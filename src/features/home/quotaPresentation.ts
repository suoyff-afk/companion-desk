import type { UsageWindow } from "../../types";
import { formatResetTime } from "../../lib/format";

export function formatQuotaReset(value: UsageWindow | null, now = new Date()): string {
  if (value === null) return "暂不可用";
  if (value.resetsAt === null || Number.isNaN(new Date(value.resetsAt).getTime())) {
    return "重置时间暂不可用";
  }
  return formatResetTime(value.resetsAt, now);
}
