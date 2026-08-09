import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const script = join(root, "scripts", "validate-release-assets.mjs");

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

describe("release asset provenance", () => {
  it("inventories every binary and README image with verifiable provenance", () => {
    const inventory = JSON.parse(readFileSync(join(root, "licenses", "assets.json"), "utf8")) as {
      assets: Array<{ path: string; evidence: string }>;
    };
    const byPath = new Map(inventory.assets.map((asset) => [asset.path, asset]));

    expect([...byPath.keys()]).toEqual(expect.arrayContaining([
      "src/assets/kunkun-spritesheet.webp",
      "src/assets/kunkun-wave.png",
      "src-tauri/icons/32x32.png",
      "src-tauri/icons/128x128.png",
      "src-tauri/icons/128x128@2x.png",
      "src-tauri/icons/icon.icns",
      "src-tauri/icons/icon.ico",
      "docs/images/companion-home.png",
      "docs/images/token-view.png",
    ]));
    expect(byPath.get("src/assets/kunkun-spritesheet.webp")?.evidence).toContain("2026-08-09");
    expect(byPath.get("src/assets/kunkun-wave.png")?.evidence).toContain("2026-08-09");
    expect(byPath.has("codex.svg")).toBe(false);
    expect(existsSync(join(root, "codex.svg"))).toBe(false);
    expect(readFileSync(join(root, "src", "components", "ProviderMark.tsx"), "utf8"))
      .not.toContain("codex.svg");
  });

  it("keeps public screenshots out of the internal QA tree", () => {
    const trackedQa = spawnSync(
      "git",
      ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "ls-files", "docs/qa"],
      { cwd: root, encoding: "utf8" },
    );

    expect(trackedQa.status).toBe(0);
    expect(trackedQa.stdout.trim()).toBe("");
  });

  it("accepts the authorized inventory for redistribution", () => {
    expect(run("--schema-only").status).toBe(0);
    const gate = run("--require-redistributable");
    expect(gate.status).toBe(0);
    expect(gate.stdout).toContain("verified redistributable");
  });
});
