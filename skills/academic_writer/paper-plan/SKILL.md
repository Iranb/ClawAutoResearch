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
  - research_workflow
---

# Paper Plan

Build a paper outline from experiment results, then validate it with the Cross-Reviewer before any prose is written. In the current workflow this stage must also materialize a durable `paper_story_state`, so the story skeleton becomes a workflow contract rather than a loose writing note.

> **File ownership**: Write ONLY to `{PROJ}/academic_writer/`. Read from `{PROJ}/analyzer/`, `{PROJ}/reviewer/`, `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Research Rigor Constraints

- Preserve **one variable per experiment** in the storyline: ablations and gains should stay attributable to the specific change that produced them.
- **Record everything** needed for writing: each claim should point to its experiment evidence, figure/table, and relevant review caveat.
- Keep the **experiment and code change linked** by carrying forward bundle ids, config families, or artifact names when planning sections.
- **Verify before claiming**: unsupported or partial claims must be downgraded or removed before they enter the outline.
- **Never manipulate evaluation narrative** by hiding baselines, renaming metrics, or over-compressing negative results.
- **Never fabricate citations** while mapping related work or contribution claims.

## Input

- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — key results and analysis
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` — authoritative claim support ledger from Analyzer
- `{PROJ}/analyzer/TRACK_VERDICTS.md` — which tracks are writing-safe to foreground
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md` — claims that cannot yet be elevated
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md` — advisory theory / mechanism signal
- `{PROJ}/analyzer/THEORY_STATE.json` — structured theorem / lemma candidate state
- `{PROJ}/analyzer/proof-packets/` — packetized theorem / lemma / proposition objects
- `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md` — generated appendix plan derived from proof packets
- `{PROJ}/CLAIM_POLICY.md` — label-to-wording constraints
- `{PROJ}/reviewer/REVIEW_REPORT.md` — canonical reviewer feedback from experiment review cycle
- `{PROJ}/analyzer/figures/` — available figures
- `{PROJ}/researcher/LITERATURE.md` — related work landscape
- `{PROJ}/researcher/ZOTERO_PACKET.md` — Zotero `bot/<project-id>` writing-shortlist / baseline summary when available
- `{PROJ}/researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json` — authoritative idea-fragments to claim traceability map; use it to preserve which catalyst fragment justifies each contribution and which claims still need downstream experiment support
- `{PROJ}/academic_writer/VENUE_ROUTING_PLAN.md` — workflow-owned venue recommendation and risk-limited routing envelope
- `research_workflow.get_writing_contract` — user-provided template path, section order, and paragraph-logic contract
- `research_workflow.get_citation_integrity` — source-of-truth citation policy and placeholder budget

If `writing_contract.template_required = true` and the template path is missing or unreadable, stop and ask Researcher to restore it through `research_workflow.set_writing_contract` before drafting the outline.

## Process

### 0. Load Writing Contract

Before extracting claims, inspect:

```json
{"action":"get_writing_contract"}
```

If `paper_mode` is configured, treat it as a hard envelope:

- `conference` = `9` main-body pages + `2` reference pages
- `journal` = `12` main-body pages + `2` reference pages

Also inspect:

```json
{"action":"get_citation_integrity"}
```

If `{PROJ}/researcher/ZOTERO_PACKET.md` exists, use it together with `/citation-management` and `/venue-templates` to lock:

- which papers belong in the writing shortlist
- which baseline papers must appear in related work or setup
- which venue structure and page budget should constrain the outline

Also read `{PROJ}/researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json` before drafting the story skeleton:

- preserve which idea fragments survive into paper-level claims
- carry forward the fragment-to-claim linkage into `CONTRIBUTION_MAP.md`, `ADVANTAGE_MAP.md`, and `CLAIM_TO_EXPERIMENT_MAP.md`
- if the idea-to-claim map is stale or contradicts `CLAIM_EVIDENCE_MATRIX.md`, repair the map before locking the outline
- before freezing the outline, materialize and consume:
  - `{PROJ}/academic_writer/PREWRITE_REJECTION_SIMULATION.md`
  - `{PROJ}/academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md`
  - `{PROJ}/academic_writer/FIGURE_ANCHOR_PLAN.md`
  - `{PROJ}/academic_writer/VENUE_ROUTING_PLAN.md`

If a template path is configured:

- read the project-local copied template before drafting
- preserve its required section order unless the project scope forces an explicit adaptation
- write `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` to show how the template maps to this paper

Also inspect these proof-writing fields from the contract:

- `main_text_proof_style`
- `proof_appendix_required`
- `proof_appendix_path`
- `theory_note_path`
- `proof_checklist`

`TEMPLATE_MAPPING.md` should include:

- template source path
- required sections from the template
- how each template section maps to current paper sections
- which sections are reused, merged, dropped, or newly added
- any paragraph-pattern rules the writer should preserve

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
- Use `IDEA_TO_CLAIM_MAP.json` and the surviving idea fragments as the upstream source for:
  - which contributions are foregrounded
  - which claims remain contingent
  - which fallback narrative branches are still valid
- Once the sketch is coherent, let workflow scaffold the durable story contract first:

```json
{"action":"materialize_paper_story_state","paperStoryMaterialization":{"basis_stage":"plan"}}
```

- Use `research_workflow.set_paper_story_state` only for bounded follow-up patches after the scaffold exists

### 2.2 Theory / Proof Appendix Plan

Before locking the outline, read `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md` if it already exists. Treat it as the generated starting point from `/theory-phase`, then refine only if the outline changed materially.

If the file does not exist, stop and ask Analyzer / Researcher to run `/theory-phase` or `research_workflow.materialize_theory_appendix` before planning proof-heavy writing.

The plan should follow this structure:

```markdown
# Theory Appendix Plan

- Main-text theorem / lemma candidates:
  - [statement]
- Main-text intuition only:
  - [what can be safely claimed in body text]
- Appendix derivations:
  - [derivation / proof sketch / algebra / case split]
- Evidence basis:
  - [results, trend, ablation, mechanism note, literature cue]
- Assumptions / caveats:
  - [explicit boundary]
```

Rules:
- only elevate theory that is consistent with `THEORY_SUPPORT_NOTE.md` and supported empirical signals
- use `THEORY_STATE.json` and `proof-packets/` as the source of truth for what is body-safe vs appendix-only
- main text should keep theorem / lemma statements concise
- detailed derivations belong in the appendix, not in the main narrative
- if the theory signal is weak, plan a conservative appendix note rather than a strong theorem claim

### 2.5 KG Storyline Packet

Before locking the outline, build `{PROJ}/academic_writer/KG_STORYLINE_PACKET.md`.
You may call `/kg-storyline-contract` first, or produce the packet directly here.

The packet must map:

- problem
- gap in prior work
- method response
- evidence spine
- limitation boundary
- off-limit side tracks

When the packet is writing-safe, update `writing_contract.kg_storyline_status = ready`.

Before leaving `/paper-plan`, the durable story contract should be complete enough to cover:

- `TASK_SUMMARY.md`
- `CHALLENGE_STATEMENT.md`
- `INSIGHT_SUMMARY.md`
- `CONTRIBUTION_MAP.md`
- `ADVANTAGE_MAP.md`
- `STORY_SPINE.md`
- `PIPELINE_FIGURE_SKETCH.md`
- `MODULE_MOTIVATION_MAP.md`
- `CLAIM_TO_EXPERIMENT_MAP.md`
- `FALLBACK_NARRATIVE.md`
- `REJECTION_RISK_TABLE.md`
- `PREWRITE_REJECTION_SIMULATION.md`
- `CONTRIBUTION_TO_STORY_BRIDGE.md`
- `FIGURE_ANCHOR_PLAN.md`

### 3. Section Outline

Write the section-level outline with concrete targets:

- if a user template is configured, start from that template's section order and adapt it
- if a project-local template copy exists, use that copy as the active writing template and never edit the external source template
- if the project needs to deviate from the template, document the deviation in `TEMPLATE_MAPPING.md`
- keep `PAPER_PLAN.md` and `TEMPLATE_MAPPING.md` consistent

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

## 5. Results (~1-1.5 pages)
- Main quantitative takeaway
- Claim-to-evidence recap

## 6. Discussion (~0.5-1 page)
- Interpretation, boundary conditions, and implications

## 7. Limitations (~0.2-0.4 page)
- Honest scope boundary

## 8. Conclusion (~0.5 page)
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

If a writing template is configured, update the writing contract after the outline is aligned:

```json
{
  "action": "set_writing_contract",
  "writingContract": {
    "template_status": "applied",
    "template_mapping_path": "academic_writer/TEMPLATE_MAPPING.md",
    "last_template_applied_at": "<now>",
    "paragraph_logic_status": "pending"
  }
}
```

If proof-aware writing is enabled, keep or set:
- `main_text_proof_style = lemma_result_only`
- `proof_appendix_required = true`
- `proof_appendix_path = academic_writer/paper/sections/appendix_theory.tex` unless you intentionally configured a different appendix path

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
- `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md`
- `{PROJ}/academic_writer/KG_STORYLINE_PACKET.md`
- `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` when a template is configured
- `{PROJ}/academic_writer/WRITING_SIGNALS.md`
- `{PROJ}/academic_writer/story/` 下的 durable story contract files

When those story files are updated, sync `PROJECT_MANIFEST.json.paper_story_state` through `research_workflow.set_paper_story_state` instead of hand-editing the manifest.
