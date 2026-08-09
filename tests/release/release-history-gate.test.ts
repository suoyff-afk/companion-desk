import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const gate = join(root, "scripts", "release-history-gate.mjs");
const node = process.execPath;

function git(repo: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function put(repo: string, path: string, contents: string) {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function putBytes(repo: string, path: string, contents: Buffer) {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function utf16be(value: string, bom = true) {
  const bytes = Buffer.from(value, "utf16le");
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    [bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]];
  }
  return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]) : bytes;
}

function commit(
  repo: string,
  message: string,
  email = "12345+release-bot@users.noreply.github.com",
  name = "Companion Desk Release",
) {
  git(repo, "add", "-A");
  git(
    repo,
    "-c",
    `user.name=${name}`,
    "-c",
    `user.email=${email}`,
    "commit",
    "-m",
    message,
  );
}

function fixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), "companion-release-gate-"));
  git(repo, "init", "--initial-branch=main");
  put(repo, "README.md", "# Clean public source\n");
  commit(repo, "public root");
  return repo;
}

function runGateWithEnv(repo: string, environment: Record<string, string>, ...args: string[]) {
  return spawnSync(node, [gate, "--repo", repo, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function runGate(repo: string, ...args: string[]) {
  return runGateWithEnv(repo, {}, ...args);
}

describe("public history release gate", { timeout: 20_000 }, () => {
  it("passes a clean ref and reports every scanned boundary", () => {
    const result = runGate(fixtureRepo(), "--ref", "HEAD");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/tracked tree/i);
    expect(result.stdout).toMatch(/reachable blobs/i);
    expect(result.stdout).toMatch(/commit metadata/i);
    expect(result.stdout).toMatch(/source archive/i);
  });

  it("fails with a precise tracked-file location for machine-local paths", () => {
    const repo = fixtureRepo();
    const localPath = ["C:", "Users", "private-user", "AppData", "token.json"].join("\\");
    put(repo, "notes.txt", `do not publish ${localPath}\n`);
    commit(repo, "add private path");

    const result = runGate(repo, "--ref", "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked:notes.txt");
    expect(result.stderr).toMatch(/machine-local absolute path/i);
  });

  it("finds a deleted secret in reachable history instead of treating the tree as clean", () => {
    const repo = fixtureRepo();
    const token = ["github", "_pat_", "A".repeat(30)].join("");
    put(repo, "removed-secret.txt", `${token}\n`);
    commit(repo, "accidentally add token");
    git(repo, "rm", "removed-secret.txt");
    commit(repo, "remove token");

    const strict = runGate(repo, "--ref", "HEAD");
    const diagnostic = runGate(repo, "--ref", "HEAD", "--tree-only");

    expect(strict.status).toBe(1);
    expect(strict.stderr).toMatch(/history:[0-9a-f]+:removed-secret\.txt/i);
    expect(strict.stderr).toMatch(/GitHub personal access token/i);
    expect(diagnostic.status, diagnostic.stderr).toBe(0);
    expect(diagnostic.stdout).toMatch(/tree-only diagnostic.*not a release approval/i);
  });

  it("checks commit metadata for personal mailboxes", () => {
    const repo = fixtureRepo();
    put(repo, "CHANGELOG.md", "clean\n");
    commit(repo, "personal author", ["someone", "gmail.com"].join("@"));

    const result = runGate(repo, "--ref", "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/commit:[0-9a-f]+:author-email/i);
    expect(result.stderr).toMatch(/personal email domain/i);
  });

  it("checks reachable commit messages, not only file contents", () => {
    const repo = fixtureRepo();
    const localPath = ["C:", "Users", "private-user", "Desktop"].join("\\");
    put(repo, "CHANGELOG.md", "clean\n");
    commit(repo, `copied from ${localPath}`);

    const result = runGate(repo, "--ref", "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/commit:[0-9a-f]+:message.*machine-local absolute path/i);
  });

  it("accepts untracked operator deny terms for private aliases and identity names", () => {
    const repo = fixtureRepo();
    const privateAlias = ["private", "cluster", "alias"].join("-");
    const privateName = ["Private", "Identity"].join(" ");
    put(repo, "ssh-example.txt", `Host ${privateAlias}\n`);
    commit(repo, "private setup", "12345+release-bot@users.noreply.github.com", privateName);

    const result = runGateWithEnv(
      repo,
      { RELEASE_HISTORY_DENY_TERMS: `${privateAlias}\n${privateName}` },
      "--ref",
      "HEAD",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tracked:ssh-example\.txt.*operator deny term/i);
    expect(result.stderr).toMatch(/commit:[0-9a-f]+:author-name.*operator deny term/i);
  });

  it("fails closed when release mode receives only whitespace and comma deny terms", () => {
    const repo = fixtureRepo();
    const unusable = "  , \n,\t ,  ";

    const result = runGateWithEnv(
      repo,
      { RELEASE_HISTORY_DENY_TERMS: unusable },
      "--ref",
      "HEAD",
      "--require-deny-terms",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/at least one non-empty release history deny term is required/i);
    expect(result.stderr).not.toContain(unusable);
  });

  it("accepts release mode when normalization leaves a usable deny term", () => {
    const repo = fixtureRepo();

    const result = runGateWithEnv(
      repo,
      { RELEASE_HISTORY_DENY_TERMS: "  reviewed-private-term  ,  " },
      "--ref",
      "HEAD",
      "--require-deny-terms",
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("applies operator deny terms to institutional author and committer emails", () => {
    const repo = fixtureRepo();
    const institutionalEmail = ["private.identity", "research.example.edu"].join("@");
    put(repo, "CHANGELOG.md", "clean\n");
    commit(repo, "institutional author", institutionalEmail, "Public Contributor");

    const result = runGateWithEnv(
      repo,
      { RELEASE_HISTORY_DENY_TERMS: institutionalEmail },
      "--ref",
      "HEAD",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/commit:[0-9a-f]+:author-email.*operator deny term/i);
    expect(result.stderr).toMatch(/commit:[0-9a-f]+:committer-email.*operator deny term/i);
  });

  it("does not publish project-specific deny terms inside the scanner itself", () => {
    const source = readFileSync(gate, "utf8");
    const forbiddenFragments = [
      ["lclu", "ster"].join(""),
      ["ys86", "faxu"].join(""),
    ];

    for (const fragment of forbiddenFragments) expect(source).not.toContain(fragment);
  });

  it("keeps this tracked fixture source free of complete machine-local path literals", () => {
    const source = readFileSync(import.meta.filename, "utf8");

    expect(source).not.toMatch(/\b[A-Z]:[\\/]/);
  });

  it("scans UTF-16LE and UTF-16BE text with BOM or alternating NUL bytes", () => {
    const repo = fixtureRepo();
    const localPath = ["C:", "Users", "private-user", "Desktop"].join("\\");
    const personalEmail = ["private.user", "gmail.com"].join("@");
    const denyTerm = ["private", "cluster", "alias"].join("-");
    const secret = ["github", "_pat_", "Z".repeat(30)].join("");
    putBytes(
      repo,
      "utf16-path.txt",
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(localPath, "utf16le")]),
    );
    putBytes(repo, "utf16-email.txt", utf16be(personalEmail));
    putBytes(repo, "utf16-deny.txt", Buffer.from(denyTerm, "utf16le"));
    putBytes(repo, "utf16-secret.txt", utf16be(secret, false));
    commit(repo, "UTF-16 fixtures");

    const result = runGateWithEnv(
      repo,
      { RELEASE_HISTORY_DENY_TERMS: denyTerm },
      "--ref",
      "HEAD",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tracked:utf16-path\.txt.*machine-local absolute path/i);
    expect(result.stderr).toMatch(/tracked:utf16-email\.txt.*personal email domain/i);
    expect(result.stderr).toMatch(/tracked:utf16-deny\.txt.*operator deny term/i);
    expect(result.stderr).toMatch(/tracked:utf16-secret\.txt.*GitHub personal access token/i);
  });

  it("uses all refs only when explicitly requested and catches a side-branch leak", () => {
    const repo = fixtureRepo();
    git(repo, "checkout", "-b", "private-work");
    put(repo, "internal-qa/result.txt", "private\n");
    commit(repo, "internal QA");
    git(repo, "checkout", "main");

    const publicRef = runGate(repo, "--ref", "main");
    const allRefs = runGate(repo, "--all-refs");

    expect(publicRef.status, publicRef.stderr).toBe(0);
    expect(allRefs.status).toBe(1);
    expect(allRefs.stderr).toMatch(/history:[0-9a-f]+:internal-qa\/result\.txt/i);
    expect(allRefs.stderr).toMatch(/internal QA or agent file/i);
  });

  it("allows only the explicitly reviewed generic Windows path fixtures", () => {
    const repo = fixtureRepo();
    const placeholderHome = ["C:", "Users", "Kunkun"].join("\\");
    const portableRoot = ["E:", "portable-codex"].join("\\");
    put(
      repo,
      "src-tauri/src/codex_root.rs",
      `assert_eq!(home, r"${placeholderHome}"); assert_eq!(root, r"${portableRoot}");\n`,
    );
    commit(repo, "generic path tests");

    const reviewed = runGate(repo, "--ref", "HEAD");
    put(repo, "README.md", `${placeholderHome}\n`);
    commit(repo, "copy fixture into docs");
    const copied = runGate(repo, "--ref", "HEAD");

    expect(reviewed.status, reviewed.stderr).toBe(0);
    expect(copied.status).toBe(1);
    expect(copied.stderr).toMatch(/tracked:README\.md/i);
  });

  it("blocks local configuration and packaged build artifacts by filename", () => {
    const repo = fixtureRepo();
    put(repo, ".npmrc", "cache=somewhere\n");
    put(repo, "artifacts/Companion-Desk.msi", "not really binary\n");
    commit(repo, "add local and packaged files");

    const result = runGate(repo, "--ref", "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tracked:\.npmrc.*local configuration/i);
    expect(result.stderr).toMatch(/tracked:artifacts\/Companion-Desk\.msi.*build or installer artifact/i);
  });

  it("does not treat binary image noise, property names, or release tests as leaks", () => {
    const repo = fixtureRepo();
    put(repo, "src/state.ts", "const previous = this.local;\n");
    put(repo, "tests/release/gate.test.ts", "expect(true).toBe(true);\n");
    const image = join(repo, "assets", "icon.png");
    mkdirSync(dirname(image), { recursive: true });
    writeFileSync(
      image,
      Buffer.concat([
        Buffer.from([0, 1, 2, 3, 255]),
        Buffer.from(["C:", "random-binary-noise"].join("\\")),
      ]),
    );
    commit(repo, "ordinary source and binary assets");

    const result = runGate(repo, "--ref", "HEAD");

    expect(result.status, result.stderr).toBe(0);
  });
});
