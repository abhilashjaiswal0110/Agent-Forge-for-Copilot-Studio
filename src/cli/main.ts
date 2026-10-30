import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  analysisMarkdown,
  analyzeResults,
  applyAgentPlan,
  applyFixes,
  atLeast,
  blueprintReadme,
  environmentReport,
  fixesFor,
  format,
  generateTestSet,
  issuesText,
  lint,
  loadWorkspace,
  planBlueprint,
  RULES,
  testSetCsv,
  toMermaid,
  TRIAGE_ADVICE,
  usableProfiles,
  validateProfiles,
  validateSpec,
  validateTestSet,
  type BlueprintSpec,
  type ReportFormat,
  type Severity
} from '../core';
import { parseMcpJson } from '../setup/mcpConfig';
import { runStdioServer } from '../mcp/server';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  version: string;
}

export const USAGE = `Agent Forge for Copilot Studio - command-line checks

Usage:
  agent-forge lint [folders...] [options]   Lint cloned agents (default folder: current directory)
  agent-forge rules [--format text|json]    List lint rules
  agent-forge graph [folders...]            Print the architecture as a Mermaid flowchart
  agent-forge mcp [folder]                  Start the read-only MCP server on stdio (default folder: current directory)
  agent-forge blueprint <spec.json> [--out <folder>]
                                            Generate an orchestrator, read-only domain agents and one write agent
  agent-forge eval generate [folder] [--agent <schemaName>] [--output <file.csv>]
                                            Draft a Copilot Studio test set (Question, Expected response)
  agent-forge eval validate <file.csv>      Check a test set against the Copilot Studio import rules
  agent-forge eval analyze <results.csv> [--format text|json|markdown]
                                            Triage results exported from the Evaluate tab
  agent-forge env [folders...] [--profiles <file.json>] [--deny <kinds>] [--format text|json]
                                            Show the environment stage (dev, test, prod) of each agent folder.
                                            Profiles come from --profiles or .vscode/settings.json
                                            (agentForge.environments). --deny prod,unknown exits 1 on a match.
  agent-forge --version | --help

Lint options:
  --format text|json|sarif   Output format (default text)
  --output <file>            Write the report to a file instead of stdout
  --fail-on error|warning|info|never
                             Exit with code 1 when findings at or above this severity exist (default error)
  --disable <ids>            Comma-separated rule ids to skip, for example DESC002,UX001
  --fix                      Apply safe quick fixes, then re-lint

Exit codes: 0 success, 1 findings at or above --fail-on, 2 usage error.`;

interface Parsed {
  command: string;
  folders: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['format', 'output', 'fail-on', 'disable', 'agent', 'out', 'profiles', 'deny']);

/** Reads profiles from a JSON array, an object with `environments`, or a VS Code settings file (comments allowed). */
export function readProfiles(file: string): unknown {
  const json = parseMcpJson(readFileSync(file, 'utf8')) as Record<string, unknown> | unknown[];
  if (Array.isArray(json)) return json;
  return json['agentForge.environments'] ?? json.environments ?? [];
}

export function parseArgs(argv: string[]): Parsed {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string | true>();
  const folders: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const inline = eq < 0 ? undefined : a.slice(eq + 1);
      if (VALUE_FLAGS.has(k)) {
        const v = inline ?? rest[++i];
        if (v === undefined) throw new Error(`--${k} needs a value`);
        flags.set(k, v);
      } else flags.set(k, true);
    } else folders.push(a);
  }
  return { command, folders, flags };
}

function oneOf<T extends string>(value: string | true | undefined, allowed: readonly T[], fallback: T, flag: string): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`--${flag} must be one of ${allowed.join(', ')}`);
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let p: Parsed;
  try {
    p = parseArgs(argv);
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  if (p.command === '--version' || p.command === '-v') {
    io.out(io.version);
    return 0;
  }
  if (p.command === 'help' || p.command === '--help' || p.command === '-h' || p.flags.has('help')) {
    io.out(USAGE);
    return 0;
  }

  const folders = (p.folders.length ? p.folders : ['.']).map((f) => resolve(io.cwd, f));
  try {
    switch (p.command) {
      case 'rules': {
        const fmt = oneOf(p.flags.get('format'), ['text', 'json'] as const, 'text', 'format');
        io.out(fmt === 'json' ? JSON.stringify(RULES, null, 2) : RULES.map((r) => `${r.id.padEnd(8)} ${r.severity.padEnd(8)} ${r.title}`).join('\n'));
        return 0;
      }
      case 'graph':
        io.out(toMermaid(loadWorkspace(folders)));
        return 0;
      case 'mcp':
        await runStdioServer(io.version, folders[0]);
        return 0;
      case 'lint': {
        const fmt = oneOf<ReportFormat>(p.flags.get('format'), ['text', 'json', 'sarif'], 'text', 'format');
        const failOn = oneOf(p.flags.get('fail-on'), ['error', 'warning', 'info', 'never'] as const, 'error', 'fail-on');
        const disable = p.flags.get('disable');
        const disabledRules = typeof disable === 'string' ? disable.split(',').map((s) => s.trim()).filter(Boolean) : [];

        let ws = loadWorkspace(folders);
        let findings = lint(ws, { disabledRules });
        if (p.flags.has('fix')) {
          const fixes = findings.flatMap((f) => fixesFor(f, ws)).filter((f) => f.safe);
          const changed = applyFixes(fixes);
          io.err(`Applied ${fixes.length} fix(es) to ${new Set(changed).size} file(s).`);
          ws = loadWorkspace(folders);
          findings = lint(ws, { disabledRules });
        }
        if (!ws.agents.length && !ws.parseErrors.length) io.err('No Copilot Studio agent found (looked for agent.mcs.yml or settings.mcs.yml).');

        const report = format(fmt, findings, io.cwd, io.version);
        const output = p.flags.get('output');
        if (typeof output === 'string') {
          writeFileSync(resolve(io.cwd, output), report + '\n');
          io.err(`Report written to ${output}.`);
        } else io.out(report);
        return failOn !== 'never' && atLeast(findings, failOn as Severity).length ? 1 : 0;
      }
      case 'blueprint': {
        if (!p.folders.length) throw new Error('Usage: agent-forge blueprint <spec.json> [--out <folder>]');
        const spec = JSON.parse(readFileSync(resolve(io.cwd, p.folders[0]), 'utf8')) as BlueprintSpec;
        spec.spokes ??= [];
        const errors = validateSpec(spec);
        if (errors.length) {
          io.err(errors.join('\n'));
          return 1;
        }
        const out = resolve(io.cwd, typeof p.flags.get('out') === 'string' ? (p.flags.get('out') as string) : '.');
        const plans = planBlueprint(spec);
        const clash = plans.find((a) => existsSync(join(out, a.folder)));
        if (clash) throw new Error(`Folder ${join(out, clash.folder)} already exists; choose another --out.`);
        for (const a of plans) applyAgentPlan(join(out, a.folder), a);
        writeFileSync(join(out, 'BLUEPRINT.md'), blueprintReadme(spec, plans));
        io.out(`Created ${plans.length} agent folder(s) in ${out}: ${plans.map((a) => a.folder).join(', ')}.`);
        return 0;
      }
      case 'eval': {
        const [sub, target] = p.folders;
        if (sub === 'generate') {
          const ws = loadWorkspace([resolve(io.cwd, target ?? '.')]);
          const wanted = p.flags.get('agent');
          const candidates = typeof wanted === 'string' ? ws.agents.filter((a) => a.schemaName === wanted || a.name === wanted) : ws.agents.filter((a) => a.components.some((c) => c.kind === 'ConnectedAgentTool'));
          const agent = candidates[0] ?? (ws.agents.length === 1 ? ws.agents[0] : undefined);
          if (!agent) throw new Error(ws.agents.length ? `Several agents found; pass --agent <schemaName> (${ws.agents.map((a) => a.schemaName ?? a.name).join(', ')}).` : 'No agent found.');
          const csv = testSetCsv(generateTestSet(agent, ws.agents));
          const output = p.flags.get('output');
          if (typeof output === 'string') {
            writeFileSync(resolve(io.cwd, output), csv);
            io.err(`Test set for "${agent.name}" written to ${output}. Review the drafted questions before importing.`);
          } else io.out(csv.trimEnd());
          return 0;
        }
        if (sub === 'validate' && target) {
          const file = resolve(io.cwd, target);
          const issues = validateTestSet(readFileSync(file, 'utf8'), statSync(file).size);
          io.out(issuesText(issues));
          return issues.some((i) => i.severity === 'error') ? 1 : 0;
        }
        if (sub === 'analyze' && target) {
          const fmt = oneOf(p.flags.get('format'), ['text', 'json', 'markdown'] as const, 'text', 'format');
          const a = analyzeResults(readFileSync(resolve(io.cwd, target), 'utf8'));
          if (fmt === 'json') io.out(JSON.stringify(a, null, 2));
          else if (fmt === 'markdown') io.out(analysisMarkdown(a));
          else {
            io.out(`${a.passed} passed, ${a.failed} failed, ${a.unknown} unknown of ${a.total}.`);
            for (const [c, n] of Object.entries(a.byCategory)) io.out(`  ${c.padEnd(10)} ${n}  ${TRIAGE_ADVICE[c as keyof typeof TRIAGE_ADVICE]}`);
            if (a.missingColumns.length) io.err(`Columns not found: ${a.missingColumns.join(', ')}.`);
          }
          return 0;
        }
        throw new Error('Usage: agent-forge eval generate [folder] | eval validate <file.csv> | eval analyze <results.csv>');
      }
      case 'env': {
        const fmt = oneOf(p.flags.get('format'), ['text', 'json'] as const, 'text', 'format');
        const explicit = p.flags.get('profiles');
        const settings = resolve(io.cwd, '.vscode', 'settings.json');
        const source = typeof explicit === 'string' ? resolve(io.cwd, explicit) : existsSync(settings) ? settings : undefined;
        const raw = source ? readProfiles(source) : [];
        for (const e of validateProfiles(raw)) io.err(`Ignored: ${e}`);
        const rows = environmentReport(loadWorkspace(folders).agents, usableProfiles(raw));
        const deny = typeof p.flags.get('deny') === 'string' ? (p.flags.get('deny') as string).split(',').map((s) => s.trim()) : [];
        const bad = deny.filter((d) => !['dev', 'test', 'prod', 'unknown'].includes(d));
        if (bad.length) throw new Error(`--deny accepts dev, test, prod, unknown (got ${bad.join(', ')})`);
        if (fmt === 'json') io.out(JSON.stringify(rows, null, 2));
        else {
          for (const r of rows) io.out(`${r.kind.padEnd(8)} ${(r.schemaName ?? r.agent).padEnd(40)} ${r.label}`);
          io.out(`${rows.length} agent(s); profiles from ${source ?? 'none'}.`);
        }
        const denied = rows.filter((r) => deny.includes(r.kind));
        if (denied.length) io.err(`${denied.length} agent(s) target a denied stage: ${denied.map((r) => r.schemaName ?? r.agent).join(', ')}.`);
        return denied.length ? 1 : 0;
      }
      default:
        io.err(`Unknown command "${p.command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
}
