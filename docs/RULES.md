# Lint rules

Agent Forge lints Copilot Studio agent folders for both harnesses. Findings show in the
Problems panel with source **Agent Forge** and the rule id as code. Disable rules with the
`agentForge.lint.disabledRules` setting, for example `["DESC002"]`.

Errors block **Push** and **Publish** unless you explicitly override.

| Id | Severity | Harness | Title | Why it matters |
|---|---|---|---|---|
| YAML001 | Error | Any | YAML parse error | Files that do not parse will not sync or render in Copilot Studio. |
| HARN001 | Error | Any | Mixed harness shapes | Standard (`topics/`, `actions/`) and GitHub Copilot harness (`behaviors/`, `capabilities/`) shapes must never be mixed in one agent folder. |
| MA001 | Error | Any | Nested connected agents | Multi-agent depth is 1. A connected agent that delegates to another connected agent fails at runtime even if the portal allows the wiring. Use hub-and-spoke from one orchestrator. |
| MA002 | Info | GitHub Copilot | Connected agent not in workspace | Clone every agent of the solution side by side so the architecture can be validated end to end. |
| MA003 | Info | GitHub Copilot | Connected agent shares full history | Domain agents usually need a compact context envelope, not the whole conversation. Confirm the history mode is intentional. |
| DESC001 | Warning | Any | Missing description | The orchestrator routes by description. A component without one is invisible or mis-routed. |
| DESC002 | Info | Any | Description is a label, not a trigger | Write descriptions as trigger conditions: what it does plus "use when the user asks …". |
| DESC003 | Warning | Any | Duplicate descriptions | Two components with the same description compete for the same request. Tighten both or merge them. |
| SEC001 | Warning | GitHub Copilot | MCP tool exposes all operations | Restrict MCP tools with an `allowedTools` list. Read-only agents should never expose write operations. |
| SEC002 | Warning | GitHub Copilot | Auto-approve without allowlist | Switch write operations off (allowlist) before using `AlwaysApprove`. |
| HITL001 | Warning | Any | Write capability without confirmation protocol | Anything that leaves the conversation needs draft → preview → explicit yes → execute once. |
| UX001 | Info | GitHub Copilot | No waiting message guidance | Announce slow tool calls and delegations first; silent gaps read as a broken agent. |
| SKL001 | Warning | GitHub Copilot | Skill description drift | `SKILL.md` front matter and `skill.mcs.yml` description should match. |
| DRY001 | Info | GitHub Copilot | Duplicated skill content | The same skill copied into many agents drifts. Keep one canonical source. |
| FMT001 | Error | Any | Name too long | Component and schema names are limited to 100 characters. |
| FMT002 | Warning | Any | Colon-space in knowledge description | Knowledge descriptions containing `: ` are a known source of sync and rendering problems. |

## Heuristics

- **Write capability** (HITL001): an MCP tool, or a tool whose name contains a write verb
  (create, update, delete, send, post, …). The agent passes when its instructions contain
  confirmation language such as "confirm", "approval", "preview" or "human in the loop".
- **Trigger language** (DESC002): descriptions shorter than 40 characters, or without phrases
  such as "use when", "use for", "when the user", "if the user" or "trigger", are flagged.
  Knowledge sources are exempt.
- **Waiting language** (UX001): agents with connected-agent, MCP or workflow tools should
  mention "wait", "one moment", "this may take" or similar in their instructions.
