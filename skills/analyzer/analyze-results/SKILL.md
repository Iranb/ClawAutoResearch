---
name: analyze-results
description: "Analyze experiment results: compute metrics, create figures, summarize findings."
argument-hint: "[results directory or experiment name]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - lobster
---

# Analyze Results

Extract metrics from experiment outputs, generate figures, and summarize findings.

> **File ownership**: Write ONLY to `{PROJ}/analyzer/`. Read logs from `{PROJ}/researcher/artifacts/` (read-only).
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Process

### 1. Collect Results

Read all result files (JSON / CSV) from `{PROJ}/researcher/artifacts/results/`.

### 2. Compute Metrics

- compute mean ± standard deviation across seeds
- compare against the baseline in both absolute value and relative improvement
- run significance tests where applicable

### 3. Generate Figures

Use Python to generate visualizations:

```python
import matplotlib.pyplot as plt
import seaborn as sns
# comparison plots, ablation plots, training curves, and related figures
```

Save them to `{PROJ}/analyzer/figures/` (one PDF and one PNG each).

### 4. Generate Tables

Generate LaTeX-formatted result tables and save them to `{PROJ}/analyzer/tables/`.

### 5. Build Claim-Evidence Matrix

Before writing the narrative, first write `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`:

```markdown
# Claim Evidence Matrix

| Claim ID | Claim | Claim Type | Evidence | Artifact | Support Status | Writer Guidance |
|----------|-------|------------|----------|----------|----------------|-----------------|
| C1 | Ours outperforms baseline on X | primary | +2.3% ± 0.4 over 3 seeds | Table 1 | SUPPORTED | safe to state as main contribution |
| C2 | Component Y is essential | ablation | -1.8% without Y | Table 2 | SUPPORTED | safe to state with ablation wording |
| C3 | Method is robust to scale shift | analysis | trend only, weak sample count | Fig 3 | PARTIAL | phrase as preliminary / exploratory |
```

Support status vocabulary:
- `SUPPORTED` — strong enough for headline writing
- `PARTIAL` — can only be framed cautiously
- `UNSUPPORTED` — cannot be presented as a main claim

Also write `{PROJ}/analyzer/TRACK_VERDICTS.md`:

```markdown
# Track Verdicts

| Track ID | Current Stage | Evidence Summary | Decision | Why |
|----------|---------------|------------------|----------|-----|
| track_a | experiment | +2.3% over baseline, 3 seeds | advance | strongest signal, novelty intact |
| track_b | pilot | weak gain, unstable variance | park | interesting but not worth more budget yet |
| track_c | pilot | no gain, contradicts hypothesis | kill | falsified by pilot |
```

Also write `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`:

```markdown
# Unsupported Claims

- C3 — "Method is robust to scale shift"
  - Why unresolved: only one dataset / weak sample count
  - Required evidence: 2 more datasets or stronger controlled analysis
  - Allowed wording now: "preliminary trend suggests ..."
```

### 5.5 Build Theory Support Note

Also write `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`:

```markdown
# Theory Support Note

Overall signal: RED

| Claim ID | Current support style | Signal | Safe writing guidance | Human follow-up |
|----------|-----------------------|--------|-----------------------|-----------------|
| C1 | empirical + mechanistic intuition | GREEN | can explain why the design should help | tighten assumptions if submitting |
| C2 | empirical only | RED | avoid theorem-like wording; present as observed effect | add deeper analysis or theory later |
```

Rules:
- Only use `GREEN` or `RED`
- This file is advisory only; lack of theory must **not** block draft generation
- `RED` means the writer should prefer empirical / mechanism language over strong theoretical claims
- Do not fabricate theorems, proofs, or assumptions just to turn a claim green

### 5.6 Build Minimal Theory State And Proof Packets

Do not stop at the prose note. Also create:

- `{PROJ}/analyzer/THEORY_STATE.json`
- `{PROJ}/analyzer/proof-packets/*.json`

`THEORY_STATE.json` should summarize:

```json
{
  "status": "draft or ready",
  "overall_signal": "green or red",
  "thesis": "one-sentence theory thesis",
  "body_guidance": "empirical_mechanistic or proof_sketch",
  "main_text_proof_style": "lemma_result_only",
  "theorem_candidates": [],
  "lemma_packets": [],
  "appendix_sections": []
}
```

Each proof packet should be a small structured object:

```json
{
  "packet_id": "lemma_monotonic_margin",
  "role": "lemma",
  "title": "Margin monotonicity under confidence sharpening",
  "statement": "If confidence sharpening increases inter-class margin, the cluster assignment error upper bound decreases monotonically.",
  "short_result": "Explains why the method should help under semantic shift.",
  "body_safe": true,
  "confidence": "green or red",
  "appendix_required": true,
  "appendix_path": "academic_writer/paper/sections/appendix_theory.tex",
  "evidence_pointers": ["Table 1", "Fig 3", "CLAIM C2"],
  "assumptions": ["feature margin estimate is stable"],
  "derivation_outline": ["define margin quantity", "bound assignment error", "show monotonic decrease"],
  "caveats": ["not a formal proof"],
  "source_claim_ids": ["C2"]
}
```

Rules:
- only create theorem / lemma candidates that are supported by observed trends, ablations, or literature-backed mechanisms
- if support is weak, keep `body_safe = false` and `confidence = red`
- main text should consume only body-safe objects
- detailed derivation steps belong to appendix-oriented packets, not headline contribution bullets

After writing the files, call:

```json
{
  "action": "record_theory_state",
  "theoryState": {
    "status": "draft or ready",
    "overall_signal": "green or red",
    "theory_state_path": "analyzer/THEORY_STATE.json",
    "proof_packet_dir": "analyzer/proof-packets",
    "appendix_packet_path": "academic_writer/THEORY_APPENDIX_PLAN.md",
    "main_text_proof_style": "lemma_result_only",
    "body_ready": true or false,
    "theoryStateFile": {}
  }
}
```

For each packet, also call:

```json
{
  "action": "upsert_proof_packet",
  "proofPacket": {}
}
```

### 5.7 Materialize Writer-Ready Theory Outputs

After the packet set is stable, either invoke `/theory-phase` or directly call:

```json
{
  "action": "materialize_theory_appendix"
}
```

This must create:

- `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md`
- `{PROJ}/academic_writer/paper/sections/appendix_theory.tex`

The appendix draft is generated from the packets and can be refined later by Writer, but it must exist before proof-aware writing is considered ready.

### 6. Write Report

Output `{PROJ}/analyzer/NARRATIVE_REPORT.md`:

```markdown
# Experiment Report: [title]

## Setup
- Model: ...
- Dataset: ...
- Config: ...

## Results
| Method | Metric1 | Metric2 |
|--------|---------|---------|
| Baseline | X ± Y | ... |
| Ours | X ± Y | ... |

## Analysis
- Key finding 1: ...
- Limitation: ...

## Artifacts
- Figures: {PROJ}/analyzer/figures/
- Tables:  {PROJ}/analyzer/tables/
- Logs:    {PROJ}/researcher/artifacts/logs/
```

### 7. Completion Signal

```
## Analysis Complete
- **Figures**: {PROJ}/analyzer/figures/
- **Tables**: {PROJ}/analyzer/tables/
- **Claim matrix**: {PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md
- **Track verdicts**: {PROJ}/analyzer/TRACK_VERDICTS.md
- **Unsupported claims**: {PROJ}/analyzer/UNSUPPORTED_CLAIMS.md
- **Theory support note**: {PROJ}/analyzer/THEORY_SUPPORT_NOTE.md
- **Theory state**: {PROJ}/analyzer/THEORY_STATE.json
- **Proof packets**: {PROJ}/analyzer/proof-packets/
- **Theory appendix plan**: {PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md
- **Theory appendix draft**: {PROJ}/academic_writer/paper/sections/appendix_theory.tex
- **Report**: {PROJ}/analyzer/NARRATIVE_REPORT.md
- **Main result**: [Proposed achieves X.X ± Y.Y vs baseline X.X ± Y.Y]
```

Then append to `{PROJ}/orchestrator/TODOS.md`:
```
- [x] Analysis complete: NARRATIVE_REPORT.md — completed: YYYY-MM-DD
```

## Rules

- Do NOT modify files in `{PROJ}/researcher/artifacts/logs/` (read-only)
- Do NOT run new experiments — only analyze existing results
- Do NOT write to any folder outside `{PROJ}/analyzer/`
- Include all completed runs — do not cherry-pick seeds
- Prefer explicit `advance / merge / park / kill` recommendations over vague suggestions
- Theory support is advisory, not a hard gate: use only `GREEN / RED`

## Stage Closeout

When the required ANALYZE artifacts are complete and the project is ready to move into REVIEW, invoke the Lobster handoff workflow from the quickstart.

Do not hand off if a central unsupported claim still requires returning to EXPERIMENT or if analysis explicitly requests more data collection.
