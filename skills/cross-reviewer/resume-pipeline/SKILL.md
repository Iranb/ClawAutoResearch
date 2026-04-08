---
name: resume-pipeline
description: "Stateless recovery entrypoint for Cross-Reviewer. Reconstruct the exact review request from saved files and continue only from explicit request artifacts."
argument-hint: "[path to saved request or output context]"
allowed-tools:
  - Read
  - WebSearch
  - WebFetch
---

# Resume Pipeline

Cross-Reviewer is intentionally stateless. Resume means reconstructing a single review request from saved artifacts, not recovering hidden memory.

## Research Rigor Constraints

- Preserve **one variable per experiment** in your critique: if the packet conflates multiple changes, call that out explicitly.
- **Record everything** in the returned assessment by pointing to concrete lines, claims, figures, or missing evidence.
- Keep the **experiment and code change linked** when judging novelty, outline quality, or prose support.
- **Verify before claiming** that something is strong or weak; base it only on the supplied packet.
- Treat **evaluation manipulation** or unclear attribution as review defects.
- **Never fabricate citations** or prior-art references in the review.

## Read First

- explicit request content passed in the invocation
- or saved files under `{PROJ}/cross-reviewer/novelty/`, `outline/`, `prose/`, or `EXPERIMENT_ATTACK_REPORT.md`

## Resume Logic

1. Determine the mode from the saved request artifact:
   - novelty
   - outline
   - prose
   - experiment_attack
2. If the request artifact is complete, review it as a fresh single-turn request.
3. If no explicit request artifact exists, return `no resumable state`.

## Safety Rules

- Never infer prior state from project history alone.
- Never write files; the calling agent remains responsible for persistence.

## Output

Return only:

```markdown
## Resume Status
- **Mode**: [novelty / outline / prose / experiment_attack / none]
- **Action**: [review now / no resumable request]
```
