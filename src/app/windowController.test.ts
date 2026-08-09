// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopWindowPort, openCodexApp } from "../lib/bridge";
import { COLLAPSED_NOTIFICATION_LAYOUT, DEFAULT_WINDOW_LAYOUTS } from "./windowLayout";
import { applyWindowLayout, type WindowPort, type WindowSize } from "./windowController";

type PhysicalTestSize = WindowSize & {
  toLogical(scaleFactor: number): WindowSize;
};

type ResizeListener = (event: { payload: PhysicalTestSize }) => void;

const tauriWindowMocks = vi.hoisted(() => ({
  currentMonitor: vi.fn(),
  clearEffects: vi.fn(),
  innerSize: vi.fn(),
  onResized: vi.fn(),
  scaleFactor: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setMaxSize: vi.fn(),
  setMinSize: vi.fn(),
  setResizable: vi.fn(),
  setEffects: vi.fn(),
  setShadow: vi.fn(),
  setSize: vi.fn(),
  setSkipTaskbar: vi.fn(),
  unmaximize: vi.fn(),
  toggleMaximize: vi.fn(),
  isMaximized: vi.fn(),
  outerPosition: vi.fn(),
  outerSize: vi.fn(),
  setPosition: vi.fn(),
  startDragging: vi.fn(),
}));

const tauriCoreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMocks.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: tauriWindowMocks.currentMonitor,
  getCurrentWindow: () => ({
    clearEffects: tauriWindowMocks.clearEffects,
    innerSize: tauriWindowMocks.innerSize,
    onResized: tauriWindowMocks.onResized,
    scaleFactor: tauriWindowMocks.scaleFactor,
    setAlwaysOnTop: tauriWindowMocks.setAlwaysOnTop,
    setMaxSize: tauriWindowMocks.setMaxSize,
    setMinSize: tauriWindowMocks.setMinSize,
    setResizable: tauriWindowMocks.setResizable,
    setEffects: tauriWindowMocks.setEffects,
    setShadow: tauriWindowMocks.setShadow,
    setSize: tauriWindowMocks.setSize,
    setSkipTaskbar: tauriWindowMocks.setSkipTaskbar,
    unmaximize: tauriWindowMocks.unmaximize,
    toggleMaximize: tauriWindowMocks.toggleMaximize,
    isMaximized: tauriWindowMocks.isMaximized,
    outerPosition: tauriWindowMocks.outerPosition,
    outerSize: tauriWindowMocks.outerSize,
    setPosition: tauriWindowMocks.setPosition,
    startDragging: tauriWindowMocks.startDragging,
  }),
  LogicalSize: class MockLogicalSize {
    width: number;
    height: number;

    constructor(size: WindowSize) {
      this.width = size.width;
      this.height = size.height;
    }
  },
  PhysicalPosition: class MockPhysicalPosition {
    x: number;
    y: number;

    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.useRealTimers();
  vi.resetAllMocks();
});

function enableTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
}

function describeSize(size: WindowSize | null): string {
  return size === null ? "cleared" : `${size.width}x${size.height}`;
}

function createRecordingPort(
  calls: string[],
  failures: Map<string, Error> = new Map(),
): WindowPort {
  const record = async (call: string) => {
    calls.push(call);
    const error = failures.get(call);
    if (error !== undefined) {
      failures.delete(call);
      throw error;
    }
  };

  return {
    clearEffects: () => record("clearEffects"),
    unmaximize: () => record("unmaximize"),
    setAlwaysOnTop: (value) => record(`setAlwaysOnTop:${value}`),
    setResizable: (value) => record(`setResizable:${value}`),
    setEffects: (effects) => record(`setEffects:${effects.effects.join(",")}`),
    setShadow: (value) => record(`setShadow:${value}`),
    setMinSize: (size) => record(`setMinSize:${describeSize(size)}`),
    setMaxSize: (size) => record(`setMaxSize:${describeSize(size)}`),
    setSize: (size) => record(`setSize:${describeSize(size)}`),
    setSkipTaskbar: (value) => record(`setSkipTaskbar:${value}`),
  };
}

function physicalSize(width: number, height: number): PhysicalTestSize {
  return {
    width,
    height,
    toLogical: vi.fn((scaleFactor: number) => ({
      width: width / scaleFactor,
      height: height / scaleFactor,
    })),
  };
}

function captureResizeListeners(nativeUnlisten: () => void = () => undefined): ResizeListener[] {
  const listeners: ResizeListener[] = [];
  tauriWindowMocks.onResized.mockImplementation(async (listener) => {
    listeners.push(listener);
    return nativeUnlisten;
  });
  return listeners;
}

describe("applyWindowLayout", () => {
  it("applies the collapsed fixed-size policy and keeps it on top last", async () => {
    const calls: string[] = [];

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.collapsed,
      createRecordingPort(calls),
    )).resolves.toBe(true);

    expect(calls).toEqual([
      "unmaximize",
      "setResizable:true",
      "clearEffects",
      "setShadow:false",
      "setMaxSize:cleared",
      "setMinSize:160x150",
      "setMaxSize:160x150",
      "setSize:160x150",
      "setResizable:false",
      "setSkipTaskbar:true",
      "setAlwaysOnTop:true",
    ]);
  });

  it("clears the previous collapsed maximum before raising the notification minimum", async () => {
    const calls: string[] = [];

    await expect(applyWindowLayout(
      COLLAPSED_NOTIFICATION_LAYOUT,
      createRecordingPort(calls),
    )).resolves.toBe(true);

    const clearedMaximumIndex = calls.indexOf("setMaxSize:cleared");
    const notificationMinimumIndex = calls.indexOf("setMinSize:300x150");
    expect(clearedMaximumIndex).toBeGreaterThanOrEqual(0);
    expect(notificationMinimumIndex).toBeGreaterThan(clearedMaximumIndex);
    expect(calls).toContain("setMaxSize:300x150");
  });

  it("makes an expanded window findable and clears its maximum before raising its minimum", async () => {
    const calls: string[] = [];

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.home,
      createRecordingPort(calls),
    )).resolves.toBe(true);

    expect(calls).toEqual([
      "unmaximize",
      "setAlwaysOnTop:false",
      "setResizable:true",
      "setSkipTaskbar:false",
      "clearEffects",
      "setShadow:false",
      "setMaxSize:cleared",
      "setMinSize:360x300",
      "setSize:380x310",
      "setResizable:true",
    ]);
  });

  it("checks native visibility after applying an expanded layout", async () => {
    const calls: string[] = [];
    const ensureVisible = vi.fn(async () => undefined);
    const port = { ...createRecordingPort(calls), ensureVisible };

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.home,
      port,
    )).resolves.toBe(true);

    expect(ensureVisible).toHaveBeenCalledOnce();
  });

  it("continues expanding when the platform rejects the optional material effect", async () => {
    const calls: string[] = [];
    const error = new Error("mica unsupported");
    const logger = { warn: vi.fn() };
    const port = createRecordingPort(calls, new Map([["clearEffects", error]]));

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.home,
      port,
      logger,
    )).resolves.toBe(true);

    expect(calls).toEqual([
      "unmaximize",
      "setAlwaysOnTop:false",
      "setResizable:true",
      "setSkipTaskbar:false",
      "clearEffects",
      "setShadow:false",
      "setMaxSize:cleared",
      "setMinSize:360x300",
      "setSize:380x310",
      "setResizable:true",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowController] optional step failed at clearEffects",
      error,
    );
  });

  it("continues collapsing when an optional native material call is unavailable", async () => {
    const calls: string[] = [];
    const error = new Error("effects unavailable");
    const logger = { warn: vi.fn() };
    const port = createRecordingPort(calls, new Map([["clearEffects", error]]));

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.collapsed,
      port,
      logger,
    )).resolves.toBe(true);

    expect(calls).toContain("setSize:160x150");
    expect(calls.at(-1)).toBe("setAlwaysOnTop:true");
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowController] optional step failed at clearEffects",
      error,
    );
  });

  it("logs the failed expanded step and restores a findable unconstrained window", async () => {
    const calls: string[] = [];
    const error = new Error("minimum rejected");
    const logger = { warn: vi.fn() };
    const port = createRecordingPort(calls, new Map([["setMinSize:360x300", error]]));

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.home,
      port,
      logger,
    )).resolves.toBe(false);

    expect(calls).toEqual([
      "unmaximize",
      "setAlwaysOnTop:false",
      "setResizable:true",
      "setSkipTaskbar:false",
      "clearEffects",
      "setShadow:false",
      "setMaxSize:cleared",
      "setMinSize:360x300",
      "setAlwaysOnTop:false",
      "setSkipTaskbar:false",
      "setResizable:true",
      "setMaxSize:cleared",
      "clearEffects",
      "setShadow:false",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowController] apply failed at setMinSize",
      error,
    );
  });

  it("undoes hidden and fixed state when collapsed taskbar hiding fails", async () => {
    const calls: string[] = [];
    const error = new Error("taskbar rejected");
    const logger = { warn: vi.fn() };
    const port = createRecordingPort(calls, new Map([["setSkipTaskbar:true", error]]));

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.collapsed,
      port,
      logger,
    )).resolves.toBe(false);

    expect(calls.slice(-6)).toEqual([
      "setAlwaysOnTop:false",
      "setSkipTaskbar:false",
      "setResizable:true",
      "setMaxSize:cleared",
      "clearEffects",
      "setShadow:false",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowController] apply failed at setSkipTaskbar(collapsed)",
      error,
    );
  });

  it("continues best-effort recovery when one recovery call also rejects", async () => {
    const calls: string[] = [];
    const applyError = new Error("size rejected");
    const recoveryError = new Error("taskbar restore rejected");
    const logger = { warn: vi.fn() };
    const port = createRecordingPort(calls, new Map([
      ["setSize:160x150", applyError],
      ["setSkipTaskbar:false", recoveryError],
    ]));

    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.collapsed,
      port,
      logger,
    )).resolves.toBe(false);

    expect(calls.slice(-6)).toEqual([
      "setAlwaysOnTop:false",
      "setSkipTaskbar:false",
      "setResizable:true",
      "setMaxSize:cleared",
      "clearEffects",
      "setShadow:false",
    ]);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      "[windowController] apply failed at setSize",
      applyError,
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      "[windowController] recovery failed at setSkipTaskbar(false)",
      recoveryError,
    );
  });

  it("uses a successful no-op port in a regular browser", async () => {
    await expect(applyWindowLayout(
      DEFAULT_WINDOW_LAYOUTS.home,
      createDesktopWindowPort(),
    )).resolves.toBe(true);
  });
});

describe("createDesktopWindowPort", () => {
  it("forwards native maximize operations to the current window", async () => {
    enableTauri();
    tauriWindowMocks.toggleMaximize.mockResolvedValue(undefined);
    tauriWindowMocks.isMaximized.mockResolvedValue(true);
    const port = createDesktopWindowPort();

    await expect(port.toggleMaximize()).resolves.toBeUndefined();
    await expect(port.isMaximized()).resolves.toBe(true);

    expect(tauriWindowMocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(tauriWindowMocks.isMaximized).toHaveBeenCalledOnce();
  });

  it("snaps a completed native pet drag to a nearby monitor edge", async () => {
    enableTauri();
    tauriWindowMocks.startDragging.mockResolvedValue(undefined);
    tauriWindowMocks.outerPosition.mockResolvedValue({ x: 8, y: 100 });
    tauriWindowMocks.outerSize.mockResolvedValue({ width: 160, height: 150 });
    tauriWindowMocks.currentMonitor.mockResolvedValue({
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1_920, height: 1_040 },
      },
    });

    await expect(createDesktopWindowPort().dragAndDock()).resolves.toBe("left");
    expect(tauriWindowMocks.setPosition).toHaveBeenCalledWith({ x: 0, y: 100 });
  });

  it("uses the dedicated native launcher for Codex", async () => {
    enableTauri();

    await openCodexApp();

    expect(tauriCoreMocks.invoke).toHaveBeenCalledWith("open_codex_app");
  });

  it("uses a dedicated native command for a real app quit", async () => {
    enableTauri();

    await createDesktopWindowPort().quit();

    expect(tauriCoreMocks.invoke).toHaveBeenCalledWith("quit_app");
  });

  it("treats quit as a successful no-op in a regular browser", async () => {
    await expect(createDesktopWindowPort().quit()).resolves.toBeUndefined();
    expect(tauriCoreMocks.invoke).not.toHaveBeenCalled();
  });

  it("maps material and shadow methods to the current native window", async () => {
    enableTauri();
    const port = createDesktopWindowPort();

    await port.clearEffects();
    await port.setEffects({ effects: ["micaLight"] });
    await port.setShadow(false);
    await port.setAlwaysOnTop(true);

    expect(tauriWindowMocks.clearEffects).toHaveBeenCalledOnce();
    expect(tauriWindowMocks.setEffects).toHaveBeenCalledWith({ effects: ["micaLight"] });
    expect(tauriWindowMocks.setShadow).toHaveBeenCalledWith(false);
    expect(tauriWindowMocks.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("uses the current window scale factor for physical inner sizes", async () => {
    enableTauri();
    tauriWindowMocks.scaleFactor.mockResolvedValue(2);
    tauriWindowMocks.innerSize.mockResolvedValue(physicalSize(760, 1_080));

    await expect(createDesktopWindowPort().innerSize()).resolves.toEqual({
      width: 380,
      height: 540,
    });
    expect(tauriWindowMocks.scaleFactor).toHaveBeenCalledOnce();
  });

  it("debounces consecutive events for one listener and keeps only the latest size", async () => {
    vi.useFakeTimers();
    enableTauri();
    tauriWindowMocks.scaleFactor.mockResolvedValue(1);
    const listeners = captureResizeListeners();
    const handler = vi.fn();
    await createDesktopWindowPort().onResized(handler);

    listeners[0]({ payload: physicalSize(400, 500) });
    await vi.advanceTimersByTimeAsync(100);
    listeners[0]({ payload: physicalSize(600, 700) });
    await vi.advanceTimersByTimeAsync(249);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ width: 600, height: 700 });
  });

  it("debounces two resize listeners independently", async () => {
    vi.useFakeTimers();
    enableTauri();
    tauriWindowMocks.scaleFactor.mockResolvedValue(1);
    const listeners = captureResizeListeners();
    const first = vi.fn();
    const second = vi.fn();
    const port = createDesktopWindowPort();
    await port.onResized(first);
    await port.onResized(second);

    listeners[0]({ payload: physicalSize(400, 500) });
    listeners[1]({ payload: physicalSize(600, 700) });
    await vi.advanceTimersByTimeAsync(250);

    expect(first).toHaveBeenCalledWith({ width: 400, height: 500 });
    expect(second).toHaveBeenCalledWith({ width: 600, height: 700 });
  });

  it("cleanup clears a pending debounce and calls the native unlisten", async () => {
    vi.useFakeTimers();
    enableTauri();
    tauriWindowMocks.scaleFactor.mockResolvedValue(1);
    const nativeUnlisten = vi.fn();
    const listeners = captureResizeListeners(nativeUnlisten);
    const handler = vi.fn();
    const cleanup = await createDesktopWindowPort().onResized(handler);

    listeners[0]({ payload: physicalSize(400, 500) });
    cleanup();
    await vi.advanceTimersByTimeAsync(250);

    expect(handler).not.toHaveBeenCalled();
    expect(nativeUnlisten).toHaveBeenCalledOnce();
  });

  it("does not call a disposed listener after its pending scale-factor read resolves", async () => {
    vi.useFakeTimers();
    enableTauri();
    let resolveScaleFactor!: (value: number) => void;
    tauriWindowMocks.scaleFactor.mockReturnValue(new Promise<number>((resolve) => {
      resolveScaleFactor = resolve;
    }));
    const listeners = captureResizeListeners();
    const handler = vi.fn();
    const cleanup = await createDesktopWindowPort().onResized(handler);
    const payload = physicalSize(800, 1_000);

    listeners[0]({ payload });
    await vi.advanceTimersByTimeAsync(250);
    expect(tauriWindowMocks.scaleFactor).toHaveBeenCalledOnce();
    cleanup();
    resolveScaleFactor(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(payload.toLogical).toHaveBeenCalledWith(2);
    expect(handler).not.toHaveBeenCalled();
  });

  it("suppresses resize events caused by a programmatic setSize", async () => {
    vi.useFakeTimers();
    enableTauri();
    tauriWindowMocks.scaleFactor.mockResolvedValue(1);
    const listeners = captureResizeListeners();
    const handler = vi.fn();
    const port = createDesktopWindowPort();
    await port.onResized(handler);

    await port.setSize({ width: 380, height: 540 });
    listeners[0]({ payload: physicalSize(380, 540) });
    await vi.advanceTimersByTimeAsync(250);
    expect(handler).not.toHaveBeenCalled();

    listeners[0]({ payload: physicalSize(400, 560) });
    await vi.advanceTimersByTimeAsync(250);
    expect(handler).toHaveBeenCalledWith({ width: 400, height: 560 });
  });

  it("logs resize conversion failures separately from handler failures", async () => {
    vi.useFakeTimers();
    enableTauri();
    const logger = { warn: vi.fn() };
    const listeners = captureResizeListeners();
    const conversionError = new Error("scale factor unavailable");
    tauriWindowMocks.scaleFactor.mockRejectedValueOnce(conversionError);
    const handler = vi.fn();
    await createDesktopWindowPort(logger).onResized(handler);

    listeners[0]({ payload: physicalSize(400, 500) });
    await vi.advanceTimersByTimeAsync(250);
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowBridge] resize conversion failed",
      conversionError,
    );

    const handlerError = new Error("consumer failed");
    tauriWindowMocks.scaleFactor.mockResolvedValueOnce(1);
    handler.mockImplementationOnce(() => { throw handlerError; });
    listeners[0]({ payload: physicalSize(600, 700) });
    await vi.advanceTimersByTimeAsync(250);
    expect(logger.warn).toHaveBeenCalledWith(
      "[windowBridge] resize handler failed",
      handlerError,
    );
  });

  it("logs rejected async resize handlers", async () => {
    vi.useFakeTimers();
    enableTauri();
    const logger = { warn: vi.fn() };
    const listeners = captureResizeListeners();
    const handlerError = new Error("async persistence failed");
    tauriWindowMocks.scaleFactor.mockResolvedValue(1);
    const handler = vi.fn(async () => { throw handlerError; });
    await createDesktopWindowPort(logger).onResized(handler);

    listeners[0]({ payload: physicalSize(600, 700) });
    await vi.advanceTimersByTimeAsync(250);

    expect(logger.warn).toHaveBeenCalledWith(
      "[windowBridge] resize handler failed",
      handlerError,
    );
  });
});
