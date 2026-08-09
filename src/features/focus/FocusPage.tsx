import { CheckCircle, Clock, Pause, Play, Stop, Target } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { readAppValue, writeAppValue } from "../../lib/persistence";
import {
  completeOrTick,
  createFocusState,
  end,
  pause,
  resume,
  start,
  type FocusState,
} from "./focusMachine";

interface CompletedSession {
  task: string;
  durationMs: number;
  completedAt: string;
  reflection?: string;
}

interface StoredFocusData {
  task: string;
  durationMinutes: number;
  completed: CompletedSession[];
}

export interface FocusSummary {
  readonly status: FocusState["status"];
  readonly remainingMs: number;
  readonly durationMs: number;
}

interface FocusPageProps {
  onSessionChange?: (summary: FocusSummary) => void;
}

const DEFAULT_DATA: StoredFocusData = { task: "Current task", durationMinutes: 25, completed: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCompletedSession(value: unknown): CompletedSession | null {
  if (!isRecord(value)) return null;
  const task = typeof value.task === "string" ? value.task.trim() : "";
  const durationMs = value.durationMs;
  const completedAt = value.completedAt;
  if (
    !task
    || typeof durationMs !== "number"
    || !Number.isFinite(durationMs)
    || durationMs < 0
    || durationMs > 180 * 60_000
    || typeof completedAt !== "string"
    || !Number.isFinite(Date.parse(completedAt))
  ) return null;

  const reflection = typeof value.reflection === "string" ? value.reflection.trim().slice(0, 120) : "";
  return reflection ? { task, durationMs, completedAt, reflection } : { task, durationMs, completedAt };
}

function normalizeStoredData(value: unknown): StoredFocusData {
  if (!isRecord(value)) return DEFAULT_DATA;
  const completed = Array.isArray(value.completed)
    ? value.completed
      .map(normalizeCompletedSession)
      .filter((item): item is CompletedSession => item !== null)
      .slice(-100)
    : [];
  return {
    task: typeof value.task === "string" ? value.task : DEFAULT_DATA.task,
    durationMinutes: typeof value.durationMinutes === "number" && value.durationMinutes >= 1 && value.durationMinutes <= 180
      ? value.durationMinutes
      : DEFAULT_DATA.durationMinutes,
    completed,
  };
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FocusPage({ onSessionChange }: FocusPageProps = {}) {
  const [task, setTask] = useState(DEFAULT_DATA.task);
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DATA.durationMinutes);
  const [completed, setCompleted] = useState(DEFAULT_DATA.completed);
  const [session, setSession] = useState<FocusState>(() => createFocusState(DEFAULT_DATA.durationMinutes * 60_000));
  const [pendingCompletion, setPendingCompletion] = useState<CompletedSession | null>(null);
  const [reflection, setReflection] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const recordedCompletion = useRef(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusAfterDialog = useRef(false);
  const publishedRemainingSecond = Math.ceil(session.remainingMs / 1_000);

  useEffect(() => {
    let active = true;
    void readAppValue<unknown>("focus", null).then((value) => {
      if (!active) return;
      const stored = normalizeStoredData(value);
      setTask(stored.task);
      setDurationMinutes(stored.durationMinutes);
      setCompleted(stored.completed);
      setSession(createFocusState(stored.durationMinutes * 60_000));
      setPersistenceReady(true);
      setHydrated(true);
    }).catch(() => {
      if (!active) return;
      setPersistenceReady(false);
      setHydrated(true);
      setPersistenceNotice("Saved focus data could not be loaded. You can continue with a new session.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (hydrated && persistenceReady) {
      void writeAppValue("focus", { task, durationMinutes, completed } satisfies StoredFocusData)
        .then(() => { if (active) setPersistenceNotice(null); })
        .catch(() => { if (active) setPersistenceNotice("Focus changes could not be saved. Change the session again to retry."); });
    }
    return () => { active = false; };
  }, [completed, durationMinutes, hydrated, task]);

  useEffect(() => {
    if (session.status !== "running") return;
    const timer = window.setInterval(() => {
      setSession((current) => completeOrTick(current, Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [session.status]);

  useEffect(() => {
    onSessionChange?.({
      status: session.status,
      remainingMs: session.remainingMs,
      durationMs: session.durationMs,
    });
  }, [onSessionChange, publishedRemainingSecond, session.durationMs, session.status]);

  useEffect(() => {
    if (session.status !== "completed" || recordedCompletion.current) return;
    recordedCompletion.current = true;
    setReflection("");
    setPendingCompletion({
      task: task.trim() || "Untitled focus",
      durationMs: session.durationMs,
      completedAt: new Date().toISOString(),
    });
  }, [session.durationMs, session.status, task]);

  useEffect(() => {
    if (pendingCompletion !== null || !restoreFocusAfterDialog.current) return;
    restoreFocusAfterDialog.current = false;
    resetButtonRef.current?.focus();
  }, [pendingCompletion]);

  const resetSession = (minutes = durationMinutes) => {
    if (!hydrated || pendingCompletion) return;
    recordedCompletion.current = false;
    setPendingCompletion(null);
    setReflection("");
    setSession(createFocusState(minutes * 60_000));
  };

  const begin = () => {
    if (!hydrated || pendingCompletion) return;
    const base = session.status === "idle" ? session : createFocusState(durationMinutes * 60_000);
    recordedCompletion.current = false;
    setPendingCompletion(null);
    setReflection("");
    setSession(start(base, Date.now()));
  };

  const finishEarly = () => {
    if (!hydrated || pendingCompletion) return;
    const endedSession = end(session, Date.now());
    setSession(endedSession);
    if (endedSession.status === "completed") return;
    recordedCompletion.current = true;
    setReflection("");
    setPendingCompletion({
      task: task.trim() || "Untitled focus",
      durationMs: endedSession.durationMs - endedSession.remainingMs,
      completedAt: new Date().toISOString(),
    });
  };

  const recordCompletion = (reflectionValue?: string) => {
    if (!pendingCompletion) return;
    const trimmedReflection = reflectionValue?.trim();
    const completedSession = trimmedReflection
      ? { ...pendingCompletion, reflection: trimmedReflection }
      : pendingCompletion;
    setPersistenceReady(true);
    setCompleted((current) => [...current, completedSession].slice(-100));
    restoreFocusAfterDialog.current = true;
    setPendingCompletion(null);
    setReflection("");
  };

  const updateDuration = (value: number) => {
    if (!hydrated || pendingCompletion) return;
    const minutes = Math.max(1, Math.min(180, Math.round(value || 1)));
    setPersistenceReady(true);
    setDurationMinutes(minutes);
    resetSession(minutes);
  };

  const elapsedPercent = Math.round((1 - session.remainingMs / session.durationMs) * 100);
  const recentCompleted = completed.filter((item) => Date.now() - new Date(item.completedAt).getTime() <= 7 * 86_400_000);
  const focusHours = recentCompleted.reduce((sum, item) => sum + item.durationMs, 0) / 3_600_000;
  const recentSessions = completed.slice(-4).reverse();
  const controlsDisabled = !hydrated || pendingCompletion !== null;
  const pendingMainProps = pendingCompletion ? { inert: true, "aria-hidden": true } : {};

  const trapDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section className="feature-page focus-page" aria-labelledby="focus-title">
      <div className="focus-main" data-testid="focus-main-layout" {...pendingMainProps}>
        <div className="focus-above-fold" data-testid="focus-above-fold">
          <header className="feature-page__header focus-header">
            <p>Deep work</p>
            <h1 id="focus-title">Focus</h1>
            <span>专注计时</span>
            {persistenceNotice && <small className="field-error" role="status">{persistenceNotice}</small>}
          </header>

          <div className="focus-primary">
            <article className="glass-panel focus-settings">
              <label className="focus-task-field">
                <span>Current task <small>当前任务</small></span>
                <input value={task} disabled={controlsDisabled} onChange={(event) => {
                  setPersistenceReady(true);
                  setTask(event.target.value);
                }} maxLength={120} />
              </label>
              <label className="focus-duration-field">
                <span>Duration <small>分钟</small></span>
                <input type="number" min="1" max="180" value={durationMinutes} disabled={controlsDisabled || session.status === "running" || session.status === "paused"} onChange={(event) => updateDuration(Number(event.target.value))} />
              </label>
              <div className="focus-presets" aria-label="专注时长预设">
                {[25, 50].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={durationMinutes === minutes}
                    disabled={controlsDisabled || session.status === "running" || session.status === "paused"}
                    onClick={() => updateDuration(minutes)}
                  >
                    {minutes} 分钟
                  </button>
                ))}
              </div>
            </article>

            <article className="glass-panel focus-session-panel">
              <div className="panel-title"><Clock /><span><strong>Focus session</strong><small>专注会话</small></span></div>
              <div className="focus-dial" style={{ "--focus-progress": `${elapsedPercent * 3.6}deg` } as React.CSSProperties}>
                <div className="focus-dial__inner">
                  <Target />
                  <strong>{formatTime(session.remainingMs)}</strong>
                  <span>{task.trim() || "Untitled focus"}</span>
                  <small>{session.status === "idle" ? "Ready" : session.status}</small>
                </div>
              </div>
            </article>

            <div className="focus-actions" aria-label="Focus session actions">
              {(session.status === "idle" || session.status === "ended" || session.status === "completed") && (
                <button type="button" className="focus-action focus-action--primary" disabled={controlsDisabled} onClick={begin}><Play weight="fill" />Start Focus <small>开始专注</small></button>
              )}
              {session.status === "running" && (
                <button type="button" className="focus-action" disabled={controlsDisabled} onClick={() => setSession((current) => pause(current, Date.now()))}><Pause weight="fill" />Pause <small>暂停</small></button>
              )}
              {session.status === "paused" && (
                <button type="button" className="focus-action focus-action--primary" disabled={controlsDisabled} onClick={() => setSession((current) => resume(current, Date.now()))}><Play weight="fill" />Resume <small>继续</small></button>
              )}
              {(session.status === "running" || session.status === "paused") && (
                <button type="button" className="focus-action focus-action--danger" disabled={controlsDisabled} onClick={finishEarly}><Stop weight="fill" />End Session <small>结束会话</small></button>
              )}
              <button ref={resetButtonRef} type="button" className="focus-action" disabled={controlsDisabled} onClick={() => resetSession()}><Clock />Reset <small>重置</small></button>
            </div>
          </div>
        </div>

        <aside className="glass-panel focus-overview">
            <div className="panel-title"><CheckCircle /><span><strong>Focus overview</strong><small>专注概览</small></span></div>
            <div className="focus-stat"><span>Focus time<small>本周专注</small></span><strong>{focusHours.toFixed(1)}<small>h</small></strong></div>
            <div className="focus-stat"><span>Sessions<small>本周完成</small></span><strong>{recentCompleted.length}</strong></div>
            <div className="focus-stat"><span>Completion<small>当前进度</small></span><strong>{elapsedPercent}<small>%</small></strong></div>
            <section className="focus-recent" aria-labelledby="focus-recent-title">
              <h2 id="focus-recent-title">Recent sessions <small>最近完成</small></h2>
              {recentSessions.length === 0 ? (
                <p className="focus-recent__empty">No completed sessions yet.</p>
              ) : (
                <ul>
                  {recentSessions.map((item, index) => (
                    <li key={`${item.completedAt}-${index}`}>
                      <div>
                        <strong>{item.task}</strong>
                        <time dateTime={item.completedAt}>{new Date(item.completedAt).toLocaleString()}</time>
                      </div>
                      <small>{Math.round(item.durationMs / 60_000)} min</small>
                      {item.reflection && <p>{item.reflection}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
        </aside>
      </div>

      {pendingCompletion && (
        <div className="dialog-backdrop">
          <article className="confirm-dialog focus-reflection-dialog" role="dialog" aria-modal="true" aria-labelledby="focus-reflection-title" onKeyDown={trapDialogFocus}>
            <CheckCircle weight="fill" />
            <h2 id="focus-reflection-title">Session complete</h2>
            <p>写下一条本次收获，帮助下一次专注更清晰。</p>
            <label htmlFor="focus-reflection">一条本次收获</label>
            <input
              id="focus-reflection"
              type="text"
              value={reflection}
              maxLength={120}
              autoFocus
              onChange={(event) => setReflection(event.target.value)}
            />
            <output htmlFor="focus-reflection">{reflection.length} / 120</output>
            <div>
              <button type="button" onClick={() => recordCompletion()}>Skip</button>
              <button type="button" onClick={() => recordCompletion(reflection)}>Save reflection</button>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
