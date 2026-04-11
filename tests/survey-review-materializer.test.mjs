import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
} from "../tools/workflow-guard-state/survey-review.ts";
import {
  materializePaperStoryState,
  materializeSurveyReviewState,
  runWorkflowAutoIterator,
} from "../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeSurveyProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-survey-materializer-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-graph-reasoning",
    current_stage: "survey_review",
    owner_agent: "researcher",
    survey_review: {
      topic: "Graph reasoning survey",
      mode: "deep",
    },
  });
  return projectRoot;
}

test("materializeSurveyReviewState reconciles survey artifacts into completed durable state", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
    ],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: [
      { canonical_id: "arxiv:2501.00001" },
      { canonical_id: "arxiv:2501.00002" },
      { canonical_id: "arxiv:2501.00004" },
    ],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2401.00003" }],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Retrieval-augmented systems\n- Structure-aware planners\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Paper | Family | Dataset | Metric |",
      "| --- | --- | --- | --- |",
      "| A | Retrieval | SurveyBench | Accuracy |",
      "| B | Planning | GraphArena | F1 |",
      "| C | Hybrid | TaskGraph | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n- Cross-family comparison is still weak.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Scope and blind spots are recorded.\n- Recent coverage is acceptable.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Retrieval-augmented systems\n- Structure-aware planners\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "completed");
  assert.equal(result.state.currentPhase, "complete");
  assert.equal(result.state.queryRoundCount, 2);
  assert.equal(result.state.includedPaperCount, 3);
  assert.equal(result.state.excludedPaperCount, 1);
  assert.equal(result.state.graphGroundedBriefReady, true);
  assert.equal(result.state.gateReady, true);
  assert.equal(result.state.coverageStatus, "ready");
  assert.equal(result.state.taxonomyStabilityStatus, "stable");
  assert.equal(result.state.representativeMethodsStatus, "ready");
  assert.equal(result.state.benchmarkAlignmentStatus, "aligned");
  assert.equal(result.state.gapClosureStatus, "closed");
});

test("completed survey artifacts can seed survey-mode paper story and writing contract", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
    ],
    candidate_paper_count: 9,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: [
      { canonical_id: "arxiv:2501.00001" },
      { canonical_id: "arxiv:2501.00002" },
      { canonical_id: "arxiv:2501.00003" },
      { canonical_id: "arxiv:2501.00004" },
    ],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2401.00003" }],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Graph pretraining\n- Graph reasoning agents\n"
  );
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH), "# SOTA Matrix\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Paper | Family | Dataset | Metric |",
      "| --- | --- | --- | --- |",
      "| A | Graph pretraining | SurveyBench | Accuracy |",
      "| B | Reasoning agents | GraphArena | F1 |",
      "| C | Hybrid systems | TaskGraph | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n- Cross-family comparison is still weak.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Included papers cover three benchmark families.\n- Blind spots are documented.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Graph pretraining\n- Reasoning agents\n- Hybrid systems\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n"
  );

  await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  const result = await materializePaperStoryState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "ready");
  await fs.access(path.join(projectRoot, result.state.storySpinePath));
  await fs.access(path.join(projectRoot, result.state.claimToExperimentMapPath));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.writing_contract.paper_mode, "survey");
  assert.deepEqual(manifest.writing_contract.required_sections, [
    "abstract",
    "introduction",
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
    "conclusion",
  ]);
  assert.equal(manifest.writing_contract.proof_appendix_required, false);
});

test("survey review stays blocked when survey-quality gates are not ready", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [{ query: "graph reasoning survey", provider: "papers-cool" }],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2501.00001" }],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2401.00003" }],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH), "# Literature Review\n");
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH), "# SOTA Matrix\n");
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH), "# Gap Synthesis\n");
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH), "# Coverage Summary\n");
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH), "# Survey Brief\n");

  await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "survey_review");
  assert.equal(result.stageAfter, "survey_review");
  assert.ok(
    result.missingStageSignals.some((signal) => /survey coverage gate is not ready/i.test(signal))
  );
  assert.ok(
    result.missingStageSignals.some((signal) => /survey taxonomy gate is not stable/i.test(signal))
  );
});

test("completed survey review can advance into write stage", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
    ],
    candidate_paper_count: 18,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n\n- Main benchmarks: SurveyBench, GraphArena.\n- Main metrics: Accuracy, F1.\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: [
      { canonical_id: "arxiv:2501.00001" },
      { canonical_id: "arxiv:2501.00002" },
      { canonical_id: "arxiv:2501.00003" },
      { canonical_id: "arxiv:2501.00004" },
      { canonical_id: "arxiv:2501.00005" },
      { canonical_id: "arxiv:2501.00006" },
    ],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2401.00003" }],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Graph pretraining\n- Reasoning agents\n- Hybrid systems\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Paper | Family | Dataset | Metric |",
      "| --- | --- | --- | --- |",
      "| A | Graph pretraining | SurveyBench | Accuracy |",
      "| B | Reasoning agents | GraphArena | F1 |",
      "| C | Hybrid systems | TaskGraph | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n- Cross-family comparisons are still weak.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Scope and blind spots are recorded.\n- Recent coverage is acceptable.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Graph pretraining\n- Reasoning agents\n- Hybrid systems\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n"
  );

  await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "survey_review");
  assert.equal(result.stageAfter, "write");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "write");
  assert.equal(manifest.owner_agent, "academic_writer");
});
