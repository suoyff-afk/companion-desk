import { useRef, type PointerEvent } from "react";
import spriteUrl from "../assets/kunkun-spritesheet.webp";

type PetStatus = "ready" | "working" | "resting";

const STATUS_COPY: Record<PetStatus, string> = {
  ready: "Ready when you are.",
  working: "Keeping you company.",
  resting: "Taking a quiet break.",
};

interface PetDockProps {
  status: PetStatus;
  collapsed?: boolean;
  onToggle?: () => void;
  onDragStart?: () => void | Promise<void>;
}

const DRAG_THRESHOLD_PX = 5;

export function PetDock({ status, collapsed = false, onToggle, onDragStart }: PetDockProps) {
  const pointerStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressNextClick = useRef(false);

  const startPetPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!collapsed || onDragStart === undefined || event.button !== 0) return;
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
      void Promise.resolve(onDragStart?.()).catch(() => undefined);
    } catch {
      // A native drag failure must not break later pet clicks.
    }
  };

  const finishPetPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId !== event.pointerId) return;
    pointerStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const togglePet = () => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    onToggle?.();
  };

  const content = (
    <>
      <div
        className="pet-dock__sprite"
        role="img"
        aria-label="kunkun"
        style={{ backgroundImage: `url(${spriteUrl})` }}
      />
      {!collapsed && (
        <div className="pet-dock__copy">
          <strong>kunkun</strong>
          <small>{STATUS_COPY[status]}</small>
        </div>
      )}
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        className={`pet-dock${collapsed ? " pet-dock--collapsed" : ""}`}
        aria-label={collapsed ? "展开 Kunkun" : "收起 Kunkun"}
        onClick={togglePet}
        onPointerDown={startPetPointer}
        onPointerMove={movePetPointer}
        onPointerUp={finishPetPointer}
        onPointerCancel={finishPetPointer}
      >
        {content}
      </button>
    );
  }

  return <section className="pet-dock" aria-label="Kunkun Pet Dock">{content}</section>;
}
