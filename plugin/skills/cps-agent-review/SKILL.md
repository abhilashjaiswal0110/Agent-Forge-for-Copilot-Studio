---
name: cps-agent-review
description: Reviews Copilot Studio agent YAML for routing, security, human-in-the-loop and multi-agent defects and proposes exact fixes. Use when the user asks to review, audit, harden or lint a Copilot Studio agent or solution, or asks why the wrong topic, tool or agent fired.
---

# Copilot Studio agent review

## 1. Gather facts first

1. Run **Agent Forge: Lint Workspace** (or read the Problems panel, source "Agent Forge").
   Each finding has a rule id; the rule catalogue is in the extension's `docs/RULES.md`.
2. Open **Agent Forge: Show Architecture Graph** to see orchestrators, connected agents and
   unresolved targets.
3. Find each agent root (folder containing `settings.mcs.yml` or `agent.mcs.yml`) and
   detect its harness before giving advice.

## 2. Review checklist

**Routing**
- Every topic, tool, skill, knowledge source and connected agent has a description written
  as a trigger condition, at least one sentence, naming when *not* to use it if a sibling
  overlaps.
- No two descriptions are identical or near identical.
- Standard harness: only `OnRecognizedIntent` topics compete for routing; system topics are fine without trigger phrases.

**Multi-agent**
- Depth 1: a connected agent never has its own connected agents.
- Every connected-agent target exists in the workspace (clone it) or is documented as external.
- History mode: prefer `NoHistory` plus an explicit context envelope.

**Security and writes**
- MCP tools list `allowedTools`; read-only agents expose no write operations.
- `AlwaysApprove` only after an allowlist.
- Write-capable agents have preview-and-confirm language in their instructions (GitHub
  Copilot harness) or a `Question`/card confirmation (standard harness).
- No secrets, tenant ids or personal data in instructions or knowledge descriptions.

**User experience**
- Agents that call tools or other agents announce waits.
- Instructions hold hard rules as a numbered list.
- Greeting and conversation starters match the routes that actually exist.

**Skills (GitHub Copilot harness)**
- `skill.mcs.yml` description matches the `SKILL.md` front matter description.
- The same skill copied into several agents is a sign it belongs in one domain agent.

## 3. Report format

Return a table: `Severity | Agent | File | Issue | Fix`. Severity is Error (blocks push),
Warning (fix before publish) or Info. Then give a patch for each fix you can make safely in
YAML (descriptions, instructions, history mode, allowlists). For changes that need the portal
(new tools, connections, connected agents), say exactly which portal step to take and to pull
afterwards.

## 4. Verify

After edits: lint again, then follow the `cps-lifecycle` skill (push → publish → test). A
review is not complete until the changed routes were exercised in the test pane and the
activity map shows the expected topic, tool or agent firing.
