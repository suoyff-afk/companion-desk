# Companion Desk — current project handoff

**Status reviewed: 2026-10-01.** Companion Desk is a local-first Tauri 2
desktop companion for Windows 10/11 x64. Companion Desk is the product name;
Kunkun is the pet's name. The source manifests report version `0.5.1`; the
release-process documents reference `v0.5.1-beta`; this source handoff creates
no new release or tag.
Use the stable [GitHub Releases page](https://github.com/suoyff-afk/companion-desk/releases)
to check the current published beta and its actual files. This handoff records
the implemented source and current scope; local development history does not
by itself establish what is published on `main`.

## Current product

The home screen puts **HPC 工作台** first and **专注** second. Games and Token
are under **更多**. The HPC view combines an embedded Windows OpenSSH terminal
and a separate manual, read-only Slurm task board. Configure a host alias in
the user's OpenSSH config; the app supplies no host or credentials.

The task board queries the current user's queue and the previous seven days of
accounting history, or registered job IDs for a selected project. It retains
per-source timestamps and stale/error states. Projects store host alias and
registered IDs in local app storage. Array allocations are expanded where
Slurm supplies task rows; step records are excluded. A task counts as
successful only when its scheduler state is `COMPLETED` and its exit code is
`0:0`. Partial query failures and compressed array results are marked as
incomplete.

This is scheduler visibility only. The app does not inspect solver output,
checkpoints, ETA, or scientific acceptance. It does not submit, cancel, rerun,
or automatically refresh jobs. A completed scheduler job is not a scientific
result gate.

Other current features include Codex quota and local activity views, local
focus sessions, and local games. Quota availability depends on non-public
response formats that may change. Friend networking is deferred; it is disabled
in the public entry point. Companion Desk is an independent community project
and is not affiliated with or endorsed by OpenAI.

## Source map

- `src/features/home/HomePage.tsx` — home actions and primary navigation.
- `src/features/hpc/HpcPage.tsx` — HPC page composition: task board and
  terminal.
- `src/features/hpc/HpcTaskBoard.tsx` — refresh lifecycle, source freshness,
  project selection and task list UI.
- `src/features/hpc/hpcTaskModel.ts` — job merging, Slurm state classification,
  summaries, array handling, and project ID validation.
- `src/features/hpc/hpcQueryBridge.ts` — Tauri command bridge and snapshot
  validation.
- `src/features/hpc/TerminalPanel.tsx` and `terminalBridge.ts` — interactive
  OpenSSH terminal UI and bridge.
- `src-tauri/src/hpc_query.rs` — bounded, fixed read-only `squeue`/`sacct`
  query, parsing, time/output limits, and sanitized errors.
- `src-tauri/src/ssh.rs` — native OpenSSH terminal process handling and host
  alias validation.
- `src/lib/persistence.ts` — local persistence adapter, including HPC project
  registrations.

## Validation evidence and limits

Fresh local verification on **2026-10-01**:

- `npm ci` succeeded from the updated lock file.
- `npm test -- --maxWorkers=2`: 50 files / 475 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: 56 tests passed.
- `npm run tauri -- build`: TypeScript/Vite and the Windows release build
  passed for integration `cecdbb6`; NSIS EXE and MSI bundles were generated.
  The subsequent correction changes only a test fixture. This is build evidence,
  not installation, signature, checksum, or complete release acceptance.
- Asset redistribution validation passed. The intended source tree contained
  223 files and passed the sensitive-content diagnostic. Run the complete
  reachable-history gate on the actual public commit before publishing.
- Dependency audit passed the high-severity gate with zero high/critical
  findings. Two moderate findings remain in Vitest / its mocker tooling
  ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)).

The dependency repair uses published Nano ID 3.3.18, a Firestore-scoped
`grpc-js` 1.13.6 override, and compatible Browserslist/baseline lock updates.
The gRPC import/API smoke and frontend tests do not establish a real Firebase
or Firestore protocol acceptance result; the friend entry remains disabled.
The Slurm `SPECIAL_EXIT` / `SE` regression now keeps requeued jobs nonterminal.

The [first integration CI run](https://github.com/suoyff-afk/companion-desk/actions/runs/36843771153)
passed the frontend job but failed one of 56 Windows Rust tests: the stdin-EOF
success fixture exceeded its two-second process budget. Its test-only budget
is now ten seconds to allow cold Windows PowerShell startup. A held-stdin
negative control still timed out and failed; that temporary mutation was
removed, and the corrected local Rust suite passed 56/56. Production query
deadlines and cleanup logic are unchanged.

The [correction CI run](https://github.com/suoyff-afk/companion-desk/actions/runs/36861408899)
for code commit `31c87f3` passed both jobs on **2026-10-01**: 475 frontend tests,
20 Firebase rules tests, 56 Windows Rust tests, and the normal Tauri release
build. It generated and uploaded unsigned NSIS EXE and MSI CI artifacts. This
is automated test/build evidence; no new GitHub Release, installation, signing,
or real-cluster acceptance is claimed. Later documentation-only commits do
not change the code covered by this run; inspect their own CI status separately.

A subsequent [documentation-only CI run](https://github.com/suoyff-afk/companion-desk/actions/runs/36863052373)
for `0f62eec` passed the frontend job but failed two Windows process fixtures
(54/56): the descendant readiness wait expired at five seconds, and the
stdin-EOF result wait expired at ten seconds. Increasing the latter budget
alone did not establish stable hosted-runner behavior; production query code
was identical to the passing run.

The Windows regression fixtures now use native `sort.exe` for stdin EOF and
an explicitly invoked native helper for timeout, overflow, and inherited
descendant pipes. A ready handshake separates fixture startup from the tested
deadline; abnormal fixture cleanup reaps the explicit test processes. Overflow
must report the output limit. Fresh local verification passed 56 tests, with
one ignored helper entry that the active regression tests invoke explicitly.
Held-stdin and disabled-cancellation negative controls failed as expected,
then were removed. Production query code is unchanged. Check the
[current main CI runs](https://github.com/suoyff-afk/companion-desk/actions/workflows/ci.yml?query=branch%3Amain)
for hosted-runner validation of this fixture change.

Historical **2026-09-30** native acceptance exercised home → HPC and refreshed
a real Slurm queue/history through Tauri, observing 48 scheduler-successful
array tasks. It preceded the October fixes and did not establish solver or
scientific-result acceptance. No new native interaction or real-cluster
acceptance is claimed for the October source. A browser preview cannot prove
Windows window behavior or OpenSSH authentication. Check GitHub Actions for
CI evidence belonging to the actual `main` commit; local results are separate.

## Cloud and GitHub handoff — 2026-10-01

The official Dots creation page reported that the account plan did not yet
include Dot access, so no Dot task was created. The user has since authorized
organizing the implemented source and publishing the existing public GitHub
repository for a cloud agent/Dots takeover. This request is a development
handoff; the Windows desktop application itself is not being converted into a
cloud application.

This source synchronization integrates the HPC task board, primary home
navigation, dependency repairs, and this handoff on top of the existing public
`main` history. Local development history is preserved separately. Public
`main` is the authoritative source for cloud development; the manifests remain
`0.5.1`. Use the current GitHub commit and Actions run as synchronization and
CI evidence. Local configuration, credentials, and build artifacts are
excluded from the source tree.

## Minimal next step

Have the cloud agent select this repository's `main`, read `AGENTS.md` and
this handoff, and inspect the current CI results. Use Linux for frontend work
and the existing Windows CI for desktop builds. Native interaction and real
SSH acceptance remain on the user's Windows machine. Confirm the next actual
HPC workflow with the user before adding features; keep changes isolated from
the installed production application until authorized.
