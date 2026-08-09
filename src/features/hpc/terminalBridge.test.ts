// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class MockChannel<T> {
    onmessage?: (message: T) => void;
  },
  invoke: tauriMocks.invoke,
}));

import { desktopTerminalBridge } from "./terminalBridge";

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.resetAllMocks();
});

function enableTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
}

describe("desktopTerminalBridge", () => {
  it("reads and closes the shared native SSH process", async () => {
    enableTauri();
    tauriMocks.invoke.mockResolvedValueOnce({ state: "processRunning", sessionId: "ssh-42" });

    await expect(desktopTerminalBridge.getStatus()).resolves.toEqual({
      state: "processRunning",
      sessionId: "ssh-42",
    });
    await desktopTerminalBridge.closeAll();

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "get_ssh_status");
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "close_all_ssh");
  });
});
