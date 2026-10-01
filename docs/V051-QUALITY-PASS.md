# Companion Desk v0.5.1 Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a focused `v0.5.1-beta` repair release that fixes confirmed lifecycle and keyboard bugs, makes the public download path truthful, and passes a fresh packaged-Windows gate before promotion.

**Architecture:** Keep the existing React/Tauri boundaries. Native activation remains a safe 160 by 150 fallback, while an activation generation tells React to reapply the saved collapsed layout. Keep-alive feature pages receive explicit activity state so hidden views cannot consume input. Release metadata remains enforced by the existing release contract tests.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust, GitHub Actions.

---

### Task 1: Reapply the saved pet layout after native activation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] Add a failing App test that stores a non-default pet size, emits the injected `activate-collapsed` event while already collapsed, and expects a new `setSize` plus `ensureVisible` call.
- [ ] Run `npm test -- src/App.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` and confirm the new assertion fails because the layout effect does not rerun.
- [ ] Add a collapsed-activation generation state. Increment it only from the native activation listener and include it in the window-layout effect dependencies.
- [ ] Rerun the targeted test and confirm it passes without changing the native fallback sequence.
- [ ] Commit only the lifecycle fix and its regression test.

### Task 2: Stop hidden 2048 from consuming keyboard input

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/games/Game2048Page.tsx`
- Modify: `src/features/games/Game2048Board.tsx`
- Modify: `src/features/games/GamePages.test.tsx`
- Modify: `src/App.test.tsx`

- [ ] Add a failing test that renders 2048 inactive, dispatches `ArrowLeft`, and verifies the event is not cancelled and the board does not change.
- [ ] Run `npm test -- src/features/games/GamePages.test.tsx src/App.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` and confirm the hidden-page assertion fails.
- [ ] Define the `game2048` feature prop as `{ active: boolean }`, pass the current keep-alive activity state through App and Game2048Page, and attach the global listener only when active.
- [ ] Rerun the targeted tests and confirm active keyboard play still works while inactive input is ignored.
- [ ] Commit only the 2048 lifecycle fix and tests.

### Task 3: Make public metadata and documentation match v0.5.1

**Files:**
- Modify: `tests/release/public-metadata.test.ts`
- Modify: `tests/release/release-tag.test.ts`
- Modify: `tests/release/workflows.test.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `docs/RELEASE.md`
- Modify: `docs/GITHUB-RELEASE-CHECKLIST.md`
- Modify: `docs/RELEASE_TEMPLATE.md`
- Modify: `docs/KNOWN-LIMITATIONS.md`
- Modify: `docs/PROJECT-SUMMARY.md`
- Modify: `docs/TEST-MATRIX.md`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`

- [ ] First change release tests to require version `0.5.1`, the `v0.5.1-beta` contract, a prominent real release/download link, published-tense README copy, and Cargo metadata without friend/poke/Firebase claims.
- [ ] Run the release tests and confirm they fail against the current 0.5.0 and pre-release wording.
- [ ] Update all five manifest/lock locations to `0.5.1`, update release contracts and docs to `v0.5.1-beta`, and remove the misleading Cargo friend-poke claim.
- [ ] Rewrite the README first screen with the approved cute-plus-useful positioning, a direct Windows release link, CI badge, three enabled benefits, and local-first/no-telemetry trust copy. Keep SSH and detailed boundaries below the primary introduction.
- [ ] Replace `When published` and candidate-only claims with accurate current instructions. Keep the unsigned SmartScreen warning and exact checksum command.
- [ ] Run all release tests and the asset gate, then commit the metadata/documentation update.

### Task 4: Verify the complete source candidate

**Files:**
- No production changes unless a gate produces a reproducible defect.

- [ ] Run the complete frontend suite with one worker and record the exact file/test totals.
- [ ] Run `npm run build` and confirm TypeScript plus Vite exit zero.
- [ ] Run the E-drive Rust toolchain test command and record exact totals.
- [ ] Run dependency audit, asset authorization, public-tree/history, workflow, and binary-path test gates.
- [ ] Inspect `git diff --check`, the version matrix, and the final diff for unrelated work.

### Task 5: Package and perform native Windows acceptance

**Files:**
- Update release evidence only if an existing authoritative checklist requires it.

- [ ] Build exactly one unsigned NSIS EXE and one unsigned MSI from the frozen candidate with reproducible Rust path remapping.
- [ ] Scan the inner executable for local paths and generate `SHA256SUMS.txt`.
- [ ] Install the EXE to an isolated E-drive directory without replacing the existing working installation.
- [ ] Using the packaged build, verify first launch is collapsed, click expands, right-click works, drag moves only after movement, saved small/large size survives reactivation, close returns to pet, Token refresh works or honestly reports unavailable, Focus completes with a note, both games work, and HPC opens the embedded OpenSSH view.
- [ ] Treat the current Windows machine's NSIS EXE core acceptance as the blocking beta gate and record the OS build, candidate hash, install path, and result.
- [ ] For the MSI, verify build output, SHA-256, Authenticode signature status, and static package metadata and contents; do not install it for this beta.
- [ ] Record the unverified second Windows version and clean-machine matrix as known beta limitations deferred to a stable release.
- [ ] Uninstall or retain the isolated candidate according to the existing acceptance arrangement without deleting user data.

### Task 6: Publish and verify v0.5.1-beta

**Files:**
- No source changes after the candidate tag is created.

- [ ] Create a clean public-root commit and tag `v0.5.1-beta` only after all pre-tag gates pass.
- [ ] Wait for GitHub verify/build/release jobs to pass and inspect the draft assets.
- [ ] Download the draft assets to a fresh E-drive verification directory and independently compare both hashes with `SHA256SUMS.txt`.
- [ ] Publish accurate prerelease notes and make the draft public.
- [ ] Set GitHub topics to `windows`, `tauri`, `rust`, `codex`, and `desktop-pet`; keep homepage empty until a real site exists.
- [ ] Verify the public tag target, release state, download URLs, asset names, checksums, and current CI conclusions.

### Task 7: Prepare promotion assets after acceptance

**Files:**
- Modify README only in a later patch if a genuine recording is accepted.

- [ ] Record a 15 to 25 second demonstration from the accepted packaged build with sanitized quota and SSH information.
- [ ] Review the recording for personal paths, account data, private hosts, tokens, and stale UI.
- [ ] Add it to the README only after visual acceptance; do not generate or simulate product behavior.
- [ ] Copy the EXE and checksum file to the user's chosen domestic distribution service when that service is selected by the user.
