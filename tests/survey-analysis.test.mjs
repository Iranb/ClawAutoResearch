import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
  DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
  DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH,
  DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
  materializeSurveyAnalysis,
} from "../tools/research-authoring/survey-analysis.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeSurveyAnalysisProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-survey-analysis-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-analysis-demo",
    workflow_line: "survey",
    paper_type: "survey",
    writing_contract: {
      paper_mode: "survey",
    },
    survey_review: {
      topic: "Graph reasoning survey",
      status: "completed",
      included_papers_path: "researcher/INCLUDED_PAPERS.json",
      excluded_papers_path: "researcher/EXCLUDED_PAPERS.json",
      screening_decisions_path: "researcher/CANDIDATE_SCREENING_DECISIONS.json",
      review_protocol_path: "researcher/REVIEW_PROTOCOL.md",
      literature_review_path: "researcher/LITERATURE_REVIEW.md",
      sota_matrix_path: "researcher/SOTA_MATRIX.md",
      gap_synthesis_path: "researcher/GAP_SYNTHESIS.md",
      coverage_summary_path: "researcher/COVERAGE_SUMMARY.md",
      survey_brief_path: "researcher/SURVEY_BRIEF.md",
      query_round_count: 4,
      candidate_paper_count: 28,
      included_paper_count: 12,
      excluded_paper_count: 10,
      pending_screening_count: 0,
      pending_planned_round_count: 0,
      coverage_status: "ready",
      taxonomy_stability_status: "stable",
      representative_methods_status: "ready",
      benchmark_alignment_status: "aligned",
      gap_closure_status: "closed",
      gate_ready: true,
    },
  });
  return projectRoot;
}

test("materializeSurveyAnalysis writes comparability and traceability audits for a grounded survey packet", async (t) => {
  const projectRoot = await makeSurveyAnalysisProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeText(
    path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
    [
      "# Survey Brief",
      "",
      "## Themes",
      "- Graph Pretraining improves benchmark coverage when SurveyBench and GraphArena stay explicit.",
      "- Reasoning Agents expose protocol-sensitive tradeoffs on GraphArena F1.",
      "",
      "## Open Problems",
      "- Benchmark alignment across SurveyBench and GraphArena remains weak.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
    [
      "# Literature Review",
      "",
      "## Taxonomy",
      "- Graph Pretraining",
      "- Reasoning Agents",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Dataset | Metric | Backbone | Protocol | Notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| Graph Pretraining | Foundation | SurveyBench | Accuracy | ViT-B | standard | broad coverage |",
      "| Reasoning Agents | Planning | GraphArena | F1 | ViT-B | standard | protocol-sensitive tradeoff |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"),
    "# Review Protocol\n\n- Dataset / benchmark / metric alignment is explicit.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
    "# Gap Synthesis\n\n## Open Problems\n- Benchmark alignment across SurveyBench and GraphArena remains weak.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Blind spots are documented.\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: [
      { canonical_id: "paper:1", title: "Graph Pretraining for SurveyBench" },
      { canonical_id: "paper:2", title: "Reasoning Agents on GraphArena" },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    backgroundPapers: [{ title: "Open World Object Detection: A Survey" }],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "CANDIDATE_SCREENING_DECISIONS.json"),
    {
      decisions: [
        {
          title: "Open World Object Detection: A Survey",
          decision: "background",
          reason: "scope boundary anchor",
          paper_role: "boundary_reference",
          evidence_role: "scope_guardrail",
          benchmark_family: "OpenWorldDetection",
        },
        {
          title: "Graph Pretraining for SurveyBench",
          decision: "include",
          paper_role: "strong_baseline",
          evidence_role: "representative_family_member",
          benchmark_family: "SurveyBench",
          task_family: "graph_reasoning",
          setting_family: "standard",
        },
      ],
    }
  );

  const result = await materializeSurveyAnalysis({ projectRoot });

  assert.equal(result.comparabilityReady, true);
  assert.equal(result.traceabilityReady, true);
  assert.equal(result.fairCompareRowCount >= 2, true);
  assert.equal(result.traceableClaimCount, result.claimCount);

  const traceabilityAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH), "utf8")
  );
  assert.equal(traceabilityAudit.ready, true);
  assert.equal(traceabilityAudit.backgroundAnchorCount, 1);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH), "utf8")
  );
  assert.equal(sourceIndex.claims.length >= 2, true);
  assert.equal(sourceIndex.claims[0].traceabilityStatus, "ready");
  assert.equal(sourceIndex.roleCoverage.paperRoleCounts.strong_baseline, 1);

  const report = await fs.readFile(
    path.join(projectRoot, DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH),
    "utf8"
  );
  assert.match(report, /Traceable claims/i);
  assert.match(report, /Fair Compare Summary/i);

  const topTierBridge = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH), "utf8")
  );
  assert.equal(topTierBridge.ready, true);
  assert.equal(topTierBridge.roleCoverage.paperRoleCounts.strong_baseline, 1);
  assert.equal(topTierBridge.benchmarkHints.selectedBenchmarkFamily, "SurveyBench");
  assert.equal(topTierBridge.contracts.benchmarkProtocol.status, "partial");
});

test("materializeSurveyAnalysis flags unsupported synthesis claims when traceability is weak", async (t) => {
  const projectRoot = await makeSurveyAnalysisProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeText(
    path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
    "# Survey Brief\n\n## Themes\n- Latent Route Harmonization dominates every benchmark family.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
    "# Literature Review\n\n## Taxonomy\n- Graph Pretraining\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Dataset | Metric | Notes |",
      "| --- | --- | --- | --- | --- |",
      "| Graph Pretraining | Foundation | SurveyBench | Accuracy | baseline |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"),
    "# Review Protocol\n\n- Dataset / benchmark / metric alignment is explicit.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
    "# Gap Synthesis\n\n## Open Problems\n- Better benchmark alignment\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Blind spots are documented.\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: [{ canonical_id: "paper:1", title: "Graph Pretraining for SurveyBench" }],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    backgroundPapers: [],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "CANDIDATE_SCREENING_DECISIONS.json"),
    { decisions: [] }
  );

  const result = await materializeSurveyAnalysis({ projectRoot });

  assert.equal(result.traceabilityReady, false);
  assert.equal(result.unsupportedClaimCount > 0, true);

  const traceabilityAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH), "utf8")
  );
  assert.equal(traceabilityAudit.ready, false);
  assert.equal(traceabilityAudit.traceabilityReady, false);
});
