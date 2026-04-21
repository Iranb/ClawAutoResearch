import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SURVEY_BRIEF_PATH,
  DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH,
  DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH,
  DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_GAP_SYNTHESIS_PATH,
  DEFAULT_SURVEY_INCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_LITERATURE_PATH,
  DEFAULT_SURVEY_LITERATURE_REVIEW_PATH,
  DEFAULT_SURVEY_QUERY_REGISTRY_PATH,
  DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH,
  DEFAULT_SURVEY_SCREENING_DECISIONS_PATH,
  DEFAULT_SURVEY_SOTA_MATRIX_PATH,
} from "../tools/workflow-guard-state/survey-review.ts";
import { normalizeWritingContractState } from "../tools/workflow-guard-state/writing-contract.ts";
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
      { query: "graph reasoning benchmark comparison", provider: "papers-cool" },
      { query: "graph reasoning agents survey", provider: "pasa-paper-search" },
      { query: "graph reasoning failure analysis", provider: "papers-cool" },
      { query: "graph reasoning recent papers", provider: "pasa-paper-search" },
    ],
    candidate_paper_count: 48,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 20 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.000${String(index + 1).padStart(2, "0")}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 8 }, (_unused, index) => ({
      canonical_id: `arxiv:2401.100${index}`,
    })),
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
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Retrieval | strong baseline | SurveyBench | Accuracy |",
      "| B | Planning | structured reasoning | GraphArena | F1 |",
      "| C | Hybrid | benchmark transfer | TaskGraph | mAP |",
      "| D | Calibration | robustness caveat | OpenArena | AUC |",
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
  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "completed");
  assert.equal(result.state.currentPhase, "complete");
  assert.equal(result.state.queryRoundCount, 6);
  assert.equal(result.state.includedPaperCount, 20);
  assert.equal(result.state.excludedPaperCount, 8);
  assert.equal(result.state.graphGroundedBriefReady, true);
  assert.equal(result.state.gateReady, true);
  assert.equal(result.state.coverageStatus, "ready");
  assert.equal(result.state.taxonomyStabilityStatus, "stable");
  assert.equal(result.state.representativeMethodsStatus, "ready");
  assert.equal(result.state.benchmarkAlignmentStatus, "aligned");
  assert.equal(result.state.gapClosureStatus, "closed");
  assert.equal(result.generatedFiles.includes(DEFAULT_SURVEY_BRIEF_PATH), true);
  const brief = await fs.readFile(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "utf8"
  );
  assert.match(brief, /^# Survey Brief/m);
  assert.match(brief, /## Themes/m);
  assert.match(brief, /Retrieval-augmented systems/i);
  assert.match(brief, /## Open Problems/m);
});

test("completed survey artifacts can seed survey-mode paper story and writing contract", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
      { query: "graph reasoning benchmark comparison", provider: "papers-cool" },
      { query: "graph reasoning agents survey", provider: "pasa-paper-search" },
      { query: "graph reasoning failure analysis", provider: "papers-cool" },
      { query: "graph reasoning recent papers", provider: "pasa-paper-search" },
    ],
    candidate_paper_count: 44,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 18 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.200${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 8 }, (_unused, index) => ({
      canonical_id: `arxiv:2401.200${index}`,
    })),
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
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Graph pretraining | strong baseline | SurveyBench | Accuracy |",
      "| B | Reasoning agents | multi-step planning | GraphArena | F1 |",
      "| C | Hybrid systems | benchmark transfer | TaskGraph | mAP |",
      "| D | Calibration | robustness caveat | OpenArena | AUC |",
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
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  assert.equal(writingContract.paperMode, "survey");
  assert.deepEqual(writingContract.requiredSections, [
    "abstract",
    "introduction",
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
    "conclusion",
  ]);
  assert.equal(writingContract.proofAppendixRequired, false);
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

test("materializeSurveyReviewState understands modern survey packet field names from live auto-review runs", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    topic: "Generalized Category Discovery",
    mode: "survey",
    queryRounds: [
      { round: 1, queries: ["gcd survey"] },
      { round: 2, queries: ["gcd taxonomy"] },
      { round: 3, queries: ["gcd benchmark"] },
    ],
    totalCount: 14,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    version: 1,
    includedPapers: [
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
      { id: "p4" },
      { id: "p5" },
      { id: "p6" },
      { id: "p7" },
      { id: "p8" },
      { id: "p9" },
      { id: "p10" },
      { id: "p11" },
      { id: "p12" },
      { id: "p13" },
      { id: "p14" },
    ],
    totalCount: 14,
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    version: 1,
    excludedPapers: [],
    backgroundPapers: [{ id: "b1" }, { id: "b2" }],
    totalCount: 2,
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Contrastive + clustering\n- Alignment\n- Domain robustness\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Paper | Family | Dataset | Metric |",
      "| --- | --- | --- | --- |",
      "| A | Contrastive | CUB | All |",
      "| B | Alignment | Cars | All |",
      "| C | Domain Shift | SSB | H-score |",
      "| D | Attention | CUB | All |",
      "| E | Calibration | Cars | H-score |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Better benchmark alignment\n- Shortcut learning robustness\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Scope boundaries are explicit.\n- Blind spots are recorded.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Contrastive + clustering\n- Alignment\n- Domain robustness\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-modern-fields",
    agentId: "researcher",
  });

  assert.equal(result.state.queryRoundCount, 3);
  assert.equal(result.state.candidatePaperCount, 14);
  assert.equal(result.state.includedPaperCount, 14);
  assert.equal(result.state.excludedPaperCount, 2);
  assert.equal(result.state.coverageStatus, "ready");
});

test("materializeSurveyReviewState keeps survey review in retrieval when retrieval_rounds exist but coverage is still incomplete", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    topic: "OmniModel",
    mode: "survey",
    retrieval_rounds: [
      { round: 1, source: "arXiv API", status: "completed" },
      { round: 2, source: "arXiv API", status: "completed" },
      { round: 3, source: "Semantic Scholar", status: "partial" },
      { round: 4, source: "arXiv API", status: "completed" },
    ],
    planned_rounds: [
      { round: 5, source: "Semantic Scholar", status: "pending" },
      { round: 6, source: "arXiv API", status: "pending" },
    ],
    totalCount: 31,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 31 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.500${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Speech omni\n- End-to-end omni\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Omni | baseline | OmniBench | Accuracy |",
      "| B | Speech | audio | OmniEval | F1 |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Better benchmark alignment\n- More non-English omni models\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    [
      "# Coverage Summary",
      "",
      "- Coverage spans the initial omni-model candidate pool.",
      "- Retrieval gaps remain for benchmark breadth and non-English models.",
      "",
    ].join("\n")
  );
  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-retrieval-rounds",
    agentId: "researcher",
  });

  assert.equal(result.state.queryRoundCount, 4);
  assert.equal(result.state.status, "searching");
  assert.equal(result.state.currentPhase, "retrieval");
  assert.match(result.state.pendingReason ?? "", /planned survey search rounds are still pending/i);
  assert.equal(result.state.coverageStatus, "partial");
  assert.equal(result.generatedFiles.includes(DEFAULT_SURVEY_BRIEF_PATH), true);
  assert.equal(
    result.generatedFiles.includes(
      "reviewer/panel-discussions/survey-brief-refinement/PANEL_DISCUSSION_PACKET.json"
    ),
    true
  );
  const brief = await fs.readFile(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "utf8"
  );
  assert.match(brief, /^# Survey Brief/m);
  assert.match(brief, /## Themes/m);
  assert.match(brief, /Speech omni/i);
  assert.match(brief, /## Recommended Next Sweep/m);
});

test("materializeSurveyReviewState blocks completion when pending screening candidates remain unresolved", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "gcd survey", provider: "zotero" },
      { query: "gcd survey recent", provider: "openalex" },
      { query: "gcd benchmarks", provider: "semanticscholar" },
      { query: "gcd failure modes", provider: "dblp" },
    ],
    candidate_paper_count: 52,
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH), {
    papers: [
      { title: "OpenGCD", decision: "pending_screen" },
      { title: "On-the-Fly Category Discovery", decision: "pending_screen" },
    ],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 20 }, (_unused, index) => ({
      canonical_id: `arxiv:2601.000${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 20 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.100${index}`,
    })),
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Prompt tuning\n- Prototype learning\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Prompt | stable | BenchA | Accuracy |",
      "| B | Prototype | robust | BenchB | F1 |",
      "| C | Hybrid | transfer | BenchC | AUC |",
      "| D | Contrastive | caveat | BenchD | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- benchmark alignment\n- scaling\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Coverage spans core venues.\n- Scope and blind spots are explicit.\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-pending-screening",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "screening");
  assert.equal(result.state.currentPhase, "screening");
  assert.equal(result.state.pendingScreeningCount, 2);
  assert.equal(result.state.coverageStatus, "partial");
  assert.match(result.state.pendingReason ?? "", /pending screening candidate/i);
});

test("materializeSurveyReviewState ignores stale pending candidates once screening decisions resolve them", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "gcd survey", provider: "zotero" },
      { query: "gcd survey recent", provider: "openalex" },
      { query: "gcd benchmarks", provider: "semanticscholar" },
      { query: "gcd failure modes", provider: "dblp" },
    ],
    candidate_paper_count: 52,
    saturation: { assessed: true, verdict: "saturated" },
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH), {
    papers: [
      { title: "OpenGCD", decision: "pending_screen" },
      { title: "Open World Object Detection: A Survey", decision: "pending_screen" },
    ],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_SCREENING_DECISIONS_PATH), {
    decisions: [
      { title: "OpenGCD", decision: "include" },
      { title: "Open World Object Detection: A Survey", decision: "reference" },
    ],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 20 }, (_unused, index) => ({
      canonical_id: `arxiv:2602.000${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    excludedPapers: Array.from({ length: 18 }, (_unused, index) => ({
      canonical_id: `arxiv:2502.100${index}`,
    })),
    backgroundPapers: [
      { title: "Open World Object Detection: A Survey" },
      { title: "A Review of Novel Class Discovery" },
    ],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Prompt tuning\n- Prototype learning\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Prompt | stable | BenchA | Accuracy |",
      "| B | Prototype | robust | BenchB | F1 |",
      "| C | Hybrid | transfer | BenchC | AUC |",
      "| D | Contrastive | caveat | BenchD | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- benchmark alignment\n- scaling\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Coverage spans core venues.\n- Scope and blind spots are explicit.\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-resolved-screening",
    agentId: "researcher",
  });

  assert.equal(result.state.pendingScreeningCount, 0);
  assert.equal(result.state.backgroundPaperCount, 2);
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.currentPhase, "complete");
});

test("materializeSurveyReviewState moves into taxonomy_refinement once a brief exists but themes are still weak", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [{ query: "gcd survey", provider: "papers-cool" }, { query: "gcd benchmark", provider: "pasa-paper-search" }],
    candidate_paper_count: 26,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n\n- Dataset coverage is explicit.\n- Metric coverage is explicit.\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 15 }, (_unused, index) => ({
      canonical_id: `arxiv:2502.700${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 11 }, (_unused, index) => ({
      canonical_id: `arxiv:2402.700${index}`,
    })),
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\nA broad review exists, but the taxonomy prose is still weak and does not yet separate method families clearly.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Other GCD Methods | baseline | SurveyBench | Accuracy |",
      "| B | Other GCD Methods | efficient | GraphArena | F1 |",
      "| C | Other GCD Methods | robust | TaskGraph | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Better benchmark alignment\n- Stronger comparative analysis across method families\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage is summarized.\n- Scope boundaries are explicit.\n- Blind spots remain.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Survey methods\n\n## Open Problems\n- Better benchmark alignment\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-taxonomy-refinement",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "synthesizing");
  assert.equal(result.state.currentPhase, "taxonomy_refinement");
  assert.equal(result.state.taxonomyStabilityStatus, "unstable");
  assert.match(result.state.pendingReason ?? "", /taxonomy\/theme section/i);
});

test("materializeSurveyReviewState accepts screened-breadth coverage for niche surveys with many screened candidates", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "gcd survey", provider: "zotero" },
      { query: "gcd ncd osr owr", provider: "openalex" },
      { query: "gcd citation expansion", provider: "citation-expansion" },
    ],
    candidate_paper_count: 74,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n\n- Benchmark / dataset / metric alignment is explicit.\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 23 }, (_unused, index) => ({
      canonical_id: `arxiv:2503.800${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 51 }, (_unused, index) => ({
      canonical_id: `arxiv:2403.800${index}`,
    })),
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Foundational / Baseline\n- Prompt-Based Learning\n- Prototype Learning\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Foundational / Baseline | task formulation | SurveyBench | Accuracy |",
      "| B | Prompt-Based Learning | efficient | GraphArena | F1 |",
      "| C | Prototype Learning | robust | TaskGraph | mAP |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- More breadth on adjacent tasks\n- More fair benchmark comparisons across settings\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    [
      "# Coverage Summary",
      "",
      "- Search coverage spans core venues and adjacent task aliases.",
      "- Scope boundaries and blind spots are explicit.",
      "- Coverage includes a large screened candidate pool with durable exclusions.",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Foundational / Baseline\n- Prompt-Based Learning\n- Prototype Learning\n\n## Open Problems\n- More fair benchmark comparisons across settings\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-screened-breadth",
    agentId: "researcher",
  });

  assert.equal(result.state.coverageStatus, "ready");
});

test("materializeSurveyReviewState uses the representative-method and benchmark tables instead of the first protocol table", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    queryRounds: [{ round: 1 }, { round: 2 }, { round: 3 }],
    totalCount: 14,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n\nDataset / benchmark / metric alignment is explicit.\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    includedPapers: Array.from({ length: 14 }, (_, index) => ({ id: `p${index + 1}` })),
    totalCount: 14,
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    excludedPapers: [],
    backgroundPapers: [{ id: "b1" }, { id: "b2" }],
    totalCount: 2,
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n\n## Taxonomy\n- Contrastive + clustering\n- Alignment\n- Robustness\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH),
    [
      "# SOTA Matrix",
      "",
      "## Evaluation Protocol",
      "| Dimension | Details |",
      "|-----------|---------|",
      "| Backbones | ResNet / DINO / CLIP |",
      "| Datasets | CIFAR / CUB / Cars |",
      "| Metrics | Accuracy / H-score |",
      "| Setting | Known + novel |",
      "",
      "## Quantitative Comparison by Method Family",
      "| Method | Backbone | Improvement | Notes |",
      "|--------|----------|-------------|-------|",
      "| SimGCD | ResNet-50 | baseline | baseline |",
      "| TAN | ResNet-50 | — | alignment |",
      "| FREE | ResNet-50 | robust | domain shift |",
      "| MOS | — | +9% | attention |",
      "| TextGCD | CLIP | +9.9% | multi-modal |",
      "| SDC | ResNet-50 | +2.64% | calibration |",
      "",
      "## Benchmark & Dataset Alignment Table",
      "| Benchmark | Dataset | Classes | Type | Key Methods Evaluated | Primary Metric |",
      "|-----------|---------|---------|------|----------------------|----------------|",
      "| SSB Part 1 | CUB | 200 | Fine-grained | SimGCD, MOS, SDC | All/Old/New/H-score |",
      "| SSB Part 2 | Cars | 196 | Fine-grained | SimGCD, AF, GET | All/Old/New/H-score |",
      "| Standard | CIFAR-100 | 100 | Coarse | SimGCD, TextGCD | All/Old/New/H-score |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n\n## Open Problems\n- Better benchmark alignment\n- Shortcut learning robustness\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Scope boundaries are explicit.\n- Blind spots are recorded.\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH),
    "# Survey Brief\n\n## Themes\n- Contrastive + clustering\n- Alignment\n- Robustness\n"
  );

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test-table-selection",
    agentId: "researcher",
  });

  assert.equal(result.state.representativeMethodsStatus, "ready");
  assert.equal(result.state.benchmarkAlignmentStatus, "aligned");
});

test("completed survey review can advance into write stage", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
      { query: "graph reasoning benchmark comparison", provider: "papers-cool" },
      { query: "graph reasoning agents survey", provider: "pasa-paper-search" },
      { query: "graph reasoning failure analysis", provider: "papers-cool" },
      { query: "graph reasoning recent papers", provider: "pasa-paper-search" },
    ],
    candidate_paper_count: 46,
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH), "# Review Protocol\n\n- Main benchmarks: SurveyBench, GraphArena.\n- Main metrics: Accuracy, F1.\n");
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 18 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.300${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: Array.from({ length: 8 }, (_unused, index) => ({
      canonical_id: `arxiv:2401.300${index}`,
    })),
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
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| A | Graph pretraining | strong baseline | SurveyBench | Accuracy |",
      "| B | Reasoning agents | multi-step planning | GraphArena | F1 |",
      "| C | Hybrid systems | benchmark transfer | TaskGraph | mAP |",
      "| D | Calibration | robustness caveat | OpenArena | AUC |",
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
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.orchestration_state.pending_owner_candidate, "academic_writer");
  assert.equal(manifest.orchestration_state.pending_stage_candidate, "write");
  assert.equal(manifest.orchestration_state.handoff_phase, "prepared");
  assert.equal(result.pendingHandoff, true);
  assert.equal(result.pendingHandoffPhase, "prepared");
  assert.equal(
    result.recommendedActions.some(
      (action) =>
        action.kind === "drive_stage" &&
        action.owner === "academic_writer" &&
        action.stage === "write" &&
        typeof action.command === "string" &&
        action.command.includes("/paper-phase")
    ),
    true
  );
});
