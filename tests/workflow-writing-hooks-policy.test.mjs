import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { materializeWritingHookPolicies } from "../tools/research-writing/hook-policies.ts";
import { maybePrepareWorkflowStageContracts } from "../tools/workflow-guard-runtime/stage-preflight.ts";

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

async function makeWritingHookProject({
  stage = "write",
  paperMode = "conference",
  includeExistingHook = false,
} = {}) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-writing-hooks-")
  );
  await fs.mkdir(path.join(projectRoot, "academic_writer"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "reviewer"), { recursive: true });

  await Promise.all([
    writeText(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"), "# Plan\n"),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
      "# Story Spine\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
      "# Claim Map\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CONTRIBUTION_MAP.md"),
      "# Contribution Map\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "CONTRIBUTION_TO_STORY_BRIDGE.md"),
      "# Bridge\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "FIGURE_ANCHOR_PLAN.md"),
      "# Figure Anchor\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "paper", "main.tex"),
      "\\input{sections/abstract}\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
      "# Claim Evidence Matrix\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
      "# Unsupported Claims\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
      "# Reverse Outline\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
      "# Unsupported Claim Audit\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
      "# Limitation Audit\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"),
      "# Figure/Table QC\n"
    ),
  ]);

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: stage,
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    opportunity_scorecard: { verdict: "worth_top_tier_bet" },
    writing_contract: {
      paper_mode: paperMode,
      required_sections:
        paperMode === "survey"
          ? [
              "abstract",
              "introduction",
              "scope_and_protocol",
              "taxonomy",
              "evidence_synthesis",
              "benchmark_landscape",
              "open_problems",
              "conclusion",
            ]
          : ["abstract", "introduction", "related_work", "experiments", "conclusion"],
      section_order:
        paperMode === "survey"
          ? [
              "abstract",
              "introduction",
              "scope_and_protocol",
              "taxonomy",
              "evidence_synthesis",
              "benchmark_landscape",
              "open_problems",
              "conclusion",
            ]
          : ["abstract", "introduction", "related_work", "experiments", "conclusion"],
    },
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      contribution_map_path: "academic_writer/story/CONTRIBUTION_MAP.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      contribution_to_story_bridge_path: "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md",
      figure_anchor_plan_path: "academic_writer/FIGURE_ANCHOR_PLAN.md",
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
    },
    review_pressure_packet: {
      status: "ready",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      unsupported_claim_audit_path:
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
      figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    },
    ...(includeExistingHook
      ? {
          workflow_hooks: {
            enabled: true,
            audit_hooks: [
              {
                hook_id: "custom-review-hook",
                hook_type: "file_audit",
                stage: "review",
                hook_point: "before_stage_handoff",
                target_role: "reviewer",
                auditor_role: "reviewer",
                file_path: "reviewer/REVIEW_SUMMARY.md",
                requirement_prompt: "Keep the external review summary consistent.",
              },
              {
                hook_id: "paper-plan-thesis-audit",
                hook_type: "file_audit",
                stage: "review",
                hook_point: "before_stage_handoff",
                target_role: "academic_writer",
                auditor_role: "reviewer",
                file_path: "academic_writer/PAPER_PLAN.md",
                requirement_prompt: "stale",
              },
            ],
          },
        }
      : {}),
  });

  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: params.runtime ?? {},
    logger: params.logger ?? {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "researcher",
          sessionKey: params.sessionKey ?? "agent:researcher:test",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
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

test("materializeWritingHookPolicies preserves non-writing hooks and is idempotent", async (t) => {
  const projectRoot = await makeWritingHookProject({
    stage: "review",
    includeExistingHook: true,
  });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await materializeWritingHookPolicies({
    projectRoot,
    stage: "review",
  });
  assert.equal(first.updated, true);
  assert.ok(first.generatedHookIds.includes("paper-plan-thesis-audit"));
  assert.ok(first.generatedHookIds.includes("main-tex-consistency-audit"));
  assert.ok(first.generatedHookIds.includes("figure-table-alignment-audit"));
  assert.ok(first.generatedHookIds.includes("final-figure-table-budget-audit"));
  assert.ok(first.enabledHookIds.includes("paper-plan-thesis-audit"));
  assert.ok(first.enabledHookIds.includes("abstract-claim-audit"));

  const customHook = first.policy.auditHooks.find((entry) => entry.hookId === "custom-review-hook");
  assert.ok(customHook);

  const thesisHook = first.policy.auditHooks.find(
    (entry) => entry.hookId === "paper-plan-thesis-audit"
  );
  assert.ok(thesisHook);
  assert.notEqual(thesisHook.requirementPrompt, "stale");
  assert.match(thesisHook.requirementPrompt, /top-tier strictness/i);
  assert.ok(
    thesisHook.supportingArtifacts.includes("analyzer/CLAIM_EVIDENCE_MATRIX.md")
  );

  const abstractHook = first.policy.auditHooks.find(
    (entry) => entry.hookId === "abstract-claim-audit"
  );
  assert.equal(abstractHook?.enabled, true);
  assert.equal(abstractHook?.hookPoint, "before_task_complete");
  assert.deepEqual(abstractHook?.filters?.taskIds, ["write.section.abstract"]);

  const second = await materializeWritingHookPolicies({
    projectRoot,
    stage: "review",
  });
  assert.equal(second.updated, false);

  const manifest = await readManifest(projectRoot);
  assert.equal(
    manifest.workflow_hooks.audit_hooks.some((entry) => entry.hook_id === "custom-review-hook"),
    true
  );
});

test("maybePrepareWorkflowStageContracts materializes writing hook policies after writing support", async (t) => {
  const projectRoot = await makeWritingHookProject({
    stage: "write",
  });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    stage: "write",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(result.errors.some((entry) => entry.contract === "writing_hook_policies"), false);
  assert.equal(result.materializedContracts.includes("writing_hook_policies"), true);

  const manifest = await readManifest(projectRoot);
  const hookIds = manifest.workflow_hooks.audit_hooks.map((entry) => entry.hook_id);
  assert.ok(hookIds.includes("main-tex-consistency-audit"));
  assert.ok(hookIds.includes("figure-caption-audit"));
  assert.ok(hookIds.includes("figure-table-alignment-audit"));
});

test("research_workflow materialize_writing_hook_policies writes the writing-owned hook catalog", async (t) => {
  const projectRoot = await makeWritingHookProject({
    stage: "submit",
  });
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.OPENCLAW_PROJECT = projectRoot;

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_writing_hook_policies",
    writingHookPolicyMaterialization: {
      basis_stage: "submit",
    },
  });

  assert.equal(result.stage, "submit");
  assert.ok(result.generatedHookIds.includes("paper-plan-thesis-audit"));
  assert.ok(result.enabledHookIds.includes("figure-caption-audit"));
  assert.ok(result.enabledHookIds.includes("final-figure-table-budget-audit"));
  assert.ok(result.policy.auditHooks.some((entry) => entry.hookId === "main-tex-consistency-audit"));

  const manifest = await readManifest(projectRoot);
  assert.equal(
    manifest.workflow_hooks.audit_hooks.some(
      (entry) => entry.hook_id === "main-tex-consistency-audit"
    ),
    true
  );
});

test("materializeWritingHookPolicies generates survey-specific section hooks", async (t) => {
  const projectRoot = await makeWritingHookProject({
    stage: "write",
    paperMode: "survey",
  });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeWritingHookPolicies({
    projectRoot,
    stage: "write",
    paperMode: "survey",
  });

  const hookIds = result.generatedHookIds;
  assert.ok(hookIds.includes("survey-taxonomy-audit"));
  assert.ok(hookIds.includes("survey-evidence-synthesis-audit"));
  assert.ok(hookIds.includes("survey-open-problems-audit"));
  assert.ok(hookIds.includes("survey-conclusion-boundary-audit"));

  const taxonomyHook = result.policy.auditHooks.find(
    (entry) => entry.hookId === "survey-taxonomy-audit"
  );
  assert.ok(taxonomyHook);
  assert.equal(taxonomyHook?.enabled, true);
  assert.equal(taxonomyHook?.appliesWhen?.workflowLines?.[0], "survey");
  assert.deepEqual(taxonomyHook?.filters?.taskIds, ["write.section.taxonomy"]);
});
