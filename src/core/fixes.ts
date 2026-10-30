import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readText } from './workspace';
import type { Component, Finding, WorkspaceModel } from './model';

/** Replaces columns [startCol, endCol) on a 0-based line. Insert with startCol === endCol. */
export interface TextEdit {
  file: string;
  line: number;
  startCol: number;
  endCol: number;
  text: string;
}

export interface QuickFix {
  ruleId: string;
  title: string;
  /** Safe fixes only tighten or align content and are applied by `agent-forge lint --fix`. */
  safe: boolean;
  edits: TextEdit[];
  creates: { file: string; content: string }[];
}

export const FIXABLE_RULES = ['FMT002', 'SEC001', 'SEC002', 'HITL002', 'SEC004', 'SKL001', 'SKL002'] as const;

function lines(file: string): string[] {
  try {
    return readText(file).split(/\r?\n/);
  } catch {
    return [];
  }
}

function findComponent(ws: WorkspaceModel, file: string): Component | undefined {
  for (const a of ws.agents) {
    const c = a.components.find((x) => x.file === file);
    if (c) return c;
  }
  return undefined;
}

function replaceLine(file: string, line: number, text: string, before: string): TextEdit {
  return { file, line, startCol: 0, endCol: before.length, text };
}

/** Quotes a YAML scalar when plain style would be ambiguous. */
export function yamlScalar(s: string): string {
  return /^[\s'"&*!|>%@`#{[\]-]|: | #|[\r\n]|\s$/.test(s) ? JSON.stringify(s) : s;
}

export function fixesFor(finding: Finding, ws: WorkspaceModel): QuickFix[] {
  const src = lines(finding.file);
  const at = src[finding.line] ?? '';
  const fix = (title: string, safe: boolean, edits: TextEdit[], creates: QuickFix['creates'] = []): QuickFix[] => [
    { ruleId: finding.ruleId, title, safe, edits, creates }
  ];

  switch (finding.ruleId) {
    case 'FMT002': {
      const m = /^(\s*description:\s*)(.*)$/.exec(at);
      if (!m || !m[2].includes(': ')) return [];
      return fix('Replace ": " with " - " in the description', true, [replaceLine(finding.file, finding.line, m[1] + m[2].replace(/: /g, ' - '), at)]);
    }
    case 'SEC001': {
      if (src.some((l) => /^allowedTools:/.test(l))) return [];
      const text = 'allowedTools: []  # list only the operations this agent needs';
      const last = src.length - 1;
      const edit: TextEdit =
        last >= 0 && src[last] === ''
          ? { file: finding.file, line: last, startCol: 0, endCol: 0, text: `${text}\n` }
          : { file: finding.file, line: Math.max(last, 0), startCol: (src[last] ?? '').length, endCol: (src[last] ?? '').length, text: `\n${text}` };
      return fix('Add an empty allowedTools list (then list the operations this agent needs)', false, [edit]);
    }
    case 'SEC002':
    case 'HITL002': {
      const i = src.findIndex((l) => /^\s*kind:\s*AlwaysApprove\s*$/.test(l));
      if (i < 0) return [];
      return fix('Ask the user before each call (AlwaysAsk)', true, [replaceLine(finding.file, i, src[i].replace('AlwaysApprove', 'AlwaysAsk'), src[i])]);
    }
    case 'SEC004': {
      if (!/http:\/\//i.test(at)) return [];
      return fix('Switch the URL to https', false, [replaceLine(finding.file, finding.line, at.replace(/\bhttp:\/\/(?!localhost\b|127\.0\.0\.1\b)/gi, 'https://'), at)]);
    }
    case 'SKL001': {
      const c = findComponent(ws, finding.file);
      if (!c?.skillMdFile || !c.description) return [];
      const md = lines(c.skillMdFile);
      const i = md.findIndex((l, idx) => idx > 0 && /^description:/.test(l));
      if (i < 0) return [];
      return fix('Copy the skill.mcs.yml description into SKILL.md', true, [replaceLine(c.skillMdFile, i, `description: ${yamlScalar(c.description)}`, md[i])]);
    }
    case 'SKL002': {
      const c = findComponent(ws, finding.file);
      if (!c) return [];
      const file = join(dirname(finding.file), 'SKILL.md');
      if (existsSync(file)) return [];
      const description = c.description ?? 'Describe what this skill does. Use when ...';
      const content = `---\nname: ${yamlScalar(c.name)}\ndescription: ${yamlScalar(description)}\n---\n\n# ${c.name}\n\n1. Describe the steps this skill follows.\n`;
      return fix('Create SKILL.md from skill.mcs.yml', true, [], [{ file, content }]);
    }
    default:
      return [];
  }
}

/** Applies fixes to disk. Edits are applied bottom-up per file so earlier positions stay valid. Returns changed files. */
export function applyFixes(fixes: QuickFix[]): string[] {
  const byFile = new Map<string, TextEdit[]>();
  for (const f of fixes) for (const e of f.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  const changed: string[] = [];

  for (const [file, edits] of byFile) {
    const original = readFileSync(file, 'utf8');
    const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
    const raw = original.slice(bom.length);
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const src = raw.split(/\r?\n/);
    const seen = new Set<string>();
    const ordered = edits
      .filter((e) => {
        const key = `${e.line}:${e.startCol}:${e.endCol}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.line - a.line || b.startCol - a.startCol);
    for (const e of ordered) {
      while (src.length <= e.line) src.push('');
      const l = src[e.line];
      const replaced = l.slice(0, e.startCol) + e.text + l.slice(e.endCol);
      src.splice(e.line, 1, ...replaced.split('\n'));
    }
    writeFileSync(file, bom + src.join(eol));
    changed.push(file);
  }
  for (const f of fixes) {
    for (const c of f.creates) {
      // 'wx' creates atomically and fails if the file appeared meanwhile; never overwrite.
      try {
        writeFileSync(c.file, c.content, { flag: 'wx' });
        changed.push(c.file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }
  return changed;
}
