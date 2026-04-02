# workflow-commands

This directory holds the first-stage extraction of `tools/workflow-commands.ts`.

Current split:

- `types.ts`
  Shared command-facing types, labels, and dependency contracts.
- `parsers.ts`
  Discord/Telegram peer parsing and route-target helpers.
- `formatters.ts`
  Workflow status formatting and human-readable summary helpers.
- `index.ts`
  Re-export surface for the submodule.

Boundary rules:

- Keep command registration, runtime dispatch, and background continuation starts in `../workflow-commands.ts`.
- Move only reusable parsing/formatting/types logic into this directory.
- Add `*.js` shim siblings when source-level `node --test` imports require them.
