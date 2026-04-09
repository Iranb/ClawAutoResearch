# Zotero Project Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow-owned, non-blocking Zotero project sync flow with a dedicated `/zotero-sync` Discord command, configurable plugin-global Zotero root, and safe project-level reconciliation.

**Architecture:** Extend workflow policy with one plugin-global Zotero root setting, resolve the effective per-project Zotero path from explicit manifest override or global root, and centralize packet generation plus prompt guidance in a small Zotero sync helper. Manual `/zotero-sync` and existing research/graph flows should trigger bounded background continuations only; foreground code updates state and returns immediately.

**Tech Stack:** TypeScript, Node.js, existing workflow command/runtime helpers, node:test, JSON plugin schema/docs.

---

### Task 1: Add plugin-global Zotero root configuration and effective path resolution

**Files:**
- Modify: `openclaw.plugin.json`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-guard-project-state.ts`
- Modify: `DOC/reference/configuration.md`
- Test: `tests/workflow-prompt-ownership.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [ ] **Step 1: Write the failing policy/config tests**

```js
test("getWorkflowGuardPolicy defaults zoteroProjectRoot to bot", () => {
  const policy = getWorkflowGuardPolicy({});
  assert.equal(policy.zoteroProjectRoot, "bot");
});

test("getWorkflowGuardPolicy preserves explicit zoteroProjectRoot", () => {
  const policy = getWorkflowGuardPolicy({ zoteroProjectRoot: "Bot" });
  assert.equal(policy.zoteroProjectRoot, "Bot");
});
```

- [ ] **Step 2: Run the policy test to verify it fails**

Run: `/opt/homebrew/bin/node --test tests/workflow-prompt-ownership.test.mjs`
Expected: FAIL because `zoteroProjectRoot` does not exist yet.

- [ ] **Step 3: Write the failing project-init/default-path test**

```js
assert.equal(
  manifest.research_program.zotero_project_path,
  "Bot/gcd-confirmation-bias-mitigation"
);
```

Use plugin config with `zoteroProjectRoot: "Bot"` and a second case with no explicit root expecting `bot/<project-id>`.

- [ ] **Step 4: Run the workflow command test to verify it fails**

Run: `/opt/homebrew/bin/node --test tests/workflow-commands.test.mjs`
Expected: FAIL because the default path logic is still hard-coded.

- [ ] **Step 5: Implement the minimal policy/config support**

Required changes:
- add `zoteroProjectRoot?: string` to `WorkflowGuardPolicy`
- add `DEFAULT_POLICY.zoteroProjectRoot = "bot"`
- normalize `config.zoteroProjectRoot` in `normalizePolicy(...)`
- add `zoteroProjectRoot` to `openclaw.plugin.json` schema and `uiHints`
- add one helper in `tools/workflow-guard-project-state.ts` that resolves:
  - explicit manifest path first
  - else `<policy.zoteroProjectRoot>/<project-id>`
  - else `bot/<project-id>`

- [ ] **Step 6: Update project bootstrap to use the effective default root**

Touch the existing bootstrap and `project-init` call sites so new projects inherit the configured global root without overwriting explicit per-project paths.

- [ ] **Step 7: Run the targeted tests to verify they pass**

Run: `/opt/homebrew/bin/node --test tests/workflow-prompt-ownership.test.mjs tests/workflow-commands.test.mjs`
Expected: PASS for the new policy/default-path assertions.

- [ ] **Step 8: Commit**

```bash
git add openclaw.plugin.json tools/workflow-guard.ts tools/workflow-guard-project-state.ts DOC/reference/configuration.md tests/workflow-prompt-ownership.test.mjs tests/workflow-commands.test.mjs
git commit -m "Add configurable Zotero project root"
```

### Task 2: Add a workflow-owned Zotero sync helper and durable packet artifacts

**Files:**
- Create: `tools/workflow-zotero-sync.ts`
- Modify: `tools/workflow-guard-project-state.ts`
- Test: `tests/workflow-zotero-sync.test.mjs`

- [ ] **Step 1: Write the failing helper tests**

```js
test("resolveEffectiveZoteroProjectPath prefers explicit manifest path over global root", () => {
  assert.equal(
    resolveEffectiveZoteroProjectPath({
      projectId: "paper-lab",
      explicitProjectPath: "Bot/custom-folder",
      zoteroProjectRoot: "bot",
    }),
    "Bot/custom-folder"
  );
});

test("materializeZoteroSyncPacket writes selected/baselines/writing-shortlist targets", async () => {
  const packet = await materializeZoteroSyncPacket(...);
  assert.deepEqual(packet.collections.map((entry) => entry.kind), [
    "selected",
    "baselines",
    "writing-shortlist",
  ]);
});

test("packet materialization records collection removal policy without deleting Zotero items", async () => {
  const packet = await materializeZoteroSyncPacket(...);
  assert.equal(packet.removalPolicy, "remove_from_project_collections_only");
});
```

- [ ] **Step 2: Run the new helper test file to verify it fails**

Run: `/opt/homebrew/bin/node --test tests/workflow-zotero-sync.test.mjs`
Expected: FAIL because the helper file and packet writer do not exist yet.

- [ ] **Step 3: Implement the minimal helper**

`tools/workflow-zotero-sync.ts` should own:
- effective path resolution
- one JSON packet writer for `{PROJ}/researcher/ZOTERO_SYNC_PACKET.json`
- one Markdown summary writer for `{PROJ}/researcher/ZOTERO_PACKET.md`
- collection targets for:
  - `selected`
  - `baselines`
  - `writing-shortlist`
- explicit packet status model that supports `pending`, `queued`, `synced`, `skipped`, `unavailable`, `failed`, `needs_manual_followup`
- removal policy fixed to “remove from project collections only”

Keep the first version simple:
- derive `selected` from canonical entries in `PAPER_SOURCE_INDEX.json`
- derive `baselines` from available baseline references/required baselines when possible
- derive `writing-shortlist` only from existing workflow-owned shortlist/citation artifacts when present; otherwise emit an empty collection target rather than guessing

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `/opt/homebrew/bin/node --test tests/workflow-zotero-sync.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/workflow-zotero-sync.ts tests/workflow-zotero-sync.test.mjs tools/workflow-guard-project-state.ts
git commit -m "Add workflow-owned Zotero sync packet helper"
```

### Task 3: Register `/zotero-sync` and launch it as a bounded background Researcher continuation

**Files:**
- Modify: `tools/workflow-commands/types.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/register-research-commands.ts` (only if needed by exported types/coverage)
- Modify: `tools/workflow-guard-prompt-assembly.ts`
- Test: `tests/workflow-commands.test.mjs`
- Test: `tests/workflow-fast-paths.test.mjs`

- [ ] **Step 1: Write the failing command registration and routing tests**

Add a new command test shaped like the existing graph-build test:

```js
test("zotero-sync command starts a background continuation for the current project and routes it to Researcher", async () => {
  assert.equal(result.text, "Background Zotero sync started for paper-lab.");
  assert.equal(captured.backgroundRun.kind, "zotero_sync");
  assert.match(captured.backgroundRun.commandText, /^\/zotero-sync\b/);
});
```

Also add a degraded-runtime test mirroring `resume-pipeline` so command queueing still works when runtime subagent access is unavailable.

- [ ] **Step 2: Write the failing background-prompt test**

Add a `tests/workflow-fast-paths.test.mjs` case asserting the background run:
- includes `/zotero-sync`
- tells the background Researcher to use `/zotero-project-library`
- mentions the effective configured collection root
- states “do not block the foreground session”
- states removal is collection-only, not item deletion

- [ ] **Step 3: Run the targeted command/fast-path tests to verify they fail**

Run: `/opt/homebrew/bin/node --test tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs`
Expected: FAIL because `zotero_sync` is not a known command kind yet.

- [ ] **Step 4: Implement the minimal command path**

Required changes:
- add `zotero_sync` to `WorkflowBackgroundCommandKind`, `WorkflowCommandKind`, and `COMMAND_LABELS`
- add a builder like `buildZoteroSyncBackgroundCommand(...)`
- register a new `/zotero-sync` command in `createResearchWorkflowCommands(...)`
- make the handler:
  - resolve the current project
  - materialize/refresh `ZOTERO_SYNC_PACKET.json`
  - start or queue a background Researcher continuation
  - return immediately with a non-blocking status message

- [ ] **Step 5: Implement the background continuation guidance**

Update `workflow-fast-paths.ts` so `zotero_sync` continuations get:
- explicit `/zotero-project-library` instructions
- project-wide reconciliation language
- collection-only removal rule
- foreground-responsiveness / no-inline-wait rule
- `ZOTERO_PACKET.md` / `ZOTERO_SYNC_PACKET.json` refresh reminder

- [ ] **Step 6: Run the targeted tests to verify they pass**

Run: `/opt/homebrew/bin/node --test tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs`
Expected: PASS for the new command and prompt assertions.

- [ ] **Step 7: Commit**

```bash
git add tools/workflow-commands/types.ts tools/workflow-commands.ts tools/workflow-fast-paths.ts tools/workflow-guard-prompt-assembly.ts tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs
git commit -m "Add non-blocking zotero-sync workflow command"
```

### Task 4: Hook soft-sync guidance into workflow checkpoints and update docs

**Files:**
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `WORKFLOW.md`
- Modify: `DOC/reference/slash-commands.md`
- Modify: `DOC/reference/skills.md`
- Modify: `skills/researcher/research-lit/SKILL.md`
- Modify: `skills/researcher/graph-build/SKILL.md`
- Test: `tests/workflow-zotero-scientific-skills.test.mjs`

- [ ] **Step 1: Write the failing docs/skills assertions**

Extend existing docs tests to expect:
- configurable plugin-global Zotero root terminology
- `/zotero-sync` in slash-command docs
- reconciliation/removal language that is collection-only, not delete/trash

- [ ] **Step 2: Run the docs test to verify it fails**

Run: `/opt/homebrew/bin/node --test tests/workflow-zotero-scientific-skills.test.mjs`
Expected: FAIL because docs do not mention `/zotero-sync` or configurable root yet.

- [ ] **Step 3: Implement the minimal docs/guidance updates**

Update docs and skill text so they consistently say:
- project bibliography root is configurable globally and defaults to `bot`
- explicit project path still wins
- `/zotero-sync` is the manual project-wide reconciliation command
- stale papers are removed only from project collections, not deleted from Zotero

- [ ] **Step 4: Run the docs test to verify it passes**

Run: `/opt/homebrew/bin/node --test tests/workflow-zotero-scientific-skills.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run focused regression verification**

Run:

```bash
/opt/homebrew/bin/node --test tests/workflow-zotero-sync.test.mjs tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs tests/workflow-prompt-ownership.test.mjs tests/workflow-zotero-scientific-skills.test.mjs
```

Expected: all targeted Zotero/config/command tests PASS.

- [ ] **Step 6: Run broader workflow verification**

Run:

```bash
/opt/homebrew/bin/node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs
```

Expected: PASS with no regressions in background workflow dispatch or runtime tooling.

- [ ] **Step 7: Commit**

```bash
git add WORKFLOW.md DOC/reference/slash-commands.md DOC/reference/skills.md skills/researcher/research-lit/SKILL.md skills/researcher/graph-build/SKILL.md tests/workflow-zotero-scientific-skills.test.mjs
git commit -m "Document workflow-owned Zotero sync behavior"
```

### Final Verification

**Files:**
- Review only

- [ ] **Step 1: Run final full verification for touched workflow areas**

```bash
/opt/homebrew/bin/node --test tests/workflow-zotero-sync.test.mjs tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs tests/workflow-prompt-ownership.test.mjs tests/workflow-zotero-scientific-skills.test.mjs tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs
PATH=/opt/homebrew/bin:$PATH npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --stat HEAD~4..HEAD` or `git diff --stat main...HEAD`
Expected: only the intended Zotero workflow/config/command/docs files changed.

- [ ] **Step 3: Prepare branch completion**

Use the finishing-a-development-branch workflow after verification passes.
