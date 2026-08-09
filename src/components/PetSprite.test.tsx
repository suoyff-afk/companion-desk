// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PET_SPRITE_CELL_WIDTH,
  PET_SPRITE_REACTIONS,
  PetSprite,
  getPetSpriteFrameOffsets,
} from "./PetSprite";

afterEach(cleanup);

describe("PetSprite", () => {
  it("maps only the approved non-empty sprite rows and frame counts", () => {
    expect(PET_SPRITE_REACTIONS).toEqual({
      idle: { row: 0, frames: 6 },
      waving: { row: 3, frames: 4 },
      jumping: { row: 4, frames: 5 },
      happy: { row: 8, frames: 6 },
    });
  });

  it("renders one background-image sprite element without duplicate image nodes", () => {
    const { container, rerender } = render(<PetSprite reaction="idle" />);

    expect(container.querySelectorAll(".pet-sprite")).toHaveLength(1);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "idle");

    rerender(<PetSprite reaction="jumping" />);
    const sprite = container.querySelector<HTMLElement>(".pet-sprite");
    expect(container.querySelectorAll(".pet-sprite")).toHaveLength(1);
    expect(sprite).toHaveAttribute("data-reaction", "jumping");
    expect(sprite?.style.getPropertyValue("--pet-sprite-row")).toBe("4");
    expect(sprite?.style.getPropertyValue("--pet-sprite-frames")).toBe("5");
    expect(sprite?.style.getPropertyValue("--pet-sprite-animation-end")).toBe("-960px");
  });

  it.each(Object.keys(PET_SPRITE_REACTIONS) as Array<keyof typeof PET_SPRITE_REACTIONS>)(
    "visits every approved %s frame once without entering the next frame",
    (reaction) => {
      const { frames } = PET_SPRITE_REACTIONS[reaction];
      const offsets = getPetSpriteFrameOffsets(reaction);

      expect(offsets).toEqual(
        Array.from({ length: frames }, (_, frame) => -frame * PET_SPRITE_CELL_WIDTH),
      );
      expect(offsets).toHaveLength(frames);
      expect(offsets.at(-1)).toBe(-(frames - 1) * PET_SPRITE_CELL_WIDTH);
      expect(offsets).not.toContain(-frames * PET_SPRITE_CELL_WIDTH);
    },
  );
});
