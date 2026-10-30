import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  environmentReport,
  guardDecision,
  hostOf,
  lint,
  loadWorkspace,
  matchEnvironment,
  quotePowerFxValues,
  targetFromInput,
  usableProfiles,
  validateProfiles,
  type EnvironmentProfile
} from '../src/core';
import { readProfiles, runCli } from '../src/cli/main';

const temps: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-forge-v4-'));
  temps.push(root);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), content);
  }
  return root;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe('Power Fx values in YAML', () => {
  const topic = (value: string) =>
    `kind: AdaptiveDialog\nbeginDialog:\n  kind: OnRecognizedIntent\n  id: main\n  intent:\n    displayName: Greeting\n    modelDescription: Greets the user. Use when the user says hello.\n  actions:\n    - kind: SendActivity\n      id: s1\n      activity: ${value}\n    - kind: SetVariable\n      id: s2\n      value: =Topic.Name\n`;

  it('quotes only Power Fx values that strict YAML rejects, keeping line count and line endings', () => {
    const crlf = 'a: 1\r\ntext: ="Hi: there"\r\nb: =x\r\n';
    const q = quotePowerFxValues(crlf)!;
    expect(q).toBe("a: 1\r\ntext: '=\"Hi: there\"'\r\nb: =x\r\n");
    expect(quotePowerFxValues('text: =Topic.Name\n')).toBeUndefined();
    expect(quotePowerFxValues('text: "=quoted: already"\n')).toBeUndefined();
    const multi = quotePowerFxValues("v: =If(x,\n    \"it's: here\",\n    y)\nnext: 1\n")!;
    expect(multi.split('\n')).toHaveLength(5);
    expect(multi).toContain("v: '=If(x,\n    \"it''s: here\",\n    y)'\nnext: 1");
  });

  it('leaves Power Fx-like text inside block scalars untouched', () => {
    const text = 'instructions: |\n  Total: =Sum(a: b)\n  - item: =x: y\nmsg: ="a: b"\nnote: >-\n  k: =v: w\n';
    const q = quotePowerFxValues(text)!;
    expect(q).toBe('instructions: |\n  Total: =Sum(a: b)\n  - item: =x: y\nmsg: \'="a: b"\'\nnote: >-\n  k: =v: w\n');
  });

  it('keeps a skipped line in sync with the block end', () => {
    expect(quotePowerFxValues('a: |\n  x: =y: z\nb: =c: d\n')).toBe("a: |\n  x: =y: z\nb: '=c: d'\n");
  });

  it('parses portal-generated topics instead of reporting YAML001', () => {
    const root = fixture({
      'C/settings.mcs.yml': 'displayName: Classic\nschemaName: x_c\nconfiguration:\n  recognizer:\n    kind: GenerativeAIRecognizer\n',
      'C/agent.mcs.yml': 'kind: GptComponentMetadata\ninstructions: Answer Contoso questions.\n',
      'C/topics/Greeting.mcs.yml': topic('="Hello " & User.DisplayName & ": welcome to Contoso"')
    });
    const ws = loadWorkspace([root]);
    expect(ws.parseErrors).toEqual([]);
    expect(ws.agents[0].components.find((c) => c.category === 'topic')?.name).toBe('Greeting');
    expect(lint(ws).map((f) => f.ruleId)).not.toContain('YAML001');
  });

  it('still reports genuinely broken YAML at the original line', () => {
    const root = fixture({
      'C/settings.mcs.yml': 'displayName: Classic\nschemaName: x_c\n',
      'C/topics/Broken.mcs.yml': 'kind: AdaptiveDialog\nmsg: ="a: b"\nlist: [unclosed\n'
    });
    const [err] = loadWorkspace([root]).parseErrors;
    expect(err.file).toMatch(/Broken/);
    expect(err.line).toBeGreaterThanOrEqual(2);
    expect(err.message).not.toMatch(/compact mappings/);
  });
});

const PROFILES: EnvironmentProfile[] = [
  { name: 'Contoso Dev', kind: 'dev', url: 'https://contoso-dev.crm.dynamics.com/' },
  { name: 'Contoso Test', kind: 'test', id: '22222222-2222-2222-2222-222222222222' },
  { name: 'Contoso Prod', kind: 'prod', url: 'https://contoso.crm.dynamics.com' }
];

describe('environment profiles', () => {
  it('validates profiles and keeps only usable ones', () => {
    expect(validateProfiles(PROFILES)).toEqual([]);
    const bad = [
      { name: 'A', kind: 'dev' },
      { name: 'a', kind: 'staging', url: 'http://x' },
      { name: 'C', kind: 'prod', id: 'nope' },
      { name: 'D', kind: 'dev', url: 'https://CONTOSO-DEV.crm.dynamics.com' },
      { name: 'E', kind: 'dev', url: 'https://contoso-dev.crm.dynamics.com/other' }
    ];
    const errors = validateProfiles(bad);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Profile 1 ("A") needs a url or an id.',
        'Profile 2 ("a"): duplicate name.',
        'Profile 2 ("a"): kind must be dev, test or prod.',
        'Profile 2 ("a"): url must be an https URL.',
        'Profile 3 ("C"): id must be an environment GUID.',
        'Profile 5 ("E") points at the same environment as "D".'
      ])
    );
    expect(usableProfiles(bad).map((p) => p.name)).toEqual(['D', 'E']);
    expect(validateProfiles('x')).toEqual(['agentForge.environments must be an array.']);
  });

  it('matches agents by environment id or Dataverse host', () => {
    expect(hostOf('Contoso.CRM.dynamics.com/')).toBe('contoso.crm.dynamics.com');
    expect(matchEnvironment({ dataverseEndpoint: 'https://contoso-dev.crm.dynamics.com' }, PROFILES).label).toBe('dev: Contoso Dev');
    expect(matchEnvironment({ environmentId: '22222222-2222-2222-2222-222222222222' }, PROFILES).kind).toBe('test');
    expect(matchEnvironment({ dataverseEndpoint: 'https://contoso.crm.dynamics.com/' }, PROFILES).kind).toBe('prod');
    expect(matchEnvironment({ dataverseEndpoint: 'https://fabrikam.crm.dynamics.com/' }, PROFILES)).toMatchObject({ kind: 'unknown', unsynced: false });
    expect(matchEnvironment({}, PROFILES)).toMatchObject({ kind: 'unknown', unsynced: true });
    expect(targetFromInput(' 22222222-2222-2222-2222-222222222222 ')).toEqual({ environmentId: '22222222-2222-2222-2222-222222222222' });
  });

  it('guards production and unprofiled environments', () => {
    const prod = matchEnvironment({ dataverseEndpoint: 'https://contoso.crm.dynamics.com/' }, PROFILES);
    const dev = matchEnvironment({ dataverseEndpoint: 'https://contoso-dev.crm.dynamics.com/' }, PROFILES);
    const unknown = matchEnvironment({ dataverseEndpoint: 'https://fabrikam.crm.dynamics.com/' }, PROFILES);
    const unsynced = matchEnvironment({}, PROFILES);
    expect(guardDecision(prod, 'confirm', false)).toEqual({ action: 'confirm', phrase: 'Contoso Prod' });
    expect(guardDecision(prod, 'block', false).action).toBe('block');
    expect(guardDecision(prod, 'off', true).action).toBe('allow');
    expect(guardDecision(dev, 'block', true).action).toBe('allow');
    expect(guardDecision(unknown, 'confirm', false).action).toBe('allow');
    expect(guardDecision(unknown, 'confirm', true)).toMatchObject({ action: 'block', reason: expect.stringContaining('(fabrikam.crm.dynamics.com)') });
    expect(guardDecision(unsynced, 'confirm', true)).toMatchObject({ action: 'block', reason: expect.stringMatching(/no sync metadata/) });
  });

  const agentFiles = (name: string, endpoint: string) => ({
    [`${name}/settings.mcs.yml`]: `displayName: ${name}\nschemaName: contoso_${name}\nconfiguration:\n  recognizer:\n    kind: CLICopilotRecognizer\n`,
    [`${name}/.mcs/conn.json`]: JSON.stringify({ DataverseEndpoint: endpoint, EnvironmentId: '33333333-3333-3333-3333-333333333333', AgentId: '44444444-4444-4444-4444-444444444444' })
  });

  it('reports each agent folder with its stage', () => {
    const root = fixture({ ...agentFiles('Hub', 'https://contoso.crm.dynamics.com/'), ...agentFiles('Spoke', 'https://contoso-dev.crm.dynamics.com/') });
    expect(environmentReport(loadWorkspace([root]).agents, PROFILES).map((r) => `${r.schemaName}=${r.kind}`)).toEqual(['contoso_Hub=prod', 'contoso_Spoke=dev']);
  });

  it('CLI env reads profiles from settings.json and denies stages', async () => {
    const root = fixture({
      ...agentFiles('Hub', 'https://contoso.crm.dynamics.com/'),
      ...agentFiles('Spoke', 'https://fabrikam.crm.dynamics.com/'),
      '.vscode/settings.json': `{\n  // workspace settings\n  "agentForge.environments": ${JSON.stringify(PROFILES)},\n}\n`
    });
    const run = async (argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runCli(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: root, version: '0' });
      return { code, out: out.join('\n'), err: err.join('\n') };
    };
    const r = await run(['env']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^prod\s+contoso_Hub\s+prod: Contoso Prod$/m);
    expect(r.out).toMatch(/^unknown\s+contoso_Spoke\s+no profile \(fabrikam.crm.dynamics.com\)$/m);
    expect((await run(['env', '--deny', 'prod'])).code).toBe(1);
    expect((await run(['env', '--deny', 'unknown', '--format', 'json'])).code).toBe(1);
    expect((await run(['env', '--deny', 'test'])).code).toBe(0);
    expect((await run(['env', '--deny', 'staging'])).code).toBe(2);
    writeFileSync(join(root, 'profiles.json'), JSON.stringify({ environments: PROFILES.slice(0, 1) }));
    expect(readProfiles(join(root, 'profiles.json'))).toHaveLength(1);
    expect((await run(['env', '--profiles', 'profiles.json', '--deny', 'prod'])).code).toBe(0);
  });
});
