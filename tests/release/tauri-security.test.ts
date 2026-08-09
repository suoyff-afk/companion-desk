import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const readJson = (path: string) => JSON.parse(readText(path));

const REQUIRED_RENDERER_PERMISSIONS = [
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "core:window:allow-available-monitors",
  "core:window:allow-center",
  "core:window:allow-close",
  "core:window:allow-current-monitor",
  "core:window:allow-hide",
  "core:window:allow-inner-size",
  "core:window:allow-is-maximized",
  "core:window:allow-outer-position",
  "core:window:allow-outer-size",
  "core:window:allow-scale-factor",
  "core:window:allow-set-always-on-top",
  "core:window:allow-set-effects",
  "core:window:allow-set-max-size",
  "core:window:allow-set-min-size",
  "core:window:allow-set-position",
  "core:window:allow-set-resizable",
  "core:window:allow-set-shadow",
  "core:window:allow-set-size",
  "core:window:allow-set-skip-taskbar",
  "core:window:allow-start-dragging",
  "core:window:allow-toggle-maximize",
  "core:window:allow-unmaximize",
  "store:allow-get",
  "store:allow-load",
  "store:allow-save",
  "store:allow-set",
].sort();

const WINDOW_CALL_PERMISSIONS: Record<string, string[]> = {
  availableMonitors: ["core:window:allow-available-monitors"],
  center: ["core:window:allow-center"],
  clearEffects: ["core:window:allow-set-effects"],
  close: ["core:window:allow-close"],
  currentMonitor: ["core:window:allow-current-monitor"],
  hide: ["core:window:allow-hide"],
  innerSize: ["core:window:allow-inner-size"],
  isMaximized: ["core:window:allow-is-maximized"],
  onResized: ["core:event:allow-listen", "core:event:allow-unlisten"],
  outerPosition: ["core:window:allow-outer-position"],
  outerSize: ["core:window:allow-outer-size"],
  scaleFactor: ["core:window:allow-scale-factor"],
  setAlwaysOnTop: ["core:window:allow-set-always-on-top"],
  setEffects: ["core:window:allow-set-effects"],
  setMaxSize: ["core:window:allow-set-max-size"],
  setMinSize: ["core:window:allow-set-min-size"],
  setPosition: ["core:window:allow-set-position"],
  setResizable: ["core:window:allow-set-resizable"],
  setShadow: ["core:window:allow-set-shadow"],
  setSize: ["core:window:allow-set-size"],
  setSkipTaskbar: ["core:window:allow-set-skip-taskbar"],
  startDragging: ["core:window:allow-start-dragging"],
  toggleMaximize: ["core:window:allow-toggle-maximize"],
  unmaximize: ["core:window:allow-unmaximize"],
};

function rendererWindowCalls(): string[] {
  const source = ["src/lib/bridge.ts", "src/components/WindowChrome.tsx"]
    .map(readText)
    .join("\n");
  const calls = new Set(
    [...source.matchAll(
      /(?:getCurrentWindow\(\)|(?:geometry\.)?currentWindow)\.(\w+)\s*\(/g,
    )].map((match) => match[1]),
  );
  for (const freeFunction of ["availableMonitors", "currentMonitor"]) {
    if (new RegExp(`\\b${freeFunction}\\s*\\(`).test(source)) calls.add(freeFunction);
  }
  return [...calls].sort();
}

function parseCsp(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name, values];
      }),
  );
}

describe("Tauri release security contract", () => {
  it("grants the main renderer only the IPC permissions used by shipped features", () => {
    const capability = readJson("src-tauri/capabilities/default.json");

    expect([...capability.permissions].sort()).toEqual(REQUIRED_RENDERER_PERMISSIONS);
    expect(capability.permissions).not.toContain("core:default");
    expect(capability.permissions).not.toContain("store:default");
    expect(capability.permissions).not.toContain("window-state:default");
  });

  it("maps every renderer window call to its required permission", () => {
    const capability = readJson("src-tauri/capabilities/default.json");

    expect(rendererWindowCalls()).toEqual(Object.keys(WINDOW_CALL_PERMISSIONS).sort());
    for (const [method, permissions] of Object.entries(WINDOW_CALL_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(capability.permissions, `${method} requires ${permission}`).toContain(permission);
      }
    }
  });

  it.each(["csp", "devCsp"])("hardens %s against embedded and navigational content", (policyName) => {
    const config = readJson("src-tauri/tauri.conf.json");
    const directives = parseCsp(config.app.security[policyName]);

    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });

  it("keeps the production policy local-first", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const directives = parseCsp(config.app.security.csp);

    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(config.app.security.csp).not.toMatch(/firebase|googleapis|127\.0\.0\.1/i);
  });
});
