# Agent Forge for Copilot Studio

> Private preview. Design, lint, visualise and ship **enterprise multi-agent orchestrators** on
> Microsoft Copilot Studio from VS Code – for both the **standard** harness and the **GitHub
> Copilot harness** (new agent experience).

Not affiliated with or endorsed by Microsoft.

## Features

| Feature | What you get |
|---|---|
| **Agent explorer** | Every cloned agent in the workspace, its harness, and its topics, actions, skills, tools, knowledge, connections and connected agents. Click to open. |
| **Architecture graph** | Orchestrators, connected agents and external targets on one canvas, with error and warning counts. **Copy as Mermaid** for design docs. |
| **Policy linter** | 25 rules for routing, multi-agent depth, the single write agent, MCP allowlists, auto-approve, human-in-the-loop, hard-coded secrets, insecure URLs, waiting UX, skill drift, missing topics and formatting. Results in the Problems panel. See [docs/RULES.md](docs/RULES.md). |
| **Quick fixes** | <kbd>Ctrl</kbd>+<kbd>.</kbd> fixes for colon-space descriptions, auto-approved writes, skill drift, missing `SKILL.md`, missing allowlists and http URLs, plus **Apply All Safe Quick Fixes** and per-rule disable. |
| **Safe lifecycle** | Pull, push (draft) and publish through `pac copilot`, with a CLI capability check, lint gates, a confirmation step, automatic snapshots and a `release-evidence.jsonl` log. |
| **CI and MCP** | A bundled command-line tool (`agent-forge lint`) with text, JSON and SARIF output, `--fix` and exit codes, and a read-only MCP server so any agent host can lint, inventory and diagram your agents. |
| **Walkthrough** | **Agent Forge: Get Started** takes you from cloning to CI in six steps. |
| **Expert skills and agents** | Clean-room skills (`cps-orchestrator-architect`, `cps-agent-review`, `cps-lifecycle`) and custom agents (`cps-architect`, `cps-browser-tester`) for Copilot Chat and other Agent Plugin hosts. |
| **Browser co-pilot** | One command adds a Playwright MCP server limited to Copilot Studio and Power Platform hosts – isolated profile by default. |

## Quick start

1. Install the [Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction)
   (a release with `pac copilot pull` and `push`; run `pac install latest` if they are missing) and sign in: `pac auth create`.
2. Clone your agents side by side into one folder (`pac copilot clone`, or the Copilot Studio extension).
3. Open the folder in VS Code. The **Agent Forge** view appears in the activity bar.
4. Run **Agent Forge: Show Architecture Graph** and **Agent Forge: Lint Workspace**.
5. Right-click an agent → **Pull**, **Push Agent as Draft**, **Publish Agent**.
6. Optional: **Agent Forge: Install Copilot Studio Skills into Workspace** and
   **Agent Forge: Configure Browser Co-pilot (Playwright MCP)**.

Try it on the bundled fictional sample in [`samples/contoso-it-helpdesk`](samples/contoso-it-helpdesk):
an orchestrator with two connected agents (GitHub Copilot harness) and a standard-harness agent.

## Commands

| Command | Notes |
|---|---|
| Agent Forge: Refresh Agents | Re-scan the workspace. |
| Agent Forge: Lint Workspace | Run all rules and open Problems. |
| Agent Forge: Show Architecture Graph | Opens the graph webview. |
| Agent Forge: Pull Agent | `pac copilot pull --project-dir <agent>`; checks the CLI supports it, snapshot first. Needs workspace trust. |
| Agent Forge: Push Agent as Draft | Blocked on lint errors unless you override; snapshot first. |
| Agent Forge: Publish Agent | `pac copilot publish --bot <id>`; type the agent name to confirm. |
| Agent Forge: Configure Browser Co-pilot | Writes `copilot-studio-browser` into `.vscode/mcp.json`. |
| Agent Forge: Install Copilot Studio Skills | Copies the bundled skills into `.github/skills`. |
| Agent Forge: Apply All Safe Quick Fixes | Applies every safe fix after a confirmation; undo in each editor. |
| Agent Forge: Disable Lint Rule… | Adds a rule id to `agentForge.lint.disabledRules` for the workspace. |
| Agent Forge: Configure Agent Forge MCP Server | Writes the read-only `agent-forge` server into `.vscode/mcp.json` (needs Node.js). |
| Agent Forge: Get Started | Opens the walkthrough. |

## Command line and CI

The VSIX bundles `dist/cli.js`; from a repository checkout run `npm ci && npm run build` first.

```bash
node dist/cli.js lint path/to/agents                          # text report, exit 1 on errors
node dist/cli.js lint agents --format sarif --output agent-forge.sarif --fail-on warning
node dist/cli.js lint agents --fix                            # apply safe quick fixes, then re-lint
node dist/cli.js rules                                        # list rules
node dist/cli.js graph agents > architecture.mmd              # Mermaid
node dist/cli.js mcp agents                                   # read-only MCP server on stdio
```

GitHub Actions example (upload SARIF to code scanning):

```yaml
- run: node tools/agent-forge/dist/cli.js lint agents --format sarif --output agent-forge.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: agent-forge.sarif
```

The MCP server exposes `list_rules`, `list_agents`, `lint` and `architecture_mermaid`. All
four are read-only and offline.

## Settings

| Setting | Default | Description |
|---|---|---|
| `agentForge.pacPath` | `pac` | Path to the Power Platform CLI. |
| `agentForge.lint.disabledRules` | `[]` | Rule ids to disable. |
| `agentForge.browser.profile` | `isolated` | `isolated` (fresh in-memory browser) or `extension` (your signed-in Edge/Chrome via the Playwright extension). |

## Supported layouts

- **GitHub Copilot harness**: `settings.mcs.yml` (+ `agent.sync.yaml`), `behaviors/`,
  `capabilities/tools`, `capabilities/knowledge`, `infrastructure/connections`.
- **Standard harness**: `agent.mcs.yml`, `settings.mcs.yml`, `topics/`, `actions/`,
  `knowledge/`, `variables/`, `agents/`.
- `workflows/` (cloud flows) is valid in both.
- Sync metadata from `.mcs/conn.json` (agent id and environment) is used for publish.

## Privacy and telemetry

Agent Forge sends anonymous usage events (command names, counts, durations, harness types)
only when the extension is built with a telemetry key **and** VS Code telemetry is enabled
(`telemetry.telemetryLevel`). It never sends agent names, file paths, descriptions,
instructions, ids or environment details. Lint and graph work fully offline.

In untrusted workspaces only the explorer, lint and graph run.

## Development

```powershell
npm ci
npm run typecheck; npm test; npm run build
npm run scan      # clean-room gate, see docs/PLAN.md section 4
npm run package   # produces the .vsix
```

Press <kbd>F5</kbd> with the sample folder open to debug. Roadmap: [docs/PLAN.md](docs/PLAN.md).

## License

Proprietary during private preview – see [LICENSE](LICENSE).
