// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Game2048Page } from "./Game2048Page";
import { GomokuPage } from "./GomokuPage";
import { GameCenterPage } from "./RechargePage";

afterEach(cleanup);

describe("standalone game pages", () => {
  it("offers only playable local games without a friend-versus preview", () => {
    render(<GameCenterPage onNavigate={() => undefined} />);

    expect(screen.getByRole("button", { name: "打开 2048" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开五子棋" })).toBeInTheDocument();
    expect(screen.queryByText(/好友对战\s*·\s*预览/)).not.toBeInTheDocument();
    expect(screen.queryByText("联机功能待接入")).not.toBeInTheDocument();
  });

  it("mounts only the 2048 board on the 2048 page", () => {
    const { container } = render(<Game2048Page />);

    expect(screen.getAllByLabelText("2048 board")).toHaveLength(1);
    expect(container.querySelector(".gomoku-board")).not.toBeInTheDocument();
  });

  it("mounts only the Gomoku board on the Gomoku page", () => {
    const { container } = render(<GomokuPage />);

    expect(container.querySelectorAll(".gomoku-board")).toHaveLength(1);
    expect(screen.queryByLabelText("2048 board")).not.toBeInTheDocument();
  });
});
