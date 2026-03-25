---
name: theory-phase
description: "Coordinate or bootstrap a minimal theorem/lemma synthesis before writing, then materialize theory appendix artifacts."
argument-hint: "[optional focus or claim id]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Agent
  - research_workflow
---

# Theory Phase

Run a dedicated theorem/lemma synthesis pass after analysis and before serious paper writing.

> **Researcher rule**: prefer using `research_workflow` to write theory-state artifacts so the appendix plan and proof packets stay consistent. Do not freestyle a separate prose-only theory note when structured packets are needed.

## When To Use

Run this when:

- Analyzer has finished result analysis
- the project is preparing for `write`
- theory-aware writing is enabled
- Writer needs a structured proof packet layer instead of loose mechanism prose

## Inputs

- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`
- `{PROJ}/analyzer/THEORY_STATE.json` if it already exists
- `{PROJ}/analyzer/proof-packets/` if it already exists
- `{PROJ}/researcher/LITERATURE.md`
- `research_workflow.get_theory_state`
- `research_workflow.get_writing_contract`

## Process

### 1. Reconcile Current Theory Status

Call:

```json
{"action":"get_theory_state"}
```

If theory packets already exist, refine them rather than duplicating them under new IDs.

### 2. Synthesize Or Refine Theorem/Lemma Packets

Create the smallest useful theory set:

- 1-2 concise main theorem / proposition candidates at most
- 2-4 supporting lemmas at most
- every packet must point back to empirical evidence or literature-backed mechanism

Conservative rules:

- if a claim is only exploratory, keep `body_safe = false`
- if the proof is incomplete, keep it appendix-oriented and say so in `caveats`
- do not promote a result to theorem language unless the assumptions are explicit

### 3. Persist Structured Theory Artifacts

Record the updated state:

```json
{
  "action": "record_theory_state",
  "theoryState": {
    "status": "draft or ready",
    "overall_signal": "green or red",
    "body_ready": true or false,
    "theory_state_path": "analyzer/THEORY_STATE.json",
    "proof_packet_dir": "analyzer/proof-packets",
    "appendix_packet_path": "academic_writer/THEORY_APPENDIX_PLAN.md",
    "main_text_proof_style": "lemma_result_only",
    "theoryStateFile": {}
  }
}
```

Upsert each packet through:

```json
{
  "action": "upsert_proof_packet",
  "proofPacket": {}
}
```

### 4. Generate Writer-Ready Theory Outputs

Call:

```json
{
  "action": "materialize_theory_appendix"
}
```

This must leave behind:

- `academic_writer/THEORY_APPENDIX_PLAN.md`
- `academic_writer/paper/sections/appendix_theory.tex`

### 5. Handoff

When the artifacts exist, tell Writer or Orchestrator that theory packets are ready. Point them to:

- `analyzer/THEORY_STATE.json`
- `analyzer/proof-packets/`
- `academic_writer/THEORY_APPENDIX_PLAN.md`
- `academic_writer/paper/sections/appendix_theory.tex`

## Success Criteria

- Writer can consume structured proof objects without reconstructing them from prose
- the appendix plan and appendix draft are generated from the packet set
- main-text-safe statements are separated from appendix-only derivations
