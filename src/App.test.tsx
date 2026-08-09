// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowSize } from "./app/windowController";
import type { DesktopWindowPort } from "./lib/bridge";
import { createMemoryAdapter } from "./lib/persistence";
import type { FocusSummary } from "./features/focus/FocusPage";
import type { FriendPort, FriendPortHandlers } from "./features/friends/FriendPort";
import type { FriendSnapshot } from "./features/friends/types";
import type { ProviderSnapshot } from "./types";
import type { NativeAppEvents } from "./lib/bridge";
import type { TokenHistorySnapshot } from "./features/token/tokenHistory";
import { TokenPage } from "./features/token/TokenPage";
import { GameCenterPage } from "./features/games/RechargePage";
import ProductionApp, {
  POKE_NOTIFICATION_DURATION_MS,
  POKE_QUEUE_LIMIT,
  appendBoundedPoke,
  type AppProps,
} from "./App";

afterEach(cleanup);

const quota: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 62, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 48, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: null,
  updatedAt: "2026-07-16T12:00:00.000Z",
  status: "ok",
  message: null,
};

interface TestWindowPort extends DesktopWindowPort {
  emitResize(size: WindowSize): Promise<void>;
}

function createWindowPort(overrides: Partial<DesktopWindowPort> = {}): TestWindowPort {
  let resizeHandler: ((size: WindowSize) => void | Promise<void>) | null = null;

  const port: TestWindowPort = {
    center: vi.fn(async () => undefined),
    ensureVisible: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    dragAndDock: vi.fn(async () => null),
    dock: vi.fn(async () => undefined),
    clearEffects: vi.fn(async () => undefined),
    unmaximize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    setAlwaysOnTop: vi.fn(async () => undefined),
    setResizable: vi.fn(async () => undefined),
    setEffects: vi.fn(async () => undefined),
    setShadow: vi.fn(async () => undefined),
    setMinSize: vi.fn(async () => undefined),
    setMaxSize: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined),
    setSkipTaskbar: vi.fn(async () => undefined),
    currentWorkArea: vi.fn(async () => ({ width: 1_200, height: 900 })),
    innerSize: vi.fn(async () => null),
    onResized: vi.fn(async (handler) => {
      let active = true;
      resizeHandler = (size) => active ? handler(size) : undefined;
      return () => {
        active = false;
        if (resizeHandler !== null) resizeHandler = null;
      };
    }),
    emitResize: async (size) => {
      if (resizeHandler !== null) await resizeHandler(size);
    },
    ...overrides,
  };
  return port;
}

function quotaLoader() {
  return vi.fn(async () => [quota]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function historyFixture(): TokenHistorySnapshot {
  const usage = { raw: 256_000, input: 128_000, cachedInput: 64_000, uncachedInput: 64_000, output: 128_000, reasoningOutput: 32_000 };
  return {
    todayTokens: 256_000, sevenDayTokens: 256_000, averageRequestTokens: 256_000,
    eventCount: 1, usage, daily: [{ date: "2026-07-29", totalTokens: 256_000, eventCount: 1, usage }],
    sources: ["vscode", "subagent", "other"].map((source) => ({ source: source as "vscode" | "subagent" | "other", fileCount: 0, usage: { ...usage, raw: 0, input: 0, cachedInput: 0, uncachedInput: 0, output: 0, reasoningOutput: 0 } })),
    activeFileCount: 0, archiveFileCount: 0, unreadableFileCount: 0,
  };
}

function createNativeAppEvents() {
  let handler: ((reason: "tray" | "resume") => void) | null = null;
  let collapsedHandler: (() => void) | null = null;
  const unlisten = vi.fn();
  const unlistenCollapsed = vi.fn();
  const port = {
    listenQuotaRefreshRequests: vi.fn(async (nextHandler) => {
      handler = nextHandler;
      return unlisten;
    }),
    listenActivateCollapsed: vi.fn(async (nextHandler: () => void) => {
      collapsedHandler = nextHandler;
      return unlistenCollapsed;
    }),
  };
  return {
    port: port as NativeAppEvents,
    unlisten,
    unlistenCollapsed,
    emit(reason: "tray" | "resume") { handler?.(reason); },
    emitCollapsed() { collapsedHandler?.(); },
  };
}

function friendSnapshot(overrides: Partial<FriendSnapshot> = {}): FriendSnapshot {
  return {
    connectionState: "ready",
    self: { uid: "self", displayName: "Kunkun", createdAt: 1 },
    ownFriendCode: "48271936",
    friends: [{ uid: "momo", displayName: "Momo", acceptedAt: 1 }],
    pendingRequests: [],
    cooldownsByFriendUid: {},
    incomingPoke: null,
    ...overrides,
  };
}

function createFriendPort(initial = friendSnapshot()) {
  let handlers: FriendPortHandlers | null = null;
  const stop = vi.fn(() => { handlers = null; });
  const port: FriendPort = {
    start: vi.fn(async (nextHandlers) => {
      handlers = nextHandlers;
      nextHandlers.onSnapshot(initial);
      return stop;
    }),
    requestByCode: vi.fn(async () => undefined),
    acceptRequest: vi.fn(async () => undefined),
    ignoreRequest: vi.fn(async () => undefined),
    poke: vi.fn(async () => undefined),
    removeFriend: vi.fn(async () => undefined),
    resetIdentity: vi.fn(async () => undefined),
  };
  return {
    port,
    stop,
    emit(snapshot: FriendSnapshot) {
      handlers?.onSnapshot(snapshot);
    },
    fail(error: Error) {
      handlers?.onError?.(error);
    },
  };
}

function App(props: AppProps) {
  return <ProductionApp initialView="home" {...props} />;
}

const featureTypeChecks: NonNullable<AppProps["features"]> = {
  // @ts-expect-error TokenPage requires quota props and cannot replace the games page.
  games: TokenPage,
  // @ts-expect-error GameCenterPage requires onNavigate and cannot replace TokenPage.
  token: GameCenterPage,
};
void featureTypeChecks;

describe("App companion views", () => {
  it("keeps Desk chrome visible when a feature throws and retries the feature", async () => {
    let shouldThrow = true;
    const CrashingFocus = () => {
      if (shouldThrow) throw new Error("focus failed");
      return <p>Focus recovered</p>;
    };

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => render(
        <ProductionApp
          initialView="focus"
          windowPort={createWindowPort()}
          storageAdapter={createMemoryAdapter()}
          loadQuota={quotaLoader()}
          features={{ focus: CrashingFocus }}
        />,
      )).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("could not load.");
    expect(screen.getByRole("button", { name: "返回主页" })).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Focus recovered")).toBeInTheDocument();
  });

  it("recreates a rejected lazy feature loader when Retry is pressed", async () => {
    const loadFocus = vi.fn()
      .mockRejectedValueOnce(new Error("focus chunk unavailable"))
      .mockResolvedValueOnce({ default: () => <p>Focus chunk recovered</p> });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <ProductionApp
          initialView="focus"
          windowPort={createWindowPort()}
          storageAdapter={createMemoryAdapter()}
          loadQuota={quotaLoader()}
          featureLoaders={{ focus: loadFocus }}
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent("could not load.");
      expect(loadFocus).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Focus chunk recovered")).toBeInTheDocument();
      expect(loadFocus).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps an injected friend port inactive and hides all friend UI when friends are explicitly disabled", async () => {
    const friends = createFriendPort();
    const windowPort = createWindowPort();
    render(
      <ProductionApp
        initialView="home"
        friendsEnabled={false}
        friendPort={friends.port}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 380, height: 310 }));
    expect(friends.port.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "好友" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加好友" })).not.toBeInTheDocument();
    expect(screen.queryByText("好友功能暂不可用")).not.toBeInTheDocument();
  });

  it("keeps injected friend functionality available only when friends are explicitly enabled", async () => {
    const friends = createFriendPort();
    render(
      <ProductionApp
        initialView="home"
        friendsEnabled
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Momo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加好友" })).toBeInTheDocument();
  });

  it("starts an injected friend port when friends are enabled after an initially disabled render", async () => {
    const friends = createFriendPort();
    const rendered = render(
      <ProductionApp
        initialView="home"
        friendsEnabled={false}
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    expect(friends.port.start).not.toHaveBeenCalled();
    rendered.rerender(
      <ProductionApp
        initialView="home"
        friendsEnabled
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Momo" })).toBeInTheDocument();
  });

  it("cleans up an enabled friend port when friends are disabled after mount", async () => {
    const friends = createFriendPort();
    const rendered = render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    rendered.rerender(
      <ProductionApp
        friendsEnabled={false}
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.stop).toHaveBeenCalledOnce());
    act(() => friends.emit(friendSnapshot({
      incomingPoke: { senderUid: "momo", eventId: "disabled-after-start", createdAt: 1 },
    })));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("defers the default friend port factory until friends are enabled", async () => {
    const friends = createFriendPort();
    const friendPortFactory = vi.fn(() => friends.port);
    const rendered = render(
      <ProductionApp
        initialView="home"
        friendsEnabled={false}
        friendPortFactory={friendPortFactory}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    expect(friendPortFactory).not.toHaveBeenCalled();
    rendered.rerender(
      <ProductionApp
        initialView="home"
        friendsEnabled
        friendPortFactory={friendPortFactory}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friendPortFactory).toHaveBeenCalledOnce());
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
  });

  it("returns Home to the floating pet when the window close control is clicked", async () => {
    render(<App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));

    expect(await screen.findByRole("button", { name: "展开 Companion Desk" })).toBeInTheDocument();
  });

  it.each([
    ["home", false, false],
    ["focus", true, false],
    ["games", true, false],
    ["game2048", true, false],
    ["gomoku", true, false],
    ["token", true, true],
    ["hpc", true, true],
  ] as const)(
    "renders the approved %s page controls in the real App",
    async (initialView, showBack, showMaximize) => {
      render(
        <ProductionApp
          initialView={initialView}
          windowPort={createWindowPort()}
          storageAdapter={createMemoryAdapter()}
          loadQuota={quotaLoader()}
          features={{
            focus: () => <p>Focus matrix</p>,
            games: () => <p>Games matrix</p>,
            game2048: () => <p>2048 matrix</p>,
            gomoku: () => <p>Gomoku matrix</p>,
            token: () => <p>Token matrix</p>,
            hpc: () => <p>HPC matrix</p>,
          }}
        />,
      );

      expect(screen.getByRole("button", { name: "关闭面板，返回宠物" })).toBeInTheDocument();
      if (showBack) {
        expect(screen.getByRole("button", { name: /返回主页|返回游戏中心/ })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: /返回主页|返回游戏中心/ })).not.toBeInTheDocument();
      }
      if (showMaximize) {
        expect(screen.getByRole("button", { name: "最大化或还原" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "最大化或还原" })).not.toBeInTheDocument();
      }
    },
  );

  it.each([
    ["Close", "关闭面板，返回宠物", { width: 160, height: 150 }],
    ["Back", "返回主页", { width: 380, height: 310 }],
  ] as const)("serializes a pending maximize before %s applies its layout", async (_action, actionLabel, expectedSize) => {
    const calls: string[] = [];
    const pendingToggle = deferred<void>();
    const windowPort = createWindowPort({
      toggleMaximize: vi.fn(async () => {
        calls.push("toggle:start");
        await pendingToggle.promise;
        calls.push("toggle:end");
      }),
      unmaximize: vi.fn(async () => { calls.push("unmaximize"); }),
    });
    render(
      <ProductionApp
        initialView="token"
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ token: () => <p>Token race</p> }}
      />,
    );
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());
    calls.length = 0;
    vi.mocked(windowPort.setSize).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "最大化或还原" }));
    fireEvent.click(screen.getByRole("button", { name: actionLabel }));
    await waitFor(() => expect(calls).toEqual(["toggle:start"]));

    await act(async () => { pendingToggle.resolve(); });
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith(expectedSize));
    expect(calls).toEqual(["toggle:start", "toggle:end", "unmaximize"]);
  });

  it("records a maximize failure and still runs the queued collapsed layout", async () => {
    const logger = { warn: vi.fn() };
    const windowPort = createWindowPort({
      toggleMaximize: vi.fn(async () => { throw new Error("maximize unavailable"); }),
    });
    render(
      <ProductionApp
        initialView="hpc"
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        logger={logger}
        features={{ hpc: () => <p>HPC recovery</p> }}
      />,
    );
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());
    vi.mocked(windowPort.setSize).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "最大化或还原" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 160, height: 150 }));
    expect(windowPort.toggleMaximize).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("[App] failed to toggle maximize", expect.any(Error));
  });

  it("uses the latest quota loader after rerender for manual, tray, and interval refreshes", async () => {
    vi.useFakeTimers();
    try {
      const nativeEvents = createNativeAppEvents();
      const loadA = vi.fn(async (_force?: boolean) => [quota]);
      const loadB = vi.fn(async (_force?: boolean) => [quota]);
      const props = { windowPort: createWindowPort(), storageAdapter: createMemoryAdapter(), nativeEvents: nativeEvents.port };
      const { rerender } = render(<App {...props} loadQuota={loadA} />);
      await act(async () => undefined);
      expect(loadA).toHaveBeenCalledWith(false);

      rerender(<App {...props} loadQuota={loadB} />);
      fireEvent.click(screen.getByRole("button", { name: "刷新额度" }));
      await act(async () => undefined);
      await act(async () => nativeEvents.emit("tray"));
      await act(async () => { await vi.advanceTimersByTimeAsync(900_000); });

      expect(loadA).toHaveBeenCalledOnce();
      expect(loadB.mock.calls.map(([force]) => force)).toEqual([true, true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one controller state from collapsed through home to Token", async () => {
    const loadQuota = vi.fn(async () => [{ ...quota, shortWindow: { ...quota.shortWindow!, remainingPercent: 73 } }]);
    render(<ProductionApp initialView="collapsed" windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} />);

    expect(await screen.findByRole("group", { name: "5小时额度：73%" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 Companion Desk" }));
    expect(await screen.findByText("73%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "Token" }));
    expect(await screen.findByRole("heading", { name: "Token" })).toBeInTheDocument();
    expect(screen.getByText("73% remaining")).toBeInTheDocument();
    expect(loadQuota).toHaveBeenCalledOnce();
  });

  it("refreshes quota for tray and resume events then removes the native listener", async () => {
    const nativeEvents = createNativeAppEvents();
    const loadQuota = quotaLoader();
    const { unmount } = render(<ProductionApp windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} nativeEvents={nativeEvents.port} />);

    await waitFor(() => expect(loadQuota).toHaveBeenCalledOnce());
    await act(async () => nativeEvents.emit("tray"));
    await act(async () => nativeEvents.emit("resume"));
    await waitFor(() => expect(loadQuota).toHaveBeenCalledTimes(3));
    unmount();
    expect(nativeEvents.unlisten).toHaveBeenCalledOnce();
  });

  it("collapses for native activation without remounting a feature page and removes its listener", async () => {
    const nativeEvents = createNativeAppEvents();
    const mounts = vi.fn();
    const Focus = () => {
      useEffect(() => {
        mounts();
      }, []);
      return <p>Focus stays mounted</p>;
    };
    const { unmount } = render(
      <ProductionApp
        initialView="focus"
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        nativeEvents={nativeEvents.port}
        features={{ focus: Focus }}
      />,
    );

    expect(await screen.findByText("Focus stays mounted")).toBeInTheDocument();
    await waitFor(() => expect((nativeEvents.port as unknown as { listenActivateCollapsed: ReturnType<typeof vi.fn> }).listenActivateCollapsed).toHaveBeenCalledOnce());
    await act(async () => nativeEvents.emitCollapsed());

    expect(await screen.findByRole("button", { name: /Companion Desk/ })).toBeInTheDocument();
    expect(screen.getByText("Focus stays mounted")).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledOnce();
    unmount();
    expect(nativeEvents.unlistenCollapsed).toHaveBeenCalledOnce();
  });

  it("warns when the native collapsed activation listener cannot be registered", async () => {
    const logger = { warn: vi.fn() };
    const nativeEvents = {
      listenQuotaRefreshRequests: vi.fn(async () => () => undefined),
      listenActivateCollapsed: vi.fn(async () => { throw new Error("event unavailable"); }),
    } as NativeAppEvents;

    render(<App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} nativeEvents={nativeEvents} logger={logger} />);

    await waitFor(() => expect(logger.warn).toHaveBeenCalledWith("[App] failed to listen for collapsed activation", expect.any(Error)));
  });

  it("ignores a native refresh emitted after unmount while listener cleanup is pending", async () => {
    const cleanup = vi.fn();
    const pendingListener = deferred<() => void>();
    let handler: ((reason: "tray" | "resume") => void) | null = null;
    const nativeEvents: NativeAppEvents = {
      listenQuotaRefreshRequests: vi.fn((nextHandler) => {
        handler = nextHandler;
        return pendingListener.promise;
      }),
      listenActivateCollapsed: vi.fn(async () => () => undefined),
    };
    const loadQuota = quotaLoader();
    const { unmount } = render(<ProductionApp windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} nativeEvents={nativeEvents} />);

    await waitFor(() => expect(loadQuota).toHaveBeenCalledOnce());
    unmount();
    (handler as ((reason: "tray" | "resume") => void) | null)?.("tray");
    expect(loadQuota).toHaveBeenCalledOnce();
    pendingListener.resolve(cleanup);
    await act(async () => undefined);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps the interval alive through StrictMode while coalescing startup", async () => {
    vi.useFakeTimers();
    try {
      const firstLoad = deferred<ProviderSnapshot[]>();
      const loadQuota = vi.fn()
        .mockReturnValueOnce(firstLoad.promise)
        .mockResolvedValueOnce([quota]);
      render(<StrictMode><App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} /></StrictMode>);

      expect(loadQuota).toHaveBeenCalledOnce();
      await act(async () => firstLoad.resolve([quota]));
      await act(async () => { await vi.advanceTimersByTimeAsync(900_000); });
      expect(loadQuota).toHaveBeenCalledTimes(2);
      expect(loadQuota).toHaveBeenLastCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains the trusted snapshot time across stale Home, Token, and collapsed views", async () => {
    const trusted = { ...quota, shortWindow: { ...quota.shortWindow!, remainingPercent: 73 }, updatedAt: "2026-07-29T09:30:00.000Z" };
    const loadQuota = vi.fn().mockResolvedValueOnce([trusted]).mockRejectedValueOnce(new Error("offline"));
    render(<App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} />);

    expect(await screen.findByText("73%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新额度" }));
    expect(await screen.findByRole("status")).toHaveTextContent("数据可能过期");
    expect(screen.getByRole("status")).toHaveTextContent("09:30");

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    expect(await screen.findByRole("status")).toHaveTextContent("09:30");
    fireEvent.click(screen.getByRole("button", { name: "展开 Companion Desk" }));
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "Token" }));
    expect(await screen.findByRole("heading", { name: "Token" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("09:30");
    expect(screen.getByText("73% remaining")).toBeInTheDocument();
  });

  it("uses App loadHistory seam and refreshes quota and history from Token", async () => {
    const loadQuota = vi.fn(async () => [quota]);
    const loadHistory = vi.fn().mockResolvedValueOnce(historyFixture()).mockRejectedValueOnce(new Error("history offline"));
    render(<ProductionApp initialView="token" windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} loadHistory={loadHistory} />);

    expect(await screen.findByText("256k")).toBeInTheDocument();
    expect(loadQuota).toHaveBeenCalledWith(false);
    expect(loadHistory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Refresh quota and local activity" }));
    await waitFor(() => expect(loadQuota).toHaveBeenCalledTimes(2));
    expect(loadQuota).toHaveBeenLastCalledWith(true);
    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(screen.getByText("62% remaining")).toBeInTheDocument();
  });

  it("keeps hide separate from the pet menu's real exit action", async () => {
    const windowPort = createWindowPort();
    render(
      <ProductionApp
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    const pet = await screen.findByRole("button", { name: "展开 Companion Desk" });
    fireEvent.contextMenu(pet);
    fireEvent.click(await screen.findByRole("menuitem", { name: "暂时隐藏" }));
    expect(windowPort.hide).toHaveBeenCalledOnce();
    expect(windowPort.quit).not.toHaveBeenCalled();

    fireEvent.contextMenu(pet);
    fireEvent.click(await screen.findByRole("menuitem", { name: "退出应用" }));
    expect(windowPort.quit).toHaveBeenCalledOnce();
    expect(windowPort.close).not.toHaveBeenCalled();
  });

  it("starts as the collapsed pet, loads quota once, and opens Companion Desk on click", async () => {
    const windowPort = createWindowPort();
    const loadQuota = quotaLoader();

    render(<ProductionApp windowPort={windowPort} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} />);

    const pet = await screen.findByRole("button", { name: "展开 Companion Desk" });
    expect(screen.queryByRole("region", { name: "Companion Desk 首页" })).not.toBeInTheDocument();
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 160, height: 150 }));
    fireEvent.click(pet);
    expect(await screen.findByRole("region", { name: "Companion Desk 首页" })).toBeInTheDocument();
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 310 }));
    expect(loadQuota).toHaveBeenCalledOnce();
  });

  it("loads and persists the three pet size presets", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("petPreferencesV1", { size: "small", dockSide: null, reactionsEnabled: true });
    const windowPort = createWindowPort();
    render(
      <ProductionApp
        windowPort={windowPort}
        storageAdapter={storageAdapter}
        loadQuota={quotaLoader()}
      />,
    );

    const pet = await screen.findByRole("button", { name: "展开 Companion Desk" });
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 120, height: 113 }));
    fireEvent.contextMenu(pet);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "大" }));
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 200, height: 188 }));
    await waitFor(() => expect(storageAdapter.get("petPreferencesV1")).resolves.toEqual({
      size: "large",
      dockSide: null,
      reactionsEnabled: true,
    }));
  });

  it("restores a persisted edge dock after applying the collapsed layout", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("petPreferencesV1", { size: "standard", dockSide: "right", reactionsEnabled: true });
    const windowPort = createWindowPort();
    const { container } = render(
      <ProductionApp
        windowPort={windowPort}
        storageAdapter={storageAdapter}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(windowPort.dock).toHaveBeenCalledWith("right"));
    expect(container.querySelector(".collapsed-companion")).toHaveAttribute("data-dock-side", "right");
  });

  it("temporarily grows Home while More is open and restores the compact layout", async () => {
    const windowPort = createWindowPort();
    render(
      <ProductionApp
        initialView="home"
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 310 }));
    vi.mocked(windowPort.setSize).mockClear();
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 355 }));

    vi.mocked(windowPort.setSize).mockClear();
    fireEvent.click(toggle);
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 310 }));
  });

  it("opens Focus and Game Center directly from the pet context menu", async () => {
    const windowPort = createWindowPort();
    render(
      <ProductionApp
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{
          focus: () => <p>Focus from pet menu</p>,
          games: () => <p>Games from pet menu</p>,
        }}
      />,
    );

    const pet = await screen.findByRole("button", { name: "展开 Companion Desk" });
    vi.mocked(windowPort.setSize).mockClear();
    fireEvent.contextMenu(pet);
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 300, height: 350 }));
    fireEvent.click(screen.getByRole("menuitem", { name: "专注" }));
    expect(await screen.findByText("Focus from pet menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    fireEvent.contextMenu(await screen.findByRole("button", { name: "展开 Companion Desk" }));
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 300, height: 350 }));
    fireEvent.click(screen.getByRole("menuitem", { name: "玩一下" }));
    expect(await screen.findByText("Games from pet menu")).toBeInTheDocument();
  });

  it("requests quota only once under the app entry StrictMode", async () => {
    const loadQuota = quotaLoader();

    render(
      <StrictMode>
        <App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={loadQuota} />
      </StrictMode>,
    );

    expect(await screen.findByLabelText("5小时额度：62%")).toBeInTheDocument();
    expect(loadQuota).toHaveBeenCalledOnce();
  });

  it("keeps visited feature state mounted and never mounts an unvisited feature", async () => {
    let focusMounts = 0;
    let tokenMounts = 0;

    function StatefulFocus() {
      const [note, setNote] = useState("");
      useEffect(() => { focusMounts += 1; }, []);
      return <label>Stateful focus<input aria-label="Feature note" value={note} onChange={(event) => setNote(event.target.value)} /></label>;
    }
    function UnvisitedToken() {
      useEffect(() => { tokenMounts += 1; }, []);
      return <p>Unvisited token</p>;
    }

    render(
      <App
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ focus: StatefulFocus, token: UnvisitedToken }}
      />,
    );

    expect(screen.queryByLabelText("Feature note")).not.toBeInTheDocument();
    expect(tokenMounts).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    const input = await screen.findByLabelText("Feature note");
    fireEvent.change(input, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "返回主页" }));

    const retainedFeature = screen.getByText("Stateful focus").closest("[data-feature-view]");
    expect(retainedFeature).toHaveAttribute("hidden");
    expect(retainedFeature).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    expect(await screen.findByLabelText("Feature note")).toHaveValue("keep me");
    expect(focusMounts).toBe(1);
    expect(tokenMounts).toBe(0);
  });

  it("returns standalone games to Game Center without resetting their mounted state", async () => {
    function Stateful2048() {
      const [note, setNote] = useState("");
      return <label>2048 state<input aria-label="2048 note" value={note} onChange={(event) => setNote(event.target.value)} /></label>;
    }

    render(
      <App
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ game2048: Stateful2048 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "玩一下" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 2048" }));
    const input = await screen.findByLabelText("2048 note");
    fireEvent.change(input, { target: { value: "keep this game" } });

    fireEvent.click(screen.getByRole("button", { name: "返回游戏中心" }));
    expect(await screen.findByRole("heading", { name: "Game Center" })).toBeInTheDocument();
    expect(input.closest("[data-feature-view]"))?.toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "打开 2048" }));
    expect(await screen.findByLabelText("2048 note")).toHaveValue("keep this game");
  });

  it("keeps a running focus summary visible on home and in the collapsed ring", async () => {
    function SummaryFocus({ onSessionChange }: { onSessionChange?: (summary: FocusSummary) => void }) {
      return (
        <button
          type="button"
          onClick={() => onSessionChange?.({ status: "running", remainingMs: 24 * 60_000, durationMs: 25 * 60_000 })}
        >
          Publish focus summary
        </button>
      );
    }

    render(
      <App
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ focus: SummaryFocus }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publish focus summary" }));
    fireEvent.click(screen.getByRole("button", { name: "返回主页" }));

    expect(screen.getByRole("button", { name: "专注，剩余 24:00" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    expect(await screen.findByRole("button", { name: "展开 Companion Desk" })).toBeInTheDocument();
    const focusQuota = await screen.findByRole("group", { name: "专注剩余：24min" });
    expect(focusQuota).toHaveTextContent("24min");
    expect(screen.queryByRole("group", { name: /5小时额度/ })).not.toBeInTheDocument();
  });

  it("turns each remote poke into one collapsed reaction without expanding the Desk", async () => {
    const windowPort = createWindowPort();
    const friends = createFriendPort();
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        random={() => 0}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    vi.mocked(windowPort.setSize).mockClear();
    vi.mocked(windowPort.setAlwaysOnTop).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "poke-1", createdAt: 10 },
      }));
    });

    const petButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    const companion = petButton.closest(".collapsed-companion");
    expect(screen.getByRole("group", { name: "5小时额度：62%" })).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Momo 戳了你一下");
    expect(companion).toHaveAttribute("data-notification-state", "visible");
    expect(companion?.querySelector(".collapsed-companion__bubble")).toBeInTheDocument();
    expect(companion?.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "waving");
    expect(companion?.querySelectorAll(".pet-sprite")).toHaveLength(1);
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 300, height: 150 }));
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "poke-1", createdAt: 10 },
      }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("status")).toHaveTextContent("Momo 戳了你一下");
    expect(screen.queryByRole("region", { name: "Companion Desk 首页" })).not.toBeInTheDocument();
  });

  it("clears active and queued poke notifications when friends are disabled", async () => {
    const friends = createFriendPort();
    const timers: Array<{ callback: () => void }> = [];
    const scheduleNotification = vi.fn((callback: () => void) => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    });
    const cancelNotification = vi.fn();
    const windowPort = createWindowPort();
    const rendered = render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={cancelNotification}
        random={() => 0}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    act(() => friends.emit(friendSnapshot({
      incomingPoke: { senderUid: "momo", eventId: "active", createdAt: 1 },
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("Momo");
    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledOnce());
    act(() => friends.emit(friendSnapshot({
      incomingPoke: { senderUid: "momo", eventId: "queued", createdAt: 2 },
    })));

    rendered.rerender(
      <ProductionApp
        friendsEnabled={false}
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={cancelNotification}
        random={() => 0}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(cancelNotification).toHaveBeenCalledWith(timers[0]);
    expect(screen.getByRole("button", { name: "展开 Companion Desk" }).closest(".collapsed-companion"))
      .toHaveAttribute("data-notification-state", "hidden");
    expect(document.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "idle");

    act(() => timers[0].callback());
    expect(scheduleNotification).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the default remote-poke notification between four and five seconds", () => {
    expect(POKE_NOTIFICATION_DURATION_MS).toBeGreaterThanOrEqual(4_000);
    expect(POKE_NOTIFICATION_DURATION_MS).toBeLessThanOrEqual(5_000);
  });

  it("caps pending pokes at 20 and drops the oldest pending interaction first", () => {
    const pending = Array.from(
      { length: POKE_QUEUE_LIMIT + 2 },
      (_, index) => index + 1,
    ).reduce((queue, poke) => appendBoundedPoke(queue, poke), [] as number[]);

    expect(pending).toHaveLength(POKE_QUEUE_LIMIT);
    expect(pending).toEqual(Array.from({ length: POKE_QUEUE_LIMIT }, (_, index) => index + 3));
  });

  it("never replays an already processed poke later in the same app session", async () => {
    const windowPort = createWindowPort();
    const friendList = [
      { uid: "momo", displayName: "Momo", acceptedAt: 1 },
      { uid: "aki", displayName: "Aki", acceptedAt: 1 },
    ];
    const friends = createFriendPort(friendSnapshot({ friends: friendList }));
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const scheduleNotification = vi.fn((callback: () => void, delay: number) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    });

    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={vi.fn()}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "momo", eventId: "original", createdAt: 1 },
      }));
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Momo");
    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledOnce());

    for (let index = 0; index < 100; index += 1) {
      act(() => {
        friends.emit(friendSnapshot({
          friends: friendList,
          incomingPoke: { senderUid: "aki", eventId: `overflow-${index}`, createdAt: index + 2 },
        }));
      });
    }
    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "momo", eventId: "original", createdAt: 1 },
      }));
    });

    for (let timerIndex = 0; timerIndex < POKE_QUEUE_LIMIT; timerIndex += 1) {
      act(() => timers[timerIndex].callback());
      await waitFor(() => expect(scheduleNotification).toHaveBeenCalledTimes(timerIndex + 2));
      expect(screen.getByRole("status")).toHaveTextContent("Aki");
    }

    act(() => timers[POKE_QUEUE_LIMIT].callback());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("clears the remote reaction and restores idle bounds after its notification expires", async () => {
    const windowPort = createWindowPort();
    const friends = createFriendPort();
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        notificationDurationMs={10}
        random={() => 0.99}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "poke-expiry", createdAt: 11 },
      }));
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Momo 戳了你一下");
    expect(document.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "happy");

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 160, height: 150 }));
    expect(document.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "idle");
  });

  it("shows different remote pokes FIFO for a full timer each and shrinks only after the queue drains", async () => {
    const windowPort = createWindowPort();
    const friends = createFriendPort(friendSnapshot({
      friends: [
        { uid: "momo", displayName: "Momo", acceptedAt: 1 },
        { uid: "aki", displayName: "Aki", acceptedAt: 1 },
      ],
    }));
    const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
    const scheduleNotification = vi.fn((callback: () => void, delay: number) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    });
    const cancelNotification = vi.fn((timer: unknown) => {
      (timer as (typeof timers)[number]).cancelled = true;
    });
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={cancelNotification}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    vi.mocked(windowPort.setSize).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        friends: [
          { uid: "momo", displayName: "Momo", acceptedAt: 1 },
          { uid: "aki", displayName: "Aki", acceptedAt: 1 },
        ],
        incomingPoke: { senderUid: "momo", eventId: "fifo-1", createdAt: 20 },
      }));
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Momo 戳了你一下");
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 300, height: 150 }));
    expect(timers[0]?.delay).toBe(POKE_NOTIFICATION_DURATION_MS);
    vi.mocked(windowPort.setSize).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        friends: [
          { uid: "momo", displayName: "Momo", acceptedAt: 1 },
          { uid: "aki", displayName: "Aki", acceptedAt: 1 },
        ],
        incomingPoke: { senderUid: "aki", eventId: "fifo-2", createdAt: 21 },
      }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Momo 戳了你一下");
    expect(timers).toHaveLength(1);

    act(() => timers[0].callback());
    expect(await screen.findByRole("status")).toHaveTextContent("Aki 戳了你一下");
    await waitFor(() => expect(timers).toHaveLength(2));
    expect(timers[1].delay).toBe(POKE_NOTIFICATION_DURATION_MS);
    expect(windowPort.setSize).not.toHaveBeenCalledWith({ width: 160, height: 150 });

    act(() => timers[1].callback());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 160, height: 150 }));
  });

  it("supports a synchronous scheduler across consecutive pokes without retaining stale handles", async () => {
    let resolveFirstNotificationLayout!: () => void;
    const firstNotificationLayout = new Promise<void>((resolve) => {
      resolveFirstNotificationLayout = resolve;
    });
    let notificationLayouts = 0;
    const windowPort = createWindowPort({
      setSize: vi.fn((size: WindowSize) => {
        if (size.width === 300 && size.height === 150 && notificationLayouts++ === 0) {
          return firstNotificationLayout;
        }
        return Promise.resolve();
      }),
    });
    const friendList = [
      { uid: "momo", displayName: "Momo", acceptedAt: 1 },
      { uid: "aki", displayName: "Aki", acceptedAt: 1 },
    ];
    const friends = createFriendPort(friendSnapshot({ friends: friendList }));
    const handles: object[] = [];
    const scheduleNotification = vi.fn((callback: () => void) => {
      const handle = {};
      handles.push(handle);
      callback();
      return handle;
    });
    const cancelNotification = vi.fn();
    const rendered = render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={cancelNotification}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "momo", eventId: "sync-1", createdAt: 20 },
      }));
    });
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 300, height: 150 }));
    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "aki", eventId: "sync-2", createdAt: 21 },
      }));
    });

    await act(async () => {
      resolveFirstNotificationLayout();
      await Promise.resolve();
    });

    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    rendered.unmount();
    expect(cancelNotification).not.toHaveBeenCalled();
    expect(handles).toHaveLength(2);
  });

  it("ignores older and same-timestamp replacements when a sender slot moves backwards", async () => {
    const windowPort = createWindowPort();
    const friends = createFriendPort();
    const timers: Array<() => void> = [];
    const scheduleNotification = vi.fn((callback: () => void) => {
      timers.push(callback);
      return callback;
    });
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={vi.fn()}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "newer", createdAt: 100 },
      }));
    });
    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledOnce());
    act(() => timers[0]());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "older", createdAt: 99 },
      }));
    });
    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "same-time-replacement", createdAt: 100 },
      }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scheduleNotification).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts each poke timer only after its notification layout is ready", async () => {
    const notificationLayoutResolves: Array<() => void> = [];
    const setSize = vi.fn((size: WindowSize) => {
      if (size.width !== 300 || size.height !== 150) return Promise.resolve();
      return new Promise<void>((resolve) => {
        notificationLayoutResolves.push(resolve);
      });
    });
    const windowPort = createWindowPort({ setSize });
    const friendList = [
      { uid: "momo", displayName: "Momo", acceptedAt: 1 },
      { uid: "aki", displayName: "Aki", acceptedAt: 1 },
    ];
    const friends = createFriendPort(friendSnapshot({ friends: friendList }));
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const scheduleNotification = vi.fn((callback: () => void, delay: number) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    });

    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={scheduleNotification}
        cancelNotification={vi.fn()}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "momo", eventId: "deferred-1", createdAt: 20 },
      }));
    });
    await waitFor(() => expect(notificationLayoutResolves).toHaveLength(1));
    expect(scheduleNotification).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "aki", eventId: "deferred-2", createdAt: 21 },
      }));
    });
    expect(scheduleNotification).not.toHaveBeenCalled();

    await act(async () => {
      notificationLayoutResolves[0]();
      await Promise.resolve();
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Momo");
    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledOnce());
    expect(timers[0]?.delay).toBe(POKE_NOTIFICATION_DURATION_MS);

    act(() => timers[0].callback());
    await waitFor(() => expect(notificationLayoutResolves).toHaveLength(2));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(scheduleNotification).toHaveBeenCalledOnce();

    await act(async () => {
      notificationLayoutResolves[1]();
      await Promise.resolve();
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Aki");
    await waitFor(() => expect(scheduleNotification).toHaveBeenCalledTimes(2));
    expect(timers[1]?.delay).toBe(POKE_NOTIFICATION_DURATION_MS);

    act(() => timers[1].callback());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 160, height: 150 }));
  });

  it("passes the real friend view model to Home and sends its only interaction through FriendPort", async () => {
    const friends = createFriendPort();
    render(
      <App
        friendsEnabled
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Momo" }));
    fireEvent.click(screen.getByRole("button", { name: "戳一下Momo" }));
    await waitFor(() => expect(friends.port.poke).toHaveBeenCalledWith("momo"));
  });

  it("keeps local focus navigation usable when the friend service is unavailable", async () => {
    const friends = createFriendPort();
    render(
      <App
        friendsEnabled
        friendPort={friends.port}
        windowPort={createWindowPort()}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ focus: () => <p>Local focus remains available</p> }}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    act(() => friends.fail(new Error("offline")));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "好友" })).not.toBeInTheDocument());
    expect(screen.queryByText("好友功能暂不可用")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    expect(await screen.findByText("Local focus remains available")).toBeInTheDocument();
  });

  it("skips a poke whose notification layout fails, advances the queue, and finally restores idle bounds", async () => {
    let rejectNotificationResize!: (reason?: unknown) => void;
    let notificationAttempts = 0;
    const notificationResize = new Promise<void>((_resolve, reject) => {
      rejectNotificationResize = reject;
    });
    const setSize = vi.fn((size: WindowSize) => {
      if (size.width === 300 && size.height === 150 && notificationAttempts++ === 0) {
        return notificationResize;
      }
      return Promise.resolve();
    });
    const windowPort = createWindowPort({ setSize });
    const friendList = [
      { uid: "momo", displayName: "Momo", acceptedAt: 1 },
      { uid: "aki", displayName: "Aki", acceptedAt: 1 },
    ];
    const friends = createFriendPort(friendSnapshot({ friends: friendList }));
    const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={(callback) => {
          const timer = { callback, cancelled: false };
          timers.push(timer);
          return timer;
        }}
        cancelNotification={(timer) => {
          (timer as (typeof timers)[number]).cancelled = true;
        }}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        logger={{ warn: vi.fn() }}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());
    vi.mocked(windowPort.setSize).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "momo", eventId: "poke-layout-failure", createdAt: 11 },
      }));
    });

    const petButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    const companion = petButton.closest(".collapsed-companion");
    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 300, height: 150 }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(companion).toHaveAttribute("data-notification-state", "hidden");

    act(() => {
      friends.emit(friendSnapshot({
        friends: friendList,
        incomingPoke: { senderUid: "aki", eventId: "poke-after-failure", createdAt: 12 },
      }));
    });

    await act(async () => {
      rejectNotificationResize(new Error("notification resize unavailable"));
      await Promise.resolve();
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Aki 戳了你一下");
    await waitFor(() => {
      expect(vi.mocked(windowPort.setSize).mock.calls.filter(([size]) => size.width === 300)).toHaveLength(2);
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ cancelled: false });

    act(() => timers[0].callback());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 160, height: 150 }));
  });

  it("closes an open companion menu when a poke arrives so it cannot cover the bubble", async () => {
    const windowPort = createWindowPort();
    const friends = createFriendPort();
    render(
      <ProductionApp
        friendsEnabled
        friendPort={friends.port}
        scheduleNotification={() => ({})}
        cancelNotification={vi.fn()}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );
    await waitFor(() => expect(friends.port.start).toHaveBeenCalledOnce());

    const pet = await screen.findByRole("button", { name: /Companion Desk/ });
    fireEvent.contextMenu(pet);
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "menu-poke", createdAt: 30 },
      }));
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Momo");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("restores idle bounds when opening the companion menu cannot resize the window", async () => {
    let expandedAttempts = 0;
    const setSize = vi.fn((size: WindowSize) => {
      if (size.width === 300 && size.height === 350 && expandedAttempts++ === 0) {
        return Promise.reject(new Error("menu resize unavailable"));
      }
      return Promise.resolve();
    });
    const windowPort = createWindowPort({ setSize });
    render(
      <ProductionApp
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        logger={{ warn: vi.fn() }}
      />,
    );

    fireEvent.contextMenu(await screen.findByRole("button", { name: /Companion Desk/ }));
    await waitFor(() => expect(setSize).toHaveBeenCalledWith({ width: 300, height: 350 }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(setSize).toHaveBeenCalledWith({ width: 160, height: 150 }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the collapsed companion surface as a drag region without replacing the pet button", async () => {
    render(<App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    const petButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    const companion = petButton.closest(".collapsed-companion");

    expect(companion).toHaveAttribute("data-tauri-drag-region");
    expect(petButton).toHaveAttribute("type", "button");
  });

  it("renders one approved idle sprite, ring, and quota group", async () => {
    const { container } = render(
      <App windowPort={createWindowPort()} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    const petButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    const companion = petButton.closest(".collapsed-companion");
    expect(petButton.querySelectorAll(".pet-sprite")).toHaveLength(1);
    expect(petButton.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "idle");
    expect(petButton.querySelector("img")).not.toBeInTheDocument();
    expect(companion?.querySelectorAll(".collapsed-companion__ring")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "5小时额度：62%" })).toBeInTheDocument();
    expect(container.querySelector(".collapsed-quota")).not.toBeInTheDocument();
  });

  it("uses idle bounds and topmost only while collapsed", async () => {
    const windowPort = createWindowPort();
    render(<App windowPort={windowPort} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
    vi.mocked(windowPort.setSize).mockClear();
    vi.mocked(windowPort.setAlwaysOnTop).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    const petButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 160, height: 150 }));
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));

    vi.mocked(windowPort.setAlwaysOnTop).mockClear();
    fireEvent.click(petButton);

    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
  });

  it("ignores saved collapsed bounds for idle and notification layouts", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("windowLayoutsV3", { collapsed: { width: 600, height: 600 } });
    const windowPort = createWindowPort();
    const friends = createFriendPort();
    render(<App friendsEnabled friendPort={friends.port} windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
    vi.mocked(windowPort.setSize).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    const idlePetButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));
    const idleSize = vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0];

    fireEvent.click(idlePetButton);
    await screen.findByRole("region", { name: "Companion Desk 首页" });
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
    vi.mocked(windowPort.setSize).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "poke-saved-layout", createdAt: 12 },
      }));
    });
    await screen.findByRole("status");
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));
    const notificationSize = vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0];

    expect(idleSize).toEqual({ width: 160, height: 150 });
    expect(notificationSize).toEqual({ width: 300, height: 150 });
  });

  it("keeps collapsed layouts fixed when the work area is smaller", async () => {
    const windowPort = createWindowPort({
      currentWorkArea: vi.fn(async () => ({ width: 300, height: 300 })),
    });
    const friends = createFriendPort();
    render(
      <App
        friendsEnabled
        friendPort={friends.port}
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
      />,
    );

    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
    vi.mocked(windowPort.setSize).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    const idlePetButton = await screen.findByRole("button", { name: "展开 Companion Desk" });
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));
    const idleSize = vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0];

    fireEvent.click(idlePetButton);
    await screen.findByRole("region", { name: "Companion Desk 首页" });
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(false));
    vi.mocked(windowPort.setSize).mockClear();

    act(() => {
      friends.emit(friendSnapshot({
        incomingPoke: { senderUid: "momo", eventId: "poke-small-area", createdAt: 13 },
      }));
    });
    await screen.findByRole("status");
    await waitFor(() => expect(vi.mocked(windowPort.setAlwaysOnTop).mock.calls.at(-1)?.[0]).toBe(true));
    const notificationSize = vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0];

    expect(idleSize).toEqual({ width: 160, height: 150 });
    expect(notificationSize).toEqual({ width: 300, height: 150 });
  });

  it("ignores polluted V2 sizes and uses the compact home default", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("windowLayoutsV2", { home: { width: 2_560, height: 1_392 } });
    const windowPort = createWindowPort();

    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 310 }));
  });

  it("restores a normalized V3 size for the current work area", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("windowLayoutsV3", { home: { width: 444, height: 555 } });
    const windowPort = createWindowPort();

    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 444, height: 555 }));
  });

  it("ignores legacy saved home height so the compact default takes effect", async () => {
    const storageAdapter = createMemoryAdapter();
    await storageAdapter.set("windowLayouts", { home: { width: 380, height: 540 } });
    const windowPort = createWindowPort();

    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 380, height: 310 }));
  });

  it("uses 92 percent of a small work area and never sets a minimum above the resolved size", async () => {
    const windowPort = createWindowPort({
      currentWorkArea: vi.fn(async () => ({ width: 300, height: 400 })),
    });

    render(<App windowPort={windowPort} storageAdapter={createMemoryAdapter()} loadQuota={quotaLoader()} />);

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalledWith({ width: 276, height: 310 }));
    expect(windowPort.setMinSize).toHaveBeenCalledWith({ width: 276, height: 300 });
  });

  it("persists manual expanded sizes but never writes a collapsed size", async () => {
    const storageAdapter = createMemoryAdapter();
    const windowPort = createWindowPort();
    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    await act(async () => { await windowPort.emitResize({ width: 412, height: 532 }); });
    await waitFor(() => expect(storageAdapter.entries()).toContainEqual([
      "windowLayoutsV3",
      expect.objectContaining({ home: { width: 412, height: 532 } }),
    ]));

    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));
    await screen.findByRole("button", { name: "展开 Companion Desk" });
    await act(async () => { await windowPort.emitResize({ width: 220, height: 250 }); });
    const layouts = storageAdapter.entries().find(([key]) => key === "windowLayoutsV3")?.[1] as Record<string, unknown>;
    expect(layouts).toHaveProperty("home", { width: 412, height: 532 });
    expect(layouts).not.toHaveProperty("collapsed");
  });

  it("does not persist a resize while the desktop window is maximized", async () => {
    const storageAdapter = createMemoryAdapter();
    const windowPort = createWindowPort({
      isMaximized: vi.fn(async () => true),
    });
    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    await act(async () => { await windowPort.emitResize({ width: 1_920, height: 1_080 }); });

    expect(windowPort.isMaximized).toHaveBeenCalledOnce();
    expect(storageAdapter.entries().some(([key]) => key === "windowLayoutsV3")).toBe(false);
  });

  it("warns and skips resize persistence when maximized state cannot be read", async () => {
    const storageAdapter = createMemoryAdapter();
    const logger = { warn: vi.fn() };
    const windowPort = createWindowPort({
      isMaximized: vi.fn(async () => { throw new Error("window unavailable"); }),
    });
    render(
      <App
        windowPort={windowPort}
        storageAdapter={storageAdapter}
        loadQuota={quotaLoader()}
        logger={logger}
      />,
    );
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    await act(async () => { await windowPort.emitResize({ width: 1_920, height: 1_080 }); });

    expect(logger.warn).toHaveBeenCalledWith("[App] failed to read maximized state", expect.any(Error));
    expect(storageAdapter.entries().some(([key]) => key === "windowLayoutsV3")).toBe(false);
  });

  it.each([
    ["Close", "关闭面板，返回宠物", "collapsed"],
    ["Back", "返回主页", "home"],
  ] as const)("discards an in-flight resize from the old view after %s", async (_action, actionLabel, destination) => {
    const maximized = deferred<boolean>();
    const storageAdapter = createMemoryAdapter();
    const windowPort = createWindowPort({
      isMaximized: vi.fn(() => maximized.promise),
    });
    render(
      <ProductionApp
        initialView="token"
        windowPort={windowPort}
        storageAdapter={storageAdapter}
        loadQuota={quotaLoader()}
        features={{ token: () => <p>Token stale resize</p> }}
      />,
    );
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    const resize = windowPort.emitResize({ width: 1_111, height: 777 });
    await waitFor(() => expect(windowPort.isMaximized).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: actionLabel }));
    if (destination === "collapsed") {
      await screen.findByRole("button", { name: "展开 Companion Desk" });
    } else {
      await screen.findByRole("region", { name: "Companion Desk 首页" });
    }

    maximized.resolve(false);
    await resize;

    expect(storageAdapter.entries().some(([key]) => key === "windowLayoutsV3")).toBe(false);
  });

  it("keeps the newest resize when maximized-state queries resolve out of order", async () => {
    const firstMaximized = deferred<boolean>();
    const secondMaximized = deferred<boolean>();
    const storageAdapter = createMemoryAdapter();
    const windowPort = createWindowPort({
      isMaximized: vi.fn()
        .mockImplementationOnce(() => firstMaximized.promise)
        .mockImplementationOnce(() => secondMaximized.promise),
    });
    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    const firstResize = windowPort.emitResize({ width: 411, height: 531 });
    await waitFor(() => expect(windowPort.isMaximized).toHaveBeenCalledOnce());
    const secondResize = windowPort.emitResize({ width: 422, height: 542 });
    await waitFor(() => expect(windowPort.isMaximized).toHaveBeenCalledTimes(2));

    secondMaximized.resolve(false);
    await secondResize;
    await expect(storageAdapter.get("windowLayoutsV3")).resolves.toMatchObject({
      home: { width: 422, height: 542 },
    });

    firstMaximized.resolve(false);
    await firstResize;
    await expect(storageAdapter.get("windowLayoutsV3")).resolves.toMatchObject({
      home: { width: 422, height: 542 },
    });
  });

  it("keeps an in-flight valid resize when a later invalid resize is ignored", async () => {
    const maximized = deferred<boolean>();
    const storageAdapter = createMemoryAdapter();
    const windowPort = createWindowPort({
      isMaximized: vi.fn(() => maximized.promise),
    });
    render(<App windowPort={windowPort} storageAdapter={storageAdapter} loadQuota={quotaLoader()} />);
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    const validResize = windowPort.emitResize({ width: 433, height: 553 });
    await waitFor(() => expect(windowPort.isMaximized).toHaveBeenCalledOnce());
    await windowPort.emitResize({ width: 0, height: 0 });
    expect(windowPort.isMaximized).toHaveBeenCalledOnce();

    maximized.resolve(false);
    await validResize;

    await expect(storageAdapter.get("windowLayoutsV3")).resolves.toMatchObject({
      home: { width: 433, height: 553 },
    });
  });

  it("contains resize persistence failures without breaking navigation", async () => {
    const storageAdapter = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => { throw new Error("store unavailable"); }),
    };
    const logger = { warn: vi.fn() };
    const windowPort = createWindowPort();
    render(
      <App
        windowPort={windowPort}
        storageAdapter={storageAdapter}
        loadQuota={quotaLoader()}
        logger={logger}
        features={{ focus: () => <p>Focus after store failure</p> }}
      />,
    );
    await waitFor(() => expect(windowPort.onResized).toHaveBeenCalledOnce());

    await expect(windowPort.emitResize({ width: 412, height: 532 })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith("[App] failed to save window layouts", expect.any(Error));
    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    expect(await screen.findByText("Focus after store failure")).toBeInTheDocument();
  });

  it("lets the newest view win when an older layout lookup finishes late", async () => {
    let resolveFirstWorkArea: ((size: WindowSize) => void) | undefined;
    const firstWorkArea = new Promise<WindowSize>((resolve) => { resolveFirstWorkArea = resolve; });
    const currentWorkArea = vi.fn()
      .mockImplementationOnce(() => firstWorkArea)
      .mockResolvedValue({ width: 1_200, height: 900 });
    const windowPort = createWindowPort({ currentWorkArea });

    render(
      <App
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ focus: () => <p>Latest focus</p> }}
      />,
    );
    await waitFor(() => expect(currentWorkArea).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    expect(await screen.findByText("Latest focus")).toBeInTheDocument();
    resolveFirstWorkArea?.({ width: 1_200, height: 900 });

    await waitFor(() => expect(windowPort.setSize).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(windowPort.setSize).mock.calls.at(-1)?.[0]).toEqual({ width: 420, height: 560 }));
  });

  it("keeps navigation usable when the desktop window API fails", async () => {
    const windowPort = createWindowPort({ unmaximize: vi.fn(async () => { throw new Error("window unavailable"); }) });
    render(
      <App
        windowPort={windowPort}
        storageAdapter={createMemoryAdapter()}
        loadQuota={quotaLoader()}
        features={{ focus: () => <p>Focus despite failure</p> }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    expect(await screen.findByText("Focus despite failure")).toBeInTheDocument();
  });
});
