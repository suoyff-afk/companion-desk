import { ArrowClockwise, Broom, Plugs, XCircle } from "@phosphor-icons/react";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TerminalBridge, TerminalEvent } from "./terminalBridge";

interface Disposable {
  dispose(): void;
}

export interface TerminalAdapter {
  readonly cols: number;
  readonly rows: number;
  open(element: HTMLElement): void;
  write(data: Uint8Array): void;
  clear(): void;
  focus(): void;
  dispose(): void;
  onData(listener: (data: string) => void): Disposable;
  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable;
}

export interface FitAdapter extends Disposable {
  fit(): void;
}

type TerminalBundle = { terminal: TerminalAdapter; fit: FitAdapter };
export type TerminalFactory = () => TerminalBundle | Promise<TerminalBundle>;

export const XTERM_OPTIONS = {
  cursorBlink: true,
  convertEol: false,
  fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  screenReaderMode: true,
  scrollback: 5000,
  theme: {
    background: "#07111f",
    foreground: "#d9e6f2",
    cursor: "#67e8b1",
    selectionBackground: "#27476a",
    black: "#0b1626",
    blue: "#63a6ff",
    brightBlue: "#8bbcff",
    green: "#5cdb95",
    brightGreen: "#7cf0ad",
  },
} satisfies import("@xterm/xterm").ITerminalOptions;

export const createXtermTerminal: TerminalFactory = async () => {
  const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
  const terminal = new Terminal(XTERM_OPTIONS);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  return { terminal, fit };
};

type ConnectionStatus = "Disconnected" | "Connecting" | "Started" | "Exited" | "Error";

interface TerminalPanelProps {
  hostAlias: string;
  hostValid: boolean;
  bridge: TerminalBridge;
  terminalFactory: TerminalFactory;
  onConnected(): void;
  connectionFields: ReactNode;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "SSH terminal operation failed.");
}

export function TerminalPanel({ hostAlias, hostValid, bridge, terminalFactory, onConnected, connectionFields }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalAdapter | null>(null);
  const fitRef = useRef<FitAdapter | null>(null);
  const sessionRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<ConnectionStatus>("Disconnected");
  const [detail, setDetail] = useState("Ready to connect using your SSH config.");
  const [terminalReady, setTerminalReady] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let terminal: TerminalAdapter | null = null;
    let fit: FitAdapter | null = null;
    let dataDisposable: Disposable | null = null;
    let resizeDisposable: Disposable | null = null;
    let observer: ResizeObserver | null = null;

    const setup = (bundle: TerminalBundle) => {
      if (cancelled) {
        bundle.fit.dispose();
        bundle.terminal.dispose();
        return;
      }
      terminal = bundle.terminal;
      fit = bundle.fit;
      terminalRef.current = terminal;
      fitRef.current = fit;
      if (containerRef.current) terminal.open(containerRef.current);
      dataDisposable = terminal.onData((data) => {
        const sessionId = sessionRef.current;
        const attempt = attemptRef.current;
        if (sessionId) void bridge.write(sessionId, data).catch(async () => {
          if (mountedRef.current && attempt === attemptRef.current && sessionRef.current === sessionId) {
            attemptRef.current += 1;
            sessionRef.current = null;
            setCleanupPending(true);
            setStatus("Error");
            setDetail("Could not write to the SSH terminal.");
            await bridge.close(sessionId).catch(() => undefined);
            if (mountedRef.current) setCleanupPending(false);
          }
        });
      });
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        const sessionId = sessionRef.current;
        if (sessionId) void bridge.resize(sessionId, cols, rows).catch(() => undefined);
      });
      const fitTerminal = () => {
        try { fit?.fit(); } catch { /* The container can be between layouts during navigation. */ }
      };
      fitTerminal();
      observer = typeof ResizeObserver === "undefined" || !containerRef.current
        ? null
        : new ResizeObserver(fitTerminal);
      if (observer && containerRef.current) observer.observe(containerRef.current);
      setTerminalReady(true);
    };

    try {
      const result = terminalFactory();
      if (result instanceof Promise) {
        void result.then(setup).catch((error) => {
          if (!cancelled) {
            setStatus("Error");
            setDetail(errorMessage(error));
          }
        });
      } else {
        setup(result);
      }
    } catch (error) {
      setStatus("Error");
      setDetail(errorMessage(error));
    }

    return () => {
      cancelled = true;
      mountedRef.current = false;
      attemptRef.current += 1;
      observer?.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      const sessionId = sessionRef.current;
      sessionRef.current = null;
      if (sessionId) void bridge.close(sessionId).catch(() => undefined);
      fit?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [bridge, terminalFactory]);

  const receiveEvent = useCallback((attempt: number, event: TerminalEvent) => {
    if (!mountedRef.current || attempt !== attemptRef.current) return;
    if (event.event === "output") {
      terminalRef.current?.write(decodeBase64(event.data));
      return;
    }
    sessionRef.current = null;
    attemptRef.current += 1;
    if (event.event === "exit") {
      setStatus("Exited");
      setDetail(`SSH process exited with code ${event.code}.`);
    } else {
      setStatus("Error");
      setDetail(event.message);
    }
  }, []);

  const connect = async () => {
    if (cleanupPending || !hostValid || status === "Connecting" || status === "Started") return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setStatus("Connecting");
    setDetail(`Connecting to ${hostAlias}…`);
    try {
      fitRef.current?.fit();
      const sessionId = await bridge.start(hostAlias, terminal.cols, terminal.rows, (event) => receiveEvent(attempt, event));
      if (!mountedRef.current || attempt !== attemptRef.current) {
        await bridge.close(sessionId);
        return;
      }
      sessionRef.current = sessionId;
      setStatus("Started");
      setDetail(`SSH process started for ${hostAlias}. Complete authentication in the terminal.`);
      terminal.focus();
      onConnected();
    } catch (error) {
      if (mountedRef.current && attempt === attemptRef.current) {
        attemptRef.current += 1;
        setStatus("Error");
        setDetail(errorMessage(error));
      }
    }
  };

  const disconnect = async () => {
    attemptRef.current += 1;
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    if (sessionId) await bridge.close(sessionId).catch(() => undefined);
    if (mountedRef.current) {
      setStatus("Disconnected");
      setDetail("Session closed. Terminal output was not saved.");
    }
  };

  const connected = status === "Started";
  return (
    <>
      <div className="glass-panel ssh-connection-bar" role="group" aria-label="SSH connection controls">
        {connectionFields}
        <div className="ssh-connection-actions">
          <button type="button" onClick={() => terminalRef.current?.clear()}><Broom />Clear</button>
          {connected ? (
            <button type="button" className="terminal-action terminal-action--disconnect" onClick={() => void disconnect()}><XCircle />Disconnect</button>
          ) : (
            <button type="button" className="terminal-action" onClick={() => void connect()} disabled={cleanupPending || !terminalReady || !hostValid || status === "Connecting"}>
              {status === "Exited" || status === "Error" ? <ArrowClockwise /> : <Plugs />}
              {status === "Exited" || status === "Error" ? "Reconnect" : status === "Connecting" ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>

      <article className="ssh-terminal-card" aria-label="Embedded SSH terminal">
        <header className="ssh-terminal-card__header">
          <span className={`terminal-light terminal-light--${status.toLowerCase()}`} />
          <strong>Windows OpenSSH</strong>
          <span className="terminal-status" data-state={status.toLowerCase()} role="status" aria-live="polite" aria-atomic="true">{status}</span>
          <small>ConPTY · Local</small>
        </header>
        <div ref={containerRef} className="xterm-host" aria-label="SSH terminal output" />
        <footer className="terminal-toolbar"><p>{detail}</p></footer>
      </article>
    </>
  );
}
