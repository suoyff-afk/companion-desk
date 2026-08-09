// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../../types";
import { TokenPage } from "./TokenPage";
import type { TokenHistorySnapshot } from "./tokenHistory";
import type { QuotaState } from "../quota/quotaController";

afterEach(cleanup);

const quotaFixture: ProviderSnapshot[] = [{
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 64, resetsAt: "2026-07-15T18:00:00Z", windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 37, resetsAt: "2026-07-20T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: null,
  updatedAt: "2026-07-15T12:00:00Z",
  status: "ok",
  message: null,
}];

const historyFixture: TokenHistorySnapshot = {
  todayTokens: 182_000,
  sevenDayTokens: 2_400_000,
  averageRequestTokens: 1_246,
  eventCount: 1_926,
  usage: {
    raw: 2_400_000,
    input: 2_000_000,
    cachedInput: 600_000,
    uncachedInput: 1_400_000,
    output: 400_000,
    reasoningOutput: 80_000,
  },
  activeFileCount: 12,
  archiveFileCount: 4,
  unreadableFileCount: 3,
  sources: [
    {
      source: "vscode",
      fileCount: 5,
      usage: {
        raw: 900_000,
        input: 740_000,
        cachedInput: 240_000,
        uncachedInput: 500_000,
        output: 160_000,
        reasoningOutput: 30_000,
      },
    },
    {
      source: "subagent",
      fileCount: 9,
      usage: {
        raw: 1_300_000,
        input: 1_100_000,
        cachedInput: 310_000,
        uncachedInput: 790_000,
        output: 200_000,
        reasoningOutput: 42_000,
      },
    },
    {
      source: "other",
      fileCount: 2,
      usage: {
        raw: 200_000,
        input: 160_000,
        cachedInput: 50_000,
        uncachedInput: 110_000,
        output: 40_000,
        reasoningOutput: 8_000,
      },
    },
  ],
  daily: [{
    date: "2026-07-15",
    totalTokens: 182_000,
    eventCount: 146,
    usage: {
      raw: 182_000,
      input: 150_000,
      cachedInput: 45_000,
      uncachedInput: 105_000,
      output: 32_000,
      reasoningOutput: 6_000,
    },
  }],
};

function quotaState(snapshot: ProviderSnapshot | null = quotaFixture[0]): QuotaState {
  return {
    snapshot,
    lastSuccessful: snapshot?.status === "ok" ? snapshot : null,
    loading: false,
    refreshing: false,
    updatedAt: snapshot?.updatedAt ?? null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function historyWithToday(todayTokens: number): TokenHistorySnapshot {
  return {
    ...historyFixture,
    todayTokens,
    daily: [{ ...historyFixture.daily[0], totalTokens: todayTokens }],
  };
}

describe("TokenPage", () => {
  it("shows real Codex windows without inventing monthly quota", async () => {
    render(
      <TokenPage
        quota={quotaState()}
        refreshQuota={async () => quotaState()}
        loadHistory={async () => historyFixture}
      />,
    );

    expect(await screen.findByText("64% remaining")).toBeInTheDocument();
    expect(screen.getByText("5-hour quota")).toBeInTheDocument();
    expect(screen.getByText("Weekly quota")).toBeInTheDocument();
    expect(screen.getByText("182k")).toBeInTheDocument();
    expect(screen.queryByText(/Monthly quota/i)).not.toBeInTheDocument();
  });

  it("leads with compact quota, activity, cache, and trend insights", async () => {
    render(
      <TokenPage
        quota={quotaState()}
        refreshQuota={async () => quotaState()}
        loadHistory={async () => historyFixture}
      />,
    );

    expect(await screen.findByText("64% remaining")).toBeInTheDocument();
    expect(screen.getByText("5小时")).toBeInTheDocument();
    expect(screen.getByText("本周")).toBeInTheDocument();
    expect(screen.getByText("今日活动")).toBeInTheDocument();
    expect(screen.getByText("缓存命中")).toBeInTheDocument();
    expect(screen.getByText("7日趋势")).toBeInTheDocument();
    expect(screen.getByText("182k")).toBeInTheDocument();
    expect(screen.getByLabelText("Cache hit 30%")).toBeInTheDocument();
    expect(screen.getByLabelText("Seven day local raw activity chart")).toBeInTheDocument();

    const disclosure = screen.getByRole("button", { name: "数据说明" });
    const details = document.getElementById("token-data-details");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(details).toBeInTheDocument();
    expect(details).toHaveAttribute("hidden");

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(details).not.toHaveAttribute("hidden");
    expect(screen.getByText("Cached input")).toBeInTheDocument();
    expect(screen.getByText("Uncached input")).toBeInTheDocument();
    expect(screen.getByText("Reasoning output")).toBeInTheDocument();
    expect(screen.getByText("Active · 12 files")).toBeInTheDocument();
    expect(screen.getByText("Archive · 4 files")).toBeInTheDocument();
    expect(screen.getByText("Unreadable · 3 files")).toBeInTheDocument();
    expect(screen.getByText(/raw local token counters; not billing/i)).toBeInTheDocument();
    expect(screen.getByText("~/.codex/sessions + ~/.codex/archived_sessions")).toBeInTheDocument();
    expect(screen.queryByText("Peak day")).not.toBeInTheDocument();
    expect(screen.queryByText("Dominant source")).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(details).toHaveAttribute("hidden");
  });

  it("refreshes the shared quota and local history together without clearing quota on history failure", async () => {
    const refreshQuota = vi.fn(async () => quotaState());
    const loadHistory = vi.fn()
      .mockResolvedValueOnce(historyFixture)
      .mockRejectedValueOnce(new Error("history offline"));
    render(<TokenPage quota={quotaState()} refreshQuota={refreshQuota} loadHistory={loadHistory} />);

    await screen.findByText("182k");
    fireEvent.click(screen.getByRole("button", { name: /Refresh quota and local activity/ }));

    await waitFor(() => {
      expect(refreshQuota).toHaveBeenCalledWith();
      expect(loadHistory).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("64% remaining")).toBeInTheDocument();
  });

  it("labels local history as partial when session files could not be read", async () => {
    render(
      <TokenPage
        quota={quotaState()}
        refreshQuota={async () => quotaState()}
        loadHistory={async () => ({ ...historyFixture, unreadableFileCount: 3 })}
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Partial statistics · unread 3 files");
  });

  it("keeps the newest StrictMode history request authoritative when completions arrive out of order", async () => {
    const first = deferred<TokenHistorySnapshot>();
    const second = deferred<TokenHistorySnapshot>();
    const loadHistory = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(
      <StrictMode>
        <TokenPage quota={quotaState()} refreshQuota={async () => quotaState()} loadHistory={loadHistory} />
      </StrictMode>,
    );

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve(historyWithToday(111)));
    expect(screen.queryByText("111")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh quota and local activity/ })).toBeDisabled();

    await act(async () => second.resolve(historyWithToday(222)));
    expect(await screen.findByText("222")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh quota and local activity/ })).not.toBeDisabled();
  });
});
