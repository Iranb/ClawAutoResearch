import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWorkflowSnapshot,
  runWorkflowAutoIterator,
} from "../../../tools/workflow-guard.ts";
import {
  buildWorkflowControlContract,
  normalizeWorkflowControlContract,
} from "../../../tools/workflow-control-contract.ts";
import { reconcileWorkflowControl } from "../../../tools/workflow-control-reconciler.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("workflow snapshot reads workflow_control before stale manifest projection fields", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-control-contract-")
  );
  const previousProject = process.env.OPENCLAW_PROJECT;
  t.after(async () => {
    if (previousProject == null) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProject;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const contract = buildWorkflowControlContract({
    contractId: "wfctl_test_contract",
    reconciledAt: "2026-05-12T00:00:00.000Z",
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    status: "ready",
    blockingReason: null,
    completionStatus: "incomplete",
    completionSource: "experiment_completion",
    completionReason: "owner_work_required",
    runtimeState: "idle",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "control-contract-demo",
    current_stage: "plan",
    owner_agent: "orchestrator",
    next_action: "/plan-phase",
    blocking_reason: "stale graph discovery warning",
    workflow_control: contract,
  });
  process.env.OPENCLAW_PROJECT = projectRoot;

  const snapshot = await buildWorkflowSnapshot({
    policy: {},
    agentId: "researcher",
    workspaceDir: projectRoot,
  });

  assert.equal(snapshot.currentStage, "experiment");
  assert.equal(snapshot.ownerAgent, "researcher");
  assert.equal(snapshot.nextAction, "/monitor-experiment");
  assert.equal(snapshot.blockingReason, "multi_seed_validation_pending");
  assert.match(snapshot.workflowControlContractId ?? "", /^wfctl_experiment_/);
  assert.equal(snapshot.workflowControlStatus, "waiting");
  assert.equal(snapshot.workflowControlCompletionStatus, "incomplete");
  assert.equal(snapshot.workflowControlCompletionSource, "experiment_completion");
  assert.equal(snapshot.workflowControlRuntimeState, "idle");
});

test("workflow snapshot guidance reads workflow_control next_action before stale projection", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-control-guidance-")
  );
  const previousProject = process.env.OPENCLAW_PROJECT;
  t.after(async () => {
    if (previousProject == null) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProject;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const contract = buildWorkflowControlContract({
    contractId: "wfctl_guidance_contract",
    reconciledAt: "2026-05-12T00:00:00.000Z",
    stage: "code",
    owner: "coder",
    nextAction: "Implement the bounded experiment runtime repair.",
    status: "ready",
    blockingReason: null,
    completionStatus: "incomplete",
    completionSource: "code_completion",
    completionReason: "owner_work_required",
    runtimeState: "active",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "control-contract-guidance-demo",
    current_stage: "plan",
    owner_agent: "orchestrator",
    next_action: "Stale plan projection should not reach dynamic tasks.",
    workflow_control: contract,
  });
  process.env.OPENCLAW_PROJECT = projectRoot;

  const snapshot = await buildWorkflowSnapshot({
    policy: {},
    agentId: "coder",
    workspaceDir: projectRoot,
  });

  assert.ok(
    snapshot.backgroundTasks.includes(
      "Stay aligned with manifest next_action: Implement the bounded experiment runtime repair."
    )
  );
  assert.equal(
    snapshot.backgroundTasks.some((task) =>
      task.includes("Stale plan projection should not reach dynamic tasks.")
    ),
    false
  );
});

test("auto iterator starts from workflow_control before stale manifest projection fields", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-control-auto-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const contract = buildWorkflowControlContract({
    contractId: "wfctl_auto_contract",
    reconciledAt: "2026-05-12T00:00:00.000Z",
    stage: "setup",
    owner: "orchestrator",
    nextAction: '/project-init "research goal"',
    status: "waiting",
    blockingReason: "project_onboarding_pending",
    completionStatus: "incomplete",
    completionSource: "setup_completion",
    completionReason: "project_onboarding_pending",
    runtimeState: "idle",
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    schema_version: 1,
    tracks: [],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "control-contract-auto-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    next_action: "Stale graph-build projection must not drive this tick.",
    blocking_reason: "stale graph discovery warning",
    workflow_control: contract,
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "orchestrator",
    mode: "manual",
    policy: { autoMode: "off" },
    now: "2026-05-12T00:01:00.000Z",
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "setup");
  assert.equal(manifest.workflow_control.stage, "setup");
  assert.equal(manifest.current_stage, "setup");
  assert.notEqual(manifest.workflow_control.stage, "graph_build");
  assert.notEqual(manifest.next_action, "Stale graph-build projection must not drive this tick.");
});

test("reconciler replaces stale same-stage next_action after canonical completion", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-control-same-stage-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const contract = buildWorkflowControlContract({
    contractId: "wfctl_same_stage_stale",
    reconciledAt: "2026-05-12T00:00:00.000Z",
    stage: "analyze",
    owner: "analyzer",
    nextAction: "/analyze-results",
    status: "waiting",
    blockingReason: "analysis_report_missing",
    completionStatus: "incomplete",
    completionSource: "analyze_completion",
    completionReason: "analysis_report_missing",
    runtimeState: "idle",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "same-stage-stale-next-action-demo",
    current_stage: "analyze",
    owner_agent: "analyzer",
    next_action: "/analyze-results",
    workflow_control: contract,
  });
  await fs.mkdir(path.join(projectRoot, "analyzer"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"),
    "Ready analysis.\n",
    "utf8"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "artifacts", "results", "results.json"),
    { metrics: [{ name: "score", value: 0.91 }] }
  );

  const result = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:01:00.000Z",
  });

  assert.equal(result.contract.stage, "analyze");
  assert.equal(result.contract.completion.status, "complete");
  assert.equal(result.contract.next_action, "/review-paper");
  assert.equal(result.manifest.next_action, "/review-paper");
});

test("reconciler does not let legacy stage signals downgrade canonical completion", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-control-complete-signals-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "complete-signals-demo",
    current_stage: "done",
    owner_agent: "orchestrator",
  });

  const result = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:01:00.000Z",
    stageSignalResolver: async () => ["legacy projection says more files are missing"],
  });

  assert.equal(result.contract.stage, "done");
  assert.equal(result.contract.completion.status, "complete");
  assert.equal(result.contract.blocking_reason, null);
  assert.deepEqual(result.stageCompletion.missingSignals, []);
});

test("workflow_control normalizer rejects partial projection-shaped records", () => {
  assert.equal(
    normalizeWorkflowControlContract({
      schema_version: 1,
      stage: "experiment",
      owner: "researcher",
    }),
    null
  );
});
