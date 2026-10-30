# Agent Forge for Copilot Studio

**Design, lint, evaluate and ship multi-agent orchestrators for Microsoft Copilot Studio from VS Code.**
Works with the **standard** harness (topics and actions) and the **GitHub Copilot** harness
(the new agent experience: skills, tools and connected agents).

> Preview. Agent Forge is an independent tool. It is not affiliated with or endorsed by Microsoft.

## Features

| Feature | What you get |
|---|---|
| **Agent explorer** | Every cloned agent in the workspace with its harness, topics, actions, skills, tools, knowledge, connections and connected agents. Click to open. |
| **Architecture graph** | Orchestrators, connected agents and external targets on one canvas with error and warning counts. **Copy as Mermaid** for design documents. |
| **Policy linter** | 25 rules for routing, multi-agent depth, the single write agent, MCP allowlists, auto-approve, human in the loop, hard-coded secrets, insecure URLs, waiting UX, skill drift, missing topics and formatting, in the Problems panel. |
| **Quick fixes** | <kbd>Ctrl</kbd>+<kbd>.</kbd> fixes for seven rules, **Apply All Safe Quick Fixes**, and disable-rule on every finding. |
| **Blueprint wizard** | Generates an orchestrator, read-only domain agents and one write agent with routing, confirmation and waiting rules, and can create them in a dev environment with `pac copilot init`. |
| **Evaluation studio** | Drafts a test set from routing descriptions plus safety cases, validates it against the import rules, and triages exported results by failure type. |
| **Safe lifecycle** | Pull, push (draft) and publish through `pac copilot` with a CLI capability check, lint gate, confirmation, snapshots and a release-evidence log. |
| **Environment profiles** | Mark environments as dev, test or prod. The stage shows next to each agent, production steps need the profile name typed (or are blocked), and `agent-forge env --deny prod` checks folders in CI. |
| **Browser recipes** | Portal-only steps (add an MCP tool, capture a test trace, provision a SharePoint list, import a test set, verify a publish) run by Copilot agent mode through Playwright MCP, with consent gates. |
| **CLI, CI and MCP** | `dist/cli.js` with SARIF output, `--fix` and exit codes, a guardrail git hook, and a read-only MCP server with eight tools. |
| **Snippets and skills** | YAML snippets (`af-hitl`, `af-connected-agent`, `af-mcp-tool`, …), three expert skills and two custom agents for Copilot. |

## Quick start

1. Install the [Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction)
   2.14 or later (`pac install latest`) and sign in with `pac auth create`.
2. Clone your agents side by side into one folder: `pac copilot clone --bot <id> --environment <env>`.
   No agent yet? Run **Agent Forge: Open Contoso Sample** or **Agent Forge: New Orchestrator Blueprint**.
3. Open the folder. The **Agent Forge** view appears in the activity bar.
4. Run **Agent Forge: Show Architecture Graph** and **Agent Forge: Lint Workspace**, then fix
   findings with <kbd>Ctrl</kbd>+<kbd>.</kbd>.
5. Right-click an agent → **Pull**, **Push Agent as Draft**, **Publish Agent**.
6. Right-click an agent → **New Evaluation Test Set**, import it on the Copilot Studio Evaluate
   tab, and run **Analyse Evaluation Results** on the exported CSV.

**Agent Forge: Get Started** opens a walkthrough of these steps.

## Commands

| Command | Notes |
|---|---|
| Refresh Agents · Lint Workspace · Show Architecture Graph | Explore and check the workspace. Work offline and in untrusted workspaces. |
| Apply All Safe Quick Fixes · Disable Lint Rule… | Fix or silence findings. |
| Pull Agent · Push Agent as Draft · Publish Agent | `pac copilot pull/push/publish`. Needs workspace trust; snapshot and confirmation first; push and publish are blocked on lint errors unless you override, and guarded by environment profiles. |
| Add Environment Profile… | Saves the agent's environment (from `.mcs/conn.json`) or a typed URL as a dev, test or prod profile in workspace settings. |
| New Orchestrator Blueprint… | Files only, or files plus live agents via `pac copilot init --environment` (trust and confirmation required). |
| New Evaluation Test Set · Validate Evaluation CSV · Analyse Evaluation Results | Evaluation studio. Validate and analyse are also on the CSV context menu in the Explorer. |
| Run Browser Recipe… · Configure Browser Co-pilot | Playwright MCP limited to Copilot Studio and Power Platform hosts, isolated profile by default. |
| Configure Agent Forge MCP Server · Install Guardrail Git Hook | Use the checks from any MCP client and before every commit (needs Node.js). |
| Install Copilot Studio Skills · Open Contoso Sample · Get Started | Skills into `.github/skills`, recipes into `.github/prompts`, the sample and the walkthrough. |

## Lint rules

Errors block push and publish unless you override. Disable rules with
`agentForge.lint.disabledRules`.

| Id | Severity | Harness | Rule |
|---|---|---|---|
| YAML001 | Error | Any | YAML parse error |
| HARN001 | Error | Any | Mixed harness shapes |
| MA001 | Error | Any | Nested connected agents |
| MA002 | Info | GitHub Copilot | Connected agent not in workspace |
| MA003 | Info | GitHub Copilot | Connected agent shares full history |
| DESC001 | Warning | Any | Missing description |
| DESC002 | Info | Any | Description is a label, not a trigger |
| DESC003 | Warning | Any | Duplicate descriptions |
| SEC001 | Warning | GitHub Copilot | MCP tool exposes all operations |
| SEC002 | Warning | GitHub Copilot | Auto-approve without allowlist |
| HITL001 | Warning | Any | Write capability without confirmation protocol |
| UX001 | Info | GitHub Copilot | No waiting message guidance |
| SKL001 | Warning | GitHub Copilot | Skill description drift |
| DRY001 | Info | GitHub Copilot | Duplicated skill content |
| FMT001 | Error | Any | Name too long |
| FMT002 | Warning | Any | Colon-space in knowledge description |
| INST001 | Warning | Any | Missing instructions |
| INST002 | Warning | Any | Instructions too long |
| MA004 | Info | Any | More than one write agent |
| SEC003 | Error | Any | Hard-coded secret |
| SEC004 | Warning | Any | Insecure http URL |
| HITL002 | Warning | GitHub Copilot | Auto-approved write operations |
| SKL002 | Warning | GitHub Copilot | Skill without SKILL.md |
| TOP001 | Warning | Standard | Redirect to missing topic |
| FMT003 | Info | Any | Description too long |

Quick fixes: FMT002, SEC002, HITL002, SKL001 and SKL002 (safe, applied by *Apply All* and
`--fix`); SEC001 and SEC004 (manual, review before saving).

## Command line and CI

The extension folder contains `dist/cli.js` (Node.js 20+):

```bash
node dist/cli.js lint agents --format sarif --output agent-forge.sarif --fail-on error
node dist/cli.js lint agents --fix
node dist/cli.js blueprint spec.json --out agents
node dist/cli.js eval generate agents --agent contoso_ITAssistant --output evals/testset.csv
node dist/cli.js eval validate evals/testset.csv
node dist/cli.js eval analyze results.csv --format markdown
node dist/cli.js env agents --deny prod                       # fail if a folder is linked to production
node dist/cli.js mcp agents
```

Exit codes: 0 success, 1 findings at or above `--fail-on`, 2 usage error. Upload the SARIF file
to GitHub code scanning or Azure DevOps to see findings on pull requests.

MCP tools (all read-only and offline): `list_rules`, `list_agents`, `lint`,
`architecture_mermaid`, `generate_test_set`, `validate_test_set`, `analyze_eval_results`,
`plan_blueprint`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `agentForge.pacPath` | `pac` | Path to the Power Platform CLI. |
| `agentForge.lint.disabledRules` | `[]` | Rule ids to disable. |
| `agentForge.environments` | `[]` | Profiles: `{ "name": "Contoso Dev", "kind": "dev", "url": "https://contoso-dev.crm.dynamics.com/" }` (or `id` with the environment GUID). |
| `agentForge.productionGuard` | `confirm` | For prod profiles: `confirm` (type the profile name), `block` or `off`. |
| `agentForge.requireEnvironmentProfile` | `false` | Refuse push, publish and creating agents in environments without a profile. |
| `agentForge.browser.profile` | `isolated` | `isolated` (fresh in-memory browser) or `extension` (your signed-in Edge or Chrome through the Playwright extension). |

## Supported layouts

- **GitHub Copilot harness**: `settings.mcs.yml` (+ `agent.sync.yaml`), `behaviors/`,
  `capabilities/tools`, `capabilities/knowledge`, `infrastructure/connections`.
- **Standard harness**: `agent.mcs.yml`, `settings.mcs.yml`, `topics/`, `actions/`,
  `knowledge/`, `variables/`, `agents/`.
- `workflows/` (cloud flows) in both. Sync metadata (`.mcs/conn.json`) is used for publish and environment profiles.
- Power Fx values written by the portal as plain scalars (for example `activity: ="Hi: " & User.DisplayName`)
  are accepted even though they are not strict YAML.

## Requirements

- VS Code 1.95 or later.
- Power Platform CLI 2.14 or later for pull, push, publish and creating agents. The extension
  checks the version before each step.
- Node.js 20 or later only for the CLI, the MCP server and the git hook.
- Copilot Chat (agent mode) for browser recipes and skills.

## Privacy, security and telemetry

- Lint, graph, quick fixes, blueprints and evaluation files work offline. Nothing is uploaded.
- Commands that run `pac`, write MCP configuration or install a git hook need workspace trust
  and an explicit confirmation. Browser recipes ask for consent and stop before every save.
- Hard-coded secret findings never echo the secret.
- Anonymous usage telemetry (command names, counts, durations, harness types, rule ids) is sent
  only when the build includes a telemetry key **and** VS Code telemetry is enabled
  (`telemetry.telemetryLevel`). No agent names, paths, descriptions, instructions, ids or
  environment details are ever sent.

## Known limitations

- Evaluation-result analysis matches column names from the Copilot Studio export; edited
  headers may need renaming.

## License

[MIT](https://github.com/abhilashjaiswal0110/Copilotstudio-extension/blob/main/LICENSE). Source, issues and security reports:
[github.com/abhilashjaiswal0110/Copilotstudio-extension](https://github.com/abhilashjaiswal0110/Copilotstudio-extension)
(see SECURITY.md for private vulnerability reporting).