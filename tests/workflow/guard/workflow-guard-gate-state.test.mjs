import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readJsonIfExists, writeJsonEnsured } from "../../../tools/workflow-guard-core/fs.ts";
import {
  computeWorkflowGateConfirmationDeadline,
  getWorkflowGateStatePath,
  getWorkflowGateStateSummary,
  normalizeWorkflowGateState,
  setWorkflowGateStateForWorkflow,
} from "../../../tools/workflow-guard-project/gate-state.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-gate-state-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  return projectRoot;
}

test("gate state normalizes and persists timed-default deadlines", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const normalized = normalizeWorkflowGateState({
    current_stage: "review",
    last_gate: "CONFIRM-RESUME-1",
    gate_status: "waiting",
    gate_type: "timed_default",
    auto_proceed: false,
    confirmation_requested_at: "2026-03-28T09:00:00.000Z",
    revision_count: 2.8,
  });

  assert.equal(normalized.currentStage, "review");
  assert.equal(normalized.revisionCount, 2);
  assert.equal(
    computeWorkflowGateConfirmationDeadline(normalized),
    "2026-03-28T10:00:00.000Z"
  );

  const result = await setWorkflowGateStateForWorkflow({
    projectRoot,
    gateState: {
      current_stage: "review",
      last_gate: "CONFIRM-RESUME-1",
      gate_status: "waiting",
      gate_type: "timed_default",
      auto_proceed: false,
      confirmation_requested_at: "2026-03-28T09:00:00.000Z",
      default_action: "resume_recommended_stage",
      default_action_reason: "No reply within the deadline.",
    },
    readJsonIfExists,
    writeJsonEnsured,
  });

  assert.equal(result.state.gateType, "timed_default");
  assert.equal(result.confirmationDeadlineAt, "2026-03-28T10:00:00.000Z");
  assert.equal(result.timedDefaultEligible, true);

  const summary = await getWorkflowGateStateSummary({
    projectRoot,
    readJsonIfExists,
    now: "2026-03-28T10:30:00.000Z",
  });

  assert.equal(summary.timedDefaultExpired, true);
  assert.equal(summary.confirmationDeadlineAt, "2026-03-28T10:00:00.000Z");
  assert.equal(getWorkflowGateStatePath(projectRoot).endsWith("GATE_STATE.json"), true);
});

