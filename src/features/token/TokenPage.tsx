import { ArrowClockwise, ChartLineUp, Clock, Gauge } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageWindow } from "../../types";
import type { QuotaState } from "../quota/quotaController";
import {
  formatCompactTokens,
  getTokenHistory,
  type TokenHistorySnapshot,
} from "./tokenHistory";

interface TokenPageProps {
  quota: Readonly<QuotaState>;
  refreshQuota: () => Promise<Readonly<QuotaState>>;
  loadHistory?: () => Promise<TokenHistorySnapshot>;
}

function formatReset(value: string | null): string {
  if (!value) return "Reset time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset time unavailable";
  return `Resets ${date.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function QuotaMeter({ label, zh, value }: { label: string; zh: string; value: UsageWindow | null }) {
  if (!value) {
    return (
      <div className="quota-meter quota-meter--unavailable">
        <div><strong>{label}</strong><small>{zh}</small></div>
        <p>Unavailable</p>
      </div>
    );
  }

  const usedPercent = Math.max(0, Math.min(100, 100 - value.remainingPercent));
  return (
    <div className="quota-meter">
      <div className="quota-meter__heading">
        <span><strong>{label}</strong><small>{zh}</small></span>
        <b>{Math.round(value.remainingPercent)}% remaining</b>
      </div>
      <div className="quota-meter__track" aria-label={`${label}: ${Math.round(value.remainingPercent)}% remaining`}>
        <span style={{ width: `${usedPercent}%` }} />
      </div>
      <p>{formatReset(value.resetsAt)}</p>
    </div>
  );
}

function percent(part: number | undefined, total: number | undefined): number | null {
  if (part === undefined || total === undefined || total <= 0) return null;
  return Math.round((part / total) * 100);
}

export function TokenPage({ quota, refreshQuota, loadHistory = getTokenHistory }: TokenPageProps) {
  const [history, setHistory] = useState<TokenHistorySnapshot | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const historyGenerationRef = useRef(0);

  const requestHistory = useCallback(async (
    quotaRefresh?: () => Promise<Readonly<QuotaState>>,
  ) => {
    const generation = ++historyGenerationRef.current;
    setHistoryLoading(true);
    setNotice(null);
    const historyResult = quotaRefresh
      ? (await Promise.allSettled([quotaRefresh(), loadHistory()]))[1]
      : (await Promise.allSettled([loadHistory()]))[0];
    if (generation !== historyGenerationRef.current) return;
    if (historyResult.status === "fulfilled") setHistory(historyResult.value);
    else setNotice("Local token history could not be read.");
    setHistoryLoading(false);
  }, [loadHistory]);

  useEffect(() => {
    void requestHistory();
    return () => { historyGenerationRef.current += 1; };
  }, [requestHistory]);

  const loading = quota.loading || quota.refreshing || historyLoading;
  const snapshot = quota.snapshot;

  const cacheHit = percent(history?.usage.cachedInput, history?.usage.input);
  const composition = [
    { label: "Cached input", value: history?.usage.cachedInput, share: percent(history?.usage.cachedInput, history?.usage.input) },
    { label: "Uncached input", value: history?.usage.uncachedInput, share: percent(history?.usage.uncachedInput, history?.usage.input) },
    { label: "Output", value: history?.usage.output, share: percent(history?.usage.output, history?.usage.raw) },
    { label: "Reasoning output", value: history?.usage.reasoningOutput, share: percent(history?.usage.reasoningOutput, history?.usage.output) },
  ];

  return (
    <section className="feature-page token-page" aria-labelledby="token-title">
      <header className="feature-page__header token-page__header">
        <div>
          <p>Codex usage</p>
          <h1 id="token-title">Token</h1>
          <span>令牌洞察</span>
        </div>
        <button type="button" className="refresh-button" aria-label="Refresh quota and local activity" onClick={() => void requestHistory(refreshQuota)} disabled={loading}>
          <ArrowClockwise className={loading ? "is-spinning" : ""} />
          {loading ? "Reading…" : "Refresh"}
        </button>
      </header>

      {notice && <p className="token-notice" role="status">{notice}</p>}
      {(history?.unreadableFileCount ?? 0) > 0 && (
        <p className="token-notice" role="status">
          Partial statistics · unread {history!.unreadableFileCount} files
        </p>
      )}

      <article className="glass-panel quota-summary token-quota-card">
        <div className="panel-title"><Gauge /><span><strong>Codex quota</strong><small>官方额度</small></span></div>
        {snapshot?.status && snapshot.status !== "ok" && <p className="quota-status">{snapshot.message ?? snapshot.status}</p>}
        {snapshot?.status === "stale" && quota.updatedAt && <p role="status">数据可能过期。最后更新：<time dateTime={quota.updatedAt}>{quota.updatedAt}</time></p>}
        <QuotaMeter label="5-hour quota" zh="5小时" value={snapshot?.shortWindow ?? null} />
        <QuotaMeter label="Weekly quota" zh="本周" value={snapshot?.weeklyWindow ?? null} />
      </article>

      <div className="token-compact-insights">
        <article className="glass-panel token-insight-card">
          <div className="panel-title"><Clock /><span><strong>今日活动</strong><small>Today · local raw</small></span></div>
          <strong className="token-insight-card__value">
            {history ? formatCompactTokens(history.todayTokens) : "—"}
          </strong>
          <small>tokens</small>
        </article>

        <article className="glass-panel token-insight-card" aria-label={`Cache hit ${cacheHit ?? 0}%`}>
          <div className="panel-title"><Gauge /><span><strong>缓存命中</strong><small>Cache hit</small></span></div>
          <strong className="token-insight-card__value">{cacheHit === null ? "—" : `${cacheHit}%`}</strong>
          <small>复用的输入上下文占比</small>
        </article>
      </div>

      <article className="glass-panel token-chart-panel token-trend-card">
        <div className="panel-title"><ChartLineUp /><span><strong>7日趋势</strong><small>7-day local raw activity</small></span></div>
        {history?.daily.length ? (
          <div className="token-chart" aria-label="Seven day local raw activity chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history.daily} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e6e7f2" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={formatCompactTokens} tickLine={false} axisLine={false} width={42} />
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} tokens`, "Raw activity"]} />
                <Line type="monotone" dataKey="totalTokens" stroke="#6f67f5" strokeWidth={3} dot={{ r: 3, fill: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-chart">{historyLoading ? "Reading local Codex sessions…" : "No token events found in the last 7 days."}</div>
        )}
      </article>

      <article className="glass-panel token-details-card">
        <button
          type="button"
          className="token-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls="token-data-details"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span>数据说明</span>
          <span aria-hidden="true">{detailsOpen ? "−" : "+"}</span>
        </button>

        <div id="token-data-details" className="token-details-content" hidden={!detailsOpen}>
          <div className="token-composition" aria-label="Seven-day usage composition">
            {composition.map((item) => (
              <div key={item.label}>
                <div><span>{item.label}</span><b>{item.value === undefined ? "—" : formatCompactTokens(item.value)} · {item.share ?? 0}%</b></div>
                <div className="token-composition__track"><span style={{ width: `${Math.max(0, Math.min(100, item.share ?? 0))}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="token-data-quality">
            <strong>Data coverage</strong>
            <span>Active · {history?.activeFileCount ?? 0} files</span>
            <span>Archive · {history?.archiveFileCount ?? 0} files</span>
            <span className={(history?.unreadableFileCount ?? 0) > 0 ? "has-warning" : ""}>Unreadable · {history?.unreadableFileCount ?? 0} files</span>
          </p>
          <p className="token-source-note">Raw local token counters; not billing or quota consumption. Data source · <span>~/.codex/sessions + ~/.codex/archived_sessions</span></p>
        </div>
      </article>
    </section>
  );
}
