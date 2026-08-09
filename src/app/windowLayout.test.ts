import { describe, expect, it } from "vitest";
import {
  COLLAPSED_NOTIFICATION_LAYOUT,
  COLLAPSED_MENU_LAYOUT,
  DEFAULT_WINDOW_LAYOUTS,
  HOME_MORE_OPEN_LAYOUT,
  getCollapsedWindowLayout,
  getHomeWindowLayout,
  isLegacyAutoHomeSize,
  normalizeSavedWindowSize,
  type SavedWindowSize,
} from "./windowLayout";
import { PET_SIZE_SCALES } from "../components/petPreferences";

describe("DEFAULT_WINDOW_LAYOUTS", () => {
  it("defines the complete per-view window policy", () => {
    expect(DEFAULT_WINDOW_LAYOUTS).toEqual({
      collapsed: {
        width: 160,
        height: 150,
        minWidth: 160,
        minHeight: 150,
        resizable: false,
      },
      home: {
        width: 380,
        height: 310,
        minWidth: 360,
        minHeight: 300,
        resizable: true,
      },
      token: {
        width: 620,
        height: 600,
        minWidth: 560,
        minHeight: 520,
        resizable: true,
      },
      focus: {
        width: 420,
        height: 560,
        minWidth: 390,
        minHeight: 520,
        resizable: true,
      },
      games: {
        width: 560,
        height: 520,
        minWidth: 500,
        minHeight: 480,
        resizable: true,
      },
      game2048: {
        width: 480,
        height: 600,
        minWidth: 440,
        minHeight: 560,
        resizable: true,
      },
      gomoku: {
        width: 620,
        height: 680,
        minWidth: 560,
        minHeight: 620,
        resizable: true,
      },
      hpc: {
        width: 900,
        height: 650,
        minWidth: 760,
        minHeight: 560,
        resizable: true,
      },
    });
  });
});

describe("collapsed window layouts", () => {
  it("reserves enough height for every pet menu action", () => {
    expect(COLLAPSED_MENU_LAYOUT).toEqual({
      width: 300,
      height: 350,
      minWidth: 300,
      minHeight: 350,
      resizable: false,
    });
    expect(getCollapsedWindowLayout(false, "standard", true)).toBe(COLLAPSED_MENU_LAYOUT);
  });

  it("defines the fixed notification layout", () => {
    expect(COLLAPSED_NOTIFICATION_LAYOUT).toEqual({
      width: 300,
      height: 150,
      minWidth: 300,
      minHeight: 150,
      resizable: false,
    });
  });

  it("selects the idle layout without notifications", () => {
    expect(getCollapsedWindowLayout(false)).toBe(DEFAULT_WINDOW_LAYOUTS.collapsed);
  });

  it("scales only the idle pet window for the three persisted presets", () => {
    expect(PET_SIZE_SCALES).toEqual({ small: 0.75, standard: 1, large: 1.25 });
    expect(getCollapsedWindowLayout(false, "small")).toMatchObject({ width: 120, height: 113 });
    expect(getCollapsedWindowLayout(false, "standard")).toBe(DEFAULT_WINDOW_LAYOUTS.collapsed);
    expect(getCollapsedWindowLayout(false, "large")).toMatchObject({ width: 200, height: 188 });
    expect(getCollapsedWindowLayout(true, "large")).toBe(COLLAPSED_NOTIFICATION_LAYOUT);
  });

  it("selects the notification layout when a notification is present", () => {
    expect(getCollapsedWindowLayout(true)).toBe(COLLAPSED_NOTIFICATION_LAYOUT);
  });
});

describe("home disclosures", () => {
  it("uses compact heights and reserves only the space each optional section needs", () => {
    expect(HOME_MORE_OPEN_LAYOUT).toEqual({
      ...DEFAULT_WINDOW_LAYOUTS.home,
      height: 355,
      minHeight: 345,
    });
    expect(getHomeWindowLayout(false, false)).toBe(DEFAULT_WINDOW_LAYOUTS.home);
    expect(getHomeWindowLayout(true, false)).toBe(HOME_MORE_OPEN_LAYOUT);
    expect(getHomeWindowLayout(false, true)).toMatchObject({ height: 365, minHeight: 355 });
    expect(getHomeWindowLayout(true, true)).toMatchObject({ height: 410, minHeight: 400 });
  });

  it("recognizes only the two auto-sized home layouts from the previous release", () => {
    expect(isLegacyAutoHomeSize({ width: 380, height: 390 })).toBe(true);
    expect(isLegacyAutoHomeSize({ width: 380, height: 430 })).toBe(true);
    expect(isLegacyAutoHomeSize({ width: 444, height: 555 })).toBe(false);
  });
});

describe("normalizeSavedWindowSize", () => {
  const home = DEFAULT_WINDOW_LAYOUTS.home;

  it("rejects non-finite saved sizes", () => {
    expect(normalizeSavedWindowSize(
      { width: Number.NaN, height: 540 },
      home,
    )).toBeNull();
    expect(normalizeSavedWindowSize(
      { width: 380, height: Number.POSITIVE_INFINITY },
      home,
    )).toBeNull();
  });

  it("clamps saved sizes to page minimums and a supplied work area", () => {
    expect(normalizeSavedWindowSize(
      { width: 120, height: 2_000 },
      home,
      { width: 800, height: 640 },
    )).toEqual({ width: 360, height: 640 });
  });

  it("fits within a valid work area smaller than the page minimums", () => {
    expect(normalizeSavedWindowSize(
      { width: 900, height: 900 },
      home,
      { width: 320, height: 480 },
    )).toEqual({ width: 320, height: 480 });
  });

  it.each([
    ["zero-width", { width: 0, height: 640 }],
    ["negative-height", { width: 800, height: -1 }],
  ] satisfies Array<[string, SavedWindowSize]>)(
    "uses default bounds for a %s work area",
    (_label, workArea) => {
      expect(normalizeSavedWindowSize(
        { width: 800, height: 640 },
        home,
        workArea,
      )).toEqual({ width: 380, height: 310 });
    },
  );

  it.each([
    ["NaN", { width: Number.NaN, height: 640 }],
    ["infinite", { width: 800, height: Number.POSITIVE_INFINITY }],
  ] satisfies Array<[string, SavedWindowSize]>)(
    "uses default bounds when one work-area axis is %s",
    (_label, workArea) => {
      expect(normalizeSavedWindowSize(
        { width: 800, height: 640 },
        home,
        workArea,
      )).toEqual({ width: 380, height: 310 });
    },
  );

  it("uses the page defaults as safe upper bounds without a valid work area", () => {
    expect(normalizeSavedWindowSize(
      { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
      home,
    )).toEqual({ width: 380, height: 310 });
  });
});
