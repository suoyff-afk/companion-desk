import { ArrowCounterClockwise, ArrowUUpLeft } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { chooseGomokuMove, createGomoku, placeStone, type GomokuState } from "./gomoku";

const STAR_POINTS = new Set(["3,3", "3,11", "7,7", "11,3", "11,11"]);

export function GomokuBoard() {
  const [game, setGame] = useState(createGomoku);
  const [history, setHistory] = useState<GomokuState[]>([]);
  const [thinking, setThinking] = useState(false);
  const size = game.board.length;
  const isDraw = !game.winner && game.moves === size * size;
  const winningCells = useMemo(() => new Set(game.winningLine.map(([row, column]) => `${row},${column}`)), [game.winningLine]);

  useEffect(() => {
    if (!thinking) return;
    const timer = window.setTimeout(() => {
      const move = chooseGomokuMove(game.board);
      setGame((current) => move ? placeStone(current, move[0], move[1]) : current);
      setThinking(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [game.board, thinking]);

  const play = (row: number, column: number) => {
    if (thinking || game.current !== "black" || game.winner || isDraw) return;
    const next = placeStone(game, row, column);
    if (next === game) return;
    setHistory((states) => [...states, game]);
    setGame(next);
    if (!next.winner && next.moves < size * size) setThinking(true);
  };

  const reset = () => {
    setThinking(false);
    setHistory([]);
    setGame(createGomoku());
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setThinking(false);
    setGame(previous);
    setHistory((states) => states.slice(0, -1));
  };

  const status = game.winner === "black"
    ? "You win!"
    : game.winner === "white"
      ? "Kunkun wins!"
      : isDraw
        ? "Draw"
        : thinking
          ? "Kunkun thinking…"
          : "Your turn";

  return (
    <section className="game-surface gomoku-surface">
      <header className="game-surface__header">
        <div><h2>Gomoku</h2><span>五子棋 · {status}</span></div>
        <div className="game-actions">
          <button type="button" onClick={undo} disabled={!history.length}><ArrowUUpLeft />Undo</button>
          <button type="button" onClick={reset}><ArrowCounterClockwise />New game</button>
        </div>
      </header>
      <div className="gomoku-status" aria-label="Gomoku players" aria-live="polite">
        <span className={!thinking && !game.winner && !isDraw ? "is-active" : ""}><i className="gomoku-player-stone gomoku-player-stone--black" />You</span>
        <strong>{status}</strong>
        <span className={thinking ? "is-active" : ""}><i className="gomoku-player-stone gomoku-player-stone--white" />Kunkun</span>
      </div>
      <div className="gomoku-board" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }} aria-busy={thinking}>
        {game.board.map((row, rowIndex) => row.map((stone, columnIndex) => {
          const key = `${rowIndex},${columnIndex}`;
          const isLast = game.lastMove?.[0] === rowIndex && game.lastMove[1] === columnIndex;
          const className = [
            STAR_POINTS.has(key) ? "gomoku-cell--star" : "",
            isLast ? "gomoku-cell--last" : "",
            winningCells.has(key) ? "gomoku-cell--winning" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              type="button"
              key={key}
              className={className}
              aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}: ${stone ?? "empty"}`}
              disabled={thinking || game.current !== "black" || Boolean(game.winner) || isDraw || Boolean(stone)}
              onClick={() => play(rowIndex, columnIndex)}
            >
              {stone && <span className={`gomoku-stone gomoku-stone--${stone}`} />}
            </button>
          );
        }))}
      </div>
    </section>
  );
}
