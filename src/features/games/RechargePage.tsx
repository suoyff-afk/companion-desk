import { ArrowRight, GameController } from "@phosphor-icons/react";

export interface GameCenterPageProps {
  onNavigate: (view: "game2048" | "gomoku") => void;
}

export function GameCenterPage({ onNavigate }: GameCenterPageProps) {
  return (
    <section className="feature-page game-center-page" aria-labelledby="game-center-title">
      <header className="game-center-page__header">
        <span className="game-center-page__eyebrow"><GameController weight="duotone" /> 本地小游戏</span>
        <h1 id="game-center-title">Game Center</h1>
        <p>选一个轻松的小挑战，随时回来继续。</p>
      </header>

      <div className="game-choice-grid" aria-label="选择游戏">
        <button type="button" className="game-choice game-choice--2048" aria-label="打开 2048" onClick={() => onNavigate("game2048")}>
          <span className="game-choice__preview game-choice__preview--2048" aria-hidden="true">
            <i>2</i><i>4</i><i>8</i><i>16</i>
          </span>
          <span className="game-choice__copy"><strong>2048</strong><small>本地数字拼图</small></span>
          <ArrowRight weight="bold" />
        </button>

        <button type="button" className="game-choice game-choice--gomoku" aria-label="打开五子棋" onClick={() => onNavigate("gomoku")}>
          <span className="game-choice__preview game-choice__preview--gomoku" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <span className="game-choice__copy"><strong>五子棋</strong><small>与 Kunkun 本地对弈</small></span>
          <ArrowRight weight="bold" />
        </button>
      </div>
    </section>
  );
}

export const RechargePage = GameCenterPage;
