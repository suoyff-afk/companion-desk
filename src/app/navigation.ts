export const FEATURE_VIEWS = [
  "token",
  "focus",
  "games",
  "game2048",
  "gomoku",
  "hpc",
] as const;

export type FeatureView = (typeof FEATURE_VIEWS)[number];
export type AppView = "collapsed" | "home" | FeatureView;
