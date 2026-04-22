# ClawAutoResearch Project Instructions

This file is the project-specific supplement for future coding work in this repository.
It captures the stable delivery preferences and workflow-debugging expectations established in prior work on AutoResearch.

## Core Delivery Rules

- Prioritize the most stable fix, not the smallest fix.
- Refactor when necessary to remove the real source of instability instead of patching symptoms.
- Finish end-to-end when the task is clear:
  inspect, implement, verify, and report.
- Do not stop at a local state patch if the repository code is the real cause.
- When the live project state is corrupted, repair the live state only after identifying the systemic cause.
- Prefer durable contracts, persisted artifacts, and replayable state over implicit heuristics.

## Root-Cause Discipline

- Do not explain a stuck workflow from a single file.
- Trace failures across:
  - stage decision
  - owner routing
  - handoff delivery
  - runtime queue/session recovery
  - live project manifest drift
- Separate:
  - decision-layer bugs
  - runtime/session bugs
  - project-state corruption
  - missing artifacts or incomplete contracts
- If a manual repair is required, record the repository change needed to prevent the same class of failure.

## Workflow-Specific Expectations

When AutoResearch gets stuck, inspect these files first:

- `PROJECT_MANIFEST.json`
- `.openclaw-research/auto-iterator-state.json`
- `.openclaw-research/workflow-runtime-queue.json`
- `.openclaw-research/workflow-runtime-sessions.json`
- `.openclaw-research/workflow-mailbox.json`
- `.openclaw-research/workflow-handoff-intents.json`
- `.openclaw-research/workflow-events.jsonl`
- `.openclaw-research/workflow-trace.jsonl`
- `.openclaw-research/workflow-diagnostics.jsonl`

When analyzing a stall, explicitly answer:

- What is the current stage?
- Who is the current owner?
- What is the next action?
- What is the blocking reason?
- Is the problem in stage readiness, owner routing, handoff delivery, or runtime replay?
- Is the system actually unable to advance, or is auto mode / launch mode preventing dispatch?

## Auto Mode And Routing Guardrails

- Do not rely on bare `runWorkflowAutoIterator(...)` calls without policy unless the task explicitly requires a no-policy simulation.
- Treat missing policy injection as a first-class diagnostic cause when `configuredAutoMode` unexpectedly falls back to `off`.
- Do not conflate:
  - `experiment not started yet`
  - `experiment implementation is broken`
- For experiment-stage routing:
  - first-launch orchestration belongs to `Researcher /experiment-phase`
  - bounded implementation/runtime repair belongs to `Coder`

## Logging Requirements

- Add structured logs for control-plane decisions, not ad-hoc debug prints.
- Prefer persisted JSONL diagnostics over transient console output.
- New logging should explain:
  - what decision was made
  - why it was made
  - which inputs caused it
  - what next action the system expects
- If a workflow can stall at a layer, that layer should emit enough data to distinguish:
  - waiting
  - blocked
  - degraded
  - failed
- Keep diagnostic logs compatible with capture bundles so field debugging can be replayed offline.

## Live Project Repair Rules

- When repairing a real project under `Downloads/AutoResearchProjects/...`, back up the mutable workflow state first.
- If stale queue/session/mailbox entries are causing drift:
  - mark them terminal or superseded
  - do not leave ambiguous `running` state on dead entries
- If owner/stage drift is repaired manually, verify whether repository code also needs a fix.
- After a live repair, check whether the decision layer now advances correctly under real policy.

## Verification Standard

Run the narrow tests for the touched subsystem first, then run broader verification before closing:

- targeted unit/integration tests for touched files
- `npm test`
- `npm run build`

Run `npm run lint` when possible, but if the repository is not currently lint-configured, report that as an environment/repo limitation rather than pretending lint passed.

## Git And Delivery

- Use a dedicated branch for substantive fixes.
- Keep commits reviewable and scoped around one root cause or one coherent hardening pass.
- When asked to ship:
  - push the branch
  - open the PR
  - merge to `main`
- Do not claim merge completion without verifying the remote result.

## Final Reporting Expectations

Every closeout should include:

- changed files
- what was simplified or made more durable
- what was verified
- remaining risks or known limits

Avoid changelog-style noise. Report the real outcome and the remaining weak points.
