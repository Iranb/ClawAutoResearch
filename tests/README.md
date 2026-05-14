# Test Module Layout

Tests are grouped by functional area so targeted runs do not need the full suite.

Run everything:

```bash
npm test
```

Select tests from the current git diff:

```bash
npm run test:changed:list
npm run test:changed
```

`test:changed:list` prints the changed files, selected test files, covering
npm scripts, and the narrow `node --test ...` command. `test:changed` runs the
selected files. The selector follows relative imports from source files to test
files, then adds conservative subsystem fallback suites for workflow entrypoints
that are difficult to prove with static imports alone.

Useful variants:

```bash
node scripts/select_changed_tests.mjs --base main
node scripts/select_changed_tests.mjs --staged
node scripts/select_changed_tests.mjs --files tools/workflow-stage-completion.ts
node scripts/select_changed_tests.mjs --json
```

Run a module:

```bash
npm run test:workflow:auto-iterator
npm run test:workflow:commands
npm run test:workflow:runtime
npm run test:workflow:handoff
npm run test:workflow:evidence
npm run test:workflow:project
npm run test:paper-ingestion
npm run test:papernexus
npm run test:research-writing
npm run test:survey
```

Directory map:

- `tests/agents`: agent dispatch, prompt policy, and capability completion.
- `tests/distribution`: dist runtime preparation and model sync.
- `tests/e2e`: end-to-end command, paper generation, and dashboard harnesses.
- `tests/experiment`: experiment routing, local execution, git search, and evaluation.
- `tests/gateway`: isolated gateway and runtime subagent behavior.
- `tests/idea-catalyst`: idea catalyst modules, LLM contracts, cross-domain inspiration, state, runtime tools, and ideation evidence.
- `tests/literature`: literature discovery, provider evidence, and research30 search.
- `tests/lobster`: Lobster handoff integration.
- `tests/paper-ingestion`: paper discovery, source contracts, ingestion retry/validation, and graph catch-up.
- `tests/papernexus`: PaperNexus MCP, batch execution, packet integration, secrets, and certification.
- `tests/plugin`: plugin identity, registration, install, and workspace-update skill checks.
- `tests/research-memory`: cycle memory and portfolio memory aggregation.
- `tests/research-writing`: manuscript writing, theory, citation, and authoring helpers.
- `tests/survey`: survey review, survey writing, survey visuals, and survey workflow route.
- `tests/workflow/auto-iterator`: auto iterator stage decisions, auto mode, and auto-stage dispatch.
- `tests/workflow/commands`: slash/local command handlers and command replay harnesses.
- `tests/workflow/control-plane`: broad control-plane integration coverage that spans multiple workflow subsystems.
- `tests/workflow/derived-state`: derived readiness, track evidence, and handoff eligibility state.
- `tests/workflow/diagnostics`: workflow diagnostics log behavior.
- `tests/workflow/discussion`: panel discussion and reusable decision round behavior.
- `tests/workflow/docs`: workflow documentation site checks.
- `tests/workflow/evidence`: workflow evidence kernel, protocol convergence, and top-tier evidence architecture.
- `tests/workflow/execution`: execution runtime, proof receipts, and execution budget.
- `tests/workflow/frontier-mapping`: frontier mapping preflight and durable artifact materialization.
- `tests/workflow/guard`: Workflow Guard policy, state, setters, summaries, and guard evaluations.
- `tests/workflow/handoff`: handoff activation, delivery, maintenance, budgets, receipts, and broadcasts.
- `tests/workflow/hooks`: hooks, file audit, and intermediate artifact policy.
- `tests/workflow/kernel`: workflow kernel graph-context helpers.
- `tests/workflow/project`: project binding, project migration, and project resolution.
- `tests/workflow/prompting`: workflow snapshot/status prompt formatting and prompt policy.
- `tests/workflow/runtime`: runtime queue/session service, background pool, fast paths, and GPU monitor.
- `tests/workflow/team`: workflow team runtime, task claims, collaboration, and agent session isolation.
- `tests/workflow/writing`: workflow writing hooks, workbench, review fixes, revision control, and writer/reviewer state.
- `tests/workflow/zotero`: Zotero sync and related scientific skills.
