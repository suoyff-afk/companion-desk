import { GomokuBoard } from "./GomokuBoard";

export function GomokuPage() {
  return (
    <section className="feature-page game-page gomoku-page" aria-label="五子棋游戏">
      <article className="glass-panel game-page__surface">
        <GomokuBoard />
      </article>
    </section>
  );
}
