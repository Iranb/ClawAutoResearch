import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getFileAuditStateSummary,
  normalizeWorkflowHooksPolicy,
  readWorkflowHooksPolicyForProject,
  setFileAuditPolicyForProject,
} from "../tools/workflow-hooks/state.ts";

test("normalizeWorkflowHooksPolicy accepts legacy workflow_audit.checkpoints", () => {
  const policy = normalizeWorkflowHooksPolicy({
    workflow_audit: {
      enabled: true,
      checkpoints: [
        {
          checkpoint_id: "writer-main-tex",
          stage: "review",
          trigger: "before_stage_handoff",
          target_role: "academic_writer",
          auditor_role: "reviewer",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "Check the draft.",
        },
      ],
    },
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.auditHooks.length, 1);
  assert.equal(policy.auditHooks[0].hookId, "writer-main-tex");
  assert.equal(policy.auditHooks[0].hookPoint, "before_stage_handoff");
});

test("setFileAuditPolicyForProject writes workflow_hooks manifest state and summary", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-policy-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );

  await setFileAuditPolicyForProject({
    projectRoot,
    hookPolicies: [
      {
        hook_id: "writer-main-tex",
        hook_type: "file_audit",
        stage: "review",
        hook_point: "before_stage_handoff",
        target_role: "academic_writer",
        auditor_role: "reviewer",
        file_path: "academic_writer/paper/main.tex",
        requirement_prompt: "Check the draft.",
      },
    ],
    mode: "replace",
  });

  const policy = await readWorkflowHooksPolicyForProject(projectRoot);
  assert.equal(policy.auditHooks.length, 1);
  assert.equal(policy.auditHooks[0].hookId, "writer-main-tex");

  const summary = await getFileAuditStateSummary({ projectRoot });
  assert.equal(summary.policy.auditHooks.length, 1);
  assert.deepEqual(summary.stateStore.hooks, {});
});
