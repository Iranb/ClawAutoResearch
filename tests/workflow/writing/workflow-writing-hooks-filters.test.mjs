import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateWorkflowHooksForPoint } from "../../../tools/workflow-hooks/executor.ts";
import { buildWorkflowHookPointContext } from "../../../tools/workflow-hooks/point-context.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("writing hooks honor appliesWhen and fine-grained filters before launching", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-writing-hook-filters-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "survey-abstract",
          hook_type: "file_audit",
          stage: "write",
          hook_point: "before_task_complete",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/sections/abstract.tex",
          requirement_prompt: "Check claim/evidence alignment in the abstract.",
          filters: {
            workflow_lines: ["survey"],
            paper_modes: ["survey"],
            target_roles: ["academic_writer"],
            task_prefixes: ["write.section."],
            file_globs: ["academic_writer/paper/sections/*.tex"],
            materialized_contracts: ["writing_support_bundle"],
            changed_paths_any: ["academic_writer/paper/sections/abstract.tex"],
          },
          applies_when: {
            workflow_lines: ["survey"],
            paper_modes: ["survey"],
            stages: ["write"],
          },
        },
        {
          hook_id: "mismatched-main-tex",
          hook_type: "file_audit",
          stage: "write",
          hook_point: "before_task_complete",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "This hook should be filtered out by file_globs.",
          filters: {
            file_globs: ["academic_writer/paper/sections/*.tex"],
            changed_paths_any: ["academic_writer/paper/sections/abstract.tex"],
          },
        },
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper", "sections"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex"),
    "\\section*{Abstract}\nSupported survey abstract.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\input{sections/abstract}\n",
    "utf8"
  );

  const context = buildWorkflowHookPointContext({
    projectRoot,
    projectId: "demo-project",
    stage: "write",
    hookPoint: "before_task_complete",
    ownerRole: "academic_writer",
    actorRole: "academic_writer",
    targetRole: "academic_writer",
    taskId: "write.section.abstract",
    workflowLine: "survey",
    paperMode: "survey",
    materializedArtifacts: [
      {
        contract: "writing_support_bundle",
        artifactPath: "academic_writer/paper/sections/abstract.tex",
        fingerprint: "sha1:abstract",
        action: "updated",
      },
    ],
    changedPaths: ["academic_writer/paper/sections/abstract.tex"],
  });

  const started = await evaluateWorkflowHooksForPoint({
    workflowRuntime: {
      waitForRun: async () => ({ status: "timeout" }),
      getSessionMessages: async () => ({ messages: [] }),
    },
    context,
    requesterSessionKey: "agent:academic_writer:main",
    launchReviewerRun: async ({ hookId }) => ({
      launched: true,
      runId: `run-${hookId}`,
      sessionKey: "agent:reviewer:main",
      error: null,
    }),
  });

  assert.equal(started.aggregateStatus, "auditing");
  assert.deepEqual(
    started.hooksRun.map((entry) => entry.hookId),
    ["survey-abstract"]
  );
  assert.equal(started.hooksRun[0]?.launched, true);
});

test("writing hooks skip cleanly when workflow filters do not match the current context", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-writing-hook-skip-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "survey-abstract",
          hook_type: "file_audit",
          stage: "write",
          hook_point: "before_task_complete",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/sections/abstract.tex",
          requirement_prompt: "Check claim/evidence alignment in the abstract.",
          filters: {
            workflow_lines: ["survey"],
            changed_paths_any: ["academic_writer/paper/sections/abstract.tex"],
          },
          applies_when: {
            paper_modes: ["survey"],
          },
        },
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper", "sections"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex"),
    "\\section*{Abstract}\nConference abstract.\n",
    "utf8"
  );

  const skipped = await evaluateWorkflowHooksForPoint({
    context: buildWorkflowHookPointContext({
      projectRoot,
      projectId: "demo-project",
      stage: "write",
      hookPoint: "before_task_complete",
      ownerRole: "academic_writer",
      actorRole: "academic_writer",
      targetRole: "academic_writer",
      taskId: "write.section.abstract",
      workflowLine: "experiment",
      paperMode: "conference",
      changedPaths: ["academic_writer/paper/sections/abstract.tex"],
    }),
  });

  assert.equal(skipped.aggregateStatus, "idle");
  assert.equal(skipped.aggregateVerdict, "pass");
  assert.deepEqual(skipped.hooksRun, []);
});
