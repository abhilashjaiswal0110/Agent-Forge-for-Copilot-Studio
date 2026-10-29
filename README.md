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
| **Policy linter** | 16 rules for routing, multi-agent depth, MCP allowlists, human-in-the-loop, waiting UX, skill drift and formatting. Results in the Problems panel. See [docs/RULES.md](docs/RULES.md). |
| **Safe lifecycle** | Pull, push (draft) and publish through `pac copilot`, with lint gates, a confirmation step, automatic snapshots and a `release-evidence.jsonl` log. |
| **Expert skills and agents** | Clean-room skills (`cps-orchestrator-architect`, `cps-agent-review`, `cps-lifecycle`) and custom agents (`cps-architect`, `cps-browser-tester`) for Copilot Chat and other Agent Plugin hosts. |
| **Browser co-pilot** | One command adds a Playwright MCP server limited to Copilot Studio and Power Platform hosts – isolated profile by default. |

## Quick start

1. Install the [Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction) and sign in: `pac auth create`.
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
| Agent Forge: Pull Agent | `pac copilot pull --project-dir <agent>`; snapshot first. Needs workspace trust. |
| Agent Forge: Push Agent as Draft | Blocked on lint errors unless you override; snapshot first. |
| Agent Forge: Publish Agent | `pac copilot publish --bot <id>`; type the agent name to confirm. |
| Agent Forge: Configure Browser Co-pilot | Writes `copilot-studio-browser` into `.vscode/mcp.json`. |
| Agent Forge: Install Copilot Studio Skills | Copies the bundled skills into `.github/skills`. |

## Settings

| Setting | Default | Description |
|---|---|---|
| `agentForge.pacPath` | `pac` | Path to the Power Platform CLI. |
| `agentForge.lint.disabledRules` | `[]` | Rule ids to disable. |
| `agentForge.browser.profile` | `isolated` | `isolated` (fresh in-memory browser) or `extension` (your signed-in Edge/Chrome via the Playwright extension). |

## Supported layouts

- **GitHub Copilot harness**: `settings.mcs.yml` (+ `agent.sync.yaml`), `behaviors/`,
  `capabilities/tools`, `capabilities/knowledge`, `infrastructure/connections`, `workflows/`.
- **Standard harness**: `agent.mcs.yml`, `settings.mcs.yml`, `topics/`, `actions/`,
  `knowledge/`, `variables/`, `agents/`.
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
