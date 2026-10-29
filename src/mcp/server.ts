import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  analysisMarkdown,
  analyzeResults,
  atLeast,
  blueprintReadme,
  fixesFor,
  formatJson,
  generateTestSet,
  lint,
  loadWorkspace,
  planBlueprint,
  RULES,
  summary,
  testSetCsv,
  toMermaid,
  validateSpec,
  validateTestSet,
  type BlueprintSpec,
  type Severity
} from '../core';

/** Minimal, read-only Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0). */

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type ToolArgs = Record<string, unknown>;

const pathArg = {
  path: { type: 'string', description: 'Folder containing cloned Copilot Studio agents. Defaults to the server working directory.' }
};

export const TOOLS = [
  {
    name: 'list_rules',
    title: 'List lint rules',
    description: 'Lists every Agent Forge lint rule with id, severity, harness and rationale. Use when explaining a finding or choosing rules to disable.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'list_agents',
    title: 'List agents',
    description: 'Lists the Copilot Studio agents found under a folder with harness, schema name and component counts. Use when you need an inventory before reviewing or editing agents.',
    inputSchema: { type: 'object', properties: pathArg },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'lint',
    title: 'Lint agents',
    description: 'Runs the Agent Forge policy linter (routing, multi-agent depth, MCP allowlists, human in the loop, secrets, formatting) and returns findings with available quick fixes. Use after editing agent YAML and before pushing.',
    inputSchema: {
      type: 'object',
      properties: {
        ...pathArg,
        minSeverity: { type: 'string', enum: ['info', 'warning', 'error'], description: 'Lowest severity to return. Default info.' },
        disabledRules: { type: 'array', items: { type: 'string' }, description: 'Rule ids to skip.' }
      }
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'architecture_mermaid',
    title: 'Architecture as Mermaid',
    description: 'Returns the orchestrator and connected-agent architecture as a Mermaid flowchart. Use when documenting or reviewing a multi-agent design.',
    inputSchema: { type: 'object', properties: pathArg },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'generate_test_set',
    title: 'Draft evaluation test set',
    description: 'Drafts a Copilot Studio single-response test set (CSV with Question and Expected response) from an agent\'s routing descriptions plus safety cases. Use when preparing an evaluation run. Returns CSV text; nothing is written.',
    inputSchema: { type: 'object', properties: { ...pathArg, agent: { type: 'string', description: 'Schema name or display name. Defaults to the orchestrator.' } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'validate_test_set',
    title: 'Validate evaluation test set',
    description: 'Checks a test-set CSV against the Copilot Studio import rules (headers, 100 questions, 1,000 characters, 5 MB). Use before importing a test set.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'CSV path, relative to the server folder.' } }, required: ['file'] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'analyze_eval_results',
    title: 'Analyse evaluation results',
    description: 'Summarises a results CSV exported from the Copilot Studio Evaluate tab: pass rate per test method and failures grouped by triage category with advice. Use after an evaluation run.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'CSV path, relative to the server folder.' } }, required: ['file'] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'plan_blueprint',
    title: 'Plan an orchestrator blueprint',
    description: 'Plans a hub-and-spoke solution (orchestrator, read-only domain agents, one write agent): schema names, instructions and files. Use when designing a new multi-agent solution. Returns the plan; nothing is written.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string' },
        orchestrator: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' } }, required: ['name', 'purpose'] },
        spokes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' } }, required: ['name', 'purpose'] } },
        writer: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, operations: { type: 'array', items: { type: 'string' } } } }
      },
      required: ['prefix', 'orchestrator', 'spokes']
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
];

class ToolError extends Error {}

function folder(args: ToolArgs, cwd: string): string {
  const p = typeof args.path === 'string' && args.path.trim() ? resolve(cwd, args.path) : cwd;
  if (!existsSync(p)) throw new ToolError(`Folder not found: ${p}`);
  return p;
}

export function callTool(name: string, args: ToolArgs, cwd = process.cwd()): string {
  switch (name) {
    case 'list_rules':
      return JSON.stringify(RULES, null, 2);
    case 'list_agents': {
      const ws = loadWorkspace([folder(args, cwd)]);
      const agents = ws.agents.map((a) => ({
        name: a.name,
        schemaName: a.schemaName,
        harness: a.harness,
        root: a.root,
        components: a.components.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.category]: (acc[c.category] ?? 0) + 1 }), {}),
        connectedAgents: a.components.filter((c) => c.kind === 'ConnectedAgentTool').map((c) => c.targetAgentSchema ?? c.name)
      }));
      return JSON.stringify({ agents, parseErrors: ws.parseErrors.length }, null, 2);
    }
    case 'lint': {
      const root = folder(args, cwd);
      const ws = loadWorkspace([root]);
      const disabled = Array.isArray(args.disabledRules) ? args.disabledRules.map(String) : [];
      const min = (['info', 'warning', 'error'].includes(String(args.minSeverity)) ? args.minSeverity : 'info') as Severity;
      const findings = atLeast(lint(ws, { disabledRules: disabled }), min);
      const report = JSON.parse(formatJson(findings, root)) as { summary: ReturnType<typeof summary>; findings: Record<string, unknown>[] };
      report.findings.forEach((f, i) => {
        const fixes = fixesFor(findings[i], ws).map((x) => x.title);
        if (fixes.length) f.fixes = fixes;
      });
      return JSON.stringify(report, null, 2);
    }
    case 'architecture_mermaid':
      return toMermaid(loadWorkspace([folder(args, cwd)]));
    case 'generate_test_set': {
      const ws = loadWorkspace([folder(args, cwd)]);
      const wanted = typeof args.agent === 'string' ? args.agent : undefined;
      const agent = wanted
        ? ws.agents.find((a) => a.schemaName === wanted || a.name === wanted)
        : ws.agents.find((a) => a.components.some((c) => c.kind === 'ConnectedAgentTool')) ?? ws.agents[0];
      if (!agent) throw new ToolError(wanted ? `Agent not found: ${wanted}` : 'No agent found.');
      return testSetCsv(generateTestSet(agent, ws.agents));
    }
    case 'validate_test_set':
    case 'analyze_eval_results': {
      if (typeof args.file !== 'string') throw new ToolError('file is required.');
      const file = resolve(cwd, args.file);
      if (!existsSync(file)) throw new ToolError(`File not found: ${file}`);
      const text = readFileSync(file, 'utf8');
      return name === 'validate_test_set' ? JSON.stringify(validateTestSet(text, statSync(file).size), null, 2) : analysisMarkdown(analyzeResults(text));
    }
    case 'plan_blueprint': {
      const spec = { ...args, spokes: Array.isArray(args.spokes) ? args.spokes : [] } as unknown as BlueprintSpec;
      if (spec.writer && !Array.isArray(spec.writer.operations)) spec.writer.operations = [];
      const errors = validateSpec(spec);
      if (errors.length) throw new ToolError(errors.join('\n'));
      const plans = planBlueprint(spec);
      return JSON.stringify({ agents: plans.map((p) => ({ ...p, files: Object.keys(p.files) })), readme: blueprintReadme(spec, plans) }, null, 2);
    }
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
}

export function handleMessage(msg: JsonRpcRequest, version: string, cwd = process.cwd()): object | undefined {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agent-forge', title: 'Agent Forge for Copilot Studio', version },
        instructions: 'Read-only tools to inventory, lint and diagram Copilot Studio agents cloned to disk. Nothing is sent over the network.'
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as ToolArgs;
      if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`);
      try {
        return reply({ content: [{ type: 'text', text: callTool(name, args, cwd) }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      if (isNotification) return undefined;
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

export function runStdioServer(version: string, cwd = process.cwd()): Promise<void> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const send = (o: object) => process.stdout.write(JSON.stringify(o) + '\n');
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(line) as JsonRpcRequest;
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const res = handleMessage(msg, version, cwd);
      if (res) send(res);
    });
    rl.on('close', () => done());
  });
}
