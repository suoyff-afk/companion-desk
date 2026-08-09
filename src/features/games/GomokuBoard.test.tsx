// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Game2048Board } from "./Game2048Board";
import { GomokuBoard } from "./GomokuBoard";
import { moveGrid, type MoveDirection } from "./game2048";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Game2048Board", () => {
  it("samples random rolls once outside StrictMode initializers and state updaters", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = render(<StrictMode><Game2048Board /></StrictMode>);
    expect(random).not.toHaveBeenCalled();

    const values = [...container.querySelectorAll(".tile-2048")].map((tile) => Number(tile.textContent) || 0);
    const grid = Array.from({ length: 4 }, (_, row) => values.slice(row * 4, row * 4 + 4));
    const directions: MoveDirection[] = ["left", "right", "up", "down"];
    const direction = directions.find((candidate) => moveGrid(grid, candidate).moved);
    expect(direction).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: `Move ${direction}` }));
    expect(random).toHaveBeenCalledTimes(2);

    random.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(random).toHaveBeenCalledTimes(4);
  });

  it("only intercepts unmodified arrow keys outside editing controls", () => {
    render(<><Game2048Board /><input aria-label="Name" /><textarea aria-label="Notes" /><select aria-label="Choice"><option>One</option></select><div aria-label="Editor" contentEditable /></>);

    expect(fireEvent.keyDown(window, { key: "ArrowLeft" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Name"), { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Choice"), { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Editor"), { key: "ArrowLeft" })).toBe(true);
  });
});

describe("GomokuBoard", () => {
  it("announces status changes politely", () => {
    render(<GomokuBoard />);
    expect(screen.getByLabelText("Gomoku players")).toHaveAttribute("aria-live", "polite");
  });

  it("locks the board while Kunkun thinks and undoes a complete round", () => {
    vi.useFakeTimers();
    render(<GomokuBoard />);

    const center = screen.getByRole("button", { name: "Row 8, column 8: empty" });
    fireEvent.click(center);

    expect(screen.getByText("Kunkun thinking…")).toBeInTheDocument();
    expect(center).toBeDisabled();

    act(() => { vi.advanceTimersByTime(210); });
    expect(screen.getAllByRole("button", { name: /: white$/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: /: black$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /: white$/ })).not.toBeInTheDocument();
  });
});
