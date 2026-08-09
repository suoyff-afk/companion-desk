import type { CSSProperties } from "react";

import spriteSheetUrl from "../assets/kunkun-spritesheet.webp";

export const PET_SPRITE_REACTIONS = {
  idle: { row: 0, frames: 6 },
  waving: { row: 3, frames: 4 },
  jumping: { row: 4, frames: 5 },
  happy: { row: 8, frames: 6 },
} as const;

export const PET_SPRITE_CELL_WIDTH = 192;
export const PET_SPRITE_CELL_HEIGHT = 208;

export type PetReaction = keyof typeof PET_SPRITE_REACTIONS;

export function getPetSpriteFrameOffsets(reaction: PetReaction): number[] {
  return Array.from(
    { length: PET_SPRITE_REACTIONS[reaction].frames },
    (_, frame) => -frame * PET_SPRITE_CELL_WIDTH,
  );
}

interface PetSpriteProps {
  reaction?: PetReaction;
  className?: string;
}

export function PetSprite({ reaction = "idle", className = "" }: PetSpriteProps) {
  const animation = PET_SPRITE_REACTIONS[reaction];
  const style = {
    "--pet-sprite-row": animation.row,
    "--pet-sprite-frames": animation.frames,
    "--pet-sprite-row-position": `${-animation.row * PET_SPRITE_CELL_HEIGHT}px`,
    "--pet-sprite-animation-end": `${-animation.frames * PET_SPRITE_CELL_WIDTH}px`,
    backgroundImage: `url("${spriteSheetUrl}")`,
  } as CSSProperties;

  return (
    <span
      className={`pet-sprite${className ? ` ${className}` : ""}`}
      data-reaction={reaction}
      style={style}
      aria-hidden="true"
    />
  );
}
