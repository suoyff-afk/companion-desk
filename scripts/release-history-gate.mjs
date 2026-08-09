import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BUFFER = 256 * 1024 * 1024;
const MAX_FINDINGS = 100;

const secretRules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["GitHub personal access token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Firebase API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/],
  [
    "assigned secret",
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
  ],
];

const personalEmail = /\b[A-Z0-9._%+-]+@(?:gmail\.com|qq\.com|163\.com|126\.com|outlook\.com|hotmail\.com|icloud\.com)\b/i;
const privateHostname = /(?:(?:https?|ssh):\/\/|\b(?:host(?:name)?|server)\s*[:=]\s*["']?)(?:[a-z0-9-]+\.)+(?:local|lan|internal)\b/i;
const privateAddress = /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/;

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathFindings(path) {
  const normalized = normalizePath(path);
  const lower = normalized.toLocaleLowerCase("en-US");
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? lower;
  const findings = [];

  const localConfig =
    basename === ".npmrc"
    || basename === "auth.json"
    || basename === "credentials.json"
    || basename === "token.json"
    || (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example"))
    || lower === ".cargo/config.toml"
    || segments.includes(".firebase");
  if (localConfig) findings.push("local configuration");

  const internal =
    segments.some((segment) => [".agents", ".codex", ".superpowers", "internal-qa"].includes(segment))
    || lower.startsWith("docs/superpowers/")
    || lower.startsWith("docs/qa/")
    || basename === "design-qa.md"
    || /(?:^|[-_.])debug\.log$/i.test(basename);
  if (internal) findings.push("internal QA or agent file");

  const artifact =
    segments.some((segment) => ["node_modules", "dist", "target", "artifacts"].includes(segment))
    || segments[0] === "release"
    || /\.(?:exe|msi|dmg|app|zip|tar\.gz|pdb)$/i.test(basename);
  if (artifact) findings.push("build or installer artifact");

  return findings;
}

function reviewedGenericFixture(path, matchedPath) {
  const normalizedFile = normalizePath(path).toLocaleLowerCase("en-US");
  const normalizedMatch = matchedPath
    .replace(/\\{2,}/g, "\\")
    .replace(/[\s)\]}]+$/g, "")
    .toLocaleLowerCase("en-US");
  const allowed = new Map([
    ["src-tauri/src/codex_root.rs", ["c:\\users\\kunkun", "e:\\portable-codex"]],
    ["src-tauri/src/ssh.rs", ["d:\\windows", "e:\\系统目录"]],
    ["tests/release/binary-path-scan.test.ts", ["c:\\users\\runneradmin\\.cargo"]],
    ["src/features/hpc/hostvalidation.test.ts", ["c:\\"]],
  ]);
  if ((allowed.get(normalizedFile) ?? []).includes(normalizedMatch)) return true;
  return normalizedFile === "src-tauri/src/ssh.rs"
    && (normalizedMatch === "d:\\windows" || (normalizedMatch.startsWith("e:\\") && !normalizedMatch.includes("\\users\\")));
}

function isProbablyText(bytes) {
  const sample = Buffer.from(bytes).subarray(0, 8192);
  if (sample.includes(0)) return false;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) controls += 1;
  }
  const decoded = sample.toString("utf8");
  const replacements = decoded.split("\uFFFD").length - 1;
  return controls / Math.max(sample.length, 1) < 0.01
    && replacements / Math.max(decoded.length, 1) < 0.01;
}

function decodeUtf16Be(bytes) {
  const swapped = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped.toString("utf16le");
}

function alternatingNullEncoding(bytes) {
  const sample = Buffer.from(bytes).subarray(0, 8192);
  const pairs = Math.floor(sample.length / 2);
  if (pairs < 4) return null;
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index + 1 < sample.length; index += 2) {
    if (sample[index] === 0) evenNulls += 1;
    if (sample[index + 1] === 0) oddNulls += 1;
  }
  if (oddNulls / pairs >= 0.3 && evenNulls / pairs <= 0.05) return "utf16le";
  if (evenNulls / pairs >= 0.3 && oddNulls / pairs <= 0.05) return "utf16be";
  return null;
}

function decodedTextViews(bytes) {
  const buffer = Buffer.from(bytes);
  let decoded = null;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    decoded = buffer.subarray(2).toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    decoded = decodeUtf16Be(buffer.subarray(2));
  } else {
    const encoding = alternatingNullEncoding(buffer);
    if (encoding === "utf16le") decoded = buffer.toString("utf16le");
    else if (encoding === "utf16be") decoded = decodeUtf16Be(buffer);
    else if (isProbablyText(buffer)) decoded = buffer.toString("utf8").replace(/^\uFEFF/, "");
  }
  if (decoded === null) return [];
  return [...new Set([decoded, decoded.replace(/\\{2,}/g, "\\")])];
}

function includesDenyTerm(value, denyTerms) {
  const lower = value.toLocaleLowerCase("en-US");
  return denyTerms.some((term) => lower.includes(term.toLocaleLowerCase("en-US")));
}

function contentFindings(path, bytes, denyTerms = []) {
  const findings = [];
  for (const text of decodedTextViews(bytes)) {
    for (const [label, pattern] of secretRules) {
      if (pattern.test(text)) findings.push(label);
    }
    if (personalEmail.test(text)) findings.push("personal email domain");
    if (privateHostname.test(text) || privateAddress.test(text)) {
      findings.push("private hostname or network address");
    }
    if (includesDenyTerm(text, denyTerms)) findings.push("operator deny term");

    const windowsPaths = text.match(/\b[A-Z]:[\\/][^\r\n\t"'`<>|,;]*/g) ?? [];
    const unixHomes = text.match(/(?:^|[\s"'=(])\/(?:home|Users)\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?/gm) ?? [];
    for (const rawMatch of [...windowsPaths, ...unixHomes]) {
      const match = rawMatch.trim();
      if (!reviewedGenericFixture(path, match)) findings.push("machine-local absolute path");
    }
  }
  return [...new Set(findings)];
}

function parseTree(output) {
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, type, object] = entry.slice(0, tab).split(" ");
      return { mode, type, object, path: entry.slice(tab + 1) };
    })
    .filter((entry) => entry.type === "blob");
}

export function parseTarEntries(archive) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readText = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const name = readText(0, 100);
    const prefix = readText(345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readText(124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`Invalid tar entry size for ${path}.`);
    const type = String.fromCharCode(header[156] || 48);
    const start = offset + 512;
    const end = start + size;
    if (end > archive.length) throw new Error(`Truncated tar entry: ${path}.`);
    if (type === "0" || type === "\0") entries.push({ path, bytes: archive.subarray(start, end) });
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    ref: "HEAD",
    allRefs: false,
    treeOnly: false,
    requireDenyTerms: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") options.repo = argv[++index];
    else if (argument === "--ref") options.ref = argv[++index];
    else if (argument === "--all-refs") options.allRefs = true;
    else if (argument === "--tree-only") options.treeOnly = true;
    else if (argument === "--require-deny-terms") options.requireDenyTerms = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.repo) throw new Error("--repo requires a path.");
  if (!options.ref) throw new Error("--ref requires a git revision.");
  if (options.allRefs && argv.includes("--ref")) {
    throw new Error("Use either --ref or --all-refs, not both.");
  }
  return { ...options, repo: resolve(options.repo) };
}

function git(repo, args, encoding = null) {
  return execFileSync(
    "git",
    ["-c", `safe.directory=${repo.replaceAll("\\", "/")}`, ...args],
    { cwd: repo, encoding, maxBuffer: MAX_BUFFER },
  );
}

function addFindings(target, origin, labels) {
  for (const label of labels) {
    if (target.length >= MAX_FINDINGS) return;
    target.push(`${origin} — ${label}`);
  }
}

function scanEntries(entries, originPrefix, readBlob, findings, denyTerms) {
  for (const entry of entries) {
    const origin = `${originPrefix}:${entry.path}`;
    addFindings(findings, origin, pathFindings(entry.path));
    addFindings(findings, origin, contentFindings(entry.path, readBlob(entry.object), denyTerms));
  }
}

export function runReleaseHistoryGate(rawOptions) {
  const options = {
    ...rawOptions,
    denyTerms: (rawOptions.denyTerms ?? []).map((term) => term.trim()).filter(Boolean),
    repo: resolve(rawOptions.repo),
  };
  const findings = [];
  const blobCache = new Map();
  const readBlob = (object) => {
    if (!blobCache.has(object)) blobCache.set(object, git(options.repo, ["cat-file", "blob", object]));
    return blobCache.get(object);
  };
  const treeEntries = parseTree(git(options.repo, ["ls-tree", "-r", "-z", options.ref]));
  scanEntries(treeEntries, "tracked", readBlob, findings, options.denyTerms);

  const counts = {
    tracked: treeEntries.length,
    historyBlobs: 0,
    commits: 0,
    archiveEntries: 0,
  };
  if (options.treeOnly) return { findings, counts, diagnostic: true };

  const revisionArgs = options.allRefs ? ["--all"] : [options.ref];
  const commits = git(options.repo, ["rev-list", ...revisionArgs], "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  counts.commits = commits.length;
  const scannedBlobPaths = new Set();
  for (const commit of commits) {
    const entries = parseTree(git(options.repo, ["ls-tree", "-r", "-z", commit]));
    for (const entry of entries) {
      const key = `${entry.object}\0${entry.path}`;
      if (scannedBlobPaths.has(key)) continue;
      scannedBlobPaths.add(key);
      const origin = `history:${commit}:${entry.path}`;
      addFindings(findings, origin, pathFindings(entry.path));
      addFindings(findings, origin, contentFindings(entry.path, readBlob(entry.object), options.denyTerms));
    }
  }
  counts.historyBlobs = scannedBlobPaths.size;

  const metadata = git(
    options.repo,
    ["log", "--format=%H%x09%an%x09%ae%x09%cn%x09%ce", ...revisionArgs],
    "utf8",
  );
  for (const line of metadata.split(/\r?\n/).filter(Boolean)) {
    const [commit, authorName, authorEmail, committerName, committerEmail] = line.split("\t");
    if (personalEmail.test(authorEmail ?? "")) {
      addFindings(findings, `commit:${commit}:author-email`, ["personal email domain"]);
    }
    if (includesDenyTerm(authorEmail ?? "", options.denyTerms)) {
      addFindings(findings, `commit:${commit}:author-email`, ["operator deny term"]);
    }
    if (personalEmail.test(committerEmail ?? "")) {
      addFindings(findings, `commit:${commit}:committer-email`, ["personal email domain"]);
    }
    if (includesDenyTerm(committerEmail ?? "", options.denyTerms)) {
      addFindings(findings, `commit:${commit}:committer-email`, ["operator deny term"]);
    }
    for (const [field, value] of [["author-name", authorName], ["committer-name", committerName]]) {
      if (includesDenyTerm(value ?? "", options.denyTerms)) {
        addFindings(findings, `commit:${commit}:${field}`, ["operator deny term"]);
      }
    }
  }
  for (const commit of commits) {
    const rawCommit = git(options.repo, ["cat-file", "commit", commit]);
    const separator = rawCommit.indexOf(Buffer.from("\n\n"));
    const message = separator >= 0 ? rawCommit.subarray(separator + 2) : Buffer.alloc(0);
    addFindings(
      findings,
      `commit:${commit}:message`,
      contentFindings("COMMIT_MESSAGE", message, options.denyTerms),
    );
  }

  const archiveRefs = options.allRefs
    ? [
        ...new Set([
          "HEAD",
          ...git(options.repo, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"], "utf8")
            .split(/\r?\n/)
            .filter(Boolean),
        ]),
      ]
    : [options.ref];
  for (const ref of archiveRefs) {
    const entries = parseTarEntries(git(options.repo, ["archive", "--format=tar", ref]));
    counts.archiveEntries += entries.length;
    for (const entry of entries) {
      const origin = `archive:${ref}:${entry.path}`;
      addFindings(findings, origin, pathFindings(entry.path));
      addFindings(findings, origin, contentFindings(entry.path, entry.bytes, options.denyTerms));
    }
  }

  return { findings: [...new Set(findings)], counts, diagnostic: false };
}

function main() {
  const denyTerms = (process.env.RELEASE_HISTORY_DENY_TERMS ?? "")
    .split(/\r?\n|,/)
    .map((term) => term.trim())
    .filter(Boolean);
  const options = { ...parseArgs(process.argv.slice(2)), denyTerms };
  if (options.requireDenyTerms && denyTerms.length === 0) {
    throw new Error("At least one non-empty release history deny term is required.");
  }
  const result = runReleaseHistoryGate(options);
  if (result.findings.length) {
    throw new Error(
      `Public history gate found ${result.findings.length} issue(s):\n${result.findings.map((finding) => `- ${finding}`).join("\n")}`,
    );
  }
  if (result.diagnostic) {
    process.stdout.write(
      `TREE-ONLY DIAGNOSTIC — not a release approval. Tracked tree: ${result.counts.tracked} files.\n`,
    );
    return;
  }
  process.stdout.write(
    [
      "Public history release gate passed.",
      `Tracked tree: ${result.counts.tracked} files.`,
      `Reachable blobs: ${result.counts.historyBlobs}.`,
      `Commit metadata: ${result.counts.commits} commits.`,
      `Source archive: ${result.counts.archiveEntries} entries.`,
    ].join("\n") + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release history gate failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
