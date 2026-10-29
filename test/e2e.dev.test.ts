/**
 * Opt-in end-to-end round trip against a real dev environment (Phase 2 exit test).
 *
 *   $env:AGENT_FORGE_E2E_ENV = 'https://<dev-org>.crm.dynamics.com/'   # dev environment URL or id
 *   npx vitest run test/e2e.dev.test.ts
 *
 * Creates two scratch agents (hub + spoke) with `pac copilot init --environment`, applies an Agent Forge
 * blueprint, lints, pulls, pushes, publishes, pulls again and deletes both agents unless
 * AGENT_FORGE_E2E_KEEP=1. Requires a signed-in pac profile with maker rights in that environment.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyAgentPlan, lint, loadWorkspace, planBlueprint, type BlueprintSpec } from '../src/core';
import { pacArgs, pacInitArgs, pacSupports } from '../src/lifecycle/pacArgs';

const ENV = process.env.AGENT_FORGE_E2E_ENV;
const PAC = process.env.AGENT_FORGE_PAC ?? 'pac';
const KEEP = process.env.AGENT_FORGE_E2E_KEEP === '1';

function pac(args: string[], cwd?: string) {
  const windows = process.platform === 'win32';
  const quoted = windows ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const r = spawnSync(PAC, quoted, { cwd, encoding: 'utf8', shell: windows, timeout: 600_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!ENV)('dev environment round trip', () => {
  const stamp = Date.now().toString(36).slice(-5);
  const spec: BlueprintSpec = {
    prefix: 'afe2e',
    orchestrator: { name: `AF E2E Hub ${stamp}`, purpose: 'Scratch orchestrator for Agent Forge end-to-end tests; safe to delete' },
    spokes: [{ name: `AF E2E Spoke ${stamp}`, purpose: 'Scratch read-only domain agent for Agent Forge end-to-end tests' }]
  };
  const plans = planBlueprint(spec);
  const root = mkdtempSync(join(tmpdir(), 'af-e2e-'));
  const created: string[] = [];
  const dir = (name: string) => join(root, plans.find((p) => p.name === name)!.folder);

  afterAll(() => {
    // Delete the hub first: a spoke cannot be deleted while a connected-agent tool still references it.
    const failures: string[] = [];
    if (!KEEP) {
      for (const id of [...created].reverse()) {
        const r = pac(['copilot', 'delete', '--bot', id, '--environment', ENV!, '--confirm']);
        if (r.code !== 0) failures.push(`${id}: ${r.out.trim().split('\n').pop()}`);
      }
      // pac copilot init imports one solution per agent, named after the schema name.
      for (const p of [...plans].reverse()) {
        const r = pac(['solution', 'delete', '--solution-name', p.schemaName, '--environment', ENV!]);
        if (r.code !== 0) failures.push(`solution ${p.schemaName}: ${r.out.trim().split('\n').pop()}`);
      }
    }
    rmSync(root, { recursive: true, force: true });
    if (failures.length) throw new Error(`Scratch agents not deleted, remove them manually:\n${failures.join('\n')}`);
  });

  it('pac supports the sync verbs', () => {
    const help = pac(['copilot', 'help']).out;
    for (const step of ['pull', 'push', 'publish'] as const) expect(pacSupports(step, help), step).toBe(true);
  });

  it('bootstraps the agents, applies the blueprint and lints clean', () => {
    for (const p of plans) {
      const r = pac(pacInitArgs({ name: p.name, prefix: spec.prefix, schemaName: p.schemaName, projectDir: dir(p.name), environment: ENV! }));
      expect(r.code, r.out).toBe(0);
      const agent = loadWorkspace([dir(p.name)]).agents[0];
      expect(agent.sync.agentId, 'conn.json agent id').toBeTruthy();
      created.push(agent.sync.agentId!);
      applyAgentPlan(dir(p.name), p);
    }
    const ws = loadWorkspace([root]);
    expect(ws.agents.map((a) => a.harness)).toEqual(ws.agents.map(() => 'githubCopilot'));
    expect(lint(ws).filter((f) => f.severity !== 'info')).toEqual([]);
  }, 900_000);

  it('pulls, pushes spokes before the hub, publishes and pulls again', () => {
    const ordered = [...plans.filter((p) => p.role !== 'orchestrator'), ...plans.filter((p) => p.role === 'orchestrator')];
    for (const p of ordered) {
      const agent = loadWorkspace([dir(p.name)]).agents[0];
      const target = { root: agent.root, agentId: agent.sync.agentId, schemaName: agent.schemaName, environmentId: agent.sync.environmentId };
      for (const step of ['pull', 'push', 'publish', 'pull'] as const) {
        const r = pac(pacArgs(step, target), agent.root);
        expect(r.code, `${step} ${p.name}\n${r.out}`).toBe(0);
      }
      expect(readFileSync(join(agent.root, 'settings.mcs.yml'), 'utf8')).toContain('read-only');
    }
  }, 1_800_000);
});
