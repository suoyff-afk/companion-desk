import { describe, expect, it } from "vitest";
import { findDockTarget } from "./petDocking";

const workArea = { x: 0, y: 0, width: 1_920, height: 1_040 };

describe("findDockTarget", () => {
  it("snaps within 24 pixels of the left or right edge", () => {
    expect(findDockTarget({ x: 8, y: 100, width: 160, height: 150 }, workArea)).toEqual({
      side: "left",
      x: 0,
      y: 100,
    });
    expect(findDockTarget({ x: 1_752, y: 100, width: 160, height: 150 }, workArea)).toEqual({
      side: "right",
      x: 1_760,
      y: 100,
    });
  });

  it("does not snap away from an edge and clamps docked vertical position", () => {
    expect(findDockTarget({ x: 120, y: 100, width: 160, height: 150 }, workArea)).toBeNull();
    expect(findDockTarget({ x: 2, y: 2_000, width: 160, height: 150 }, workArea)).toEqual({
      side: "left",
      x: 0,
      y: 890,
    });
  });

  it("supports negative-coordinate monitors", () => {
    expect(findDockTarget(
      { x: -1_918, y: -50, width: 160, height: 150 },
      { x: -1_920, y: -100, width: 1_920, height: 1_080 },
    )).toEqual({ side: "left", x: -1_920, y: -50 });
  });
});
