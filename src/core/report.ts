import { relative, sep } from 'node:path';
import { RULES } from './rules';
import type { Finding, Severity } from './model';

export type ReportFormat = 'text' | 'json' | 'sarif';

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export function atLeast(findings: Finding[], threshold: Severity): Finding[] {
  return findings.filter((f) => RANK[f.severity] >= RANK[threshold]);
}

const rel = (file: string, cwd: string) => {
  const r = relative(cwd, file);
  return (r && !r.startsWith('..') ? r : file).split(sep).join('/');
};

export function summary(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

export function formatText(findings: Finding[], cwd: string): string {
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  const lines = sorted.map((f) => `${rel(f.file, cwd)}:${f.line + 1}  ${f.severity.padEnd(7)}  ${f.ruleId.padEnd(7)}  ${f.message}`);
  const s = summary(findings);
  lines.push(`${findings.length} finding(s): ${s.error} error(s), ${s.warning} warning(s), ${s.info} info.`);
  return lines.join('\n');
}

export function formatJson(findings: Finding[], cwd: string): string {
  return JSON.stringify({ summary: summary(findings), findings: findings.map((f) => ({ ...f, file: rel(f.file, cwd), line: f.line + 1 })) }, null, 2);
}

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

/** SARIF 2.1.0 for GitHub code scanning and Azure DevOps. */
export function formatSarif(findings: Finding[], cwd: string, version: string): string {
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Agent Forge for Copilot Studio',
            version,
            rules: RULES.map((r) => ({
              id: r.id,
              name: r.title.replace(/[^A-Za-z0-9]+/g, ''),
              shortDescription: { text: r.title },
              fullDescription: { text: r.rationale },
              defaultConfiguration: { level: LEVEL[r.severity] }
            }))
          }
        },
        results: findings.map((f) => ({
          ruleId: f.ruleId,
          level: LEVEL[f.severity],
          message: { text: f.message },
          locations: [{ physicalLocation: { artifactLocation: { uri: rel(f.file, cwd) }, region: { startLine: f.line + 1 } } }]
        }))
      }
    ]
  };
  return JSON.stringify(sarif, null, 2);
}

export function format(kind: ReportFormat, findings: Finding[], cwd: string, version: string): string {
  return kind === 'json' ? formatJson(findings, cwd) : kind === 'sarif' ? formatSarif(findings, cwd, version) : formatText(findings, cwd);
}
