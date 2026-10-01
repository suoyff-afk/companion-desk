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
        pattern: /[A-Z]:[/\\]+Users[/\\]+(?!(?:kunkun|runneradmin)(?:[/\\]|[\s"']|$))[A-Z0-9._-]+/i,
      },
      {
        label: "machine-local tool path",
        pattern: /[A-Z]:[/\\]+CodexTools(?:[/\\]|[\s"']|$)/i,
      },
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

  it("uses the 0.5.1 version consistently", () => {
    expect(JSON.parse(read("package.json")).version).toBe("0.5.1");
    expect(JSON.parse(read("package-lock.json")).version).toBe("0.5.1");
    expect(JSON.parse(read("package-lock.json")).packages[""].version).toBe("0.5.1");
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("0.5.1");
    expect(read("src-tauri/Cargo.toml")).toMatch(/^version = "0\.5\.1"$/m);
    expect(read("src-tauri/Cargo.lock")).toMatch(
      /\[\[package\]\]\r?\nname = "kunkun-desk"\r?\nversion = "0\.5\.1"/,
    );
  });

  it("uses a stable release entry point without claiming an unpublished release", () => {
    const readme = read("README.md");
    const privacy = read("PRIVACY.md");
    const security = read("SECURITY.md");
    const limitations = read("docs/KNOWN-LIMITATIONS.md");
    const summary = read("docs/PROJECT-SUMMARY.md");
    const releaseTemplate = read("docs/RELEASE_TEMPLATE.md");
    const bugTemplate = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
    const packageManifest = JSON.parse(read("package.json"));

    expect(readme).toMatch(
      /^## \[Download for Windows\]\(https:\/\/github\.com\/suoyff-afk\/companion-desk\/releases\)$/m,
    );
    expect(readme).not.toMatch(/github\.com\/suoyff-afk\/companion-desk\/releases\/tag\//);
    expect(readme).not.toMatch(/next candidate/i);
    expect(readme).not.toContain("v0.5.0-beta");
    expect(readme).not.toMatch(/candidate/i);
    expect(readme).toMatch(/source (?:manifests|version).*0\.5\.1/i);
    expect(readme).toMatch(/check [\s\S]*Releases page[\s\S]*current published beta/i);
    expect(readme).toMatch(/each published beta[\s\S]*Releases page[\s\S]*actual[\s\S]*files/i);
    expect(readme).toMatch(/exact filenames shown/i);
    expect(readme).not.toContain("The `v0.5.1-beta` GitHub Release includes");
    expect(readme).toContain("Companion-Desk_0.5.1-beta_windows-x64-setup.exe");
    expect(readme).not.toMatch(/when published|intended to contain/i);
    expect(readme).toContain("Free, local-first, and no telemetry.");
    expect(readme).toContain("See your Codex quota");
    expect(readme).toContain("Stay focused with local sessions");
    expect(readme).toContain("Take a quick break with local games");
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
    expect(privacy).toContain("v0.5.1-beta");
    expect(security).toContain("v0.5.1-beta");
    expect(summary).toContain("Kunkun is the pet's name");
    expect(summary).toContain("Friend networking is deferred");
    expect(releaseTemplate).toContain("Friend networking is not included");
    expect(releaseTemplate).not.toMatch(/Firebase anonymous friend codes.*Included/s);
    expect(bugTemplate).toContain("v0.5.1-beta");
    expect(limitations).not.toContain("PUBLIC RELEASE BLOCKED");
    expect(limitations).toContain("Friend networking is deferred");
    expect(packageManifest.description).toMatch(/local-first Windows desktop companion/i);
    expect(read("src-tauri/Cargo.toml")).toMatch(/description = ".*local-first.*Codex/i);
    expect(read("src-tauri/Cargo.toml")).not.toMatch(/friend|poke|Firebase/i);
    expect(tauri.productName).toBe("Companion Desk");
    expect(tauri.bundle.longDescription).not.toMatch(/friend|Firebase/i);
    expect(tauri.bundle.longDescription).toMatch(/Codex.*focus.*games.*OpenSSH/i);
  });

  it("documents an attainable beta acceptance gate and defers the stable matrix", () => {
    const release = read("docs/RELEASE.md");
    const checklist = read("docs/GITHUB-RELEASE-CHECKLIST.md");
    const matrix = read("docs/TEST-MATRIX.md");
    const limitations = read("docs/KNOWN-LIMITATIONS.md");
    const plan = read("docs/V051-QUALITY-PASS.md");
    const security = read("SECURITY.md");
    const releaseTemplate = read("docs/RELEASE_TEMPLATE.md");

    expect(release).toMatch(/NSIS EXE[\s\S]*current Windows machine[\s\S]*blocking beta gate/i);
    expect(release).toMatch(/MSI[\s\S]*build[\s\S]*SHA-256[\s\S]*signature[\s\S]*static[\s\S]*not installed/i);
    expect(release).toMatch(/second Windows version[\s\S]*clean machine[\s\S]*not beta blockers[\s\S]*stable release/i);
    expect(release).not.toMatch(/On both Windows 10 x64 and Windows 11 x64[\s\S]*test the EXE and MSI/i);

    expect(checklist).toMatch(/current Windows machine[\s\S]*EXE[\s\S]*core[\s\S]*acceptance/i);
    expect(checklist).toMatch(/MSI[\s\S]*SHA-256[\s\S]*signature[\s\S]*static[\s\S]*not install/i);
    expect(checklist).toMatch(/second Windows version[\s\S]*clean-machine[\s\S]*not beta blockers[\s\S]*stable release/i);
    expect(checklist).not.toMatch(/verified MSI[\s\S]*clean-installs/i);

    expect(matrix).toMatch(/Current Windows machine[\s\S]*NSIS EXE[\s\S]*blocking beta/i);
    expect(matrix).toMatch(/MSI[\s\S]*build[\s\S]*hash[\s\S]*signature[\s\S]*static[\s\S]*no install/i);
    expect(matrix).toMatch(/Stable release[\s\S]*Windows 10\/11[\s\S]*clean-machine/i);

    expect(limitations).toMatch(/second Windows version[\s\S]*clean machine[\s\S]*not been verified/i);
    expect(limitations).toMatch(/not beta blockers[\s\S]*stable release/i);

    expect(plan).toMatch(/current Windows machine[\s\S]*NSIS EXE[\s\S]*blocking/i);
    expect(plan).toMatch(/MSI[\s\S]*signature[\s\S]*static[\s\S]*not install/i);

    for (const [path, contents] of [
      ["SECURITY.md", security],
      ["docs/RELEASE_TEMPLATE.md", releaseTemplate],
    ] as const) {
      expect(contents, `${path} must require current-machine EXE acceptance`).toMatch(
        /current Windows machine[\s\S]*NSIS EXE[\s\S]*core[\s\S]*acceptance/i,
      );
      expect(contents, `${path} must limit MSI validation to static checks`).toMatch(
        /MSI[\s\S]*build[\s\S]*SHA-256[\s\S]*signature[\s\S]*static[\s\S]*not install/i,
      );
      expect(contents, `${path} must defer unavailable matrix evidence`).toMatch(
        /second Windows version[\s\S]*clean machine[\s\S]*upgrade[\s\S]*known[\s\S]*limitations[\s\S]*stable release/i,
      );
    }
    expect(security).not.toMatch(/perform isolated Windows install, launch, upgrade, and uninstall tests/i);
    expect(releaseTemplate).not.toMatch(/Windows (?:10|11) clean install/);
  });

  it("keeps release contracts and issue templates on the v0.5.1-beta candidate", () => {
    for (const path of [
      "docs/RELEASE.md",
      "docs/GITHUB-RELEASE-CHECKLIST.md",
      "docs/RELEASE_TEMPLATE.md",
      "docs/KNOWN-LIMITATIONS.md",
      "docs/PROJECT-SUMMARY.md",
      "docs/TEST-MATRIX.md",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/ISSUE_TEMPLATE/feature_request.yml",
    ]) {
      expect(read(path), `${path} must name the current beta`).toContain("v0.5.1-beta");
    }
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
