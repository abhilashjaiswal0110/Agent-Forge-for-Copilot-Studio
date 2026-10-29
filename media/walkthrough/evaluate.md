## Evaluate

1. **New Evaluation Test Set** drafts `evals/<agent>-testset.csv` with one routing case per
   component plus safety cases (confirmation, out of scope, prompt injection). Rewrite the
   questions the way real users ask them.
2. **Validate Evaluation CSV** checks the Copilot Studio import rules: `Question` and
   `Expected response` headers, at most 100 questions of up to 1,000 characters, 5 MB.
3. Import the file on the **Evaluate** tab in Copilot Studio (or run the browser recipe
   *import-eval-test-set*), run it and export the results.
4. **Analyse Evaluation Results** shows the pass rate per test method and groups failures into
   no-answer, error, safety, grounding, partial and mismatch, with what to fix for each.