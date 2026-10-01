# Privacy

Companion Desk `v0.5.1-beta` is local-first. Friend networking is not included,
and the public beta does not connect to Firebase.

## What the app reads locally

- Codex login state needed to request quota values available to the desktop
  client.
- Local Codex session and archived-session records used by the local activity
  view.
- The Windows OpenSSH configuration needed to connect to the host alias chosen
  by the user.
- App preferences and saved local feature state.

Codex quota and local activity are separate. Local session totals are not
presented as authoritative quota or billing totals.

## What the app stores locally

- Window, display, focus, game, and other app preferences.
- The selected SSH host alias where the app supports restoring it.
- HPC project names, their host aliases, and the job IDs registered by the user.

Task-query snapshots and source timestamps are held in memory for the current
view; they are not saved as a remote monitoring history.

Companion Desk does not intentionally persist Codex access tokens, SSH
passwords, SSH commands, or terminal output in its own data store.

## Network traffic

### Codex quota

The existing Codex access token and required account identifier are sent only
to the Codex/ChatGPT quota endpoints used by the native quota reader.

### OpenSSH

SSH traffic is handled by the local Windows OpenSSH client and goes directly to
the host selected by the user. Companion Desk does not proxy SSH traffic.
Manually refreshing the task board sends fixed, read-only Slurm queries over
SSH. It requests the current user's queue and recent history, or the job IDs
registered for the selected project.

### Not present in this beta

The public beta includes no Firebase connection, friend codes, friend requests,
chat, analytics SDK, advertising SDK, or automatic crash-reporting service.
Experimental friend-source files may remain in the repository, but they are
disabled at the shipped entry point and are not a released feature.

## Logs and reports

Bug reports must not include credentials, raw authentication files, access
tokens, account identifiers, private hostnames, usernames, personal paths, or
unredacted terminal output.
