import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const commit = "73d67168136b36fd3b644159b0cff149da4905d9";
const require = createRequire(import.meta.url);

describe("patched Nano ID source", () => {
  it("pins the official 3.3.17 commit with an integrity hash", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const nanoid = lock.packages["node_modules/postcss/node_modules/nanoid"];

    expect(manifest.overrides.postcss.nanoid).toContain(commit);
    expect(nanoid.version).toBe("3.3.17");
    expect(nanoid.resolved).toContain(commit);
    expect(nanoid.integrity).toMatch(/^sha512-/);
  });

  it("returns from a zero-size custom generator instead of looping", () => {
    const script = [
      'const { createRequire } = require("node:module")',
      'const fromPostcss = createRequire(require.resolve("postcss/package.json"))',
      'const { customAlphabet } = fromPostcss("nanoid")',
      'const value = customAlphabet("abc", 0)()',
      'if (value !== "") process.exit(2)',
    ].join(";");
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 1_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("remains compatible with PostCSS CommonJS input processing", async () => {
    const postcss = require("postcss");
    const input = new postcss.Input("a { color: red }");
    const result = await postcss([]).process(input.css, { from: undefined });

    expect(input.id).toMatch(/^<input css [\w-]{6}>$/);
    expect(result.css).toBe("a { color: red }");
  });
});
