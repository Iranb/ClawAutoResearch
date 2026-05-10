import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWorkflowGateControlPackage,
  getFileAuditStateSummary,
  normalizeWorkflowHooksPolicy,
  readWorkflowHooksPolicyForProject,
  setFileAuditPolicyForProject,
  summarizeHookExecutionResults,
} from "../../../tools/workflow-hooks/state.ts";

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

test("normalizeWorkflowHooksPolicy preserves gate routing policy", () => {
  const policy = normalizeWorkflowHooksPolicy({
    workflow_hooks: {
      enabled: true,
      audit_hooks: [
        {
          hook_id: "citation-context",
          hook_type: "file_audit",
          stage: "submit",
          hook_point: "before_stage_handoff",
          target_role: "academic_writer",
          auditor_role: "researcher",
          file_path: "academic_writer/paper/main.tex",
          requirement_prompt: "Check citation context.",
          gate_disposition: "repair_required",
          gate_scope: {
            level: "claim",
            targets: ["claim-related-work-2"],
          },
          repair_owner_role: "researcher",
          repair_command: "Refresh citation context and claim ledger.",
          recheck_hook_id: "citation-context",
          retry_budget: 2,
        },
      ],
    },
  });

  const hook = policy.auditHooks[0];
  assert.equal(hook.gateDisposition, "repair_required");
  assert.deepEqual(hook.gateScope, {
    level: "claim",
    targets: ["claim-related-work-2"],
  });
  assert.equal(hook.repairOwnerRole, "researcher");
  assert.equal(hook.repairCommand, "Refresh citation context and claim ledger.");
  assert.equal(hook.retryBudget, 2);
});

test("summarizeHookExecutionResults emits repair routes without making repair_required a hard block", () => {
  const summary = summarizeHookExecutionResults([
    {
      hookId: "citation-context",
      hookPoint: "before_stage_handoff",
      stage: "submit",
      verdict: "revise",
      status: "revise_requested",
      pending: false,
      launched: false,
      revisedRequested: true,
      escalated: false,
      fileFingerprint: "sha1:main",
      result: {
        verdict: "revise",
        summary: "Citation context is too broad for this claim.",
        violations: [
          {
            rule: "citation_context_mismatch",
            severity: "high",
            location: "Related Work",
            message: "The citation supports retrieval, not experiment repair.",
          },
        ],
        requiredFixes: ["Downgrade the cited claim."],
        reviewedArtifacts: ["academic_writer/paper/main.tex"],
        confidence: 0.95,
        runId: "run-1",
        rawText: "{}",
        reviewerRole: "researcher",
        filePath: "academic_writer/paper/main.tex",
        fileFingerprint: "sha1:main",
        packetFingerprint: "sha1:packet",
        createdAt: "2026-05-08T00:00:00.000Z",
      },
      revisionDispatch: {
        runId: "run-repair",
        sessionKey: "agent:researcher:main",
        dispatchedAt: "2026-05-08T00:01:00.000Z",
        targetRole: "researcher",
        aggregateRevisionPacketPath:
          "reviewer/file-audits/aggregate/before_stage_handoff/submit/researcher.md",
      },
      blockingReason: "Citation context is too broad for this claim.",
      gateDisposition: "repair_required",
      gateScope: {
        level: "claim",
        targets: ["claim-related-work-2"],
      },
      repairRoute: {
        owner: "researcher",
        command: "Refresh citation context and claim ledger.",
        repairPacketPath:
          "reviewer/file-audits/aggregate/before_stage_handoff/submit/researcher.md",
        recheckHookId: "citation-context",
        rollbackStage: null,
        retryBudget: 2,
      },
    },
  ]);

  assert.equal(summary.aggregateVerdict, "revise");
  assert.equal(summary.gateControl.primaryDisposition, "repair_required");
  assert.equal(summary.gateControl.blocking, false);
  assert.equal(summary.gateControl.repairRequiredCount, 1);
  assert.equal(summary.gateControl.repairRoutes[0]?.owner, "researcher");
  assert.equal(summary.gateControl.issues[0]?.scope.level, "claim");
});

test("buildWorkflowGateControlPackage treats block verdicts as hard blockers", () => {
  const gateControl = buildWorkflowGateControlPackage([
    {
      hookId: "proof-obligation",
      hookPoint: "before_stage_handoff",
      stage: "submit",
      verdict: "block",
      status: "failed",
      pending: false,
      launched: false,
      revisedRequested: false,
      escalated: false,
      fileFingerprint: "sha1:proof",
      result: null,
      revisionDispatch: null,
      blockingReason: "Proof obligation is invalid.",
    },
  ]);

  assert.equal(gateControl.primaryDisposition, "hard_block");
  assert.equal(gateControl.blocking, true);
  assert.equal(gateControl.hardBlockCount, 1);
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
