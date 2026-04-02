# workflow-guard-runtime

This directory holds runtime glue extracted from `tools/workflow-guard.ts`.

Current split:

- `auto-iterator.ts`
  The workflow auto-iterator loop, expressed as a dependency-injected runtime
  module behind the facade export in `../workflow-guard.ts`.

Boundary rules:

- Keep the stable public API in `../workflow-guard.ts`.
- Keep stage missing-signal collection in `../workflow-guard-stages/`.
- Keep summaries, materializers, and state contracts in their dedicated
  directories; runtime modules should orchestrate them rather than reimplement
  them.
