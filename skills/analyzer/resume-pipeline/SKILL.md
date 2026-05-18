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
  - research_workflow
---

# Resume Pipeline

Use when analysis stopped mid-run or when Researcher wants Analyzer to continue from existing results.

## Research Rigor Constraints

- Preserve **one variable per experiment** when reconstructing comparisons; keep attribution tied to the original hypothesis and bundle.
- **Record everything** you reuse versus regenerate so later review can audit the resume pass.
- Keep the **experiment and code change linked** by regenerating outputs from the recorded artifacts, not memory.
- **Verify before claiming** an analysis output is complete; stale inputs or missing scripts mean the output is not trustworthy yet.
- **Never manipulate evaluation** while resuming: do not silently change the metric view, baseline set, or aggregation rule.
- **Never fabricate citations** in regenerated narratives or notes.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`
- `{PROJ}/researcher/artifacts/results/`
- `{PROJ}/researcher/artifacts/logs/`
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json`
- `{PROJ}/researcher/evaluation_summary.json`
- existing files under `{PROJ}/analyzer/`

## Resume Logic

1. Verify that `PROJECT_MANIFEST.json.workflow_control` or the current Workflow Guard snapshot routes work to Analyzer; if ownership is stale, report the blocker instead of taking over.
2. Verify that experiment artifacts exist and are non-empty.
3. Detect which analysis outputs are already present:
   - `NARRATIVE_REPORT.md`
   - `CLAIM_EVIDENCE_MATRIX.md`
   - `TRACK_VERDICTS.md`
   - `UNSUPPORTED_CLAIMS.md`
   - `THEORY_SUPPORT_NOTE.md`
   - `THEORY_STATE.json`
   - `proof-packets/`
   - `figures/`, `tables/`
4. If `experiment_search.status` is `ready_for_analysis` and the standard analyzer packets are missing or stale, call `research_workflow.materialize_analysis_artifacts` before manual regeneration. Treat it as workflow-owned repair from synced experiment evidence; inspect its output and do not treat it as a separate completion authority.
5. Regenerate only missing or obviously stale outputs.
6. If all outputs already exist, return `no-op` with a summary of what is ready.

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
