# Agent Forge for Copilot Studio – product plan

Status: **private preview** (v0.1.0). This is the public-safe roadmap; it contains no
customer or solution-specific content.

## 1. Name

| Option | Notes |
|---|---|
| **Agent Forge for Copilot Studio** (chosen, id `cps-agent-forge`) | Short, memorable, no Marketplace collision found; "for Copilot Studio" is a descriptor, not a claim of affiliation. |
| Copilot Studio Orchestrator Kit | Strong SEO for "orchestrator", narrower scope. |
| Multi-Agent Studio for CPS | Clear benefit, but "Studio" may be confused with the official product. |

Do not use Microsoft logos or "Microsoft" in the name.

## 2. Decisions

| Topic | Decision |
|---|---|
| Publisher | `abhilashjaiswal0110` (create the Marketplace publisher with this id before the first upload) |
| Visibility | Private repository and `private: true` until GA readiness, then MIT and public |
| Harnesses | Standard and GitHub Copilot (new agent experience), both first-class |
| Browser co-pilot | Playwright MCP with an **isolated** profile by default; signed-in browser via `--extension` only by explicit setting |
| Telemetry | On, usage events only, honours VS Code telemetry settings, no content |
| Team | Single maintainer; automation-first (CI, lint gate, packaged VSIX artefacts) |

## 3. Positioning

*Design, lint, visualise and ship enterprise multi-agent orchestrators on Copilot Studio from
VS Code, with proven patterns built in.*

Differentiators against existing Copilot Studio extensions:

1. **Architecture graph and policy linter** for both harnesses (depth-1 delegation, single
   write agent, allowlists before auto-approve, descriptions as triggers, wait UX).
2. **Expert pack**: skills and custom agents that work in Copilot Chat, Copilot CLI and other
   Agent Plugin hosts.
3. **Lifecycle with safety gates**: pull → lint → push → publish → re-pull, with snapshots and
   release evidence.
4. **Browser co-pilot** for portal-only steps and test-pane checks through Playwright MCP.
5. **Orchestrator blueprints** and **eval studio** (planned).
6. **Enterprise ALM**: environment profiles, solution packaging and CI policy enforcement (planned).

## 4. Clean-room rules

1. Practices are rewritten from scratch; no private file is ever copied in.
2. Samples use the fictional Contoso domain only.
3. `npm run scan` (and CI) fails on GUIDs, tenant hosts, emails and private patterns kept outside
   the repo (`.denylist.local` locally, `DENYLIST_PATTERNS` secret in CI).
4. Private solutions may be used as local test fixtures; their output is never committed.

## 5. Phases

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0. Foundations | Repo, CI, deny-list gate, core parser for both layouts, Contoso sample | Large private fixture parses with 0 errors | **Done** |
| 1. See & Lint | Agent explorer, architecture graph, 16 rules → 25, quick fixes, Agent Plugin v1, walkthrough | Lint finds seeded issues; sample is clean | **In progress** (explorer, graph, 16 rules, plugin v1 done) |
| 2. Ship | pac pull/push/publish, snapshots, release evidence, environment profiles, MCP server v1 | End-to-end round trip in a dev environment | **Started** (pull/push/publish, snapshots, evidence done) |
| 3. Build | Orchestrator blueprint wizard, instruction and HITL templates, guardrail hooks | New user builds 1 orchestrator + 3 spokes + 1 write agent in < 60 min | Planned |
| 4. Prove | Eval studio: CSV generator and validator, results analyser, failure triage | Generated CSVs import cleanly | Planned |
| 5. Browser co-pilot | Portal recipes (add tool, test-pane trace capture, list provisioning) | Recipes run with consent prompts | **Started** (MCP config + tester agent) |
| 6. GA | Hardening, docs site, accessibility, public MIT release, Open VSX | Quality bar met | Planned |

## 6. Quality bar

- Lazy activation; VSIX under 5 MB; works offline for lint and graph.
- Every rule has an id, rationale, harness applicability, docs entry and a test fixture.
- No network calls without user action (telemetry aside, which honours VS Code settings).
- Deny-list gate green on every commit.

## 7. Go-to-market (at public launch)

- Listing SEO: "Copilot Studio", "multi-agent", "orchestrator", "agents", "Power Platform";
  hero GIF, feature table, 60-second quick start.
- Distribution: VS Code Marketplace, Open VSX, Agent Plugin marketplace, MCP server on npm.
- Content: "orchestrator from zero" video, blog series (patterns, HITL, evals), sample gallery.
- Community: Power Platform community forums and calls, MVPs, user groups, conferences.
- Product-led growth: walkthrough, Mermaid export, README lint badge.
- KPIs: installs, 30-day active users, first successful publish, rating ≥ 4.5.
  Targets: 5K installs in 6 months, 25K in 12 months.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Copilot Studio YAML or harness changes | Schema knowledge isolated in `src/core`; rules tagged by harness; fast releases |
| Overlap with Microsoft tooling | Complement it: architecture, governance, evals, release; defer to official editors |
| pac CLI changes | Pure argument builder with tests; version checks; manual fallback |
| Brittle portal automation | Optional browser recipes; CLI preferred |
| Leaking private content | Clean-room rules and deny-list gate |
