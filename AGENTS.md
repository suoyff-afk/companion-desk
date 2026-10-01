# Agent instructions

Read `docs/PROJECT-SUMMARY.md` first for the current handoff, source map,
validation evidence, and limitations. Use actual code and command output as
evidence; historical results do not establish that a changed checkout passes.

## Scope and working method

- Companion Desk is a personal Windows desktop tool. HPC is its primary home
  action. A cloud development handoff does not change the application into a
  cloud service.
- Choose the smallest reliable change. Preserve one implementation per feature
  and the existing `src/features` / `src-tauri/src` module boundaries.
- Keep experimental changes on a branch. Changing the user's installed
  production application requires explicit user authorization.
- The HPC board is a manual, read-only Slurm view. Keep interactive terminal
  commands separate from fixed task queries. Never equate scheduler completion
  with solver progress, scientific acceptance, or an unverified percentage.
- This repository is public. Never commit credentials, local SSH/Codex data,
  private hostnames, personal paths, research outputs, or build artifacts.
- Update the existing project summary with dated, concise evidence and the
  next step. Do not create duplicate status reports or copy chat transcripts.

## Validation and delivery

Use Node.js 22 and `npm ci`. Run `npm test -- --maxWorkers=2`, `npm run build`,
and `npm run release:assets:check` for frontend/source changes. Check the actual
candidate's reachable history with `npm run release:history:gate -- --ref <commit>`.

On Windows with Rust installed, run
`cargo test --manifest-path src-tauri/Cargo.toml` and `npm run tauri -- build`.
Use the normal Tauri build for packaged applications. A browser preview or
Linux frontend test does not verify native Windows behavior or real SSH access.

The existing CI includes Linux frontend and Windows desktop jobs. Report their
actual status separately from local tests. Source synchronization does not
authorize a release tag or publishing installers; follow `docs/RELEASE.md`
for releases. Report outcomes, evidence, and remaining limits concisely.
