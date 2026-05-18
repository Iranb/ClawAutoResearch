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

## Workflow Orientation

This skill is the recovery entrypoint for Reviewer inside the review / revise / write loop.

Before acting, classify the current state:
- ordinary in-progress review round
- stale interrupted review round
- write-side revise packet waiting for recheck
- submit-side package verification pass

Downstream contract:
- if you conclude `revise`, the system should be able to route a bounded revision packet back to Writer
- if you conclude `pass`, the project may continue toward submit packaging
- if you conclude `block`, make the integrity failure explicit enough that revision is clearly insufficient

## Research Rigor Constraints

- Preserve **one variable per experiment** in resumed review reasoning; if attribution was already muddy, keep that concern visible.
- **Record everything** you resume, restart, or conclude so the next round stays auditable.
- Keep the **experiment and code change linked** by resuming from the saved evidence packet, not hidden memory.
- **Verify before claiming** a review can be closed; incomplete or stale state should be surfaced, not papered over.
- Treat **evaluation manipulation** as a standing blocker if discovered during resume.
- **Never fabricate citations** in review notes.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/researcher/REVIEW_STATE.json`
- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/analyzer/TRACK_VERDICTS.md`
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`
- `{PROJ}/academic_writer/SCIENTIFIC_EDIT_LEDGER.json` if PaperGuru is required
- `{PROJ}/academic_writer/SCIENTIFIC_EDIT_REPORT.md` if PaperGuru is required
- `{PROJ}/reviewer/AUTO_REVIEW.md` if exists

## Resume Logic

1. Verify that `PROJECT_MANIFEST.json.workflow_control` or the current Workflow Guard snapshot routes work to Reviewer; if ownership is stale, report the blocker instead of taking over.
2. If the project is in `review` / `submit` or the blocker is `paperguru_gate_blocked`, call `research_workflow.get_paperguru_gate` first. If it returns `blocked`, report the missing pass ids or receipt gaps and continue only the bounded PaperGuru repair/recheck; if it returns `ready`, continue normal review or submit verification.
3. If `REVIEW_STATE.json` is missing, start a fresh `/review-phase`.
4. If `status = completed`, return `no-op` with the last verdict.
5. If `status = in_progress` and timestamp is recent, continue from the next round.
6. If `status = in_progress` but stale, restart the review loop and note that the prior state expired.

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
