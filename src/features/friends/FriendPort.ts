import type { FriendSnapshot } from "./types";

export interface FriendPortHandlers {
  onSnapshot(snapshot: FriendSnapshot): void;
  onError?(error: Error): void;
}

export interface FriendPort {
  start(handlers: FriendPortHandlers): Promise<() => void>;
  requestByCode(code: string): Promise<void>;
  acceptRequest(requesterUid: string): Promise<void>;
  ignoreRequest(requesterUid: string): Promise<void>;
  poke(friendUid: string): Promise<void>;
  removeFriend(friendUid: string): Promise<void>;
  resetIdentity(): Promise<void>;
}
