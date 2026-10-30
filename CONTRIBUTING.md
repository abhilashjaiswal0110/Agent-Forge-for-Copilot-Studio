# Contributing

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for the clean-room rules.

## Build and test

```powershell
npm ci
npm run scan; npm run typecheck; npm test; npm run build   # gate before every commit
npm run scan:history                                       # every published file version and commit message
npm run package                                            # produces the .vsix
npm run test:integration                                   # installs the newest .vsix into a downloaded VS Code and drives it
```

Press <kbd>F5</kbd> with the sample folder open to debug. `npm run icon` regenerates
`media/icon.png`.

## Dev-environment round trip (Phase 2 exit test)

Opt-in and maintainer-only. It creates and deletes scratch agents and their solutions, so use a
dev environment and a pac profile with maker rights:

```powershell
$env:AGENT_FORGE_E2E_ENV = 'https://<dev-org>.crm.dynamics.com/'
npm run test:e2e        # set AGENT_FORGE_E2E_KEEP=1 to keep the agents for inspection
```

## Releasing

Releases use Marketplace **Trusted Publishing** (GitHub OIDC); there is no publishing token to
store or rotate.

1. Bump `version` in `package.json` and add a `## <version>` section to `CHANGELOG.md`; merge.
2. Tag the merge commit and push the tag: `git tag v0.4.1 && git push origin v0.4.1`.
3. `.github/workflows/publish.yml` runs in the `marketplace` environment (only `v*` tags may deploy),
   runs the full gate and the integration test on the VSIX, publishes it with
   `vsce publish --oidc`, and creates a GitHub release with the VSIX attached.

The Marketplace policy (publisher **AbhilashJaiswal** → Trusted Publishing) must name owner
`abhilashjaiswal0110`, repository `Agent-Forge-for-Copilot-Studio`, workflow `publish.yml` and
environment `marketplace`. Because the repository is private, a new or reopened policy must be
used within 48 hours; the first successful publish activates it permanently.

Security: [SECURITY.md](SECURITY.md). Going public: [docs/PUBLIC-RELEASE.md](docs/PUBLIC-RELEASE.md);
repository settings: `node scripts/harden-repo.mjs`.

Roadmap: [docs/PLAN.md](docs/PLAN.md). Rules: [docs/RULES.md](docs/RULES.md).
