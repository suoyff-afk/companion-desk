# Companion Desk v0.5.0-beta

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
- Windows 10 clean install: `<result or NOT RUN>`
- Windows 11 clean install: `<result or NOT RUN>`
- Upgrade and uninstall: `<result or NOT RUN>`

## Known limitations

Copy the current shipped-scope limitations from
`docs/KNOWN-LIMITATIONS.md`. Do not publish until all blocking items in
`docs/GITHUB-RELEASE-CHECKLIST.md` have evidence.

Companion Desk is an independent community project and is not affiliated with
or endorsed by OpenAI.
