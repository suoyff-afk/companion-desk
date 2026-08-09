import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
} from "firebase/database";

import { readAppValue, writeAppValue, type StorageAdapter } from "../../lib/persistence";
import type { FriendPort, FriendPortHandlers } from "./FriendPort";
import { POKE_EXPIRY_MS, isPokeExpired, normalizeFriendCode } from "./friendLogic";
import { readViteFirebaseWebConfig, type ReadyFirebaseWebConfig } from "./firebaseConfig";
import type { FriendProfile, FriendRequest, FriendSnapshot, FriendSummary, IncomingPoke } from "./types";

type JsonRecord = Record<string, unknown>;

export interface FirebaseFriendUser {
  uid: string;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export interface FirebaseFriendAdapter {
  databaseUrl: string;
  auth: {
    currentUser: FirebaseFriendUser | null;
    setPersistence(): Promise<void>;
    signInAnonymously(): Promise<FirebaseFriendUser>;
    signOut(): Promise<void>;
  };
  database: {
    get(path: string): Promise<unknown>;
    runTransaction(path: string, updateValue: (current: unknown) => unknown): Promise<{ committed: boolean; value: unknown }>;
    update(updates: Record<string, unknown>): Promise<void>;
    remove(path: string): Promise<void>;
    onValue(path: string, listener: (value: unknown) => void): () => void;
    serverTimestamp: unknown;
  };
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface FirebaseFriendPortOptions {
  adapter?: FirebaseFriendAdapter;
  storage?: StorageAdapter;
  now?: () => number;
  randomCode?: () => string;
  randomUuid?: () => string;
}

interface FriendLocalState {
  displayName?: string;
  ownFriendCode?: string;
  handledPokeEventIds?: Record<string, number>;
  outboundRequestRecipientUids?: string[];
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type RandomValues = (target: Uint32Array) => Uint32Array;

export function randomEightDigitCode(
  randomValues: RandomValues = (target) => crypto.getRandomValues(target),
): string {
  const bytes = new Uint32Array(1);
  const range = 90_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  do { randomValues(bytes); } while (bytes[0] >= limit);
  return String(10_000_000 + (bytes[0] % range));
}

function randomEventId(): string {
  return crypto.randomUUID();
}

function displayNameFor(uid: string, saved: string | undefined): string {
  return saved?.trim() || `Kunkun-${uid.slice(0, 6)}`;
}

function profileFromValue(uid: string, value: unknown): FriendProfile | null {
  const profile = record(value);
  const displayName = typeof profile.displayName === "string" ? profile.displayName : null;
  const createdAt = numberValue(profile.createdAt);
  return displayName && createdAt !== null ? { uid, displayName, createdAt } : null;
}

export function firebaseDatabaseRestUrl(config: ReadyFirebaseWebConfig): string {
  const databaseNamespace = new URL(config.databaseURL).hostname.split(".")[0];
  return config.useEmulator
    ? `http://127.0.0.1:9000/?ns=${encodeURIComponent(databaseNamespace)}`
    : config.databaseURL;
}

function defaultFirebaseAdapter(): FirebaseFriendAdapter {
  const config = readViteFirebaseWebConfig();
  if (config.status !== "ready") throw new Error("Firebase friends are unavailable because public web configuration is missing.");

  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const database = getDatabase(app, config.databaseURL);
  if (config.useEmulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(database, "127.0.0.1", 9000);
  }

  return {
    databaseUrl: firebaseDatabaseRestUrl(config),
    auth: {
      get currentUser() { return auth.currentUser; },
      setPersistence: () => setPersistence(auth, browserLocalPersistence),
      signInAnonymously: async () => (await signInAnonymously(auth)).user,
      signOut: () => signOut(auth),
    },
    database: {
      get: async (path) => (await get(ref(database, path))).val(),
      runTransaction: async (path, updateValue) => {
        const result = await runTransaction(ref(database, path), updateValue, { applyLocally: false });
        return { committed: result.committed, value: result.snapshot.val() };
      },
      update: (updates) => update(ref(database), updates),
      remove: (path) => remove(ref(database, path)),
      onValue: (path, listener) => onValue(ref(database, path), (snapshot) => listener(snapshot.val())),
      serverTimestamp: serverTimestamp(),
    },
    fetch: globalThis.fetch.bind(globalThis),
  };
}

export function createFirebaseFriendPort(options: FirebaseFriendPortOptions = {}): FriendPort {
  return new FirebaseFriendPort(options);
}

function emptyFriendSnapshot(): FriendSnapshot {
  return {
    connectionState: "connecting",
    self: null,
    ownFriendCode: null,
    friends: [],
    pendingRequests: [],
    cooldownsByFriendUid: {},
    incomingPoke: null,
  };
}

interface IdentityBootstrapResult {
  user: FirebaseFriendUser;
  forceFresh: boolean;
}

class FirebaseFriendPort implements FriendPort {
  private readonly adapter: FirebaseFriendAdapter;
  private readonly now: () => number;
  private readonly randomCode: () => string;
  private readonly randomUuid: () => string;
  private storage?: StorageAdapter;
  private user: FirebaseFriendUser | null = null;
  private handlers: FriendPortHandlers | null = null;
  private stopListeners: Array<() => void> = [];
  private activePokes = new Set<AbortController>();
  private sessionGeneration = 0;
  private requestSequence = 0;
  private friendSequence = 0;
  private pokeSequence = 0;
  private localWriteQueue: Promise<void> = Promise.resolve();
  private identityBootstrap: Promise<IdentityBootstrapResult> | null = null;
  private retainedIdentity: FirebaseFriendUser | null = null;
  private forceFreshIdentity = false;
  private identityRequiresSignOut = false;
  private local: FriendLocalState = {};
  private connected = false;
  private snapshot: FriendSnapshot = emptyFriendSnapshot();

  constructor(options: FirebaseFriendPortOptions) {
    this.adapter = options.adapter ?? defaultFirebaseAdapter();
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.randomCode = options.randomCode ?? randomEightDigitCode;
    this.randomUuid = options.randomUuid ?? randomEventId;
  }

  async start(handlers: FriendPortHandlers): Promise<() => void> {
    this.stop();
    const session = ++this.sessionGeneration;
    this.handlers = handlers;
    this.snapshot = { ...emptyFriendSnapshot(), connectionState: "connecting" };
    try {
      const local = await readAppValue<FriendLocalState>("friends", {}, this.storage);
      if (!this.isActiveSession(session)) return () => undefined;
      this.local = local;
      await this.adapter.auth.setPersistence();
      if (!this.isActiveSession(session)) return () => undefined;

      const identity = await this.bootstrapIdentity();
      if (!this.isActiveSession(session)) return () => undefined;
      this.user = identity.user;
      if (identity.forceFresh) {
        this.forceFreshIdentity = false;
        this.identityRequiresSignOut = false;
      }
      await this.ensureProfile(session);
      if (!this.isActiveSession(session)) return () => undefined;
      const ownFriendCode = await this.claimFriendCode(session);
      if (!this.isActiveSession(session) || ownFriendCode === null) return () => undefined;
      this.snapshot = { ...this.snapshot, ownFriendCode };
      this.emit(session);
      this.startListeners(session);
      return () => {
        if (this.isActiveSession(session)) this.stop();
      };
    } catch (cause) {
      if (!this.isActiveSession(session)) return () => undefined;
      const error = cause instanceof Error ? cause : new Error("Unable to start Firebase friends.");
      this.snapshot = { ...this.snapshot, connectionState: "unavailable" };
      this.emit(session);
      handlers.onError?.(error);
      throw error;
    }
  }

  async requestByCode(code: string): Promise<void> {
    const normalized = normalizeFriendCode(code);
    if (!normalized) throw new Error("Friend code must contain exactly eight digits.");
    const uid = this.requireUser().uid;
    const recipientUid = await this.adapter.database.get(`friendCodes/${normalized}`);
    if (typeof recipientUid !== "string") throw new Error("Friend code was not found.");
    if (recipientUid === uid) throw new Error("You cannot add yourself as a friend.");
    const previousLocal = this.local;
    const alreadyTracked = previousLocal.outboundRequestRecipientUids?.includes(recipientUid) ?? false;
    if (!alreadyTracked) {
      const nextLocal = {
        ...previousLocal,
        outboundRequestRecipientUids: [...(previousLocal.outboundRequestRecipientUids ?? []), recipientUid],
      };
      await this.persistLocal(nextLocal);
      this.local = nextLocal;
    }
    try {
      await this.adapter.database.update({
        [`requests/${recipientUid}/${uid}`]: { createdAt: this.adapter.database.serverTimestamp },
      });
    } catch (error) {
      if (!alreadyTracked) {
        this.local = previousLocal;
        try { await this.persistLocal(previousLocal); } catch { /* Preserve the remote failure. */ }
      }
      throw error;
    }
  }

  async acceptRequest(requesterUid: string): Promise<void> {
    const uid = this.requireUser().uid;
    const acceptedAt = this.adapter.database.serverTimestamp;
    await this.adapter.database.update({
      [`friends/${uid}/${requesterUid}`]: { acceptedAt },
      [`friends/${requesterUid}/${uid}`]: { acceptedAt },
      [`requests/${uid}/${requesterUid}`]: null,
    });
  }

  async ignoreRequest(requesterUid: string): Promise<void> {
    await this.adapter.database.remove(`requests/${this.requireUser().uid}/${requesterUid}`);
  }

  async poke(friendUid: string): Promise<void> {
    const user = this.requireUser();
    const session = this.sessionGeneration;
    if (!this.connected || !this.isActiveSession(session)) throw new Error("Pokes require an active Firebase connection.");

    const controller = new AbortController();
    this.activePokes.add(controller);
    try {
      if (!this.connected || !this.isActiveSession(session)) {
        controller.abort();
        throw new Error("Pokes require an active Firebase connection.");
      }
      const token = await user.getIdToken(true);
      if (!this.connected || !this.isActiveSession(session)) {
        controller.abort();
        throw new Error("Pokes require an active Firebase connection.");
      }
      const restBase = new URL(this.adapter.databaseUrl);
      const url = new URL(`pokes/${encodeURIComponent(friendUid)}/${encodeURIComponent(user.uid)}.json`, restBase);
      const namespace = restBase.searchParams.get("ns");
      if (namespace) url.searchParams.set("ns", namespace);
      url.searchParams.set("auth", token);
      const response = await this.adapter.fetch(url.toString(), {
        method: "PUT",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: this.randomUuid(), createdAt: { ".sv": "timestamp" } }),
      });
      if (!response.ok) throw new Error(`Poke delivery failed (${response.status}).`);
      if (!this.isActiveSession(session)) throw new DOMException("Poke session stopped.", "AbortError");
      this.snapshot = {
        ...this.snapshot,
        cooldownsByFriendUid: { ...this.snapshot.cooldownsByFriendUid, [friendUid]: this.now() },
      };
      this.emit(session);
    } finally {
      this.activePokes.delete(controller);
    }
  }

  async removeFriend(friendUid: string): Promise<void> {
    const uid = this.requireUser().uid;
    await this.adapter.database.update({
      [`friends/${uid}/${friendUid}`]: null,
      [`friends/${friendUid}/${uid}`]: null,
    });
  }

  async resetIdentity(): Promise<void> {
    const user = this.requireUser();
    const localBeforeReset = this.local;
    this.stop();
    const [remoteFriends, remoteRequests, incomingPokes] = await Promise.all([
      this.bestEffortRecord(`friends/${user.uid}`),
      this.bestEffortRecord(`requests/${user.uid}`),
      this.bestEffortRecord(`pokes/${user.uid}`),
    ]);
    const friendUids = new Set([...Object.keys(remoteFriends), ...this.snapshot.friends.map((friend) => friend.uid)]);
    const updates: Record<string, unknown> = { [`profiles/${user.uid}`]: null };
    if (this.local.ownFriendCode) updates[`friendCodes/${this.local.ownFriendCode}`] = null;
    for (const friendUid of friendUids) {
      updates[`friends/${user.uid}/${friendUid}`] = null;
      updates[`friends/${friendUid}/${user.uid}`] = null;
    }
    for (const requesterUid of Object.keys(remoteRequests)) updates[`requests/${user.uid}/${requesterUid}`] = null;
    for (const recipientUid of localBeforeReset.outboundRequestRecipientUids ?? []) {
      updates[`requests/${recipientUid}/${user.uid}`] = null;
    }

    let signOutFailure: unknown = null;
    try {
      await this.adapter.database.update(updates);
    } catch (error) {
      this.local = localBeforeReset;
      this.retainedIdentity = user;
      this.forceFreshIdentity = false;
      this.identityRequiresSignOut = false;
      throw error;
    }
    this.forceFreshIdentity = true;
    this.identityRequiresSignOut = true;
    await Promise.all(Object.entries(incomingPokes).map(async ([senderUid, poke]) => {
      const createdAt = numberValue(record(poke).createdAt);
      if (createdAt === null || createdAt > this.now() - POKE_EXPIRY_MS) return;
      try {
        await this.adapter.database.remove(`pokes/${user.uid}/${senderUid}`);
      } catch {
        // Fresh poke records cannot be deleted by the recipient, and stale deletion may race another client.
      }
    }));

    this.local = {};
    this.snapshot = emptyFriendSnapshot();
    try {
      await this.persistLocal(this.local);
    } catch {
      // Local storage cleanup is best-effort; invalidating the Firebase identity remains mandatory.
    }
    try {
      await this.adapter.auth.signOut();
      this.identityRequiresSignOut = false;
    } catch (error) {
      signOutFailure = error;
    } finally {
      this.user = null;
    }

    if (signOutFailure) throw signOutFailure;
  }

  private bootstrapIdentity(): Promise<IdentityBootstrapResult> {
    if (this.identityBootstrap) return this.identityBootstrap;

    const forceFresh = this.forceFreshIdentity;
    const requiresSignOut = forceFresh && this.identityRequiresSignOut;
    const bootstrap = (async (): Promise<IdentityBootstrapResult> => {
      if (requiresSignOut) await this.adapter.auth.signOut();
      const currentUser = forceFresh ? null : (this.adapter.auth.currentUser ?? this.retainedIdentity);
      const user = currentUser ?? await this.adapter.auth.signInAnonymously();
      this.retainedIdentity = null;
      return { user, forceFresh };
    })();
    this.identityBootstrap = bootstrap;
    const clear = () => {
      if (this.identityBootstrap === bootstrap) this.identityBootstrap = null;
    };
    void bootstrap.then(clear, clear);
    return bootstrap;
  }

  private async ensureProfile(session: number): Promise<void> {
    const user = this.requireUser();
    const existing = profileFromValue(user.uid, await this.adapter.database.get(`profiles/${user.uid}`));
    if (!this.isActiveSession(session) || existing) return;
    const displayName = displayNameFor(user.uid, this.local.displayName);
    this.local = { ...this.local, displayName };
    await this.persistLocal(this.local, session);
    if (!this.isActiveSession(session)) return;
    await this.adapter.database.update({
      [`profiles/${user.uid}`]: { displayName, createdAt: this.adapter.database.serverTimestamp },
    });
  }

  private async claimFriendCode(session: number): Promise<string | null> {
    const user = this.requireUser();
    let candidate = normalizeFriendCode(this.local.ownFriendCode ?? "");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!this.isActiveSession(session)) return null;
      candidate ??= this.randomCode();
      const result = await this.adapter.database.runTransaction(
        `friendCodes/${candidate}`,
        (current) => current === null || current === undefined ? user.uid : current,
      );
      if (!this.isActiveSession(session)) return null;
      if (result.value === user.uid) {
        this.local = { ...this.local, ownFriendCode: candidate };
        await this.persistLocal(this.local, session);
        if (!this.isActiveSession(session)) return null;
        return candidate;
      }
      candidate = null;
    }
    throw new Error("Unable to reserve a friend code. Please try again.");
  }

  private startListeners(session: number): void {
    const uid = this.requireUser().uid;
    this.stopListeners = [
      this.adapter.database.onValue(".info/connected", (value) => {
        if (!this.isActiveSession(session)) return;
        this.connected = value === true;
        if (!this.connected) this.activePokes.forEach((controller) => controller.abort());
        this.snapshot = { ...this.snapshot, connectionState: this.connected ? "ready" : "connecting" };
        this.emit(session);
      }),
      this.adapter.database.onValue(`profiles/${uid}`, (value) => {
        if (!this.isActiveSession(session)) return;
        this.snapshot = { ...this.snapshot, self: profileFromValue(uid, value) };
        this.emit(session);
      }),
      this.adapter.database.onValue(`requests/${uid}`, (value) => {
        if (!this.isActiveSession(session)) return;
        void this.updateRequests(record(value), session, ++this.requestSequence);
      }),
      this.adapter.database.onValue(`friends/${uid}`, (value) => {
        if (!this.isActiveSession(session)) return;
        void this.updateFriends(record(value), session, ++this.friendSequence);
      }),
      this.adapter.database.onValue(`pokes/${uid}`, (value) => {
        if (!this.isActiveSession(session)) return;
        void this.handlePokeInbox(record(value), session, ++this.pokeSequence);
      }),
    ];
  }

  private async updateRequests(values: JsonRecord, session: number, sequence: number): Promise<void> {
    if (!this.isActiveSession(session) || sequence !== this.requestSequence) return;
    const requests = await Promise.all(Object.entries(values).map(async ([requesterUid, request]) => {
      const createdAt = numberValue(record(request).createdAt);
      const profile = profileFromValue(requesterUid, await this.adapter.database.get(`profiles/${requesterUid}`));
      return createdAt === null || !profile ? null : { requesterUid, displayName: profile.displayName, createdAt } satisfies FriendRequest;
    }));
    if (!this.isActiveSession(session) || sequence !== this.requestSequence) return;
    this.snapshot = { ...this.snapshot, pendingRequests: requests.filter((request): request is FriendRequest => request !== null) };
    this.emit(session);
  }

  private async updateFriends(values: JsonRecord, session: number, sequence: number): Promise<void> {
    if (!this.isActiveSession(session) || sequence !== this.friendSequence) return;
    const friends = await Promise.all(Object.entries(values).map(async ([friendUid, friend]) => {
      const acceptedAt = numberValue(record(friend).acceptedAt);
      const profile = profileFromValue(friendUid, await this.adapter.database.get(`profiles/${friendUid}`));
      return acceptedAt === null || !profile ? null : { uid: friendUid, displayName: profile.displayName, acceptedAt } satisfies FriendSummary;
    }));
    if (!this.isActiveSession(session) || sequence !== this.friendSequence) return;
    const resolvedFriends = friends.filter((friend): friend is FriendSummary => friend !== null);
    const acceptedUids = new Set(resolvedFriends.map((friend) => friend.uid));
    const trackedOutbound = this.local.outboundRequestRecipientUids ?? [];
    const remainingOutbound = trackedOutbound.filter((friendUid) => !acceptedUids.has(friendUid));
    if (remainingOutbound.length !== trackedOutbound.length) {
      const previousLocal = this.local;
      const nextLocal = { ...previousLocal, outboundRequestRecipientUids: remainingOutbound };
      try {
        await this.persistLocal(nextLocal, session);
        if (!this.isActiveSession(session) || sequence !== this.friendSequence) return;
        this.local = nextLocal;
      } catch {
        this.local = previousLocal;
      }
    }
    this.snapshot = { ...this.snapshot, friends: resolvedFriends };
    this.emit(session);
  }

  private async handlePokeInbox(values: JsonRecord, session: number, sequence: number): Promise<void> {
    if (!this.isActiveSession(session) || sequence !== this.pokeSequence) return;
    const uid = this.requireUser().uid;
    for (const [senderUid, rawPoke] of Object.entries(values)) {
      const poke = record(rawPoke);
      const eventId = typeof poke.eventId === "string" ? poke.eventId : null;
      const createdAt = numberValue(poke.createdAt);
      if (!eventId || createdAt === null) continue;
      if (isPokeExpired(createdAt, this.now())) {
        void this.adapter.database.remove(`pokes/${uid}/${senderUid}`).catch(() => undefined);
        continue;
      }
      if (this.local.handledPokeEventIds?.[eventId] || !this.isActiveSession(session) || sequence !== this.pokeSequence) continue;
      this.local = {
        ...this.local,
        handledPokeEventIds: { ...this.local.handledPokeEventIds, [eventId]: this.now() },
      };
      await this.persistLocal(this.local, session);
      if (!this.isActiveSession(session) || sequence !== this.pokeSequence) return;
      this.snapshot = { ...this.snapshot, incomingPoke: { senderUid, eventId, createdAt } satisfies IncomingPoke };
      this.emit(session);
    }
  }

  private persistLocal(state: FriendLocalState, session?: number): Promise<void> {
    const write = this.localWriteQueue.then(async () => {
      if (session !== undefined && !this.isActiveSession(session)) return;
      await writeAppValue("friends", state, this.storage);
    });
    this.localWriteQueue = write.catch(() => undefined);
    return write;
  }

  private async bestEffortRecord(path: string): Promise<JsonRecord> {
    try {
      return record(await this.adapter.database.get(path));
    } catch {
      return {};
    }
  }

  private requireUser(): FirebaseFriendUser {
    if (!this.user) throw new Error("Firebase friend identity has not started.");
    return this.user;
  }

  private emit(session?: number): void {
    if (session !== undefined && !this.isActiveSession(session)) return;
    this.handlers?.onSnapshot(this.snapshot);
  }

  private stop(): void {
    this.sessionGeneration += 1;
    this.stopListeners.splice(0).forEach((unsubscribe) => unsubscribe());
    this.activePokes.forEach((controller) => controller.abort());
    this.activePokes.clear();
    this.connected = false;
    this.user = null;
    this.handlers = null;
  }

  private isActiveSession(session: number): boolean { return session === this.sessionGeneration && this.handlers !== null; }
}
