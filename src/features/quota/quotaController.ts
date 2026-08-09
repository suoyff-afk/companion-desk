import { mergeSnapshots } from "../../lib/snapshots";
import type { ProviderSnapshot } from "../../types";

const REFRESH_INTERVAL_MS = 900_000;
const CODEX_QUOTA_UNAVAILABLE = "Codex quota unavailable";

export type QuotaRefreshReason = "startup" | "manual" | "interval" | "tray" | "resume";

export interface QuotaState {
  snapshot: ProviderSnapshot | null;
  lastSuccessful: ProviderSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  updatedAt: string | null;
}

export interface QuotaController {
  getState(): Readonly<QuotaState>;
  subscribe(listener: (state: Readonly<QuotaState>) => void): () => void;
  refresh(reason: QuotaRefreshReason): Promise<Readonly<QuotaState>>;
  start(): void;
  stop(): void;
}

interface Scheduler {
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
}

interface QuotaControllerOptions {
  load(force: boolean): Promise<ProviderSnapshot[]>;
  scheduler?: Scheduler;
}

const defaultScheduler: Scheduler = {
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unable to refresh quota";
}

function unavailableFrom(snapshot: ProviderSnapshot, message: string): ProviderSnapshot {
  return {
    ...snapshot,
    shortWindow: null,
    weeklyWindow: null,
    resetCredits: null,
    updatedAt: snapshot.updatedAt,
    status: "unavailable",
    message,
  };
}

export function createQuotaController({ load, scheduler = defaultScheduler }: QuotaControllerOptions): QuotaController {
  let state: Readonly<QuotaState> = {
    snapshot: null,
    lastSuccessful: null,
    loading: false,
    refreshing: false,
    updatedAt: null,
  };
  let intervalHandle: unknown | null = null;
  let inFlight: Promise<Readonly<QuotaState>> | null = null;
  const listeners = new Set<(next: Readonly<QuotaState>) => void>();
  const notificationQueue: Readonly<QuotaState>[] = [];
  let notifying = false;

  const commit = (next: QuotaState) => {
    state = next;
  };

  const notify = (next: Readonly<QuotaState>) => {
    notificationQueue.push(next);
    if (notifying) return;

    notifying = true;
    try {
      while (notificationQueue.length > 0) {
        const current = notificationQueue.shift();
        if (!current) continue;
        [...listeners].forEach((listener) => {
          if (!listeners.has(listener)) return;
          try {
            listener(current);
          } catch {
            // Observers must not interrupt quota state transitions.
          }
        });
      }
    } finally {
      notifying = false;
    }
  };

  const failureState = (error: unknown): QuotaState => {
    const previous = state.lastSuccessful;
    const snapshot = previous
      ? mergeSnapshots([previous], [unavailableFrom(previous, errorMessage(error))])[0]
      : null;
    return {
      snapshot,
      lastSuccessful: previous,
      loading: false,
      refreshing: false,
      updatedAt: state.updatedAt,
    };
  };

  const snapshotState = (incoming: ProviderSnapshot[]): QuotaState => {
    if (!incoming.some((item) => item.provider === "codex")) {
      return failureState(CODEX_QUOTA_UNAVAILABLE);
    }
    const merged = mergeSnapshots(state.lastSuccessful ? [state.lastSuccessful] : [], incoming);
    const snapshot = merged.find((item) => item.provider === "codex") ?? null;
    const lastSuccessful = snapshot?.status === "ok"
      ? snapshot
      : snapshot?.status === "signed_out"
        ? null
        : state.lastSuccessful;
    const completedSuccessfully = snapshot?.status === "ok" || snapshot?.status === "signed_out";

    return {
      snapshot,
      lastSuccessful,
      loading: false,
      refreshing: false,
      updatedAt: completedSuccessfully ? (snapshot?.updatedAt ?? state.updatedAt) : state.updatedAt,
    };
  };

  const refresh = (reason: QuotaRefreshReason): Promise<Readonly<QuotaState>> => {
    if (inFlight) return inFlight;

    let resolveTask!: (next: Readonly<QuotaState>) => void;
    const task = new Promise<Readonly<QuotaState>>((resolve) => {
      resolveTask = resolve;
    });
    inFlight = task;

    commit({
      ...state,
      loading: state.snapshot === null,
      refreshing: state.snapshot !== null,
    });
    notify(state);

    let request: Promise<ProviderSnapshot[]>;
    try {
      request = Promise.resolve(load(reason !== "startup"));
    } catch (error) {
      request = Promise.reject(error);
    }

    const complete = (next: QuotaState) => {
      commit(next);
      if (inFlight === task) inFlight = null;
      resolveTask(next);
      notify(next);
    };

    void request.then(
      (incoming) => {
        complete(snapshotState(incoming));
      },
      (error: unknown) => {
        complete(failureState(error));
      },
    );
    return task;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    start: () => {
      if (intervalHandle !== null) return;
      intervalHandle = scheduler.setInterval(() => {
        void refresh("interval");
      }, REFRESH_INTERVAL_MS);
      void refresh("startup");
    },
    stop: () => {
      if (intervalHandle === null) return;
      scheduler.clearInterval(intervalHandle);
      intervalHandle = null;
    },
  };
}
