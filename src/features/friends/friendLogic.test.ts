import { describe, expect, it } from "vitest";

import {
  FRIEND_DISPLAY_LIMIT,
  POKE_COOLDOWN_MS,
  isPokeExpired,
  normalizeFriendCode,
  shouldHandlePoke,
  canSendPoke,
} from "./friendLogic";
import type { FriendSnapshot } from "./types";

const now = 1_750_000_000_000;

describe("friend logic", () => {
  it("keeps the locally authoritative own friend code outside the remote profile", () => {
    const snapshot: FriendSnapshot = {
      connectionState: "ready",
      self: null,
      ownFriendCode: "48271936",
      friends: [],
      pendingRequests: [],
      cooldownsByFriendUid: {},
      incomingPoke: null,
    };

    expect(snapshot.ownFriendCode).toBe("48271936");
  });

  it("normalizes only eight digits with surrounding whitespace and spaces", () => {
    expect(normalizeFriendCode(" 4827 1936 ")).toBe("48271936");
    expect(normalizeFriendCode("4827-1936")).toBeNull();
    expect(normalizeFriendCode("4827193")).toBeNull();
  });

  it("enforces a thirty-second per-friend poke cooldown", () => {
    expect(canSendPoke(now, now - POKE_COOLDOWN_MS)).toBe(true);
    expect(canSendPoke(now, now - POKE_COOLDOWN_MS + 1)).toBe(false);
    expect(canSendPoke(now, null)).toBe(true);
  });

  it("expires pokes strictly after twenty-four hours", () => {
    expect(isPokeExpired(now - 86_400_000, now)).toBe(false);
    expect(isPokeExpired(now - 86_400_001, now)).toBe(true);
  });

  it("limits only the rendered friend list to twenty entries", () => {
    expect(FRIEND_DISPLAY_LIMIT).toBe(20);
  });

  it("handles only fresh, unexpired poke events", () => {
    expect(shouldHandlePoke({ eventId: "e2", createdAt: now }, "e1", now)).toBe(true);
    expect(shouldHandlePoke({ eventId: "e1", createdAt: now }, "e1", now)).toBe(false);
    expect(shouldHandlePoke({ eventId: "expired", createdAt: now - 86_400_001 }, null, now)).toBe(false);
  });
});
