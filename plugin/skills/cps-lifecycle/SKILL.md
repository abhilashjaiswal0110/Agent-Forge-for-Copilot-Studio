---
name: cps-lifecycle
description: Runs the safe Copilot Studio change lifecycle - pull, validate, push as draft, publish, re-pull and test - with the Power Platform CLI and Agent Forge commands, including browser checks through Playwright MCP. Use when the user wants to pull, push, publish, sync, deploy or test a Copilot Studio agent, or resolve a push conflict.
---

# Copilot Studio change lifecycle

## Prerequisites

- Power Platform CLI (`pac`) with the `copilot` command group: `pac copilot help`.
- An authenticated profile for the target environment: `pac auth list`, `pac auth create`.
- The agent was cloned (it has `.mcs/conn.json` or sync metadata). You cannot push an agent
  that was never cloned.

## The loop

1. **Pull** – `Agent Forge: Pull Agent` (runs `pac copilot pull --project-dir <agent>`).
   Always pull before editing; the portal may have changed. Agent Forge snapshots the folder
   first so you can roll back.
2. **Edit** – descriptions, instructions, skills, topics. Do not hand-create tools,
   connections or new agents; add those in the portal, then pull.
3. **Validate** – `Agent Forge: Lint Workspace`. Errors block push. Also run the official
   validation if available (`/copilot-studio:validate`).
4. **Push** – `Agent Forge: Push Agent as Draft` (`pac copilot push --project-dir <agent>`).
   This creates a draft. If push reports a conflict: pull, re-apply your change, validate,
   push again. Never force over the portal.
5. **Publish** – `Agent Forge: Publish Agent` (`pac copilot publish --bot <id or schema>`).
   Drafts are not visible to channels or external test tools until published.
6. **Re-pull** – pull once more so on-disk files match what the service normalised.
7. **Test** – exercise every changed route (see below). A change is verified only when the
   activity map shows the intended topic, tool or agent firing with sensible arguments.

Agent Forge records each step in `release-evidence.jsonl` in its storage folder. Attach it to
the change record if your team needs an audit trail.

## Multi-agent order

Push and publish **spokes before the orchestrator**. A connected-agent tool resolves the
published version of its target; publishing the orchestrator first tests against stale spokes.

## Browser checks with Playwright MCP

Run **Agent Forge: Configure Browser Co-pilot** once. It adds the `copilot-studio-browser`
server to `.vscode/mcp.json`:

- `isolated` profile (default): a fresh in-memory browser. Sign in when prompted; nothing
  persists after the session.
- `extension` profile: drives your signed-in Edge or Chrome through the Playwright browser
  extension. Use only on a trusted machine.

Navigation is limited to Copilot Studio, Power Platform and Microsoft sign-in hosts.

Typical browser tasks:

1. Open `https://copilotstudio.microsoft.com`, pick the environment and the agent.
2. Open the test pane, send each test prompt, wait for the reply, take a snapshot of the
   activity map, and record pass/fail per prompt.
3. Check portal-only settings (channels, authentication, connection status) and report
   anything that does not match the YAML.

Never type credentials or secrets on the user's behalf, never approve consent dialogs
without the user, and never publish from the browser when the CLI path is available.

## Rollback

Each pull or push snapshot is in the extension storage `snapshots/` folder (last 10 kept).
To roll back: restore the snapshot into the agent folder, validate, push, publish.
