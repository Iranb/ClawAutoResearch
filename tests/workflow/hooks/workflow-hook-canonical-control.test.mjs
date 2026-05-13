import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runWorkflowHookPointGate } from "../../../tools/workflow-hooks/gateways.ts";
import { evaluateWorkflowHandoffHooks } from "../../../tools/workflow-hooks/handoff-gates.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function surveyWorkflowControl() {
  return {
    schema_version: 1,
    contract_id: "workflow-control:test",
    reconciled_at: "2026-05-12T12:00:00.000Z",
    stage: "survey_review",
    owner: "researcher",
    next_action: "/survey-pipeline",
    status: "ready",
    blocking_reason: null,
    completion: {
      status: "incomplete",
      source: "survey_review_completion",
      reason: null,
    },
    runtime_state: "idle",
    queue_key: null,
    session_key: null,
  };
}

async function writeSurveyHookProject(t, prefix) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, "reviewer"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "reviewer", "SURVEY_GATE.md"), "gate\n", "utf8");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-survey-project",
    current_stage: "plan",
    owner_agent: "orchestrator",
    workflow_control: surveyWorkflowControl(),
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "survey-only-gate",
          hook_type: "file_audit",
          stage: "survey_review",
          hook_point: "before_stage_handoff",
          target_role: "researcher",
          auditor_role: "reviewer",
          file_path: "reviewer/SURVEY_GATE.md",
          requirement_prompt: "Check the survey handoff gate.",
          applies_when: {
            workflow_lines: ["survey"],
          },
        },
      ],
    },
  });
  return projectRoot;
}

test("workflow hook point gate uses canonical workflow_control before stale stage projection", async (t) => {
  const projectRoot = await writeSurveyHookProject(
    t,
    "openclaw-hook-canonical-gateway-"
  );

  const summary = await runWorkflowHookPointGate({
    workflowRuntime: {
      async run() {
        return { runId: "hook-run-1" };
      },
    },
    projectRoot,
    projectId: "demo-survey-project",
    stage: "survey_review",
    hookPoint: "before_stage_handoff",
    ownerRole: "researcher",
    actorRole: "orchestrator",
    requesterSessionKey: "agent:orchestrator:test",
  });

  assert.equal(summary.hooksRun[0]?.hookId, "survey-only-gate");
  assert.equal(summary.hooksRun[0]?.launched, true);
});

test("handoff hook gate uses canonical workflow_control before stale stage projection", async (t) => {
  const projectRoot = await writeSurveyHookProject(
    t,
    "openclaw-hook-canonical-handoff-"
  );

  const result = await evaluateWorkflowHandoffHooks({
    workflowRuntime: {
      async run() {
        return { runId: "hook-run-1" };
      },
    },
    projectRoot,
    projectId: "demo-survey-project",
    hookPoint: "before_stage_handoff",
    stage: "survey_review",
    ownerBefore: "orchestrator",
    ownerAfter: "researcher",
    requesterSessionKey: "agent:orchestrator:test",
  });

  assert.equal(result.hookGate?.hookGatePolicyIds.includes("survey-only-gate"), true);
  assert.equal(result.allowed, false);
});
