import { describe, expect, it } from "vitest";
import {
  addRandomTile,
  apply2048Move,
  isGameOver,
  moveGrid,
  randomFromRolls,
  undo2048Move,
  type Game2048State,
  type Grid,
} from "./game2048";

const EMPTY: Grid = Array.from({ length: 4 }, () => [0, 0, 0, 0]);

describe("2048", () => {
  it("replays the same random rolls for repeated React state updater calls", () => {
    const rolls = [0.25, 0.95];
    const firstCall = randomFromRolls(rolls);
    const repeatedCall = randomFromRolls(rolls);

    expect([firstCall(), firstCall()]).toEqual([0.25, 0.95]);
    expect([repeatedCall(), repeatedCall()]).toEqual([0.25, 0.95]);
  });

  it("merges each tile only once per move", () => {
    const grid = [[2, 2, 2, 2], ...EMPTY.slice(1)];
    expect(moveGrid(grid, "left").grid[0]).toEqual([4, 4, 0, 0]);
  });

  it("reports no-op moves", () => {
    const grid = [[2, 4, 8, 16], ...EMPTY.slice(1)];
    expect(moveGrid(grid, "left").moved).toBe(false);
  });

  it("inserts a deterministic tile with an injected random source", () => {
    const values = [0, 0.95];
    const grid = addRandomTile(EMPTY, () => values.shift() ?? 0);
    expect(grid[0][0]).toBe(4);
  });

  it("detects game over only when no moves remain", () => {
    expect(isGameOver([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])).toBe(true);
    expect(isGameOver([[2, 2, 4, 8], ...EMPTY.slice(1)])).toBe(false);
  });

  it("stores one successful move for undo and marks only the spawned tile", () => {
    const state: Game2048State = {
      grid: [[2, 2, 0, 0], ...EMPTY.slice(1)],
      score: 0,
      best: 0,
      previous: null,
      won: false,
      newTile: null,
      turn: 0,
    };

    const moved = apply2048Move(state, "left", () => 0);
    expect(moved.grid[0]).toEqual([4, 2, 0, 0]);
    expect(moved.newTile).toEqual([0, 1]);
    expect(moved.score).toBe(4);
    expect(moved.best).toBe(4);
    expect(moved.turn).toBe(1);

    const undone = undo2048Move(moved);
    expect(undone.grid).toEqual(state.grid);
    expect(undone.score).toBe(0);
    expect(undone.best).toBe(4);
    expect(undone.previous).toBeNull();
    expect(undone.turn).toBe(0);
  });

  it("does not create undo history for a no-op move", () => {
    const state: Game2048State = {
      grid: [[2, 4, 8, 16], ...EMPTY.slice(1)],
      score: 12,
      best: 20,
      previous: null,
      won: false,
      newTile: null,
      turn: 0,
    };

    expect(apply2048Move(state, "left", () => 0)).toBe(state);
  });

  it("updates best score and records reaching 2048 without stopping play", () => {
    const state: Game2048State = {
      grid: [[1024, 1024, 0, 0], ...EMPTY.slice(1)],
      score: 100,
      best: 100,
      previous: null,
      won: false,
      newTile: null,
      turn: 0,
    };

    const moved = apply2048Move(state, "left", () => 0);
    expect(moved.grid[0][0]).toBe(2048);
    expect(moved.score).toBe(2148);
    expect(moved.best).toBe(2148);
    expect(moved.won).toBe(true);
    expect(apply2048Move(moved, "right", () => 0)).not.toBe(moved);
  });
});
