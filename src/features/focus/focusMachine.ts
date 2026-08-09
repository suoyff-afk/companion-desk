export type FocusStatus = "idle" | "running" | "paused" | "completed" | "ended";

export interface FocusState {
  durationMs: number;
  remainingMs: number;
  status: FocusStatus;
  lastStartedAt: number | null;
}

export function createFocusState(durationMs: number): FocusState {
  const safeDuration = Math.max(1_000, Math.round(durationMs));
  return {
    durationMs: safeDuration,
    remainingMs: safeDuration,
    status: "idle",
    lastStartedAt: null,
  };
}

export function start(state: FocusState, now: number): FocusState {
  return { ...state, status: "running", lastStartedAt: now };
}

export function completeOrTick(state: FocusState, now: number): FocusState {
  if (state.status !== "running" || state.lastStartedAt === null) return state;
  const elapsed = Math.max(0, now - state.lastStartedAt);
  const remainingMs = Math.max(0, state.remainingMs - elapsed);
  return remainingMs === 0
    ? { ...state, remainingMs: 0, status: "completed", lastStartedAt: null }
    : { ...state, remainingMs, lastStartedAt: now };
}

export function pause(state: FocusState, now: number): FocusState {
  const current = completeOrTick(state, now);
  return current.status === "completed"
    ? current
    : { ...current, status: "paused", lastStartedAt: null };
}

export function resume(state: FocusState, now: number): FocusState {
  return state.status === "paused" ? start(state, now) : state;
}

export function end(state: FocusState, now: number): FocusState {
  const current = completeOrTick(state, now);
  return current.status === "completed"
    ? current
    : { ...current, status: "ended", lastStartedAt: null };
}
