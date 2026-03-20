---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Reviewer. Resume internal review rounds from REVIEW_STATE.json or safely conclude when review is already complete."
argument-hint: "[project id or empty to infer current project]"
allowed-tools:
  - Read
  - Write
  - Edit
  - MemorySearch
  - MemoryGet
  - WebSearch
  - WebFetch
---

# Resume Pipeline

Use when the internal review loop was interrupted and Reviewer needs to continue from durable review state.

## Read First

- `{PROJ}/researcher/REVIEW_STATE.json`
- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/analyzer/TRACK_VERDICTS.md`
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`
- `{PROJ}/reviewer/AUTO_REVIEW.md` if exists

## Resume Logic

1. If `REVIEW_STATE.json` is missing, start a fresh `/review-phase`.
2. If `status = completed`, return `no-op` with the last verdict.
3. If `status = in_progress` and timestamp is recent, continue from the next round.
4. If `status = in_progress` but stale, restart the review loop and note that the prior state expired.

## Safety Rules

- Do not silently reset a recent in-progress review.
- Keep the reviewer independent; do not inspect coder implementation details or remote execution logs.

## Output

```markdown
## Resume Status
- **Review state**: [fresh / resumed / restarted / completed]
- **Round**: [N]
- **Next action**: [continue review / no-op]
```
