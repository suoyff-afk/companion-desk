import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const require = createRequire(import.meta.url);

describe("patched Nano ID source", () => {
  it("pins the official published 3.3.18 patch with its integrity hash", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const nanoid = lock.packages["node_modules/nanoid"]
      ?? lock.packages["node_modules/postcss/node_modules/nanoid"];

    expect(manifest.overrides.postcss.nanoid).toBe("3.3.18");
    expect(nanoid.version).toBe("3.3.18");
    expect(nanoid.resolved).toBe("https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz");
    expect(nanoid.integrity).toBe("sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==");
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
