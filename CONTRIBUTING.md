# Contributing

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for the clean-room rules.

## Build and test

```powershell
npm ci
npm run scan; npm run typecheck; npm test; npm run build   # gate before every commit
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

Roadmap: [docs/PLAN.md](docs/PLAN.md). Rules: [docs/RULES.md](docs/RULES.md).
