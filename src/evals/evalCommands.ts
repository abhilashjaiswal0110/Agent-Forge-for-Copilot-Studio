import * as path from 'node:path';
import * as vscode from 'vscode';
import { analysisMarkdown, analyzeResults, generateTestSet, parseCsvRows, testSetCsv, validateTestSet, type AgentModel } from '../core';
import type { Telemetry } from '../telemetry';

const isCsv = (u?: vscode.Uri) => !!u && /\.(csv|txt)$/i.test(u.fsPath);

async function pickCsv(arg: vscode.Uri | undefined, title: string): Promise<vscode.Uri | undefined> {
  if (isCsv(arg)) return arg;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (isCsv(active)) return active;
  const picked = await vscode.window.showOpenDialog({ title, canSelectMany: false, filters: { 'CSV files': ['csv', 'txt'] }, defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
  return picked?.[0];
}

async function readText(uri: vscode.Uri): Promise<{ text: string; bytes: number }> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { text: open.getText(), bytes: Buffer.byteLength(open.getText(), 'utf8') };
  const data = await vscode.workspace.fs.readFile(uri);
  return { text: new TextDecoder().decode(data), bytes: data.byteLength };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export class EvalCommands {
  constructor(
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly telemetry: Telemetry
  ) {}

  /** Drafts evals/<schema>-testset.csv for an agent and validates it. */
  async newTestSet(agent: AgentModel | undefined, all: AgentModel[]): Promise<vscode.Uri | undefined> {
    if (!agent) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(agent.root)) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    const cases = generateTestSet(agent, all);
    const base = (agent.schemaName ?? path.basename(agent.root)).replace(/[^A-Za-z0-9_-]/g, '_');
    let target = vscode.Uri.joinPath(folder.uri, 'evals', `${base}-testset.csv`);
    for (let i = 2; await exists(target); i++) target = vscode.Uri.joinPath(folder.uri, 'evals', `${base}-testset-${i}.csv`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, 'evals'));
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(testSetCsv(cases)));
    await vscode.window.showTextDocument(target);
    await this.validate(target, true);
    this.telemetry.event('command.newTestSet', { harness: agent.harness }, { cases: cases.length });
    void vscode.window.showInformationMessage(
      `Drafted ${cases.length} test case(s) for "${agent.name}". Edit the questions so they sound like real users, then import the file on the Copilot Studio Evaluate tab.`
    );
    return target;
  }

  /** Shows import-rule problems for a test-set CSV in the Problems panel. Returns the error count. */
  async validate(arg?: vscode.Uri, quiet = false): Promise<number> {
    const uri = await pickCsv(arg, 'Select an evaluation test set (CSV)');
    if (!uri) return 0;
    const { text, bytes } = await readText(uri);
    const issues = validateTestSet(text, bytes);
    const rows = parseCsvRows(text);
    this.diagnostics.set(
      uri,
      issues.map((i) => {
        const line = rows[i.row - 1]?.line ?? 0;
        const d = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
          i.message,
          i.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
        );
        d.source = 'Agent Forge evals';
        return d;
      })
    );
    const errors = issues.filter((i) => i.severity === 'error').length;
    this.telemetry.event('command.validateTestSet', undefined, { errors, warnings: issues.length - errors, rows: Math.max(rows.length - 1, 0) });
    if (!quiet) {
      if (errors) void vscode.window.showErrorMessage(`Test set has ${errors} error(s); see the Problems panel.`);
      else void vscode.window.showInformationMessage(`Test set is valid for import (${rows.length - 1} case(s)${issues.length ? `, ${issues.length} warning(s)` : ''}).`);
    }
    return errors;
  }

  /** Opens a Markdown triage report for a results CSV exported from the Evaluate tab. */
  async analyze(arg?: vscode.Uri): Promise<void> {
    const uri = await pickCsv(arg, 'Select evaluation results exported from Copilot Studio (CSV)');
    if (!uri) return;
    const { text } = await readText(uri);
    const a = analyzeResults(text);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: analysisMarkdown(a, `Evaluation results - ${path.basename(uri.fsPath)}`) });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('markdown.showPreviewToSide', doc.uri);
    const byCategory = Object.fromEntries(Object.entries(a.byCategory).map(([k, v]) => [`cat_${k}`, v ?? 0]));
    this.telemetry.event('command.analyzeResults', undefined, { total: a.total, passed: a.passed, failed: a.failed, ...byCategory });
  }
}
