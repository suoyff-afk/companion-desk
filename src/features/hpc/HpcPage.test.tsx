// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HpcPage } from "./HpcPage";
import { XTERM_OPTIONS } from "./TerminalPanel";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function terminalHarness() {
  const listeners: { data?: (data: string) => void; resize?: (size: { cols: number; rows: number }) => void } = {};
  const terminal = {
    cols: 100,
    rows: 32,
    open: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      listeners.data = listener;
      return { dispose: vi.fn() };
    }),
    onResize: vi.fn((listener: (size: { cols: number; rows: number }) => void) => {
      listeners.resize = listener;
      return { dispose: vi.fn() };
    }),
  };
  const fit = { fit: vi.fn(), dispose: vi.fn() };
  return { terminal, fit, listeners, factory: () => ({ terminal, fit }) };
}

function bridgeHarness() {
  type Event = { event: string; data?: string; code?: number; message?: string };
  let onEvent: ((event: Event) => void) | undefined;
  const eventListeners: Array<(event: Event) => void> = [];
  const bridge = {
    start: vi.fn(async (_hostAlias: string, _cols: number, _rows: number, listener: (event: Event) => void) => {
      onEvent = listener;
      eventListeners.push(listener);
      return `session-${eventListeners.length}`;
    }),
    write: vi.fn(async (_sessionId: string, _data: string): Promise<void> => undefined),
    resize: vi.fn(async (_sessionId: string, _cols: number, _rows: number): Promise<void> => undefined),
    close: vi.fn(async (_sessionId: string): Promise<void> => undefined),
    getStatus: vi.fn(async () => ({ state: "idle" as const })),
    closeAll: vi.fn(async (): Promise<void> => undefined),
  };
  return {
    bridge,
    emit: (event: Event) => onEvent?.(event),
    emitAt: (attempt: number, event: Event) => eventListeners[attempt]?.(event),
  };
}

function enterHostAlias(value = "tud-hpc") {
  fireEvent.change(screen.getByLabelText("SSH host alias"), { target: { value } });
}

describe("HpcPage", () => {
  it("shows one task board whose refresh does not type into the interactive terminal", async () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    const queryBridge = {
      query: vi.fn(async () => ({
        hostAlias: "tud-hpc",
        queriedAt: "2026-09-30T16:00:00Z",
        historyDays: 7,
        queue: [{ jobId: "100_0", name: "case-a", state: "RUNNING", elapsed: "00:05:00", reason: "node-a", exitCode: null, workDir: "/example/run" }],
        history: [],
        issues: [],
      })),
    };
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} queryBridge={queryBridge} />);
    enterHostAlias();

    expect(screen.getAllByRole("heading", { name: "任务看板" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^刷新$/ }));
    expect(await screen.findByText("case-a")).toBeInTheDocument();
    expect(queryBridge.query).toHaveBeenCalledWith("tud-hpc", []);
    expect(bridge.write).not.toHaveBeenCalled();
  });

  it("describes local SSH startup without claiming remote authentication", async () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    expect(await screen.findByText(/^Started$/i)).toBeInTheDocument();
    expect(screen.getByText(/Complete authentication in the terminal/)).toBeInTheDocument();
    expect(screen.queryByText(/^Connected$/i)).not.toBeInTheDocument();
  });

  it("starts a fresh install with an empty host alias and cannot connect", () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    expect(screen.getByLabelText("SSH host alias")).toHaveValue("");
    expect(screen.getByLabelText("SSH host alias")).toHaveAttribute("placeholder", "例如：tud-hpc");
    expect(screen.getByLabelText("SSH host alias")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(/Use an SSH config host alias/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it("restores a valid host alias saved by an earlier version", async () => {
    window.localStorage.setItem("kunkun-desk.hpc", JSON.stringify({ hostAlias: "saved-cluster" }));
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();

    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    await waitFor(() => expect(screen.getByLabelText("SSH host alias")).toHaveValue("saved-cluster"));
  });

  it.each(["new-cluster", ""])("keeps a user's host edit %j when saved-host loading finishes", async (value) => {
    window.localStorage.setItem("kunkun-desk.hpc", JSON.stringify({ hostAlias: "saved-cluster" }));
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    enterHostAlias("new-cluster");
    if (!value) enterHostAlias("");
    await act(async () => {});

    expect(screen.getByLabelText("SSH host alias")).toHaveValue(value);
  });

  it("keeps SSH controls available after saved-host loading fails and saves on a later connection", async () => {
    vi.spyOn(Storage.prototype, "getItem")
      .mockImplementation((key) => {
        if (key === "kunkun-desk.hpc") throw new Error("storage unavailable");
        return null;
      });
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();

    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    expect(await screen.findByText("Saved SSH host could not be loaded. Enter it again to continue.")).toBeInTheDocument();
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    expect(await screen.findByText(/^Started$/i)).toBeInTheDocument();
    expect(screen.queryByText("Saved SSH host could not be loaded. Enter it again to continue.")).not.toBeInTheDocument();
  });

  it("shows a non-blocking save failure and retries after reconnecting", async () => {
    vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => { throw new Error("storage unavailable"); });
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    expect(await screen.findByText("SSH host could not be saved. It will retry on the next connection.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));
    await screen.findByText(/^Disconnected$/i);
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);
    expect(screen.queryByText("SSH host could not be saved. It will retry on the next connection.")).not.toBeInTheDocument();
  });

  it("keeps the desensitized SSH configuration example collapsed by default", () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    const summary = screen.getByText("查看 SSH 配置示例");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(summary);
    const example = screen.getByLabelText("SSH 配置示例");
    expect(example.textContent).toBe(`Host tud-hpc
    HostName login.cluster.example.edu
    User your-username
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes`);
  });

  it("leaves the page title to the compact window chrome", () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    expect(screen.getByRole("region", { name: "HPC / SSH" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "HPC / SSH" })).not.toBeInTheDocument();
  });

  it("exposes terminal status and output to assistive technology", () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    expect(within(screen.getByLabelText("Embedded SSH terminal")).getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText("SSH terminal output")).toBeInTheDocument();
    expect(XTERM_OPTIONS.screenReaderMode).toBe(true);
  });

  it("prioritizes the embedded terminal without non-live side panels", async () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    expect(screen.queryByText(/Preview · Not live/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Queue summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Active jobs")).not.toBeInTheDocument();
    const connectionStrip = screen.getByRole("group", { name: "SSH connection controls" });
    expect(within(connectionStrip).getByLabelText("SSH host alias")).toBeInTheDocument();
    expect(within(connectionStrip).getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Embedded SSH terminal")).toBeInTheDocument();
    expect(screen.queryByText(/external console|separate console|confirm ssh launch/i)).not.toBeInTheDocument();
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() => expect(bridge.start).toHaveBeenCalledWith("tud-hpc", 100, 32, expect.any(Function)));
    expect(await screen.findByText(/^Started$/i)).toBeInTheDocument();
  });

  it("fits xterm when its terminal region is resized", () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();

    const view = render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);
    const output = screen.getByLabelText("SSH terminal output");
    expect(observe).toHaveBeenCalledWith(output);
    const fitCalls = terminal.fit.fit.mock.calls.length;

    act(() => resizeCallback?.([], {} as ResizeObserver));

    expect(terminal.fit.fit).toHaveBeenCalledTimes(fitCalls + 1);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("writes decoded output events to xterm and disconnects the active session", async () => {
    const harness = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={harness.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    act(() => harness.emit({ event: "output", data: "aGk=" }));
    expect(terminal.terminal.write).toHaveBeenCalledWith(new Uint8Array([104, 105]));

    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));
    await waitFor(() => expect(harness.bridge.close).toHaveBeenCalledWith("session-1"));
    expect(await screen.findByText(/^Disconnected$/i)).toBeInTheDocument();
  });

  it("waits for a pending disconnect before allowing another connection", async () => {
    const harness = bridgeHarness();
    const closing = deferred<void>();
    harness.bridge.close.mockImplementationOnce(() => closing.promise);
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={harness.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));

    expect(screen.queryByRole("button", { name: /^Connect$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Disconnect$/i })).toBeDisabled();
    expect(harness.bridge.close).toHaveBeenCalledOnce();
    await act(async () => closing.resolve());
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    expect(await screen.findByText(/^Started$/i)).toBeInTheDocument();
    expect(harness.bridge.start).toHaveBeenCalledTimes(2);
  });

  it("forwards xterm input and resize events and clears the visible terminal", async () => {
    const harness = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={harness.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    act(() => terminal.listeners.data?.("squeue\r"));
    await waitFor(() => expect(harness.bridge.write).toHaveBeenCalledWith("session-1", "squeue\r"));
    act(() => terminal.listeners.resize?.({ cols: 132, rows: 44 }));
    await waitFor(() => expect(harness.bridge.resize).toHaveBeenCalledWith("session-1", 132, 44));
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));

    expect(terminal.terminal.clear).toHaveBeenCalledOnce();
  });

  it("does not start a session for an invalid alias", () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);

    fireEvent.change(screen.getByLabelText("SSH host alias"), { target: { value: "bad;host" } });
    expect(screen.getByLabelText("SSH host alias")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Use an SSH config host alias/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it("closes the session and disposes xterm when unmounted", async () => {
    const { bridge } = bridgeHarness();
    const terminal = terminalHarness();
    const view = render(<HpcPage terminalBridge={bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    view.unmount();

    await waitFor(() => expect(bridge.close).toHaveBeenCalledWith("session-1"));
    expect(terminal.terminal.dispose).toHaveBeenCalledOnce();
    expect(terminal.fit.dispose).toHaveBeenCalledOnce();
  });

  it("does not become connected when the process exits before start returns", async () => {
    const terminal = terminalHarness();
    const bridge = bridgeHarness();
    bridge.bridge.start.mockImplementation(async (_host, _cols, _rows, listener) => {
      listener({ event: "exit", code: 255 });
      return "early-exit-session";
    });
    render(<HpcPage terminalBridge={bridge.bridge} terminalFactory={terminal.factory} />);

    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    expect(await screen.findByText(/^Exited$/i)).toBeInTheDocument();
    await waitFor(() => expect(bridge.bridge.close).toHaveBeenCalledWith("early-exit-session"));
    expect(screen.queryByText(/^Connected$/i)).not.toBeInTheDocument();
  });

  it("ignores late events from an older session after reconnecting", async () => {
    const terminal = terminalHarness();
    const bridge = bridgeHarness();
    render(<HpcPage terminalBridge={bridge.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);
    act(() => bridge.emitAt(0, { event: "exit", code: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /^Reconnect$/i }));
    await screen.findByText(/^Started$/i);

    act(() => bridge.emitAt(0, { event: "error", message: "old session error" }));

    expect(screen.getByText(/^Started$/i)).toBeInTheDocument();
    expect(screen.queryByText(/old session error/i)).not.toBeInTheDocument();
  });

  it("closes a session after its current write fails before reconnecting", async () => {
    const terminal = terminalHarness();
    const harness = bridgeHarness();
    harness.bridge.write.mockRejectedValueOnce(new Error("write failed"));
    render(<HpcPage terminalBridge={harness.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);

    act(() => terminal.listeners.data?.("x"));

    expect(await screen.findByText(/^Error$/i)).toBeInTheDocument();
    await waitFor(() => expect(harness.bridge.close).toHaveBeenCalledWith("session-1"));
    fireEvent.click(screen.getByRole("button", { name: /^Reconnect$/i }));
    await screen.findByText(/^Started$/i);
    expect(harness.bridge.close.mock.invocationCallOrder[0]).toBeLessThan(harness.bridge.start.mock.invocationCallOrder[1]);
  });

  it("ignores a late write rejection from an old session after reconnecting", async () => {
    const terminal = terminalHarness();
    const harness = bridgeHarness();
    const oldWrite = deferred<void>();
    harness.bridge.write.mockImplementationOnce(() => oldWrite.promise);
    render(<HpcPage terminalBridge={harness.bridge} terminalFactory={terminal.factory} />);
    enterHostAlias();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await screen.findByText(/^Started$/i);
    act(() => terminal.listeners.data?.("pending"));
    act(() => harness.emitAt(0, { event: "exit", code: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /^Reconnect$/i }));
    await screen.findByText(/^Started$/i);

    await act(async () => oldWrite.reject(new Error("late old write failure")));

    expect(screen.getByText(/^Started$/i)).toBeInTheDocument();
    expect(harness.bridge.close).not.toHaveBeenCalledWith("session-2");
  });
});
