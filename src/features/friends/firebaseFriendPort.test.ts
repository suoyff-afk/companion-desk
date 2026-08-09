import { describe, expect, it, vi } from "vitest";

import {
  createFirebaseFriendPort,
  firebaseDatabaseRestUrl,
  randomEightDigitCode,
  type FirebaseFriendAdapter,
} from "./firebaseFriendPort";
import type { ReadyFirebaseWebConfig } from "./firebaseConfig";
import { createMemoryAdapter, type StorageAdapter } from "../../lib/persistence";
import type { FriendSnapshot } from "./types";

const now = 1_750_000_000_000;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createFirebaseAdapter(overrides: Partial<FirebaseFriendAdapter> = {}) {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, (value: unknown) => void>();
  const registeredListeners = new Map<string, Array<(value: unknown) => void>>();
  const adapter: FirebaseFriendAdapter = {
    databaseUrl: "https://demo-companion-desk-default-rtdb.firebaseio.com",
    auth: {
      currentUser: null,
      setPersistence: vi.fn(async () => undefined),
      signInAnonymously: vi.fn(async () => ({ uid: "me", getIdToken: vi.fn(async () => "fresh-token") })),
      signOut: vi.fn(async () => undefined),
    },
    database: {
      get: vi.fn(async (path) => values.get(path) ?? null),
      runTransaction: vi.fn(async (path, update) => {
        const next = update(values.get(path) ?? null);
        values.set(path, next);
        return { committed: true, value: next };
      }),
      update: vi.fn(async (updates) => { Object.entries(updates).forEach(([path, value]) => values.set(path, value)); }),
      remove: vi.fn(async (path) => { values.delete(path); }),
      onValue: vi.fn((path, callback) => {
        listeners.set(path, callback);
        registeredListeners.set(path, [...(registeredListeners.get(path) ?? []), callback]);
        callback(values.get(path) ?? null);
        return () => listeners.delete(path);
      }),
      serverTimestamp: { ".sv": "timestamp" },
    },
    fetch: vi.fn(async () => new Response("", { status: 200 })),
    ...overrides,
  };
  return {
    adapter,
    values,
    emit(path: string, value: unknown) { listeners.get(path)?.(value); },
    emitRegistered(path: string, value: unknown, index = 0) { registeredListeners.get(path)?.[index]?.(value); },
  };
}

async function startPort(adapter: FirebaseFriendAdapter, storage: StorageAdapter = createMemoryAdapter()) {
  const snapshots: FriendSnapshot[] = [];
  const port = createFirebaseFriendPort({
    adapter,
    storage,
    now: () => now,
    randomCode: () => "48271936",
    randomUuid: () => "event-1",
  });
  const stop = await port.start({ onSnapshot: (snapshot) => snapshots.push(snapshot) });
  return { port, snapshots, stop, storage };
}

describe("Firebase friend pure helpers", () => {
  it("routes emulator REST writes to the normalized RTDB instance namespace", () => {
    const config: ReadyFirebaseWebConfig = {
      status: "ready",
      apiKey: "public-key",
      authDomain: "demo-companion-desk.firebaseapp.com",
      databaseURL: "https://demo-companion-desk-default-rtdb.firebaseio.com",
      projectId: "demo-companion-desk",
      appId: "1:1:web:1",
      useEmulator: true,
    };

    expect(firebaseDatabaseRestUrl(config))
      .toBe("http://127.0.0.1:9000/?ns=demo-companion-desk-default-rtdb");
    expect(firebaseDatabaseRestUrl({
      ...config,
      databaseURL: "https://demo-companion-desk-default-rtdb.europe-west1.firebasedatabase.app",
    })).toBe("http://127.0.0.1:9000/?ns=demo-companion-desk-default-rtdb");
    expect(firebaseDatabaseRestUrl({ ...config, useEmulator: false })).toBe(config.databaseURL);
  });

  it("uses rejection sampling across the complete unbiased eight-digit range", () => {
    const rejectionLimit = Math.floor(0x1_0000_0000 / 90_000_000) * 90_000_000;
    const samples = [rejectionLimit, 0, rejectionLimit - 1];
    const randomValues = vi.fn((target: Uint32Array) => {
      target[0] = samples.shift() ?? 0;
      return target;
    });

    expect(randomEightDigitCode(randomValues)).toBe("10000000");
    expect(randomValues).toHaveBeenCalledTimes(2);
    expect(randomEightDigitCode(randomValues)).toBe("99999999");
  });
});

describe("FirebaseFriendPort", () => {
  it("persists anonymous identity locally after claiming an available eight-digit code", async () => {
    const { adapter, values } = createFirebaseAdapter();
    const { snapshots, storage } = await startPort(adapter);

    expect(adapter.auth.setPersistence).toHaveBeenCalledOnce();
    expect(adapter.auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(adapter.database.runTransaction).toHaveBeenCalledWith("friendCodes/48271936", expect.any(Function));
    expect(values.get("friendCodes/48271936")).toBe("me");
    expect((await storage.get("friends"))).toMatchObject({ ownFriendCode: "48271936" });
    expect(snapshots.at(-1)?.ownFriendCode).toBe("48271936");
  });

  it("retries a code collision until it claims its own code", async () => {
    const { adapter } = createFirebaseAdapter();
    let calls = 0;
    adapter.database.runTransaction = vi.fn(async (_path, update) => {
      calls += 1;
      const value = update(calls === 1 ? "other-user" : null);
      return { committed: value === "me", value };
    });
    const port = createFirebaseFriendPort({
      adapter,
      storage: createMemoryAdapter(),
      randomCode: () => (calls === 0 ? "11111111" : "22222222"),
    });

    await port.start({ onSnapshot: vi.fn() });

    expect(adapter.database.runTransaction).toHaveBeenCalledTimes(2);
  });

  it("reads only the exact code path before creating a request", async () => {
    const { adapter, values } = createFirebaseAdapter();
    values.set("friendCodes/87654321", "friend");
    const { port, storage } = await startPort(adapter);

    await port.requestByCode("8765 4321");

    expect(adapter.database.get).toHaveBeenCalledWith("friendCodes/87654321");
    expect(adapter.database.update).toHaveBeenCalledWith({
      "requests/friend/me": { createdAt: { ".sv": "timestamp" } },
    });
    expect(await storage.get("friends")).toMatchObject({
      outboundRequestRecipientUids: ["friend"],
    });
  });

  it("does not create an untracked outbound request when local intent persistence fails", async () => {
    const { adapter, values } = createFirebaseAdapter();
    values.set("friendCodes/87654321", "friend");
    let failIntentWrite = false;
    const storage = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {
        if (failIntentWrite) throw new Error("disk full");
      }),
    };
    const { port } = await startPort(adapter, storage);
    vi.mocked(adapter.database.update).mockClear();
    failIntentWrite = true;

    await expect(port.requestByCode("87654321")).rejects.toThrow("disk full");

    expect(adapter.database.update).not.toHaveBeenCalled();
  });

  it("rolls back a newly tracked outbound request when the remote creation fails", async () => {
    const { adapter, values } = createFirebaseAdapter();
    values.set("friendCodes/87654321", "friend");
    const storage = createMemoryAdapter();
    const { port } = await startPort(adapter, storage);
    adapter.database.update = vi.fn(async () => { throw new Error("offline"); });

    await expect(port.requestByCode("87654321")).rejects.toThrow("offline");

    expect(await storage.get("friends")).not.toMatchObject({
      outboundRequestRecipientUids: ["friend"],
    });
  });

  it("accepts with one root update containing both friend mirrors and request deletion", async () => {
    const { adapter } = createFirebaseAdapter();
    const { port } = await startPort(adapter);

    await port.acceptRequest("friend");

    expect(adapter.database.update).toHaveBeenLastCalledWith({
      "friends/me/friend": { acceptedAt: { ".sv": "timestamp" } },
      "friends/friend/me": { acceptedAt: { ".sv": "timestamp" } },
      "requests/me/friend": null,
    });
  });

  it("clears outbound request tracking when the friendship appears", async () => {
    const { adapter, values, emit } = createFirebaseAdapter();
    values.set("profiles/friend", { displayName: "Friend", createdAt: now });
    const storage = createMemoryAdapter();
    await storage.set("friends", {
      ownFriendCode: "48271936",
      outboundRequestRecipientUids: ["friend"],
    });
    const { port } = await startPort(adapter, storage);

    emit("friends/me", { friend: { acceptedAt: now } });

    await vi.waitFor(async () => {
      expect(await storage.get("friends")).toMatchObject({
        outboundRequestRecipientUids: [],
      });
    });
    await port.resetIdentity();
    expect(adapter.database.update).not.toHaveBeenLastCalledWith(expect.objectContaining({
      "requests/friend/me": null,
    }));
  });

  it("ignores requests and removes both friendship mirrors", async () => {
    const { adapter } = createFirebaseAdapter();
    const { port } = await startPort(adapter);

    await port.ignoreRequest("friend");
    await port.removeFriend("friend");

    expect(adapter.database.remove).toHaveBeenCalledWith("requests/me/friend");
    expect(adapter.database.update).toHaveBeenLastCalledWith({
      "friends/me/friend": null,
      "friends/friend/me": null,
    });
  });

  it("tracks the Realtime Database connection state", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const { snapshots } = await startPort(adapter);

    emit(".info/connected", true);

    expect(adapter.database.onValue).toHaveBeenCalledWith(".info/connected", expect.any(Function));
    expect(snapshots.at(-1)?.connectionState).toBe("ready");
  });

  it("ignores retained Firebase callbacks after stop without emitting or persisting", async () => {
    const { adapter, emitRegistered } = createFirebaseAdapter();
    const storage = createMemoryAdapter();
    const { snapshots, stop } = await startPort(adapter, storage);
    const snapshotCount = snapshots.length;
    const storedBeforeStop = await storage.get("friends");

    stop();
    emitRegistered(".info/connected", true);
    emitRegistered("profiles/me", { displayName: "Stale", createdAt: now });
    emitRegistered("pokes/me", { friend: { eventId: "after-stop", createdAt: now } });
    await Promise.resolve();

    expect(snapshots).toHaveLength(snapshotCount);
    expect(await storage.get("friends")).toEqual(storedBeforeStop);
  });

  it("does not let a superseded asynchronous start register listeners or emit to the newer handler", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const firstRead = deferred<unknown>();
    let reads = 0;
    const storage = {
      get: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? firstRead.promise : undefined;
      }),
      set: vi.fn(async () => undefined),
    };
    const firstSnapshots: FriendSnapshot[] = [];
    const secondSnapshots: FriendSnapshot[] = [];
    const port = createFirebaseFriendPort({
      adapter,
      storage,
      randomCode: () => "48271936",
    });

    const firstStart = port.start({ onSnapshot: (snapshot) => firstSnapshots.push(snapshot) });
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce());
    const secondStop = await port.start({ onSnapshot: (snapshot) => secondSnapshots.push(snapshot) });
    const secondSnapshotCount = secondSnapshots.length;
    firstRead.resolve(undefined);
    const staleStop = await firstStart;

    expect(adapter.database.onValue).toHaveBeenCalledTimes(5);
    expect(secondSnapshots).toHaveLength(secondSnapshotCount);
    expect(firstSnapshots).toHaveLength(0);

    staleStop();
    emit(".info/connected", true);
    expect(secondSnapshots.at(-1)?.connectionState).toBe("ready");
    secondStop();
  });

  it("shares a deferred anonymous sign-in across superseded starts without corrupting the active identity", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const signInResult = deferred<FirebaseFriendAdapter["auth"]["currentUser"]>();
    adapter.auth.signInAnonymously = vi.fn(async () => {
      const user = await signInResult.promise;
      if (!user) throw new Error("missing test user");
      adapter.auth.currentUser = user;
      return user;
    });
    const port = createFirebaseFriendPort({
      adapter,
      storage: createMemoryAdapter(),
      randomCode: () => "48271936",
    });
    const firstSnapshots: FriendSnapshot[] = [];
    const secondSnapshots: FriendSnapshot[] = [];

    const firstStart = port.start({ onSnapshot: (snapshot) => firstSnapshots.push(snapshot) });
    await vi.waitFor(() => expect(adapter.auth.signInAnonymously).toHaveBeenCalledOnce());
    const secondStart = port.start({ onSnapshot: (snapshot) => secondSnapshots.push(snapshot) });
    await vi.waitFor(() => expect(adapter.auth.setPersistence).toHaveBeenCalledTimes(2));

    expect(adapter.auth.signInAnonymously).toHaveBeenCalledOnce();
    signInResult.resolve({ uid: "shared-user", getIdToken: vi.fn(async () => "token") });
    const staleStop = await firstStart;
    const activeStop = await secondStart;

    expect(firstSnapshots).toHaveLength(0);
    expect(adapter.database.onValue).toHaveBeenCalledTimes(5);
    expect(adapter.database.onValue).toHaveBeenCalledWith("profiles/shared-user", expect.any(Function));
    staleStop();
    emit(".info/connected", true);
    expect(secondSnapshots.at(-1)?.connectionState).toBe("ready");

    activeStop();
    const thirdSnapshots: FriendSnapshot[] = [];
    const thirdStop = await port.start({ onSnapshot: (snapshot) => thirdSnapshots.push(snapshot) });
    expect(adapter.auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(adapter.auth.signOut).not.toHaveBeenCalled();
    expect(adapter.database.onValue).toHaveBeenCalledTimes(10);
    expect(adapter.auth.currentUser?.uid).toBe("shared-user");
    expect(thirdSnapshots.length).toBeGreaterThan(0);
    thirdStop();
  });

  it("sends a one-shot REST poke with a fresh token and an AbortController", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const user = { uid: "me", getIdToken: vi.fn(async () => "fresh-token") };
    adapter.auth.currentUser = user;
    const { port } = await startPort(adapter);
    emit(".info/connected", true);

    await port.poke("friend");

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(adapter.fetch).toHaveBeenCalledWith(
      "https://demo-companion-desk-default-rtdb.firebaseio.com/pokes/friend/me.json?auth=fresh-token",
      expect.objectContaining({
        method: "PUT",
        signal: expect.any(AbortSignal),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: "event-1", createdAt: { ".sv": "timestamp" } }),
      }),
    );
  });

  it("preserves the emulator namespace in one-shot REST poke URLs", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    adapter.databaseUrl = "http://127.0.0.1:9000/?ns=demo-companion-desk-default-rtdb";
    adapter.auth.currentUser = { uid: "me", getIdToken: vi.fn(async () => "fresh-token") };
    const { port } = await startPort(adapter);
    emit(".info/connected", true);

    await port.poke("friend");

    expect(adapter.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/pokes/friend/me.json?ns=demo-companion-desk-default-rtdb&auth=fresh-token",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("does not fetch a poke while disconnected", async () => {
    const { adapter } = createFirebaseAdapter();
    const { port } = await startPort(adapter);

    await expect(port.poke("friend")).rejects.toThrow("active Firebase connection");

    expect(adapter.fetch).not.toHaveBeenCalled();
  });

  it("aborts an in-flight poke when the connection drops", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    adapter.auth.currentUser = { uid: "me", getIdToken: vi.fn(async () => "fresh-token") };
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    adapter.fetch = fetch;
    const { port } = await startPort(adapter);
    emit(".info/connected", true);

    const delivery = port.poke("friend");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    emit(".info/connected", false);

    await expect(delivery).rejects.toMatchObject({ name: "AbortError" });
    expect((fetch.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("surfaces a non-2xx poke response without retrying", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    adapter.auth.currentUser = { uid: "me", getIdToken: vi.fn(async () => "fresh-token") };
    adapter.fetch = vi.fn(async () => new Response("denied", { status: 403 }));
    const { port } = await startPort(adapter);
    emit(".info/connected", true);

    await expect(port.poke("friend")).rejects.toThrow("403");

    expect(adapter.fetch).toHaveBeenCalledOnce();
  });

  it("does not notify for expired or locally handled poke events and deletes only expired records", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const storage = createMemoryAdapter();
    await storage.set("friends", { ownFriendCode: "48271936", handledPokeEventIds: { handled: now } });
    const { snapshots } = await startPort(adapter, storage);

    emit("pokes/me", {
      friend: { eventId: "handled", createdAt: now },
      stale: { eventId: "stale", createdAt: now - 86_400_001 },
    });

    expect(snapshots.at(-1)?.incomingPoke).toBeNull();
    expect(adapter.database.remove).toHaveBeenCalledWith("pokes/me/stale");
  });

  it("persists a fresh poke event before notifying and parses profile, requests, and friends", async () => {
    const { adapter, values, emit } = createFirebaseAdapter();
    values.set("profiles/me", { displayName: "Me", createdAt: now });
    values.set("profiles/requester", { displayName: "Requester", createdAt: now - 1 });
    values.set("profiles/friend", { displayName: "Friend", createdAt: now - 2 });
    const storage = createMemoryAdapter();
    const incomingPersistence: unknown[] = [];
    const snapshots: FriendSnapshot[] = [];
    const port = createFirebaseFriendPort({
      adapter,
      storage,
      now: () => now,
      randomCode: () => "48271936",
      randomUuid: () => "event-1",
    });
    await port.start({
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
        if (snapshot.incomingPoke) void storage.get("friends").then((value) => incomingPersistence.push(value));
      },
    });

    emit(`profiles/me`, { displayName: "Me", createdAt: now });
    emit("requests/me", { requester: { createdAt: now - 10 } });
    emit("friends/me", { friend: { acceptedAt: now - 20 } });
    emit("pokes/me", { friend: { eventId: "fresh", createdAt: now } });

    await vi.waitFor(() => expect(incomingPersistence).toContainEqual(expect.objectContaining({
      handledPokeEventIds: { fresh: now },
    })));
    expect(snapshots.some((snapshot) => snapshot.self?.displayName === "Me")).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.pendingRequests[0]?.displayName === "Requester")).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.friends[0]?.displayName === "Friend")).toBe(true);
  });

  it("keeps the newest request snapshot when an older profile lookup resolves last", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const { snapshots } = await startPort(adapter);
    const oldProfile = deferred<unknown>();
    adapter.database.get = vi.fn(async (path) => {
      if (path === "profiles/old-requester") return oldProfile.promise;
      if (path === "profiles/new-requester") return { displayName: "New requester", createdAt: now };
      return null;
    });

    emit("requests/me", { "old-requester": { createdAt: now - 2 } });
    emit("requests/me", { "new-requester": { createdAt: now - 1 } });
    await vi.waitFor(() => expect(snapshots.at(-1)?.pendingRequests[0]?.requesterUid).toBe("new-requester"));
    oldProfile.resolve({ displayName: "Old requester", createdAt: now });
    await Promise.resolve();

    expect(snapshots.at(-1)?.pendingRequests.map((request) => request.requesterUid)).toEqual(["new-requester"]);
  });

  it("keeps the newest friend snapshot when an older profile lookup resolves last", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const { snapshots } = await startPort(adapter);
    const oldProfile = deferred<unknown>();
    adapter.database.get = vi.fn(async (path) => {
      if (path === "profiles/old-friend") return oldProfile.promise;
      if (path === "profiles/new-friend") return { displayName: "New friend", createdAt: now };
      return null;
    });

    emit("friends/me", { "old-friend": { acceptedAt: now - 2 } });
    emit("friends/me", { "new-friend": { acceptedAt: now - 1 } });
    await vi.waitFor(() => expect(snapshots.at(-1)?.friends[0]?.uid).toBe("new-friend"));
    oldProfile.resolve({ displayName: "Old friend", createdAt: now });
    await Promise.resolve();

    expect(snapshots.at(-1)?.friends.map((friend) => friend.uid)).toEqual(["new-friend"]);
  });

  it("serializes handled poke persistence so an older write cannot overwrite the newer event", async () => {
    const persisted = new Map<string, unknown>();
    const oldWrite = deferred<void>();
    let delayOldPoke = false;
    const storage = {
      get: vi.fn(async (key: string) => persisted.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        const handled = (value as { handledPokeEventIds?: Record<string, number> }).handledPokeEventIds;
        if (delayOldPoke && handled?.old && !handled?.new) await oldWrite.promise;
        persisted.set(key, value);
      }),
    };
    const { adapter, emit } = createFirebaseAdapter();
    const { snapshots } = await startPort(adapter, storage);
    delayOldPoke = true;

    emit("pokes/me", { friend: { eventId: "old", createdAt: now - 1 } });
    emit("pokes/me", { friend: { eventId: "new", createdAt: now } });
    oldWrite.resolve();

    await vi.waitFor(() => expect(snapshots.at(-1)?.incomingPoke?.eventId).toBe("new"));
    expect(persisted.get("friends")).toMatchObject({
      handledPokeEventIds: { old: now, new: now },
    });
  });

  it("emits every fresh unhandled poke from one inbox snapshot in stable order", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const storage = createMemoryAdapter();
    const { snapshots } = await startPort(adapter, storage);

    emit("pokes/me", {
      alice: { eventId: "alice-fresh", createdAt: now - 2 },
      bob: { eventId: "bob-fresh", createdAt: now - 1 },
    });

    await vi.waitFor(async () => {
      expect(snapshots
        .map((snapshot) => snapshot.incomingPoke?.eventId)
        .filter(Boolean)
        .slice(-2))
        .toEqual(["alice-fresh", "bob-fresh"]);
      expect(await storage.get("friends")).toMatchObject({
        handledPokeEventIds: {
          "alice-fresh": now,
          "bob-fresh": now,
        },
      });
    });
  });

  it("does not let an expired or duplicate poke block a later fresh inbox item", async () => {
    const { adapter, emit } = createFirebaseAdapter();
    const storage = createMemoryAdapter();
    await storage.set("friends", {
      ownFriendCode: "48271936",
      handledPokeEventIds: { duplicate: now },
    });
    const { snapshots } = await startPort(adapter, storage);

    emit("pokes/me", {
      expired: { eventId: "expired", createdAt: now - 86_400_001 },
      duplicate: { eventId: "duplicate", createdAt: now - 2 },
      fresh: { eventId: "fresh-after-skips", createdAt: now - 1 },
    });

    await vi.waitFor(() => expect(snapshots.at(-1)?.incomingPoke?.eventId).toBe("fresh-after-skips"));
    expect(adapter.database.remove).toHaveBeenCalledWith("pokes/me/expired");
  });

  it("keeps fresh incoming pokes, deletes stale ones separately, and limits the core update to rule-allowed paths", async () => {
    const { adapter, values } = createFirebaseAdapter();
    values.set("friends/me", { "friend-not-yet-resolved": { acceptedAt: now } });
    values.set("requests/me", { requester: { createdAt: now } });
    values.set("pokes/me", {
      fresh: { eventId: "fresh", createdAt: now - 86_399_999 },
      stale: { eventId: "stale", createdAt: now - 86_400_001 },
    });
    const storage = createMemoryAdapter();
    await storage.set("friends", {
      ownFriendCode: "48271936",
      outboundRequestRecipientUids: ["pending-recipient"],
    });
    const { port } = await startPort(adapter, storage);

    await port.resetIdentity();

    expect(adapter.database.update).toHaveBeenLastCalledWith({
      "friendCodes/48271936": null,
      "profiles/me": null,
      "friends/me/friend-not-yet-resolved": null,
      "friends/friend-not-yet-resolved/me": null,
      "requests/me/requester": null,
      "requests/pending-recipient/me": null,
    });
    expect(adapter.database.remove).toHaveBeenCalledWith("pokes/me/stale");
    expect(adapter.database.remove).not.toHaveBeenCalledWith("pokes/me/fresh");
    expect(adapter.auth.signOut).toHaveBeenCalledOnce();
    expect(await storage.get("friends")).toEqual({});
  });

  it("invalidates retained listeners before reset cleanup can emit or persist stale events", async () => {
    const { adapter, emitRegistered } = createFirebaseAdapter();
    const storage = createMemoryAdapter();
    const { port, snapshots } = await startPort(adapter, storage);
    const snapshotCount = snapshots.length;

    const reset = port.resetIdentity();
    emitRegistered(".info/connected", true);
    emitRegistered("profiles/me", { displayName: "Stale", createdAt: now });
    emitRegistered("pokes/me", { friend: { eventId: "during-reset", createdAt: now } });
    await reset;

    expect(snapshots).toHaveLength(snapshotCount);
    expect(await storage.get("friends")).toEqual({});
  });

  it("continues core reset and sign-out when stale poke deletion is denied", async () => {
    const { adapter, values } = createFirebaseAdapter();
    values.set("pokes/me", { stale: { eventId: "stale", createdAt: now - 86_400_001 } });
    adapter.database.remove = vi.fn(async () => { throw new Error("permission denied"); });
    const { port } = await startPort(adapter);

    await expect(port.resetIdentity()).resolves.toBeUndefined();

    expect(adapter.database.update).toHaveBeenLastCalledWith({
      "friendCodes/48271936": null,
      "profiles/me": null,
    });
    expect(adapter.database.remove).toHaveBeenCalledWith("pokes/me/stale");
    expect(adapter.auth.signOut).toHaveBeenCalledOnce();
  });

  it("keeps the old identity and local cleanup data when the core reset write fails", async () => {
    const { adapter } = createFirebaseAdapter();
    const oldUser = { uid: "me", getIdToken: vi.fn(async () => "old-token") };
    adapter.auth.currentUser = oldUser;
    adapter.database.get = vi.fn(async (path) => {
      if (["friends/me", "requests/me", "pokes/me"].includes(path)) throw new Error("offline");
      return null;
    });
    let failUpdates = false;
    adapter.database.update = vi.fn(async () => { if (failUpdates) throw new Error("offline"); });
    const storage = createMemoryAdapter();
    await storage.set("friends", {
      ownFriendCode: "48271936",
      outboundRequestRecipientUids: ["pending-recipient"],
    });
    const port = createFirebaseFriendPort({ adapter, storage });
    await port.start({ onSnapshot: vi.fn() });
    failUpdates = true;

    await expect(port.resetIdentity()).rejects.toThrow("offline");

    expect(adapter.auth.signOut).not.toHaveBeenCalled();
    expect(await storage.get("friends")).toMatchObject({
      ownFriendCode: "48271936",
      outboundRequestRecipientUids: ["pending-recipient"],
    });
    failUpdates = false;
    await port.start({ onSnapshot: vi.fn() });
    expect(adapter.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(adapter.database.update).toHaveBeenCalledWith(expect.objectContaining({
      "profiles/me": expect.any(Object),
    }));
  });

  it("rejects a sign-out failure and retries sign-out before creating a fresh identity on restart", async () => {
    const { adapter } = createFirebaseAdapter();
    const oldUser = { uid: "old-user", getIdToken: vi.fn(async () => "old-token") };
    const newUser = { uid: "new-user", getIdToken: vi.fn(async () => "new-token") };
    adapter.auth.currentUser = oldUser;
    adapter.auth.signInAnonymously = vi.fn(async () => newUser);
    adapter.auth.signOut = vi.fn()
      .mockRejectedValueOnce(new Error("sign-out failed"))
      .mockResolvedValueOnce(undefined);
    const port = createFirebaseFriendPort({
      adapter,
      storage: createMemoryAdapter(),
      randomCode: () => "48271936",
    });
    await port.start({ onSnapshot: vi.fn() });

    await expect(port.resetIdentity()).rejects.toThrow("sign-out failed");
    await port.start({ onSnapshot: vi.fn() });

    expect(adapter.auth.signOut).toHaveBeenCalledTimes(2);
    expect(adapter.auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(adapter.database.update).toHaveBeenCalledWith(expect.objectContaining({
      "profiles/new-user": expect.any(Object),
    }));
  });

  it("reuses the old identity after a core reset failure so cleanup can be retried", async () => {
    const { adapter } = createFirebaseAdapter();
    const oldUser = { uid: "old-user", getIdToken: vi.fn(async () => "old-token") };
    adapter.auth.currentUser = oldUser;
    let failCoreReset = false;
    const originalUpdate = adapter.database.update;
    adapter.database.update = vi.fn(async (updates) => {
      if (failCoreReset && updates["profiles/old-user"] === null) throw new Error("core reset failed");
      await originalUpdate(updates);
    });
    const port = createFirebaseFriendPort({
      adapter,
      storage: createMemoryAdapter(),
      randomCode: () => "48271936",
    });
    await port.start({ onSnapshot: vi.fn() });
    failCoreReset = true;

    await expect(port.resetIdentity()).rejects.toThrow("core reset failed");
    await port.start({ onSnapshot: vi.fn() });

    expect(adapter.auth.signOut).not.toHaveBeenCalled();
    expect(adapter.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(adapter.database.update).toHaveBeenCalledWith(expect.objectContaining({
      "profiles/old-user": expect.any(Object),
    }));
  });
});
