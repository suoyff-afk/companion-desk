export type Stone = "black" | "white";
export type GomokuBoard = Array<Array<Stone | null>>;
export type GomokuMove = readonly [row: number, column: number];

export interface GomokuState {
  board: GomokuBoard;
  current: Stone;
  winner: Stone | null;
  moves: number;
  lastMove: GomokuMove | null;
  winningLine: GomokuMove[];
}

export function createGomoku(size = 15): GomokuState {
  return {
    board: Array.from({ length: size }, () => Array<Stone | null>(size).fill(null)),
    current: "black",
    winner: null,
    moves: 0,
    lastMove: null,
    winningLine: [],
  };
}

function countDirection(board: GomokuBoard, row: number, column: number, rowStep: number, columnStep: number, stone: Stone): number {
  let count = 0;
  let nextRow = row + rowStep;
  let nextColumn = column + columnStep;
  while (board[nextRow]?.[nextColumn] === stone) {
    count += 1;
    nextRow += rowStep;
    nextColumn += columnStep;
  }
  return count;
}

const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

function findWinningLine(board: GomokuBoard, row: number, column: number, stone: Stone): GomokuMove[] {
  for (const [rowStep, columnStep] of DIRECTIONS) {
    const backward = countDirection(board, row, column, -rowStep, -columnStep, stone);
    const forward = countDirection(board, row, column, rowStep, columnStep, stone);
    if (backward + 1 + forward < 5) continue;
    const line: GomokuMove[] = [];
    for (let offset = -backward; offset <= forward; offset += 1) {
      line.push([row + offset * rowStep, column + offset * columnStep]);
    }
    const placedIndex = backward;
    const start = Math.max(0, Math.min(placedIndex, line.length - 5));
    return line.slice(start, start + 5);
  }
  return [];
}

export function placeStone(state: GomokuState, row: number, column: number): GomokuState {
  if (state.winner || !state.board[row] || state.board[row][column] !== null) return state;
  const board = state.board.map((line) => [...line]);
  board[row][column] = state.current;
  const winningLine = findWinningLine(board, row, column, state.current);
  const winner = winningLine.length ? state.current : null;
  return {
    board,
    current: state.current === "black" ? "white" : "black",
    winner,
    moves: state.moves + 1,
    lastMove: [row, column],
    winningLine,
  };
}

function candidateMoves(board: GomokuBoard): GomokuMove[] {
  const candidates = new Set<string>();
  let hasStone = false;
  board.forEach((line, row) => line.forEach((stone, column) => {
    if (!stone) return;
    hasStone = true;
    for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
      for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        if (board[nextRow]?.[nextColumn] === null) candidates.add(`${nextRow},${nextColumn}`);
      }
    }
  }));
  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    return [[center, center]];
  }
  return [...candidates]
    .map((value) => value.split(",").map(Number) as [number, number])
    .sort(([rowA, columnA], [rowB, columnB]) => rowA - rowB || columnA - columnB);
}

function wouldWin(board: GomokuBoard, [row, column]: GomokuMove, stone: Stone): boolean {
  const trial = [...board];
  trial[row] = [...board[row]];
  trial[row][column] = stone;
  return findWinningLine(trial, row, column, stone).length === 5;
}

function lineScore(board: GomokuBoard, row: number, column: number, stone: Stone): number {
  return DIRECTIONS.reduce((score, [rowStep, columnStep]) => {
    const connected = countDirection(board, row, column, rowStep, columnStep, stone)
      + countDirection(board, row, column, -rowStep, -columnStep, stone);
    return score + connected * connected;
  }, 0);
}

export function chooseGomokuMove(board: GomokuBoard): GomokuMove | null {
  const candidates = candidateMoves(board);
  if (!candidates.length) return null;

  const winningMove = candidates.find((move) => wouldWin(board, move, "white"));
  if (winningMove) return winningMove;
  const blockingMove = candidates.find((move) => wouldWin(board, move, "black"));
  if (blockingMove) return blockingMove;

  const center = (board.length - 1) / 2;
  return [...candidates].sort(([rowA, columnA], [rowB, columnB]) => {
    const scoreA = lineScore(board, rowA, columnA, "white") * 12
      + lineScore(board, rowA, columnA, "black") * 10
      - (Math.abs(rowA - center) + Math.abs(columnA - center));
    const scoreB = lineScore(board, rowB, columnB, "white") * 12
      + lineScore(board, rowB, columnB, "black") * 10
      - (Math.abs(rowB - center) + Math.abs(columnB - center));
    return scoreB - scoreA || rowA - rowB || columnA - columnB;
  })[0];
}
