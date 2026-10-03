import { useEffect, useRef, useState } from "react";
import { readAppValue, writeAppValue } from "../../lib/persistence";
import { desktopHpcQueryBridge, validateHpcSnapshot, type HpcJob, type HpcQueryBridge } from "./hpcQueryBridge";
import { classifyJob, hasCompressedArrays, hasOversizedProjects, matchesProject, MAX_PROJECT_JOB_IDS, mergeJobs, mergeProjectJobIds, summarizeJobs, validateProjects, type HpcProject, type JobFilter } from "./hpcTaskModel";
import "./HpcTaskBoard.css";
export interface HpcTaskBoardProps { hostAlias: string; hostValid: boolean; bridge?: HpcQueryBridge }

export function HpcTaskBoard({ hostAlias, hostValid, bridge = desktopHpcQueryBridge }: HpcTaskBoardProps) {
  const [projects, setProjects] = useState<HpcProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const preservedOversizedRecords = useRef<unknown[]>([]);
  const oversizedNotice = `部分项目超过 ${MAX_PROJECT_JOB_IDS} 项，未载入；原有登记已保留。`;
  useEffect(() => {
    let active = true;
    readAppValue<unknown>("hpc-projects", []).then(value => {
      if (!active) return;
      preservedOversizedRecords.current = Array.isArray(value) ? value.filter(item => hasOversizedProjects([item])) : [];
      setProjects(validateProjects(value));
      if (preservedOversizedRecords.current.length > 0) setNotice(oversizedNotice);
      setLoaded(true);
    })
      .catch(() => { if (active) setNotice("项目未能载入，暂不能保存；可继续读取任务，重新启动应用后重试。"); });
    return () => { active = false; };
  }, []);
  const hostProjects = projects.filter(project => project.hostAlias === hostAlias);
  const project = hostProjects.find(item => item.id === selectedId);
  async function saveProject(name: string, jobIds: string[]) {
    const existing = hostProjects.find(item => item.name === name);
    const mergedIds = mergeProjectJobIds(existing?.jobIds ?? [], jobIds);
    if (mergedIds === null) { setNotice(`每个项目最多登记 ${MAX_PROJECT_JOB_IDS} 项任务，原项目未改动。`); return false; }
    const saved: HpcProject = { id: existing?.id ?? crypto.randomUUID(), name, hostAlias, jobIds: mergedIds };
    const next = existing ? projects.map(item => item.id === existing.id ? saved : item) : [...projects, saved];
    setProjects(next);
    setSaving(true);
    try { await writeAppValue("hpc-projects", [...next, ...preservedOversizedRecords.current]); setNotice(preservedOversizedRecords.current.length > 0 ? oversizedNotice : ""); }
    catch { setNotice("项目未能保存，本次仍可使用；关闭后可能丢失。"); }
    finally { setSaving(false); }
    return true;
  }
  return <BoardScope key={JSON.stringify([hostAlias, project?.id ?? "all", project?.jobIds ?? []])} hostAlias={hostAlias} hostValid={hostValid} bridge={bridge}
    project={project} projects={hostProjects} onProjectChange={setSelectedId} onSave={saveProject} canSave={loaded && !saving} notice={notice} />;
}

interface SourceData { jobs: HpcJob[] | null; timestamp: string | null; stale: boolean }
const emptySource = (): SourceData => ({ jobs: null, timestamp: null, stale: false });
interface BoardScopeProps extends Required<HpcTaskBoardProps> {
  project?: HpcProject; projects: HpcProject[]; onProjectChange(id: string): void;
  onSave(name: string, ids: string[]): Promise<boolean>; canSave: boolean; notice: string;
}
const filters: Array<[JobFilter, string]> = [["all", "全部"], ["queued", "排队"], ["running", "运行"], ["abnormal", "异常"], ["ended", "已结束"]];

function BoardScope({ hostAlias, hostValid, bridge, project, projects, onProjectChange, onSave, canSave, notice }: BoardScopeProps) {
  const [queue, setQueue] = useState<SourceData>(emptySource);
  const [history, setHistory] = useState<SourceData>(emptySource);
  const [queried, setQueried] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [partial, setPartial] = useState(false);
  const [historyDays, setHistoryDays] = useState<number | null>(project ? null : 7);
  const [filter, setFilter] = useState<JobFilter>("all");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const request = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  async function refresh() {
    if (busy.current || !hostValid) return;
    busy.current = true;
    const current = ++request.current;
    setLoading(true);
    setIssues([]);
    try {
      const snapshot = validateHpcSnapshot(await bridge.query(hostAlias, project?.jobIds ?? []));
      if (current !== request.current) return;
      if (snapshot.hostAlias !== hostAlias) throw new Error("任务查询返回的主机不匹配。");
      setQueue(previous => snapshot.queue === null ? { ...previous, stale: true } : { jobs: snapshot.queue, timestamp: snapshot.queriedAt, stale: false });
      setHistory(previous => snapshot.history === null ? { ...previous, stale: true } : { jobs: snapshot.history, timestamp: snapshot.queriedAt, stale: false });
      setIssues(snapshot.issues.map(issue => `${issue.source === "queue" ? "队列" : "历史"}读取失败：${issue.message}`));
      setPartial(snapshot.issues.length > 0);
      setHistoryDays(snapshot.historyDays);
      setQueried(true);
    } catch (error) {
      if (current !== request.current) return;
      setIssues([`读取失败：${error instanceof Error ? error.message : String(error)}`]);
      setQueue(previous => ({ ...previous, stale: true }));
      setHistory(previous => ({ ...previous, stale: true }));
      setPartial(true);
      setQueried(true);
    } finally {
      if (current === request.current) { busy.current = false; setLoading(false); }
    }
  }
  const jobs = mergeJobs(queue.jobs, history.jobs, { queueStale: queue.stale, historyStale: history.stale }).filter(job => !project || matchesProject(job.jobId, project.jobIds));
  const visible = jobs.filter(job => {
    const status = classifyJob(job);
    return filter === "all" || status.group === filter || (filter === "ended" && status.group === "abnormal");
  });
  const summary = summarizeJobs(jobs, project?.jobIds);
  const unsupportedArrays = hasCompressedArrays(queue.jobs?.filter(job => !project || matchesProject(job.jobId, project.jobIds)) ?? null,
    history.jobs?.filter(job => !project || matchesProject(job.jobId, project.jobIds)) ?? null);
  const incomplete = partial || unsupportedArrays;
  const hasData = queue.jobs !== null || history.jobs !== null;
  const emptyMessage = !queried ? "点击刷新读取当前任务" : !hasData ? "暂无可用任务数据" : jobs.length === 0 ? (incomplete ? "暂无可用任务数据" : project && summary.unknown > 0 ? "登记任务状态未知" : "当前没有任务") : "当前筛选没有任务";
  const windowText = project || historyDays === null ? "已登记任务" : `当前队列＋近${historyDays}天历史`;
  const sourceStamp = (label: string, data: SourceData) => <span>{label}：{data.timestamp ? <>{data.stale ? "上次数据" : "已更新"} <time dateTime={data.timestamp}>{data.timestamp}</time></> : "未读取"}</span>;
  async function save() {
    if (!name.trim() || selected.length === 0 || !canSave) return;
    if (!await onSave(name.trim(), selected)) return;
    setName("");
    setSelected([]);
  }
  return <section className="hpc-task-board" aria-label="任务看板">
    <div className="hpc-task-heading"><h2>任务看板</h2><span>{windowText}</span></div>
    <div className="hpc-task-toolbar">
      <select aria-label="项目" value={project?.id ?? ""} onChange={event => onProjectChange(event.target.value)}>
        <option value="">全部任务</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button className="hpc-task-refresh" type="button" onClick={() => void refresh()} disabled={!hostValid || loading}>{loading ? "读取中…" : "刷新"}</button>
    </div>
    <div className="hpc-task-filters" role="group" aria-label="任务状态筛选">{filters.map(([value, label]) =>
      <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {queried && <div className="hpc-task-counts" aria-label="任务统计">{incomplete ? <span>统计不完整</span> : <>
      {summary.denominator !== null && <span>总任务 {summary.denominator}</span>}
      <span>排队 {summary.queued}</span><span>运行 {summary.running}</span><span>已结束 {summary.ended}</span>
      <span>需关注 {summary.abnormal + summary.unknown}{summary.unknown > 0 && <small>未知 {summary.unknown}</small>}</span>
    </>}</div>}
    <div className="hpc-task-notices" role="status" aria-live="polite">
      {issues.map(issue => <p key={issue}>{issue}</p>)}{unsupportedArrays && <p>数组任务明细暂不可用，统计不完整。</p>}{notice && <p>{notice}</p>}
    </div>
    {queried && <div className="hpc-task-stamps">{sourceStamp("队列", queue)}{sourceStamp("历史", history)}</div>}
    <div className="hpc-task-table-region" tabIndex={0} aria-label="任务列表" aria-busy={loading}>
      {visible.length === 0 ? <p className="hpc-task-empty">{loading ? "正在读取任务…" : emptyMessage}</p> : <table>
        <thead><tr>{managing && <th>选择</th>}<th>任务 ID / 名称</th><th>状态</th><th>用时</th><th>原因 / 退出码</th></tr></thead>
        <tbody>{visible.map(job => {
          const status = classifyJob(job);
          const fromQueue = queue.jobs?.includes(job);
          const stale = fromQueue ? queue.stale : history.stale;
          const registrable = /^\d+(?:_\d+)?$/.test(job.jobId);
          return <tr key={job.jobId} className={stale ? "hpc-task-stale" : undefined}>
            {managing && <td>{registrable && <input type="checkbox" aria-label={`选择任务 ${job.jobId}`} checked={selected.includes(job.jobId)}
              onChange={event => setSelected(previous => event.target.checked ? [...previous, job.jobId] : previous.filter(id => id !== job.jobId))} />}</td>}
            <td><strong>{job.jobId}</strong><span className="hpc-task-job-name" title={job.name}>{job.name || "—"}</span>{stale && <small>上次数据</small>}</td>
            <td><span className={`hpc-task-state hpc-task-state-${status.group}`}>{status.label}</span><small>{job.state}</small></td>
            <td className="hpc-task-elapsed">{job.elapsed || "—"}</td><td><span className="hpc-task-reason">{job.reason || "—"}</span><small>退出 {job.exitCode ?? "未知"}</small></td>
          </tr>;
        })}</tbody>
      </table>}
    </div>
    <details className="hpc-task-management" onToggle={event => setManaging(event.currentTarget.open)}>
      <summary>管理项目</summary>
      <p>勾选任务，保存为当前主机的项目。</p>
      <div className="hpc-task-save"><input aria-label="项目名称" placeholder="项目名称" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        <button type="button" disabled={!canSave || !name.trim() || selected.length === 0} onClick={() => void save()}>保存所选任务</button></div>
      <small>已选 {selected.length} 项；同名项目追加任务。</small>
    </details>
  </section>;
}
