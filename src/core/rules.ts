import { basename } from 'node:path';
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
  { id: 'FMT002', title: 'Colon-space in knowledge description', severity: 'warning', harness: 'any', rationale: 'Knowledge descriptions containing ": " are a known source of sync and rendering problems; rephrase without colon-space.' },
  { id: 'INST001', title: 'Missing instructions', severity: 'warning', harness: 'any', rationale: 'Without instructions the orchestrator has no role, scope or rules, so routing and tone are left to defaults.' },
  { id: 'INST002', title: 'Instructions too long', severity: 'warning', harness: 'any', rationale: 'Copilot Studio caps agent instructions at 8,000 characters. Move procedures into skills, topics or knowledge and keep instructions to role, scope and hard rules.' },
  { id: 'MA004', title: 'More than one write agent', severity: 'info', harness: 'any', rationale: 'Keep a single connected agent that changes data so confirmations, audit and permissions live in one place; domain agents stay read-only.' },
  { id: 'SEC003', title: 'Hard-coded secret', severity: 'error', harness: 'any', rationale: 'Keys, passwords, tokens and SAS signatures in agent files end up in source control and solution exports. Use connections, environment variables or Key Vault.' },
  { id: 'SEC004', title: 'Insecure http URL', severity: 'warning', harness: 'any', rationale: 'Knowledge sources, tools and links should use https; plain http is blocked or downgraded in most tenants and exposes traffic.' },
  { id: 'HITL002', title: 'Auto-approved write operations', severity: 'warning', harness: ['githubCopilot'], rationale: 'An allowlist that still contains write operations should not use AlwaysApprove; ask the user before each write.' },
  { id: 'SKL002', title: 'Skill without SKILL.md', severity: 'warning', harness: ['githubCopilot'], rationale: 'A skill folder needs SKILL.md with name and description front matter; without it the skill has no body to load.' },
  { id: 'TOP001', title: 'Redirect to missing topic', severity: 'warning', harness: ['standard'], rationale: 'A BeginDialog node that targets a topic not present in the agent fails at runtime; the conversation ends with a system error.' },
  { id: 'FMT003', title: 'Description too long', severity: 'info', harness: 'any', rationale: 'Descriptions over 1,024 characters dilute routing and may be truncated. Keep them to what it does plus when to use it.' }
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

const WRITE_VERBS = /\b(create|update|delete|remove|send|post|reply|forward|upload|write|patch|insert|add|set|assign|approve|move|share)/i;
const CONFIRM_LANGUAGE = /(confirm|explicit (yes|approval)|approval|preview|human[- ]in[- ]the[- ]loop|do not (execute|send) until)/i;
const WAIT_LANGUAGE = /(wait|moment|this (may|can|will) take|one moment|working on it|please hold|stand by)/i;
const TRIGGER_LANGUAGE = /(use (this )?when|use for|when the user|if the user|invoke when|call when|trigger)/i;

export const MAX_INSTRUCTIONS = 8000;
export const MAX_DESCRIPTION = 1024;

const SECRET_KEY = /\b(api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|pwd|access[_-]?token|auth[_-]?token|subscription[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"'#,;]+)/i;
const SECRET_LITERALS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}/,
  /[?&]sig=[A-Za-z0-9%+/=]{20,}/i,
  /\bAccountKey=[A-Za-z0-9+/=]{20,}/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const HTTP_URL = /\bhttp:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])([^\s"'<>]+)/i;
const HTTP_ALLOWED_HOSTS = /^(adaptivecards\.io|schema\.org|www\.w3\.org|schemas\.)/i;

/** True when a line holds something that looks like a literal credential, not a reference or placeholder. */
export function looksLikeSecret(line: string): boolean {
  if (SECRET_LITERALS.some((r) => r.test(line))) return true;
  const m = SECRET_KEY.exec(line);
  if (!m) return false;
  const value = m[2];
  if (value.length < 12 || /^(=|\$|\{|<|%|https?:|Env\.|Global\.|Topic\.|System\.)/i.test(value)) return false;
  return /\d/.test(value) && /[A-Za-z]/.test(value);
}

export function insecureUrl(line: string): string | undefined {
  const m = HTTP_URL.exec(line);
  return m && !HTTP_ALLOWED_HOSTS.test(m[1]) ? m[0] : undefined;
}

/** Files that belong to an agent and are worth scanning line by line. */
export function agentFiles(agent: AgentModel): string[] {
  const files = new Set<string>();
  for (const f of [agent.settingsFile, agent.agentFile]) if (f) files.add(f);
  for (const c of agent.components) {
    if (c.category !== 'connection') files.add(c.file);
    if (c.skillMdFile) files.add(c.skillMdFile);
  }
  return [...files];
}

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
      if (c.description.length > MAX_DESCRIPTION) {
        out.add('FMT003', `Description of ${c.category} "${c.name}" is ${c.description.length} characters (keep under ${MAX_DESCRIPTION}).`, c.file, descLine(), agent.name);
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
      } else if (c.toolPermissionMode === 'AlwaysApprove') {
        const writes = c.allowedTools.filter((t) => WRITE_VERBS.test(t));
        if (writes.length) {
          out.add('HITL002', `MCP tool "${c.name}" auto-approves write operations (${writes.slice(0, 3).join(', ')}${writes.length > 3 ? ', ...' : ''}).`, c.file, lineOf(c.file, /toolPermissionMode:/), agent.name);
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
    if (!s.skillMdFile) {
      out.add('SKL002', `Skill "${s.name}" has no SKILL.md next to skill.mcs.yml.`, s.file, 0, agent.name);
    }
  }

  if (!agent.instructions.trim()) {
    if (agent.harness !== 'unknown') out.add('INST001', `Agent "${agent.name}" has no instructions.`, anchor, lineOf(anchor, /instructions:/), agent.name);
  } else if (agent.instructions.length > MAX_INSTRUCTIONS) {
    const file = agent.harness === 'standard' && agent.agentFile ? agent.agentFile : anchor;
    out.add('INST002', `Instructions of "${agent.name}" are ${agent.instructions.length} characters (max ${MAX_INSTRUCTIONS}).`, file, lineOf(file, /instructions:/), agent.name);
  }

  const spokes = agent.components
    .filter((c) => c.kind === 'ConnectedAgentTool')
    .map((c) => ({ tool: c, target: all.find((a) => a.schemaName && a.schemaName === c.targetAgentSchema) }))
    .filter((s) => s.target && s.target.components.some(isWriteCapable));
  if (spokes.length > 1) {
    const names = spokes.map((s) => s.target!.name).join(', ');
    out.add('MA004', `"${agent.name}" delegates to ${spokes.length} write-capable agents (${names}); keep one write agent and make the others read-only.`, anchor, 0, agent.name);
  }

  if (agent.harness === 'standard') {
    const topics = new Set(agent.components.filter((c) => c.category === 'topic').map((c) => basename(c.file).replace(/\.mcs\.yml$|\.ya?ml$/i, '').toLowerCase()));
    const prefix = agent.schemaName ? `${agent.schemaName}.topic.`.toLowerCase() : undefined;
    for (const t of agent.components.filter((c) => c.dialogRefs?.length)) {
      for (const ref of new Set(t.dialogRefs)) {
        if (prefix && ref.toLowerCase().startsWith(prefix) && !topics.has(ref.slice(prefix.length).toLowerCase())) {
          out.add('TOP001', `Topic "${t.name}" redirects to "${ref}", which is not in this agent.`, t.file, lineOf(t.file, new RegExp(escapeRegExp(ref))), agent.name);
        }
      }
    }
  }

  for (const file of agentFiles(agent)) {
    let lines: string[];
    try {
      lines = readText(file).split(/\r?\n/);
    } catch {
      continue;
    }
    lines.forEach((text, i) => {
      // The secret itself is never echoed into the message.
      if (looksLikeSecret(text)) out.add('SEC003', 'Line looks like a hard-coded credential. Move it to a connection, environment variable or Key Vault.', file, i, agent.name);
      const url = insecureUrl(text);
      if (url) out.add('SEC004', `Insecure URL ${url.length > 60 ? url.slice(0, 60) + '...' : url}; use https.`, file, i, agent.name);
    });
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
