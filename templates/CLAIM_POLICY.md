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
