import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { materializeResultsStoryline } from "../tools/research-writing/results-storyline.ts";
import { materializeTitleAbstractIntroWorkbench } from "../tools/research-writing/title-abstract-intro-workbench.ts";
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

async function makeWorkbenchProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-writing-workbench-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    owner_agent: "academic_writer",
    workflow_line: "experiment",
    research_program: {
      status: "approved",
      goal: "Keep graph-grounded support precision stable under broader narrative scope.",
      problem_statement:
        "Validated gains still read as separate deltas instead of one argument.",
      baseline_reference: "baseline-router",
      primary_metric: "support_precision",
    },
    writing_contract: {
      paper_mode: "conference",
      required_sections: ["abstract", "introduction", "results", "conclusion"],
      section_order: ["abstract", "introduction", "results", "conclusion"],
    },
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      challenge_statement_path: "academic_writer/story/CHALLENGE_STATEMENT.md",
      contribution_to_story_bridge_path: "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      track_verdicts_path: "analyzer/TRACK_VERDICTS.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    },
    review_pressure_packet: {
      status: "ready",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
      unsupported_claim_audit_path:
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
      figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    },
    innovation_synthesis_state: {
      status: "ready",
      central_thesis:
        "Graph-grounded routing keeps support precision stable without turning the manuscript into a fragile claim stack.",
      integrated_contribution_statement_path:
        "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
      synthesis_memo_path: "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
    },
  });

  await Promise.all([
    writeText(
      path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
      "# Story Spine\nGraph-grounded routing keeps support precision stable as the narrative expands.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CHALLENGE_STATEMENT.md"),
      "# Challenge Statement\nCurrent drafts lose support precision when the prose widens.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "CONTRIBUTION_TO_STORY_BRIDGE.md"),
      "# Bridge\nOne routing mechanism ties together evidence binding, reviewer pressure, and results order.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
      "# Claim Map\nclaim-1 -> exp-main\nclaim-2 -> exp-ablation\nclaim-3 -> exp-boundary\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
      "# Claim Evidence Matrix\nclaim-1 backed by main table\nclaim-2 backed by ablation table\nclaim-3 backed by boundary figure\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "TRACK_VERDICTS.md"),
      "# Track Verdicts\n- mechanism is supported\n- baseline comparison is strong\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
      "# Unsupported Claims\n- long-range boundary still needs stronger caveat wording\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
      "# Fallback Narrative\n- keep the story scoped to support precision instead of generic quality claims\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "FIGURE_TABLE_ALIGNMENT.md"),
      "# Figure/Table Alignment\nFigure 1 teaches the integrated routing mechanism.\nTable 1 shows the main benchmark result.\nTable 2 shows the ablation.\nFigure 2 shows the failure boundary.\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
      "# Reverse Outline\n- the intro currently buries the reviewer question order\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
      "# Limitation Audit\n- keep the boundary explicit in the abstract and conclusion\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
      "# Unsupported Claim Audit\n- do not promise general writing quality improvements\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"),
      "# Reject First Review\n- strongest baseline comparison must stay visible\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md"),
      "# Novelty Attack\n- avoid framing this as a generic rewrite system\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"),
      "# Figure/Table QC\n- Figure 1 and Table 1 carry the main narrative entry points\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "paper", "main.tex"),
      "\\input{sections/abstract}\n\\input{sections/introduction}\n\\input{sections/results}\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "INNOVATION_SYNTHESIS_MEMO.md"),
      "# Innovation Synthesis Memo\nOne central thesis ties routing, ablation, and boundary evidence together.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "INTEGRATED_CONTRIBUTION_STATEMENT.md"),
      "# Integrated Contribution Statement\nGraph-grounded routing keeps support precision stable without collapsing narrative clarity.\n"
    ),
  ]);

  return projectRoot;
}

test("materializeResultsStoryline writes reviewer-question order and evidence sequence", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeResultsStoryline({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.workflowLine, "experiment");
  assert.equal(result.state.questionOrder.length, 5);
  assert.equal(result.state.questionOrder[0].questionId, "effectiveness");
  assert.ok(result.generatedFiles.includes("academic_writer/RESULTS_QUESTION_ORDER.md"));
  assert.ok(
    result.generatedFiles.includes("academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json")
  );

  const questionOrder = await fs.readFile(
    path.join(projectRoot, "academic_writer", "RESULTS_QUESTION_ORDER.md"),
    "utf8"
  );
  assert.match(questionOrder, /Does the method improve support_precision/i);
  assert.match(questionOrder, /What mechanism explains the observed gain/i);
});

test("materializeTitleAbstractIntroWorkbench writes aligned title and drafting workbench artifacts", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeResultsStoryline({
    projectRoot,
    stage: "review",
  });
  const result = await materializeTitleAbstractIntroWorkbench({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.alignmentStatus, "aligned");
  assert.ok(result.state.selectedTitle);
  assert.ok(result.generatedFiles.includes("academic_writer/TITLE_CANDIDATES.md"));
  assert.ok(
    result.generatedFiles.includes("academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md")
  );
  assert.ok(
    result.generatedFiles.includes("academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md")
  );

  const titleCandidates = await fs.readFile(
    path.join(projectRoot, "academic_writer", "TITLE_CANDIDATES.md"),
    "utf8"
  );
  const abstractWorkbench = await fs.readFile(
    path.join(projectRoot, "academic_writer", "ABSTRACT_5_SENTENCE_WORKBENCH.md"),
    "utf8"
  );
  const introWorkbench = await fs.readFile(
    path.join(projectRoot, "academic_writer", "INTRO_5_PARAGRAPH_WORKBENCH.md"),
    "utf8"
  );
  assert.doesNotMatch(titleCandidates, /^Preferred title: (A Study of|Towards|An Approach to|Some Notes on)/im);
  assert.match(abstractWorkbench, /1\. Problem/);
  assert.match(abstractWorkbench, /5\. Implication \/ Boundary/);
  assert.match(introWorkbench, /Paragraph 3: What Unified Lens or Mechanism This Paper Adds/);
});

test("maybePrepareWorkflowStageContracts materializes results storyline and title/abstract/intro workbench", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifest = await readManifest(projectRoot);
  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "review",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(result.materializedContracts.includes("results_storyline"), true);
  assert.equal(
    result.materializedContracts.includes("title_abstract_intro_workbench"),
    true
  );

  const updatedManifest = await readManifest(projectRoot);
  assert.equal(updatedManifest.results_storyline.status, "ready");
  assert.equal(updatedManifest.title_abstract_intro_workbench.status, "ready");
});

test("research_workflow exposes results storyline and title/abstract/intro workbench summaries", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
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

  const storyline = await executeWorkflowTool(tool, {
    action: "materialize_results_storyline_state",
    resultsStorylineMaterialization: {
      basis_stage: "review",
    },
  });
  assert.equal(storyline.state.status, "ready");

  const workbench = await executeWorkflowTool(tool, {
    action: "materialize_title_abstract_intro_workbench_state",
    titleAbstractIntroWorkbenchMaterialization: {
      basis_stage: "review",
    },
  });
  assert.equal(workbench.state.status, "ready");

  const storylineSummary = await executeWorkflowTool(tool, {
    action: "get_results_storyline_state",
  });
  assert.equal(storylineSummary.state.status, "ready");
  assert.equal(storylineSummary.questionOrderExists, true);
  assert.equal(storylineSummary.evidenceSequenceExists, true);

  const workbenchSummary = await executeWorkflowTool(tool, {
    action: "get_title_abstract_intro_workbench_state",
  });
  assert.equal(workbenchSummary.state.status, "ready");
  assert.equal(workbenchSummary.titleCandidatesExists, true);
  assert.equal(workbenchSummary.abstractWorkbenchExists, true);
  assert.equal(workbenchSummary.introWorkbenchExists, true);
});

test("write stage only requires storyline and title/abstract/intro workbench to exist, not to be ready", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
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

  const manifest = await readManifest(projectRoot);
  manifest.current_stage = "write";
  manifest.results_storyline = {
    status: "draft",
  };
  manifest.title_abstract_intro_workbench = {
    status: "draft",
  };
  manifest.paragraph_logic_audit = {
    status: "pending",
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });
  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /results_storyline\.status must not be missing/i.test(signal)
    ),
    false
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /title_abstract_intro_workbench\.status must not be missing/i.test(signal)
    ),
    false
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /paragraph_logic_audit\.status must not be missing/i.test(signal)
    ),
    false
  );
});

test("review stage requires storyline and title/abstract/intro workbench to be ready for closeout", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
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

  const manifest = await readManifest(projectRoot);
  manifest.current_stage = "review";
  manifest.results_storyline = {
    status: "draft",
  };
  manifest.title_abstract_intro_workbench = {
    status: "draft",
  };
  manifest.paragraph_logic_audit = {
    status: "blocked",
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });
  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /results_storyline\.status must be ready before REVIEW closeout/i.test(signal)
    ),
    true
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /title_abstract_intro_workbench\.status must be ready before REVIEW closeout/i.test(
        signal
      )
    ),
    true
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /paragraph_logic_audit\.status must be ready before REVIEW closeout/i.test(signal)
    ),
    true
  );
});

test("submit stage requires storyline and title/abstract/intro workbench to be ready", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
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

  const manifest = await readManifest(projectRoot);
  manifest.current_stage = "submit";
  manifest.results_storyline = {
    status: "draft",
  };
  manifest.title_abstract_intro_workbench = {
    status: "draft",
  };
  manifest.paragraph_logic_audit = {
    status: "blocked",
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });
  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /results_storyline\.status must be ready before SUBMIT/i.test(signal)
    ),
    true
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /title_abstract_intro_workbench\.status must be ready before SUBMIT/i.test(signal)
    ),
    true
  );
  assert.equal(
    snapshot.missingStageSignals.some((signal) =>
      /paragraph_logic_audit\.status must be ready before SUBMIT/i.test(signal)
    ),
    true
  );
});
