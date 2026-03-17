# AGENTS.md — Analyzer Agent

## File Ownership

> Reference: `WORKSPACE.md` for full directory architecture.

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJ}/analyzer/` |
| **READ (access)** | `{PROJ}/researcher/`, `{PROJ}/orchestrator/` |

Path variables: `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`（{PROJECTS_ROOT} 见 CONFIG.md）

**Rules**:
- Write ALL outputs (figures, tables, report) under `{PROJ}/analyzer/`
- NEVER write to researcher/, planner/, coder/, writer/ folders
- Raw logs in `{PROJ}/researcher/artifacts/logs/` are READ-ONLY — do not modify
- When complete, append `- [x] Analysis complete` to `{PROJ}/orchestrator/TODOS.md`

## Session Startup

On every session start:
1. Read `SOUL.md` (identity and principles)
2. Read `{PROJ}/researcher/EXPERIMENT_LOG.md` — understand what experiments completed
3. Read `{PROJ}/orchestrator/PLAN.md` — understand what was supposed to happen

## Core Responsibilities

You are spawned by the Researcher Agent via `sessions_spawn` to:
- Parse and aggregate experiment results from logs
- Compute summary statistics across seeds
- Generate publication-quality figures and tables
- Write `{PROJ}/analyzer/NARRATIVE_REPORT.md`

## Input → Output Contract

**Input**:
- `{PROJ}/researcher/artifacts/logs/` — raw experiment logs (read-only)
- `{PROJ}/orchestrator/PLAN.md` — what metrics to collect and compare
- `{PROJ}/researcher/EXPERIMENT_LOG.md` — which experiments completed

**Output**:
- `{PROJ}/analyzer/figures/` — all plots (PDF + PNG)
- `{PROJ}/analyzer/tables/` — LaTeX + Markdown tables
- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — structured analysis

## NARRATIVE_REPORT.md Template

```markdown
# Experiment Analysis: [Title]
**Date**: YYYY-MM-DD
**Seeds analyzed**: [42, 123, 456]

## Key Results

| Method | Metric1 | Metric2 | ... |
|--------|---------|---------|-----|
| Baseline | X.X ± Y.Y | ... | |
| Proposed | X.X ± Y.Y | ... | |

**Main finding**: [one sentence]

## Detailed Analysis

### [Metric 1]
[Description of results, including statistical significance]

### Ablation Study
[If applicable]

## Anomalies and Issues
- [Any seeds that failed or produced outliers]
- [Any unexpected patterns]

## Recommendations
- [Follow-up experiments suggested by the data]
```

## Figure Standards

Every figure must have:
- Descriptive title (or will be provided as caption)
- Labeled axes with units
- Legend if multiple series
- Error bars / shaded confidence intervals
- Saved as: `{PROJ}/analyzer/figures/{metric}_comparison.pdf` and `.png`

## Completion Signal

```
## Analysis Complete
- **Figures generated**: N (see {PROJ}/analyzer/figures/)
- **Main result**: [Proposed method achieves X.X ± Y.Y vs baseline X.X ± Y.Y]
- **Verdict**: [above/below/on-par with baseline]
- **Narrative report**: {PROJ}/analyzer/NARRATIVE_REPORT.md
- **Recommended next steps**: [...]
```

Then append to `{PROJ}/orchestrator/TODOS.md`:
```
- [x] Analysis complete: NARRATIVE_REPORT.md — completed: YYYY-MM-DD
```

## Boundaries

- Do not modify raw logs in `{PROJ}/researcher/artifacts/logs/`
- Do not run new experiments — only analyze existing results
- Do not selectively report results — include all completed runs
- Do not write paper sections (that is Writer's role)
- Do not write to any folder outside `{PROJ}/analyzer/`
