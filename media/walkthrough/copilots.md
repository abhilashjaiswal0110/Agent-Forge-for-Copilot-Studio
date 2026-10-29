## Add expert skills and co-pilots

- **Install Copilot Studio Skills** copies orchestrator-architecture, agent-review and
  lifecycle skills into `.github/skills`, and the browser recipes into `.github/prompts`.
- **Configure Agent Forge MCP Server** lets any MCP client lint, inventory, diagram, plan
  blueprints and check evaluation files (read-only, offline).
- **Configure Browser Co-pilot** adds Playwright MCP limited to Copilot Studio and Power
  Platform hosts, with an isolated browser profile by default.
- **Run Browser Recipe** hands a portal recipe (add an MCP tool, capture a test trace, provision
  a SharePoint list, import a test set, verify a publish) to Copilot agent mode after your
  consent. Recipes stop and ask before anything is saved, published or deleted.
- **Install Guardrail Git Hook** blocks commits that have lint errors.