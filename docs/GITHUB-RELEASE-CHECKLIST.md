# Companion Desk 0.5.0 public-beta release checklist

Check an item only after recording current evidence for the exact candidate.

## Before tagging

- [ ] `$CandidateTag` records the selected candidate tag: `v0.5.0-beta` for the
      first candidate or the next unused `v0.5.0-beta.N` for a retry.
- [ ] The public build and user-facing material include only the approved
      local-first scope and expose no friend control, Firebase setup, promise,
      or request.
- [ ] Fresh and upgrade profiles keep exactly one visible pet through expand,
      collapse, close-to-pet, drag, size, rapid transitions, and display
      changes; Exit ends the Companion Desk process and all its windows, and
      relaunch restores one pet.
- [ ] Legacy Home/collapsed layouts migrate without hidden, off-screen, opaque,
      fixed-size, or duplicate windows; valid expanded sizes remain restorable.
- [ ] All included views and their loading, empty, unavailable, stale,
      malformed, and error states pass native visual review.
- [ ] Quota with usable, missing, stale, and malformed local Codex state never
      substitutes local-history totals; local activity remains non-authoritative.
- [ ] Focus, Gomoku, 2048, preferences, offline use, and embedded Windows
      OpenSSH valid/missing/error/disconnect paths behave as documented.
- [ ] Naming, independent-project attribution, licenses, notices, README,
      privacy, security, limitations, and `docs/RELEASE_TEMPLATE.md` are prepared
      and match the shipped local-first scope.
- [ ] The asset inventory and public documentation consistently record that the
      user created the character artwork and authorized public Companion Desk
      distribution on 2026-08-09, and every shipped asset passes
      `npm run release:assets:gate`.
- [ ] Every published repository/support link resolves to the verified intended
      destination; unknown links are omitted and no placeholder is presented as
      a real URL.
- [ ] `npm run release:history:gate` passes from a clean clone against every
      intended public ref and reachable object, covering secrets, personal
      paths, private identities, local configuration, generated artifacts, and
      internal QA material.
- [ ] `.npmrc`, `.cargo/config.toml`, Firebase logs/exports, credentials, build
      outputs, and installers are absent from tracked public history.
- [ ] All five manifests/locks report `0.5.0`; the identifier remains
      `com.kunkun.desk`; `node scripts/validate-release-tag.mjs $CandidateTag`
      passes for the selected candidate.
- [ ] The release workflow builds without Firebase repository variables and
      cannot enable friend networking in the public package.
- [ ] Clean-checkout asset, dependency, frontend, build, Rust, metadata,
      sensitive-content, workflow, and binary-path scanner tests plus the
      release-workflow configuration pass for the frozen commit.

## Tagged draft and artifacts

- [ ] Every pre-tag item is checked before creating the selected candidate tag
      from the frozen reviewed commit.
- [ ] The Windows workflow builds that commit and uploads only
      `companion-desk-windows-x64-unsigned`, with no macOS or legacy-product
      artifact.
- [ ] The GitHub Release for the selected candidate tag remains draft and prerelease
      during validation.
- [ ] The draft contains exactly one unsigned EXE (primary), one unsigned MSI
      (backup), and `SHA256SUMS.txt` covering both installers.
- [ ] The inner executable passes its local-build-path scan; downloaded hashes
      independently match `SHA256SUMS.txt`.
- [ ] Both generated source archives and every downloadable asset are inspected
      for unexpected, ignored, sensitive, or machine-specific content.
- [ ] Draft notes accurately state included/deferred scope, known limitations,
      and the unsigned/Windows SmartScreen warning without claiming signing or
      verified-publisher status.

## Isolated Windows acceptance

- [ ] The verified EXE clean-installs, launches, and uninstalls on isolated
      Windows 10 x64 and Windows 11 x64 environments.
- [ ] The verified MSI backup clean-installs, launches, and uninstalls on
      isolated Windows 10 x64 and Windows 11 x64 snapshots without conflicting
      with the EXE path.
- [ ] Upgrading a compatible `com.kunkun.desk` installation preserves intended
      local state, migrates legacy layouts, and creates neither a second app
      identity nor a second companion window.
- [ ] Native checks cover pet/panel lifecycle, quota states, local activity,
      focus, both games, OpenSSH, offline use, and absence of friend UI or
      Firebase traffic.
- [ ] The evidence matrix records every EXE/MSI and Windows 10/11 pair, OS build,
      candidate SHA-256, prior upgrade version, result, and observed
      post-uninstall data behavior.

## Publish

- [ ] Every gate has current evidence for the selected candidate tag and
      downloaded assets; after evidence begins, a candidate change never moves
      that tag and instead uses a new incremented `v0.5.0-beta.N` tag and draft
      with fresh evidence.
- [ ] The final prerelease contains only inspected EXE, MSI,
      `SHA256SUMS.txt`, source archives, and accurate notes.
- [ ] The release owner explicitly approves publishing the draft.

Do not publish while any blocking item is unchecked.

## Deferred, not beta gates

- Production Firebase configuration/deployment and two-user verification.
- Friend codes, requests, pokes, and all other friend UI or promises.
