import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  asRecord,
  asString,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { pathExists, readJsonIfExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  deriveGraphBuildMicroStage,
  normalizePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import {
  normalizeExperimentReviewState,
  serializeExperimentReviewState,
} from "../workflow-guard-state/experiment-review";
import { serializeAutoDispatchDiagnosticsState } from "../workflow-guard-state/auto-dispatch-diagnostics";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import {
  deriveIdeaCatalystMicroStage,
} from "../idea-catalyst/workflow-bridge";
import {
  deriveWorkflowGraphContext,
  shouldRefreshWorkflowGraphPresence,
} from "../workflow-kernel/graph-context";
import { DEFAULT_PAPERNEXUS_GRAPH_BUILD_RECEIPT_PATH } from "../papernexus-graph-build-receipt";
import { readPapernexusSyncState } from "../papernexus-sync-state";
import { summarizeEvidenceCloseoutState } from "../workflow-evidence/closeout-summary";
import {
  reconcileWorkflowControl,
} from "../workflow-control-reconciler";
import {
  advanceLiteratureDiscoveryRequisition,
  type LiteratureDiscoveryRequisitionAdvanceResult,
} from "../literature-discovery/requisition-executor";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import {
  buildWorkflowAutoModeRiskFingerprint,
  type WorkflowAutoModeRiskLevel,
} from "../workflow-auto-mode";
import {
  getWorkflowTaskGraphPath,
  materializeWorkflowTaskGraph,
  readWorkflowTaskGraphStore,
  summarizeWorkflowTaskGraphStore,
} from "../workflow-team/task-graph";
import { buildWorkflowStageTaskPreview } from "../workflow-team/stage-profiles";
import { materializeWorkflowTeamRound } from "../workflow-team/team-round";
import { maybePrepareWorkflowStageContracts } from "./stage-preflight";
import { createStageOwnerHandoffIntent } from "../workflow-handoff/handoff-router";
import { transitionWorkflowHandoffIntent } from "../workflow-handoff/handoff-store";
import { runWorkflowHandoffMaintenancePass } from "../workflow-handoff/maintenance";
import { appendWorkflowDiagnosticEvent } from "../workflow-diagnostics.js";
import type { GraphPresenceCheckResult } from "../graph-presence";
import type { GraphBuildSourceCatchupResult } from "../graph-build-source-catchup";
import type {
  AutoIteratorAction,
  AutoIteratorResult,
  WorkflowGuardPolicy,
} from "../workflow-guard.js";

type ManifestLike = Record<string, unknown>;
type TrackRegistryLike = Record<string, unknown>;
type ExperimentLedgerLike = Record<string, unknown> & {
  summary?: Record<string, unknown> | null;
};
type GateStateLike = {
  currentStage: string | null;
  lastGate: string | null;
  gateStatus: string | null;
  gateTimestamp: string | null;
  defaultActionExecutedAt: string | null;
  revisionCount: number | null;
  [key: string]: unknown;
};

type AutoModeRiskEvaluationLike = {
  riskLevel: string;
  reasons: string[];
  riskFingerprint: string | null;
};

type AutoModeDiscussionStoreLike = {
  currentRound?: {
    packetFingerprint?: string | null;
    packetJsonPath?: string | null;
    stage?: string | null;
    riskLevel?: string | null;
    status?: string | null;
  } | null;
  roundsStartedByFingerprint?: Record<string, number>;
} | null;

type EffectiveAutoModeLike = {
  configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
  effectiveMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
  riskLevel: string;
  reasons: string[];
  riskFingerprint: string | null;
  mitigationStatus: string | null;
  mitigationRoundsStarted: number;
  mitigationRoundsRemaining: number;
};

type GateEvaluationLike = {
  blocking: boolean;
  reason: string | null;
  timedDefaultTriggered: boolean;
};

function normalizeAutoModeRiskLevel(
  value: unknown
): WorkflowAutoModeRiskLevel | null {
  const riskLevel = normalizeStage(value);
  return riskLevel === "stable" || riskLevel === "caution" || riskLevel === "severe"
    ? riskLevel
    : null;
}

function collectStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && Boolean(entry.trim())
  );
}

async function isSemanticallyEquivalentAutoModeDiscussionRound(params: {
  projectRoot: string;
  round: NonNullable<NonNullable<AutoModeDiscussionStoreLike>["currentRound"]>;
  riskEvaluation: AutoModeRiskEvaluationLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.riskEvaluation.riskFingerprint) {
    return false;
  }
  const packetJsonPath = asString(params.round.packetJsonPath);
  if (packetJsonPath) {
    const resolvedPacketPath = path.isAbsolute(packetJsonPath)
      ? packetJsonPath
      : resolveProjectArtifactPath(params.projectRoot, packetJsonPath) ??
        path.resolve(params.projectRoot, packetJsonPath);
    const packet = asRecord(
      await readJsonIfExists<Record<string, unknown>>(resolvedPacketPath)
    );
    const packetRiskLevel = packet
      ? normalizeAutoModeRiskLevel(packet.riskLevel)
      : null;
    if (packet && packetRiskLevel) {
      const packetFingerprint = buildWorkflowAutoModeRiskFingerprint({
        stage: asString(packet.stage) ?? params.stage,
        riskLevel: packetRiskLevel,
        reasons: collectStringArray(packet.riskReasons),
        missingStageSignals: collectStringArray(packet.missingStageSignals),
      });
      if (packetFingerprint === params.riskEvaluation.riskFingerprint) {
        return true;
      }
    }
  }

  const roundRiskLevel = normalizeAutoModeRiskLevel(params.round.riskLevel);
  return (
    normalizeStage(params.round.stage) === normalizeStage(params.stage) &&
    roundRiskLevel === params.riskEvaluation.riskLevel &&
    params.round.status === "resolved"
  );
}

function hasOutstandingGraphBuildIngestionWork(
  manifest: ManifestLike | null | undefined
): boolean {
  const state = normalizePaperIngestionState(manifest?.paper_ingestion);
  const graphPresenceStatus = normalizeStage(
    asRecord(manifest?.paper_ingestion)?.graph_presence_status ??
      asRecord(manifest?.paper_ingestion)?.graphPresenceStatus
  );
  if (graphPresenceStatus === "ready") {
    return false;
  }
  if (state.repairRequired || state.reconcileRequired) {
    return true;
  }
  if (
    ["waiting_import", "reconciling", "blocked"].includes(
      normalizeStage(state.runtimeStatus) ?? ""
    )
  ) {
    return true;
  }
  if (
    state.queuedRequests.some((request) =>
      ["queued", "launching", "running", "needs_repair"].includes(request.status)
    )
  ) {
    return true;
  }
  if (
    state.activeBatches.some((batch) =>
      ["queued", "running"].includes(normalizeStage(batch.status) ?? "")
    )
  ) {
    return true;
  }
  return state.paperOperations.some((operation) =>
    ["queued", "running"].includes(normalizeStage(operation.status) ?? "")
  );
}

function paperIngestionRequestUsesStrictRemotePapernexus(
  request: ReturnType<typeof normalizePaperIngestionState>["queuedRequests"][number]
): boolean {
  const wrapper = request.wrapper ?? "";
  const lastSessionKey = request.lastSessionKey ?? "";
  return (
    wrapper === "papernexus_remote_mcp" ||
    /papernexus:remote_mcp:/i.test(lastSessionKey)
  );
}

function manifestUsesStrictRemotePapernexus(
  manifest: ManifestLike | null | undefined,
  state: ReturnType<typeof normalizePaperIngestionState>
): boolean {
  const paperIngestion = asRecord(manifest?.paper_ingestion);
  const accessMode = normalizeStage(
    pickString(manifest ?? {}, ["papernexusAccessMode", "papernexus_access_mode"]) ??
      pickString(paperIngestion ?? {}, [
        "papernexusAccessMode",
        "papernexus_access_mode",
      ])
  );
  if (accessMode === "remote_mcp") {
    return true;
  }
  if (accessMode === "local_mcp") {
    return false;
  }
  return state.queuedRequests.some(paperIngestionRequestUsesStrictRemotePapernexus);
}

function isVerifiedSourceBackedGraphBuildReceipt(
  receipt: Record<string, unknown> | null | undefined
): boolean {
  if (!receipt) {
    return false;
  }
  const receiptStatus = normalizeStage(receipt.status);
  const graphVisibility = normalizeStage(
    receipt.graph_visibility ?? receipt.graphVisibility
  );
  const coverage = asRecord(receipt.coverage);
  const sourceBackedCount =
    pickNumber(receipt, ["source_backed_count", "sourceBackedCount"]) ?? 0;
  return (
    (receiptStatus === "graph_ready" || receiptStatus === "evidence_ready") &&
    graphVisibility === "verified" &&
    (receipt.source_backed_graph_claim === true ||
      receipt.sourceBackedGraphClaim === true) &&
    (coverage?.min_required_satisfied === true ||
      coverage?.minRequiredSatisfied === true) &&
    sourceBackedCount > 0
  );
}

async function hasVerifiedSourceBackedGraphBuildReceipt(
  projectRoot: string
): Promise<boolean> {
  const receipt = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, DEFAULT_PAPERNEXUS_GRAPH_BUILD_RECEIPT_PATH)
  );
  return isVerifiedSourceBackedGraphBuildReceipt(receipt);
}

type MailboxQueueResultLike = {
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
};

type ProjectsStateLike = {
  projects?: unknown[];
};

const AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS = 15_000;
const TRANSITION_BOOTSTRAP_PREP_STAGES = new Set([
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
type StagePreflightResult = Awaited<ReturnType<typeof maybePrepareWorkflowStageContracts>>;

function buildAutoIteratorStageHandoffAcceptanceChecks(params: {
  workflowLine: "experiment" | "survey";
  stageAfter: string | null | undefined;
}): string[] {
  const stageAfter = normalizeStage(params.stageAfter);
  if (params.workflowLine === "survey") {
    if (stageAfter === "write") {
      return [
        "researcher/SURVEY_QUERY_REGISTRY.json exists",
        "researcher/INCLUDED_PAPERS.json exists",
        "researcher/EXCLUDED_PAPERS.json exists",
        "researcher/SOTA_MATRIX.md exists",
        "researcher/GAP_SYNTHESIS.md exists",
        "researcher/SURVEY_BRIEF.md exists",
      ];
    }
    if (stageAfter === "submit") {
      return [
        "academic_writer/paper/main.tex exists",
        "academic_writer/WRITING_SIGNALS.md exists",
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
      ];
    case "experiment":
      return [
        "coder/EXPERIMENT_INDEX.md exists",
      ];
    case "analyze":
      return [
        "researcher/EXPERIMENT_LEDGER.json is updated",
      ];
    case "write":
      return [
        "analyzer/CLAIM_EVIDENCE_MATRIX.md exists",
        "analyzer/TRACK_VERDICTS.md exists",
        "analyzer/QUALITY_AUDIT.md exists",
      ];
    case "review":
      return [
        "academic_writer/paper/main.tex exists",
      ];
    case "submit":
      return [
        "reviewer/REVIEW_REPORT.md exists",
      ];
    default:
      return [];
  }
}

function mergeStagePreflightResults(results: StagePreflightResult[]): StagePreflightResult {
  const mergedContracts: string[] = [];
  const seenContracts = new Set<string>();
  const materializedArtifacts: StagePreflightResult["materializedArtifacts"] = [];
  const emittedHookEvents: StagePreflightResult["emittedHookEvents"] = [];
  const errors: StagePreflightResult["errors"] = [];
  let manifest: ManifestLike = {};
  for (const result of results) {
    manifest = result.manifest;
    for (const contract of result.materializedContracts) {
      if (seenContracts.has(contract)) {
        continue;
      }
      seenContracts.add(contract);
      mergedContracts.push(contract);
    }
    materializedArtifacts.push(...result.materializedArtifacts);
    emittedHookEvents.push(...result.emittedHookEvents);
    errors.push(...result.errors);
  }
  return {
    manifest,
    materializedContracts: mergedContracts,
    materializedArtifacts,
    emittedHookEvents,
    errors,
  };
}

function shouldBootstrapTransitionStage(params: {
  stageBefore: string | null;
  stageAfter: string | null;
}): boolean {
  const stageBefore = normalizeStage(params.stageBefore);
  const stageAfter = normalizeStage(params.stageAfter);
  return Boolean(
    stageAfter &&
      stageAfter !== stageBefore &&
      TRANSITION_BOOTSTRAP_PREP_STAGES.has(stageAfter)
  );
}

function buildCanonicalStageSignals(params: {
  stage: string | null;
  completionStatus: string | null | undefined;
  blockingReason: string | null | undefined;
  missingSignals?: string[] | null;
}): string[] {
  if (params.missingSignals && params.missingSignals.length > 0) {
    return params.missingSignals;
  }
  if (
    params.stage === "experiment" &&
    canonicalExperimentDecisionFromBlocker({
      stageBefore: "experiment",
      stageAfter: params.stage,
      blockingReason: params.blockingReason,
    })
  ) {
    return [];
  }
  if (params.blockingReason) {
    return [params.blockingReason];
  }
  if (
    params.completionStatus &&
    params.completionStatus !== "complete" &&
    params.completionStatus !== "blocked" &&
    params.completionStatus !== "failed"
  ) {
    return [`${params.stage ?? "workflow"}_completion_incomplete`];
  }
  return [];
}

const WRITE_PACKAGE_READY_STATUSES = new Set(["ready", "assembled", "approved"]);
const DEFAULT_WRITE_PACKAGE_MANIFEST_PATH = "academic_writer/WRITE_PACKAGE.json";
const DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH =
  "academic_writer/WRITE_PACKAGE_ASSEMBLY_REPORT.json";
const DEFAULT_CITATION_CANDIDATES_PATH =
  "academic_writer/CITATION_CANDIDATES.json";

async function projectArtifactExists(
  projectRoot: string,
  relativePath: string | null
): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, relativePath);
  return resolved ? pathExists(resolved) : false;
}

async function writePackageNeedsAutoAssembly(params: {
  projectRoot: string;
  state: Record<string, unknown>;
}): Promise<boolean> {
  const status = normalizeStage(pickString(params.state, ["status"]));
  if (!status || !WRITE_PACKAGE_READY_STATUSES.has(status)) {
    return true;
  }

  const sourceArtifactCount =
    pickNumber(params.state, ["sourceArtifactCount", "source_artifact_count"]) ?? 0;
  const derivedArtifactCount =
    pickNumber(params.state, ["derivedArtifactCount", "derived_artifact_count"]) ?? 0;
  if (sourceArtifactCount <= 0 || derivedArtifactCount <= 0) {
    return true;
  }

  const durableArtifactPaths = [
    pickString(params.state, [
      "citationCandidatesPath",
      "citation_candidates_path",
    ]) ?? DEFAULT_CITATION_CANDIDATES_PATH,
    pickString(params.state, [
      "packageManifestPath",
      "package_manifest_path",
    ]) ?? DEFAULT_WRITE_PACKAGE_MANIFEST_PATH,
    pickString(params.state, [
      "assemblyReportPath",
      "assembly_report_path",
    ]) ?? DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH,
  ];
  for (const artifactPath of durableArtifactPaths) {
    if (!(await projectArtifactExists(params.projectRoot, artifactPath))) {
      return true;
    }
  }
  return false;
}

function stageFromCanonicalNextAction(action: string | null | undefined): string | null {
  const normalized = String(action ?? "").trim().toLowerCase();
  switch (normalized) {
    case "/frontier-map":
      return "frontier_mapping";
    case "/idea-catalyst":
      return "idea";
    case "/plan-phase":
    case "/plan-experiment":
      return "plan";
    case "/run-experiment":
      return "code";
    case "/monitor-experiment":
      return "experiment";
    case "/analyze-results":
      return "analyze";
    case "/review-paper":
      return "review";
    case "/write-paper":
      return "write";
    case "/submit-ready":
      return "submit";
    case "/done":
      return "done";
    default:
      return null;
  }
}

export function selectDispatchableAutoStageAction(params: {
  autoIteratorResult: Pick<
    AutoIteratorResult,
    | "gateBlocking"
    | "missingStageSignals"
    | "pendingHandoff"
    | "pendingHandoffPhase"
    | "recommendedActions"
  >;
  owner?: AutoIteratorAction["owner"] | null;
}): AutoIteratorAction | null {
  if (params.autoIteratorResult.gateBlocking) {
    return null;
  }
  const allowPreparedOwnerHandoff =
    params.autoIteratorResult.pendingHandoff === true &&
    params.autoIteratorResult.pendingHandoffPhase === "prepared";
  const action =
    params.autoIteratorResult.recommendedActions.find(
      (entry) =>
        entry.kind === "drive_stage" &&
        entry.owner &&
        entry.command &&
        entry.blocking !== true &&
        (params.owner == null || entry.owner === params.owner)
    ) ?? null;
  if (!action) {
    return null;
  }
  if (
    (params.autoIteratorResult.missingStageSignals ?? []).length > 0 &&
    !allowPreparedOwnerHandoff &&
    action.dispatchDespiteMissingSignals !== true
  ) {
    return null;
  }
  return action;
}

const SELF_DRIVEN_RESEARCHER_STAGES = new Set([
  "graph_build",
  "frontier_mapping",
  "idea",
]);

function canDispatchOwnerStageWithMissingSignals(params: {
  stage: string | null;
  owner: AutoIteratorAction["owner"] | null;
  previousOwner: AutoIteratorAction["owner"] | null;
  missingStageSignals: string[];
  stageRepairCommand: string | null;
}): boolean {
  if (!params.stage || params.missingStageSignals.length === 0) {
    return false;
  }
  if (params.stageRepairCommand != null) {
    return false;
  }
  if (
    params.stage === "write" &&
    params.owner === "academic_writer" &&
    params.previousOwner === "academic_writer"
  ) {
    return true;
  }
  if (params.stage === "experiment" && params.owner === "coder") {
    return true;
  }
  if (params.owner !== "researcher") {
    return false;
  }
  if (params.previousOwner != null && params.previousOwner !== params.owner) {
    return false;
  }
  return SELF_DRIVEN_RESEARCHER_STAGES.has(params.stage);
}

function canonicalExperimentDecisionFromBlocker(params: {
  stageBefore: string | null;
  stageAfter: string | null;
  blockingReason: unknown;
}): string | null {
  if (params.stageBefore !== "experiment") {
    return null;
  }
  const blocker = normalizeStage(params.blockingReason);
  if (blocker === "experiment_repair_implementation") {
    return "repair_implementation";
  }
  if (
    blocker === "launch_pending" ||
    blocker === "continue_tuning" ||
    blocker === "require_multi_seed" ||
    blocker === "reconcile_runtime" ||
    blocker === "rollback_to_plan" ||
    blocker === "rollback_to_idea"
  ) {
    return blocker;
  }
  if (params.stageAfter === "plan") {
    return "rollback_to_plan";
  }
  if (params.stageAfter === "idea") {
    return "rollback_to_idea";
  }
  return null;
}

type AutoIteratorDeps = {
  normalizePolicy: (value: Record<string, unknown> | undefined) => WorkflowGuardPolicy;
  loadExperimentLedgerIfExists: (
    projectRoot: string
  ) => Promise<ExperimentLedgerLike | null>;
  readGateState: (projectRoot: string) => Promise<GateStateLike>;
  normalizeRole: (value: unknown) => AutoIteratorAction["owner"];
  inferProjectId: (
    projectRoot: string | null,
    manifest: Record<string, unknown> | null
  ) => string | null;
  normalizeWritePackageState: (value: unknown) => Record<string, unknown>;
  assembleWritePackage: (params: {
    projectRoot: string;
    mode: string;
    trigger: string;
    agentId?: string | null;
  }) => Promise<unknown>;
  checkGraphPresenceForWorkflow: (params: {
    projectRoot: string;
    updateManifest: boolean;
    sharedCorpus?: string | null;
    remoteAccess: {
      apiBaseUrl?: string;
      mcpUrl?: string;
      mcpTransport?: string;
      mcpTimeoutMs?: number;
      tokenSource?: string;
      tokenEnv?: string;
      tokenService?: string;
      tokenAccount?: string;
      mineruHttpUrl?: string;
      tokenLookupTimeoutMs?: number;
    };
  }) => Promise<GraphPresenceCheckResult>;
  materializeGraphBuildPaperSources?: (params: {
    projectRoot: string;
    projectId?: string | null;
    workflowPolicy?: {
      papernexusSharedCorpus?: string | null;
      papernexusMcpUrl?: string | null;
      papernexusApiBaseUrl?: string | null;
    } | null;
    now?: string;
  }) => Promise<GraphBuildSourceCatchupResult>;
  advanceLiteratureDiscoveryRequisition?: (params: {
    projectRoot: string;
    projectId?: string | null;
    workflowPolicy?: WorkflowGuardPolicy | null;
    now?: string;
  }) => Promise<LiteratureDiscoveryRequisitionAdvanceResult>;
  getPreviousStagesForRegression: (params: {
    currentStage: string | null;
    manifest: ManifestLike;
  }) => string[];
  getMissingStageSignals: (params: {
    projectRoot: string;
    manifest: ManifestLike;
    trackRegistry: TrackRegistryLike | null;
    experimentLedger: ExperimentLedgerLike | null;
    currentStage: string | null;
    includeOrchestrationValidation?: boolean;
  }) => Promise<string[]>;
  evaluateWorkflowAutoModeRisk: (params: {
    configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    stage: string | null;
    regressed: boolean;
    revisionCount: number | null;
    missingStageSignals: string[];
    manifest: ManifestLike;
  }) => AutoModeRiskEvaluationLike;
  readAutoModeDiscussionStore: (
    projectRoot: string
  ) => Promise<AutoModeDiscussionStoreLike>;
  resolveEffectiveWorkflowAutoMode: (params: {
    configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    riskEvaluation: AutoModeRiskEvaluationLike;
    mitigationStatus: string | null;
    mitigationRoundsStarted: number;
    mitigationMaxRounds: number;
  }) => EffectiveAutoModeLike;
  evaluateGateBlocking: (params: {
    projectRoot: string;
    gateState: GateStateLike;
    stage: string | null;
    hasStageWorkRemaining: boolean;
    effectiveAutoMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    autoGate: NonNullable<WorkflowGuardPolicy["autoGate"]>;
    now: string;
  }) => Promise<GateEvaluationLike>;
  isSurveyWorkflow: (manifest: ManifestLike | null) => boolean;
  ensureSurveyWorkflowIdentity?: (manifest: ManifestLike | null) => {
    manifest: ManifestLike;
    updated: boolean;
  };
  resolveStageForWorkflowLine: (params: {
    stage: string | null;
    manifest: ManifestLike | null;
  }) => string | null;
  resolveNextStageForWorkflow: (params: {
    stage: string | null;
    manifest: ManifestLike | null;
  }) => string | null;
  STAGE_REQUIREMENTS: Record<string, { nextStage?: string | null }>;
  stageOwner: (stage: string | null) => AutoIteratorAction["owner"];
  loadExperimentSearchState?: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<Record<string, unknown>>;
  normalizeExperimentSearchState: (value: unknown) => Record<string, unknown>;
  normalizeAutonomousExecutionState: (
    value: unknown
  ) => {
    experimentLaunchMode: "manual" | "reviewed_auto";
    maxExperimentReviewRounds: number;
    requireAnalyzerReview: boolean;
    requireCrossReview: boolean;
  };
  loadExperimentReviewState: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<Record<string, unknown>>;
  isReviewedAutoExperimentLaunchEnabled: (value: unknown) => boolean;
  resolveExperimentReviewNextOwner: (params: {
    state: Record<string, unknown>;
    autonomousExecution: {
      experimentLaunchMode: "manual" | "reviewed_auto";
      maxExperimentReviewRounds: number;
      requireAnalyzerReview: boolean;
      requireCrossReview: boolean;
    };
    hasActiveRuns: boolean;
    readyForAnalysis: boolean;
  }) => AutoIteratorAction["owner"] | null;
  deriveExperimentReviewMicroStage: (params: {
    state: Record<string, unknown>;
    autonomousExecution: {
      experimentLaunchMode: "manual" | "reviewed_auto";
      maxExperimentReviewRounds: number;
      requireAnalyzerReview: boolean;
      requireCrossReview: boolean;
    };
    hasActiveRuns: boolean;
    readyForAnalysis: boolean;
  }) => string | null;
  buildExperimentReviewCommand: (params: {
    owner: AutoIteratorAction["owner"] | null;
    state: Record<string, unknown>;
  }) => string | null;
  hasActiveExperimentRuns: (ledger: ExperimentLedgerLike | null) => boolean;
  hasFinishedExperimentWorkAwaitingReconciliation: (params: {
    ledger: ExperimentLedgerLike | null;
    experimentSearch: Record<string, unknown>;
  }) => boolean;
  evaluateExperimentSearchDecision: (params: {
    experimentSearch: unknown;
    experimentSearchSpec?: unknown;
    experimentLedger?: unknown;
    gpuMonitor?: unknown;
    experimentReviewState?: unknown;
    experimentMemory?: unknown;
  }) => {
    decision: string;
    rationale: string;
    recommendedNextAction: string;
    validationStage: string;
    decisionConfidence: string;
    baselineFairnessStatus: string;
    implementationConfidence: string;
    searchExhaustionStatus: string;
    persistedPatch: Record<string, unknown>;
  };
  buildExperimentMonitorCommand: () => string;
  buildGraphImportRepairGuidance: (
    sharedCorpus: string | null | undefined
  ) => string;
  formatStageCommand: (stage: string | null) => string | null;
  STAGE_ENTRY_MICRO_STAGES: Record<string, string>;
  saveManifest: (projectRoot: string, manifest: Record<string, unknown>) => Promise<void>;
  saveGateState: (projectRoot: string, gateState: GateStateLike) => Promise<void>;
  maybeQueueAutoIteratorMailbox: (params: {
    projectRoot: string;
    fromRole: AutoIteratorAction["owner"];
    toRole: AutoIteratorAction["owner"];
    stage: string | null;
    nextAction: string | null;
    missingStageSignals: string[];
    cooldownSeconds: number;
  }) => Promise<MailboxQueueResultLike>;
  formatStageSummary: (stage: string | null) => string | null;
  normalizeIdleResearchState: (value: unknown) => { topic: string | null };
  isIdleResearchDue: (value: unknown) => boolean;
  syncProjectsStateEntry: (params: {
    projectRoot: string;
    projectId: string;
    manifest: ManifestLike;
    trackRegistry: TrackRegistryLike | null;
    stage: string | null;
    nextAction: string | null;
    blockingReason: string | null;
  }) => Promise<boolean>;
  readProjectsStateRaw: (projectRoot: string) => Promise<ProjectsStateLike>;
  writeAutoIteratorAudit: (
    projectRoot: string,
    result: AutoIteratorResult
  ) => Promise<string | null>;
  appendWorkflowTraceEvent: (params: {
    projectRoot: string;
    projectId: string | null;
    kind: string;
    action: string;
    functionName: string;
    stage: string | null;
    owner: AutoIteratorAction["owner"];
    agentId: AutoIteratorAction["owner"];
    sessionKey: string | null;
    summary: string;
    details: Record<string, unknown>;
  }) => Promise<void>;
  materializeIdeationContract: (params: {
    projectRoot: string;
    ideationMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializePaperStoryState: (params: {
    projectRoot: string;
    paperStoryMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeReviewPressurePacket: (params: {
    projectRoot: string;
    reviewPressureMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeExperimentReviewState: (params: {
    projectRoot: string;
    experimentReviewMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeSurveyReviewState: (params: {
    projectRoot: string;
    surveyReviewMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeInnovationSynthesisState?: (params: {
    projectRoot: string;
    stage?: string | null;
  }) => Promise<unknown>;
  materializeResultsStoryline?: (params: {
    projectRoot: string;
    stage?: string | null;
  }) => Promise<unknown>;
  materializeTitleAbstractIntroWorkbench?: (params: {
    projectRoot: string;
    stage?: string | null;
  }) => Promise<unknown>;
  materializeIdeaCatalystState: (params: {
    projectRoot: string;
    ideaCatalystMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeLiteratureDiscoveryPacket: (params: {
    projectRoot: string;
    literatureDiscoveryMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializePapernexusPacketContracts?: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  queueIdeaCatalystRequisition: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  queueLiteratureDiscoveryRequisition: (params: {
    projectRoot: string;
    packetPath: string;
    triggerKind?: string | null;
    originStage?: string | null;
    summary?: string | null;
    sharedCorpus?: string | null;
    requestIdPrefix?: string | null;
  }) => Promise<unknown>;
};

async function finishAutoIteratorAfterRequisitionAdvance(params: {
  projectRoot: string;
  projectId: string | null;
  mode: string;
  configuredAutoMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
  stageBefore: string | null;
  ownerBefore: AutoIteratorAction["owner"];
  actorRole: AutoIteratorAction["owner"];
  stagePreflight: StagePreflightResult;
  advance: LiteratureDiscoveryRequisitionAdvanceResult;
  deps: AutoIteratorDeps;
}): Promise<AutoIteratorResult> {
  const manifest =
    (await readJsonIfExists<ManifestLike>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const workflowControl = asRecord(manifest.workflow_control);
  const stageAfter =
    normalizeStage(workflowControl?.stage) ??
    normalizeStage(manifest.current_stage) ??
    params.stageBefore;
  const ownerAfter = params.deps.normalizeRole(
    workflowControl?.owner ?? manifest.owner_agent ?? "researcher"
  );
  const nextAction =
    asString(workflowControl?.next_action) ??
    asString(manifest.next_action) ??
    "/graph-build";
  const blockingReason =
    asString(workflowControl?.blocking_reason) ??
    asString(manifest.blocking_reason) ??
    params.advance.summary;
  const missingStageSignals = blockingReason ? [blockingReason] : [];
  let projectsStateUpdated = false;
  if (params.projectId) {
    projectsStateUpdated = await params.deps.syncProjectsStateEntry({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      manifest,
      trackRegistry: null,
      stage: stageAfter,
      nextAction,
      blockingReason,
    });
  }
  const materializedArtifacts = [
    ...params.stagePreflight.materializedArtifacts,
    {
      contract: "literature_discovery_requisition_advanced",
      artifactPath: params.advance.batchManifestPath ?? "PROJECT_MANIFEST.json",
      fingerprint: null,
      action: "reconciled" as const,
      kind: params.advance.reason,
    },
  ];
  const recommendedActions: AutoIteratorAction[] = [
    {
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary:
        params.advance.summary ??
        "Workflow-owned literature discovery requisition advanced; wait for the next tick before dispatching owner work.",
      command: nextAction,
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    },
  ];
  const result: AutoIteratorResult = {
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    mode: params.mode,
    configuredAutoMode: params.configuredAutoMode,
    effectiveAutoMode: params.configuredAutoMode,
    autoModeRiskLevel: "stable",
    autoModeReasons: [],
    autoModeRiskFingerprint: null,
    autoModeMitigationStatus: null,
    autoModeMitigationRoundsStarted: 0,
    autoModeMitigationRoundsRemaining: 0,
    stageBefore: params.stageBefore,
    stageEffective: stageAfter,
    stageAfter,
    stageChanged: stageAfter !== params.stageBefore,
    regressed: stageAfter !== params.stageBefore,
    gateBlocking: false,
    gateReason: null,
    timedDefaultTriggered: false,
    missingStageSignals,
    ownerBefore: params.ownerBefore,
    ownerAfter,
    ownerActivated: false,
    pendingHandoff: false,
    pendingHandoffPhase: null,
    pendingHandoffExecutionId: null,
    nextAction,
    resumeAction: nextAction,
    blockingReason,
    experimentDecision: null,
    experimentDecisionRationale: null,
    experimentRollbackStage: null,
    graphPresenceCheck: null,
    projectsStateUpdated,
    auditPath: null,
    materializedArtifacts,
    hookEvents: params.stagePreflight.emittedHookEvents,
    recommendedActions,
  };
  result.auditPath = await params.deps.writeAutoIteratorAudit(
    params.projectRoot,
    result
  );
  await params.deps.appendWorkflowTraceEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "auto_iterator",
    action: "literature_requisition_advanced",
    functionName: "runWorkflowAutoIterator",
    stage: stageAfter,
    owner: ownerAfter,
    agentId: params.actorRole,
    sessionKey: null,
    summary: `Auto iterator advanced literature requisition ${params.advance.requestId ?? "unknown"}.`,
    details: {
      reason: params.advance.reason,
      requestId: params.advance.requestId,
      status: params.advance.status,
      attemptCount: params.advance.attemptCount,
      startedAt: params.advance.startedAt,
      runId: params.advance.runId,
      queueProgress: params.advance.queueProgress,
      sourceIndexPath: params.advance.sourceIndexPath,
      materializedPaperCount: params.advance.materializedPaperCount,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "auto_iterator",
    action: "literature_requisition_advanced",
    status:
      params.advance.reason === "blocked" ||
      params.advance.reason === "marked_needs_repair"
        ? "blocked"
        : "waiting",
    stage: stageAfter,
    owner: ownerAfter,
    summary:
      params.advance.summary ??
      "Advanced a workflow-owned literature discovery requisition and stopped this tick before owner dispatch.",
    details: {
      requestId: params.advance.requestId,
      status: params.advance.status,
      attemptCount: params.advance.attemptCount,
      startedAt: params.advance.startedAt,
      runId: params.advance.runId,
      queueProgress: params.advance.queueProgress,
      catchup: params.advance.catchup,
    },
  });
  return result;
}

export async function runWorkflowAutoIteratorImpl(
  params: {
    projectRoot: string;
    agentId?: string;
    mode?: string;
    queueMailbox?: boolean;
    cooldownSeconds?: number;
    policy?: WorkflowGuardPolicy;
    now?: string;
    requesterSessionKey?: string | null;
    sessionBindingKey?: string | null;
  },
  deps: AutoIteratorDeps
): Promise<AutoIteratorResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const workflowPolicy = deps.normalizePolicy(
    params.policy as Record<string, unknown> | undefined
  );
  const configuredAutoMode =
    workflowPolicy.autoMode ?? ("off" as NonNullable<WorkflowGuardPolicy["autoMode"]>);
  const autoGate =
    workflowPolicy.autoGate ??
    ({
      maxMitigationRounds: 0,
    } as NonNullable<WorkflowGuardPolicy["autoGate"]>);
  const now = params.now ?? new Date().toISOString();
  const agentContactCooldownSeconds =
    typeof workflowPolicy.agentContactCooldownSeconds === "number" &&
    Number.isFinite(workflowPolicy.agentContactCooldownSeconds)
      ? Math.max(0, Math.floor(workflowPolicy.agentContactCooldownSeconds))
      : 300;
  const [manifestRaw, initialTrackRegistry, initialExperimentLedger] = await Promise.all([
    readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    deps.loadExperimentLedgerIfExists(projectRoot),
  ]);
  const rawWorkflowControl = asRecord(manifestRaw?.workflow_control);
  const rawControlStage =
    rawWorkflowControl?.schema_version === 1
      ? normalizeStage(rawWorkflowControl.stage)
      : null;
  const rawStageBefore = rawControlStage ?? normalizeStage(manifestRaw?.current_stage);
  const initialReconcile = await reconcileWorkflowControl({
    projectRoot,
    policy: { allowProjectionRepair: true },
    now,
  });
  let manifest = { ...(manifestRaw ?? {}), ...initialReconcile.manifest };
  if (rawStageBefore) {
    manifest.current_stage = rawStageBefore;
    if (rawWorkflowControl?.schema_version === 1) {
      manifest.workflow_control = rawWorkflowControl;
    } else {
      delete manifest.workflow_control;
    }
  }
  let trackRegistry = initialTrackRegistry;
  let experimentLedger = initialExperimentLedger;
  const gateState = await deps.readGateState(projectRoot);
  const actorRole = deps.normalizeRole(params.agentId);
  const projectId = deps.inferProjectId(projectRoot, manifest);
  const mode = asString(params.mode) ?? "manual";
  let stageBefore =
    rawStageBefore ?? normalizeStage(manifest.current_stage) ?? gateState.currentStage ?? "setup";
  if (deps.ensureSurveyWorkflowIdentity) {
    const surveyIdentity = deps.ensureSurveyWorkflowIdentity(manifest);
    if (surveyIdentity.updated) {
      manifest = {
        ...manifest,
        ...surveyIdentity.manifest,
      };
      await deps.saveManifest(projectRoot, manifest);
    }
  }
  if (deps.isSurveyWorkflow(manifest)) {
    stageBefore =
      deps.resolveStageForWorkflowLine({
        stage: stageBefore,
        manifest,
      }) ?? stageBefore;
  }
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "auto_iterator",
    action: "tick_started",
    status: "started",
    stage: stageBefore,
    owner: asString(manifest.owner_agent),
    summary: `Auto iterator started for ${stageBefore}.`,
    details: {
      mode,
      actorRole,
      configuredAutoMode,
      requesterSessionKey: asString(params.requesterSessionKey) ?? null,
      sessionBindingKey: asString(params.sessionBindingKey) ?? null,
    },
  });
  const initialStagePreflight = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: stageBefore,
    agentId: actorRole,
    trigger: `auto_iterator:${mode}`,
    autoGate,
    deps: {
      materializeIdeationContract: deps.materializeIdeationContract,
      materializePaperStoryState: deps.materializePaperStoryState,
      materializeExperimentReviewState: deps.materializeExperimentReviewState,
      materializeReviewPressurePacket: deps.materializeReviewPressurePacket,
      materializeSurveyReviewState: deps.materializeSurveyReviewState,
      materializeInnovationSynthesisState: deps.materializeInnovationSynthesisState,
      materializeResultsStoryline: deps.materializeResultsStoryline,
      materializeTitleAbstractIntroWorkbench:
        deps.materializeTitleAbstractIntroWorkbench,
      materializeIdeaCatalystState: deps.materializeIdeaCatalystState,
      materializeLiteratureDiscoveryPacket: deps.materializeLiteratureDiscoveryPacket,
      materializePapernexusPacketContracts: deps.materializePapernexusPacketContracts,
      queueIdeaCatalystRequisition: deps.queueIdeaCatalystRequisition,
      queueLiteratureDiscoveryRequisition: deps.queueLiteratureDiscoveryRequisition,
    },
  });
  let stagePreflight = initialStagePreflight;
  manifest = {
    ...manifest,
    ...initialStagePreflight.manifest,
  };
  if (
    initialStagePreflight.materializedArtifacts.length > 0 ||
    initialStagePreflight.emittedHookEvents.length > 0
  ) {
    trackRegistry =
      (await readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json"))) ??
      trackRegistry;
    experimentLedger = await deps.loadExperimentLedgerIfExists(projectRoot);
  }
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "stage_preflight",
    action: "current_stage_prepared",
    status:
      initialStagePreflight.materializedArtifacts.length > 0 ||
      initialStagePreflight.emittedHookEvents.length > 0
        ? "completed"
        : "waiting",
    stage: stageBefore,
    owner: asString(manifest.owner_agent),
    summary: `Stage preflight prepared ${stageBefore}.`,
    details: {
      materializedArtifacts: initialStagePreflight.materializedArtifacts,
      hookEvents: initialStagePreflight.emittedHookEvents,
    },
  });
  trackRegistry =
    (await readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json"))) ??
    trackRegistry;
  const preflightHadSideEffect =
    initialStagePreflight.materializedArtifacts.length > 0 ||
    initialStagePreflight.emittedHookEvents.length > 0;
  if (!preflightHadSideEffect && deps.advanceLiteratureDiscoveryRequisition) {
    const advance = await deps.advanceLiteratureDiscoveryRequisition({
      projectRoot,
      projectId,
      workflowPolicy,
      now,
    });
    if (advance.advanced) {
      return finishAutoIteratorAfterRequisitionAdvance({
        projectRoot,
        projectId,
        mode,
        configuredAutoMode,
        stageBefore,
        ownerBefore: deps.normalizeRole(
          manifest.owner_agent ?? deps.stageOwner(stageBefore) ?? "researcher"
        ),
        actorRole,
        stagePreflight,
        advance,
        deps,
      });
    }
  }
  const writePackageBefore = deps.normalizeWritePackageState(manifest.write_package);
  const surveyWorkflow = deps.isSurveyWorkflow(manifest);
  if (
    workflowPolicy.autoMode === "aggressive" &&
    (stageBefore === "write" || stageBefore === "submit") &&
    (await writePackageNeedsAutoAssembly({
      projectRoot,
      state: writePackageBefore,
    }))
  ) {
    await deps.assembleWritePackage({
      projectRoot,
      mode: "aggressive",
      trigger: "auto_iterator",
      agentId: actorRole,
    });
    manifest =
      (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
      manifest;
    const postAssemblyPreflight = await maybePrepareWorkflowStageContracts({
      projectRoot,
      manifest,
      stage: stageBefore,
      agentId: actorRole,
      trigger: `auto_iterator:${mode}:write_package_assembled`,
      autoGate,
      deps: {
        materializeIdeationContract: deps.materializeIdeationContract,
        materializePaperStoryState: deps.materializePaperStoryState,
        materializeExperimentReviewState: deps.materializeExperimentReviewState,
        materializeReviewPressurePacket: deps.materializeReviewPressurePacket,
        materializeSurveyReviewState: deps.materializeSurveyReviewState,
        materializeInnovationSynthesisState: deps.materializeInnovationSynthesisState,
        materializeResultsStoryline: deps.materializeResultsStoryline,
        materializeTitleAbstractIntroWorkbench:
          deps.materializeTitleAbstractIntroWorkbench,
        materializeIdeaCatalystState: deps.materializeIdeaCatalystState,
        materializeLiteratureDiscoveryPacket: deps.materializeLiteratureDiscoveryPacket,
        materializePapernexusPacketContracts: deps.materializePapernexusPacketContracts,
        queueIdeaCatalystRequisition: deps.queueIdeaCatalystRequisition,
        queueLiteratureDiscoveryRequisition: deps.queueLiteratureDiscoveryRequisition,
      },
    });
    stagePreflight = mergeStagePreflightResults([
      stagePreflight,
      postAssemblyPreflight,
    ]);
    manifest = {
      ...manifest,
      ...postAssemblyPreflight.manifest,
    };
  }

  let graphPresenceCheck: GraphPresenceCheckResult | null = null;
  const graphPresenceAcceptedByPreflight = stagePreflight.materializedContracts.some(
    (contract) =>
      contract === "literature_discovery_requisition_degraded" ||
      contract === "literature_discovery_requisition_verified_graph"
  );
  const paperIngestionStateForGraphRefresh = normalizePaperIngestionState(
    manifest.paper_ingestion
  );
  let papernexusSyncState = await readPapernexusSyncState(projectRoot);
  const graphPresenceRefreshRequested = shouldRefreshWorkflowGraphPresence({
    manifest,
    stage: stageBefore,
    nowIso: now,
    minRefreshIntervalMs: AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS,
    papernexusSyncState,
  });
  const remoteGraphRepairWithoutVerifiedReceipt =
    stageBefore === "graph_build" &&
    paperIngestionStateForGraphRefresh.repairRequired &&
    manifestUsesStrictRemotePapernexus(
      manifest,
      paperIngestionStateForGraphRefresh
    ) &&
    !(await hasVerifiedSourceBackedGraphBuildReceipt(projectRoot));
  const shouldRefreshGraphPresenceNow =
    !graphPresenceAcceptedByPreflight &&
    graphPresenceRefreshRequested &&
    !remoteGraphRepairWithoutVerifiedReceipt;
  if (
    !graphPresenceAcceptedByPreflight &&
    graphPresenceRefreshRequested &&
    remoteGraphRepairWithoutVerifiedReceipt
  ) {
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "auto_iterator",
      action: "graph_presence_refresh_skipped",
      status: "blocked",
      stage: stageBefore,
      owner: asString(manifest.owner_agent),
      summary:
        "Skipped graph presence refresh because strict remote PaperNexus repair lacks a verified graph build receipt.",
      details: {
        reason: "remote_papernexus_missing_verified_graph_build_receipt",
        receiptPath: DEFAULT_PAPERNEXUS_GRAPH_BUILD_RECEIPT_PATH,
        repairReason: paperIngestionStateForGraphRefresh.repairReason,
      },
    });
  }
  if (stageBefore === "graph_build" && shouldRefreshGraphPresenceNow) {
    graphPresenceCheck = await deps.checkGraphPresenceForWorkflow({
      projectRoot,
      updateManifest: true,
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
    manifest =
      (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
      manifest;
  }
  if (stageBefore === "graph_build" && deps.materializeGraphBuildPaperSources) {
    try {
      const graphPresenceReady =
        normalizeStage(graphPresenceCheck?.status) === "ready" ||
        normalizeStage(asRecord(manifest.paper_ingestion)?.graph_presence_status) ===
          "ready";
      const sourceCatchup: GraphBuildSourceCatchupResult =
        remoteGraphRepairWithoutVerifiedReceipt
        ? {
            attempted: false,
            queued: false,
            skippedReason:
              "Strict remote PaperNexus repair is blocked until a verified graph build receipt is available.",
            sourceIndexPath: null,
            materializedPaperCount: 0,
            requestId: null,
            batchManifestPath: null,
            errors: [
              paperIngestionStateForGraphRefresh.repairReason ??
                "Remote PaperNexus graph build receipt is missing or unverified.",
            ],
            attempts: [],
          }
        : graphPresenceReady && !hasOutstandingGraphBuildIngestionWork(manifest)
        ? {
            attempted: false,
            queued: false,
            skippedReason:
              "Graph presence is already ready; source catch-up skipped.",
            sourceIndexPath: null,
            materializedPaperCount: 0,
            requestId: null,
            batchManifestPath: null,
            errors: [],
            attempts: [],
          }
        : await deps.materializeGraphBuildPaperSources({
            projectRoot,
            projectId,
            workflowPolicy,
            now,
          });
      await appendWorkflowDiagnosticEvent({
        projectRoot,
        projectId,
        component: "graph_build_source_catchup",
        action: "materialize_missing_sources",
        status: sourceCatchup.queued
          ? "completed"
          : sourceCatchup.attempted
            ? "waiting"
            : "waiting",
        stage: stageBefore,
        owner: asString(manifest.owner_agent),
        summary: sourceCatchup.queued
          ? `Queued PaperNexus import for ${sourceCatchup.materializedPaperCount} materialized graph-build source(s).`
          : sourceCatchup.skippedReason ?? "Graph-build source catch-up did not queue work.",
        details: {
          queued: sourceCatchup.queued,
          attempted: sourceCatchup.attempted,
          skippedReason: sourceCatchup.skippedReason,
          sourceIndexPath: sourceCatchup.sourceIndexPath,
          materializedPaperCount: sourceCatchup.materializedPaperCount,
          requestId: sourceCatchup.requestId,
          batchManifestPath: sourceCatchup.batchManifestPath,
          errors: sourceCatchup.errors,
        },
      });
      if (sourceCatchup.queued) {
        manifest =
          (await readJsonIfExists<ManifestLike>(
            path.join(projectRoot, "PROJECT_MANIFEST.json")
          )) ?? manifest;
      }
    } catch (error) {
      await appendWorkflowDiagnosticEvent({
        projectRoot,
        projectId,
        component: "graph_build_source_catchup",
        action: "materialize_missing_sources",
        status: "failed",
        stage: stageBefore,
        owner: asString(manifest.owner_agent),
        summary: "Graph-build source catch-up failed before graph presence verification.",
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  if (graphPresenceCheck === null && shouldRefreshGraphPresenceNow) {
    graphPresenceCheck = await deps.checkGraphPresenceForWorkflow({
      projectRoot,
      updateManifest: true,
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
    manifest =
      (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
      manifest;
    papernexusSyncState = await readPapernexusSyncState(projectRoot);
  }

  const canonicalReconcile = await reconcileWorkflowControl({
    projectRoot,
    policy: { allowProjectionRepair: true },
    now,
    manifest,
    stageSignalResolver: async ({ stage, manifest: reconcilerManifest }) =>
      deps.getMissingStageSignals({
        projectRoot,
        manifest: reconcilerManifest,
        trackRegistry,
        experimentLedger,
        currentStage: stage,
      }),
  });
  manifest = canonicalReconcile.manifest;
  const canonicalControl = canonicalReconcile.contract;
  const stageEffective = normalizeStage(canonicalControl.stage) ?? stageBefore;
  const regressed = stageEffective !== stageBefore;
  const regressionDepth = 0;
  const regressionDepthCapped = false;
  const effectiveMissingSignals = buildCanonicalStageSignals({
    stage: stageEffective,
    completionStatus: canonicalControl.completion.status,
    blockingReason: canonicalControl.blocking_reason,
    missingSignals: canonicalReconcile.stageCompletion.missingSignals,
  });
  const autoModeRiskEvaluation = deps.evaluateWorkflowAutoModeRisk({
    configuredMode: configuredAutoMode,
    stage: stageEffective,
    regressed,
    revisionCount: gateState.revisionCount,
    missingStageSignals: effectiveMissingSignals,
    manifest,
  });
  const autoModeDiscussionStore =
    autoModeRiskEvaluation.riskFingerprint && autoModeRiskEvaluation.riskLevel !== "stable"
      ? await deps.readAutoModeDiscussionStore(projectRoot)
      : null;
  let autoModeDiscussionRound =
    autoModeDiscussionStore?.currentRound?.packetFingerprint ===
    autoModeRiskEvaluation.riskFingerprint
      ? autoModeDiscussionStore.currentRound
      : null;
  let autoModeDiscussionRoundsFingerprint =
    autoModeDiscussionRound?.packetFingerprint ?? autoModeRiskEvaluation.riskFingerprint;
  if (
    !autoModeDiscussionRound &&
    autoModeDiscussionStore?.currentRound &&
    (await isSemanticallyEquivalentAutoModeDiscussionRound({
      projectRoot,
      round: autoModeDiscussionStore.currentRound,
      riskEvaluation: autoModeRiskEvaluation,
      stage: stageEffective,
    }))
  ) {
    autoModeDiscussionRound = autoModeDiscussionStore.currentRound;
    autoModeDiscussionRoundsFingerprint =
      autoModeDiscussionRound.packetFingerprint ?? autoModeRiskEvaluation.riskFingerprint;
  }
  const autoModeMitigationRoundsStarted = autoModeRiskEvaluation.riskFingerprint
    ? Math.max(
        autoModeDiscussionStore?.roundsStartedByFingerprint?.[
          autoModeRiskEvaluation.riskFingerprint
        ] ?? 0,
        autoModeDiscussionRoundsFingerprint &&
          autoModeDiscussionRoundsFingerprint !== autoModeRiskEvaluation.riskFingerprint
          ? autoModeDiscussionStore?.roundsStartedByFingerprint?.[
              autoModeDiscussionRoundsFingerprint
            ] ?? 0
          : 0
      )
    : 0;
  const autoModeEvaluation = deps.resolveEffectiveWorkflowAutoMode({
    configuredMode: configuredAutoMode,
    riskEvaluation: autoModeRiskEvaluation,
    mitigationStatus: autoModeDiscussionRound?.status ?? null,
    mitigationRoundsStarted: autoModeMitigationRoundsStarted,
    mitigationMaxRounds: autoGate.maxMitigationRounds,
  });
  const gateEvaluation = await deps.evaluateGateBlocking({
    projectRoot,
    gateState,
    stage: stageEffective,
    hasStageWorkRemaining:
      canonicalControl.completion.status !== "complete" ||
      canonicalControl.blocking_reason != null,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    autoGate,
    now,
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "auto_iterator",
    action: "auto_mode_evaluated",
    status:
      gateEvaluation.blocking
        ? "blocked"
        : effectiveMissingSignals.length > 0 || regressed
          ? "waiting"
          : "completed",
    stage: stageEffective,
    owner: asString(manifest.owner_agent),
    summary: `Auto mode resolved to ${autoModeEvaluation.effectiveMode} for ${stageEffective}.`,
    details: {
      configuredAutoMode: autoModeEvaluation.configuredMode,
      effectiveAutoMode: autoModeEvaluation.effectiveMode,
      riskLevel: autoModeEvaluation.riskLevel,
      riskFingerprint: autoModeEvaluation.riskFingerprint,
      mitigationStatus: autoModeEvaluation.mitigationStatus,
      gateBlocking: gateEvaluation.blocking,
      gateReason: gateEvaluation.reason,
      regressed,
      effectiveMissingSignals,
    },
  });

  let stageAfter = stageEffective;
  const experimentSearchStateBeforeAdvance =
    stageEffective === "experiment"
      ? deps.loadExperimentSearchState
        ? await deps.loadExperimentSearchState({
            projectRoot,
            manifest,
          })
        : deps.normalizeExperimentSearchState(manifest.experiment_search)
      : null;
  const experimentReviewStateBeforeAdvance =
    stageEffective === "experiment"
      ? await deps.loadExperimentReviewState({
          projectRoot,
          manifest,
        })
      : null;
  const reviewedAutoPrelaunch =
    stageEffective === "experiment" &&
    deps.isReviewedAutoExperimentLaunchEnabled(manifest.autonomous_execution) &&
    !deps.hasActiveExperimentRuns(experimentLedger) &&
    !deps.hasFinishedExperimentWorkAwaitingReconciliation({
      ledger: experimentLedger,
      experimentSearch: experimentSearchStateBeforeAdvance ?? {},
    }) &&
    normalizeStage(experimentSearchStateBeforeAdvance?.status) !==
      "ready_for_analysis";
  const canonicalExperimentDecision = canonicalExperimentDecisionFromBlocker({
    stageBefore,
    stageAfter,
    blockingReason: canonicalControl.blocking_reason,
  });
  const experimentDecision: string | null = canonicalExperimentDecision;
  const experimentDecisionRationale: string | null =
    canonicalExperimentDecision === "repair_implementation"
      ? "Canonical experiment completion routed bounded implementation repair to Coder."
      : canonicalExperimentDecision === "launch_pending"
        ? "Canonical experiment completion routed first launch orchestration to Researcher."
      : canonicalExperimentDecision === "continue_tuning" ||
          canonicalExperimentDecision === "require_multi_seed"
        ? "Canonical experiment completion routed bounded experiment search work to Coder."
      : canonicalExperimentDecision === "reconcile_runtime"
        ? "Canonical experiment completion routed runtime reconciliation to Researcher."
      : canonicalExperimentDecision === "rollback_to_plan" ||
          canonicalExperimentDecision === "rollback_to_idea"
        ? "Canonical experiment completion selected a rollback target."
        : null;
  const experimentRollbackStage: string | null =
    canonicalExperimentDecision === "rollback_to_plan"
      ? "plan"
      : canonicalExperimentDecision === "rollback_to_idea"
        ? "idea"
        : null;
  if (
    !reviewedAutoPrelaunch &&
    !gateEvaluation.blocking &&
    !regressed &&
    stageEffective &&
    canonicalControl.completion.status === "complete" &&
    canonicalControl.blocking_reason == null &&
    stageEffective !== "done"
  ) {
    const nextStage =
      stageFromCanonicalNextAction(canonicalControl.next_action) ??
      deps.resolveNextStageForWorkflow({
        stage: stageEffective,
        manifest,
      });
    if (nextStage) {
      stageAfter = nextStage;
    }
  }

  if (
    shouldBootstrapTransitionStage({
      stageBefore: stageEffective,
      stageAfter,
    })
  ) {
    const targetStagePreflight = await maybePrepareWorkflowStageContracts({
      projectRoot,
      manifest,
      stage: stageAfter,
      agentId: actorRole,
      trigger: `auto_iterator:${mode}:target_stage`,
      autoGate,
      deps: {
        materializeIdeationContract: deps.materializeIdeationContract,
        materializePaperStoryState: deps.materializePaperStoryState,
        materializeExperimentReviewState: deps.materializeExperimentReviewState,
        materializeReviewPressurePacket: deps.materializeReviewPressurePacket,
        materializeSurveyReviewState: deps.materializeSurveyReviewState,
        materializeInnovationSynthesisState: deps.materializeInnovationSynthesisState,
        materializeResultsStoryline: deps.materializeResultsStoryline,
        materializeTitleAbstractIntroWorkbench:
          deps.materializeTitleAbstractIntroWorkbench,
        materializeIdeaCatalystState: deps.materializeIdeaCatalystState,
        materializeLiteratureDiscoveryPacket: deps.materializeLiteratureDiscoveryPacket,
        materializePapernexusPacketContracts: deps.materializePapernexusPacketContracts,
        queueIdeaCatalystRequisition: deps.queueIdeaCatalystRequisition,
        queueLiteratureDiscoveryRequisition: deps.queueLiteratureDiscoveryRequisition,
      },
    });
    stagePreflight = mergeStagePreflightResults([
      initialStagePreflight,
      targetStagePreflight,
    ]);
    manifest = {
      ...manifest,
      ...targetStagePreflight.manifest,
    };
    trackRegistry =
      (await readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json"))) ??
      trackRegistry;
    experimentLedger = await deps.loadExperimentLedgerIfExists(projectRoot);
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "stage_preflight",
      action: "target_stage_prepared",
      status:
        targetStagePreflight.materializedArtifacts.length > 0 ||
        targetStagePreflight.emittedHookEvents.length > 0
          ? "completed"
          : "waiting",
      stage: stageAfter,
      owner: asString(manifest.owner_agent),
      summary: `Prepared target stage ${stageAfter}.`,
      details: {
        fromStage: stageEffective,
        materializedArtifacts: targetStagePreflight.materializedArtifacts,
        hookEvents: targetStagePreflight.emittedHookEvents,
      },
    });
  }

  const existingOrchestrationState = asRecord(manifest.orchestration_state) ?? {};
  const manifestOwner = asString(manifest.owner_agent);
  const manifestStage = normalizeStage(manifest.current_stage);
  const orchestrationOwner = pickString(existingOrchestrationState, [
    "currentOwner",
    "current_owner",
  ]);
  const canonicalStageOwner = deps.stageOwner(stageBefore);
  const handoffPhase = normalizeStage(
    pickString(existingOrchestrationState, ["handoffPhase", "handoff_phase"])
  );
  const ownerBefore =
    ((manifestStage === stageBefore || !canonicalStageOwner) && manifestOwner
      ? manifestOwner
      : null) ??
    ((handoffPhase === "prepared" || handoffPhase === "waiting") && orchestrationOwner
      ? orchestrationOwner
      : canonicalStageOwner ?? orchestrationOwner);
  const graphContextForActions = deriveWorkflowGraphContext({
    manifest,
    stage: stageAfter,
    nowIso: now,
    minRefreshIntervalMs: AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS,
    graphPresenceCheck,
    papernexusSyncState,
  });
  const paperIngestionStateForActions = graphContextForActions.paperIngestionState;
  const experimentSearchState = deps.normalizeExperimentSearchState(
    stageAfter === "experiment"
      ? deps.loadExperimentSearchState
        ? await deps.loadExperimentSearchState({
            projectRoot,
            manifest,
          })
        : manifest.experiment_search
      : manifest.experiment_search
  );
  const autonomousExecutionState = deps.normalizeAutonomousExecutionState(
    manifest.autonomous_execution
  );
  const experimentReviewState =
    stageAfter === "experiment"
      ? await deps.loadExperimentReviewState({
          projectRoot,
          manifest,
        })
      : null;
  const reviewedAutoExperimentLaunchEnabled =
    stageAfter === "experiment" &&
    deps.isReviewedAutoExperimentLaunchEnabled(manifest.autonomous_execution);
  const shouldMonitorExperiments =
    stageAfter === "experiment" &&
    (deps.hasActiveExperimentRuns(experimentLedger) ||
      deps.hasFinishedExperimentWorkAwaitingReconciliation({
        ledger: experimentLedger,
        experimentSearch: experimentSearchState,
      }));
  const experimentReadyForAnalysis =
    stageAfter === "experiment" &&
    normalizeStage(experimentSearchState.status) === "ready_for_analysis";
  const experimentReviewOwner =
    stageAfter === "experiment" && experimentReviewState
      ? deps.resolveExperimentReviewNextOwner({
          state: experimentReviewState,
          autonomousExecution: autonomousExecutionState,
          hasActiveRuns: shouldMonitorExperiments,
          readyForAnalysis: Boolean(experimentReadyForAnalysis),
        })
      : null;
  const experimentReviewCommand =
    stageAfter === "experiment" &&
    experimentReviewState &&
    reviewedAutoExperimentLaunchEnabled &&
    !shouldMonitorExperiments &&
    !experimentReadyForAnalysis
      ? deps.buildExperimentReviewCommand({
          owner: experimentReviewOwner,
          state: experimentReviewState,
        })
      : null;
  const experimentMonitorCommand = shouldMonitorExperiments
    ? deps.buildExperimentMonitorCommand()
    : null;
  const activeStageSignals =
    stageAfter === stageEffective
      ? effectiveMissingSignals
      : stageAfter
        ? await deps.getMissingStageSignals({
            projectRoot,
            manifest,
            trackRegistry,
            experimentLedger,
            currentStage: stageAfter,
          })
        : [];
  const setupOnboardingCommand =
    stageAfter === "setup" &&
    activeStageSignals.some((signal) =>
      signal.includes("PROJECT_MANIFEST.json.research_program")
    )
      ? "Run /project-init to complete the onboarding contract and lock the baseline, primary metric, datasets, success criteria, and Zotero bot/<project-id> path before graph grounding."
      : null;
  const graphImportRepairCommand =
    stageAfter === "graph_build" && graphContextForActions.repairRequired
      ? deps.buildGraphImportRepairGuidance(
          graphContextForActions.repairTargetCorpus
        )
      : null;
  const ideaCatalystStateForActions = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const ideaCatalystRequisitionCommand =
    stageAfter === "idea" &&
    (ideaCatalystStateForActions.requisitionRequired ||
      ideaCatalystStateForActions.status === "requisition")
      ? `Satisfy IDEA-CATALYST requisition at {PROJ}/${ideaCatalystStateForActions.investigationRequisitionPath} by collecting the requested cross-domain papers, scheduling imports with research_workflow.schedule_papernexus_import, then rerunning /graph-build before resuming IDEA.`
      : null;
  const ownerAfter =
    (stageAfter === stageEffective && !regressed
      ? deps.normalizeRole(canonicalControl.owner)
      : null) ??
    deps.stageOwner(stageAfter);
  const crossOwnerStageTransition =
    Boolean(ownerAfter) &&
    Boolean(ownerBefore) &&
    ownerAfter !== ownerBefore;
  const dispatchStageSignals = shouldMonitorExperiments ? [] : activeStageSignals;
  const canonicalNextAction =
    stageAfter === stageEffective ? canonicalControl.next_action : null;
  const derivedStageRepairCommand =
    graphImportRepairCommand ?? ideaCatalystRequisitionCommand ?? setupOnboardingCommand;
  const stageRepairCommand = canonicalNextAction == null ? derivedStageRepairCommand : null;
  const stageReadinessRepairSummary =
    dispatchStageSignals.length > 0
      ? `Resolve the following readiness signals before handing off ${stageAfter ?? "the current"} stage: ${dispatchStageSignals.join("; ")}.`
      : stageRepairCommand;
  const prioritizedExperimentCommand =
    canonicalNextAction == null
      ? experimentMonitorCommand ?? experimentReviewCommand ?? null
      : null;
  const nextAction = gateEvaluation.blocking
    ? gateEvaluation.reason
    : canonicalNextAction ??
      prioritizedExperimentCommand ??
      stageRepairCommand ??
      deps.formatStageCommand(stageAfter);
  const resumeAction = gateEvaluation.blocking
    ? "Wait for the blocking gate to resolve, then run /resume-pipeline."
    : canonicalNextAction ??
      prioritizedExperimentCommand ??
      stageRepairCommand ??
      deps.formatStageCommand(stageAfter);
  const canonicalBlockingReason =
    asString(canonicalControl.blocking_reason) ??
    asString(canonicalReconcile.stageCompletion.blockingReason) ??
    (canonicalControl.completion.status !== "complete"
      ? asString(canonicalControl.completion.reason)
      : null) ??
    asString(canonicalReconcile.stageCompletion.missingSignals?.[0]) ??
    asString(effectiveMissingSignals[0]) ??
    null;
  const blockingReason = gateEvaluation.blocking
    ? gateEvaluation.reason
    : canonicalBlockingReason ??
      (dispatchStageSignals.length > 0
      ? `Waiting for ${ownerAfter ?? "workflow owner"} to satisfy: ${dispatchStageSignals.join("; ")}`
      : stageReadinessRepairSummary
        ? "Waiting for workflow-owned repair before the stage can be handed off."
        : null);
  const stageReadyForOwnerWork =
    !gateEvaluation.blocking &&
    dispatchStageSignals.length === 0 &&
    stageRepairCommand == null;
  const stageOwnerCanMaterializeMissingSignals =
    !gateEvaluation.blocking &&
    canDispatchOwnerStageWithMissingSignals({
      stage: stageAfter,
      owner: ownerAfter,
      previousOwner: deps.normalizeRole(ownerBefore),
      missingStageSignals: dispatchStageSignals,
      stageRepairCommand,
    });
  const stageRepairBackgroundCommand = stageReadinessRepairSummary
    ? stageReadinessRepairSummary
    : dispatchStageSignals.length > 0
      ? `Review the blocking signals and repair the workflow-owned gap before handing off ${stageAfter ?? "the current"} stage.`
      : null;
  const previousMicroStage = normalizeStage(manifest.current_micro_stage) ?? null;
  const nextMicroStage =
    stageAfter === "graph_build"
      ? deriveGraphBuildMicroStage({
          paperIngestionState: paperIngestionStateForActions,
          graphPresenceStatus:
            graphContextForActions.graphPresenceStatus ??
            graphContextForActions.graphPresenceCheckStatus,
        })
      : stageAfter === "experiment" &&
          reviewedAutoExperimentLaunchEnabled &&
          experimentReviewState
        ? deps.deriveExperimentReviewMicroStage({
            state: experimentReviewState,
            autonomousExecution: autonomousExecutionState,
            hasActiveRuns: shouldMonitorExperiments,
            readyForAnalysis: Boolean(experimentReadyForAnalysis),
          })
      : stageAfter === "idea"
        ? deriveIdeaCatalystMicroStage(asRecord(manifest.idea_catalyst))
      : stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed
        ? deps.STAGE_ENTRY_MICRO_STAGES[stageAfter] ?? previousMicroStage
      : previousMicroStage;

  const pendingOwnerCandidate =
    pickString(existingOrchestrationState, [
      "pendingOwnerCandidate",
      "pending_owner_candidate",
    ]) ?? null;
  const pendingStageCandidate =
    pickString(existingOrchestrationState, [
      "pendingStageCandidate",
      "pending_stage_candidate",
    ]) ?? null;
  const existingExecutionId =
    pickString(existingOrchestrationState, [
      "currentExecutionId",
      "current_execution_id",
    ]) ??
    pickString(existingOrchestrationState, ["stageRunId", "stage_run_id"]) ??
    null;
  const targetStagePreparedForSameTickCommit =
    Boolean(
      stageAfter &&
        TRANSITION_BOOTSTRAP_PREP_STAGES.has(stageAfter) &&
        stageAfter !== stageBefore
    ) &&
    !regressed &&
    !gateEvaluation.blocking &&
    (dispatchStageSignals.length === 0 || stageOwnerCanMaterializeMissingSignals) &&
    stageRepairCommand == null;
  const ownerTransitionRequiresClaim =
    !gateEvaluation.blocking &&
    crossOwnerStageTransition &&
    !regressed &&
    stageAfter !== stageBefore &&
    !targetStagePreparedForSameTickCommit;
  if (crossOwnerStageTransition && targetStagePreparedForSameTickCommit) {
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "auto_iterator",
      action: "owner_handoff_decoupled_from_state_commit",
      status: "completed",
      stage: stageAfter,
      owner: ownerAfter,
      summary:
        "Committed prepared target stage without waiting for owner handoff acknowledgement.",
      details: {
        stageBefore,
        stageAfter,
        ownerBefore,
        ownerAfter,
        reason: "target_stage_contracts_ready",
        dispatchStageSignals,
      },
    });
  }
  const reusePendingExecutionId =
    ownerTransitionRequiresClaim &&
    pendingOwnerCandidate === ownerAfter &&
    pendingStageCandidate === stageAfter
      ? existingExecutionId
      : null;
  const nextExecutionId =
    reusePendingExecutionId ??
    (stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed
      ? randomUUID()
      : existingExecutionId);
  const preparedHandoff =
    ownerTransitionRequiresClaim
      ? await createStageOwnerHandoffIntent({
          projectRoot,
          projectId,
          workflowLine: surveyWorkflow ? "survey" : "experiment",
          stageBefore,
          stageAfter,
          ownerBefore,
          ownerAfter: ownerAfter!,
          fromSessionKey: asString(params.requesterSessionKey) ?? null,
          sessionBindingKey: asString(params.sessionBindingKey) ?? null,
          nextAction,
          resumeAction,
          executionId: nextExecutionId,
          summary:
            deps.formatStageSummary(stageAfter) ??
            `Workflow owner handoff ${ownerBefore ?? "unknown"} -> ${ownerAfter ?? "unknown"}.`,
          acceptanceChecks: buildAutoIteratorStageHandoffAcceptanceChecks({
            workflowLine: surveyWorkflow ? "survey" : "experiment",
            stageAfter,
          }),
          blockingReason,
          missingStageSignals: activeStageSignals,
          manifestRevision: nextExecutionId,
        })
      : null;
  const stalePendingHandoffId =
    gateEvaluation.blocking && !ownerTransitionRequiresClaim
      ? pickString(existingOrchestrationState, [
          "pendingHandoffId",
          "pending_handoff_id",
        ])
      : null;
  if (stalePendingHandoffId) {
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: stalePendingHandoffId,
      toStatus: "superseded",
      terminalReason: "blocked_gate_cleared_pending_handoff",
      summary:
        "Superseded pending owner handoff because the current stage is blocked by a workflow gate and must not dispatch owner work.",
    });
  }
  const committedStage = ownerTransitionRequiresClaim ? stageBefore : stageAfter;
  const committedOwner = ownerTransitionRequiresClaim ? ownerBefore : ownerAfter;
  manifest.project_id = projectId;
  manifest.current_stage = committedStage;
  manifest.owner_agent = committedOwner;
  manifest.next_action = nextAction;
  manifest.blocking_reason = blockingReason;
  manifest.resume_action = resumeAction;
  manifest.auto_dispatch_diagnostics = serializeAutoDispatchDiagnosticsState({
    status:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? "degraded"
        : gateEvaluation.blocking
          ? "blocked"
          : dispatchStageSignals.length > 0
            ? "waiting"
            : "ready",
    lastCheckedAt: now,
    blockingLayer:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? "risk"
        : gateEvaluation.blocking
          ? "runtime"
          : dispatchStageSignals.length > 0
              ? "signals"
              : null,
    blockingReason:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? autoModeEvaluation.riskLevel
        : gateEvaluation.reason ?? null,
    blockingSummary: blockingReason,
    stageAfter,
    ownerAfter,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    riskFingerprint: autoModeEvaluation.riskFingerprint,
    activeHookPoint: null,
    aggregateHookVerdict: null,
    runtimeSessionHealth: gateEvaluation.blocking ? "gate_blocked" : null,
    mailboxStatus: null,
    nextRepairAction: nextAction,
  });
  manifest.last_heartbeat_at = now;
  manifest.current_micro_stage = nextMicroStage;
  const orchestrationNextStage =
    stageAfter != null ? deps.STAGE_REQUIREMENTS[stageAfter]?.nextStage ?? null : null;
  manifest.orchestration_state = {
    ...existingOrchestrationState,
    status: gateEvaluation.blocking
      ? "blocked"
      : ownerTransitionRequiresClaim
        ? "waiting"
      : stageReadyForOwnerWork
        ? "running"
        : "waiting",
    blocking_category: pickString(existingOrchestrationState, [
      "blockingCategory",
      "blocking_category",
    ]),
    current_owner: ownerTransitionRequiresClaim ? ownerBefore : ownerAfter,
    next_owner: ownerTransitionRequiresClaim
      ? ownerAfter
      : orchestrationNextStage != null
        ? deps.stageOwner(orchestrationNextStage)
        : null,
    pending_handoff_id:
      ownerTransitionRequiresClaim
        ? preparedHandoff?.intent.intentId ??
          pickString(existingOrchestrationState, [
            "pendingHandoffId",
            "pending_handoff_id",
          ])
        : null,
    pending_owner_candidate: ownerTransitionRequiresClaim ? ownerAfter : null,
    pending_stage_candidate: ownerTransitionRequiresClaim ? stageAfter : null,
    handoff_phase: ownerTransitionRequiresClaim ? "prepared" : "idle",
    current_execution_id: nextExecutionId,
    owner_claimed_at:
      ownerTransitionRequiresClaim &&
      pendingOwnerCandidate === ownerAfter &&
      pendingStageCandidate === stageAfter
        ? pickString(existingOrchestrationState, [
            "ownerClaimedAt",
            "owner_claimed_at",
          ])
        : null,
    owner_activation_deadline:
      ownerTransitionRequiresClaim
        ? preparedHandoff?.intent.deliveryPlan.ackDeadlineAt ??
          pickString(existingOrchestrationState, [
            "ownerActivationDeadline",
            "owner_activation_deadline",
          ])
        : null,
    rollback_target_owner: ownerTransitionRequiresClaim ? ownerBefore : null,
    last_handoff_error: ownerTransitionRequiresClaim
      ? null
      : pickString(existingOrchestrationState, [
          "lastHandoffError",
          "last_handoff_error",
        ]),
    next_transition_candidate: ownerTransitionRequiresClaim
      ? stageAfter
      : orchestrationNextStage,
    blocking_reason: blockingReason,
    rollback_reason_category: pickString(existingOrchestrationState, [
        "rollbackReasonCategory",
        "rollback_reason_category",
      ]),
    rollback_evidence_summary: pickString(existingOrchestrationState, [
      "rollbackEvidenceSummary",
      "rollback_evidence_summary",
    ]),
    rollback_target_stage: pickString(existingOrchestrationState, [
        "rollbackTargetStage",
        "rollback_target_stage",
      ]),
    last_contract_eval_result:
      gateEvaluation.blocking
          ? "blocked"
          : dispatchStageSignals.length > 0
            ? "needs_stage_repair"
            : "pass",
    last_contract_eval_at: now,
    resume_cursor: nextMicroStage,
    last_updated_at: now,
  };
  if (stageAfter === "experiment" && experimentReviewState) {
    const experimentReviewStatus = experimentReadyForAnalysis
      ? "ready_for_analysis"
      : shouldMonitorExperiments
        ? "monitoring"
        : normalizeStage(experimentReviewState.status) ?? "planning";
    manifest.experiment_review_state = serializeExperimentReviewState({
      ...normalizeExperimentReviewState(experimentReviewState),
      launchMode: autonomousExecutionState.experimentLaunchMode,
      status: experimentReviewStatus,
      microStage: nextMicroStage,
      lastUpdatedAt: now,
    });
  }
  if (
    !ownerTransitionRequiresClaim &&
    (stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed)
  ) {
    manifest.last_handoff_at = now;
  }
  manifest = (
    await reconcileWorkflowControl({
      projectRoot,
      policy: { allowProjectionRepair: true },
      now,
      manifest,
      stageSignalResolver: async ({ stage, manifest: reconcilerManifest }) =>
        deps.getMissingStageSignals({
          projectRoot,
          manifest: reconcilerManifest,
          trackRegistry,
          experimentLedger,
          currentStage: stage,
        }),
    })
  ).manifest;
  await runWorkflowHandoffMaintenancePass({ projectRoot, now: new Date(now) });

  if (workflowPolicy.teamRuntime?.enabled !== false) {
    const evidenceCloseout = summarizeEvidenceCloseoutState(manifest);
    const writingContract = normalizeWritingContractState(manifest.writing_contract);
    const teamTaskPreview = buildWorkflowStageTaskPreview({
      currentStage: stageAfter,
      topTierVerdict: evidenceCloseout.topTierVerdict,
      evidenceCloseout,
      writingSectionOrder: writingContract.sectionOrder,
    });
    await materializeWorkflowTaskGraph({
      projectRoot,
      projectId,
      stage: stageAfter,
      topTierVerdict: evidenceCloseout.topTierVerdict,
      evidenceCloseout,
      previewTasks: teamTaskPreview,
    });
    const taskGraphStore = await readWorkflowTaskGraphStore(projectRoot);
    const taskGraphSummary = summarizeWorkflowTaskGraphStore(taskGraphStore);
    await materializeWorkflowTeamRound({
      projectRoot,
      projectId,
      stage: stageAfter,
      leadRole: ownerAfter,
      topTierVerdict: evidenceCloseout.topTierVerdict,
      evidenceCloseoutStatus: evidenceCloseout.status,
      taskGraphPath: getWorkflowTaskGraphPath(projectRoot),
      taskCount: taskGraphSummary.taskCount,
      claimableCount: taskGraphSummary.claimableCount,
      blockedCount: taskGraphSummary.blockedCount,
      claimedCount: taskGraphSummary.claimedCount,
      verifyingCount: taskGraphSummary.verifyingCount,
      needsRepairCount: taskGraphSummary.needsRepairCount,
      satisfiedCount: taskGraphSummary.satisfiedCount,
      optionalCount: taskGraphSummary.optionalCount,
    });
  }

  const nextGateState: GateStateLike = {
    ...gateState,
    currentStage: stageAfter,
    gateType:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.gateType,
    gateTimestamp:
      gateEvaluation.blocking && stageAfter === "submit"
        ? gateState.gateTimestamp ?? now
        : stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
          ? null
          : gateState.gateTimestamp,
    lastGate:
      gateEvaluation.blocking && stageAfter === "submit"
        ? gateState.lastGate ?? "GATE-5"
        : stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
          ? null
          : gateState.lastGate,
    gateStatus:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateEvaluation.timedDefaultTriggered
        ? "approved"
        : gateEvaluation.blocking
          ? "waiting"
          : gateState.gateStatus === "waiting"
            ? "approved"
            : gateState.gateStatus,
    confirmationRequestedAt:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.confirmationRequestedAt,
    confirmationDeadlineAt:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.confirmationDeadlineAt,
    defaultAction:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.defaultAction,
    defaultActionReason:
      stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.defaultActionReason,
    defaultActionExecutedAt: gateEvaluation.timedDefaultTriggered
      ? gateState.defaultActionExecutedAt ?? now
      : stageAfter !== "submit" && gateState.lastGate?.trim().toUpperCase() === "GATE-5"
        ? null
        : gateState.defaultActionExecutedAt,
  };
  await deps.saveGateState(projectRoot, nextGateState);

  const recommendedActions: AutoIteratorAction[] = [];
  const shouldDispatchPreparedOwnerHandoff =
    ownerTransitionRequiresClaim && !gateEvaluation.blocking && stageRepairCommand == null;
  if (gateEvaluation.blocking) {
    recommendedActions.push({
      kind: "wait_human",
      stage: stageAfter,
      owner: ownerAfter,
      summary: gateEvaluation.reason ?? "Wait for the required human gate.",
      command: null,
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: true,
    });
  } else if (
    stageReadyForOwnerWork ||
    shouldDispatchPreparedOwnerHandoff ||
    stageOwnerCanMaterializeMissingSignals
  ) {
    const mailbox =
      params.queueMailbox === false
        ? {
            queued: false,
            messageId: null,
            cooldownRemainingSeconds: null,
          }
        : await deps.maybeQueueAutoIteratorMailbox({
            projectRoot,
            fromRole: actorRole,
            toRole: ownerAfter,
            stage: stageAfter,
            nextAction,
            missingStageSignals: dispatchStageSignals,
            cooldownSeconds:
              typeof params.cooldownSeconds === "number" &&
              Number.isFinite(params.cooldownSeconds)
                ? Math.max(0, Math.floor(params.cooldownSeconds))
                : agentContactCooldownSeconds,
          });
    recommendedActions.push({
      kind: "drive_stage",
      stage: stageAfter,
      owner: ownerAfter,
      summary:
        deps.formatStageSummary(stageAfter) ??
        "Drive the current workflow stage and refresh durable state.",
      command: nextAction,
      mailboxQueued: mailbox.queued,
      mailboxMessageId: mailbox.messageId,
      cooldownRemainingSeconds: mailbox.cooldownRemainingSeconds,
      blocking: false,
      dispatchDespiteMissingSignals: stageOwnerCanMaterializeMissingSignals,
    });
  } else {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary:
        blockingReason ??
        "Workflow-owned repair or materialization is still required before the stage can be handed off.",
      command: stageRepairBackgroundCommand,
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const idleResearch = deps.normalizeIdleResearchState(manifest.idle_research);
  if (deps.isIdleResearchDue(idleResearch) && (gateEvaluation.blocking || ownerAfter !== "researcher")) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary: `Idle research topic "${idleResearch.topic ?? "unset"}" is due and can run in the background.`,
      command:
        idleResearch.topic
          ? `Run /idle-research for "${idleResearch.topic}" and record the round through research_workflow.record_idle_research_run.`
          : "Configure idle research with research_workflow.set_idle_research before using background rounds.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const paperIngestion = asRecord(manifest.paper_ingestion);
  if (
    paperIngestion?.refresh_required === true &&
    (stageAfter === "graph_build" || stageAfter === "frontier_mapping" || stageAfter === "idea")
  ) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary:
        "PaperNexus graph catch-up is pending and should refresh brainstorm grounding before novelty-sensitive work.",
      command:
        graphImportRepairCommand ??
        "Run /graph-build to verify PAPER_SOURCE_INDEX.json is reflected in the shared global graph, refresh graph readiness metadata, and update the brainstorm bundle (cache-first, without --force) before continuing frontier mapping or ideation. If wrapper-driven graph catch-up still fails, hand the exact non-force command to the user to run manually.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const experimentMemory = asRecord(manifest.experiment_memory);
  if (
    experimentLedger?.summary?.papernexusSyncRequired === true ||
    experimentMemory?.papernexus_sync_required === true
  ) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary: "Experiment evidence still needs to be synchronized back into PaperNexus.",
      command:
        "Refresh PaperNexus nodes or graph overlays for the latest experiments before the next ideation or writing round.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  let projectsStateUpdated = false;
  if (projectId) {
    projectsStateUpdated = await deps.syncProjectsStateEntry({
      projectRoot,
      projectId,
      manifest,
      trackRegistry,
      stage: stageAfter,
      nextAction,
      blockingReason,
    });
  }

  if (stageAfter === "done") {
    const projectsState = await deps.readProjectsStateRaw(projectRoot);
    const nextProject =
      (Array.isArray(projectsState.projects)
        ? projectsState.projects
            .filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
            .filter((entry) => pickString(entry, ["id"]) !== projectId)
            .filter((entry) => normalizeStage(entry.status) === "active")
            .sort((left, right) => {
              const leftPriority = pickNumber(left, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
              const rightPriority = pickNumber(right, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
              if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
              }
              const leftUpdated = pickString(left, ["updated"]) ?? "";
              const rightUpdated = pickString(right, ["updated"]) ?? "";
              return rightUpdated.localeCompare(leftUpdated);
            })[0]
        : null) ?? null;
    if (nextProject) {
      const nextProjectId = pickString(nextProject, ["id"]);
      recommendedActions.push({
        kind: "switch_project",
        stage: "done",
        owner: "researcher",
        summary: `Queue candidate ready: ${nextProjectId ?? "another active project"}.`,
        command:
          nextProjectId
            ? `Switch OPENCLAW_PROJECT to ${nextProjectId} and run /resume-pipeline there.`
            : "Switch to the next active queued project and run /resume-pipeline.",
        mailboxQueued: false,
        mailboxMessageId: null,
        cooldownRemainingSeconds: null,
        blocking: false,
      });
    }
  }

  const result: AutoIteratorResult = {
    projectRoot,
    projectId,
    mode,
    configuredAutoMode:
      autoModeEvaluation.configuredMode as AutoIteratorResult["configuredAutoMode"],
    effectiveAutoMode:
      autoModeEvaluation.effectiveMode as AutoIteratorResult["effectiveAutoMode"],
    autoModeRiskLevel:
      autoModeEvaluation.riskLevel as AutoIteratorResult["autoModeRiskLevel"],
    autoModeReasons: autoModeEvaluation.reasons,
    autoModeRiskFingerprint: autoModeEvaluation.riskFingerprint,
    autoModeMitigationStatus:
      autoModeEvaluation.mitigationStatus as AutoIteratorResult["autoModeMitigationStatus"],
    autoModeMitigationRoundsStarted: autoModeEvaluation.mitigationRoundsStarted,
    autoModeMitigationRoundsRemaining: autoModeEvaluation.mitigationRoundsRemaining,
    stageBefore,
    stageEffective,
    stageAfter,
    stageChanged: stageAfter !== stageBefore,
    regressed,
    gateBlocking: gateEvaluation.blocking,
    gateReason: gateEvaluation.reason,
    timedDefaultTriggered: gateEvaluation.timedDefaultTriggered,
    missingStageSignals: dispatchStageSignals,
    ownerBefore,
    ownerAfter,
    ownerActivated: !ownerTransitionRequiresClaim,
    pendingHandoff: ownerTransitionRequiresClaim,
    pendingHandoffPhase: ownerTransitionRequiresClaim ? "prepared" : null,
    pendingHandoffExecutionId: ownerTransitionRequiresClaim ? nextExecutionId : null,
    nextAction,
    resumeAction,
    blockingReason,
    experimentDecision,
    experimentDecisionRationale,
    experimentRollbackStage,
    graphPresenceCheck,
    projectsStateUpdated,
    auditPath: null,
    materializedArtifacts: stagePreflight.materializedArtifacts,
    hookEvents: stagePreflight.emittedHookEvents,
    recommendedActions,
  };

  result.auditPath = await deps.writeAutoIteratorAudit(projectRoot, result);
  await deps.appendWorkflowTraceEvent({
    projectRoot,
    projectId,
    kind: "auto_iterator",
    action: "auto_iterator_tick",
    functionName: "runWorkflowAutoIterator",
    stage: stageAfter,
    owner: ownerAfter,
    agentId: actorRole,
    sessionKey: null,
    summary: `Auto iterator evaluated ${stageBefore} -> ${stageAfter}`,
    details: {
      mode,
      stageBefore,
      stageEffective,
      stageAfter,
      regressed,
      regressionDepth,
      regressionDepthCapped,
      gateBlocking: gateEvaluation.blocking,
      blockingReason,
      missingStageSignals: dispatchStageSignals,
      configuredAutoMode: autoModeEvaluation.configuredMode,
      effectiveAutoMode: autoModeEvaluation.effectiveMode,
      ownerBefore,
      ownerAfter,
      nextAction,
      experimentDecision,
      experimentDecisionRationale,
      experimentRollbackStage,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "auto_iterator",
    action: "tick_completed",
    status:
      gateEvaluation.blocking
        ? "blocked"
        : blockingReason
          ? "waiting"
          : "completed",
    stage: stageAfter,
    owner: ownerAfter,
    summary: `Auto iterator settled on ${stageAfter} owned by ${ownerAfter ?? "workflow"}.`,
    details: {
      stageBefore,
      stageEffective,
      stageAfter,
      regressed,
      regressionDepth,
      gateBlocking: gateEvaluation.blocking,
      gateReason: gateEvaluation.reason,
      blockingReason,
      ownerBefore,
      ownerAfter,
      nextAction,
      recommendedActions: recommendedActions.map((entry) => ({
        kind: entry.kind,
        owner: entry.owner,
        stage: entry.stage,
        blocking: entry.blocking,
        command: entry.command,
      })),
      missingStageSignals: dispatchStageSignals,
      experimentDecision,
      experimentRollbackStage,
      auditPath: result.auditPath,
    },
  });
  return result;
}
