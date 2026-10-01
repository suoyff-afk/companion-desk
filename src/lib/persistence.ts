export type AppStorageKey = "focus" | "games" | "hpc" | "hpc-projects" | "friends" | "windowLayouts" | "windowLayoutsV2" | "windowLayoutsV3" | "petSizeV1" | "petPreferencesV1";

export interface StorageAdapter {
  get(key: AppStorageKey): Promise<unknown>;
  set(key: AppStorageKey, value: unknown): Promise<void>;
}

export interface MemoryStorageAdapter extends StorageAdapter {
  entries(): Array<[AppStorageKey, unknown]>;
}

export function createMemoryAdapter(): MemoryStorageAdapter {
  const values = new Map<AppStorageKey, unknown>();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => { values.set(key, value); },
    entries: () => [...values.entries()],
  };
}

function browserAdapter(): StorageAdapter {
  const prefix = "kunkun-desk.";
  return {
    get: async (key) => {
      const raw = window.localStorage.getItem(`${prefix}${key}`);
      if (raw === null) return undefined;
      try { return JSON.parse(raw) as unknown; } catch { return undefined; }
    },
    set: async (key, value) => {
      window.localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
    },
  };
}

let desktopAdapterPromise: Promise<StorageAdapter> | null = null;

async function desktopAdapter(): Promise<StorageAdapter> {
  if (desktopAdapterPromise === null) {
    const pending = import("@tauri-apps/plugin-store").then(async ({ load }) => {
      const store = await load("kunkun-desk.json", { defaults: {}, autoSave: 100 });
      return {
        get: (key: AppStorageKey) => store.get(key),
        set: async (key: AppStorageKey, value: unknown) => { await store.set(key, value); await store.save(); },
      };
    });
    let cached: Promise<StorageAdapter>;
    cached = pending.catch((error) => {
      if (desktopAdapterPromise === cached) desktopAdapterPromise = null;
      throw error;
    });
    desktopAdapterPromise = cached;
  }
  return desktopAdapterPromise;
}

async function defaultAdapter(): Promise<StorageAdapter> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return desktopAdapter();
  return browserAdapter();
}

export async function readAppValue<T>(key: AppStorageKey, fallback: T, adapter?: StorageAdapter): Promise<T> {
  const storage = adapter ?? await defaultAdapter();
  const value = await storage.get(key);
  return value === undefined || value === null ? fallback : value as T;
}

export async function writeAppValue(key: AppStorageKey, value: unknown, adapter?: StorageAdapter): Promise<void> {
  const storage = adapter ?? await defaultAdapter();
  await storage.set(key, value);
}
