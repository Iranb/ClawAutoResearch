import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateWorkflowHooksForPoint } from "../tools/workflow-hooks/executor.ts";
import { buildWorkflowHookPointContext } from "../tools/workflow-hooks/point-context.ts";
import { getFileAuditStateSummary } from "../tools/workflow-hooks/state.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("evaluateWorkflowHooksForPoint launches and then settles a file audit hook", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-executor-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "writer-main-tex",
          hook_type: "file_audit",
          stage: "review",
          hook_point: "before_stage_handoff",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "Check unsupported claims.",
        },
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "A supported draft.\n",
    "utf8"
  );

  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "review",
    hookPoint: "before_stage_handoff",
    ownerRole: "academic_writer",
    actorRole: "researcher",
  });

  const started = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
    launchReviewerRun: async () => ({
      launched: true,
      runId: "run-1",
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });
  assert.equal(started.aggregateStatus, "auditing");
  assert.equal(started.hooksRun[0]?.launched, true);

  const completed = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "ok" }),
      getSessionMessages: async () => ({
        messages: [
          JSON.stringify({
            verdict: "pass",
            summary: "Looks good.",
            violations: [],
            requiredFixes: [],
            reviewedArtifacts: ["academic_writer/paper/main.tex"],
            confidence: 0.9,
          }),
        ],
      }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
  });
  assert.equal(completed.aggregateVerdict, "pass");
  assert.equal(completed.aggregateStatus, "passed");
});

test("evaluateWorkflowHooksForPoint invalidates a cached pass when supporting artifacts drift", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-drift-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "writer-main-tex",
          hook_type: "file_audit",
          stage: "review",
          hook_point: "before_stage_handoff",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "Check unsupported claims.",
          supporting_artifacts: ["analyzer/CLAIM_EVIDENCE_MATRIX.md"],
        },
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "analyzer"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "A supported draft.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "claim-a supported\n",
    "utf8"
  );

  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "review",
    hookPoint: "before_stage_handoff",
    ownerRole: "academic_writer",
    actorRole: "researcher",
  });

  await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
    launchReviewerRun: async () => ({
      launched: true,
      runId: "run-1",
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });

  await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "ok" }),
      getSessionMessages: async () => ({
        messages: [
          JSON.stringify({
            verdict: "pass",
            summary: "Looks good.",
            violations: [],
            requiredFixes: [],
            reviewedArtifacts: ["academic_writer/paper/main.tex"],
            confidence: 0.9,
          }),
        ],
      }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
  });

  await fs.writeFile(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "claim-a is now unsupported\n",
    "utf8"
  );

  const rerun = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
    launchReviewerRun: async () => ({
      launched: true,
      runId: "run-2",
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });

  assert.equal(rerun.aggregateStatus, "auditing");
  assert.equal(rerun.hooksRun[0]?.launched, true);
});

test("evaluateWorkflowHooksForPoint restarts auditing when live inputs drift mid-flight", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-midflight-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "writer-main-tex",
          hook_type: "file_audit",
          stage: "review",
          hook_point: "before_stage_handoff",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "Check unsupported claims.",
        },
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "version one\n",
    "utf8"
  );

  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "review",
    hookPoint: "before_stage_handoff",
    ownerRole: "academic_writer",
    actorRole: "researcher",
  });

  await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
    launchReviewerRun: async () => ({
      launched: true,
      runId: "run-1",
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });

  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "version two\n",
    "utf8"
  );

  const rerun = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "ok" }),
      getSessionMessages: async () => ({
        messages: [
          JSON.stringify({
            verdict: "pass",
            summary: "Looks good.",
            violations: [],
            requiredFixes: [],
            reviewedArtifacts: ["academic_writer/paper/main.tex"],
            confidence: 0.9,
          }),
        ],
      }),
    },
    context,
    requesterSessionKey: "agent:researcher:main",
    launchReviewerRun: async () => ({
      launched: true,
      runId: "run-2",
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });

  assert.equal(rerun.aggregateStatus, "auditing");
  const summary = await getFileAuditStateSummary({ projectRoot });
  assert.equal(summary.stateStore.hooks["writer-main-tex"]?.roundsStarted, 2);
});
