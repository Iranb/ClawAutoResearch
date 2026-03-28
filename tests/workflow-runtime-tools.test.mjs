import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { getWorkflowTraceLogPath } from "../tools/workflow-trace.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-tool-runtime-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        owner_agent: "academic_writer",
        idle_research: { enabled: false },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: {},
    logger: {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  assert.ok(registeredTool);
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

test("research_workflow get_papernexus_remote_access returns a redacted token status", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PAPERNEXUS_API_TOKEN = "super-secret-token";
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "get_papernexus_remote_access",
  });
  assert.equal(result.tokenAvailable, true);
  assert.equal(result.tokenSourceResolved, "env");
  assert.equal(result.token, "[REDACTED]");
  assert.equal(result.summary.tokenSourceConfigured, "env");
  assert.equal(result.summary.tokenEnv, "PAPERNEXUS_API_TOKEN");
});

test("research_workflow runtime-state actions persist manifest state and append temp traces", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const tracePath = getWorkflowTraceLogPath({
    projectRoot,
    projectId: "demo-project",
  });

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(tracePath, { force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const writingSession = await executeWorkflowTool(tool, {
    action: "set_writing_session",
    writingSession: {
      status: "ready_for_submit",
      current_section: "abstract",
      section_packets: {
        abstract: {
          section: "abstract",
          packet_path: "academic_writer/section_packets/abstract.md",
          status: "finalized",
          review_verdict: "publication_ready",
        },
      },
      graph_evidence_coverage_status: "covered",
    },
  });
  assert.equal(writingSession.state.status, "ready_for_submit");
  assert.equal(writingSession.readyForSubmit, true);

  const reviewSession = await executeWorkflowTool(tool, {
    action: "set_review_session",
    reviewSession: {
      status: "completed",
      stage_scope: "review",
      round: 2,
      verdict: "ready",
      reviewer_summary: "Ready to hand off to writing.",
      action_items: ["Polish the abstract."],
    },
  });
  assert.equal(reviewSession.state.status, "completed");
  assert.equal(reviewSession.state.stageScope, "review");

  const graphGuidedWriting = await executeWorkflowTool(tool, {
    action: "set_graph_guided_writing",
    graphGuidedWriting: {
      status: "ready",
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
      covered_headline_claim_count: 2,
      total_headline_claim_count: 2,
    },
  });
  assert.equal(graphGuidedWriting.state.status, "ready");
  assert.equal(graphGuidedWriting.readyForSubmit, true);

  const externalReview = await executeWorkflowTool(tool, {
    action: "set_external_review_state",
    externalReview: {
      status: "received",
      provider: "paperreview.ai",
      review_skill: "paperreview-submit",
      source_label: "Stanford Agentic Reviewer",
      submitted_pdf_path: "academic_writer/paper/main.pdf",
      external_review_path: "reviewer/external_review_2026-03-26.md",
      review_response_path: "reviewer/rebuttal_2026-03-26.md",
      overall_recommendation: "minor_revision",
      required_action: "rollback_write",
    },
  });
  assert.equal(externalReview.state.status, "received");
  assert.equal(externalReview.state.reviewSkill, "paperreview-submit");

  const paperQc = await executeWorkflowTool(tool, {
    action: "set_paper_qc",
    paperQc: {
      status: "running",
      compile_status: "pass",
      compile_round_count: 2,
      chktex_status: "pending",
      page_budget_status: "pending",
      latest_report_path: "academic_writer/PAPER_QC.md",
    },
  });
  assert.equal(paperQc.state.status, "running");
  assert.equal(paperQc.state.compileStatus, "pass");

  const figureQc = await executeWorkflowTool(tool, {
    action: "set_figure_qc",
    figureQc: {
      status: "ready",
      figure_review_path: "reviewer/SURFACE_REVIEW.json",
      figure_selection_path: "academic_writer/FIGURE_SELECTION.json",
      duplicate_figure_status: "pass",
      caption_alignment_status: "pass",
      text_alignment_status: "pass",
      selection_status: "pass",
    },
  });
  assert.equal(figureQc.state.status, "ready");
  assert.equal(figureQc.state.selectionStatus, "pass");

  const citationCollection = await executeWorkflowTool(tool, {
    action: "set_citation_collection",
    citationCollection: {
      status: "running",
      progress_path: "academic_writer/citations_progress.json",
      cache_bib_path: "academic_writer/cached_citations.bib",
      candidate_count: 24,
      verified_count: 8,
      suspicious_count: 1,
      hallucinated_count: 0,
    },
  });
  assert.equal(citationCollection.state.status, "running");
  assert.equal(citationCollection.state.candidateCount, 24);

  const reviewIssueTracker = await executeWorkflowTool(tool, {
    action: "set_review_issue_tracker",
    reviewIssueTracker: {
      status: "open",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      last_review_round: 3,
      open_counts: {
        critical: 0,
        high: 1,
        medium: 2,
        low: 1,
      },
      pending_reason: "One high-severity surface issue is still open.",
    },
  });
  assert.equal(reviewIssueTracker.state.status, "open");
  assert.equal(reviewIssueTracker.state.openCounts.high, 1);

  const experimentSearch = await executeWorkflowTool(tool, {
    action: "set_experiment_search",
    experimentSearch: {
      status: "running",
      current_main_stage: "creative_research",
      current_substage: "branch_expansion",
      frontier_node_ids: ["node-3", "node-4"],
      best_node_id: "node-3",
      completed_node_ids: ["node-1", "node-2"],
      failed_node_ids: ["node-0"],
      tried_hyperparams: ["lr=1e-4|wd=0.01"],
      completed_ablations: ["remove_graph_adapter"],
      multi_seed_status: "running",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "pending",
      plot_pack_path: "researcher/plot_pack.json",
      stage_progress_path: "researcher/stage_progress.json",
      checkpoint_path: "researcher/checkpoints/experiment-manager.json",
    },
  });
  assert.equal(experimentSearch.state.status, "running");
  assert.equal(experimentSearch.state.currentMainStage, "creative_research");
  assert.equal(experimentSearch.stateFileExists, true);

  const brainstormCycle = await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      mode: "aggressive",
      topic: "Graph-grounded novelty synthesis for section planning",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      graph_version_seen: "global-v42",
      import_task_ids_seen: ["imp-1", "imp-2"],
      topic_summary: {
        objective: "Produce a reconciled novelty bundle before ideation.",
        constraints: ["stay within shared graph evidence"],
      },
      research_brief: {
        anchors: ["anchor-a", "anchor-b"],
        frontier_focus: "limitations and transfer gaps",
      },
      brainstorm_brief: {
        mode: "diverge",
        requested_rounds: 2,
      },
      rounds: [
        {
          round_id: "round-1",
          label: "diverge",
          status: "completed",
          options: [
            {
              option_id: "opt-a",
              title: "Baseline router",
              score: 0.62,
              summary: "A conservative graph-router extension.",
              logic_chain: "# Logic A\n",
              evidence_chain: "# Evidence A\n",
              reasoning_trace: [{ step: "inspect-anchor-a", conclusion: "partial gap" }],
              question_packet: "# Questions A\n",
              working_memory: { hypothesis: "A" },
              synthesis_packet: "# Synthesis A\n",
            },
            {
              option_id: "opt-b",
              title: "Compositional novelty router",
              score: 0.93,
              summary: "A stronger graph-grounded novelty direction.",
              logic_chain: "# Logic B\n",
              evidence_chain: "# Evidence B\n",
              reasoning_trace: [{ step: "inspect-anchor-b", conclusion: "composable gap" }],
              question_packet: "# Questions B\n",
              working_memory: { hypothesis: "B" },
              synthesis_packet: "# Synthesis B\n",
              reflection_chain: { stance: "keep" },
              theory_brief: { theorem_seed: "lemma-demo" },
              storyline_brief: { arc: "gap -> method -> evidence" },
            },
          ],
        },
        {
          round_id: "round-2",
          label: "converge",
          status: "completed",
          options: [
            {
              option_id: "opt-c",
              title: "Converged shortlist",
              score: 0.81,
              summary: "A merged shortlist with lower score than opt-b.",
              logic_chain: "# Logic C\n",
              evidence_chain: "# Evidence C\n",
              reasoning_trace: [{ step: "compare-a-b", conclusion: "opt-b wins" }],
              question_packet: "# Questions C\n",
              working_memory: { hypothesis: "C" },
              synthesis_packet: "# Synthesis C\n",
            },
          ],
        },
      ],
    },
  });
  assert.equal(brainstormCycle.state.status, "reconciled");
  assert.equal(brainstormCycle.state.selectedOptionId, "opt-b");
  assert.equal(brainstormCycle.state.selectedRoundId, "round-1");
  assert.equal(brainstormCycle.chainBundleReady, true);

  const brainstormCycleSummary = await executeWorkflowTool(tool, {
    action: "get_brainstorm_cycle",
  });
  assert.equal(brainstormCycleSummary.state.selectedOptionId, "opt-b");
  assert.equal(brainstormCycleSummary.state.rounds.length, 2);
  assert.equal(brainstormCycleSummary.logicChainExists, true);
  assert.equal(brainstormCycleSummary.reasoningTraceExists, true);

  const writingSummary = await executeWorkflowTool(tool, {
    action: "get_writing_session",
  });
  assert.equal(writingSummary.state.currentSection, "abstract");
  assert.equal(writingSummary.readyForSubmit, true);

  const externalReviewSummary = await executeWorkflowTool(tool, {
    action: "get_external_review_state",
  });
  assert.equal(externalReviewSummary.state.status, "received");

  const paperQcSummary = await executeWorkflowTool(tool, {
    action: "get_paper_qc",
  });
  assert.equal(paperQcSummary.state.compileStatus, "pass");

  const figureQcSummary = await executeWorkflowTool(tool, {
    action: "get_figure_qc",
  });
  assert.equal(figureQcSummary.state.captionAlignmentStatus, "pass");

  const citationCollectionSummary = await executeWorkflowTool(tool, {
    action: "get_citation_collection",
  });
  assert.equal(citationCollectionSummary.state.verifiedCount, 8);

  const reviewIssueTrackerSummary = await executeWorkflowTool(tool, {
    action: "get_review_issue_tracker",
  });
  assert.equal(reviewIssueTrackerSummary.state.openCounts.medium, 2);

  const experimentSearchSummary = await executeWorkflowTool(tool, {
    action: "get_experiment_search",
  });
  assert.equal(experimentSearchSummary.state.bestNodeId, "node-3");
  assert.equal(experimentSearchSummary.stateFileExists, true);

  await executeWorkflowTool(tool, {
    action: "auto_iterator_tick",
    iterator: {
      mode: "test",
      queueMailbox: false,
      dispatchTasks: false,
      broadcastStageChange: false,
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.writing_session.status, "ready_for_submit");
  assert.equal(manifest.review_session.status, "completed");
  assert.equal(manifest.graph_guided_writing.status, "ready");
  assert.equal(manifest.external_review_state.status, "received");
  assert.equal(manifest.paper_qc.status, "running");
  assert.equal(manifest.figure_qc.status, "ready");
  assert.equal(manifest.citation_collection.status, "running");
  assert.equal(manifest.review_issue_tracker.status, "open");
  assert.equal(manifest.experiment_search.status, "running");
  assert.equal(manifest.brainstorm_cycle.status, "reconciled");
  assert.equal(manifest.brainstorm_cycle.selected_option_id, "opt-b");

  const experimentSearchFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json"), "utf8")
  );
  assert.equal(experimentSearchFile.status, "running");
  assert.equal(experimentSearchFile.best_node_id, "node-3");

  const brainstormLogic = await fs.readFile(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "LOGIC_CHAIN.md"),
    "utf8"
  );
  assert.match(brainstormLogic, /Logic B/);

  const rawTrace = await fs.readFile(tracePath, "utf8");
  const traceEvents = rawTrace
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_writing_session" &&
        event.functionName === "setWritingSessionState" &&
        event.stage === "write"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_review_session" &&
        event.functionName === "setReviewSessionState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_graph_guided_writing" &&
        event.functionName === "setGraphGuidedWritingState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_external_review_state" &&
        event.functionName === "setExternalReviewState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_paper_qc" &&
        event.functionName === "setPaperQcState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_figure_qc" &&
        event.functionName === "setFigureQcState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_citation_collection" &&
        event.functionName === "setCitationCollectionState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_review_issue_tracker" &&
        event.functionName === "setReviewIssueTrackerState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_experiment_search" &&
        event.functionName === "setExperimentSearchState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "run_brainstorm_cycle" &&
        event.functionName === "runBrainstormCycle"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "auto_iterator" &&
        event.functionName === "runWorkflowAutoIterator" &&
        event.details?.stageBefore
    )
  );
});
