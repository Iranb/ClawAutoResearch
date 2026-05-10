import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setChannelProjectBinding } from "../../../tools/channel-project-bindings.ts";
import {
  loadWorkflowProjectState,
} from "../../../tools/workflow-guard-project/project-context.ts";
import {
  buildWorkflowSnapshotFromProjectState,
} from "../../../tools/workflow-guard-project/snapshot-builder.ts";
import { materializeWorkflowTaskGraph } from "../../../tools/workflow-team/task-graph.ts";
import { materializeWorkflowTeamRound } from "../../../tools/workflow-team/team-round.ts";
import { materializeRevisionControlState } from "../../../tools/research-writing/revision-control.ts";

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-snapshot-builder-"));
}

async function makeProject(workspaceRoot, projectId = "demo-project") {
  const projectRoot = path.join(workspaceRoot, "projects", projectId);
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "plan",
        owner_agent: "researcher",
        research_program: {
          status: "ready",
          goal: "Model a workflow guard split",
          problem_statement: "The facade is too large.",
          baseline_reference: "workflow-guard.ts",
          primary_metric: "module_count",
          datasets: ["repo"],
          success_criteria: ["split the module"],
          zotero_project_path: "bot/demo-project",
        },
        writing_contract: {
          template_required: false,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeTrackRegistry(projectRoot, tracks) {
  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify({ tracks }, null, 2)}\n`,
    "utf8"
  );
}

async function writeMailbox(projectRoot, messages) {
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        messages,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeAutoIteratorAudit(projectRoot, audit) {
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
    "utf8"
  );
}

test("snapshot builder preserves project context and emits derived fields", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-split");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-split",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return ["PROJECT_MANIFEST.json.current_stage"];
      },
    }
  );

  assert.equal(snapshot.projectRoot, projectRoot);
  assert.equal(snapshot.projectId, "workflow-guard-split");
  assert.equal(snapshot.projectResolutionSource, "channel_binding");
  assert.equal(snapshot.channelProjectBindingKey, "local:group:paper-lab");
  assert.equal(snapshot.channelProjectBindingWorkflowSessionKey, sessionKey);
  assert.equal(snapshot.currentStage, "plan");
  assert.equal(snapshot.recommendedOwner, "orchestrator");
  assert.deepEqual(snapshot.missingStageSignals, ["PROJECT_MANIFEST.json.current_stage"]);
  assert.equal(snapshot.researchProgramOnboardingStatus, "ready");
  assert.ok(snapshot.allowedWriteScopes.includes("{PROJ}/PROJECT_MANIFEST.json"));
  assert.ok(snapshot.backgroundTasks.some((task) => task.includes("Continue literature survey")));
});

test("snapshot builder surfaces revision control, auto diagnostics, and survey visual compiler summaries", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-revision-snapshot");
  const sessionKey = "agent:academic_writer:local:group:revision-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.owner_agent = "academic_writer";
  manifest.review_session = {
    status: "completed",
    round: 2,
    verdict: "revise",
    reviewer_summary: "Review still requests bounded fixes.",
    review_packet_path: "reviewer/REVIEW_PACKET.json",
    latest_review_path: "reviewer/REVIEW_REPORT.md",
    blocking_artifacts: ["academic_writer/paper/main.tex"],
  };
  manifest.review_issue_tracker = {
    status: "open",
    issues: [
      {
        issue_id: "issue-1",
        severity: "high",
        title: "Revise the main manuscript",
        target_artifact: "academic_writer/paper/main.tex",
        fix_artifact_paths: ["academic_writer/paper/sections/results.tex"],
        opened_by: "reviewer",
        status: "open",
      },
    ],
    last_review_round: 2,
  };
  manifest.revision_control_state = {
    status: "active",
    revision_round: 2,
    current_owner: "academic_writer",
    next_reviewer_role: "reviewer",
    active_revision_packet_path: "reviewer/REVISION_CONTROL_PACKET.json",
    open_sources: [
      {
        source_type: "review_session",
        source_id: "review-round-2",
        severity: "medium",
        status: "open",
      },
    ],
    pending_reason: "Review still requests bounded fixes.",
  };
  manifest.auto_dispatch_diagnostics = {
    status: "waiting",
    blocking_layer: "signals",
    blocking_reason: "missing_storyline",
    next_repair_action: "Regenerate the storyline bundle.",
  };
  manifest.paragraph_logic_audit = {
    status: "blocked",
    audit_report_path: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
    reverse_outline_path: "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
    blocking_issue_count: 3,
    weakest_sections: ["introduction", "discussion"],
    next_repair_action: "Rewrite the introduction handoff before the next review pass.",
  };
  manifest.execution_proof = {
    status: "blocked",
    path: "researcher/EXECUTION_PROOF.json",
    receipt_count: 1,
    lineage_matched_receipt_count: 0,
    candidate_commit: "cand-789",
    expected_stage_run_id: "stage-run-exp-7",
    primary_receipt_experiment_id: "exp-7",
    primary_receipt_run_id: "run-exp-7",
    primary_receipt_stage_run_id: "stage-run-exp-6",
    primary_receipt_git_commit: "old-commit",
    primary_receipt_path: "coder/experiments/track-main/exp-7__coverage/REMOTE_RUN.json",
    pending_reason: "Execution receipts exist, but their commit lineage or stage_run_id does not match the current candidate/search state.",
  };
  manifest.survey_visual_compiler_state = {
    status: "ready",
    row_count: 6,
    insertion_map_path: "academic_writer/SURVEY_VISUAL_INSERTION_MAP.json",
  };
  manifest.survey_methodology_consistency = {
    status: "blocked",
    path: "researcher/SURVEY_METHODOLOGY_CONSISTENCY.json",
    blocking_issues: ["Survey counts disagree."],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.mkdir(path.join(projectRoot, "reviewer"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updated_at: new Date().toISOString(),
        hook_points: {},
        hooks: {},
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-queue.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: "workflow-revision-snapshot",
        projectRoot,
        entries: [
          {
            queueId: "queue-1",
            queueKey: "background-run:survey-review",
            source: "start_background_run",
            entryType: "background_run",
            ownerAgent: "researcher",
            channelKey: "local:channel:paper-lab",
            requesterSessionKey: "agent:researcher:local:channel:paper-lab",
            family: "research",
            kind: "survey_review",
            projectId: "workflow-revision-snapshot",
            projectRoot,
            queuedAt: "2026-04-20T01:48:57.511Z",
            attemptCount: 1,
            summary:
              "Queued background workflow for survey-generalized-category-discovery-v3.",
            status: "degraded",
            lastError:
              "Plugin runtime subagent methods are only available during a gateway request.",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH_GIT_REVIEW_STATE.json"),
    `${JSON.stringify(
      {
        status: "ready",
        promotion_basis_signals: ["primary_metric_win", "promotion_rule_satisfied"],
        promotion_evidence_summary:
          "Primary metric beat the incumbent under the approved promotion rule.",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.mkdir(
    path.join(projectRoot, ".openclaw-research", "panel-discussions"),
    { recursive: true }
  );
  await fs.writeFile(
    path.join(
      projectRoot,
      ".openclaw-research",
      "panel-discussions",
      "survey-brief-refinement.json"
    ),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-20T08:44:13.731Z",
        roundsStartedByFingerprint: {
          "survey-brief-fingerprint": 1,
        },
        currentRound: {
          discussionId: "survey-brief-refinement",
          topic: "Refine the survey brief for the current topic",
          stage: "survey_review",
          roundId: "survey-brief-round-1",
          packetPath:
            "reviewer/panel-discussions/survey-brief-refinement/PANEL_DISCUSSION_PACKET.md",
          packetJsonPath:
            "reviewer/panel-discussions/survey-brief-refinement/PANEL_DISCUSSION_PACKET.json",
          packetFingerprint: "survey-brief-fingerprint",
          status: "reviewing",
          participants: ["researcher", "analyzer", "planner", "reviewer"],
          maxRounds: 2,
          launchedAt: "2026-04-20T08:44:13.731Z",
          updatedAt: "2026-04-20T08:44:13.731Z",
          attempts: [],
          aggregate: {
            status: "needs_changes",
            quorum: 2,
            reviewCount: 1,
            averageConfidence: 8.1,
            decisionCounts: { needs_changes: 1 },
            recommendedOwner: "researcher",
            actionItems: ["stabilize taxonomy labels"],
            blockers: [],
            summary: "One refinement pass is still needed.",
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await materializeRevisionControlState({
    projectRoot,
    stage: "write",
  });
  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "academic_writer",
    },
    projectRoot,
    projectId: "workflow-revision-snapshot",
    messageChannel: "local",
    boundByAgent: "academic_writer",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "academic_writer",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "academic_writer",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.revisionControlStatus, "active");
  assert.equal(snapshot.revisionControlOpenSourceCount, 3);
  assert.equal(snapshot.paragraphLogicAuditStatus, "blocked");
  assert.equal(snapshot.paragraphLogicAuditBlockingIssueCount, 3);
  assert.equal(snapshot.paragraphLogicAuditSectionTransitionIssueCount, 0);
  assert.equal(snapshot.executionProofStatus, "blocked");
  assert.equal(snapshot.executionProofReceiptCount, 1);
  assert.equal(snapshot.executionProofLineageMatchedReceiptCount, 0);
  assert.equal(snapshot.executionProofCandidateCommit, "cand-789");
  assert.equal(snapshot.executionProofExpectedStageRunId, "stage-run-exp-7");
  assert.equal(snapshot.executionProofPrimaryReceiptExperimentId, "exp-7");
  assert.equal(snapshot.executionProofPrimaryReceiptRunId, "run-exp-7");
  assert.equal(snapshot.executionProofPrimaryReceiptStageRunId, "stage-run-exp-6");
  assert.equal(snapshot.executionProofPrimaryReceiptGitCommit, "old-commit");
  assert.equal(
    snapshot.executionProofPrimaryReceiptPath,
    "coder/experiments/track-main/exp-7__coverage/REMOTE_RUN.json"
  );
  assert.deepEqual(snapshot.experimentSearchPromotionBasisSignals, [
    "primary_metric_win",
    "promotion_rule_satisfied",
  ]);
  assert.equal(
    snapshot.experimentSearchPromotionEvidenceSummary,
    "Primary metric beat the incumbent under the approved promotion rule."
  );
  assert.equal(snapshot.surveyBriefRefinementStatus, "reviewing");
  assert.equal(snapshot.surveyBriefRefinementReviewCount, 1);
  assert.equal(snapshot.surveyBriefRefinementRoundId, "survey-brief-round-1");
  assert.equal(
    snapshot.surveyBriefRefinementPacketPath,
    "reviewer/panel-discussions/survey-brief-refinement/PANEL_DISCUSSION_PACKET.md"
  );
  assert.equal(
    snapshot.surveyBriefRefinementSummary,
    "One refinement pass is still needed."
  );
  assert.equal(snapshot.backgroundQueueEntryCount, 1);
  assert.equal(snapshot.backgroundQueueDegradedCount, 1);
  assert.equal(snapshot.backgroundQueueTopKind, "survey_review");
  assert.equal(snapshot.backgroundQueueTopStatus, "degraded");
  assert.equal(
    snapshot.backgroundQueueTopSummary,
    "Queued background workflow for survey-generalized-category-discovery-v3."
  );
  assert.equal(
    snapshot.backgroundQueueTopError,
    "Plugin runtime subagent methods are only available during a gateway request."
  );
  assert.equal(snapshot.autoDispatchDiagnosticsStatus, "waiting");
  assert.equal(snapshot.autoDispatchBlockingLayer, "signals");
  assert.equal(snapshot.autoGateReviewToWriteMode, "panel_gate");
  assert.equal(snapshot.autoGateWriteToSubmitMode, "panel_gate");
  assert.equal(snapshot.autoGateSubmitToDoneMode, "manual_gate");
  assert.equal(snapshot.surveyVisualCompilerStatus, "ready");
  assert.equal(snapshot.surveyMethodologyConsistencyStatus, "blocked");
});

test("snapshot builder surfaces evidence contract summaries from manifest state", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-evidence-contracts");
  const sessionKey = "agent:researcher:local:group:evidence-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "ready_for_analysis";
  manifest.benchmark_protocol = {
    status: "ready",
    benchmark_family: "OpenWorldGraphBench",
    primary_metric: "H-score",
    split_descriptor: "baseline-a validation split",
    evaluation_harness: "open-world-hscore-v1",
    protocol_lock_path: "researcher/BENCHMARK_PROTOCOL.json",
    fairness_report_path: "researcher/BASELINE_FAIRNESS_REPORT.json",
    locked: true,
    drift_status: "pass",
    fair_compare_status: "pass",
    fair_compare_summary:
      "Main compare keeps the same backbone, split, and evaluation harness.",
    allowed_deviation_count: 0,
    allowed_deviation_status: "none",
  };
  manifest.statistical_evidence = {
    status: "ready",
    aggregate_path: "analyzer/STATISTICAL_EVIDENCE.json",
    claim_strength_status: "strong",
    significant_result_count: 3,
    insufficient_seed_count: 1,
  };
  manifest.venue_competition = {
    status: "partial",
    target_venues: ["ICLR", "NeurIPS"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "ready",
  };
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
    graph_context_status: "ready",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "workflow-evidence-contracts",
    stage: "experiment",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: false,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "experiment.lock_benchmark_protocol",
        title: "Lock the benchmark protocol",
        owner: "orchestrator",
        status: "blocked",
        reason: "Benchmark/statistical/ablation evidence is still incomplete.",
      },
    ],
  });
  await materializeWorkflowTeamRound({
    projectRoot,
    projectId: "workflow-evidence-contracts",
    stage: "experiment",
    leadRole: "researcher",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseoutStatus: "blocked",
    taskGraphPath: path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
    taskCount: 1,
    claimableCount: 1,
    blockedCount: 0,
    claimedCount: 0,
    verifyingCount: 0,
    needsRepairCount: 0,
    satisfiedCount: 0,
    optionalCount: 0,
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-evidence-contracts",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.benchmarkProtocolStatus, "ready");
  assert.equal(snapshot.benchmarkProtocolFamily, "OpenWorldGraphBench");
  assert.equal(snapshot.benchmarkProtocolLocked, true);
  assert.equal(snapshot.benchmarkProtocolDriftStatus, "pass");
  assert.equal(snapshot.benchmarkProtocolPrimaryMetric, "H-score");
  assert.equal(snapshot.benchmarkProtocolSplitDescriptor, "baseline-a validation split");
  assert.equal(snapshot.benchmarkProtocolEvaluationHarness, "open-world-hscore-v1");
  assert.equal(snapshot.benchmarkProtocolFairCompareStatus, "pass");
  assert.equal(snapshot.benchmarkProtocolFairCompareSummary, "Main compare keeps the same backbone, split, and evaluation harness.");
  assert.equal(snapshot.benchmarkProtocolAllowedDeviationCount, 0);
  assert.equal(snapshot.benchmarkProtocolAllowedDeviationStatus, "none");
  assert.equal(
    snapshot.benchmarkProtocolFairnessReportPath,
    "researcher/BASELINE_FAIRNESS_REPORT.json"
  );
  assert.equal(snapshot.statisticalEvidenceStatus, "ready");
  assert.equal(snapshot.statisticalEvidenceClaimStrengthStatus, "strong");
  assert.equal(snapshot.statisticalEvidenceSignificantResultCount, 3);
  assert.equal(snapshot.statisticalEvidenceInsufficientSeedCount, 1);
  assert.equal(snapshot.venueCompetitionStatus, "partial");
  assert.deepEqual(snapshot.venueCompetitionTargetVenues, ["ICLR", "NeurIPS"]);
  assert.equal(snapshot.venueCompetitionAcceptanceRiskStatus, "moderate");
  assert.equal(snapshot.venueCompetitionGraphContextStatus, "ready");
  assert.equal(snapshot.opportunityScorecardStatus, "ready");
  assert.equal(snapshot.opportunityScorecardVerdict, "worth_top_tier_bet");
  assert.equal(snapshot.opportunityScorecardGraphContextStatus, "ready");
  assert.equal(snapshot.evidenceCloseoutStatus, "blocked");
  assert.equal(snapshot.evidenceCloseoutTopTierVerdict, "worth_top_tier_bet");
  assert.equal(snapshot.evidenceCloseoutExperimentAnalyzeReady, false);
  assert.equal(snapshot.evidenceCloseoutAnalyzeReviewReady, false);
  assert.equal(snapshot.evidenceCloseoutWriteReady, false);
  assert.equal(snapshot.evidenceCloseoutSubmitReady, false);
  assert.equal(snapshot.evidenceCloseoutGraphDependentBlockerCount, 0);
  assert.ok((snapshot.evidenceCloseoutTopBlockers ?? []).length >= 1);
  assert.ok(Array.isArray(snapshot.teamTaskPreview));
  assert.ok(
    snapshot.teamTaskPreview.some((task) =>
      task.taskId === "experiment.lock_benchmark_protocol"
    )
  );
  assert.equal(snapshot.teamTaskGraphTaskCount, 1);
  assert.equal(snapshot.teamTaskGraphClaimableCount, 1);
  assert.equal(snapshot.teamTaskGraphClaimedCount, 0);
  assert.equal(snapshot.teamTaskGraphSatisfiedCount, 0);
  assert.equal(snapshot.teamRoundStatus, "blocked");
  assert.equal(snapshot.teamRoundLeadRole, "researcher");
  assert.equal(snapshot.teamRoundActiveSessionCount, 0);
});

test("snapshot builder suppresses stale waiting blockers once missing stage signals are cleared", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-blocker");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track fd-gcd-freq-debiased missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-blocker",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.deepEqual(snapshot.missingStageSignals, []);
  assert.equal(snapshot.blockingReason, null);
});

test("snapshot builder marks stale auto-iterator audits without regressing live ready evidence state", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-audit");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
      ],
    },
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeAutoIteratorAudit(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-04-09T08:59:36.572Z",
    result: {
      projectRoot,
      projectId: "workflow-guard-stale-audit",
      stageBefore: "idea",
      stageAfter: "idea",
      ownerAfter: "researcher",
      blockingReason:
        "active track track-main missing graph-backed innovation evidence",
      missingStageSignals: [
        "active track track-main missing graph-backed innovation evidence",
      ],
    },
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-audit",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "ready");
  assert.equal(snapshot.blockingReason, null);
  assert.equal(snapshot.autoIteratorAuditStatus, "completed");
  assert.equal(snapshot.autoIteratorAuditFreshness, "stale");
  assert.equal(snapshot.autoIteratorAuditMatchesLiveState, false);
  assert.match(snapshot.autoIteratorAuditSummary ?? "", /stale auto-iterator audit/i);
});

test("snapshot builder downgrades orphan started auto-iterator audits to timed_out", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-started-audit");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeAutoIteratorAudit(projectRoot, {
    schemaVersion: 2,
    runId: "started-audit",
    status: "started",
    startedAt: "2026-04-09T08:59:36.572Z",
    updatedAt: "2026-04-09T08:59:36.572Z",
    summary: "Auto iterator started for default mode.",
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-started-audit",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.autoIteratorAuditStatus, "timed_out");
  assert.equal(snapshot.autoIteratorAuditFreshness, "stale");
  assert.match(snapshot.autoIteratorAuditSummary ?? "", /timed out/i);
});

test("snapshot builder filters stale auto-iterator mailbox handoffs whose blocker no longer matches", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-mailbox");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeMailbox(projectRoot, [
    {
      id: "stale-auto-iterator",
      fromAgent: "orchestrator",
      toAgent: "researcher",
      subject: "auto-iterator: idea owner handoff",
      body: [
        "Please resume idea stage.",
        "Next action: Run /idea-phase.",
        "Missing stage signals: active track fd-gcd-freq-debiased missing graph-backed innovation evidence; active track talon-gcd-bias missing graph-backed innovation evidence",
      ].join("\n"),
      kind: "handoff",
      priority: "high",
      status: "pending",
      createdAt: "2026-04-09T07:13:26.090Z",
    },
  ]);

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-mailbox",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.deepEqual(snapshot.missingStageSignals, []);
  assert.deepEqual(snapshot.unreadMailbox, []);
});

test("snapshot builder surfaces survey review state for projectless review workflows", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "survey-graph-reasoning");
  const sessionKey = "agent:researcher:local:group:survey-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "survey-graph-reasoning",
        current_stage: "survey_review",
        owner_agent: "researcher",
        survey_review: {
          status: "screening",
          current_phase: "screening",
          topic: "Graph reasoning survey",
          mode: "deep",
          candidate_paper_count: 80,
          included_paper_count: 24,
          excluded_paper_count: 31,
          graph_grounded_brief_ready: false,
          gate_ready: false,
          coverage_status: "partial",
          taxonomy_stability_status: "unstable",
          representative_methods_status: "partial",
          benchmark_alignment_status: "partial",
          topic_relevance_status: "needs_revision",
          gap_closure_status: "partial",
          gate_blocking_issues: [
            "Expand SOTA matrix coverage before write handoff.",
          ],
          diagnostics_path: "researcher/SURVEY_GATE_DIAGNOSTICS.json",
          survey_brief_path: "researcher/SURVEY_BRIEF.md",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "survey-graph-reasoning",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.currentStage, "survey_review");
  assert.equal(snapshot.surveyReviewStatus, "screening");
  assert.equal(snapshot.surveyReviewCurrentPhase, "screening");
  assert.equal(snapshot.surveyReviewTopic, "Graph reasoning survey");
  assert.equal(snapshot.surveyReviewMode, "deep");
  assert.equal(snapshot.surveyReviewCandidatePaperCount, 80);
  assert.equal(snapshot.surveyReviewIncludedPaperCount, 24);
  assert.equal(snapshot.surveyReviewExcludedPaperCount, 31);
  assert.equal(snapshot.surveyReviewGraphGroundedBriefReady, false);
  assert.equal(snapshot.surveyReviewGateReady, false);
  assert.equal(snapshot.surveyReviewCoverageStatus, "partial");
  assert.equal(snapshot.surveyReviewTaxonomyStabilityStatus, "unstable");
  assert.equal(snapshot.surveyReviewRepresentativeMethodsStatus, "partial");
  assert.equal(snapshot.surveyReviewBenchmarkAlignmentStatus, "partial");
  assert.equal(snapshot.surveyReviewTopicRelevanceStatus, "needs_revision");
  assert.equal(snapshot.surveyReviewGapClosureStatus, "partial");
  assert.equal(snapshot.surveyReviewGateBlockingIssueCount, 1);
  assert.equal(
    snapshot.surveyReviewDiagnosticsPath,
    "researcher/SURVEY_GATE_DIAGNOSTICS.json"
  );
  assert.equal(snapshot.surveyReviewSurveyBriefPath, "researcher/SURVEY_BRIEF.md");
});

test("snapshot builder classifies file-backed track evidence as repairable and distinguishes it from missing evidence", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-file-backed-evidence");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      reasoning_packet_dir: "researcher/reasoning/track-main",
    },
  ]);
  await fs.mkdir(path.join(projectRoot, "researcher", "reasoning", "track-main"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
    `${JSON.stringify(
      {
        graph_innovation_evidence: {
          evidence_pointers: [
            "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
          ],
          linked_graph_nodes: ["paper:router"],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-file-backed-evidence",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "repairable");
  assert.match(
    snapshot.workflowEvidenceSummary,
    /file-backed GRAPH_EVIDENCE\.json pending canonicalization/i
  );
  assert.notEqual(snapshot.blockingReason, null);
  assert.doesNotMatch(snapshot.blockingReason, /waiting for researcher to satisfy/i);
});

test("snapshot builder clears stale blocker text when derived evidence readiness is satisfied", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-ready-evidence");
  const sessionKey = "agent:researcher:local:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      reasoning_packet_dir: "researcher/reasoning/track-main",
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
      ],
    },
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "local",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-ready-evidence",
    messageChannel: "local",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "ready");
  assert.match(snapshot.workflowEvidenceSummary, /inline graph evidence present/i);
  assert.equal(snapshot.blockingReason, null);
});
