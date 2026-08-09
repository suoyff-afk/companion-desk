import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const tag = process.argv[2] ?? "";
const coreVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function readJsonVersion(path) {
  const value = JSON.parse(readFileSync(resolve(root, path), "utf8")).version;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} does not contain a string version`);
  }
  return value;
}

function readCargoVersion() {
  const path = "src-tauri/Cargo.toml";
  const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/);
  const packageStart = lines.findIndex((line) => line.trim() === "[package]");
  if (packageStart < 0) {
    throw new Error(`${path} does not contain a [package] section`);
  }

  const packageLines = lines.slice(packageStart + 1);
  const nextSection = packageLines.findIndex((line) =>
    /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  const section =
    nextSection < 0 ? packageLines : packageLines.slice(0, nextSection);
  const versionLine = section.find((line) => /^\s*version\s*=/.test(line));
  const match = versionLine?.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
  if (!match) {
    throw new Error(`${path} [package] does not contain a string version`);
  }
  return match[1];
}

function validate() {
  const versions = {
    "package.json": readJsonVersion("package.json"),
    "tauri.conf.json": readJsonVersion("src-tauri/tauri.conf.json"),
    "Cargo.toml": readCargoVersion(),
  };
  const uniqueVersions = new Set(Object.values(versions));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `manifest versions do not match: ${Object.entries(versions)
        .map(([name, version]) => `${name}=${version}`)
        .join(", ")}`,
    );
  }

  const version = versions["package.json"];
  if (!coreVersionPattern.test(version)) {
    throw new Error(`invalid core version in manifests: ${version}`);
  }

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(
    `^v${escapedVersion}-beta(?:\\.(?:0|[1-9]\\d*))?$`,
  );
  if (!tagPattern.test(tag)) {
    throw new Error(
      `tag must be v${version}-beta or v${version}-beta.N; received ${tag || "<empty>"}`,
    );
  }

  process.stdout.write(
    `Release tag ${tag} validated for manifest version ${version}\n`,
  );
}

try {
  validate();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Release tag validation failed: ${message}\n`);
  process.exitCode = 1;
}
