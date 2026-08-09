// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  it("renders a single-column glass surface without permanent navigation", () => {
    const { container } = render(
      <AppShell view="home" title="Kunkun" onClose={vi.fn()}>
        <p>Home content</p>
      </AppShell>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-material", "glass");
    expect(container.firstElementChild).toHaveAttribute("data-view", "home");
    expect(screen.getByRole("main")).toHaveTextContent("Home content");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it.each([
    ["home", false, false],
    ["focus", true, false],
    ["token", true, true],
    ["hpc", true, true],
  ] as const)(
    "maps %s to the expected window controls",
    (view, showBack, showMaximize) => {
      render(
        <AppShell
          view={view}
          title={view}
          onBack={showBack ? vi.fn() : undefined}
          onClose={vi.fn()}
        >
          <p>{view} content</p>
        </AppShell>,
      );

      expect(screen.getByRole("button", { name: "关闭面板，返回宠物" })).toBeInTheDocument();
      if (showBack) {
        expect(screen.getByRole("button", { name: "返回主页" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "返回主页" })).not.toBeInTheDocument();
      }
      if (showMaximize) {
        expect(screen.getByRole("button", { name: "最大化或还原" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "最大化或还原" })).not.toBeInTheDocument();
      }
    },
  );

  it("removes chrome in collapsed mode so only companion content remains", () => {
    const { container } = render(
      <AppShell view="collapsed" title="Kunkun" onClose={vi.fn()}>
        <p>Collapsed companion</p>
      </AppShell>,
    );

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Collapsed companion");
    expect(container.firstElementChild).toHaveClass("app-shell--collapsed");
  });
});
