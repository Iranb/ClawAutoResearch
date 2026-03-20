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
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` — authoritative claim support ledger from Analyzer
- `{PROJ}/analyzer/TRACK_VERDICTS.md` — which tracks are writing-safe to foreground
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md` — claims that cannot yet be elevated
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md` — advisory theory / mechanism signal
- `{PROJ}/CLAIM_POLICY.md` — label-to-wording constraints
- `{PROJ}/reviewer/AUTO_REVIEW.md` — reviewer feedback from experiment review cycle
- `{PROJ}/analyzer/figures/` — available figures
- `{PROJ}/researcher/LITERATURE.md` — related work landscape

## Process

### 1. Extract Claims

Start from `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`, not from free-form memory:
- preserve `SUPPORTED / PARTIAL / UNSUPPORTED` labels
- each primary paper claim must map to concrete evidence
- if a claim is `UNSUPPORTED`, it cannot remain a headline contribution
- only claims from tracks endorsed by `TRACK_VERDICTS.md` may become paper contributions
- build or refine the Claims-Evidence matrix used by the writer:

```markdown
| # | Claim | Evidence | Figure/Table | Section |
|---|-------|----------|-------------|---------|
| 1 | Proposed method outperforms baseline on X | Table 1: +2.3% ± 0.4 | Table 1 | §5.1 |
| 2 | Component Y is essential (ablation) | Table 2: -1.8% without Y | Table 2 | §5.2 |
| 3 | Method scales to larger datasets | Fig 3: consistent gains on Z | Fig 3 | §5.3 |
```

Flag any claim without evidence — either find evidence, downgrade the wording, or remove the claim.

### 2. Storyline Sketch

Before expanding the outline, write `{PROJ}/academic_writer/STORYLINE_SKETCH.md`:

```markdown
# Storyline Sketch

- Thesis: [one-sentence paper claim]
- Problem: [what matters]
- Gap / tension: [what prior work misses]
- Core idea: [what this paper does]
- Evidence spine: [claim 1 -> evidence, claim 2 -> evidence]
- Limitation boundary: [what the paper does not prove]
- Storyline signal: [GREEN or RED]
```

Rules:
- Only use `GREEN` or `RED`
- `RED` means the storyline is still loose, not that writing must stop
- If `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md` is `RED`, reflect that in the limitation boundary instead of inventing stronger theory

### 3. Section Outline

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

### 4. Figure Plan

For each planned figure, specify:
```markdown
| Figure | Type | Data Source | Key Insight | Section |
|--------|------|-------------|-------------|---------|
| Fig 1 | Architecture diagram | N/A (to be drawn) | Overall framework | §3 |
| Fig 2 | Bar chart | results/main_comparison.json | +2.3% on CIFAR-100 | §4.2 |
| Fig 3 | Line plot | results/scaling_*.json | Consistent gains | §4.4 |
```

### 5. Cross-Reviewer Validation

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
[full outline from Step 3]

Figure Plan:
[full figure plan from Step 4]

Key results summary:
[3-sentence summary of main experimental findings]

Winning track scope:
[summary derived from TRACK_VERDICTS.md]

Theory support note:
[summary from THEORY_SUPPORT_NOTE.md]

Please also return two advisory signals only:
- Theory: GREEN or RED
- Storyline: GREEN or RED

END_REQUEST
```

Wait for Cross-Reviewer response. Parse:
- **Overall quality** assessment
- **Missing elements** checklist → add missing experiments to TODOS.md if any
- **Priority fixes** list → resolve before writing begins
- **Advisory signals** → update `{PROJ}/academic_writer/WRITING_SIGNALS.md`

### 6. Resolve Blockers

For each item in Cross-Reviewer's "Priority Fixes":
1. If it requires a new experiment → add task to `{PROJ}/orchestrator/TODOS.md`, mark outline section as `[PENDING EXPERIMENT]`
2. If it's a structural fix → update the outline in-place
3. If it's minor → note as TODO for writing phase
4. If it is an unsupported primary claim → remove it from the contribution list or explicitly downgrade it
5. If the paper is too broad → cut the weaker track or move it to limitations / future work
6. If Theory or Storyline is `RED` → continue, but write the risk explicitly into `{PROJ}/academic_writer/WRITING_SIGNALS.md` for human review

Write `{PROJ}/academic_writer/WRITING_SIGNALS.md` with:

```markdown
# Writing Signals

- Theory: GREEN
- Storyline: RED
- Paragraph logic: RED

## Human Review Focus
- Tighten opening thesis in Introduction
- Revisit paragraph transitions in Related Work and Conclusion
```

At this stage, `paragraph_logic` defaults to `RED` until `/paper-write` performs section-level checks.

Save the Cross-Reviewer outline response to `{PROJ}/cross-reviewer/outline/{date}.md`.

## Output

`{PROJ}/academic_writer/PAPER_PLAN.md` containing:
- Claims-Evidence Matrix (verified)
- Storyline Sketch reference
- Section Outline (validated by Cross-Reviewer)
- Figure Plan
- Cross-Reviewer assessment (appended verbatim)
- List of any pending experiments needed before writing

Also write:
- `{PROJ}/academic_writer/STORYLINE_SKETCH.md`
- `{PROJ}/academic_writer/WRITING_SIGNALS.md`
