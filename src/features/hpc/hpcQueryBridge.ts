import { invoke } from "@tauri-apps/api/core";
export interface HpcJob { jobId: string; name: string; state: string; elapsed: string; reason: string; workDir: string; exitCode: string | null }
export interface HpcSnapshot { hostAlias: string; queriedAt: string; historyDays: number | null; queue: HpcJob[] | null; history: HpcJob[] | null; issues: Array<{ source: "queue" | "history"; message: string }> }
export interface HpcQueryBridge { query(hostAlias: string, jobIds?: string[]): Promise<HpcSnapshot> }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function validJob(value: unknown): value is HpcJob {
  return object(value) && ["jobId", "name", "state", "elapsed", "reason", "workDir"].every(key => typeof value[key] === "string")
    && typeof value.jobId === "string" && value.jobId.length > 0 && (value.exitCode === null || typeof value.exitCode === "string");
}
export function validateHpcSnapshot(value: unknown): HpcSnapshot {
  if (!object(value) || typeof value.hostAlias !== "string" || typeof value.queriedAt !== "string" || !Number.isFinite(Date.parse(value.queriedAt))
    || !(value.historyDays === null || (typeof value.historyDays === "number" && Number.isInteger(value.historyDays) && value.historyDays > 0))
    || ![value.queue, value.history].every(source => source === null || (Array.isArray(source) && source.every(validJob)))
    || !Array.isArray(value.issues) || !value.issues.every(issue => object(issue) && ["queue", "history"].includes(String(issue.source)) && typeof issue.message === "string" && issue.message.length > 0)) {
    throw new Error("任务查询返回了无效数据。");
  }
  const snapshot = value as unknown as HpcSnapshot;
  for (const source of ["queue", "history"] as const) {
    if ((snapshot[source] === null) !== snapshot.issues.some(issue => issue.source === source)) throw new Error("任务查询返回了无效数据来源状态。");
  }
  return snapshot;
}
export const desktopHpcQueryBridge: HpcQueryBridge = {
  async query(hostAlias, jobIds = []) {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) throw new Error("任务查询仅在桌面应用中可用。");
    const snapshot = validateHpcSnapshot(await invoke<unknown>("query_hpc_jobs", { hostAlias, jobIds }));
    if (snapshot.hostAlias !== hostAlias) throw new Error("任务查询返回的主机不匹配。");
    return snapshot;
  },
};
