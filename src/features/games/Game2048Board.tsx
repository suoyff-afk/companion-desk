import { ArrowCounterClockwise, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUUpLeft } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apply2048Move,
  create2048State,
  isGameOver,
  randomFromRolls,
  undo2048Move,
  type MoveDirection,
} from "./game2048";

const BEST_SCORE_KEY = "kunkun-desk.game2048.best";
const SWIPE_THRESHOLD = 30;
const CREATE_ROLL_COUNT = 4;
const MOVE_ROLL_COUNT = 2;

function sampleRolls(count: number): number[] {
  return Array.from({ length: count }, () => Math.random());
}

const INITIAL_ROLLS = sampleRolls(CREATE_ROLL_COUNT);

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    || target.isContentEditable
    || Boolean(target.closest('[contenteditable="true"]'));
}

function readBestScore(): number {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(BEST_SCORE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeBestScore(value: number): void {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch {
    // Storage can be unavailable in privacy-restricted browser and desktop webviews.
  }
}

export function Game2048Board() {
  const [game, setGame] = useState(() => create2048State(randomFromRolls(INITIAL_ROLLS), readBestScore()));
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const move = useCallback((direction: MoveDirection) => {
    const rolls = sampleRolls(MOVE_ROLL_COUNT);
    setGame((current) => apply2048Move(current, direction, randomFromRolls(rolls)));
  }, []);

  useEffect(() => { writeBestScore(game.best); }, [game.best]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditingTarget(event.target)) return;
      const directions: Record<string, MoveDirection | undefined> = {
        ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      };
      const direction = directions[event.key];
      if (direction) { event.preventDefault(); move(direction); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const reset = () => {
    const rolls = sampleRolls(CREATE_ROLL_COUNT);
    setGame((current) => create2048State(randomFromRolls(rolls), current.best));
  };

  const finishSwipe = (x: number, y: number) => {
    if (!swipeStart.current) return;
    const deltaX = x - swipeStart.current.x;
    const deltaY = y - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_THRESHOLD) return;
    if (Math.abs(deltaX) > Math.abs(deltaY)) move(deltaX > 0 ? "right" : "left");
    else move(deltaY > 0 ? "down" : "up");
  };

  const gameOver = isGameOver(game.grid);

  return (
    <section className="game-surface game-2048-surface">
      <header className="game-surface__header game-2048-header">
        <div><h2>2048</h2><span>数字拼图 · Join the numbers</span></div>
        <div className="score-2048" aria-label="2048 scores">
          <span><small>Score</small><strong>{game.score}</strong></span>
          <span><small>Best</small><strong>{game.best}</strong></span>
        </div>
        <div className="game-actions">
          <button type="button" onClick={() => setGame(undo2048Move)} disabled={!game.previous}><ArrowUUpLeft />Undo</button>
          <button type="button" onClick={reset}><ArrowCounterClockwise />New game</button>
        </div>
      </header>
      {game.won && <p className="game-banner game-banner--win" aria-live="polite"><strong>2048 reached!</strong> Keep going for a higher score.</p>}
      {gameOver && <p className="game-banner game-banner--over" aria-live="polite"><strong>Game over.</strong> No moves left — undo or start a new game.</p>}
      <div
        className="board-2048"
        aria-label="2048 board"
        onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => finishSwipe(event.clientX, event.clientY)}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        {game.grid.flatMap((row, rowIndex) => row.map((value, column) => {
          const isNew = game.newTile?.[0] === rowIndex && game.newTile[1] === column;
          return (
            <div
              key={`${rowIndex}-${column}-${isNew ? game.turn : "steady"}`}
              className={`tile-2048 tile-2048--${Math.min(value, 2048)}${isNew ? " tile-2048--new" : ""}`}
            >
              {value || ""}
            </div>
          );
        }))}
      </div>
      <div className="controls-2048" aria-label="2048 controls">
        <span />
        <button type="button" aria-label="Move up" onClick={() => move("up")}><ArrowUp /></button>
        <span />
        <button type="button" aria-label="Move left" onClick={() => move("left")}><ArrowLeft /></button>
        <button type="button" aria-label="Move down" onClick={() => move("down")}><ArrowDown /></button>
        <button type="button" aria-label="Move right" onClick={() => move("right")}><ArrowRight /></button>
      </div>
      <p className="controls-2048__hint">Arrow keys, controls, or swipe to move</p>
    </section>
  );
}
