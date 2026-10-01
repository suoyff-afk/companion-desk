# Companion Desk Launch Strategy

Date: 2026-08-12
Status: Positioning approved; promotion blocked by the v0.5.1 quality pass

## Goal

Help general Codex users understand and try Companion Desk without turning the
beta into a broad productivity suite. Promotion starts only after known product
and release-page defects are repaired and a fresh Windows candidate passes the
quality gate below.

## Evidence state

Verified facts:

- `v0.5.0-beta` is publicly available for Windows x64;
- the public build includes Kunkun, Codex quota/activity views, focus sessions,
  local games, and embedded Windows OpenSSH;
- friend networking is disabled in the public build;
- the installers are unsigned;
- the current README has no direct release link and still uses pre-release
  wording;
- reactivating a collapsed pet can replace the selected pet size with the
  native 160 by 150 fallback;
- the keep-alive 2048 page listens for arrow keys while hidden.

Unverified hypotheses:

- the combined pet, quota, and focus proposition is attractive to general Codex
  users;
- a short demonstration improves download conversion;
- users will keep the pet on their desktop after the first day.

The quality pass may fix verified defects. Only external use can test the three
hypotheses, so they must not be presented as established product facts.

## v0.5.1 quality pass

The next beta is a repair release, not a feature release. Its implementation
scope is limited to:

1. Reapply the saved pet size and visibility correction whenever native
   activation returns the app to collapsed mode.
2. Prevent the hidden 2048 page from consuming keys or changing game state.
3. Replace README pre-release wording with a prominent, real Windows download
   link, accurate verification instructions, and current release status.
4. Remove friend-poke claims from package metadata while the public build keeps
   networking disabled.
5. Update all version manifests, release contracts, and release documentation
   consistently to `0.5.1` / `v0.5.1-beta`.
6. Add accurate GitHub topics after the release candidate is verified.

Embedded SSH intentionally remains mounted across page navigation so a user can
return to a running terminal session. That behavior is not changed in this
repair release. The collapsed pet's click, right-click, and drag behavior must
be checked in the packaged Windows build; the drag implementation changes only
if that test reproduces a conflict.

Acceptance requires targeted regression tests, the complete frontend and Rust
suites, a production build, a packaged Windows smoke test, matching release
asset checksums, and a final audit of the public GitHub page. A real motion demo
is recorded only from the accepted `v0.5.1-beta` build and is not simulated.

## Audience and positioning

Primary audience: Windows users who already use Codex and want a friendlier,
lighter way to keep quota and focus tools near their workflow.

Primary promise:

> Your cute desktop companion for Codex. See your quota, stay focused, and take
> a quick break without leaving your workflow.

Kunkun attracts attention; reliable quota, focus, and short-break tools prove
that Companion Desk is more than decoration. HPC / SSH remains a useful
secondary feature rather than the headline.

## Considered approaches

1. Static screenshots: fastest, but does not communicate motion or the floating
   pet experience.
2. Short real-product demonstration: selected. It balances personality,
   credibility, production cost, and reuse across channels.
3. Polished cinematic trailer: potentially attractive, but too expensive for a
   first public beta and likely to become outdated quickly.

## Core launch asset

After the quality pass, create one 15-25 second recording from the accepted
released Windows build:

1. Kunkun idles on the desktop, moves, and changes size.
2. A click expands Companion Desk.
3. The quota card is shown briefly.
4. A focus session is started.
5. A local game or SSH page is opened.
6. The Desk collapses back to Kunkun.

Use the same recording as the README hero GIF and as the source for short social
posts. Do not simulate unavailable features or include personal quota, host,
account, path, or project information.

## GitHub first-screen structure

The README above the fold should contain, in order:

1. Product name and the primary promise.
2. The short demonstration.
3. One prominent `Download for Windows` link to the latest GitHub Release.
4. Three concise benefits: Codex quota, focus sessions, and short breaks.
5. Trust line: free, local-first, no telemetry.

Move detailed boundaries, development setup, checksums, and HPC / SSH guidance
below the product introduction. Remove release-planning language that is no
longer true after publication.

Add GitHub topics: `codex`, `desktop-pet`, `productivity`, `focus-timer`, `ssh`,
`hpc`, `tauri`, `windows`, and `local-first`.

## Distribution sequence

1. Complete and publish the `v0.5.1-beta` quality pass.
2. Provide a domestic download mirror for the EXE and checksum file while
   keeping GitHub as the authoritative source and issue tracker.
3. Publish the same truthful demonstration and download path to one Chinese
   channel already used by the maintainer; do not require a foreign social
   account.
4. Invite any willing external Codex user to try the build. There is no minimum
   team size and no requirement to recruit several people before the first post.
5. Fix only installation, onboarding, quota visibility, or serious interaction
   failures found through that feedback.

Each post should lead with the pet in motion, give one sentence of utility, and
link directly to the GitHub Release. Avoid long feature lists.

## Success measures

The first gate is not star count or a fixed recruitment number. External
validation starts with the first person outside the project who can:

- download and install the released build;
- understand how to expand and collapse Kunkun;
- see a real quota value or an honest unavailable state;
- start a focus session;
- explain whether they would keep the app and why.

Collect only voluntary qualitative feedback and public GitHub download counts;
do not add telemetry for this launch.

## Non-goals

- No chat system, leaderboard, complex progression, or new games for launch.
- Do not advertise friend interaction while it is disabled in the public beta.
- Do not position Companion Desk as a replacement for every Codex or terminal
  workflow.
- Do not target every desktop-pet user; target Codex users first.

## Risks and mitigations

- Unsigned Windows installers reduce trust: state the SmartScreen warning
  clearly and keep checksums prominent.
- Quota formats may change: demonstrate only the honest current behavior and
  retain the unavailable state.
- A feature-heavy README can hide the value: keep the first screen limited to
  the promise, demonstration, download, three benefits, and trust statement.
- Personal screenshots can leak data: record with neutral aliases and sanitized
  quota/activity content.

## Acceptance

- The v0.5.1 repair scope passes its automated and packaged Windows gates before
  promotion begins.
- The hero demonstration comes from the exact accepted released build.
- A new visitor can identify the product, platform, primary benefit, and download
  action without scrolling through development documentation.
- Every public claim matches a feature enabled in `v0.5.1-beta`.
- The same core message is used across GitHub and launch posts.
