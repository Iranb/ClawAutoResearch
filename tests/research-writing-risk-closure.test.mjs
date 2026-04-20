import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeWritingSupportArtifacts } from "../tools/research-writing/materializers.ts";
import { normalizePaperStoryState } from "../tools/workflow-guard-state/paper-story.ts";
import { normalizeReviewPressurePacketState } from "../tools/workflow-guard-state/review-pressure.ts";

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProjectRoot() {
  const projectsRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-risk-closure-")
  );
  const projectRoot = path.join(projectsRoot, "project-alpha");
  await fs.mkdir(projectRoot, { recursive: true });

  await writeText(
    path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
    "# Story Spine\n- Contribution: graph-grounded support router\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
    "# Claim To Experiment Map\n\n## claim-1\n- Evidence: Table 1\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
    "# Fallback Narrative\n- Narrow to bounded support precision gains.\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "REJECTION_RISK_TABLE.md"),
    "# Rejection Risk Table\n- Incremental novelty risk\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "PIPELINE_FIGURE_SKETCH.md"),
    "# Pipeline Figure Sketch\n- Anchor: graph-grounded support router\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "MODULE_MOTIVATION_MAP.md"),
    "# Module Motivation Map\n- Router: preserve support precision\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"),
    "# Reject First Review\n- Novelty may look incremental.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md"),
    "# Novelty Attack\n- The gain may be only a baseline refinement.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
    "# Unsupported Claim Audit\n- claim-2 unsupported.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
    "# Reverse Outline\n- Intro drifts away from challenge.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"),
    "# Figure Table QC\n- Figure 1 should be the anchor figure.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
    "# Limitation Audit\n- Keep scope bounded.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "external_review_2026-04-05.md"),
    "# External Review\n\n## Major Concerns\n- The novelty claim is too broad.\n- The venue fit is unclear.\n"
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "project-alpha",
    target_venues: ["ICLR", "NeurIPS"],
    research_program: {
      goal: "Improve support precision for automated research writing.",
      problem_statement: "Current drafts drift away from grounded evidence.",
      baseline_reference: "baseline-router",
      primary_metric: "support_precision",
    },
    idle_research: {
      preferred_venues: ["ICLR", "NeurIPS", "arXiv"],
    },
    external_review_state: {
      status: "received",
      external_review_path: "reviewer/external_review_2026-04-05.md",
      review_response_path: "reviewer/rebuttal_2026-04-05.md",
      overall_recommendation: "weak_reject",
      required_action: "revise_and_rebut",
    },
  });

  return { projectsRoot, projectRoot };
}

function buildPaperStoryState() {
  return normalizePaperStoryState({
    status: "ready",
    claim_support_status: "partial",
    supported_claim_count: 1,
    partial_claim_count: 1,
    unsupported_claim_count: 1,
    story_spine_path: "academic_writer/story/STORY_SPINE.md",
    claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    rejection_risk_table_path: "academic_writer/story/REJECTION_RISK_TABLE.md",
    pipeline_figure_sketch_path: "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
    module_motivation_map_path: "academic_writer/story/MODULE_MOTIVATION_MAP.md",
    idea_to_claim_map_path: "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
  });
}

function buildReviewPressureState() {
  return normalizeReviewPressurePacketState({
    status: "ready",
    reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
    novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
    unsupported_claim_audit_path: "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
    figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
  });
}

test("writing support artifacts now include venue routing and auto-materialized rebuttal response packet", async (t) => {
  const { projectsRoot, projectRoot } = await makeProjectRoot();
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  const result = await materializeWritingSupportArtifacts({
    projectRoot,
    stage: "submit",
    paperStoryState: buildPaperStoryState(),
    reviewPressureState: buildReviewPressureState(),
  });

  assert.ok(
    result.generatedFiles.includes("academic_writer/VENUE_ROUTING_PLAN.md"),
    "venue routing plan should be generated"
  );
  assert.ok(
    result.generatedFiles.includes("reviewer/rebuttal_2026-04-05.md"),
    "rebuttal response should be generated from external review"
  );

  const venuePlan = await fs.readFile(
    path.join(projectRoot, "academic_writer", "VENUE_ROUTING_PLAN.md"),
    "utf8"
  );
  assert.match(venuePlan, /ICLR|NeurIPS/i);
  assert.match(venuePlan, /support_precision|baseline-router/i);

  const rebuttal = await fs.readFile(
    path.join(projectRoot, "reviewer", "rebuttal_2026-04-05.md"),
    "utf8"
  );
  assert.match(rebuttal, /Priority Color/i);
  assert.match(rebuttal, /Champion Strategy/i);
  assert.match(rebuttal, /weak_reject|revise_and_rebut|novelty/i);
});

test("survey writing support scaffolds missing section packets and drafts", async (t) => {
  const { projectsRoot, projectRoot } = await makeProjectRoot();
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
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
  };
  manifest.survey_review = {
    status: "completed",
    topic: "Generalized Category Discovery v3",
    survey_brief_path: "researcher/SURVEY_BRIEF.md",
    literature_review_path: "researcher/LITERATURE_REVIEW.md",
    sota_matrix_path: "researcher/SOTA_MATRIX.md",
    gap_synthesis_path: "researcher/GAP_SYNTHESIS.md",
    coverage_summary_path: "researcher/COVERAGE_SUMMARY.md",
  };
  await writeJson(manifestPath, manifest);

  await writeText(
    path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
    "# Survey Brief\n- Topic: GCD\n- Benchmark caution: ImageNet-100 settings remain incomparable across backbones.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
    "# Literature Review\n\n## Prompt-Based Learning\n- Prompt methods adapt frozen backbones.\n\n## Prototype Learning\n- Prototype methods stabilize known/novel separation.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    "| Family | Representative | Benchmark | Metric |\n| --- | --- | --- | --- |\n| Prompt-Based Learning | SPTNet | ImageNet-100 | accuracy |\n| Prototype Learning | ProtoGCD | CIFAR100 | NMI |\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
    "# Gap Synthesis\n- Benchmark comparability is still weak.\n- Open-world deployment remains under-evaluated.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
    "# Coverage Summary\n- Included papers cover prompt, prototype, and debiasing families.\n- Blind spot: embodied and multimodal variants.\n"
  );

  const result = await materializeWritingSupportArtifacts({
    projectRoot,
    stage: "write",
    paperStoryState: buildPaperStoryState(),
    reviewPressureState: buildReviewPressureState(),
  });

  for (const relativePath of [
    "academic_writer/section_packets/evidence_synthesis.md",
    "academic_writer/section_packets/benchmark_landscape.md",
    "academic_writer/section_packets/open_problems.md",
    "academic_writer/section_packets/conclusion.md",
    "academic_writer/paper/sections/evidence_synthesis.tex",
    "academic_writer/paper/sections/benchmark_landscape.tex",
    "academic_writer/paper/sections/open_problems.tex",
    "academic_writer/paper/sections/conclusion.tex",
  ]) {
    assert.ok(result.generatedFiles.includes(relativePath), `${relativePath} should be generated`);
    await fs.access(path.join(projectRoot, relativePath));
  }

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.writing_session.status, "drafting");
  assert.equal(updatedManifest.writing_session.process_status, "drafting");
  assert.equal(updatedManifest.writing_session.drafted_sections.length, 8);
  assert.equal(
    updatedManifest.writing_session.section_packets.evidence_synthesis.status,
    "drafting"
  );
});
