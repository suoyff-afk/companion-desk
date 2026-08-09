import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  ChartDonut,
  GameController,
  TerminalWindow,
  Timer,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { FeatureView } from "../../app/navigation";
import type { FocusSummary } from "../focus/FocusPage";
import { AddFriendDialog } from "../friends/AddFriendDialog";
import { FriendStrip } from "../friends/FriendStrip";
import {
  UNAVAILABLE_FRIEND_SNAPSHOT,
  type FriendsViewModel,
} from "../friends/useFriends";
import type { UsageWindow } from "../../types";
import type { QuotaState } from "../quota/quotaController";
import { openCodexApp } from "../../lib/bridge";
import { formatQuotaReset } from "./quotaPresentation";

interface HomePageProps {
  quota: Readonly<QuotaState>;
  refreshQuota: () => Promise<Readonly<QuotaState>>;
  focusSummary?: FocusSummary | null;
  onNavigate: (view: FeatureView) => void;
  friends?: FriendsViewModel;
  onMoreOpenChange?: (open: boolean) => void;
  onOpenCodex?: () => Promise<void>;
}

const UNAVAILABLE_FRIENDS: FriendsViewModel = {
  snapshot: UNAVAILABLE_FRIEND_SNAPSHOT,
  busy: null,
  error: null,
  actionErrors: {},
  latestErrorAction: null,
  requestByCode: async () => false,
  acceptRequest: async () => false,
  ignoreRequest: async () => false,
  poke: async () => false,
  removeFriend: async () => false,
  resetIdentity: async () => false,
};

function formatFocusTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function QuotaRow({ label, value }: { label: string; value: UsageWindow | null }) {
  const percent = value === null ? null : Math.round(Math.max(0, Math.min(100, value.remainingPercent)));
  const resetLabel = formatQuotaReset(value);

  return (
    <div className="home-quota__row" aria-label={percent === null ? `${label}：暂不可用` : `${label}：${percent}%`}>
      <span className="home-quota__label"><span>{label}</span>{value !== null && <small>{resetLabel}</small>}</span>
      <div className="home-quota__track" aria-hidden="true">
        <i style={{ width: `${percent ?? 0}%` }} />
      </div>
      <strong>{percent === null ? "暂不可用" : `${percent}%`}</strong>
    </div>
  );
}

export function HomePage({ quota, refreshQuota, focusSummary, onNavigate, friends = UNAVAILABLE_FRIENDS, onMoreOpenChange, onOpenCodex = openCodexApp }: HomePageProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [codexLaunchError, setCodexLaunchError] = useState(false);
  const availableQuota = quota.snapshot?.status === "ok" || quota.snapshot?.status === "stale"
    ? quota.snapshot
    : null;
  const focusTime = focusSummary?.status === "running" ? formatFocusTime(focusSummary.remainingMs) : null;
  const friendsAvailable = friends.snapshot.connectionState !== "unavailable";
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    onMoreOpenChange?.(next);
  };
  const launchCodex = async () => {
    setCodexLaunchError(false);
    try {
      await onOpenCodex();
    } catch {
      setCodexLaunchError(true);
    }
  };

  return (
    <section className="home-page" aria-label="Companion Desk 首页">
      <header className="home-page__intro">
        <p>陪你专注，也陪你松一口气。</p>
        <button type="button" onClick={() => { void launchCodex(); }}><ArrowSquareOut />打开 Codex</button>
      </header>
      {codexLaunchError && <p className="home-page__launch-error" role="status">暂时无法打开 Codex</p>}

      <article className="home-quota" aria-label="Codex 额度摘要">
        <div className="home-quota__heading">
          <ChartDonut weight="duotone" />
          <strong>额度</strong>
          <small>Codex</small>
          <button
            type="button"
            className="home-quota__refresh"
            aria-label="刷新额度"
            aria-busy={quota.loading || quota.refreshing}
            onClick={() => void refreshQuota()}
            disabled={quota.loading || quota.refreshing}
          >
            <ArrowsClockwise aria-hidden="true" />
          </button>
        </div>
        <QuotaRow label="5小时额度" value={availableQuota?.shortWindow ?? null} />
        <QuotaRow label="本周额度" value={availableQuota?.weeklyWindow ?? null} />
        {quota.snapshot?.status === "stale" && quota.updatedAt && (
          <p role="status">数据可能过期。最后更新：<time dateTime={quota.updatedAt}>{quota.updatedAt}</time></p>
        )}
      </article>

      <div className="home-primary-actions" aria-label="常用功能">
        <button
          type="button"
          className="home-action home-action--focus"
          aria-label={focusTime ? `专注，剩余 ${focusTime}` : undefined}
          onClick={() => onNavigate("focus")}
        >
          <Timer weight="duotone" />
          <span>专注</span>
          {focusTime && <small className="home-action__status">{focusTime}</small>}
        </button>
        <button type="button" className="home-action home-action--play" onClick={() => onNavigate("games")}>
          <GameController weight="duotone" />
          <span>玩一下</span>
        </button>
      </div>

      <div className="home-more">
        <button
          type="button"
          className="home-more__toggle"
          aria-expanded={moreOpen}
          onClick={toggleMore}
        >
          更多 <CaretDown className={moreOpen ? "is-open" : ""} />
        </button>
        {moreOpen && (
          <div className="home-more__actions">
            <button type="button" onClick={() => onNavigate("token")}><ChartDonut />Token</button>
            <button type="button" onClick={() => onNavigate("hpc")}><TerminalWindow />HPC / SSH</button>
          </div>
        )}
      </div>

      {friendsAvailable && (
        <>
          <FriendStrip friends={friends} onAdd={() => setAddFriendOpen(true)} />
          <AddFriendDialog open={addFriendOpen} onClose={() => setAddFriendOpen(false)} friends={friends} />
        </>
      )}
    </section>
  );
}
