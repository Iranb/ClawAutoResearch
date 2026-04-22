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
  getExperimentGpuMonitorStateSummary,
  getFigureQcStateSummary,
  getGateStateSummary,
  getGraphGuidedWritingStateSummary,
  getIdleResearchStateSummary,
  getInnovationReflectionStateSummary,
  getOrchestrationStateSummary,
  getPapernexusProgressSummary,
  getPaperIngestionStateSummary,
  getPaperStoryStateSummary,
  getInnovationSynthesisStateSummary,
  getResultsStorylineStateSummary,
  getStorylinePlannerStateSummary,
  auditLiteratureCoverageForWorkflow,
  runBroadPaperSearchForWorkflow,
  materializeIdeationContract,
  materializeExperimentMemoryPacket,
  materializeExperimentReviewState,
  materializeInnovationSynthesisState,
  materializeLiteratureDiscoveryPacket,
  materializePlanState,
  materializePaperStoryState,
  materializeStorylinePlannerState,
  materializeResultsStorylineState,
  planCitationExpansionForWorkflow,
  queuePaperIngestionRequest,
  getPaperQcStateSummary,
  getResearchProgramStateSummary,
  getReviewPressurePacketStateSummary,
  getProjectRootForWorkflow,
  getReviewIssueTrackerStateSummary,
  getReviewSessionStateSummary,
  getStoryGapSearchRequisitionStateSummary,
  getSurveyReviewStateSummary,
  getTheoryStateSummary,
  getWorkflowContactCooldown,
  getTitleAbstractIntroWorkbenchStateSummary,
  getWritePackageStateSummary,
  getWritingContractStateSummary,
  getWritingSessionStateSummary,
  inferTargetRoleFromToolParams,
  listChannelProjectBindingsForWorkflow,
  materializeReviewPressurePacket,
  materializeSurveyReviewState,
  materializeTitleAbstractIntroWorkbenchState,
  materializeTheoryAppendix,
  queueWorkflowMailboxMessage,
  readWorkflowMailboxForAgent,
  recordCitationVerification,
  recordIdleResearchRun,
  recordInnovationReflection,
  recordTheoryState,
  recordWorkflowContactEvent,
  refreshExperimentGpuMonitor,
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
  setStorylinePlannerState,
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
import {
  getCrossDomainInspirationStateSummary,
  materializeCrossDomainBridgeArtifacts,
  materializeCrossDomainInspirationRequisition,
  setCrossDomainInspirationState,
} from "./idea-catalyst/cross-domain-contract";
import { queueLiteratureDiscoveryRequisition } from "./literature-discovery/workflow-bridge";
import { materializePapernexusPacketContracts } from "./papernexus-packets/materializer";
import { materializeCycleMemory } from "./research-memory-cycle";
import { materializeWritingSupportArtifacts } from "./research-writing/materializers";
import { materializeWritingHookPolicies } from "./research-writing/hook-policies";
import { materializeRevisionControlState } from "./research-writing/revision-control";
import { materializeParagraphLogicAudit } from "./research-writing/paragraph-logic-audit";
import {
  materializeWorkflowPanelDiscussionState,
  readWorkflowPanelDiscussionStore,
} from "./workflow-panel-discussion";
import { materializeExecutionProofState } from "./workflow-execution-proof-state";
import { runCitationCalibration } from "./research-writing/citation-calibration";
import { materializeCitationAudit } from "./research-intel/citation-audit";
import { stagePapernexusRemoteSources } from "./papernexus-remote-stage";
import { runIdeaCatalystResearch30 } from "./research30/bridge";
import { reconcileAuthoringCloseout } from "./authoring-closeout-reconcile";
import { captureWorkflowDiagnosticBundle } from "./workflow-diagnostic-bundle";
import { evaluateExperimentSearchDecisionForProject } from "./workflow-experiment-decision";
import { recordExperimentRuntimeSignal } from "./workflow-experiment-runtime-watch";
import { normalizeWorkflowRole } from "./workflow-guard-policies/role-policy";
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
import { handoffWorkflowTaskToAgent } from "./workflow-execution/delivery-adapter";
import { inspectWorkflowLobsterReadiness } from "./lobster-handoff";
import { ensureWorkflowDispatchMailboxMessage } from "./workflow-handoff-runtime";
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
} from "./workflow-execution/background-pool";
import { migrateWorkflowRuntimeState } from "./workflow-execution/runtime-store";
import {
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  readWorkflowRuntimeEvents,
} from "./workflow-execution/runtime-store";
import {
  asObject,
  readNumber,
  readString,
  requireObject,
  textResponse,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";
import { createWorkflowExecutionRuntimeFromApi } from "./workflow-execution-runtime.js";
import { readJsonIfExists, pathExists, writeJsonAtomicEnsured } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import { writeWorkflowTextArtifact } from "./workflow-artifact-text-writer";
import {
  ensureSurveyWorkflowIdentity,
  resolveStageForWorkflowLine,
} from "./workflow-line-routing.js";
import { loadTrackInnovationEvidence } from "./workflow-derived-state/track-evidence";
import {
  buildWorkflowQueueContext,
  enqueueWorkflowTask,
} from "./workflow-coordination";
import {
  claimWorkflowTask,
  claimNextWorkflowTaskForOwner,
  } from "./workflow-team/task-graph";
import {
  materializeWorkflowTeamRound,
  readWorkflowTeamRoundStore,
  recordWorkflowTeamRoundClaim,
  recordWorkflowTeamRoundCompletion,
  releaseWorkflowTeamRoundSession,
} from "./workflow-team/team-round";
import { getGateReviewStorePath, readGateReviewStore } from "./workflow-auto-gate";
import { appendWorkflowTraceEvent } from "./workflow-trace";
import { inspectPapernexusRemoteAccess } from "./papernexus-secret";
import {
  isTrackedPapernexusImportWrapper,
  writePapernexusProgressFromManifest,
} from "./papernexus-progress";
import {
  collectPaperIngestionFailures,
  materializePaperIngestionRetry,
  readProjectManifestForRetry,
} from "./paper-ingestion-failures";
import { normalizePaperIngestionState } from "./workflow-guard-state/paper-ingestion";
import { resolveWorkflowSnapshotContext } from "./workflow-runtime-snapshot";
import {
  getWorkflowTaskGraphPath,
  releaseWorkflowTaskClaim,
  renewWorkflowTaskLease,
  readWorkflowTaskGraphStore,
  summarizeWorkflowTaskGraphStore,
} from "./workflow-team/task-graph";
import { completeWorkflowTaskAndContinue } from "./workflow-team/task-hooks";
import {
  createWorkflowArtifactReceipt,
  readWorkflowArtifactReceiptStore,
} from "./workflow-handoff/artifact-receipts";
import { upsertWorkflowAgentSessionRegistryEntry } from "./workflow-agent-session-registry";
import {
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
} from "./workflow-handoff/handoff-store";
import {
  createStageOwnerHandoffIntent,
  createTaskUnlockedHandoffIntent,
} from "./workflow-handoff/handoff-router";
import {
  deliverWorkflowHandoffIntent,
  type WorkflowHandoffDeliveryRuntime,
} from "./workflow-handoff/handoff-delivery";
import { sweepPendingHandoffIntents } from "./workflow-handoff/handoff-sweep.js";
import {
  claimAndActivateWorkflowHandoffForAgent,
  syncPreparedWorkflowHandoffToManifest,
} from "./workflow-handoff/handoff-activation.js";
import { buildHandoffDashboard } from "./workflow-handoff/dashboard.js";
import { routeWorkflowFailure } from "./workflow-handoff/failure-router";
import {
  closeWorkflowRepairItemsForTask,
  readWorkflowRepairQueueStore,
} from "./workflow-handoff/repair-queue";
import {
  readWorkflowAgentCapabilityStore,
  upsertWorkflowAgentCapability,
} from "./workflow-handoff/agent-capabilities";
import {
  claimWorkflowWriteScope,
  readWorkflowWriteScopeStore,
  releaseStaleWorkflowWriteScopes,
} from "./workflow-handoff/write-scope";
import {
  createWorkflowInboundBudgetContext,
  recordWorkflowInboundTurnCompleted,
  recordWorkflowInboundTurnStarted,
} from "./workflow-handoff/inbound-budget";
import { WORKFLOW_INBOUND_AUTO_ITERATOR_INLINE_BUDGET_MS } from "./workflow-handoff/handoff-defaults";
import { runWorkflowHookPointGate } from "./workflow-hooks/gateways.js";
import { evaluateWorkflowHandoffHooks } from "./workflow-hooks/handoff-gates.js";
import {
  getFileAuditStateSummary,
  readWorkflowHooksPolicyForProject,
  setFileAuditPolicyForProject,
} from "./workflow-hooks/state.js";
import { materializeFileAuditPacket } from "./workflow-hooks/file-audit-runner.js";
import { buildWorkflowHookPointContext } from "./workflow-hooks/point-context.js";

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

const TOOL_ACTIONS_AUTO_ACTIVATE_PENDING_HANDOFFS = new Set([
  "materialize_plan_state",
  "set_research_program",
  "set_orchestration_state",
]);

function resolveSnapshotWorkflowLine(
  snapshot: WorkflowSnapshot
): "experiment" | "survey" {
  const record = snapshot as Record<string, unknown>;
  const workflowLine =
    readString(record.workflowLine) ?? readString(record.workflow_line);
  const paperMode =
    readString(record.paperMode) ??
    readString(record.paper_mode) ??
    readString((record.writingContract as Record<string, unknown> | undefined)?.paper_mode) ??
    readString(record.writingPaperMode) ??
    readString(record.writing_paper_mode) ??
    readString(record.surveyReviewMode) ??
    readString(record.survey_review_mode);
  const currentStage =
    readString(record.currentStage) ?? readString(record.current_stage);
  return workflowLine === "survey" ||
    paperMode === "survey" ||
    currentStage === "survey_review"
    ? "survey"
    : "experiment";
}

function resolveWorkflowLineFromManifestRecord(
  manifest: Record<string, unknown> | null | undefined
): "experiment" | "survey" {
  const workflowLine =
    readString(manifest?.workflow_line) ?? readString(manifest?.workflowLine);
  const paperType =
    readString(manifest?.paper_type) ?? readString(manifest?.paperType);
  const writingContract =
    asObject(manifest?.writing_contract) ?? asObject(manifest?.writingContract);
  const paperMode =
    readString(writingContract?.paper_mode) ?? readString(writingContract?.paperMode);
  const currentStage =
    readString(manifest?.current_stage) ?? readString(manifest?.currentStage);
  if (
    workflowLine === "survey" ||
    paperType === "survey" ||
    paperMode === "survey" ||
    currentStage === "survey_review" ||
    asObject(manifest?.survey_review) != null
  ) {
    return "survey";
  }
  return "experiment";
}

async function maybeAutoActivatePendingHandoffForToolAction(params: {
  action: string;
  plugin: PluginRegistrationContext;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  snapshot: WorkflowSnapshot;
  ctx: ToolContext;
  projectRoot: string | null;
}) {
  if (!TOOL_ACTIONS_AUTO_ACTIVATE_PENDING_HANDOFFS.has(params.action)) {
    return { claimed: false, activated: false };
  }
  if (!params.projectRoot || !params.snapshot.role) {
    return { claimed: false, activated: false };
  }
  return await claimAndActivateWorkflowHandoffForAgent({
    projectRoot: params.projectRoot,
    role: params.snapshot.role,
    sessionKey: params.ctx.sessionKey,
    claimLeaseMs: 15 * 60 * 1000,
    beforeActivateHook: async ({ intent, stageAfter }) => {
      const hookSummary = await runWorkflowHookPointGate({
        runtimeSubagent: params.plugin.api.runtime?.subagent,
        projectRoot: params.projectRoot!,
        projectId: params.snapshot.projectId,
        stage: stageAfter,
        hookPoint: "before_handoff_activation",
        ownerRole: params.snapshot.role,
        actorRole: params.snapshot.role,
        requesterSessionKey: params.ctx.sessionKey,
        requesterChannel: params.ctx.messageChannel,
        handoffIntentId: intent.intentId,
        targetStage: stageAfter,
        transition: "tool_handoff_activation",
      });
      return {
        allow: hookSummary.aggregateVerdict === "pass",
        blockingReason: hookSummary.blockingReason,
      };
    },
    afterActivateHook: async ({ intent, stageAfter }) => {
      await runWorkflowHookPointGate({
        runtimeSubagent: params.plugin.api.runtime?.subagent,
        projectRoot: params.projectRoot!,
        projectId: params.snapshot.projectId,
        stage: stageAfter,
        hookPoint: "after_handoff_activation",
        ownerRole: params.snapshot.role,
        actorRole: params.snapshot.role,
        requesterSessionKey: params.ctx.sessionKey,
        requesterChannel: params.ctx.messageChannel,
        handoffIntentId: intent.intentId,
        targetStage: stageAfter,
        transition: "tool_handoff_activation",
      });
    },
  });
}

const SERIALIZED_WORKFLOW_ACTIONS = new Set([
  "auto_iterator_tick",
  "start_background_run",
  "run_papernexus_wrapper",
  "queue_paper_ingestion",
  "stage_papernexus_remote_sources",
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
  "set_storyline_planner_state",
  "materialize_storyline_planner_state",
  "materialize_results_storyline_state",
  "materialize_title_abstract_intro_workbench_state",
  "materialize_innovation_synthesis_state",
  "materialize_writing_support_artifacts",
  "materialize_writing_hook_policies",
  "get_panel_discussion_state",
  "materialize_panel_discussion_state",
  "get_execution_proof_state",
  "materialize_execution_proof_state",
  "get_paragraph_logic_audit_state",
  "materialize_paragraph_logic_audit_state",
  "get_revision_control_state",
  "materialize_revision_control_state",
  "reconcile_authoring_closeout",
  "materialize_cycle_memory",
  "materialize_survey_review_state",
  "materialize_idea_catalyst_state",
  "run_idea_catalyst_research30",
  "capture_diagnostic_bundle",
  "get_file_audit_state",
  "set_file_audit_policy",
  "materialize_file_audit_packet",
  "set_survey_review",
  "refresh_gpu_monitor",
  "set_ideation_contract",
  "set_experiment_review_state",
  "set_idea_catalyst_state",
  "set_cross_domain_inspiration",
  "materialize_cross_domain_requisition",
  "queue_cross_domain_requisition",
  "materialize_cross_domain_bridge_artifacts",
  "set_paper_story_state",
  "materialize_review_pressure_packet",
  "set_review_pressure_packet",
  "prune_background_sessions",
  "retire_background_sessions",
  "bind_channel_project",
  "unbind_channel_project",
  "dispatch_task",
  "get_task_graph",
  "get_team_round",
  "claim_task",
  "renew_task_lease",
  "release_task",
  "complete_task",
  "prepare_stage_handoff",
  "get_handoff_intents",
  "ack_handoff_intent",
  "claim_handoff_intent",
  "fail_handoff_intent",
  "get_artifact_receipts",
  "get_repair_queue",
  "get_agent_capabilities",
  "claim_write_scope",
  "release_stale_write_scopes",
  "get_paper_ingestion_failures",
  "classify_paper_ingestion_failures",
  "materialize_paper_ingestion_retry",
  "queue_paper_ingestion_retry",
  "get_paper_ingestion_retry_status",
  "cancel_paper_ingestion_retry",
  "read_mailbox",
  "send_mailbox",
  "ack_mailbox",
  "write_text_artifact",
]);

const WORKFLOW_ACTION_FUNCTIONS: Record<string, string> = {
  get_snapshot: "buildWorkflowSnapshot",
  get_runtime_health: "buildWorkflowSnapshot",
  get_handoff_status: "buildHandoffDashboard",
  diagnose_track_evidence: "loadTrackInnovationEvidence",
  get_papernexus_remote_access: "inspectPapernexusRemoteAccess",
  get_papernexus_progress: "getPapernexusProgressSummary",
  check_graph_presence: "checkGraphPresenceForWorkflow",
  refresh_graph_presence: "checkGraphPresenceForWorkflow",
  accept_remote_graph_ready: "checkGraphPresenceForWorkflow",
  audit_literature_coverage: "auditLiteratureCoverageForWorkflow",
  plan_citation_expansion: "planCitationExpansionForWorkflow",
  run_broad_paper_search: "runBroadPaperSearchForWorkflow",
  auto_iterator_tick: "runWorkflowAutoIterator",
  start_background_run: "startBackgroundWorkflowRun",
  run_papernexus_wrapper: "buildPapernexusWrapperBackgroundRunRequest",
  queue_paper_ingestion: "queuePaperIngestionRequest",
  stage_papernexus_remote_sources: "stagePapernexusRemoteSources",
  validate_paper_ingestion: "validatePaperIngestionRequest",
  queue_idea_catalyst_requisition: "queueIdeaCatalystRequisition",
  queue_literature_discovery_requisition: "queueLiteratureDiscoveryRequisition",
  migrate_runtime_state: "migrateWorkflowRuntimeState",
  get_idle_research: "getIdleResearchStateSummary",
  set_idle_research: "setIdleResearchState",
  record_idle_research_run: "recordIdleResearchRun",
  get_experiment_memory: "getExperimentMemorySummary",
  get_gpu_monitor: "getExperimentGpuMonitorStateSummary",
  get_innovation_reflection: "getInnovationReflectionStateSummary",
  get_brainstorm_cycle: "getBrainstormCycleStateSummary",
  get_survey_review: "getSurveyReviewStateSummary",
  set_brainstorm_cycle: "setBrainstormCycleState",
  refresh_gpu_monitor: "refreshExperimentGpuMonitor",
  record_experiment_runtime_signal: "recordExperimentRuntimeSignal",
  run_brainstorm_cycle: "runBrainstormCycle",
  materialize_ideation_contract: "materializeIdeationContract",
  materialize_literature_discovery_packet: "materializeLiteratureDiscoveryPacket",
  materialize_plan_state: "materializePlanState",
  materialize_papernexus_packet_contracts: "materializePapernexusPacketContracts",
  materialize_idea_catalyst_state: "materializeIdeaCatalystState",
  run_idea_catalyst_research30: "runIdeaCatalystResearch30",
  capture_diagnostic_bundle: "captureWorkflowDiagnosticBundle",
  get_file_audit_state: "getFileAuditStateSummary",
  set_file_audit_policy: "setFileAuditPolicyForProject",
  materialize_file_audit_packet: "materializeFileAuditPacket",
  materialize_paper_story_state: "materializePaperStoryState",
  set_storyline_planner_state: "setStorylinePlannerState",
  materialize_storyline_planner_state: "materializeStorylinePlannerState",
  materialize_results_storyline_state: "materializeResultsStorylineState",
  materialize_title_abstract_intro_workbench_state:
    "materializeTitleAbstractIntroWorkbenchState",
  materialize_innovation_synthesis_state: "materializeInnovationSynthesisState",
  materialize_writing_support_artifacts: "materializeWritingSupportArtifacts",
  materialize_writing_hook_policies: "materializeWritingHookPolicies",
  get_panel_discussion_state: "readWorkflowPanelDiscussionStore",
  materialize_panel_discussion_state: "materializeWorkflowPanelDiscussionState",
  get_execution_proof_state: "materializeExecutionProofState",
  materialize_execution_proof_state: "materializeExecutionProofState",
  get_paragraph_logic_audit_state: "materializeParagraphLogicAudit",
  materialize_paragraph_logic_audit_state: "materializeParagraphLogicAudit",
  get_revision_control_state: "materializeRevisionControlState",
  materialize_revision_control_state: "materializeRevisionControlState",
  reconcile_authoring_closeout: "reconcileAuthoringCloseout",
  materialize_cycle_memory: "materializeCycleMemory",
  materialize_survey_review_state: "materializeSurveyReviewState",
  get_ideation_contract: "getIdeationContractStateSummary",
  get_idea_catalyst_state: "getIdeaCatalystStateSummary",
  set_ideation_contract: "setIdeationContractState",
  set_idea_catalyst_state: "setIdeaCatalystState",
  get_cross_domain_inspiration: "getCrossDomainInspirationStateSummary",
  set_cross_domain_inspiration: "setCrossDomainInspirationState",
  materialize_cross_domain_requisition: "materializeCrossDomainInspirationRequisition",
  queue_cross_domain_requisition: "queueLiteratureDiscoveryRequisition",
  materialize_cross_domain_bridge_artifacts: "materializeCrossDomainBridgeArtifacts",
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
  get_storyline_planner_state: "getStorylinePlannerStateSummary",
  get_results_storyline_state: "getResultsStorylineStateSummary",
  get_innovation_synthesis_state: "getInnovationSynthesisStateSummary",
  get_title_abstract_intro_workbench_state:
    "getTitleAbstractIntroWorkbenchStateSummary",
  get_story_gap_search_requisition: "getStoryGapSearchRequisitionStateSummary",
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
  run_citation_calibration: "runCitationCalibration",
  get_paper_qc: "getPaperQcStateSummary",
  set_paper_qc: "setPaperQcState",
  get_figure_qc: "getFigureQcStateSummary",
  set_figure_qc: "setFigureQcState",
  get_citation_collection: "getCitationCollectionStateSummary",
  set_citation_collection: "setCitationCollectionState",
  get_review_issue_tracker: "getReviewIssueTrackerStateSummary",
  set_review_issue_tracker: "setReviewIssueTrackerState",
  get_experiment_search: "getExperimentSearchStateSummary",
  evaluate_experiment_search_decision: "evaluateExperimentSearchDecisionForProject",
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
  get_task_graph: "readWorkflowTaskGraphStore",
  get_team_round: "readWorkflowTeamRoundStore",
  claim_task: "claimWorkflowTask",
  renew_task_lease: "renewWorkflowTaskLease",
  release_task: "releaseWorkflowTaskClaim",
  complete_task: "completeWorkflowTaskAndContinue",
  prepare_stage_handoff: "createStageOwnerHandoffIntent",
  get_handoff_intents: "readWorkflowHandoffIntentStore",
  ack_handoff_intent: "transitionWorkflowHandoffIntent",
  claim_handoff_intent: "transitionWorkflowHandoffIntent",
  fail_handoff_intent: "routeWorkflowFailure",
  get_artifact_receipts: "readWorkflowArtifactReceiptStore",
  get_repair_queue: "readWorkflowRepairQueueStore",
  get_agent_capabilities: "readWorkflowAgentCapabilityStore",
  claim_write_scope: "claimWorkflowWriteScope",
  release_stale_write_scopes: "releaseStaleWorkflowWriteScopes",
  get_paper_ingestion_failures: "collectPaperIngestionFailures",
  classify_paper_ingestion_failures: "collectPaperIngestionFailures",
  materialize_paper_ingestion_retry: "materializePaperIngestionRetry",
  queue_paper_ingestion_retry: "queuePaperIngestionRequest",
  get_paper_ingestion_retry_status: "getPaperIngestionStateSummary",
  cancel_paper_ingestion_retry: "setPaperIngestionState",
  recover_survey_route: "ensureSurveyWorkflowIdentity",
  skip_experiment_stages_for_survey: "ensureSurveyWorkflowIdentity",
  read_mailbox: "readWorkflowMailboxForAgent",
  send_mailbox: "queueWorkflowMailboxMessage",
  ack_mailbox: "acknowledgeWorkflowMailboxMessage",
  write_text_artifact: "writeWorkflowTextArtifact",
};

async function resolveWorkflowToolState(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  rawParams: Record<string, unknown>;
  action?: string;
  autoBind?: boolean;
}): Promise<WorkflowToolState> {
  const channelBinding = asObject(params.rawParams.channelBinding);
  const citationCalibration = asObject(params.rawParams.citationCalibration);
  const explicitProjectRootOverride =
    readString(params.rawParams.projectRoot) ??
    readString(params.rawParams.project_root) ??
    (params.action === "run_citation_calibration"
      ? readString(citationCalibration?.projectRoot) ??
        readString(citationCalibration?.project_root) ??
        readString(citationCalibration?.projectPath) ??
        readString(citationCalibration?.project_path)
      : null);
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
    explicitProjectRootOverride ??
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

function resolveWorkflowProjectRootWithOverride(params: {
  state: WorkflowToolState;
  override?: string | null;
}): string {
  const explicit = readString(params.override);
  if (explicit) {
    return path.resolve(explicit);
  }
  return requireWorkflowProjectRoot(params.state);
}

function createWorkflowToolRuntime(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  projectRoot?: string | null;
}): ReturnType<typeof createWorkflowExecutionRuntimeFromApi> {
  return createWorkflowExecutionRuntimeFromApi({
    api: params.plugin.api,
    defaultWorkspaceDir:
      readString(params.projectRoot) ??
      readString(params.agentCtx.workspaceDir) ??
      undefined,
    defaultAgentId: readString(params.agentCtx.agentId) ?? undefined,
    defaultMessageChannel: readString(params.agentCtx.messageChannel) ?? undefined,
  });
}

async function maybeBroadcastSimpleHandoffStatus(params: {
  runtimeSubagent?: {
    run: (params: {
      sessionKey: string;
      message: string;
      lane?: string;
      deliver?: boolean;
      idempotencyKey?: string;
      extraSystemPrompt?: string;
    }) => Promise<{ runId: string }>;
  };
  bindingPolicy?: Parameters<typeof maybeBroadcastWorkflowStatusUpdate>[0]["bindingPolicy"];
  sessionKey?: string | null;
  projectId: string | null;
  projectRoot: string | null;
  status:
    | "handoff_ready"
    | "handed_off"
    | "waiting"
    | "continued"
    | "blocked";
  stage?: string | null;
  summary: string;
  intentId?: string | null;
  phase: string;
}) {
  return maybeBroadcastWorkflowStatusUpdate({
    runtimeSubagent: params.runtimeSubagent,
    bindingPolicy: params.bindingPolicy,
    sessionKey: params.sessionKey,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    status: params.status,
    stage: params.stage,
    summary: params.summary,
    idempotencyKeySuffix: [
      "handoff",
      params.phase,
      params.intentId ?? "unknown-intent",
    ].join(":"),
  });
}

async function maybeAutoRefreshCitationVerification(params: {
  projectRoot: string;
  triggerAction: string;
  bibliographyPathOverride?: string | null;
}): Promise<{
  triggered: boolean;
  skippedReason: string | null;
  calibration?: Awaited<ReturnType<typeof runCitationCalibration>>;
  audit?: Awaited<ReturnType<typeof materializeCitationAudit>>;
  verification?: Awaited<ReturnType<typeof recordCitationVerification>>;
  error?: string | null;
}> {
  try {
    const citationSummary = await getCitationIntegrityStateSummary({
      projectRoot: params.projectRoot,
    });
    const bibliographyPath =
      readString(params.bibliographyPathOverride) ??
      citationSummary.state.bibliographyPath ??
      "academic_writer/paper/refs.bib";
    const bibliographyResolvedPath =
      citationSummary.bibliographyResolvedPath ??
      resolveProjectArtifactPath(params.projectRoot, bibliographyPath) ??
      path.join(params.projectRoot, bibliographyPath);
    if (!bibliographyResolvedPath || !(await pathExists(bibliographyResolvedPath))) {
      return {
        triggered: false,
        skippedReason: `No bibliography found for auto citation verification after ${params.triggerAction}.`,
      };
    }
    const calibration = await runCitationCalibration({
      projectRoot: params.projectRoot,
      bibliographyPath,
    });
    const audit = await materializeCitationAudit({
      projectRoot: params.projectRoot,
      bibliographyPath: calibration.outputBibPath,
      outputPath: "researcher/CITATION_AUDIT_REPORT.json",
    });
    const verificationStatus =
      calibration.hallucinatedCount > 0 ||
      calibration.suspiciousCount > 0 ||
      audit.hallucinatedCitationCount > 0 ||
      audit.suspiciousCitationCount > 0 ||
      audit.unresolvedPlaceholderCount > 0 ||
      audit.citationCountStatus !== "ready" ||
      audit.topicRelevanceStatus === "needs_revision"
        ? "needs_revision"
        : "verified";
    const verification = await recordCitationVerification({
      projectRoot: params.projectRoot,
      citationVerification: {
        source_of_truth: [
          "paper_refs_bib",
          "citation_calibration",
          "paper_identity_registry",
        ],
        bibliography_path: calibration.outputBibPath,
        verification_report_path:
          calibration.verificationReportPath ?? "reviewer/CITATION_VERIFICATION.md",
        verification_status: verificationStatus,
        verified_citation_count: Math.max(
          calibration.verifiedCount,
          audit.verifiedCitationCount
        ),
        suspicious_citation_count: Math.max(
          calibration.suspiciousCount,
          audit.suspiciousCitationCount
        ),
        hallucinated_citation_count: Math.max(
          calibration.hallucinatedCount,
          audit.hallucinatedCitationCount
        ),
        unresolved_placeholder_count: audit.unresolvedPlaceholderCount,
        pending_reason:
          verificationStatus === "verified"
            ? `Automatic citation verification refreshed cleanly after ${params.triggerAction}.`
            : `Automatic citation verification found suspicious bibliography entries after ${params.triggerAction}.`,
      },
    });
    return {
      triggered: true,
      skippedReason: null,
      calibration,
      audit,
      verification,
    };
  } catch (error) {
    return {
      triggered: false,
      skippedReason: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
    ownerActivated: true,
    pendingHandoff: false,
    pendingHandoffPhase: null,
    pendingHandoffExecutionId: null,
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

function buildStageHandoffAcceptanceChecks(params: {
  workflowLine: "experiment" | "survey";
  stageAfter: string | null | undefined;
}): string[] {
  const stageAfter = readString(params.stageAfter);
  if (params.workflowLine === "survey") {
    if (stageAfter === "write") {
      return [
        "survey review packet exists and can support writing",
        "researcher/SURVEY_BRIEF.md exists",
        "researcher/SOTA_MATRIX.md or researcher/LITERATURE_REVIEW.md exists",
      ];
    }
    if (stageAfter === "review") {
      return [
        "PROJECT_MANIFEST.json.writing_session reflects active draft progress",
        "academic_writer/paper/main.tex exists or writing section packets cover the required sections",
        "writing process is drafting|section_review|manuscript_complete|compile_ready|ready_for_submit",
      ];
    }
    if (stageAfter === "submit") {
      return [
        "PROJECT_MANIFEST.json.writing_session reflects a reviewer-ready survey draft",
        "academic_writer/paper/main.tex exists",
        "at least one PDF exists under academic_writer/paper/",
      ];
    }
    return [];
  }
  switch (stageAfter) {
    case "plan":
      return [
        "researcher/IDEA_REPORT.md exists",
        "TRACK_REGISTRY.json exists",
      ];
    case "code":
      return [
        "orchestrator/PLAN.md exists",
        "orchestrator/TODOS.md exists",
        "orchestrator/PLAN_AUDIT.md exists",
        "PROJECT_MANIFEST.json.research_program.plan_selection.selected_track_id != null",
      ];
    case "experiment":
      return [
        "coder/EXPERIMENT_INDEX.md exists",
        "coder/experiments/<track-id>/ bundle exists",
      ];
    case "analyze":
      return [
        "researcher/EXPERIMENT_LEDGER.json or EXPERIMENT_SEARCH.json is updated",
        "researcher/EXPERIMENT_GPU_MONITOR.json is reconciled",
      ];
    case "write":
      return [
        "analyzer/analysis packet exists",
        "write package inputs are assembled",
      ];
    case "review":
      return [
        "academic_writer/paper/main.tex exists",
        "academic_writer/story/ or section packets are present",
        "writing process is drafting|section_review|manuscript_complete|compile_ready|ready_for_submit",
      ];
    case "submit":
      return [
        "PROJECT_MANIFEST.json.writing_session reflects a reviewer-ready draft",
        "academic_writer/paper/main.tex exists",
        "at least one PDF exists under academic_writer/paper/",
      ];
    default:
      return [];
  }
}

function buildWorkflowHandoffDeliveryRuntime(params: {
  plugin: PluginRegistrationContext;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  agentCtx: ToolContext;
  requesterRole: DispatchableWorkflowRole;
  targetRole: DispatchableWorkflowRole;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  summary: string;
  command: string | null;
  preferredSessionKeys?: string[] | null;
  toSessionKey?: string | null;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
  autoModeActive: boolean;
}): {
  runtime: WorkflowHandoffDeliveryRuntime;
  getDispatch: () => Awaited<ReturnType<typeof handoffWorkflowTaskToAgent>> | null;
} {
  let capturedDispatch: Awaited<ReturnType<typeof handoffWorkflowTaskToAgent>> | null =
    null;
  const requesterSessionKey =
    readString(params.agentCtx.sessionKey) ?? `agent:${params.requesterRole}:main`;
  const preferredSessionKeys =
    params.preferredSessionKeys && params.preferredSessionKeys.length > 0
      ? params.preferredSessionKeys
      : deriveWorkflowDispatchSessionCandidates({
          requesterSessionKey,
          targetRole: params.targetRole,
        });
  return {
    runtime: {
      nativeDispatch: async () => {
        capturedDispatch = await handoffWorkflowTaskToAgent({
          runtimeSubagent: params.plugin.api.runtime?.subagent,
          workflowPolicy: params.workflowPolicy,
          requesterSessionKey: params.agentCtx.sessionKey,
          requesterChannel: params.agentCtx.messageChannel,
          fromRole: params.requesterRole,
          toRole: params.targetRole,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          stage: params.stage,
          summary: params.summary,
          command: params.command,
          mailboxMessageId: null,
          requireMailboxAcknowledgement: true,
          waitTimeoutMs: params.waitTimeoutMs,
          retryOnTimeout: params.retryOnTimeout,
          enableSpawnFallback: params.enableSpawnFallback,
          autoModeActive: params.autoModeActive,
          logger: params.plugin.api.logger,
        });
        return {
          ok: capturedDispatch.dispatched,
          runId: capturedDispatch.runId,
          sessionKey: capturedDispatch.sessionKey,
          error: capturedDispatch.error,
        };
      },
      channelBroadcast: async (handoffIntent: { intentId: string }) => {
        const result = await maybeBroadcastWorkflowStatusUpdate({
          runtimeSubagent: params.plugin.api.runtime?.subagent,
          bindingPolicy: params.workflowPolicy,
          sessionKey: params.agentCtx.sessionKey,
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          status: "handoff_ready",
          stage: params.stage,
          summary: `Handoff ${handoffIntent.intentId} is ready for ${params.targetRole}: ${params.summary}`,
          idempotencyKeySuffix: `handoff-channel:${handoffIntent.intentId}`,
        });
        return {
          ok:
            result.broadcasted ||
            result.reasonSkipped === "duplicate_pending" ||
            result.reasonSkipped === "duplicate_delivered",
          runId: result.runId,
          messageId: result.idempotencyKey,
          error: result.reasonSkipped,
        };
      },
      runtimeQueue: async (handoffIntent: { intentId: string }) => {
        const queued = await enqueueQueuedBackgroundWorkflowRun({
          source: "workflow_auto_stage",
          ownerAgent: params.targetRole,
          requesterSessionKey,
          messageChannel: readString(params.agentCtx.messageChannel),
          preferredSessionKey: preferredSessionKeys[0] ?? params.toSessionKey ?? null,
          family: "research",
          kind: "workflow_stage_dispatch",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
          queueKey: `handoff:${handoffIntent.intentId}`,
          summary: `Queued handoff ${handoffIntent.intentId} for ${params.targetRole} after direct delivery fallback.`,
          dispatchPayload: {
            requesterChannel: readString(params.agentCtx.messageChannel) ?? null,
            requesterAccountId: null,
            preferredSessionKeys,
            fromRole: params.requesterRole,
            toRole: params.targetRole,
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            stage: params.stage,
            summary: params.summary,
            command: params.command,
            mailboxMessageId: null,
            requireMailboxAcknowledgement: true,
            extraBody:
              "Workflow handoff delivery fallback. Continue only the assigned stage and keep durable state current.",
            waitTimeoutMs: params.waitTimeoutMs ?? 5000,
            retryOnTimeout: params.retryOnTimeout ?? false,
            enableSpawnFallback:
              params.enableSpawnFallback === false ? false : true,
            useWorkflowHandoff: true,
            autoModeActive: params.autoModeActive,
          },
        });
        return { ok: true, queueKey: queued.entry.queueKey };
      },
      mailboxCompat: async (handoffIntent: { intentId: string }) => {
        const messageId = await ensureWorkflowDispatchMailboxMessage({
          projectRoot: params.projectRoot,
          fromAgent: params.requesterRole,
          toAgent: params.targetRole,
          projectId: params.projectId,
          stage: params.stage,
          summary: `Compatibility handoff ${handoffIntent.intentId}: ${params.summary}`,
          command: params.command,
          queueKey: handoffIntent.intentId,
          existingMessageId: null,
        });
        return {
          ok: Boolean(messageId),
          messageId,
          error: messageId ? null : "mailbox_compat_unavailable",
        };
      },
    },
    getDispatch: () => capturedDispatch,
  };
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
  forceQueueOnly?: boolean;
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

  if (params.snapshot.projectRoot) {
    const sweepRuntime = buildWorkflowHandoffDeliveryRuntime({
      plugin: params.plugin,
      workflowPolicy: params.workflowPolicy,
      agentCtx: params.agentCtx,
      requesterRole,
      targetRole: ownerAfter,
      projectRoot: params.snapshot.projectRoot,
      projectId: params.snapshot.projectId,
      stage: params.result.stageAfter ?? params.snapshot.currentStage,
      summary: params.result.nextAction ?? "Retry the pending workflow handoff.",
      command: params.result.nextAction,
      autoModeActive,
      waitTimeoutMs: params.waitTimeoutMs,
      retryOnTimeout: params.retryOnTimeout,
      enableSpawnFallback: params.enableSpawnFallback,
    });
    await sweepPendingHandoffIntents({
      projectRoot: params.snapshot.projectRoot,
      runtime: sweepRuntime.runtime,
      lobsterMode: params.workflowPolicy.lobsterHandoff?.enabled
        ? "enabled"
        : "disabled",
      bindingPolicy: params.workflowPolicy,
    });
  }

  const primaryAction = selectDispatchableAutoStageAction({
    autoIteratorResult: params.result,
    owner: ownerAfter,
  });
  if (!primaryAction) {
    return null;
  }
  if ((primaryAction.cooldownRemainingSeconds ?? 0) > 0 && !params.result.pendingHandoff) {
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
  const handoffIntent = await createStageOwnerHandoffIntent({
    projectRoot: params.snapshot.projectRoot,
    projectId: params.snapshot.projectId,
    workflowLine: resolveSnapshotWorkflowLine(params.snapshot),
    stageBefore: params.result.stageBefore,
    stageAfter: params.result.stageAfter,
    ownerBefore: params.result.ownerBefore,
    ownerAfter,
    fromSessionKey: params.agentCtx.sessionKey,
    sessionBindingKey: params.snapshot.channelProjectBindingKey,
    preferredSessionKeys: deriveWorkflowDispatchSessionCandidates({
      requesterSessionKey: readString(params.agentCtx.sessionKey) ?? `agent:${requesterRole}:main`,
      targetRole: ownerAfter,
    }),
    executionId: params.result.pendingHandoffExecutionId,
    summary: primaryAction.summary,
    acceptanceChecks: buildStageHandoffAcceptanceChecks({
      workflowLine: resolveSnapshotWorkflowLine(params.snapshot),
      stageAfter: params.result.stageAfter,
    }),
    nextAction: primaryAction.command ?? params.result.nextAction,
    resumeAction: primaryAction.command ?? params.result.resumeAction,
    blockingReason: params.result.blockingReason,
    missingStageSignals: params.result.missingStageSignals,
    deliveryPlan: autoModeActive
      ? undefined
      : {
          channels: ["native_runtime", "channel_broadcast", "mailbox_compat"],
          maxAttemptsTotal: 3,
          maxAttemptsByChannel: {
            native_runtime: 1,
            channel_broadcast: 1,
            mailbox_compat: 1,
          },
        },
    manifestRevision: params.result.pendingHandoffExecutionId ??
      readString((params.snapshot as Record<string, unknown>).manifestUpdatedAt) ??
      readString((params.snapshot as Record<string, unknown>).manifest_updated_at),
  });
  await syncPreparedWorkflowHandoffToManifest({
    projectRoot: params.snapshot.projectRoot,
    intent: handoffIntent.intent,
  });
  let dispatchedViaDelivery: Awaited<ReturnType<typeof handoffWorkflowTaskToAgent>> | null =
    null;
  const deliveryRuntime = buildWorkflowHandoffDeliveryRuntime({
    plugin: params.plugin,
    workflowPolicy: params.workflowPolicy,
    agentCtx: params.agentCtx,
    requesterRole,
    targetRole: ownerAfter,
    projectRoot: handoffIntent.intent.projectRoot,
    projectId: handoffIntent.intent.projectId,
    stage: handoffIntent.intent.stage,
    summary:
      handoffIntent.intent.summary ??
      primaryAction.summary,
    command: handoffIntent.intent.command,
    toSessionKey: handoffIntent.intent.toSessionKey,
    preferredSessionKeys: handoffIntent.intent.preferredSessionKeys,
    autoModeActive,
    waitTimeoutMs: params.waitTimeoutMs,
    retryOnTimeout: params.retryOnTimeout,
    enableSpawnFallback: params.enableSpawnFallback,
  });
  const deliveryResult = params.forceQueueOnly
    ? null
    : await deliverWorkflowHandoffIntent({
        intent: handoffIntent.intent,
        bindingPolicy: params.workflowPolicy,
        lobsterMode: params.workflowPolicy.lobsterHandoff?.enabled
          ? "enabled"
          : "disabled",
        runtime: deliveryRuntime.runtime,
      });
  dispatchedViaDelivery = deliveryRuntime.getDispatch();
  if (deliveryResult?.intent) {
    await syncPreparedWorkflowHandoffToManifest({
      projectRoot: params.snapshot.projectRoot,
      intent: deliveryResult.intent,
    });
  }
  const queuedAttempt =
    deliveryResult?.intent.deliveryAttempts.find(
      (attempt) => attempt.channel === "runtime_queue" && attempt.status === "delivered"
    ) ?? null;
  const dispatch = params.forceQueueOnly
    ? {
        dispatched: false,
        sessionKey: null,
        runId: null,
        waitStatus: null,
        channel: null,
        strategy: null,
        attempts: [],
        fallbackSpawned: false,
        acknowledgedByMailbox: false,
        error: "inbound_budget_exceeded",
        backend: "native" as const,
        lobsterStatus: null,
        fallbackReason: "inbound_budget_exceeded",
      }
    : queuedAttempt
      ? {
          dispatched: false,
          sessionKey: null,
          runId: null,
          waitStatus: null,
          channel: null,
          strategy: null,
          attempts: [],
          fallbackSpawned: false,
          acknowledgedByMailbox: false,
          error: dispatchedViaDelivery?.error ?? "queued_via_runtime_queue",
          backend: "native" as const,
          lobsterStatus: null,
          fallbackReason: "runtime_queue",
          queuedFallback: true,
          queueKey: queuedAttempt.queueKey,
          queuePosition: null,
        }
      : dispatchedViaDelivery ??
      {
        dispatched: false,
        sessionKey: null,
        runId: null,
        waitStatus: null,
        channel: null,
        strategy: null,
        attempts: [],
        fallbackSpawned: false,
        acknowledgedByMailbox: false,
        error: "handoff delivery did not start",
        backend: "native" as const,
        lobsterStatus: null,
        fallbackReason: "handoff_delivery_failed",
      };
  if (dispatch.dispatched) {
    await recordWorkflowContactEvent({
      projectRoot: params.snapshot.projectRoot,
      fromAgent: requesterRole,
      toAgent: ownerAfter,
      channel: dispatch.channel ?? "sessions_send",
    });
    if (dispatch.sessionKey && params.workflowPolicy.teamRuntime?.enabled !== false) {
      try {
        const claimedTask = await claimNextWorkflowTaskForOwner({
          projectRoot: params.snapshot.projectRoot,
          owner: ownerAfter,
          sessionKey: dispatch.sessionKey,
        });
        if (claimedTask.claimed && claimedTask.task) {
          let teamRound = await recordWorkflowTeamRoundClaim({
            projectRoot: params.snapshot.projectRoot,
            sessionKey: dispatch.sessionKey,
            taskId: claimedTask.task.taskId,
          });
          if (!teamRound) {
            const taskGraphStore = await readWorkflowTaskGraphStore(
              params.snapshot.projectRoot
            );
            const taskGraphSummary = summarizeWorkflowTaskGraphStore(taskGraphStore);
            if (taskGraphStore) {
              await materializeWorkflowTeamRound({
                projectRoot: params.snapshot.projectRoot,
                projectId: params.snapshot.projectId ?? null,
                stage: primaryAction.stage ?? params.result.stageAfter ?? params.snapshot.currentStage,
                leadRole: ownerAfter,
                topTierVerdict: taskGraphStore.topTierVerdict,
                evidenceCloseoutStatus: taskGraphStore.evidenceCloseoutStatus,
                taskGraphPath: getWorkflowTaskGraphPath(params.snapshot.projectRoot),
                taskCount: taskGraphSummary.taskCount,
                claimableCount: taskGraphSummary.claimableCount,
                blockedCount: taskGraphSummary.blockedCount,
                claimedCount: taskGraphSummary.claimedCount,
                verifyingCount: taskGraphSummary.verifyingCount,
                needsRepairCount: taskGraphSummary.needsRepairCount,
                satisfiedCount: taskGraphSummary.satisfiedCount,
                optionalCount: taskGraphSummary.optionalCount,
              });
              teamRound = await recordWorkflowTeamRoundClaim({
                projectRoot: params.snapshot.projectRoot,
                sessionKey: dispatch.sessionKey,
                taskId: claimedTask.task.taskId,
              });
            }
          }
        }
      } catch (error) {
        params.plugin.api.logger?.warn?.("Failed to claim workflow task after tool-side auto dispatch.", {
          projectRoot: params.snapshot.projectRoot,
          owner: ownerAfter,
          stage:
            primaryAction.stage ?? params.result.stageAfter ?? params.snapshot.currentStage,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (
    !dispatch.dispatched &&
    autoModeActive &&
    !("queuedFallback" in dispatch && dispatch.queuedFallback) &&
    !(deliveryResult?.delivered || deliveryResult?.terminal)
  ) {
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
      handoffIntentId: handoffIntent.intent.intentId,
      handoffStatus: deliveryResult?.intent.status ?? handoffIntent.intent.status,
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
    handoffIntentId: handoffIntent.intent.intentId,
    handoffStatus: deliveryResult?.intent.status ?? handoffIntent.intent.status,
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
              "get_handoff_status",
              "diagnose_track_evidence",
              "get_papernexus_remote_access",
              "get_papernexus_progress",
              "check_graph_presence",
              "refresh_graph_presence",
              "accept_remote_graph_ready",
  "audit_literature_coverage",
  "plan_citation_expansion",
  "run_broad_paper_search",
  "auto_iterator_tick",
              "start_background_run",
              "run_papernexus_wrapper",
              "queue_paper_ingestion",
              "stage_papernexus_remote_sources",
              "validate_paper_ingestion",
              "queue_literature_discovery_requisition",
              "migrate_runtime_state",
              "get_idle_research",
              "set_idle_research",
              "record_idle_research_run",
  "get_experiment_memory",
  "get_gpu_monitor",
  "get_innovation_reflection",
              "get_brainstorm_cycle",
              "get_survey_review",
  "set_brainstorm_cycle",
  "refresh_gpu_monitor",
  "record_experiment_runtime_signal",
  "run_brainstorm_cycle",
              "materialize_ideation_contract",
              "materialize_experiment_review_state",
              "materialize_literature_discovery_packet",
              "materialize_plan_state",
              "materialize_papernexus_packet_contracts",
              "materialize_paper_story_state",
              "materialize_storyline_planner_state",
              "materialize_results_storyline_state",
              "materialize_title_abstract_intro_workbench_state",
              "materialize_innovation_synthesis_state",
              "materialize_writing_support_artifacts",
              "materialize_writing_hook_policies",
              "get_panel_discussion_state",
              "materialize_panel_discussion_state",
              "get_execution_proof_state",
              "materialize_execution_proof_state",
              "get_paragraph_logic_audit_state",
              "materialize_paragraph_logic_audit_state",
              "get_revision_control_state",
              "materialize_revision_control_state",
              "reconcile_authoring_closeout",
              "materialize_cycle_memory",
              "materialize_survey_review_state",
              "run_idea_catalyst_research30",
              "get_file_audit_state",
              "set_file_audit_policy",
              "materialize_file_audit_packet",
              "get_cross_domain_inspiration",
              "set_cross_domain_inspiration",
              "materialize_cross_domain_requisition",
              "queue_cross_domain_requisition",
              "materialize_cross_domain_bridge_artifacts",
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
  "set_storyline_planner_state",
  "get_storyline_planner_state",
  "get_results_storyline_state",
  "get_innovation_synthesis_state",
  "get_title_abstract_intro_workbench_state",
  "get_story_gap_search_requisition",
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
              "run_citation_calibration",
              "capture_diagnostic_bundle",
              "get_paper_qc",
              "set_paper_qc",
              "get_figure_qc",
              "set_figure_qc",
              "get_citation_collection",
              "set_citation_collection",
              "get_review_issue_tracker",
              "set_review_issue_tracker",
              "get_experiment_search",
              "evaluate_experiment_search_decision",
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
              "get_task_graph",
              "get_team_round",
              "claim_task",
              "renew_task_lease",
              "release_task",
              "complete_task",
              "prepare_stage_handoff",
              "get_handoff_intents",
              "ack_handoff_intent",
              "claim_handoff_intent",
              "fail_handoff_intent",
              "get_artifact_receipts",
              "get_repair_queue",
              "get_agent_capabilities",
              "claim_write_scope",
              "release_stale_write_scopes",
              "get_paper_ingestion_failures",
              "classify_paper_ingestion_failures",
              "materialize_paper_ingestion_retry",
              "queue_paper_ingestion_retry",
              "get_paper_ingestion_retry_status",
              "cancel_paper_ingestion_retry",
              "recover_survey_route",
              "skip_experiment_stages_for_survey",
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
          broadPaperSearch: {
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
          fileAuditPolicy: {
            type: "object",
            additionalProperties: true,
          },
          fileAuditPolicies: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
          handoff: {
            type: "object",
            additionalProperties: true,
          },
          ideationMaterialization: {
            type: "object",
            additionalProperties: true,
          },
          crossDomainInspiration: {
            type: "object",
            additionalProperties: true,
          },
          crossDomainBridgeEvidence: {
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
          writingHookPolicyMaterialization: {
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
          experimentSearchDecision: {
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
          experimentRuntimeSignal: {
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
          citationCalibration: {
            type: "object",
            additionalProperties: true,
          },
          ideaCatalystResearch30: {
            type: "object",
            additionalProperties: true,
          },
          topic: {
            type: "string",
          },
          papernexusRemoteStage: {
            type: "object",
            additionalProperties: true,
          },
          authoringCloseout: {
            type: "object",
            additionalProperties: true,
          },
          channelBinding: {
            type: "object",
            additionalProperties: true,
          },
          projectRoot: {
            type: "string",
          },
          projectId: {
            type: "string",
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
          taskId: {
            type: "string",
          },
          completionNote: {
            type: "string",
          },
          handoffIntentId: {
            type: "string",
          },
          hookId: {
            type: "string",
          },
          hookPoint: {
            type: "string",
          },
          artifactReceipt: {
            type: "object",
            additionalProperties: true,
          },
          failure: {
            type: "object",
            additionalProperties: true,
          },
          writeScope: {
            type: "object",
            additionalProperties: true,
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
          artifactPath: {
            type: "string",
          },
          content: {
            type: "string",
          },
          mode: {
            type: "string",
            enum: ["replace", "append"],
          },
          ensureTrailingNewline: {
            type: "boolean",
          },
        },
        required: ["action"],
      },
      async execute(_id, params) {
        const action = String(params.action ?? "");
        const executeAction = async () => {
          let state = await resolveWorkflowToolState({
            plugin,
            agentCtx: ctx,
            rawParams: params,
            action,
          });
          let {
            workflowPolicy,
            channelBinding,
            snapshot,
            projectRoot,
            projectRequiredMessage,
            bindingRole,
          } = state;
          const workflowRuntime = createWorkflowToolRuntime({
            plugin,
            agentCtx: ctx,
            projectRoot,
          });
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
          const handoffActivation = await maybeAutoActivatePendingHandoffForToolAction({
            action,
            plugin,
            workflowPolicy,
            snapshot,
            ctx,
            projectRoot,
          });
          if (handoffActivation.claimed) {
            state = await resolveWorkflowToolState({
              plugin,
              agentCtx: ctx,
              rawParams: params,
              action,
            });
            ({
              workflowPolicy,
              channelBinding,
              snapshot,
              projectRoot,
              projectRequiredMessage,
              bindingRole,
            } = state);
            if (!handoffActivation.activated) {
              throw new Error(
                `Cannot execute ${action} before the pending ${snapshot.role ?? ctx.agentId ?? "workflow"} handoff is activated.${
                  snapshot.blockingReason ? ` ${snapshot.blockingReason}` : ""
                }`
              );
            }
          }
          if (projectRoot && ctx.sessionKey) {
            const lobsterReadiness = await inspectWorkflowLobsterReadiness({
              config: workflowPolicy.lobsterHandoff,
              autoModeActive: workflowPolicy.autoMode !== "off",
            }).catch(() => null);
            await upsertWorkflowAgentCapability({
              projectRoot,
              projectId: snapshot.projectId,
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              role: snapshot.role,
              agentId: ctx.agentId,
              messageChannel: ctx.messageChannel,
              canUseResearchWorkflow: true,
              canReceiveNativeDispatch: true,
              canRunExecPacket: true,
              canUseLobster: lobsterReadiness?.status === "ready",
              confidence: "high",
            });
            await upsertWorkflowAgentSessionRegistryEntry({
              projectRoot,
              projectId: snapshot.projectId,
              role: snapshot.role ?? ctx.agentId ?? "unknown",
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              currentStage: snapshot.currentStage,
              status: "active",
              source: "workflow_tool",
            });
          }
          const genericInboundBudget =
            projectRoot && action !== "auto_iterator_tick"
              ? createWorkflowInboundBudgetContext({
                  projectRoot,
                  projectId: snapshot.projectId,
                  channelKey:
                    readString(channelBinding?.channelKey) ??
                    readString(ctx.channelKey) ??
                    readString(ctx.messageChannel),
                  sessionKey: ctx.sessionKey,
                  agentId: ctx.agentId,
                  action,
                })
              : null;
          if (genericInboundBudget) {
            await recordWorkflowInboundTurnStarted(genericInboundBudget);
          }
          let actionFailed = false;

          const syncTeamRoundFromTaskGraph = async (params: {
            projectRoot: string;
            stage: string | null;
            leadRole: string | null;
            sessionKey?: string | null;
            claimedTaskId?: string | null;
            completedTaskId?: string | null;
          }) => {
            const taskGraphStore = await readWorkflowTaskGraphStore(params.projectRoot);
            const taskGraphSummary = summarizeWorkflowTaskGraphStore(taskGraphStore);
            if (!taskGraphStore) {
              return { taskGraphStore: null, taskGraphSummary, teamRound: null };
            }
            const existingRound = await readWorkflowTeamRoundStore(params.projectRoot);
            const teamRound = await materializeWorkflowTeamRound({
              projectRoot: params.projectRoot,
              projectId: snapshot.projectId ?? taskGraphStore.projectId ?? null,
              stage: params.stage ?? taskGraphStore.stage ?? null,
              leadRole: params.leadRole ?? existingRound?.leadRole ?? null,
              topTierVerdict: taskGraphStore.topTierVerdict,
              evidenceCloseoutStatus: taskGraphStore.evidenceCloseoutStatus,
              taskGraphPath: getWorkflowTaskGraphPath(params.projectRoot),
              taskCount: taskGraphSummary.taskCount,
              claimableCount: taskGraphSummary.claimableCount,
              blockedCount: taskGraphSummary.blockedCount,
              claimedCount: taskGraphSummary.claimedCount,
              verifyingCount: taskGraphSummary.verifyingCount,
              needsRepairCount: taskGraphSummary.needsRepairCount,
              satisfiedCount: taskGraphSummary.satisfiedCount,
              optionalCount: taskGraphSummary.optionalCount,
            });
            if (params.sessionKey && params.claimedTaskId) {
              await recordWorkflowTeamRoundClaim({
                projectRoot: params.projectRoot,
                sessionKey: params.sessionKey,
                taskId: params.claimedTaskId,
              });
            }
            if (params.sessionKey && params.completedTaskId) {
              await recordWorkflowTeamRoundCompletion({
                projectRoot: params.projectRoot,
                sessionKey: params.sessionKey,
                taskId: params.completedTaskId,
              });
            }
            return { taskGraphStore, taskGraphSummary, teamRound };
          };

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
            case "get_handoff_status": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const report = await buildHandoffDashboard({
                projectRoot: resolvedProjectRoot,
                projectId: state.snapshot.projectId,
                policy: workflowPolicy,
                sessionKey: ctx.sessionKey,
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
            case "check_graph_presence":
            case "refresh_graph_presence":
            case "accept_remote_graph_ready": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const graphPresenceCheck = asObject(params.graphPresenceCheck);
              const result = await checkGraphPresenceForWorkflow({
                projectRoot: resolvedProjectRoot,
                updateManifest:
                  action === "refresh_graph_presence" ||
                  action === "accept_remote_graph_ready"
                    ? true
                    :
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
              if (action === "accept_remote_graph_ready" && result.status !== "ready") {
                throw new Error(
                  `Remote graph is not ready; graph presence status=${result.status}, missing=${result.missingPaperCount}.`
                );
              }
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
              const autoCitationVerification =
                await maybeAutoRefreshCitationVerification({
                  projectRoot: resolvedProjectRoot,
                  triggerAction: "plan_citation_expansion",
                });
              return textResponse(
                JSON.stringify(
                  {
                    ...packet,
                    autoCitationVerification,
                  },
                  null,
                  2
                )
              );
            }
            case "run_broad_paper_search": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const broadPaperSearch = asObject(params.broadPaperSearch);
              const depthValue = readString(
                broadPaperSearch?.depth ?? broadPaperSearch?.searchDepth
              );
              const result = await runBroadPaperSearchForWorkflow({
                projectRoot: resolvedProjectRoot,
                topic:
                  readString(broadPaperSearch?.topic) ??
                  readString(params.topic) ??
                  (() => {
                    throw new Error("run_broad_paper_search requires a topic.");
                  })(),
                depth:
                  depthValue === "quick" ||
                  depthValue === "default" ||
                  depthValue === "deep"
                    ? depthValue
                    : undefined,
                maxQueries: readNumber(
                  broadPaperSearch?.maxQueries ?? broadPaperSearch?.max_queries
                ),
                maxResultsPerQuery: readNumber(
                  broadPaperSearch?.maxResultsPerQuery ??
                    broadPaperSearch?.max_results_per_query
                ),
                maxIndexEntries: readNumber(
                  broadPaperSearch?.maxIndexEntries ?? broadPaperSearch?.max_index_entries
                ),
                maxResolutionAttempts: readNumber(
                  broadPaperSearch?.maxResolutionAttempts ??
                    broadPaperSearch?.max_resolution_attempts
                ),
              });
              const autoCitationVerification =
                await maybeAutoRefreshCitationVerification({
                  projectRoot: resolvedProjectRoot,
                  triggerAction: "run_broad_paper_search",
                });
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    autoCitationVerification,
                  },
                  null,
                  2
                )
              );
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
              const inboundBudget = createWorkflowInboundBudgetContext({
                projectRoot,
                projectId: snapshot.projectId,
                channelKey:
                  readString(channelBinding?.channelKey) ??
                  readString(ctx.channelKey) ??
                  readString(ctx.messageChannel),
                sessionKey: ctx.sessionKey,
                agentId: ctx.agentId,
                action: "auto_iterator_tick",
                inboundBudgetMs:
                  readNumber(iterator?.inboundBudgetMs) ??
                  readNumber(iterator?.inbound_budget_ms) ??
                  WORKFLOW_INBOUND_AUTO_ITERATOR_INLINE_BUDGET_MS,
              });
              await recordWorkflowInboundTurnStarted(inboundBudget);
              const result = await runWorkflowAutoIterator({
                projectRoot,
                policy: workflowPolicy,
                agentId: ctx.agentId,
                requesterSessionKey: ctx.sessionKey,
                sessionBindingKey: snapshot.channelProjectBindingKey,
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
                        Math.min(5000, Math.max(0, inboundBudget.remainingMs() - 1500)),
                      retryOnTimeout:
                        iterator?.retryOnTimeout === true ||
                        iterator?.retry_on_timeout === true,
                      enableSpawnFallback:
                        iterator?.enableSpawnFallback === false ||
                        iterator?.enable_spawn_fallback === false
                          ? false
                          : true,
                      forceQueueOnly:
                        (readString(iterator?.executionMode) ??
                          readString(iterator?.execution_mode) ??
                          "defer_after_budget") === "outbox_only" ||
                        inboundBudget.isExhausted(2500),
                    });
              const stageBroadcast =
                iterator?.broadcastStageChange === false ||
                iterator?.broadcast_stage_change === false ||
                inboundBudget.isExhausted(1500) ||
                result.pendingHandoff
                  ? {
                      broadcasted: false,
                      reasonSkipped:
                        iterator?.broadcastStageChange === false ||
                        iterator?.broadcast_stage_change === false
                          ? "disabled_by_iterator"
                          : result.pendingHandoff
                            ? "handoff_pending"
                          : "inbound_budget_exceeded",
                      runId: null,
                      sessionKey: ctx.sessionKey ?? null,
                      idempotencyKey: null,
                    }
                  : await maybeBroadcastAutoIteratorStageChange({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      bindingPolicy: workflowPolicy,
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
                      handoffIntentId:
                        (dispatchResult as Record<string, unknown> | null)?.handoffIntentId as string | null ??
                        null,
                    });
              const statusBroadcast =
                result.timedDefaultTriggered === true && !inboundBudget.isExhausted(1500)
                  ? await maybeBroadcastWorkflowStatusUpdate({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      bindingPolicy: workflowPolicy,
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
              const dispatchQueuedFallback =
                Boolean(
                  dispatchResult &&
                    "queuedFallback" in dispatchResult &&
                    dispatchResult.queuedFallback === true
                );
              const dispatchQueueKey =
                dispatchResult && "queueKey" in dispatchResult
                  ? readString(dispatchResult.queueKey)
                  : null;
              await recordWorkflowInboundTurnCompleted({
                context: inboundBudget,
                status:
                  dispatchQueuedFallback ||
                  stageBroadcast.reasonSkipped === "inbound_budget_exceeded"
                    ? "deferred"
                    : "completed_inline",
                deferredQueueKey: dispatchQueueKey,
              });
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    agentTaskDispatch: dispatchResult,
                    stageBroadcast,
                    statusBroadcast,
                    inboundBudget: {
                      turnId: inboundBudget.turn.turnId,
                      remainingMs: inboundBudget.remainingMs(),
                      deferred:
                        dispatchQueuedFallback ||
                        stageBroadcast.reasonSkipped === "inbound_budget_exceeded",
                    },
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
                runtimeSubagent: workflowRuntime,
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
                      bindingPolicy: workflowPolicy,
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
                runtimeSubagent: workflowRuntime,
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
                      bindingPolicy: workflowPolicy,
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
            case "stage_papernexus_remote_sources": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const stageParams = asObject(params.papernexusRemoteStage);
              const result = await stagePapernexusRemoteSources({
                projectRoot: resolvedProjectRoot,
                sshTarget:
                  readString(stageParams?.sshTarget) ??
                  readString(stageParams?.ssh_target),
                remoteBaseDir:
                  readString(stageParams?.remoteBaseDir) ??
                  readString(stageParams?.remote_base_dir),
                projectId:
                  readString(stageParams?.projectId) ??
                  readString(stageParams?.project_id),
                sourcePaths: Array.isArray(stageParams?.sourcePaths)
                  ? stageParams.sourcePaths
                      .map((entry) => readString(entry))
                      .filter((entry): entry is string => Boolean(entry))
                  : Array.isArray(stageParams?.source_paths)
                    ? stageParams.source_paths
                        .map((entry) => readString(entry))
                        .filter((entry): entry is string => Boolean(entry))
                    : undefined,
                manifestPath:
                  readString(stageParams?.manifestPath) ??
                  readString(stageParams?.manifest_path),
                rewriteManifestOut:
                  readString(stageParams?.rewriteManifestOut) ??
                  readString(stageParams?.rewrite_manifest_out),
                reportPath:
                  readString(stageParams?.reportPath) ??
                  readString(stageParams?.report_path),
                timeoutSeconds:
                  typeof stageParams?.timeoutSeconds === "number"
                    ? stageParams.timeoutSeconds
                    : typeof stageParams?.timeout_seconds === "number"
                      ? stageParams.timeout_seconds
                      : undefined,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_paper_ingestion_failures":
            case "classify_paper_ingestion_failures": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const manifest = await readProjectManifestForRetry(resolvedProjectRoot);
              const ingestionState = normalizePaperIngestionState(manifest.paper_ingestion);
              const failures = collectPaperIngestionFailures({ state: ingestionState });
              const retryableFailures = failures.filter(
                (entry) => entry.retryable && !entry.alreadyInGraph
              );
              const nonRetryableFailures = failures.filter(
                (entry) => !entry.retryable || entry.alreadyInGraph
              );
              await setPaperIngestionState({
                projectRoot: resolvedProjectRoot,
                paperIngestion: {
                  failed_papers: failures,
                  retryable_failed_papers: retryableFailures,
                  non_retryable_failed_papers: nonRetryableFailures,
                  last_failure_scan_at: new Date().toISOString(),
                },
              });
              return textResponse(
                JSON.stringify(
                  {
                    failedCount: failures.length,
                    retryableCount: retryableFailures.length,
                    nonRetryableCount: nonRetryableFailures.length,
                    failures,
                    retryableFailures,
                    nonRetryableFailures,
                  },
                  null,
                  2
                )
              );
            }
            case "materialize_paper_ingestion_retry":
            case "queue_paper_ingestion_retry": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const requestPayload = asObject(params.paperIngestionRequest);
              const materialized = await materializePaperIngestionRetry({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId ?? null,
                manifest: await readProjectManifestForRetry(resolvedProjectRoot),
                intervalSeconds:
                  readNumber(
                    requestPayload?.intervalSeconds ?? requestPayload?.interval_seconds
                  ) ?? null,
                maxAttempts:
                  readNumber(requestPayload?.maxAttempts ?? requestPayload?.max_attempts) ??
                  null,
              });
              if (action === "materialize_paper_ingestion_retry") {
                await setPaperIngestionState({
                  projectRoot: resolvedProjectRoot,
                  paperIngestion: {
                    failed_papers: materialized.failures,
                    retryable_failed_papers: materialized.retryableFailures,
                    non_retryable_failed_papers: materialized.nonRetryableFailures,
                    last_failure_scan_at: new Date().toISOString(),
                    last_retry_manifest_path: materialized.retryManifestPath,
                    retry_policy: {
                      mode: "sequential",
                      interval_seconds: materialized.retryManifest.intervalSeconds,
                      max_attempts: materialized.retryManifest.maxAttempts,
                    },
                    retry_status:
                      materialized.retryableFailures.length > 0
                        ? "manifest_ready"
                        : "no_retryable_failures",
                    sequential_retry_interval_seconds:
                      materialized.retryManifest.intervalSeconds,
                  },
                });
                return textResponse(JSON.stringify(materialized, null, 2));
              }
              if (materialized.retryableFailures.length === 0) {
                await setPaperIngestionState({
                  projectRoot: resolvedProjectRoot,
                  paperIngestion: {
                    failed_papers: materialized.failures,
                    retryable_failed_papers: [],
                    non_retryable_failed_papers: materialized.nonRetryableFailures,
                    last_failure_scan_at: new Date().toISOString(),
                    last_retry_manifest_path: materialized.retryManifestPath,
                    retry_status: "no_retryable_failures",
                  },
                });
                const repairHandoff =
                  materialized.failures.length > 0
                    ? await routeWorkflowFailure({
                        projectRoot: resolvedProjectRoot,
                        projectId: snapshot.projectId,
                        workflowLine: resolveSnapshotWorkflowLine(snapshot),
                        stage: snapshot.currentStage,
                        originalOwner: snapshot.role,
                        failureKind: "paper_ingestion_failed",
                        failureReason:
                          "PaperNexus failures remain but no retryable failed papers were found.",
                        verificationRule: "paper_ingestion_retry",
                      })
                    : null;
                return textResponse(
                  JSON.stringify({ ...materialized, repairHandoff }, null, 2)
                );
              }
              const queued = await queuePaperIngestionRequest({
                projectRoot: resolvedProjectRoot,
                paperIngestionRequest: {
                  wrapper: "pn_batch_import.py",
                  args: [
                    "--manifest",
                    materialized.retryManifestPath,
                    "submit",
                    "--sequential",
                    "--interval",
                    String(materialized.retryManifest.intervalSeconds),
                  ],
                  command_text: materialized.commandText,
                  manifest_path: materialized.retryManifestPath,
                  paper_count: materialized.retryableFailures.length,
                  summary: `Sequentially retry ${materialized.retryableFailures.length} failed PaperNexus paper import(s).`,
                  trigger_kind: "failed_paper_retry",
                  status: "queued",
                },
              });
              await setPaperIngestionState({
                projectRoot: resolvedProjectRoot,
                paperIngestion: {
                  failed_papers: materialized.failures,
                  retryable_failed_papers: materialized.retryableFailures,
                  non_retryable_failed_papers: materialized.nonRetryableFailures,
                  last_failure_scan_at: new Date().toISOString(),
                  last_retry_manifest_path: materialized.retryManifestPath,
                  retry_policy: {
                    mode: "sequential",
                    interval_seconds: materialized.retryManifest.intervalSeconds,
                    max_attempts: materialized.retryManifest.maxAttempts,
                  },
                  retry_status: "queued",
                  retry_attempt_count: 0,
                  sequential_retry_interval_seconds:
                    materialized.retryManifest.intervalSeconds,
                },
              });
              return textResponse(
                JSON.stringify(
                  {
                    ...materialized,
                    queuedRequest: queued.request,
                  },
                  null,
                  2
                )
              );
            }
            case "get_paper_ingestion_retry_status": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const manifest = await readProjectManifestForRetry(resolvedProjectRoot);
              const ingestionState = normalizePaperIngestionState(manifest.paper_ingestion);
              return textResponse(
                JSON.stringify(
                  {
                    retryStatus: ingestionState.retryStatus,
                    retryRunId: ingestionState.retryRunId,
                    retryAttemptCount: ingestionState.retryAttemptCount,
                    lastRetryManifestPath: ingestionState.lastRetryManifestPath,
                    retryableFailedCount: ingestionState.retryableFailedPapers.length,
                    nonRetryableFailedCount: ingestionState.nonRetryableFailedPapers.length,
                    sequentialRetryIntervalSeconds:
                      ingestionState.sequentialRetryIntervalSeconds,
                  },
                  null,
                  2
                )
              );
            }
            case "cancel_paper_ingestion_retry": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setPaperIngestionState({
                projectRoot: resolvedProjectRoot,
                paperIngestion: {
                  retry_status: "cancelled",
                  last_updated_at: new Date().toISOString(),
                },
              });
              return textResponse(JSON.stringify(result.state, null, 2));
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
                runtimeSubagent: workflowRuntime,
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
                runtimeSubagent: workflowRuntime,
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
                runtimeSubagent: workflowRuntime,
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
            case "get_task_graph": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowTaskGraphStore(resolvedProjectRoot);
              return textResponse(
                JSON.stringify(
                  {
                    path: getWorkflowTaskGraphPath(resolvedProjectRoot),
                    summary: summarizeWorkflowTaskGraphStore(store),
                    store,
                  },
                  null,
                  2
                )
              );
            }
            case "get_team_round": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowTeamRoundStore(resolvedProjectRoot);
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "claim_task": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (workflowPolicy.teamRuntime?.enabled === false) {
                throw new Error("Workflow Team Runtime is disabled by policy.");
              }
              const taskId = readString(params.taskId);
              if (!taskId) {
                throw new Error("taskId is required for claim_task.");
              }
              if (!snapshot.role) {
                throw new Error("Cannot determine the current workflow role for claim_task.");
              }
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for claim_task.");
              }
              const claimed = await claimWorkflowTask({
                projectRoot: resolvedProjectRoot,
                taskId,
                sessionKey: ctx.sessionKey,
                role: snapshot.role,
              });
              if (claimed.claimed && claimed.task) {
                await syncTeamRoundFromTaskGraph({
                  projectRoot: resolvedProjectRoot,
                  stage: snapshot.currentStage,
                  leadRole: snapshot.ownerAgent ?? snapshot.role,
                  sessionKey: ctx.sessionKey,
                  claimedTaskId: claimed.task.taskId,
                });
              }
              return textResponse(JSON.stringify(claimed, null, 2));
            }
            case "renew_task_lease": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (workflowPolicy.teamRuntime?.enabled === false) {
                throw new Error("Workflow Team Runtime is disabled by policy.");
              }
              const taskId = readString(params.taskId);
              if (!taskId) {
                throw new Error("taskId is required for renew_task_lease.");
              }
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for renew_task_lease.");
              }
              const renewed = await renewWorkflowTaskLease({
                projectRoot: resolvedProjectRoot,
                taskId,
                sessionKey: ctx.sessionKey,
              });
              return textResponse(JSON.stringify(renewed, null, 2));
            }
            case "release_task": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (workflowPolicy.teamRuntime?.enabled === false) {
                throw new Error("Workflow Team Runtime is disabled by policy.");
              }
              const taskId = readString(params.taskId);
              if (!taskId) {
                throw new Error("taskId is required for release_task.");
              }
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for release_task.");
              }
              const released = await releaseWorkflowTaskClaim({
                projectRoot: resolvedProjectRoot,
                taskId,
                sessionKey: ctx.sessionKey,
              });
              if (released.released) {
                await releaseWorkflowTeamRoundSession({
                  projectRoot: resolvedProjectRoot,
                  sessionKey: ctx.sessionKey,
                });
                await syncTeamRoundFromTaskGraph({
                  projectRoot: resolvedProjectRoot,
                  stage: snapshot.currentStage,
                  leadRole: snapshot.ownerAgent ?? snapshot.role,
                });
              }
              return textResponse(JSON.stringify(released, null, 2));
            }
            case "complete_task": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              if (workflowPolicy.teamRuntime?.enabled === false) {
                throw new Error("Workflow Team Runtime is disabled by policy.");
              }
              const taskId = readString(params.taskId);
              if (!taskId) {
                throw new Error("taskId is required for complete_task.");
              }
              if (!snapshot.role) {
                throw new Error("Cannot determine the current workflow role for complete_task.");
              }
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for complete_task.");
              }
              const receiptPayload = asObject(params.artifactReceipt);
              const receipt = await createWorkflowArtifactReceipt({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                taskId,
                handoffIntentId: readString(params.handoffIntentId),
                producedByRole: snapshot.role,
                producedBySessionKey: ctx.sessionKey,
                stage: snapshot.currentStage,
                summary:
                  readString(receiptPayload?.summary) ??
                  readString(params.completionNote) ??
                  "Workflow task completion.",
                completionNote: readString(params.completionNote),
                changedFiles: Array.isArray(receiptPayload?.changedFiles)
                  ? receiptPayload.changedFiles.filter((entry): entry is string => typeof entry === "string")
                  : [],
                artifactPaths: Array.isArray(receiptPayload?.artifactPaths)
                  ? receiptPayload.artifactPaths.filter((entry): entry is string => typeof entry === "string")
                  : [],
                evidencePointers: Array.isArray(receiptPayload?.evidencePointers)
                  ? receiptPayload.evidencePointers.filter((entry): entry is string => typeof entry === "string")
                  : [],
                verificationCommands: Array.isArray(receiptPayload?.verificationCommands)
                  ? receiptPayload.verificationCommands.filter((entry): entry is string => typeof entry === "string")
                  : [],
                verificationResult:
                  receiptPayload?.verificationResult === "passed" ||
                  receiptPayload?.verificationResult === "failed" ||
                  receiptPayload?.verificationResult === "not_run"
                    ? receiptPayload.verificationResult
                    : "not_run",
                blockers: Array.isArray(receiptPayload?.blockers)
                  ? receiptPayload.blockers.filter((entry): entry is string => typeof entry === "string")
                  : [],
                assumptions: Array.isArray(receiptPayload?.assumptions)
                  ? receiptPayload.assumptions.filter((entry): entry is string => typeof entry === "string")
                  : [],
                nextSuggestedTaskIds: Array.isArray(receiptPayload?.nextSuggestedTaskIds)
                  ? receiptPayload.nextSuggestedTaskIds.filter((entry): entry is string => typeof entry === "string")
                  : [],
              });
              const completion = await completeWorkflowTaskAndContinue({
                projectRoot: resolvedProjectRoot,
                taskId,
                sessionKey: ctx.sessionKey,
                role: snapshot.role,
                completionNote: readString(params.completionNote),
                hookGateContext: {
                  runtimeSubagent: workflowRuntime,
                  projectId: snapshot.projectId,
                  stage: snapshot.currentStage,
                  requesterChannel: ctx.messageChannel,
                  changedPaths: [
                    ...(Array.isArray(receiptPayload?.changedFiles)
                      ? receiptPayload.changedFiles
                      : []),
                    ...(Array.isArray(receiptPayload?.artifactPaths)
                      ? receiptPayload.artifactPaths
                      : []),
                  ].filter((entry): entry is string => typeof entry === "string"),
                },
              });
              if (!completion.verification.verified) {
                await routeWorkflowFailure({
                  projectRoot: resolvedProjectRoot,
                  projectId: snapshot.projectId,
                  workflowLine: resolveSnapshotWorkflowLine(snapshot),
                  stage: snapshot.currentStage,
                  sourceTaskId: taskId,
                  originalOwner: snapshot.role,
                  failureKind: "verification_failed",
                  failureReason:
                    completion.verification.reason ??
                    "Workflow task verification failed.",
                  verificationRule: completion.task?.verificationRule ?? null,
                });
              } else {
                await closeWorkflowRepairItemsForTask({
                  projectRoot: resolvedProjectRoot,
                  sourceTaskId: taskId,
                });
              }
              if (completion.verification.verified && completion.nextTask?.owner) {
                await createTaskUnlockedHandoffIntent({
                  projectRoot: resolvedProjectRoot,
                  projectId: snapshot.projectId,
                  workflowLine: resolveSnapshotWorkflowLine(snapshot),
                  stage: snapshot.currentStage,
                  fromRole: snapshot.role,
                  fromSessionKey: ctx.sessionKey,
                  toRole: completion.nextTask.owner,
                  sourceTaskId: taskId,
                  targetTaskId: completion.nextTask.taskId,
                  artifactReceiptId: receipt.receipt.receiptId,
                  summary: `Task ${taskId} completed; ${completion.nextTask.taskId} is ready.`,
                  command: completion.nextTask.title,
                });
              }
              await syncTeamRoundFromTaskGraph({
                projectRoot: resolvedProjectRoot,
                stage: snapshot.currentStage,
                leadRole: snapshot.ownerAgent ?? snapshot.role,
              });
              return textResponse(JSON.stringify({ ...completion, artifactReceipt: receipt }, null, 2));
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
                runtimeSubagent: workflowRuntime,
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
                if (dispatch.sessionKey) {
                  try {
                    const claimedTask = await claimNextWorkflowTaskForOwner({
                      projectRoot: resolvedProjectRoot,
                      owner: toAgent,
                      sessionKey: dispatch.sessionKey,
                    });
                    if (claimedTask.claimed && claimedTask.task) {
                      await syncTeamRoundFromTaskGraph({
                        projectRoot: resolvedProjectRoot,
                        stage: snapshot.currentStage,
                        leadRole: toAgent,
                        sessionKey: dispatch.sessionKey,
                        claimedTaskId: claimedTask.task.taskId,
                      });
                    } else {
                      plugin.api.logger?.warn?.(
                        "No matching workflow task was claimed after explicit dispatch_task.",
                        {
                          projectRoot: resolvedProjectRoot,
                          owner: toAgent,
                          stage: snapshot.currentStage,
                          reason: claimedTask.reason,
                        }
                      );
                    }
                  } catch (error) {
                    plugin.api.logger?.warn?.(
                      "Failed to claim workflow task after explicit dispatch_task.",
                      {
                        projectRoot: resolvedProjectRoot,
                        owner: toAgent,
                        stage: snapshot.currentStage,
                        error: error instanceof Error ? error.message : String(error),
                      }
                    );
                  }
                }
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
            case "get_gpu_monitor": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getExperimentGpuMonitorStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "refresh_gpu_monitor": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await refreshExperimentGpuMonitor({
                projectRoot: resolvedProjectRoot,
                server: readString(params.server),
                servers: Array.isArray(params.servers)
                  ? params.servers
                      .map((entry) => readString(entry))
                      .filter((entry): entry is string => Boolean(entry))
                  : null,
                sshTimeoutMs:
                  typeof params.sshTimeoutMs === "number" &&
                  Number.isFinite(params.sshTimeoutMs)
                    ? Math.floor(params.sshTimeoutMs)
                    : undefined,
              });
              return textResponse(JSON.stringify(result, null, 2));
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
            case "get_file_audit_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getFileAuditStateSummary({
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
            case "record_experiment_runtime_signal": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await recordExperimentRuntimeSignal({
                projectRoot: resolvedProjectRoot,
                runtimeSignal: requireObject(
                  params.experimentRuntimeSignal,
                  "experimentRuntimeSignal"
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
            case "get_cross_domain_inspiration": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getCrossDomainInspirationStateSummary({
                projectRoot: resolvedProjectRoot,
                workflowLine: resolveSnapshotWorkflowLine(snapshot),
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
            case "run_idea_catalyst_research30": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const searchParams = asObject(params.ideaCatalystResearch30);
              const depthValue = readString(searchParams?.depth);
              const result = await runIdeaCatalystResearch30({
                projectRoot: resolvedProjectRoot,
                scoutingReportPath:
                  readString(searchParams?.scoutingReportPath) ??
                  readString(searchParams?.scouting_report_path),
                requisitionPath:
                  readString(searchParams?.requisitionPath) ??
                  readString(searchParams?.requisition_path),
                reportJsonPath:
                  readString(searchParams?.reportJsonPath) ??
                  readString(searchParams?.report_json_path),
                reportMarkdownPath:
                  readString(searchParams?.reportMarkdownPath) ??
                  readString(searchParams?.report_markdown_path),
                days:
                  typeof searchParams?.days === "number"
                    ? searchParams.days
                    : typeof searchParams?.day_horizon === "number"
                      ? searchParams.day_horizon
                      : undefined,
                sources:
                  readString(searchParams?.sources) ??
                  readString(searchParams?.source_mode),
                depth:
                  depthValue === "quick" ||
                  depthValue === "default" ||
                  depthValue === "deep"
                    ? depthValue
                    : undefined,
                topK:
                  typeof searchParams?.topK === "number"
                    ? searchParams.topK
                    : typeof searchParams?.top_k === "number"
                      ? searchParams.top_k
                      : undefined,
                mock:
                  searchParams?.mock === true || searchParams?.use_mock === true,
                updateScoutReport:
                  searchParams?.updateScoutReport === false ||
                  searchParams?.update_scout_report === false
                    ? false
                    : true,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "reconcile_authoring_closeout": {
              const closeoutParams = asObject(params.authoringCloseout);
              const resolvedProjectRoot = resolveWorkflowProjectRootWithOverride({
                state,
                override:
                  readString(closeoutParams?.projectRoot) ??
                  readString(closeoutParams?.project_root),
              });
              const result = await reconcileAuthoringCloseout({
                projectRoot: resolvedProjectRoot,
                compilePdf:
                  closeoutParams?.compilePdf === false ||
                  closeoutParams?.compile_pdf === false
                    ? false
                    : true,
                autoInjectConferenceCitations:
                  closeoutParams?.autoInjectConferenceCitations === false ||
                  closeoutParams?.auto_inject_conference_citations === false
                    ? false
                    : true,
                currentStageOverride:
                  readString(closeoutParams?.currentStageOverride) ??
                  readString(closeoutParams?.current_stage_override),
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
            case "set_cross_domain_inspiration": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setCrossDomainInspirationState({
                projectRoot: resolvedProjectRoot,
                patch: requireObject(
                  params.crossDomainInspiration,
                  "crossDomainInspiration"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_cross_domain_requisition":
            case "queue_cross_domain_requisition": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const materialized = await materializeCrossDomainInspirationRequisition({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                workflowLine: resolveSnapshotWorkflowLine(snapshot),
                force:
                  asObject(params.crossDomainInspiration)?.force === true ||
                  asObject(params.crossDomainInspiration)?.force_requisition === true,
              });
              if (
                action === "queue_cross_domain_requisition" &&
                materialized.created &&
                materialized.requisitionPath
              ) {
                const queued = await queueLiteratureDiscoveryRequisition({
                  projectRoot: resolvedProjectRoot,
                  packetPath: materialized.requisitionPath,
                  triggerKind: "cross_domain_literature_discovery",
                  originStage: snapshot.currentStage,
                  summary:
                    "Workflow-owned cross-domain source-domain evidence acquisition.",
                  requestIdPrefix: "cross-domain",
                });
                return textResponse(
                  JSON.stringify({ ...materialized, queued }, null, 2)
                );
              }
              return textResponse(JSON.stringify(materialized, null, 2));
            }
            case "materialize_cross_domain_bridge_artifacts": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload = asObject(params.crossDomainBridgeEvidence);
              const evidenceItems = Array.isArray(payload?.bridgeEvidence)
                ? payload.bridgeEvidence
                : Array.isArray(payload?.bridge_evidence)
                  ? payload.bridge_evidence
                  : [];
              const result = await materializeCrossDomainBridgeArtifacts({
                projectRoot: resolvedProjectRoot,
                evidenceItems: evidenceItems.filter(
                  (entry): entry is Record<string, unknown> =>
                    Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
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
            case "set_file_audit_policy": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const hookPolicies = Array.isArray(params.fileAuditPolicies)
                ? params.fileAuditPolicies
                : params.fileAuditPolicy
                  ? [params.fileAuditPolicy]
                  : [];
              const result = await setFileAuditPolicyForProject({
                projectRoot: resolvedProjectRoot,
                hookPolicies,
                mode: readString(params.mode) === "replace" ? "replace" : "append",
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_file_audit_packet": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const hookId = readString(params.hookId);
              if (!hookId) {
                throw new Error("hookId is required for materialize_file_audit_packet.");
              }
              const policy = (await readWorkflowHooksPolicyForProject(
                resolvedProjectRoot
              )).auditHooks.find((entry) => entry.hookId === hookId);
              if (!policy) {
                throw new Error(`Unknown file audit hook: ${hookId}`);
              }
              const result = await materializeFileAuditPacket({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                policy,
                context: buildWorkflowHookPointContext({
                  projectRoot: resolvedProjectRoot,
                  projectId: snapshot.projectId,
                  stage: snapshot.currentStage,
                  hookPoint:
                    (readString(params.hookPoint) as typeof policy.hookPoint | null) ??
                    policy.hookPoint,
                  ownerRole: snapshot.ownerAgent ?? snapshot.role,
                  actorRole: snapshot.role,
                }),
                roundNumber: 1,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "set_survey_review": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setSurveyReviewState({
                projectRoot: resolvedProjectRoot,
                surveyReview: requireObject(params.surveyReview, "surveyReview"),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "recover_survey_route":
            case "skip_experiment_stages_for_survey": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const manifestPath = path.join(resolvedProjectRoot, "PROJECT_MANIFEST.json");
              const manifest =
                (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
              const surveyIdentity = ensureSurveyWorkflowIdentity({
                ...manifest,
                workflow_line: "survey",
                paper_type: "survey",
              });
              const surveyReview = asObject(surveyIdentity.manifest.survey_review);
              const currentStage = readString(manifest.current_stage);
              const recoveredStage =
                resolveStageForWorkflowLine({
                  stage: currentStage ?? null,
                  manifest: surveyIdentity.manifest,
                }) ?? "survey_review";
              const recoveredOwner =
                recoveredStage === "write"
                  ? readString(manifest.owner_agent) ?? "academic_writer"
                  : recoveredStage === "submit"
                    ? readString(manifest.owner_agent) ?? "reviewer"
                    : "researcher";
              const nextManifest = {
                ...manifest,
                ...surveyIdentity.manifest,
                current_stage: recoveredStage,
                current_micro_stage:
                  recoveredStage === "survey_review"
                    ? readString(surveyReview?.current_phase) ?? "survey_route_recovery"
                    : readString(manifest.current_micro_stage) ?? recoveredStage,
                owner_agent: recoveredOwner,
                next_action:
                  recoveredStage === "survey_review"
                    ? "Materialize survey_review state, then produce survey taxonomy, coverage matrix, and outline before write."
                    : readString(manifest.next_action) ??
                      "Continue the current survey workflow stage.",
                blocking_reason: null,
                updated_at: new Date().toISOString(),
              };
              await writeJsonAtomicEnsured(manifestPath, nextManifest);
              return textResponse(
                JSON.stringify(
                  {
	                    recovered: true,
	                    action,
	                    stage: nextManifest.current_stage,
	                    workflowLine: (nextManifest as Record<string, unknown>).workflow_line,
	                    paperType: (nextManifest as Record<string, unknown>).paper_type,
	                  },
                  null,
                  2
                )
              );
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
            case "get_storyline_planner_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getStorylinePlannerStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_results_storyline_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getResultsStorylineStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_innovation_synthesis_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getInnovationSynthesisStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_title_abstract_intro_workbench_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getTitleAbstractIntroWorkbenchStateSummary({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(summary, null, 2));
            }
            case "get_story_gap_search_requisition": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const summary = await getStoryGapSearchRequisitionStateSummary({
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
            case "set_storyline_planner_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await setStorylinePlannerState({
                projectRoot: resolvedProjectRoot,
                storylinePlanner: requireObject(
                  params.storylinePlanner ?? {},
                  "storylinePlanner"
                ),
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_storyline_planner_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.storylinePlannerMaterialization) ??
                asObject(params.storylinePlanner) ??
                {};
              const result = await materializeStorylinePlannerState({
                projectRoot: resolvedProjectRoot,
                topic:
                  readString(payload.topic) ??
                  readString(payload.survey_topic) ??
                  null,
                configuredMode:
                  (readString(payload.configured_mode) ??
                    readString(payload.configuredMode) ??
                    null) as
                    | "heuristic"
                    | "reviewer_judged"
                    | "learned_shadow"
                    | "learned_primary"
                    | null,
                learnedModelPath:
                  readString(payload.learned_model_path) ??
                  readString(payload.learnedModelPath) ??
                  null,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_results_storyline_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.resultsStorylineMaterialization) ??
                asObject(params.resultsStoryline) ??
                {};
              const result = await materializeResultsStorylineState({
                projectRoot: resolvedProjectRoot,
                stage:
                  readString(payload.basis_stage) ??
                  readString(payload.basisStage) ??
                  snapshot.currentStage ??
                  null,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_title_abstract_intro_workbench_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.titleAbstractIntroWorkbenchMaterialization) ??
                asObject(params.titleAbstractIntroWorkbench) ??
                {};
              const result = await materializeTitleAbstractIntroWorkbenchState({
                projectRoot: resolvedProjectRoot,
                stage:
                  readString(payload.basis_stage) ??
                  readString(payload.basisStage) ??
                  snapshot.currentStage ??
                  null,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "materialize_innovation_synthesis_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.innovationSynthesisMaterialization) ??
                asObject(params.innovationSynthesis) ??
                {};
              const result = await materializeInnovationSynthesisState({
                projectRoot: resolvedProjectRoot,
                stage:
                  readString(payload.basis_stage) ??
                  readString(payload.basisStage) ??
                  snapshot.currentStage ??
                  null,
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
            case "materialize_writing_hook_policies": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.writingHookPolicyMaterialization) ??
                asObject(params.writingHookMaterialization);
              const basisStage =
                readString(payload?.basis_stage) ??
                readString(payload?.basisStage) ??
                snapshot.currentStage ??
                "write";
              const result = await materializeWritingHookPolicies({
                projectRoot: resolvedProjectRoot,
                stage: basisStage,
                paperMode:
                  readString(payload?.paperMode) === "conference" ||
                  readString(payload?.paper_mode) === "conference"
                    ? "conference"
                    : readString(payload?.paperMode) === "journal" ||
                        readString(payload?.paper_mode) === "journal"
                      ? "journal"
                      : readString(payload?.paperMode) === "survey" ||
                          readString(payload?.paper_mode) === "survey"
                        ? "survey"
                        : undefined,
                topTierVerdict:
                  readString(payload?.topTierVerdict) ??
                  readString(payload?.top_tier_verdict) ??
                  null,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_panel_discussion_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.panelDiscussionQuery) ??
                asObject(params.panelDiscussion) ??
                {};
              const discussionId =
                readString(payload.discussionId) ??
                readString(payload.discussion_id) ??
                readString(params.discussionId) ??
                readString(params.discussion_id);
              if (!discussionId) {
                throw new Error("panel discussion query requires discussionId");
              }
              const store = await readWorkflowPanelDiscussionStore(
                resolvedProjectRoot,
                discussionId
              );
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "materialize_panel_discussion_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload =
                asObject(params.panelDiscussionMaterialization) ??
                asObject(params.panelDiscussion) ??
                {};
              const result = await materializeWorkflowPanelDiscussionState({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId ?? null,
                policyLike: payload,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_revision_control_state":
            case "materialize_revision_control_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const payload = asObject(params.revisionControlMaterialization);
              const result = await materializeRevisionControlState({
                projectRoot: resolvedProjectRoot,
                stage:
                  readString(payload?.basis_stage) ??
                  readString(payload?.basisStage) ??
                  readString(params.stage) ??
                  snapshot.currentStage ??
                  "review",
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_execution_proof_state":
            case "materialize_execution_proof_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeExecutionProofState({
                projectRoot: resolvedProjectRoot,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "get_paragraph_logic_audit_state":
            case "materialize_paragraph_logic_audit_state": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const result = await materializeParagraphLogicAudit({
                projectRoot: resolvedProjectRoot,
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
            case "write_text_artifact": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const actorRole =
                normalizeWorkflowRole(snapshot.role) ??
                normalizeWorkflowRole(bindingRole) ??
                normalizeWorkflowRole(ctx.agentId);
              if (!actorRole) {
                throw new Error(
                  "Could not resolve a workflow role for write_text_artifact."
                );
              }
              const artifactPath =
                readString(params.artifactPath) ??
                readString(params.path) ??
                readString(params.filePath) ??
                readString(params.file_path);
              if (!artifactPath) {
                throw new Error("artifactPath is required for write_text_artifact.");
              }
              const content =
                typeof params.content === "string"
                  ? params.content
                  : typeof params.text === "string"
                    ? params.text
                    : typeof params.body === "string"
                      ? params.body
                      : "";
              const modeValue = readString(params.mode);
              const result = await writeWorkflowTextArtifact({
                projectRoot: resolvedProjectRoot,
                role: actorRole,
                artifactPath,
                content,
                mode: modeValue === "append" ? "append" : "replace",
                ensureTrailingNewline:
                  typeof params.ensureTrailingNewline === "boolean"
                    ? params.ensureTrailingNewline
                    : false,
              });
              const bibliographyWrite =
                /(^|\/)refs(?:\.calibrated)?\.bib$/i.test(artifactPath);
              const autoCitationVerification = bibliographyWrite
                ? await maybeAutoRefreshCitationVerification({
                    projectRoot: resolvedProjectRoot,
                    triggerAction: "write_text_artifact",
                    bibliographyPathOverride: artifactPath,
                  })
                : {
                    triggered: false,
                    skippedReason: null,
                  };
              return textResponse(
                JSON.stringify(
                  {
                    ...result,
                    autoCitationVerification,
                  },
                  null,
                  2
                )
              );
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
            case "run_citation_calibration": {
              const calibration = asObject(params.citationCalibration);
              const resolvedProjectRoot = resolveWorkflowProjectRootWithOverride({
                state,
                override:
                  readString(calibration?.projectRoot) ??
                  readString(calibration?.project_root) ??
                  readString(calibration?.projectPath) ??
                  readString(calibration?.project_path),
              });
              const result = await runCitationCalibration({
                projectRoot: resolvedProjectRoot,
                bibliographyPath:
                  readString(calibration?.bibliographyPath) ??
                  readString(calibration?.bibliography_path),
                outputBibPath:
                  readString(calibration?.outputBibPath) ??
                  readString(calibration?.output_bib_path),
                reportJsonPath:
                  readString(calibration?.reportJsonPath) ??
                  readString(calibration?.report_json_path),
                reportMarkdownPath:
                  readString(calibration?.reportMarkdownPath) ??
                  readString(calibration?.report_markdown_path),
                replaceArxiv:
                  calibration?.replaceArxiv === true ||
                  calibration?.replace_arxiv === true,
                syncVerificationReport:
                  calibration?.syncVerificationReport === false ||
                  calibration?.sync_verification_report === false
                    ? false
                    : true,
              });
              const verificationStatus =
                result.hallucinatedCount > 0 || result.suspiciousCount > 0
                  ? "needs_revision"
                  : "verified";
              const verification = await recordCitationVerification({
                projectRoot: resolvedProjectRoot,
                citationVerification: {
                  bibliography_path: result.outputBibPath,
                  verification_report_path:
                    result.verificationReportPath ?? "reviewer/CITATION_VERIFICATION.md",
                  verification_status: verificationStatus,
                  verified_citation_count: result.verifiedCount,
                  suspicious_citation_count: result.suspiciousCount,
                  hallucinated_citation_count: result.hallucinatedCount,
                  pending_reason:
                    verificationStatus === "verified"
                      ? "Citation calibration completed cleanly."
                      : "Citation calibration found suspicious or hallucinated entries.",
                },
              });
              return textResponse(
                JSON.stringify({ ...result, verification }, null, 2)
              );
            }
            case "capture_diagnostic_bundle": {
              const bundle = asObject(params.diagnosticBundle);
              const resolvedProjectRoot = resolveWorkflowProjectRootWithOverride({
                state,
                override:
                  readString(bundle?.projectRoot) ??
                  readString(bundle?.project_root) ??
                  readString(bundle?.projectPath) ??
                  readString(bundle?.project_path),
              });
              const result = await captureWorkflowDiagnosticBundle({
                projectRoot: resolvedProjectRoot,
                workflowPolicy,
                agentCtx: {
                  agentId: ctx.agentId,
                  workspaceDir: ctx.workspaceDir,
                  sessionKey: ctx.sessionKey,
                  sessionId: ctx.sessionId,
                  messageChannel: ctx.messageChannel,
                  channelKey: ctx.channelKey,
                },
                reason:
                  readString(bundle?.reason) ??
                  readString(bundle?.captureReason) ??
                  "workflow_runtime_capture",
                tailLines:
                  readNumber(bundle?.tailLines) ??
                  readNumber(bundle?.tail_lines) ??
                  200,
              });
              return textResponse(JSON.stringify(result, null, 2));
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
                  bindingPolicy: workflowPolicy,
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
                  bindingPolicy: workflowPolicy,
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
                  bindingPolicy: workflowPolicy,
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
            case "evaluate_experiment_search_decision": {
              const decisionParams = asObject(params.experimentSearchDecision);
              const resolvedProjectRoot = resolveWorkflowProjectRootWithOverride({
                state,
                override:
                  readString(decisionParams?.projectRoot) ??
                  readString(decisionParams?.project_root),
              });
              const result = await evaluateExperimentSearchDecisionForProject({
                projectRoot: resolvedProjectRoot,
                persist:
                  decisionParams?.persist === false ||
                  decisionParams?.write_back === false
                    ? false
                    : true,
              });
              return textResponse(JSON.stringify(result, null, 2));
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
            case "prepare_stage_handoff": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const actorRole = snapshot.role ?? ctx.agentId ?? null;
              if (!actorRole) {
                throw new Error("Current workflow role is required to prepare a stage handoff.");
              }
              const currentManifest =
                (await readJsonIfExists<Record<string, unknown>>(
                  path.join(resolvedProjectRoot, "PROJECT_MANIFEST.json")
                )) ?? null;
              const handoffPatch = asObject(params.handoff) ?? {};
              const explicitToRole = inferTargetRoleFromToolParams({
                agentId:
                  readString(handoffPatch.toRole) ??
                  readString(params.toAgent) ??
                  undefined,
              });
              const explicitStageAfter =
                readString(handoffPatch.stageAfter) ??
                readString(handoffPatch.stage_after);
              const autoIteratorResult =
                explicitToRole && explicitStageAfter
                  ? null
                  : await runWorkflowAutoIterator({
                      projectRoot: resolvedProjectRoot,
                      policy: workflowPolicy,
                      agentId: snapshot.role ?? ctx.agentId ?? undefined,
                      mode: "prepare-handoff",
                      queueMailbox: false,
                    });
              const stageAfter =
                explicitStageAfter ??
                autoIteratorResult?.stageAfter ??
                null;
              const toRole =
                explicitToRole ??
                (autoIteratorResult?.ownerAfter as DispatchableWorkflowRole | null) ??
                null;
              if (!stageAfter || !toRole) {
                throw new Error(
                  "prepare_stage_handoff requires a target stage and target role, either explicitly or from auto_iterator_tick."
                );
              }
              if (actorRole === toRole) {
                throw new Error(
                  `prepare_stage_handoff only applies to cross-owner transitions (current role: ${actorRole}).`
                );
              }
              const workflowLine =
                readString(handoffPatch.workflowLine) === "survey"
                  ? "survey"
                  : readString(handoffPatch.workflowLine) === "experiment"
                    ? "experiment"
                    : resolveWorkflowLineFromManifestRecord(currentManifest) ??
                      resolveSnapshotWorkflowLine(snapshot);
              const summary =
                readString(handoffPatch.summary) ??
                autoIteratorResult?.recommendedActions.find(
                  (action) => action.kind === "drive_stage" && action.owner === toRole
                )?.summary ??
                `Workflow handoff ${actorRole} -> ${toRole}.`;
              const command =
                readString(handoffPatch.command) ??
                autoIteratorResult?.recommendedActions.find(
                  (action) => action.kind === "drive_stage" && action.owner === toRole
                )?.command ??
                autoIteratorResult?.nextAction ??
                null;
              const acceptanceChecks = Array.isArray(handoffPatch.acceptanceChecks)
                ? handoffPatch.acceptanceChecks.filter(
                    (entry): entry is string =>
                      typeof entry === "string" && entry.trim().length > 0
                  )
                : buildStageHandoffAcceptanceChecks({
                    workflowLine,
                    stageAfter,
                  });
              const prepareGate = await evaluateWorkflowHandoffHooks({
                runtimeSubagent: workflowRuntime,
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                hookPoint: "before_prepare_handoff",
                stage: stageAfter,
                ownerBefore: actorRole,
                ownerAfter: toRole,
                requesterSessionKey: ctx.sessionKey,
                requesterChannel: ctx.messageChannel,
                transition: "prepare_stage_handoff",
              });
              if (!prepareGate.allowed) {
                throw new Error(
                  prepareGate.blockingReason ??
                    "Workflow hook gate blocked prepare_stage_handoff."
                );
              }
              const stageGate = await evaluateWorkflowHandoffHooks({
                runtimeSubagent: workflowRuntime,
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                hookPoint: "before_stage_handoff",
                stage: stageAfter,
                ownerBefore: actorRole,
                ownerAfter: toRole,
                requesterSessionKey: ctx.sessionKey,
                requesterChannel: ctx.messageChannel,
                transition: "prepare_stage_handoff",
              });
              if (!stageGate.allowed) {
                throw new Error(
                  stageGate.blockingReason ??
                    "Workflow hook gate blocked stage handoff preparation."
                );
              }
              const handoff = await createStageOwnerHandoffIntent({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                workflowLine,
                stageBefore:
                  readString(handoffPatch.stageBefore) ??
                  autoIteratorResult?.stageBefore ??
                  snapshot.currentStage,
                stageAfter,
                ownerBefore: actorRole,
                ownerAfter: toRole,
                fromSessionKey: ctx.sessionKey,
                sessionBindingKey: snapshot.channelProjectBindingKey,
                preferredSessionKeys: deriveWorkflowDispatchSessionCandidates({
                  requesterSessionKey:
                    readString(ctx.sessionKey) ?? `agent:${actorRole}:main`,
                  targetRole: toRole,
                }),
                executionId:
                  readString(handoffPatch.executionId) ??
                  autoIteratorResult?.pendingHandoffExecutionId ??
                  null,
                summary,
                acceptanceChecks,
                nextAction: command,
                resumeAction: command,
                blockingReason:
                  readString(handoffPatch.blockingReason) ??
                  autoIteratorResult?.blockingReason ??
                  null,
                missingStageSignals:
                  (autoIteratorResult?.missingStageSignals ?? []).slice(),
                manifestRevision:
                  autoIteratorResult?.pendingHandoffExecutionId ??
                  readString((snapshot as Record<string, unknown>).manifestUpdatedAt) ??
                  readString((snapshot as Record<string, unknown>).manifest_updated_at),
                hookGate: stageGate.hookGate ?? prepareGate.hookGate,
              });
              await syncPreparedWorkflowHandoffToManifest({
                projectRoot: resolvedProjectRoot,
                intent: handoff.intent,
              });
              const prepareBroadcast = await maybeBroadcastSimpleHandoffStatus({
                runtimeSubagent: plugin.api.runtime?.subagent,
                bindingPolicy: workflowPolicy,
                sessionKey: ctx.sessionKey,
                projectId: snapshot.projectId,
                projectRoot: resolvedProjectRoot,
                status: "handoff_ready",
                stage: stageAfter,
                intentId: handoff.intent.intentId,
                phase: "prepared",
                summary: `Handoff prepared: ${actorRole} -> ${toRole} for ${stageAfter}.`,
              });
              const shouldDispatch = handoffPatch.dispatch !== false;
              let deliveryResult = null;
              let dispatchBroadcast = null;
              if (shouldDispatch) {
                const delivery = buildWorkflowHandoffDeliveryRuntime({
                  plugin,
                  workflowPolicy,
                  agentCtx: ctx,
                  requesterRole: actorRole as DispatchableWorkflowRole,
                  targetRole: toRole,
                  projectRoot: resolvedProjectRoot,
                  projectId: snapshot.projectId,
                  stage: stageAfter,
                  summary,
                  command,
                  preferredSessionKeys: handoff.intent.preferredSessionKeys,
                  toSessionKey: handoff.intent.toSessionKey,
                  waitTimeoutMs: 5000,
                  retryOnTimeout: false,
                  enableSpawnFallback: true,
                  autoModeActive:
                    (autoIteratorResult?.effectiveAutoMode ?? workflowPolicy.autoMode ?? "off") !== "off",
                });
                deliveryResult = await deliverWorkflowHandoffIntent({
                  intent: handoff.intent,
                  bindingPolicy: workflowPolicy,
                  lobsterMode: workflowPolicy.lobsterHandoff?.enabled
                    ? "enabled"
                    : "disabled",
                  runtime: delivery.runtime,
                });
                if (deliveryResult?.intent) {
                  await syncPreparedWorkflowHandoffToManifest({
                    projectRoot: resolvedProjectRoot,
                    intent: deliveryResult.intent,
                  });
                  if (deliveryResult.delivered) {
                    dispatchBroadcast = await maybeBroadcastSimpleHandoffStatus({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      bindingPolicy: workflowPolicy,
                      sessionKey: ctx.sessionKey,
                      projectId: snapshot.projectId,
                      projectRoot: resolvedProjectRoot,
                      status: "handed_off",
                      stage: stageAfter,
                      intentId: deliveryResult.intent.intentId,
                      phase: "dispatched",
                      summary: `Handoff dispatched: ${actorRole} -> ${toRole} for ${stageAfter}.`,
                    });
                  }
                }
              }
              return textResponse(
                JSON.stringify(
                  {
                    intent: deliveryResult?.intent ?? handoff.intent,
                    created: handoff.created,
                    dispatched: deliveryResult?.delivered ?? false,
                    terminal: deliveryResult?.terminal ?? false,
                    prepareBroadcast,
                    dispatchBroadcast,
                  },
                  null,
                  2
                )
              );
            }
            case "get_handoff_intents": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowHandoffIntentStore(resolvedProjectRoot);
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "ack_handoff_intent": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const handoffIntentId = readString(params.handoffIntentId);
              const idempotencyKey = readString(params.messageId);
              if (!handoffIntentId && !idempotencyKey) {
                throw new Error("handoffIntentId or messageId/idempotencyKey is required.");
              }
              const handoffStore = await readWorkflowHandoffIntentStore(resolvedProjectRoot);
              const currentIntent =
                handoffStore.intents.find(
                  (entry) =>
                    (handoffIntentId && entry.intentId === handoffIntentId) ||
                    (idempotencyKey && entry.idempotencyKey === idempotencyKey)
                ) ?? null;
              if (!currentIntent) {
                throw new Error("handoff intent not found.");
              }
              const actorRole = snapshot.role ?? ctx.agentId ?? null;
              const canAck =
                actorRole === currentIntent.toRole ||
                actorRole === "researcher" ||
                actorRole === "admin" ||
                (ctx.sessionKey && ctx.sessionKey === currentIntent.toSessionKey);
              if (!canAck) {
                throw new Error(
                  `${actorRole ?? "unknown"} cannot acknowledge handoff for ${currentIntent.toRole}.`
                );
              }
              const intent = await transitionWorkflowHandoffIntent({
                projectRoot: resolvedProjectRoot,
                intentId: handoffIntentId,
                idempotencyKey,
                toStatus: "acknowledged",
                summary: `Handoff acknowledged by ${snapshot.role ?? ctx.agentId ?? "unknown"}.`,
              });
              const payload = asObject(intent?.payload) ?? {};
              const ackBroadcast = await maybeBroadcastSimpleHandoffStatus({
                runtimeSubagent: plugin.api.runtime?.subagent,
                bindingPolicy: workflowPolicy,
                sessionKey: ctx.sessionKey,
                projectId: snapshot.projectId,
                projectRoot: resolvedProjectRoot,
                status: "waiting",
                stage:
                  intent?.stageAfter ??
                  readString(payload.stageAfter) ??
                  intent?.stage ??
                  snapshot.currentStage,
                intentId: intent?.intentId ?? currentIntent.intentId,
                phase: "acknowledged",
                summary: `Handoff acknowledged by ${snapshot.role ?? ctx.agentId ?? "unknown"} for ${currentIntent.toRole}.`,
              });
              return textResponse(JSON.stringify({ ...intent, ackBroadcast }, null, 2));
            }
            case "claim_handoff_intent": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const handoffIntentId = readString(params.handoffIntentId);
              const idempotencyKey = readString(params.messageId);
              if (!handoffIntentId && !idempotencyKey) {
                throw new Error("handoffIntentId or messageId/idempotencyKey is required.");
              }
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for claim_handoff_intent.");
              }
              const handoffStore = await readWorkflowHandoffIntentStore(resolvedProjectRoot);
              const currentIntent =
                handoffStore.intents.find(
                  (entry) =>
                    (handoffIntentId && entry.intentId === handoffIntentId) ||
                    (idempotencyKey && entry.idempotencyKey === idempotencyKey)
                ) ?? null;
              if (!currentIntent) {
                throw new Error("handoff intent not found.");
              }
              const actorRole = snapshot.role ?? ctx.agentId ?? null;
              const canClaim =
                actorRole === currentIntent.toRole ||
                actorRole === "researcher" ||
                actorRole === "admin" ||
                ctx.sessionKey === currentIntent.toSessionKey;
              if (!canClaim) {
                throw new Error(
                  `${actorRole ?? "unknown"} cannot claim handoff for ${currentIntent.toRole}.`
                );
              }
              let claimedTask = null;
              if (currentIntent.targetTaskId) {
                claimedTask = await claimWorkflowTask({
                  projectRoot: resolvedProjectRoot,
                  taskId: currentIntent.targetTaskId,
                  sessionKey: ctx.sessionKey,
                  role: actorRole,
                });
                if (!claimedTask.claimed) {
                  throw new Error(
                    `Could not claim target task ${currentIntent.targetTaskId}: ${claimedTask.reason}`
                  );
                }
              }
              const leaseMs = Math.max(
                60_000,
                Math.floor((readNumber(params.waitSeconds) ?? 900) * 1000)
              );
              const intent = await claimAndActivateWorkflowHandoffForAgent({
                projectRoot: resolvedProjectRoot,
                role: currentIntent.toRole,
                sessionKey: ctx.sessionKey,
                claimLeaseMs: leaseMs,
                intentId: currentIntent.intentId,
                idempotencyKey: currentIntent.idempotencyKey,
                beforeActivateHook: async ({ intent, stageAfter }) => {
                  const hookSummary = await runWorkflowHookPointGate({
                    runtimeSubagent: workflowRuntime,
                    projectRoot: resolvedProjectRoot,
                    projectId: snapshot.projectId,
                    stage: stageAfter,
                    hookPoint: "before_handoff_activation",
                    ownerRole: currentIntent.toRole,
                    actorRole: snapshot.role,
                    requesterSessionKey: ctx.sessionKey,
                    requesterChannel: ctx.messageChannel,
                    handoffIntentId: intent.intentId,
                    targetStage: stageAfter,
                    transition: "handoff_activation",
                  });
                  return {
                    allow: hookSummary.aggregateVerdict === "pass",
                    blockingReason: hookSummary.blockingReason,
                  };
                },
                afterActivateHook: async ({ intent, stageAfter }) => {
                  await runWorkflowHookPointGate({
                    runtimeSubagent: workflowRuntime,
                    projectRoot: resolvedProjectRoot,
                    projectId: snapshot.projectId,
                    stage: stageAfter,
                    hookPoint: "after_handoff_activation",
                    ownerRole: currentIntent.toRole,
                    actorRole: snapshot.role,
                    requesterSessionKey: ctx.sessionKey,
                    requesterChannel: ctx.messageChannel,
                    handoffIntentId: intent.intentId,
                    targetStage: stageAfter,
                    transition: "handoff_activation",
                  });
                },
              });
              const activatedIntent = intent.intent;
              const activatedPayload = asObject(activatedIntent?.payload) ?? {};
              const activationBroadcast =
                activatedIntent && intent.activated
                  ? await maybeBroadcastSimpleHandoffStatus({
                      runtimeSubagent: plugin.api.runtime?.subagent,
                      bindingPolicy: workflowPolicy,
                      sessionKey: ctx.sessionKey,
                      projectId: snapshot.projectId,
                      projectRoot: resolvedProjectRoot,
                      status: "continued",
                      stage:
                        activatedIntent.stageAfter ??
                        readString(activatedPayload.stageAfter) ??
                        activatedIntent.stage ??
                        snapshot.currentStage,
                      intentId: activatedIntent.intentId,
                      phase: "activated",
                      summary: `Handoff activated: ${activatedIntent.toRole} is now active for ${activatedIntent.stageAfter ?? readString(activatedPayload.stageAfter) ?? activatedIntent.stage ?? snapshot.currentStage ?? "the current stage"}.`,
                    })
                  : null;
              return textResponse(
                JSON.stringify({ ...intent, claimedTask, activationBroadcast }, null, 2)
              );
            }
            case "fail_handoff_intent": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const handoffIntentId = readString(params.handoffIntentId);
              const failure = asObject(params.failure);
              const failureReason =
                readString(failure?.failureReason) ??
                readString(failure?.reason) ??
                readString(params.completionNote) ??
                "Handoff execution failed.";
              const failureKind =
                readString(failure?.failureKind) === "tool_unavailable"
                  ? "tool_unavailable"
                  : readString(failure?.failureKind) === "runtime_unavailable"
                    ? "runtime_unavailable"
                    : readString(failure?.failureKind) === "stale_claim"
                      ? "stale_claim"
                      : "verification_failed";
              const routed = await routeWorkflowFailure({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                workflowLine: resolveSnapshotWorkflowLine(snapshot),
                stage: snapshot.currentStage,
                sourceIntentId: handoffIntentId,
                originalOwner: snapshot.role,
                failureKind,
                failureReason,
                verificationRule: readString(failure?.verificationRule),
              });
              if (handoffIntentId) {
                await transitionWorkflowHandoffIntent({
                  projectRoot: resolvedProjectRoot,
                  intentId: handoffIntentId,
                  toStatus: "failed",
                  summary: failureReason,
                });
              }
              const failureBroadcast = await maybeBroadcastSimpleHandoffStatus({
                runtimeSubagent: plugin.api.runtime?.subagent,
                bindingPolicy: workflowPolicy,
                sessionKey: ctx.sessionKey,
                projectId: snapshot.projectId,
                projectRoot: resolvedProjectRoot,
                status: "blocked",
                stage: snapshot.currentStage,
                intentId: handoffIntentId,
                phase: "failed",
                summary: `Handoff failed: ${failureReason}`,
              });
              return textResponse(
                JSON.stringify({ ...routed, failureBroadcast }, null, 2)
              );
            }
            case "get_artifact_receipts": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowArtifactReceiptStore(resolvedProjectRoot);
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "get_repair_queue": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowRepairQueueStore(resolvedProjectRoot);
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "get_agent_capabilities": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const store = await readWorkflowAgentCapabilityStore(resolvedProjectRoot);
              return textResponse(JSON.stringify(store, null, 2));
            }
            case "claim_write_scope": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const writeScope = asObject(params.writeScope);
              if (!ctx.sessionKey) {
                throw new Error("sessionKey is required for claim_write_scope.");
              }
              const result = await claimWorkflowWriteScope({
                projectRoot: resolvedProjectRoot,
                projectId: snapshot.projectId,
                taskId: readString(params.taskId),
                sessionKey: ctx.sessionKey,
                role: snapshot.role,
                ownedDirs: Array.isArray(writeScope?.ownedDirs)
                  ? writeScope.ownedDirs.filter((entry): entry is string => typeof entry === "string")
                  : [],
                exclusiveFiles: Array.isArray(writeScope?.exclusiveFiles)
                  ? writeScope.exclusiveFiles.filter((entry): entry is string => typeof entry === "string")
                  : [],
                mode:
                  writeScope?.mode === "append_only" ||
                  writeScope?.mode === "exclusive_write" ||
                  writeScope?.mode === "read_only"
                    ? writeScope.mode
                    : "read_only",
                leaseTtlMs: readNumber(writeScope?.leaseTtlMs) ?? undefined,
                override: writeScope?.override === true,
              });
              return textResponse(JSON.stringify(result, null, 2));
            }
            case "release_stale_write_scopes": {
              const resolvedProjectRoot = requireWorkflowProjectRoot(state);
              const released = await releaseStaleWorkflowWriteScopes({
                projectRoot: resolvedProjectRoot,
              });
              const store = await readWorkflowWriteScopeStore(resolvedProjectRoot);
              return textResponse(JSON.stringify({ released, store }, null, 2));
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
            actionFailed = true;
            await traceAction("failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            if (genericInboundBudget) {
              await recordWorkflowInboundTurnCompleted({
                context: genericInboundBudget,
                status: actionFailed
                  ? "failed"
                  : genericInboundBudget.isExhausted()
                    ? "deferred"
                    : "completed_inline",
              }).catch(() => null);
            }
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
