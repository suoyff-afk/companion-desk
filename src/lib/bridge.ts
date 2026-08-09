import type { ProviderSnapshot, WidgetPreferences } from "../types";
import type { WindowLogger, WindowPort, WindowSize } from "../app/windowController";
import { recoverWindowPosition, type PhysicalRect } from "../app/windowPosition";
import { findDockTarget, placeDockedWindow } from "../app/petDocking";
import type { DockSide } from "../components/petPreferences";
import type { Effects } from "@tauri-apps/api/window";

const defaultPreferences: WidgetPreferences = { locked: false, alwaysOnTop: false, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN" };

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 78 * 60_000).toISOString(), windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type NativeQuotaRefreshReason = "tray" | "resume";

export interface NativeAppEvents {
  listenQuotaRefreshRequests(
    handler: (reason: NativeQuotaRefreshReason) => void,
  ): Promise<() => void>;
  listenActivateCollapsed(handler: () => void): Promise<() => void>;
}

export async function listenQuotaRefreshRequests(
  handler: (reason: NativeQuotaRefreshReason) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<NativeQuotaRefreshReason>("refresh-requested", (event) => {
    if (event.payload === "tray" || event.payload === "resume") handler(event.payload);
  });
}

export async function listenActivateCollapsed(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen("activate-collapsed", handler);
}

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export async function openCodexApp(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_codex_app");
}

export interface DesktopWindowPort extends WindowPort {
  center(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  quit(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  dragAndDock(): Promise<DockSide>;
  dock(side: Exclude<DockSide, null>): Promise<void>;
  currentWorkArea(): Promise<WindowSize | null>;
  innerSize(): Promise<WindowSize | null>;
  onResized(handler: (size: WindowSize) => void | Promise<void>): Promise<() => void>;
}

function warnWindowBridge(logger: WindowLogger, message: string, error: unknown): void {
  try { logger.warn(message, error); } catch { /* Logging is best-effort. */ }
}

const browserWindowPort: DesktopWindowPort = {
  center: async () => undefined,
  ensureVisible: async () => undefined,
  hide: async () => undefined,
  close: async () => undefined,
  quit: async () => undefined,
  dragAndDock: async () => null,
  dock: async () => undefined,
  clearEffects: async () => undefined,
  unmaximize: async () => undefined,
  toggleMaximize: async () => undefined,
  isMaximized: async () => false,
  setAlwaysOnTop: async () => undefined,
  setResizable: async () => undefined,
  setEffects: async () => undefined,
  setShadow: async () => undefined,
  setMinSize: async () => undefined,
  setMaxSize: async () => undefined,
  setSize: async () => undefined,
  setSkipTaskbar: async () => undefined,
  currentWorkArea: async () => null,
  innerSize: async () => null,
  onResized: async () => () => undefined,
};

export function createDesktopWindowPort(logger: WindowLogger = console): DesktopWindowPort {
  if (!isTauri()) return browserWindowPort;

  const windowApi = import("@tauri-apps/api/window");
  const resizeDebounceMs = 250;
  let ignoreResizeEventsUntil = 0;

  const markProgrammaticResize = () => {
    ignoreResizeEventsUntil = Date.now() + resizeDebounceMs;
  };

  const toLogicalSize = async (size: WindowSize & {
    toLogical(scaleFactor: number): WindowSize;
  }): Promise<WindowSize> => {
    const { getCurrentWindow } = await windowApi;
    const logical = size.toLogical(await getCurrentWindow().scaleFactor());
    return { width: logical.width, height: logical.height };
  };

  const readDockGeometry = async () => {
    const { currentMonitor, getCurrentWindow } = await windowApi;
    const currentWindow = getCurrentWindow();
    const [position, size, monitor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
      currentMonitor(),
    ]);
    if (monitor === null) return null;
    return {
      currentWindow,
      windowRect: { x: position.x, y: position.y, width: size.width, height: size.height },
      workArea: {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      },
    };
  };

  return {
    center: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().center();
    },
    ensureVisible: async () => {
      const { availableMonitors, getCurrentWindow, PhysicalPosition } = await windowApi;
      const currentWindow = getCurrentWindow();
      const [position, size, monitors] = await Promise.all([
        currentWindow.outerPosition(),
        currentWindow.outerSize(),
        availableMonitors(),
      ]);
      const workAreas: PhysicalRect[] = monitors.map((monitor) => ({
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      }));
      if (workAreas.length === 0) {
        await currentWindow.center();
        return;
      }
      const recovered = recoverWindowPosition({
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      }, workAreas);
      if (recovered.recovered) {
        await currentWindow.setPosition(new PhysicalPosition(recovered.x, recovered.y));
      }
    },
    hide: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().hide();
    },
    close: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().close();
    },
    quit: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app");
    },
    dragAndDock: async () => {
      const { getCurrentWindow, PhysicalPosition } = await windowApi;
      await getCurrentWindow().startDragging();
      const geometry = await readDockGeometry();
      if (geometry === null) return null;
      const target = findDockTarget(geometry.windowRect, geometry.workArea);
      if (target !== null) {
        await geometry.currentWindow.setPosition(new PhysicalPosition(target.x, target.y));
      }
      return target?.side ?? null;
    },
    dock: async (side) => {
      const { PhysicalPosition } = await windowApi;
      const geometry = await readDockGeometry();
      if (geometry === null) return;
      const target = placeDockedWindow(geometry.windowRect, geometry.workArea, side);
      await geometry.currentWindow.setPosition(new PhysicalPosition(target.x, target.y));
    },
    clearEffects: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().clearEffects();
    },
    unmaximize: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().unmaximize();
    },
    toggleMaximize: async () => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().toggleMaximize();
    },
    isMaximized: async () => {
      const { getCurrentWindow } = await windowApi;
      return getCurrentWindow().isMaximized();
    },
    setAlwaysOnTop: async (value) => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().setAlwaysOnTop(value);
    },
    setResizable: async (value) => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().setResizable(value);
    },
    setEffects: async (effects) => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().setEffects(effects as unknown as Effects);
    },
    setShadow: async (value) => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().setShadow(value);
    },
    setMinSize: async (size) => {
      const { getCurrentWindow, LogicalSize } = await windowApi;
      markProgrammaticResize();
      await getCurrentWindow().setMinSize(new LogicalSize(size));
    },
    setMaxSize: async (size) => {
      const { getCurrentWindow, LogicalSize } = await windowApi;
      markProgrammaticResize();
      await getCurrentWindow().setMaxSize(size === null ? null : new LogicalSize(size));
    },
    setSize: async (size) => {
      const { getCurrentWindow, LogicalSize } = await windowApi;
      markProgrammaticResize();
      await getCurrentWindow().setSize(new LogicalSize(size));
    },
    setSkipTaskbar: async (value) => {
      const { getCurrentWindow } = await windowApi;
      await getCurrentWindow().setSkipTaskbar(value);
    },
    currentWorkArea: async () => {
      const { currentMonitor } = await windowApi;
      const monitor = await currentMonitor();
      if (monitor === null) return null;
      const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
      return { width: size.width, height: size.height };
    },
    innerSize: async () => {
      const { getCurrentWindow } = await windowApi;
      return toLogicalSize(await getCurrentWindow().innerSize());
    },
    onResized: async (handler) => {
      const { getCurrentWindow } = await windowApi;
      let disposed = false;
      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      const unlisten = await getCurrentWindow().onResized(({ payload }) => {
        if (disposed || Date.now() < ignoreResizeEventsUntil) return;
        if (resizeTimer !== undefined) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = undefined;
          void toLogicalSize(payload)
            .then((size) => {
              if (disposed) return;
              try {
                void Promise.resolve(handler(size)).catch((error) => {
                  warnWindowBridge(logger, "[windowBridge] resize handler failed", error);
                });
              } catch (error) {
                warnWindowBridge(logger, "[windowBridge] resize handler failed", error);
              }
            })
            .catch((error) => {
              if (disposed) return;
              warnWindowBridge(logger, "[windowBridge] resize conversion failed", error);
            });
        }, resizeDebounceMs);
      });
      return () => {
        disposed = true;
        if (resizeTimer !== undefined) clearTimeout(resizeTimer);
        resizeTimer = undefined;
        unlisten();
      };
    },
  };
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  return () => { unlistenPreferences(); unlistenRefresh(); };
}
