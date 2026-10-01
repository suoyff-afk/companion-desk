import type { HpcJob } from "./hpcQueryBridge";
export interface HpcProject { id: string; name: string; hostAlias: string; jobIds: string[] }
export const MAX_PROJECT_JOB_IDS = 512;
export type JobFilter = "all" | "queued" | "running" | "abnormal" | "ended";
export function hasCompressedArrays(queue: HpcJob[] | null, history: HpcJob[] | null): boolean {
  return [...(queue ?? []), ...(history ?? [])].some(job => /^\d+_\[.*\]$/.test(job.jobId));
}
export function mergeJobs(queue: HpcJob[] | null, history: HpcJob[] | null, freshness: { queueStale: boolean; historyStale: boolean } = { queueStale: false, historyStale: false }): HpcJob[] {
  const rows = new Map<string, HpcJob>();
  const preferredSources = freshness.queueStale && !freshness.historyStale ? [history, queue] : [queue, history];
  for (const job of preferredSources.flatMap(source => source ?? [])) {
    if (!job.jobId.includes(".") && !rows.has(job.jobId)) rows.set(job.jobId, job);
  }
  const elements = new Set([...rows.keys()].filter(id => /^\d+_(?:\d+|\[.*\])$/.test(id)).map(id => id.split("_")[0]));
  return [...rows.values()].filter(job => {
    const root = job.jobId.split("_")[0];
    return !/^\d+_\[.*\]$/.test(job.jobId) && (!elements.has(root) || /^\d+_\d+$/.test(job.jobId));
  });
}
export function matchesProject(id: string, ids: string[]): boolean {
  return ids.some(registered => id === registered || (/^\d+$/.test(registered) && id.startsWith(`${registered}_`) && /^\d+_(?:\d+|\[[\d,:%-]+\])$/.test(id)));
}
type Outcome = "success" | "failed" | "cancelled" | "timeout" | "oom" | "unknown" | "active";
export function classifyJob(job: HpcJob): { group: JobFilter; outcome: Outcome; label: string } {
  const state = job.state.trim().toUpperCase().split(/[ +]/)[0];
  if (["PENDING", "PD", "CONFIGURING", "CF", "REQUEUED", "REQUEUE_FED", "REQUEUE_HOLD", "SPECIAL_EXIT", "SE"].includes(state)) return { group: "queued", outcome: "active", label: "排队" };
  if (["RUNNING", "R", "COMPLETING", "CG", "STAGE_OUT", "SIGNALING", "SUSPENDED", "S"].includes(state)) return { group: "running", outcome: "active", label: state === "SUSPENDED" || state === "S" ? "暂停" : "运行" };
  if (state === "COMPLETED") {
    if (job.exitCode === "0:0") return { group: "ended", outcome: "success", label: "成功" };
    if (job.exitCode === null || job.exitCode === "") return { group: "ended", outcome: "unknown", label: "结束待核实" };
    return { group: "abnormal", outcome: "failed", label: "失败" };
  }
  if (["CANCELLED", "CA"].includes(state)) return { group: "abnormal", outcome: "cancelled", label: "取消" };
  if (["TIMEOUT", "TO"].includes(state)) return { group: "abnormal", outcome: "timeout", label: "超时" };
  if (["OUT_OF_MEMORY", "OOM"].includes(state)) return { group: "abnormal", outcome: "oom", label: "内存不足" };
  if (["FAILED", "F", "NODE_FAIL", "NF", "BOOT_FAIL", "BF", "DEADLINE", "DL", "PREEMPTED", "PR", "REVOKED", "RV"].includes(state)) return { group: "abnormal", outcome: "failed", label: "失败" };
  return { group: "all", outcome: "unknown", label: "未知" };
}
export interface TaskSummary { total: number; queued: number; running: number; abnormal: number; ended: number; success: number; failed: number; cancelled: number; timeout: number; oom: number; unknown: number; denominator: number | null }
export function summarizeJobs(jobs: HpcJob[], ids?: string[]): TaskSummary {
  const registered = ids ? [...new Set(ids)] : undefined;
  const denominator = registered?.length && registered.every(id => /^\d+_\d+$/.test(id)) ? registered.length : null;
  const summary: TaskSummary = { total: denominator ?? jobs.length, queued: 0, running: 0, abnormal: 0, ended: 0, success: 0, failed: 0, cancelled: 0, timeout: 0, oom: 0, unknown: 0, denominator };
  for (const job of jobs) {
    const status = classifyJob(job);
    if (status.group !== "all" && status.group !== "ended") summary[status.group]++;
    if (status.group === "ended" || status.group === "abnormal") summary.ended++;
    if (status.outcome !== "active") summary[status.outcome]++;
  }
  if (registered) summary.unknown += registered.filter(id => !jobs.some(job => matchesProject(job.jobId, [id]))).length;
  return summary;
}
function normalizedProject(value: unknown): HpcProject | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || typeof item.hostAlias !== "string" || !item.hostAlias || !Array.isArray(item.jobIds)) return null;
  const jobIds = [...new Set<string>(item.jobIds.filter((id: unknown): id is string => typeof id === "string" && /^\d+(?:_\d+)?$/.test(id)))];
  return jobIds.length ? { id: item.id, name: item.name.trim(), hostAlias: item.hostAlias, jobIds } : null;
}
export function mergeProjectJobIds(existing: string[], selected: string[]): string[] | null {
  const merged = [...new Set([...existing, ...selected])];
  return merged.length <= MAX_PROJECT_JOB_IDS ? merged : null;
}
export function hasOversizedProjects(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => (normalizedProject(item)?.jobIds.length ?? 0) > MAX_PROJECT_JOB_IDS);
}
export function validateProjects(value: unknown): HpcProject[] {
  if (!Array.isArray(value)) return [];
  const projects: HpcProject[] = [];
  for (const item of value) {
    const project = normalizedProject(item);
    if (project && project.jobIds.length <= MAX_PROJECT_JOB_IDS && !projects.some(existing => existing.id === project.id)) projects.push(project);
  }
  return projects;
}
