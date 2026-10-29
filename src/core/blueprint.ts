import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { yamlScalar } from './fixes';

/** Orchestrator blueprint: one user-facing orchestrator, read-only domain spokes and at most one write agent. */
export interface BlueprintAgent {
  name: string;
  purpose: string;
}

export interface BlueprintSpec {
  /** Publisher customization prefix, for example "contoso". */
  prefix: string;
  orchestrator: BlueprintAgent;
  spokes: BlueprintAgent[];
  writer?: BlueprintAgent & { operations: string[] };
}

export type AgentRole = 'orchestrator' | 'spoke' | 'writer';

export interface AgentPlan {
  role: AgentRole;
  name: string;
  schemaName: string;
  folder: string;
  instructions: string;
  /** Extra files relative to the agent folder. */
  files: Record<string, string>;
}

export const MAX_SPOKES = 8;

/** Mirrors pac copilot init: {prefix}_{name without non-alphanumerics}. */
export function schemaFor(prefix: string, name: string): string {
  return `${prefix}_${name.replace(/[^A-Za-z0-9]/g, '')}`;
}

export const folderFor = (name: string) => name.trim().replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-');

export function validateSpec(spec: BlueprintSpec): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9]{1,7}$/.test(spec.prefix)) errors.push('Prefix must be 2-8 lowercase letters or digits and start with a letter.');
  const all = [spec.orchestrator, ...spec.spokes, ...(spec.writer ? [spec.writer] : [])];
  for (const a of all) {
    if (!a.name?.trim()) errors.push('Every agent needs a name.');
    else if (!/[A-Za-z0-9]/.test(a.name)) errors.push(`"${a.name}" needs at least one letter or digit.`);
    else if (a.name.length > 60) errors.push(`"${a.name}" is longer than 60 characters.`);
    if (!a.purpose?.trim() || a.purpose.trim().length < 15) errors.push(`Describe what "${a.name || '(unnamed)'}" does in at least 15 characters.`);
  }
  const schemas = all.map((a) => schemaFor(spec.prefix, a.name ?? ''));
  if (new Set(schemas).size !== schemas.length) errors.push('Agent names must be unique (after removing spaces and symbols).');
  if (spec.spokes.length < 1) errors.push('Add at least one domain agent.');
  if (spec.spokes.length > MAX_SPOKES) errors.push(`Use at most ${MAX_SPOKES} domain agents; group related domains instead.`);
  if (spec.writer && !spec.writer.operations.length) errors.push('List the operations the write agent may perform.');
  return errors;
}

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Human-in-the-loop protocol shared by the orchestrator and the write agent. */
export const HITL_PROTOCOL = [
  'For anything that leaves this conversation (create, update, delete, send, approve):',
  '1. Draft the change and show a preview with every field that will be written.',
  '2. Ask for an explicit "yes" and wait for it in the next user message.',
  '3. Execute the change once, then report exactly what the tool confirmed.',
  'Never claim something was saved, sent or changed unless a tool confirmed it.'
].join('\n');

export const WAIT_GUIDANCE = 'Before any delegation or slow tool call, tell the user what you are doing and ask them to wait a moment.';

export const CONTEXT_ENVELOPE = 'When you delegate, pass a context envelope: the user goal, known facts, constraints and open questions. Do not forward the whole conversation.';

export function orchestratorInstructions(spec: BlueprintSpec): string {
  const routes = spec.spokes.map((s, i) => `${i + 1}. ${s.name} - ${sentence(s.purpose)}`);
  if (spec.writer) routes.push(`${routes.length + 1}. ${spec.writer.name} - the only agent that changes data. ${sentence(spec.writer.purpose)}`);
  return [
    `You are ${spec.orchestrator.name}, the single user-facing assistant. ${sentence(spec.orchestrator.purpose)}`,
    'Route each request to the narrowest agent below and never delegate to more than one agent for the same step:',
    ...routes,
    CONTEXT_ENVELOPE,
    WAIT_GUIDANCE,
    'Hard rules:',
    '1. Domain agents are read-only; only the write agent may change anything.',
    spec.writer ? `2. ${HITL_PROTOCOL.split('\n').join(' ')}` : '2. You cannot change data. Explain what the user can do instead.',
    '3. If no agent fits, say so and ask one clarifying question.'
  ].join('\n');
}

export function spokeInstructions(spec: BlueprintSpec, spoke: BlueprintAgent): string {
  return [
    `You are ${spoke.name}, a read-only domain agent called by ${spec.orchestrator.name}. ${sentence(spoke.purpose)}`,
    'Reply in this format:',
    'DOMAIN REVIEW - findings with the evidence (source, record or document) for each.',
    'EVIDENCE NEEDED - what is missing and which question would resolve it.',
    'You never create, update, delete or send anything. Tell the user to wait a moment before long searches.'
  ].join('\n');
}

export function writerInstructions(spec: BlueprintSpec): string {
  const w = spec.writer!;
  return [
    `You are ${w.name}, the only agent that changes data for ${spec.orchestrator.name}. ${sentence(w.purpose)}`,
    `Allowed operations: ${w.operations.join(', ')}. Refuse anything else.`,
    'Execute a change only when the request carries the previewed draft and the user\'s explicit yes confirmation.',
    HITL_PROTOCOL,
    'Tell the user to wait a moment while the change runs.'
  ].join('\n');
}

const connectedTool = (target: AgentPlan, description: string) =>
  [
    'mcs.metadata:',
    `  componentName: ${yamlScalar(target.name)}`,
    `  description: ${yamlScalar(description)}`,
    'kind: ConnectedAgentTool',
    'historyType:',
    '  kind: NoHistory',
    `botSchemaName: ${target.schemaName}`,
    ''
  ].join('\n');

const TRIAGE_DESCRIPTION = 'Classifies a request and picks the narrowest agent. Use when a new request arrives, before any delegation.';

export function planBlueprint(spec: BlueprintSpec): AgentPlan[] {
  const plan = (role: AgentRole, a: BlueprintAgent, instructions: string): AgentPlan => ({
    role,
    name: a.name.trim(),
    schemaName: schemaFor(spec.prefix, a.name),
    folder: folderFor(a.name),
    instructions,
    files: {}
  });
  const spokes = spec.spokes.map((s) => plan('spoke', s, spokeInstructions(spec, s)));
  const writer = spec.writer ? plan('writer', spec.writer, writerInstructions(spec)) : undefined;
  const orch = plan('orchestrator', spec.orchestrator, orchestratorInstructions(spec));

  for (const [i, s] of spokes.entries()) {
    orch.files[`capabilities/tools/${s.folder.toLowerCase()}.mcs.yml`] = connectedTool(
      s,
      `${sentence(spec.spokes[i].purpose)} Read-only. Use when the user asks about ${lowerFirst(s.name)} topics.`
    );
  }
  if (writer) {
    orch.files[`capabilities/tools/${writer.folder.toLowerCase()}.mcs.yml`] = connectedTool(
      writer,
      `Executes approved changes (${spec.writer!.operations.join(', ')}). Use only after the user gave an explicit yes to a previewed draft.`
    );
  }
  orch.files['behaviors/triage/skill.mcs.yml'] = [
    'mcs.metadata:',
    '  componentName: request-triage',
    `  description: ${yamlScalar(TRIAGE_DESCRIPTION)}`,
    'kind: InlineAgentSkill',
    'skillFolderName: triage',
    ''
  ].join('\n');
  orch.files['behaviors/triage/SKILL.md'] = [
    '---',
    'name: request-triage',
    `description: ${yamlScalar(TRIAGE_DESCRIPTION)}`,
    '---',
    '',
    '# Request triage',
    '',
    '1. Restate the user goal in one sentence.',
    `2. Pick exactly one agent: ${[...spokes, ...(writer ? [writer] : [])].map((a) => a.name).join(', ')}.`,
    '3. Build the context envelope (goal, known facts, constraints, open questions).',
    '4. If the request changes data, draft and preview it before involving the write agent.',
    ''
  ].join('\n');
  return [...spokes, ...(writer ? [writer] : []), orch];
}

/** settings.mcs.yml in the shape `pac copilot init --authoring-mode cli-copilot` writes. */
export function settingsYaml(a: AgentPlan): string {
  return [
    `displayName: ${JSON.stringify(a.name)}`,
    `schemaName: ${JSON.stringify(a.schemaName)}`,
    'accessControlPolicy: GroupMembership',
    'authenticationMode: Integrated',
    'authenticationTrigger: Always',
    'configuration:',
    '  authoringModel: CliCopilot',
    '  recognizer:',
    '    kind: CLICopilotRecognizer',
    '  agentSettings:',
    '    instructions:',
    '      segments:',
    '        - kind: StaticSegment',
    '          value: ""',
    'template: cliagent-1.0.0',
    'language: 1033',
    ''
  ].join('\n');
}

/** Sets the instructions of an existing settings.mcs.yml, keeping every other field and comment. */
export function setInstructions(settingsText: string, instructions: string): string {
  const doc = parseDocument(settingsText);
  if (doc.errors.length) throw new Error(`settings.mcs.yml does not parse: ${doc.errors[0].message.split('\n')[0]}`);
  doc.setIn(['configuration', 'agentSettings', 'instructions', 'segments'], doc.createNode([{ kind: 'StaticSegment', value: instructions }]));
  return doc.toString({ lineWidth: 0 });
}

/**
 * Writes one agent of the plan into `root`. Creates settings.mcs.yml and agent.sync.yaml when absent
 * (local design); otherwise only replaces instructions so server-generated fields survive.
 */
export function applyAgentPlan(root: string, a: AgentPlan): string[] {
  const written: string[] = [];
  const write = (rel: string, content: string) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    written.push(full);
  };
  const settings = join(root, 'settings.mcs.yml');
  write('settings.mcs.yml', setInstructions(existsSync(settings) ? readFileSync(settings, 'utf8').replace(/^\uFEFF/, '') : settingsYaml(a), a.instructions));
  if (!existsSync(join(root, 'agent.sync.yaml'))) write('agent.sync.yaml', 'layoutVersion: 1\n');
  for (const [rel, content] of Object.entries(a.files)) write(rel, content);
  return written;
}

export function blueprintReadme(spec: BlueprintSpec, plans: AgentPlan[]): string {
  const orch = plans.find((p) => p.role === 'orchestrator')!;
  const lines = [
    `# ${orch.name} - orchestrator blueprint`,
    '',
    'Generated by Agent Forge. Hub and spoke with delegation depth 1: the orchestrator is the only',
    'agent users talk to; domain agents are read-only; one write agent executes previewed, confirmed changes.',
    '',
    '```mermaid',
    'flowchart LR',
    ...plans.filter((p) => p.role !== 'orchestrator').map((p) => `  ${orch.schemaName} -->|${p.role === 'writer' ? 'approved changes' : 'read-only'}| ${p.schemaName}`),
    '```',
    '',
    '| Agent | Role | Schema name | Folder |',
    '|---|---|---|---|',
    ...plans.map((p) => `| ${p.name} | ${p.role} | \`${p.schemaName}\` | \`${p.folder}/\` |`),
    '',
    '## Next steps',
    '',
    '1. Review the instructions in each `settings.mcs.yml` and run **Agent Forge: Lint Workspace**.'
  ];
  if (spec.writer) {
    lines.push(
      `2. Add the MCP server or connector for ${spec.writer.name} in Copilot Studio (browser recipe "Add an MCP tool"),`,
      `   restricted to: ${spec.writer.operations.join(', ')}, with "Ask before running" for write operations.`
    );
  }
  lines.push(
    `${spec.writer ? 3 : 2}. Add knowledge or read tools to each domain agent, then push the domain agents before the orchestrator.`,
    `${spec.writer ? 4 : 3}. Generate an evaluation test set (**Agent Forge: New Evaluation Test Set**) and run it in Copilot Studio.`,
    ''
  );
  return lines.join('\n');
}
