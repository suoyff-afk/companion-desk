// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { desktopHpcQueryBridge, validateHpcSnapshot } from "./hpcQueryBridge";

const snapshot = () => ({ hostAlias: "cluster", queriedAt: "2026-09-30T10:00:00Z", historyDays: 7, queue: [], history: [], issues: [] });
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });
describe("HPC query bridge", () => {
  it("rejects browser calls without claiming live data", async () => {
    await expect(desktopHpcQueryBridge.query("cluster")).rejects.toThrow(/桌面/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses the shared command with host and explicit IDs", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue(snapshot());
    await desktopHpcQueryBridge.query("cluster");
    expect(invoke).toHaveBeenCalledWith("query_hpc_jobs", { hostAlias: "cluster", jobIds: [] });
    await desktopHpcQueryBridge.query("cluster", ["123_1"]);
    expect(invoke).toHaveBeenLastCalledWith("query_hpc_jobs", { hostAlias: "cluster", jobIds: ["123_1"] });
  });
  it("preserves null source failure separately from genuine empty results", () => {
    const result = { ...snapshot(), queue: null, issues: [{ source: "queue", message: "authentication failed" }] };
    expect(validateHpcSnapshot(result)).toEqual(result);
    expect(validateHpcSnapshot(snapshot()).queue).toEqual([]);
  });
  it("rejects malformed rows, missing failure evidence and invalid timestamps", () => {
    expect(() => validateHpcSnapshot({ ...snapshot(), queue: [{ jobId: "1" }] })).toThrow(/无效/);
    expect(() => validateHpcSnapshot({ ...snapshot(), queue: null })).toThrow(/无效/);
    expect(() => validateHpcSnapshot({ ...snapshot(), queriedAt: "yesterday" })).toThrow(/无效/);
  });
  it("rejects a response for the wrong host", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({ ...snapshot(), hostAlias: "elsewhere" });
    await expect(desktopHpcQueryBridge.query("cluster")).rejects.toThrow(/主机/);
  });
});
