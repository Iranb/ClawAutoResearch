import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { readWorkflowHandoffIntentStore, upsertWorkflowHandoffIntent, transitionWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-store.ts";
import { materializeWorkflowTaskGraph, readWorkflowTaskGraphStore } from "../tools/workflow-team/task-graph.ts";

function createTool(params) {
  let registered = null;
  const plugin = createPluginRegistrationContext({
    pluginConfig: {
      projectsRoot: path.dirname(params.projectRoot),
      enforceWorkflowBoundaries: true,
      teamRuntime: { enabled: true },
    },
    registerTool(spec) {
      registered = spec;
    },
    runtime: {},
    logger: {},
  });
  registerWorkflowTools(plugin);
  return registered({
    workspaceDir: params.projectRoot,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionId: `${params.agentId}-session`,
    messageChannel: "discord",
  });
}

async function execute(tool, params) {
  const response = await tool.execute("test", params);
  return JSON.parse(response.content[0].text);
}

test("handoff ack/claim enforces owner and claims target task", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-ack-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      { project_id: "demo", current_stage: "code", owner_agent: "coder" },
      null,
      2
    )}\n`
  );
  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo",
    stage: "code",
    topTierVerdict: null,
    evidenceCloseout: {
      status: "not_applicable",
      topTierVerdict: null,
      blockers: [],
      experimentAnalyzeReady: true,
      analyzeReviewReady: true,
      writeReady: true,
      submitReady: true,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 0,
    },
    previewTasks: [
      {
        taskId: "code.task",
        title: "Code task",
        owner: "coder",
        status: "blocked",
        reason: "Needs code.",
        dependsOn: [],
        verificationRule: "none",
      },
    ],
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "handoff-claim-demo",
    toRole: "coder",
    reason: "stage_owner_change",
    targetTaskId: "code.task",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "dispatching",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "delivered",
  });

  const reviewerTool = createTool({
    projectRoot,
    agentId: "reviewer",
    sessionKey: "agent:reviewer:main",
  });
  await assert.rejects(
    () =>
      execute(reviewerTool, {
        action: "ack_handoff_intent",
        handoffIntentId: created.intent.intentId,
      }),
    /cannot acknowledge/
  );

  const coderTool = createTool({
    projectRoot,
    agentId: "coder",
    sessionKey: "agent:coder:main",
  });
  const acked = await execute(coderTool, {
    action: "ack_handoff_intent",
    handoffIntentId: created.intent.intentId,
  });
  assert.equal(acked.status, "acknowledged");
  const claimed = await execute(coderTool, {
    action: "claim_handoff_intent",
    handoffIntentId: created.intent.intentId,
  });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.activated, true);
  assert.equal(claimed.intent.status, "activated");
  const taskGraph = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(taskGraph.tasks[0].status, "claimed");
  assert.equal(taskGraph.tasks[0].lease.sessionKey, "agent:coder:main");
});

test("prepare_stage_handoff creates a real prepared handoff intent without switching the manifest owner", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-prepare-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo",
        current_stage: "survey_review",
        owner_agent: "researcher",
        survey_review: {
          status: "completed",
          topic: "Demo survey",
        },
      },
      null,
      2
    )}\n`
  );

  const researcherTool = createTool({
    projectRoot,
    agentId: "researcher",
    sessionKey: "agent:researcher:main",
  });
  const prepared = await execute(researcherTool, {
    action: "prepare_stage_handoff",
    handoff: {
      stageAfter: "write",
      toRole: "academic_writer",
      summary: "Survey packet is complete and ready for write.",
      command: "/paper-phase",
      dispatch: false,
    },
  });

  assert.equal(prepared.created, true);
  assert.equal(prepared.intent.status, "prepared");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.orchestration_state.pending_owner_candidate, "academic_writer");

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents.length, 1);
  assert.equal(store.intents[0].status, "prepared");
});
