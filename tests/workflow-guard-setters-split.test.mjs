import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  setIdleResearchState,
  setExperimentSearchState,
  setBrainstormCycleState,
  setResearchProgramState,
} from "../tools/workflow-guard-setters/research-state-setters.ts";
import {
  setWritingContractState,
  setWritingSessionState,
  setReviewSessionState,
  setGraphGuidedWritingState,
  setExternalReviewState,
} from "../tools/workflow-guard-setters/writing-state-setters.ts";

async function makeProjectRoot(manifest) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-guard-setters-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("research setter module persists manifest updates", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    idle_research: {
      enabled: true,
      topic: "graph search",
      status: "pending",
    },
    brainstorm_cycle: {
      status: "pending",
      topic: "graph search",
      basis_stage: "idea",
    },
    experiment_search: {
      status: "pending",
    },
    research_program: {
      status: "ready",
      goal: "demo",
      global_constraints: {},
      tracks: [],
      task_graph: [],
      plan_alternatives: [],
      plan_selection: {},
      datasets: [],
      success_criteria: [],
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const idleResult = await setIdleResearchState({
    projectRoot,
    idleResearch: {
      enabled: false,
      status: "ready",
    },
  });
  assert.equal(idleResult.state.status, "disabled");
  assert.equal(idleResult.due, false);

  const searchResult = await setExperimentSearchState({
    projectRoot,
    experimentSearch: {
      status: "ready_for_analysis",
      baselineExperimentId: "exp-baseline",
      frontierExperimentIds: ["exp-frontier"],
      completedExperimentIds: ["exp-done"],
      failedExperimentIds: ["exp-failed"],
      discardedExperimentIds: ["exp-discarded"],
      multiSeedStatus: "ready",
      plotPackStatus: "ready",
      evaluationSummaryPath: "researcher/EXPERIMENT_EVAL.md",
      plotPackPath: "researcher/PLOT_PACK.md",
    },
  });
  assert.equal(searchResult.stateFileExists, true);
  assert.equal(searchResult.readyForAnalysis, true);
  assert.equal(searchResult.state.baselineExperimentId, "exp-baseline");
  assert.deepEqual(searchResult.state.frontierExperimentIds, ["exp-frontier"]);
  assert.deepEqual(searchResult.state.completedExperimentIds, ["exp-done"]);
  assert.deepEqual(searchResult.state.failedExperimentIds, ["exp-failed"]);
  assert.deepEqual(searchResult.state.discardedExperimentIds, ["exp-discarded"]);
  const persistedSearch = JSON.parse(
    await fs.readFile(searchResult.stateFilePath, "utf8")
  );
  assert.equal(persistedSearch.baseline_experiment_id, "exp-baseline");
  assert.deepEqual(persistedSearch.frontier_experiment_ids, ["exp-frontier"]);
  assert.deepEqual(persistedSearch.completed_experiment_ids, ["exp-done"]);
  assert.deepEqual(persistedSearch.failed_experiment_ids, ["exp-failed"]);
  assert.deepEqual(persistedSearch.discarded_experiment_ids, ["exp-discarded"]);

  const brainstormResult = await setBrainstormCycleState({
    projectRoot,
    brainstormCycle: {
      trackId: "track/a",
      topic: "graph search",
      basisStage: "idea",
      provider: "workflow_core_brainstorm",
      providerMode: "core",
      contractVersion: 1,
      rounds: [],
    },
  });
  assert.ok(Array.isArray(brainstormResult.validationErrors));
  assert.equal(typeof brainstormResult.chainBundleReady, "boolean");
});

test("research setter module canonicalizes object-shaped plan track and task payloads", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    research_program: {
      status: "approved",
      goal: "demo",
      global_constraints: {},
      tracks: [],
      task_graph: [],
      plan_alternatives: [],
      plan_selection: {},
      datasets: [],
      success_criteria: [],
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await setResearchProgramState({
    projectRoot,
    researchProgram: {
      status: "approved",
      goal: "demo",
      tracks: {
        main: {
          track_id: "track-main",
          status: "active",
          hypothesis: "demo hypothesis",
          novelty_basis: "demo novelty",
          main_metric: "acc",
          success_threshold: "acc>=0.9",
          required_baselines: "baseline-a",
          required_ablations: ["ablation-a"],
          required_controls: { primary: "seed-control" },
          experiment_stage_matrix: {
            baseline_implementation: { ready: true },
            baseline_tuning: { ready: true },
            creative_research: { ready: true },
            ablation_studies: { ready: true },
          },
          stop_rules: "stop after no improvement",
          rollback_triggers: ["baseline regression"],
          write_scope: {
            allowed_claim_ids: "claim-1",
            allowed_figure_ids: ["fig-1"],
          },
        },
      },
      task_graph: {
        tasks: {
          plan_main: {
            task_id: "plan-main",
            stage: "plan",
            track_id: "track-main",
            owner: "researcher",
            dependencies: [],
            entry_criteria: "track active",
            expected_outputs: { primary: "plan ready" },
            retry_budget: 1,
            exit_criteria: ["plan locked"],
          },
        },
      },
    },
  });

  assert.equal(result.state.tracks.length, 1);
  assert.deepEqual(result.state.tracks[0].experimentStageMatrix, [
    "baseline_implementation",
    "baseline_tuning",
    "creative_research",
    "ablation_studies",
  ]);
  assert.equal(result.state.taskGraph.length, 1);
  assert.deepEqual(result.state.taskGraph[0].entryCriteria, ["track active"]);
  assert.deepEqual(result.state.taskGraph[0].expectedOutputs, ["plan ready"]);
  assert.deepEqual(result.state.taskGraph[0].exitCriteria, ["plan locked"]);
});

test("writing setter module copies templates and updates review state", async (t) => {
  const templateFile = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-writing-template-")
  );
  const templatePath = path.join(templateFile, "template.md");
  await fs.writeFile(templatePath, "# template\n", "utf8");

  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    writing_contract: {
      template_required: false,
    },
    writing_session: {
      status: "missing",
      current_section: "abstract",
      draft_order: [],
      finalized_sections: [],
      compile_safe_sections: [],
      section_packets: {},
      headline_claim_evidence_status: "pending",
      graph_evidence_coverage_status: "pending",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
      future_scholar_verification_skill: "future/literature-dehallucination",
    },
    review_session: {
      status: "missing",
    },
    graph_guided_writing: {
      enabled: false,
    },
    external_review_state: {
      status: "missing",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(templateFile, { recursive: true, force: true });
  });

  const contractResult = await setWritingContractState({
    projectRoot,
    policy: {
      defaultConferenceTemplatePath: templatePath,
      defaultJournalTemplatePath: null,
    },
    writingContract: {
      paperMode: "conference",
    },
  });
  assert.equal(contractResult.templateReady, true);
  assert.ok(contractResult.projectTemplateResolvedPath);
  await fs.access(contractResult.projectTemplateResolvedPath);

  const sessionResult = await setWritingSessionState({
    projectRoot,
    writingSession: {
      currentSection: "abstract",
      draftOrder: ["abstract"],
      finalizedSections: ["abstract"],
      compileSafeSections: ["abstract"],
      sectionPackets: {
        abstract: {
          section: "abstract",
          status: "finalized",
          packetPath: "academic_writer/abstract.json",
          draftPath: "academic_writer/abstract.md",
          reviewPath: "reviewer/abstract.md",
          allowedClaims: [],
          requiredGraphEvidencePointers: [],
          forbiddenUnsupportedClaims: [],
          missingCitationPlaceholders: [],
          requiredCitationCount: 0,
          requiredFigureIds: [],
          dependentSections: [],
          stale: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      graphEvidenceCoverageStatus: "covered",
    },
  });
  assert.equal(sessionResult.state.currentSection, "abstract");

  const reviewResult = await setReviewSessionState({
    projectRoot,
    reviewSession: {
      status: "ready",
      stageScope: "write",
      round: 1,
      reviewPacketPath: "reviewer/REVIEW_PACKET.json",
      graphEvidenceSummaryPath: "reviewer/GRAPH_EVIDENCE_SUMMARY.md",
      latestReviewPath: "reviewer/REVIEW_REPORT.md",
      verdict: "ready",
      rubric: { originality: 0.8, quality: 0.9 },
      reviewerSummary: "looks good",
      actionItems: ["none"],
      blockingArtifacts: [],
    },
  });
  assert.equal(reviewResult.state.round, 1);
  await fs.access(reviewResult.reviewPacketResolvedPath);
  assert.equal(reviewResult.revisionControl.status, "idle");

  const graphResult = await setGraphGuidedWritingState({
    projectRoot,
    graphGuidedWriting: {
      enabled: false,
    },
  });
  assert.equal(graphResult.readyForSubmit, true);

  const externalResult = await setExternalReviewState({
    projectRoot,
    externalReview: {
      status: "received",
      overallRecommendation: "accept",
      submittedPdfPath: "academic_writer/submission.pdf",
      externalReviewPath: "reviewer/EXTERNAL_REVIEW.md",
      reviewResponsePath: "reviewer/REVIEW_RESPONSE.md",
    },
  });
  assert.equal(externalResult.conclusionReady, true);
  assert.equal(externalResult.revisionControl.status, "idle");
});
