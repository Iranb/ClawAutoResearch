# Code Innovation Review And Workspace Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable multi-agent code-innovation review gate before `CODE -> EXPERIMENT`, strengthen baseline/innovation manifest contracts, and add a Researcher workspace-update skill that can refresh `ClawAutoResearch` and run `install.sh` non-interactively.

**Architecture:** Reuse the existing workflow auto-review runtime shape: a new persisted code-review store plus coordinator-driven nested reviewer runs, while extending code-stage manifest validation in `workflow-guard.ts`. Add a dedicated Researcher skill and installer `--yes` flag so workspace updates are deterministic and restart-safe.

**Tech Stack:** TypeScript, Node test runner, markdown skills/docs, bash installer

---

### Task 1: Add failing regression coverage for code review gating

**Files:**
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-service.test.mjs`
- Create: `tests/researcher-workspace-update-skill.test.mjs`

- [x] Add failing tests for aggressive code review pending/approved behavior.
- [x] Add failing tests for new manifest contract signals.
- [x] Add failing tests for the new Researcher workspace-update skill and installer `--yes` mode.

### Task 2: Implement durable code-review runtime

**Files:**
- Create: `tools/workflow-code-review.ts`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/workflow-auto-mode.ts`

- [x] Add persisted code-review packet/store helpers and reviewer prompts.
- [x] Block `CODE -> EXPERIMENT` in aggressive mode until code review is approved.
- [x] Teach the coordinator to launch/poll/recover code-review rounds.
- [x] Surface code-review status in `/workflow-status`.

### Task 3: Strengthen baseline + innovation contract enforcement

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `WORKFLOW.md`
- Modify: `skills/coder/implement-experiment/SKILL.md`
- Modify: `skills/orchestrator/plan-research/SKILL.md`
- Modify: `agents/coder/AGENTS.md`
- Modify: `agents/coder/SOUL.md`
- Modify: `agents/coder/TOOLS.md`
- Modify: `agents/coder/HEARTBEAT.md`
- Modify: `agents/orchestrator/AGENTS.md`

- [x] Require baseline reference / metric / target improvement / protocol fields in experiment manifests.
- [x] Require innovation points, validation steps, and ablation plan coverage.
- [x] Teach Coder and Orchestrator to preserve baseline training/eval fidelity unless deviations are declared.

### Task 4: Add Researcher workspace-update skill and installer support

**Files:**
- Create: `skills/researcher/workspace-update/SKILL.md`
- Modify: `skills/index.json`
- Modify: `agents/researcher/AGENTS.md`
- Modify: `agents/researcher/TOOLS.md`
- Modify: `install.sh`

- [x] Add a Researcher skill for updating `/workspace/ClawAutoResearch`.
- [x] Add installer `--yes` / non-interactive confirmation support.
- [x] Document the auto-yes install path and role-file overwrite behavior.

### Task 5: Verify

**Files:**
- Modify if needed based on failures from earlier tasks

- [x] Run `node --test tests/auto-iterator.test.mjs tests/workflow-service.test.mjs tests/researcher-workspace-update-skill.test.mjs`
- [x] Run `npm run build`
- [x] Run any additional focused tests needed after fixes

## Completion Notes

- Added a new persisted `CODE-REVIEW` runtime with multi-agent reviewer quorum (`researcher`, `orchestrator`, `reviewer`) and stable packet fingerprinting.
- Tightened `CODE` stage bundle requirements so baseline fidelity, metric targeting, and incremental innovation validation are enforced before `CODE -> EXPERIMENT`.
- Added `workspace-update` for Researcher plus `install.sh --yes` / `OPENCLAW_INSTALL_ASSUME_YES` for deterministic reinstall flows.
- Verified with:
  - `node --test tests/auto-iterator.test.mjs tests/workflow-service.test.mjs tests/researcher-workspace-update-skill.test.mjs tests/workflow-commands.test.mjs`
  - `npm run build`
