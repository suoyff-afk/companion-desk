import { describe, expect, it } from "vitest";
import type { UsageWindow } from "../../types";
import { formatQuotaReset } from "./quotaPresentation";

const now = new Date("2026-08-09T10:00:00.000Z");

function usage(resetsAt: string | null): UsageWindow {
  return { remainingPercent: 62, resetsAt, windowSeconds: 18_000 };
}

describe("formatQuotaReset", () => {
  it("distinguishes an unavailable window from an unavailable reset time", () => {
    expect(formatQuotaReset(null, now)).toBe("暂不可用");
    expect(formatQuotaReset(usage(null), now)).toBe("重置时间暂不可用");
    expect(formatQuotaReset(usage("invalid"), now)).toBe("重置时间暂不可用");
  });

  it("formats a real reset returned by Codex", () => {
    expect(formatQuotaReset(usage("2026-08-09T12:00:00.000Z"), now)).toBe("2 小时后重置");
  });
});
