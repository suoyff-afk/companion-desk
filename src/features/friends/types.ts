export type FriendConnectionState = "connecting" | "ready" | "unavailable";

export interface FriendProfile {
  uid: string;
  displayName: string;
  createdAt: number;
}

export interface FriendSummary {
  uid: string;
  displayName: string;
  acceptedAt: number;
}

export interface FriendRequest {
  requesterUid: string;
  displayName: string;
  createdAt: number;
}

export interface IncomingPoke {
  senderUid: string;
  eventId: string;
  createdAt: number;
}

export interface FriendSnapshot {
  connectionState: FriendConnectionState;
  self: FriendProfile | null;
  ownFriendCode: string | null;
  friends: FriendSummary[];
  pendingRequests: FriendRequest[];
  cooldownsByFriendUid: Record<string, number>;
  incomingPoke: IncomingPoke | null;
}
