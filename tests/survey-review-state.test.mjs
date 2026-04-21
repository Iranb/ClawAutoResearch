import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SURVEY_BRIEF_PATH,
  DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH,
  DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH,
  DEFAULT_SURVEY_DIAGNOSTICS_PATH,
  DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_GAP_SYNTHESIS_PATH,
  DEFAULT_SURVEY_INCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_LITERATURE_PATH,
  DEFAULT_SURVEY_LITERATURE_REVIEW_PATH,
  DEFAULT_SURVEY_QUERY_REGISTRY_PATH,
  DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH,
  DEFAULT_SURVEY_SCREENING_DECISIONS_PATH,
  DEFAULT_SURVEY_SOTA_MATRIX_PATH,
  getSurveyReviewStateSummary,
  normalizeSurveyReviewState,
  serializeSurveyReviewState,
} from "../tools/workflow-guard-state/survey-review.ts";

test("normalizeSurveyReviewState provides durable survey defaults", () => {
  const state = normalizeSurveyReviewState({
    topic: "Graph reasoning survey",
    mode: "deep",
  });

  assert.equal(state.status, "missing");
  assert.equal(state.topic, "Graph reasoning survey");
  assert.equal(state.mode, "deep");
  assert.equal(state.queryRegistryPath, DEFAULT_SURVEY_QUERY_REGISTRY_PATH);
  assert.equal(state.literaturePath, DEFAULT_SURVEY_LITERATURE_PATH);
  assert.equal(state.reviewProtocolPath, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH);
  assert.equal(state.includedPapersPath, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH);
  assert.equal(state.excludedPapersPath, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH);
  assert.equal(state.candidatePapersPath, DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH);
  assert.equal(state.screeningDecisionsPath, DEFAULT_SURVEY_SCREENING_DECISIONS_PATH);
  assert.equal(state.literatureReviewPath, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH);
  assert.equal(state.sotaMatrixPath, DEFAULT_SURVEY_SOTA_MATRIX_PATH);
  assert.equal(state.gapSynthesisPath, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH);
  assert.equal(state.coverageSummaryPath, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH);
  assert.equal(state.surveyBriefPath, DEFAULT_SURVEY_BRIEF_PATH);
  assert.equal(state.diagnosticsPath, DEFAULT_SURVEY_DIAGNOSTICS_PATH);
  assert.equal(state.gateReady, false);
  assert.deepEqual(state.gateBlockingIssues, []);
});

test("serializeSurveyReviewState preserves survey counts and durable paths", () => {
  const state = normalizeSurveyReviewState({
    status: "graph_grounded",
    current_phase: "graph_grounding",
    topic: "Graph reasoning survey",
    mode: "standard",
    candidate_paper_count: 48,
    included_paper_count: 19,
    excluded_paper_count: 21,
    background_paper_count: 4,
    pending_screening_count: 2,
    pending_planned_round_count: 1,
    graph_grounded_brief_ready: true,
    diagnostics_path: "researcher/SURVEY_GATE_DIAGNOSTICS.json",
    gate_ready: true,
    coverage_status: "ready",
    taxonomy_stability_status: "stable",
    representative_methods_status: "ready",
    benchmark_alignment_status: "aligned",
    topic_relevance_status: "ready",
    gap_closure_status: "closed",
  });

  const serialized = serializeSurveyReviewState(state);

  assert.equal(serialized.status, "graph_grounded");
  assert.equal(serialized.current_phase, "graph_grounding");
  assert.equal(serialized.candidate_paper_count, 48);
  assert.equal(serialized.included_paper_count, 19);
  assert.equal(serialized.excluded_paper_count, 21);
  assert.equal(serialized.background_paper_count, 4);
  assert.equal(serialized.pending_screening_count, 2);
  assert.equal(serialized.pending_planned_round_count, 1);
  assert.equal(serialized.graph_grounded_brief_ready, true);
  assert.equal(serialized.gate_ready, true);
  assert.equal(serialized.coverage_status, "ready");
  assert.equal(serialized.taxonomy_stability_status, "stable");
  assert.equal(serialized.benchmark_alignment_status, "aligned");
  assert.equal(serialized.topic_relevance_status, "ready");
  assert.equal(serialized.survey_brief_path, DEFAULT_SURVEY_BRIEF_PATH);
});

test("getSurveyReviewStateSummary exposes survey readiness and artifact counts", () => {
  const summary = getSurveyReviewStateSummary({
    survey_review: {
      status: "completed",
      current_phase: "complete",
      topic: "Graph reasoning survey",
      mode: "deep",
      candidate_paper_count: 120,
      included_paper_count: 42,
      excluded_paper_count: 51,
      background_paper_count: 7,
      pending_screening_count: 0,
      pending_planned_round_count: 0,
      graph_grounded_brief_ready: true,
      gate_ready: true,
      coverage_status: "ready",
      taxonomy_stability_status: "stable",
      representative_methods_status: "ready",
      benchmark_alignment_status: "aligned",
      topic_relevance_status: "ready",
      gap_closure_status: "closed",
    },
  });

  assert.equal(summary.state.status, "completed");
  assert.equal(summary.state.currentPhase, "complete");
  assert.equal(summary.state.topic, "Graph reasoning survey");
  assert.equal(summary.state.mode, "deep");
  assert.equal(summary.state.candidatePaperCount, 120);
  assert.equal(summary.state.includedPaperCount, 42);
  assert.equal(summary.state.excludedPaperCount, 51);
  assert.equal(summary.state.backgroundPaperCount, 7);
  assert.equal(summary.state.pendingScreeningCount, 0);
  assert.equal(summary.state.pendingPlannedRoundCount, 0);
  assert.equal(summary.state.graphGroundedBriefReady, true);
  assert.equal(summary.state.gateReady, true);
  assert.equal(summary.state.topicRelevanceStatus, "ready");
  assert.equal(summary.ready, true);
});
