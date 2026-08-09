import { describe, expect, it } from "vitest";
import { recoverWindowPosition } from "./windowPosition";

describe("recoverWindowPosition", () => {
  it("clamps a window that fits the work area instead of leaving it partly off-screen", () => {
    expect(recoverWindowPosition(
      { x: -20, y: 12, width: 380, height: 390 },
      [{ x: 0, y: 0, width: 1920, height: 1040 }],
    )).toEqual({ x: 0, y: 12, recovered: true });
  });

  it("clamps the right and bottom edges after a pet expands into the desk", () => {
    expect(recoverWindowPosition(
      { x: 1760, y: 900, width: 380, height: 390 },
      [{ x: 0, y: 0, width: 1920, height: 1040 }],
    )).toEqual({ x: 1540, y: 650, recovered: true });
  });

  it("centers a fully off-screen window in the nearest work area", () => {
    expect(recoverWindowPosition(
      { x: 2500, y: 100, width: 380, height: 390 },
      [{ x: 0, y: 0, width: 1920, height: 1040 }],
    )).toEqual({ x: 770, y: 325, recovered: true });
  });

  it("supports monitors with negative desktop coordinates", () => {
    expect(recoverWindowPosition(
      { x: -3000, y: 1500, width: 400, height: 500 },
      [
        { x: -1920, y: 0, width: 1920, height: 1040 },
        { x: 0, y: 0, width: 1920, height: 1040 },
      ],
    )).toEqual({ x: -1160, y: 270, recovered: true });
  });

  it("uses the primary fallback rectangle when no monitor data is available", () => {
    expect(recoverWindowPosition(
      { x: Number.NaN, y: 0, width: 380, height: 390 },
      [],
      { x: 0, y: 0, width: 1920, height: 1040 },
    )).toEqual({ x: 770, y: 325, recovered: true });
  });
});
