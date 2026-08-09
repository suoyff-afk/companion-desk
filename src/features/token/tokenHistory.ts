export interface TokenUsageBreakdown {
  raw: number;
  input: number;
  cachedInput: number;
  uncachedInput: number;
  output: number;
  reasoningOutput: number;
}

export interface DailyTokenTotal {
  date: string;
  totalTokens: number;
  eventCount: number;
  usage: TokenUsageBreakdown;
}

export interface TokenSourceTotal {
  source: "vscode" | "subagent" | "other";
  fileCount: number;
  usage: TokenUsageBreakdown;
}

export interface TokenHistorySnapshot {
  todayTokens: number;
  sevenDayTokens: number;
  averageRequestTokens: number;
  daily: DailyTokenTotal[];
  eventCount: number;
  usage: TokenUsageBreakdown;
  sources: TokenSourceTotal[];
  activeFileCount: number;
  archiveFileCount: number;
  unreadableFileCount: number;
}

const EMPTY_HISTORY: TokenHistorySnapshot = {
  todayTokens: 0,
  sevenDayTokens: 0,
  averageRequestTokens: 0,
  daily: [],
  eventCount: 0,
  usage: {
    raw: 0,
    input: 0,
    cachedInput: 0,
    uncachedInput: 0,
    output: 0,
    reasoningOutput: 0,
  },
  sources: [
    { source: "vscode", fileCount: 0, usage: { raw: 0, input: 0, cachedInput: 0, uncachedInput: 0, output: 0, reasoningOutput: 0 } },
    { source: "subagent", fileCount: 0, usage: { raw: 0, input: 0, cachedInput: 0, uncachedInput: 0, output: 0, reasoningOutput: 0 } },
    { source: "other", fileCount: 0, usage: { raw: 0, input: 0, cachedInput: 0, uncachedInput: 0, output: 0, reasoningOutput: 0 } },
  ],
  activeFileCount: 0,
  archiveFileCount: 0,
  unreadableFileCount: 0,
};

export async function getTokenHistory(): Promise<TokenHistorySnapshot> {
  if (!("__TAURI_INTERNALS__" in window)) return EMPTY_HISTORY;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TokenHistorySnapshot>("get_token_history");
}

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const digits = value >= 10_000_000 ? 0 : 1;
    return `${(value / 1_000_000).toFixed(digits).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const digits = value >= 100_000 ? 0 : 1;
    return `${(value / 1_000).toFixed(digits).replace(/\.0$/, "")}k`;
  }
  return value.toLocaleString("en-US");
}
