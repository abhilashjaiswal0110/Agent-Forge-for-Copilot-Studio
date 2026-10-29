# Contributor instructions

This repository is a **clean-room** VS Code extension for Microsoft Copilot Studio.

1. Never copy content from any customer or private solution: no agent names, tenant hosts,
   GUIDs, emails, list names or instruction text. Rewrite practices in generic terms and use the
   fictional Contoso domain for samples and tests.
2. Run `npm run scan`, `npm run typecheck`, `npm test` and `npm run build` before every commit.
3. Keep Copilot Studio schema knowledge in `src/core`; it must not import `vscode`.
4. Every new lint rule needs an entry in `RULES`, a row in `docs/RULES.md`, and a failing and a
   passing test fixture in `test/`.
5. Never send content in telemetry; events carry only counts, durations and enum values.
6. Commands that run external processes or write outside the workspace require workspace trust
   and an explicit confirmation.
