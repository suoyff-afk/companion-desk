import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function decodedViews(bytes) {
  return [
    Buffer.from(bytes).toString("utf8"),
    Buffer.from(bytes).subarray(0).toString("utf16le"),
    Buffer.from(bytes).subarray(1).toString("utf16le"),
  ];
}

export function findForbiddenBinaryText(bytes, forbiddenPaths) {
  const decoded = decodedViews(bytes);
  for (const candidate of forbiddenPaths.filter(Boolean)) {
    for (const variant of [candidate, candidate.replaceAll("\\", "/")]) {
      const lower = variant.toLocaleLowerCase("en-US");
      if (decoded.some((text) => text.toLocaleLowerCase("en-US").includes(lower))) {
        return variant;
      }
    }
  }

  const cargoRegistry = /[A-Z]:[\\/](?:Users[\\/][^\\/]+[\\/])?\.cargo[\\/]registry[\\/]src[\\/]/i;
  if (decoded.some((text) => cargoRegistry.test(text))) {
    return "Cargo registry absolute source prefix";
  }
  return null;
}

async function main() {
  const binaryPath = process.argv[2] ?? process.env.BINARY_PATH;
  if (!binaryPath) throw new Error("binary path is required");
  const cargoHome = process.env.CARGO_HOME
    || (process.env.USERPROFILE ? resolve(process.env.USERPROFILE, ".cargo") : "");
  const rustupHome = process.env.RUSTUP_HOME
    || (process.env.USERPROFILE ? resolve(process.env.USERPROFILE, ".rustup") : "");
  const forbidden = [
    process.env.GITHUB_WORKSPACE,
    process.env.USERPROFILE,
    process.env.CARGO_HOME,
    process.env.RUSTUP_HOME,
    cargoHome,
    rustupHome,
  ].filter(Boolean).map((value) => resolve(value));
  const match = findForbiddenBinaryText(await readFile(binaryPath), [...new Set(forbidden)]);
  if (match) throw new Error(`Rust binary contains a local build path: ${match}`);
  process.stdout.write("Rust binary path scan passed\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Binary path scan failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
