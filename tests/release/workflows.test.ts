import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type Job = {
  "runs-on"?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  strategy?: unknown;
  env?: Record<string, string>;
  steps?: Step[];
};

type Workflow = {
  on?: {
    push?: {
      tags?: string[];
    };
  };
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

const repoRoot = resolve(import.meta.dirname, "../..");

function loadWorkflow(filename: string): Workflow {
  return parse(
    readFileSync(resolve(repoRoot, ".github/workflows", filename), "utf8"),
  ) as Workflow;
}

function requireJob(workflow: Workflow, name: string): Job {
  const job = workflow.jobs[name];
  expect(job, `missing ${name} job`).toBeDefined();
  return job;
}

function requireStep(job: Job, predicate: (step: Step) => boolean): Step {
  const step = job.steps?.find(predicate);
  expect(step, "missing workflow step").toBeDefined();
  return step!;
}

const ci = loadWorkflow("ci.yml");
const beta = loadWorkflow("release.yml");
const checklist = readFileSync(
  resolve(repoRoot, "docs/GITHUB-RELEASE-CHECKLIST.md"),
  "utf8",
);
const appSource = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");
const tauriConfig = JSON.parse(readFileSync(resolve(repoRoot, "src-tauri/tauri.conf.json"), "utf8")) as {
  app: { security: { csp: string } };
};

describe("Windows CI workflow", () => {
  it("uses read-only permissions and builds only Windows desktop artifacts", () => {
    expect(ci.permissions).toEqual({ contents: "read" });

    const desktop = requireJob(ci, "desktop");
    expect(desktop["runs-on"]).toBe("windows-latest");
    expect(desktop.strategy).toBeUndefined();

    const upload = requireStep(
      desktop,
      (step) => step.uses === "actions/upload-artifact@v4",
    );
    expect(upload.with).toMatchObject({
      name: "companion-desk-windows-x64-unsigned",
      "if-no-files-found": "error",
    });
    expect(upload.with?.path).toMatch(/bundle\/nsis\/\*\.exe/);
    expect(upload.with?.path).toMatch(/bundle\/msi\/\*\.msi/);
  });

  it("keeps frontend, audit, Rust, and Tauri quality gates", () => {
    const frontend = requireJob(ci, "frontend");
    const desktop = requireJob(ci, "desktop");
    const frontendRuns = frontend.steps?.flatMap((step) => step.run ?? []) ?? [];
    const desktopRuns = desktop.steps?.flatMap((step) => step.run ?? []) ?? [];

    expect(frontendRuns).toEqual(
      expect.arrayContaining([
        "npm run release:history:gate -- --ref HEAD",
        "npm test",
        "npm run build",
        "npm audit --audit-level=high",
      ]),
    );
    expect(desktopRuns).toEqual(
      expect.arrayContaining([
        "cargo test --manifest-path src-tauri/Cargo.toml",
        "npm run tauri -- build",
      ]),
    );
  });

  it("runs Firebase rules tests with Java 21 and pinned emulators", () => {
    const frontend = requireJob(ci, "frontend");
    const java = requireStep(
      frontend,
      (step) => step.uses === "actions/setup-java@v4",
    );
    expect(java.with).toEqual({
      distribution: "temurin",
      "java-version": "21",
    });

    const emulator = requireStep(
      frontend,
      (step) => step.name === "Test Firebase rules",
    );
    expect(emulator.run).toMatch(
      /^npx --yes firebase-tools@15\.24\.0 emulators:exec /,
    );
    expect(emulator.run).toMatch(/--project demo-companion-desk/);
    expect(emulator.run).toMatch(/--only auth,database/);
    expect(emulator.run).toMatch(/"npm run test:firebase"$/);
  });
});

describe("Windows beta release dependency gate", () => {
  it("routes beta-looking tags to the strict validator", () => {
    expect(beta.on?.push?.tags).toEqual(["v*.*.*-beta*"]);
  });

  it("runs every portable verification before the Windows build", () => {
    const verify = requireJob(beta, "verify");
    expect(verify["runs-on"]).toBe("ubuntu-latest");
    expect(verify.permissions).toEqual({ contents: "read" });

    const runs = verify.steps?.flatMap((step) => step.run ?? []) ?? [];
    expect(runs).toEqual(
      expect.arrayContaining([
        "npm ci",
        "npm audit --audit-level=high",
        "npm test",
        "npm run build",
      ]),
    );
    expect(verify.steps?.some((step) => step.uses === "actions/setup-java@v4")).toBe(false);
    expect(runs.join("\n")).not.toMatch(/firebase-tools|test:firebase|emulators:exec/i);

    const tagValidation = requireStep(
      verify,
      (step) => step.name === "Validate release tag",
    );
    expect(tagValidation.env).toEqual({
      RELEASE_TAG: "${{ github.ref_name }}",
    });
    expect(tagValidation.run).toBe(
      'node scripts/validate-release-tag.mjs "$RELEASE_TAG"',
    );
  });

  it("fetches complete history before applying the public-history gate", () => {
    const ciCheckout = requireStep(
      requireJob(ci, "frontend"),
      (step) => step.uses === "actions/checkout@v4",
    );
    const releaseCheckout = requireStep(
      requireJob(beta, "verify"),
      (step) => step.uses === "actions/checkout@v4",
    );

    expect(ciCheckout.with).toMatchObject({ "fetch-depth": 0 });
    expect(releaseCheckout.with).toMatchObject({ "fetch-depth": 0 });
  });

  it("requires private deny terms for a tag release without printing their value", () => {
    const verify = requireJob(beta, "verify");
    const releaseGate = requireStep(
      verify,
      (step) => step.name === "Gate public release history",
    );

    expect(releaseGate.env).toEqual({
      RELEASE_HISTORY_DENY_TERMS: "${{ secrets.RELEASE_HISTORY_DENY_TERMS }}",
    });
    expect(releaseGate.run).toBe(
      "npm run release:history:gate -- --all-refs --require-deny-terms",
    );
    expect(releaseGate.run).not.toMatch(/echo\s+["']?\$\{?RELEASE_HISTORY_DENY_TERMS/i);
    expect(releaseGate.run).not.toMatch(/set\s+-x/);

    const ciGate = requireStep(
      requireJob(ci, "frontend"),
      (step) => step.run === "npm run release:history:gate -- --ref HEAD",
    );
    expect(ciGate.env).toBeUndefined();
  });

  it("gates build and release on explicit successful dependencies", () => {
    const build = requireJob(beta, "build");
    const release = requireJob(beta, "release");

    expect(build.needs).toBe("verify");
    expect(build.if).toBe("${{ needs.verify.result == 'success' }}");
    expect(build.permissions).toEqual({ contents: "read" });

    expect(release.needs).toEqual(["verify", "build"]);
    expect(release.if).toBe(
      "${{ needs.verify.result == 'success' && needs.build.result == 'success' }}",
    );
    expect(release.permissions).toEqual({ contents: "write" });
  });

  it("passes the exact built artifact from build to release", () => {
    const build = requireJob(beta, "build");
    const release = requireJob(beta, "release");

    const upload = requireStep(
      build,
      (step) => step.uses === "actions/upload-artifact@v4",
    );
    expect(upload.with).toMatchObject({
      name: "companion-desk-windows-x64-unsigned",
      "if-no-files-found": "error",
    });
    expect(upload.with?.path).toMatch(/artifacts\/\*\.exe/);
    expect(upload.with?.path).toMatch(/artifacts\/\*\.msi/);
    expect(upload.with?.path).toMatch(/artifacts\/SHA256SUMS\.txt/);

    const download = requireStep(
      release,
      (step) => step.uses === "actions/download-artifact@v4",
    );
    expect(download.with).toEqual({
      name: "companion-desk-windows-x64-unsigned",
      path: "artifacts",
    });

    const publish = requireStep(
      release,
      (step) => step.uses === "softprops/action-gh-release@v2",
    );
    expect(publish.with).toMatchObject({
      draft: true,
      prerelease: true,
      fail_on_unmatched_files: true,
    });
    expect(publish.with?.files).toMatch(/artifacts\/\*\.exe/);
    expect(publish.with?.files).toMatch(/artifacts\/\*\.msi/);
    expect(publish.with?.files).toMatch(/artifacts\/SHA256SUMS\.txt/);
  });

  it("builds one NSIS EXE and MSI, then generates SHA-256 checksums", () => {
    const build = requireJob(beta, "build");
    expect(build["runs-on"]).toBe("windows-latest");
    expect(build.strategy).toBeUndefined();

    const prepare = requireStep(
      build,
      (step) => step.name === "Prepare unsigned Windows release assets",
    );
    expect(prepare.run).toMatch(/bundle\/nsis/);
    expect(prepare.run).toMatch(/bundle\/msi/);
    expect(prepare.run).toMatch(/\$nsis\.Count -ne 1/);
    expect(prepare.run).toMatch(/\$msi\.Count -ne 1/);
    expect(prepare.run).toContain(
      '"Companion-Desk_${version}_windows-x64-setup.exe"',
    );
    expect(prepare.run).toContain(
      '"Companion-Desk_${version}_windows-x64.msi"',
    );
    expect(prepare.run).toMatch(/Get-FileHash/);
    expect(prepare.run).toMatch(/SHA256SUMS\.txt/);
  });

  it("remaps Rust source paths and scans the inner executable before upload", () => {
    const build = requireJob(beta, "build");
    const steps = build.steps ?? [];
    const remapIndex = steps.findIndex(
      (step) => step.name === "Configure reproducible Rust paths",
    );
    const tauriIndex = steps.findIndex(
      (step) => step.run?.includes("npm run tauri -- build"),
    );
    const scanIndex = steps.findIndex(
      (step) => step.name === "Scan Rust binary for local build paths",
    );
    const uploadIndex = steps.findIndex(
      (step) => step.uses === "actions/upload-artifact@v4",
    );

    expect(remapIndex).toBeGreaterThan(-1);
    expect(tauriIndex).toBeGreaterThan(remapIndex);
    expect(scanIndex).toBeGreaterThan(tauriIndex);
    expect(uploadIndex).toBeGreaterThan(scanIndex);

    const remap = steps[remapIndex];
    expect(remap.shell).toBe("pwsh");
    expect(remap.run).toMatch(/GITHUB_WORKSPACE/);
    expect(remap.run).toMatch(/CARGO_HOME/);
    expect(remap.run).toMatch(/RUSTUP_HOME/);
    expect(remap.run).toMatch(/--remap-path-prefix=.*=\/workspace/);
    expect(remap.run).toMatch(/--remap-path-prefix=.*=\/cargo-home/);
    expect(remap.run).toMatch(/--remap-path-prefix=.*=\/rustup-home/);
    expect(remap.run).toMatch(/GITHUB_ENV/);

    const scan = steps[scanIndex];
    expect(scan.shell).toBe("pwsh");
    expect(scan.run).toMatch(/scan-binary-paths\.mjs/);
    expect(scan.env).toMatchObject({
      BINARY_PATH: "src-tauri/target/release/kunkun-desk.exe",
    });
  });

  it("builds a local-first beta without Firebase configuration or emulator dependencies", () => {
    const build = requireJob(beta, "build");
    const verify = requireJob(beta, "verify");
    expect(beta.env).toEqual({ VITE_ENABLE_FRIENDS: "false" });
    expect(verify.env).toBeUndefined();
    expect(build.env).toBeUndefined();

    const steps = build.steps ?? [];
    expect(steps.some((step) => /firebase/i.test(step.name ?? "") || /firebase/i.test(step.run ?? ""))).toBe(false);
    const tauri = requireStep(build, (step) => step.run === "npm run tauri -- build");
    expect(tauri.run).toBe("npm run tauri -- build");
  });

  it("keeps the shipped beta entrypoint and production CSP local-first", () => {
    expect(appSource).not.toMatch(/from\s+["']\.\/features\/friends\/firebaseFriendPort["']/);
    expect(appSource).toMatch(/import\(["']\.\/features\/friends\/firebaseFriendPort["']\)/);
    expect(tauriConfig.app.security.csp).not.toMatch(/firebase|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/i);
  });
});

describe("release operator checklist", () => {
  it("documents the draft beta gate and exact Windows artifacts", () => {
    expect(checklist).toMatch(/`v0\.5\.1-beta`/);
    expect(checklist).toMatch(/`companion-desk-windows-x64-unsigned`/);
    expect(checklist).toMatch(/draft and prerelease/);
    expect(checklist).toMatch(/SHA256SUMS\.txt/);
    expect(checklist).toMatch(/Do not publish/);
  });
});
