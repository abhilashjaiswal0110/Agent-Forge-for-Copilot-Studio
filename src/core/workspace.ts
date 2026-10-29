import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { LineCounter, parseDocument } from 'yaml';
import type { AgentModel, Component, ComponentCategory, Harness, ParseError, SyncMetadata, WorkspaceModel } from './model';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.vscode-test']);

type Yaml = Record<string, unknown> | undefined;

export function readText(file: string): string {
  return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

export function readYaml(file: string, errors: ParseError[]): Yaml {
  let text: string;
  try {
    text = readText(file);
  } catch (e) {
    // For example cloud-only OneDrive placeholders or locked files; report and keep scanning.
    errors.push({ file, message: `File could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'}).`, line: 0 });
    return undefined;
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false, prettyErrors: false });
  if (doc.errors.length) {
    const e = doc.errors[0];
    errors.push({ file, message: e.message.split('\n')[0], line: lineCounter.linePos(e.pos[0]).line - 1 });
    return undefined;
  }
  const value = doc.toJS();
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

function collectDialogRefs(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => collectDialogRefs(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.kind === 'BeginDialog' && typeof o.dialog === 'string') out.push(o.dialog);
    Object.values(o).forEach((x) => collectDialogRefs(x, out));
  }
  return out;
}

function listYaml(dir: string, recursive = false): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...listYaml(full, true));
    else if (entry.isFile() && /\.(mcs\.yml|ya?ml)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** Finds agent roots: folders holding agent.mcs.yml or settings.mcs.yml (covers agent.sync.yaml layouts). */
export function findAgentRoots(root: string, maxDepth = 6): string[] {
  const roots: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, 'agent.mcs.yml')) || existsSync(join(dir, 'settings.mcs.yml'))) {
      roots.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return roots.sort();
}

export function detectHarness(root: string, settings: Yaml, agentYaml: Yaml): { harness: Harness; evidence: string[] } {
  const ghcp: string[] = [];
  const std: string[] = [];
  // workflows/ (cloud flows) appears in both harnesses, so it is not evidence either way.
  for (const d of ['behaviors', 'capabilities', 'infrastructure']) if (isDir(join(root, d))) ghcp.push(`${d}/`);
  for (const d of ['topics', 'actions', 'variables', 'agents']) if (isDir(join(root, d))) std.push(`${d}/`);
  const recognizer = str(get(settings, 'configuration', 'recognizer', 'kind'));
  if (recognizer === 'CLICopilotRecognizer') ghcp.push('recognizer CLICopilotRecognizer');
  if (recognizer === 'GenerativeAIRecognizer') std.push('recognizer GenerativeAIRecognizer');
  if (get(settings, 'configuration', 'agentSettings') !== undefined) ghcp.push('agentSettings');
  if (get(settings, 'configuration', 'settings', 'GenerativeActionsEnabled') !== undefined) std.push('GenerativeActionsEnabled');
  if (str(get(agentYaml, 'kind')) === 'GptComponentMetadata') std.push('GptComponentMetadata');

  const harness: Harness = ghcp.length && std.length ? 'mixed' : ghcp.length ? 'githubCopilot' : std.length ? 'standard' : 'unknown';
  return { harness, evidence: harness === 'githubCopilot' ? ghcp : harness === 'standard' ? std : [...ghcp, ...std] };
}

function readSync(root: string): SyncMetadata {
  const file = join(root, '.mcs', 'conn.json');
  if (!existsSync(file)) return {};
  try {
    const j = JSON.parse(readText(file)) as Record<string, unknown>;
    return {
      agentId: str(j.AgentId),
      environmentId: str(j.EnvironmentId),
      environmentDisplayName: str(j.EnvironmentDisplayName),
      dataverseEndpoint: str(j.DataverseEndpoint)
    };
  } catch {
    return {};
  }
}

function parseFrontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const hash = (s: string) => createHash('sha256').update(s.replace(/\r\n/g, '\n').trim()).digest('hex');

function metaComponent(category: ComponentCategory, file: string, y: Yaml, routable: boolean): Component {
  return {
    category,
    kind: str(get(y, 'kind')),
    name: str(get(y, 'mcs.metadata', 'componentName')) ?? basename(file).replace(/\.mcs\.yml$|\.ya?ml$/i, ''),
    description: str(get(y, 'mcs.metadata', 'description')),
    schemaName: str(get(y, 'mcs.metadata', 'schemaName')),
    file,
    routable
  };
}

function parseGithubCopilotComponents(root: string, errors: ParseError[]): Component[] {
  const out: Component[] = [];

  for (const file of listYaml(join(root, 'behaviors'), true).filter((f) => basename(f) === 'skill.mcs.yml')) {
    const y = readYaml(file, errors);
    if (!y) continue;
    const c = metaComponent('skill', file, y, true);
    const skillMd = join(dirname(file), 'SKILL.md');
    if (existsSync(skillMd)) {
      c.skillMdFile = skillMd;
      try {
        const text = readText(skillMd);
        c.skillMdDescription = parseFrontMatter(text).description;
        c.contentHash = hash(text);
      } catch (e) {
        errors.push({ file: skillMd, message: `File could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'}).`, line: 0 });
      }
    }
    out.push(c);
  }

  for (const file of listYaml(join(root, 'capabilities', 'tools'))) {
    const y = readYaml(file, errors);
    if (!y) continue;
    const c = metaComponent('tool', file, y, true);
    const allowed = get(y, 'allowedTools');
    if (Array.isArray(allowed)) c.allowedTools = allowed.map(String);
    c.toolPermissionMode = str(get(y, 'toolPermissionMode', 'kind'));
    c.targetAgentSchema = str(get(y, 'botSchemaName'));
    c.historyType = str(get(y, 'historyType', 'kind'));
    out.push(c);
  }

  for (const file of listYaml(join(root, 'capabilities', 'knowledge'))) {
    const y = readYaml(file, errors);
    if (y) out.push(metaComponent('knowledge', file, y, true));
  }

  for (const file of listYaml(join(root, 'workflows'), true)) {
    const y = readYaml(file, errors);
    if (y) out.push(metaComponent('workflow', file, y, true));
  }

  const connDir = join(root, 'infrastructure', 'connections');
  if (isDir(connDir)) {
    for (const f of readdirSync(connDir).sort()) {
      out.push({ category: 'connection', name: f, file: join(connDir, f), routable: false });
    }
  }
  return out;
}

function parseStandardComponents(root: string, errors: ParseError[]): Component[] {
  const out: Component[] = [];

  for (const file of listYaml(join(root, 'topics'), true)) {
    const y = readYaml(file, errors);
    if (!y) continue;
    const c = metaComponent('topic', file, y, false);
    const trigger = str(get(y, 'beginDialog', 'kind'));
    c.name = str(get(y, 'beginDialog', 'intent', 'displayName')) ?? c.name;
    c.description = str(get(y, 'beginDialog', 'intent', 'modelDescription')) ?? str(get(y, 'modelDescription')) ?? c.description;
    c.routable = trigger === 'OnRecognizedIntent';
    c.dialogRefs = collectDialogRefs(y);
    out.push(c);
  }

  for (const file of listYaml(join(root, 'actions'), true)) {
    const y = readYaml(file, errors);
    if (!y) continue;
    const c = metaComponent('action', file, y, true);
    c.name = str(get(y, 'modelDisplayName')) ?? c.name;
    c.description = str(get(y, 'modelDescription')) ?? c.description;
    out.push(c);
  }

  for (const file of listYaml(join(root, 'knowledge'), true)) {
    const y = readYaml(file, errors);
    if (y) out.push(metaComponent('knowledge', file, y, true));
  }

  for (const file of listYaml(join(root, 'variables'), true)) {
    const y = readYaml(file, errors);
    if (y) out.push(metaComponent('variable', file, y, false));
  }

  for (const file of listYaml(join(root, 'agents'), true)) {
    const y = readYaml(file, errors);
    if (!y) continue;
    const c = metaComponent('childAgent', file, y, true);
    c.description = str(get(y, 'modelDescription')) ?? c.description;
    out.push(c);
  }
  return out;
}

export function parseAgent(root: string, errors: ParseError[]): AgentModel {
  const settingsFile = existsSync(join(root, 'settings.mcs.yml')) ? join(root, 'settings.mcs.yml') : undefined;
  const agentFile = existsSync(join(root, 'agent.mcs.yml')) ? join(root, 'agent.mcs.yml') : undefined;
  const settings = settingsFile ? readYaml(settingsFile, errors) : undefined;
  const agentYaml = agentFile ? readYaml(agentFile, errors) : undefined;
  const { harness, evidence } = detectHarness(root, settings, agentYaml);

  const instructionSource = get(settings, 'configuration', 'agentSettings', 'instructions') ?? get(agentYaml, 'instructions');
  return {
    name: str(get(settings, 'displayName')) ?? str(get(agentYaml, 'mcs.metadata', 'componentName')) ?? basename(root),
    schemaName: str(get(settings, 'schemaName')),
    root,
    harness,
    harnessEvidence: evidence,
    settingsFile,
    agentFile,
    instructions: collectStrings(instructionSource).join('\n'),
    sync: readSync(root),
    components: [...parseGithubCopilotComponents(root, errors), ...parseStandardComponents(root, errors)]
  };
}

export function loadWorkspace(folders: string[]): WorkspaceModel {
  const parseErrors: ParseError[] = [];
  const agents = folders.flatMap((f) => findAgentRoots(f)).map((r) => parseAgent(r, parseErrors));
  return { agents, parseErrors };
}
