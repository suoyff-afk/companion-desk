import type { ReactNode } from "react";
import type { AppView } from "../app/navigation";
import { WindowChrome, type WindowChromeBridge } from "./WindowChrome";

interface AppShellProps {
  view: AppView;
  title: string;
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  chromeBridge?: WindowChromeBridge;
  children: ReactNode;
}

export function AppShell({ view, title, onBack, backLabel, onClose, chromeBridge, children }: AppShellProps) {
  const collapsed = view === "collapsed";
  const showMaximize = view === "token" || view === "hpc";

  return (
    <div
      className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`}
      data-material="glass"
      data-view={view}
    >
      {!collapsed && (
        <WindowChrome
          title={title}
          onBack={onBack}
          backLabel={backLabel}
          onClose={onClose}
          showMaximize={showMaximize}
          bridge={chromeBridge}
        />
      )}
      <main className="app-main" data-view={view}>
        {children}
      </main>
    </div>
  );
}
