# Changelog

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
