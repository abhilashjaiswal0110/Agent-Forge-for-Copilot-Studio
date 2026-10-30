# Making the repository public

A one-time runbook. The goal is that nothing confidential is exposed and nobody, including a
compromised account token or workflow, can silently change `main`, release tags, releases or
the Marketplace listing.

## 1. Confirm nothing confidential is published (done 2026-10-30, repeat right before the switch)

Making a repository public exposes **every commit on every branch and tag**, pull request text,
release notes and Actions logs, not only the current files.

```powershell
git fetch --all --tags --prune
npm run scan            # working tree
npm run scan:history    # every file version and commit message on branches and tags
```

Both use the built-in checks (GUIDs, tenant hosts, emails) plus your private patterns from
`.denylist.local` (never committed) or the `DENYLIST_PATTERNS` secret. The scan never prints
the matched text.

Result on 2026-10-30:

- Working tree and all 174 published file versions and commit messages: clean.
- Commit author and committer emails: GitHub noreply addresses only.
- `.denylist.local`: never committed.
- PR descriptions, release notes and all Actions logs: no private patterns, tenant hosts,
  environment URLs, agent ids or usernames. Remaining GUIDs are GitHub runner ids.
- Local editor checkpoints (`refs/agents/*`) were never pushed; they are not published.

If a future scan finds something in history, do **not** just delete it in a new commit: rewrite
history (`git filter-repo`), force-push every branch and tag, delete stale PR refs by contacting
GitHub Support, and rotate anything that was a credential.

## 2. Settings that cannot be applied while private (free plan)

`node scripts/harden-repo.mjs` applies the whole baseline and reports what was skipped. Already
active: read-only default workflow token, only GitHub-owned actions pinned to SHAs, Dependabot
alerts and security updates, immutable releases, delete branches after merge.

Right after making the repository public, run it again. It adds:

| Protection | Effect |
|---|---|
| Ruleset `main` (no bypass) | Changes only through a pull request with passing `build (ubuntu-latest)` and `build (windows-latest)`; no force push, no deletion. |
| Ruleset `release tags` | Only admins can create, move or delete `v*` tags, so only admins can start a release. |
| Environment `marketplace` reviewer | Each publish waits for your approval, in addition to the `v*` tag restriction. |
| Secret scanning + push protection | Pushes containing credentials are blocked; history is scanned. |
| Fork pull request approval | Workflows from forks never run without your approval, and never see secrets. |
| Private vulnerability reporting | Reports arrive privately (see SECURITY.md). |

The CodeQL workflow, dependency review on pull requests and VSIX provenance attestations are
already in the workflows and switch on automatically when the repository is public.

## 3. The switch

1. Licence: MIT (chosen 2026-10-30, released in v0.4.2).
2. Run step 1 again.
3. Settings → General → Danger Zone → Change visibility → Public.
4. `node scripts/harden-repo.mjs` and check that every line says `ok`.
5. Settings → Code security: confirm secret scanning, push protection and private vulnerability
   reporting are on; enable "Code scanning → default setup" only if you remove `codeql.yml`.
6. Open a test pull request and confirm `main` cannot be pushed to directly.

## 4. Ongoing

- Keep two-factor authentication on the GitHub and Microsoft accounts; the Marketplace
  publisher has one owner.
- Never add collaborators with admin rights; give `write` if needed, and raise the `main`
  ruleset to one required approval with code-owner review.
- Dependabot opens weekly update pull requests for actions (SHA pins) and npm.
- Remove the `DENYLIST_PATTERNS` secret only if you stop using private patterns; forks never
  receive it.
