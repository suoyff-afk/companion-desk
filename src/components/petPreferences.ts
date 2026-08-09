export type PetSize = "small" | "standard" | "large";
export type DockSide = "left" | "right" | null;

export interface PetPreferences {
  size: PetSize;
  dockSide: DockSide;
  reactionsEnabled: boolean;
}

export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  size: "standard",
  dockSide: null,
  reactionsEnabled: true,
};

export const PET_SIZE_SCALES: Record<PetSize, number> = {
  small: 0.75,
  standard: 1,
  large: 1.25,
};

export function isPetSize(value: unknown): value is PetSize {
  return value === "small" || value === "standard" || value === "large";
}

export function normalizePetPreferences(value: unknown): PetPreferences {
  if (typeof value !== "object" || value === null) return DEFAULT_PET_PREFERENCES;
  const candidate = value as Partial<PetPreferences>;
  return {
    size: isPetSize(candidate.size) ? candidate.size : DEFAULT_PET_PREFERENCES.size,
    dockSide: candidate.dockSide === "left" || candidate.dockSide === "right"
      ? candidate.dockSide
      : null,
    reactionsEnabled: typeof candidate.reactionsEnabled === "boolean"
      ? candidate.reactionsEnabled
      : DEFAULT_PET_PREFERENCES.reactionsEnabled,
  };
}

export function idleReactionDelay(randomValue: number): number {
  const normalized = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0;
  return (8 + 7 * normalized) * 60_000;
}
