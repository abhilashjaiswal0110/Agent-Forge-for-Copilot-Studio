# Agent Forge for Copilot Studio – product plan

Status: **private preview** (v0.2.0). This is the public-safe roadmap; it contains no
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
| Publisher | `AbhilashJaiswal` (Marketplace publisher created; set in `package.json`) |
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
| 1. See & Lint | Agent explorer, architecture graph, 16 rules → 25, quick fixes, Agent Plugin v1, walkthrough | Lint finds seeded issues; sample is clean | **Done** (v0.2.0) |
| 2. Ship | pac pull/push/publish, snapshots, release evidence, MCP server v1 | End-to-end round trip in a dev environment | **Done** (v0.3.0; exit test passed twice against a dev environment with pac 2.14.1; environment profiles moved to Phase 6) |
| 3. Build | Orchestrator blueprint wizard, instruction and HITL templates, guardrail hooks | New user builds 1 orchestrator + 3 spokes + 1 write agent in < 60 min | **Done** (v0.3.0: wizard with files-only and live `pac copilot init` modes, snippets, git hook; generated agents lint clean and push and publish in the exit test) |
| 4. Prove | Eval studio: CSV generator and validator, results analyser, failure triage | Generated CSVs import cleanly | **Done** (v0.3.0: generator, validator against the documented import rules, analyser with six triage categories) |
| 5. Browser co-pilot | Portal recipes (add tool, test-pane trace capture, list provisioning) | Recipes run with consent prompts | **Done** (v0.3.0: five recipes with consent gates, Run Browser Recipe command, installed as prompt files) |
| 6. GA | Hardening, environment profiles, docs site, accessibility, public MIT release, Open VSX | Quality bar met | Planned |

## 6. Quality bar

- Lazy activation; VSIX under 5 MB; works offline for lint and graph.
- Every rule has an id, rationale, harness applicability, docs entry and a test fixture.
- No network calls without user action (telemetry aside, which honours VS Code settings).
- Deny-list gate green on every commit.
- The packaged VSIX passes the integration suite (`npm run test:integration`) in a clean VS Code.

### Phase 2 exit test: dev-environment round trip

Automated as an opt-in test (`npm run test:e2e` with `AGENT_FORGE_E2E_ENV` set; see
CONTRIBUTING.md). It uses only scratch agents:

1. Check that `pac copilot help` lists `pull`, `push` and `publish` (pac 2.4.1 did not; 2.14.1 does).
2. Create a hub and a spoke with `pac copilot init --authoring-mode cli-copilot --environment`.
3. Apply an Agent Forge blueprint (instructions, connected-agent tool, triage skill); lint must
   have no errors or warnings.
4. For the spoke, then the hub: pull → push → publish → pull, all with exit code 0, using the
   same `pac` arguments as the extension.
5. Delete both agents (hub first; a referenced spoke cannot be deleted) and their solutions.

Result (2026-10-29, pac 2.14.1, dev environment): passed twice (254 s and 322 s), no scratch
agents or solutions left behind. Findings fixed on the way: delete order, solution cleanup, and
`StaticSegment` instructions being read as text (INST001 never fired on real agents).

Not automated: the portal-side conflict check (edit the same item in the portal and locally,
then push, and expect "pull first"). Run it manually once per pac major version.

## 7. Next steps

1. Environment profiles (dev/test/prod mapping per agent folder) with a production guard.
2. Publish the CLI and MCP server to npm so CI does not need the extension folder.
3. Parser tolerance: portal-generated Power Fx values such as `text: ="... : ..."` are invalid
   strict YAML and raise YAML001; decide whether to accept them with a dedicated info rule.
4. Upgrade dev tooling majors (vitest 3+, esbuild 0.25+) to clear dev-only audit advisories.
5. Public launch tasks in section 8: hero GIF, docs site, MIT licence, Open VSX.
## 8. Go-to-market (at public launch)

- Listing SEO: "Copilot Studio", "multi-agent", "orchestrator", "agents", "Power Platform";
  hero GIF, feature table, 60-second quick start.
- Distribution: VS Code Marketplace, Open VSX, Agent Plugin marketplace, MCP server on npm.
- Content: "orchestrator from zero" video, blog series (patterns, HITL, evals), sample gallery.
- Community: Power Platform community forums and calls, MVPs, user groups, conferences.
- Product-led growth: walkthrough, Mermaid export, README lint badge.
- KPIs: installs, 30-day active users, first successful publish, rating ≥ 4.5.
  Targets: 5K installs in 6 months, 25K in 12 months.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Copilot Studio YAML or harness changes | Schema knowledge isolated in `src/core`; rules tagged by harness; fast releases |
| Overlap with Microsoft tooling | Complement it: architecture, governance, evals, release; defer to official editors |
| pac CLI changes | Pure argument builder with tests; version checks; manual fallback |
| Brittle portal automation | Optional browser recipes; CLI preferred |
| Leaking private content | Clean-room rules and deny-list gate |
