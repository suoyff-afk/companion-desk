export type FeatureView = "token" | "focus" | "games" | "game2048" | "gomoku" | "hpc";
export type AppView = "collapsed" | "home" | FeatureView;

export const APP_VIEWS: readonly AppView[] = [
  "collapsed",
  "home",
  "token",
  "focus",
  "games",
  "game2048",
  "gomoku",
  "hpc",
];

export type PageId = "token" | "focus" | "recharge" | "hpc";

export const NAV_ITEMS = [
  { id: "token", label: "Token Monitor", zh: "令牌监控" },
  { id: "focus", label: "Focus Timer", zh: "专注计时" },
  { id: "recharge", label: "Recharge & Games", zh: "休息与游戏" },
  { id: "hpc", label: "HPC / SSH", zh: "高性能计算" },
] as const satisfies ReadonlyArray<{
  id: PageId;
  label: string;
  zh: string;
}>;
