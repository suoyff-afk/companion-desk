import { useCallback, useEffect, useRef, useState } from "react";

import type { FriendPort } from "./FriendPort";
import { normalizeFriendCode } from "./friendLogic";
import type { FriendSnapshot } from "./types";

export type FriendAction =
  | "requestByCode"
  | "acceptRequest"
  | "ignoreRequest"
  | "poke"
  | "removeFriend"
  | "resetIdentity";

export interface FriendsViewModel {
  snapshot: FriendSnapshot;
  busy: FriendAction | null;
  error: string | null;
  actionErrors: Partial<Record<FriendAction, string>>;
  latestErrorAction: FriendAction | null;
  requestByCode(code: string): Promise<boolean>;
  acceptRequest(requesterUid: string): Promise<boolean>;
  ignoreRequest(requesterUid: string): Promise<boolean>;
  poke(friendUid: string): Promise<boolean>;
  removeFriend(friendUid: string): Promise<boolean>;
  resetIdentity(): Promise<boolean>;
}

export const UNAVAILABLE_FRIEND_SNAPSHOT: FriendSnapshot = {
  connectionState: "unavailable",
  self: null,
  ownFriendCode: null,
  friends: [],
  pendingRequests: [],
  cooldownsByFriendUid: {},
  incomingPoke: null,
};

const CONNECTING_FRIEND_SNAPSHOT: FriendSnapshot = {
  ...UNAVAILABLE_FRIEND_SNAPSHOT,
  connectionState: "connecting",
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "好友操作失败，请稍后重试";
}

export function useFriends(port: FriendPort): FriendsViewModel {
  const [snapshot, setSnapshot] = useState<FriendSnapshot>(CONNECTING_FRIEND_SNAPSHOT);
  const [busy, setBusy] = useState<FriendAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Partial<Record<FriendAction, string>>>({});
  const [latestErrorAction, setLatestErrorAction] = useState<FriendAction | null>(null);
  const activeRef = useRef(true);
  const actionQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const listenerGenerationRef = useRef(0);
  const stopListenerRef = useRef<(() => void) | null>(null);

  const startListener = useCallback(async () => {
    const generation = ++listenerGenerationRef.current;
    stopListenerRef.current?.();
    stopListenerRef.current = null;
    if (activeRef.current) {
      setSnapshot(CONNECTING_FRIEND_SNAPSHOT);
      setError(null);
    }
    try {
      const stop = await port.start({
      onSnapshot(nextSnapshot) {
        if (activeRef.current && generation === listenerGenerationRef.current) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      },
      onError(nextError) {
        if (activeRef.current && generation === listenerGenerationRef.current) {
          setSnapshot((current) => ({ ...current, connectionState: "unavailable" }));
          setError(errorMessage(nextError));
        }
      },
      });
      if (!activeRef.current || generation !== listenerGenerationRef.current) stop();
      else stopListenerRef.current = stop;
    } catch (startError) {
      if (activeRef.current && generation === listenerGenerationRef.current) {
        setSnapshot(UNAVAILABLE_FRIEND_SNAPSHOT);
        setError(errorMessage(startError));
      }
      throw startError;
    }
  }, [port]);

  useEffect(() => {
    activeRef.current = true;
    void startListener().catch(() => undefined);
    return () => {
      activeRef.current = false;
      listenerGenerationRef.current += 1;
      stopListenerRef.current?.();
      stopListenerRef.current = null;
    };
  }, [startListener]);

  const run = useCallback(<T,>(
    action: FriendAction,
    operation: () => Promise<T>,
  ): Promise<boolean> => {
    const result = actionQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (activeRef.current) {
          setBusy(action);
          setActionErrors((current) => {
            if (!(action in current)) return current;
            const next = { ...current };
            delete next[action];
            return next;
          });
          setLatestErrorAction((current) => current === action ? null : current);
        }
        try {
          await operation();
          return true;
        } catch (actionError) {
          if (activeRef.current) {
            setActionErrors((current) => ({ ...current, [action]: errorMessage(actionError) }));
            setLatestErrorAction(action);
          }
          return false;
        } finally {
          if (activeRef.current) setBusy(null);
        }
      });
    actionQueueRef.current = result;
    return result;
  }, []);

  const requestByCode = useCallback((rawCode: string) => {
    const code = normalizeFriendCode(rawCode);
    if (code === null) {
      setError("请输入 8 位好友 ID");
      setActionErrors((current) => ({ ...current, requestByCode: "请输入 8 位好友 ID" }));
      setLatestErrorAction("requestByCode");
      return Promise.resolve(false);
    }
    return run("requestByCode", () => port.requestByCode(code));
  }, [port, run]);

  return {
    snapshot,
    busy,
    error,
    actionErrors,
    latestErrorAction,
    requestByCode,
    acceptRequest: useCallback(
      (requesterUid: string) => run("acceptRequest", () => port.acceptRequest(requesterUid)),
      [port, run],
    ),
    ignoreRequest: useCallback(
      (requesterUid: string) => run("ignoreRequest", () => port.ignoreRequest(requesterUid)),
      [port, run],
    ),
    poke: useCallback(
      (friendUid: string) => run("poke", () => port.poke(friendUid)),
      [port, run],
    ),
    removeFriend: useCallback(
      (friendUid: string) => run("removeFriend", () => port.removeFriend(friendUid)),
      [port, run],
    ),
    resetIdentity: useCallback(
      () => run("resetIdentity", async () => {
        let resetError: unknown = null;
        let restartError: unknown = null;
        try {
          await port.resetIdentity();
        } catch (nextResetError) {
          resetError = nextResetError;
        }
        try {
          await startListener();
        } catch (nextRestartError) {
          restartError = nextRestartError;
        }
        if (resetError !== null && restartError !== null) {
          throw new Error(`${errorMessage(resetError)}；恢复连接失败：${errorMessage(restartError)}`);
        }
        if (restartError !== null) throw restartError;
        if (resetError !== null) throw resetError;
      }),
      [port, run, startListener],
    ),
  };
}
