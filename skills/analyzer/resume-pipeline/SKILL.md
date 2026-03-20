---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Analyzer. Resume analysis from existing artifacts and regenerate only missing figures, tables, or reports."
argument-hint: "[project id or empty to infer current project]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Resume Pipeline

Use when analysis stopped mid-run or when Researcher wants Analyzer to continue from existing results.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`
- `{PROJ}/researcher/artifacts/results/`
- `{PROJ}/researcher/artifacts/logs/`
- existing files under `{PROJ}/analyzer/`

## Resume Logic

1. Verify that experiment artifacts exist and are non-empty.
2. Detect which analysis outputs are already present:
   - `NARRATIVE_REPORT.md`
   - `CLAIM_EVIDENCE_MATRIX.md`
   - `TRACK_VERDICTS.md`
   - `UNSUPPORTED_CLAIMS.md`
   - `THEORY_SUPPORT_NOTE.md`
   - `figures/`, `tables/`
3. Regenerate only missing or obviously stale outputs.
4. If all outputs already exist, return `no-op` with a summary of what is ready.

## Safety Rules

- Do not rerun experiments.
- Do not overwrite complete outputs unless inputs changed materially or the user explicitly asks for regeneration.

## Output

```markdown
## Resume Status
- **Artifacts found**: [summary]
- **Outputs reused**: [list]
- **Outputs regenerated**: [list]
- **Next action**: [review / write / blocked]
```
