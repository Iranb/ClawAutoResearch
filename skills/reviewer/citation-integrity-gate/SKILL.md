---
name: citation-integrity-gate
description: "Reviewer-side citation verification gate: independently audit refs.bib and manuscript citations, flag hallucinated or suspicious references, and update workflow citation state before submission."
argument-hint: "[optional scope, section, or 'full-paper']"
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

# Citation Integrity Gate

Run an independent reviewer-side citation audit before submission packaging.

This skill complements:

- `/scientific-critical-thinking` for rigor and protocol defects
- `/scholar-evaluation` for structured scoring
- `/peer-review` for the integrated reviewer voice

This skill operationalizes the citation workflow principle that citations must be:

- searched from real sources
- verified against source-of-truth metadata
- checked for claim fit
- only then accepted into the final bibliography

## Research Rigor Constraints

- Preserve **one variable per experiment** in citation-backed claims: check each strong claim against its specific cited support, not a vague related-work cluster.
- **Record everything** in `CITATION_VERIFICATION.md`, including suspicious keys, hallucinated entries, and required rewrites.
- Keep the **experiment and code change linked** when citations are used to justify methods, baselines, or implementation decisions.
- **Verify before claiming** a citation is safe: metadata and claim fit both matter.
- **Never manipulate evaluation narrative** with weak or irrelevant citations.
- **Never fabricate citations**. Any hallucinated reference is a gate failure.

## Core Rule

**A paper with hallucinated citations is not submission-ready.**

## Inputs

- `{PROJ}/academic_writer/paper/main.tex`
- `{PROJ}/academic_writer/paper/sections/*.tex`
- `{PROJ}/academic_writer/paper/refs.bib`
- `{PROJ}/researcher/ZOTERO_PACKET.md`
- `{PROJ}/academic_writer/PAPER_PLAN.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/CLAIM_POLICY.md`
- `{PROJ}/reviewer/AUTO_REVIEW.md`
- `research_workflow.get_citation_integrity`

## Outputs

- `{PROJ}/reviewer/CITATION_VERIFICATION.md`
- updated `PROJECT_MANIFEST.json.citation_integrity` through `research_workflow.record_citation_verification`

## Audit Procedure

### 1. Load Citation State

Call:

```json
{"action":"get_citation_integrity"}
```

Read:

- `source_of_truth`
- `allowed_placeholder_count`
- `bibliography_path`
- current verification counts

### 2. Parse the Bibliography and Draft

Review:

- every BibTeX entry in `refs.bib`
- every key cited in `main.tex` and section files
- every placeholder citation marker

If `{PROJ}/researcher/ZOTERO_PACKET.md` exists, also verify whether high-salience cited works are actually present in the project's Zotero `bot/<project-id>` writing-shortlist or baseline folders. Missing Zotero provenance is not an automatic failure, but it is a review signal that the bibliography queue drifted.

Focus especially on:

- Abstract
- Introduction contribution bullets
- related-work contrast sentences
- novelty claims
- strongest quantitative comparison claims

### 3. Independently Verify Metadata

For each high-salience citation, confirm:

- title exists
- authors are plausible and correctly ordered
- year and venue match
- DOI or arXiv ID is real when available
- entry type is sensible (`@article`, `@inproceedings`, `@misc`, etc.)

Use at least two trustworthy sources when feasible:

- DBLP
- CrossRef
- Semantic Scholar
- arXiv
- DataCite

### 4. Validate Claim Support

For strong narrative uses of a citation, verify that the cited paper actually supports the sentence.

Examples:

- "X was the first to ..."
- "Prior work consistently shows ..."
- "Method Y fails under ..."
- "Paper Z proves ..."

If the citation does not clearly support the sentence:

- mark it `suspicious`
- request wording downgrade or citation replacement

### 5. Classify Findings

Use four buckets:

- `verified`
- `suspicious`
- `hallucinated`
- `placeholder`

Definitions:

- `verified`: metadata and claim fit are acceptable
- `suspicious`: paper exists, but the citation metadata or claim fit is weak
- `hallucinated`: paper or citation metadata cannot be grounded in real sources
- `placeholder`: unresolved `[CITATION NEEDED: ...]`

### 6. Write the Verification Report

Write:

- `{PROJ}/reviewer/CITATION_VERIFICATION.md`

Use this structure:

```markdown
# Citation Verification

## Summary
- verified: N
- suspicious: N
- hallucinated: N
- placeholders: N
- verdict: verified / needs_revision

## Verified Citations
- key:
  - sources:
  - note:

## Suspicious Citations
- key:
  - issue:
  - required fix:

## Hallucinated Citations
- key or sentence:
  - issue:
  - action:

## Placeholder Budget
- unresolved:
- allowed:

## Final Verdict
- submission_ready: yes / no
```

### 7. Update Workflow State

If all of the following are true:

- hallucinated citations = 0
- suspicious citations = 0
- unresolved placeholders <= allowed budget

then record:

- `verification_status = verified`

Otherwise record:

- `verification_status = needs_revision`

Call:

```json
{
  "action": "record_citation_verification",
  "citationVerification": {
    "verification_report_path": "reviewer/CITATION_VERIFICATION.md",
    "bibliography_path": "academic_writer/paper/refs.bib",
    "verification_status": "verified or needs_revision",
    "verified_citation_count": 0,
    "suspicious_citation_count": 0,
    "hallucinated_citation_count": 0,
    "unresolved_placeholder_count": 0,
    "pending_reason": "Short reviewer summary"
  }
}
```

## Completion Signal

```markdown
## Citation Gate Complete

- bibliography: {PROJ}/academic_writer/paper/refs.bib
- report: {PROJ}/reviewer/CITATION_VERIFICATION.md
- status: verified / needs_revision
- verified citations: N
- suspicious citations: N
- hallucinated citations: N
- unresolved placeholders: N / allowed M
```

## Rules

- Do not trust Writer memory alone
- Do not waive hallucinated citations
- Do not mark `verified` while suspicious entries remain
- A citation gate is about factual integrity, not stylistic polish
