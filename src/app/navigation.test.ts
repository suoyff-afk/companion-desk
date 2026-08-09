import { describe, expect, it } from "vitest";
import { APP_VIEWS } from "./navigation";

describe("APP_VIEWS", () => {
  it("defines every companion view in navigation order", () => {
    expect(APP_VIEWS).toEqual([
      "collapsed",
      "home",
      "token",
      "focus",
      "games",
      "game2048",
      "gomoku",
      "hpc",
    ]);
  });
});
