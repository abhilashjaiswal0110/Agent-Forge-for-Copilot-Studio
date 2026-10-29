---
description: Create a SharePoint list for an agent (for example a request log) with named columns, with consent before creating anything.
mode: agent
tools: ['copilot-studio-browser']
---
# Recipe: provision a SharePoint list

This recipe creates content. Before each create or save, stop, show exactly what will be created
and wait for the user to reply "yes". Never change site permissions. If a sign-in page appears,
ask the user to sign in and wait.

Ask the user for: site URL, list name, and columns (name, type, required). Suggest a minimal
schema when they are unsure (Title, Status choice, Requested by person, Details multi-line text).

1. Open the site and check that a list with that name does not exist. If it does, stop and ask.
2. **Consent gate.** Show the list name and column table.
3. Create a blank list, then add each column with its type and required flag.
4. Open the list settings and take a snapshot that shows the columns.
5. Return the list URL and the column table. Remind the user to add the list as knowledge or a
   tool in Copilot Studio and to keep write access with the single write agent.

Note: the browser co-pilot allows Copilot Studio and Power Platform hosts by default. Add the
SharePoint host to `--allowed-origins` in `.vscode/mcp.json` before running this recipe.