# Companion Desk v0.5.1-beta

Local-first Windows 10/11 x64 public-beta candidate.

## Downloads

- EXE installer (primary, unsigned): `<asset name>`
- MSI installer (backup, unsigned): `<asset name>`
- SHA-256 checksums: `SHA256SUMS.txt`

Windows SmartScreen may show an unknown publisher warning because these
installers are unsigned. Verify the downloaded installer against
`SHA256SUMS.txt` before running it.

## Included

- Floating Kunkun pet and compact Companion Desk panel
- Local Codex quota and separate local-activity views
- Focus timer with completion note
- Local Gomoku and 2048
- Embedded Windows OpenSSH

Friend networking is not included. The public beta exposes no friend controls
and does not connect to Firebase.

## Verification evidence

- Commit: `<sha>`
- Frontend tests: `<result or NOT RUN>`
- Rust tests: `<result or NOT RUN>`
- Asset redistribution gate: `<result or NOT RUN>`
- EXE/MSI SHA-256 verification: `<result or NOT RUN>`
- Current Windows machine NSIS EXE core acceptance: `<result or NOT RUN>`
- MSI build, SHA-256, Authenticode signature status, and static package
  inspection: `<result or NOT RUN>`; do not install the MSI for this beta.

## Known limitations

Copy the current shipped-scope limitations from
`docs/KNOWN-LIMITATIONS.md`. Do not publish until all blocking items in
`docs/GITHUB-RELEASE-CHECKLIST.md` have evidence.

The second Windows version, clean machine, and upgrade checks are known
limitations, not beta blockers. A stable release requires the full Windows
10/11 x64 clean-machine and installer matrix.

Companion Desk is an independent community project and is not affiliated with
or endorsed by OpenAI.
