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

## Fast Test Workflow

Use a layered test loop so live workflow repairs do not wait on full-suite runs after every small edit.

- Pre-test live session check: before every targeted test, full test, or live smoke involving the real AutoResearch project, inspect `.openclaw-research/workflow-runtime-sessions.json` in the live project and report active/bound session status before dispatching more work.
- Inner loop: run only the tests that cover the touched file or reproduced bug. Prefer `node --test <test-file>` and `--test-name-pattern` when a single case is enough.
- Workflow decision tests: use `npm run test:workflow:auto-iterator` and `npm run test:workflow:control-plane`, plus narrow files such as `tests/workflow/auto-iterator/auto-iterator.test.mjs` and `tests/workflow/guard/workflow-guard-modules.test.mjs`.
- Paper ingestion and graph catch-up tests: use `npm run test:paper-ingestion`, `npm run test:workflow:runtime`, and `npm run test:idea-catalyst` for runtime-bridged ingestion cases.
- Runtime queue/session repair tests: use `npm run test:workflow:runtime`, with narrow cases in `tests/workflow/runtime/workflow-service.test.mjs`, `tests/workflow/runtime/workflow-runtime-tools.test.mjs`, and `tests/workflow/runtime/workflow-fast-paths.test.mjs`.
- Handoff and ownership tests: use `npm run test:workflow:handoff`, plus `tests/workflow/auto-iterator/workflow-auto-stage-handoff.test.mjs` when stage routing is involved.
- Experiment routing tests: use `npm run test:experiment`, plus experiment-focused cases in `tests/workflow/auto-iterator/auto-iterator.test.mjs`.
- Writing/review tests: use `npm run test:workflow:writing` and `npm run test:research-writing`, plus review/submit-focused cases in `tests/workflow/auto-iterator/auto-iterator.test.mjs`.
- Survey workflow tests: use `npm run test:survey`, plus survey-focused cases in `tests/workflow/auto-iterator/auto-iterator.test.mjs`.
- Live smoke: after syncing to `ClawAutoResearch`, run one real-project auto-iterator or worker replay that prints stage, owner, next action, blocking reason, missing signals, and PaperNexus graph presence. Do not repeat remote PaperNexus imports when the only observed blocker is an external corpus configuration such as a missing remote `EML` corpus.
- Runtime sync: build in the development repo, then sync the minimum needed runtime artifacts to `ClawAutoResearch`. Avoid full iCloud-backed `rsync` loops unless files outside `dist/`, touched `tools/`, tests, or templates changed.

Before commit or shipping, widen verification to `npm run build`, `npm run lint` when available, `git diff --check`, `gitnexus_detect_changes()`, and either the relevant subsystem suite or `npm test` depending on blast radius.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ClawAutoResearch** (32203 symbols, 51191 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ClawAutoResearch/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ClawAutoResearch/clusters` | All functional areas |
| `gitnexus://repo/ClawAutoResearch/processes` | All execution flows |
| `gitnexus://repo/ClawAutoResearch/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
