// Clean-room leak gate. Fails when tracked files contain private identifiers.
// Built-in generic checks + private patterns from DENYLIST_PATTERNS (CI secret) or .denylist.local (git-ignored).
// Pattern format: one JavaScript regex per line (case-insensitive); blank lines and lines starting with # are ignored.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const SKIP = [/^package-lock\.json$/, /\.(png|jpg|jpeg|gif|ico|vsix|zip)$/i, /^scripts\/denylist-scan\.mjs$/];

const builtIn = [
  {
    id: 'GUID',
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    allow: (m) => /^([0-9a-f])\1{7}-/i.test(m) // placeholder GUIDs such as 11111111-1111-...
  },
  {
    id: 'TENANT_HOST',
    re: /\b[a-z0-9-]+\.(sharepoint\.com|crm\d*\.dynamics\.com|api\.powerplatform\.com)\b/gi,
    allow: (m) => /^(contoso|fabrikam|example)/i.test(m)
  },
  {
    id: 'EMAIL',
    re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    allow: (m) => /@(example\.(com|org)|contoso\.com|fabrikam\.com|users\.noreply\.github\.com)$/i.test(m)
  }
];

function loadPrivatePatterns() {
  const sources = [];
  if (process.env.DENYLIST_PATTERNS) sources.push(process.env.DENYLIST_PATTERNS);
  if (existsSync('.denylist.local')) sources.push(readFileSync('.denylist.local', 'utf8'));
  return sources
    .flatMap((s) => s.split(/\r?\n/))
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((p, i) => ({ id: `PRIVATE_${i + 1}`, re: new RegExp(p, 'gi'), allow: () => false }));
}

const history = process.argv.includes('--history');
const privatePatterns = loadPrivatePatterns();
const rules = [...builtIn, ...privatePatterns];
const findings = [];

function scanText(label, text) {
  text.split(/\r?\n/).forEach((line, idx) => {
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        if (!rule.allow(m[0])) findings.push(`${label}:${idx + 1} [${rule.id}]`);
      }
    }
  });
}

let scanned = 0;
if (history) {
  // Every file version and commit message reachable from a branch or tag: what a public repo exposes.
  // Local-only refs (for example editor or agent checkpoints under refs/agents) are never pushed.
  // HEAD covers the detached merge commit that CI checks out for pull requests, including forks.
  const PUBLISHED = ['--branches', '--remotes', '--tags', 'HEAD'];
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  const blobs = new Map();
  for (const line of git(['rev-list', ...PUBLISHED, '--objects']).split(/\r?\n/)) {
    const [sha, ...rest] = line.split(' ');
    const path = rest.join(' ');
    if (sha && path && !blobs.has(sha)) blobs.set(sha, path);
  }
  for (const [sha, path] of blobs) {
    if (SKIP.some((r) => r.test(path)) || git(['cat-file', '-t', sha]).trim() !== 'blob') continue;
    const buf = execFileSync('git', ['cat-file', 'blob', sha], { maxBuffer: 1 << 30 });
    if (buf.includes(0)) continue; // binary
    scanText(`${path}@${sha.slice(0, 8)}`, buf.toString('utf8'));
    scanned++;
  }
  for (const c of git(['rev-list', ...PUBLISHED]).split(/\r?\n/).filter(Boolean)) {
    scanText(`commit ${c.slice(0, 8)} message`, git(['log', '-1', '--format=%B', c]));
    scanned++;
  }
} else {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((f) => f && !SKIP.some((r) => r.test(f)) && existsSync(f));
  for (const file of files) scanText(file, readFileSync(file, 'utf8'));
  scanned = files.length;
}

if (privatePatterns.length === 0) {
  console.warn('denylist-scan: no private patterns loaded (set DENYLIST_PATTERNS or create .denylist.local).');
}
if (findings.length) {
  // Matched text is intentionally not printed so the gate itself never leaks identifiers into logs.
  console.error(`denylist-scan: ${findings.length} finding(s):\n${[...new Set(findings)].join('\n')}`);
  process.exit(1);
}
console.log(`denylist-scan: ${scanned} ${history ? 'blobs and commit messages in history' : 'files'} clean (${rules.length} rules).`);
