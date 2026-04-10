import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  assembleWritePackage,
  acknowledgeWorkflowMailboxMessage,
  bindChannelProjectForWorkflow,
  buildWorkflowSnapshot,
  canRoleContactInWorkflow,
  getBrainstormCycleStateSummary,
  checkGraphPresenceForWorkflow,
  getCitationCollectionStateSummary,
  getChannelProjectBindingForWorkflow,
  getCitationIntegrityStateSummary,
  getIdeationContractStateSummary,
  getExperimentSearchStateSummary,
  getExperimentGitReviewSummary,
  getExperimentReviewStateSummary,
  getExternalReviewStateSummary,
  getExperimentMemorySummary,
  getFigureQcStateSummary,
  getGateStateSummary,
  getGraphGuidedWritingStateSummary,
  getIdleResearchStateSummary,
  getInnovationReflectionStateSummary,
  getOrchestrationStateSummary,
  getPapernexusProgressSummary,
  getPaperIngestionStateSummary,
  getPaperStoryStateSummary,
  auditLiteratureCoverageForWorkflow,
  materializeIdeationContract,
  materializeExperimentMemoryPacket,
  materializeExperimentReviewState,
  materializeLiteratureDiscoveryPacket,
  materializePlanState,
  materializePaperStoryState,
  planCitationExpansionForWorkflow,
  queuePaperIngestionRequest,
  getPaperQcStateSummary,
  getResearchProgramStateSummary,
  getReviewPressurePacketStateSummary,
  getProjectRootForWorkflow,
  getReviewIssueTrackerStateSummary,
  getReviewSessionStateSummary,
  getSurveyReviewStateSummary,
  getTheoryStateSummary,
  getWorkflowContactCooldown,
  getWritePackageStateSummary,
  getWritingContractStateSummary,
  getWritingSessionStateSummary,
  inferTargetRoleFromToolParams,
  listChannelProjectBindingsForWorkflow,
  materializeReviewPressurePacket,
  materializeSurveyReviewState,
  materializeTheoryAppendix,
  queueWorkflowMailboxMessage,
  readWorkflowMailboxForAgent,
  recordCitationVerification,
  recordIdleResearchRun,
  recordInnovationReflection,
  recordTheoryState,
  recordWorkflowContactEvent,
  runBrainstormCycle,
  runWorkflowAutoIterator,
  requestExperimentGitOp,
  applyExperimentGitOp,
  setBrainstormCycleState,
  setCitationCollectionState,
  setExperimentSearchState,
  setExperimentGitReviewState,
  setExperimentReviewState,
  setExternalReviewState,
  setFigureQcState,
  setGateStateForWorkflow,
  setGraphGuidedWritingState,
  setIdeationContractState,
  setIdleResearchState,
  setOrchestrationState,
  setPaperIngestionState,
  setPaperQcState,
  setPaperStoryState,
  setResearchProgramState,
  setReviewPressurePacketState,
  setReviewIssueTrackerState,
  setReviewSessionState,
  setSurveyReviewState,
  setWritePackageState,
  setWritingSessionState,
  setWritingContractState,
  unbindChannelProjectForWorkflow,
  upsertExperimentLedgerEntry,
  upsertTheoryProofPacket,
  validatePaperIngestionRequest,
} from "./workflow-guard";
import {
  getIdeaCatalystStateSummary,
  setIdeaCatalystState,
} from "./idea-catalyst/state";
import { materializeIdeaCatalystState } from "./idea-catalyst/materializers";
import { queueIdeaCatalystRequisition } from "./idea-catalyst/workflow-bridge";
import { queueLiteratureDiscoveryRequisition } from "./literature-discovery/workflow-bridge";
import { materializePapernexusPacketContracts } from "./papernexus-packets/materializer";
import { materializeCycleMemory } from "./research-memory-cycle";
import { materializeWritingSupportArtifacts } from "./research-writing/materializers";
import {
  dispatchWorkflowTaskToAgent,
  deriveWorkflowDispatchSessionCandidates,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import {
  selectDispatchableAutoStageAction,
} from "./workflow-guard-runtime/auto-iterator";
import {
  maybeBroadcastAutoIteratorStageChange,
  maybeBroadcastWorkflowStatusUpdate,
} from "./stage-broadcast";
import { handoffWorkflowTaskToAgent } from "./lobster-handoff";
import {
  buildPapernexusWrapperBackgroundRunRequest,
  enqueueQueuedBackgroundWorkflowRun,
  startBackgroundWorkflowRun,
  type BackgroundRunRequest,
  type PapernexusWrapperRunRequest,
} from "./workflow-fast-paths";
import {
  listBackgroundWorkflowRuns,
  pruneBackgroundWorkflowRuns,
  retireBackgroundWorkflowRuns,
} from "./workflow-background-pool";
import { migrateWorkflowRuntimeState } from "./workflow-runtime-state.js";
import {
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  readWorkflowRuntimeEvents,
} from "./workflow-runtime-state.js";
import {
  asObject,
  readNumber,
  readString,
  requireObject,
  textResponse,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";
import { readJsonIfExists, pathExists } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import { loadTrackInnovationEvidence } from "./workflow-derived-state/track-evidence";
import {
  buildWorkflowQueueContext,
  enqueueWorkflowTask,
} from "./workflow-coordination";
import { getGateReviewStorePath, readGateReviewStore } from "./workflow-auto-gate";
import { appendWorkflowTraceEvent } from "./workflow-trace";
import { inspectPapernexusRemoteAccess } from "./papernexus-secret";
import {
  isTrackedPapernexusImportWrapper,
  writePapernexusProgressFromManifest,
} from "./papernexus-progress";
import { resolveWorkflowSnapshotContext } from "./workflow-runtime-snapshot";

type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;

type WorkflowToolState = {
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  channelBinding: Record<string, unknown> | null;
  snapshot: WorkflowSnapshot;
  projectRoot: string | null;
  workspaceProjectRoot: string | null;
  projectRequiredMessage: string;
  bindingRole: string | null;
};

type AutoIteratorResult = Awaited<ReturnType<typeof runWorkflowAutoIterator>>;

const SERIALIZED_WORKFLOW_ACTIONS = new Set([
  "auto_iterator_tick",
  "start_background_run",
  "run_papernexus_wrapper",
  "queue_paper_ingestion",
  "queue_idea_catalyst_requisition",
  "queue_literature_discovery_requisition",
  "migrate_runtime_state",
  "set_gate_state",
  "set_paper_ingestion",
  "materialize_ideation_contract",
  "materialize_experiment_review_state",
  "materialize_literature_discovery_packet",
  "materialize_plan_state",
  "materialize_papernexus_packet_contracts",
  "materialize_paper_story_state",
  "materialize_writing_support_artifacts",
  "materialize_cycle_memory",
  "materialize_survey_review_state",
  "materialize_idea_catalyst_state",
  "set_survey_review",
  "set_ideation_contract",
  "set_experiment_review_state",
  "set_idea_catalyst_state",
  "set_paper_story_state",
  "materialize_review_pressure_packet",
  "set_review_pressure_packet",
  "prune_background_sessions",
  "retire_background_sessions",
  "bind_channel_project",
  "unbind_channel_project",
  "dispatch_task",
  "read_mailbox",
  "send_mailbox",
  "ack_mailbox",
]);

const WORKFLOW_ACTION_FUNCTIONS: Record<string, string> = {
  get_snapshot: "buildWorkflowSnapshot",
  get_runtime_health: "buildWorkflowSnapshot",
  diagnose_track_evidence: "loadTrackInnovationEvidence",
  get_papernexus_remote_access: "inspectPapernexusRemoteAccess",
  get_papernexus_progress: "getPapernexusProgressSummary",
  check_graph_presence: "checkGraphPresenceForWorkflow",
  audit_literature_coverage: "auditLiteratureCoverageForWorkflow",
  plan_citation_expansion: "planCitationExpansionForWorkflow",
  auto_iterator_tick: "runWorkflowAutoIterator",
  start_background_run: "startBackgroundWorkflowRun",
  run_papernexus_wrapper: "buildPapernexusWrapperBackgroundRunRequest",
  queue_paper_ingestion: "queuePaperIngestionRequest",
  validate_paper_ingestion: "validatePaperIngestionRequest",
  queue_idea_catalyst_requisition: "queueIdeaCatalystRequisition",
  queue_literature_discovery_requisition: "queueLiteratureDiscoveryRequisition",
  migrate_runtime_state: "migrateWorkflowRuntimeState",
  get_idle_research: "getIdleResearchStateSummary",
  set_idle_research: "setIdleResearchState",
  record_idle_research_run: "recordIdleResearchRun",
  get_experiment_memory: "getExperimentMemorySummary",
  get_innovation_reflection: "getInnovationReflectionStateSummary",
  get_brainstorm_cycle: "getBrainstormCycleStateSummary",
  get_survey_review: "getSurveyReviewStateSummary",
  set_brainstorm_cycle: "setBrainstormCycleState",
  run_brainstorm_cycle: "runBrainstormCycle",
  materialize_ideation_contract: "materializeIdeationContract",
  materialize_literature_discovery_packet: "materializeLiteratureDiscoveryPacket",
  materialize_plan_state: "materializePlanState",
  materialize_papernexus_packet_contracts: "materializePapernexusPacketContracts",
  materialize_idea_catalyst_state: "materializeIdeaCatalystState",
  materialize_paper_story_state: "materializePaperStoryState",
  materialize_writing_support_artifacts: "materializeWritingSupportArtifacts",
  materialize_cycle_memory: "materializeCycleMemory",
  materialize_survey_review_state: "materializeSurveyReviewState",
  get_ideation_contract: "getIdeationContractStateSummary",
  get_idea_catalyst_state: "getIdeaCatalystStateSummary",
  set_ideation_contract: "setIdeationContractState",
  set_idea_catalyst_state: "setIdeaCatalystState",
  get_research_program: "getResearchProgramStateSummary",
  set_survey_review: "setSurveyReviewState",
  set_research_program: "setResearchProgramState",
  get_orchestration_state: "getOrchestrationStateSummary",
  set_orchestration_state: "setOrchestrationState",
  get_paper_ingestion: "getPaperIngestionStateSummary",
  set_paper_ingestion: "setPaperIngestionState",
  get_theory_state: "getTheoryStateSummary",
  get_writing_contract: "getWritingContractStateSummary",
  get_paper_story_state: "getPaperStoryStateSummary",
  set_paper_story_state: "setPaperStoryState",
  materialize_review_pressure_packet: "materializeReviewPressurePacket",
  get_write_package: "getWritePackageStateSummary",
  set_write_package: "setWritePackageState",
  assemble_write_package: "assembleWritePackage",
  get_writing_session: "getWritingSessionStateSummary",
  set_writing_session: "setWritingSessionState",
  get_review_session: "getReviewSessionStateSummary",
  set_review_session: "setReviewSessionState",
  get_review_pressure_packet: "getReviewPressurePacketStateSummary",
  set_review_pressure_packet: "setReviewPressurePacketState",
  get_graph_guided_writing: "getGraphGuidedWritingStateSummary",
  set_graph_guided_writing: "setGraphGuidedWritingState",
  get_citation_integrity: "getCitationIntegrityStateSummary",
  get_paper_qc: "getPaperQcStateSummary",
  set_paper_qc: "setPaperQcState",
  get_figure_qc: "getFigureQcStateSummary",
  set_figure_qc: "setFigureQcState",
  get_citation_collection: "getCitationCollectionStateSummary",
  set_citation_collection: "setCitationCollectionState",
  get_review_issue_tracker: "getReviewIssueTrackerStateSummary",
  set_review_issue_tracker: "setReviewIssueTrackerState",
  get_experiment_search: "getExperimentSearchStateSummary",
  get_experiment_git_review: "getExperimentGitReviewSummary",
  get_experiment_review_state: "getExperimentReviewStateSummary",
  set_experiment_search: "setExperimentSearchState",
  request_experiment_git_op: "requestExperimentGitOp",
  set_experiment_git_review: "setExperimentGitReviewState",
  apply_experiment_git_op: "applyExperimentGitOp",
  set_experiment_review_state: "setExperimentReviewState",
  materialize_experiment_memory_packet: "materializeExperimentMemoryPacket",
  materialize_experiment_review_state: "materializeExperimentReviewState",
  get_external_review_state: "getExternalReviewStateSummary",
  set_external_review_state: "setExternalReviewState",
  get_gate_state: "getGateStateSummary",
  set_gate_state: "setGateStateForWorkflow",
  list_background_sessions: "listBackgroundWorkflowRuns",
  prune_background_sessions: "pruneBackgroundWorkflowRuns",
  retire_background_sessions: "retireBackgroundWorkflowRuns",
  get_gate_review_state: "readGateReviewStore",
  upsert_experiment: "upsertExperimentLedgerEntry",
  record_theory_state: "recordTheoryState",
  upsert_proof_packet: "upsertTheoryProofPacket",
  materialize_theory_appendix: "materializeTheoryAppendix",
  record_innovation_reflection: "recordInnovationReflection",
  set_writing_contract: "setWritingContractState",
  record_citation_verification: "recordCitationVerification",
  get_channel_project_binding: "getChannelProjectBindingForWorkflow",
  bind_channel_project: "bindChannelProjectForWorkflow",
  unbind_channel_project: "unbindChannelProjectForWorkflow",
  list_channel_project_bindings: "listChannelProjectBindingsForWorkflow",
  dispatch_task: "dispatchWorkflowTaskToAgent",
  read_mailbox: "readWorkflowMailboxForAgent",
  send_mailbox: "queueWorkflowMailboxMessage",
  ack_mailbox: "acknowledgeWorkflowMailboxMessage",
};

async function resolveWorkflowToolState(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  rawParams: Record<string, unknown>;
  action?: string;
  autoBind?: boolean;
}): Promise<WorkflowToolState> {
  const channelBinding = asObject(params.rawParams.channelBinding);
  const { workflowPolicy, snapshot } = await resolveWorkflowSnapshotContext({
    plugin: params.plugin,
    agentCtx: params.agentCtx,
    channelKey:
      readString(channelBinding?.channelKey) ??
      readString(params.agentCtx.channelKey) ??
      null,
    autoBind: params.autoBind,
    stagePreflight: false,
    preflightTrigger: params.action ? `workflow_tool:${params.action}` : "workflow_tool",
  });

  const workspaceProjectRoot = await (async () => {
    const workspaceDir = readString(params.agentCtx.workspaceDir);
    if (!workspaceDir) {
      return null;
    }
    const candidate = path.resolve(workspaceDir);
    try {
      await fs.stat(path.join(candidate, "PROJECT_MANIFEST.json"));
      return candidate;
    } catch {
      return null;
    }
  })();

  const allowWorkspaceProjectFallback =
    workflowPolicy.enableChannelProjectBindings !== true ||
    (!readString(params.agentCtx.sessionKey) &&
      !readString(params.agentCtx.sessionId) &&
      !readString(params.agentCtx.channelKey));

  const projectRoot =
    snapshot.projectRoot ??
    (allowWorkspaceProjectFallback ? workspaceProjectRoot : null) ??
    getProjectRootForWorkflow({
      policy: workflowPolicy,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      channelKey:
        readString(channelBinding?.channelKey) ??
        readString(params.agentCtx.channelKey),
    });

  return {
    workflowPolicy,
    channelBinding,
    snapshot,
    projectRoot,
    workspaceProjectRoot,
    projectRequiredMessage:
      "A resolved project is required for this workflow action. Bind the current Discord/channel session to a project or set OPENCLAW_PROJECT.",
    bindingRole:
      snapshot.role ?? (params.agentCtx.agentId ? params.agentCtx.agentId.toLowerCase() : null),
  };
}

function shouldQueueWorkflowAction(action: string): boolean {
  return SERIALIZED_WORKFLOW_ACTIONS.has(action);
}

function resolveWorkflowToolQueueContext(
  state: WorkflowToolState,
  agentCtx: ToolContext
) {
  return buildWorkflowQueueContext({
    projectRoot:
      state.projectRoot ??
      readString(state.channelBinding?.projectRoot) ??
      readString(state.channelBinding?.project_path) ??
      state.snapshot.projectRoot,
    workspaceDir: agentCtx.workspaceDir,
    sessionKey: agentCtx.sessionKey,
    sessionId: agentCtx.sessionId,
    messageChannel: agentCtx.messageChannel,
    channelKey:
      readString(state.channelBinding?.channelKey) ??
      readString(agentCtx.channelKey) ??
      state.snapshot.channelProjectBindingKey,
  });
}

function requireWorkflowProjectRoot(state: WorkflowToolState): string {
  if (!state.projectRoot) {
    throw new Error(state.projectRequiredMessage);
  }
  return state.projectRoot;
}

function normalizeTrackStatus(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readTrackId(track: Record<string, unknown>): string | null {
  const trackId = track.track_id ?? track.trackId;
  return typeof trackId === "string" && trackId.trim().length > 0 ? trackId.trim() : null;
}

async function diagnoseTrackEvidence(projectRoot: string) {
  const manifestPath = resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json");
  const trackRegistryPath = resolveProjectArtifactPath(projectRoot, "TRACK_REGISTRY.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(trackRegistryPath)) ?? {};
  const researchProgram =
    manifest.research_program && typeof manifest.research_program === "object"
      ? (manifest.research_program as Record<string, unknown>)
      : null;
  const programTracks = Array.isArray(researchProgram?.tracks)
    ? (researchProgram?.tracks as Array<Record<string, unknown>>)
    : [];
  const programActiveTrackIds = programTracks
    .map((track) => (track && typeof track === "object" ? track : null))
    .filter((track): track is Record<string, unknown> => Boolean(track))
    .filter((track) => normalizeTrackStatus(track.status) === "active")
    .map((track) => readTrackId(track))
    .filter((trackId): trackId is string => Boolean(trackId));
  const registryTracks = Array.isArray(trackRegistry.tracks)
    ? (trackRegistry.tracks as Array<Record<string, unknown>>)
    : [];

  const tracks = await Promise.all(
    registryTracks.map(async (track) => {
      const trackId = readTrackId(track);
      const evidence = await loadTrackInnovationEvidence({
        projectRoot,
        track,
      });
      const reasoningPacketDir =
        typeof track.reasoning_packet_dir === "string" ? track.reasoning_packet_dir : null;
      const graphEvidenceResolvedPath = resolveProjectArtifactPath(
        projectRoot,
        evidence.graphEvidencePath
      );
      return {
        trackId,
        status: normalizeTrackStatus(track.status),
        isActiveInRegistry: normalizeTrackStatus(track.status) === "active",
        isActiveInResearchProgram: trackId
          ? programActiveTrackIds.includes(trackId)
          : false,
        reasoningPacketDir,
        reasoningPacketResolvedPath: resolveProjectArtifactPath(projectRoot, reasoningPacketDir),
        graphEvidencePath: evidence.graphEvidencePath,
        graphEvidenceResolvedPath,
        graphEvidenceFileExists: graphEvidenceResolvedPath
          ? await pathExists(graphEvidenceResolvedPath)
          : false,
        presence: evidence.presence,
        hasGraphBackedInnovationEvidence: evidence.hasGraphBackedInnovationEvidence,
        importedFromGraphEvidence: evidence.importedFromGraphEvidence,
        evidencePointerCount: evidence.evidencePointers.length,
        linkedGraphNodeCount: evidence.linkedGraphNodes.length,
        relationPatternCount: evidence.relationPatterns.length,
        diagnostics: evidence.diagnostics,
        repairable: evidence.repairable,
      };
    })
  );

  return {
    projectRoot,
    manifestPath,
    trackRegistryPath,
    currentStage: readString(manifest.current_stage) ?? null,
    currentMicroStage: readString(manifest.current_micro_stage) ?? null,
    ownerAgent: readString(manifest.owner_agent) ?? null,
    registryDeclaredActiveTracks: readNumber(trackRegistry.active_tracks) ?? null,
    researchProgramActiveTrackCount: programActiveTrackIds.length,
    programActiveTrackIds,
    registryActiveTrackIds: tracks
      .filter((track) => track.isActiveInRegistry && track.trackId)
      .map((track) => track.trackId),
    missingGraphBackedInnovationEvidenceTrackIds: tracks
      .filter((track) => track.isActiveInRegistry && !track.hasGraphBackedInnovationEvidence)
      .map((track) => track.trackId),
    tracks,
  };
}

async function getWorkflowRuntimeHealthReport(params: {
  state: WorkflowToolState;
  agentCtx: ToolContext;
}) {
  const resolvedProjectRoot = params.state.projectRoot;
  const queuePath = resolvedProjectRoot ? getWorkflowRuntimeQueuePath(resolvedProjectRoot) : null;
  const sessionsPath = resolvedProjectRoot
    ? getWorkflowRuntimeSessionsPath(resolvedProjectRoot)
    : null;
  const eventsPath = resolvedProjectRoot
    ? path.join(resolvedProjectRoot, ".openclaw-research", "workflow-events.jsonl")
    : null;
  const autoIteratorAuditPath = resolvedProjectRoot
    ? path.join(resolvedProjectRoot, ".openclaw-research", "auto-iterator-state.json")
    : null;

  const [queueStore, sessionsStore, runtimeEvents] = resolvedProjectRoot
    ? await Promise.all([
        readJsonIfExists<Record<string, unknown>>(queuePath),
        readJsonIfExists<Record<string, unknown>>(sessionsPath),
        readWorkflowRuntimeEvents(resolvedProjectRoot),
      ])
    : [null, null, []];
  const queueEntries = Array.isArray(queueStore?.entries) ? queueStore.entries : [];
  const sessionEntries = Array.isArray(sessionsStore?.entries) ? sessionsStore.entries : [];
  const latestRuntimeEvent = Array.isArray(runtimeEvents) ? runtimeEvents.at(-1) ?? null : null;

  return {
    projectResolution: {
      resolvedProjectRoot,
      snapshotProjectRoot: params.state.snapshot.projectRoot,
      workspaceProjectRoot: params.state.workspaceProjectRoot,
      bindingProjectRoot:
        readString(params.state.channelBinding?.projectRoot) ??
        readString(params.state.channelBinding?.project_path) ??
        null,
      projectId: params.state.snapshot.projectId,
      channelBindingKey: params.state.snapshot.channelProjectBindingKey,
      projectResolutionSource: params.state.snapshot.projectResolutionSource,
    },
    snapshot: {
      currentStage: params.state.snapshot.currentStage,
      currentMicroStage: params.state.snapshot.currentMicroStage,
      ownerAgent: params.state.snapshot.ownerAgent,
      recommendedOwner: params.state.snapshot.recommendedOwner,
      nextAction: params.state.snapshot.nextAction,
      resumeAction: params.state.snapshot.resumeAction,
      blockingReason: params.state.snapshot.blockingReason,
      missingStageSignals: params.state.snapshot.missingStageSignals,
      workflowEvidenceStatus: params.state.snapshot.workflowEvidenceStatus,
      workflowEvidenceSummary: params.state.snapshot.workflowEvidenceSummary,
      stateRevision: params.state.snapshot.stateRevision,
      stateUpdatedAt: params.state.snapshot.stateUpdatedAt,
    },
    autoIteratorAudit: {
      path: autoIteratorAuditPath,
      status: params.state.snapshot.autoIteratorAuditStatus,
      freshness: params.state.snapshot.autoIteratorAuditFreshness,
      updatedAt: params.state.snapshot.autoIteratorAuditUpdatedAt,
      runId: params.state.snapshot.autoIteratorAuditRunId,
      stageBefore: params.state.snapshot.autoIteratorAuditStageBefore,
      stageAfter: params.state.snapshot.autoIteratorAuditStageAfter,
      matchesLiveState: params.state.snapshot.autoIteratorAuditMatchesLiveState,
      summary: params.state.snapshot.autoIteratorAuditSummary,
    },
    runtime: {
      queuePath,
      sessionsPath,
      eventsPath,
      queueEntryCount: queueEntries.length,
      queueRunningCount: queueEntries.filter((entry) => asObject(entry)?.status === "running").length,
      queueQueuedCount: queueEntries.filter((entry) => asObject(entry)?.status === "queued").length,
      sessionEntryCount: sessionEntries.length,
      sessionActiveCount: sessionEntries.filter((entry) => asObject(entry)?.status === "active").length,
      sessionIdleCount: sessionEntries.filter((entry) => asObject(entry)?.status === "idle").length,
      latestEvent: latestRuntimeEvent,
    },
    guidance: [
      params.state.snapshot.autoIteratorAuditFreshness === "stale"
        ? "The last auto-iterator audit is stale. Trust the live snapshot, then rerun auto_iterator_tick once if you need a fresh terminal audit."
        : "The last auto-iterator audit is aligned with the live snapshot or no audit exists yet.",
      resolvedProjectRoot &&
      params.state.workspaceProjectRoot &&
      resolvedProjectRoot !== params.state.workspaceProjectRoot
        ? "Workspace project root differs from the bound project root. Workflow tools now follow the bound snapshot project."
        : "Resolved project root matches the current workspace binding context.",
    ],
  };
}

function buildUnboundProjectAutoIteratorPayload(params: {
  snapshot: WorkflowSnapshot;
  iterator: Record<string, unknown> | null;
}) {
  return {
    projectRoot: null,
    projectId: null,
    mode: readString(params.iterator?.mode) ?? "default",
    configuredAutoMode: "off",
    effectiveAutoMode: "off",
    autoModeRiskLevel: "stable",
    autoModeReasons: [],
    autoModeRiskFingerprint: null,
    autoModeMitigationStatus: null,
    autoModeMitigationRoundsStarted: 0,
    autoModeMitigationRoundsRemaining: 0,
    stageBefore: null,
    stageEffective: null,
    stageAfter: null,
    stageChanged: false,
    regressed: false,
    gateBlocking: false,
    gateReason: null,
    missingStageSignals: ["No active project is bound to this channel/session."],
    ownerBefore: params.snapshot.ownerAgent ?? null,
    ownerAfter: params.snapshot.role === "researcher" ? "researcher" : null,
    nextAction:
      'Start a project with /research-pipeline or call research_workflow.bind_channel_project with a projectId/topic so the plugin can scaffold it under projectsRoot.',
    resumeAction:
      "After a project exists, run /resume-pipeline or research_workflow.auto_iterator_tick again.",
    blockingReason:
      "No active project is bound to this channel/session.",
    graphPresenceCheck: null,
    projectsStateUpdated: false,
    auditPath: null,
    recommendedActions: [
      {
        kind: "background",
        stage: "setup",
        owner: "researcher",
        summary:
          "No active project is bound to this Discord/session context yet.",
        command:
          '/research-pipeline "topic" or research_workflow.bind_channel_project with projectId/topic',
        mailboxQueued: false,
        mailboxMessageId: null,
        cooldownRemainingSeconds: null,
        blocking: false,
      },
    ],
    agentTaskDispatch: null,
  };
}

function buildAutoStageDispatchQueueKey(params: {
  projectRoot: string;
  stage: string | null | undefined;
  owner: string | null | undefined;
  command: string | null | undefined;
}) {
  return [
    path.resolve(params.projectRoot),
    params.stage ?? "unknown-stage",
    params.owner ?? "unknown-owner",
    params.command ?? "no-command",
  ].join("::");
}

export async function maybeDispatchAutoIteratorTask(params: {
  plugin: PluginRegistrationContext;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  agentCtx: ToolContext;
  snapshot: WorkflowSnapshot;
  result: AutoIteratorResult;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
}) {
  const requesterRole = params.snapshot.role;
  const ownerAfter = params.result.ownerAfter as DispatchableWorkflowRole | null;
  const autoModeActive =
    (params.result.effectiveAutoMode ?? params.workflowPolicy.autoMode ?? "off") !== "off";
  if (!params.workflowPolicy.enforceWorkflowBoundaries) {
    return null;
  }
  if (!requesterRole || !ownerAfter || requesterRole === ownerAfter) {
    return null;
  }
  const primaryAction = selectDispatchableAutoStageAction({
    autoIteratorResult: params.result,
    owner: ownerAfter,
  });
  if (!primaryAction) {
    return null;
  }
  if ((primaryAction.cooldownRemainingSeconds ?? 0) > 0) {
    return {
      dispatched: false,
      blockedByCooldown: true,
      cooldownRemainingSeconds: primaryAction.cooldownRemainingSeconds,
      owner: ownerAfter,
    };
  }
  if (!params.snapshot.projectRoot) {
    return null;
  }
  const dispatch = await handoffWorkflowTaskToAgent({
    runtimeSubagent: params.plugin.api.runtime?.subagent,
    workflowPolicy: params.workflowPolicy,
    requesterSessionKey: params.agentCtx.sessionKey,
    requesterChannel: params.agentCtx.messageChannel,
    fromRole: requesterRole,
    toRole: ownerAfter,
    projectRoot: params.snapshot.projectRoot,
    projectId: params.snapshot.projectId,
    stage: primaryAction.stage ?? params.snapshot.currentStage,
    summary: primaryAction.summary,
    command: primaryAction.command,
    mailboxMessageId: primaryAction.mailboxMessageId,
    requireMailboxAcknowledgement: true,
    waitTimeoutMs: params.waitTimeoutMs,
    retryOnTimeout: params.retryOnTimeout,
    enableSpawnFallback: params.enableSpawnFallback,
    autoModeActive,
    logger: params.plugin.api.logger,
  });
  if (dispatch.dispatched) {
    await recordWorkflowContactEvent({
      projectRoot: params.snapshot.projectRoot,
      fromAgent: requesterRole,
      toAgent: ownerAfter,
      channel: dispatch.channel ?? "sessions_send",
    });
  }
  if (!dispatch.dispatched && autoModeActive) {
    const requesterSessionKey =
      readString(params.agentCtx.sessionKey) ?? `agent:${requesterRole}:main`;
    const preferredSessionKeys = deriveWorkflowDispatchSessionCandidates({
      requesterSessionKey,
      targetRole: ownerAfter,
    });
    const queued = await enqueueQueuedBackgroundWorkflowRun({
      source: "workflow_auto_stage",
      ownerAgent: ownerAfter,
      requesterSessionKey,
      messageChannel: readString(params.agentCtx.messageChannel),
      preferredSessionKey: preferredSessionKeys[0] ?? null,
      family: "research",
      kind: "workflow_stage_dispatch",
      projectId: params.snapshot.projectId,
      projectRoot: params.snapshot.projectRoot,
      projectsRoot: params.workflowPolicy.projectsRoot,
      queueKey: buildAutoStageDispatchQueueKey({
        projectRoot: params.snapshot.projectRoot,
        stage: primaryAction.stage ?? params.result.stageAfter ?? params.snapshot.currentStage,
        owner: ownerAfter,
        command: primaryAction.command,
      }),
      summary:
        `Queued the ${primaryAction.stage ?? params.result.stageAfter ?? "current"} stage handoff for ${ownerAfter} because immediate auto-mode dispatch was unavailable.`,
      dispatchPayload: {
        requesterChannel: readString(params.agentCtx.messageChannel) ?? null,
        requesterAccountId: null,
        preferredSessionKeys,
        fromRole: requesterRole,
        toRole: ownerAfter,
        projectRoot: params.snapshot.projectRoot,
        projectId: params.snapshot.projectId,
        stage: primaryAction.stage ?? params.result.stageAfter ?? params.snapshot.currentStage,
        summary: primaryAction.summary,
        command: primaryAction.command,
        mailboxMessageId: primaryAction.mailboxMessageId ?? null,
        requireMailboxAcknowledgement: true,
        extraBody:
          "Workflow auto-mode queued dispatch. Continue only the assigned stage, keep durable state current, and do not skip stage completion checks.",
        waitTimeoutMs: params.waitTimeoutMs ?? 5000,
        retryOnTimeout: params.retryOnTimeout ?? false,
        enableSpawnFallback:
          params.enableSpawnFallback === false ? false : true,
        useWorkflowHandoff: true,
        autoModeActive: true,
      },
    });
    return {
      ...dispatch,
      blockedByCooldown: false,
      cooldownRemainingSeconds: null,
      owner: ownerAfter,
      queuedFallback: true,
      queueKey: queued.entry.queueKey,
      queuePosition: queued.queuePosition,
    };
  }
  return {
    ...dispatch,
    blockedByCooldown: false,
    cooldownRemainingSeconds: null,
    owner: ownerAfter,
  };
}

export function registerWorkflowTools(plugin: PluginRegistrationContext) {
  plugin.api.registerTool(
    (ctx) => ({
      name: "research_workflow",
      description:
        "Project workflow guard, deterministic auto-iterator, idle research state, experiment ledger, theory/proof packets, innovation reflection, writing contract, citation integrity state, and mailbox. Use it to inspect current workflow state, reconcile and advance stages deterministically, keep structured background/experiment/theory memory current, refresh experiment-informed ideation memory, persist template-driven writing constraints, record citation verification, read or send bounded handoff messages, and avoid direct edits to workflow state files.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: [
              "get_snapshot",
              "get_runtime_health",
              "diagnose_track_evidence",
              "get_papernexus_remote_access",
              "get_papernexus_progress",
              "check_graph_presence",
              "audit_literature_coverage",
              "plan_citation_expansion",
              "auto_iterator_tick",
              "start_background_run",
              "run_papernexus_wrapper",
              "queue_paper_ingestion",
              "validate_paper_ingestion",
              "queue_literature_discovery_requisition",
              "migrate_runtime_state",
              "get_idle_research",
              "set_idle_research",
              "record_idle_research_run",
              "get_experiment_memory",
              "get_innovation_reflection",
              "get_brainstorm_cycle",
              "get_survey_review",
              "set_brainstorm_cycle",
              "run_brainstorm_cycle",
              "materialize_ideation_contract",
              "materialize_experiment_review_state",
              "materialize_literature_discovery_packet",
              "materialize_plan_state",
              "materialize_papernexus_packet_contracts",
              "materialize_paper_story_state",
              "materialize_writing_support_artifacts",
              "materialize_cycle_memory",
              "materialize_survey_review_state",
              "get_research_program",
              "set_survey_review",
              "set_research_program",
              "get_orchestration_state",
              "set_orchestration_state",
              "get_paper_ingestion",
              "set_paper_ingestion",
              "get_theory_state",
              "get_writing_contract",
              "get_paper_story_state",
              "set_paper_story_state",
              "get_write_package",
              "set_write_package",
              "assemble_write_package",
              "get_writing_session",
              "set_writing_session",
              "get_review_session",
              "set_review_session",
              "get_review_pressure_packet",
              "materialize_review_pressure_packet",
              "set_review_pressure_packet",
              "get_graph_guided_writing",
              "set_graph_guided_writing",
              "get_citation_integrity",
              "get_paper_qc",
              "set_paper_qc",
              "get_figure_qc",
              "set_figure_qc",
              "get_citation_collection",
              "set_citation_collection",
              "get_review_issue_tracker",
              "set_review_issue_tracker",
              "get_experiment_search",
              "get_experiment_git_review",
              "get_experiment_review_state",
              "set_experiment_search",
              "request_experiment_git_op",
              "set_experiment_git_review",
              "apply_experiment_git_op",
              "set_experiment_review_state",
              "materialize_experiment_memory_packet",
              "get_external_review_state",
              "set_external_review_state",
              "get_gate_state",
              "set_gate_state",
              "list_background_sessions",
              "prune_background_sessions",
              "get_gate_review_state",
              "upsert_experiment",
              "record_theory_state",
              "upsert_proof_packet",
              "materialize_theory_appendix",
              "record_innovation_reflection",
              "set_writing_contract",
              "record_citation_verification",
              "get_channel_project_binding",
              "bind_channel_project",
              "unbind_channel_project",
              "list_channel_project_bindings",
              "dispatch_task",
              "read_mailbox",
              "send_mailbox",
              "ack_mailbox",
            ],
          },
          idleResearch: {
            type: "object",
            additionalProperties: true,
          },
          iterator: {
            type: "object",
            additionalProperties: true,
          },
          backgroundRun: {
            type: "object",
            additionalProperties: true,
          },
          papernexusWrapper: {
            type: "object",
            additionalProperties: true,
          },
          paperIngestionRequest: {
            type: "object",
            additionalProperties: true,
          },
          literatureCoverage: {
            type: "object",
            additionalProperties: true,
          },
          citationExpansion: {
            type: "object",
            additionalProperties: true,
          },
          literatureDiscovery: {
            type: "object",
            additionalProperties: true,
          },
          runtimeState: {
            type: "object",
            additionalProperties: true,
          },
          graphPresenceCheck: {
            type: "object",
            additionalProperties: true,
          },
          idleResearchRun: {
            type: "object",
            additionalProperties: true,
          },
          experiment: {
            type: "object",
            additionalProperties: true,
          },
          innovationReflection: {
            type: "object",
            additionalProperties: true,
          },
          brainstormCycle: {
            type: "object",
            additionalProperties: true,
          },
          surveyReview: {
            type: "object",
            additionalProperties: true,
          },
          ideationMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          surveyReviewMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          literatureDiscoveryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          paperStoryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          writingSupportMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          cycleMemoryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          researchProgram: {
            type: "object",
            additionalProperties: true,
          },
          orchestrationState: {
            type: "object",
            additionalProperties: true,
          },
          paperIngestion: {
            type: "object",
            additionalProperties: true,
          },
          theoryState: {
            type: "object",
            additionalProperties: true,
          },
          proofPacket: {
            type: "object",
            additionalProperties: true,
          },
          theoryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          writingContract: {
            type: "object",
            additionalProperties: true,
          },
          writePackage: {
            type: "object",
            additionalProperties: true,
          },
          writePackageAssembly: {
            type: "object",
            additionalProperties: true,
          },
          writingSession: {
            type: "object",
            additionalProperties: true,
          },
          reviewSession: {
            type: "object",
            additionalProperties: true,
          },
          reviewPressureMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          externalReview: {
            type: "object",
            additionalProperties: true,
          },
          paperQc: {
            type: "object",
            additionalProperties: true,
          },
          figureQc: {
            type: "object",
            additionalProperties: true,
          },
          citationCollection: {
            type: "object",
            additionalProperties: true,
          },
          reviewIssueTracker: {
            type: "object",
            additionalProperties: true,
          },
          experimentSearch: {
            type: "object",
            additionalProperties: true,
          },
          experimentGitRequest: {
            type: "object",
            additionalProperties: true,
          },
          experimentGitReview: {
            type: "object",
            additionalProperties: true,
          },
          experimentMemoryMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          gateState: {
            type: "object",
            additionalProperties: true,
          },
          graphGuidedWriting: {
            type: "object",
            additionalProperties: true,
          },
          backgroundSessions: {
            type: "object",
            additionalProperties: true,
          },
          citationVerification: {
            type: "object",
            additionalProperties: true,
          },
          channelBinding: {
            type: "object",
            additionalProperties: true,
          },
          toAgent: {
            type: "string",
          },
          subject: {
            type: "string",
          },
          command: {
            type: "string",
          },
          body: {
            type: "string",
          },
          extraBody: {
            type: "string",
          },
          kind: {
            type: "string",
            enum: ["handoff", "blocker", "request", "note"],
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high"],
          },
          limit: {
            type: "number",
            minimum: 1,
          },
          includeAcknowledged: {
            type: "boolean",
          },
          messageId: {
            type: "string",
          },
          waitSeconds: {
            type: "number",
            minimum: 0,
          },
          retryOnTimeout: {
            type: "boolean",
          },
          enableSpawnFallback: {
            type: "boolean",
          },
        },
        required: ["action"],
      },
      async execute(_id, params) {
        const action = String(params.action ?? "");
        const executeAction = async () => {
          const state = await resolveWorkflowToolState({
            plugin,
            agentCtx: ctx,
            rawParams: params,
            action,
          });
          const {
            workflowPolicy,
            channelBinding,
            snapshot,
            projectRoot,
            projectRequiredMessage,
            bindingRole,
          } = state;
          const traceAction = async (
            status: "started" | "failed",
            details?: Record<string, unknown>
          ) => {
            if (!projectRoot) {
              return;
            }
            await appendWorkflowTraceEvent({
              projectRoot,
              projectId: snapshot.projectId,
              kind: "tool_action",
              action,
              functionName: WORKFLOW_ACTION_FUNCTIONS[action] ?? action,
              stage: snapshot.currentStage,
              owner: snapshot.ownerAgent,
              agentId: ctx.agentId,
              sessionKey: ctx.sessionKey,
              summary: `research_workflow.${action} ${status}`,
              details: {
                status,
                ...(details ?? {}),
              },
            });
          };
          await traceAction("started");

          try {
            switch (action) {
              case "get_snapshot":
                return textResponse(JSON.stringify(snapshot, null, 2));
            case "get_runtime_health": {
              const report = await getWorkflowRuntimeHealthReport({
                state,
                agentCtx: ctx,
              });
              return textResponse(JSON.stringify(report, null, 2));
            }
            case "diagnose_track_evidence": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const diagnosis = await diagnoseTrackEvidence(resolvedProjectRoot);
              return textResponse(JSON.stringify(diagnosis, null, 2));
            }
            case "get_papernexus_remote_access": {
              const access = await inspectPapernexusRemoteAccess({
                apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
                mcpUrl: workflowPolicy.papernexusMcpUrl,
                mcpTransport: workflowPolicy.papernexusMcpTransport,
                mcpTimeoutMs: workflowPolicy.papernexusMcpTimeoutMs,
                tokenSource: workflowPolicy.papernexusApiTokenSource,
                tokenEnv: workflowPolicy.papernexusApiTokenEnv,
                tokenService: workflowPolicy.papernexusApiTokenService,
                tokenAccount: workflowPolicy.papernexusApiTokenAccount,
                mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
                tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
              });
              return textResponse(
                JSON.stringify(
                  {
                    ...access,
                    token: access.tokenAvailable ? "[REDACTED]" : null,
                  },
                  null,
                  2
                )
              );
            }
            case "get_papernexus_progress": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const progress = await getPapernexusProgressSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(progress, null, 2));
            }
            case "check_graph_presence": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const graphPresenceCheck = asObject(params.graphPresenceCheck);
              const result = await checkGraphPresenceForWorkflow({
                projectRoot: resolvedProjectRoot,
                updateManifest:
                  graphPresenceCheck?.updateManifest === false ||
                  graphPresenceCheck?.update_manifest === false
                    ? false
                    : true,
                sharedCorpus: workflowPolicy.papernexusSharedCorpus,
                remoteAccess: {
                  apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
                  mcpUrl: workflowPolicy.papernexusMcpUrl,
                  mcpTransport: workflowPolicy.papernexusMcpTransport,
                  mcpTimeoutMs: workflowPolicy.papernexusMcpTimeoutMs,
                  tokenSource: workflowPolicy.papernexusApiTokenSource,
                  tokenEnv: workflowPolicy.papernexusApiTokenEnv,
                  tokenService: workflowPolicy.papernexusApiTokenService,
                  tokenAccount: workflowPolicy.papernexusApiTokenAccount,
                  mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
                  tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
                },
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "audit_literature_coverage": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const audit = await auditLiteratureCoverageForWorkflow({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(audit, null, 2));
            }
            case "plan_citation_expansion": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const citationExpansion = asObject(params.citationExpansion);
              const packet = await planCitationExpansionForWorkflow({
                projectRoot: resolvedProjectRoot,
                maxSeeds: readNumber(
                  citationExpansion?.maxSeeds ?? citationExpansion?.max_seeds
                ),
              });
              return textResponse(JSON.stringify(packet, null, 2));
            }
            case "get_channel_project_binding": {
              const binding = getChannelProjectBindingForWorkflow({
                policy: workflowPolicy,
                workspaceDir: ctx.workspaceDir,
                sessionKey: ctx.sessionKey,
                sessionId: ctx.sessionId,
                messageChannel: ctx.messageChannel,
                channelKey:
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey),
              });
              return textResponse(JSON.stringify(binding, null, 2));
            }
            case "list_channel_project_bindings": {
              const bindings = listChannelProjectBindingsForWorkflow({
                policy: workflowPolicy,
                workspaceDir: ctx.workspaceDir,
              });
              return textResponse(JSON.stringify(bindings, null, 2));
            }
            case "bind_channel_project": {
              if (bindingRole && bindingRole !== "researcher") {
                throw new Error(
                  "Only Researcher may bind a Discord/channel session to a project in this workflow."
                );
              }
              const bound = await bindChannelProjectForWorkflow({
                policy: workflowPolicy,
                workspaceDir: ctx.workspaceDir,
                sessionKey: ctx.sessionKey,
                sessionId: ctx.sessionId,
                messageChannel: ctx.messageChannel,
                channelKey:
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey),
                projectRoot:
                  readString(channelBinding?.projectRoot) ??
                  readString(channelBinding?.project_path) ??
                  process.env.OPENCLAW_PROJECT ??
                  snapshot.projectRoot,
                projectId:
                  readString(channelBinding?.projectId) ??
                  readString(channelBinding?.project_id) ??
                  snapshot.projectId,
                title:
                  readString(channelBinding?.title) ??
                  readString(channelBinding?.topic),
                topic: readString(channelBinding?.topic),
                boundByAgent: ctx.agentId,
                notes: readString(channelBinding?.notes),
              });
              return textResponse(JSON.stringify(bound, null, 2));
            }
            case "unbind_channel_project": {
              if (bindingRole && bindingRole !== "researcher") {
                throw new Error(
                  "Only Researcher may remove a Discord/channel session project binding in this workflow."
                );
              }
              const result = await unbindChannelProjectForWorkflow({
                policy: workflowPolicy,
                workspaceDir: ctx.workspaceDir,
                sessionKey: ctx.sessionKey,
                sessionId: ctx.sessionId,
                messageChannel: ctx.messageChannel,
                channelKey:
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "auto_iterator_tick": {
              const iterator = asObject(params.iterator);
              if (!projectRoot) {
                return textResponse(
                  JSON.stringify(
                    buildUnboundProjectAutoIteratorPayload({
                      snapshot,
                      iterator,
                    }),
                    null,
                    2
                  )
                );
              }
              const result = await runWorkflowAutoIterator({
                projectRoot,
                policy: workflowPolicy,
                agentId: ctx.agentId,
                mode: readString(iterator?.mode),
                queueMailbox:
                  iterator?.queueMailbox === false ||
                  iterator?.queue_mailbox === false
                    ? false
                    : true,
                cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
              });
              const dispatchResult =
                iterator?.dispatchTasks === false || iterator?.dispatch_tasks === false
                  ? null
                  : await maybeDispatchAutoIteratorTask({
                      plugin,
                      workflowPolicy,
                      agentCtx: ctx,
                      snapshot,
                      result,
                      waitTimeoutMs:
                        (readNumber(iterator?.waitTimeoutMs) ??
                          readNumber(iterator?.wait_timeout_ms)) ??
                        5000,
                      retryOnTimeout:
                        iterator?.retryOnTimeout === true ||
                        iterator?.retry_on_timeout === true,
                      enableSpawnFallback:
                        iterator?.enableSpawnFallback === false ||
                        iterator?.enable_spawn_fallback === false
                          ? false
                          : true,
                    });
              const stageBroadcast =
                iterator?.broadcastStageChange === false ||
                iterator?.broadcast_stage_change === false
                  ? {
                      broadcasted: false,
                      reasonSkipped: "disabled_by_iterator",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    }
                  : await maybeBroadcastAutoIteratorStageChange({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      sessionKey: ctx.sessionKey,
                      projectId: snapshot.projectId,
                      projectRoot,
                      stageBefore: result.stageBefore,
                      stageAfter: result.stageAfter,
                      stageChanged: result.stageChanged,
                      ownerBefore: result.ownerBefore,
                      ownerAfter: result.ownerAfter,
                      nextAction: result.nextAction,
                      blockingReason: result.blockingReason,
                      regressed: result.regressed,
                      recommendedActions: result.recommendedActions,
                      agentTaskDispatch: dispatchResult,
                    });
              const statusBroadcast =
                result.timedDefaultTriggered === true
                  ? await maybeBroadcastWorkflowStatusUpdate({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      sessionKey: ctx.sessionKey,
                      projectId: snapshot.projectId,
                      projectRoot,
                      status: "continued",
                      stage: result.stageAfter,
                      summary:
                        result.gateReason ??
                        "The workflow continued through the default safe branch after the confirmation deadline expired.",
                      idempotencyKeySuffix: [
                        "timed-default",
                        result.stageAfter ?? "unknown-stage",
                      ].join(":"),
                    })
                  : {
                      broadcasted: false,
                      reasonSkipped: "not_needed",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    };
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    agentTaskDispatch: dispatchResult,
                    stageBroadcast,
                    statusBroadcast,
                  },
                  null,
                  2
                )
              );
            }
            case "start_background_run": {
              const backgroundRun = requireObject<BackgroundRunRequest>(
                params.backgroundRun,
                "backgroundRun"
              );
              const result = await startBackgroundWorkflowRun({
                runtimeSubagent: plugin.api.runtime?.subagent,
                workflowPolicy,
                agentCtx: ctx,
                snapshot,
                backgroundRun,
              });
              const resolvedProjectId = result.projectId ?? snapshot.projectId;
              const resolvedProjectRoot = result.projectRoot ?? projectRoot;
              const statusBroadcast =
                resolvedProjectRoot && ctx.sessionKey
                  ? await maybeBroadcastWorkflowStatusUpdate({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      sessionKey: ctx.sessionKey,
                      projectId: resolvedProjectId,
                      projectRoot: resolvedProjectRoot,
                      status: result.started
                        ? "started"
                        : result.reason === "channel_capacity_reached"
                          ? "queued"
                          : "waiting",
                      stage: snapshot.currentStage,
                      summary: result.summary,
                      idempotencyKeySuffix: [
                        "start-background-run",
                        backgroundRun.kind ?? "generic",
                        result.reason,
                        result.reusedIdleSession ? "reused" : "fresh",
                      ].join(":"),
                    })
                  : {
                      broadcasted: false,
                      reasonSkipped: resolvedProjectRoot ? "session_unavailable" : "project_unavailable",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    };
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    statusBroadcast,
                  },
                  null,
                  2
                )
              );
            }
            case "run_papernexus_wrapper": {
              const papernexusWrapper = requireObject<PapernexusWrapperRunRequest>(
                params.papernexusWrapper,
                "papernexusWrapper"
              );
              const backgroundRun =
                buildPapernexusWrapperBackgroundRunRequest(papernexusWrapper);
              const result = await startBackgroundWorkflowRun({
                runtimeSubagent: plugin.api.runtime?.subagent,
                workflowPolicy,
                agentCtx: ctx,
                snapshot,
                backgroundRun,
              });
              const resolvedProjectId = result.projectId ?? snapshot.projectId;
              const resolvedProjectRoot = result.projectRoot ?? projectRoot;
              if (
                resolvedProjectRoot &&
                result.started &&
                isTrackedPapernexusImportWrapper(backgroundRun.wrapper)
              ) {
                const phaseOverride =
                  backgroundRun.wrapper === "pn_stage_sync.py"
                    ? "uploading"
                    : backgroundRun.wrapper === "pn_import_queue.py"
                      ? "waiting_import"
                      : "submitting";
                await writePapernexusProgressFromManifest({
                  projectRoot: resolvedProjectRoot,
                  manifest: {
                    project_id: resolvedProjectId,
                    next_action: snapshot.nextAction,
                    blocking_reason: snapshot.blockingReason,
                    paper_ingestion: {},
                  },
                  ownerRun: {
                    run_id: result.runId,
                    session_key: result.sessionKey,
                    queue_key: result.queueKey,
                    wrapper: backgroundRun.wrapper,
                  },
                  phaseOverride,
                  nextActionOverride:
                    phaseOverride === "uploading"
                      ? "wait for staged file upload"
                      : phaseOverride === "waiting_import"
                        ? "wait for import completion"
                        : "wait for import task submission",
                  updatedAt: new Date().toISOString(),
                });
              }
              const statusBroadcast =
                resolvedProjectRoot && ctx.sessionKey
                  ? await maybeBroadcastWorkflowStatusUpdate({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      sessionKey: ctx.sessionKey,
                      projectId: resolvedProjectId,
                      projectRoot: resolvedProjectRoot,
                      status: result.started
                        ? "started"
                        : result.reason === "channel_capacity_reached"
                          ? "queued"
                          : "waiting",
                      stage: snapshot.currentStage,
                      summary: backgroundRun.summary ?? result.summary,
                      idempotencyKeySuffix: [
                        "run-papernexus-wrapper",
                        backgroundRun.wrapper,
                        result.reason,
                        result.reusedIdleSession ? "reused" : "fresh",
                      ].join(":"),
                    })
                  : {
                      broadcasted: false,
                      reasonSkipped: resolvedProjectRoot
                        ? "session_unavailable"
                        : "project_unavailable",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    };
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    wrapper: backgroundRun.wrapper,
                    commandText: backgroundRun.commandText,
                    statusBroadcast,
                  },
                  null,
                  2
                )
              );
            }
            case "queue_paper_ingestion": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const requestPayload = requireObject<Record<string, unknown>>(
                params.paperIngestionRequest ?? params.papernexusWrapper,
                "paperIngestionRequest"
              );
              const wrapperRun =
                buildPapernexusWrapperBackgroundRunRequest(requestPayload);
              const queued = await queuePaperIngestionRequest({
                projectRoot: resolvedProjectRoot,
                paperIngestionRequest: {
                  request_id:
                    readString(requestPayload.requestId ?? requestPayload.request_id) ??
                    undefined,
                  wrapper: wrapperRun.wrapper,
                  args: Array.isArray(requestPayload.args)
                    ? requestPayload.args
                    : [],
                  command_text: wrapperRun.commandText,
                  manifest_path:
                    readString(requestPayload.manifestPath ?? requestPayload.manifest_path) ??
                    null,
                  shared_corpus:
                    readString(requestPayload.sharedCorpus ?? requestPayload.shared_corpus) ??
                    null,
                  paper_count:
                    readNumber(requestPayload.paperCount ?? requestPayload.paper_count) ?? null,
                  summary:
                    readString(requestPayload.summary) ??
                    wrapperRun.summary,
                },
              });
              return textResponse(
                JSON.stringify(
                  {
                    ...queued,
                    commandText: queued.request.commandText,
                  },
                  null,
                  2
                )
              );
            }
            case "queue_idea_catalyst_requisition": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await queueIdeaCatalystRequisition({
                projectRoot: resolvedProjectRoot,
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "queue_literature_discovery_requisition": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const literatureDiscovery = requireObject<Record<string, unknown>>(
                params.literatureDiscovery ?? {},
                "literatureDiscovery"
              );
              const result = await queueLiteratureDiscoveryRequisition({
                projectRoot: resolvedProjectRoot,
                packetPath:
                  readString(
                    literatureDiscovery.packetPath ?? literatureDiscovery.packet_path
                  ) ??
                  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json",
                triggerKind:
                  readString(
                    literatureDiscovery.triggerKind ?? literatureDiscovery.trigger_kind
                  ) ?? "literature_discovery",
                originStage:
                  readString(
                    literatureDiscovery.originStage ?? literatureDiscovery.origin_stage
                  ) ?? snapshot.currentStage,
                summary: readString(literatureDiscovery.summary),
                sharedCorpus:
                  readString(
                    literatureDiscovery.sharedCorpus ?? literatureDiscovery.shared_corpus
                  ) ?? null,
                requestIdPrefix:
                  readString(
                    literatureDiscovery.requestIdPrefix ??
                      literatureDiscovery.request_id_prefix
                  ) ?? null,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "migrate_runtime_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const runtimeState = asObject(params.runtimeState);
              const result = await migrateWorkflowRuntimeState({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                compatibilityMode:
                  readString(runtimeState?.compatibilityMode) === "legacy_dispatch" ||
                  readString(runtimeState?.compatibilityMode) === "hybrid_runtime" ||
                  readString(runtimeState?.compatibilityMode) ===
                    "sessions_spawn_runtime"
                    ? (readString(runtimeState?.compatibilityMode) as
                        | "legacy_dispatch"
                        | "hybrid_runtime"
                        | "sessions_spawn_runtime")
                    : "sessions_spawn_runtime",
                reason:
                  readString(runtimeState?.reason) ??
                  "research_workflow.migrate_runtime_state",
                notes: Array.isArray(runtimeState?.notes)
                  ? runtimeState?.notes
                      .map((value) => readString(value))
                      .filter((value): value is string => Boolean(value))
                  : undefined,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "list_background_sessions": {
              const backgroundSessions = asObject(params.backgroundSessions);
              const result = await listBackgroundWorkflowRuns({
                runtimeSubagent: plugin.api.runtime?.subagent,
                ownerAgent: readString(backgroundSessions?.ownerAgent) ?? bindingRole,
                channelKey:
                  readString(backgroundSessions?.channelKey) ??
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey) ??
                  snapshot.channelProjectBindingKey,
                family: readString(backgroundSessions?.family),
                projectId: readString(backgroundSessions?.projectId) ?? snapshot.projectId,
                projectRoot: readString(backgroundSessions?.projectRoot) ?? projectRoot,
                projectsRoot: workflowPolicy.projectsRoot,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "prune_background_sessions": {
              const backgroundSessions = asObject(params.backgroundSessions);
              const result = await pruneBackgroundWorkflowRuns({
                runtimeSubagent: plugin.api.runtime?.subagent,
                ownerAgent: readString(backgroundSessions?.ownerAgent) ?? bindingRole,
                channelKey:
                  readString(backgroundSessions?.channelKey) ??
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey) ??
                  snapshot.channelProjectBindingKey,
                family: readString(backgroundSessions?.family),
                projectId: readString(backgroundSessions?.projectId) ?? snapshot.projectId,
                projectRoot: readString(backgroundSessions?.projectRoot) ?? projectRoot,
                projectsRoot: workflowPolicy.projectsRoot,
                idleOlderThanMs: readNumber(backgroundSessions?.idleOlderThanMs),
                deleteSessions: backgroundSessions?.deleteSessions === true,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "retire_background_sessions": {
              const backgroundSessions = asObject(params.backgroundSessions);
              const result = await retireBackgroundWorkflowRuns({
                runtimeSubagent: plugin.api.runtime?.subagent,
                ownerAgent: readString(backgroundSessions?.ownerAgent) ?? bindingRole,
                channelKey:
                  readString(backgroundSessions?.channelKey) ??
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey) ??
                  snapshot.channelProjectBindingKey,
                family: readString(backgroundSessions?.family),
                projectId: readString(backgroundSessions?.projectId) ?? snapshot.projectId,
                projectRoot: readString(backgroundSessions?.projectRoot) ?? projectRoot,
                projectsRoot: workflowPolicy.projectsRoot,
                statuses: Array.isArray(backgroundSessions?.statuses)
                  ? backgroundSessions?.statuses
                  : undefined,
                deleteSessions: backgroundSessions?.deleteSessions === true,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_gate_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await getGateStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_gate_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const gateState = requireObject<Record<string, unknown>>(
                params.gateState,
                "gateState"
              );
              const result = await setGateStateForWorkflow({
                projectRoot: resolvedProjectRoot,
                gateState,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "dispatch_task": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!snapshot.role) {
                throw new Error("Cannot determine the current workflow role for dispatch_task.");
              }
              const toAgent = inferTargetRoleFromToolParams({
                agentId: params.toAgent,
              }) as DispatchableWorkflowRole | null;
              if (!toAgent) {
                throw new Error("toAgent must be one of the known workflow agents.");
              }
              if (
                !canRoleContactInWorkflow({
                  fromRole: snapshot.role,
                  toRole: toAgent,
                  currentStage: snapshot.currentStage,
                })
              ) {
                throw new Error(`${snapshot.role} cannot dispatch work to ${toAgent}.`);
              }
              const cooldown = await getWorkflowContactCooldown({
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
              });
              if (cooldown.blocked) {
                return textResponse(
                  JSON.stringify(
                    {
                      dispatched: false,
                      blockedByCooldown: true,
                      cooldownRemainingSeconds: cooldown.remainingSeconds,
                      lastEvent: cooldown.lastEvent,
                    },
                    null,
                    2
                  )
                );
              }
              const subject = readString(params.subject) ?? "Workflow task dispatch";
              const body = readString(params.body);
              const explicitCommand = readString(params.command);
              const explicitExtraBody = readString(params.extraBody);
              const command =
                explicitCommand ??
                (body && !body.includes("\n") ? body : snapshot.nextAction);
              const extraBody =
                explicitExtraBody ??
                (body && body.includes("\n") ? body : null);
              const dispatch = await dispatchWorkflowTaskToAgent({
                runtimeSubagent: plugin.api.runtime?.subagent,
                requesterSessionKey: ctx.sessionKey,
                requesterChannel: ctx.messageChannel,
                fromRole: snapshot.role,
                toRole: toAgent,
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                stage: snapshot.currentStage,
                summary: subject,
                command,
                requireMailboxAcknowledgement: false,
                extraBody,
                waitTimeoutMs: Math.max(
                  0,
                  Math.floor(((readNumber(params.waitSeconds) ?? 0) as number) * 1000)
                ),
                retryOnTimeout: params.retryOnTimeout === true,
                enableSpawnFallback: params.enableSpawnFallback === false ? false : true,
              });
              if (dispatch.dispatched) {
                await recordWorkflowContactEvent({
                  projectRoot: resolvedProjectRoot,
                  fromAgent: snapshot.role,
                  toAgent,
                  channel: dispatch.channel ?? "sessions_send",
                });
              }
              return textResponse(JSON.stringify(dispatch, null, 2));
            }
            case "get_idle_research": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getIdleResearchStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_idle_research": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setIdleResearchState({
                projectRoot: resolvedProjectRoot,
                idleResearch: requireObject(params.idleResearch, "idleResearch"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_idle_research_run": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordIdleResearchRun({
                projectRoot: resolvedProjectRoot,
                idleResearchRun: requireObject(
                  params.idleResearchRun,
                  "idleResearchRun"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_experiment_memory": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentMemorySummary({
                projectRoot: resolvedProjectRoot,
                limit:
                  typeof params.limit === "number" && Number.isFinite(params.limit)
                    ? Math.floor(params.limit)
                    : 6,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_innovation_reflection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getInnovationReflectionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getBrainstormCycleStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_survey_review": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getSurveyReviewStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setBrainstormCycleState({
                projectRoot: resolvedProjectRoot,
                brainstormCycle: requireObject(
                  params.brainstormCycle,
                  "brainstormCycle"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "run_brainstorm_cycle": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await runBrainstormCycle({
                projectRoot: resolvedProjectRoot,
                brainstormCycle: requireObject(
                  params.brainstormCycle,
                  "brainstormCycle"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_ideation_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getIdeationContractStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_idea_catalyst_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getIdeaCatalystStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "materialize_ideation_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeIdeationContract({
                projectRoot: resolvedProjectRoot,
                ideationMaterialization: requireObject(
                  params.ideationMaterialization ?? {},
                  "ideationMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_plan_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializePlanState({
                projectRoot: resolvedProjectRoot,
                planMaterialization: requireObject(
                  params.planMaterialization ?? {},
                  "planMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_idea_catalyst_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeIdeaCatalystState({
                projectRoot: resolvedProjectRoot,
                ideaCatalystMaterialization: requireObject(
                  params.ideaCatalystMaterialization ?? {},
                  "ideaCatalystMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_survey_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeSurveyReviewState({
                projectRoot: resolvedProjectRoot,
                surveyReviewMaterialization: requireObject(
                  params.surveyReviewMaterialization ?? {},
                  "surveyReviewMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_ideation_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setIdeationContractState({
                projectRoot: resolvedProjectRoot,
                ideationContract: requireObject(
                  params.ideationContract,
                  "ideationContract"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_idea_catalyst_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setIdeaCatalystState({
                projectRoot: resolvedProjectRoot,
                ideaCatalyst: requireObject(
                  params.ideaCatalyst,
                  "ideaCatalyst"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_research_program": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getResearchProgramStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_survey_review": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setSurveyReviewState({
                projectRoot: resolvedProjectRoot,
                surveyReview: requireObject(params.surveyReview, "surveyReview"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_research_program": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setResearchProgramState({
                projectRoot: resolvedProjectRoot,
                researchProgram: requireObject(
                  params.researchProgram,
                  "researchProgram"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_orchestration_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getOrchestrationStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_orchestration_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setOrchestrationState({
                projectRoot: resolvedProjectRoot,
                orchestrationState: requireObject(
                  params.orchestrationState,
                  "orchestrationState"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_theory_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getTheoryStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_writing_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritingContractStateSummary({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_paper_story_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getPaperStoryStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "materialize_literature_discovery_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeLiteratureDiscoveryPacket({
                projectRoot: resolvedProjectRoot,
                literatureDiscoveryMaterialization: requireObject(
                  params.literatureDiscoveryMaterialization ?? {},
                  "literatureDiscoveryMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_papernexus_packet_contracts": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializePapernexusPacketContracts({
                projectRoot: resolvedProjectRoot,
                packetPaths: requireObject(
                  params.packetPaths ?? {},
                  "packetPaths"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_paper_story_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializePaperStoryState({
                projectRoot: resolvedProjectRoot,
                paperStoryMaterialization: requireObject(
                  params.paperStoryMaterialization ?? {},
                  "paperStoryMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_writing_support_artifacts": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const paperStorySummary = await getPaperStoryStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              const reviewPressureSummary =
                await getReviewPressurePacketStateSummary({
                  projectRoot: resolvedProjectRoot,
                });
              const basisStage =
                readString(asObject(params.writingSupportMaterialization)?.basis_stage) ??
                readString(asObject(params.writingSupportMaterialization)?.basisStage) ??
                snapshot.currentStage ??
                "write";
              const result = await materializeWritingSupportArtifacts({
                projectRoot: resolvedProjectRoot,
                stage: basisStage,
                paperStoryState: paperStorySummary.state,
                reviewPressureState: reviewPressureSummary.state,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_cycle_memory": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const basisStage =
                readString(asObject(params.cycleMemoryMaterialization)?.basis_stage) ??
                readString(asObject(params.cycleMemoryMaterialization)?.basisStage) ??
                snapshot.currentStage ??
                "write";
              const result = await materializeCycleMemory({
                projectRoot: resolvedProjectRoot,
                stage: basisStage,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_paper_story_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setPaperStoryState({
                projectRoot: resolvedProjectRoot,
                paperStoryState: requireObject(
                  params.paperStoryState,
                  "paperStoryState"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritePackageStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritePackageState({
                projectRoot: resolvedProjectRoot,
                writePackage: requireObject(params.writePackage, "writePackage"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "assemble_write_package": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await assembleWritePackage({
                projectRoot: resolvedProjectRoot,
                mode: readString(asObject(params.writePackageAssembly)?.mode) ?? "deterministic",
                trigger:
                  readString(asObject(params.writePackageAssembly)?.trigger) ??
                  "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_writing_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getWritingSessionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_writing_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritingSessionState({
                projectRoot: resolvedProjectRoot,
                writingSession: requireObject(params.writingSession, "writingSession"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_review_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getReviewSessionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_review_session": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setReviewSessionState({
                projectRoot: resolvedProjectRoot,
                reviewSession: requireObject(params.reviewSession, "reviewSession"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_review_pressure_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getReviewPressurePacketStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "materialize_review_pressure_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeReviewPressurePacket({
                projectRoot: resolvedProjectRoot,
                reviewPressureMaterialization: requireObject(
                  params.reviewPressureMaterialization ?? {},
                  "reviewPressureMaterialization"
                ),
                trigger: "research_workflow",
                agentId: ctx.agentId,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_review_pressure_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setReviewPressurePacketState({
                projectRoot: resolvedProjectRoot,
                reviewPressurePacket: requireObject(
                  params.reviewPressurePacket,
                  "reviewPressurePacket"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_graph_guided_writing": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getGraphGuidedWritingStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_graph_guided_writing": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setGraphGuidedWritingState({
                projectRoot: resolvedProjectRoot,
                graphGuidedWriting: requireObject(
                  params.graphGuidedWriting,
                  "graphGuidedWriting"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_citation_integrity": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getCitationIntegrityStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_paper_ingestion": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getPaperIngestionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "validate_paper_ingestion": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const requestPayload = asObject(params.paperIngestionRequest);
              const result = await validatePaperIngestionRequest({
                projectRoot: resolvedProjectRoot,
                requestId: readString(
                  requestPayload?.requestId ?? requestPayload?.request_id
                ),
                paperIngestionRequest: requestPayload,
                persist:
                  requestPayload && Object.keys(requestPayload).length > 0
                    ? false
                    : true,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_paper_ingestion": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setPaperIngestionState({
                projectRoot: resolvedProjectRoot,
                paperIngestion: requireObject(params.paperIngestion, "paperIngestion"),
              });
              const completedPaperBroadcasts: Array<
                Awaited<ReturnType<typeof maybeBroadcastWorkflowStatusUpdate>>
              > = [];
              const paperOperationBroadcasts: Array<
                Awaited<ReturnType<typeof maybeBroadcastWorkflowStatusUpdate>>
              > = [];
              const batchStatusBroadcasts: Array<
                Awaited<ReturnType<typeof maybeBroadcastWorkflowStatusUpdate>>
              > = [];
              for (const completedPaper of result.newlyCompletedPapers) {
                const paperLabel =
                  completedPaper.title ??
                  completedPaper.canonicalId ??
                  completedPaper.importTaskId ??
                  "unknown paper";
                const summaryParts = [`PaperNexus import completed: ${paperLabel}`];
                if (completedPaper.canonicalId) {
                  summaryParts.push(`(${completedPaper.canonicalId})`);
                }
                if (completedPaper.importTaskId) {
                  summaryParts.push(`via task ${completedPaper.importTaskId}`);
                }
                const broadcastResult = await maybeBroadcastWorkflowStatusUpdate({
                  runtimeSubagent: plugin.api.runtime?.subagent,
                  sessionKey: ctx.sessionKey,
                  projectId: snapshot.projectId,
                  projectRoot: resolvedProjectRoot,
                  status: "completed",
                  stage: snapshot.currentStage,
                  summary: `${summaryParts.join(" ")}.`,
                  idempotencyKeySuffix: [
                    "set-paper-ingestion",
                    "completed-paper",
                    completedPaper.canonicalId ?? "unknown-canonical",
                    completedPaper.importTaskId ?? "unknown-import-task",
                    completedPaper.title ?? "unknown-title",
                  ].join(":"),
                });
                completedPaperBroadcasts.push(broadcastResult);
              }
              for (const operation of result.newlyTerminalPaperOperations) {
                if (!["timed_out", "failed"].includes(operation.status)) {
                  continue;
                }
                const paperLabel =
                  operation.title ??
                  operation.canonicalId ??
                  operation.importTaskId ??
                  "unknown paper";
                const phaseLabel =
                  operation.phase === "graph" ? "graph reconcile" : "import";
                const timeoutLabel =
                  typeof operation.timeoutSeconds === "number"
                    ? `${operation.timeoutSeconds}s`
                    : "the configured time budget";
                const summaryParts = [
                  `PaperNexus ${phaseLabel} ${
                    operation.status === "timed_out"
                      ? `timed out after ${timeoutLabel}`
                      : "failed"
                  }: ${paperLabel}`,
                ];
                if (operation.canonicalId) {
                  summaryParts.push(`(${operation.canonicalId})`);
                }
                if (operation.importTaskId) {
                  summaryParts.push(`via task ${operation.importTaskId}`);
                }
                if (operation.status === "timed_out") {
                  summaryParts.push("Moved on to the next paper instead of waiting indefinitely.");
                } else if (operation.detail) {
                  summaryParts.push(operation.detail);
                }
                const broadcastResult = await maybeBroadcastWorkflowStatusUpdate({
                  runtimeSubagent: plugin.api.runtime?.subagent,
                  sessionKey: ctx.sessionKey,
                  projectId: snapshot.projectId,
                  projectRoot: resolvedProjectRoot,
                  status: operation.status === "failed" ? "blocked" : "waiting",
                  stage: snapshot.currentStage,
                  summary: summaryParts.join(" "),
                  idempotencyKeySuffix: [
                    "set-paper-ingestion",
                    "paper-operation",
                    operation.phase,
                    operation.status,
                    operation.canonicalId ?? "unknown-canonical",
                    operation.importTaskId ?? "unknown-import-task",
                    operation.title ?? "unknown-title",
                  ].join(":"),
                });
                paperOperationBroadcasts.push(broadcastResult);
              }
              for (const batch of result.newlyTerminalBatches) {
                const manifestLabel = batch.manifestPath ?? "unknown manifest";
                const summaryParts = [
                  `Batch import ${
                    batch.status === "completed"
                      ? "completed"
                      : batch.status === "timed_out"
                        ? "timed out"
                        : "failed"
                  }: ${manifestLabel}`,
                ];
                if (typeof batch.completed === "number" && typeof batch.total === "number") {
                  summaryParts.push(`(${batch.completed}/${batch.total} synced)`);
                }
                if (batch.detail) {
                  summaryParts.push(batch.detail);
                }
                const broadcastResult = await maybeBroadcastWorkflowStatusUpdate({
                  runtimeSubagent: plugin.api.runtime?.subagent,
                  sessionKey: ctx.sessionKey,
                  projectId: snapshot.projectId,
                  projectRoot: resolvedProjectRoot,
                  status:
                    batch.status === "completed"
                      ? "completed"
                      : batch.status === "failed"
                        ? "blocked"
                        : "waiting",
                  stage: snapshot.currentStage,
                  summary: summaryParts.join(" "),
                  idempotencyKeySuffix: [
                    "set-paper-ingestion",
                    "batch-status",
                    batch.status,
                    batch.manifestPath ?? "unknown-manifest",
                  ].join(":"),
                });
                batchStatusBroadcasts.push(broadcastResult);
              }
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    completedPaperBroadcasts,
                    paperOperationBroadcasts,
                    batchStatusBroadcasts,
                  },
                  null,
                  2
                )
              );
            }
            case "get_paper_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getPaperQcStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_paper_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setPaperQcState({
                projectRoot: resolvedProjectRoot,
                paperQc: requireObject(params.paperQc, "paperQc"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_figure_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getFigureQcStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_figure_qc": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setFigureQcState({
                projectRoot: resolvedProjectRoot,
                figureQc: requireObject(params.figureQc, "figureQc"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_citation_collection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getCitationCollectionStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_citation_collection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setCitationCollectionState({
                projectRoot: resolvedProjectRoot,
                citationCollection: requireObject(
                  params.citationCollection,
                  "citationCollection"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_review_issue_tracker": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getReviewIssueTrackerStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_review_issue_tracker": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setReviewIssueTrackerState({
                projectRoot: resolvedProjectRoot,
                reviewIssueTracker: requireObject(
                  params.reviewIssueTracker,
                  "reviewIssueTracker"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_experiment_search": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentSearchStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_experiment_git_review": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentGitReviewSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_experiment_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentReviewStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_experiment_search": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExperimentSearchState({
                projectRoot: resolvedProjectRoot,
                experimentSearch: requireObject(
                  params.experimentSearch,
                  "experimentSearch"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "request_experiment_git_op": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await requestExperimentGitOp({
                projectRoot: resolvedProjectRoot,
                agentId: state.bindingRole,
                request: requireObject(
                  params.experimentGitRequest,
                  "experimentGitRequest"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_experiment_git_review": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExperimentGitReviewState({
                projectRoot: resolvedProjectRoot,
                experimentGitReview: requireObject(
                  params.experimentGitReview,
                  "experimentGitReview"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "apply_experiment_git_op": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await applyExperimentGitOp({
                projectRoot: resolvedProjectRoot,
                agentId: state.bindingRole,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_experiment_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExperimentReviewState({
                projectRoot: resolvedProjectRoot,
                experimentReview: requireObject(
                  params.experimentReview,
                  "experimentReview"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_experiment_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeExperimentReviewState({
                projectRoot: resolvedProjectRoot,
                experimentReviewMaterialization: asObject(
                  params.experimentReviewMaterialization
                ) ?? undefined,
                trigger: readString(params.trigger) ?? null,
                agentId: state.bindingRole,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_experiment_memory_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeExperimentMemoryPacket({
                projectRoot: resolvedProjectRoot,
                experimentMemoryMaterialization:
                  asObject(params.experimentMemoryMaterialization) ?? undefined,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_external_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExternalReviewStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "set_external_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setExternalReviewState({
                projectRoot: resolvedProjectRoot,
                externalReview: requireObject(
                  params.externalReview,
                  "externalReview"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_gate_review_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await readGateReviewStore(resolvedProjectRoot);
              return textResponse(
                JSON.stringify(
                  {
                    storePath: getGateReviewStorePath(resolvedProjectRoot),
                    ...summary,
                  },
                  null,
                  2
                )
              );
            }
            case "upsert_experiment": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await upsertExperimentLedgerEntry({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                agentId: ctx.agentId,
                experiment: requireObject(params.experiment, "experiment"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_theory_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordTheoryState({
                projectRoot: resolvedProjectRoot,
                theoryState: requireObject(params.theoryState, "theoryState"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "upsert_proof_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await upsertTheoryProofPacket({
                projectRoot: resolvedProjectRoot,
                proofPacket: requireObject(params.proofPacket, "proofPacket"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_theory_appendix": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeTheoryAppendix({
                projectRoot: resolvedProjectRoot,
                theoryMaterialization: asObject(params.theoryMaterialization),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_innovation_reflection": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordInnovationReflection({
                projectRoot: resolvedProjectRoot,
                innovationReflection: requireObject(
                  params.innovationReflection,
                  "innovationReflection"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_writing_contract": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setWritingContractState({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
                writingContract: requireObject(
                  params.writingContract,
                  "writingContract"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "record_citation_verification": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordCitationVerification({
                projectRoot: resolvedProjectRoot,
                citationVerification: requireObject(
                  params.citationVerification,
                  "citationVerification"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "read_mailbox": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
              }
              const messages = await readWorkflowMailboxForAgent({
                projectRoot: resolvedProjectRoot,
                agentId: ctx.agentId,
                limit:
                  typeof params.limit === "number" && Number.isFinite(params.limit)
                    ? Math.floor(params.limit)
                    : workflowPolicy.maxWorkflowInboxMessages,
                includeAcknowledged: params.includeAcknowledged === true,
              });
              return textResponse(JSON.stringify(messages, null, 2));
            }
            case "send_mailbox": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
              }
              if (!snapshot.role) {
                throw new Error("Cannot determine the current agent role for mailbox delivery.");
              }
              const toAgent = inferTargetRoleFromToolParams({
                agentId: params.toAgent,
              });
              if (!toAgent) {
                throw new Error("toAgent must be one of the known workflow agents.");
              }
              if (
                !canRoleContactInWorkflow({
                  fromRole: snapshot.role,
                  toRole: toAgent,
                  currentStage: snapshot.currentStage,
                })
              ) {
                throw new Error(
                  `${snapshot.role} is not allowed to contact ${toAgent}; use the bounded workflow path instead.`
                );
              }
              const cooldown = await getWorkflowContactCooldown({
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
              });
              if (cooldown.blocked) {
                throw new Error(
                  `${snapshot.role} already contacted ${toAgent} via ${cooldown.lastEvent?.channel ?? "workflow"} at ${cooldown.lastEvent?.createdAt ?? "recently"}. Wait about ${cooldown.remainingSeconds}s before contacting again.`
                );
              }
              const subject = readString(params.subject);
              const body = readString(params.body);
              if (!subject || !body) {
                throw new Error("subject and body are required for send_mailbox.");
              }
              const item = await queueWorkflowMailboxMessage({
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                subject,
                body,
                kind: readString(params.kind),
                priority: readString(params.priority),
              });
              await recordWorkflowContactEvent({
                projectRoot: resolvedProjectRoot,
                fromAgent: snapshot.role,
                toAgent,
                channel: "mailbox",
              });
              return textResponse(JSON.stringify(item, null, 2));
            }
            case "ack_mailbox": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (!workflowPolicy.enableWorkflowMailbox) {
                throw new Error("Workflow mailbox is disabled by plugin policy.");
              }
              const messageId = readString(params.messageId);
              if (!messageId) {
                throw new Error("messageId is required for ack_mailbox.");
              }
              const acknowledged = await acknowledgeWorkflowMailboxMessage({
                projectRoot: resolvedProjectRoot,
                messageId,
                agentId: ctx.agentId,
              });
              if (!acknowledged) {
                throw new Error(`No workflow mailbox message found for id: ${messageId}`);
              }
              return textResponse(JSON.stringify(acknowledged, null, 2));
            }
            default:
              throw new Error(`Unsupported research_workflow action: ${action}`);
            }
          } catch (error) {
            await traceAction("failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };

        if (!shouldQueueWorkflowAction(action)) {
          return executeAction();
        }

        const previewState = await resolveWorkflowToolState({
          plugin,
          agentCtx: ctx,
          rawParams: params,
          action,
          autoBind: false,
        });
        return enqueueWorkflowTask({
          queueContext: resolveWorkflowToolQueueContext(previewState, ctx),
          label: `research_workflow:${action}`,
          logger: plugin.api.logger,
          task: executeAction,
        });
      },
    }),
    { optional: true }
  );
}
