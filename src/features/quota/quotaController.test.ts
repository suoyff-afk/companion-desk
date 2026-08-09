import { describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../../types";
import { createQuotaController, type QuotaState } from "./quotaController";

function okSnapshot(remainingPercent: number): ProviderSnapshot {
  return {
    provider: "codex",
    displayName: "CODEX",
    plan: "PRO",
    shortWindow: { remainingPercent, resetsAt: "2026-07-29T12:00:00Z", windowSeconds: 18_000 },
    weeklyWindow: { remainingPercent: 42, resetsAt: "2026-08-01T00:00:00Z", windowSeconds: 604_800 },
    resetCredits: 1,
    updatedAt: "2026-07-29T10:00:00Z",
    status: "ok",
    message: null,
  };
}

function signedOutSnapshot(): ProviderSnapshot {
  return {
    ...okSnapshot(0),
    shortWindow: null,
    weeklyWindow: null,
    resetCredits: null,
    status: "signed_out",
    message: "Please sign in",
  };
}

function unavailableSnapshot(message = "Network unavailable"): ProviderSnapshot {
  return {
    ...okSnapshot(0),
    shortWindow: null,
    weeklyWindow: null,
    resetCredits: null,
    status: "unavailable",
    message,
  };
}

function claudeSnapshot(): ProviderSnapshot {
  return { ...okSnapshot(73), provider: "claude", displayName: "CLAUDE" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("quota controller", () => {
  it("coalesces concurrent refresh reasons", async () => {
    const pending = deferred<ProviderSnapshot[]>();
    const load = vi.fn(() => pending.promise);
    const controller = createQuotaController({ load });
    const startup = controller.refresh("startup");
    const manual = controller.refresh("manual");

    expect(manual).toBe(startup);
    expect(load).toHaveBeenCalledTimes(1);

    pending.resolve([okSnapshot(73)]);
    await startup;

    expect(controller.getState().snapshot?.shortWindow?.remainingPercent).toBe(73);
  });

  it("coalesces a refresh re-entered by a loading subscriber", async () => {
    const pending = deferred<ProviderSnapshot[]>();
    const load = vi.fn(() => pending.promise);
    const controller = createQuotaController({ load });
    let reentered = false;
    let subscriberRefresh: Promise<Readonly<QuotaState>> | null = null;
    controller.subscribe((state) => {
      if (state.loading && !reentered) {
        reentered = true;
        subscriberRefresh = controller.refresh("manual");
      }
    });

    const startup = controller.refresh("startup");

    expect(subscriberRefresh).toBe(startup);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve([okSnapshot(73)]);
    await startup;
  });

  it("isolates loading listener errors without interrupting refresh", async () => {
    const pending = deferred<ProviderSnapshot[]>();
    const load = vi.fn(() => pending.promise);
    const controller = createQuotaController({ load });
    const healthyListener = vi.fn();
    controller.subscribe((state) => {
      if (state.loading) throw new Error("loading observer failed");
    });
    controller.subscribe(healthyListener);
    let refresh: Promise<Readonly<QuotaState>> | null = null;

    expect(() => {
      refresh = controller.refresh("startup");
    }).not.toThrow();
    expect(healthyListener).toHaveBeenCalledWith(expect.objectContaining({ loading: true }));

    pending.resolve([okSnapshot(73)]);
    await refresh!;
    expect(controller.getState().snapshot?.shortWindow?.remainingPercent).toBe(73);
  });

  it("isolates terminal listener errors so a later refresh can run", async () => {
    const terminalReached = deferred<void>();
    const load = vi.fn()
      .mockResolvedValueOnce([okSnapshot(73)])
      .mockResolvedValueOnce([okSnapshot(88)]);
    const controller = createQuotaController({ load });
    controller.subscribe((state) => {
      if (state.snapshot?.shortWindow?.remainingPercent === 73) terminalReached.resolve();
    });
    controller.subscribe((state) => {
      if (state.snapshot?.shortWindow?.remainingPercent === 73) throw new Error("terminal observer failed");
    });

    controller.refresh("startup");
    await terminalReached.promise;
    await controller.refresh("manual");

    expect(load).toHaveBeenCalledTimes(2);
    expect(controller.getState().snapshot?.shortWindow?.remainingPercent).toBe(88);
  });

  it("starts a new refresh from a terminal listener without changing the prior result", async () => {
    const firstPending = deferred<ProviderSnapshot[]>();
    const secondPending = deferred<ProviderSnapshot[]>();
    const load = vi.fn()
      .mockImplementationOnce(() => firstPending.promise)
      .mockImplementationOnce(() => secondPending.promise);
    const controller = createQuotaController({ load });
    let terminalRefresh: Promise<Readonly<QuotaState>> | null = null;
    controller.subscribe((state) => {
      if (state.snapshot?.shortWindow?.remainingPercent === 73 && !terminalRefresh) {
        terminalRefresh = controller.refresh("manual");
      }
    });

    const startup = controller.refresh("startup");
    firstPending.resolve([okSnapshot(73)]);
    const initialState = await startup;

    expect(initialState.snapshot?.shortWindow?.remainingPercent).toBe(73);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(true);

    secondPending.resolve([okSnapshot(88)]);
    await terminalRefresh!;
    expect(controller.getState().snapshot?.shortWindow?.remainingPercent).toBe(88);
  });

  it("notifies terminal listeners before a nested refresh state", async () => {
    const firstPending = deferred<ProviderSnapshot[]>();
    const secondPending = deferred<ProviderSnapshot[]>();
    const load = vi.fn()
      .mockImplementationOnce(() => firstPending.promise)
      .mockImplementationOnce(() => secondPending.promise);
    const controller = createQuotaController({ load });
    let terminalRefresh: Promise<Readonly<QuotaState>> | null = null;
    const observed: Array<{ remainingPercent: number; refreshing: boolean }> = [];
    controller.subscribe((state) => {
      if (state.snapshot?.shortWindow?.remainingPercent === 73 && !terminalRefresh) {
        terminalRefresh = controller.refresh("manual");
      }
    });
    controller.subscribe((state) => {
      const remainingPercent = state.snapshot?.shortWindow?.remainingPercent;
      if (remainingPercent !== undefined) observed.push({ remainingPercent, refreshing: state.refreshing });
    });

    const startup = controller.refresh("startup");
    firstPending.resolve([okSnapshot(73)]);
    await startup;

    expect(observed).toEqual([
      { remainingPercent: 73, refreshing: false },
      { remainingPercent: 73, refreshing: true },
    ]);

    secondPending.resolve([okSnapshot(88)]);
    await terminalRefresh!;
  });

  it("retains the last successful value as stale after failure", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([okSnapshot(73)])
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createQuotaController({ load });

    await controller.refresh("startup");
    await controller.refresh("manual");

    expect(controller.getState().snapshot).toMatchObject({
      status: "stale",
      message: "offline",
      shortWindow: { remainingPercent: 73 },
    });
    expect(controller.getState().updatedAt).toBe("2026-07-29T10:00:00Z");
  });

  it("starts once, schedules a 15-minute interval, and refreshes it forcefully", async () => {
    const callback = vi.fn();
    const handle = {};
    const setInterval = vi.fn((next: () => void, delay: number) => {
      callback.mockImplementation(next);
      return handle;
    });
    const clearInterval = vi.fn();
    const load = vi.fn().mockResolvedValue([okSnapshot(73)]);
    const controller = createQuotaController({ load, scheduler: { setInterval, clearInterval } });

    controller.start();
    controller.start();

    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 900_000);
    expect(load).toHaveBeenCalledWith(false);

    await vi.waitFor(() => expect(controller.getState().loading).toBe(false));
    callback();
    expect(load).toHaveBeenLastCalledWith(true);
  });

  it("stops an active interval once", () => {
    const handle = {};
    const setInterval = vi.fn(() => handle);
    const clearInterval = vi.fn();
    const controller = createQuotaController({
      load: vi.fn().mockResolvedValue([okSnapshot(73)]),
      scheduler: { setInterval, clearInterval },
    });

    controller.start();
    controller.stop();
    controller.stop();

    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(clearInterval).toHaveBeenCalledWith(handle);
  });

  it("keeps the first-load error honest without inventing a quota value", async () => {
    const controller = createQuotaController({ load: vi.fn().mockRejectedValue(new Error("offline")) });

    await controller.refresh("startup");

    expect(controller.getState()).toEqual({
      snapshot: null,
      lastSuccessful: null,
      loading: false,
      refreshing: false,
      updatedAt: null,
    });
  });

  it("keeps prior quota as stale when a successful load returns no Codex snapshot", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([okSnapshot(73)])
      .mockResolvedValueOnce([]);
    const controller = createQuotaController({ load });

    await controller.refresh("startup");
    await controller.refresh("manual");

    expect(controller.getState().snapshot).toMatchObject({
      status: "stale",
      message: "Codex quota unavailable",
      shortWindow: { remainingPercent: 73 },
    });
  });

  it("keeps the first load empty when results contain no Codex snapshot", async () => {
    const controller = createQuotaController({ load: vi.fn().mockResolvedValue([claudeSnapshot()]) });

    await controller.refresh("startup");

    expect(controller.getState()).toEqual({
      snapshot: null,
      lastSuccessful: null,
      loading: false,
      refreshing: false,
      updatedAt: null,
    });
  });

  it("converts a synchronous load throw into a recoverable refresh failure", async () => {
    const load = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync offline"); })
      .mockResolvedValueOnce([okSnapshot(73)]);
    const controller = createQuotaController({ load });
    let firstRefresh!: Promise<Readonly<QuotaState>>;

    expect(() => {
      firstRefresh = controller.refresh("startup");
    }).not.toThrow();
    await firstRefresh;
    expect(controller.getState()).toMatchObject({ snapshot: null, loading: false, refreshing: false });

    await controller.refresh("manual");
    expect(controller.getState().snapshot?.shortWindow?.remainingPercent).toBe(73);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("clears retention on sign-out so a later failure cannot resurrect quota", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([okSnapshot(73)])
      .mockResolvedValueOnce([signedOutSnapshot()])
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createQuotaController({ load });

    await controller.refresh("startup");
    await controller.refresh("manual");
    expect(controller.getState()).toMatchObject({
      snapshot: { status: "signed_out" },
      lastSuccessful: null,
    });

    await controller.refresh("interval");
    expect(controller.getState()).toMatchObject({ snapshot: null, lastSuccessful: null });
  });

  it("replaces stale state and updates the refresh timestamp after recovery", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([{ ...okSnapshot(73), updatedAt: "2026-07-29T10:00:00.000Z" }])
      .mockResolvedValueOnce([unavailableSnapshot("offline")])
      .mockResolvedValueOnce([{ ...okSnapshot(88), updatedAt: "2026-07-29T10:15:00.000Z" }]);
    const controller = createQuotaController({ load });

    await controller.refresh("startup");
    await controller.refresh("manual");
    expect(controller.getState().snapshot?.status).toBe("stale");

    await controller.refresh("manual");
    expect(controller.getState()).toMatchObject({
      snapshot: { status: "ok", shortWindow: { remainingPercent: 88 } },
      updatedAt: "2026-07-29T10:15:00.000Z",
    });
  });

  it("uses a cached load only at startup and forces every user or lifecycle refresh", async () => {
    const load = vi.fn().mockResolvedValue([okSnapshot(73)]);
    const controller = createQuotaController({ load });

    await controller.refresh("startup");
    await controller.refresh("manual");
    await controller.refresh("interval");
    await controller.refresh("tray");
    await controller.refresh("resume");

    expect(load.mock.calls.map(([force]) => force)).toEqual([false, true, true, true, true]);
  });

  it("notifies subscribers of changes and stops after unsubscribe", async () => {
    const load = vi.fn().mockResolvedValue([okSnapshot(73)]);
    const controller = createQuotaController({ load });
    const states: Array<Readonly<QuotaState>> = [];
    const unsubscribe = controller.subscribe((state) => states.push(state));

    await controller.refresh("startup");
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ loading: true });
    expect(states[1]).toMatchObject({ snapshot: { status: "ok" }, loading: false });

    unsubscribe();
    await controller.refresh("manual");
    expect(states).toHaveLength(2);
  });
});
