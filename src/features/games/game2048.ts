export type Grid = number[][];
export type MoveDirection = "left" | "right" | "up" | "down";

export interface MoveResult {
  grid: Grid;
  moved: boolean;
  score: number;
}

export type TilePosition = readonly [row: number, column: number];

export interface Game2048State {
  grid: Grid;
  score: number;
  best: number;
  previous: { grid: Grid; score: number; won: boolean; turn: number } | null;
  won: boolean;
  newTile: TilePosition | null;
  turn: number;
}

export function randomFromRolls(rolls: ReadonlyArray<number>): () => number {
  let index = 0;
  return () => rolls[index++] ?? 0;
}

function mergeLine(line: number[]): { line: number[]; score: number } {
  const values = line.filter(Boolean);
  const merged: number[] = [];
  let score = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === values[index + 1]) {
      const value = values[index] * 2;
      merged.push(value);
      score += value;
      index += 1;
    } else {
      merged.push(values[index]);
    }
  }
  while (merged.length < line.length) merged.push(0);
  return { line: merged, score };
}

function transpose(grid: Grid): Grid {
  return grid[0].map((_, column) => grid.map((row) => row[column]));
}

function rowsForDirection(grid: Grid, direction: MoveDirection): { rows: Grid; reversed: boolean; transposed: boolean } {
  const transposed = direction === "up" || direction === "down";
  const reversed = direction === "right" || direction === "down";
  const rows = transposed ? transpose(grid) : grid.map((row) => [...row]);
  return { rows: reversed ? rows.map((row) => [...row].reverse()) : rows, reversed, transposed };
}

export function moveGrid(grid: Grid, direction: MoveDirection): MoveResult {
  const { rows, reversed, transposed } = rowsForDirection(grid, direction);
  let score = 0;
  let next = rows.map((row) => {
    const result = mergeLine(row);
    score += result.score;
    return reversed ? result.line.reverse() : result.line;
  });
  if (transposed) next = transpose(next);
  const moved = next.some((row, rowIndex) => row.some((value, column) => value !== grid[rowIndex][column]));
  return { grid: next, moved, score };
}

export function addRandomTile(grid: Grid, random: () => number = Math.random): Grid {
  const empty: Array<[number, number]> = [];
  grid.forEach((row, rowIndex) => row.forEach((value, column) => {
    if (value === 0) empty.push([rowIndex, column]);
  }));
  if (empty.length === 0) return grid;
  const index = Math.min(empty.length - 1, Math.floor(Math.max(0, random()) * empty.length));
  const [row, column] = empty[index];
  const next = grid.map((line) => [...line]);
  next[row][column] = random() < 0.9 ? 2 : 4;
  return next;
}

export function create2048(random: () => number = Math.random): Grid {
  const empty = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  return addRandomTile(addRandomTile(empty, random), random);
}

export function create2048State(random: () => number = Math.random, best = 0): Game2048State {
  return {
    grid: create2048(random),
    score: 0,
    best,
    previous: null,
    won: false,
    newTile: null,
    turn: 0,
  };
}

function findSpawnedTile(before: Grid, after: Grid): TilePosition | null {
  for (let row = 0; row < after.length; row += 1) {
    for (let column = 0; column < after[row].length; column += 1) {
      if (before[row][column] === 0 && after[row][column] !== 0) return [row, column];
    }
  }
  return null;
}

export function apply2048Move(
  state: Game2048State,
  direction: MoveDirection,
  random: () => number = Math.random,
): Game2048State {
  const result = moveGrid(state.grid, direction);
  if (!result.moved) return state;
  const grid = addRandomTile(result.grid, random);
  const score = state.score + result.score;
  return {
    grid,
    score,
    best: Math.max(state.best, score),
    previous: { grid: state.grid, score: state.score, won: state.won, turn: state.turn },
    won: state.won || grid.some((row) => row.some((value) => value >= 2048)),
    newTile: findSpawnedTile(result.grid, grid),
    turn: state.turn + 1,
  };
}

export function undo2048Move(state: Game2048State): Game2048State {
  if (!state.previous) return state;
  return {
    grid: state.previous.grid,
    score: state.previous.score,
    best: state.best,
    previous: null,
    won: state.previous.won,
    newTile: null,
    turn: state.previous.turn,
  };
}

export function isGameOver(grid: Grid): boolean {
  if (grid.some((row) => row.includes(0))) return false;
  return grid.every((row, rowIndex) => row.every((value, column) => (
    grid[rowIndex + 1]?.[column] !== value && row[column + 1] !== value
  )));
}
