import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

const read = (path: string) => readFileSync(join(root, path), "utf8");
const trackedFiles = () =>
  execFileSync(
    "git",
    ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "ls-files", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

const trackedTextFiles = () =>
  trackedFiles().flatMap((path) => {
    const fullPath = join(root, path);
    if (!existsSync(fullPath)) return [];
    const bytes = readFileSync(fullPath);
    return bytes.includes(0) ? [] : [{ path, contents: bytes.toString("utf8") }];
  });

describe("public release metadata", () => {
  it("scans every tracked text file for personal data and stale release metadata", () => {
    const quotaName = ["Quota", " Float"].join("");
    const forbidden: Array<{ label: string; pattern: RegExp }> = [
      { label: "stale product name", pattern: new RegExp(quotaName, "i") },
      {
        label: "stale release URL",
        pattern: new RegExp(
          ["change-42-yhmm", "quota-float", "releases"].join("[/\\\\]"),
          "i",
        ),
      },
      {
        label: "personal Windows path",
        pattern: new RegExp(["C:", "Users", "suoyf"].join("[/\\\\]+"), "i"),
      },
      {
        label: "machine-local tool path",
        pattern: new RegExp(["E:", "CodexTools"].join("[/\\\\]+"), "i"),
      },
      { label: "private cluster hostname", pattern: new RegExp(["lclu", "ster"].join(""), "i") },
      { label: "private cluster user", pattern: new RegExp(["ys86", "faxu"].join(""), "i") },
      { label: "personal legacy name", pattern: new RegExp(["xiao", "yan"].join(""), "i") },
      {
        label: "legacy product name",
        pattern: new RegExp(["Kunkun", " Desk"].join(""), "i"),
      },
    ];
    const upstreamAttributionFiles = new Set([
      "THIRD_PARTY_NOTICES.md",
      "licenses/assets.json",
      "licenses/quota-float-MIT.txt",
    ]);

    for (const { path, contents } of trackedTextFiles()) {
      for (const { label, pattern } of forbidden) {
        if (label === "stale product name" && upstreamAttributionFiles.has(path)) continue;
        expect(contents, `${path} contains ${label}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the upstream attribution and complete original MIT license", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");
    const upstreamLicense = read("licenses/quota-float-MIT.txt");
    const quotaName = ["Quota", " Float"].join("");

    expect(notices).toContain(quotaName);
    expect(notices).toContain(["https://github.com/change-42-yhmm", "quota-float"].join("/"));
    expect(notices).not.toContain(["change-42-yhmm", "quota-float", "releases"].join("/"));
    expect(notices).toContain("licenses/quota-float-MIT.txt");
    expect(upstreamLicense).toContain(`Copyright (c) 2026 ${quotaName} contributors`);
    expect(upstreamLicense).toContain(
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
    );
    expect(upstreamLicense).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
    );
  });

  it("uses the 0.5.0 version consistently", () => {
    expect(JSON.parse(read("package.json")).version).toBe("0.5.0");
    expect(JSON.parse(read("package-lock.json")).version).toBe("0.5.0");
    expect(JSON.parse(read("package-lock.json")).packages[""].version).toBe("0.5.0");
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("0.5.0");
    expect(read("src-tauri/Cargo.toml")).toMatch(/^version = "0\.5\.0"$/m);
    expect(read("src-tauri/Cargo.lock")).toMatch(
      /\[\[package\]\]\r?\nname = "kunkun-desk"\r?\nversion = "0\.5\.0"/,
    );
  });

  it("presents an honest local-first 0.5.0 beta with current screenshots", () => {
    const readme = read("README.md");
    const privacy = read("PRIVACY.md");
    const limitations = read("docs/KNOWN-LIMITATIONS.md");
    const summary = read("docs/PROJECT-SUMMARY.md");
    const releaseTemplate = read("docs/RELEASE_TEMPLATE.md");
    const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
    const packageManifest = JSON.parse(read("package.json"));

    expect(readme).toContain("v0.5.0-beta");
    expect(readme).toContain("Windows 10/11 x64");
    expect(readme).toMatch(/not affiliated with\s+or endorsed by OpenAI/);
    expect(readme).toContain("EXE");
    expect(readme).toContain("MSI");
    expect(readme).toContain("SHA256SUMS.txt");
    expect(readme).toContain("SmartScreen");
    expect(readme).toContain("Node.js 22");
    expect(readme).toContain("OpenSSH");
    expect(readme).toContain("docs/images/companion-home.png");
    expect(readme).toContain("docs/images/token-view.png");
    expect(readme).not.toContain("docs/qa/");
    expect(readme).toContain("Friend networking is not included in this beta");
    expect(readme).toContain("does not require a Firebase project or configuration");
    expect(readme).not.toMatch(/builds? without Firebase configuration/i);
    expect(privacy).toContain("does not connect to Firebase");
    expect(summary).toContain("Kunkun is the pet's name");
    expect(summary).toContain("Friend networking is deferred");
    expect(releaseTemplate).toContain("Friend networking is not included");
    expect(releaseTemplate).not.toMatch(/Firebase anonymous friend codes.*Included/s);
    expect(bugTemplate).toContain("v0.5.0-beta");
    expect(limitations).not.toContain("PUBLIC RELEASE BLOCKED");
    expect(limitations).toContain("Friend networking is deferred");
    expect(packageManifest.description).toMatch(/local-first Windows desktop companion/i);
    expect(tauri.productName).toBe("Companion Desk");
    expect(tauri.bundle.longDescription).not.toMatch(/friend|Firebase/i);
    expect(tauri.bundle.longDescription).toMatch(/Codex.*focus.*games.*OpenSSH/i);
  });

  it("keeps machine-local tool configuration out of source archives", () => {
    const ignore = read(".gitignore");
    const tracked = trackedFiles();

    expect(tracked).not.toContain("design-qa.md");
    expect(tracked.some((path) => path.startsWith("docs/superpowers/"))).toBe(false);
    expect(ignore).toMatch(/^\/\.npmrc$/m);
    expect(ignore).toMatch(/^\/\.cargo\/config\.toml$/m);
    expect(ignore).toMatch(/^\/\.superpowers\/$/m);
    expect(ignore).toMatch(/^\/design-qa\.md$/m);
    expect(ignore).toMatch(/^\/docs\/superpowers\/$/m);
    expect(ignore).toMatch(/^\/firebase-debug\.log\*$/m);
    expect(ignore).toMatch(/^\/internal-qa\//m);
  });
});
