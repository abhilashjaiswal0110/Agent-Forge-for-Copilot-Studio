# Changelog

## 0.4.1 – preview

- Releases are published from GitHub Actions with Marketplace Trusted Publishing (OIDC): no
  stored publishing token. Each release runs the full test gate and the VS Code integration test
  on the exact VSIX it publishes, and attaches it to a GitHub release.

## 0.4.0 – preview

- **Environment profiles**: `agentForge.environments` marks Dataverse environments as dev, test
  or prod (matched by environment id or URL from `.mcs/conn.json`). The Agent Forge view shows
  the stage of each agent. Push, publish and the blueprint wizard's live mode follow
  `agentForge.productionGuard` (`confirm`: type the profile name, `block`, `off`) and
  `agentForge.requireEnvironmentProfile`. New command *Add Environment Profile*; the blueprint
  wizard offers profiles; release evidence records the stage.
- CLI `agent-forge env [folders] [--profiles file] [--deny prod,unknown]` for CI checks.
- **Power Fx values** written by the portal as plain scalars (for example
  `activity: ="Hi: " & User.DisplayName`) no longer raise YAML001.
- Dev tooling upgraded (vitest 5, vite 8, esbuild 0.28, @vscode/vsce 4, @vscode/test-electron 3):
  `npm audit` reports 0 vulnerabilities. CI runs on Node 22; the CLI still targets Node 20.
## 0.3.0 – preview

- **Blueprint wizard** (*New Orchestrator Blueprint*): an orchestrator, read-only domain agents
  and one write agent with routing, context-envelope, waiting and confirmation rules, a
  connected-agent tool per agent and a triage skill. Creates files only, or the live agents in
  an environment with `pac copilot init --environment`. Also `agent-forge blueprint spec.json`.
- **Evaluation studio**: *New Evaluation Test Set* (routing and safety cases),
  *Validate Evaluation CSV* (Copilot Studio import rules, diagnostics in Problems) and
  *Analyse Evaluation Results* (pass rate per method, six failure categories with advice).
  CLI `agent-forge eval generate|validate|analyze`.
- **Browser recipes**: add an MCP tool, capture a test trace, provision a SharePoint list,
  import a test set, verify a publish; *Run Browser Recipe* asks for consent and hands the
  recipe to Copilot agent mode. *Install Skills* also installs them as prompt files.
- YAML snippets (`af-hitl`, `af-envelope`, `af-connected-agent`, `af-mcp-tool`, `af-skill`),
  *Install Guardrail Git Hook*, *Open Contoso Sample*.
- MCP server: four new read-only tools (`generate_test_set`, `validate_test_set`,
  `analyze_eval_results`, `plan_blueprint`).
- Phase 2 exit test automated and passed against a dev environment (`npm run test:e2e`).
- Integration test of the packaged VSIX in a clean VS Code (`npm run test:integration`).
- Marketplace listing: icon, gallery banner, self-contained README, homepage and issues links,
  free-to-use preview licence.
- Fix: instructions stored as `StaticSegment` values (the shape `pac copilot init` writes) were
  read with the segment kind as text, so INST001 never fired on real agents.
## 0.2.0 – private preview

- Nine new lint rules (25 in total): INST001 missing instructions, INST002 instructions over
  8,000 characters, MA004 more than one write agent, SEC003 hard-coded secret, SEC004 insecure
  http URL, HITL002 auto-approved write operations, SKL002 skill without `SKILL.md`, TOP001
  redirect to a missing topic, FMT003 description over 1,024 characters.
- Quick fixes for FMT002, SEC001, SEC002, HITL002, SEC004, SKL001 and SKL002, a
  "Disable rule" action on every finding, and **Apply All Safe Quick Fixes**.
- **Get Started** walkthrough (clone, explore, lint and fix, ship, co-pilots, CI).
- Command-line tool `agent-forge` (`dist/cli.js`): `lint` with text, JSON and SARIF output,
  `--fail-on`, `--disable`, `--fix` and `--output`; `rules`; `graph`; `mcp`.
- Read-only MCP server (v1): `list_rules`, `list_agents`, `lint`, `architecture_mermaid`, plus a
  command to register it in `.vscode/mcp.json`.
- Pull, push and publish first check that the installed Power Platform CLI supports the step
  and explain how to update it (`pac copilot pull`/`push` need a recent CLI).
- Marketplace publisher set to `AbhilashJaiswal`.
- Fix: a standard-harness agent with cloud flows in `workflows/` is no longer reported as a
  mixed harness (HARN001).
- Fix: unreadable files (for example cloud-only OneDrive placeholders) are reported as YAML001
  instead of stopping the scan.

## 0.1.0 – private preview

- Agent explorer for standard and GitHub Copilot harness agents.
- Architecture graph webview with Mermaid export.
- Policy linter with 16 rules (routing, multi-agent depth, MCP allowlists, human in the loop,
  waiting UX, skill drift, formatting).
- Pull, push and publish through `pac copilot` with lint gates, confirmations, snapshots and
  release evidence.
- Bundled Agent Plugin: three skills, two custom agents and a Playwright MCP browser co-pilot.
- Commands to configure the browser co-pilot and install skills into a workspace.
- Fictional Contoso IT help desk sample.
