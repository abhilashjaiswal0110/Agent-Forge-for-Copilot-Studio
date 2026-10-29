---
description: Run a question in the Copilot Studio test pane and capture the activity trace (routing, tools, delegations) as evidence. Read-only.
mode: agent
tools: ['copilot-studio-browser']
---
# Recipe: capture a test-pane trace

Read-only recipe. Do not change agent settings. If a sign-in page appears, ask the user to sign
in and wait. Stay on copilotstudio.microsoft.com and the Microsoft sign-in pages.

Ask the user for: agent name, environment, and the questions to test (or a test-set CSV path).

1. Open the agent in https://copilotstudio.microsoft.com and open the **Test** pane. Start a new
   conversation for each question.
2. Turn on the activity map / trace view if it is available.
3. For each question: send it, wait for the reply to finish, then record:
   - which topic, skill, tool or connected agent ran, in order;
   - any tool approval prompts (do **not** approve them; record that one was shown);
   - the final answer (first 300 characters) and the time it took.
4. Take one screenshot per question.
5. Return a Markdown table: question | route taken | approval shown | answer excerpt | seconds.
   Flag rows where the route does not match the expected agent.