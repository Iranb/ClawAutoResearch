---
name: paper-plan
description: "Plan paper structure: claims-evidence matrix, section outline, figure plan. Validated by Cross-Reviewer before writing begins."
argument-hint: "[paper topic or empty to infer from NARRATIVE_REPORT.md]"
allowed-tools:
  - Read
  - Write
  - Grep
  - Glob
  - Agent
---

# Paper Plan

Build a paper outline from experiment results, then validate it with the Cross-Reviewer before any prose is written.

> **File ownership**: Write ONLY to `{PROJ}/academic_writer/`. Read from `{PROJ}/analyzer/`, `{PROJ}/reviewer/`, `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Input

- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — key results and analysis
- `{PROJ}/reviewer/AUTO_REVIEW.md` — reviewer feedback from experiment review cycle
- `{PROJ}/analyzer/figures/` — available figures
- `{PROJ}/researcher/LITERATURE.md` — related work landscape

## Process

### 1. Extract Claims

From `NARRATIVE_REPORT.md`, extract all claims the paper will make:
- Each claim must have a corresponding experiment result as evidence
- Build a Claims-Evidence matrix:

```markdown
| # | Claim | Evidence | Figure/Table | Section |
|---|-------|----------|-------------|---------|
| 1 | Proposed method outperforms baseline on X | Table 1: +2.3% ± 0.4 | Table 1 | §5.1 |
| 2 | Component Y is essential (ablation) | Table 2: -1.8% without Y | Table 2 | §5.2 |
| 3 | Method scales to larger datasets | Fig 3: consistent gains on Z | Fig 3 | §5.3 |
```

Flag any claim without evidence — either find evidence or remove the claim.

### 2. Section Outline

Write the section-level outline with concrete targets:

```markdown
## 1. Introduction (~1 page)
- Hook: [problem statement]
- Gap: [what existing methods miss]
- Contribution bullets: [3 contributions, each tied to a claim]
- Paper structure: 1 sentence per section

## 2. Related Work (~1 page)
- Sub-section A: [theme — cite top-5 from LITERATURE.md]
- Sub-section B: [theme]
- How our work differs: [explicit positioning statement]

## 3. Method (~2 pages)
- §3.1 Problem formulation (notation table)
- §3.2 [Core component 1] — ties to Claim 1
- §3.3 [Core component 2] — ties to Claim 2
- §3.4 Complexity analysis (time + space)

## 4. Experiments (~3 pages)
- §4.1 Setup (datasets, baselines, metrics, seeds)
- §4.2 Main results (Table 1 — Claim 1)
- §4.3 Ablation study (Table 2 — Claim 2)
- §4.4 Further analysis / scalability (Fig 3 — Claim 3)

## 5. Conclusion (~0.5 page)
- Summary, limitations, future work
```

### 3. Figure Plan

For each planned figure, specify:
```markdown
| Figure | Type | Data Source | Key Insight | Section |
|--------|------|-------------|-------------|---------|
| Fig 1 | Architecture diagram | N/A (to be drawn) | Overall framework | §3 |
| Fig 2 | Bar chart | results/main_comparison.json | +2.3% on CIFAR-100 | §4.2 |
| Fig 3 | Line plot | results/scaling_*.json | Consistent gains | §4.4 |
```

### 4. Cross-Reviewer Validation

Send the complete outline to the **Cross-Reviewer Agent**:

```
sessions_send agent="cross-reviewer":

CROSS_REVIEW_REQUEST
mode: outline
context: [research domain, target venue: NeurIPS/ICML/ICLR, stage: pre-writing]

Target venue: [venue]
Expected contribution type: [new method / new analysis / new benchmark / etc.]

Claims-Evidence Matrix:
[full matrix from Step 1]

Section Outline:
[full outline from Step 2]

Figure Plan:
[full figure plan from Step 3]

Key results summary:
[3-sentence summary of main experimental findings]

END_REQUEST
```

Wait for Cross-Reviewer response. Parse:
- **Overall quality** assessment
- **Missing elements** checklist → add missing experiments to TODOS.md if any
- **Priority fixes** list → resolve before writing begins

### 5. Resolve Blockers

For each item in Cross-Reviewer's "Priority Fixes":
1. If it requires a new experiment → add task to `{PROJ}/orchestrator/TODOS.md`, mark outline section as `[PENDING EXPERIMENT]`
2. If it's a structural fix → update the outline in-place
3. If it's minor → note as TODO for writing phase

Save the Cross-Reviewer outline response to `{PROJ}/cross-reviewer/outline/{date}.md`.

## Output

`{PROJ}/academic_writer/PAPER_PLAN.md` containing:
- Claims-Evidence Matrix (verified)
- Section Outline (validated by Cross-Reviewer)
- Figure Plan
- Cross-Reviewer assessment (appended verbatim)
- List of any pending experiments needed before writing
