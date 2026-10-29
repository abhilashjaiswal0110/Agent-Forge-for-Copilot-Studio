## Run the same checks in CI

The extension ships a command-line tool with the same rules:

```bash
node dist/cli.js lint agents/ --format sarif --output agent-forge.sarif --fail-on error
node dist/cli.js eval validate evals/orchestrator-testset.csv
```

Upload the SARIF file to GitHub code scanning or Azure DevOps to see findings on pull
requests. Use `--fix` to apply safe fixes and `--disable DESC002,UX001` to skip rules.