# Known limitations

- Installers are unsigned and may trigger Windows SmartScreen or an unknown
  publisher warning.
- Isolated Windows 10/11 clean-install, upgrade, and uninstall acceptance is not
  complete until evidence is recorded for the exact tagged EXE and MSI.
- Codex quota depends on locally available login state and non-public response
  formats. It may become unavailable when those formats change.
- Local activity reflects only session records available on the current
  computer and is not an authoritative quota or billing total.
- Embedded SSH depends on Windows OpenSSH and a valid user-owned SSH config
  alias. Companion Desk is not an HPC scheduler or job-monitoring service.
- Friend networking is deferred and is not included in `v0.5.0-beta`. The
  public build does not expose friend controls or connect to Firebase.
- The current release target is Windows 10/11 x64 only.
