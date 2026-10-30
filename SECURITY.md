# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub private vulnerability reporting](https://github.com/abhilashjaiswal0110/Agent-Forge-for-Copilot-Studio/security/advisories/new)
(Security → Report a vulnerability). You will get an acknowledgement within 5 working days and
a fix or mitigation plan within 30 days for confirmed issues.

Include the extension version, VS Code version, steps to reproduce and the impact. Use the
fictional Contoso sample or a minimal agent folder; never send real tenant data.

## Supported versions

Only the latest version on the Visual Studio Marketplace receives fixes.

## How releases are protected

- Releases are built and published only by `.github/workflows/publish.yml` from a `v*` tag, in
  the `marketplace` environment, with Marketplace **Trusted Publishing** (GitHub OIDC). No
  publishing token exists, so none can leak. The Marketplace policy is bound to this
  repository's GitHub ids, so forks cannot publish.
- Each release runs the full test suite and an integration test on the exact VSIX it publishes.
  The GitHub release lists the VSIX SHA-256 and, for the public repository, a build provenance
  attestation: `gh attestation verify cps-agent-forge-<version>.vsix --repo abhilashjaiswal0110/Agent-Forge-for-Copilot-Studio`.
  Releases up to 0.4.3 were attested before the repository was renamed; verify those with
  `--repo abhilashjaiswal0110/Copilotstudio-extension`.
- Workflow actions are pinned to full commit SHAs, and the default workflow token is read-only.
- The extension sends no content in telemetry, and commands that run external processes or
  write outside the workspace require workspace trust and an explicit confirmation.
