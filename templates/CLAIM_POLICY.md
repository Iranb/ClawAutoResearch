# Claim Policy

This file defines how evidence labels constrain writing and stage advancement.

## Support Labels

- `SUPPORTED`
  - May appear in contribution bullets, abstract, and conclusion.
  - May be framed as a main result when tied to concrete tables / figures / runs.
- `PARTIAL`
  - Must use cautious language such as "suggests", "indicates", or "is consistent with".
  - Must not be the sole justification for the paper's headline contribution.
- `UNSUPPORTED`
  - Must not appear in title, abstract, contribution bullets, or conclusion claims.
  - Must be removed, downgraded to exploratory wording, or sent back for more experiments.

## Claim Types

- `primary`
  - The paper cannot advance to final writing unless every primary claim has a support label.
- `ablation`
  - Must point to a concrete controlled comparison.
- `analysis`
  - May rely on trends, but weak evidence must be labeled `PARTIAL`.
- `exploratory`
  - Can appear only when clearly marked as preliminary or future work.

## Workflow Rules

- Every claim in `CLAIM_EVIDENCE_MATRIX.md` must map to at least one artifact.
- Every headline contribution must belong to an active or winning track in `TRACK_REGISTRY.json`.
- If a primary claim becomes `UNSUPPORTED`, the workflow must roll back to analysis, review, or experiment before paper finalization.
- When scope pressure is high, drop low-value `PARTIAL` claims before adding more experiments.

## Storyline Rules

- Keep the paper to `1-2` core ideas; weaker side tracks belong in limitations or future work.
- Every headline claim in Abstract, Introduction, and Conclusion must appear in the KG-backed storyline packet and the claim-evidence matrix.
- The storyline must follow `problem -> gap -> method -> evidence -> limitation` instead of listing disconnected features.

## Citation Rules

- Every non-trivial related-work claim needs a real citation from a source-of-truth record; do not invent BibTeX.
- Every headline empirical claim needs either an inline citation to prior work or direct experiment evidence.
- Placeholders like `[CITATION NEEDED]` must be driven to zero before submission unless the workflow explicitly allows otherwise.
- Any citation marked suspicious or hallucinated by the citation integrity gate must be removed, replaced, or downgraded before submission.
