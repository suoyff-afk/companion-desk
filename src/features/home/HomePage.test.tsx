// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FriendsViewModel } from "../friends/useFriends";
import type { ProviderSnapshot } from "../../types";
import { HomePage } from "./HomePage";
import type { QuotaState } from "../quota/quotaController";

afterEach(cleanup);

const quota: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 62, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 48, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: null,
  updatedAt: "2026-07-16T12:00:00.000Z",
  status: "ok",
  message: null,
};

function friendModel(): FriendsViewModel {
  return {
    snapshot: {
      connectionState: "ready",
      self: null,
      ownFriendCode: "48271936",
      friends: [{ uid: "friend", displayName: "小北", acceptedAt: 1 }],
      pendingRequests: [],
      cooldownsByFriendUid: {},
      incomingPoke: null,
    },
    busy: null,
    error: null,
    actionErrors: {},
    latestErrorAction: null,
    requestByCode: vi.fn(async () => true),
    acceptRequest: vi.fn(async () => true),
    ignoreRequest: vi.fn(async () => true),
    poke: vi.fn(async () => true),
    removeFriend: vi.fn(async () => true),
    resetIdentity: vi.fn(async () => true),
  };
}

function quotaState(snapshot: ProviderSnapshot | null = quota): QuotaState {
  return {
    snapshot,
    lastSuccessful: snapshot?.status === "ok" ? snapshot : null,
    loading: false,
    refreshing: false,
    updatedAt: snapshot?.updatedAt ?? null,
  };
}

describe("HomePage", () => {
  it("keeps the quota summary and primary actions visible", () => {
    const onNavigate = vi.fn();
    render(<HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={onNavigate} />);

    expect(screen.getByRole("region", { name: "Companion Desk 首页" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kunkun" })).not.toBeInTheDocument();
    expect(screen.getByText("陪你专注，也陪你松一口气。")).toBeInTheDocument();
    expect(screen.getByLabelText("5小时额度：62%" )).toBeInTheDocument();
    expect(screen.getByLabelText("本周额度：48%" )).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "专注" }));
    fireEvent.click(screen.getByRole("button", { name: "玩一下" }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, "focus");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "games");
  });

  it("falls back to unavailable quota copy when loading fails", () => {
    render(<HomePage quota={quotaState(null)} refreshQuota={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getAllByText("暂不可用")).toHaveLength(2);
  });

  it("shows reset availability without inventing a time", () => {
    render(<HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getAllByText("重置时间暂不可用")).toHaveLength(2);
  });

  it("offers a compact Codex launcher in the home header", async () => {
    const onOpenCodex = vi.fn(async () => undefined);
    render(
      <HomePage
        quota={quotaState()}
        refreshQuota={vi.fn()}
        onNavigate={vi.fn()}
        onOpenCodex={onOpenCodex}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Codex" }));
    expect(onOpenCodex).toHaveBeenCalledOnce();
  });

  it("uses a quiet icon-only refresh control with a busy state", () => {
    const { rerender } = render(
      <HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={vi.fn()} />,
    );

    const refresh = screen.getByRole("button", { name: "刷新额度" });
    expect(refresh).not.toHaveTextContent("刷新额度");
    expect(refresh).toHaveAttribute("aria-busy", "false");

    rerender(
      <HomePage
        quota={{ ...quotaState(), refreshing: true }}
        refreshQuota={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "刷新额度" })).toHaveAttribute("aria-busy", "true");
  });

  it("discloses Token and HPC without permanent navigation", () => {
    const onNavigate = vi.fn();
    render(<HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={onNavigate} />);

    expect(screen.queryByRole("button", { name: "Token" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "Token" }));
    fireEvent.click(screen.getByRole("button", { name: "HPC / SSH" }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, "token");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "hpc");
  });

  it("reports the More disclosure state so the desktop can reserve enough space", () => {
    const onMoreOpenChange = vi.fn();
    render(
      <HomePage
        quota={quotaState()}
        refreshQuota={vi.fn()}
        onNavigate={vi.fn()}
        onMoreOpenChange={onMoreOpenChange}
      />,
    );

    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(onMoreOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(toggle);
    expect(onMoreOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("hides the unavailable friend area without demo identities", () => {
    render(<HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: "好友" })).not.toBeInTheDocument();
    expect(screen.queryByText("好友功能暂不可用")).not.toBeInTheDocument();
    expect(screen.queryByText(/Momo|阿杰|小雨|本地预览|联机功能待接入/)).not.toBeInTheDocument();
  });

  it("renders the real friend view model and opens the add dialog", () => {
    render(<HomePage quota={quotaState()} refreshQuota={vi.fn()} onNavigate={vi.fn()} friends={friendModel()} />);

    expect(screen.getByRole("button", { name: "小北" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加好友" }));
    expect(screen.getByRole("dialog", { name: "添加好友" })).toBeInTheDocument();
  });

  it("keeps a stale percentage and exposes its update time", () => {
    const stale = { ...quota, status: "stale" as const, message: "offline" };
    render(<HomePage quota={quotaState(stale)} refreshQuota={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByLabelText("5小时额度：62%")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("数据可能过期");
    expect(screen.getByRole("status")).toHaveTextContent("2026");
  });
});
