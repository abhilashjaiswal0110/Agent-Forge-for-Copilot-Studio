import type { AgentModel, SyncMetadata } from './model';

/** Environment profiles map Dataverse environments to a stage so lifecycle steps can be guarded. */
export type EnvironmentKind = 'dev' | 'test' | 'prod';
export const ENVIRONMENT_KINDS: EnvironmentKind[] = ['dev', 'test', 'prod'];

export interface EnvironmentProfile {
  /** Short label, for example "Contoso Dev". */
  name: string;
  kind: EnvironmentKind;
  /** Dataverse URL, for example https://contoso-dev.crm.dynamics.com/ */
  url?: string;
  /** Environment id (GUID) as stored in .mcs/conn.json. */
  id?: string;
}

export interface EnvironmentMatch {
  kind: EnvironmentKind | 'unknown';
  profile?: EnvironmentProfile;
  /** True when the agent folder has no sync metadata (never cloned or initialised against an environment). */
  unsynced: boolean;
  label: string;
}

export type GuardMode = 'confirm' | 'block' | 'off';
export type GuardDecision = { action: 'allow' } | { action: 'confirm'; phrase: string } | { action: 'block'; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-case host of a URL or bare host; undefined when it does not look like one. */
export function hostOf(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return new URL(/^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function validateProfiles(profiles: unknown): string[] {
  if (!Array.isArray(profiles)) return ['agentForge.environments must be an array.'];
  const errors: string[] = [];
  const names = new Set<string>();
  const targets = new Map<string, string>();
  profiles.forEach((p: Partial<EnvironmentProfile>, i) => {
    const at = `Profile ${i + 1}${p?.name ? ` ("${p.name}")` : ''}`;
    if (!p || typeof p !== 'object') return void errors.push(`${at} must be an object.`);
    if (!p.name?.trim()) errors.push(`${at} needs a name.`);
    else if (names.has(p.name.trim().toLowerCase())) errors.push(`${at}: duplicate name.`);
    else names.add(p.name.trim().toLowerCase());
    if (!ENVIRONMENT_KINDS.includes(p.kind as EnvironmentKind)) errors.push(`${at}: kind must be dev, test or prod.`);
    if (!p.url && !p.id) errors.push(`${at} needs a url or an id.`);
    if (p.url && (!/^https:\/\//i.test(p.url) || !hostOf(p.url))) errors.push(`${at}: url must be an https URL.`);
    if (p.id && !GUID.test(p.id)) errors.push(`${at}: id must be an environment GUID.`);
    for (const key of [p.id?.toLowerCase(), hostOf(p.url)]) {
      if (!key) continue;
      if (targets.has(key) && targets.get(key) !== p.name) errors.push(`${at} points at the same environment as "${targets.get(key)}".`);
      targets.set(key, p.name ?? '');
    }
  });
  return errors;
}

/** Valid profiles only; invalid entries are ignored so one typo does not disable every guard. */
export function usableProfiles(profiles: unknown): EnvironmentProfile[] {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter(
    (p): p is EnvironmentProfile =>
      !!p && typeof p === 'object' && typeof p.name === 'string' && !!p.name.trim() && ENVIRONMENT_KINDS.includes(p.kind) && (GUID.test(p.id ?? '') || !!hostOf(p.url))
  );
}

/** Matches a target (agent sync metadata, or a URL or id typed by the user) to a profile. */
export function matchEnvironment(target: Pick<SyncMetadata, 'environmentId' | 'dataverseEndpoint'>, profiles: EnvironmentProfile[]): EnvironmentMatch {
  const id = target.environmentId?.toLowerCase();
  const host = hostOf(target.dataverseEndpoint);
  if (!id && !host) return { kind: 'unknown', unsynced: true, label: 'not synced' };
  const profile =
    profiles.find((p) => id && p.id?.toLowerCase() === id) ?? profiles.find((p) => host && hostOf(p.url) === host);
  if (profile) return { kind: profile.kind, profile, unsynced: false, label: `${profile.kind}: ${profile.name}` };
  return { kind: 'unknown', unsynced: false, label: `no profile (${host ?? id})` };
}

/** A URL or GUID typed by the user, as a match target. */
export function targetFromInput(value: string): Pick<SyncMetadata, 'environmentId' | 'dataverseEndpoint'> {
  return GUID.test(value.trim()) ? { environmentId: value.trim() } : { dataverseEndpoint: value.trim() };
}

/**
 * Decides whether a step that changes an environment may run.
 * Production: `confirm` asks the user to type the profile name, `block` refuses, `off` allows.
 * Environments without a profile are refused when `requireProfile` is set.
 */
export function guardDecision(match: EnvironmentMatch, mode: GuardMode, requireProfile: boolean): GuardDecision {
  if (match.kind === 'prod') {
    if (mode === 'block') return { action: 'block', reason: `"${match.profile!.name}" is a production environment and agentForge.productionGuard is "block". Promote through a pipeline or change the setting.` };
    if (mode === 'confirm') return { action: 'confirm', phrase: match.profile!.name };
    return { action: 'allow' };
  }
  if (match.kind === 'unknown' && requireProfile) {
    return {
      action: 'block',
      reason: match.unsynced
        ? 'This agent folder has no sync metadata (.mcs/conn.json), so its environment cannot be checked. Clone it with pac copilot clone.'
        : `The target environment (${match.label.replace(/^no profile \(|\)$/g, '')}) has no environment profile and agentForge.requireEnvironmentProfile is on. Add a profile first.`
    };
  }
  return { action: 'allow' };
}

export interface AgentEnvironmentRow {
  agent: string;
  schemaName?: string;
  kind: EnvironmentMatch['kind'];
  label: string;
}

export function environmentReport(agents: AgentModel[], profiles: EnvironmentProfile[]): AgentEnvironmentRow[] {
  return agents.map((a) => {
    const m = matchEnvironment(a.sync, profiles);
    return { agent: a.name, schemaName: a.schemaName, kind: m.kind, label: m.label };
  });
}
