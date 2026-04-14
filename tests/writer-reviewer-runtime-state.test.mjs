import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getCitationCollectionStateSummary,
  getExternalReviewStateSummary,
  getExperimentSearchStateSummary,
  getFigureQcStateSummary,
  getGraphGuidedWritingStateSummary,
  getPaperQcStateSummary,
  getReviewIssueTrackerStateSummary,
  getReviewSessionStateSummary,
  getWritingSessionStateSummary,
  runWorkflowAutoIterator,
  setCitationCollectionState,
  setExternalReviewState,
  setExperimentSearchState,
  setFigureQcState,
  setGraphGuidedWritingState,
  setPaperQcState,
  setReviewIssueTrackerState,
  setReviewSessionState,
  setWritingSessionState,
} from "../tools/workflow-guard.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-writer-reviewer-runtime-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value = "# artifact\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function seedProjectReadyForWrite(projectRoot) {
  const now = "2026-03-26T09:00:00.000Z";
  const trackId = "track-main";
  const experimentId = "exp-1";

  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        linked_graph_nodes: ["paper:demo", "concept:graph-grounding"],
        relation_patterns: ["supports->paper:demo"],
        evidence_pointers: ["graph/LIMITATION_FRONTIER.md#demo-track"],
        reasoning_packet_dir: `researcher/reasoning/${trackId}`,
        working_memory_path: `researcher/reasoning/${trackId}/working-memory.md`,
        synthesis_packet_path: `researcher/reasoning/${trackId}/synthesis.md`,
      },
    ],
  });
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "packet.md"),
    "# reasoning packet\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "working-memory.md"),
    "# working memory\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "synthesis.md"),
    "# synthesis\n"
  );
  await writeText(path.join(projectRoot, "CLAIM_POLICY.md"));

  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
  });
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
  });
  for (const fileName of [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, "graph", fileName));
  }

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"));
  await writeText(path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"));
  await writeText(path.join(projectRoot, "orchestrator", "PLAN.md"));
  await writeText(path.join(projectRoot, "orchestrator", "TODOS.md"));
  await writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"));
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
  await writeText(
    path.join(projectRoot, "researcher", "artifacts", "results", "metrics.json"),
    "{}\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: experimentId,
      lastFailedExperimentId: null,
      bestKnownConfigRef: "configs/best.yaml",
      lastDecisionSummary: "baseline validated",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
    experiments: [
      {
        experimentId,
        trackId,
        name: "baseline",
        kind: "train",
        status: "completed",
        stage: "experiment",
        hypothesis: "baseline works",
        configRef: "configs/best.yaml",
        summary: "completed run",
        server: "gpu-0",
        gpuId: "0",
        screenName: "baseline",
        launchedAt: now,
        completedAt: now,
        updatedAt: now,
        lastUpdatedBy: "researcher",
        decision: "keep",
        keyMetric: { name: "acc", value: 0.9 },
        metrics: { acc: 0.9 },
        resultPaths: ["researcher/artifacts/results/metrics.json"],
        evidencePointers: ["researcher/artifacts/results/metrics.json"],
        failureSignature: null,
        notes: ["stable"],
        metadata: {},
        papernexusSync: {
          status: "synced",
          corpus: "demo-project",
          lastSyncedAt: now,
          nodeRefs: ["paper:demo"],
          notes: null,
        },
      },
    ],
  });

  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "train.py"
    ),
    "print('ok')\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "README.md"
    )
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: experimentId,
      project_id: "demo-project",
      track_id: trackId,
      name: "baseline",
      entry_point: "train.py",
      status: "completed",
    }
  );

  for (const fileName of [
    "NARRATIVE_REPORT.md",
    "CLAIM_EVIDENCE_MATRIX.md",
    "TRACK_VERDICTS.md",
    "UNSUPPORTED_CLAIMS.md",
    "QUALITY_AUDIT.md",
    "THEORY_SUPPORT_NOTE.md",
  ]) {
    await writeText(path.join(projectRoot, "analyzer", fileName));
  }
  await writeJson(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
    schema_version: 1,
    status: "draft",
    overall_signal: "green",
    theorem_candidates: [
      {
        packet_id: "theorem_demo",
        role: "theorem",
        statement: "Demo theorem statement.",
      },
    ],
    lemma_packets: [],
    appendix_sections: [],
  });
  await writeJson(
    path.join(projectRoot, "analyzer", "proof-packets", "lemma_demo.json"),
    {
      packet_id: "lemma_demo",
      role: "lemma",
      statement: "Demo lemma statement.",
      body_safe: true,
    }
  );

  await writeText(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"));
  await writeJson(path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json"), {
    status: "pass",
  });
  await writeJson(
    path.join(projectRoot, "reviewer", "SUBMISSION_SIMULATION_REVIEW.json"),
    { status: "pass" }
  );
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [],
  });
  await writeText(path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"));
  for (const fileName of [
    "REJECT_FIRST_REVIEW.md",
    "NOVELTY_ATTACK.md",
    "UNSUPPORTED_CLAIM_AUDIT.md",
    "REVERSE_OUTLINE.md",
    "FIGURE_TABLE_QC.md",
    "LIMITATION_AUDIT.md",
  ]) {
    await writeText(path.join(projectRoot, "reviewer", "story-pressure", fileName));
  }

  await writeText(path.join(projectRoot, "cross-reviewer", "notes.md"));
  await writeText(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"));
  await writeText(path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md"));
  await writeText(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"));
  await writeText(path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"));
  for (const fileName of [
    "TASK_SUMMARY.md",
    "CHALLENGE_STATEMENT.md",
    "INSIGHT_SUMMARY.md",
    "CONTRIBUTION_MAP.md",
    "ADVANTAGE_MAP.md",
    "STORY_SPINE.md",
    "PIPELINE_FIGURE_SKETCH.md",
    "MODULE_MOTIVATION_MAP.md",
    "CLAIM_TO_EXPERIMENT_MAP.md",
    "FALLBACK_NARRATIVE.md",
    "REJECTION_RISK_TABLE.md",
  ]) {
    await writeText(path.join(projectRoot, "academic_writer", "story", fileName));
  }
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"),
    {
      claims: [
        {
          claim_id: "claim-1",
          fragment_id: "frag-1",
          track_id: trackId,
        },
      ],
    }
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex"),
    "% appendix\n"
  );
  await writeText(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "% refs\n"
  );

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    current_micro_stage: "frontiers_packaged",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
      graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [],
      refresh_required: false,
    },
    experiment_memory: {
      last_ledger_update_at: now,
      papernexus_sync_required: false,
      papernexus_sync_status: "synced",
    },
    innovation_reflection: {
      required_after_experiments: true,
      status: "fresh",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
      reflected_through_experiment_update_at: now,
      reflected_experiment_ids: [experimentId],
    },
    research_program: {
      status: "approved",
      goal: "Writer/reviewer runtime fixture",
      tracks: [
        {
          track_id: trackId,
          priority: 1,
          status: "active",
          hypothesis: "Graph grounding improves support precision.",
          novelty_basis: "It couples frontier packets with section drafting.",
          main_metric: "acc",
          success_threshold: "acc>=0.9",
          required_baselines: ["baseline-a"],
          required_ablations: ["ablation-a"],
          required_controls: ["seed-control"],
          experiment_stage_matrix: [
            "baseline_implementation",
            "baseline_tuning",
            "creative_research",
            "ablation_studies",
          ],
          budget: {
            gpu_hours: 8,
            max_runs: 4,
            max_debug_iterations: 1,
          },
          stop_rules: ["stop after no improvement"],
          rollback_triggers: ["baseline regression"],
          write_scope: {
            allowed_claim_ids: ["claim-1"],
            allowed_figure_ids: ["fig-1"],
          },
        },
      ],
      task_graph: [
        {
          task_id: "plan-main",
          stage: "plan",
          track_id: trackId,
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track active"],
          expected_outputs: ["plan ready"],
          retry_budget: 1,
          exit_criteria: ["plan locked"],
        },
      ],
    },
    orchestration_state: {
      status: "running",
      current_owner: "orchestrator",
      next_owner: "coder",
      next_transition_candidate: "code",
      retry_budget_remaining: 2,
      last_contract_eval_result: "pass",
    },
    experiment_search: {
      status: "ready_for_analysis",
      current_main_stage: "ablation_studies",
      multi_seed_status: "ready",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "ready",
      plot_pack_path: "researcher/plot_pack.json",
    },
    theory_state: {
      status: "draft",
      overall_signal: "green",
      theory_state_path: "analyzer/THEORY_STATE.json",
      source_theory_note_path: "analyzer/THEORY_SUPPORT_NOTE.md",
      proof_packet_dir: "analyzer/proof-packets",
      appendix_packet_path: "academic_writer/THEORY_APPENDIX_PLAN.md",
      main_text_proof_style: "lemma_result_only",
      body_ready: true,
      theorem_count: 1,
      lemma_count: 1,
      proof_packet_count: 1,
      last_updated_at: now,
    },
    writing_contract: {
      template_required: false,
      kg_storyline_required: false,
      required_sections: ["method", "results"],
      section_order: ["abstract", "introduction", "method", "results", "conclusion"],
      paragraph_logic_status: "pending",
      proof_appendix_required: true,
      proof_appendix_path: "academic_writer/paper/sections/appendix_theory.tex",
    },
    citation_integrity: {
      enabled: true,
      verification_required: true,
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      verification_status: "verified",
      bibliography_page_count: 1,
      all_citations_real: true,
      allowed_placeholder_count: 0,
      unresolved_placeholder_count: 0,
      hallucinated_citation_count: 0,
    },
    write_package: {
      status: "ready",
      winning_track_ids: [trackId],
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      narrative_report_path: "analyzer/NARRATIVE_REPORT.md",
      track_verdicts_path: "analyzer/TRACK_VERDICTS.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
      baseline_summary_path: "researcher/baseline_summary.json",
      research_summary_path: "researcher/research_summary.json",
      ablation_summary_path: "researcher/ablation_summary.json",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      figure_pack_path: "academic_writer/FIGURE_PACK.json",
      table_pack_path: "academic_writer/TABLE_PACK.json",
      proof_packet_dir: "analyzer/proof-packets",
      citation_candidates_path: "academic_writer/CITATION_CANDIDATES.json",
    },
    paper_story_state: {
      status: "ready",
      track_id: trackId,
      task_summary_path: "academic_writer/story/TASK_SUMMARY.md",
      challenge_statement_path: "academic_writer/story/CHALLENGE_STATEMENT.md",
      insight_summary_path: "academic_writer/story/INSIGHT_SUMMARY.md",
      contribution_map_path: "academic_writer/story/CONTRIBUTION_MAP.md",
      advantage_map_path: "academic_writer/story/ADVANTAGE_MAP.md",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      pipeline_figure_sketch_path:
        "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
      module_motivation_map_path:
        "academic_writer/story/MODULE_MOTIVATION_MAP.md",
      claim_to_experiment_map_path:
        "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      idea_to_claim_map_path:
        "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
      rejection_risk_table_path:
        "academic_writer/story/REJECTION_RISK_TABLE.md",
      claim_support_status: "supported",
      supported_claim_count: 2,
      partial_claim_count: 0,
      unsupported_claim_count: 0,
      pending_reason: null,
    },
    review_issue_tracker: {
      status: "ready",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      open_counts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      issues: [],
    },
    review_pressure_packet: {
      status: "ready",
      mode: "aggressive",
      track_id: trackId,
      reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
      unsupported_claim_audit_path:
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
      latest_round_at: now,
      pending_reason: null,
    },
    review_session: {
      status: "completed",
      stage_scope: "review",
      round: 1,
      latest_review_path: "reviewer/REVIEW_REPORT.md",
      verdict: "ready",
    },
  });
}

test("writer/reviewer runtime summaries persist durable state and reserve scholar slot", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await setWritingSessionState({
    projectRoot,
    writingSession: {
      status: "writing",
      current_section: "results",
      draft_order: ["method", "experimental_setup", "results", "related_work"],
      finalized_sections: ["method"],
      compile_safe_sections: ["method"],
      section_packets: {
        method: {
          section: "method",
          goal: "Explain the final approach.",
          allowed_claims: ["claim-method-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#method-anchor"],
          forbidden_unsupported_claims: ["claim-unsupported-1"],
          missing_citation_placeholders: [],
          packet_path: "academic_writer/section-packets/method.json",
          draft_path: "academic_writer/paper/sections/method.tex",
          review_path: "cross-reviewer/prose/method-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
        results: {
          section: "results",
          goal: "Ground the headline results in saved evidence.",
          allowed_claims: ["claim-results-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#results-anchor"],
          forbidden_unsupported_claims: ["claim-unsupported-2"],
          missing_citation_placeholders: ["[CITATION NEEDED: prior art]"],
          packet_path: "academic_writer/section-packets/results.json",
          draft_path: "academic_writer/paper/sections/results.tex",
          review_path: null,
          review_verdict: "needs_revision",
          status: "cross_reviewed",
        },
      },
      headline_claim_evidence_status: "partial",
      graph_evidence_coverage_status: "partial",
      graph_evidence_coverage_summary:
        "1/2 headline claims already have graph-backed evidence pointers.",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
      future_scholar_verification_skill: "future/literature-dehallucination",
      pending_reason: "Results still need one more graph-backed evidence pass.",
    },
  });

  await setReviewSessionState({
    projectRoot,
    reviewSession: {
      status: "needs_revision",
      stage_scope: "review",
      round: 2,
      review_packet_path: "reviewer/REVIEW_PACKET.json",
      graph_evidence_summary_path: "reviewer/GRAPH_EVIDENCE_SUMMARY.md",
      latest_review_path: "reviewer/REVIEW_REPORT.md",
      verdict: "not_ready",
      rubric: {
        originality: 7,
        quality: 6,
        clarity: 7,
        significance: 6,
        soundness: 5,
        citation_integrity: 8,
        graph_grounded_evidence_sufficiency: 5,
      },
      reviewer_summary:
        "Soundness and graph-grounded evidence are still below the handoff bar.",
      action_items: [
        "Tighten the claim-evidence bridge in Results.",
        "Remove unsupported headline language from the current abstract.",
      ],
      blocking_artifacts: ["reviewer/REVIEW_REPORT.md"],
      pending_reason: "One more review-driven revision round is required.",
    },
  });

  await setGraphGuidedWritingState({
    projectRoot,
    graphGuidedWriting: {
      enabled: true,
      status: "partial",
      anchor_index_path: "graph/ANCHOR_INDEX.md",
      frontier_files: [
        "graph/LIMITATION_FRONTIER.md",
        "graph/CONTRADICTION_FRONTIER.md",
      ],
      literature_path: "researcher/LITERATURE.md",
      claim_evidence_packet_paths: [
        "analyzer/CLAIM_EVIDENCE_MATRIX.md",
        "academic_writer/KG_STORYLINE_PACKET.md",
      ],
      required_evidence_pointer_count: 2,
      covered_headline_claim_count: 1,
      total_headline_claim_count: 2,
      evidence_coverage_status: "partial",
      missing_evidence_claims: ["claim-results-1"],
      citation_source_mode: "graph_only",
      scholar_query_reserved: true,
      scholar_query_skill_slot: "future/literature-dehallucination",
      pending_reason: "One headline claim still lacks a graph-grounded evidence pointer.",
    },
  });

  const writingSummary = await getWritingSessionStateSummary({ projectRoot });
  const reviewSummary = await getReviewSessionStateSummary({ projectRoot });
  const graphSummary = await getGraphGuidedWritingStateSummary({ projectRoot });

  assert.equal(writingSummary.state.currentSection, "results");
  assert.deepEqual(writingSummary.state.finalizedSections, ["method"]);
  assert.equal(
    writingSummary.state.sectionPackets.results?.reviewVerdict,
    "needs_revision"
  );
  assert.equal(reviewSummary.state.round, 2);
  assert.equal(reviewSummary.state.rubric.soundness, 5);
  assert.equal(graphSummary.state.evidenceCoverageStatus, "partial");
  assert.equal(graphSummary.state.scholarQueryReserved, true);
  assert.equal(
    graphSummary.state.scholarQuerySkillSlot,
    "future/literature-dehallucination"
  );
  assert.equal(writingSummary.processStatus, "drafting");
  assert.equal(writingSummary.nextSuggestedSection, "abstract");
});

test("writing session readiness blocks stale packets and unresolved citation placeholders", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await setWritingSessionState({
    projectRoot,
    writingSession: {
      status: "ready_for_submit",
      current_section: "abstract",
      draft_order: ["abstract", "introduction", "results"],
      finalized_sections: ["abstract"],
      compile_safe_sections: ["abstract"],
      section_packets: {
        abstract: {
          section: "abstract",
          section_class: "abstract",
          goal: "Summarize the paper in one paragraph.",
          allowed_claims: ["claim-abstract-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#abstract-anchor"],
          forbidden_unsupported_claims: ["claim-unsupported-1"],
          missing_citation_placeholders: ["[CITATION NEEDED: baseline]"],
          required_citation_count: 2,
          required_figure_ids: [],
          dependent_sections: ["introduction", "conclusion"],
          stale: true,
          packet_path: "academic_writer/section-packets/abstract.json",
          draft_path: "academic_writer/paper/sections/abstract.tex",
          review_path: "cross-reviewer/prose/abstract-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
      },
      headline_claim_evidence_status: "covered",
      graph_evidence_coverage_status: "covered",
    },
  });

  const summary = await getWritingSessionStateSummary({ projectRoot });
  assert.equal(summary.state.sectionPackets.abstract?.stale, true);
  assert.equal(
    summary.state.sectionPackets.abstract?.requiredCitationCount,
    2
  );
  assert.equal(summary.readyForSubmit, false);
});

test("external review summary persists Stanford reviewer conclusion", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.pdf"),
    "pdf\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "external_review_2026-03-26.md"),
    "# Stanford review\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "rebuttal_2026-03-26.md"),
    "# rebuttal\n"
  );

  await setExternalReviewState({
    projectRoot,
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

  const summary = await getExternalReviewStateSummary({ projectRoot });
  assert.equal(summary.state.status, "received");
  assert.equal(summary.state.reviewSkill, "paperreview-submit");
  assert.equal(summary.externalReviewExists, true);
  assert.equal(summary.reviewResponseExists, true);
  assert.equal(summary.conclusionReady, true);
});

test("external review summary falls back to any compiled PDF under writer paper dir", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "camera_ready_v2.pdf"),
    "pdf\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "external_review_2026-03-26.md"),
    "# Stanford review\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "rebuttal_2026-03-26.md"),
    "# rebuttal\n"
  );

  await setExternalReviewState({
    projectRoot,
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

  const summary = await getExternalReviewStateSummary({ projectRoot });
  assert.equal(summary.submittedPdfExists, true);
  assert.match(summary.submittedPdfResolvedPath ?? "", /camera_ready_v2\.pdf$/);
});

test("phase-2 runtime state summaries persist QC, issue tracking, and independent experiment search state", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(path.join(projectRoot, "academic_writer", "PAPER_QC.md"), "# qc\n");
  await writeText(
    path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json"),
    "{\n  \"status\": \"ok\"\n}\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "cached_citations.bib"),
    "% cached bib\n"
  );
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [
      {
        issue_id: "rev-1",
        lane: "surface",
        severity: "high",
        status: "open",
      },
      {
        issue_id: "rev-2",
        lane: "evidence",
        severity: "medium",
        status: "waived",
      },
    ],
  });

  await setPaperQcState({
    projectRoot,
    paperQc: {
      status: "running",
      compile_status: "pass",
      compile_round_count: 2,
      chktex_status: "pending",
      page_budget_status: "pending",
      latest_report_path: "academic_writer/PAPER_QC.md",
    },
  });
  await setFigureQcState({
    projectRoot,
    figureQc: {
      status: "running",
      figure_review_path: "reviewer/SURFACE_REVIEW.json",
      duplicate_figure_status: "pass",
      caption_alignment_status: "pending",
      text_alignment_status: "pending",
      selection_status: "pass",
    },
  });
  await setCitationCollectionState({
    projectRoot,
    citationCollection: {
      status: "running",
      cache_bib_path: "academic_writer/cached_citations.bib",
      candidate_count: 18,
      verified_count: 7,
      suspicious_count: 1,
      hallucinated_count: 0,
    },
  });
  await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      status: "open",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      last_review_round: 4,
      open_counts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
      },
    },
  });
  await setExperimentSearchState({
    projectRoot,
    experimentSearch: {
      status: "ready_for_analysis",
      current_main_stage: "ablation_studies",
      current_substage: "multi_seed_aggregation",
      best_node_id: "node-best",
      completed_node_ids: ["node-1", "node-2"],
      multi_seed_status: "ready",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "ready",
      plot_pack_path: "researcher/plot_pack.json",
      checkpoint_path: "researcher/checkpoints/experiment-manager.json",
    },
  });

  const paperQcSummary = await getPaperQcStateSummary({ projectRoot });
  const figureQcSummary = await getFigureQcStateSummary({ projectRoot });
  const citationCollectionSummary = await getCitationCollectionStateSummary({
    projectRoot,
  });
  const reviewIssueTrackerSummary = await getReviewIssueTrackerStateSummary({
    projectRoot,
  });
  const experimentSearchSummary = await getExperimentSearchStateSummary({
    projectRoot,
  });

  assert.equal(paperQcSummary.state.compileStatus, "pass");
  assert.equal(paperQcSummary.latestReportExists, true);
  assert.equal(figureQcSummary.figureReviewExists, true);
  assert.equal(citationCollectionSummary.cacheBibExists, true);
  assert.equal(reviewIssueTrackerSummary.state.openCounts.high, 1);
  assert.equal(reviewIssueTrackerSummary.issueManifestExists, true);
  assert.equal(experimentSearchSummary.state.bestNodeId, "node-best");
  assert.equal(experimentSearchSummary.stateFileExists, true);
  assert.equal(experimentSearchSummary.readyForAnalysis, true);
});

test("ordinary paper line write-stage auto iterator blocks forward progression until writing session and graph coverage are ready", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForWrite(projectRoot);

  const blocked = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "test-write-gate",
    queueMailbox: false,
  });

  assert.equal(blocked.stageAfter, "write");
  assert.deepEqual(blocked.missingStageSignals, []);
  assert.ok(
    blocked.recommendedActions.some((action) =>
      action.command?.includes("/paper-phase")
    )
  );

  await setWritingSessionState({
    projectRoot,
    writingSession: {
      status: "ready_for_submit",
      current_section: "conclusion",
      draft_order: ["method", "experimental_setup", "results", "related_work", "introduction", "abstract", "conclusion"],
      finalized_sections: ["method", "results"],
      compile_safe_sections: ["method", "results"],
      section_packets: {
        method: {
          section: "method",
          goal: "Explain the final method.",
          allowed_claims: ["claim-method-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#method-anchor"],
          forbidden_unsupported_claims: [],
          missing_citation_placeholders: [],
          packet_path: "academic_writer/section-packets/method.json",
          draft_path: "academic_writer/paper/sections/method.tex",
          review_path: "cross-reviewer/prose/method-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
        results: {
          section: "results",
          goal: "Ground the results in saved evidence.",
          allowed_claims: ["claim-results-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#results-anchor"],
          forbidden_unsupported_claims: [],
          missing_citation_placeholders: [],
          packet_path: "academic_writer/section-packets/results.json",
          draft_path: "academic_writer/paper/sections/results.tex",
          review_path: "cross-reviewer/prose/results-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
      },
      headline_claim_evidence_status: "covered",
      graph_evidence_coverage_status: "covered",
      graph_evidence_coverage_summary:
        "All headline claims now have graph or experiment evidence pointers.",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
      future_scholar_verification_skill: "future/literature-dehallucination",
    },
  });

  await setGraphGuidedWritingState({
    projectRoot,
    graphGuidedWriting: {
      enabled: true,
      status: "ready",
      anchor_index_path: "graph/ANCHOR_INDEX.md",
      frontier_files: ["graph/LIMITATION_FRONTIER.md"],
      literature_path: "researcher/LITERATURE.md",
      claim_evidence_packet_paths: [
        "analyzer/CLAIM_EVIDENCE_MATRIX.md",
        "academic_writer/KG_STORYLINE_PACKET.md",
      ],
      required_evidence_pointer_count: 2,
      covered_headline_claim_count: 2,
      total_headline_claim_count: 2,
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
      citation_source_mode: "graph_only",
      scholar_query_reserved: true,
      scholar_query_skill_slot: "future/literature-dehallucination",
    },
  });

  const ready = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "test-write-gate",
    queueMailbox: false,
  });

  assert.equal(ready.stageAfter, "submit");
  assert.ok(
    !ready.missingStageSignals.some((signal) =>
      signal.includes("writing_session")
    )
  );
  assert.ok(
    !ready.missingStageSignals.some((signal) =>
      signal.includes("graph_guided_writing")
    )
  );
});

test("ordinary paper line write-stage gate blocks only on hard review/QC failures, not merely pending late-stage QC work", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForWrite(projectRoot);

  await setWritingSessionState({
    projectRoot,
    writingSession: {
      status: "ready_for_submit",
      current_section: "results",
      draft_order: ["method", "results"],
      finalized_sections: ["method", "results"],
      compile_safe_sections: ["method", "results"],
      section_packets: {
        method: {
          section: "method",
          goal: "Explain the final method.",
          allowed_claims: ["claim-method-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#method-anchor"],
          forbidden_unsupported_claims: [],
          missing_citation_placeholders: [],
          packet_path: "academic_writer/section-packets/method.json",
          draft_path: "academic_writer/paper/sections/method.tex",
          review_path: "cross-reviewer/prose/method-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
        results: {
          section: "results",
          goal: "Ground the results in saved evidence.",
          allowed_claims: ["claim-results-1"],
          required_graph_evidence_pointers: ["graph/ANCHOR_INDEX.md#results-anchor"],
          forbidden_unsupported_claims: [],
          missing_citation_placeholders: [],
          packet_path: "academic_writer/section-packets/results.json",
          draft_path: "academic_writer/paper/sections/results.tex",
          review_path: "cross-reviewer/prose/results-2026-03-26.md",
          review_verdict: "publication_ready",
          status: "finalized",
        },
      },
      headline_claim_evidence_status: "covered",
      graph_evidence_coverage_status: "covered",
    },
  });
  await setGraphGuidedWritingState({
    projectRoot,
    graphGuidedWriting: {
      enabled: true,
      status: "ready",
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
      covered_headline_claim_count: 2,
      total_headline_claim_count: 2,
    },
  });
  await setPaperQcState({
    projectRoot,
    paperQc: {
      status: "running",
      compile_status: "pass",
      chktex_status: "pending",
      page_budget_status: "pending",
    },
  });
  await setFigureQcState({
    projectRoot,
    figureQc: {
      status: "running",
      caption_alignment_status: "pending",
      text_alignment_status: "pending",
      selection_status: "pending",
    },
  });
  await setCitationCollectionState({
    projectRoot,
    citationCollection: {
      status: "running",
      candidate_count: 10,
      verified_count: 4,
      suspicious_count: 0,
      hallucinated_count: 0,
    },
  });
  await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      status: "open",
      open_counts: {
        critical: 0,
        high: 1,
        medium: 2,
        low: 0,
      },
      issues: [
        {
          issue_id: "surface-high-1",
          lane: "surface",
          severity: "high",
          status: "open",
        },
        {
          issue_id: "surface-medium-1",
          lane: "surface",
          severity: "medium",
          status: "open",
        },
      ],
      last_review_round: 2,
      pending_reason: "One high-severity surface issue remains.",
    },
  });

  const blocked = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "test-write-hard-fail",
    queueMailbox: false,
  });

  assert.equal(blocked.stageAfter, "write");
  assert.ok(
    blocked.recommendedActions.some((action) =>
      action.command?.includes("/paper-phase")
    )
  );

  await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      status: "waived",
      open_counts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 1,
      },
      issues: [
        {
          issue_id: "surface-medium-1",
          lane: "surface",
          severity: "medium",
          status: "waived",
          waiver_reason: "Aggressive auto mode accepted the remaining wording issue.",
        },
      ],
      last_review_round: 3,
      pending_reason: "Only waived medium or low-severity issues remain.",
    },
  });

  const ready = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "test-write-hard-fail",
    queueMailbox: false,
  });

  assert.equal(ready.stageAfter, "submit");
  assert.ok(
    !ready.missingStageSignals.some((signal) =>
      signal.includes("paper_qc.status = ready")
    )
  );
});
