// Runs inside VS Code against the installed Agent Forge VSIX. Uses only commands without modal dialogs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const ID = 'AbhilashJaiswal.cps-agent-forge';
const ws = process.env.AGENT_FORGE_INT_WORKSPACE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}

const forgeDiagnostics = () =>
  vscode.languages.getDiagnostics().flatMap(([uri, ds]) => ds.filter((d) => d.source === 'Agent Forge').map((d) => ({ uri, d })));

const tests = {
  async 'activates from the installed VSIX with all contributions'() {
    const ext = vscode.extensions.getExtension(ID);
    assert.ok(ext, `${ID} is installed`);
    await ext.activate();
    assert.equal(ext.isActive, true);
    const pkg = ext.packageJSON;
    assert.ok(pkg.icon && fs.existsSync(path.join(ext.extensionPath, pkg.icon)), 'icon is packaged');
    for (const f of ['dist/extension.js', 'dist/cli.js', 'plugin/plugin.json', 'snippets/copilot-studio.code-snippets', 'media/walkthrough/evaluate.md']) {
      assert.ok(fs.existsSync(path.join(ext.extensionPath, f)), `${f} is packaged`);
    }
    for (const r of fs.readdirSync(path.join(ext.extensionPath, 'plugin', 'recipes'))) assert.match(r, /\.prompt\.md$/);
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = pkg.contributes.commands.map((c) => c.command).filter((c) => !registered.has(c));
    assert.deepEqual(missing, [], 'every contributed command is registered');
    for (const step of pkg.contributes.walkthroughs[0].steps) assert.ok(fs.existsSync(path.join(ext.extensionPath, step.media.markdown)), step.id);
  },

  async 'lint publishes diagnostics for the sample'() {
    await vscode.commands.executeCommand('agentForge.lint');
    const diags = await waitFor(() => forgeDiagnostics().length && forgeDiagnostics(), 'Agent Forge diagnostics');
    assert.ok(diags.every(({ d }) => d.severity === vscode.DiagnosticSeverity.Information), 'sample has only info findings');
  },

  async 'offers and applies a quick fix'() {
    const file = path.join(ws, 'Contoso-Incidents', 'capabilities', 'knowledge', 'policies.mcs.yml');
    fs.writeFileSync(file, 'mcs.metadata:\n  componentName: Policies\n  description: "Policies: HR and IT"\nkind: KnowledgeSourceConfiguration\n');
    await vscode.commands.executeCommand('agentForge.refresh');
    const uri = vscode.Uri.file(file);
    const diag = await waitFor(() => vscode.languages.getDiagnostics(uri).find((d) => d.code === 'FMT002'), 'FMT002 diagnostic');
    const doc = await vscode.workspace.openTextDocument(uri);
    const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, diag.range, vscode.CodeActionKind.QuickFix.value);
    const fix = actions.find((a) => a.title.includes('Replace ": "'));
    assert.ok(fix, `quick fix offered (got: ${actions.map((a) => a.title).join(' | ')})`);
    assert.ok(actions.some((a) => a.title.startsWith('Disable rule FMT002')), 'disable action offered');
    assert.ok(await vscode.workspace.applyEdit(fix.edit));
    assert.match(doc.getText(), /description: "Policies - HR and IT"/);
    await doc.save();
    await vscode.commands.executeCommand('agentForge.refresh');
    await waitFor(() => !vscode.languages.getDiagnostics(uri).some((d) => d.code === 'FMT002'), 'FMT002 cleared');
  },

  async 'drafts and validates an evaluation test set'() {
    const orchestrator = vscode.Uri.file(path.join(ws, 'Contoso-Orchestrator', 'settings.mcs.yml'));
    const created = await vscode.commands.executeCommand('agentForge.newTestSet', orchestrator);
    assert.ok(created && fs.existsSync(created.fsPath), 'test set written');
    assert.match(fs.readFileSync(created.fsPath, 'utf8'), /^Question,Expected response\r\n/);
    const errors = await vscode.commands.executeCommand('agentForge.validateTestSet', created);
    assert.equal(errors, 0);
    const bad = path.join(ws, 'evals', 'bad.csv');
    fs.writeFileSync(bad, 'Prompt\nhello\n');
    assert.ok((await vscode.commands.executeCommand('agentForge.validateTestSet', vscode.Uri.file(bad))) > 0);
    assert.ok(vscode.languages.getDiagnostics(vscode.Uri.file(bad)).some((d) => d.source === 'Agent Forge evals'));
  },

  async 'analyses evaluation results into a Markdown report'() {
    const file = path.join(ws, 'evals', 'results.csv');
    fs.writeFileSync(file, "Question,Expected response,Test method,Agent's response,Result,Analysis\r\nq1,e,Compare meaning,ok,Pass,\r\nq2,e,Compare meaning,\"I'm sorry\",Fail,\r\n");
    await vscode.commands.executeCommand('agentForge.analyzeResults', vscode.Uri.file(file));
    const report = await waitFor(() => vscode.workspace.textDocuments.find((d) => d.languageId === 'markdown' && d.isUntitled && d.getText().includes('Evaluation results')), 'report');
    assert.match(report.getText(), /\*\*1\/2 passed \(50%\)\*\*/);
    assert.match(report.getText(), /no-answer/);
  },

  async 'contributes environment profile settings and accepts a profile'() {
    const cfg = vscode.workspace.getConfiguration('agentForge');
    assert.equal(cfg.inspect('productionGuard').defaultValue, 'confirm');
    assert.equal(cfg.inspect('requireEnvironmentProfile').defaultValue, false);
    assert.deepEqual(cfg.inspect('environments').defaultValue, []);
    const profiles = [{ name: 'Contoso Dev', kind: 'dev', url: 'https://contoso-dev.crm.dynamics.com/' }];
    await cfg.update('environments', profiles, vscode.ConfigurationTarget.Workspace);
    assert.deepEqual(vscode.workspace.getConfiguration('agentForge').get('environments'), profiles);
    await vscode.commands.executeCommand('agentForge.refresh');
  },

  async 'opens the walkthrough and graph without errors'() {
    await vscode.commands.executeCommand('agentForge.openWalkthrough');
    await vscode.commands.executeCommand('agentForge.showGraph');
  },

  async 'bundled CLI runs on the sample'() {
    const ext = vscode.extensions.getExtension(ID);
    const { execFileSync } = require('node:child_process');
    let out;
    try {
      out = execFileSync('node', [path.join(ext.extensionPath, 'dist', 'cli.js'), 'lint', ws, '--format', 'json', '--fail-on', 'never'], { encoding: 'utf8' });
    } catch (e) {
      if (e.code === 'ENOENT') return; // no Node.js on PATH in this environment
      throw e;
    }
    assert.equal(JSON.parse(out).summary.error, 0);
  }
};

exports.run = async function run() {
  const failures = [];
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failures.push(name);
      console.error(`  FAIL ${name}\n${e && e.stack ? e.stack : e}`);
    }
  }
  console.log(`${Object.keys(tests).length - failures.length}/${Object.keys(tests).length} integration tests passed`);
  if (failures.length) throw new Error(`Failed: ${failures.join(', ')}`);
};
