// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameCenterPage } from "./RechargePage";

afterEach(cleanup);

describe("GameCenterPage", () => {
  it("offers distinct local games without mounting either board", () => {
    const onNavigate = vi.fn();
    const { container } = render(<GameCenterPage onNavigate={onNavigate} />);

    expect(screen.getByRole("button", { name: "打开 2048" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开五子棋" })).toBeInTheDocument();
    expect(screen.queryByLabelText("2048 board")).not.toBeInTheDocument();
    expect(container.querySelector(".gomoku-board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 2048" }));
    fireEvent.click(screen.getByRole("button", { name: "打开五子棋" }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, "game2048");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "gomoku");
  });

  it("keeps the game center limited to local play", () => {
    render(<GameCenterPage onNavigate={vi.fn()} />);

    expect(screen.queryByText("好友对战 · 预览")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "联机功能待接入" })).not.toBeInTheDocument();
    expect(screen.getByText("与 Kunkun 本地对弈")).toBeInTheDocument();
  });
});
