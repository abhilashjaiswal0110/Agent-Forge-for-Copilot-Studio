---
description: Import an Agent Forge test-set CSV into the Copilot Studio Evaluate tab and start a run, with consent before running.
mode: agent
tools: ['copilot-studio-browser']
---
# Recipe: import and run an evaluation test set

Before you import or run anything, check the file with **Agent Forge: Validate Evaluation CSV**
(or `node dist/cli.js eval validate <file>`). Stop if it has errors.

Rules: stop for user consent before **Import** and before **Run**; if a sign-in page appears, ask
the user to sign in and wait; stay on copilotstudio.microsoft.com and Microsoft sign-in pages.

Ask the user for: agent name, environment, CSV path, and the test method (for example general
quality, compare meaning, keyword match).

1. Open the agent → **Evaluation** → **New evaluation** → **Import** and upload the CSV.
   **Consent gate.**
2. Name the test set after the file and choose the test method and passing score.
3. **Consent gate**, then run the evaluation and wait until it finishes.
4. Export the results as CSV, then tell the user to run **Agent Forge: Analyse Evaluation
   Results** on the downloaded file.