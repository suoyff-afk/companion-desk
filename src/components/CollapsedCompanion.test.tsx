// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_GEOMETRY,
  CollapsedCompanion,
  rectanglesOverlap,
} from "./CollapsedCompanion";
import { COLLAPSED_NOTIFICATION_LAYOUT } from "../app/windowLayout";
import type { ProviderSnapshot } from "../types";
import type { QuotaState } from "../features/quota/quotaController";

const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: string): string;
}>("node:fs");
const styles = readFileSync("src/styles.css", "utf8");

afterEach(() => {
  cleanup();
});

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "lostpointercapture",
  init: { button?: number; pointerId: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

describe("collapsed companion geometry", () => {
  it("exports the approved composition coordinates", () => {
    expect(COLLAPSED_GEOMETRY).toEqual({
      ring: { x: 30, y: 35, width: 105, height: 105 },
      pet: { x: 18, y: 8, width: 120, height: 130 },
      quota: { x: 96, y: 72, width: 35, height: 22 },
      face: { x: 46, y: 18, width: 57, height: 48 },
      bubble: { x: 138, y: 28, width: 150, height: 44 },
      unread: { x: 128, y: 16, width: 10, height: 10 },
    });
  });

  it("places quota in the open area below the raised hand instead of over the torso", () => {
    const { quota, pet, ring } = COLLAPSED_GEOMETRY;
    expect(quota.x).toBeGreaterThan(pet.x + pet.width * 0.6);
    expect(quota.y).toBeGreaterThan(pet.y + pet.height * 0.35);
    expect(quota.x + quota.width).toBeLessThanOrEqual(ring.x + ring.width);
  });

  it("keeps the notification bubble clear of the face", () => {
    expect(rectanglesOverlap(COLLAPSED_GEOMETRY.bubble, COLLAPSED_GEOMETRY.face)).toBe(false);
  });

  it("keeps the notification bubble inside the notification window", () => {
    const { bubble } = COLLAPSED_GEOMETRY;

    expect(bubble.x + bubble.width).toBeLessThanOrEqual(COLLAPSED_NOTIFICATION_LAYOUT.width);
  });
});

describe("collapsed companion rendering", () => {
  it("keeps a stale shared quota value visible with an accessible freshness warning", () => {
    const snapshot: ProviderSnapshot = {
      provider: "codex", displayName: "CODEX", plan: "PRO",
      shortWindow: { remainingPercent: 73, resetsAt: null, windowSeconds: 18_000 },
      weeklyWindow: null, resetCredits: null, updatedAt: "2026-07-29T09:30:00.000Z",
      status: "stale", message: "offline",
    };
    const quota: QuotaState = { snapshot, lastSuccessful: snapshot, loading: false, refreshing: false, updatedAt: snapshot.updatedAt };
    render(<CollapsedCompanion quota={quota} label="5小时额度" onOpen={vi.fn()} onDragStart={vi.fn()} />);

    expect(screen.getByRole("group", { name: "5小时额度：73%" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("数据可能过期");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("renders the idle composition without a live status announcement", () => {
    const { container } = render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={vi.fn()} onDragStart={vi.fn()} />,
    );

    const root = container.querySelector<HTMLElement>(".collapsed-companion");
    expect(root).toHaveClass("collapsed-companion--approved");
    expect(root).toHaveAttribute("data-tauri-drag-region");
    expect(root).toHaveAttribute("data-notification-state", "hidden");
    expect(root?.style.getPropertyValue("--collapsed-ring-x")).toBe("30px");
    expect(root?.style.getPropertyValue("--collapsed-pet-height")).toBe("130px");
    expect(root?.style.getPropertyValue("--collapsed-quota-x")).toBe("96px");
    expect(root?.style.getPropertyValue("--collapsed-quota-y")).toBe("72px");
    expect(root?.style.getPropertyValue("--collapsed-quota-width")).toBe("35px");
    expect(root?.style.getPropertyValue("--collapsed-bubble-x")).toBe("138px");
    expect(root?.style.getPropertyValue("--collapsed-unread-width")).toBe("10px");
    expect(container.querySelectorAll(".collapsed-companion__ring")).toHaveLength(1);
    expect(container.querySelector(".collapsed-companion__orbit")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex 用量：62%" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps approved positioning isolated from the legacy collapsed root", () => {
    expect(styles).toContain(
      ".collapsed-companion { position: relative; width: 100%; height: 100%; display: grid; place-items: end center; overflow: visible; }",
    );
    expect(styles).toContain(".collapsed-companion--approved .collapsed-companion__ring");
    expect(styles).not.toMatch(/(?:^|\n)\.collapsed-companion__ring\s*\{/);
    expect(styles).not.toMatch(/(?:^|\n)\.collapsed-quota(?:__pill)?(?:\s|\{|:)/);
    expect(styles).not.toContain(".collapsed-companion:not(.collapsed-companion--approved) .collapsed-companion__bubble");
    expect(styles).not.toContain(".collapsed-companion:not(.collapsed-companion--approved) .collapsed-companion__unread");
  });

  it("uses a light animated technology ring and compact quota chip", () => {
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__ring \{[^}]*conic-gradient/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__orbit \{[^}]*animation: companion-orbit/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__pet:focus-visible \{[^}]*border-radius: 18px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__quota \{[^}]*padding: 3px 4px;[^}]*backdrop-filter: blur\(8px\);/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__quota strong \{ font-size: 11px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__menu \{[^}]*left: 145px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__quota small \{ font-size: 7px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__bubble \{[^}]*gap: 3px;[^}]*padding: 7px 10px;[^}]*border-radius: 14px;[^}]*font-size: 11px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__bubble \{[^}]*box-shadow: none;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__bubble::before \{[^}]*left: -7px; top: 15px; width: 14px; height: 14px;/);
    expect(styles).toMatch(/\.collapsed-companion--approved \.collapsed-companion__unread \{[^}]*border: 1px solid rgba\(245,249,255,\.9\);/);
  });

  it("announces an unread interaction when a notification is visible", () => {
    const { container } = render(
      <CollapsedCompanion
        value="62"
        unit="%"
        label="Codex 用量"
        reaction="waving"
        notification={{ sender: "Momo", message: "戳了你一下" }}
        onOpen={vi.fn()}
        onDragStart={vi.fn()}
      />,
    );

    expect(container.querySelector(".collapsed-companion")).toHaveAttribute(
      "data-notification-state",
      "visible",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Momo 戳了你一下");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "未读互动：Momo 戳了你一下");
    expect(container.querySelectorAll(".pet-sprite")).toHaveLength(1);
    expect(container.querySelector(".pet-sprite")).toHaveAttribute("data-reaction", "waving");
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});

describe("collapsed companion interactions", () => {
  it("reveals persisted docking and keeps center, reaction, and reset controls explicit", () => {
    const onCenter = vi.fn();
    const onReactionsEnabledChange = vi.fn();
    const onRestoreDefault = vi.fn();
    function ControlledCompanion() {
      const [menuOpen, setMenuOpen] = useState(false);
      return (
        <CollapsedCompanion
          value={62}
          unit="%"
          label="Codex 用量"
          dockSide="right"
          reactionsEnabled={false}
          onCenter={onCenter}
          onReactionsEnabledChange={onReactionsEnabledChange}
          onRestoreDefault={onRestoreDefault}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          onOpen={vi.fn()}
          onDragStart={vi.fn()}
        />
      );
    }
    const { container } = render(<ControlledCompanion />);
    const pet = screen.getByRole("button", { name: "展开 Companion Desk" });

    expect(container.querySelector(".collapsed-companion")).toHaveAttribute("data-dock-side", "right");
    expect(styles).toContain('.collapsed-companion--approved[data-dock-side="right"]');
    fireEvent.contextMenu(pet);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "偶尔挥手", checked: false }));
    expect(onReactionsEnabledChange).toHaveBeenCalledWith(true);

    fireEvent.contextMenu(pet);
    fireEvent.click(screen.getByRole("menuitem", { name: "移到屏幕中央" }));
    expect(onCenter).toHaveBeenCalledOnce();

    fireEvent.contextMenu(pet);
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复默认" }));
    expect(onRestoreDefault).toHaveBeenCalledOnce();
  });

  it("offers small, standard, and large pet size presets", () => {
    const onPetSizeChange = vi.fn();
    function ControlledCompanion() {
      const [menuOpen, setMenuOpen] = useState(false);
      return (
        <CollapsedCompanion
          value={62}
          unit="%"
          label="Codex 用量"
          petSize="standard"
          onPetSizeChange={onPetSizeChange}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          onOpen={vi.fn()}
          onDragStart={vi.fn()}
        />
      );
    }
    const { container } = render(<ControlledCompanion />);

    expect(container.querySelector(".collapsed-companion")).toHaveStyle({ "--companion-scale": "1" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "展开 Companion Desk" }));
    expect(screen.getByRole("menuitemradio", { name: "标准", checked: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "小" }));
    expect(onPetSizeChange).toHaveBeenCalledWith("small");
  });

  it("opens a context menu with primary, hide, and exit actions", () => {
    const onOpen = vi.fn();
    const onFocus = vi.fn();
    const onPlay = vi.fn();
    const onHide = vi.fn();
    const onExit = vi.fn();
    function ControlledCompanion() {
      const [menuOpen, setMenuOpen] = useState(false);
      return (
        <CollapsedCompanion
          value={62}
          unit="%"
          label="Codex 用量"
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          onOpen={onOpen}
          onFocus={onFocus}
          onPlay={onPlay}
          onHide={onHide}
          onExit={onExit}
          onDragStart={vi.fn()}
        />
      );
    }
    render(<ControlledCompanion />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "展开 Companion Desk" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "专注" }));
    expect(onFocus).toHaveBeenCalledOnce();

    fireEvent.contextMenu(screen.getByRole("button", { name: "展开 Companion Desk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "暂时隐藏" }));
    expect(onHide).toHaveBeenCalledOnce();

    fireEvent.contextMenu(screen.getByRole("button", { name: "展开 Companion Desk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出应用" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("focuses and cycles menu items, then Escape closes and restores the pet trigger", async () => {
    function ControlledCompanion() {
      const [menuOpen, setMenuOpen] = useState(false);
      return (
        <CollapsedCompanion
          value={62}
          unit="%"
          label="Codex 用量"
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          onOpen={vi.fn()}
          onDragStart={vi.fn()}
        />
      );
    }
    render(<ControlledCompanion />);
    const trigger = screen.getByRole("button", { name: /Companion Desk/ });

    fireEvent.contextMenu(trigger);
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(items.at(-1)!, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("starts one drag only after moving beyond 5px and suppresses the release click", () => {
    const onOpen = vi.fn();
    const onDragStart = vi.fn(async () => undefined);
    render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={onOpen} onDragStart={onDragStart} />,
    );
    const pet = screen.getByRole("button", { name: "展开 Companion Desk" });

    firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(pet, "pointermove", { pointerId: 1, clientX: 25, clientY: 20 });
    expect(onDragStart).not.toHaveBeenCalled();

    firePointer(pet, "pointermove", { pointerId: 1, clientX: 26, clientY: 20 });
    firePointer(pet, "pointermove", { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.click(pet);

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps a short click as the open action", () => {
    const onOpen = vi.fn();
    render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={onOpen} onDragStart={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开 Companion Desk" }));

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each([
    ["synchronous throw", vi.fn(() => { throw new Error("drag unavailable"); })],
    ["asynchronous rejection", vi.fn(async () => { throw new Error("drag rejected"); })],
  ])("recovers from a %s and allows a later click", async (_case, onDragStart) => {
    const onOpen = vi.fn();
    render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={onOpen} onDragStart={onDragStart} />,
    );
    const pet = screen.getByRole("button", { name: "展开 Companion Desk" });

    firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(pet, "pointermove", { pointerId: 1, clientX: 26, clientY: 20 });
    fireEvent.click(pet);
    fireEvent.click(pet);

    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
  });

  it("clears a lost pointer capture before a new drag gesture", () => {
    const onDragStart = vi.fn();
    render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={vi.fn()} onDragStart={onDragStart} />,
    );
    const pet = screen.getByRole("button", { name: "展开 Companion Desk" });

    firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(pet, "lostpointercapture", { pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(pet, "pointermove", { pointerId: 1, clientX: 30, clientY: 20 });
    expect(onDragStart).not.toHaveBeenCalled();

    firePointer(pet, "pointerdown", { button: 0, pointerId: 2, clientX: 20, clientY: 20 });
    firePointer(pet, "pointermove", { pointerId: 2, clientX: 26, clientY: 20 });
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("isolates releasePointerCapture errors and preserves the click", () => {
    const onOpen = vi.fn();
    render(
      <CollapsedCompanion value={62} unit="%" label="Codex 用量" onOpen={onOpen} onDragStart={vi.fn()} />,
    );
    const pet = screen.getByRole("button", { name: "展开 Companion Desk" });
    Object.defineProperties(pet, {
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn(() => { throw new DOMException("capture lost"); }) },
    });

    firePointer(pet, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    expect(() => {
      firePointer(pet, "pointerup", { pointerId: 1, clientX: 20, clientY: 20 });
    }).not.toThrow();
    fireEvent.click(pet);

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
