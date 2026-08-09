// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FriendPort, FriendPortHandlers } from "./FriendPort";
import type { FriendSnapshot } from "./types";
import { useFriends } from "./useFriends";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const readySnapshot: FriendSnapshot = {
  connectionState: "ready",
  self: { uid: "me", displayName: "Kunkun-me", createdAt: 1 },
  ownFriendCode: "48271936",
  friends: [],
  pendingRequests: [],
  cooldownsByFriendUid: {},
  incomingPoke: null,
};

function createPort() {
  let handlers: FriendPortHandlers | null = null;
  const registeredHandlers: FriendPortHandlers[] = [];
  const stop = vi.fn();
  const port: FriendPort = {
    start: vi.fn(async (nextHandlers) => {
      handlers = nextHandlers;
      registeredHandlers.push(nextHandlers);
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
    emit(snapshot: FriendSnapshot) { handlers?.onSnapshot(snapshot); },
    emitRegistered(index: number, snapshot: FriendSnapshot) { registeredHandlers[index]?.onSnapshot(snapshot); },
    fail(error: Error) { handlers?.onError?.(error); },
  };
}

describe("useFriends", () => {
  it("starts one listener across rerenders, applies snapshots, and cleans up", async () => {
    const { port, stop, emit } = createPort();
    const { result, rerender, unmount } = renderHook(() => useFriends(port));

    await act(async () => undefined);
    rerender();
    expect(port.start).toHaveBeenCalledOnce();

    act(() => emit(readySnapshot));
    expect(result.current.snapshot).toEqual(readySnapshot);

    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("contains startup and listener failures as an unavailable friend area", async () => {
    const first = createPort();
    first.port.start = vi.fn(async () => { throw new Error("missing config"); });
    const startup = renderHook(() => useFriends(first.port));

    await act(async () => undefined);
    expect(startup.result.current.snapshot.connectionState).toBe("unavailable");
    expect(startup.result.current.error).toBe("missing config");

    const second = createPort();
    const listener = renderHook(() => useFriends(second.port));
    await act(async () => undefined);
    act(() => second.fail(new Error("offline")));
    expect(listener.result.current.snapshot.connectionState).toBe("unavailable");
    expect(listener.result.current.error).toBe("offline");
  });

  it("rejects invalid friend codes without calling the port", async () => {
    const { port } = createPort();
    const { result } = renderHook(() => useFriends(port));
    await act(async () => undefined);

    await act(async () => {
      expect(await result.current.requestByCode("123")).toBe(false);
    });

    expect(port.requestByCode).not.toHaveBeenCalled();
    expect(result.current.error).toBe("请输入 8 位好友 ID");
  });

  it("serializes actions and exposes the busy action", async () => {
    const first = deferred<void>();
    const { port } = createPort();
    port.poke = vi.fn(() => first.promise);
    const { result } = renderHook(() => useFriends(port));
    await act(async () => undefined);

    let pokePromise!: Promise<boolean>;
    let removePromise!: Promise<boolean>;
    act(() => {
      pokePromise = result.current.poke("friend");
      removePromise = result.current.removeFriend("friend");
    });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.busy).toBe("poke");
    expect(port.poke).toHaveBeenCalledOnce();
    expect(port.removeFriend).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve();
      expect(await pokePromise).toBe(true);
      expect(await removePromise).toBe(true);
    });

    expect(port.removeFriend).toHaveBeenCalledOnce();
    expect(result.current.busy).toBeNull();
  });

  it("restarts the listener after identity reset and accepts only the new snapshot", async () => {
    const setup = createPort();
    const { result } = renderHook(() => useFriends(setup.port));
    await act(async () => undefined);
    act(() => setup.emit(readySnapshot));

    await act(async () => {
      expect(await result.current.resetIdentity()).toBe(true);
    });

    expect(setup.port.start).toHaveBeenCalledTimes(2);
    const freshSnapshot: FriendSnapshot = {
      ...readySnapshot,
      self: { uid: "fresh", displayName: "Kunkun-fresh", createdAt: 2 },
      ownFriendCode: "87654321",
    };
    act(() => {
      setup.emitRegistered(0, { ...readySnapshot, ownFriendCode: "11111111" });
      setup.emitRegistered(1, freshSnapshot);
    });
    expect(result.current.snapshot).toEqual(freshSnapshot);
  });

  it("reports reset and restart failures without pretending the action succeeded", async () => {
    const resetFailure = createPort();
    resetFailure.port.resetIdentity = vi.fn(async () => { throw new Error("reset denied"); });
    const first = renderHook(() => useFriends(resetFailure.port));
    await act(async () => undefined);
    await act(async () => {
      expect(await first.result.current.resetIdentity()).toBe(false);
    });
    expect(first.result.current.actionErrors.resetIdentity).toBe("reset denied");
    expect(resetFailure.port.start).toHaveBeenCalledTimes(2);
    const recovered = { ...readySnapshot, ownFriendCode: "13572468" };
    act(() => resetFailure.emitRegistered(1, recovered));
    expect(first.result.current.snapshot).toEqual(recovered);

    const restartFailure = createPort();
    vi.mocked(restartFailure.port.start)
      .mockImplementationOnce(async () => vi.fn())
      .mockRejectedValueOnce(new Error("restart offline"));
    const second = renderHook(() => useFriends(restartFailure.port));
    await act(async () => undefined);
    await act(async () => {
      expect(await second.result.current.resetIdentity()).toBe(false);
    });
    expect(second.result.current.actionErrors.resetIdentity).toBe("restart offline");
    expect(restartFailure.port.start).toHaveBeenCalledTimes(2);
  });

  it("keeps action errors scoped when another action starts", async () => {
    const setup = createPort();
    setup.port.poke = vi.fn(async () => { throw new Error("poke failed"); });
    const { result } = renderHook(() => useFriends(setup.port));
    await act(async () => undefined);

    await act(async () => { await result.current.poke("friend"); });
    expect(result.current.actionErrors.poke).toBe("poke failed");
    expect(result.current.latestErrorAction).toBe("poke");
    await act(async () => { await result.current.removeFriend("other"); });
    expect(result.current.actionErrors.poke).toBe("poke failed");
    expect(result.current.latestErrorAction).toBe("poke");
  });

  it("tracks the most recently failed action instead of fixed error priority", async () => {
    const setup = createPort();
    setup.port.poke = vi.fn(async () => { throw new Error("poke failed first"); });
    setup.port.removeFriend = vi.fn(async () => { throw new Error("remove failed last"); });
    const { result } = renderHook(() => useFriends(setup.port));
    await act(async () => undefined);

    await act(async () => { await result.current.poke("friend"); });
    await act(async () => { await result.current.removeFriend("friend"); });

    expect(result.current.actionErrors).toMatchObject({
      poke: "poke failed first",
      removeFriend: "remove failed last",
    });
    expect(result.current.latestErrorAction).toBe("removeFriend");
  });
});
