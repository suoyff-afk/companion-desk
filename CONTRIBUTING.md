# Contributing

Thanks for helping improve Companion Desk.

## Before opening an issue

Remove tokens, account identifiers, private SSH details, terminal output, personal paths, and unredacted screenshots.

## Development

```powershell
npm ci
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Use `npm run tauri dev` for desktop behavior. A browser preview cannot verify native quota reads, OpenSSH, transparency, dragging, or installer behavior.

## Pull requests

- Keep each change focused and preserve the boundaries in `PRIVACY.md`.
- Add a failing regression test before behavior changes.
- Do not add telemetry or log credentials and raw responses.
- Do not add personal host aliases, filesystem paths, generated installers, local caches, or unlicensed artwork.
- Keep the public-beta entry point local-first; friend networking is deferred.
- Do not claim a clean-machine install, signing, or asset clearance without evidence.
