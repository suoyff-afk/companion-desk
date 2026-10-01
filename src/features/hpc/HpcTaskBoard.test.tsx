// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HpcTaskBoard } from "./HpcTaskBoard";
import type { HpcJob, HpcSnapshot } from "./hpcQueryBridge";

const job = (jobId: string, state = "RUNNING", name = `job-${jobId}`): HpcJob => ({ jobId, name, state, elapsed: "01:00", reason: "", workDir: "", exitCode: state === "COMPLETED" ? "0:0" : null });
const snapshot = (queue: HpcJob[] | null = [], history: HpcJob[] | null = [], rest: Partial<HpcSnapshot> = {}): HpcSnapshot => ({ hostAlias: "cluster", queriedAt: "2026-09-30T10:00:00Z", historyDays: 7, queue, history, issues: [], ...rest });
function deferred<T>() { let resolve!: (result: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const refresh = () => fireEvent.click(screen.getByRole("button", { name: "刷新" }));
const seedProjects = (projects: unknown) => window.localStorage.setItem("kunkun-desk.hpc-projects", JSON.stringify(projects));
const openManagement = () => {
  const details = screen.getByText("管理项目").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
};

describe("HPC task board", () => {
  it("shows one compact manual board with no network before refresh", async () => {
    const query = vi.fn(async () => snapshot());
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    expect(screen.getByRole("heading", { name: "任务看板" })).toBeInTheDocument();
    expect(screen.getByText("点击刷新读取当前任务")).toBeInTheDocument();
    expect(screen.getByText("当前队列＋近7天历史")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("管理项目").closest("details")).not.toHaveAttribute("open");
    expect(query).not.toHaveBeenCalled();
    refresh();
    expect(await screen.findByText("当前没有任务")).toBeInTheDocument();
    expect(query).toHaveBeenCalledWith("cluster", []);
  });
  it("disables refresh for invalid hosts and while a query runs", async () => {
    const pending = deferred<HpcSnapshot>();
    const query = vi.fn(() => pending.promise);
    const view = render(<HpcTaskBoard hostAlias="bad;host" hostValid={false} bridge={{ query }} />);
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    view.rerender(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh();
    expect(screen.getByRole("button", { name: "读取中…" })).toBeDisabled();
    await act(async () => pending.resolve(snapshot()));
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
  });
  it("retains the previous successful failed source with its actual stale timestamp", async () => {
    const query = vi.fn().mockResolvedValueOnce(snapshot([job("101")], [job("102", "COMPLETED")]))
      .mockResolvedValueOnce(snapshot(null, [job("103", "COMPLETED")], { queriedAt: "2026-09-30T10:05:00Z", issues: [{ source: "queue", message: "认证失败" }] }));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-101"); refresh();
    expect(await screen.findByText(/队列读取失败：认证失败/)).toBeInTheDocument();
    expect(screen.getByText("job-101")).toBeInTheDocument();
    expect(screen.getByText("job-103")).toBeInTheDocument();
    expect(screen.queryByText("job-102")).not.toBeInTheDocument();
    expect(screen.getByText(/队列：上次数据/)).toHaveTextContent("2026-09-30T10:00:00Z");
    expect(screen.getByText(/历史：已更新/)).toHaveTextContent("2026-09-30T10:05:00Z");
    expect(screen.getByText("统计不完整")).toBeInTheDocument();
  });
  it("shows fresh completed history over stale running queue and marks the chosen row fresh", async () => {
    const query = vi.fn().mockResolvedValueOnce(snapshot([job("101", "RUNNING")]))
      .mockResolvedValueOnce(snapshot(null, [job("101", "COMPLETED")], { queriedAt: "2026-09-30T10:05:00Z", issues: [{ source: "queue", message: "队列不可用" }] }));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("RUNNING"); refresh();
    const row = (await screen.findByText("COMPLETED")).closest("tr")!;
    expect(within(row).getByText("成功")).toBeInTheDocument();
    expect(within(row).queryByText("上次数据")).not.toBeInTheDocument();
    expect(screen.queryByText("RUNNING")).not.toBeInTheDocument();
    expect(screen.getByText(/队列：上次数据/)).toHaveTextContent("2026-09-30T10:00:00Z");
  });
  it("keeps fresh running queue visible over stale completed history", async () => {
    const query = vi.fn().mockResolvedValueOnce(snapshot([], [job("101", "COMPLETED")]))
      .mockResolvedValueOnce(snapshot([job("101", "RUNNING")], null, { queriedAt: "2026-09-30T10:05:00Z", issues: [{ source: "history", message: "历史不可用" }] }));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("COMPLETED"); refresh();
    const row = (await screen.findByText("RUNNING")).closest("tr")!;
    expect(within(row).queryByText("上次数据")).not.toBeInTheDocument();
    expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
    expect(screen.getByText(/历史：上次数据/)).toHaveTextContent("2026-09-30T10:00:00Z");
  });
  it("treats genuine empty arrays as empty and clears previous rows", async () => {
    const query = vi.fn().mockResolvedValueOnce(snapshot([job("101")])).mockResolvedValueOnce(snapshot());
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-101"); refresh();
    expect(await screen.findByText("当前没有任务")).toBeInTheDocument();
    expect(screen.queryByText("job-101")).not.toBeInTheDocument();
  });
  it("reports source failures without inventing zero or an empty success", async () => {
    const query = vi.fn(async () => snapshot(null, null, { issues: [{ source: "queue", message: "认证失败" }, { source: "history", message: "无权限" }] }));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh();
    expect(await screen.findByText("暂无可用任务数据")).toBeInTheDocument();
    expect(screen.queryByText("当前没有任务")).not.toBeInTheDocument();
    expect(screen.getByText("统计不完整")).toBeInTheDocument();
  });
  it("allows manual retry after query failure and marks retained rows stale", async () => {
    const query = vi.fn().mockResolvedValueOnce(snapshot([job("101")])).mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce(snapshot([job("102")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-101"); refresh();
    expect(await screen.findByText(/读取失败：Permission denied/)).toBeInTheDocument();
    expect(screen.getByText("job-101")).toBeInTheDocument();
    expect(screen.getByText(/队列：上次数据/)).toBeInTheDocument();
    refresh(); await screen.findByText("job-102");
    expect(screen.queryByText(/Permission denied/)).not.toBeInTheDocument();
  });
  it("clears a changed host and ignores a response from the old request", async () => {
    const old = deferred<HpcSnapshot>();
    const query = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot([job("202")], [], { hostAlias: "other" }));
    const view = render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh();
    view.rerender(<HpcTaskBoard hostAlias="other" hostValid bridge={{ query }} />);
    expect(screen.getByText("点击刷新读取当前任务")).toBeInTheDocument();
    refresh(); await screen.findByText("job-202");
    await act(async () => old.resolve(snapshot([job("101")])));
    expect(screen.queryByText("job-101")).not.toBeInTheDocument();
    expect(screen.getByText("job-202")).toBeInTheDocument();
  });
  it("scopes saved projects to the host, clears switched rows, and filters exact registered IDs", async () => {
    seedProjects([{ id: "p", name: "项目甲", hostAlias: "cluster", jobIds: ["123_1", "123_2"] }, { id: "q", name: "别的主机", hostAlias: "other", jobIds: ["1"] }]);
    const query = vi.fn(async () => snapshot([job("123_1"), job("1234_1"), job("123_20")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    await screen.findByRole("option", { name: "项目甲" });
    expect(screen.queryByRole("option", { name: "别的主机" })).not.toBeInTheDocument();
    refresh(); await screen.findByText("job-1234_1");
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "p" } });
    expect(screen.queryByText("job-1234_1")).not.toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(1);
    refresh(); await screen.findByText("job-123_1");
    expect(query).toHaveBeenLastCalledWith("cluster", ["123_1", "123_2"]);
    expect(screen.queryByText("job-123_20")).not.toBeInTheDocument();
    expect(screen.getByText("未知 1")).toBeInTheDocument();
    expect(screen.getByText("总任务 2")).toBeInTheDocument();
  });
  it("selects jobs and saves a named batch, surviving a storage failure in memory", async () => {
    const query = vi.fn(async () => snapshot([job("123_1"), job("123_2")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-123_1");
    openManagement();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择任务 123_1" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "选中批次" } });
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
    fireEvent.click(screen.getByRole("button", { name: "保存所选任务" }));
    expect(await screen.findByRole("option", { name: "选中批次" })).toBeInTheDocument();
    expect(await screen.findByText(/项目未能保存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
  });
  it("persists selected task IDs without paths", async () => {
    const query = vi.fn(async () => snapshot([job("123_1")]));
    const view = render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-123_1");
    openManagement();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择任务 123_1" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "批次" } });
    fireEvent.click(screen.getByRole("button", { name: "保存所选任务" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("kunkun-desk.hpc-projects")!)).toEqual([expect.objectContaining({ name: "批次", hostAlias: "cluster", jobIds: ["123_1"] })]));
    view.unmount();
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    expect(await screen.findByRole("option", { name: "批次" })).toBeInTheDocument();
  });
  it("filters state locally while preserving complete summary counts", async () => {
    const query = vi.fn(async () => snapshot([job("1", "RUNNING"), job("2", "PENDING")], [job("3", "COMPLETED"), job("4", "CANCELLED")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-1");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    expect(screen.queryByText("job-2")).not.toBeInTheDocument();
    expect(screen.getByText("已结束 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "已结束" }));
    expect(screen.getByText("job-3")).toBeInTheDocument();
    expect(screen.getByText("job-4")).toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("keeps same-named projects on separate hosts and requires manual refresh after switching", async () => {
    seedProjects([{ id: "p", name: "同名项目", hostAlias: "cluster", jobIds: ["123_1"] }, { id: "q", name: "同名项目", hostAlias: "other", jobIds: ["456_1"] }]);
    const query = vi.fn(async (hostAlias: string) => snapshot([job(hostAlias === "cluster" ? "123_1" : "456_1")], [], { hostAlias, historyDays: null }));
    const view = render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    await screen.findByRole("option", { name: "同名项目" });
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "p" } });
    refresh(); await screen.findByText("job-123_1");
    view.rerender(<HpcTaskBoard hostAlias="other" hostValid bridge={{ query }} />);
    expect(screen.queryByText("job-123_1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("项目")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "q" } });
    expect(query).toHaveBeenCalledTimes(1);
    refresh(); await screen.findByText("job-456_1");
    expect(query).toHaveBeenLastCalledWith("other", ["456_1"]);
    expect(screen.getByText("已登记任务")).toBeInTheDocument();
  });
  it("ignores an old response after changing project during a refresh", async () => {
    seedProjects([{ id: "p", name: "项目", hostAlias: "cluster", jobIds: ["123_1"] }]);
    const old = deferred<HpcSnapshot>();
    const query = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot([job("123_1")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    await screen.findByRole("option", { name: "项目" });
    refresh();
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "p" } });
    refresh(); await screen.findByText("job-123_1");
    await act(async () => old.resolve(snapshot([job("999")])));
    expect(screen.queryByText("job-999")).not.toBeInTheDocument();
    expect(screen.getByText("job-123_1")).toBeInTheDocument();
  });
  it("ignores a response after unmounting", async () => {
    const old = deferred<HpcSnapshot>();
    const query = vi.fn(() => old.promise);
    const view = render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); view.unmount();
    await act(async () => old.resolve(snapshot([job("999")])));
    expect(screen.queryByText("job-999")).not.toBeInTheDocument();
  });
  it("keeps querying usable when saved projects fail to load", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("unavailable"); });
    const query = vi.fn(async () => snapshot([job("123_1")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    expect(await screen.findByText(/项目未能载入/)).toBeInTheDocument();
    refresh(); expect(await screen.findByText("job-123_1")).toBeInTheDocument();
  });
  it("marks unsupported compressed arrays as incomplete rather than counting an aggregate job", async () => {
    const query = vi.fn(async () => snapshot([job("123"), job("123_[2-8]")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh();
    expect(await screen.findByText("数组任务明细暂不可用，统计不完整。")).toBeInTheDocument();
    expect(screen.getByText("统计不完整")).toBeInTheDocument();
    expect(screen.queryByText("job-123")).not.toBeInTheDocument();
    expect(screen.queryByText("当前没有任务")).not.toBeInTheDocument();
  });
  it("uses four compact summary counts and keeps detailed failures in the table", async () => {
    const query = vi.fn(async () => snapshot([], [job("1", "CANCELLED"), job("2", "TIMEOUT"), job("3", "OUT_OF_MEMORY")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    refresh(); await screen.findByText("job-1");
    const stats = within(screen.getByLabelText("任务统计"));
    expect(stats.getByText("排队 0")).toBeInTheDocument();
    expect(stats.getByText("运行 0")).toBeInTheDocument();
    expect(stats.getByText("已结束 3")).toBeInTheDocument();
    expect(stats.getByText("需关注 3")).toBeInTheDocument();
    expect(stats.queryByText("成功 0")).not.toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("超时")).toBeInTheDocument();
    expect(screen.getByText("内存不足")).toBeInTheDocument();
  });
  it("rejects an oversized merged project without changing saved IDs or clearing the selection", async () => {
    const original = [{ id: "p", name: "批次", hostAlias: "cluster", jobIds: Array.from({ length: 512 }, (_, i) => `123_${i}`) }];
    seedProjects(original);
    const query = vi.fn(async () => snapshot([job("123_512")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    await screen.findByRole("option", { name: "批次" });
    refresh(); await screen.findByText("job-123_512");
    openManagement();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择任务 123_512" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "批次" } });
    fireEvent.click(screen.getByRole("button", { name: "保存所选任务" }));
    expect(await screen.findByText("每个项目最多登记 512 项任务，原项目未改动。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("kunkun-desk.hpc-projects")!)).toEqual(original);
    expect(screen.getByRole("checkbox", { name: "选择任务 123_512" })).toBeChecked();
    expect(screen.getByLabelText("项目名称")).toHaveValue("批次");
  });
  it("rejects loaded oversized projects visibly and preserves their raw records when saving another batch", async () => {
    const oversized = { id: "p", name: "超限批次", hostAlias: "cluster", jobIds: Array.from({ length: 513 }, (_, i) => `123_${i}`), note: "preserve original metadata" };
    seedProjects([oversized]);
    const query = vi.fn(async () => snapshot([job("456_1")]));
    render(<HpcTaskBoard hostAlias="cluster" hostValid bridge={{ query }} />);
    expect(await screen.findByText("部分项目超过 512 项，未载入；原有登记已保留。")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "超限批次" })).not.toBeInTheDocument();
    refresh(); await screen.findByText("job-456_1");
    openManagement();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择任务 456_1" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新批次" } });
    fireEvent.click(screen.getByRole("button", { name: "保存所选任务" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("kunkun-desk.hpc-projects")!)).toEqual([expect.objectContaining({ name: "新批次", jobIds: ["456_1"] }), oversized]));
    expect(screen.getByText("部分项目超过 512 项，未载入；原有登记已保留。")).toBeInTheDocument();
  });
});
