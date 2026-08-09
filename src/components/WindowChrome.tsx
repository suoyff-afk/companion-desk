import { ArrowLeft, ArrowsOutSimple, X } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import spriteUrl from "../assets/kunkun-spritesheet.webp";

export interface WindowChromeBridge {
  toggleMaximize(): Promise<void>;
}

const desktopWindowChromeBridge: WindowChromeBridge = {
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
};

interface WindowChromeProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  showMaximize?: boolean;
  bridge?: WindowChromeBridge;
}

export function WindowChrome({ title, onBack, backLabel = "返回主页", onClose, showMaximize = false, bridge = desktopWindowChromeBridge }: WindowChromeProps) {
  const mountedRef = useRef(true);
  const maximizingRef = useRef(false);
  const [maximizing, setMaximizing] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const toggleMaximize = () => {
    if (maximizingRef.current) return;
    maximizingRef.current = true;
    setMaximizing(true);

    const finish = () => {
      maximizingRef.current = false;
      if (mountedRef.current) setMaximizing(false);
    };
    try {
      void bridge.toggleMaximize().catch(() => undefined).finally(finish);
    } catch {
      finish();
    }
  };

  return (
    <header className="window-chrome">
      {onBack && (
        <button type="button" className="window-chrome__back" aria-label={backLabel} onClick={onBack}>
          <ArrowLeft />
        </button>
      )}
      <div
        className="window-chrome__avatar"
        aria-label="Kunkun 头像"
        style={{ backgroundImage: `url(${spriteUrl})` }}
      />
      <div
        className="window-chrome__drag"
        aria-label="Window drag region"
        data-tauri-drag-region=""
      >
        <strong>{title}</strong>
      </div>
      <div className="window-chrome__controls" aria-label="Window controls">
        {showMaximize && (
          <button
            type="button"
            aria-label="最大化或还原"
            aria-busy={maximizing}
            disabled={maximizing}
            onClick={toggleMaximize}
          >
            <ArrowsOutSimple />
          </button>
        )}
        <button type="button" className="window-chrome__close" aria-label="关闭面板，返回宠物" onClick={onClose}><X /></button>
      </div>
    </header>
  );
}
