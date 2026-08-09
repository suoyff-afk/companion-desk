# Test matrix

Record results for the exact frozen `v0.5.0-beta` candidate. Earlier smoke
tests are useful engineering history but are not release evidence.

| Area | Scenario | Required evidence |
| --- | --- | --- |
| Frontend | Unit and component suite | `npm test` passes on the candidate |
| Web build | TypeScript and Vite | `npm run build` passes on the candidate |
| Rust | Native unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` passes on the candidate |
| Quota | Signed in, signed out, stale, malformed response | No invented values or credential leakage |
| Local activity | Present, missing, and partial local records | Labels remain local and non-authoritative |
| Focus and games | Focus completion note, Gomoku, 2048 | Local state and controls behave as documented |
| Offline | No general network beyond unavailable quota/SSH destinations | Focus, games, preferences, and local activity remain usable |
| OpenSSH | Valid/invalid alias, resize, disconnect | Embedded terminal only; no saved password, command, or terminal output |
| Window | Start collapsed, drag, resize, expand, close-to-pet, exit | No duplicate, hidden, or opaque pet window |
| Install | EXE primary and MSI backup | Install, launch, compatible upgrade, and uninstall on Windows 10/11 x64 |
| Security | Tracked history, source archives, inner executable | No secrets, personal paths, private identities, or local tool config |
| Assets | Binary and README images | `npm run release:assets:gate` passes; authorization and provenance match `licenses/assets.json` |
| Network policy | Public-beta build | No friend control or Firebase traffic is present |

Friend networking and Firebase emulator/two-user testing are deferred to a
later network-enabled release and are not `v0.5.0-beta` gates.

Passing unit tests or a smoke test does not prove clean-machine installation,
quota correctness for every account, or native window behavior.
