import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SURVEY_BRIEF_PATH,
  DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH,
  DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_GAP_SYNTHESIS_PATH,
  DEFAULT_SURVEY_INCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_LITERATURE_PATH,
  DEFAULT_SURVEY_LITERATURE_REVIEW_PATH,
  DEFAULT_SURVEY_QUERY_REGISTRY_PATH,
  DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH,
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
  assert.equal(state.literatureReviewPath, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH);
  assert.equal(state.sotaMatrixPath, DEFAULT_SURVEY_SOTA_MATRIX_PATH);
  assert.equal(state.gapSynthesisPath, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH);
  assert.equal(state.coverageSummaryPath, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH);
  assert.equal(state.surveyBriefPath, DEFAULT_SURVEY_BRIEF_PATH);
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
    graph_grounded_brief_ready: true,
  });

  const serialized = serializeSurveyReviewState(state);

  assert.equal(serialized.status, "graph_grounded");
  assert.equal(serialized.current_phase, "graph_grounding");
  assert.equal(serialized.candidate_paper_count, 48);
  assert.equal(serialized.included_paper_count, 19);
  assert.equal(serialized.excluded_paper_count, 21);
  assert.equal(serialized.graph_grounded_brief_ready, true);
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
      graph_grounded_brief_ready: true,
    },
  });

  assert.equal(summary.state.status, "completed");
  assert.equal(summary.state.currentPhase, "complete");
  assert.equal(summary.state.topic, "Graph reasoning survey");
  assert.equal(summary.state.mode, "deep");
  assert.equal(summary.state.candidatePaperCount, 120);
  assert.equal(summary.state.includedPaperCount, 42);
  assert.equal(summary.state.excludedPaperCount, 51);
  assert.equal(summary.state.graphGroundedBriefReady, true);
});
