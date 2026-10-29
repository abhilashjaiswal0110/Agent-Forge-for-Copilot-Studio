import * as vscode from 'vscode';
import { fixesFor, type Finding, type QuickFix, type WorkspaceModel } from '../core';

const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

export function toWorkspaceEdit(fixes: QuickFix[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  const seen = new Set<string>();
  for (const fix of fixes) {
    for (const e of fix.edits) {
      const key = `${e.file}|${e.line}|${e.startCol}|${e.endCol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edit.replace(vscode.Uri.file(e.file), new vscode.Range(e.line, e.startCol, e.line, e.endCol), e.text);
    }
    for (const c of fix.creates) {
      if (seen.has(c.file)) continue;
      seen.add(c.file);
      edit.createFile(vscode.Uri.file(c.file), { ignoreIfExists: true, contents: new TextEncoder().encode(c.content) });
    }
  }
  return edit;
}

/** Offers rule quick fixes plus "disable rule" for Agent Forge diagnostics. */
export class AgentForgeCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly state: () => { model: WorkspaceModel; findings: Finding[] }) {}

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const { model, findings } = this.state();
    const actions: vscode.CodeAction[] = [];
    for (const d of context.diagnostics) {
      if (d.source !== 'Agent Forge') continue;
      const ruleId = String(d.code);
      const finding = findings.find(
        (f) => f.ruleId === ruleId && f.line === d.range.start.line && f.message === d.message && samePath(f.file, document.uri.fsPath)
      );
      if (finding) {
        for (const fix of fixesFor(finding, model)) {
          const action = new vscode.CodeAction(`${fix.title} (${ruleId})`, vscode.CodeActionKind.QuickFix);
          action.edit = toWorkspaceEdit([fix]);
          action.diagnostics = [d];
          action.isPreferred = fix.safe;
          actions.push(action);
        }
      }
      const disable = new vscode.CodeAction(`Disable rule ${ruleId} in this workspace`, vscode.CodeActionKind.QuickFix);
      disable.command = { command: 'agentForge.disableRule', title: disable.title, arguments: [ruleId] };
      disable.diagnostics = [d];
      actions.push(disable);
    }
    return actions;
  }
}
