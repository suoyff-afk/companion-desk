import type { AppView } from "./navigation";
import { PET_SIZE_SCALES, type PetSize } from "../components/petPreferences";

export interface WindowLayout {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
}

export interface SavedWindowSize {
  width: number;
  height: number;
}

export type SavedWindowLayouts = Partial<Record<AppView, SavedWindowSize>>;
export const COLLAPSED_NOTIFICATION_LAYOUT: WindowLayout = {
  width: 300,
  height: 150,
  minWidth: 300,
  minHeight: 150,
  resizable: false,
};

export const COLLAPSED_MENU_LAYOUT: WindowLayout = {
  width: 300,
  height: 350,
  minWidth: 300,
  minHeight: 350,
  resizable: false,
};

export const DEFAULT_WINDOW_LAYOUTS: Record<AppView, WindowLayout> = {
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
};

export const HOME_MORE_OPEN_LAYOUT: WindowLayout = {
  ...DEFAULT_WINDOW_LAYOUTS.home,
  height: 355,
  minHeight: 345,
};

const HOME_FRIENDS_LAYOUT: WindowLayout = {
  ...DEFAULT_WINDOW_LAYOUTS.home,
  height: 365,
  minHeight: 355,
};

const HOME_FRIENDS_MORE_OPEN_LAYOUT: WindowLayout = {
  ...DEFAULT_WINDOW_LAYOUTS.home,
  height: 410,
  minHeight: 400,
};

export function getHomeWindowLayout(moreOpen: boolean, hasFriends: boolean): WindowLayout {
  if (hasFriends) return moreOpen ? HOME_FRIENDS_MORE_OPEN_LAYOUT : HOME_FRIENDS_LAYOUT;
  return moreOpen ? HOME_MORE_OPEN_LAYOUT : DEFAULT_WINDOW_LAYOUTS.home;
}

export function isLegacyAutoHomeSize(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SavedWindowSize>;
  return candidate.width === 380 && (candidate.height === 390 || candidate.height === 430);
}

export function getCollapsedWindowLayout(
  hasNotification: boolean,
  petSize: PetSize = "standard",
  menuOpen = false,
): WindowLayout {
  if (menuOpen) return COLLAPSED_MENU_LAYOUT;
  if (hasNotification) return COLLAPSED_NOTIFICATION_LAYOUT;
  if (petSize === "standard") return DEFAULT_WINDOW_LAYOUTS.collapsed;
  const scale = PET_SIZE_SCALES[petSize];
  const width = Math.round(DEFAULT_WINDOW_LAYOUTS.collapsed.width * scale);
  const height = Math.round(DEFAULT_WINDOW_LAYOUTS.collapsed.height * scale);
  return { width, height, minWidth: width, minHeight: height, resizable: false };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidWorkArea(
  workArea: SavedWindowSize | undefined,
): workArea is SavedWindowSize {
  return workArea !== undefined
    && isFiniteNumber(workArea.width)
    && workArea.width > 0
    && isFiniteNumber(workArea.height)
    && workArea.height > 0;
}

export function normalizeSavedWindowSize(
  value: unknown,
  layout: WindowLayout,
  workArea?: SavedWindowSize,
): SavedWindowSize | null {
  if (typeof value !== "object" || value === null) return null;

  const { width, height } = value as Partial<SavedWindowSize>;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;

  const validWorkArea = isValidWorkArea(workArea) ? workArea : null;
  const maxWidth = validWorkArea?.width ?? Math.max(layout.width, layout.minWidth);
  const maxHeight = validWorkArea?.height ?? Math.max(layout.height, layout.minHeight);
  const minWidth = Math.min(layout.minWidth, maxWidth);
  const minHeight = Math.min(layout.minHeight, maxHeight);

  return {
    width: Math.min(Math.max(width, minWidth), maxWidth),
    height: Math.min(Math.max(height, minHeight), maxHeight),
  };
}
