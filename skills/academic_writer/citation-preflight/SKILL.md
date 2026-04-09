---
name: citation-preflight
description: "Writer-side citation preflight: verify that bibliography entries come from real sources of truth, remove or downgrade suspicious references, and prepare refs.bib before reviewer-side citation gate."
argument-hint: "[optional section name, refs path, or 'all']"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - research_workflow
---

# Citation Preflight

Prepare the paper bibliography so Reviewer can later run a clean citation-integrity gate.

This skill adapts the practical workflow from the external `citation-workflow.md` reference into this repo's writing pipeline:

1. Search for the paper from trustworthy metadata sources
2. Verify the paper in at least 2 sources when feasible
3. Retrieve BibTeX or source-of-truth metadata
4. Validate that the citation actually supports the claim it is used for
5. Only then add or keep the entry in `refs.bib`

When local Zotero MCP is available, start from the project's Zotero `bot/<project-id>/writing-shortlist` rather than from an ad hoc citation queue.

This skill typically sits after `/citation-management` and alongside `/venue-templates`: first curate the venue-appropriate shortlist, then verify the actual metadata and claim fit.

## Research Rigor Constraints

- Preserve **one variable per experiment** in citation-backed writing: do not use one paper to justify multiple unrelated claims without checking each claim fit separately.
- **Record everything** in `CITATION_PREFLIGHT.md`, including the exact sentence/claim each citation supports and why suspicious entries were downgraded.
- Keep the **experiment and code change linked** when citations are used to justify implementation choices or baselines.
- **Verify before claiming**: if source metadata or claim fit is uncertain, keep the claim unresolved rather than pretending it is supported.
- **Never manipulate evaluation narrative** by citing unrelated papers to inflate novelty or strength.
- **Never fabricate citations**. This rule overrides convenience.

## Core Rule

**Never generate citations from memory.**

If a citation cannot be grounded in source-of-truth metadata, it must be:

- removed
- downgraded to a `[CITATION NEEDED: ...]` placeholder within budget
- or rewritten so the unsupported citation is no longer needed

## Inputs

- `{PROJ}/academic_writer/paper/main.tex`
- `{PROJ}/academic_writer/paper/sections/*.tex`
- `{PROJ}/academic_writer/paper/refs.bib`
- `{PROJ}/academic_writer/PAPER_PLAN.md`
- `{PROJ}/academic_writer/STORYLINE_SKETCH.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/researcher/LITERATURE.md`
- `{PROJ}/researcher/ZOTERO_PACKET.md`
- `{PROJ}/CLAIM_POLICY.md`
- `research_workflow.get_citation_integrity`

## Trusted Sources

Use the workflow-configured `source_of_truth` list from:

```json
{"action":"get_citation_integrity"}
```

Preferred sources:

- DBLP for CS / ML venue metadata and BibTeX
- CrossRef for DOI resolution and BibTeX retrieval
- Semantic Scholar for existence / metadata cross-check
- arXiv when the paper is a preprint
- DataCite when relevant for datasets / software / reports

## Procedure

### 1. Load Citation State

Call:

```json
{"action":"get_citation_integrity"}
```

Treat the returned fields as hard constraints:

- `bibliography_path`
- `allowed_placeholder_count`
- `source_of_truth`

### 2. Build the Citation Queue

Read the draft and collect:

- all `\cite{...}` keys already present
- all `[CITATION NEEDED: ...]` placeholders
- all headline related-work comparisons and prior-work claims that still lack a concrete source

If `{PROJ}/researcher/ZOTERO_PACKET.md` exists, reconcile this queue against the Zotero `bot/<project-id>/writing-shortlist` and baseline folders first.

Then write:

- `{PROJ}/academic_writer/CITATION_PREFLIGHT.md`

Use this structure:

```markdown
# Citation Preflight

## Queue
- claim / section:
  - query:
  - expected paper:
  - status: pending / verified / suspicious / hallucinated / placeholder

## Verified
- key:
  - source 1:
  - source 2:
  - doi/arxiv:

## Needs Revision
- issue:
  - section:
  - action:
```

### 3. Verify Each Citation

For each queue item:

1. Search by title + author keywords
2. Confirm the paper exists in at least two sources when possible
3. Prefer DOI-backed or DBLP-exported BibTeX
4. Confirm author list, year, venue, and identifier are consistent

Do not keep entries that only exist as vague memory matches.

### 4. Validate Claim Fit

For citations used in:

- Abstract
- Introduction contribution bullets
- key related-work contrasts
- strongest novelty claims

do one extra check:

- verify the cited paper actually supports the claim
- if not, downgrade the wording or replace the citation

If a citation only loosely relates to the sentence, treat it as `suspicious`.

### 5. Update `refs.bib`

Keep or add only verified entries in:

- `{PROJ}/academic_writer/paper/refs.bib`

Recommended key format:

- `author_year_firstword`

Examples:

- `vaswani_2017_attention`
- `devlin_2019_bert`

### 6. Resolve Problems Before Reviewer Gate

If an entry is suspicious or hallucinated:

- remove it from `refs.bib`, or
- replace it with a verified entry, or
- rewrite the sentence so it no longer depends on that citation

If a placeholder remains, keep it explicit and count it against the placeholder budget.

### 7. Record Writer-Side Status

After preflight, call:

```json
{
  "action": "record_citation_verification",
  "citationVerification": {
    "bibliography_path": "academic_writer/paper/refs.bib",
    "verification_report_path": "reviewer/CITATION_VERIFICATION.md",
    "verification_status": "pending",
    "verified_citation_count": 0,
    "suspicious_citation_count": 0,
    "hallucinated_citation_count": 0,
    "pending_reason": "Writer citation preflight completed; reviewer-side verification still required."
  }
}
```

Update the counts truthfully from the preflight results.

Do not mark the project `verified` here. Final verification belongs to Reviewer.

## Completion Signal

```markdown
## Citation Preflight Complete

- refs.bib updated: yes / no
- verified entries: N
- suspicious entries: N
- hallucinated entries removed: N
- unresolved placeholders: N
- next step: reviewer /citation-integrity-gate
```

## Rules

- Never invent BibTeX
- Never cite from memory alone
- Never keep a hallucinated citation in `refs.bib`
- Strong claims need real support, not citation-shaped placeholders
- Writer preflight reduces risk; Reviewer still performs the final gate
