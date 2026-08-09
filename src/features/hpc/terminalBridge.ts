import { Channel, invoke } from "@tauri-apps/api/core";

export type TerminalEvent =
  | { event: "output"; data: string }
  | { event: "exit"; code: number }
  | { event: "error"; message: string };

export type SshProcessStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "processRunning"; sessionId: string }
  | { state: "exited"; code: number | null }
  | { state: "error"; message: string };

export interface TerminalBridge {
  start(hostAlias: string, cols: number, rows: number, onEvent: (event: TerminalEvent) => void): Promise<string>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  getStatus(): Promise<SshProcessStatus>;
  closeAll(): Promise<void>;
}

function requireDesktop(): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Embedded SSH is available only in the Windows desktop build.");
  }
}

export const desktopTerminalBridge: TerminalBridge = {
  async start(hostAlias, cols, rows, onEvent) {
    requireDesktop();
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = onEvent;
    return invoke<string>("start_ssh_terminal", { hostAlias, cols, rows, onEvent: channel });
  },
  async write(sessionId, data) {
    requireDesktop();
    await invoke("write_ssh_terminal", { sessionId, data });
  },
  async resize(sessionId, cols, rows) {
    requireDesktop();
    await invoke("resize_ssh_terminal", { sessionId, cols, rows });
  },
  async close(sessionId) {
    requireDesktop();
    await invoke("close_ssh_terminal", { sessionId });
  },
  async getStatus() {
    requireDesktop();
    return invoke<SshProcessStatus>("get_ssh_status");
  },
  async closeAll() {
    requireDesktop();
    await invoke("close_all_ssh");
  },
};
