import { describe, expect, it } from "vitest";
import {
  DEFAULT_PET_PREFERENCES,
  idleReactionDelay,
  normalizePetPreferences,
} from "./petPreferences";

describe("pet preferences", () => {
  it("accepts only the three sizes, two dock sides, and a boolean reaction flag", () => {
    expect(normalizePetPreferences({ size: "large", dockSide: "right", reactionsEnabled: false })).toEqual({
      size: "large",
      dockSide: "right",
      reactionsEnabled: false,
    });
    expect(normalizePetPreferences({ size: "huge", dockSide: "top", reactionsEnabled: "yes" })).toEqual(
      DEFAULT_PET_PREFERENCES,
    );
  });

  it("schedules optional idle waves only between 8 and 15 minutes", () => {
    expect(idleReactionDelay(0)).toBe(8 * 60_000);
    expect(idleReactionDelay(0.5)).toBe(11.5 * 60_000);
    expect(idleReactionDelay(1)).toBe(15 * 60_000);
    expect(idleReactionDelay(Number.NaN)).toBe(8 * 60_000);
  });
});
