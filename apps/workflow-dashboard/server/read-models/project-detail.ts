import path from "node:path";

import { pathExists, readJsonFile } from "../file-access/fs.js";
import { getWorkflowStageIndex } from "../constants/workflow-stages.js";
import { resolveExistingProjectRoot } from "../file-access/project-root.js";

type ManifestFile = {
  project_id?: string | null;
  title?: string | null;
  current_stage?: string | null;
  owner_agent?: string | null;
  updated_at?: string | null;
  blocking_reason?: string | null;
  next_action?: string | null;
  resume_action?: string | null;
  paper_story_state?: Record<string, unknown> | null;
  results_storyline?: Record<string, unknown> | null;
  innovation_synthesis_state?: Record<string, unknown> | null;
  title_abstract_intro_workbench?: Record<string, unknown> | null;
  review_pressure_packet?: Record<string, unknown> | null;
  citation_integrity?: Record<string, unknown> | null;
  benchmark_protocol?: Record<string, unknown> | null;
  statistical_evidence?: Record<string, unknown> | null;
  venue_competition?: Record<string, unknown> | null;
  ablation_evidence?: Record<string, unknown> | null;
  mechanism_evidence?: Record<string, unknown> | null;
  reproducibility_pack?: Record<string, unknown> | null;
  camera_ready_evidence?: Record<string, unknown> | null;
  survey_review?: {
    status?: string | null;
    topic?: string | null;
    candidate_paper_count?: number | null;
    included_paper_count?: number | null;
    excluded_paper_count?: number | null;
    graph_grounded_brief_ready?: boolean | null;
  } | null;
  writing_contract?: {
    paper_mode?: string | null;
    paperMode?: string | null;
  } | null;
  opportunity_scorecard?: {
    verdict?: string | null;
    status?: string | null;
  } | null;
};

type PapernexusProgressFile = {
  phase?: string | null;
  progress?: {
    total?: number | null;
    completed?: number | null;
    remaining?: number | null;
  } | null;
};

type TaskGraphFile = { tasks?: Array<Record<string, unknown>> | null };
type TeamRoundFile = {
  leadRole?: string | null;
  activeSessionKeys?: string[] | null;
  lastClaimedTaskId?: string | null;
  lastCompletedTaskId?: string | null;
};
type HandoffIntentStore = { intents?: Array<Record<string, unknown>> | null };
type RepairQueueStore = { items?: Array<Record<string, unknown>> | null };
type AgentCapabilityStore = { records?: Array<Record<string, unknown>> | null };
type WriteScopeStore = { claims?: Array<Record<string, unknown>> | null };

export type ProjectDetailSummary = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  workflowLine: "experiment" | "survey";
  paperMode: string | null;
  owner: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  updatedAt: string | null;
  blockingReason: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  surveyStatus: string | null;
  surveyTopic: string | null;
  surveyProgressSummary: string | null;
  paperStoryStatus: string | null;
  paperStoryClaimSupportStatus: string | null;
  paperStorySupportedClaimCount: number | null;
  paperStoryUnsupportedClaimCount: number | null;
  resultsStorylineStatus: string | null;
  resultsStorylineQuestionCount: number | null;
  innovationSynthesisStatus: string | null;
  innovationSynthesisIntegrationPattern: string | null;
  innovationSynthesisPointCount: number | null;
  titleAbstractIntroStatus: string | null;
  titleAbstractIntroAlignmentStatus: string | null;
  titleAbstractIntroSelectedTitle: string | null;
  reviewPressureStatus: string | null;
  citationIntegrityStatus: string | null;
  suspiciousCitationCount: number | null;
  hallucinatedCitationCount: number | null;
  figureTableArtifactSummary: string | null;
  surveyAuthoringArtifactSummary: string | null;
  papernexusPhase: string | null;
  papernexusProgressSummary: string | null;
  topTierVerdict: string | null;
  teamRoundLead: string | null;
  teamRoundActiveSessions: number | null;
  teamRoundLastClaimedTaskId: string | null;
  teamRoundLastCompletedTaskId: string | null;
  teamTaskGraphTaskCount: number | null;
  teamTaskGraphClaimableCount: number | null;
  teamTaskGraphBlockedCount: number | null;
  teamTaskGraphClaimedCount: number | null;
  teamTaskGraphVerifyingCount: number | null;
  teamTaskGraphNeedsRepairCount: number | null;
  teamTaskGraphSatisfiedCount: number | null;
  pendingHandoffCount: number;
  failedHandoffCount: number;
  unackedHandoffCount: number;
  repairQueueCount: number;
  staleClaimCount: number;
  capabilityWarnings: number;
  activeWriteScopeCount: number;
  taskBoard: Array<{
    taskId: string;
    title: string;
    owner: string | null;
    status: string;
    claimant: string | null;
    dependsOn: string[];
    verificationStatus: string;
    latestEvent: string | null;
    latestEventAt: string | null;
  }>;
  evidenceBoard: {
    benchmarkProtocolStatus: string | null;
    benchmarkProtocolLocked: boolean;
    statisticalEvidenceStatus: string | null;
    statisticalEvidenceClaimStrength: string | null;
    venueCompetitionStatus: string | null;
    venueCompetitionGraphContextStatus: string | null;
    ablationEvidenceStatus: string | null;
    ablationEvidenceSufficiency: string | null;
    mechanismEvidenceStatus: string | null;
    mechanismEvidenceGraphContextStatus: string | null;
    reproducibilityPackStatus: string | null;
    reproducibilityEnvironmentStatus: string | null;
    cameraReadyEvidenceStatus: string | null;
    cameraReadyFiguresStatus: string | null;
    cameraReadyTablesStatus: string | null;
    cameraReadyCaptionsStatus: string | null;
    topTierVerdict: string | null;
    evidenceCloseoutStatus: string | null;
  };
  source: Array<"manifest" | "papernexus_progress" | "fallback">;
};

export async function readProjectDetailSummary(params: {
  projectsRoot: string;
  projectId: string;
}): Promise<ProjectDetailSummary | null> {
  const projectRoot = await resolveExistingProjectRoot({
    projectsRoot: params.projectsRoot,
    projectId: params.projectId,
  });

  if (!projectRoot) {
    return null;
  }

  const manifest = await readJsonFile<ManifestFile>(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
  );
  const progress = await readJsonFile<PapernexusProgressFile>(
    path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"),
  );
  const dashboardSummary = await readLocalDashboardSummary(projectRoot, manifest);
  const paperStory = asRecord(manifest?.paper_story_state);
  const resultsStoryline = asRecord(manifest?.results_storyline);
  const innovationSynthesis = asRecord(manifest?.innovation_synthesis_state);
  const titleWorkbench = asRecord(manifest?.title_abstract_intro_workbench);
  const reviewPressure = asRecord(manifest?.review_pressure_packet);
  const citationIntegrity = asRecord(manifest?.citation_integrity);
  const source: ProjectDetailSummary["source"] = [];

  if (manifest) {
    source.push("manifest");
  }

  if (progress) {
    source.push("papernexus_progress");
  }

  if (!asString(manifest?.project_id)) {
    source.push("fallback");
  }

  const currentStage = asString(manifest?.current_stage);
  const blockingReason = asString(manifest?.blocking_reason);
  const nextAction = asString(manifest?.next_action);
  const paperMode = getPaperMode(manifest?.writing_contract);
  const surveyStatus = asString(manifest?.survey_review?.status);
  const [
    figureAlignmentExists,
    figureRegistryExists,
    tableRegistryExists,
    surveyComparativeExists,
    surveySectionBriefsExists,
    surveySelfReviewExists,
  ] = await Promise.all([
    pathExists(
      path.join(projectRoot, "academic_writer", "FIGURE_TABLE_ALIGNMENT.md"),
    ),
    pathExists(
      path.join(projectRoot, "academic_writer", "FIGURE_REGISTRY.json"),
    ),
    pathExists(
      path.join(projectRoot, "academic_writer", "TABLE_REGISTRY.json"),
    ),
    pathExists(
      path.join(projectRoot, "academic_writer", "SURVEY_COMPARATIVE_ANALYSIS.md"),
    ),
    pathExists(
      path.join(projectRoot, "academic_writer", "SURVEY_SECTION_BRIEFS.md"),
    ),
    pathExists(
      path.join(projectRoot, "academic_writer", "SURVEY_SELF_REVIEW.md"),
    ),
  ]);

  return {
    id: asString(manifest?.project_id) ?? params.projectId,
    title: asString(manifest?.title),
    projectRoot,
    currentStage,
    workflowLine: deriveWorkflowLine({
      currentStage,
      paperMode,
      surveyStatus,
    }),
    paperMode,
    owner: asString(manifest?.owner_agent),
    status: deriveStatus({ currentStage, blockingReason, nextAction }),
    updatedAt: asString(manifest?.updated_at),
    blockingReason,
    nextAction,
    resumeAction: asString(manifest?.resume_action),
    surveyStatus,
    surveyTopic: asString(manifest?.survey_review?.topic),
    surveyProgressSummary: formatSurveyProgressSummary(manifest?.survey_review),
    paperStoryStatus: asString(paperStory?.status),
    paperStoryClaimSupportStatus: asString(
      paperStory?.claim_support_status ?? paperStory?.claimSupportStatus,
    ),
    paperStorySupportedClaimCount: asNumber(
      paperStory?.supported_claim_count ?? paperStory?.supportedClaimCount,
    ),
    paperStoryUnsupportedClaimCount: asNumber(
      paperStory?.unsupported_claim_count ?? paperStory?.unsupportedClaimCount,
    ),
    resultsStorylineStatus: asString(resultsStoryline?.status),
    resultsStorylineQuestionCount: Array.isArray(
      resultsStoryline?.question_order ?? resultsStoryline?.questionOrder,
    )
      ? ((resultsStoryline?.question_order ??
          resultsStoryline?.questionOrder) as unknown[]).length
      : 0,
    innovationSynthesisStatus: asString(innovationSynthesis?.status),
    innovationSynthesisIntegrationPattern: asString(
      innovationSynthesis?.integration_pattern ?? innovationSynthesis?.integrationPattern,
    ),
    innovationSynthesisPointCount: Array.isArray(
      innovationSynthesis?.innovation_points ?? innovationSynthesis?.innovationPoints,
    )
      ? ((innovationSynthesis?.innovation_points ??
          innovationSynthesis?.innovationPoints) as unknown[]).length
      : 0,
    titleAbstractIntroStatus: asString(titleWorkbench?.status),
    titleAbstractIntroAlignmentStatus: asString(
      titleWorkbench?.alignment_status ?? titleWorkbench?.alignmentStatus,
    ),
    titleAbstractIntroSelectedTitle: asString(
      titleWorkbench?.selected_title ?? titleWorkbench?.selectedTitle,
    ),
    reviewPressureStatus: asString(reviewPressure?.status),
    citationIntegrityStatus: asString(
      citationIntegrity?.verification_status ?? citationIntegrity?.verificationStatus,
    ),
    suspiciousCitationCount: asNumber(
      citationIntegrity?.suspicious_citation_count ??
        citationIntegrity?.suspiciousCitationCount,
    ),
    hallucinatedCitationCount: asNumber(
      citationIntegrity?.hallucinated_citation_count ??
        citationIntegrity?.hallucinatedCitationCount,
    ),
    figureTableArtifactSummary: formatExistsSummary(
      [figureAlignmentExists, figureRegistryExists, tableRegistryExists],
      "core outputs",
    ),
    surveyAuthoringArtifactSummary:
      deriveWorkflowLine({ currentStage, paperMode, surveyStatus }) === "survey"
        ? formatExistsSummary(
            [surveyComparativeExists, surveySectionBriefsExists, surveySelfReviewExists],
            "survey outputs",
          )
        : null,
    papernexusPhase: asString(progress?.phase),
    papernexusProgressSummary: formatPapernexusProgressSummary(progress?.progress),
    topTierVerdict: asString(manifest?.opportunity_scorecard?.verdict),
    teamRoundLead: dashboardSummary.teamRound.leadRole,
    teamRoundActiveSessions: dashboardSummary.teamRound.activeSessionCount,
    teamRoundLastClaimedTaskId: dashboardSummary.teamRound.lastClaimedTaskId,
    teamRoundLastCompletedTaskId: dashboardSummary.teamRound.lastCompletedTaskId,
    teamTaskGraphTaskCount: dashboardSummary.teamTaskGraph.taskCount,
    teamTaskGraphClaimableCount: dashboardSummary.teamTaskGraph.claimableCount,
    teamTaskGraphBlockedCount: dashboardSummary.teamTaskGraph.blockedCount,
    teamTaskGraphClaimedCount: dashboardSummary.teamTaskGraph.claimedCount,
    teamTaskGraphVerifyingCount: dashboardSummary.teamTaskGraph.verifyingCount,
    teamTaskGraphNeedsRepairCount: dashboardSummary.teamTaskGraph.needsRepairCount,
    teamTaskGraphSatisfiedCount: dashboardSummary.teamTaskGraph.satisfiedCount,
    pendingHandoffCount: dashboardSummary.handoffRecovery.pendingHandoffCount,
    failedHandoffCount: dashboardSummary.handoffRecovery.failedHandoffCount,
    unackedHandoffCount: dashboardSummary.handoffRecovery.unackedHandoffCount,
    repairQueueCount: dashboardSummary.handoffRecovery.repairQueueCount,
    staleClaimCount: dashboardSummary.handoffRecovery.staleClaimCount,
    capabilityWarnings: dashboardSummary.handoffRecovery.capabilityWarnings,
    activeWriteScopeCount: dashboardSummary.handoffRecovery.activeWriteScopeCount,
    taskBoard: dashboardSummary.taskBoard,
    evidenceBoard: {
      benchmarkProtocolStatus: dashboardSummary.evidenceBoard.benchmarkProtocol.status,
      benchmarkProtocolLocked: dashboardSummary.evidenceBoard.benchmarkProtocol.locked,
      statisticalEvidenceStatus: dashboardSummary.evidenceBoard.statisticalEvidence.status,
      statisticalEvidenceClaimStrength:
        dashboardSummary.evidenceBoard.statisticalEvidence.claimStrengthStatus,
      venueCompetitionStatus: dashboardSummary.evidenceBoard.venueCompetition.status,
      venueCompetitionGraphContextStatus:
        dashboardSummary.evidenceBoard.venueCompetition.graphContextStatus,
      ablationEvidenceStatus: dashboardSummary.evidenceBoard.ablationEvidence.status,
      ablationEvidenceSufficiency:
        dashboardSummary.evidenceBoard.ablationEvidence.sufficiencyStatus,
      mechanismEvidenceStatus: dashboardSummary.evidenceBoard.mechanismEvidence.status,
      mechanismEvidenceGraphContextStatus:
        dashboardSummary.evidenceBoard.mechanismEvidence.graphContextStatus,
      reproducibilityPackStatus: dashboardSummary.evidenceBoard.reproducibilityPack.status,
      reproducibilityEnvironmentStatus:
        dashboardSummary.evidenceBoard.reproducibilityPack.environmentCaptureStatus,
      cameraReadyEvidenceStatus: dashboardSummary.evidenceBoard.cameraReadyEvidence.status,
      cameraReadyFiguresStatus:
        dashboardSummary.evidenceBoard.cameraReadyEvidence.figuresStatus,
      cameraReadyTablesStatus: dashboardSummary.evidenceBoard.cameraReadyEvidence.tablesStatus,
      cameraReadyCaptionsStatus:
        dashboardSummary.evidenceBoard.cameraReadyEvidence.captionsStatus,
      topTierVerdict: dashboardSummary.evidenceBoard.opportunityScorecard.verdict,
      evidenceCloseoutStatus: dashboardSummary.evidenceCloseout.status,
    },
    source,
  };
}

function deriveWorkflowLine(params: {
  currentStage: string | null;
  paperMode: string | null;
  surveyStatus: string | null;
}): ProjectDetailSummary["workflowLine"] {
  if (
    params.currentStage === "survey_review" ||
    params.paperMode === "survey" ||
    (params.surveyStatus !== null && params.surveyStatus !== "missing")
  ) {
    return "survey";
  }

  return "experiment";
}

function deriveStatus(params: {
  currentStage: string | null;
  blockingReason: string | null;
  nextAction: string | null;
}): ProjectDetailSummary["status"] {
  if (params.blockingReason) {
    return "blocked";
  }

  if (getWorkflowStageIndex(params.currentStage) === null) {
    return "incomplete";
  }

  if (params.currentStage === "submit" || params.currentStage === "done" || !params.nextAction) {
    return "ready";
  }

  return "active";
}

function formatPapernexusProgressSummary(
  progress: PapernexusProgressFile["progress"],
): string | null {
  const total = asNumber(progress?.total);
  const completed = asNumber(progress?.completed);
  const remaining =
    asNumber(progress?.remaining) ??
    (typeof total === "number" && typeof completed === "number"
      ? total - completed
      : null);

  if (total === null || completed === null) {
    return null;
  }

  if (remaining === null) {
    return `${completed}/${total} completed`;
  }

  return `${completed}/${total} completed (${remaining} remaining)`;
}

function formatSurveyProgressSummary(
  survey: ManifestFile["survey_review"],
): string | null {
  const candidateCount = asNumber(survey?.candidate_paper_count);
  const includedCount = asNumber(survey?.included_paper_count);
  const excludedCount = asNumber(survey?.excluded_paper_count);
  const briefReady = survey?.graph_grounded_brief_ready === true;
  const parts: string[] = [];

  if (candidateCount !== null) {
    parts.push(`${candidateCount} candidates`);
  }
  if (includedCount !== null) {
    parts.push(`${includedCount} included`);
  }
  if (excludedCount !== null) {
    parts.push(`${excludedCount} excluded`);
  }
  if (briefReady) {
    parts.push("brief ready");
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getPaperMode(value: ManifestFile["writing_contract"]): string | null {
  return asString(value?.paper_mode) ?? asString(value?.paperMode);
}

function formatExistsSummary(values: boolean[], label: string): string | null {
  const ready = values.filter(Boolean).length;
  const total = values.length;
  return total > 0 ? `${ready}/${total} ${label} ready` : null;
}

async function readLocalDashboardSummary(projectRoot: string, manifest: ManifestFile | null) {
  const [taskGraph, teamRound, handoffStore, repairQueue, capabilities, writeScopes] =
    await Promise.all([
      readJsonFile<TaskGraphFile>(
        path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
      ),
      readJsonFile<TeamRoundFile>(
        path.join(projectRoot, ".openclaw-research", "workflow-team-round.json"),
      ),
      readJsonFile<HandoffIntentStore>(
        path.join(projectRoot, ".openclaw-research", "workflow-handoff-intents.json"),
      ),
      readJsonFile<RepairQueueStore>(
        path.join(projectRoot, ".openclaw-research", "workflow-repair-queue.json"),
      ),
      readJsonFile<AgentCapabilityStore>(
        path.join(projectRoot, ".openclaw-research", "workflow-agent-capabilities.json"),
      ),
      readJsonFile<WriteScopeStore>(
        path.join(projectRoot, ".openclaw-research", "workflow-write-scopes.json"),
      ),
    ]);

  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : [];
  const intents = Array.isArray(handoffStore?.intents) ? handoffStore.intents : [];
  const repairItems = Array.isArray(repairQueue?.items) ? repairQueue.items : [];
  const capabilityRecords = Array.isArray(capabilities?.records) ? capabilities.records : [];
  const writeScopeClaims = Array.isArray(writeScopes?.claims) ? writeScopes.claims : [];
  const now = Date.now();

  return {
    teamTaskGraph: {
      taskCount: tasks.length,
      claimableCount: countByStatus(tasks, "claimable"),
      blockedCount: countByStatus(tasks, "blocked"),
      claimedCount: countByStatus(tasks, "claimed"),
      verifyingCount: countByStatus(tasks, "verifying"),
      needsRepairCount: countByStatus(tasks, "needs_repair"),
      satisfiedCount: countByStatus(tasks, "satisfied"),
    },
    taskBoard: tasks.map((task) => {
      const lease = asRecord(task.lease);
      return {
        taskId: asString(task.taskId ?? task.task_id) ?? "unknown",
        title: asString(task.title) ?? "Untitled task",
        owner: asString(task.owner),
        status: asString(task.status) ?? "unknown",
        claimant:
          asString(lease?.role) ??
          asString(lease?.sessionKey ?? lease?.session_key),
        dependsOn: asStringArray(task.dependsOn ?? task.depends_on),
        verificationStatus:
          asString(task.verificationStatus ?? task.verification_status) ?? "unknown",
        latestEvent:
          asString(task.latestEventSummary ?? task.latest_event_summary) ?? null,
        latestEventAt: asString(task.latestEventAt ?? task.latest_event_at),
      };
    }),
    teamRound: {
      leadRole: asString(teamRound?.leadRole),
      activeSessionCount: Array.isArray(teamRound?.activeSessionKeys)
        ? teamRound.activeSessionKeys.length
        : 0,
      lastClaimedTaskId: asString(teamRound?.lastClaimedTaskId),
      lastCompletedTaskId: asString(teamRound?.lastCompletedTaskId),
    },
    handoffRecovery: {
      pendingHandoffCount: intents.filter((entry) =>
        [
          "prepared",
          "pending",
          "queued",
          "dispatching",
          "dispatched",
          "delivered",
          "acknowledged",
          "claimed",
          "activated",
        ].includes(asString(entry.status) ?? ""),
      ).length,
      failedHandoffCount: intents.filter((entry) =>
        ["failed", "expired", "escalated"].includes(asString(entry.status) ?? ""),
      ).length,
      unackedHandoffCount: intents.filter((entry) =>
        ["dispatched", "delivered", "acknowledged"].includes(asString(entry.status) ?? ""),
      ).length,
      repairQueueCount: repairItems.filter((entry) =>
        ["queued", "claimed", "failed", "escalated"].includes(asString(entry.status) ?? ""),
      ).length,
      staleClaimCount: intents.filter(
        (entry) => (asString(entry.status) ?? "") === "stale_claim",
      ).length,
      capabilityWarnings: capabilityRecords.filter((entry) => {
        const confidence = asString(entry.confidence);
        const expiresAt = asString(entry.expiresAt ?? entry.expires_at);
        return confidence === "low" || (expiresAt ? Date.parse(expiresAt) <= now : false);
      }).length,
      activeWriteScopeCount: writeScopeClaims.filter((entry) => {
        const releasedAt = asString(entry.releasedAt ?? entry.released_at);
        const leaseExpiresAt = asString(entry.leaseExpiresAt ?? entry.lease_expires_at);
        return (
          !releasedAt &&
          typeof leaseExpiresAt === "string" &&
          Date.parse(leaseExpiresAt) > now
        );
      }).length,
    },
    evidenceBoard: {
      benchmarkProtocol: {
        status: asString(manifest?.benchmark_protocol?.status),
        locked: asBoolean(manifest?.benchmark_protocol?.locked),
      },
      statisticalEvidence: {
        status: asString(manifest?.statistical_evidence?.status),
        claimStrengthStatus: asString(
          manifest?.statistical_evidence?.claim_strength_status ??
            manifest?.statistical_evidence?.claimStrengthStatus,
        ),
      },
      venueCompetition: {
        status: asString(manifest?.venue_competition?.status),
        graphContextStatus: asString(
          manifest?.venue_competition?.graph_context_status ??
            manifest?.venue_competition?.graphContextStatus,
        ),
      },
      ablationEvidence: {
        status: asString(manifest?.ablation_evidence?.status),
        sufficiencyStatus: asString(
          manifest?.ablation_evidence?.sufficiency_status ??
            manifest?.ablation_evidence?.sufficiencyStatus,
        ),
      },
      mechanismEvidence: {
        status: asString(manifest?.mechanism_evidence?.status),
        graphContextStatus: asString(
          manifest?.mechanism_evidence?.graph_context_status ??
            manifest?.mechanism_evidence?.graphContextStatus,
        ),
      },
      reproducibilityPack: {
        status: asString(manifest?.reproducibility_pack?.status),
        environmentCaptureStatus: asString(
          manifest?.reproducibility_pack?.environment_capture_status ??
            manifest?.reproducibility_pack?.environmentCaptureStatus,
        ),
      },
      cameraReadyEvidence: {
        status: asString(manifest?.camera_ready_evidence?.status),
        figuresStatus: asString(
          manifest?.camera_ready_evidence?.figures_status ??
            manifest?.camera_ready_evidence?.figuresStatus,
        ),
        tablesStatus: asString(
          manifest?.camera_ready_evidence?.tables_status ??
            manifest?.camera_ready_evidence?.tablesStatus,
        ),
        captionsStatus: asString(
          manifest?.camera_ready_evidence?.captions_status ??
            manifest?.camera_ready_evidence?.captionsStatus,
        ),
      },
      opportunityScorecard: {
        verdict: asString(
          manifest?.opportunity_scorecard?.verdict ??
            manifest?.opportunity_scorecard?.status,
        ),
      },
    },
    evidenceCloseout: {
      status: deriveEvidenceCloseoutStatus(manifest),
    },
  };
}

function countByStatus(tasks: Array<Record<string, unknown>>, status: string): number {
  return tasks.filter((task) => (asString(task.status) ?? "") === status).length;
}

function deriveEvidenceCloseoutStatus(manifest: ManifestFile | null): string {
  const statuses = [
    asString(manifest?.benchmark_protocol?.status),
    asString(manifest?.statistical_evidence?.status),
    asString(manifest?.venue_competition?.status),
    asString(manifest?.ablation_evidence?.status),
    asString(manifest?.mechanism_evidence?.status),
    asString(manifest?.reproducibility_pack?.status),
    asString(manifest?.camera_ready_evidence?.status),
  ].filter(Boolean);
  if (statuses.length === 0) {
    return "not_applicable";
  }
  if (statuses.every((status) => status === "ready" || status === "pass")) {
    return "ready";
  }
  if (statuses.some((status) => status === "blocked" || status === "failed")) {
    return "blocked";
  }
  return "in_progress";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
}
