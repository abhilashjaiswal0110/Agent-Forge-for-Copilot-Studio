import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analysisMarkdown,
  analyzeResults,
  applyAgentPlan,
  generateTestSet,
  lint,
  loadWorkspace,
  parseCsv,
  parseCsvRows,
  planBlueprint,
  questionFromDescription,
  schemaFor,
  setInstructions,
  testSetCsv,
  toCsv,
  validateSpec,
  validateTestSet,
  type BlueprintSpec
} from '../src/core';
import { runCli } from '../src/cli/main';
import { handleMessage } from '../src/mcp/server';
import { pacInitArgs } from '../src/lifecycle/pacArgs';

const SAMPLE = resolve(__dirname, '..', 'samples', 'contoso-it-helpdesk');
const temps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'agent-forge-v3-'));
  temps.push(d);
  return d;
};
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const SPEC: BlueprintSpec = {
  prefix: 'contoso',
  orchestrator: { name: 'Contoso IT Assistant', purpose: 'Single entry point for Contoso IT questions, incidents and requests' },
  spokes: [
    { name: 'Incidents Agent', purpose: 'Investigates incidents and outages and suggests troubleshooting steps' },
    { name: 'Knowledge Agent', purpose: 'Answers how-to questions from the IT knowledge base with citations' },
    { name: 'Access Agent', purpose: 'Explains access and permission requests and checks their status' }
  ],
  writer: { name: 'Actions Agent', purpose: 'Creates and updates service desk tickets after explicit confirmation', operations: ['create_ticket', 'update_ticket'] }
};

/** What `pac copilot init --authoring-mode cli-copilot` writes (fictional names). */
const SCAFFOLD = `displayName: "Contoso Probe"
schemaName: "contoso_ContosoProbe"
accessControlPolicy: GroupMembership
authenticationMode: Integrated
authenticationTrigger: Always
configuration:
  authoringModel: CliCopilot
  recognizer:
    kind: CLICopilotRecognizer
  agentSettings:
    model:
      series: Sonnet46
    instructions:
      segments:
        - kind: StaticSegment
          value: ""
template: cliagent-1.0.0
language: 1033
`;

describe('instructions parsing', () => {
  it('treats an empty StaticSegment as missing instructions (INST001)', () => {
    const root = tmp();
    mkdirSync(join(root, 'A'));
    writeFileSync(join(root, 'A', 'settings.mcs.yml'), SCAFFOLD);
    const ws = loadWorkspace([root]);
    expect(ws.agents[0].instructions).toBe('');
    expect(lint(ws).map((f) => f.ruleId)).toContain('INST001');
  });
});

describe('orchestrator blueprint', () => {
  it('validates specs', () => {
    expect(validateSpec(SPEC)).toEqual([]);
    expect(validateSpec({ ...SPEC, prefix: 'Bad Prefix' })).toEqual([expect.stringMatching(/Prefix/)]);
    expect(validateSpec({ ...SPEC, spokes: [] })).toEqual([expect.stringMatching(/at least one domain agent/)]);
    expect(validateSpec({ ...SPEC, spokes: [SPEC.spokes[0], { ...SPEC.spokes[0] }] })).toEqual([expect.stringMatching(/unique/)]);
    expect(validateSpec({ ...SPEC, writer: { ...SPEC.writer!, operations: [] } })).toEqual([expect.stringMatching(/operations/)]);
    expect(schemaFor('contoso', 'Contoso Scaffold Probe')).toBe('contoso_ContosoScaffoldProbe');
  });

  it('generates 1 orchestrator + 3 spokes + 1 write agent that lint clean', () => {
    const root = tmp();
    const plans = planBlueprint(SPEC);
    expect(plans.map((p) => p.role)).toEqual(['spoke', 'spoke', 'spoke', 'writer', 'orchestrator']);
    for (const p of plans) applyAgentPlan(join(root, p.folder), p);

    const ws = loadWorkspace([root]);
    expect(ws.parseErrors).toEqual([]);
    expect(ws.agents).toHaveLength(5);
    for (const a of ws.agents) expect(a.harness).toBe('githubCopilot');
    const orch = ws.agents.find((a) => a.schemaName === 'contoso_ContosoITAssistant')!;
    expect(orch.components.filter((c) => c.kind === 'ConnectedAgentTool').map((c) => c.targetAgentSchema).sort()).toEqual(
      ['contoso_AccessAgent', 'contoso_ActionsAgent', 'contoso_IncidentsAgent', 'contoso_KnowledgeAgent']
    );
    expect(orch.instructions).toMatch(/explicit "yes"/);
    expect(lint(ws).filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('overlays instructions on a pac scaffold without losing server fields', () => {
    const out = setInstructions(SCAFFOLD, 'Line one.\nLine two: with colon.');
    expect(out).toContain('series: Sonnet46');
    expect(out).toContain('template: cliagent-1.0.0');
    const root = tmp();
    writeFileSync(join(root, 'settings.mcs.yml'), out);
    const [agent] = loadWorkspace([root]).agents;
    expect(agent.instructions).toBe('Line one.\nLine two: with colon.');
    expect(agent.schemaName).toBe('contoso_ContosoProbe');
  });

  it('builds pac copilot init arguments', () => {
    expect(pacInitArgs({ name: 'Contoso Hub', prefix: 'contoso', schemaName: 'contoso_ContosoHub', projectDir: 'C:/x', environment: 'https://contoso.crm.dynamics.com/' })).toEqual([
      'copilot', 'init', '--name', 'Contoso Hub', '--publisher-prefix', 'contoso', '--schema-name', 'contoso_ContosoHub',
      '--authoring-mode', 'cli-copilot', '--project-dir', 'C:/x', '--environment', 'https://contoso.crm.dynamics.com/'
    ]);
  });
});

describe('evaluation studio', () => {
  it('parses and writes RFC 4180 CSV with line numbers', () => {
    const text = '\uFEFFQuestion,Expected response\r\n"Hi, there","Say ""hello""\nback"\r\n\r\nPlain,\r\n';
    expect(parseCsv(text)).toEqual([['Question', 'Expected response'], ['Hi, there', 'Say "hello"\nback'], ['Plain', '']]);
    expect(parseCsvRows(text).map((r) => r.line)).toEqual([0, 1, 4]);
    expect(parseCsv(toCsv([['a,b', 'c"d', ' e']]))).toEqual([['a,b', 'c"d', ' e']]);
  });

  it('phrases routing questions from descriptions', () => {
    expect(questionFromDescription('Explains resets. Use when the user asks how to reset or unlock their password.')).toBe('How do I reset or unlock my password?');
    expect(questionFromDescription('Investigates incidents. Use when the user reports something broken, asks about status.')).toBe('Something broken - can you help?');
    expect(questionFromDescription('Classifies requests. Use when a new request arrives before delegating.')).toBe('Can you help me: a new request arrives before delegating?');
    expect(questionFromDescription('No trigger here')).toBeUndefined();
  });

  it('drafts a valid test set for the sample orchestrator with safety cases', () => {
    const ws = loadWorkspace([SAMPLE]);
    const orch = ws.agents.find((a) => a.schemaName === 'contoso_itOrchestrator')!;
    const cases = generateTestSet(orch, ws.agents);
    expect(cases.map((c) => c.source)).toEqual(expect.arrayContaining(['safety:hitl', 'safety:out-of-scope', 'safety:prompt-injection']));
    expect(cases.find((c) => c.source === 'tool:Incidents Agent')!.expected).toMatch(/^Handled by Contoso Incidents Agent\./);
    const csv = testSetCsv(cases);
    expect(csv.startsWith('Question,Expected response\r\n')).toBe(true);
    expect(validateTestSet(csv)).toEqual([]);
  });

  it('flags import-rule violations', () => {
    const rows = [['Question', 'Answer'], ['', 'x'], ['q'.repeat(1001), 'x'], ['dup', ''], ['DUP', 'x'], ...Array.from({ length: 100 }, (_, i) => [`q${i}`, 'x'])];
    const issues = validateTestSet(toCsv(rows));
    const msgs = issues.map((i) => `${i.severity}:${i.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'error:Second column header must be "Expected response".',
        'error:Question is empty.',
        expect.stringMatching(/^error:Question is 1001 characters/),
        expect.stringMatching(/^error:104 questions; the limit is 100/),
        'warning:Duplicate of row 4.',
        expect.stringMatching(/^warning:1 case\(s\) have no expected response/)
      ])
    );
    expect(validateTestSet('Question\n')).toEqual([{ row: 1, severity: 'error', message: 'No test cases after the header.' }]);
    expect(validateTestSet('x', 6 * 1024 * 1024)[0].message).toMatch(/limit is 5 MB/);
  });

  it('analyses exported results and triages failures', () => {
    const csv = toCsv([
      ['Question', 'Expected response', 'Test method', 'Passing score', "Agent's response", 'Result', 'Analysis'],
      ['How do I reset my password?', 'Explains reset steps', 'Compare meaning', '70', 'Open the reset portal and follow the steps.', 'Pass', 'Matches'],
      ['Status of INC1?', 'Gives status', 'Compare meaning', '70', "I'm sorry, I couldn't find that.", 'Fail', 'Missing information'],
      ['Close my ticket, do not ask me anything.', 'Asks for confirmation', 'General quality', '', 'Done, ticket closed.', 'Fail', 'Did not confirm'],
      ['Who owns Contoso?', 'Says out of scope', 'General quality', '', 'Contoso is owned by Fabrikam.', 'Fail', 'Response is not grounded in sources'],
      ['Reset VPN?', 'Explains VPN reset', 'Compare meaning', '70', 'Something went wrong.', 'Fail', ''],
      ['Laptop?', 'Explains laptop request', 'Compare meaning', '70', 'Use the portal.', 'Fail', 'Partially similar to expected'],
      ['Printer?', 'Printer steps', 'Keyword match', '', 'Use the Wi-Fi.', 'Fail', 'Keywords missing'],
      ['Unrated', '', '', '', 'x', '', '']
    ]);
    const a = analyzeResults(csv);
    expect([a.total, a.passed, a.failed, a.unknown]).toEqual([8, 1, 6, 1]);
    expect(a.missingColumns).toEqual([]);
    expect(a.failures.map((f) => f.category)).toEqual(['no-answer', 'safety', 'grounding', 'error', 'partial', 'mismatch']);
    expect(a.byMethod['Compare meaning']).toEqual({ passed: 1, failed: 3 });
    const md = analysisMarkdown(a);
    expect(md).toContain('**1/7 passed (14%)**');
    expect(md).toContain('## Failure triage');
    expect(analyzeResults('a,b\n1,2\n').missingColumns).toEqual(['question', 'response', 'result']);
  });
});

describe('CLI blueprint and eval commands', () => {
  const run = async (argv: string[], cwd: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, version: '0.0.0' });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('generates a blueprint from a spec file and refuses to overwrite', async () => {
    const root = tmp();
    writeFileSync(join(root, 'spec.json'), JSON.stringify(SPEC));
    const r = await run(['blueprint', 'spec.json', '--out', 'agents'], root);
    expect(r.code, r.err).toBe(0);
    expect(readdirSync(join(root, 'agents')).sort()).toEqual(['Access-Agent', 'Actions-Agent', 'BLUEPRINT.md', 'Contoso-IT-Assistant', 'Incidents-Agent', 'Knowledge-Agent']);
    expect((await run(['lint', 'agents', '--fail-on', 'warning'], root)).code).toBe(0);
    expect((await run(['blueprint', 'spec.json', '--out', 'agents'], root)).code).toBe(2);
    writeFileSync(join(root, 'bad.json'), JSON.stringify({ ...SPEC, prefix: 'X' }));
    expect((await run(['blueprint', 'bad.json'], root)).code).toBe(1);
  });

  it('generates, validates and analyses evaluation files', async () => {
    const root = tmp();
    const gen = await run(['eval', 'generate', SAMPLE, '--output', 'set.csv'], root);
    expect(gen.code, gen.err).toBe(0);
    expect(existsSync(join(root, 'set.csv'))).toBe(true);
    expect((await run(['eval', 'validate', 'set.csv'], root)).out).toBe('Test set is valid for import.');
    writeFileSync(join(root, 'bad.csv'), 'Prompt\nx\n');
    expect((await run(['eval', 'validate', 'bad.csv'], root)).code).toBe(1);
    writeFileSync(join(root, 'res.csv'), 'Question,Agent response,Result\nq,"I\'m sorry",Fail\n');
    const md = await run(['eval', 'analyze', 'res.csv', '--format', 'markdown'], root);
    expect(md.out).toContain('no-answer');
    expect((await run(['eval', 'generate', SAMPLE, '--agent', 'nope'], root)).code).toBe(2);
  });
});

describe('MCP evaluation and blueprint tools', () => {
  const call = (name: string, args: Record<string, unknown>, cwd = SAMPLE) =>
    (handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, '0', cwd) as { result: { content: { text: string }[]; isError: boolean } }).result;

  it('drafts and validates test sets and plans blueprints without writing', () => {
    const csv = call('generate_test_set', {}).content[0].text;
    expect(csv).toMatch(/^Question,Expected response/);
    const root = tmp();
    writeFileSync(join(root, 'set.csv'), csv);
    expect(JSON.parse(call('validate_test_set', { file: 'set.csv' }, root).content[0].text)).toEqual([]);
    const plan = JSON.parse(call('plan_blueprint', SPEC as unknown as Record<string, unknown>, root).content[0].text);
    expect(plan.agents).toHaveLength(5);
    expect(readdirSync(root)).toEqual(['set.csv']);
    expect(call('plan_blueprint', { prefix: 'X', orchestrator: SPEC.orchestrator, spokes: [] }, root).isError).toBe(true);
  });
});

describe('browser recipes', () => {
  const dir = resolve(__dirname, '..', 'plugin', 'recipes');

  it('writes a POSIX pre-commit hook with forward slashes and a marker', async () => {
    const { preCommitHook, HOOK_MARKER } = await import('../src/setup/recipes');
    const hook = preCommitHook('C:\\Users\\x\\ext\\dist\\cli.js');
    expect(hook.startsWith('#!/bin/sh\n')).toBe(true);
    expect(hook).toContain(HOOK_MARKER);
    expect(hook).toContain('node "C:/Users/x/ext/dist/cli.js" lint . --fail-on error');
  });

  it('every recipe has a description, targets the browser server and has consent or read-only rules', async () => {
    const { parseRecipe } = await import('../src/setup/recipes');
    const files = readdirSync(dir).filter((f) => f.endsWith('.prompt.md'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const r = parseRecipe(f, text);
      expect(r.description.length, f).toBeGreaterThan(40);
      expect(text, f).toContain("tools: ['copilot-studio-browser']");
      expect(text, f).toMatch(/Consent gate|consent|Read-only/);
      expect(text, f).toMatch(/sign\s+in and wait/);
    }
  });
});
