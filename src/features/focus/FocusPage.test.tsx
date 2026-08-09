// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusPage } from "./FocusPage";

describe("FocusPage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function flushHydration() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderHydrated() {
    render(<FocusPage />);
    await flushHydration();
  }

  async function finishOneMinuteNaturally() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    await renderHydrated();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Duration/i }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));
    act(() => vi.advanceTimersByTime(60_000));
  }

  async function readStoredFocus() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return JSON.parse(window.localStorage.getItem("kunkun-desk.focus") ?? "null") as {
      completed: Array<{ task: string; durationMs: number; completedAt: string; reflection?: string }>;
    };
  }

  it("shows only focus controls and the configured task", () => {
    render(<FocusPage />);

    expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Focus/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Current task")).toBeInTheDocument();
    expect(screen.queryByText("Weekly quota")).not.toBeInTheDocument();
  });

  it("keeps focus usable after a save failure and retries on the next change", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => { throw new Error("storage unavailable"); });

    await renderHydrated();

    expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Focus changes could not be saved. Change the session again to retry.");

    fireEvent.change(screen.getByRole("textbox", { name: /Current task/i }), { target: { value: "Retry persistence" } });

    await screen.findByDisplayValue("Retry persistence");
    await act(async () => { await Promise.resolve(); });
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not overwrite saved focus data after loading it fails until the user changes a field", async () => {
    window.localStorage.setItem("kunkun-desk.focus", JSON.stringify({
      task: "Keep this session",
      durationMinutes: 50,
      completed: [],
    }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => { throw new Error("storage unavailable"); });

    await renderHydrated();

    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByText("Saved focus data could not be loaded. You can continue with a new session.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Current task/i }), { target: { value: "Save this instead" } });

    await act(async () => { await Promise.resolve(); });
    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(window.localStorage.getItem("kunkun-desk.focus") ?? "{}")).toMatchObject({ task: "Save this instead" });
  });

  it("offers 25 and 50 minute presets and publishes a read-only session summary", async () => {
    const onSessionChange = vi.fn();
    render(<FocusPage onSessionChange={onSessionChange} />);
    await flushHydration();

    expect(screen.getByRole("button", { name: "25 分钟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "50 分钟" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /Duration/i })).toHaveValue(25);
    expect(onSessionChange).toHaveBeenLastCalledWith({
      status: "idle",
      remainingMs: 25 * 60_000,
      durationMs: 25 * 60_000,
    });

    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));

    expect(onSessionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "running",
      durationMs: 25 * 60_000,
    }));
  });

  it("derives elapsed time from the clock after a background-sized jump", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-07-15T12:00:00.000Z");
    vi.setSystemTime(startedAt);
    const onSessionChange = vi.fn();
    render(<FocusPage onSessionChange={onSessionChange} />);
    await flushHydration();
    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));

    vi.setSystemTime(new Date(startedAt.getTime() + 10_000));
    act(() => vi.advanceTimersByTime(250));

    expect(onSessionChange).toHaveBeenLastCalledWith({
      status: "running",
      remainingMs: 25 * 60_000 - 10_250,
      durationMs: 25 * 60_000,
    });
  });

  it("publishes at most one running summary per displayed second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const onSessionChange = vi.fn();
    render(<FocusPage onSessionChange={onSessionChange} />);
    await flushHydration();
    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));
    const callsAfterStart = onSessionChange.mock.calls.length;

    act(() => vi.advanceTimersByTime(750));
    expect(onSessionChange).toHaveBeenCalledTimes(callsAfterStart);

    act(() => vi.advanceTimersByTime(250));
    expect(onSessionChange).toHaveBeenCalledTimes(callsAfterStart + 1);
  });

  it("keeps controls disabled until persisted focus data has hydrated", async () => {
    render(<FocusPage />);

    const startButton = screen.getByRole("button", { name: /Start Focus/i });
    const resetButton = screen.getByRole("button", { name: /Reset/i });
    const taskInput = screen.getByRole("textbox", { name: /Current task/i });
    const durationInput = screen.getByRole("spinbutton", { name: /Duration/i });
    expect(startButton).toBeDisabled();
    expect(resetButton).toBeDisabled();
    expect(taskInput).toBeDisabled();
    expect(durationInput).toBeDisabled();

    await flushHydration();

    expect(startButton).toBeEnabled();
    expect(resetButton).toBeEnabled();
    expect(taskInput).toBeEnabled();
    expect(durationInput).toBeEnabled();
  });

  it("keeps the focus actions inside the queryable above-fold layout", async () => {
    await renderHydrated();

    const aboveFold = screen.getByTestId("focus-above-fold");
    expect(within(aboveFold).getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(within(aboveFold).getByRole("textbox", { name: /Current task/i })).toBeInTheDocument();
    expect(within(aboveFold).getByText("25:00")).toBeInTheDocument();
    expect(within(aboveFold).getByRole("button", { name: "25 分钟" })).toBeInTheDocument();
    expect(within(aboveFold).getByRole("button", { name: "50 分钟" })).toBeInTheDocument();
    fireEvent.click(within(aboveFold).getByRole("button", { name: /Start Focus/i }));
    expect(within(aboveFold).getByRole("button", { name: /Pause/i })).toBeInTheDocument();
    expect(within(aboveFold).getByRole("button", { name: /End Session/i })).toBeInTheDocument();
    expect(within(aboveFold).getByRole("button", { name: /Reset/i })).toBeInTheDocument();
  });

  it("renders a legacy completed session without reflection and filters damaged entries", async () => {
    window.localStorage.setItem("kunkun-desk.focus", JSON.stringify({
      task: "Write results",
      durationMinutes: 25,
      completed: [
        null,
        { task: "Legacy session", durationMs: 1_500_000, completedAt: "2026-07-14T10:00:00.000Z" },
        { task: "Broken session", durationMs: "long", completedAt: "not-a-date" },
      ],
    }));

    render(<FocusPage />);

    expect(await screen.findByText("Legacy session")).toBeInTheDocument();
    expect(screen.queryByText("Broken session")).not.toBeInTheDocument();
  });

  it("asks for one takeaway after natural completion and saves it exactly once", async () => {
    await finishOneMinuteNaturally();

    const layout = screen.getByTestId("focus-main-layout");
    const dialog = screen.getByRole("dialog", { name: /Session complete/i });
    const reflection = within(dialog).getByRole("textbox", { name: /一条本次收获/i });
    const saveButton = within(dialog).getByRole("button", { name: /Save reflection/i });
    expect(layout).toHaveAttribute("inert");
    expect(layout).toHaveAttribute("aria-hidden", "true");
    expect(within(layout).getByRole("button", { name: /Reset/i, hidden: true })).toBeDisabled();
    expect(reflection).toHaveAttribute("maxlength", "120");
    expect(within(dialog).getByText("0 / 120")).toBeInTheDocument();

    saveButton.focus();
    fireEvent.keyDown(saveButton, { key: "Tab" });
    expect(reflection).toHaveFocus();
    fireEvent.keyDown(reflection, { key: "Tab", shiftKey: true });
    expect(saveButton).toHaveFocus();

    fireEvent.change(reflection, { target: { value: "  A smaller test made the state boundary clear.  " } });
    fireEvent.click(saveButton);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(layout).not.toHaveAttribute("inert");
    expect(layout).not.toHaveAttribute("aria-hidden");
    expect(within(layout).getByRole("button", { name: /Reset/i })).toBeEnabled();
    expect(within(layout).getByRole("button", { name: /Reset/i })).toHaveFocus();
    expect(screen.getByText("A smaller test made the state boundary clear.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Reset/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));
    expect((await readStoredFocus()).completed).toEqual([
      expect.objectContaining({ reflection: "A smaller test made the state boundary clear." }),
    ]);
  });

  it("records a natural completion without reflection when skipped", async () => {
    await finishOneMinuteNaturally();

    const layout = screen.getByTestId("focus-main-layout");
    fireEvent.click(screen.getByRole("button", { name: /Skip/i }));

    expect(layout).not.toHaveAttribute("inert");
    expect(layout).not.toHaveAttribute("aria-hidden");
    expect(within(layout).getByRole("button", { name: /Reset/i })).toBeEnabled();
    const stored = await readStoredFocus();
    expect(stored.completed).toHaveLength(1);
    expect(stored.completed[0]).not.toHaveProperty("reflection");
  });

  it("records the exact sub-second elapsed time when ending from pause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    await renderHydrated();
    fireEvent.click(screen.getByRole("button", { name: /Start Focus/i }));
    act(() => vi.advanceTimersByTime(250));
    fireEvent.click(screen.getByRole("button", { name: /Pause/i }));
    act(() => vi.advanceTimersByTime(1_000));

    fireEvent.click(screen.getByRole("button", { name: /End Session/i }));

    const dialog = screen.getByRole("dialog", { name: /Session complete/i });
    const takeaway = within(dialog).getByRole("textbox", { name: /一条本次收获/i });
    expect(takeaway).toHaveAttribute("type", "text");
    expect(takeaway).toHaveAttribute("maxlength", "120");
    fireEvent.change(takeaway, { target: { value: "  Clarified the next smallest step.  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save reflection/i }));

    expect((await readStoredFocus()).completed).toEqual([
      expect.objectContaining({
        durationMs: 250,
        completedAt: "2026-07-15T12:00:01.250Z",
        reflection: "Clarified the next smallest step.",
      }),
    ]);
  });
});
