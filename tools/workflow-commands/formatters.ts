/**
 * Formatters for workflow status output.
 */

import {
  getGateReviewStorePath,
} from "../workflow-auto-gate.js";
import {
  getCodeReviewStorePath,
} from "../workflow-code-review.js";
import {
  getAutoModeDiscussionStorePath,
} from "../workflow-auto-discussion.js";
import type {
  WorkflowSnapshot,
  WorkflowAutoIteratorResult,
  WorkflowGateReviewStore,
  WorkflowCodeReviewStore,
  WorkflowAutoDiscussionStore,
} from "./types.js";

export function compactStatusText(
  value: string | null | undefined,
  maxLength = 240
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "none";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function joinStatusList(values: string[]): string {
  return values.length > 0 ? values.join("; ") : "none";
}

function formatDerivedEvidenceLine(snapshot: WorkflowSnapshot): string | null {
  const status =
    typeof (snapshot as Record<string, unknown>).workflowEvidenceStatus === "string" &&
    String((snapshot as Record<string, unknown>).workflowEvidenceStatus).trim()
      ? String((snapshot as Record<string, unknown>).workflowEvidenceStatus).trim()
      : null;
  const summary =
    typeof (snapshot as Record<string, unknown>).workflowEvidenceSummary === "string" &&
    String((snapshot as Record<string, unknown>).workflowEvidenceSummary).trim()
      ? String((snapshot as Record<string, unknown>).workflowEvidenceSummary).trim()
      : null;
  if (!status && !summary) {
    return null;
  }
  return `Derived evidence: ${status ?? "unknown"}${summary ? ` - ${summary}` : ""}`;
}

function formatRuntimeAuditLine(snapshot: WorkflowSnapshot): string | null {
  const freshness =
    typeof (snapshot as Record<string, unknown>).autoIteratorAuditFreshness === "string" &&
    String((snapshot as Record<string, unknown>).autoIteratorAuditFreshness).trim()
      ? String((snapshot as Record<string, unknown>).autoIteratorAuditFreshness).trim()
      : null;
  const status =
    typeof (snapshot as Record<string, unknown>).autoIteratorAuditStatus === "string" &&
    String((snapshot as Record<string, unknown>).autoIteratorAuditStatus).trim()
      ? String((snapshot as Record<string, unknown>).autoIteratorAuditStatus).trim()
      : null;
  const summary =
    typeof (snapshot as Record<string, unknown>).autoIteratorAuditSummary === "string" &&
    String((snapshot as Record<string, unknown>).autoIteratorAuditSummary).trim()
      ? String((snapshot as Record<string, unknown>).autoIteratorAuditSummary).trim()
      : null;
  const updatedAt =
    typeof (snapshot as Record<string, unknown>).autoIteratorAuditUpdatedAt === "string" &&
    String((snapshot as Record<string, unknown>).autoIteratorAuditUpdatedAt).trim()
      ? String((snapshot as Record<string, unknown>).autoIteratorAuditUpdatedAt).trim()
      : null;
  if (!freshness && !status && !summary && !updatedAt) {
    return null;
  }
  return `Runtime audit: ${freshness ?? "unknown"}${status ? `/${status}` : ""}${updatedAt ? `, updated=${updatedAt}` : ""}${summary ? ` - ${summary}` : ""}`;
}

export function formatAutoModeSection(params: {
  autoIteratorResult: WorkflowAutoIteratorResult | null;
}): string[] {
  const result = params.autoIteratorResult;
  if (!result) {
    return ["Auto mode: unavailable (no active project root resolved)."];
  }
  const totalMitigationRounds =
    result.autoModeMitigationRoundsStarted + result.autoModeMitigationRoundsRemaining;
  const lines = [
    `Auto mode: configured=${result.configuredAutoMode}, effective=${result.effectiveAutoMode}, risk=${result.autoModeRiskLevel}`,
    `Auto mitigation: status=${result.autoModeMitigationStatus ?? "none"}, rounds=${result.autoModeMitigationRoundsStarted}/${totalMitigationRounds}, remaining=${result.autoModeMitigationRoundsRemaining}, fingerprint=${result.autoModeRiskFingerprint ?? "none"}`,
  ];
  if (result.autoModeReasons.length > 0) {
    lines.push("Auto mode reasons:");
    for (const reason of result.autoModeReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return lines;
}

export function formatAutoDiscussionSection(params: {
  projectRoot: string | null;
  discussionStore: WorkflowAutoDiscussionStore | null;
}): string[] {
  if (!params.projectRoot || !params.discussionStore?.currentRound) {
    return ["Auto discussion: no persisted discussion round for the current project."];
  }
  const round = params.discussionStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto discussion: status=${round.status}, stage=${round.stage ?? "unknown"}, risk=${round.riskLevel}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto discussion store: ${getAutoModeDiscussionStorePath(params.projectRoot)}`,
    `Auto discussion packet: ${round.packetPath}`,
    `Auto discussion summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
    `Auto discussion recommended owner: ${aggregate?.recommendedOwner ?? "none"}`,
  ];
  if ((aggregate?.actionItems?.length ?? 0) > 0) {
    lines.push(`Auto discussion action items: ${joinStatusList(aggregate?.actionItems ?? [])}`);
  }
  if ((aggregate?.blockers?.length ?? 0) > 0) {
    lines.push(`Auto discussion blockers: ${joinStatusList(aggregate?.blockers ?? [])}`);
  }
  lines.push("Auto discussion content:");
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - ${attempt.reviewerRole}: status=${attempt.status}${
        result
          ? `, assessment=${result.riskAssessment}, confidence=${result.confidence.toFixed(1)}`
          : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.actionItems?.length ?? 0) > 0) {
      lines.push(`    action items: ${joinStatusList(result?.actionItems ?? [])}`);
    }
    if ((result?.blockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.blockers ?? [])}`);
    }
    if (result?.rawText) {
      lines.push(`    response: ${compactStatusText(result.rawText, 320)}`);
    }
  }
  return lines;
}

export function formatGateReviewSection(params: {
  projectRoot: string | null;
  gateReviewStore: WorkflowGateReviewStore | null;
}): string[] {
  if (!params.projectRoot || !params.gateReviewStore?.currentRound) {
    return ["Auto gate review: no persisted gate review round for the current project."];
  }
  const round = params.gateReviewStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto gate review: status=${round.status}, gate=${round.gateId}, stage=${round.stage ?? "unknown"}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto gate review store: ${getGateReviewStorePath(params.projectRoot)}`,
    `Auto gate review packet: ${round.packetPath}`,
    `Auto gate review summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
  ];
  if (aggregate) {
    lines.push(
      `Auto gate review scores: avg=${aggregate.averageScore?.toFixed(2) ?? "n/a"}, min=${aggregate.minScore?.toFixed(2) ?? "n/a"}, blockers=${aggregate.blockerCount}`
    );
  }
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - gate reviewer ${attempt.reviewerRole}: status=${attempt.status}${
        result ? `, verdict=${result.verdict}, score=${result.overallScore.toFixed(1)}` : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.majorIssues?.length ?? 0) > 0) {
      lines.push(`    major issues: ${joinStatusList(result?.majorIssues ?? [])}`);
    }
    if ((result?.criticalBlockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.criticalBlockers ?? [])}`);
    }
  }
  return lines;
}

export function formatCodeReviewSection(params: {
  projectRoot: string | null;
  codeReviewStore: WorkflowCodeReviewStore | null;
}): string[] {
  if (!params.projectRoot || !params.codeReviewStore?.currentRound) {
    return ["Auto code review: no persisted code review round for the current project."];
  }
  const round = params.codeReviewStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto code review: status=${round.status}, gate=${round.gateId}, stage=${round.stage ?? "unknown"}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto code review store: ${getCodeReviewStorePath(params.projectRoot)}`,
    `Auto code review packet: ${round.packetPath}`,
    `Auto code review summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
  ];
  if (aggregate) {
    lines.push(
      `Auto code review scores: avg=${aggregate.averageScore?.toFixed(2) ?? "n/a"}, min=${aggregate.minScore?.toFixed(2) ?? "n/a"}, blockers=${aggregate.blockerCount}`
    );
  }
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - code reviewer ${attempt.reviewerRole}: status=${attempt.status}${
        result ? `, verdict=${result.verdict}, score=${result.overallScore.toFixed(1)}` : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.majorIssues?.length ?? 0) > 0) {
      lines.push(`    major issues: ${joinStatusList(result?.majorIssues ?? [])}`);
    }
    if ((result?.criticalBlockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.criticalBlockers ?? [])}`);
    }
  }
  return lines;
}

export function formatWorkflowStatusText(params: {
  snapshot: WorkflowSnapshot;
  commandLabel: string;
  targetSessionKey: string;
  autoIteratorResult: WorkflowAutoIteratorResult | null;
  discussionStore: WorkflowAutoDiscussionStore | null;
  gateReviewStore: WorkflowGateReviewStore | null;
  codeReviewStore: WorkflowCodeReviewStore | null;
}): string {
  const { snapshot } = params;
  const unreadMailboxCount = Array.isArray(snapshot.unreadMailbox)
    ? snapshot.unreadMailbox.length
    : 0;
  const hasPaperIngestionSummary =
    Boolean(snapshot.paperIngestionRuntimeStatus) ||
    (snapshot.paperIngestionImportTaskCount ?? 0) > 0 ||
    (snapshot.paperIngestionCompletedPaperCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionTimedOutOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionFailedOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionBatchCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveBatchCount ?? 0) > 0 ||
    (snapshot.paperIngestionPendingBatchItemCount ?? 0) > 0 ||
    (snapshot.paperIngestionSyncedBatchItemCount ?? 0) > 0 ||
    (snapshot.paperIngestionFailedBatchItemCount ?? 0) > 0 ||
    snapshot.paperIngestionReconcileRequired ||
    snapshot.paperIngestionRepairRequired;
  const derivedEvidenceLine = formatDerivedEvidenceLine(snapshot);
  const runtimeAuditLine = formatRuntimeAuditLine(snapshot);
  const lines = [
    "Workflow Status",
    `Session: ${params.targetSessionKey}`,
    `Role: ${snapshot.role ?? "unknown"}`,
    `Project: ${snapshot.projectId ?? "unset"} (${snapshot.projectResolutionSource})`,
    `Stage: ${snapshot.currentStage ?? "unknown"} / ${snapshot.currentMicroStage ?? "unknown"}`,
    `Owner: ${snapshot.ownerAgent ?? "unset"}${snapshot.recommendedOwner ? `, expected=${snapshot.recommendedOwner}` : ""}`,
    `Next action: ${snapshot.nextAction ?? "none"}`,
    `Resume action: ${snapshot.resumeAction ?? params.commandLabel}`,
    `Blocking reason: ${snapshot.blockingReason ?? "none"}`,
    `State revision: ${snapshot.stateRevision ?? "unknown"}${snapshot.stateUpdatedAt ? `, updated=${snapshot.stateUpdatedAt}` : ""}`,
    ...(runtimeAuditLine ? [runtimeAuditLine] : []),
    ...(derivedEvidenceLine ? [derivedEvidenceLine] : []),
    `Mailbox: ${unreadMailboxCount} unread`,
    `Idle research: enabled=${snapshot.idleResearchEnabled ? "true" : "false"}, due=${snapshot.idleResearchDue ? "true" : "false"}, topic=${snapshot.idleResearchTopic ?? "unset"}`,
    `Graph refresh: ${snapshot.graphRefreshRequired ? `required (${snapshot.graphRefreshReason ?? "pending"})` : "not required"}`,
    ...(hasPaperIngestionSummary
      ? [
          `PaperNexus ingestion: status=${snapshot.paperIngestionRuntimeStatus ?? "unknown"}, import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0}, completed_papers=${snapshot.paperIngestionCompletedPaperCount ?? 0}, active_ops=${snapshot.paperIngestionActiveOperationCount ?? 0}, timed_out=${snapshot.paperIngestionTimedOutOperationCount ?? 0}, failed=${snapshot.paperIngestionFailedOperationCount ?? 0}, batches=${snapshot.paperIngestionBatchCount ?? 0}, active_batches=${snapshot.paperIngestionActiveBatchCount ?? 0}, batch_pending_items=${snapshot.paperIngestionPendingBatchItemCount ?? 0}, batch_synced_items=${snapshot.paperIngestionSyncedBatchItemCount ?? 0}, batch_failed_items=${snapshot.paperIngestionFailedBatchItemCount ?? 0}, queued_requests=${snapshot.paperIngestionQueuedRequestCount ?? 0}, running_requests=${snapshot.paperIngestionRunningRequestCount ?? 0}, reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`,
          ...(snapshot.paperIngestionRepairRequired
            ? [
                `PaperNexus repair: required=true, target_corpus=${snapshot.paperIngestionRepairTargetCorpus ?? "unset"}, reason=${snapshot.paperIngestionRepairReason ?? "pending"}`,
              ]
            : []),
          ...(snapshot.paperIngestionLastBatchManifestPath
            ? [
                `PaperNexus batch manifest: ${snapshot.paperIngestionLastBatchManifestPath}`,
            ]
          : []),
        ]
      : []),
    ...(snapshot.brainstormCycleStatus || snapshot.brainstormCycleProvider
      ? [
          `Brainstorm contract: provider=${snapshot.brainstormCycleProvider ?? "unset"}, provider_mode=${snapshot.brainstormCycleProviderMode ?? "unset"}, provider_status=${snapshot.brainstormCycleProviderStatus ?? "unset"}, contract_version=${snapshot.brainstormCycleContractVersion ?? "unset"}, bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`,
        ]
      : []),
    ...(snapshot.surveyReviewStatus && snapshot.surveyReviewStatus !== "missing"
      ? [
          `Survey review: status=${snapshot.surveyReviewStatus}, phase=${snapshot.surveyReviewCurrentPhase ?? "unset"}, topic=${snapshot.surveyReviewTopic ?? "unset"}, mode=${snapshot.surveyReviewMode ?? "unset"}, candidates=${snapshot.surveyReviewCandidatePaperCount ?? 0}, included=${snapshot.surveyReviewIncludedPaperCount ?? 0}, excluded=${snapshot.surveyReviewExcludedPaperCount ?? 0}, query_rounds=${snapshot.surveyReviewQueryRoundCount ?? 0}`,
          `Survey synthesis: graph_grounded_brief=${snapshot.surveyReviewGraphGroundedBriefReady ? "true" : "false"}, survey_brief=${snapshot.surveyReviewSurveyBriefPath ?? "unset"}, pending_reason=${snapshot.surveyReviewPendingReason ?? "none"}`,
        ]
      : []),
    ...(snapshot.ideationContractStatus
      ? [
          `Ideation contract: status=${snapshot.ideationContractStatus}, track=${snapshot.ideationContractSelectedTrackId ?? "unset"}, direction=${snapshot.ideationContractSelectedDirectionId ?? "unset"}, idea_tree=${snapshot.ideationContractIdeaTreePath ?? "unset"}, proposal=${snapshot.ideationContractResearchProposalPath ?? "unset"}, ranking=${snapshot.ideationContractRankingHistoryPath ?? "unset"}, scoreboard=${snapshot.ideationContractTournamentScoreboardPath ?? "unset"}, top3=${snapshot.ideationContractTop3SummaryPath ?? "unset"}, graph_packet=${snapshot.ideationContractGraphPacketPath ?? "unset"}`,
          `Ideation graph signals: bridge_evidence=${snapshot.ideationContractBridgeEvidenceTier ?? "unset"}, candidate_source_domains=${snapshot.ideationContractCandidateSourceDomainCount ?? 0}, selected_source_domains=${snapshot.ideationContractSelectedSourceDomainCount ?? 0}`,
        ]
      : []),
    ...(snapshot.ideaCatalystStatus
      ? [
          `IDEA-CATALYST: status=${snapshot.ideaCatalystStatus}, mode=${snapshot.ideaCatalystMode ?? "unset"}, micro_stage=${snapshot.ideaCatalystMicroStage ?? "unset"}, target_domain=${snapshot.ideaCatalystTargetDomain ?? "unset"}, source_domains=${snapshot.ideaCatalystSourceDomainCount ?? 0}, bridges=${snapshot.ideaCatalystBridgeCount ?? 0}, top_fragment=${snapshot.ideaCatalystTopFragmentId ?? "unset"}`,
          ...(snapshot.ideaCatalystRequisitionRequired
            ? [
                `IDEA-CATALYST requisition: required=true, cycle=${snapshot.ideaCatalystLastRequisitionCycle ?? "unset"}, retry_budget=${snapshot.ideaCatalystRequisitionRetryBudget ?? "unset"}, saturated=${snapshot.ideaCatalystRequisitionSaturated ? "true" : "false"}, reason=${snapshot.ideaCatalystPendingReason ?? "pending"}`,
              ]
            : []),
        ]
      : []),
    ...((snapshot.kgStorylineStatus || snapshot.kgStorylinePacketPath)
      ? [
          `KG storyline: required=${snapshot.kgStorylineRequired ? "true" : "false"}, status=${snapshot.kgStorylineStatus ?? "unset"}, packet=${snapshot.kgStorylinePacketPath ?? "unset"}`,
        ]
      : []),
    `Innovation reflection: status=${snapshot.innovationReflectionStatus ?? "unknown"}, due=${snapshot.innovationReflectionDue ? "true" : "false"}`,
    `Experiment sync: ${snapshot.experimentSyncRequired ? `required (${snapshot.experimentPapernexusSyncStatus ?? "pending"})` : "not required"}`,
  ];
  if (
    snapshot.currentStage === "experiment" ||
    (snapshot.experimentActiveRunCount ?? 0) > 0 ||
    (snapshot.experimentTerminalRunCount ?? 0) > 0 ||
    (snapshot.experimentFinishedUnreconciledCount ?? 0) > 0
  ) {
    lines.push(
      `Experiment monitor: active_runs=${snapshot.experimentActiveRunCount ?? 0}, terminal_runs=${snapshot.experimentTerminalRunCount ?? 0}, finished_unreconciled=${snapshot.experimentFinishedUnreconciledCount ?? 0}, needs_monitor_pass=${snapshot.experimentNeedsMonitorPass ? "true" : "false"}, next=${snapshot.experimentMonitorRecommendedCommand ?? "none"}`
    );
    if (
      snapshot.experimentGpuMonitorStatus &&
      snapshot.experimentGpuMonitorStatus !== "missing"
    ) {
      lines.push(
        `GPU monitor: status=${snapshot.experimentGpuMonitorStatus}, checked_at=${snapshot.experimentGpuMonitorCheckedAt ?? "never"}, servers=${snapshot.experimentGpuMonitorServerCount ?? 0}, busy_assigned=${snapshot.experimentGpuMonitorBusyAssignedGpuCount ?? 0}, idle_assigned=${snapshot.experimentGpuMonitorIdleAssignedGpuCount ?? 0}, likely_finished=${snapshot.experimentGpuMonitorLikelyFinishedRunCount ?? 0}, recommendation=${snapshot.experimentGpuMonitorRecommendation ?? "none"}`
      );
    }
  }
  if (snapshot.experimentSearchStatus && snapshot.experimentSearchStatus !== "missing") {
    lines.push(
      `Experiment search: status=${snapshot.experimentSearchStatus}, session=${snapshot.experimentSearchSessionId ?? "unset"}, main_stage=${snapshot.experimentSearchCurrentMainStage ?? "unset"}, substage=${snapshot.experimentSearchCurrentSubstage ?? "unset"}, best_node=${snapshot.experimentSearchBestNodeId ?? "unset"}, incumbent_exp=${snapshot.experimentSearchIncumbentExperimentId ?? "unset"}, incumbent_branch=${snapshot.experimentSearchIncumbentBranch ?? "unset"}, incumbent_commit=${snapshot.experimentSearchIncumbentCommit ?? "unset"}, multi_seed=${snapshot.experimentSearchMultiSeedStatus ?? "unset"}, plot_pack=${snapshot.experimentSearchPlotPackStatus ?? "unset"}`
    );
    lines.push(
      `Experiment search artifacts: spec=${snapshot.experimentSearchSpecPath ?? "unset"}, state=${snapshot.experimentSearchStatePath ?? "unset"}, graph_memory_packet=${snapshot.experimentSearchGraphMemoryPacketPath ?? snapshot.experimentMemoryGraphPacketPath ?? "unset"}, graph_sync=${snapshot.experimentSearchGraphMemorySyncStatus ?? "unset"}`
    );
    if (snapshot.experimentSearchRequestedGitOp || snapshot.experimentSearchGitOpStatus) {
      lines.push(
        `Experiment search git: requested_op=${snapshot.experimentSearchRequestedGitOp ?? "unset"}, status=${snapshot.experimentSearchGitOpStatus ?? "unset"}, review_store=${snapshot.experimentSearchGitReviewStorePath ?? "unset"}, packet=${snapshot.experimentSearchGitReviewPacketPath ?? "unset"}, worktree=${snapshot.experimentSearchCandidateWorktreePath ?? "unset"}, base_commit=${snapshot.experimentSearchCandidateBaseCommit ?? "unset"}, head_commit=${snapshot.experimentSearchCandidateHeadCommit ?? "unset"}, last_result=${snapshot.experimentSearchLastGitOpResult ?? "unset"}`
      );
    }
  }
  if (
    snapshot.experimentReviewMode === "reviewed_auto" ||
    (snapshot.experimentReviewStatus &&
      snapshot.experimentReviewStatus !== "missing")
  ) {
    lines.push(
      `Experiment review: mode=${snapshot.experimentReviewMode}, status=${snapshot.experimentReviewStatus ?? "missing"}, micro_stage=${snapshot.experimentReviewMicroStage ?? "unset"}, round=${snapshot.experimentReviewRound ?? 0}, planner=${snapshot.experimentReviewPlannerStatus ?? "unset"}, analyzer=${snapshot.experimentReviewAnalyzerStatus ?? "unset"}, cross=${snapshot.experimentReviewCrossReviewerStatus ?? "unset"}, synthesis=${snapshot.experimentReviewSynthesisStatus ?? "unset"}, launch=${snapshot.experimentReviewLaunchApproved ? "approved" : "pending"}, blockers=${snapshot.experimentReviewBlockerCount ?? 0}`
    );
    if (snapshot.experimentReviewPendingReason) {
      lines.push(`Experiment review pending reason: ${snapshot.experimentReviewPendingReason}`);
    }
    if (snapshot.experimentReviewPacketPath || snapshot.experimentReviewPlannerPlanPath) {
      lines.push(
        `Experiment review artifacts: packet=${snapshot.experimentReviewPacketPath ?? "unset"}, planner_plan=${snapshot.experimentReviewPlannerPlanPath ?? "unset"}, analyzer_report=${snapshot.experimentReviewAnalyzerReportPath ?? "unset"}, cross_report=${snapshot.experimentReviewCrossReviewerReportPath ?? "unset"}, decision=${snapshot.experimentReviewLaunchDecisionPath ?? "unset"}`
      );
    }
  }
  if (
    snapshot.researchProgramStatus ||
    (snapshot.researchProgramOnboardingMissing ?? []).length > 0
  ) {
    lines.push(
      `Research program: status=${snapshot.researchProgramStatus ?? "missing"}, onboarding=${snapshot.researchProgramOnboardingStatus ?? "unknown"}, goal=${snapshot.researchProgramPrimaryGoal ?? "unset"}, baseline=${snapshot.researchProgramBaselineReference ?? "unset"}, primary_metric=${snapshot.researchProgramPrimaryMetricName ?? "unset"}, datasets=${snapshot.researchProgramDatasetCount ?? 0}, success_criteria=${snapshot.researchProgramSuccessCriteriaCount ?? 0}, active_tracks=${snapshot.researchProgramActiveTrackCount ?? 0}/${snapshot.researchProgramTrackCount ?? 0}`
    );
    if (snapshot.researchProgramZoteroProjectPath) {
      lines.push(
        `Research program Zotero path: ${snapshot.researchProgramZoteroProjectPath}`
      );
    }
    if (
      snapshot.zoteroSyncStatus ||
      snapshot.zoteroSyncPendingAutoTrigger ||
      snapshot.researchProgramZoteroProjectPath
    ) {
      lines.push(
        `Zotero sync: status=${snapshot.zoteroSyncStatus ?? "missing"}, trigger=${snapshot.zoteroSyncTrigger ?? "unset"}, last_requested=${snapshot.zoteroSyncLastRequestedAt ?? "never"}, pending_auto=${snapshot.zoteroSyncPendingAutoTrigger ?? "none"}`
      );
      if (snapshot.zoteroSyncTriggerReason || snapshot.zoteroSyncPendingAutoReason) {
        lines.push(
          `Zotero sync detail: last_reason=${snapshot.zoteroSyncTriggerReason ?? "none"}, pending_reason=${snapshot.zoteroSyncPendingAutoReason ?? "none"}`
        );
      }
    }
    if ((snapshot.researchProgramOnboardingMissing ?? []).length > 0) {
      lines.push(
        `Research program checklist: missing=${snapshot.researchProgramOnboardingMissing.join(", ")}`
      );
    }
  }
  if (snapshot.benchmarkProtocolStatus && snapshot.benchmarkProtocolStatus !== "missing") {
    lines.push(
      `Benchmark protocol: status=${snapshot.benchmarkProtocolStatus}, family=${snapshot.benchmarkProtocolFamily ?? "unset"}, locked=${snapshot.benchmarkProtocolLocked ? "true" : "false"}, drift=${snapshot.benchmarkProtocolDriftStatus ?? "unset"}`
    );
  }
  if (snapshot.statisticalEvidenceStatus && snapshot.statisticalEvidenceStatus !== "missing") {
    lines.push(
      `Statistical evidence: status=${snapshot.statisticalEvidenceStatus}, claim_strength=${snapshot.statisticalEvidenceClaimStrengthStatus ?? "unset"}, significant=${snapshot.statisticalEvidenceSignificantResultCount ?? 0}, insufficient_seeds=${snapshot.statisticalEvidenceInsufficientSeedCount ?? 0}`
    );
  }
  if (snapshot.venueCompetitionStatus && snapshot.venueCompetitionStatus !== "missing") {
    lines.push(
      `Venue competition: status=${snapshot.venueCompetitionStatus}, venues=${(snapshot.venueCompetitionTargetVenues ?? []).join(",") || "none"}, risk=${snapshot.venueCompetitionAcceptanceRiskStatus ?? "unset"}, graph_context=${snapshot.venueCompetitionGraphContextStatus ?? "unset"}`
    );
  }
  if (snapshot.ablationEvidenceStatus && snapshot.ablationEvidenceStatus !== "missing") {
    lines.push(
      `Ablation evidence: status=${snapshot.ablationEvidenceStatus}, sufficiency=${snapshot.ablationEvidenceSufficiencyStatus ?? "unset"}, publication_critical=${snapshot.ablationEvidencePublicationCriticalCount ?? 0}`
    );
  }
  if (snapshot.mechanismEvidenceStatus && snapshot.mechanismEvidenceStatus !== "missing") {
    lines.push(
      `Mechanism evidence: status=${snapshot.mechanismEvidenceStatus}, tier=${snapshot.mechanismEvidenceTier ?? "unset"}, graph_context=${snapshot.mechanismEvidenceGraphContextStatus ?? "unset"}`
    );
  }
  if (snapshot.reproducibilityPackStatus && snapshot.reproducibilityPackStatus !== "missing") {
    lines.push(
      `Reproducibility pack: status=${snapshot.reproducibilityPackStatus}, environment=${snapshot.reproducibilityPackEnvironmentCaptureStatus ?? "unset"}, regenerate_tables=${snapshot.reproducibilityPackRegenerateTablesStatus ?? "unset"}`
    );
  }
  if (snapshot.cameraReadyEvidenceStatus && snapshot.cameraReadyEvidenceStatus !== "missing") {
    lines.push(
      `Camera-ready evidence: status=${snapshot.cameraReadyEvidenceStatus}, figures=${snapshot.cameraReadyEvidenceFiguresStatus ?? "unset"}, tables=${snapshot.cameraReadyEvidenceTablesStatus ?? "unset"}, captions=${snapshot.cameraReadyEvidenceCaptionsStatus ?? "unset"}`
    );
  }
  if (snapshot.opportunityScorecardStatus && snapshot.opportunityScorecardStatus !== "missing") {
    lines.push(
      `Top-tier opportunity: status=${snapshot.opportunityScorecardStatus}, verdict=${snapshot.opportunityScorecardVerdict ?? "unset"}, graph_context=${snapshot.opportunityScorecardGraphContextStatus ?? "unset"}`
    );
  }
  if (snapshot.evidenceCloseoutStatus) {
    lines.push(
      `Evidence closeout: status=${snapshot.evidenceCloseoutStatus}, verdict=${snapshot.evidenceCloseoutTopTierVerdict ?? "unset"}, blockers=${snapshot.evidenceCloseoutBlockerCount ?? 0}, graph_blockers=${snapshot.evidenceCloseoutGraphDependentBlockerCount ?? 0}, local_blockers=${snapshot.evidenceCloseoutLocalEvidenceBlockerCount ?? 0}`
    );
    lines.push(
      `Evidence closeout stages: experiment_to_analyze=${snapshot.evidenceCloseoutExperimentAnalyzeReady ? "ready" : "blocked"}, analyze_to_review=${snapshot.evidenceCloseoutAnalyzeReviewReady ? "ready" : "blocked"}, write=${snapshot.evidenceCloseoutWriteReady ? "ready" : "blocked"}, submit=${snapshot.evidenceCloseoutSubmitReady ? "ready" : "blocked"}`
    );
    if ((snapshot.evidenceCloseoutTopBlockers ?? []).length > 0) {
      lines.push(
        `Evidence closeout blockers: ${(snapshot.evidenceCloseoutTopBlockers ?? []).join("; ")}`
      );
    }
  }
  if ((snapshot.teamTaskPreview ?? []).length > 0) {
    lines.push(
      `Stage task preview: ${(snapshot.teamTaskPreview ?? [])
        .map(
          (task) =>
            `${task.taskId}[${task.status}]${task.owner ? `@${task.owner}` : ""}`
        )
        .join(", ")}`
    );
  }
  if ((snapshot.teamTaskGraphTaskCount ?? 0) > 0) {
    lines.push(
      `Stage task graph: tasks=${snapshot.teamTaskGraphTaskCount ?? 0}, claimable=${snapshot.teamTaskGraphClaimableCount ?? 0}, satisfied=${snapshot.teamTaskGraphSatisfiedCount ?? 0}, optional=${snapshot.teamTaskGraphOptionalCount ?? 0}`
    );
  }
  if (snapshot.paperStoryStatus) {
    lines.push(
      `Paper story: status=${snapshot.paperStoryStatus}, track=${snapshot.paperStoryTrackId ?? "unset"}, story_spine=${snapshot.paperStoryStorySpinePath ?? "unset"}, claim_map=${snapshot.paperStoryClaimToExperimentMapPath ?? "unset"}, fallback=${snapshot.paperStoryFallbackNarrativePath ?? "unset"}`
    );
    if (snapshot.paperStoryClaimSupportStatus) {
      lines.push(
        `Paper story support: status=${snapshot.paperStoryClaimSupportStatus}, supported=${snapshot.paperStorySupportedClaimCount ?? 0}, partial=${snapshot.paperStoryPartialClaimCount ?? 0}, unsupported=${snapshot.paperStoryUnsupportedClaimCount ?? 0}`
      );
    }
  }
  if (snapshot.reviewPressureStatus) {
    lines.push(
      `Review pressure: status=${snapshot.reviewPressureStatus}, reject_first=${snapshot.reviewPressureRejectFirstReviewPath ?? "unset"}, unsupported_claim_audit=${snapshot.reviewPressureUnsupportedClaimAuditPath ?? "unset"}`
    );
  }
  if (snapshot.writingSessionStatus && snapshot.writingSessionStatus !== "missing") {
    lines.push(
      `Writing session: status=${snapshot.writingSessionStatus}, current_section=${snapshot.writingCurrentSection ?? "unset"}, section_review=${snapshot.writingCurrentSectionReviewVerdict ?? "unknown"}`
    );
    lines.push(
      `Writing evidence coverage: status=${snapshot.writingGraphEvidenceCoverageStatus ?? "unknown"}, packets_ready=${snapshot.writingSectionPacketsReady ? "true" : "false"}`
    );
  }
  if (snapshot.reviewSessionStatus && snapshot.reviewSessionStatus !== "missing") {
    lines.push(
      `Review session: status=${snapshot.reviewSessionStatus}, scope=${snapshot.reviewSessionStageScope ?? "unset"}, round=${snapshot.reviewSessionRound ?? 0}, verdict=${snapshot.reviewSessionVerdict ?? "unknown"}`
    );
    const reviewRubric = snapshot.reviewRubricSummary ?? {};
    const rubricPairs = [
      ["originality", reviewRubric.originality],
      ["quality", reviewRubric.quality],
      ["clarity", reviewRubric.clarity],
      ["significance", reviewRubric.significance],
      ["soundness", reviewRubric.soundness],
      ["citation_integrity", reviewRubric.citationIntegrity],
      ["graph_evidence", reviewRubric.graphGroundedEvidenceSufficiency],
    ].filter(([, value]) => typeof value === "number");
    if (rubricPairs.length > 0) {
      lines.push(
        `Reviewer rubric: ${rubricPairs
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`
      );
    }
  }
  if (
    snapshot.reviewIssueTrackerStatus &&
    snapshot.reviewIssueTrackerStatus !== "missing"
  ) {
    lines.push(
      `Review issues: status=${snapshot.reviewIssueTrackerStatus}, critical=${snapshot.reviewIssueCriticalCount ?? 0}, high=${snapshot.reviewIssueHighCount ?? 0}, medium=${snapshot.reviewIssueMediumCount ?? 0}, low=${snapshot.reviewIssueLowCount ?? 0}`
    );
  }
  if (
    snapshot.graphGuidedWritingStatus &&
    snapshot.graphGuidedWritingStatus !== "missing"
  ) {
    const missingClaims = Array.isArray(snapshot.graphGuidedWritingMissingEvidenceClaims)
      ? snapshot.graphGuidedWritingMissingEvidenceClaims
      : [];
    lines.push(
      `Graph-guided writing: status=${snapshot.graphGuidedWritingStatus}, evidence_coverage=${snapshot.graphGuidedWritingEvidenceCoverageStatus ?? "unknown"}, missing_claims=${missingClaims.join(",") || "none"}`
    );
    if (snapshot.graphGuidedWritingScholarReserved) {
      lines.push(
        `Scholar fallback slot: reserved=${snapshot.graphGuidedWritingScholarSkillSlot ?? "true"}`
      );
    } else {
      lines.push("Scholar fallback slot: reserved=false");
    }
  }
  if (
    snapshot.citationCollectionStatus &&
    snapshot.citationCollectionStatus !== "missing"
  ) {
    lines.push(
      `Citation collection: status=${snapshot.citationCollectionStatus}, verified=${snapshot.citationCollectionVerifiedCount ?? 0}/${snapshot.citationCollectionCandidateCount ?? 0}, suspicious=${snapshot.citationCollectionSuspiciousCount ?? 0}, hallucinated=${snapshot.citationCollectionHallucinatedCount ?? 0}`
    );
  }
  if (snapshot.paperQcStatus && snapshot.paperQcStatus !== "missing") {
    lines.push(
      `Paper QC: status=${snapshot.paperQcStatus}, compile=${snapshot.paperQcCompileStatus ?? "unset"}, chktex=${snapshot.paperQcChktexStatus ?? "unset"}, page_budget=${snapshot.paperQcPageBudgetStatus ?? "unset"}`
    );
  }
  if (snapshot.figureQcStatus && snapshot.figureQcStatus !== "missing") {
    lines.push(
      `Figure QC: status=${snapshot.figureQcStatus}, duplicate_figures=${snapshot.figureQcDuplicateFigureStatus ?? "unset"}, caption_alignment=${snapshot.figureQcCaptionAlignmentStatus ?? "unset"}, text_alignment=${snapshot.figureQcTextAlignmentStatus ?? "unset"}, selection=${snapshot.figureQcSelectionStatus ?? "unset"}`
    );
  }
  if (
    snapshot.externalReviewStatus &&
    snapshot.externalReviewStatus !== "missing"
  ) {
    lines.push(
      `External review: status=${snapshot.externalReviewStatus}, recommendation=${snapshot.externalReviewRecommendation ?? "unset"}, required_action=${snapshot.externalReviewRequiredAction ?? "unset"}`
    );
  }
  if (!snapshot.projectRoot) {
    lines.push(
      "Project binding: no active project is currently bound to this conversation or workflow session."
    );
  }
  lines.push("");
  lines.push(...formatAutoModeSection({ autoIteratorResult: params.autoIteratorResult }));
  lines.push("");
  lines.push(...formatAutoDiscussionSection({
    projectRoot: snapshot.projectRoot ?? null,
    discussionStore: params.discussionStore,
  }));
  lines.push("");
  lines.push(...formatGateReviewSection({
    projectRoot: snapshot.projectRoot ?? null,
    gateReviewStore: params.gateReviewStore,
  }));
  lines.push("");
  lines.push(...formatCodeReviewSection({
    projectRoot: snapshot.projectRoot ?? null,
    codeReviewStore: params.codeReviewStore,
  }));
  return lines.join("\n");
}

export function formatResearchProgramOnboardingGapLabels(gaps: string[]): string {
  return gaps
    .map((gap) =>
      gap
        .replace(/^PROJECT_MANIFEST\.json\.research_program\./, "")
        .replace(/\s+\(recommended:.*\)$/, "")
    )
    .join(", ");
}
