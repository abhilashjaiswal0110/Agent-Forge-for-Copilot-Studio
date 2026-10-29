import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { layout, lint, loadWorkspace, RULES, toMermaid } from '../src/core';
import { pacArgs } from '../src/lifecycle/pacArgs';

const SAMPLE = resolve(__dirname, '..', 'samples', 'contoso-it-helpdesk');
const temps: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-forge-'));
  temps.push(root);
  for (const [p, content] of Object.entries(files)) {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const ghcpSettings = (name: string, schema: string, instructions = 'Tell the user to wait a moment.') =>
  `displayName: ${name}\nschemaName: ${schema}\nconfiguration:\n  recognizer:\n    kind: CLICopilotRecognizer\n  agentSettings:\n    instructions:\n      segments:\n        - text: ${instructions}\n`;

const connected = (schema: string) =>
  `mcs.metadata:\n  componentName: To ${schema}\n  description: Delegates to ${schema}. Use when the user asks about ${schema} topics in detail.\nkind: ConnectedAgentTool\nbotSchemaName: ${schema}\n`;

describe('workspace discovery', () => {
  it('discovers both harnesses in the Contoso sample', () => {
    const ws = loadWorkspace([SAMPLE]);
    expect(ws.parseErrors).toEqual([]);
    const harness = Object.fromEntries(ws.agents.map((a) => [a.schemaName, a.harness]));
    expect(harness).toEqual({
      contoso_actionsAgent: 'githubCopilot',
      contoso_howTo: 'standard',
      contoso_incidentsAgent: 'githubCopilot',
      contoso_itOrchestrator: 'githubCopilot'
    });
    const orch = ws.agents.find((a) => a.schemaName === 'contoso_itOrchestrator')!;
    expect(orch.components.filter((c) => c.kind === 'ConnectedAgentTool').map((c) => c.targetAgentSchema).sort()).toEqual([
      'contoso_actionsAgent',
      'contoso_incidentsAgent'
    ]);
    const classic = ws.agents.find((a) => a.harness === 'standard')!;
    expect(classic.components.filter((c) => c.category === 'topic' && c.routable)).toHaveLength(1);
  });

  it('reads sync metadata from .mcs/conn.json', () => {
    const root = fixture({
      'A/settings.mcs.yml': ghcpSettings('A', 'x_a'),
      'A/agent.sync.yaml': 'layoutVersion: 1\n',
      'A/.mcs/conn.json': JSON.stringify({ AgentId: 'agent-1', EnvironmentId: 'env-1', EnvironmentDisplayName: 'Dev' })
    });
    const [agent] = loadWorkspace([root]).agents;
    expect(agent.sync).toMatchObject({ agentId: 'agent-1', environmentId: 'env-1', environmentDisplayName: 'Dev' });
  });

  it('reports YAML parse errors', () => {
    const root = fixture({ 'A/settings.mcs.yml': 'displayName: [unclosed\n' });
    const findings = lint(loadWorkspace([root]));
    expect(findings.map((f) => f.ruleId)).toContain('YAML001');
  });
});

describe('policy rules', () => {
  it('the Contoso sample is clean of errors and warnings', () => {
    const findings = lint(loadWorkspace([SAMPLE])).filter((f) => f.severity !== 'info');
    expect(findings).toEqual([]);
  });

  it('MA001 flags nested connected agents', () => {
    const root = fixture({
      'Hub/settings.mcs.yml': ghcpSettings('Hub', 'x_hub'),
      'Hub/capabilities/tools/a.mcs.yml': connected('x_mid'),
      'Mid/settings.mcs.yml': ghcpSettings('Mid', 'x_mid'),
      'Mid/capabilities/tools/b.mcs.yml': connected('x_leaf'),
      'Leaf/settings.mcs.yml': ghcpSettings('Leaf', 'x_leaf')
    });
    const ids = lint(loadWorkspace([root])).map((f) => f.ruleId);
    expect(ids.filter((i) => i === 'MA001')).toHaveLength(1);
  });

  it('HARN001 flags mixed harness folders', () => {
    const root = fixture({
      'A/settings.mcs.yml': ghcpSettings('A', 'x_a'),
      'A/topics/T.mcs.yml': 'kind: AdaptiveDialog\nbeginDialog:\n  kind: OnConversationStart\n'
    });
    expect(lint(loadWorkspace([root])).map((f) => f.ruleId)).toContain('HARN001');
  });

  it('SEC001/SEC002/HITL001 flag an unrestricted auto-approved MCP tool', () => {
    const root = fixture({
      'A/settings.mcs.yml': ghcpSettings('A', 'x_a', 'Help users and tell them to wait a moment.'),
      'A/capabilities/tools/mail.mcs.yml':
        'mcs.metadata:\n  componentName: Mail\n  description: Sends and reads mail. Use when the user asks to send or read email messages.\nkind: McpTool\ntoolPermissionMode:\n  kind: AlwaysApprove\n'
    });
    const ids = lint(loadWorkspace([root])).map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['SEC001', 'SEC002', 'HITL001']));
  });

  it('DESC001/DESC002/DESC003/FMT002 flag weak descriptions', () => {
    const root = fixture({
      'A/settings.mcs.yml': ghcpSettings('A', 'x_a'),
      'A/capabilities/knowledge/k1.mcs.yml': 'mcs.metadata:\n  componentName: K1\n  description: "Policies: HR"\nkind: KnowledgeSourceConfiguration\n',
      'A/capabilities/knowledge/k2.mcs.yml': 'mcs.metadata:\n  componentName: K2\nkind: KnowledgeSourceConfiguration\n',
      'A/behaviors/s1/skill.mcs.yml': 'mcs.metadata:\n  componentName: s1\n  description: Lookup\nkind: InlineAgentSkill\n',
      'A/behaviors/s2/skill.mcs.yml': 'mcs.metadata:\n  componentName: s2\n  description: Lookup\nkind: InlineAgentSkill\n'
    });
    const ids = lint(loadWorkspace([root])).map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['DESC001', 'DESC002', 'DESC003', 'FMT002']));
  });

  it('SKL001 and DRY001 flag skill drift and duplication', () => {
    const skill = (desc: string) => `---\nname: shared\ndescription: ${desc}\n---\nBody\n`;
    const meta = 'mcs.metadata:\n  componentName: shared\n  description: Gathers evidence. Use when a domain review needs facts.\nkind: InlineAgentSkill\n';
    const files: Record<string, string> = {};
    for (const n of ['A', 'B', 'C']) {
      files[`${n}/settings.mcs.yml`] = ghcpSettings(n, `x_${n}`);
      files[`${n}/behaviors/shared/skill.mcs.yml`] = meta;
      files[`${n}/behaviors/shared/SKILL.md`] = skill('Different text');
    }
    const ids = lint(loadWorkspace([fixture(files)])).map((f) => f.ruleId);
    expect(ids.filter((i) => i === 'SKL001')).toHaveLength(3);
    expect(ids.filter((i) => i === 'DRY001')).toHaveLength(1);
  });

  it('honours disabled rules', () => {
    const root = fixture({ 'A/settings.mcs.yml': ghcpSettings('A', 'x_a'), 'A/topics/T.mcs.yml': 'kind: AdaptiveDialog\n' });
    expect(lint(loadWorkspace([root]), { disabledRules: ['HARN001'] }).map((f) => f.ruleId)).not.toContain('HARN001');
  });

  it('every rule has an id, rationale and unique id', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) expect(r.rationale.length).toBeGreaterThan(20);
  });
});

describe('graph', () => {
  it('lays out orchestrator left and domain agents right', () => {
    const { nodes, edges } = layout(loadWorkspace([SAMPLE]));
    expect(edges).toHaveLength(2);
    const orch = nodes.find((n) => n.key === 'contoso_itOrchestrator')!;
    const inc = nodes.find((n) => n.key === 'contoso_incidentsAgent')!;
    expect(orch.orchestrator).toBe(true);
    expect(inc.x).toBeGreaterThan(orch.x);
  });

  it('renders Mermaid', () => {
    const m = toMermaid(loadWorkspace([SAMPLE]));
    expect(m).toContain('flowchart LR');
    expect(m).toContain('contoso_itOrchestrator -->|Incidents Agent| contoso_incidentsAgent');
  });
});

describe('pac arguments', () => {
  it('builds pull/push/publish commands', () => {
    expect(pacArgs('pull', { root: 'C:/a' })).toEqual(['copilot', 'pull', '--project-dir', 'C:/a']);
    expect(pacArgs('push', { root: 'C:/a' })).toEqual(['copilot', 'push', '--project-dir', 'C:/a']);
    expect(pacArgs('publish', { root: 'C:/a', agentId: 'id1', environmentId: 'env1' })).toEqual([
      'copilot', 'publish', '--bot', 'id1', '--environment', 'env1'
    ]);
    expect(pacArgs('publish', { root: 'C:/a', schemaName: 'x_a' })).toEqual(['copilot', 'publish', '--bot', 'x_a']);
    expect(() => pacArgs('publish', { root: 'C:/a' })).toThrow(/Cannot publish/);
  });
});
