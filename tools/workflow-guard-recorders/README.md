# workflow-guard-recorders

This directory holds workflow-guard helpers that persist durable workflow state
but are not stage-gate logic themselves.

Current split:

- `state-recorders.ts`
  Stateful mutation helpers for citation verification, idle research,
  innovation reflection, and experiment memory/ledger upserts.

Boundary rules:

- Keep public exports in `../workflow-guard.ts`.
- Keep normalization and serialization contracts in `../workflow-guard-state/`.
- Recorders may depend on state contracts and shared helpers, but should not own
  auto-iterator or stage-routing decisions.
