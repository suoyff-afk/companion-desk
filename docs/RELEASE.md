# Companion Desk 0.5.1 public-beta release process

This is the single release route. Use
`docs/GITHUB-RELEASE-CHECKLIST.md` to record evidence; an unchecked gate is not
a release claim.

## Contract

The selected candidate tag identifies one immutable candidate. Use
`v0.5.1-beta` for the first candidate; each retry uses the next unused
`v0.5.1-beta.N` tag. The beta is local-first for Windows 10 and Windows 11 x64
and includes the floating companion, trustworthy Codex quota, local activity,
focus tools, Gomoku, 2048, and embedded Windows OpenSSH.

Friend networking is not included. Its source may remain, but the public build,
interface, README, release notes, and other user-facing material must neither
enable nor promise it. The beta build must not require Firebase repository
variables or a production Firebase project. Production Firebase deployment and
two-user verification belong to a later network-enabled release and do not
block this beta.

## Blocking gates

1. **Window lifecycle and migration:** fresh and upgraded profiles keep one
   visible pet through expand, collapse, close-to-pet, drag, size, and display
   changes; Exit ends the Companion Desk process and all its windows, and
   relaunch restores one pet; legacy saved layouts cannot strand or duplicate it.
2. **Visible experience:** every included view and honest empty, stale, and
   error state passes native visual review; no friend/Firebase UI is exposed.
3. **Local reliability:** quota never falls back to inferred history; local
   activity, focus, games, preferences, offline use, and OpenSSH error paths
   behave as documented.
4. **Brand, authorization, and privacy:** names, licenses, asset inventory,
   README, privacy, security, limitations, template, and notes match the shipped
   scope. The user created the character artwork and explicitly authorized it
   for public Companion Desk distribution on 2026-08-09; public records must
   consistently reflect that fact and the shipped asset paths.
5. **Clean public history:** every intended public ref and reachable object is
   free of secrets, personal paths, private identities, local configuration,
   installers, build output, and internal QA material; repeat from a clean
   clone.
6. **Full tests and scans:** asset, dependency, frontend, build, Rust, metadata,
   sensitive-content, workflow, and history gates plus the inner-binary
   scanner's tests and workflow configuration pass on the frozen commit.
7. **Exact artifacts:** the tagged commit yields one unsigned EXE, one unsigned
   MSI, matching SHA-256 checksums, clean source archives, and an inner
   executable that passes the path scan.
8. **Current-machine Windows acceptance:** the packaged NSIS EXE passes every
   core flow on the current Windows machine; this is a blocking beta gate. The
   MSI gate covers successful build output, SHA-256 verification, signature
   status, and static package inspection; the MSI is not installed for this
   beta.
9. **GitHub draft prerelease:** the inspected assets and accurate notes remain
   in a draft prerelease until every gate has evidence.

Gates 1-6 pass before tagging. Gates 7-9 use the exact tagged downloads and
pass before publishing.

## Phase 1: freeze and verify

Freeze one reviewed candidate commit. Versions in `package.json`,
`package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json` must be `0.5.1`. Keep the identifier
`com.kunkun.desk` so an existing installation upgrades instead of installing a
second app.

Run from a clean checkout:

```powershell
$CandidateTag = "v0.5.1-beta" # First candidate; use the next unused v0.5.1-beta.N on retry.
npm ci
npm run release:assets:gate
npm run release:history:gate
npm audit --audit-level=high
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/validate-release-tag.mjs $CandidateTag
```

## Phase 2: tag and create the candidate

After Phase 1 passes, tag only the frozen commit as `$CandidateTag`. The Windows
release workflow must build the local-first variant, scan its inner executable,
and create a GitHub Release for `$CandidateTag` as draft and prerelease with:

- one unsigned NSIS EXE as the primary installer;
- one unsigned MSI as the backup installer; and
- `SHA256SUMS.txt` covering both installers.

Download the EXE, MSI, checksum file, and both generated source archives.
Verify hashes independently and inspect every download for unexpected,
sensitive, ignored, or machine-specific content.

## Phase 3: current-machine Windows acceptance

Install the downloaded NSIS EXE to an isolated E-drive directory on the current
Windows machine. Record the OS build, candidate hash, install path, result, and
post-uninstall or retained-data behavior. Exercise first and normal launch,
pet/panel lifecycle, quota states, local activity, focus, both games, OpenSSH,
offline use, and absence of friend UI or Firebase traffic. Passing these core
flows with the exact EXE is the blocking beta gate.

For the MSI, verify the build output, SHA-256 hash, Authenticode signature
status, and static package metadata and contents. The MSI is not installed for
this beta. A second Windows version and a clean machine have not been verified;
they are known limitations, not beta blockers. A stable release requires the
full Windows 10/11 x64 clean-machine and installer matrix.

## Phase 4: publish

Confirm that all evidence belongs to the exact tag and downloaded artifacts.
Release notes must state included and deferred scope, known limitations, and
that the installers are unsigned. Windows SmartScreen may show an unknown
publisher warning; do not imply signing or verified-publisher status.

Only verified repository and support links may be published. Omit an unknown
link rather than presenting a placeholder as a real URL. Do not publish while
any blocking checklist item is unchecked. After evidence uses a tag, never move
that tag; a candidate change requires a new incremented `v0.5.1-beta.N` tag and
draft, followed by a complete rebuild and retest.
