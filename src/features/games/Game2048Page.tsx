import { Game2048Board } from "./Game2048Board";

export function Game2048Page({ active = true }: { active?: boolean }) {
  return (
    <section className="feature-page game-page game-2048-page" aria-label="2048 游戏">
      <article className="glass-panel game-page__surface">
        <Game2048Board active={active} />
      </article>
    </section>
  );
}
