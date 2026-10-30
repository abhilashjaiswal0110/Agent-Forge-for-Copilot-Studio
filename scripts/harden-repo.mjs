// Applies the repository hardening baseline through the GitHub API (needs `gh` signed in as an admin).
// Idempotent: run it now and again right after the repository becomes public, because several
// protections are free only for public repositories.
//   node scripts/harden-repo.mjs            apply
//   node scripts/harden-repo.mjs --dry-run  print what would be applied
import { execFileSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');
const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8' }).trim();
const results = [];

function gh(method, path, body) {
  const args = ['api', '-X', method, `repos/${repo}${path}`, '-H', 'Accept: application/vnd.github+json'];
  if (body !== undefined) args.push('--input', '-');
  return execFileSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function step(name, fn) {
  if (dryRun) return void results.push(['plan', name]);
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    const text = `${e.stderr ?? ''}${e.stdout ?? ''}`;
    const reason = /Upgrade to GitHub Pro|not available|Advanced Security|must be public|only available|403|422/i.test(text) ? 'needs a public repository or a paid plan' : text.split('\n').find((l) => l.trim()) ?? String(e);
    results.push(['skip', `${name}: ${reason.trim().slice(0, 160)}`]);
  }
}

const visibility = JSON.parse(gh('GET', '')).visibility;
const owner = JSON.parse(execFileSync('gh', ['api', 'user'], { encoding: 'utf8' }));

// Workflows: read-only token by default, no PR approvals by Actions, only GitHub-owned actions pinned to SHAs.
step('Default GITHUB_TOKEN read-only; Actions cannot approve PRs', () =>
  gh('PUT', '/actions/permissions/workflow', { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }));
step('Allow only GitHub-owned actions, pinned to full commit SHAs', () => {
  gh('PUT', '/actions/permissions', { enabled: true, allowed_actions: 'selected', sha_pinning_required: true });
  gh('PUT', '/actions/permissions/selected-actions', { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [] });
});
step('Workflows from forks need approval for every outside contributor', () =>
  gh('PUT', '/actions/permissions/fork-pr-contributor-approval', { approval_policy: 'all_external_contributors' }));

// Repository settings and security features.
step('Delete head branches after merge; no auto-merge', () => gh('PATCH', '', { delete_branch_on_merge: true, allow_auto_merge: false }));
step('Secret scanning and push protection', () =>
  gh('PATCH', '', {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
      secret_scanning_non_provider_patterns: { status: 'enabled' },
      secret_scanning_validity_checks: { status: 'enabled' }
    }
  }));
step('Dependabot alerts', () => gh('PUT', '/vulnerability-alerts'));
step('Dependabot security updates', () => gh('PUT', '/automated-security-fixes'));
step('Private vulnerability reporting', () => gh('PUT', '/private-vulnerability-reporting'));
step('Immutable releases (assets and tags cannot change after publishing)', () => gh('PUT', '/immutable-releases'));

// Rulesets: protect main and release tags.
function ruleset(body) {
  const existing = JSON.parse(gh('GET', '/rulesets?per_page=100')).find((r) => r.name === body.name);
  if (existing) gh('PUT', `/rulesets/${existing.id}`, body);
  else gh('POST', '/rulesets', body);
}
step('Ruleset "main": PR + passing CI required, no force push, no deletion (no bypass)', () =>
  ruleset({
    name: 'main',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true
        }
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: 'build (ubuntu-latest)' }, { context: 'build (windows-latest)' }]
        }
      }
    ]
  }));
step('Ruleset "release tags": only admins create, move or delete v* tags', () =>
  ruleset({
    name: 'release tags',
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }]
  }));

// The publish environment: only v* tags, and the owner approves each Marketplace release.
step(`Environment "marketplace": v* tags only, ${owner.login} approves each publish`, () => {
  gh('PUT', '/environments/marketplace', {
    reviewers: [{ type: 'User', id: owner.id }],
    prevent_self_review: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
  });
  const policies = JSON.parse(gh('GET', '/environments/marketplace/deployment-branch-policies')).branch_policies ?? [];
  if (!policies.some((p) => p.name === 'v*' && p.type === 'tag')) gh('POST', '/environments/marketplace/deployment-branch-policies', { name: 'v*', type: 'tag' });
});

console.log(`${repo} (${visibility})${dryRun ? ' - dry run' : ''}`);
for (const [status, name] of results) console.log(`  ${status.padEnd(4)}  ${name}`);
const skipped = results.filter(([s]) => s === 'skip').length;
if (skipped) console.log(`\n${skipped} setting(s) skipped. Run this script again after making the repository public.`);
