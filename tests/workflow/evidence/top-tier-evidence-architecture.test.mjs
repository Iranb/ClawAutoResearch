import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeBenchmarkRegistry } from "../../../tools/workflow-evidence/benchmark-registry.ts";
import { materializeStatisticalEvidence } from "../../../tools/workflow-evidence/statistics.ts";
import { materializeAblationSufficiency } from "../../../tools/workflow-evidence/ablation-sufficiency.ts";
import { materializeVenueCompetition } from "../../../tools/workflow-evidence/venue-competition.ts";
import { materializeOpportunityModel } from "../../../tools/workflow-evidence/opportunity-model.ts";
import { materializeMechanismPacket } from "../../../tools/workflow-evidence/mechanism-packet.ts";
import { materializeReproducibilityPack } from "../../../tools/workflow-evidence/reproducibility-pack.ts";
import { materializeCameraReadyPack } from "../../../tools/workflow-evidence/camera-ready-pack.ts";
import { materializeCitationAudit } from "../../../tools/research-intel/citation-audit.ts";
import { materializeFinalConsistencyAudit } from "../../../tools/research-submit/final-consistency-audit.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function setupProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-top-tier-arch-"));
  const now = "2026-04-15T00:00:00.000Z";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo top-tier project",
    current_stage: "experiment",
    research_program: {
      status: "approved",
      goal: "Test top-tier evidence pipeline",
      baseline_reference: "SimGCD",
      primary_metric: "h_score",
      tracks: [
        {
          track_id: "track-main",
          hypothesis: "Frequency decomposition improves h-score",
          required_ablations: ["freq ablation", "alignment ablation"],
        },
      ],
    },
    survey_review: {
      topic: "Generalized category discovery",
      query_registry_path: "researcher/QUERY_REGISTRY.json",
      included_papers_path: "researcher/INCLUDED_PAPERS.json",
      excluded_papers_path: "researcher/EXCLUDED_PAPERS.json",
      review_protocol_path: "researcher/REVIEW_PROTOCOL.md",
      literature_review_path: "researcher/LITERATURE_REVIEW.md",
      sota_matrix_path: "researcher/SOTA_MATRIX.md",
      gap_synthesis_path: "researcher/GAP_SYNTHESIS.md",
      coverage_summary_path: "researcher/COVERAGE_SUMMARY.md",
      survey_brief_path: "researcher/SURVEY_BRIEF.md",
    },
    citation_integrity: {
      enabled: true,
      verification_required: true,
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "researcher/CITATION_AUDIT_REPORT.json",
      allowed_placeholder_count: 0,
    },
  });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_mode: "gcd_fine_grained",
    primary_metric_contract: {
      metric_name: "h_score",
      direction: "higher_is_better",
      primary_evidence: [
        "Use the ProtoGCD validation split, checkpoint selection, and H-score evaluation unchanged.",
      ],
    },
    baseline_fairness_contract: {
      locked_dataset_protocol: true,
      locked_metric_protocol: true,
      locked_evaluation_harness: true,
    },
    protocol_lock_contract: {
      benchmark_family: "ProtoGCD-CIFAR100",
      canonical_dataset: "CIFAR-100",
      split_descriptor: "ProtoGCD baseline-a validation split",
      split_source: "researcher/splits/protogcd-baseline-a.json",
      split_checksum: "sha256:proto-split-demo",
      evaluation_harness: "protogcd-hscore-v1",
      official_eval_recipe:
        "Use the ProtoGCD validation split, checkpoint selection, and H-score evaluation unchanged.",
      fair_compare_notes: [
        "Main table uses the same ViT-B/16 backbone as the reproduced SimGCD baseline.",
        "All headline comparisons keep the same validation split and evaluation harness.",
      ],
      fairness_checks: {
        same_backbone: "pass",
        same_pretraining: "pass",
        same_split: "pass",
        same_evaluation_harness: "pass",
        baseline_reference_mode: "reproduced",
      },
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-proposed-3",
      lastFailedExperimentId: null,
      bestKnownConfigRef: "configs/best.yaml",
      lastDecisionSummary: "proposed kept",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
    experiments: [
      {
        experimentId: "exp-baseline-1",
        name: "baseline seed 1",
        status: "completed",
        metrics: { h_score: 0.52 },
        resultPaths: ["researcher/artifacts/results/baseline-1.json"],
      },
      {
        experimentId: "exp-baseline-2",
        name: "baseline seed 2",
        status: "completed",
        metrics: { h_score: 0.53 },
        resultPaths: ["researcher/artifacts/results/baseline-2.json"],
      },
      {
        experimentId: "exp-baseline-3",
        name: "baseline seed 3",
        status: "completed",
        metrics: { h_score: 0.51 },
        resultPaths: ["researcher/artifacts/results/baseline-3.json"],
      },
      {
        experimentId: "exp-proposed-1",
        name: "proposed freq ablation seed 1",
        status: "completed",
        comparisonGroup: "proposed",
        metrics: { h_score: 0.60 },
        resultPaths: ["researcher/artifacts/results/proposed-1.json"],
      },
      {
        experimentId: "exp-proposed-2",
        name: "proposed alignment ablation seed 2",
        status: "completed",
        comparisonGroup: "proposed",
        metrics: { h_score: 0.61 },
        resultPaths: ["researcher/artifacts/results/proposed-2.json"],
      },
      {
        experimentId: "exp-proposed-3",
        name: "proposed seed 3",
        status: "completed",
        comparisonGroup: "proposed",
        metrics: { h_score: 0.62 },
        resultPaths: ["researcher/artifacts/results/proposed-3.json"],
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "paper:simgcd",
        title: "Generalized Category Discovery",
        venue: "ECCV",
        year: 2022,
        arxiv_id: "2201.02609",
        citation_count: 120,
      },
      {
        canonical_id: "paper:debgcd",
        title: "DebGCD",
        venue: "ICLR",
        year: 2025,
        arxiv_id: "2501.12345",
        citation_count: 10,
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "QUERY_REGISTRY.json"), {
    rounds: [{ query: "gcd survey" }, { query: "fine-grained gcd" }, { query: "gcd benchmarks" }],
    candidate_paper_count: 12,
  });
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: [{ id: "paper:simgcd" }, { id: "paper:debgcd" }],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    papers: [{ id: "paper:placeholder" }],
  });
  await writeText(path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"), "# Review Protocol\n\n- dataset\n- benchmark\n- metric\n");
  await writeText(path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"), "# Literature Review\n\n## Taxonomy\n- contrastive clustering\n- multimodal learning\n");
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Notes | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| SimGCD | contrastive | baseline | SSB | H-score |",
      "| DebGCD | debiasing | sota | SSB | H-score |",
      "",
    ].join("\n")
  );
  await writeText(path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"), "# Gap Synthesis\n\n## Open Problems\n- unknown category count\n- natural domain shift\n");
  await writeText(path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"), "# Coverage Summary\n\n- benchmark coverage\n- scope boundary\n- blind spots\n");
  await writeText(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), "# Survey Brief\n\n## Themes\n- contrastive clustering\n- multimodal learning\n\n## Open Problems\n- unknown category count\n");
  await writeText(path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"), "# Claim Evidence Matrix\n\nFrequency decomposition improves h-score over SimGCD.\nAblations isolate the mechanism.\n");
  await writeText(path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"), "# Unsupported Claims\n\nGeneralizes to all fine-grained datasets.\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Results}\n\\begin{figure}\\caption{Main result}\\label{fig:main}\n\\end{figure}\n\\begin{table}\\caption{Main table}\\label{tab:main}\n\\end{table}\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@inproceedings{simgcd,title={Generalized Category Discovery},author={Vaze, Sona},booktitle={ECCV},year={2022}}\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "baseline-1.json"), { h_score: 0.52 });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "baseline-2.json"), { h_score: 0.53 });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "baseline-3.json"), { h_score: 0.51 });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "proposed-1.json"), { h_score: 0.60 });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "proposed-2.json"), { h_score: 0.61 });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "proposed-3.json"), { h_score: 0.62 });
  await writeJson(path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"), { status: "ready" });
  await writeJson(path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"), { status: "ready" });
  return projectRoot;
}

test("top-tier evidence architecture materializers produce durable artifacts and update manifest state", async (t) => {
  const projectRoot = await setupProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const benchmark = await materializeBenchmarkRegistry({ projectRoot });
  const statistics = await materializeStatisticalEvidence({ projectRoot });
  const ablations = await materializeAblationSufficiency({ projectRoot });
  const venue = await materializeVenueCompetition({ projectRoot });
  const opportunity = await materializeOpportunityModel({ projectRoot });
  const mechanism = await materializeMechanismPacket({ projectRoot });
  const repro = await materializeReproducibilityPack({ projectRoot });
  const cameraReady = await materializeCameraReadyPack({ projectRoot });
  const citation = await materializeCitationAudit({ projectRoot });
  const audit = await materializeFinalConsistencyAudit({ projectRoot });

  assert.equal(benchmark.locked, true);
  assert.equal(benchmark.splitDescriptor, "ProtoGCD baseline-a validation split");
  assert.equal(benchmark.fairCompareStatus, "pass");
  assert.equal(benchmark.allowedDeviationStatus, "none");
  assert.equal(statistics.claimStrengthStatus, "strong");
  assert.equal(ablations.sufficiencyStatus, "sufficient");
  assert.equal(venue.status, "ready");
  assert.equal(venue.objectionCount > 0, true);
  assert.equal(opportunity.verdict, "worth_top_tier_bet");
  assert.equal(opportunity.positioningStatus, "ready");
  assert.equal(opportunity.competitorObjectionCount > 0, true);
  assert.equal(opportunity.deltaPlannerStatus, "ready");
  assert.equal(mechanism.status, "ready");
  assert.equal(repro.status, "ready");
  assert.equal(cameraReady.status, "ready");
  assert.equal(citation.allCitationsReal, true);
  assert.equal(audit.cameraReady.status, "ready");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.benchmark_protocol.locked, true);
  assert.equal(manifest.benchmark_protocol.fair_compare_status, "pass");
  assert.equal(manifest.venue_competition.objection_count > 0, true);
  assert.equal(manifest.opportunity_scorecard.positioning_status, "ready");
  assert.equal(manifest.opportunity_scorecard.competitor_objection_count > 0, true);
  assert.equal(manifest.opportunity_scorecard.delta_planner_status, "ready");
  assert.equal(manifest.statistical_evidence.claim_strength_status, "strong");
  assert.equal(manifest.reproducibility_pack.status, "ready");
  assert.equal(manifest.camera_ready_evidence.status, "ready");

  await fs.access(path.join(projectRoot, "researcher", "BENCHMARK_REGISTRY.json"));
  await fs.access(path.join(projectRoot, "researcher", "PROTOCOL_LOCK.json"));
  await fs.access(path.join(projectRoot, "researcher", "BASELINE_FAIRNESS_REPORT.json"));
  await fs.access(path.join(projectRoot, "researcher", "VENUE_COMPETITOR_OBJECTIONS.json"));
  await fs.access(path.join(projectRoot, "researcher", "VENUE_DELTA_PLAN.json"));
  await fs.access(path.join(projectRoot, "analyzer", "STATISTICAL_EVIDENCE_SUMMARY.md"));
  await fs.access(path.join(projectRoot, "researcher", "PAPER_IDENTITY_REGISTRY.json"));
  await fs.access(path.join(projectRoot, "academic_writer", "FIGURE_REGISTRY.json"));
  await fs.access(path.join(projectRoot, "submit", "FINAL_CONSISTENCY_AUDIT.md"));
});

test("camera-ready and citation audits surface placeholder regressions", async (t) => {
  const projectRoot = await setupProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "Figure?? remains unresolved.\nTable ?? remains unresolved.\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@misc{placeholder,title={Placeholder work},year={2026}}\n"
  );

  const cameraReady = await materializeCameraReadyPack({ projectRoot });
  const citation = await materializeCitationAudit({ projectRoot });

  assert.equal(cameraReady.status, "partial");
  assert.equal(citation.allCitationsReal, false);
  assert.match(citation.issues.join(","), /placeholder/i);
});

test("citation audit enforces survey minimum count and topicality", async (t) => {
  const projectRoot = await setupProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.workflow_line = "survey";
  manifest.paper_type = "survey";
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
    paper_mode: "survey",
  };
  manifest.survey_review = {
    ...(manifest.survey_review ?? {}),
    topic: "Generalized Category Discovery",
  };
  await writeJson(manifestPath, manifest);
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    [
      "@inproceedings{simgcd,title={Generalized Category Discovery},author={Vaze, Sona},booktitle={ECCV},year={2022}}",
      "@book{thinkingfastslow,title={Thinking, Fast and Slow},author={Kahneman, Daniel},year={2011}}",
    ].join("\n")
  );

  const citation = await materializeCitationAudit({ projectRoot });

  assert.equal(citation.minimumCitationCount, 50);
  assert.equal(citation.bibliographyEntryCount, 2);
  assert.equal(citation.citationCountStatus, "needs_revision");
  assert.equal(citation.topicRelevanceStatus, "needs_revision");
  assert.equal(citation.offTopicCitationCount, 1);
  assert.match(citation.issues.join(","), /minimum_count|off_topic/i);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.citation_integrity.minimum_citation_count, 50);
  assert.equal(updatedManifest.citation_integrity.off_topic_citation_count, 1);
});

test("citation audit enforces journal minimum count", async (t) => {
  const projectRoot = await setupProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
    paper_mode: "journal",
  };
  manifest.research_program = {
    ...(manifest.research_program ?? {}),
    goal: "Generalized Category Discovery journal manuscript",
  };
  await writeJson(manifestPath, manifest);

  const bibEntries = Array.from({ length: 39 }, (_unused, index) =>
    `@article{gcd${index},title={Generalized Category Discovery Variant ${index}},author={Test, Author},journal={TPAMI},year={2025}}`
  ).join("\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    bibEntries
  );

  const citation = await materializeCitationAudit({ projectRoot });

  assert.equal(citation.minimumCitationCount, 40);
  assert.equal(citation.bibliographyEntryCount, 39);
  assert.equal(citation.citationCountStatus, "needs_revision");
  assert.match(citation.issues.join(","), /minimum_count/i);
});

test("citation audit floors stale conference minimum count to thirty", async (t) => {
  const projectRoot = await setupProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
    paper_mode: "conference",
  };
  manifest.citation_integrity = {
    ...(manifest.citation_integrity ?? {}),
    minimum_citation_count: 6,
  };
  await writeJson(manifestPath, manifest);

  const citation = await materializeCitationAudit({ projectRoot });

  assert.equal(citation.minimumCitationCount, 30);
  assert.equal(citation.bibliographyEntryCount, 1);
  assert.equal(citation.citationCountStatus, "needs_revision");
  assert.match(citation.issues.join(","), /minimum_count/i);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.citation_integrity.minimum_citation_count, 30);
});
