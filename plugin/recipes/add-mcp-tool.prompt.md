---
description: Add an MCP server tool to a Copilot Studio agent in the portal, restricted to an allowlist, with consent before every save.
mode: agent
tools: ['copilot-studio-browser']
---
# Recipe: add an MCP tool with an allowlist

Use the `copilot-studio-browser` MCP server (Playwright). Follow these rules throughout:

- **Consent gates.** Before you click anything that saves, publishes, deletes or grants access,
  stop and describe the exact change, then wait for the user to reply "yes".
- Never type passwords or secrets. If a sign-in page appears, ask the user to sign in and wait.
- Stay on copilotstudio.microsoft.com and the Microsoft sign-in pages.

Ask the user for: agent name, environment, MCP server or connector name, and the operations to allow.

1. Open https://copilotstudio.microsoft.com, pick the environment, open the agent.
2. Go to **Tools** → **Add a tool** → **Model Context Protocol** and select the server.
3. Before adding: list the operations the server exposes and show which ones will be allowed.
   Read-only agents get read operations only. **Consent gate.**
4. Turn off every operation not on the allowlist. Set write operations to ask the user before
   running. **Consent gate** before **Save**.
5. Take a snapshot of the tool page and summarise: tool name, allowed operations, approval mode.
6. Tell the user to run **Agent Forge: Pull Agent** so the local files match, then lint.