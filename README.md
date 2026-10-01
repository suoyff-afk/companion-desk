# Companion Desk

[![Windows CI](https://github.com/suoyff-afk/companion-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/suoyff-afk/companion-desk/actions/workflows/ci.yml)

Your cute desktop companion for Codex: see your quota, stay focused, and take a
quick break without leaving your workflow. Companion Desk is the product;
**Kunkun is the pet** that lives on the desktop.

Companion Desk is an independent community project and is not affiliated with
or endorsed by OpenAI.

## [Download for Windows](https://github.com/suoyff-afk/companion-desk/releases)

The source manifests are version `0.5.1` and target Windows 10/11 x64. Check the
Releases page for the current published beta. Free, local-first, and no telemetry.

- **See your Codex quota** with explicit unavailable and stale states.
- **Open HPC from home** to query Slurm task states and registered projects,
  alongside your interactive SSH terminal.
- **Stay focused with local sessions** and completion notes stored on your PC.
- **Take a quick break with local games** between work sessions.

![Companion Desk compact home](docs/images/companion-home.png)

## Download and verify

Each published beta on the Releases page lists its actual Windows files. Use
the exact filenames shown there. Depending on the release, files may include:

- unsigned NSIS **EXE** installer — primary choice;
- unsigned **MSI** installer — backup for environments that prefer MSI;
- `SHA256SUMS.txt` — SHA-256 checksums for both installers.

The installers are not code-signed. Windows SmartScreen may show “Unknown
publisher”. Download only from this repository's GitHub Release, then compare
the installer hash with `SHA256SUMS.txt` before running it. This example uses
the version `0.5.1` filename pattern; run it only when that exact file is listed
in the selected release:

```powershell
Get-FileHash .\Companion-Desk_0.5.1-beta_windows-x64-setup.exe -Algorithm SHA256
```

Do not bypass a warning when the filename or hash does not match the release.

## Data and feature boundaries

### Codex quota

Quota is read using Codex login state already available to the same Windows
account. Support depends on non-public response formats that can change. If a
trustworthy value is unavailable, Companion Desk shows unavailable or stale
data; it never substitutes an estimate derived from local history.

The local activity view reads Codex session records present on this computer.
It is useful for trends but is not an authoritative billing or quota record.

![Companion Desk Token view](docs/images/token-view.png)

### HPC / SSH

The home screen opens the HPC workbench directly. It combines an embedded
Windows OpenSSH terminal with a separate, manual, read-only Slurm task board.
Configure an SSH host alias in your own OpenSSH config and enter that alias in
Companion Desk. Refresh queries the current user's queue and the previous seven
days of accounting history; a saved project queries its registered job IDs.
Queue and history errors, stale data, and last-update times are shown separately.
The board does not submit, cancel, or rerun jobs, and refresh never types into
the interactive terminal.

The task board reports scheduler states and exit codes. It does not inspect
solver logs, checkpoints, estimated completion time, or scientific acceptance;
a successful scheduler state is not evidence that a simulation passed its
scientific checks. Companion Desk does not ship a cluster hostname, username,
or credential. See [docs/PROJECT-SUMMARY.md](docs/PROJECT-SUMMARY.md) for the
current source map and handoff status.

### Local storage and networking

Focus notes, game state, window layout, and preferences stay in the local app
store. The beta contains no analytics, advertising SDK, or automatic crash
upload. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the full
boundary.

**Friend networking is not included in this beta.** Firebase is disabled in the
public interface. Using the shipped beta does not require a Firebase project or configuration.

## Development

Requirements:

- Windows 10/11 x64;
- Node.js 22;
- Rust stable;
- Tauri 2 Windows prerequisites.

```powershell
npm ci
npm run release:assets:gate
npm test -- --maxWorkers=2
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Browser preview cannot validate native quota reading, embedded OpenSSH, or
native window behavior. See [the release process](docs/RELEASE.md) and
[the evidence checklist](docs/GITHUB-RELEASE-CHECKLIST.md).

## License and artwork

Source code is provided under the MIT License. Third-party attribution is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The user confirmed on
2026-08-09 that the Kunkun character artwork is their original work and
authorized its public distribution with Companion Desk. The audited asset
inventory is [`licenses/assets.json`](licenses/assets.json).
