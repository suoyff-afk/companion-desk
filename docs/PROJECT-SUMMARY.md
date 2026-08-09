# Companion Desk project summary

Companion Desk is a local-first Tauri 2 desktop companion for Windows 10/11
x64. Companion Desk is the product name; **Kunkun is the pet's name**.

## v0.5.0-beta scope

- Compact floating pet and expanded glass panel.
- Local Codex quota reader with explicit unavailable and stale states.
- Separate, non-authoritative local Codex activity summary.
- Focus timer with a completion note.
- Local Gomoku and 2048.
- Embedded Windows OpenSSH terminal using a user-selected config alias.

Friend networking is deferred. The public beta disables friend/Firebase code at
the entry point, exposes no friend controls, and requires no Firebase project or
configuration.

## Architecture

- React 19, TypeScript, Vite, and Vitest for the UI.
- Tauri 2 and Rust for native window behavior, Codex data access, local
  activity, and OpenSSH.
- Local app storage for preferences, focus notes, and game state.

The beta contains no chat, telemetry, advertising, or automatic crash
reporting. It is an independent community project and is not affiliated with or
endorsed by OpenAI.

## Release target

The candidate is `v0.5.0-beta`, Windows-only, with an unsigned EXE installer as
the primary artifact, MSI as a backup, and `SHA256SUMS.txt` for both. Publishing
remains gated by the evidence in `docs/GITHUB-RELEASE-CHECKLIST.md`.
