import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINT_SERVER_ID, lintServer, mergeMcpConfig, mergeServer, parseMcpJson, PLAYWRIGHT_SERVER_ID, playwrightServer } from '../src/setup/mcpConfig';

describe('browser co-pilot MCP config', () => {
  it('uses an isolated profile by default and the extension bridge on request', () => {
    expect(playwrightServer('isolated').args).toContain('--isolated');
    expect(playwrightServer('isolated').args).not.toContain('--extension');
    expect(playwrightServer('extension').args).toContain('--extension');
    expect(playwrightServer('isolated').args.join(' ')).toContain('copilotstudio.microsoft.com');
  });

  it('merges without dropping other servers or inputs', () => {
    const existing = parseMcpJson(`{
      // user comment
      "inputs": [{ "id": "x" }],
      "servers": { "other": { "command": "node", "args": [] }, },
    }`);
    const merged = mergeMcpConfig(existing, 'isolated');
    expect(Object.keys(merged.servers ?? {})).toEqual(['other', PLAYWRIGHT_SERVER_ID]);
    expect(merged.inputs).toEqual([{ id: 'x' }]);
    expect(mergeMcpConfig(undefined, 'extension').servers?.[PLAYWRIGHT_SERVER_ID]).toEqual(playwrightServer('extension'));
  });

  it('treats an empty file as an empty config', () => {
    expect(parseMcpJson('\uFEFF  ')).toEqual({});
  });

  it('adds the Agent Forge lint server next to existing servers', () => {
    const merged = mergeServer(mergeMcpConfig(undefined, 'isolated'), LINT_SERVER_ID, lintServer('/ext/dist/cli.js'));
    expect(Object.keys(merged.servers ?? {})).toEqual([PLAYWRIGHT_SERVER_ID, LINT_SERVER_ID]);
    expect(lintServer('/ext/dist/cli.js')).toEqual({ type: 'stdio', command: 'node', args: ['/ext/dist/cli.js', 'mcp', '${workspaceFolder}'] });
  });
});

describe('bundled agent plugin', () => {
  const root = resolve(__dirname, '..', 'plugin');

  it('documents every lint rule in docs/RULES.md', async () => {
    const { RULES } = await import('../src/core');
    const doc = readFileSync(resolve(__dirname, '..', 'docs', 'RULES.md'), 'utf8');
    for (const r of RULES) expect(doc, r.id).toContain(`| ${r.id} |`);
  });

  it('ships a plugin manifest and MCP config that parse', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
    expect(manifest.name).toBeTruthy();
    expect(() => parseMcpJson(readFileSync(join(root, 'mcp.json'), 'utf8'))).not.toThrow();
  });

  it('every skill has SKILL.md front matter with a name matching its folder and a description', () => {
    const skills = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(skills.length).toBeGreaterThanOrEqual(3);
    for (const s of skills) {
      const file = join(root, 'skills', s.name, 'SKILL.md');
      expect(existsSync(file), file).toBe(true);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      expect(fm).toMatch(new RegExp(`^name:\\s*${s.name}\\s*$`, 'm'));
      expect(fm).toMatch(/^description:\s*\S.{40,}/m);
    }
  });
});
