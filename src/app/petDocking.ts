import type { DockSide } from "../components/petPreferences";
import type { PhysicalRect } from "./windowPosition";

export interface DockTarget {
  side: Exclude<DockSide, null>;
  x: number;
  y: number;
}

export function placeDockedWindow(
  windowRect: PhysicalRect,
  workArea: PhysicalRect,
  side: Exclude<DockSide, null>,
): DockTarget {
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - windowRect.height);
  return {
    side,
    x: side === "left" ? workArea.x : workArea.x + workArea.width - windowRect.width,
    y: Math.min(maxY, Math.max(minY, windowRect.y)),
  };
}

export function findDockTarget(
  windowRect: PhysicalRect,
  workArea: PhysicalRect,
  threshold = 24,
): DockTarget | null {
  const leftDistance = Math.abs(windowRect.x - workArea.x);
  const rightEdge = workArea.x + workArea.width;
  const rightDistance = Math.abs(windowRect.x + windowRect.width - rightEdge);
  const side = leftDistance <= threshold
    ? "left"
    : rightDistance <= threshold
      ? "right"
      : null;
  if (side === null) return null;

  return placeDockedWindow(windowRect, workArea, side);
}
