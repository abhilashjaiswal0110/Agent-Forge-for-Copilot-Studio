import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyFixes, fixesFor, formatSarif, insecureUrl, lint, loadWorkspace, looksLikeSecret, RULES } from '../src/core';
import { runCli } from '../src/cli/main';
import { handleMessage, TOOLS } from '../src/mcp/server';
import { pacSupports, pacVersion } from '../src/lifecycle/pacArgs';

const SAMPLE = resolve(__dirname, '..', 'samples', 'contoso-it-helpdesk');
const temps: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-forge-v2-'));
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

const settings = (name: string, schema: string, instructions: string | null = 'Tell the user to wait a moment and confirm before any change.') =>
  `displayName: ${name}\nschemaName: ${schema}\nconfiguration:\n  recognizer:\n    kind: CLICopilotRecognizer\n` +
  (instructions === null ? '' : `  agentSettings:\n    instructions:\n      segments:\n        - text: ${instructions}\n`);

const connected = (schema: string) =>
  `mcs.metadata:\n  componentName: To ${schema}\n  description: Delegates to ${schema}. Use when the user asks about ${schema} topics in detail.\nkind: ConnectedAgentTool\nhistoryType:\n  kind: NoHistory\nbotSchemaName: ${schema}\n`;

const mcp = (tools: string[], mode = 'AlwaysAsk', description = 'Works with Contoso tickets. Use when the user asks about a ticket.') =>
  `mcs.metadata:\n  componentName: Tickets\n  description: ${description}\nkind: McpTool\ntoolPermissionMode:\n  kind: ${mode}\nallowedTools:\n${tools.map((t) => `  - ${t}`).join('\n')}\n`;

const knowledge = (url: string) =>
  `mcs.metadata:\n  componentName: KB\n  description: Contoso knowledge base articles\nkind: KnowledgeSourceConfiguration\nsource:\n  kind: PublicSiteSearchSource\n  site: ${url}\n`;

const skillMeta = (desc = 'Gathers evidence. Use when a domain review needs facts.') =>
  `mcs.metadata:\n  componentName: evidence\n  description: ${desc}\nkind: InlineAgentSkill\n`;

const ids = (root: string) => lint(loadWorkspace([root])).map((f) => f.ruleId);

const standard = (topics: Record<string, string>) => ({
  'C/settings.mcs.yml': 'displayName: Classic\nschemaName: x_c\nconfiguration:\n  recognizer:\n    kind: GenerativeAIRecognizer\n',
  'C/agent.mcs.yml': 'mcs.metadata:\n  componentName: Classic\nkind: GptComponentMetadata\ninstructions: Answer questions about Contoso.\n',
  ...Object.fromEntries(Object.entries(topics).map(([n, c]) => [`C/topics/${n}.mcs.yml`, c]))
});

const redirect = (target: string) =>
  `kind: AdaptiveDialog\nbeginDialog:\n  kind: OnConversationStart\n  id: main\n  actions:\n    - kind: BeginDialog\n      id: go\n      dialog: ${target}\n`;

describe('rule catalogue', () => {
  it('has 25 rules', () => {
    expect(RULES).toHaveLength(25);
  });

  it('reports unreadable files as YAML001 instead of crashing', () => {
    const root = fixture({ 'B/settings.mcs.yml': settings('B', 'x_b'), 'B/behaviors/e/skill.mcs.yml': skillMeta() });
    mkdirSync(join(root, 'A', 'settings.mcs.yml'), { recursive: true });
    mkdirSync(join(root, 'B', 'behaviors', 'e', 'SKILL.md'));
    const ws = loadWorkspace([root]);
    expect(ws.parseErrors.map((e) => e.message)).toEqual([expect.stringMatching(/could not be read/), expect.stringMatching(/could not be read/)]);
    expect(lint(ws).filter((f) => f.ruleId === 'YAML001')).toHaveLength(2);
  });

  it('a standard agent with cloud flows in workflows/ is not a mixed harness', () => {
    const root = fixture({
      ...standard({ Start: redirect('x_c.topic.Start') }),
      'C/workflows/NotifyOwner/workflow.mcs.yml': 'mcs.metadata:\n  componentName: Notify owner\n  description: Sends a notification. Use when a ticket owner must be told.\nkind: CloudFlowDefinition\n'
    });
    const ws = loadWorkspace([root]);
    expect(ws.agents[0].harness).toBe('standard');
    expect(lint(ws).map((f) => f.ruleId)).not.toContain('HARN001');
  });
});

describe('new rules: failing and passing fixtures', () => {
  it('INST001 missing instructions', () => {
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a', null) }))).toContain('INST001');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a') }))).not.toContain('INST001');
    const classic = { 'C/settings.mcs.yml': 'displayName: Classic\nschemaName: x_c\n', 'C/agent.mcs.yml': 'kind: GptComponentMetadata\n' };
    expect(ids(fixture(classic))).not.toContain('INST001');
  });

  it('INST002 instructions over 8,000 characters', () => {
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a', 'Confirm. ' + 'x'.repeat(8001)) }))).toContain('INST002');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a', 'Confirm. ' + 'x'.repeat(7000)) }))).not.toContain('INST002');
  });

  it('MA004 more than one write agent', () => {
    const base = {
      'Hub/settings.mcs.yml': settings('Hub', 'x_hub'),
      'Hub/capabilities/tools/w1.mcs.yml': connected('x_w1'),
      'Hub/capabilities/tools/w2.mcs.yml': connected('x_w2'),
      'W1/settings.mcs.yml': settings('W1', 'x_w1'),
      'W1/capabilities/tools/t.mcs.yml': mcp(['create_ticket']),
      'W2/settings.mcs.yml': settings('W2', 'x_w2')
    };
    expect(ids(fixture({ ...base, 'W2/capabilities/tools/t.mcs.yml': mcp(['update_ticket']) }))).toContain('MA004');
    expect(ids(fixture({ ...base, 'W2/capabilities/tools/t.mcs.yml': mcp(['get_ticket', 'list_tickets']) }))).not.toContain('MA004');
  });

  it('SEC003 hard-coded secret', () => {
    const tool = (key: string) => mcp(['get_ticket']) + `connectionProperties:\n  apiKey: ${key}\n`;
    const bad = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': tool('FAKE0000example0000KEY') });
    const findings = lint(loadWorkspace([bad])).filter((f) => f.ruleId === 'SEC003');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).not.toContain('FAKE0000');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': tool('=Env.ContosoApiKey') }))).not.toContain('SEC003');
  });

  it('SEC003 heuristics', () => {
    expect(looksLikeSecret('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(looksLikeSecret('url: https://contoso.blob.core.windows.net/x?sv=1&sig=abcdefghijklmnopqrstuvwx%3D')).toBe(true);
    expect(looksLikeSecret('password: Contoso2024Secret!')).toBe(true);
    expect(looksLikeSecret('Never ask for a password: refer users to the portal.')).toBe(false);
    expect(looksLikeSecret('client_secret: ${CLIENT_SECRET}')).toBe(false);
  });

  it('SEC004 insecure http URL', () => {
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/knowledge/k.mcs.yml': knowledge('http://intranet.contoso.com/kb') }))).toContain('SEC004');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/knowledge/k.mcs.yml': knowledge('https://intranet.contoso.com/kb') }))).not.toContain('SEC004');
    expect(insecureUrl('$schema: http://adaptivecards.io/schemas/adaptive-card.json')).toBeUndefined();
    expect(insecureUrl('url: http://localhost:3000/api')).toBeUndefined();
  });

  it('HITL002 auto-approved write operations', () => {
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': mcp(['create_ticket'], 'AlwaysApprove') }))).toContain('HITL002');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': mcp(['get_ticket'], 'AlwaysApprove') }))).not.toContain('HITL002');
  });

  it('SKL002 skill without SKILL.md', () => {
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/behaviors/e/skill.mcs.yml': skillMeta() }))).toContain('SKL002');
    expect(
      ids(fixture({
        'A/settings.mcs.yml': settings('A', 'x_a'),
        'A/behaviors/e/skill.mcs.yml': skillMeta(),
        'A/behaviors/e/SKILL.md': '---\nname: evidence\ndescription: Gathers evidence. Use when a domain review needs facts.\n---\nBody\n'
      }))
    ).not.toContain('SKL002');
  });

  it('TOP001 redirect to a missing topic', () => {
    expect(ids(fixture(standard({ Start: redirect('x_c.topic.Escalate') })))).toContain('TOP001');
    expect(ids(fixture(standard({ Start: redirect('x_c.topic.Escalate'), Escalate: 'kind: AdaptiveDialog\nbeginDialog:\n  kind: OnRedirect\n  id: main\n' })))).not.toContain('TOP001');
  });

  it('FMT003 description too long', () => {
    const long = 'Works with tickets. Use when the user asks about a ticket. ' + 'a'.repeat(1100);
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': mcp(['get_ticket'], 'AlwaysAsk', long) }))).toContain('FMT003');
    expect(ids(fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': mcp(['get_ticket']) }))).not.toContain('FMT003');
  });

  it('the Contoso sample stays clean of errors and warnings', () => {
    expect(lint(loadWorkspace([SAMPLE])).filter((f) => f.severity !== 'info')).toEqual([]);
  });
});

describe('quick fixes', () => {
  const fixAll = (root: string, rule: string, onlySafe = true) => {
    const ws = loadWorkspace([root]);
    const fixes = lint(ws)
      .filter((f) => f.ruleId === rule)
      .flatMap((f) => fixesFor(f, ws))
      .filter((f) => !onlySafe || f.safe);
    expect(fixes.length, rule).toBeGreaterThan(0);
    applyFixes(fixes);
    return root;
  };

  it('FMT002 replaces colon-space and keeps CRLF line endings and the BOM', () => {
    const root = fixture({
      'A/settings.mcs.yml': settings('A', 'x_a'),
      'A/capabilities/knowledge/k.mcs.yml': '\uFEFFmcs.metadata:\r\n  componentName: K\r\n  description: "Policies: HR"\r\nkind: KnowledgeSourceConfiguration\r\n'
    });
    fixAll(root, 'FMT002');
    const text = readFileSync(join(root, 'A/capabilities/knowledge/k.mcs.yml'), 'utf8');
    expect(text.startsWith('\uFEFFmcs.metadata:')).toBe(true);
    expect(text).toContain('description: "Policies - HR"\r\n');
    expect(ids(root)).not.toContain('FMT002');
  });

  it('SEC002 and HITL002 switch AlwaysApprove to AlwaysAsk', () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/tools/t.mcs.yml': mcp(['create_ticket'], 'AlwaysApprove') });
    fixAll(root, 'HITL002');
    expect(readFileSync(join(root, 'A/capabilities/tools/t.mcs.yml'), 'utf8')).toContain('kind: AlwaysAsk');
    expect(ids(root)).not.toContain('HITL002');

    const open = fixture({
      'A/settings.mcs.yml': settings('A', 'x_a'),
      'A/capabilities/tools/t.mcs.yml': 'mcs.metadata:\n  componentName: M\n  description: Mail. Use when the user asks about mail.\nkind: McpTool\ntoolPermissionMode:\n  kind: AlwaysApprove\n'
    });
    fixAll(open, 'SEC002');
    expect(ids(open)).not.toContain('SEC002');
  });

  it('SEC001 scaffolds an allowedTools list that still parses (manual fix)', () => {
    const file = 'A/capabilities/tools/t.mcs.yml';
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), [file]: 'mcs.metadata:\n  componentName: M\n  description: Mail. Use when the user asks about mail.\nkind: McpTool' });
    fixAll(root, 'SEC001', false);
    expect(readFileSync(join(root, file), 'utf8')).toMatch(/kind: McpTool\nallowedTools: \[\]/);
    expect(loadWorkspace([root]).parseErrors).toEqual([]);
  });

  it('SEC004 switches to https (manual fix)', () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/capabilities/knowledge/k.mcs.yml': knowledge('http://intranet.contoso.com/kb') });
    fixAll(root, 'SEC004', false);
    expect(ids(root)).not.toContain('SEC004');
  });

  it('SKL001 copies the description into SKILL.md', () => {
    const root = fixture({
      'A/settings.mcs.yml': settings('A', 'x_a'),
      'A/behaviors/e/skill.mcs.yml': skillMeta('"Gathers evidence: facts only. Use when a review needs facts."'),
      'A/behaviors/e/SKILL.md': '---\nname: evidence\ndescription: Old text\n---\nBody\n'
    });
    expect(ids(root)).toContain('SKL001');
    fixAll(root, 'SKL001');
    expect(ids(root)).not.toContain('SKL001');
  });

  it('SKL001 fix round-trips descriptions with quotes and backslashes', () => {
    const root = fixture({
      'A/settings.mcs.yml': settings('A', 'x_a'),
      'A/behaviors/e/skill.mcs.yml': skillMeta(`'Finds the "owner": C:\\share paths. Use when a path owner is needed.'`),
      'A/behaviors/e/SKILL.md': '---\nname: evidence\ndescription: Old text\n---\nBody\n'
    });
    fixAll(root, 'SKL001');
    expect(ids(root)).not.toContain('SKL001');
  });

  it('SKL002 creates SKILL.md', () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/behaviors/e/skill.mcs.yml': skillMeta() });
    fixAll(root, 'SKL002');
    expect(existsSync(join(root, 'A/behaviors/e/SKILL.md'))).toBe(true);
    const after = ids(root);
    expect(after).not.toContain('SKL002');
    expect(after).not.toContain('SKL001');
  });
});

describe('reports', () => {
  it('emits SARIF 2.1.0 with every rule and relative paths', () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a', null) });
    const sarif = JSON.parse(formatSarif(lint(loadWorkspace([root])), root, '1.2.3'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(RULES.length);
    const result = sarif.runs[0].results.find((r: { ruleId: string }) => r.ruleId === 'INST001');
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('A/settings.mcs.yml');
    expect(result.level).toBe('warning');
  });
});

describe('command-line tool', () => {
  const run = async (argv: string[], cwd: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, version: '9.9.9' });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('lints the sample with exit 0 and prints a summary', async () => {
    const r = await run(['lint', SAMPLE], process.cwd());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 error\(s\), 0 warning\(s\)/);
  });

  it('fails on errors, honours --fail-on and --disable', async () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/topics/T.mcs.yml': 'kind: AdaptiveDialog\n' });
    expect((await run(['lint'], root)).code).toBe(1);
    expect((await run(['lint', '--fail-on', 'never'], root)).code).toBe(0);
    expect((await run(['lint', '--disable=HARN001'], root)).code).toBe(0);
    const json = JSON.parse((await run(['lint', '--format', 'json', '--fail-on', 'never'], root)).out);
    expect(json.summary.error).toBe(1);
  });

  it('applies safe fixes with --fix and writes reports to a file', async () => {
    const root = fixture({ 'A/settings.mcs.yml': settings('A', 'x_a'), 'A/behaviors/e/skill.mcs.yml': skillMeta() });
    const r = await run(['lint', '--fix', '--format', 'sarif', '--output', 'out.sarif'], root);
    expect(r.code).toBe(0);
    expect(r.err).toContain('Applied 1 fix');
    expect(existsSync(join(root, 'A/behaviors/e/SKILL.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'out.sarif'), 'utf8')).runs[0].results.some((x: { ruleId: string }) => x.ruleId === 'SKL002')).toBe(false);
  });

  it('lists rules, prints Mermaid and rejects bad usage', async () => {
    expect((await run(['rules'], process.cwd())).out.split('\n')).toHaveLength(RULES.length);
    expect((await run(['graph', SAMPLE], process.cwd())).out).toContain('flowchart LR');
    expect((await run(['--version'], process.cwd())).out).toBe('9.9.9');
    expect((await run(['lint', '--format', 'xml'], process.cwd())).code).toBe(2);
    expect((await run(['deploy'], process.cwd())).code).toBe(2);
  });
});

describe('MCP server', () => {
  const call = (method: string, params?: Record<string, unknown>, id: number | null = 1) =>
    handleMessage({ jsonrpc: '2.0', id, method, params }, '9.9.9', SAMPLE) as { result?: any; error?: { code: number } } | undefined;

  it('initializes and lists read-only tools', () => {
    const init = call('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
    expect(init?.result.protocolVersion).toBe('2025-03-26');
    expect(init?.result.serverInfo.name).toBe('agent-forge');
    expect(call('initialize', { protocolVersion: '1999-01-01' })?.result.protocolVersion).toBe('2025-06-18');
    const tools = call('tools/list')?.result.tools as typeof TOOLS;
    expect(tools.map((t) => t.name)).toEqual(['list_rules', 'list_agents', 'lint', 'architecture_mermaid', 'generate_test_set', 'validate_test_set', 'analyze_eval_results', 'plan_blueprint']);
    for (const t of tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it('runs tools against the working folder', () => {
    const lintResult = JSON.parse(call('tools/call', { name: 'lint', arguments: { minSeverity: 'warning' } })?.result.content[0].text);
    expect(lintResult.summary).toEqual({ error: 0, warning: 0, info: 0 });
    const agents = JSON.parse(call('tools/call', { name: 'list_agents', arguments: {} })?.result.content[0].text);
    expect(agents.agents).toHaveLength(4);
    expect(call('tools/call', { name: 'architecture_mermaid', arguments: {} })?.result.content[0].text).toContain('flowchart LR');
    expect(call('tools/call', { name: 'lint', arguments: { path: 'does-not-exist' } })?.result.isError).toBe(true);
  });

  it('handles unknown methods, unknown tools and notifications', () => {
    expect(call('resources/list')?.error?.code).toBe(-32601);
    expect(call('tools/call', { name: 'nope' })?.error?.code).toBe(-32602);
    expect(call('notifications/initialized', undefined, null)).toBeUndefined();
  });
});

describe('Power Platform CLI preflight', () => {
  const OLD = 'Usage: pac copilot [list] [status] [extract-translation] [merge-translation] [extract-template] [mcp] [create] [init-skills] [publish] [model]\n\n  list   List of copilots\n  publish   Publish a Custom Copilot\n';
  const NEW = 'Version: 2.6.0\nUsage: pac copilot [clone] [pull] [push] [publish]\n\n  clone   Clone\n  pull    Pull remote changes\n  push    Push local changes\n  publish Publish\n';

  it('detects pull and push support from help output', () => {
    expect(pacSupports('pull', OLD)).toBe(false);
    expect(pacSupports('push', OLD)).toBe(false);
    expect(pacSupports('publish', OLD)).toBe(true);
    expect(pacSupports('pull', NEW)).toBe(true);
    expect(pacSupports('push', NEW)).toBe(true);
    expect(pacVersion('Version: 2.4.1+g3799f3e (.NET Framework 4.8)')).toBe('2.4.1');
  });
});
