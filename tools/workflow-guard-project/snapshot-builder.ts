import * as os from "node:os";
import * as path from "node:path";
import {
  asRecord,
  asString,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { pathExists, readJsonIfExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  buildExperimentMemoryDigest,
  isTerminalExperimentStatus,
  loadExperimentSearchState,
} from "../workflow-guard-experiment-history";
import { getExperimentGpuMonitorStateSummary } from "../workflow-gpu-monitor.js";
import { evaluateExperimentSearchDecision } from "../workflow-experiment-decision";
import {
  loadExperimentReviewState,
} from "../workflow-auto-experiment-review";
import { loadExperimentSearchReviewState } from "../workflow-auto-experiment-search-review.js";
import {
  loadTrackInnovationEvidence,
} from "../workflow-derived-state/track-evidence.js";
import {
  resolveStageReadiness,
} from "../workflow-derived-state/stage-readiness.js";
import {
  resolveHandoffEligibility,
} from "../workflow-derived-state/handoff-eligibility.js";
import {
  resolveWorkflowRuntimeHealth,
} from "../workflow-runtime-health.js";
import {
  filterStaleAutoIteratorMailboxItems,
  inboxForRole,
} from "../workflow-guard-collaboration";
import { resolveStageForWorkflowLine } from "../workflow-line-routing.js";
import {
  loadPapernexusProgress,
  summarizePapernexusProgress,
} from "../papernexus-progress";
import {
  deriveAutoZoteroSyncCandidate,
  readZoteroSyncStateSummary,
} from "../workflow-zotero-sync";
import { summarizeEvidenceCloseoutState } from "../workflow-evidence/closeout-summary";
import { buildWorkflowStageTaskPreview } from "../workflow-team/stage-profiles";
import {
  getWorkflowTaskGraphPath,
  readWorkflowTaskGraphStore,
  summarizeWorkflowTaskGraphStore,
} from "../workflow-team/task-graph";
import {
  getWorkflowTeamRoundPath,
  readWorkflowTeamRoundStore,
  summarizeWorkflowTeamRoundStore,
} from "../workflow-team/team-round";
import {
  normalizeAblationEvidenceState,
  normalizeBenchmarkProtocolState,
  normalizeCameraReadyEvidenceState,
  normalizeMechanismEvidenceState,
  normalizeOpportunityScorecardState,
  normalizeReproducibilityPackState,
  normalizeStatisticalEvidenceState,
  normalizeVenueCompetitionState,
} from "../workflow-evidence/contracts";
import {
  buildWorkflowRuntimeSessionBinding,
} from "../workflow-subagent-sessions";
import {
  normalizeIdleResearchState,
  computeIdleResearchNextDueAt,
  isIdleResearchDue,
  normalizeBrainstormCycleState,
  normalizeInnovationReflectionState,
} from "../workflow-guard-state/research-loop-state";
import { DEFAULT_WORKFLOW_AUTO_GATE, resolveWorkflowAutoGateModeForStage } from "../workflow-auto-mode";
import { normalizeIdeationContractState } from "../workflow-guard-state/ideation-contract";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import {
  normalizeResearchProgramState,
} from "../workflow-guard-state/research-program";
import {
  normalizePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import {
  normalizeOrchestrationState,
  normalizeWritePackageState,
  normalizeExperimentSearchState,
  normalizePaperQcState,
  normalizeCitationCollectionState,
  normalizeFigureQcState,
  normalizeReviewIssueTrackerState,
} from "../workflow-guard-state/execution-state";
import {
  normalizeAutonomousExecutionState,
  normalizeExperimentReviewState,
} from "../workflow-guard-state/experiment-review";
import {
  normalizeTheorySupportState,
} from "../workflow-guard-state/theory-state";
import {
  evaluateWritingContractState,
  normalizeWritingContractState,
  DEFAULT_KG_STORYLINE_PACKET_PATH,
} from "../workflow-guard-state/writing-contract";
import {
  normalizeCitationIntegrityState,
  normalizeWritingSessionState,
  serializeWritingSessionState,
  normalizeReviewSessionState,
  normalizeGraphGuidedWritingState,
  normalizeExternalReviewState,
} from "../workflow-guard-state/authoring-review-state";
import { normalizeRevisionControlState } from "../workflow-guard-state/revision-control";
import { normalizeAutoDispatchDiagnosticsState } from "../workflow-guard-state/auto-dispatch-diagnostics";
import { normalizeParagraphLogicAuditState } from "../workflow-guard-state/paragraph-logic-audit";
import { normalizeExecutionProofState } from "../workflow-guard-state/execution-proof";
import { normalizeSurveyVisualCompilerState } from "../workflow-guard-state/survey-visual-compiler";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import { summarizeReviewIssuesFromManifest } from "../workflow-guard-prompt-support";
import { buildDynamicTasksImpl } from "../workflow-guard-guidance/dynamic-tasks";
import { deriveRevisionControlState } from "../research-writing/revision-control";
import {
  ROLE_POLICIES,
  STAGE_REQUIREMENTS,
  getForwardStageHandoffTargetRole,
  normalizeWorkflowRole,
} from "../workflow-guard-policies/role-policy";
import { countReviewIssueLanes } from "../workflow-guard-writing/paper-quality-eval";
import { evaluateWritingProcessReadiness } from "../workflow-guard-writing/write-package-eval";
import {
  restoreAuthoringArtifactsFromRecovery,
  syncAuthoringArtifactRecovery,
  writingSessionLooksRecoverableEmpty,
} from "../research-writing/authoring-artifact-recovery";
import {
  normalizePapernexusAccessMode,
  normalizePapernexusApiTokenSource,
  normalizePapernexusMcpTransport,
  summarizePapernexusRemoteAccessConfig,
} from "../papernexus-secret";
import {
  countFinishedExperimentEntriesAwaitingReconciliation,
  countTerminalExperimentEntries,
  formatWorkflowShellArgument,
  getBrainstormCycleValidationErrors,
  getResearchProgramOnboardingGaps,
  getResearchProgramOnboardingStatus,
  getResearchProgramPlanValidationErrors,
  isBrainstormCycleReady,
  isInnovationReflectionDue,
} from "../workflow-kernel/readiness";
import { resolveWorkflowStageLeadRole } from "../workflow-kernel/stage-registry";
import type { WorkflowSnapshot, WorkflowGuardPolicy } from "../workflow-guard.js";
import type { WorkflowRole } from "../workflow-guard-guidance/types";
import type { WorkflowProjectState } from "./project-context";
import { defaultResearchProgramZoteroProjectPath } from "./project-context";

const DEFAULT_CITATION_BIB_PATH = "academic_writer/paper/refs.bib";
const DEFAULT_CITATION_REPORT_PATH = "reviewer/CITATION_VERIFICATION.md";
const DEFAULT_THEORY_APPENDIX_PLAN_PATH = "academic_writer/THEORY_APPENDIX_PLAN.md";
const DEFAULT_THEORY_APPENDIX_SECTION_PATH = "academic_writer/paper/sections/appendix_theory.tex";

type RolePolicy = {
  allowedContacts: WorkflowRole[];
  allowedSpawns: WorkflowRole[];
  allowedProjectDirs: string[];
  allowedProjectFiles: string[];
  allowProjectsStateWrite?: boolean;
  writeScopeLabels: string[];
  backgroundTasks: string[];
};

type ReviewIssueTrackerState = ReturnType<typeof normalizeReviewIssueTrackerState>;
type ReviewIssueState = ReviewIssueTrackerState["issues"][number];
type IdleResearchState = ReturnType<typeof normalizeIdleResearchState>;
type WorkflowEvidenceStatus = "ready" | "repairable" | "missing";

type WorkflowDerivedEvidenceSummary = {
  status: WorkflowEvidenceStatus;
  summary: string | null;
  diagnostics: string[];
};

export type WorkflowSnapshotBuilderDeps = {
  getMissingStageSignals?: (params: {
    projectRoot: string;
    manifest: Record<string, unknown> | null;
    trackRegistry: Record<string, unknown> | null;
    experimentLedger: unknown;
    currentStage: string | null;
  }) => Promise<string[]>;
};

export function buildGraphImportRepairGuidance(
  targetCorpus: string | null | undefined
): string {
  const normalizedCorpus = asString(targetCorpus);
  return (
    `Run /graph-build --repair-import true` +
    (normalizedCorpus
      ? ` --shared-corpus ${formatWorkflowShellArgument(normalizedCorpus)}`
      : "") +
    " to regenerate a bounded PaperNexus batch import repair pass against the locked shared corpus, persist progress through research_workflow.set_paper_ingestion, and refresh graph readiness metadata before frontier mapping or ideation."
  );
}

function getGraphPresenceMissingEntries(
  paperIngestion: Record<string, unknown> | null
): Array<Record<string, unknown>> {
  if (!paperIngestion || !Array.isArray(paperIngestion.graph_presence_missing_papers)) {
    return [];
  }
  return paperIngestion.graph_presence_missing_papers
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

export function summarizeGraphPresenceMissing(
  paperIngestion: Record<string, unknown> | null
): string | null {
  const entries = getGraphPresenceMissingEntries(paperIngestion);
  if (entries.length === 0) {
    return null;
  }
  const preview = entries
    .slice(0, 3)
    .map((entry) =>
      pickString(entry, ["arxiv_id", "arxivId", "title", "canonical_id", "canonicalId"]) ??
      "unknown-paper"
    )
    .join("; ");
  return `${preview}${entries.length > 3 ? "; ..." : ""}`;
}


async function hydrateReviewIssueTrackerState(params: {
  projectRoot: string;
  value: unknown;
}): Promise<ReviewIssueTrackerState> {
  const state = normalizeReviewIssueTrackerState(params.value);
  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.issueManifestPath
  );
  if (!issueManifestResolvedPath || !(await pathExists(issueManifestResolvedPath))) {
    return state;
  }
  const issueManifest = await readJsonIfExists<Record<string, unknown> | unknown[]>(
    issueManifestResolvedPath
  );
  if (!issueManifest) {
    return state;
  }
  const issueManifestRecord = asRecord(issueManifest);
  if (issueManifestRecord) {
    const hydratedState = normalizeReviewIssueTrackerState(issueManifestRecord);
    const hasExplicitCounts =
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "open_counts") ||
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "openCounts");
    return {
      ...state,
      status: hydratedState.status ?? state.status,
      issues: hydratedState.issues.length > 0 ? hydratedState.issues : state.issues,
      openCounts: hasExplicitCounts ? hydratedState.openCounts : state.openCounts,
      scoreRecords:
        hydratedState.scoreRecords.length > 0 ? hydratedState.scoreRecords : state.scoreRecords,
      lastReviewRound:
        hydratedState.lastReviewRound > 0 ? hydratedState.lastReviewRound : state.lastReviewRound,
      lastUpdatedAt: hydratedState.lastUpdatedAt ?? state.lastUpdatedAt,
      pendingReason: hydratedState.pendingReason ?? state.pendingReason,
    };
  }
  const hydrated = summarizeReviewIssuesFromManifest(issueManifest);
  return {
    ...state,
    issues: hydrated.issues,
    openCounts: hydrated.counts,
  };
}

function getTracks(trackRegistry: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const tracks = trackRegistry?.tracks;
  return Array.isArray(tracks)
    ? tracks.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function getActiveTracks(trackRegistry: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return getTracks(trackRegistry).filter((track) => normalizeStage(track.status) === "active");
}

function formatWorkflowTrackLabel(track: Record<string, unknown>, fallbackIndex: number): string {
  return (
    pickString(track, ["track_id", "trackId", "id", "name"]) ??
    `track-${fallbackIndex + 1}`
  );
}

async function summarizeWorkflowDerivedEvidence(params: {
  projectRoot: string | null;
  trackRegistry: Record<string, unknown> | null;
  currentStage: string | null;
}): Promise<WorkflowDerivedEvidenceSummary> {
  if (!params.projectRoot) {
    return {
      status: "ready",
      summary: null,
      diagnostics: [],
    };
  }

  const activeTracks = getActiveTracks(params.trackRegistry).slice(0, 4);
  if (activeTracks.length === 0) {
    return {
      status: "ready",
      summary: null,
      diagnostics: [],
    };
  }

  const diagnostics: string[] = [];
  let sawRepairable = false;
  let sawMissing = false;

  for (const [index, track] of activeTracks.entries()) {
    const trackLabel = formatWorkflowTrackLabel(track, index);
    const evidence = await loadTrackInnovationEvidence({
      projectRoot: params.projectRoot,
      track,
    });
    const readiness = resolveStageReadiness({
      stage: params.currentStage,
      trackEvidence: evidence,
    });
    const handoff = resolveHandoffEligibility(readiness);

    if (handoff.recommendedAction === "repair_artifact") {
      sawRepairable = true;
      const detail =
        evidence.presence === "invalid"
          ? "invalid GRAPH_EVIDENCE.json payload"
          : evidence.presence === "file_backed" || evidence.presence === "mixed"
            ? "file-backed GRAPH_EVIDENCE.json pending canonicalization"
            : "workflow-owned graph evidence repair pending";
      diagnostics.push(`track ${trackLabel}: ${detail}`);
      continue;
    }

    if (handoff.recommendedAction === "background") {
      sawMissing = true;
      diagnostics.push(
        `track ${trackLabel}: ${
          evidence.graphEvidencePath ? "missing GRAPH_EVIDENCE.json" : "missing graph-backed evidence"
        }`
      );
      continue;
    }

    diagnostics.push(
      `track ${trackLabel}: ${
        evidence.presence === "inline_only"
          ? "inline graph evidence present"
          : "graph evidence ready"
      }`
    );
  }

  const status: WorkflowEvidenceStatus = sawMissing
    ? "missing"
    : sawRepairable
      ? "repairable"
      : "ready";

  return {
    status,
    summary: diagnostics.length > 0 ? `${status}: ${diagnostics.slice(0, 2).join("; ")}` : null,
    diagnostics,
  };
}

function isLocalPapernexusStoragePath(value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  if (/\bPAPERNEXUS_ROOT\b/i.test(raw)) {
    return true;
  }
  const normalized = raw.replace(/\\/g, "/");
  return /(?:^|[=\s"'`])(?:~|\$HOME|\$\{HOME\}|\/[^\s"'`|;&]*)\/\.papernexus\/(?:papers|index-store)(?:\/|$)/i.test(
    normalized
  );
}

function isRemoteOnlyPapernexusWorkflow(params: {
  apiBaseUrl: string | null | undefined;
  mcpUrl?: string | null | undefined;
}): boolean {
  return Boolean(
    (params.apiBaseUrl && params.apiBaseUrl.trim()) ||
      (params.mcpUrl && params.mcpUrl.trim())
  );
}

function getDefaultPapernexusSourceDir(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return path.join(os.homedir(), ".papernexus", "papers", projectId);
}

function getDefaultPapernexusIndexRoot(): string {
  return path.join(os.homedir(), ".papernexus", "index-store");
}

function areWritingSectionPacketsReady(
  state: ReturnType<typeof normalizeWritingSessionState>
): boolean {
  const packets = Object.values(state.sectionPackets);
  return (
    packets.length > 0 &&
    packets.every((packet) => {
      const packetStatus = normalizeStage(packet.status);
      const reviewVerdict = normalizeStage(packet.reviewVerdict);
      return (
        !packet.stale &&
        packet.forbiddenUnsupportedClaims.length === 0 &&
        packet.missingCitationPlaceholders.length === 0 &&
        (packetStatus === "finalized" ||
          packetStatus === "locked" ||
          packetStatus === "compile_safe" ||
          reviewVerdict === "publication_ready")
      );
    })
  );
}

export async function buildWorkflowSnapshotFromProjectState(
  params: {
    policy: WorkflowGuardPolicy;
    agentId?: string;
    projectState: WorkflowProjectState;
  },
  deps: WorkflowSnapshotBuilderDeps = {}
): Promise<WorkflowSnapshot> {
  const policy = params.policy;
  const projectState = params.projectState;
  const role = normalizeWorkflowRole(params.agentId);
  const currentStage = resolveStageForWorkflowLine({
    stage: normalizeStage(projectState.manifest?.current_stage),
    manifest: projectState.manifest,
  });
  const missingStageSignals =
    projectState.projectRoot && currentStage && deps.getMissingStageSignals
      ? await deps.getMissingStageSignals({
          projectRoot: projectState.projectRoot,
          manifest: projectState.manifest,
          trackRegistry: projectState.trackRegistry,
          experimentLedger: projectState.experimentLedger,
          currentStage,
        })
      : [];
  const blockingReasonRaw = asString(projectState.manifest?.blocking_reason);
  const derivedEvidence = await summarizeWorkflowDerivedEvidence({
    projectRoot: projectState.projectRoot,
    trackRegistry: projectState.trackRegistry,
    currentStage,
  });
  const blockingReason =
    derivedEvidence.status === "ready"
      ? /^waiting for .+ to satisfy:/i.test(blockingReasonRaw ?? "")
        ? null
        : blockingReasonRaw
      : derivedEvidence.summary ?? blockingReasonRaw;
  const unreadMailbox = filterStaleAutoIteratorMailboxItems({
    items: inboxForRole({
      mailbox: projectState.mailbox,
      role,
      limit:
        typeof policy.maxWorkflowInboxMessages === "number" &&
        Number.isFinite(policy.maxWorkflowInboxMessages)
          ? Math.max(1, Math.floor(policy.maxWorkflowInboxMessages))
          : 6,
    }),
    currentStage,
    missingStageSignals,
  });
  const paperIngestion = asRecord(projectState.manifest?.paper_ingestion);
  const paperIngestionState = normalizePaperIngestionState(paperIngestion);
  const bootstrapRequest =
    projectState.manifest?.bootstrap_request &&
    typeof projectState.manifest.bootstrap_request === "object" &&
    !Array.isArray(projectState.manifest.bootstrap_request)
      ? (projectState.manifest.bootstrap_request as Record<string, unknown>)
      : null;
  const papernexusProgress = projectState.projectRoot
    ? await loadPapernexusProgress({
        projectRoot: projectState.projectRoot,
        manifest: projectState.manifest,
        writeIfMissing: false,
      })
    : null;
  const papernexusProgressSummary = summarizePapernexusProgress(papernexusProgress);
  const paperIngestionActiveOperationCount = paperIngestionState.paperOperations.filter(
    (entry) => entry.status === "queued" || entry.status === "running"
  ).length;
  const paperIngestionTimedOutOperationCount = paperIngestionState.paperOperations.filter(
    (entry) => entry.status === "timed_out"
  ).length;
  const paperIngestionFailedOperationCount = paperIngestionState.paperOperations.filter(
    (entry) => entry.status === "failed"
  ).length;
  const paperIngestionBatchCount = paperIngestionState.activeBatches.length;
  const paperIngestionActiveBatchCount = paperIngestionState.activeBatches.filter(
    (entry) => entry.status === "queued" || entry.status === "running"
  ).length;
  const paperIngestionPendingBatchItemCount = paperIngestionState.batchItems.filter(
    (entry) => entry.status === "pending" || entry.status === "running"
  ).length;
  const paperIngestionSyncedBatchItemCount = paperIngestionState.batchItems.filter(
    (entry) => entry.synced === true || entry.status === "completed"
  ).length;
  const paperIngestionFailedBatchItemCount = paperIngestionState.batchItems.filter(
    (entry) => entry.status === "failed" || entry.status === "submit_failed"
  ).length;
  const paperIngestionQueuedRequestCount = paperIngestionState.queuedRequests.filter(
    (entry) => entry.status === "queued" || entry.status === "needs_repair"
  ).length;
  const paperIngestionRunningRequestCount = paperIngestionState.queuedRequests.filter(
    (entry) => entry.status === "launching" || entry.status === "running"
  ).length;
  const experimentMemory = asRecord(projectState.manifest?.experiment_memory);
  const idleResearch = normalizeIdleResearchState(asRecord(projectState.manifest?.idle_research));
  const innovationReflection = normalizeInnovationReflectionState(
    asRecord(projectState.manifest?.innovation_reflection)
  );
  const brainstormCycle = normalizeBrainstormCycleState(
    asRecord(projectState.manifest?.brainstorm_cycle)
  );
  const surveyReview = normalizeSurveyReviewState(
    asRecord(projectState.manifest?.survey_review)
  );
  const ideationContract = normalizeIdeationContractState(
    asRecord(projectState.manifest?.ideation_contract)
  );
  const ideaCatalyst = normalizeIdeaCatalystState(
    asRecord(projectState.manifest?.idea_catalyst)
  );
  const experimentSearch = projectState.projectRoot
    ? await loadExperimentSearchState({
        projectRoot: projectState.projectRoot,
        manifest: projectState.manifest,
        readJsonIfExists,
      })
    : normalizeExperimentSearchState(asRecord(projectState.manifest?.experiment_search));
  const autonomousExecution = normalizeAutonomousExecutionState(
    asRecord(projectState.manifest?.autonomous_execution)
  );
  const experimentReview = projectState.projectRoot
    ? await loadExperimentReviewState({
        projectRoot: projectState.projectRoot,
        manifest: projectState.manifest,
      })
    : undefined;
  const experimentSearchReview = projectState.projectRoot
    ? await loadExperimentSearchReviewState({
        projectRoot: projectState.projectRoot,
        manifest: projectState.manifest,
      })
    : undefined;
  const experimentReviewState =
    experimentReview ??
    normalizeExperimentReviewState(asRecord(projectState.manifest?.experiment_review_state));
  const researchProgram = normalizeResearchProgramState(
    asRecord(projectState.manifest?.research_program)
  );
  const benchmarkProtocol = normalizeBenchmarkProtocolState(
    asRecord(projectState.manifest?.benchmark_protocol)
  );
  const statisticalEvidence = normalizeStatisticalEvidenceState(
    asRecord(projectState.manifest?.statistical_evidence)
  );
  const venueCompetition = normalizeVenueCompetitionState(
    asRecord(projectState.manifest?.venue_competition)
  );
  const ablationEvidence = normalizeAblationEvidenceState(
    asRecord(projectState.manifest?.ablation_evidence)
  );
  const mechanismEvidence = normalizeMechanismEvidenceState(
    asRecord(projectState.manifest?.mechanism_evidence)
  );
  const reproducibilityPack = normalizeReproducibilityPackState(
    asRecord(projectState.manifest?.reproducibility_pack)
  );
  const cameraReadyEvidence = normalizeCameraReadyEvidenceState(
    asRecord(projectState.manifest?.camera_ready_evidence)
  );
  const opportunityScorecard = normalizeOpportunityScorecardState(
    asRecord(projectState.manifest?.opportunity_scorecard)
  );
  const writingContract = normalizeWritingContractState(
    asRecord(projectState.manifest?.writing_contract)
  );
  const evidenceCloseout = summarizeEvidenceCloseoutState(projectState.manifest);
  const teamTaskPreview = buildWorkflowStageTaskPreview({
    currentStage,
    topTierVerdict: opportunityScorecard.verdict,
    evidenceCloseout,
    writingSectionOrder: writingContract.sectionOrder,
  });
  const taskGraphStore = projectState.projectRoot
    ? await readWorkflowTaskGraphStore(projectState.projectRoot)
    : null;
  const taskGraphSummary = summarizeWorkflowTaskGraphStore(taskGraphStore);
  const teamRoundStore = projectState.projectRoot
    ? await readWorkflowTeamRoundStore(projectState.projectRoot)
    : null;
  const teamRoundSummary = summarizeWorkflowTeamRoundStore(teamRoundStore);
  const researchProgramOnboardingMissing = getResearchProgramOnboardingGaps({
    state: researchProgram,
    projectId: projectState.projectId,
  });
  const zoteroSyncState = projectState.projectRoot
    ? await readZoteroSyncStateSummary({
        projectRoot: projectState.projectRoot,
        projectId: projectState.projectId,
        zoteroProjectRoot: policy.zoteroProjectRoot,
      })
    : {
        projectId: projectState.projectId,
        zoteroProjectPath: null,
        status: null,
        trigger: null,
        triggerReason: null,
        lastRequestedAt: null,
        collectionFingerprint: null,
        graphLastBuiltAtSeen: null,
        activeExperimentIdsSeen: [],
        activeExperimentFingerprintSeen: null,
        packetPath: "researcher/ZOTERO_SYNC_PACKET.json",
        markdownPath: "researcher/ZOTERO_PACKET.md",
      };
  const pendingAutoZoteroSync = projectState.projectRoot
    ? await deriveAutoZoteroSyncCandidate({
        projectRoot: projectState.projectRoot,
        projectId: projectState.projectId,
        zoteroProjectRoot: policy.zoteroProjectRoot,
      })
    : {
        shouldLaunch: false,
        trigger: null,
        triggerReason: null,
        dedupeKey: null,
        collectionFingerprint: null,
        graphLastBuiltAt: null,
        activeExperimentIds: [],
        activeExperimentFingerprint: null,
        zoteroProjectPath: null,
        packetPath: "researcher/ZOTERO_SYNC_PACKET.json",
        markdownPath: "researcher/ZOTERO_PACKET.md",
        currentPaperCount: 0,
        status: null,
      };
  const orchestrationState = normalizeOrchestrationState(
    asRecord(projectState.manifest?.orchestration_state)
  );
  const writePackage = normalizeWritePackageState(
    asRecord(projectState.manifest?.write_package)
  );
  const theorySupport = normalizeTheorySupportState(
    asRecord(projectState.manifest?.theory_state)
  );
  const citationIntegrity = normalizeCitationIntegrityState(
    asRecord(projectState.manifest?.citation_integrity)
  );
  const authoringRecovery = projectState.projectRoot
    ? await restoreAuthoringArtifactsFromRecovery({
        projectRoot: projectState.projectRoot,
      }).catch(() => null)
    : null;
  const recoveredWritingSession =
    authoringRecovery?.store?.writingSession &&
    typeof authoringRecovery.store.writingSession === "object" &&
    !Array.isArray(authoringRecovery.store.writingSession)
      ? asRecord(authoringRecovery.store.writingSession)
      : null;
  const writingSession = normalizeWritingSessionState(
    writingSessionLooksRecoverableEmpty(
      asRecord(projectState.manifest?.writing_session)
    ) && recoveredWritingSession
      ? recoveredWritingSession
      : asRecord(projectState.manifest?.writing_session)
  );
  const writingProcess = evaluateWritingProcessReadiness({
    writingSession,
    writingContract,
  });
  if (projectState.projectRoot) {
    await syncAuthoringArtifactRecovery({
      projectRoot: projectState.projectRoot,
      writingSession: {
        ...serializeWritingSessionState(writingSession),
        process_status: writingProcess.processStatus,
        drafted_sections: writingProcess.draftedSections,
        reviewed_sections: writingProcess.reviewedSections,
        manuscript_complete: [
          "manuscript_complete",
          "compile_ready",
          "ready_for_submit",
        ].includes(writingProcess.processStatus),
        compile_ready: ["compile_ready", "ready_for_submit"].includes(
          writingProcess.processStatus
        ),
        next_suggested_section: writingProcess.nextSuggestedSection,
        rebuild_needed: writingProcess.rebuildNeeded,
        rebuild_reason: writingProcess.rebuildReason,
        outline_ready: !["missing", "bootstrapping"].includes(
          writingProcess.processStatus
        ),
      },
    }).catch(() => null);
  }
  const reviewSession = normalizeReviewSessionState(
    asRecord(projectState.manifest?.review_session)
  );
  const cachedRevisionControl = normalizeRevisionControlState(
    asRecord(projectState.manifest?.revision_control_state)
  );
  const derivedRevisionControl = projectState.projectRoot
    ? (await deriveRevisionControlState({
        projectRoot: projectState.projectRoot,
        stage: currentStage,
      })).state
    : cachedRevisionControl;
  const revisionControl =
    derivedRevisionControl.status === "idle" && cachedRevisionControl.status !== "idle"
      ? cachedRevisionControl
      : derivedRevisionControl;
  const autoDispatchDiagnostics = normalizeAutoDispatchDiagnosticsState(
    asRecord(projectState.manifest?.auto_dispatch_diagnostics)
  );
  const paragraphLogicAudit = normalizeParagraphLogicAuditState(
    asRecord(projectState.manifest?.paragraph_logic_audit)
  );
  const executionProof = normalizeExecutionProofState(
    asRecord(projectState.manifest?.execution_proof)
  );
  const graphGuidedWriting = normalizeGraphGuidedWritingState(
    asRecord(projectState.manifest?.graph_guided_writing)
  );
  const paperStoryState = normalizePaperStoryState(
    asRecord(projectState.manifest?.paper_story_state)
  );
  const reviewPressurePacket = normalizeReviewPressurePacketState(
    asRecord(projectState.manifest?.review_pressure_packet)
  );
  const paperQc = normalizePaperQcState(asRecord(projectState.manifest?.paper_qc));
  const figureQc = normalizeFigureQcState(asRecord(projectState.manifest?.figure_qc));
  const citationCollection = normalizeCitationCollectionState(
    asRecord(projectState.manifest?.citation_collection)
  );
  const reviewIssueTracker = projectState.projectRoot
    ? await hydrateReviewIssueTrackerState({
        projectRoot: projectState.projectRoot,
        value: asRecord(projectState.manifest?.review_issue_tracker),
      })
    : normalizeReviewIssueTrackerState(
        asRecord(projectState.manifest?.review_issue_tracker)
      );
  const externalReview = normalizeExternalReviewState(
    asRecord(projectState.manifest?.external_review_state)
  );
  const surveyVisualCompiler = normalizeSurveyVisualCompilerState(
    asRecord(projectState.manifest?.survey_visual_compiler_state)
  );
  const surveyMethodologyConsistency =
    asRecord(projectState.manifest?.survey_methodology_consistency) ?? {};
  const autoGate = policy.autoGate ?? DEFAULT_WORKFLOW_AUTO_GATE;
  const currentStageGateMode = resolveWorkflowAutoGateModeForStage({
    stage: currentStage,
    config: autoGate,
  });
  const reviewIssueLaneCounts = countReviewIssueLanes(reviewIssueTracker.issues);
  const recommendedOwner =
    normalizeWorkflowRole(orchestrationState.pendingOwnerCandidate) ??
    (currentStage ? STAGE_REQUIREMENTS[currentStage]?.owner ?? null : null);
  const recentExperiments = buildExperimentMemoryDigest(
    projectState.experimentLedger as Parameters<typeof buildExperimentMemoryDigest>[0],
    5
  );
  const experimentLedgerSummary = asRecord(
    (projectState.experimentLedger as Record<string, unknown> | null)?.summary
  );
  const experimentGpuMonitor = projectState.projectRoot
    ? await getExperimentGpuMonitorStateSummary({
        projectRoot: projectState.projectRoot,
      })
    : {
        state: {
          status: "missing",
          checkedAt: null,
          serverCount: 0,
          busyAssignedGpuCount: 0,
          idleAssignedGpuCount: 0,
          likelyFinishedRunCount: 0,
          recommendation: "none",
          monitorPath: null,
        } as any,
        ready: false,
      };
  const experimentActiveRunCount =
    Array.isArray(experimentLedgerSummary?.activeExperimentIds)
      ? experimentLedgerSummary.activeExperimentIds.length
      : 0;
  const experimentTerminalRunCount = countTerminalExperimentEntries(
    projectState.experimentLedger
  );
  const experimentFinishedUnreconciledCount =
    countFinishedExperimentEntriesAwaitingReconciliation({
      ledger: projectState.experimentLedger,
      experimentSearch,
    });
  const experimentNeedsMonitorPass =
    experimentActiveRunCount > 0 || experimentFinishedUnreconciledCount > 0;
  const experimentSyncRequired =
    experimentLedgerSummary?.papernexusSyncRequired === true ||
    experimentMemory?.papernexus_sync_required === true;
  const experimentPapernexusSyncStatus =
    asString(experimentMemory?.papernexus_sync_status) ??
    (experimentLedgerSummary?.papernexusSyncRequired
      ? "pending"
      : experimentLedgerSummary?.papernexusLastSyncAt
        ? "synced"
        : null);
  const experimentSearchSpec = projectState.projectRoot
    ? await readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(
          projectState.projectRoot,
          experimentSearch.searchSpecPath
        ) ?? ""
      )
    : null;
  const experimentSearchDecision = evaluateExperimentSearchDecision({
    experimentSearch,
    experimentSearchSpec,
    experimentLedger: projectState.experimentLedger,
    gpuMonitor: experimentGpuMonitor.state,
  });
  const innovationReflectionDue = isInnovationReflectionDue({
    state: innovationReflection,
    ledger: projectState.experimentLedger,
  });
  const writingContractEval = await evaluateWritingContractState({
    projectRoot: projectState.projectRoot,
    state: writingContract,
  });
  const resolvedCitationBibliographyPath = resolveProjectArtifactPath(
    projectState.projectRoot,
    citationIntegrity.bibliographyPath
  );
  const resolvedCitationReportPath = resolveProjectArtifactPath(
    projectState.projectRoot,
    citationIntegrity.verificationReportPath
  );
  const papernexusAccessConfigured =
    (policy.papernexusApiBaseUrl ?? "").trim().length > 0 ||
    (policy.papernexusMcpUrl ?? "").trim().length > 0 ||
    (policy.papernexusApiTokenEnv ?? "").trim().length > 0 ||
    (policy.papernexusMineruHttpUrl ?? "").trim().length > 0 ||
    normalizePapernexusApiTokenSource(policy.papernexusApiTokenSource) !== "auto" ||
    ((policy.papernexusApiTokenService ?? "").trim().length > 0 &&
      (policy.papernexusApiTokenService ?? "").trim() !== "papernexus-api-token") ||
    ((policy.papernexusApiTokenAccount ?? "").trim().length > 0 &&
      (policy.papernexusApiTokenAccount ?? "").trim() !== "default");
  const papernexusAccess = papernexusAccessConfigured
    ? summarizePapernexusRemoteAccessConfig({
        apiBaseUrl: policy.papernexusApiBaseUrl,
        mcpUrl: policy.papernexusMcpUrl,
        mcpTransport: policy.papernexusMcpTransport,
        mcpTimeoutMs: policy.papernexusMcpTimeoutMs,
        tokenEnv: policy.papernexusApiTokenEnv,
        tokenSource: policy.papernexusApiTokenSource,
        tokenService: policy.papernexusApiTokenService,
        tokenAccount: policy.papernexusApiTokenAccount,
        mineruHttpUrl: policy.papernexusMineruHttpUrl,
        tokenLookupTimeoutMs: policy.papernexusApiTokenLookupTimeoutMs,
      })
    : null;
  const remoteOnlyPapernexus = isRemoteOnlyPapernexusWorkflow({
    apiBaseUrl: papernexusAccess?.apiBaseUrl ?? null,
    mcpUrl: papernexusAccess?.mcpUrl ?? null,
  });
  const runtimeBinding = projectState.channelBinding
    ? buildWorkflowRuntimeSessionBinding({
        projectRoot: projectState.channelBinding.projectRoot,
        projectId: projectState.channelBinding.projectId,
        role: projectState.channelBinding.workflowRole,
        sessionKey: projectState.channelBinding.workflowSessionKey,
        sessionId: projectState.channelBinding.workflowSessionId,
        parentSessionKey: projectState.channelBinding.parentWorkflowSessionKey,
        threadBindingKey: projectState.channelBinding.threadBindingKey,
        depth: projectState.channelBinding.depth,
      })
    : null;
  const defaultPapernexusSourceDir = remoteOnlyPapernexus
    ? null
    : getDefaultPapernexusSourceDir(projectState.projectId);
  const defaultPapernexusIndexRoot = remoteOnlyPapernexus
    ? null
    : getDefaultPapernexusIndexRoot();
  const resolvedPaperSourceDir = (() => {
    const value = asString(projectState.manifest?.paper_source_dir) ?? null;
    if (remoteOnlyPapernexus && isLocalPapernexusStoragePath(value)) {
      return null;
    }
    return value;
  })();
  const resolvedGraphSourceDir = (() => {
    const value = asString(projectState.manifest?.graph_source_dir) ?? null;
    if (remoteOnlyPapernexus && isLocalPapernexusStoragePath(value)) {
      return null;
    }
    return value;
  })();

  const snapshotBase: Omit<
    WorkflowSnapshot,
    | "stateRevision"
    | "stateUpdatedAt"
    | "autoIteratorAuditStatus"
    | "autoIteratorAuditFreshness"
    | "autoIteratorAuditUpdatedAt"
    | "autoIteratorAuditRunId"
    | "autoIteratorAuditStageBefore"
    | "autoIteratorAuditStageAfter"
    | "autoIteratorAuditMatchesLiveState"
    | "autoIteratorAuditSummary"
  > = {
    projectRoot: projectState.projectRoot,
    projectId: projectState.projectId,
    projectResolutionSource: projectState.projectResolutionSource,
    channelProjectBindingsEnabled: policy.enableChannelProjectBindings === true,
    channelProjectBindingKey: projectState.channelBindingKey,
    channelProjectBindingStorePath: projectState.channelBindingStorePath,
    channelProjectBindingWorkflowRole: runtimeBinding?.role ?? null,
    channelProjectBindingWorkflowSessionKey: runtimeBinding?.sessionKey ?? null,
    channelProjectBindingWorkflowSessionId: runtimeBinding?.sessionId ?? null,
    channelProjectBindingParentSessionKey: runtimeBinding?.parentSessionKey ?? null,
    channelProjectBindingThreadBindingKey: runtimeBinding?.threadBindingKey ?? null,
    channelProjectBindingDepth: runtimeBinding?.depth ?? null,
    channelProjectBindingLineageKey: runtimeBinding?.lineageKey ?? null,
    channelProjectBindingMode: runtimeBinding?.bindingMode ?? "channel_only",
    role,
    currentStage,
    currentMicroStage: normalizeStage(projectState.manifest?.current_micro_stage),
    ownerAgent:
      orchestrationState.currentOwner ?? asString(projectState.manifest?.owner_agent),
    recommendedOwner,
    nextAction: asString(projectState.manifest?.next_action),
    resumeAction: asString(projectState.manifest?.resume_action),
    blockingReason,
    workflowEvidenceStatus: derivedEvidence.status,
    workflowEvidenceSummary: derivedEvidence.summary,
    allowedWriteScopes: role ? ROLE_POLICIES[role].writeScopeLabels : [],
    allowedContacts: role
      ? Array.from(
          new Set(
            [
              ...ROLE_POLICIES[role].allowedContacts,
              ...(role === recommendedOwner
                ? [getForwardStageHandoffTargetRole(currentStage)]
                : []),
            ].filter((value): value is WorkflowRole => Boolean(value))
          )
        )
      : [],
    allowedSpawns: role
      ? Array.from(
          new Set(
            [
              ...ROLE_POLICIES[role].allowedSpawns,
              ...(role === recommendedOwner
                ? [getForwardStageHandoffTargetRole(currentStage)]
                : []),
            ].filter((value): value is WorkflowRole => Boolean(value))
          )
        )
      : [],
    missingStageSignals,
    graphRefreshRequired: paperIngestion?.refresh_required === true,
    graphRefreshReason: asString(paperIngestion?.refresh_reason),
    graphLastBuiltAt: asString(projectState.manifest?.graph_last_built_at),
    graphPresenceCheckedAt: asString(paperIngestion?.graph_presence_checked_at),
    graphPresenceStatus: normalizeGraphPresenceStatus(
      paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
    ),
    graphPresenceReportPath: asString(
      paperIngestion?.graph_presence_report_path ?? paperIngestion?.graphPresenceReportPath
    ),
    graphPresenceExpectedPapers: pickNumber(paperIngestion ?? {}, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
    ]),
    graphPresencePresentPapers: pickNumber(paperIngestion ?? {}, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
    ]),
    graphPresenceMissingPapers:
      getGraphPresenceMissingEntries(paperIngestion).length ||
      pickNumber(paperIngestion ?? {}, [
        "graph_presence_missing_count",
        "graphPresenceMissingCount",
      ]),
    paperIngestionRuntimeStatus: paperIngestionState.runtimeStatus,
    paperIngestionWaitingReason: paperIngestionState.waitingReason,
    paperIngestionImportTaskCount: paperIngestionState.importTaskIds.length,
    paperIngestionCompletedPaperCount: paperIngestionState.completedPapers.length,
    paperIngestionActiveOperationCount,
    paperIngestionTimedOutOperationCount,
    paperIngestionFailedOperationCount,
    paperIngestionBatchCount,
    paperIngestionActiveBatchCount,
    paperIngestionPendingBatchItemCount,
    paperIngestionSyncedBatchItemCount,
    paperIngestionFailedBatchItemCount,
    paperIngestionQueuedRequestCount,
    paperIngestionRunningRequestCount,
    paperIngestionLastBatchManifestPath: paperIngestionState.lastBatchManifestPath,
    paperIngestionLastImportStatus: paperIngestionState.lastImportStatus,
    paperIngestionGraphVersionSeen: paperIngestionState.graphVersionSeen,
    paperIngestionReconcileRequired: paperIngestionState.reconcileRequired,
    paperIngestionRepairRequired: paperIngestionState.repairRequired,
    paperIngestionRepairReason: paperIngestionState.repairReason,
    paperIngestionRepairTargetCorpus: paperIngestionState.repairTargetCorpus,
    papernexusProgress,
    papernexusProgressSummary,
    paperSourceDir: resolvedPaperSourceDir,
    graphSourceDir: resolvedGraphSourceDir,
    defaultPapernexusSourceDir,
    defaultPapernexusIndexRoot,
    papernexusApiBaseUrl: papernexusAccess?.apiBaseUrl ?? null,
    papernexusMcpUrl: papernexusAccess?.mcpUrl ?? null,
    papernexusMcpTransport: papernexusAccess?.mcpTransport ?? null,
    papernexusMcpTimeoutMs: papernexusAccess?.mcpTimeoutMs ?? null,
    papernexusApiTokenEnv: papernexusAccess?.tokenEnv ?? null,
    papernexusApiTokenSource: papernexusAccess?.tokenSourceConfigured ?? null,
    papernexusApiTokenService: papernexusAccess?.tokenService ?? null,
    papernexusApiTokenAccount: papernexusAccess?.tokenAccount ?? null,
    papernexusMineruHttpUrl: papernexusAccess?.mineruHttpUrl ?? null,
    papernexusAccessMode:
      typeof policy?.papernexusAccessMode === "string" ? policy.papernexusAccessMode : null,
    idleResearchEnabled: idleResearch.enabled,
    idleResearchTopic: idleResearch.topic,
    idleResearchStatus: idleResearch.status,
    idleResearchDue: isIdleResearchDue(idleResearch),
    idleResearchCooldownMinutes: idleResearch.cooldownMinutes,
    idleResearchLastRunAt: idleResearch.lastRunAt,
    idleResearchNextDueAt: computeIdleResearchNextDueAt(idleResearch),
    idleResearchDigestPath: idleResearch.lastDigestPath,
    experimentLedgerPath: projectState.projectRoot ? "researcher/EXPERIMENT_LEDGER.json" : null,
    experimentLedgerUpdatedAt:
      asString((projectState.experimentLedger as Record<string, unknown> | null)?.updatedAt) ??
      asString(experimentMemory?.last_ledger_update_at),
    experimentActiveRunCount,
    experimentTerminalRunCount,
    experimentFinishedUnreconciledCount,
    experimentNeedsMonitorPass,
    experimentMonitorRecommendedCommand: experimentNeedsMonitorPass
      ? "/monitor-experiment"
      : null,
    experimentGpuMonitorStatus: experimentGpuMonitor.state.status,
    experimentGpuMonitorCheckedAt: experimentGpuMonitor.state.checkedAt,
    experimentGpuMonitorServerCount: experimentGpuMonitor.state.serverCount,
    experimentGpuMonitorBusyAssignedGpuCount:
      experimentGpuMonitor.state.busyAssignedGpuCount,
    experimentGpuMonitorIdleAssignedGpuCount:
      experimentGpuMonitor.state.idleAssignedGpuCount,
    experimentGpuMonitorLikelyFinishedRunCount:
      experimentGpuMonitor.state.likelyFinishedRunCount,
    experimentGpuMonitorRecommendation:
      experimentGpuMonitor.state.recommendation,
    experimentGpuMonitorPath: experimentGpuMonitor.state.monitorPath,
    experimentSyncRequired,
    experimentPapernexusSyncStatus,
    innovationReflectionStatus: innovationReflection.status,
    innovationReflectionDue,
    innovationReflectionLastAt: innovationReflection.lastReflectionAt,
    innovationReflectionPath: innovationReflection.lastReflectionPath,
    innovationReflectionPendingReason: innovationReflection.pendingReason,
    brainstormCycleStatus: brainstormCycle.status,
    brainstormCycleTopic: brainstormCycle.topic,
    brainstormCycleBasisStage: brainstormCycle.basisStage,
    brainstormCycleTrackId: brainstormCycle.trackId,
    brainstormCycleProvider: brainstormCycle.provider,
    brainstormCycleProviderMode: brainstormCycle.providerMode,
    brainstormCycleProviderStatus: brainstormCycle.providerStatus,
    brainstormCycleContractVersion: brainstormCycle.contractVersion,
    brainstormCycleGraphVersionSeen: brainstormCycle.graphVersionSeen,
    brainstormCycleImportTaskCount: brainstormCycle.importTaskIdsSeen.length,
    brainstormCycleChainBundleReady:
      isBrainstormCycleReady(brainstormCycle) &&
      getBrainstormCycleValidationErrors(brainstormCycle).length === 0,
    brainstormCyclePendingReason: brainstormCycle.pendingReason,
    surveyReviewStatus: surveyReview.status,
    surveyReviewCurrentPhase: surveyReview.currentPhase,
    surveyReviewTopic: surveyReview.topic,
    surveyReviewMode: surveyReview.mode,
    surveyReviewCandidatePaperCount: surveyReview.candidatePaperCount,
    surveyReviewIncludedPaperCount: surveyReview.includedPaperCount,
    surveyReviewExcludedPaperCount: surveyReview.excludedPaperCount,
    surveyReviewQueryRoundCount: surveyReview.queryRoundCount,
    surveyReviewGraphGroundedBriefReady: surveyReview.graphGroundedBriefReady,
    surveyReviewDiagnosticsPath: surveyReview.diagnosticsPath,
    surveyReviewGateReady: surveyReview.gateReady,
    surveyReviewCoverageStatus: surveyReview.coverageStatus,
    surveyReviewTaxonomyStabilityStatus: surveyReview.taxonomyStabilityStatus,
    surveyReviewRepresentativeMethodsStatus:
      surveyReview.representativeMethodsStatus,
    surveyReviewBenchmarkAlignmentStatus:
      surveyReview.benchmarkAlignmentStatus,
    surveyReviewGapClosureStatus: surveyReview.gapClosureStatus,
    surveyReviewSurveyBriefPath: surveyReview.surveyBriefPath,
    surveyReviewGateBlockingIssueCount: surveyReview.gateBlockingIssues.length,
    surveyReviewPendingReason: surveyReview.pendingReason,
    ideationContractStatus: ideationContract.status,
    ideationContractSelectedDirectionId: ideationContract.selectedDirectionId,
    ideationContractSelectedTrackId: ideationContract.selectedTrackId,
    ideationContractIdeaTreePath: ideationContract.ideaTreePath,
    ideationContractResearchProposalPath: ideationContract.researchProposalPath,
    ideationContractRankingHistoryPath: ideationContract.rankingHistoryPath,
    ideationContractTournamentScoreboardPath: ideationContract.tournamentScoreboardPath,
    ideationContractTop3SummaryPath: ideationContract.top3SummaryPath,
    ideationContractGraphPacketPath: ideationContract.graphIdeationPacketPath,
    ideationContractBridgeEvidenceTier: ideationContract.graphIdeationIndices.bridgeEvidenceTier,
    ideationContractCandidateSourceDomainCount:
      ideationContract.graphIdeationIndices.candidateSourceDomains.length,
    ideationContractSelectedSourceDomainCount:
      ideationContract.graphIdeationIndices.selectedSourceDomains.length,
    ideationContractPendingReason: ideationContract.pendingReason,
    ideaCatalystStatus: ideaCatalyst.status,
    ideaCatalystMode: ideaCatalyst.mode,
    ideaCatalystMicroStage: ideaCatalyst.microStage,
    ideaCatalystTargetDomain: ideaCatalyst.targetDomain,
    ideaCatalystSourceDomainCount: ideaCatalyst.sourceDomains.length,
    ideaCatalystBridgeCount: ideaCatalyst.bridgeCount,
    ideaCatalystTopFragmentId: ideaCatalyst.topFragmentId,
    ideaCatalystRequisitionRequired: ideaCatalyst.requisitionRequired,
    ideaCatalystLastRequisitionCycle: ideaCatalyst.lastRequisitionCycle,
    ideaCatalystRequisitionRetryBudget: ideaCatalyst.requisitionRetryBudget,
    ideaCatalystRequisitionSaturated: ideaCatalyst.requisitionSaturated,
    ideaCatalystPendingReason: ideaCatalyst.pendingReason,
    researchProgramStatus: researchProgram.status,
    researchProgramTrackCount: researchProgram.tracks.length,
    researchProgramActiveTrackCount: researchProgram.tracks.filter(
      (track) => normalizeStage(track.status) === "active"
    ).length,
    researchProgramPlanAlternativeCount: researchProgram.planAlternatives.length,
    researchProgramPlanComparedOptionCount:
      researchProgram.planSelection.comparedOptionIds.length,
    researchProgramPlanSelectedOptionId: researchProgram.planSelection.selectedOptionId,
    researchProgramPlanSelectedTrackId: researchProgram.planSelection.selectedTrackId,
    researchProgramPlanSelectionReady:
      getResearchProgramPlanValidationErrors({
        state: researchProgram,
        ideationContract,
      }).length === 0,
    researchProgramPrimaryGoal: researchProgram.goal,
    researchProgramOnboardingStatus: getResearchProgramOnboardingStatus({
      state: researchProgram,
      projectId: projectState.projectId,
    }),
    researchProgramOnboardingMissing,
    researchProgramBaselineReference: researchProgram.baselineReference,
    researchProgramPrimaryMetricName: researchProgram.primaryMetric,
    researchProgramDatasetCount: researchProgram.datasets.length,
    researchProgramSuccessCriteriaCount: researchProgram.successCriteria.length,
    researchProgramZoteroProjectPath:
      researchProgram.zoteroProjectPath ??
      defaultResearchProgramZoteroProjectPath(projectState.projectId),
    bootstrapRequestSourceCommand: asString(bootstrapRequest?.source_command) ?? null,
    bootstrapRequestCleanTopic: asString(bootstrapRequest?.clean_topic) ?? null,
    bootstrapRequestRawRequest: asString(bootstrapRequest?.raw_request) ?? null,
    bootstrapRequestReferenceHints: Array.isArray(bootstrapRequest?.reference_hints)
      ? bootstrapRequest.reference_hints
          .map((entry) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    bootstrapRequestExplicitRequirements: Array.isArray(
      bootstrapRequest?.explicit_requirements
    )
      ? bootstrapRequest.explicit_requirements
          .map((entry) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    benchmarkProtocolStatus: benchmarkProtocol.status,
    benchmarkProtocolFamily: benchmarkProtocol.benchmarkFamily,
    benchmarkProtocolLocked: benchmarkProtocol.locked,
    benchmarkProtocolDriftStatus: benchmarkProtocol.driftStatus,
    benchmarkProtocolPath: benchmarkProtocol.protocolLockPath,
    benchmarkProtocolPendingReason: benchmarkProtocol.pendingReason,
    statisticalEvidenceStatus: statisticalEvidence.status,
    statisticalEvidenceAggregatePath: statisticalEvidence.aggregatePath,
    statisticalEvidenceClaimStrengthStatus:
      statisticalEvidence.claimStrengthStatus,
    statisticalEvidenceSignificantResultCount:
      statisticalEvidence.significantResultCount,
    statisticalEvidenceInsufficientSeedCount:
      statisticalEvidence.insufficientSeedCount,
    statisticalEvidencePendingReason: statisticalEvidence.pendingReason,
    venueCompetitionStatus: venueCompetition.status,
    venueCompetitionTargetVenues: venueCompetition.targetVenues,
    venueCompetitionCompetitorSlatePath:
      venueCompetition.competitorSlatePath,
    venueCompetitionAcceptanceRiskStatus:
      venueCompetition.acceptanceRiskStatus,
    venueCompetitionGraphContextStatus:
      venueCompetition.graphContextStatus,
    venueCompetitionPendingReason: venueCompetition.pendingReason,
    ablationEvidenceStatus: ablationEvidence.status,
    ablationEvidenceSummaryPath: ablationEvidence.summaryPath,
    ablationEvidenceSufficiencyStatus:
      ablationEvidence.sufficiencyStatus,
    ablationEvidencePublicationCriticalCount:
      ablationEvidence.publicationCriticalCount,
    ablationEvidencePendingReason: ablationEvidence.pendingReason,
    mechanismEvidenceStatus: mechanismEvidence.status,
    mechanismEvidencePacketPath: mechanismEvidence.packetPath,
    mechanismEvidenceTier: mechanismEvidence.evidenceTier,
    mechanismEvidenceGraphContextStatus:
      mechanismEvidence.graphContextStatus,
    mechanismEvidencePendingReason: mechanismEvidence.pendingReason,
    reproducibilityPackStatus: reproducibilityPack.status,
    reproducibilityPackBundlePath: reproducibilityPack.bundlePath,
    reproducibilityPackEnvironmentCaptureStatus:
      reproducibilityPack.environmentCaptureStatus,
    reproducibilityPackRegenerateTablesStatus:
      reproducibilityPack.regenerateTablesStatus,
    reproducibilityPackPendingReason: reproducibilityPack.pendingReason,
    cameraReadyEvidenceStatus: cameraReadyEvidence.status,
    cameraReadyEvidencePackagePath: cameraReadyEvidence.packagePath,
    cameraReadyEvidenceFiguresStatus: cameraReadyEvidence.figuresStatus,
    cameraReadyEvidenceTablesStatus: cameraReadyEvidence.tablesStatus,
    cameraReadyEvidenceCaptionsStatus:
      cameraReadyEvidence.captionsStatus,
    cameraReadyEvidencePendingReason: cameraReadyEvidence.pendingReason,
    opportunityScorecardStatus: opportunityScorecard.status,
    opportunityScorecardVerdict: opportunityScorecard.verdict,
    opportunityScorecardPath: opportunityScorecard.scorecardPath,
    opportunityScorecardGraphContextStatus:
      opportunityScorecard.graphContextStatus,
    opportunityScorecardPendingReason: opportunityScorecard.pendingReason,
    evidenceCloseoutStatus: evidenceCloseout.status,
    evidenceCloseoutTopTierVerdict: evidenceCloseout.topTierVerdict,
    evidenceCloseoutBlockerCount: evidenceCloseout.blockers.length,
    evidenceCloseoutGraphDependentBlockerCount:
      evidenceCloseout.graphDependentBlockerCount,
    evidenceCloseoutLocalEvidenceBlockerCount:
      evidenceCloseout.localEvidenceBlockerCount,
    evidenceCloseoutExperimentAnalyzeReady:
      evidenceCloseout.experimentAnalyzeReady,
    evidenceCloseoutAnalyzeReviewReady:
      evidenceCloseout.analyzeReviewReady,
    evidenceCloseoutWriteReady: evidenceCloseout.writeReady,
    evidenceCloseoutSubmitReady: evidenceCloseout.submitReady,
    evidenceCloseoutTopBlockers: evidenceCloseout.blockers.slice(0, 5),
    teamTaskPreview,
    teamTaskGraphPath: projectState.projectRoot
      ? getWorkflowTaskGraphPath(projectState.projectRoot)
      : null,
    teamTaskGraphTaskCount: taskGraphSummary.taskCount,
    teamTaskGraphClaimableCount: taskGraphSummary.claimableCount,
    teamTaskGraphBlockedCount: taskGraphSummary.blockedCount,
    teamTaskGraphClaimedCount: taskGraphSummary.claimedCount,
    teamTaskGraphVerifyingCount: taskGraphSummary.verifyingCount,
    teamTaskGraphNeedsRepairCount: taskGraphSummary.needsRepairCount,
    teamTaskGraphSatisfiedCount: taskGraphSummary.satisfiedCount,
    teamTaskGraphOptionalCount: taskGraphSummary.optionalCount,
    teamRoundPath: projectState.projectRoot
      ? getWorkflowTeamRoundPath(projectState.projectRoot)
      : null,
    teamRoundStatus: teamRoundSummary.status,
    teamRoundLeadRole:
      teamRoundStore?.leadRole ??
      resolveWorkflowStageLeadRole({
        stage: currentStage,
        ownerAgent: asString(projectState.manifest?.owner_agent),
      }),
    teamRoundActiveSessionCount: teamRoundSummary.activeSessionCount,
    teamRoundLastClaimedTaskId: teamRoundStore?.lastClaimedTaskId ?? null,
    teamRoundLastCompletedTaskId: teamRoundStore?.lastCompletedTaskId ?? null,
    zoteroSyncStatus: zoteroSyncState.status,
    zoteroSyncTrigger: zoteroSyncState.trigger,
    zoteroSyncTriggerReason: zoteroSyncState.triggerReason,
    zoteroSyncLastRequestedAt: zoteroSyncState.lastRequestedAt,
    zoteroSyncCollectionFingerprint: zoteroSyncState.collectionFingerprint,
    zoteroSyncPendingAutoTrigger:
      pendingAutoZoteroSync.shouldLaunch ? pendingAutoZoteroSync.trigger : null,
    zoteroSyncPendingAutoReason:
      pendingAutoZoteroSync.shouldLaunch ? pendingAutoZoteroSync.triggerReason : null,
    orchestrationStatus: orchestrationState.status,
    orchestrationBlockingCategory: orchestrationState.blockingCategory,
    orchestrationNextTransitionCandidate: orchestrationState.nextTransitionCandidate,
    orchestrationRetryBudgetRemaining: orchestrationState.retryBudgetRemaining,
    orchestrationRollbackTargetStage: orchestrationState.rollbackTargetStage,
    experimentReviewMode: autonomousExecution.experimentLaunchMode,
    experimentReviewStatus: experimentReviewState.status ?? "missing",
    experimentReviewMicroStage: experimentReviewState.microStage ?? null,
    experimentReviewRound: experimentReviewState.reviewRound ?? 0,
    experimentReviewPlannerStatus: experimentReviewState.plannerStatus ?? "pending",
    experimentReviewAnalyzerStatus: experimentReviewState.analyzerStatus ?? "pending",
    experimentReviewCrossReviewerStatus:
      experimentReviewState.crossReviewerStatus ?? "pending",
    experimentReviewSynthesisStatus: experimentReviewState.synthesisStatus ?? "pending",
    experimentReviewLaunchApproved: experimentReviewState.launchApproved ?? false,
    experimentReviewBlockerCount: experimentReviewState.blockerCount ?? 0,
    experimentReviewPendingReason: experimentReviewState.pendingReason ?? null,
    experimentReviewPacketPath: experimentReviewState.packetPath ?? null,
    experimentReviewPlannerPlanPath: experimentReviewState.plannerPlanPath ?? null,
    experimentReviewAnalyzerReportPath: experimentReviewState.analyzerReportPath ?? null,
    experimentReviewCrossReviewerReportPath:
      experimentReviewState.crossReviewerReportPath ?? null,
    experimentReviewLaunchDecisionPath:
      experimentReviewState.launchDecisionPath ?? null,
    experimentSearchStatus: experimentSearch.status,
    experimentSearchCurrentMainStage: experimentSearch.currentMainStage,
    experimentSearchCurrentSubstage: experimentSearch.currentSubstage,
    experimentSearchValidationStage:
      experimentSearch.validationStage ?? experimentSearchDecision.validationStage,
    experimentSearchInnerLoopMode: experimentSearch.innerLoopMode,
    experimentSearchTrialTimeBudgetMinutes: experimentSearch.trialTimeBudgetMinutes,
    experimentSearchOneChangeSignature: experimentSearch.oneChangeSignature,
    experimentSearchOneChangeValidationStatus:
      experimentSearch.oneChangeValidationStatus,
    experimentSearchComparableTrialBudgetStatus:
      experimentSearch.comparableTrialBudgetStatus,
    experimentSearchKeepDiscardRule: experimentSearch.keepDiscardRule,
    experimentSearchLastTrialOutcome: experimentSearch.lastTrialOutcome,
    experimentSearchSessionId: experimentSearch.searchSessionId,
    experimentSearchSpecPath: experimentSearch.searchSpecPath,
    experimentSearchStatePath: experimentSearch.searchStatePath,
    experimentSearchBestNodeId: experimentSearch.bestNodeId,
    experimentSearchIncumbentExperimentId: experimentSearch.incumbentExperimentId,
    experimentSearchIncumbentBranch: experimentSearch.incumbentBranch,
    experimentSearchIncumbentCommit: experimentSearch.incumbentCommit,
    experimentSearchLastCandidateExperimentId: experimentSearch.lastCandidateExperimentId,
    experimentSearchLastCandidateBranch: experimentSearch.lastCandidateBranch,
    experimentSearchLastCandidateCommit: experimentSearch.lastCandidateCommit,
    experimentSearchRequestedGitOp: experimentSearch.requestedGitOp,
    experimentSearchGitOpStatus: experimentSearch.gitOpStatus,
    experimentSearchGitReviewStorePath: experimentSearch.gitReviewStorePath,
    experimentSearchGitReviewPacketPath: experimentSearch.gitReviewPacketPath,
    experimentSearchCandidateWorktreePath: experimentSearch.candidateWorktreePath,
    experimentSearchCandidateBaseCommit: experimentSearch.candidateBaseCommit,
    experimentSearchCandidateHeadCommit: experimentSearch.candidateHeadCommit,
    experimentSearchLastGitOpResult: experimentSearch.lastGitOpResult,
    experimentSearchPromotionBasisSignals:
      experimentSearchReview?.promotionBasisSignals ?? [],
    experimentSearchPromotionEvidenceSummary:
      experimentSearchReview?.promotionEvidenceSummary ?? null,
    experimentSearchMultiSeedStatus: experimentSearch.multiSeedStatus,
    experimentSearchBaselineFairnessStatus:
      experimentSearch.baselineFairnessStatus,
    experimentSearchImplementationConfidence:
      experimentSearch.implementationConfidence,
    experimentSearchSearchExhaustionStatus:
      experimentSearch.searchExhaustionStatus,
    experimentSearchAblationStatus: experimentSearch.ablationStatus,
    experimentSearchInnovationStatus: experimentSearch.innovationStatus,
    experimentSearchDecisionConfidence:
      experimentSearch.decisionConfidence ?? experimentSearchDecision.decisionConfidence,
    experimentSearchRecommendedNextAction:
      experimentSearch.recommendedNextAction ??
      experimentSearchDecision.recommendedNextAction,
    experimentSearchFailureClusterIds:
      experimentSearch.failureClusterIds.length > 0
        ? experimentSearch.failureClusterIds
        : experimentSearchDecision.failureClusters.map((cluster) => cluster.clusterId),
    experimentSearchEvidenceCleanlinessStatus:
      experimentSearch.evidenceCleanlinessStatus,
    experimentSearchBaselineDatasetCoverageStatus:
      experimentSearch.baselineDatasetCoverageStatus,
    experimentSearchBaselineDatasetCoverageMissing:
      experimentSearch.baselineDatasetCoverageMissing,
    experimentSearchBaselineDatasetCoverageSummary:
      experimentSearch.baselineDatasetCoverageSummary,
    experimentSearchInnovationDeviationStatus:
      experimentSearch.innovationDeviationStatus,
    experimentSearchInnovationDeviationScore:
      experimentSearch.innovationDeviationScore,
    experimentSearchInnovationDeviationSummary:
      experimentSearch.innovationDeviationSummary,
    experimentSearchDecision: experimentSearchDecision.decision,
    experimentSearchPlotPackStatus: experimentSearch.plotPackStatus,
    experimentSearchGraphMemoryPacketPath: experimentSearch.graphMemoryPacketPath,
    experimentSearchGraphMemorySyncStatus: experimentSearch.graphMemorySyncStatus,
    experimentMemoryGraphPacketPath:
      asString(experimentMemory?.graph_memory_packet_path) ?? null,
    experimentMemoryGraphSyncStatusPath:
      asString(experimentMemory?.graph_memory_sync_status_path) ?? null,
    experimentMemoryGraphLastMaterializedAt:
      asString(experimentMemory?.graph_memory_last_materialized_at) ?? null,
    writePackageStatus: writePackage.status,
    writePackageAssemblyStatus: writePackage.assemblyStatus,
    writePackageAssemblyMode: writePackage.assemblyMode,
    writePackageWinningTrackCount: writePackage.winningTrackIds.length,
    writePackageDerivedArtifactCount: writePackage.derivedArtifactCount,
    writePackagePendingReason: writePackage.pendingReason,
    theorySupportStatus: theorySupport.status,
    theorySupportSignal: theorySupport.overallSignal,
    theoryStatePath: theorySupport.theoryStatePath,
    theoryProofPacketDir: theorySupport.proofPacketDir,
    theoryAppendixPacketPath: theorySupport.appendixPacketPath,
    theoryPacketCount: theorySupport.proofPacketCount,
    theoryBodyReady: theorySupport.bodyReady,
    theoryPendingReason: theorySupport.pendingReason,
    writingTemplateRequired: writingContract.templateRequired,
    writingPaperMode: writingContract.paperMode,
    writingBodyPageBudget: writingContract.bodyPageBudget,
    writingReferencePageBudget: writingContract.referencePageBudget,
    writingBodyWordTargetMin: writingContract.bodyWordTargetMin,
    writingBodyWordTargetMax: writingContract.bodyWordTargetMax,
    writingMaxCoreIdeas: writingContract.maxCoreIdeas,
    writingMaxHeadlineClaims: writingContract.maxHeadlineClaims,
    writingTemplatePath: writingContractEval.templateResolvedPath,
    writingProjectTemplatePath: writingContractEval.projectTemplateResolvedPath,
    writingTemplateStatus: writingContractEval.templateStatus,
    writingTemplateCopyStatus: writingContractEval.templateCopyStatus,
    writingTemplateMappingPath: writingContract.templateMappingPath,
    mainTextProofStyle: writingContract.mainTextProofStyle,
    proofAppendixRequired: writingContract.proofAppendixRequired,
    proofAppendixPath: writingContract.proofAppendixPath,
    proofAppendixStatus: writingContract.proofAppendixStatus,
    theoryNotePath: writingContract.theoryNotePath,
    proofChecklist: writingContract.proofChecklist,
    kgStorylineRequired: writingContract.kgStorylineRequired,
    kgStorylineStatus: writingContract.kgStorylineStatus,
    kgStorylinePacketPath: writingContract.kgStorylinePacketPath,
    storylineSource: writingContract.storylineSource,
    storylineChecklist: writingContract.storylineChecklist,
    writingRequiredSections: writingContract.requiredSections,
    writingSectionOrder: writingContract.sectionOrder,
    paragraphLogicStatus: writingContract.paragraphLogicStatus,
    paragraphLogicChecklist: writingContract.paragraphLogicChecklist,
    writingContractPendingReason:
      writingContractEval.pendingReason ?? writingContract.pendingReason,
    citationVerificationRequired:
      citationIntegrity.enabled && citationIntegrity.verificationRequired,
    citationVerificationStatus: citationIntegrity.verificationStatus,
    citationVerificationReportPath: resolvedCitationReportPath,
    citationBibliographyPath: resolvedCitationBibliographyPath,
    citationSourceOfTruth: citationIntegrity.sourceOfTruth,
    citationBibliographyEntryCount: citationIntegrity.bibliographyEntryCount,
    citationMinimumCount: citationIntegrity.minimumCitationCount,
    citationUnresolvedPlaceholderCount: citationIntegrity.unresolvedPlaceholderCount,
    citationAllowedPlaceholderCount: citationIntegrity.allowedPlaceholderCount,
    citationVerifiedCount: citationIntegrity.verifiedCitationCount,
    citationSuspiciousCount: citationIntegrity.suspiciousCitationCount,
    citationHallucinatedCount: citationIntegrity.hallucinatedCitationCount,
    citationTopicRelevanceTopic: citationIntegrity.topicRelevanceTopic,
    citationTopicRelevanceStatus: citationIntegrity.topicRelevanceStatus,
    citationRelevantCount: citationIntegrity.relevantCitationCount,
    citationOffTopicCount: citationIntegrity.offTopicCitationCount,
    citationTopicRelevanceSummary: citationIntegrity.topicRelevanceSummary,
    citationPendingReason: citationIntegrity.pendingReason,
    citationCollectionStatus: citationCollection.status,
    citationCollectionCandidateCount: citationCollection.candidateCount,
    citationCollectionVerifiedCount: citationCollection.verifiedCount,
    citationCollectionSuspiciousCount: citationCollection.suspiciousCount,
    citationCollectionHallucinatedCount: citationCollection.hallucinatedCount,
    writingSessionStatus: writingSession.status,
    writingCurrentSection: writingSession.currentSection,
    writingDraftOrder: writingSession.draftOrder,
    writingFinalizedSections: writingSession.finalizedSections,
    writingCompileSafeSections: writingSession.compileSafeSections,
    writingSectionPacketsReady: areWritingSectionPacketsReady(writingSession),
    writingProcessStatus: writingProcess.processStatus,
    writingMissingSections: writingProcess.missingSections,
    writingStaleSections: writingProcess.staleSections,
    writingNextSuggestedSection: writingProcess.nextSuggestedSection,
    writingRebuildNeeded: writingProcess.rebuildNeeded,
    writingRebuildReason: writingProcess.rebuildReason,
    writingCurrentSectionReviewVerdict: writingSession.currentSection
      ? writingSession.sectionPackets[writingSession.currentSection]?.reviewVerdict ?? null
      : null,
    writingGraphEvidenceCoverageStatus: writingSession.graphEvidenceCoverageStatus,
    writingGraphEvidenceCoverageSummary: writingSession.graphEvidenceCoverageSummary,
    paperStoryStatus: paperStoryState.status,
    paperStoryTrackId: paperStoryState.storylineSourceTrackId,
    paperStoryStorySpinePath: paperStoryState.storySpinePath,
    paperStoryClaimToExperimentMapPath: paperStoryState.claimToExperimentMapPath,
    paperStoryIdeaToClaimMapPath: paperStoryState.ideaToClaimMapPath,
    paperStoryFallbackNarrativePath: paperStoryState.fallbackNarrativePath,
    paperStoryClaimSupportStatus: paperStoryState.claimSupportStatus,
    paperStorySupportedClaimCount: paperStoryState.supportedClaimCount,
    paperStoryPartialClaimCount: paperStoryState.partialClaimCount,
    paperStoryUnsupportedClaimCount: paperStoryState.unsupportedClaimCount,
    paperStoryPendingReason: paperStoryState.pendingReason,
    reviewSessionStatus: reviewSession.status,
    reviewSessionStageScope: reviewSession.stageScope,
    reviewSessionRound: reviewSession.round,
    reviewSessionVerdict: reviewSession.verdict,
    reviewSessionSummary: reviewSession.reviewerSummary,
    revisionControlStatus: revisionControl.status,
    revisionControlRound: revisionControl.revisionRound,
    revisionControlCurrentOwner: revisionControl.currentOwner,
    revisionControlNextReviewerRole: revisionControl.nextReviewerRole,
    revisionControlOpenSourceCount: revisionControl.openSources.length,
    revisionControlPacketPath: revisionControl.activeRevisionPacketPath,
    revisionControlPendingReason: revisionControl.pendingReason,
    paragraphLogicAuditStatus: paragraphLogicAudit.status,
    paragraphLogicAuditReportPath: paragraphLogicAudit.auditReportPath,
    paragraphLogicAuditReverseOutlinePath: paragraphLogicAudit.reverseOutlinePath,
    paragraphLogicAuditBlockingIssueCount: paragraphLogicAudit.blockingIssueCount,
    paragraphLogicAuditSectionTransitionIssueCount:
      paragraphLogicAudit.sectionTransitionAdvisoryIssueCount,
    paragraphLogicAuditWeakestSections: paragraphLogicAudit.weakestSections,
    paragraphLogicAuditNextRepairAction: paragraphLogicAudit.nextRepairAction,
    executionProofStatus: executionProof.status,
    executionProofPath: executionProof.path,
    executionProofReceiptCount: executionProof.receiptCount,
    executionProofLineageMatchedReceiptCount:
      executionProof.lineageMatchedReceiptCount,
    executionProofCandidateCommit: executionProof.candidateCommit,
    executionProofExpectedStageRunId: executionProof.expectedStageRunId,
    executionProofPrimaryReceiptExperimentId:
      executionProof.primaryReceiptExperimentId,
    executionProofPrimaryReceiptRunId: executionProof.primaryReceiptRunId,
    executionProofPrimaryReceiptStageRunId:
      executionProof.primaryReceiptStageRunId,
    executionProofPrimaryReceiptGitCommit:
      executionProof.primaryReceiptGitCommit,
    executionProofPrimaryReceiptPath: executionProof.primaryReceiptPath,
    executionProofPendingReason: executionProof.pendingReason,
    reviewRubricSummary: {
      originality: reviewSession.rubric.originality,
      quality: reviewSession.rubric.quality,
      clarity: reviewSession.rubric.clarity,
      significance: reviewSession.rubric.significance,
      soundness: reviewSession.rubric.soundness,
      citationIntegrity: reviewSession.rubric.citationIntegrity,
      graphGroundedEvidenceSufficiency: reviewSession.rubric.graphGroundedEvidenceSufficiency,
    },
    graphGuidedWritingStatus: graphGuidedWriting.status,
    graphGuidedWritingEvidenceCoverageStatus: graphGuidedWriting.evidenceCoverageStatus,
    graphGuidedWritingMissingEvidenceClaims: graphGuidedWriting.missingEvidenceClaims,
    graphGuidedWritingScholarReserved: graphGuidedWriting.scholarQueryReserved,
    graphGuidedWritingScholarSkillSlot: graphGuidedWriting.scholarQuerySkillSlot,
    paperQcStatus: paperQc.status,
    paperQcCompileStatus: paperQc.compileStatus,
    paperQcChktexStatus: paperQc.chktexStatus,
    paperQcPageBudgetStatus: paperQc.pageBudgetStatus,
    figureQcStatus: figureQc.status,
    figureQcDuplicateFigureStatus: figureQc.duplicateFigureStatus,
    figureQcCaptionAlignmentStatus: figureQc.captionAlignmentStatus,
    figureQcTextAlignmentStatus: figureQc.textAlignmentStatus,
    figureQcSelectionStatus: figureQc.selectionStatus,
    reviewIssueTrackerStatus: reviewIssueTracker.status,
    reviewIssueCriticalCount: reviewIssueTracker.openCounts.critical,
    reviewIssueHighCount: reviewIssueTracker.openCounts.high,
    reviewIssueMediumCount: reviewIssueTracker.openCounts.medium,
    reviewIssueLowCount: reviewIssueTracker.openCounts.low,
    reviewIssueSurfaceCount: reviewIssueLaneCounts.surface,
    reviewIssueSubmissionCount: reviewIssueLaneCounts.submission,
    reviewPressureStatus: reviewPressurePacket.status,
    reviewPressureRejectFirstReviewPath: reviewPressurePacket.rejectFirstReviewPath,
    reviewPressureUnsupportedClaimAuditPath: reviewPressurePacket.unsupportedClaimAuditPath,
    reviewPressurePendingReason: reviewPressurePacket.statusReason,
    externalReviewStatus: externalReview.status,
    externalReviewRecommendation: externalReview.overallRecommendation,
    externalReviewRequiredAction: externalReview.requiredAction,
    autoDispatchDiagnosticsStatus: autoDispatchDiagnostics.status,
    autoDispatchBlockingLayer: autoDispatchDiagnostics.blockingLayer,
    autoDispatchBlockingReason: autoDispatchDiagnostics.blockingReason,
    autoDispatchBlockingSummary: autoDispatchDiagnostics.blockingSummary,
    autoDispatchNextRepairAction: autoDispatchDiagnostics.nextRepairAction,
    autoGateReviewToWriteMode: autoGate.gateModes.review_to_write,
    autoGateWriteToSubmitMode: autoGate.gateModes.write_to_submit,
    autoGateSubmitToDoneMode: autoGate.gateModes.submit_to_done,
    autoGateCurrentStageMode: currentStageGateMode,
    surveyVisualCompilerStatus: surveyVisualCompiler.status,
    surveyVisualCompilerRowCount: surveyVisualCompiler.rowCount,
    surveyVisualCompilerInsertionMapPath: surveyVisualCompiler.insertionMapPath,
    surveyMethodologyConsistencyStatus:
      typeof surveyMethodologyConsistency.status === "string"
        ? surveyMethodologyConsistency.status
        : null,
    surveyMethodologyConsistencyPath:
      typeof surveyMethodologyConsistency.path === "string"
        ? surveyMethodologyConsistency.path
        : null,
    surveyMethodologyConsistencyBlockingIssueCount:
      Array.isArray(surveyMethodologyConsistency.blocking_issues)
        ? surveyMethodologyConsistency.blocking_issues.length
        : null,
    recentExperiments,
    unreadMailbox,
    backgroundTasks: buildDynamicTasksImpl(
      {
        role,
        currentStage,
        manifest: projectState.manifest,
        missingStageSignals,
        experimentReviewMode: experimentReviewState.launchMode,
        experimentReviewStatus: experimentReviewState.status,
        experimentReviewMicroStage: experimentReviewState.microStage,
        experimentReviewPendingReason: experimentReviewState.pendingReason,
        experimentReviewPacketPath: experimentReviewState.packetPath,
        experimentReviewPlannerPlanPath: experimentReviewState.plannerPlanPath,
        experimentReviewAnalyzerReportPath: experimentReviewState.analyzerReportPath,
        experimentReviewCrossReviewerReportPath:
          experimentReviewState.crossReviewerReportPath,
        experimentReviewLaunchDecisionPath: experimentReviewState.launchDecisionPath,
        experimentReviewLaunchApproved: experimentReviewState.launchApproved,
        idleResearch,
        innovationReflection,
        innovationReflectionDue,
        writingContract,
        writingTemplatePath: writingContractEval.templateResolvedPath,
        writingTemplateStatus: writingContractEval.templateStatus,
        paragraphLogicStatus: writingContract.paragraphLogicStatus,
        paragraphLogicAuditStatus: paragraphLogicAudit.status,
        paragraphLogicAuditBlockingIssueCount: paragraphLogicAudit.blockingIssueCount,
        paragraphLogicAuditNextRepairAction: paragraphLogicAudit.nextRepairAction,
        paragraphLogicAuditReportPath: paragraphLogicAudit.auditReportPath,
        writingContractPendingReason:
          writingContractEval.pendingReason ?? writingContract.pendingReason,
        citationIntegrity,
        citationReportPath: resolvedCitationReportPath,
        recentExperiments,
        unreadMailbox,
        papernexusApiBaseUrl: papernexusAccess?.apiBaseUrl ?? null,
        papernexusMcpUrl: papernexusAccess?.mcpUrl ?? null,
        papernexusMcpTransport: papernexusAccess?.mcpTransport ?? null,
        papernexusApiTokenEnv: papernexusAccess?.tokenEnv ?? null,
        papernexusApiTokenSource: papernexusAccess?.tokenSourceConfigured ?? null,
        papernexusApiTokenService: papernexusAccess?.tokenService ?? null,
        papernexusApiTokenAccount: papernexusAccess?.tokenAccount ?? null,
        papernexusMineruHttpUrl: papernexusAccess?.mineruHttpUrl ?? null,
        papernexusAccessMode:
          typeof policy?.papernexusAccessMode === "string" ? policy.papernexusAccessMode : null,
      },
      {
        rolePolicies: ROLE_POLICIES,
        asRecord,
        asString,
        normalizePaperIngestionState,
        normalizeIdeaCatalystState,
        normalizeGraphPresenceStatus,
        summarizeGraphPresenceMissing,
        buildGraphImportRepairGuidance,
        isIdleResearchDue: (state) => isIdleResearchDue(state as IdleResearchState),
        computeIdleResearchNextDueAt: (state) =>
          computeIdleResearchNextDueAt(state as IdleResearchState),
        uniqueStrings,
        DEFAULT_KG_STORYLINE_PACKET_PATH,
        DEFAULT_CITATION_REPORT_PATH,
      }
    ),
  };
  const runtimeHealth = await resolveWorkflowRuntimeHealth({
    projectRoot: projectState.projectRoot,
    manifest: projectState.manifest,
    trackRegistry: projectState.trackRegistry,
    mailbox: projectState.mailbox as Record<string, unknown> | null,
    experimentLedger: projectState.experimentLedger as Record<string, unknown> | null,
    autoIteratorAudit: projectState.autoIteratorAudit,
    snapshot: snapshotBase,
  });

  return {
    ...snapshotBase,
    ...runtimeHealth,
  };
}
