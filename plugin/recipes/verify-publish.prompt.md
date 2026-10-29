---
description: After publishing, confirm in the portal that the agent has no pending changes and answers in the test pane. Read-only.
mode: agent
tools: ['copilot-studio-browser']
---
# Recipe: verify a publish

Read-only. Do not publish, save or change settings. If a sign-in page appears, ask the user to
sign in and wait.

1. Open the agent in https://copilotstudio.microsoft.com.
2. Record the last published time and whether the portal shows unpublished changes.
3. In the **Test** pane, start a new conversation and send "What can you help me with?".
4. Record the reply (first 300 characters) and any error banner.
5. Report: published time, pending changes yes/no, test reply, errors. Recommend
   **Agent Forge: Pull Agent** if the portal shows changes that are not in the local files.