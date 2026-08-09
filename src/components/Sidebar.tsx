import {
  Brain,
  ChartLineUp,
  Cube,
  TerminalWindow,
  Timer,
} from "@phosphor-icons/react";
import { NAV_ITEMS, type PageId } from "../app/navigation";
import { PetDock } from "./PetDock";

const NAV_ICONS = {
  token: ChartLineUp,
  focus: Timer,
  recharge: Brain,
  hpc: TerminalWindow,
} as const;

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <div className="app-brand" aria-label="Companion Desk">
        <span className="app-brand__mark"><Cube weight="fill" /></span>
        <span className="app-brand__text">Companion</span>
      </div>

      <nav className="app-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = NAV_ICONS[item.id];
          const selected = item.id === activePage;

          return (
            <button
              className={`app-nav__item${selected ? " app-nav__item--active" : ""}`}
              key={item.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={25} weight={selected ? "duotone" : "regular"} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.zh}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <PetDock status="ready" />
    </aside>
  );
}
