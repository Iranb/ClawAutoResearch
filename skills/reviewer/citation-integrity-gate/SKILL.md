---
name: citation-integrity-gate
description: "Reviewer-side citation integrity gate that checks bibliography evidence, metadata quality, and venue-facing citation safety before submit."
argument-hint: "[optional section or paper scope]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Citation Integrity Gate

Run the final reviewer-side citation gate before submission.

Work together with:

- `scientific-critical-thinking`
- `scholar-evaluation`
- `peer-review`

## Goals

- verify that claims cite real and appropriate sources
- identify placeholders, suspicious metadata, and hallucinated references
- update `reviewer/CITATION_VERIFICATION.md`
- return a conservative verdict if the bibliography is not ready

## Guardrails

- never invent missing metadata
- prefer downgrade/block over guessing
- keep the citation verdict aligned with the workflow citation integrity state
