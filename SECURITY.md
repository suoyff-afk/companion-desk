# Security

## Supported use

The `v0.5.0-beta` target is Windows 10/11 x64. It is an unsigned public beta,
not a security-hardened enterprise product.

## Boundaries

- Codex credentials are read locally for quota requests and are not
  intentionally persisted by Companion Desk.
- Quota parsing and local session history are best-effort integrations, not an
  official OpenAI API contract.
- Windows OpenSSH uses the user's existing configuration and security model.
  Companion Desk does not store SSH passwords or terminal output.
- Friend networking and Firebase are disabled in the public beta.
- The app does not include telemetry, analytics, advertising, or automatic
  crash uploads.

## Reporting

Do not post tokens, account identifiers, private SSH hostnames, usernames, raw
backend responses, terminal output, screenshots with personal data, or personal
paths in a public issue. Provide a minimal, redacted reproduction.

## Release checks

Before publishing the exact candidate:

- scan tracked files, reachable public history, source archives, and the inner
  executable for credentials and personal paths;
- run asset, dependency, frontend, Rust, build, metadata, and workflow gates;
- verify the unsigned EXE, MSI, and `SHA256SUMS.txt` produced by the tag;
- perform isolated Windows install, launch, upgrade, and uninstall tests;
- confirm the public interface and network policy expose no friend/Firebase
  feature.

None of these checks should be marked complete without recorded evidence.
