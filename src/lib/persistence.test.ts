import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedWindowLayouts } from "../app/windowLayout";
import {
  createMemoryAdapter,
  readAppValue,
  writeAppValue,
} from "./persistence";

const tauriStore = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@tauri-apps/plugin-store", () => ({ load: tauriStore.load }));

afterEach(() => {
  tauriStore.load.mockReset();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("persistence", () => {
  it("round-trips approved local feature state", async () => {
    const adapter = createMemoryAdapter();
    const focus = { task: "Derive equation", durationMinutes: 50, completed: [] };

    await writeAppValue("focus", focus, adapter);

    expect(await readAppValue("focus", null, adapter)).toEqual(focus);
    expect(adapter.entries()).toEqual([["focus", focus]]);
  });

  it("round-trips saved per-view window sizes", async () => {
    const adapter = createMemoryAdapter();
    const windowLayouts: SavedWindowLayouts = {
      home: { width: 412, height: 566 },
      hpc: { width: 960, height: 720 },
    };

    await writeAppValue("windowLayouts", windowLayouts, adapter);

    expect(await readAppValue("windowLayouts", {}, adapter)).toEqual(windowLayouts);
    expect(adapter.entries()).toEqual([["windowLayouts", windowLayouts]]);
  });

  it("retries desktop storage after its first initialization failure", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const store = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
    };
    tauriStore.load
      .mockRejectedValueOnce(new Error("store unavailable"))
      .mockResolvedValueOnce(store);
    const persistence = await import("./persistence");

    await expect(persistence.readAppValue("focus", null)).rejects.toThrow("store unavailable");
    await persistence.writeAppValue("focus", { task: "Retry persistence" });

    expect(tauriStore.load).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenCalledWith("focus", { task: "Retry persistence" });
  });
});
