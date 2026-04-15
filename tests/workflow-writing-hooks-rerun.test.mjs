import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeWorkflowTextArtifact } from "../tools/workflow-artifact-text-writer.ts";
import { evaluateWorkflowHooksForPoint } from "../tools/workflow-hooks/executor.ts";
import { buildWorkflowHookPointContext } from "../tools/workflow-hooks/point-context.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildWritingContext(params) {
  return buildWorkflowHookPointContext({
    projectRoot: params.projectRoot,
    projectId: "demo-project",
    stage: "write",
    hookPoint: "before_task_complete",
    ownerRole: "academic_writer",
    actorRole: "academic_writer",
    targetRole: "academic_writer",
    taskId: params.taskId,
    workflowLine: "experiment",
    paperMode: "conference",
    changedPaths: params.writeResult.changedPaths,
    artifactKinds: params.writeResult.artifactKinds,
  });
}

test("write_text_artifact exposes change metadata so hooks can rerun only for affected files", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-writing-hook-rerun-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "abstract-hook",
          hook_type: "file_audit",
          stage: "write",
          hook_point: "before_task_complete",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/sections/abstract.tex",
          requirement_prompt: "Review the abstract section only.",
          filters: {
            task_ids: ["write.section.abstract"],
            changed_paths_any: ["academic_writer/paper/sections/abstract.tex"],
          },
        },
        {
          hook_id: "results-hook",
          hook_type: "file_audit",
          stage: "write",
          hook_point: "before_task_complete",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/sections/results.tex",
          requirement_prompt: "Review the results section only.",
          filters: {
            task_ids: ["write.section.results"],
            changed_paths_any: ["academic_writer/paper/sections/results.tex"],
          },
        },
      ],
    },
  });

  const abstractWrite = await writeWorkflowTextArtifact({
    projectRoot,
    role: "academic_writer",
    artifactPath: "academic_writer/paper/sections/abstract.tex",
    content: "\\section*{Abstract}\nVersion one.\n",
  });
  assert.equal(abstractWrite.changed, true);
  assert.deepEqual(abstractWrite.changedPaths, [
    "academic_writer/paper/sections/abstract.tex",
  ]);
  assert.ok(abstractWrite.artifactKinds.includes("paper_section"));

  const started = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context: buildWritingContext({
      projectRoot,
      taskId: "write.section.abstract",
      writeResult: abstractWrite,
    }),
    requesterSessionKey: "agent:academic_writer:main",
    launchReviewerRun: async ({ hookId }) => ({
      launched: true,
      runId: `run-${hookId}-1`,
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });
  assert.deepEqual(
    started.hooksRun.map((entry) => entry.hookId),
    ["abstract-hook"]
  );

  const completed = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "ok" }),
      getSessionMessages: async () => ({
        messages: [
          JSON.stringify({
            verdict: "pass",
            summary: "Abstract is aligned.",
            violations: [],
            requiredFixes: [],
            reviewedArtifacts: ["academic_writer/paper/sections/abstract.tex"],
            confidence: 0.95,
          }),
        ],
      }),
    },
    context: buildWritingContext({
      projectRoot,
      taskId: "write.section.abstract",
      writeResult: abstractWrite,
    }),
    requesterSessionKey: "agent:academic_writer:main",
  });
  assert.equal(completed.aggregateVerdict, "pass");

  const unchangedWrite = await writeWorkflowTextArtifact({
    projectRoot,
    role: "academic_writer",
    artifactPath: "academic_writer/paper/sections/abstract.tex",
    content: "\\section*{Abstract}\nVersion one.\n",
  });
  assert.equal(unchangedWrite.changed, false);
  assert.deepEqual(unchangedWrite.changedPaths, []);

  const skipped = await evaluateWorkflowHooksForPoint({
    context: buildWritingContext({
      projectRoot,
      taskId: "write.section.abstract",
      writeResult: unchangedWrite,
    }),
  });
  assert.equal(skipped.aggregateStatus, "idle");
  assert.deepEqual(skipped.hooksRun, []);

  const resultsWrite = await writeWorkflowTextArtifact({
    projectRoot,
    role: "academic_writer",
    artifactPath: "academic_writer/paper/sections/results.tex",
    content: "\\section{Results}\nNew result text.\n",
  });
  assert.equal(resultsWrite.changed, true);
  assert.deepEqual(resultsWrite.changedPaths, [
    "academic_writer/paper/sections/results.tex",
  ]);

  const resultsStarted = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context: buildWritingContext({
      projectRoot,
      taskId: "write.section.results",
      writeResult: resultsWrite,
    }),
    requesterSessionKey: "agent:academic_writer:main",
    launchReviewerRun: async ({ hookId }) => ({
      launched: true,
      runId: `run-${hookId}-2`,
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });
  assert.deepEqual(
    resultsStarted.hooksRun.map((entry) => entry.hookId),
    ["results-hook"]
  );

  const abstractRewrite = await writeWorkflowTextArtifact({
    projectRoot,
    role: "academic_writer",
    artifactPath: "academic_writer/paper/sections/abstract.tex",
    content: "\\section*{Abstract}\nVersion two.\n",
  });
  const abstractRerun = await evaluateWorkflowHooksForPoint({
    runtimeSubagent: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context: buildWritingContext({
      projectRoot,
      taskId: "write.section.abstract",
      writeResult: abstractRewrite,
    }),
    requesterSessionKey: "agent:academic_writer:main",
    launchReviewerRun: async ({ hookId }) => ({
      launched: true,
      runId: `run-${hookId}-3`,
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });
  assert.deepEqual(
    abstractRerun.hooksRun.map((entry) => entry.hookId),
    ["abstract-hook"]
  );
});
