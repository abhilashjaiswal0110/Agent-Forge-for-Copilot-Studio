## Design a new orchestrator

**New Orchestrator Blueprint** asks for a publisher prefix, an orchestrator, read-only domain
agents and an optional write agent, then generates:

- an orchestrator with routing, context-envelope, waiting and confirmation rules, a connected
  agent tool per domain agent (no shared history) and a triage skill;
- read-only domain agents that answer as *DOMAIN REVIEW* or *EVIDENCE NEEDED*;
- one write agent limited to the operations you list, with the confirmation protocol;
- `BLUEPRINT.md` with a Mermaid diagram and next steps.

Choose **Create files only** to review and lint first, or let Agent Forge create the agents in a
dev environment with `pac copilot init --environment` (needs workspace trust and confirmation).
Push the domain agents first, then the orchestrator.