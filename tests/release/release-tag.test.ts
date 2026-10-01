import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(
  import.meta.dirname,
  "../../scripts/validate-release-tag.mjs",
);
const fixtures: string[] = [];

function createFixture(versions: {
  package: string;
  tauri: string;
  cargo: string;
}): string {
  const root = mkdtempSync(resolve(tmpdir(), "companion-release-tag-"));
  fixtures.push(root);
  mkdirSync(resolve(root, "src-tauri"), { recursive: true });
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({ version: versions.package }),
  );
  writeFileSync(
    resolve(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: versions.tauri }),
  );
  writeFileSync(
    resolve(root, "src-tauri/Cargo.toml"),
    `[package]\nname = "fixture"\nversion = "${versions.cargo}"\n\n[dependencies]\n`,
  );
  return root;
}

function runValidator(root: string, tag: string) {
  return spawnSync(process.execPath, [script, tag], {
    cwd: root,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("release tag validator", () => {
  it.each(["v0.5.1-beta", "v0.5.1-beta.2"])(
    "accepts %s when all manifests are version 0.5.1",
    (tag) => {
      const root = createFixture({
        package: "0.5.1",
        tauri: "0.5.1",
        cargo: "0.5.1",
      });

      const result = runValidator(root, tag);

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/validated .*0\.5\.1/);
      expect(result.stderr).toBe("");
    },
  );

  it("rejects a tag whose core version differs from the manifests", () => {
    const root = createFixture({
      package: "0.5.1",
      tauri: "0.5.1",
      cargo: "0.5.1",
    });

    const result = runValidator(root, "v0.5.2-beta");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /tag must be v0\.5\.1-beta or v0\.5\.1-beta\.N/,
    );
  });

  it("rejects inconsistent package, Tauri, and Cargo versions", () => {
    const root = createFixture({
      package: "0.5.1",
      tauri: "0.5.2",
      cargo: "0.5.1",
    });

    const result = runValidator(root, "v0.5.1-beta");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/manifest versions do not match/i);
    expect(result.stderr).toMatch(/package\.json=0\.5\.1/);
    expect(result.stderr).toMatch(/tauri\.conf\.json=0\.5\.2/);
    expect(result.stderr).toMatch(/Cargo\.toml=0\.5\.1/);
  });

  it.each(["v00.5.1-beta", "v0.5.1-beta.01"])(
    "rejects leading zero tag %s",
    (tag) => {
      const root = createFixture({
        package: "0.5.1",
        tauri: "0.5.1",
        cargo: "0.5.1",
      });

      const result = runValidator(root, tag);

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /tag must be v0\.5\.1-beta or v0\.5\.1-beta\.N/,
      );
    },
  );

  it("rejects a manifest version with a leading zero", () => {
    const root = createFixture({
      package: "00.5.0",
      tauri: "00.5.0",
      cargo: "00.5.0",
    });

    const result = runValidator(root, "v00.5.0-beta");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/invalid core version/i);
  });
});
