import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { PetSprite, type PetReaction } from "./PetSprite";
import type { QuotaState } from "../features/quota/quotaController";
import { PET_SIZE_SCALES, type DockSide, type PetSize } from "./petPreferences";

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const COLLAPSED_GEOMETRY = {
  ring: { x: 30, y: 35, width: 105, height: 105 },
  pet: { x: 18, y: 8, width: 120, height: 130 },
  quota: { x: 96, y: 72, width: 35, height: 22 },
  face: { x: 46, y: 18, width: 57, height: 48 },
  bubble: { x: 138, y: 28, width: 150, height: 44 },
  unread: { x: 128, y: 16, width: 10, height: 10 },
} as const satisfies Record<string, Rectangle>;

const COLLAPSED_GEOMETRY_STYLE = {
  "--collapsed-ring-x": `${COLLAPSED_GEOMETRY.ring.x}px`,
  "--collapsed-ring-y": `${COLLAPSED_GEOMETRY.ring.y}px`,
  "--collapsed-ring-width": `${COLLAPSED_GEOMETRY.ring.width}px`,
  "--collapsed-ring-height": `${COLLAPSED_GEOMETRY.ring.height}px`,
  "--collapsed-pet-x": `${COLLAPSED_GEOMETRY.pet.x}px`,
  "--collapsed-pet-y": `${COLLAPSED_GEOMETRY.pet.y}px`,
  "--collapsed-pet-width": `${COLLAPSED_GEOMETRY.pet.width}px`,
  "--collapsed-pet-height": `${COLLAPSED_GEOMETRY.pet.height}px`,
  "--collapsed-quota-x": `${COLLAPSED_GEOMETRY.quota.x}px`,
  "--collapsed-quota-y": `${COLLAPSED_GEOMETRY.quota.y}px`,
  "--collapsed-quota-width": `${COLLAPSED_GEOMETRY.quota.width}px`,
  "--collapsed-quota-height": `${COLLAPSED_GEOMETRY.quota.height}px`,
  "--collapsed-bubble-x": `${COLLAPSED_GEOMETRY.bubble.x}px`,
  "--collapsed-bubble-y": `${COLLAPSED_GEOMETRY.bubble.y}px`,
  "--collapsed-bubble-width": `${COLLAPSED_GEOMETRY.bubble.width}px`,
  "--collapsed-bubble-height": `${COLLAPSED_GEOMETRY.bubble.height}px`,
  "--collapsed-unread-x": `${COLLAPSED_GEOMETRY.unread.x}px`,
  "--collapsed-unread-y": `${COLLAPSED_GEOMETRY.unread.y}px`,
  "--collapsed-unread-width": `${COLLAPSED_GEOMETRY.unread.width}px`,
  "--collapsed-unread-height": `${COLLAPSED_GEOMETRY.unread.height}px`,
} as CSSProperties;

export function rectanglesOverlap(a: Rectangle, b: Rectangle) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

interface CollapsedCompanionProps {
  quota?: Readonly<QuotaState>;
  value?: string | number;
  unit?: string;
  label: string;
  notification?: {
    sender: string;
    message: string;
  };
  reaction?: PetReaction;
  onOpen: () => void;
  onFocus?: () => void;
  onPlay?: () => void;
  onHide?: () => void;
  onExit?: () => void;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  petSize?: PetSize;
  onPetSizeChange?: (size: PetSize) => void;
  dockSide?: DockSide;
  reactionsEnabled?: boolean;
  onReactionsEnabledChange?: (enabled: boolean) => void;
  onCenter?: () => void;
  onRestoreDefault?: () => void;
  onDragStart: () => void | Promise<void>;
}

const DRAG_THRESHOLD_PX = 5;

export function CollapsedCompanion({
  quota,
  value,
  unit,
  label,
  notification,
  reaction = "idle",
  onOpen,
  onFocus = onOpen,
  onPlay = onOpen,
  onHide = () => undefined,
  onExit = () => undefined,
  menuOpen = false,
  onMenuOpenChange = () => undefined,
  petSize = "standard",
  onPetSizeChange = () => undefined,
  dockSide = null,
  reactionsEnabled = true,
  onReactionsEnabledChange = () => undefined,
  onCenter = () => undefined,
  onRestoreDefault = () => undefined,
  onDragStart,
}: CollapsedCompanionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const petTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreMenuFocusRef = useRef(false);
  const pointerStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressNextClick = useRef(false);

  const setMenuVisibility = (open: boolean, restoreFocus = false) => {
    if (!open && restoreFocus) restoreMenuFocusRef.current = true;
    onMenuOpenChange(open);
  };

  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')?.focus();
      return;
    }
    if (restoreMenuFocusRef.current) {
      restoreMenuFocusRef.current = false;
      petTriggerRef.current?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismissPointer = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuVisibility(false);
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setMenuVisibility(false, true);
      }
    };
    window.addEventListener("pointerdown", dismissPointer);
    window.addEventListener("keydown", dismissKey);
    return () => {
      window.removeEventListener("pointerdown", dismissPointer);
      window.removeEventListener("keydown", dismissKey);
    };
  }, [menuOpen]);

  const startPetPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    suppressNextClick.current = false;
    pointerStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePetPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (start === null || start.pointerId !== event.pointerId || start.dragging) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= DRAG_THRESHOLD_PX) return;

    start.dragging = true;
    suppressNextClick.current = true;
    event.preventDefault();
    try {
      void Promise.resolve(onDragStart()).catch(() => undefined);
    } catch {
      // Native drag failures must not break later companion clicks.
    }
  };

  const finishPetPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId !== event.pointerId) return;
    pointerStart.current = null;
    try {
      const hasCapture = event.currentTarget.hasPointerCapture?.(event.pointerId) ?? true;
      if (hasCapture) event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Capture may already have been released by the native window drag.
    }
  };

  const losePetPointerCapture = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
  };

  const openCompanion = () => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    onOpen();
  };

  const interactionCopy = notification === undefined
    ? undefined
    : `${notification.sender} ${notification.message}`;
  const quotaPercent = quota?.snapshot?.shortWindow
    ? Math.round(Math.max(0, Math.min(100, quota.snapshot.shortWindow.remainingPercent)))
    : null;
  const resolvedValue = value ?? quotaPercent ?? "--";
  const resolvedUnit = unit ?? (quotaPercent === null ? "暂不可用" : "%");

  const runMenuAction = (action: () => void) => {
    setMenuVisibility(false);
    action();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuVisibility(false, true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="collapsed-companion collapsed-companion--approved"
      data-tauri-drag-region=""
      data-notification-state={notification === undefined ? "hidden" : "visible"}
      data-dock-side={dockSide ?? undefined}
      style={{ ...COLLAPSED_GEOMETRY_STYLE, "--companion-scale": PET_SIZE_SCALES[petSize] } as CSSProperties}
    >
      <div className="collapsed-companion__visual">
        <div className="collapsed-companion__ring" aria-hidden="true" />
        <span className="collapsed-companion__orbit" aria-hidden="true" />
        <button
          ref={petTriggerRef}
          type="button"
          className="collapsed-companion__pet"
          aria-label="展开 Companion Desk"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={openCompanion}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuVisibility(true);
          }}
          onPointerDown={startPetPointer}
          onPointerMove={movePetPointer}
          onPointerUp={finishPetPointer}
          onPointerCancel={finishPetPointer}
          onLostPointerCapture={losePetPointerCapture}
        >
          <PetSprite reaction={reaction} />
        </button>
        <div className="collapsed-companion__quota" role="group" aria-label={`${label}：${resolvedValue}${resolvedUnit}`}>
          <strong aria-hidden="true">{resolvedValue}</strong>
          <small aria-hidden="true">{resolvedUnit}</small>
        </div>
        {notification !== undefined && <span className="collapsed-companion__unread" aria-hidden="true" />}
      </div>
      {quota?.snapshot?.status === "stale" && quota.updatedAt && (
        <span className="sr-only" role="status">数据可能过期。最后更新：<time dateTime={quota.updatedAt}>{quota.updatedAt}</time></span>
      )}
      {menuOpen && (
        <div
          ref={menuRef}
          className="collapsed-companion__menu"
          role="menu"
          aria-label="宠物菜单"
          onKeyDown={handleMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => runMenuAction(onOpen)}>打开 Desk</button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onFocus)}>专注</button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onPlay)}>玩一下</button>
          <span className="collapsed-companion__menu-divider" aria-hidden="true" />
          <span className="collapsed-companion__menu-label">宠物大小</span>
          {(["small", "standard", "large"] as const).map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={petSize === size}
              onClick={() => runMenuAction(() => onPetSizeChange(size))}
            >
              {{ small: "小", standard: "标准", large: "大" }[size]}
            </button>
          ))}
          <span className="collapsed-companion__menu-divider" aria-hidden="true" />
          <button type="button" role="menuitem" onClick={() => runMenuAction(onCenter)}>移到屏幕中央</button>
          <button type="button" role="menuitemcheckbox" aria-checked={reactionsEnabled} onClick={() => runMenuAction(() => onReactionsEnabledChange(!reactionsEnabled))}>偶尔挥手</button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onRestoreDefault)}>恢复默认</button>
          <span className="collapsed-companion__menu-divider" aria-hidden="true" />
          <button type="button" role="menuitem" onClick={() => runMenuAction(onHide)}>暂时隐藏</button>
          <button type="button" role="menuitem" className="collapsed-companion__menu-exit" onClick={() => runMenuAction(onExit)}>退出应用</button>
        </div>
      )}
      {notification !== undefined && (
        <>
          <div
            className="collapsed-companion__bubble"
            role="status"
            aria-label={`未读互动：${interactionCopy}`}
          >
            <strong>{notification.sender}</strong>
            {" "}
            <span>{notification.message}</span>
          </div>
        </>
      )}
    </div>
  );
}
