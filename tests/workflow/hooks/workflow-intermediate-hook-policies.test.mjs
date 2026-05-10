import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeIntermediateArtifactHookPolicies } from "../../../tools/workflow-intermediate-artifact-hook-policies.ts";
import { maybePrepareWorkflowStageContracts } from "../../../tools/workflow-guard-runtime/stage-preflight.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# stub\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function readManifest(projectRoot) {
  return JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
}

async function makeIntermediateHookProject({
  stage = "frontier_mapping",
  paperMode = "conference",
  proofAppendixRequired = false,
  includeExistingHook = false,
  includeRevisionState = false,
} = {}) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-intermediate-hooks-")
  );

  await Promise.all([
    writeText(
      path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
      "# Frontier\n- bottleneck: retrieval breadth is still thin\n- tension: stronger coverage may hurt comparability\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
      "# Idea Report\n- idea: graph-grounded benchmark taxonomy\n- tradeoff: more breadth means more screening overhead\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "IDEA_AUDIT.md"),
      "# Idea Audit\n- risk: current benchmark set may overfit to headline papers\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "THEORY_SUPPORT_NOTE.md"),
      "# Theory Support\n- theorem candidate: convergence under bounded drift\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
      "# Claim Evidence Matrix\n- claim-a supported\n"
    ),
    writeJson(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
      status: "ready",
      overall_signal: "coherent",
      theorem_candidates: [{ statement: "Bounded drift preserves consistency." }],
    }),
    writeText(
      path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"),
      "# Theory Appendix Plan\n- appendix section: proof sketch\n"
    ),
    writeJson(path.join(projectRoot, "academic_writer", "PAPER_REVISION_STATE.json"), {
      status: "in_progress",
      stage: "submit",
      passes: {
        section_pass: { status: "ready" },
        intro_method_consistency_pass: { status: "ready" },
        full_paper_adversarial_pass: { status: "ready" },
      },
    }),
    writeText(
      path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"),
      "# Writing Signals\n- current pass: consistency\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
      "# Reverse Outline\n- section 1: scope\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
      "# Unsupported Claim Audit\n- none\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
      "# Limitation Audit\n- limitation: broader benchmarks still needed\n"
    ),
    writeText(
      path.join(projectRoot, "CLAIM_POLICY.md"),
      "# Claim Policy\n- do not overclaim\n"
    ),
    writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
      tracks: [{ track_id: "track-a", status: "active" }],
    }),
    writeText(path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"), "# Limitation Frontier\n"),
    writeText(path.join(projectRoot, "graph", "CONTRADICTION_FRONTIER.md"), "# Contradiction Frontier\n"),
    writeText(path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"), "# Transfer Frontier\n"),
    writeText(path.join(projectRoot, "graph", "COMPOSITION_FRONTIER.md"), "# Composition Frontier\n"),
    writeText(path.join(projectRoot, "graph", "ANCHOR_INDEX.md"), "# Anchor Index\n"),
  ]);

  if (!includeRevisionState) {
    await fs.rm(path.join(projectRoot, "academic_writer", "PAPER_REVISION_STATE.json"), {
      force: true,
    });
  }

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: stage,
    owner_agent:
      stage === "analyze" ? "analyzer" : stage === "submit" ? "academic_writer" : "researcher",
    writing_contract: {
      paper_mode: paperMode,
      proof_appendix_required: proofAppendixRequired,
    },
    paper_story_state: {
      status: "ready",
      revision_cycle_path: "academic_writer/PAPER_REVISION_STATE.json",
    },
    ...(includeExistingHook
      ? {
          workflow_hooks: {
            enabled: true,
            audit_hooks: [
              {
                hook_id: "custom-existing-hook",
                hook_type: "file_audit",
                stage: "review",
                hook_point: "before_stage_handoff",
                target_role: "reviewer",
                auditor_role: "reviewer",
                file_path: "reviewer/REVIEW_SUMMARY.md",
                requirement_prompt: "Keep this custom hook.",
              },
              {
                hook_id: "frontier-report-quality-audit",
                hook_type: "file_audit",
                stage: "frontier_mapping",
                hook_point: "before_stage_handoff",
                target_role: "researcher",
                auditor_role: "cross-reviewer",
                file_path: "researcher/FRONTIER_REPORT.md",
                requirement_prompt: "stale",
              },
            ],
          },
        }
      : {}),
  });

  return projectRoot;
}

function makeNoopPreflightDeps() {
  return {
    materializeIdeationContract: async () => ({}),
    materializePaperStoryState: async () => ({}),
    materializeReviewPressurePacket: async () => ({}),
    materializeExperimentReviewState: async () => ({}),
    materializeSurveyReviewState: async () => ({}),
    materializeIdeaCatalystState: async () => ({}),
    materializeLiteratureDiscoveryPacket: async () => ({}),
    materializePapernexusPacketContracts: async () => ({}),
    queueIdeaCatalystRequisition: async () => ({}),
    queueLiteratureDiscoveryRequisition: async () => ({}),
  };
}

test("materializeIntermediateArtifactHookPolicies preserves non-intermediate hooks and is idempotent", async (t) => {
  const projectRoot = await makeIntermediateHookProject({
    stage: "frontier_mapping",
    includeExistingHook: true,
  });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await materializeIntermediateArtifactHookPolicies({
    projectRoot,
    stage: "frontier_mapping",
  });
  assert.equal(first.updated, true);
  assert.ok(first.generatedHookIds.includes("frontier-report-quality-audit"));

  const customHook = first.policy.auditHooks.find((entry) => entry.hookId === "custom-existing-hook");
  assert.ok(customHook);

  const frontierHook = first.policy.auditHooks.find(
    (entry) => entry.hookId === "frontier-report-quality-audit"
  );
  assert.ok(frontierHook);
  assert.equal(frontierHook?.auditorRole, "cross-reviewer");
  assert.equal(frontierHook?.hookPoint, "before_stage_handoff");
  assert.notEqual(frontierHook?.requirementPrompt, "stale");
  assert.match(frontierHook?.requirementPrompt ?? "", /real frontiers/i);

  const second = await materializeIntermediateArtifactHookPolicies({
    projectRoot,
    stage: "frontier_mapping",
  });
  assert.deepEqual(second.generatedHookIds, first.generatedHookIds);
  assert.equal(
    new Set(second.policy.auditHooks.map((entry) => entry.hookId)).size,
    second.policy.auditHooks.length
  );

  const manifest = await readManifest(projectRoot);
  assert.equal(
    manifest.workflow_hooks.audit_hooks.some((entry) => entry.hook_id === "custom-existing-hook"),
    true
  );
});

test("materializeIntermediateArtifactHookPolicies generates stage-specific hooks", async (t) => {
  const analyzeRoot = await makeIntermediateHookProject({
    stage: "analyze",
    proofAppendixRequired: true,
  });
  const submitRoot = await makeIntermediateHookProject({
    stage: "submit",
    includeRevisionState: true,
  });
  const ideaRoot = await makeIntermediateHookProject({
    stage: "idea",
  });
  t.after(async () => {
    await fs.rm(analyzeRoot, { recursive: true, force: true });
    await fs.rm(submitRoot, { recursive: true, force: true });
    await fs.rm(ideaRoot, { recursive: true, force: true });
  });

  const analyze = await materializeIntermediateArtifactHookPolicies({
    projectRoot: analyzeRoot,
    stage: "analyze",
  });
  assert.ok(analyze.generatedHookIds.includes("theory-state-quality-audit"));

  const submit = await materializeIntermediateArtifactHookPolicies({
    projectRoot: submitRoot,
    stage: "submit",
  });
  assert.ok(submit.generatedHookIds.includes("revision-cycle-quality-audit"));
  const revisionHook = submit.policy.auditHooks.find(
    (entry) => entry.hookId === "revision-cycle-quality-audit"
  );
  assert.equal(revisionHook?.targetRole, "academic_writer");
  assert.equal(revisionHook?.auditorRole, "cross-reviewer");

  const idea = await materializeIntermediateArtifactHookPolicies({
    projectRoot: ideaRoot,
    stage: "idea",
  });
  assert.ok(idea.generatedHookIds.includes("idea-report-quality-audit"));
  assert.ok(idea.generatedHookIds.includes("idea-audit-quality-audit"));
});

test("maybePrepareWorkflowStageContracts materializes intermediate artifact hook policies", async (t) => {
  const projectRoot = await makeIntermediateHookProject({
    stage: "idea",
  });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    stage: "idea",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(
    result.errors.some((entry) => entry.contract === "intermediate_artifact_hook_policies"),
    false
  );
  assert.equal(
    result.materializedContracts.includes("intermediate_artifact_hook_policies"),
    true
  );

  const manifest = await readManifest(projectRoot);
  const hookIds = manifest.workflow_hooks.audit_hooks.map((entry) => entry.hook_id);
  assert.ok(hookIds.includes("idea-report-quality-audit"));
  assert.ok(hookIds.includes("idea-audit-quality-audit"));
});
