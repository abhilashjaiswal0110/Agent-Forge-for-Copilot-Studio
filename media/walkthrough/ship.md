## Ship with safety gates

Right-click an agent in the **Agent Forge** view:

1. **Pull** merges the server state into your files (`pac copilot pull`).
2. **Push Agent as Draft** uploads local changes (`pac copilot push`), blocked on lint errors.
3. **Publish Agent** makes the draft live (`pac copilot publish`); you type the agent name to confirm.

Every step checks that your Power Platform CLI supports it, takes a snapshot first and
appends to `release-evidence.jsonl`. Lifecycle commands need a trusted workspace.

**Environment profiles.** Run **Add Environment Profile** on an agent to mark its environment as
dev, test or prod. Production steps then ask you to type the profile name, or are blocked with
`agentForge.productionGuard` set to `block`.
