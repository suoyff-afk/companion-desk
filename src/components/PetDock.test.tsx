// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PetDock } from "./PetDock";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { button?: number; pointerId: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

it("shows kunkun as a persistent local companion", () => {
  render(<PetDock status="ready" />);

  expect(screen.getByRole("region", { name: "Kunkun Pet Dock" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "kunkun" })).toBeInTheDocument();
  expect(screen.getByText("Ready when you are.")).toBeInTheDocument();
});

it("becomes a semantic collapse button when a callback is provided", () => {
  const onToggle = vi.fn();
  render(<PetDock status="ready" onToggle={onToggle} />);

  fireEvent.click(screen.getByRole("button", { name: "收起 Kunkun" }));
  expect(onToggle).toHaveBeenCalledOnce();
});

it("uses an expand label and keeps the full sprite in collapsed mode", () => {
  render(<PetDock status="ready" collapsed onToggle={vi.fn()} />);

  expect(screen.getByRole("button", { name: "展开 Kunkun" })).toHaveClass("pet-dock--collapsed");
  expect(screen.getByRole("img", { name: "kunkun" }).getAttribute("style")).toContain("kunkun-spritesheet.webp");
});

it("starts one native drag after the collapsed pet moves past the threshold", () => {
  const onToggle = vi.fn();
  const onDragStart = vi.fn(async () => undefined);
  render(<PetDock status="ready" collapsed onToggle={onToggle} onDragStart={onDragStart} />);
  const pet = screen.getByRole("button", { name: /Kunkun/ });

  firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  firePointer(pet, "pointermove", { pointerId: 1, clientX: 25, clientY: 20 });
  expect(onDragStart).not.toHaveBeenCalled();
  firePointer(pet, "pointermove", { pointerId: 1, clientX: 27, clientY: 20 });
  firePointer(pet, "pointermove", { pointerId: 1, clientX: 34, clientY: 20 });
  fireEvent.click(pet);

  expect(onDragStart).toHaveBeenCalledOnce();
  expect(onToggle).not.toHaveBeenCalled();
});

it("suppresses the release click even after a long native drag", () => {
  vi.useFakeTimers();
  const onToggle = vi.fn();
  render(<PetDock status="ready" collapsed onToggle={onToggle} onDragStart={vi.fn()} />);
  const pet = screen.getByRole("button", { name: /Kunkun/ });

  firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  firePointer(pet, "pointermove", { pointerId: 1, clientX: 30, clientY: 20 });
  vi.advanceTimersByTime(800);
  firePointer(pet, "pointerup", { pointerId: 1, clientX: 30, clientY: 20 });
  fireEvent.click(pet);

  expect(onToggle).not.toHaveBeenCalled();
});

it("keeps a short collapsed-pet click as the expand action", () => {
  const onToggle = vi.fn();
  render(<PetDock status="ready" collapsed onToggle={onToggle} onDragStart={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /Kunkun/ }));

  expect(onToggle).toHaveBeenCalledOnce();
});
