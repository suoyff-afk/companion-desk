import type { IncomingPoke } from "./types";

export const FRIEND_DISPLAY_LIMIT = 20;
export const POKE_COOLDOWN_MS = 30_000;
export const POKE_EXPIRY_MS = 86_400_000;

export function normalizeFriendCode(value: string): string | null {
  const normalized = value.trim().replaceAll(" ", "");
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

export function canSendPoke(now: number, previousSentAt: number | null): boolean {
  return previousSentAt === null || now - previousSentAt >= POKE_COOLDOWN_MS;
}

export function isPokeExpired(createdAt: number, now: number): boolean {
  return now - createdAt > POKE_EXPIRY_MS;
}

export function shouldHandlePoke(
  poke: Pick<IncomingPoke, "eventId" | "createdAt">,
  lastHandledEventId: string | null,
  now: number,
): boolean {
  return poke.eventId !== lastHandledEventId && !isPokeExpired(poke.createdAt, now);
}
