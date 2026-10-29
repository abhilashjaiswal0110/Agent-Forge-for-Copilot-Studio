import { readText } from './workspace';
import type { AgentModel, Component, Finding, RuleInfo, Severity, WorkspaceModel } from './model';

export const RULES: RuleInfo[] = [
  { id: 'YAML001', title: 'YAML parse error', severity: 'error', harness: 'any', rationale: 'Files that do not parse will not sync or render in Copilot Studio.' },
  { id: 'HARN001', title: 'Mixed harness shapes', severity: 'error', harness: 'any', rationale: 'Standard (topics/actions) and GitHub Copilot harness (behaviors/capabilities) shapes must never be mixed in one agent folder.' },
  { id: 'MA001', title: 'Nested connected agents', severity: 'error', harness: 'any', rationale: 'Multi-agent depth is 1: a connected agent that itself delegates to another connected agent fails at runtime even if the portal allows the wiring. Use hub-and-spoke from one orchestrator.' },
  { id: 'MA002', title: 'Connected agent not in workspace', severity: 'info', harness: ['githubCopilot'], rationale: 'Clone every agent of the solution side by side so the architecture can be validated end to end.' },
  { id: 'MA003', title: 'Connected agent shares full history', severity: 'info', harness: ['githubCopilot'], rationale: 'Domain agents usually need a compact context envelope, not the whole conversation. Prefer passing a structured envelope and confirm the history mode is intentional.' },
  { id: 'DESC001', title: 'Missing description', severity: 'warning', harness: 'any', rationale: 'The orchestrator routes by description. A component without one is effectively invisible or mis-routed.' },
  { id: 'DESC002', title: 'Description is a label, not a trigger', severity: 'info', harness: 'any', rationale: 'Write descriptions as trigger conditions: what it does + "use when the user asks ...".' },
  { id: 'DESC003', title: 'Duplicate descriptions', severity: 'warning', harness: 'any', rationale: 'Two components with the same description compete for the same request. Tighten both or merge them.' },
  { id: 'SEC001', title: 'MCP tool exposes all operations', severity: 'warning', harness: ['githubCopilot'], rationale: 'Restrict MCP tools to the operations the agent needs with an allowedTools list. Read-only agents should never expose write operations.' },
  { id: 'SEC002', title: 'Auto-approve without allowlist', severity: 'warning', harness: ['githubCopilot'], rationale: 'Switch write operations off (allowlist) before using AlwaysApprove, otherwise writes can run without a human decision.' },
  { id: 'HITL001', title: 'Write capability without confirmation protocol', severity: 'warning', harness: 'any', rationale: 'Anything that leaves the conversation (send, create, update, delete) needs draft -> preview -> explicit yes -> execute once.' },
  { id: 'UX001', title: 'No waiting message guidance', severity: 'info', harness: ['githubCopilot'], rationale: 'Announce slow tool calls and delegations before making them; silent multi-second gaps read as a broken agent.' },
  { id: 'SKL001', title: 'Skill description drift', severity: 'warning', harness: ['githubCopilot'], rationale: 'The SKILL.md front matter and skill.mcs.yml description should match so routing and documentation agree.' },
  { id: 'DRY001', title: 'Duplicated skill content', severity: 'info', harness: ['githubCopilot'], rationale: 'The same skill copied into many agents drifts over time. Keep one canonical source and sync copies deliberately.' },
  { id: 'FMT001', title: 'Name too long', severity: 'error', harness: 'any', rationale: 'Component and schema names are limited to 100 characters.' },
  { id: 'FMT002', title: 'Colon-space in knowledge description', severity: 'warning', harness: 'any', rationale: 'Knowledge descriptions containing ": " are a known source of sync and rendering problems; rephrase without colon-space.' }
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

const WRITE_VERBS = /\b(create|update|delete|remove|send|post|reply|forward|upload|write|patch|insert|add|set|assign|approve|move|share)/i;
const CONFIRM_LANGUAGE = /(confirm|explicit (yes|approval)|approval|preview|human[- ]in[- ]the[- ]loop|do not (execute|send) until)/i;
const WAIT_LANGUAGE = /(wait|moment|this (may|can|will) take|one moment|working on it|please hold|stand by)/i;
const TRIGGER_LANGUAGE = /(use (this )?when|use for|when the user|if the user|invoke when|call when|trigger)/i;

export interface LintOptions {
  disabledRules?: string[];
}

function lineOf(file: string, pattern: RegExp): number {
  try {
    const lines = readText(file).split(/\r?\n/);
    const idx = lines.findIndex((l) => pattern.test(l));
    return idx < 0 ? 0 : idx;
  } catch {
    return 0;
  }
}

class Collector {
  readonly findings: Finding[] = [];
  constructor(private readonly disabled: Set<string>) {}
  add(ruleId: string, message: string, file: string, line = 0, agent?: string, severity?: Severity) {
    if (this.disabled.has(ruleId)) return;
    const rule = RULE_BY_ID.get(ruleId);
    this.findings.push({ ruleId, severity: severity ?? rule?.severity ?? 'warning', message, file, line, agent });
  }
}

function isWriteCapable(c: Component): boolean {
  if (c.category === 'action') return WRITE_VERBS.test(`${c.name} ${c.description ?? ''}`);
  if (c.category !== 'tool' || c.kind === 'ConnectedAgentTool') return false;
  if (c.allowedTools) return c.allowedTools.some((t) => WRITE_VERBS.test(t));
  return c.kind === 'McpTool' || WRITE_VERBS.test(c.name);
}

function lintAgent(agent: AgentModel, all: AgentModel[], out: Collector) {
  const anchor = agent.settingsFile ?? agent.agentFile ?? agent.root;

  if (agent.harness === 'mixed') {
    out.add('HARN001', `Agent "${agent.name}" mixes harness shapes (${agent.harnessEvidence.join(', ')}).`, anchor, 0, agent.name);
  }

  if (agent.schemaName && agent.schemaName.length > 100) {
    out.add('FMT001', `Schema name is ${agent.schemaName.length} characters (max 100).`, anchor, lineOf(anchor, /schemaName:/), agent.name);
  }

  const routable = agent.components.filter((c) => c.routable);
  const byDescription = new Map<string, Component[]>();

  for (const c of routable) {
    const descLine = () => lineOf(c.file, /(description|modelDescription):/);
    if (!c.description) {
      out.add('DESC001', `${c.category} "${c.name}" has no description; the orchestrator cannot route to it reliably.`, c.file, 0, agent.name);
    } else {
      if (c.category !== 'knowledge' && (c.description.length < 40 || !TRIGGER_LANGUAGE.test(c.description))) {
        out.add('DESC002', `Description of ${c.category} "${c.name}" reads like a label. State what it does and "use when ...".`, c.file, descLine(), agent.name);
      }
      const key = c.description.trim().toLowerCase();
      byDescription.set(key, [...(byDescription.get(key) ?? []), c]);
      if (c.category === 'knowledge' && c.description.includes(': ')) {
        out.add('FMT002', `Knowledge description of "${c.name}" contains ": ".`, c.file, descLine(), agent.name);
      }
    }
    for (const n of [c.name, c.schemaName]) {
      if (n && n.length > 100) out.add('FMT001', `Name "${n.slice(0, 40)}..." is ${n.length} characters (max 100).`, c.file, 0, agent.name);
    }
  }
  for (const group of byDescription.values()) {
    if (group.length > 1) {
      for (const c of group) {
        const others = group.filter((g) => g !== c).map((g) => g.name).join(', ');
        out.add('DESC003', `"${c.name}" has the same description as: ${others}.`, c.file, lineOf(c.file, /description:/), agent.name);
      }
    }
  }

  for (const c of agent.components.filter((x) => x.category === 'tool')) {
    if (c.kind === 'McpTool') {
      if (!c.allowedTools || c.allowedTools.length === 0) {
        out.add('SEC001', `MCP tool "${c.name}" has no allowedTools list; every server operation is exposed.`, c.file, lineOf(c.file, /^kind:/), agent.name);
        if (c.toolPermissionMode === 'AlwaysApprove') {
          out.add('SEC002', `MCP tool "${c.name}" uses AlwaysApprove without an allowlist.`, c.file, lineOf(c.file, /toolPermissionMode:/), agent.name);
        }
      }
    }
    if (c.kind === 'ConnectedAgentTool') {
      const target = all.find((a) => a.schemaName && a.schemaName === c.targetAgentSchema);
      if (!target) {
        out.add('MA002', `Connected agent "${c.targetAgentSchema ?? c.name}" is not cloned in this workspace; architecture checks are partial.`, c.file, lineOf(c.file, /botSchemaName:/), agent.name);
      } else {
        const nested = target.components.filter((t) => t.kind === 'ConnectedAgentTool');
        if (nested.length) {
          out.add('MA001', `"${agent.name}" delegates to "${target.name}", which itself delegates to ${nested.map((n) => n.targetAgentSchema ?? n.name).join(', ')}. Nested connected agents fail at runtime.`, c.file, lineOf(c.file, /botSchemaName:/), agent.name);
        }
      }
      if (c.historyType === 'ConversationHistory') {
        out.add('MA003', `Connected agent "${c.name}" receives the full conversation history.`, c.file, lineOf(c.file, /historyType:/), agent.name);
      }
    }
  }

  const writers = agent.components.filter(isWriteCapable);
  if (writers.length && !CONFIRM_LANGUAGE.test(agent.instructions)) {
    out.add('HITL001', `Agent "${agent.name}" can write (${writers.slice(0, 3).map((w) => w.name).join(', ')}${writers.length > 3 ? ', ...' : ''}) but its instructions have no confirmation protocol.`, anchor, lineOf(anchor, /instructions:/), agent.name);
  }

  const slow = agent.components.some((c) => c.category === 'tool' && (c.kind === 'ConnectedAgentTool' || c.kind === 'McpTool' || c.kind === 'WorkflowTool'));
  if (agent.harness === 'githubCopilot' && slow && agent.instructions && !WAIT_LANGUAGE.test(agent.instructions)) {
    out.add('UX001', `Agent "${agent.name}" calls tools/agents but its instructions never tell users to wait.`, anchor, lineOf(anchor, /instructions:/), agent.name);
  }

  for (const s of agent.components.filter((c) => c.category === 'skill')) {
    if (s.skillMdDescription && s.description && s.skillMdDescription.trim() !== s.description.trim()) {
      out.add('SKL001', `Skill "${s.name}": SKILL.md description differs from skill.mcs.yml.`, s.file, lineOf(s.file, /description:/), agent.name);
    }
  }
}

export function lint(ws: WorkspaceModel, options: LintOptions = {}): Finding[] {
  const out = new Collector(new Set(options.disabledRules ?? []));
  for (const e of ws.parseErrors) out.add('YAML001', e.message, e.file, e.line ?? 0);
  for (const a of ws.agents) lintAgent(a, ws.agents, out);

  const skillGroups = new Map<string, Component[]>();
  for (const a of ws.agents) {
    for (const s of a.components.filter((c) => c.category === 'skill' && c.contentHash)) {
      skillGroups.set(s.contentHash!, [...(skillGroups.get(s.contentHash!) ?? []), s]);
    }
  }
  for (const group of skillGroups.values()) {
    if (group.length > 2) {
      const first = group[0];
      out.add('DRY001', `Skill "${first.name}" is copied verbatim into ${group.length} agents; keep one canonical source.`, first.skillMdFile ?? first.file, 0);
    }
  }
  return out.findings;
}
