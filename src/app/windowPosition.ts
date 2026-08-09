export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecoveredPosition {
  x: number;
  y: number;
  recovered: boolean;
}

function finiteRect(rect: PhysicalRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && rect.width > 0
    && Number.isFinite(rect.height)
    && rect.height > 0;
}

function intersectionSize(a: PhysicalRect, b: PhysicalRect) {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

function intersectionArea(a: PhysicalRect, b: PhysicalRect): number {
  const intersection = intersectionSize(a, b);
  return intersection.width * intersection.height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function distanceSquaredToRect(x: number, y: number, rect: PhysicalRect): number {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2;
}

export function recoverWindowPosition(
  windowRect: PhysicalRect,
  workAreas: readonly PhysicalRect[],
  fallbackWorkArea?: PhysicalRect,
  visibleWidth = 48,
  visibleHeight = 32,
): RecoveredPosition {
  const validAreas = workAreas.filter(finiteRect);
  const candidateAreas = validAreas.length > 0
    ? validAreas
    : (fallbackWorkArea !== undefined && finiteRect(fallbackWorkArea) ? [fallbackWorkArea] : []);

  if (finiteRect(windowRect)) {
    const titleBar = { ...windowRect, height: Math.min(windowRect.height, visibleHeight) };
    const reachableAreas = candidateAreas.filter((area) => {
      const intersection = intersectionSize(titleBar, area);
      return intersection.width >= Math.min(visibleWidth, windowRect.width)
        && intersection.height >= Math.min(visibleHeight, titleBar.height);
    });
    if (reachableAreas.length > 0) {
      const area = reachableAreas.reduce((best, candidate) => (
        intersectionArea(windowRect, candidate) > intersectionArea(windowRect, best) ? candidate : best
      ));
      if (windowRect.width <= area.width && windowRect.height <= area.height) {
        const x = Math.round(clamp(windowRect.x, area.x, area.x + area.width - windowRect.width));
        const y = Math.round(clamp(windowRect.y, area.y, area.y + area.height - windowRect.height));
        return { x, y, recovered: x !== windowRect.x || y !== windowRect.y };
      }
      return { x: windowRect.x, y: windowRect.y, recovered: false };
    }
    if (candidateAreas.length === 0) return { x: windowRect.x, y: windowRect.y, recovered: false };
  }

  const area = candidateAreas.reduce((nearest, candidate) => {
    if (nearest === null) return candidate;
    const centerX = Number.isFinite(windowRect.x) && Number.isFinite(windowRect.width)
      ? windowRect.x + windowRect.width / 2
      : candidate.x + candidate.width / 2;
    const centerY = Number.isFinite(windowRect.y) && Number.isFinite(windowRect.height)
      ? windowRect.y + windowRect.height / 2
      : candidate.y + candidate.height / 2;
    return distanceSquaredToRect(centerX, centerY, candidate) < distanceSquaredToRect(centerX, centerY, nearest)
      ? candidate
      : nearest;
  }, null as PhysicalRect | null);

  if (area === null) return { x: 0, y: 0, recovered: true };
  const width = Number.isFinite(windowRect.width) && windowRect.width > 0 ? windowRect.width : 0;
  const height = Number.isFinite(windowRect.height) && windowRect.height > 0 ? windowRect.height : 0;
  return {
    x: Math.round(area.x + Math.max(0, area.width - width) / 2),
    y: Math.round(area.y + Math.max(0, area.height - height) / 2),
    recovered: true,
  };
}
