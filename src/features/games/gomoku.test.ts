import { describe, expect, it } from "vitest";
import { chooseGomokuMove, createGomoku, placeStone, type GomokuBoard } from "./gomoku";

function play(moves: ReadonlyArray<readonly [number, number]>) {
  return moves.reduce((state, [row, column]) => placeStone(state, row, column), createGomoku());
}

describe("gomoku", () => {
  it.each([
    ["horizontal", [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]]],
    ["vertical", [[3, 7], [0, 0], [4, 7], [0, 1], [5, 7], [0, 2], [6, 7], [0, 3], [7, 7]]],
    ["down diagonal", [[3, 3], [0, 1], [4, 4], [0, 2], [5, 5], [0, 3], [6, 6], [0, 4], [7, 7]]],
    ["up diagonal", [[7, 3], [0, 0], [6, 4], [0, 1], [5, 5], [0, 2], [4, 6], [0, 3], [3, 7]]],
  ] as const)("detects a %s win", (_name, moves) => {
    expect(play(moves).winner).toBe("black");
  });

  it("rejects occupied cells and stops after a win", () => {
    const first = placeStone(createGomoku(), 2, 2);
    expect(placeStone(first, 2, 2)).toBe(first);

    const won = play([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]]);
    expect(placeStone(won, 8, 8)).toBe(won);
  });

  it("records the last move and the exact winning line", () => {
    const won = play([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]]);

    expect(won.lastMove).toEqual([7, 7]);
    expect(won.winningLine).toEqual([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
  });

  it("lets Kunkun take an immediate win", () => {
    const board = createGomoku().board;
    board[7][3] = "white";
    board[7][4] = "white";
    board[7][5] = "white";
    board[7][6] = "white";
    board[7][2] = "black";
    board[6][6] = "black";

    expect(chooseGomokuMove(board)).toEqual([7, 7]);
  });

  it("blocks the player's immediate win when Kunkun cannot win", () => {
    const board = createGomoku().board;
    board[5][4] = "black";
    board[5][5] = "black";
    board[5][6] = "black";
    board[5][7] = "black";
    board[5][3] = "white";
    board[4][7] = "white";

    expect(chooseGomokuMove(board)).toEqual([5, 8]);
  });

  it("evaluates winning moves without writing to the provided board", () => {
    const board = createGomoku().board;
    board[7][3] = "white";
    board[7][4] = "white";
    board[7][5] = "white";
    board[7][6] = "white";
    board.forEach(Object.freeze);
    Object.freeze(board);

    expect(chooseGomokuMove(board)).toEqual([7, 2]);
  });

  it("chooses deterministically and opens at the center", () => {
    const empty = createGomoku().board;
    expect(chooseGomokuMove(empty)).toEqual([7, 7]);

    const board: GomokuBoard = empty.map((row) => [...row]);
    board[7][7] = "black";
    expect(chooseGomokuMove(board)).toEqual(chooseGomokuMove(board));
  });
});
