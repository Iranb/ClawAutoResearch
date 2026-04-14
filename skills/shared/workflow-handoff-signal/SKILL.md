---
name: workflow-handoff-signal
description: "Shared stage-closeout protocol for all workflow agents. Use when a role has durably finished its stage packet and wants the workflow control plane to prepare or dispatch the next owner handoff without directly editing owner_agent."
allowed-tools:
  - Read
  - research_workflow
---

# Workflow Handoff Signal

This skill is the **only stable stage-closeout path** for cross-owner workflow handoffs.

Do **not**:

- hand-edit `PROJECT_MANIFEST.json.owner_agent`
- hand-edit `PROJECT_MANIFEST.json.current_stage`
- rely on a free-form Discord message like "handoff complete"
- bypass the workflow control plane with an ad hoc Lobster hop

Instead:

1. Finish the durable outputs for your current stage
2. Reconcile state with the appropriate materializer / setter
3. Call `research_workflow.prepare_stage_handoff`
4. Stop and let the workflow control plane manage delivery / claim / activation

## When To Use

Use this skill only when **all required artifacts for the current stage are durably ready** and the next step belongs to a **different owner role**.

Examples:

- `researcher`: `survey_review -> write`
- `researcher`: `idea -> plan`
- `orchestrator`: `plan -> code`
- `coder`: `code -> experiment`
- `researcher`: `experiment -> analyze`
- `analyzer`: `analyze -> review`
- `reviewer`: `review -> write`
- `academic_writer`: `write -> submit`

## Required Protocol

Before sending the handoff signal:

1. Ensure the stage packet is real, not implied by chat text
2. Run the relevant workflow materializer / setter for your lane
3. Verify that the next stage is genuinely owned by another role

Then call:

```json
{
  "action": "prepare_stage_handoff",
  "handoff": {
    "stageAfter": "<next-stage-if-known>",
    "toRole": "<next-owner-if-known>",
    "summary": "<one-sentence stage-closeout summary>",
    "command": "<the next command if known>",
    "acceptanceChecks": [
      "<artifact-or-state check 1>",
      "<artifact-or-state check 2>"
    ],
    "dispatch": true
  }
}
```

If `stageAfter` / `toRole` are omitted, the workflow will try to derive them from `auto_iterator_tick`.

## Role-Specific Hints

- `researcher` finishing `survey_review`:
  include the survey packet artifacts and let the workflow prepare `academic_writer`
- `orchestrator` finishing `plan`:
  include `PLAN.md`, `TODOS.md`, `PLAN_AUDIT.md`, and the selected track contract
- `coder` finishing `code`:
  include experiment bundle paths, dry-run evidence, and manifest/index updates
- `analyzer` finishing `analyze`:
  include claim-evidence matrix, track verdicts, unsupported claims, and quality audit
- `reviewer` finishing `review`:
  include review report / review-pressure packet and final ready/not-ready verdict
- `academic_writer` finishing `write`:
  include the compiled draft / writing packet state and only hand off when writing really is submission-ready

## Completion Rule

Once `prepare_stage_handoff` has been called, do not also:

- send another free-form handoff message
- flip owner fields manually
- start doing the next role's work yourself

The workflow control plane owns:

- intent creation
- delivery
- retry / backoff
- claim / activation
- rollback on failed handoff

## Idle Recovery

If your stage outputs are already durable but the workflow appears stuck and no one is advancing the handoff:

1. call `research_workflow.get_snapshot`
2. if you are still the live owner, call `research_workflow.auto_iterator_tick` once
3. if the stage still belongs to you, the next owner is different, and no valid handoff is moving, call `research_workflow.prepare_stage_handoff`
4. if the stage does **not** move, report the exact blocker instead of repeatedly pinging the next role

This is a recovery path for idle / stalled transitions, not permission to start the next owner's work yourself.
