import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  asRecord,
  asString,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import {
  deriveGraphBuildMicroStage,
  normalizePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import {
  normalizeExperimentReviewState,
  serializeExperimentReviewState,
} from "../workflow-guard-state/experiment-review";
import { normalizeRevisionControlState } from "../workflow-guard-state/revision-control";
import { serializeAutoDispatchDiagnosticsState } from "../workflow-guard-state/auto-dispatch-diagnostics";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import {
  deriveIdeaCatalystMicroStage,
  shouldRouteIdeaCatalystToGraphBuild,
} from "../idea-catalyst/workflow-bridge";
import { shouldRouteLiteratureDiscoveryToGraphBuild } from "../literature-discovery/workflow-bridge";
import {
  deriveWorkflowGraphContext,
  shouldRefreshWorkflowGraphPresence,
} from "../workflow-kernel/graph-context";
import { summarizeEvidenceCloseoutState } from "../workflow-evidence/closeout-summary";
import { evaluateExperimentSearchDecision } from "../workflow-experiment-decision";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
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
import { appendWorkflowDiagnosticEvent } from "../workflow-diagnostics.js";
import type { GraphPresenceCheckResult } from "../graph-presence";
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

type MailboxQueueResultLike = {
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
};

type ProjectsStateLike = {
  projects?: unknown[];
};

const AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS = 15_000;
const TRANSITION_BOOTSTRAP_PREP_STAGES = new Set(["write"]);
type StagePreflightResult = Awaited<ReturnType<typeof maybePrepareWorkflowStageContracts>>;

const EXPERIMENT_DECISIONS_HOLDING_STAGE = new Set([
  "launch_pending",
  "repair_implementation",
  "continue_tuning",
  "narrow_search",
  "require_multi_seed",
  "require_ablation",
  "innovation_fragile",
  "reconcile_runtime",
]);

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

function hasDurableCurrentStageEvidence(params: {
  currentStage: string | null;
  previousStage: string | null;
  manifest: ManifestLike;
}): boolean {
  const currentStage = normalizeStage(params.currentStage);
  const previousStage = normalizeStage(params.previousStage);
  if (!currentStage || !previousStage) {
    return false;
  }
  const manifest = params.manifest;
  switch (currentStage) {
    case "code": {
      if (previousStage !== "plan") {
        return false;
      }
      const orchestration = asRecord(manifest.orchestration_state) ?? {};
      const currentOwner = normalizeStage(
        orchestration.current_owner ??
          orchestration.currentOwner ??
          manifest.owner_agent ??
          manifest.ownerAgent
      );
      const nextTransitionCandidate = normalizeStage(
        orchestration.next_transition_candidate ??
          orchestration.nextTransitionCandidate
      );
      const currentMicroStage = normalizeStage(
        manifest.current_micro_stage ?? manifest.currentMicroStage
      );
      const resumeCursor = normalizeStage(
        pickString(orchestration, ["resumeCursor", "resume_cursor"])
      );
      return (
        currentOwner === "coder" ||
        nextTransitionCandidate === "code" ||
        nextTransitionCandidate === "experiment" ||
        [
          "implementation_requested",
          "bundles_implemented",
          "implementation_ready",
          "implementation_repair",
        ].includes(currentMicroStage ?? "") ||
        [
          "implementation_requested",
          "bundles_implemented",
          "implementation_ready",
          "implementation_repair",
        ].includes(resumeCursor ?? "")
      );
    }
    case "idea": {
      if (!["graph_build", "frontier_mapping"].includes(previousStage)) {
        return false;
      }
      const brainstormCycle = asRecord(manifest.brainstorm_cycle) ?? {};
      const ideationContract = asRecord(manifest.ideation_contract) ?? {};
      const ideaCatalyst = asRecord(manifest.idea_catalyst) ?? {};
      return [
        normalizeStage(brainstormCycle.status),
        normalizeStage(ideationContract.status),
        normalizeStage(ideaCatalyst.status),
      ].some((status) =>
        ["ready", "reconciled", "complete", "completed", "judging", "active"].includes(
          status ?? ""
        )
      );
    }
    case "analyze": {
      if (previousStage !== "experiment") {
        return false;
      }
      const experimentSearch = asRecord(manifest.experiment_search) ?? {};
      const executionProof = asRecord(manifest.execution_proof) ?? {};
      return (
        normalizeStage(experimentSearch.status) === "ready_for_analysis" &&
        normalizeStage(executionProof.status) === "ready"
      );
    }
    case "review": {
      if (!["analyze", "write"].includes(previousStage)) {
        return false;
      }
      const reviewSession = asRecord(manifest.review_session) ?? {};
      const resultsStoryline = asRecord(manifest.results_storyline) ?? {};
      return ["completed", "ready", "received"].includes(
        normalizeStage(reviewSession.status) ?? ""
      ) || normalizeStage(resultsStoryline.status) === "ready";
    }
    case "write": {
      if (!["survey_review", "review", "revise", "analyze", "experiment"].includes(previousStage)) {
        return false;
      }
      const writingSession = asRecord(manifest.writing_session) ?? {};
      const paperStory = asRecord(manifest.paper_story_state) ?? {};
      const resultsStoryline = asRecord(manifest.results_storyline) ?? {};
      const titleWorkbench = asRecord(manifest.title_abstract_intro_workbench) ?? {};
      return (
        !["missing", "pending", "bootstrapping"].includes(
          normalizeStage(writingSession.status) ?? "missing"
        ) ||
        normalizeStage(paperStory.status) === "ready" ||
        normalizeStage(resultsStoryline.status) === "ready" ||
        normalizeStage(titleWorkbench.status) === "ready"
      );
    }
    case "submit": {
      if (!["write", "review"].includes(previousStage)) {
        return false;
      }
      const writingSession = asRecord(manifest.writing_session) ?? {};
      const reviewSession = asRecord(manifest.review_session) ?? {};
      return (
        normalizeStage(writingSession.status) === "ready_for_submit" ||
        ["completed", "ready"].includes(normalizeStage(reviewSession.status) ?? "")
      );
    }
    default:
      return false;
  }
}

function resolveCriticalSubmitRollbackStage(manifest: ManifestLike): string | null {
  const citationIntegrity = asRecord(manifest.citation_integrity) ?? {};
  const verificationStatus = normalizeStage(citationIntegrity.verification_status);
  const hallucinatedCitationCount = pickNumber(citationIntegrity, [
    "hallucinated_citation_count",
    "hallucinatedCitationCount",
  ]) ?? 0;
  const allCitationsReal = citationIntegrity.all_citations_real === true;
  if (
    verificationStatus &&
    verificationStatus !== "verified" &&
    verificationStatus !== "ready"
  ) {
    return "review";
  }
  if (!allCitationsReal || hallucinatedCitationCount > 0) {
    return "review";
  }
  return null;
}

function resolveCriticalAnalyzeRollbackStage(manifest: ManifestLike): string | null {
  const executionProof = asRecord(manifest.execution_proof) ?? {};
  const status = normalizeStage(executionProof.status);
  if (status && status !== "ready") {
    return "experiment";
  }
  return null;
}

function resolveExperimentRollbackStage(params: {
  decision: string | null;
  experimentSearchSpec: Record<string, unknown> | null;
  manifest: ManifestLike;
}): string | null {
  const decision = normalizeStage(params.decision);
  if (decision === "rollback_to_idea") {
    return "idea";
  }
  if (decision === "rollback_to_plan") {
    return "plan";
  }
  if (decision !== "innovation_invalidated") {
    return null;
  }
  const criteria =
    asRecord(
    params.experimentSearchSpec?.innovationInvalidityCriteria ??
      params.experimentSearchSpec?.innovation_invalidity_criteria
    ) ?? {};
  const orchestration = asRecord(params.manifest.orchestration_state) ?? {};
  const rollbackCandidate =
    pickString(criteria, ["rollbackTarget", "rollback_target"]) ??
    pickString(orchestration, ["rollbackTargetStage", "rollback_target_stage"]) ??
    "plan";
  const normalized = normalizeStage(rollbackCandidate);
  return normalized === "idea" ? "idea" : "plan";
}

function buildExperimentDecisionCommand(params: {
  decision: string | null;
  rationale: string | null;
  monitorCommand: string;
  searchLoopActive: boolean;
  validationStage: string | null;
}): {
  ownerOverride: AutoIteratorAction["owner"] | null;
  command: string | null;
  summary: string | null;
} {
  const decision = normalizeStage(params.decision);
  switch (decision) {
    case "launch_pending":
      return {
        ownerOverride: "researcher",
        command:
          "Run /experiment-phase to schedule the first baseline-faithful launch group, initialize EXPERIMENT_REGISTRY.md and EXPERIMENT_LEDGER.json, and delegate atomic bundle launches to Coder /run-experiment. If a bounded search envelope is already approved, let Researcher wake Coder /search-experiment from inside experiment-phase instead of treating the stage as a coder-side repair.",
        summary:
          "No experiment launch has started yet; Researcher should orchestrate the first launch group before any coder-side runtime repair loop begins.",
      };
    case "reconcile_runtime":
      return {
        ownerOverride: "researcher",
        command: params.monitorCommand,
        summary:
          "Reconcile finished or likely-finished experiment runs from durable runtime signals before any new launch work.",
      };
    case "repair_implementation":
      return {
        ownerOverride:
          normalizeStage(params.validationStage) === "review_blockers"
            ? "researcher"
            : "coder",
        command:
          normalizeStage(params.validationStage) === "review_blockers"
            ? "Run /experiment-phase to resolve the outstanding experiment review blockers, reopen planner/analyzer/cross-reviewer if needed, and only hand back to Coder after the reviewed packet is coherent again."
            : params.searchLoopActive
              ? "Run /search-experiment to repair the bounded runtime / implementation issue inside the approved search envelope, keep the baseline protocol fair, and persist watcher artifacts with research_workflow.record_experiment_runtime_signal before handing back to Researcher."
              : "Use /resume-pipeline or /search-experiment to repair the bounded runtime / implementation issue, keep the baseline protocol fair, and persist watcher artifacts with research_workflow.record_experiment_runtime_signal before handing back to Researcher.",
        summary:
          normalizeStage(params.validationStage) === "review_blockers"
            ? "Experiment review blockers must be resolved before the search loop can continue."
            : "Bounded implementation or runtime repair is required before experiment evidence is trustworthy.",
      };
    case "require_multi_seed":
      return {
        ownerOverride: "researcher",
        command:
          "Run /experiment-phase to schedule multi-seed validation on the current incumbent, then reconcile EXPERIMENT_LEDGER.json and experiment_search before analysis.",
        summary:
          "A promising incumbent exists, but multi-seed validation is still required before analysis.",
      };
    case "require_ablation":
      return {
        ownerOverride: "researcher",
        command:
          "Run /experiment-phase to execute the missing ablation bundle(s), record the results in EXPERIMENT_LEDGER.json, and keep experiment_search blocked until attribution is clean.",
        summary:
          "The innovation is not isolated yet; the missing ablation pass must complete before analysis.",
      };
    case "narrow_search":
      return {
        ownerOverride: params.searchLoopActive ? "coder" : "researcher",
        command: params.searchLoopActive
          ? "Run /search-experiment and narrow the bounded search neighborhood around the incumbent instead of widening the envelope or inventing a new branch."
          : "Run /experiment-phase and narrow the bounded search neighborhood around the best incumbent instead of widening the envelope or inventing a new branch.",
        summary:
          "The current envelope looks exhausted; narrow the search neighborhood before declaring the innovation invalid.",
      };
    case "continue_tuning":
      return {
        ownerOverride: params.searchLoopActive ? "coder" : "researcher",
        command: params.searchLoopActive
          ? "Run /search-experiment and continue the approved bounded search loop from the current incumbent without widening the envelope."
          : "Run /experiment-phase and continue the approved bounded search loop; prefer waking Coder /search-experiment for the next candidate rather than hand-editing the envelope.",
        summary:
          "Stay in the approved bounded tuning loop; the evidence is not strong enough for analysis yet.",
      };
    case "innovation_fragile":
      return {
        ownerOverride: "researcher",
        command:
          "Run /experiment-phase to add one more robustness slice or a tighter incumbent neighborhood before analysis, and do not over-claim the innovation yet.",
        summary:
          "The innovation looks promising but still fragile; collect one more robustness slice before analysis.",
      };
    default:
      return {
        ownerOverride: null,
        command: null,
        summary: params.rationale ? `Experiment decision: ${params.rationale}` : null,
      };
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
  if (
    (params.autoIteratorResult.missingStageSignals ?? []).length > 0 &&
    !allowPreparedOwnerHandoff
  ) {
    return null;
  }
  return (
    params.autoIteratorResult.recommendedActions.find(
      (action) =>
        action.kind === "drive_stage" &&
        action.owner &&
        action.command &&
        action.blocking !== true &&
        (params.owner == null || action.owner === params.owner)
    ) ?? null
  );
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

const MAX_REGRESSION_DEPTH = 3;

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
  const agentContactCooldownSeconds =
    typeof workflowPolicy.agentContactCooldownSeconds === "number" &&
    Number.isFinite(workflowPolicy.agentContactCooldownSeconds)
      ? Math.max(0, Math.floor(workflowPolicy.agentContactCooldownSeconds))
      : 300;
  const [manifestRaw, initialTrackRegistry, experimentLedger] = await Promise.all([
    readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    deps.loadExperimentLedgerIfExists(projectRoot),
  ]);
  let manifest = { ...(manifestRaw ?? {}) };
  let trackRegistry = initialTrackRegistry;
  const gateState = await deps.readGateState(projectRoot);
  const actorRole = deps.normalizeRole(params.agentId);
  const now = params.now ?? new Date().toISOString();
  const projectId = deps.inferProjectId(projectRoot, manifest);
  const mode = asString(params.mode) ?? "manual";
  let stageBefore = normalizeStage(manifest.current_stage) ?? gateState.currentStage ?? "setup";
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
  let revisionControlState = normalizeRevisionControlState(
    asRecord(manifest.revision_control_state)
  );
  trackRegistry =
    (await readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json"))) ??
    trackRegistry;
  const writePackageBefore = deps.normalizeWritePackageState(manifest.write_package);
  const surveyWorkflow = deps.isSurveyWorkflow(manifest);
  if (
    workflowPolicy.autoMode === "aggressive" &&
    (stageBefore === "write" || stageBefore === "submit") &&
    !["ready", "assembled", "approved"].includes(
      normalizeStage(writePackageBefore.status) ?? ""
    )
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
  }

  let graphPresenceCheck: GraphPresenceCheckResult | null = null;
  if (
    shouldRefreshWorkflowGraphPresence({
      manifest,
      stage: stageBefore,
      nowIso: now,
      minRefreshIntervalMs: AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS,
    })
  ) {
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

  const graphContextBeforeRouting = deriveWorkflowGraphContext({
    manifest,
    stage: stageBefore,
    nowIso: now,
    minRefreshIntervalMs: AUTO_ITERATOR_GRAPH_REFRESH_MIN_INTERVAL_MS,
    graphPresenceCheck,
  });
  const paperIngestionStateBeforeRouting = graphContextBeforeRouting.paperIngestionState;
  const ideaCatalystStateBeforeRouting = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const catalystRequestedGraphReentry = shouldRouteIdeaCatalystToGraphBuild({
    currentStage: stageBefore,
    ideaCatalyst: ideaCatalystStateBeforeRouting,
    paperIngestion: paperIngestionStateBeforeRouting,
  });
  const literatureDiscoveryRequestedGraphReentry =
    shouldRouteLiteratureDiscoveryToGraphBuild({
      currentStage: stageBefore,
      paperIngestion: paperIngestionStateBeforeRouting,
      graphPresenceStatus: graphContextBeforeRouting.graphPresenceStatus,
    });
  const requestedGraphReentry =
    !surveyWorkflow &&
    (catalystRequestedGraphReentry || literatureDiscoveryRequestedGraphReentry);
  let stageEffective = requestedGraphReentry ? "graph_build" : stageBefore;
  let regressed = requestedGraphReentry;
  const visited = new Set<string>();
  let regressionDepth = requestedGraphReentry ? 1 : 0;
  let regressionDepthCapped = false;
  while (stageEffective && !requestedGraphReentry) {
    if (stageEffective === "experiment") {
      const experimentSearchForRegression = deps.normalizeExperimentSearchState(
        manifest.experiment_search
      );
      const experimentSearchStatus = normalizeStage(
        experimentSearchForRegression.status
      );
      if (experimentSearchStatus && experimentSearchStatus !== "missing") {
        break;
      }
    }
    if (regressionDepth >= MAX_REGRESSION_DEPTH) {
      regressionDepthCapped = true;
      break;
    }
    const previousStages = deps.getPreviousStagesForRegression({
      currentStage: stageEffective,
      manifest,
    });
    const previousStage = previousStages.find((candidate) => !visited.has(candidate)) ?? null;
    if (!previousStage) {
      break;
    }
    if (
      hasDurableCurrentStageEvidence({
        currentStage: stageEffective,
        previousStage,
        manifest,
      })
    ) {
      break;
    }
    visited.add(previousStage);
    const previousMissing = await deps.getMissingStageSignals({
      projectRoot,
      manifest,
      trackRegistry,
      experimentLedger,
      currentStage: previousStage,
      includeOrchestrationValidation: false,
    });
    if (previousMissing.length === 0) {
      break;
    }
    stageEffective = previousStage;
    regressed = true;
    regressionDepth += 1;
  }

  const effectiveMissingSignals = await deps.getMissingStageSignals({
    projectRoot,
    manifest,
    trackRegistry,
    experimentLedger,
    currentStage: stageEffective,
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
  const autoModeDiscussionRound =
    autoModeDiscussionStore?.currentRound?.packetFingerprint ===
    autoModeRiskEvaluation.riskFingerprint
      ? autoModeDiscussionStore.currentRound
      : null;
  const autoModeMitigationRoundsStarted = autoModeRiskEvaluation.riskFingerprint
    ? autoModeDiscussionStore?.roundsStartedByFingerprint?.[
        autoModeRiskEvaluation.riskFingerprint
      ] ?? 0
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
    hasStageWorkRemaining: effectiveMissingSignals.length > 0,
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
  let revisionDrivenRouting = false;
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
  const experimentGpuMonitorStateBeforeAdvance =
    stageEffective === "experiment"
      ? await readJsonIfExists<Record<string, unknown>>(
          path.join(projectRoot, "researcher", "EXPERIMENT_GPU_MONITOR.json")
        )
      : null;
  const experimentSearchSpecBeforeAdvance =
    stageEffective === "experiment"
      ? await readJsonIfExists<Record<string, unknown>>(
          path.join(
            projectRoot,
            asString(experimentSearchStateBeforeAdvance?.searchSpecPath) ??
              "planner/EXPERIMENT_SEARCH_SPEC.json"
          )
        )
      : null;
  const experimentDecisionBeforeAdvance =
    stageEffective === "experiment"
      ? deps.evaluateExperimentSearchDecision({
          experimentSearch: experimentSearchStateBeforeAdvance,
          experimentSearchSpec: experimentSearchSpecBeforeAdvance,
          experimentLedger,
          gpuMonitor: experimentGpuMonitorStateBeforeAdvance,
          experimentReviewState: experimentReviewStateBeforeAdvance,
          experimentMemory: asRecord(manifest.experiment_memory) ?? {},
        })
      : null;
  const experimentRollbackStage =
    stageEffective === "experiment"
      ? resolveExperimentRollbackStage({
          decision: experimentDecisionBeforeAdvance?.decision ?? null,
          experimentSearchSpec: experimentSearchSpecBeforeAdvance,
          manifest,
        })
      : null;
  const experimentDecisionBlocksAdvance =
    stageEffective === "experiment" &&
    (EXPERIMENT_DECISIONS_HOLDING_STAGE.has(
      normalizeStage(experimentDecisionBeforeAdvance?.decision) ?? ""
    ) ||
      experimentRollbackStage != null);
  if (stageEffective === "experiment" && experimentDecisionBeforeAdvance) {
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "experiment_decision",
      action: "decision_evaluated",
      status:
        experimentRollbackStage != null
          ? "blocked"
          : experimentDecisionBlocksAdvance
            ? "waiting"
            : "completed",
      stage: stageEffective,
      owner: asString(manifest.owner_agent),
      summary: `Experiment decision resolved to ${experimentDecisionBeforeAdvance.decision}.`,
      details: {
        decision: experimentDecisionBeforeAdvance.decision,
        rationale: experimentDecisionBeforeAdvance.rationale,
        validationStage: experimentDecisionBeforeAdvance.validationStage,
        recommendedNextAction: experimentDecisionBeforeAdvance.recommendedNextAction,
        baselineFairnessStatus:
          experimentDecisionBeforeAdvance.baselineFairnessStatus,
        implementationConfidence:
          experimentDecisionBeforeAdvance.implementationConfidence,
        searchExhaustionStatus:
          experimentDecisionBeforeAdvance.searchExhaustionStatus,
        rollbackStage: experimentRollbackStage,
      },
    });
  }
  const criticalAnalyzeRollbackStage =
    stageEffective === "analyze" ? resolveCriticalAnalyzeRollbackStage(manifest) : null;
  const criticalSubmitRollbackStage =
    stageEffective === "submit" ? resolveCriticalSubmitRollbackStage(manifest) : null;
  if (
    experimentRollbackStage != null &&
    !surveyWorkflow
  ) {
    stageAfter = experimentRollbackStage;
    regressed = true;
  } else if (criticalAnalyzeRollbackStage) {
    stageAfter = criticalAnalyzeRollbackStage;
    regressed = true;
  } else if (criticalSubmitRollbackStage) {
    stageAfter = criticalSubmitRollbackStage;
    regressed = true;
  } else if (
    !reviewedAutoPrelaunch &&
    !gateEvaluation.blocking &&
    stageEffective &&
    effectiveMissingSignals.length === 0 &&
    stageEffective !== "done" &&
    !experimentDecisionBlocksAdvance
  ) {
    const nextStage = deps.resolveNextStageForWorkflow({
      stage: stageEffective,
      manifest,
    });
    if (nextStage) {
      stageAfter = nextStage;
    }
  }
  if (
    revisionControlState.status === "active" &&
    ["write", "review", "submit"].includes(stageAfter ?? "")
  ) {
    stageAfter = "write";
    revisionDrivenRouting = true;
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
    revisionControlState = normalizeRevisionControlState(
      asRecord(manifest.revision_control_state)
    );
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

  const activeStageSignals =
    criticalAnalyzeRollbackStage
      ? effectiveMissingSignals
      : stageAfter !== stageEffective
      ? await deps.getMissingStageSignals({
          projectRoot,
          manifest,
          trackRegistry,
          experimentLedger,
          currentStage: stageAfter,
        })
      : effectiveMissingSignals;

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
  const experimentGpuMonitorState =
    stageAfter === "experiment"
      ? experimentGpuMonitorStateBeforeAdvance ??
        (await readJsonIfExists<Record<string, unknown>>(
          path.join(projectRoot, "researcher", "EXPERIMENT_GPU_MONITOR.json")
        ))
      : null;
  const experimentSearchSpec =
    stageAfter === "experiment"
        ? experimentSearchSpecBeforeAdvance ??
          (await readJsonIfExists<Record<string, unknown>>(
            path.join(
              projectRoot,
              asString(experimentSearchState.searchSpecPath) ??
                "planner/EXPERIMENT_SEARCH_SPEC.json"
            )
          ))
      : null;
  const experimentDecision =
    stageAfter === "experiment"
      ? experimentDecisionBeforeAdvance ??
        deps.evaluateExperimentSearchDecision({
          experimentSearch: experimentSearchState,
          experimentSearchSpec,
          experimentLedger,
          gpuMonitor: experimentGpuMonitorState,
          experimentReviewState: experimentReviewState,
          experimentMemory: asRecord(manifest.experiment_memory) ?? {},
        })
      : null;
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
  const experimentDecisionCommand =
    stageAfter === "experiment"
      ? buildExperimentDecisionCommand({
          decision: experimentDecision?.decision ?? null,
          rationale: experimentDecision?.rationale ?? null,
          monitorCommand:
            experimentMonitorCommand ?? deps.buildExperimentMonitorCommand(),
          searchLoopActive: Boolean(
            experimentSearchState.searchSessionId ?? experimentSearchSpec?.searchSessionId
          ) && !shouldMonitorExperiments,
          validationStage: experimentDecision?.validationStage ?? null,
        })
      : null;
  const experimentDecisionOwnsNextStep =
    stageAfter === "experiment" &&
    experimentDecisionCommand?.command != null &&
    !experimentReviewCommand;
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
      ? `Satisfy IDEA-CATALYST requisition at {PROJ}/${ideaCatalystStateForActions.investigationRequisitionPath} by collecting the requested cross-domain papers, queueing imports with research_workflow.queue_paper_ingestion, then rerunning /graph-build before resuming IDEA.`
      : null;
  let ownerAfter =
    (experimentReviewCommand ? experimentReviewOwner : null) ??
    experimentDecisionCommand?.ownerOverride ??
    deps.stageOwner(stageAfter);
  if (revisionDrivenRouting) {
    ownerAfter = deps.normalizeRole(revisionControlState.currentOwner ?? "academic_writer");
  }
  const crossOwnerStageTransition =
    Boolean(ownerAfter) &&
    Boolean(ownerBefore) &&
    ownerAfter !== ownerBefore;
  const dispatchStageSignals = shouldMonitorExperiments ? [] : activeStageSignals;
  let stageRepairCommand =
    graphImportRepairCommand ?? ideaCatalystRequisitionCommand ?? setupOnboardingCommand;
  const revisionControlCommand =
    revisionDrivenRouting
      ? `Use ${revisionControlState.activeRevisionPacketPath ?? "reviewer/REVISION_CONTROL_PACKET.md"} as the only revision source of truth, repair the bounded manuscript artifacts, update durable writing state, then rerun research_workflow.auto_iterator_tick.`
      : null;
  if (revisionDrivenRouting) {
    stageRepairCommand = null;
  }
  const stageReadinessRepairSummary =
    dispatchStageSignals.length > 0
      ? `Resolve the following readiness signals before handing off ${stageAfter ?? "the current"} stage: ${dispatchStageSignals.join("; ")}.`
      : stageRepairCommand;
  const prioritizedExperimentCommand =
    experimentMonitorCommand ??
    experimentReviewCommand ??
    experimentDecisionCommand?.command ??
    null;
  const nextAction = gateEvaluation.blocking
    ? gateEvaluation.reason
    : revisionControlCommand ??
      prioritizedExperimentCommand ??
      stageRepairCommand ??
      deps.formatStageCommand(stageAfter);
  const resumeAction = gateEvaluation.blocking
    ? "Wait for the blocking gate to resolve, then run /resume-pipeline."
    : revisionControlCommand ??
      prioritizedExperimentCommand ??
      stageRepairCommand ??
      deps.formatStageCommand(stageAfter);
  const blockingReason = gateEvaluation.blocking
    ? gateEvaluation.reason
    : revisionDrivenRouting
      ? revisionControlState.pendingReason ??
        "Revision control still has open sources; keep the workflow on a bounded write repair pass."
    : dispatchStageSignals.length > 0
      ? `Waiting for ${ownerAfter ?? "workflow owner"} to satisfy: ${dispatchStageSignals.join("; ")}`
      : stageReadinessRepairSummary
        ? "Waiting for workflow-owned repair before the stage can be handed off."
        : null;
  const stageReadyForOwnerWork =
    !gateEvaluation.blocking &&
    (dispatchStageSignals.length === 0 || experimentDecisionOwnsNextStep) &&
    stageRepairCommand == null;
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

  if (stageEffective === "experiment" && experimentDecisionBeforeAdvance) {
    const persistedSearchState = {
      ...asRecord(manifest.experiment_search),
      ...experimentDecisionBeforeAdvance.persistedPatch,
      last_updated_at: now,
    };
    manifest.experiment_search = persistedSearchState;
    await writeJsonEnsured(
      path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json"),
      persistedSearchState
    );
    manifest.experiment_memory = {
      ...(asRecord(manifest.experiment_memory) ?? {}),
      last_decision_summary: experimentDecisionBeforeAdvance.rationale,
      last_updated_at: now,
    };
  }

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
  const ownerTransitionRequiresClaim =
    crossOwnerStageTransition && !regressed && stageAfter !== stageBefore;
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
  manifest.project_id = projectId;
  manifest.current_stage = ownerTransitionRequiresClaim ? stageBefore : stageAfter;
  manifest.owner_agent = ownerTransitionRequiresClaim ? ownerBefore : ownerAfter;
  manifest.next_action = nextAction;
  manifest.resume_action = resumeAction;
  manifest.blocking_reason = blockingReason;
  manifest.auto_dispatch_diagnostics = serializeAutoDispatchDiagnosticsState({
    status:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? "degraded"
        : gateEvaluation.blocking
          ? "blocked"
          : revisionDrivenRouting || dispatchStageSignals.length > 0
            ? "waiting"
            : "ready",
    lastCheckedAt: now,
    blockingLayer:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? "risk"
        : gateEvaluation.blocking
          ? "runtime"
          : revisionDrivenRouting
            ? "hook"
            : dispatchStageSignals.length > 0
              ? "signals"
              : null,
    blockingReason:
      autoModeEvaluation.effectiveMode === "off" && autoModeEvaluation.riskLevel !== "stable"
        ? autoModeEvaluation.riskLevel
        : gateEvaluation.reason ?? (revisionDrivenRouting ? "revision_control_active" : null),
    blockingSummary:
      revisionDrivenRouting
        ? revisionControlState.pendingReason
        : blockingReason,
    stageAfter,
    ownerAfter,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    riskFingerprint: autoModeEvaluation.riskFingerprint,
    activeHookPoint: revisionDrivenRouting ? "before_stage_handoff" : null,
    aggregateHookVerdict: revisionDrivenRouting ? "revise" : null,
    runtimeSessionHealth: gateEvaluation.blocking ? "gate_blocked" : null,
    mailboxStatus: null,
    nextRepairAction: nextAction,
  });
  manifest.last_heartbeat_at = now;
  manifest.current_micro_stage = nextMicroStage;
  const rollbackReasonCategory =
    experimentRollbackStage != null
      ? normalizeStage(experimentDecisionBeforeAdvance?.decision) === "rollback_to_idea"
        ? "innovation_invalidated"
        : normalizeStage(experimentDecisionBeforeAdvance?.baselineFairnessStatus) !== "ready"
          ? "baseline_fairness_broken"
          : normalizeStage(experimentDecisionBeforeAdvance?.implementationConfidence) ===
              "untrusted"
            ? "implementation_untrusted"
            : normalizeStage(experimentDecisionBeforeAdvance?.searchExhaustionStatus) ===
                "exhausted"
              ? "search_exhausted"
              : "innovation_invalidated"
      : null;
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
    blocking_category:
      experimentRollbackStage != null
        ? "rollback_required"
        : stageAfter === "experiment" && experimentDecisionBeforeAdvance
          ? normalizeStage(experimentDecisionBeforeAdvance.decision)
          : pickString(existingOrchestrationState, [
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
    rollback_reason_category:
      rollbackReasonCategory ??
      pickString(existingOrchestrationState, [
        "rollbackReasonCategory",
        "rollback_reason_category",
      ]),
    rollback_evidence_summary:
      experimentRollbackStage != null
        ? experimentDecisionBeforeAdvance?.rationale ?? blockingReason
        : pickString(existingOrchestrationState, [
            "rollbackEvidenceSummary",
            "rollback_evidence_summary",
          ]),
    rollback_target_stage:
      experimentRollbackStage ??
      pickString(existingOrchestrationState, [
        "rollbackTargetStage",
        "rollback_target_stage",
      ]),
    last_contract_eval_result:
      experimentRollbackStage != null
        ? "rollback_required"
        : gateEvaluation.blocking
          ? "blocked"
          : dispatchStageSignals.length > 0
            ? "needs_stage_repair"
            : "pass",
    last_contract_eval_at: now,
    resume_cursor:
      stageAfter === "experiment" && experimentDecisionBeforeAdvance
        ? experimentDecisionBeforeAdvance.validationStage
        : nextMicroStage,
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
  await deps.saveManifest(projectRoot, manifest);

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

  if (regressionDepthCapped) {
    await deps.appendWorkflowTraceEvent({
      projectRoot,
      projectId,
      kind: "auto_iterator",
      action: "regression_depth_capped",
      functionName: "runWorkflowAutoIterator",
      stage: stageAfter,
      owner: ownerAfter,
      agentId: actorRole,
      sessionKey: null,
      summary: `Auto iterator capped backward regression at depth ${MAX_REGRESSION_DEPTH}.`,
      details: {
        stageBefore,
        stageEffective,
        stageAfter,
        regressionDepth,
        maxRegressionDepth: MAX_REGRESSION_DEPTH,
      },
    });
  }

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
  } else if (stageReadyForOwnerWork || shouldDispatchPreparedOwnerHandoff) {
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
        experimentDecisionCommand?.summary ??
        deps.formatStageSummary(stageAfter) ??
        "Drive the current workflow stage and refresh durable state.",
      command: nextAction,
      mailboxQueued: mailbox.queued,
      mailboxMessageId: mailbox.messageId,
      cooldownRemainingSeconds: mailbox.cooldownRemainingSeconds,
      blocking: false,
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
    experimentDecision: experimentDecisionBeforeAdvance?.decision ?? null,
    experimentDecisionRationale: experimentDecisionBeforeAdvance?.rationale ?? null,
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
      experimentDecision: experimentDecisionBeforeAdvance?.decision ?? null,
      experimentDecisionRationale: experimentDecisionBeforeAdvance?.rationale ?? null,
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
      experimentDecision: experimentDecisionBeforeAdvance?.decision ?? null,
      experimentRollbackStage,
      auditPath: result.auditPath,
    },
  });
  return result;
}
