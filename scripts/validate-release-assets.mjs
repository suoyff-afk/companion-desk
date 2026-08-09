import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = process.cwd();
const requireRedistributable = process.argv.includes("--require-redistributable");
const schemaOnly = process.argv.includes("--schema-only");
const requiredFields = ["path", "purpose", "source", "copyrightHolder", "license", "evidence"];

if ((requireRedistributable && schemaOnly) || (!requireRedistributable && !schemaOnly)) {
  throw new Error("Use exactly one of --schema-only or --require-redistributable.");
}

function fail(message) {
  process.stderr.write(`Asset release validation failed: ${message}\n`);
  process.exitCode = 1;
}

const normalized = (path) => path.replaceAll("\\", "/");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function referencedAssets() {
  const referenced = new Set();
  const imageExtension = /\.(?:gif|icns|ico|jpe?g|png|svg|webp)$/i;

  for (const path of sourceFiles(resolve(root, "src"))) {
    const contents = readFileSync(path, "utf8");
    for (const match of contents.matchAll(/["']([^"']+\.(?:gif|icns|ico|jpe?g|png|svg|webp))["']/gi)) {
      if (!match[1].startsWith(".")) continue;
      referenced.add(normalized(relative(root, resolve(dirname(path), match[1]))));
    }
  }

  const tauri = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  for (const icon of tauri.bundle?.icon ?? []) {
    referenced.add(normalized(`src-tauri/${icon}`));
  }

  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  for (const match of readme.matchAll(/!\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+[^)]*)?\)/g)) {
    const path = match[1];
    if (!imageExtension.test(path) || /^(?:data:|https?:)/i.test(path)) continue;
    referenced.add(normalized(path));
  }

  return [...referenced].sort();
}

try {
  const inventoryPath = resolve(root, "licenses/assets.json");
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (!Array.isArray(inventory.assets) || inventory.assets.length === 0) {
    throw new Error("assets.json must contain a non-empty assets array.");
  }

  const seen = new Set();
  for (const asset of inventory.assets) {
    if (!asset || typeof asset !== "object") throw new Error("Every asset record must be an object.");
    for (const field of requiredFields) {
      if (typeof asset[field] !== "string" || asset[field].trim().length === 0) {
        throw new Error(`Asset record is missing ${field}.`);
      }
    }
    if (typeof asset.redistributable !== "boolean") {
      throw new Error(`Asset ${asset.path} must declare redistributable as true or false.`);
    }
    if (seen.has(asset.path)) throw new Error(`Duplicate asset record: ${asset.path}`);
    if (!existsSync(resolve(root, asset.path))) throw new Error(`Asset path does not exist: ${asset.path}`);
    seen.add(asset.path);
  }

  const missing = referencedAssets().filter((path) => !seen.has(path));
  if (missing.length > 0) {
    throw new Error(`Referenced binary or README assets are missing from assets.json: ${missing.join(", ")}.`);
  }

  if (requireRedistributable) {
    const blocked = inventory.assets.filter((asset) => !asset.redistributable).map((asset) => asset.path);
    if (blocked.length > 0) {
      fail(`BLOCKED: redistribution authorization is not verified for ${blocked.join(", ")}.`);
    } else {
      process.stdout.write("All shipped assets are verified redistributable.\n");
    }
  } else {
    process.stdout.write(`Asset inventory schema validated (${inventory.assets.length} records).\n`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
