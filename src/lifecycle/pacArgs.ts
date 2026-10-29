/** Builds Power Platform CLI arguments. Pure so it can be unit-tested without VS Code. */
export type LifecycleStep = 'pull' | 'push' | 'publish';

export interface PacTarget {
  root: string;
  agentId?: string;
  schemaName?: string;
  environmentId?: string;
}

export function pacArgs(step: LifecycleStep, t: PacTarget): string[] {
  switch (step) {
    case 'pull':
      return ['copilot', 'pull', '--project-dir', t.root];
    case 'push':
      return ['copilot', 'push', '--project-dir', t.root];
    case 'publish': {
      const bot = t.agentId ?? t.schemaName;
      if (!bot) throw new Error('Cannot publish: no agent ID in .mcs/conn.json and no schemaName in settings.mcs.yml.');
      const args = ['copilot', 'publish', '--bot', bot];
      if (t.environmentId) args.push('--environment', t.environmentId);
      return args;
    }
  }
}

/**
 * True when `pac copilot help` output lists the verb a step needs. `pull` and `push` only exist in
 * recent Power Platform CLI releases; `publish` has been available for a long time.
 */
export function pacSupports(step: LifecycleStep, copilotHelp: string): boolean {
  return new RegExp(`^\\s*${step}\\b`, 'm').test(copilotHelp) || new RegExp(`\\[${step}\\]`).test(copilotHelp);
}

export function pacVersion(text: string): string | undefined {
  return /Version:\s*([\d.]+)/.exec(text)?.[1];
}
