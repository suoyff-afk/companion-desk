# Known limitations

- Installers are unsigned and may trigger Windows SmartScreen or an unknown
  publisher warning.
- A second Windows version and a clean machine have not been verified. These are
  known limitations, not beta blockers; a stable release requires the full
  Windows 10/11 x64 clean-machine and installer matrix.
- MSI acceptance requires successful build output, SHA-256 verification,
  signature-status checks, and static package inspection; it is not installed
  for this beta. These checks remain unclaimed until the release checklist has
  evidence. Core native acceptance uses the packaged NSIS EXE on the current
  Windows machine.
- Codex quota depends on locally available login state and non-public response
  formats. It may become unavailable when those formats change.
- Local activity reflects only session records available on the current
  computer and is not an authoritative quota or billing total.
- The terminal and HPC task board depend on Windows OpenSSH and a valid
  user-owned SSH config alias. Task queries additionally require Slurm's
  `squeue` and `sacct`, accounting access, and noninteractive SSH authentication.
  Refresh is manual. Scheduler states and registered job counts do not measure
  solver progress or scientific acceptance; solver logs, checkpoints, ETA,
  automatic monitoring, and job submission are not implemented.
- Friend networking is deferred and is not included in `v0.5.1-beta`. The
  public build does not expose friend controls or connect to Firebase.
- The current release target is Windows 10/11 x64 only.
