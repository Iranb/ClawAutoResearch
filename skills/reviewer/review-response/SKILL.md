---
name: review-response
description: "Draft a project-local rebuttal from external reviewer feedback. Canonical output: {PROJ}/reviewer/rebuttal_{date}.md."
argument-hint: "[external review path or empty to infer latest reviewer/external_review_{date}.md]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Review Response

Draft a structured, evidence-backed rebuttal from the latest project-local external review artifact.

> **File ownership**: Write ONLY to `{PROJ}/reviewer/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Research Rigor Constraints

- Preserve **one variable per experiment** in the rebuttal: tie each response to the exact experiment, analysis artifact, or manuscript change that addresses it.
- **Record everything** in the rebuttal and supporting notes, including what is fixed, what remains open, and what evidence backs each response.
- Keep the **experiment and code change linked** by referencing concrete artifacts rather than vague promises.
- **Verify before claiming** a reviewer concern is resolved; if it is only partially addressed, say so.
- **Never manipulate evaluation narrative** in rebuttals by overstating preliminary evidence or hiding failed checks.
- **Never fabricate citations** or unsupported prior-work comparisons in the response.

## Inputs

Read:
- the latest `{PROJ}/reviewer/external_review_{date}.md` unless the user provided a specific path
- `{PROJ}/academic_writer/paper/` for the current paper draft when needed
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`
- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/CLAIM_POLICY.md`

## Output Contract

Write:
- `{PROJ}/reviewer/rebuttal_{YYYY-MM-DD}.md`

Use `REBUTTAL_TEMPLATE.md` in this skill directory as the starting structure.

The rebuttal must include:
- a short response summary
- point-by-point responses for the material reviewer concerns
- explicit evidence or planned revisions for each concern
- a `Priority Color` per concern:
  - `red` = needs new evidence or major claim downgrade
  - `amber` = manuscript revision can address
  - `green` = already addressed with existing evidence
- a `Champion Strategy` per concern:
  - `fix_now`
  - `downgrade_claim`
  - `defer_with_scope_boundary`
  - `rebut_with_existing_evidence`
- a closing paragraph suitable for a response letter or revision memo

## Rules

- Base every response on project evidence; do not invent new experiments or citations
- If a reviewer request cannot be satisfied, explain the limitation directly and politely
- If a concern maps to an unsupported claim, recommend downgrading or removing that claim
- Keep the tone respectful, concise, and specific
- Rank the top rebuttal priorities explicitly so the team knows which issues deserve the fastest revision budget
- Do not leave the output only in chat; the project-local rebuttal file is mandatory

## Completion

Return a short summary that includes:
- the source external review path
- the written rebuttal path
- the top 1-3 revision commitments
