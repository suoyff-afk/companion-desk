import { describe, expect, it } from "vitest";
import { classifyJob, hasCompressedArrays, hasOversizedProjects, matchesProject, mergeJobs, mergeProjectJobIds, summarizeJobs, validateProjects } from "./hpcTaskModel";
import type { HpcJob } from "./hpcQueryBridge";

const job = (jobId: string, state = "RUNNING", exitCode: string | null = null): HpcJob => ({ jobId, name: "test", state, elapsed: "01:00", reason: "", workDir: "", exitCode });

describe("task identity and status", () => {
  it("deduplicates queue/history with queue precedence, omits steps and parent aggregates", () => {
    expect(mergeJobs([job("123_1"), job("123"), job("123_[2-8]")], [job("123_1", "COMPLETED", "0:0"), job("123_2"), job("123_1.batch"), job("123_1.extern"), job("123_1.0")]).map(j => [j.jobId, j.state])).toEqual([["123_1", "RUNNING"], ["123_2", "RUNNING"]]);
  });
  it("prefers fresh history over stale queue while retaining queue precedence for equal freshness", () => {
    const queue = [job("123_1", "RUNNING")];
    const history = [job("123_1", "COMPLETED", "0:0")];
    expect(mergeJobs(queue, history, { queueStale: true, historyStale: false })).toEqual(history);
    expect(mergeJobs(queue, history, { queueStale: false, historyStale: true })).toEqual(queue);
    expect(mergeJobs(queue, history, { queueStale: true, historyStale: true })).toEqual(queue);
    expect(mergeJobs(queue, history, { queueStale: false, historyStale: false })).toEqual(queue);
  });
  it("matches numeric roots and exact elements without matching a prefix neighbor", () => {
    expect(matchesProject("123_2", ["123"])).toBe(true);
    expect(matchesProject("1234_2", ["123"])).toBe(false);
    expect(matchesProject("123_20", ["123_2"])).toBe(false);
    expect(matchesProject("123_2", ["123_2"])).toBe(true);
  });
  it("does not treat short COMPLETED aliases as verified success", () => {
    expect(classifyJob(job("1", "CD", "0:0"))).toMatchObject({ outcome: "unknown", label: "未知" });
  });
  it.each(["SPECIAL_EXIT", "SE"])("keeps requeued %s jobs nonterminal", state => {
    const requeued = job("1", state, "1:0");
    expect(classifyJob(requeued)).toMatchObject({ group: "queued", outcome: "active", label: "排队" });
    expect(summarizeJobs([requeued])).toMatchObject({ queued: 1, ended: 0, abnormal: 0, failed: 0 });
  });
  it("omits unsupported compressed arrays and their root aggregates without inventing element counts", () => {
    const queue = [job("123"), job("123_[2-8]"), job("1234")];
    expect(mergeJobs(queue, [])).toEqual([job("1234")]);
    expect(hasCompressedArrays(queue, [])).toBe(true);
    expect(hasCompressedArrays([job("123_2")], [])).toBe(false);
  });
  it("counts success only for COMPLETED plus a zero exit and distinguishes abnormal outcomes", () => {
    expect(classifyJob(job("1", "COMPLETED", "0:0"))).toMatchObject({ group: "ended", outcome: "success", label: "成功" });
    expect(classifyJob(job("2", "COMPLETED", "1:0"))).toMatchObject({ group: "abnormal", outcome: "failed" });
    expect(classifyJob(job("3", "COMPLETED", null))).toMatchObject({ group: "ended", outcome: "unknown", label: "结束待核实" });
    expect(classifyJob(job("4", "CANCELLED by 100"))).toMatchObject({ group: "abnormal", outcome: "cancelled", label: "取消" });
    expect(classifyJob(job("5", "TIMEOUT"))).toMatchObject({ group: "abnormal", outcome: "timeout", label: "超时" });
    expect(classifyJob(job("6", "OUT_OF_MEMORY"))).toMatchObject({ group: "abnormal", outcome: "oom", label: "内存不足" });
  });
  it("reports missing explicitly registered element IDs as unknown with a known denominator", () => {
    expect(summarizeJobs([job("123_1", "COMPLETED", "0:0")], ["123_1", "123_2"])).toMatchObject({ total: 2, success: 1, unknown: 1, ended: 1, denominator: 2 });
  });
  it("does not invent a total or completion percentage for registered roots", () => {
    expect(summarizeJobs([job("123_1", "COMPLETED", "0:0"), job("123_2")], ["123"])).toMatchObject({ total: 2, denominator: null, success: 1, running: 1 });
  });
  it("validates saved batches and rejects malformed identities", () => {
    expect(validateProjects([{ id: "a", name: "组", hostAlias: "cluster", jobIds: ["123", "123_1", "123", "bad;id"] }, { id: "b", name: "", hostAlias: "cluster", jobIds: ["2"] }])).toEqual([{ id: "a", name: "组", hostAlias: "cluster", jobIds: ["123", "123_1"] }]);
    expect(validateProjects(null)).toEqual([]);
  });
  it("accepts at most 512 unique IDs without truncating an oversized saved batch", () => {
    const valid = { id: "p", name: "批次", hostAlias: "cluster", jobIds: Array.from({ length: 512 }, (_, i) => `123_${i}`) };
    const oversized = { ...valid, jobIds: [...valid.jobIds, "123_512"] };
    expect(validateProjects([valid])).toEqual([valid]);
    expect(validateProjects([oversized])).toEqual([]);
    expect(hasOversizedProjects([oversized])).toBe(true);
    expect(oversized.jobIds).toHaveLength(513);
  });
  it("checks the unique merged size when appending selections", () => {
    const ids = Array.from({ length: 512 }, (_, i) => `123_${i}`);
    expect(mergeProjectJobIds(ids, ["123_0"])).toEqual(ids);
    expect(mergeProjectJobIds(ids, ["123_512"])).toBeNull();
    expect(ids).toHaveLength(512);
  });
});
