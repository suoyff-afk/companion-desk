// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowChrome } from "./WindowChrome";

afterEach(cleanup);

describe("WindowChrome", () => {
  it("shows only the close action by default", () => {
    const bridge = {
      toggleMaximize: vi.fn(async () => undefined),
    };
    const onClose = vi.fn();
    render(<WindowChrome title="Companion Desk" onClose={onClose} bridge={bridge} />);

    expect(screen.getByLabelText("Window drag region")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByLabelText("Kunkun 头像")).not.toHaveAttribute("role", "button");
    expect(screen.getByText("Companion Desk")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭面板，返回宠物" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "最小化窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Minimize window" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起到宠物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最大化或还原" })).not.toBeInTheDocument();
  });

  it("shows maximize only when requested", () => {
    const bridge = {
      toggleMaximize: vi.fn(async () => undefined),
    };
    render(
      <WindowChrome
        title="令牌监控"
        onClose={vi.fn()}
        showMaximize
        bridge={bridge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "最大化或还原" }));
    expect(bridge.toggleMaximize).toHaveBeenCalledOnce();
  });

  it("guards a pending maximize synchronously and reports its busy state", async () => {
    let resolveToggle!: () => void;
    const pendingToggle = new Promise<void>((resolve) => { resolveToggle = resolve; });
    const bridge = {
      toggleMaximize: vi.fn(() => pendingToggle),
    };
    render(
      <WindowChrome
        title="令牌监控"
        onClose={vi.fn()}
        showMaximize
        bridge={bridge}
      />,
    );

    const maximize = screen.getByRole("button", { name: "最大化或还原" });
    act(() => {
      maximize.click();
      maximize.click();
    });

    expect(bridge.toggleMaximize).toHaveBeenCalledOnce();
    expect(maximize).toBeDisabled();
    expect(maximize).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "关闭面板，返回宠物" })).toBeEnabled();

    await act(async () => { resolveToggle(); });
    expect(maximize).toBeEnabled();
    expect(maximize).toHaveAttribute("aria-busy", "false");
  });

  it("recovers the maximize control after the bridge rejects", async () => {
    const bridge = {
      toggleMaximize: vi.fn()
        .mockRejectedValueOnce(new Error("maximize unavailable"))
        .mockResolvedValueOnce(undefined),
    };
    render(
      <WindowChrome
        title="HPC"
        onClose={vi.fn()}
        showMaximize
        bridge={bridge}
      />,
    );

    const maximize = screen.getByRole("button", { name: "最大化或还原" });
    fireEvent.click(maximize);
    await waitFor(() => expect(maximize).toBeEnabled());
    fireEvent.click(maximize);

    expect(bridge.toggleMaximize).toHaveBeenCalledTimes(2);
  });

  it("settles a pending maximize after the chrome unmounts", async () => {
    let resolveToggle!: () => void;
    const pendingToggle = new Promise<void>((resolve) => { resolveToggle = resolve; });
    const bridge = {
      toggleMaximize: vi.fn(() => pendingToggle),
    };
    const { unmount } = render(
      <WindowChrome
        title="Token"
        onClose={vi.fn()}
        showMaximize
        bridge={bridge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "最大化或还原" }));
    expect(() => unmount()).not.toThrow();
    await act(async () => { resolveToggle(); });
  });

  it("shows a return-home action only on feature pages", () => {
    const onBack = vi.fn();
    const bridge = {
      toggleMaximize: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <WindowChrome title="专注" onBack={onBack} onClose={vi.fn()} bridge={bridge} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回主页" }));
    expect(onBack).toHaveBeenCalledOnce();

    rerender(<WindowChrome title="Kunkun" onClose={vi.fn()} bridge={bridge} />);
    expect(screen.queryByRole("button", { name: "返回主页" })).not.toBeInTheDocument();
  });
});
