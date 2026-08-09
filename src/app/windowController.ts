import type { WindowLayout } from "./windowLayout";

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowEffects {
  effects: string[];
}

export interface WindowPort {
  ensureVisible?(): Promise<void>;
  clearEffects(): Promise<void>;
  unmaximize(): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  setResizable(value: boolean): Promise<void>;
  setEffects(effects: WindowEffects): Promise<void>;
  setShadow(value: boolean): Promise<void>;
  setMinSize(size: WindowSize): Promise<void>;
  setMaxSize(size: WindowSize | null): Promise<void>;
  setSize(size: WindowSize): Promise<void>;
  setSkipTaskbar(value: boolean): Promise<void>;
}

export interface WindowLogger {
  warn(message: string, error: unknown): void;
}

function warnSafely(logger: WindowLogger, message: string, error: unknown): void {
  try {
    logger.warn(message, error);
  } catch {
    // Logging must never block navigation or window recovery.
  }
}

async function recoverFindableWindow(port: WindowPort, logger: WindowLogger): Promise<void> {
  const recoverySteps: Array<[string, () => Promise<void>]> = [
    ["setAlwaysOnTop(false)", () => port.setAlwaysOnTop(false)],
    ["setSkipTaskbar(false)", () => port.setSkipTaskbar(false)],
    ["setResizable(true)", () => port.setResizable(true)],
    ["setMaxSize(null)", () => port.setMaxSize(null)],
    ["clearEffects", () => port.clearEffects()],
    ["setShadow(false)", () => port.setShadow(false)],
  ];

  for (const [step, recover] of recoverySteps) {
    try {
      await recover();
    } catch (error) {
      warnSafely(logger, `[windowController] recovery failed at ${step}`, error);
    }
  }
}

export async function applyWindowLayout(
  layout: WindowLayout,
  port: WindowPort,
  logger: WindowLogger = console,
): Promise<boolean> {
  const size = { width: layout.width, height: layout.height };
  const minimumSize = { width: layout.minWidth, height: layout.minHeight };
  const collapsed = !layout.resizable;
  let step = "unmaximize";

  const runStep = async (name: string, action: () => Promise<void>) => {
    step = name;
    await action();
  };

  const runOptionalStep = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      warnSafely(logger, `[windowController] optional step failed at ${name}`, error);
    }
  };

  try {
    await runStep("unmaximize", () => port.unmaximize());
    if (!collapsed) {
      await runStep("setAlwaysOnTop(expanded)", () => port.setAlwaysOnTop(false));
    }
    await runStep("setResizable(initial)", () => port.setResizable(true));

    if (collapsed) {
      await runOptionalStep("clearEffects", () => port.clearEffects());
      await runOptionalStep("setShadow(false)", () => port.setShadow(false));
      await runStep("setMaxSize(collapsed-reset)", () => port.setMaxSize(null));
      await runStep("setMinSize", () => port.setMinSize(minimumSize));
      await runStep("setMaxSize(collapsed)", () => port.setMaxSize(size));
      await runStep("setSize", () => port.setSize(size));
      await runStep("setResizable(final)", () => port.setResizable(false));
      await runStep("setSkipTaskbar(collapsed)", () => port.setSkipTaskbar(true));
      await runStep("setAlwaysOnTop(collapsed)", () => port.setAlwaysOnTop(true));
    } else {
      await runStep("setSkipTaskbar(expanded)", () => port.setSkipTaskbar(false));
      await runOptionalStep("clearEffects", () => port.clearEffects());
      await runOptionalStep("setShadow(false)", () => port.setShadow(false));
      await runStep("setMaxSize(expanded)", () => port.setMaxSize(null));
      await runStep("setMinSize", () => port.setMinSize(minimumSize));
      await runStep("setSize", () => port.setSize(size));
      await runStep("setResizable(final)", () => port.setResizable(layout.resizable));
    }
    if (port.ensureVisible !== undefined) {
      await runOptionalStep("ensureVisible", () => port.ensureVisible!());
    }

    return true;
  } catch (error) {
    warnSafely(logger, `[windowController] apply failed at ${step}`, error);
    await recoverFindableWindow(port, logger);
    return false;
  }
}
