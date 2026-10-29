## Ship with safety gates

Right-click an agent in the **Agent Forge** view:

1. **Pull** merges the server state into your files (`pac copilot pull`).
2. **Push Agent as Draft** uploads local changes (`pac copilot push`), blocked on lint errors.
3. **Publish Agent** makes the draft live (`pac copilot publish`); you type the agent name to confirm.

Every step checks that your Power Platform CLI supports it, takes a snapshot first and
appends to `release-evidence.jsonl`. Lifecycle commands need a trusted workspace.
