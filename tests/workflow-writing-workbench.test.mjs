import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { materializeResultsStoryline } from "../tools/research-writing/results-storyline.ts";
import { materializeTitleAbstractIntroWorkbench } from "../tools/research-writing/title-abstract-intro-workbench.ts";
import { collectReviewStageMissingSignals } from "../tools/workflow-guard-stages/execution-stage-signals.ts";
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

async function makeSurveyWorkbenchProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-survey-writing-workbench-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-workbench-project",
    current_stage: "review",
    owner_agent: "academic_writer",
    workflow_line: "survey",
    survey_review: {
      status: "completed",
      topic: "Generalized Category Discovery",
      included_paper_count: 14,
    },
    writing_contract: {
      paper_mode: "survey",
      required_sections: [
        "abstract",
        "introduction",
        "scope_and_protocol",
        "taxonomy",
        "evidence_synthesis",
        "benchmark_landscape",
        "open_problems",
        "conclusion",
      ],
      section_order: [
        "abstract",
        "introduction",
        "scope_and_protocol",
        "benchmark_landscape",
        "taxonomy",
        "evidence_synthesis",
        "open_problems",
        "conclusion",
      ],
    },
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      challenge_statement_path: "academic_writer/story/CHALLENGE_STATEMENT.md",
      contribution_to_story_bridge_path: "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
      survey_storyline_packet_path: "academic_writer/SURVEY_STORYLINE_PACKET.json",
    },
    review_pressure_packet: {
      status: "ready",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    },
    innovation_synthesis_state: {
      status: "ready",
      central_thesis:
        "The decisive question in generalized category discovery is which benchmark comparisons are actually fair.",
      integrated_contribution_statement_path:
        "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
      synthesis_memo_path: "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
    },
  });

  await Promise.all([
    writeText(
      path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
      "# Story Spine\nThe survey should lead with benchmark comparability before taxonomy.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CHALLENGE_STATEMENT.md"),
      "# Challenge Statement\nResult tables still mix non-comparable open-set assumptions.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "CONTRIBUTION_TO_STORY_BRIDGE.md"),
      "# Bridge\nBenchmark comparability is the intellectual center that reorders the rest of the survey.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
      "# Claim Map\n## Theme 1 (scope_and_protocol)\n- Theme: scope\n\n## Theme 2 (benchmark_landscape)\n- Theme: benchmark\n\n## Theme 3 (taxonomy)\n- Theme: taxonomy\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
      "# Fallback Narrative\n- keep the manuscript scoped to benchmark comparability if the broader field thesis gets too wide\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "FIGURE_TABLE_ALIGNMENT.md"),
      "# Figure/Table Alignment\nTable 1 shows benchmark comparability. Figure 1 shows the field map. Table 2 shows family trade-offs.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "SURVEY_SECTION_BRIEFS.md"),
      "# Survey Section Briefs\n\n## Storyline Thesis\n- For generalized category discovery, the decisive organizing question is which benchmark and metric comparisons are actually fair.\n\n## Scope and Protocol\n- What scope and protocol boundaries define this survey?\n\n## Benchmark Landscape\n- Which benchmark comparisons are actually fair?\n\n## Taxonomy\n- Which families remain meaningful once benchmark constraints are explicit?\n\n## Evidence Synthesis\n- What comparative evidence survives those constraints?\n\n## Open Problems\n- What remains unresolved once the benchmark contract is visible?\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "SURVEY_COMPARATIVE_ANALYSIS.md"),
      "# Survey Comparative Analysis\n- non-comparable results must stay explicit\n- benchmark and metric coverage are the main story\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "SURVEY_SELF_REVIEW.md"),
      "# Survey Self Review\n- thesis sharpness matters\n- benchmark landscape is the intellectual center\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
      "# Reverse Outline\n- keep the benchmark-first ordering visible in the introduction\n"
    ),
    writeText(
      path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
      "# Limitation Audit\n- do not generalize across non-comparable open-set assumptions\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "paper", "main.tex"),
      "\\input{sections/abstract}\n\\input{sections/introduction}\n\\input{sections/benchmark_landscape}\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "INNOVATION_SYNTHESIS_MEMO.md"),
      "# Innovation Synthesis Memo\nBenchmark comparability is the selected macro-story.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "INTEGRATED_CONTRIBUTION_STATEMENT.md"),
      "# Integrated Contribution Statement\nThe survey reorganizes the field around evaluation comparability before family-level synthesis.\n"
    ),
    writeJson(path.join(projectRoot, "academic_writer", "SURVEY_STORYLINE_PACKET.json"), {
      schema_version: 1,
      topic: "Generalized Category Discovery",
      selected_strategy_id: "evaluation_crisis_first",
      selected_strategy_label: "Evaluation-crisis-first",
      selected_strategy_rationale: [
        "Benchmark comparisons are only fair under matched open-set assumptions.",
        "The field story is misleading when protocol drift is hidden behind a single leaderboard.",
      ],
      thesis:
        "For generalized category discovery, the decisive organizing question is which benchmark and metric comparisons are actually fair.",
      intellectual_center_section: "benchmark_landscape",
      body_section_order: [
        "scope_and_protocol",
        "benchmark_landscape",
        "taxonomy",
        "evidence_synthesis",
        "open_problems",
      ],
      evidence_clusters: [
        {
          cluster_id: "scope_protocol",
          label: "Scope and protocol anchors",
          kind: "scope",
          summary: "Scope discipline comes before synthesis claims.",
          anchor_ids: ["protocol:review"],
        },
        {
          cluster_id: "benchmark_landscape",
          label: "Benchmark landscape anchors",
          kind: "benchmark",
          summary: "Benchmark landscape is the intellectual center for this survey.",
          anchor_ids: ["benchmark:cifar100", "benchmark:imagenet100"],
        },
        {
          cluster_id: "taxonomy",
          label: "Taxonomy anchors",
          kind: "taxonomy",
          summary: "Taxonomy only becomes credible once evaluation drift is explicit.",
          anchor_ids: ["family:prototype", "family:prompt"],
        },
      ],
      section_plans: [
        {
          section_id: "scope_and_protocol",
          prompt: "What scope and protocol boundaries define this survey on generalized category discovery?",
          objective: "Open with inclusion, exclusion, and comparability rules.",
          core_message: "Scope discipline comes before synthesis claims.",
          evidence_cluster_ids: ["scope_protocol"],
          anchor_ids: ["protocol:review"],
          tension_ids: [],
        },
        {
          section_id: "benchmark_landscape",
          prompt: "Which benchmark comparisons are actually fair, and where does protocol drift break comparability?",
          objective: "Expose protocol drift before aggregating wins.",
          core_message: "Benchmark landscape is the intellectual center for this survey.",
          evidence_cluster_ids: ["benchmark_landscape"],
          anchor_ids: ["benchmark:cifar100", "benchmark:imagenet100"],
          tension_ids: ["tension-1"],
        },
        {
          section_id: "taxonomy",
          prompt: "Which families remain meaningful once benchmark constraints are explicit?",
          objective: "Rebuild taxonomy after the evaluation contract is visible.",
          core_message: "Taxonomy only becomes credible once evaluation drift is explicit.",
          evidence_cluster_ids: ["taxonomy"],
          anchor_ids: ["family:prototype", "family:prompt"],
          tension_ids: ["tension-1"],
        },
        {
          section_id: "evidence_synthesis",
          prompt: "What comparative evidence survives those constraints?",
          objective: "Compare strengths and weaknesses under matched settings.",
          core_message: "Evidence synthesis should keep non-comparable results visible.",
          evidence_cluster_ids: ["benchmark_landscape", "taxonomy"],
          anchor_ids: ["paper:a", "paper:b"],
          tension_ids: ["tension-1"],
        },
        {
          section_id: "open_problems",
          prompt: "What remains unresolved once the benchmark contract is visible?",
          objective: "End with open problems that fall out of the selected thesis.",
          core_message: "Open problems must inherit the benchmark comparability story.",
          evidence_cluster_ids: ["benchmark_landscape"],
          anchor_ids: ["gap:metric-drift"],
          tension_ids: ["tension-1"],
        },
      ],
    }),
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

test("materializeResultsStoryline uses survey storyline packet to drive survey question order", async (t) => {
  const projectRoot = await makeSurveyWorkbenchProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeResultsStoryline({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.workflowLine, "survey");
  assert.equal(result.state.storyStrategy, "evaluation_crisis_first");
  assert.equal(result.state.intellectualCenterSection, "benchmark_landscape");
  assert.equal(result.state.questionOrder[1].sectionId, "benchmark_landscape");
  assert.ok(result.state.questionOrder[1].evidenceIds.includes("benchmark:cifar100"));

  const questionOrder = await fs.readFile(
    path.join(projectRoot, "academic_writer", "RESULTS_QUESTION_ORDER.md"),
    "utf8"
  );
  assert.match(questionOrder, /story_strategy: evaluation_crisis_first/i);
  assert.match(questionOrder, /intellectual_center_section: benchmark_landscape/i);
  assert.match(questionOrder, /Which benchmark comparisons are actually fair/i);
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

test("survey review closeout requires comparability and traceability artifacts", async (t) => {
  const projectRoot = await makeWorkbenchProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifest = await readManifest(projectRoot);
  manifest.workflow_line = "survey";
  manifest.paper_type = "survey";
  manifest.current_stage = "review";
  manifest.writing_contract = {
    paper_mode: "survey",
    required_sections: [
      "abstract",
      "introduction",
      "scope_and_protocol",
      "taxonomy",
      "evidence_synthesis",
      "benchmark_landscape",
      "open_problems",
      "conclusion",
    ],
    section_order: [
      "abstract",
      "introduction",
      "scope_and_protocol",
      "taxonomy",
      "evidence_synthesis",
      "benchmark_landscape",
      "open_problems",
      "conclusion",
    ],
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const missing = await collectReviewStageMissingSignals(
    {
      projectRoot,
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      isNonEmptyDirectory: async () => true,
      pathExists: async (targetPath) => {
        try {
          await fs.access(targetPath);
          return true;
        } catch {
          return false;
        }
      },
      manifestFieldExists: () => true,
      getExperimentLedgerPath: () => path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
      loadExperimentSearchState: async () => ({}),
      loadExperimentReviewState: async () => ({}),
      isExperimentSearchReadyForAnalysis: () => true,
      hasActiveExperimentRuns: () => false,
      normalizeAutonomousExecutionState: () => ({
        experimentLaunchMode: "manual",
        requireAnalyzerReview: false,
        requireCrossReview: false,
      }),
      normalizeBenchmarkProtocolState: () => ({}),
      normalizeStatisticalEvidenceState: () => ({}),
      normalizeAblationEvidenceState: () => ({}),
      normalizeMechanismEvidenceState: () => ({}),
      normalizeVenueCompetitionState: () => ({}),
      normalizeOpportunityScorecardState: () => ({}),
      readJsonIfExists: async (targetPath) => {
        try {
          return JSON.parse(await fs.readFile(targetPath, "utf8"));
        } catch {
          return null;
        }
      },
      normalizeStage: (value) =>
        typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null,
      normalizeFigureQcState: (value) => ({
        figureReviewPath:
          value && typeof value === "object" && typeof value.figure_review_path === "string"
            ? value.figure_review_path
            : "reviewer/FIGURE_REVIEW.md",
      }),
      resolveProjectArtifactPath: (_root, artifactPath) =>
        artifactPath ? path.join(projectRoot, artifactPath) : null,
      findUnsupportedPrimaryClaimsInSelectedWritingScope: async () => ({
        blocked: false,
        reason: null,
      }),
      normalizeReviewPressurePacketState: (value) => ({
        rejectFirstReviewPath: value?.reject_first_review_path ?? null,
        noveltyAttackPath: value?.novelty_attack_path ?? null,
        unsupportedClaimAuditPath: value?.unsupported_claim_audit_path ?? null,
        reverseOutlinePath: value?.reverse_outline_path ?? null,
        figureTableQcPath: value?.figure_table_qc_path ?? null,
        limitationAuditPath: value?.limitation_audit_path ?? null,
      }),
      getReviewPressurePacketValidationErrors: () => [],
      normalizeWritingContractState: (value) => ({
        paperMode: value?.paper_mode ?? value?.paperMode ?? null,
        paper_mode: value?.paper_mode ?? value?.paperMode ?? null,
      }),
      normalizeCitationIntegrityState: () => ({
        enabled: false,
        verificationRequired: false,
        verificationStatus: "missing",
        bibliographyEntryCount: 0,
        minimumCitationCount: 0,
        topicRelevanceStatus: "unknown",
      }),
      normalizeResultsStorylineState: (value) => value ?? {},
      normalizeTitleAbstractIntroWorkbenchState: (value) => value ?? {},
      normalizeParagraphLogicAuditState: (value) => value ?? {},
      fileHasNonWhitespaceContent: async (targetPath) => {
        if (!targetPath) {
          return false;
        }
        try {
          return (await fs.readFile(targetPath, "utf8")).trim().length > 0;
        } catch {
          return false;
        }
      },
      DEFAULT_FIGURE_REVIEW_PATH: "reviewer/FIGURE_REVIEW.md",
      DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH:
        "reviewer/SUBMISSION_SIMULATION_REVIEW.md",
    }
  );

  assert.equal(
    missing.some((signal) =>
      /SURVEY_COMPARABILITY_REPORT\.md/i.test(signal)
    ),
    true
  );
  assert.equal(
    missing.some((signal) =>
      /SOURCE_TO_CLAIM_INDEX\.json/i.test(signal)
    ),
    true
  );
  assert.equal(
    missing.some((signal) =>
      /SURVEY_TRACEABILITY_AUDIT\.json/i.test(signal)
    ),
    true
  );
  assert.equal(
    missing.some((signal) =>
      /SURVEY_TOP_TIER_BRIDGE\.json/i.test(signal)
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
