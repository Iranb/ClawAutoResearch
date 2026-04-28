import * as fs from "node:fs/promises";
import {
  normalizeIdeationContractState,
} from "../workflow-guard-state/ideation-contract";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  isPaperIngestionExecutableUploadRequest,
  normalizePaperIngestionState,
  serializePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import {
  normalizeAutonomousExecutionState,
  normalizeExperimentReviewState,
} from "../workflow-guard-state/experiment-review";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import {
  hasActiveIdeaCatalystRequisitionRequest,
  reconcileSatisfiedIdeaCatalystRequisition,
} from "../idea-catalyst/workflow-bridge";
import {
  DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
  getWorkflowLiteratureDiscoveryNeed,
} from "../literature-discovery/materializer";
import { inspectPapernexusBridgeArtifacts } from "../workflow-evidence/papernexus-bridge";
import { hasActiveLiteratureDiscoveryRequest } from "../literature-discovery/workflow-bridge";
import { isLiteratureDiscoveryTriggerKind } from "../literature-discovery/workflow-bridge";
import { materializeCycleMemory } from "../research-memory-cycle";
import {
  materializePapernexusPacketContracts,
} from "../papernexus-packets/materializer";
import { materializeResultsStoryline } from "../research-writing/results-storyline";
import { materializeSurveyStorylinePlanner } from "../research-writing/survey-storyline-planner";
import { materializeTitleAbstractIntroWorkbench } from "../research-writing/title-abstract-intro-workbench";
import { materializeWritingSupportArtifacts } from "../research-writing/materializers";
import { materializeInnovationSynthesis } from "../research-writing/innovation-synthesis";
import { materializeWritingHookPolicies } from "../research-writing/hook-policies";
import { materializeIntermediateArtifactHookPolicies } from "../workflow-intermediate-artifact-hook-policies";
import { reconcileAuthoringCloseout } from "../authoring-closeout-reconcile";
import {
  materializeFrontierMappingState,
  shouldMaterializeFrontierMappingState,
} from "../workflow-guard-materializers/frontier-mapping-materializer";
import {
  materializeCodeExperimentBundleImpl,
  shouldMaterializeCodeExperimentBundleImpl,
} from "../workflow-guard-materializers/code-experiment-bundle-materializer";
import { materializeLocalCodeReviewFallback } from "../workflow-guard-materializers/code-review-local-materializer";
import { materializeLocalExperimentExecutionImpl } from "../workflow-guard-materializers/experiment-execution-materializer";
import { materializeAnalysisArtifactsImpl } from "../workflow-guard-materializers/analysis-artifacts-materializer";
import {
  materializeInnovationReflection,
  shouldMaterializeInnovationReflection,
} from "../workflow-guard-materializers/innovation-reflection-materializer";
import { materializePlanStateImpl } from "../workflow-guard-materializers/plan-state-materializer";
import type { WorkflowAutoGateConfig } from "../workflow-auto-mode";
import { materializeRevisionControlState } from "../research-writing/revision-control";
import { materializeSurveyVisualCompiler } from "../research-writing/survey-visual-compiler";
import { materializeSurveyMethodologyConsistency } from "../research-authoring/survey-methodology-consistency";
import { materializeExecutionProofState } from "../workflow-execution-proof-state";
import {
  normalizeInnovationSynthesisState,
  normalizeStoryGapSearchRequisitionState,
} from "../workflow-guard-state/innovation-synthesis";
import {
  normalizeOrchestrationState,
  normalizeReviewIssueTrackerState,
  normalizeWritePackageState,
} from "../workflow-guard-state/execution-state";
import {
  getResearchProgramPlanValidationErrors,
  getResearchProgramValidationErrors,
} from "../workflow-kernel/readiness";
import { normalizeResultsStorylineState } from "../workflow-guard-state/results-storyline";
import { normalizeStorylinePlannerState } from "../workflow-guard-state/storyline-planner";
import { normalizeTitleAbstractIntroWorkbenchState } from "../workflow-guard-state/title-abstract-intro-workbench";
import { loadExperimentReviewState } from "../workflow-auto-experiment-review";
import {
  isBlockingActiveExperimentStatus,
  isTerminalExperimentStatus,
  normalizeExperimentLedger,
} from "../workflow-guard-experiment-history";
import {
  isNonEmptyDirectory,
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { loadTrackInnovationEvidence } from "../workflow-guard-track-evidence.js";
import { resolveStageReadiness } from "../workflow-derived-state/stage-readiness.js";
import type {
  WorkflowHookEvent,
  WorkflowMaterializedArtifact,
} from "../workflow-hooks/contracts";

type ManifestLike = Record<string, unknown>;

type StagePreflightDeps = {
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
  materializeStorylinePlannerState?: (params: {
    projectRoot: string;
    topic?: string | null;
    configuredMode?: "heuristic" | "reviewer_judged" | "learned_shadow" | "learned_primary" | null;
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
  materializeWritingHookPolicies?: (params: {
    projectRoot: string;
    stage: string | null;
    paperMode?: "conference" | "journal" | "survey" | null;
    topTierVerdict?: string | null;
  }) => Promise<unknown>;
  materializeIntermediateArtifactHookPolicies?: (params: {
    projectRoot: string;
    stage: string | null;
    paperMode?: "conference" | "journal" | "survey" | null;
  }) => Promise<unknown>;
  materializeFrontierMappingState?: (params: {
    projectRoot: string;
    manifest?: ManifestLike | null;
  }) => Promise<unknown>;
  materializePlanState?: (params: {
    projectRoot: string;
    planMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeCodeExperimentBundle?: (params: {
    projectRoot: string;
    codeMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeLocalCodeReviewFallback?: (params: {
    projectRoot: string;
    projectId?: string | null;
    autoGate?: WorkflowAutoGateConfig | null;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeLocalExperimentExecution?: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeAnalysisArtifacts?: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeInnovationReflection?: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  reconcileAuthoringCloseout?: (params: {
    projectRoot: string;
    compilePdf?: boolean;
    autoInjectConferenceCitations?: boolean;
    currentStageOverride?: string | null;
  }) => Promise<unknown>;
  materializeRevisionControlState?: (params: {
    projectRoot: string;
    stage: string | null;
  }) => Promise<unknown>;
  materializeExecutionProofState?: (params: {
    projectRoot: string;
  }) => Promise<unknown>;
  materializeSurveyVisualCompiler?: (params: {
    projectRoot: string;
  }) => Promise<unknown>;
  materializeSurveyMethodologyConsistency?: (params: {
    projectRoot: string;
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

const IDEA_CATALYST_PREP_STAGES = new Set([
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const SURVEY_REVIEW_PREP_STAGES = new Set(["survey_review"]);
const PAPERNEXUS_PACKET_PREP_STAGES = new Set([
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const IDEATION_PREP_STAGES = new Set([
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const PAPER_STORY_PREP_STAGES = new Set([
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const STORYLINE_PLANNER_PREP_STAGES = new Set([
  "survey_review",
  "write",
  "review",
  "submit",
]);
const EXPERIMENT_REVIEW_PREP_STAGES = new Set(["experiment"]);
const REVIEW_PRESSURE_PREP_STAGES = new Set(["review", "write", "submit"]);
const LITERATURE_DISCOVERY_PREP_STAGES = new Set([
  "idea",
  "review",
  "write",
  "submit",
]);
const LITERATURE_DISCOVERY_REQUISITION_GRACE_MS = 90_000;
const WRITING_SUPPORT_PREP_STAGES = new Set(["plan", "write", "review", "submit"]);
const INNOVATION_SYNTHESIS_PREP_STAGES = new Set(["write", "review", "submit"]);
const RESULTS_STORYLINE_PREP_STAGES = new Set(["write", "review", "submit"]);
const TITLE_ABSTRACT_INTRO_PREP_STAGES = new Set(["write", "review", "submit"]);
const CYCLE_MEMORY_PREP_STAGES = new Set(["idea", "review", "write", "submit"]);
const CODE_EXPERIMENT_BUNDLE_PREP_STAGES = new Set(["code"]);
const LOCAL_CODE_REVIEW_FALLBACK_PREP_STAGES = new Set(["code"]);
const LOCAL_EXPERIMENT_EXECUTION_PREP_STAGES = new Set(["experiment"]);
const LOCAL_ANALYSIS_ARTIFACTS_PREP_STAGES = new Set([
  "analyze",
  "review",
]);
const LOCAL_AUTHORING_CLOSEOUT_PREP_STAGES = new Set(["write", "review", "submit"]);

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasTerminalIdeaCatalystRequisitionRequest(manifest: ManifestLike): boolean {
  const paperIngestion = normalizePaperIngestionState(manifest.paper_ingestion);
  return paperIngestion.queuedRequests.some(
    (entry) =>
      entry.triggerKind === "idea_catalyst_requisition" &&
      ["completed", "failed"].includes(String(entry.status ?? "").trim().toLowerCase())
  );
}

async function readPathMtimeMsIfExists(targetPath: string | null): Promise<number | null> {
  if (!targetPath) {
    return null;
  }
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

async function anyArtifactMissing(
  projectRoot: string,
  artifactPaths: Array<string | null | undefined>
): Promise<boolean> {
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(projectRoot, artifactPath ?? null);
    if (!resolved || !(await pathExists(resolved))) {
      return true;
    }
  }
  return false;
}

async function latestArtifactMtimeMs(
  projectRoot: string,
  artifactPaths: Array<string | null | undefined>
): Promise<number | null> {
  let latest: number | null = null;
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(projectRoot, artifactPath ?? null);
    const mtimeMs = await readPathMtimeMsIfExists(resolved);
    if (mtimeMs === null) {
      continue;
    }
    latest = latest === null ? mtimeMs : Math.max(latest, mtimeMs);
  }
  return latest;
}

function normalizeStageValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function extractGeneratedFiles(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }
  const record = result as Record<string, unknown>;
  const generatedFiles = record.generatedFiles ?? record.generated_files;
  if (!Array.isArray(generatedFiles)) {
    return [];
  }
  return generatedFiles.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
}

function collectActiveTrackIds(trackRegistry: Record<string, unknown> | null): string[] {
  const tracks = Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [];
  return tracks
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((track) => normalizeStageValue(track.status) === "active")
    .map((track) => {
      const trackId = track.track_id ?? track.trackId;
      return typeof trackId === "string" && trackId.trim().length > 0 ? trackId.trim() : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

async function activeTrackNeedsIdeationScaffold(params: {
  projectRoot: string;
  track: Record<string, unknown>;
}): Promise<boolean> {
  const evidence = await loadTrackInnovationEvidence({
    projectRoot: params.projectRoot,
    track: params.track,
  });
  const readiness = resolveStageReadiness({
    trackEvidence: evidence,
  });
  if (readiness.handoffMode !== "drive_stage") {
    return true;
  }
  const track = params.track;
  const reasoningPacketDir =
    typeof track.reasoning_packet_dir === "string" ? track.reasoning_packet_dir : null;
  const workingMemoryPath =
    typeof track.working_memory_path === "string" ? track.working_memory_path : null;
  const synthesisPacketPath =
    typeof track.synthesis_packet_path === "string" ? track.synthesis_packet_path : null;
  return !(
    reasoningPacketDir &&
    reasoningPacketDir.trim().length > 0 &&
    workingMemoryPath &&
    workingMemoryPath.trim().length > 0 &&
    synthesisPacketPath &&
    synthesisPacketPath.trim().length > 0 &&
    (await isNonEmptyDirectory(
      resolveProjectArtifactPath(params.projectRoot, reasoningPacketDir) ?? ""
    )) &&
    (await pathExists(
      resolveProjectArtifactPath(params.projectRoot, workingMemoryPath) ?? ""
    )) &&
    (await pathExists(
      resolveProjectArtifactPath(params.projectRoot, synthesisPacketPath) ?? ""
    ))
  );
}

async function ideationTrackRegistryNeedsRefresh(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, "TRACK_REGISTRY.json") ?? ""
    )) ?? null;
  const activeTrackIds = collectActiveTrackIds(trackRegistry);
  if (activeTrackIds.length < 1 || activeTrackIds.length > 2) {
    return true;
  }
  const researchProgram = params.manifest.research_program;
  const programTracks = Array.isArray(
    researchProgram && typeof researchProgram === "object"
      ? (researchProgram as Record<string, unknown>).tracks
      : null
  )
    ? ((researchProgram as Record<string, unknown>).tracks as unknown[])
    : [];
  const expectedActiveTrackIds = programTracks
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((track) => normalizeStageValue(track.status) === "active")
    .map((track) => {
      const trackId = track.track_id ?? track.trackId;
      return typeof trackId === "string" && trackId.trim().length > 0 ? trackId.trim() : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (
    expectedActiveTrackIds.length > 0 &&
    expectedActiveTrackIds.some((trackId) => !activeTrackIds.includes(trackId))
  ) {
    return true;
  }
  const tracks = Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [];
  for (const entry of tracks) {
    const track = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!track) {
      continue;
    }
    if (normalizeStageValue(track.status) !== "active") {
      continue;
    }
    if (
      await activeTrackNeedsIdeationScaffold({
        projectRoot: params.projectRoot,
        track,
      })
    ) {
      return true;
    }
  }
  return false;
}

async function shouldMaterializeIdeationContract(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEATION_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const state = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (state.status !== "ready") {
    return true;
  }
  const artifactsMissing = await anyArtifactMissing(params.projectRoot, [
    "researcher/IDEA_REPORT.md",
    "researcher/IDEA_AUDIT.md",
    state.graphIdeationPacketPath,
    state.ideaTreePath,
    state.noveltyTreePath,
    state.challengeInsightTreePath,
    state.solutionCheckPath,
    state.crossDomainTransferPath,
    state.problemDecompositionPath,
    state.candidatePoolPath,
    state.rankingHistoryPath,
    state.tournamentScoreboardPath,
    state.top3SummaryPath,
    state.researchProposalPath,
  ]);
  if (artifactsMissing) {
    return true;
  }
  return await ideationTrackRegistryNeedsRefresh({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
  });
}

async function shouldMaterializePlanState(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (params.stage !== "plan") {
    return false;
  }
  const ideationState = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (ideationState.status !== "ready") {
    return false;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      "orchestrator/PLAN.md",
      "orchestrator/TODOS.md",
      "orchestrator/PLAN_AUDIT.md",
    ])
  ) {
    return true;
  }
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  const researchProgramErrors = [
    ...getResearchProgramValidationErrors(researchProgram),
    ...getResearchProgramPlanValidationErrors({
      state: researchProgram,
      ideationContract: ideationState,
    }),
  ];
  if (researchProgramErrors.length > 0) {
    return true;
  }
  const orchestration = normalizeOrchestrationState(params.manifest.orchestration_state);
  const orchestrationStatus = normalizeStageValue(orchestration.status);
  return (
    !["ready", "running", "waiting", "blocked"].includes(orchestrationStatus ?? "") ||
    !orchestration.currentOwner ||
    normalizeStageValue(orchestration.nextTransitionCandidate) !== "code"
  );
}

async function hasCompleteExperimentBundle(projectRoot: string): Promise<boolean> {
  const coderRoot = resolveProjectArtifactPath(projectRoot, "coder") ?? `${projectRoot}/coder`;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: coderRoot, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (
      (await pathExists(resolveProjectArtifactPath(current.dir, "train.py") ?? "")) &&
      (await pathExists(resolveProjectArtifactPath(current.dir, "README.md") ?? "")) &&
      (await pathExists(
        resolveProjectArtifactPath(current.dir, "EXPERIMENT_MANIFEST.json") ?? ""
      ))
    ) {
      return true;
    }
    if (current.depth >= 3) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "__pycache__") {
        continue;
      }
      queue.push({
        dir: resolveProjectArtifactPath(current.dir, entry.name) ?? `${current.dir}/${entry.name}`,
        depth: current.depth + 1,
      });
    }
  }
  return false;
}

function localCodeReviewFallbackConfigured(): boolean {
  const raw = process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS;
  if (raw == null || raw.trim().length === 0) {
    return false;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

async function shouldMaterializeLocalCodeReviewFallback(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LOCAL_CODE_REVIEW_FALLBACK_PREP_STAGES.has(params.stage)) {
    return false;
  }
  if (!localCodeReviewFallbackConfigured()) {
    return false;
  }
  return hasCompleteExperimentBundle(params.projectRoot);
}

async function shouldMaterializeCodeExperimentBundle(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !CODE_EXPERIMENT_BUNDLE_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const gateState =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, "researcher/GATE_STATE.json")
    )) ?? {};
  if (
    normalizeStageValue(gateState.current_stage) === params.stage &&
    normalizeStageValue(gateState.gate_status) === "waiting"
  ) {
    return false;
  }
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  const activeTracks = researchProgram.tracks.filter(
    (track) => normalizeStageValue(track.status) === "active"
  );
  if (activeTracks.length === 0) {
    return false;
  }
  return shouldMaterializeCodeExperimentBundleImpl({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
  });
}

async function shouldMaterializeLocalExperimentExecution(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LOCAL_EXPERIMENT_EXECUTION_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const experimentSearch =
    params.manifest.experiment_search && typeof params.manifest.experiment_search === "object"
      ? (params.manifest.experiment_search as Record<string, unknown>)
      : {};
  if (
    normalizeStageValue(experimentSearch.status) === "ready_for_analysis" &&
    typeof experimentSearch.evaluation_summary_path === "string" &&
    typeof experimentSearch.plot_pack_path === "string"
  ) {
    return false;
  }
  const autonomousExecution = normalizeAutonomousExecutionState(
    params.manifest.autonomous_execution
  );
  if (autonomousExecution.experimentLaunchMode === "reviewed_auto") {
    return false;
  }
  const ledger =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(
        params.projectRoot,
        "researcher/EXPERIMENT_LEDGER.json"
      ) ?? ""
    )) ?? {};
  const projectId =
    typeof params.manifest.project_id === "string"
      ? params.manifest.project_id
      : typeof params.manifest.projectId === "string"
        ? params.manifest.projectId
        : null;
  const normalizedLedger = normalizeExperimentLedger(ledger, projectId);
  if (
    normalizedLedger.summary.activeExperimentIds.length > 0 ||
    normalizedLedger.experiments.some((entry) =>
      isBlockingActiveExperimentStatus(entry.status) ||
      isTerminalExperimentStatus(entry.status)
    )
  ) {
    return false;
  }
  return await hasCompleteExperimentBundle(params.projectRoot);
}

async function shouldMaterializeAnalysisArtifacts(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LOCAL_ANALYSIS_ARTIFACTS_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const experimentSearch =
    params.manifest.experiment_search && typeof params.manifest.experiment_search === "object"
      ? (params.manifest.experiment_search as Record<string, unknown>)
      : {};
  if (normalizeStageValue(experimentSearch.status) !== "ready_for_analysis") {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  if (
    params.stage !== "analyze" &&
    (paperStory.claimSupportStatus === "unsupported" ||
      paperStory.claimSupportStatus === "partial" ||
      paperStory.unsupportedClaimCount > 0 ||
      paperStory.partialClaimCount > 0)
  ) {
    return false;
  }
  const opportunityScorecard =
    params.manifest.opportunity_scorecard &&
    typeof params.manifest.opportunity_scorecard === "object"
      ? (params.manifest.opportunity_scorecard as Record<string, unknown>)
      : {};
  if (normalizeStageValue(opportunityScorecard.verdict) === "worth_top_tier_bet") {
    const mechanismEvidence =
      params.manifest.mechanism_evidence &&
      typeof params.manifest.mechanism_evidence === "object"
        ? (params.manifest.mechanism_evidence as Record<string, unknown>)
        : {};
    const venueCompetition =
      params.manifest.venue_competition &&
      typeof params.manifest.venue_competition === "object"
        ? (params.manifest.venue_competition as Record<string, unknown>)
        : {};
    const explicitGraphBlockers = [
      normalizeStageValue(mechanismEvidence.graph_context_status),
      normalizeStageValue(venueCompetition.graph_context_status),
    ].filter((status) => status === "unverified_graph_context" || status === "graph_unavailable");
    if (explicitGraphBlockers.length > 0) {
      return false;
    }
  }

  const writingContract = normalizeWritingContractState(params.manifest.writing_contract);
  const requiredArtifacts = [
    "analyzer/NARRATIVE_REPORT.md",
    "analyzer/CLAIM_EVIDENCE_MATRIX.md",
    "analyzer/TRACK_VERDICTS.md",
    "analyzer/UNSUPPORTED_CLAIMS.md",
    "analyzer/QUALITY_AUDIT.md",
    ...(writingContract.proofAppendixRequired
      ? [
          "analyzer/THEORY_SUPPORT_NOTE.md",
          "analyzer/THEORY_STATE.json",
          "academic_writer/THEORY_APPENDIX_PLAN.md",
          "academic_writer/paper/sections/appendix_theory.tex",
        ]
      : []),
  ];
  if (await anyArtifactMissing(params.projectRoot, requiredArtifacts)) {
    return true;
  }
  if (
    writingContract.proofAppendixRequired &&
    !(await isNonEmptyDirectory(
      resolveProjectArtifactPath(params.projectRoot, "analyzer/proof-packets") ?? ""
    ))
  ) {
    return true;
  }
  if (paperStory.claimSupportStatus !== "supported" || paperStory.supportedClaimCount < 1) {
    return true;
  }
  const theorySupport = params.manifest.theory_state;
  if (writingContract.proofAppendixRequired) {
    const theoryRecord =
      theorySupport && typeof theorySupport === "object"
        ? (theorySupport as Record<string, unknown>)
        : {};
    if (
      normalizeStageValue(theoryRecord.status) !== "ready" ||
      normalizeStageValue(theoryRecord.overall_signal) == null ||
      theoryRecord.body_ready !== true
    ) {
      return true;
    }
  }
  return false;
}

async function shouldMaterializeSurveyReviewState(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !SURVEY_REVIEW_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const state = normalizeSurveyReviewState(params.manifest.survey_review);
  const artifactMissing = await anyArtifactMissing(params.projectRoot, [
    state.queryRegistryPath,
    state.includedPapersPath,
    state.excludedPapersPath,
    state.literatureReviewPath,
    state.reviewProtocolPath,
    state.sotaMatrixPath,
    state.gapSynthesisPath,
    state.coverageSummaryPath,
    state.surveyBriefPath,
    state.diagnosticsPath,
  ]);
  return state.status !== "completed" || !state.gateReady || artifactMissing;
}

async function shouldMaterializeIdeaCatalyst(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEA_CATALYST_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideationState = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (ideationState.status !== "ready") {
    return false;
  }
  const state = normalizeIdeaCatalystState(params.manifest.idea_catalyst);
  if (state.status === "requisition") {
    return !hasActiveIdeaCatalystRequisitionRequest({
      ideaCatalyst: state,
      paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
    });
  }
  if (state.status !== "ready") {
    return true;
  }
  return anyArtifactMissing(params.projectRoot, [
    state.decompositionPacketPath,
    state.abstractionPacketPath,
    state.scoutingReportPath,
    state.gateDecisionPath,
    state.ideaFragmentsPath,
    state.rankedFragmentsPath,
  ]);
}

async function shouldQueueIdeaCatalystRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEA_CATALYST_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideaCatalyst = normalizeIdeaCatalystState(params.manifest.idea_catalyst);
  if (!ideaCatalyst.requisitionRequired && ideaCatalyst.status !== "requisition") {
    return false;
  }
  if (ideaCatalyst.requisitionSaturated) {
    return false;
  }
  const requisitionPath = resolveProjectArtifactPath(
    params.projectRoot,
    ideaCatalyst.investigationRequisitionPath
  );
  const requisition =
    requisitionPath
      ? await readJsonIfExists<Record<string, unknown>>(requisitionPath)
      : null;
  if (requisition?.actionable === false) {
    return false;
  }
  if (hasTerminalIdeaCatalystRequisitionRequest(params.manifest)) {
    return false;
  }
  return !hasActiveIdeaCatalystRequisitionRequest({
    ideaCatalyst,
    paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
  });
}

async function shouldMaterializePaperStory(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !PAPER_STORY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideationState = normalizeIdeationContractState(params.manifest.ideation_contract);
  const surveyReviewState = normalizeSurveyReviewState(params.manifest.survey_review);
  const surveyWritingBridgeReady = surveyReviewState.status === "completed";
  if (ideationState.status !== "ready" && !surveyWritingBridgeReady) {
    return false;
  }
  const state = normalizePaperStoryState(params.manifest.paper_story_state);
  if (state.status !== "ready") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      state.taskSummaryPath,
      state.challengeStatementPath,
      state.insightSummaryPath,
      state.contributionMapPath,
      state.advantageMapPath,
      state.storySpinePath,
      state.pipelineFigureSketchPath,
      state.moduleMotivationMapPath,
      state.claimToExperimentMapPath,
      state.fallbackNarrativePath,
      state.rejectionRiskTablePath,
      ...(surveyWritingBridgeReady
        ? [state.surveyStorylinePacketPath, state.surveyStorylineMemoPath]
        : []),
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(state.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(
    params.projectRoot,
    surveyWritingBridgeReady
      ? [
          surveyReviewState.surveyBriefPath,
          surveyReviewState.literatureReviewPath,
          surveyReviewState.gapSynthesisPath,
          surveyReviewState.coverageSummaryPath,
          surveyReviewState.sotaMatrixPath,
          state.surveyStorylinePacketPath,
          state.surveyStorylineMemoPath,
          state.claimEvidenceMatrixPath,
          state.trackVerdictsPath,
          state.unsupportedClaimsPath,
        ]
      : [
          ideationState.researchProposalPath,
          ideationState.problemDecompositionPath,
          ideationState.graphIdeationPacketPath,
          ideationState.graphBasisPaths.storylineBriefPath,
          state.claimEvidenceMatrixPath,
          state.trackVerdictsPath,
          state.unsupportedClaimsPath,
        ]
  );
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeStorylinePlanner(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !STORYLINE_PLANNER_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const surveyReviewState = normalizeSurveyReviewState(params.manifest.survey_review);
  if (surveyReviewState.status !== "completed") {
    return false;
  }
  const current = normalizeStorylinePlannerState(params.manifest.storyline_planner);
  if (current.status === "missing") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      current.candidatePath,
      current.judgePacketPath,
      current.selectionPath,
      current.shadowSelectionPath,
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(current.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    surveyReviewState.surveyBriefPath,
    surveyReviewState.literatureReviewPath,
    surveyReviewState.reviewProtocolPath,
    surveyReviewState.sotaMatrixPath,
    surveyReviewState.gapSynthesisPath,
    surveyReviewState.coverageSummaryPath,
    surveyReviewState.includedPapersPath,
    surveyReviewState.excludedPapersPath,
    surveyReviewState.screeningDecisionsPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeExperimentReview(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !EXPERIMENT_REVIEW_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const autonomousExecution = normalizeAutonomousExecutionState(
    params.manifest.autonomous_execution
  );
  if (autonomousExecution.experimentLaunchMode !== "reviewed_auto") {
    return false;
  }
  const experimentSearch = params.manifest.experiment_search;
  const experimentSearchStatus = normalizeStageValue(
    experimentSearch && typeof experimentSearch === "object"
      ? (experimentSearch as Record<string, unknown>).status
      : null
  );
  if (experimentSearchStatus === "ready_for_analysis") {
    return false;
  }
  const experimentReview = await loadExperimentReviewState({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
  });
  if (experimentReview.status === "missing") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      experimentReview.packetPath,
      experimentReview.plannerPlanPath,
      experimentReview.launchDecisionPath,
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(experimentReview.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const reviewInProgress =
    normalizeStageValue(experimentReview.plannerStatus) === "ready" ||
    normalizeStageValue(experimentReview.analyzerStatus) === "ready" ||
    normalizeStageValue(experimentReview.crossReviewerStatus) === "ready" ||
    normalizeStageValue(experimentReview.analyzerVerdict) != null ||
    normalizeStageValue(experimentReview.crossReviewerVerdict) != null ||
    experimentReview.launchApproved === true;
  if (reviewInProgress) {
    return false;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    "TRACK_REGISTRY.json",
    "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json",
    "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json",
    "researcher/papernexus/GRAPH_STORYLINE_PACKET.json",
    experimentReview.analyzerReportPath,
    experimentReview.crossReviewerReportPath,
    experimentReview.launchDecisionPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeReviewPressure(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !REVIEW_PRESSURE_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStoryState = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStoryState.status !== "ready") {
    return false;
  }
  const state = normalizeReviewPressurePacketState(params.manifest.review_pressure_packet);
  if (state.status !== "ready") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      state.rejectFirstReviewPath,
      state.noveltyAttackPath,
      state.unsupportedClaimAuditPath,
      state.reverseOutlinePath,
      state.figureTableQcPath,
      state.limitationAuditPath,
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(state.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStoryState.storySpinePath,
    paperStoryState.claimToExperimentMapPath,
    paperStoryState.fallbackNarrativePath,
    paperStoryState.rejectionRiskTablePath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeLiteratureDiscoveryPacket(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LITERATURE_DISCOVERY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  const packetExists = Boolean(packetResolvedPath && (await pathExists(packetResolvedPath)));
  const literatureDiscoveryNeed = await getWorkflowLiteratureDiscoveryNeed({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    stage: params.stage,
  });
  if (!literatureDiscoveryNeed.required && !packetExists) {
    return false;
  }
  if (!packetResolvedPath || !(await pathExists(packetResolvedPath))) {
    return true;
  }
  const packetTimestamp = await readPathMtimeMsIfExists(packetResolvedPath);
  if (packetTimestamp === null) {
    return true;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  const reviewPressure = normalizeReviewPressurePacketState(params.manifest.review_pressure_packet);
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStory.challengeStatementPath,
    paperStory.insightSummaryPath,
    paperStory.unsupportedClaimsPath,
    paperStory.rejectionRiskTablePath,
    reviewPressure.rejectFirstReviewPath,
    reviewPressure.noveltyAttackPath,
    reviewPressure.limitationAuditPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > packetTimestamp;
}

async function shouldMaterializePapernexusPacketContracts(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !PAPERNEXUS_PACKET_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const artifacts = await inspectPapernexusBridgeArtifacts({
    projectRoot: params.projectRoot,
  });
  return artifacts.anyArtifactsPresent;
}

async function shouldQueueLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LITERATURE_DISCOVERY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  const packetExists = Boolean(packetResolvedPath && (await pathExists(packetResolvedPath)));
  const literatureDiscoveryNeed = await getWorkflowLiteratureDiscoveryNeed({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    stage: params.stage,
  });
  if (!literatureDiscoveryNeed.required) {
    return false;
  }
  if (!packetExists) {
    return true;
  }
  return !hasActiveLiteratureDiscoveryRequest({
    paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
  });
}

async function reconcileSatisfiedLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<{ manifest: ManifestLike; updated: boolean }> {
  if (!params.stage || !LITERATURE_DISCOVERY_PREP_STAGES.has(params.stage)) {
    return { manifest: params.manifest, updated: false };
  }
  const literatureDiscoveryNeed = await getWorkflowLiteratureDiscoveryNeed({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    stage: params.stage,
  });
  if (literatureDiscoveryNeed.required) {
    return { manifest: params.manifest, updated: false };
  }

  const state = normalizePaperIngestionState(params.manifest.paper_ingestion);
  const now = new Date().toISOString();
  let updated = false;
  const queuedRequests = state.queuedRequests.map((request) => {
    const dormantQueued =
      request.status === "queued" &&
      !request.startedAt &&
      !request.lastRunId &&
      !request.lastSessionKey &&
      request.attemptCount === 0;
    const obsoleteRepair = request.status === "needs_repair";
    if (
      !isLiteratureDiscoveryTriggerKind(request.triggerKind) ||
      (!dormantQueued && !obsoleteRepair)
    ) {
      return request;
    }
    updated = true;
    return {
      ...request,
      status: "completed" as const,
      updatedAt: now,
      finishedAt: request.finishedAt ?? now,
      detail:
        request.detail ??
        "Literature discovery request was satisfied by current workflow state before launch.",
      deadLetterReason: null,
      lastError: null,
    };
  });

  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  if (packetResolvedPath && (await pathExists(packetResolvedPath))) {
    const packet =
      (await readJsonIfExists<Record<string, unknown>>(packetResolvedPath)) ?? {};
    if (packet.evidence_gap_closed !== true) {
      updated = true;
      await writeJsonEnsured(packetResolvedPath, {
        ...packet,
        evidence_gap_closed: true,
        closure_reason: "workflow_state_satisfied",
        trigger: "workflow_preflight_reconciled",
        last_updated_at: now,
      });
    }
  }

  if (!updated) {
    return { manifest: params.manifest, updated: false };
  }

  const manifest = {
    ...params.manifest,
    paper_ingestion: serializePaperIngestionState({
      ...state,
      queuedRequests,
      lastUpdatedAt: now,
    }),
  };
  await writeJsonEnsured(
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ??
      `${params.projectRoot}/PROJECT_MANIFEST.json`,
    manifest
  );
  return { manifest, updated: true };
}

function isGraphPresenceReady(manifest: ManifestLike): boolean {
  return readManifestStatus(manifest.paper_ingestion, [
    "graph_presence_status",
    "graphPresenceStatus",
  ]) === "ready";
}

function isStaleUnresolvedLiteratureDiscoveryRequisition(
  request: ReturnType<typeof normalizePaperIngestionState>["queuedRequests"][number],
  nowMs: number
): boolean {
  if (!isLiteratureDiscoveryTriggerKind(request.triggerKind)) {
    return false;
  }
  if (request.requestKind !== "requisition") {
    return false;
  }
  if (!["queued", "launching", "running"].includes(request.status)) {
    return false;
  }
  const reference =
    request.createdAt ?? request.startedAt ?? request.lastAttemptAt ?? request.updatedAt;
  const referenceMs = parseTimestampMs(reference);
  return (
    referenceMs !== null &&
    nowMs - referenceMs >= LITERATURE_DISCOVERY_REQUISITION_GRACE_MS
  );
}

function deriveLiteratureDiscoverySatisfactionReportPath(request: {
  requestId: string;
  manifestPath: string | null;
}): string {
  if (request.manifestPath?.includes("/")) {
    return `${request.manifestPath.split("/").slice(0, -1).join("/")}/REQUISITION_SATISFACTION_REPORT.json`;
  }
  return `researcher/literature-discovery/requisition/${request.requestId}/REQUISITION_SATISFACTION_REPORT.json`;
}

async function reconcileStaleLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<{ manifest: ManifestLike; updated: boolean }> {
  if (params.stage !== "graph_build" || !isGraphPresenceReady(params.manifest)) {
    return { manifest: params.manifest, updated: false };
  }

  const state = normalizePaperIngestionState(params.manifest.paper_ingestion);
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const staleRequests = state.queuedRequests.filter((request) =>
    isStaleUnresolvedLiteratureDiscoveryRequisition(request, nowMs)
  );
  if (staleRequests.length === 0) {
    return { manifest: params.manifest, updated: false };
  }

  const packetPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  const packet =
    (await readJsonIfExists<Record<string, unknown>>(packetPath ?? "")) ?? {};
  const selectedPapers = Array.isArray(packet.selected_papers)
    ? packet.selected_papers
    : [];
  const candidatePapers = Array.isArray(packet.candidate_papers)
    ? packet.candidate_papers
    : [];
  const graphPresencePath =
    readManifestString(params.manifest.paper_ingestion, [
      "graph_presence_report_path",
      "graphPresenceReportPath",
    ]) ?? "graph/GRAPH_PRESENCE_CHECK.json";

  const updatedRequestIds = new Set(staleRequests.map((request) => request.requestId));
  for (const request of staleRequests) {
    const reportPath = deriveLiteratureDiscoverySatisfactionReportPath(request);
    const resolvedReportPath = resolveProjectArtifactPath(params.projectRoot, reportPath);
    if (resolvedReportPath) {
      await writeJsonEnsured(resolvedReportPath, {
        schema_version: 1,
        status: "warning",
        decision: "degraded_satisfied_current_graph",
        request_id: request.requestId,
        trigger_kind: request.triggerKind,
        graph_presence_status: "ready",
        graph_presence_report_path: graphPresencePath,
        selected_paper_count: selectedPapers.length,
        candidate_paper_count: candidatePapers.length,
        reason:
          "Graph presence is already ready and the bounded no-Discord literature discovery requisition did not produce additional durable import evidence within the local grace window.",
        limitations: [
          "No additional PaperNexus import was credited to this requisition.",
          "Downstream writing/review may continue using the current graph while preserving this warning for audit.",
        ],
        created_at: now,
        updated_at: now,
      });
    }
  }

  const queuedRequests = state.queuedRequests.map((request) => {
    if (!updatedRequestIds.has(request.requestId)) {
      return request;
    }
    const reportPath = deriveLiteratureDiscoverySatisfactionReportPath(request);
    return {
      ...request,
      status: "completed" as const,
      updatedAt: now,
      finishedAt: request.finishedAt ?? now,
      lastError: null,
      validationStatus: "warning" as const,
      validationSummary:
        "No-Discord literature discovery grace window elapsed after graph presence was ready; current graph accepted with a durable warning report.",
      validationReportPath: reportPath,
      detail:
        request.detail ??
        "Literature discovery request was degradably satisfied by the current ready graph state.",
      deadLetterAt: null,
      deadLetterReason: null,
    };
  });

  const paperIngestionRecord =
    params.manifest.paper_ingestion &&
    typeof params.manifest.paper_ingestion === "object" &&
    !Array.isArray(params.manifest.paper_ingestion)
      ? (params.manifest.paper_ingestion as Record<string, unknown>)
      : {};
  const manifest = {
    ...params.manifest,
    paper_ingestion: {
      ...paperIngestionRecord,
      ...serializePaperIngestionState({
        ...state,
        runtimeStatus: "ready",
        waitingReason: null,
        queuedRequests,
        lastUpdatedAt: now,
      }),
    },
  };
  await writeJsonEnsured(
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ??
      `${params.projectRoot}/PROJECT_MANIFEST.json`,
    manifest
  );
  return { manifest, updated: true };
}

function sanitizeArtifactPathFragment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "request"
  );
}

function isTerminalGraphReadyUploadFailureRequest(
  request: ReturnType<typeof normalizePaperIngestionState>["queuedRequests"][number]
): boolean {
  if (!isPaperIngestionExecutableUploadRequest(request)) {
    return false;
  }
  if (request.status !== "needs_repair" && request.status !== "failed") {
    return false;
  }
  return request.validationStatus === "valid" || request.validationStatus === "warning";
}

function deriveGraphReadyUploadFailureReportPath(request: {
  requestId: string;
}): string {
  return `graph/paper-ingestion-validation/${sanitizeArtifactPathFragment(
    request.requestId
  )}-graph-ready-degraded.json`;
}

function readGraphPresenceSnapshot(manifest: ManifestLike): Record<string, unknown> {
  return {
    status: readManifestStatus(manifest.paper_ingestion, [
      "graph_presence_status",
      "graphPresenceStatus",
    ]),
    report_path:
      readManifestString(manifest.paper_ingestion, [
        "graph_presence_report_path",
        "graphPresenceReportPath",
      ]) ?? "graph/GRAPH_PRESENCE_CHECK.json",
    expected_paper_count: readManifestNumber(manifest.paper_ingestion, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
      "graph_presence_expected_paper_count",
      "graphPresenceExpectedPaperCount",
    ]),
    present_paper_count: readManifestNumber(manifest.paper_ingestion, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
      "graph_presence_present_paper_count",
      "graphPresencePresentPaperCount",
    ]),
    missing_paper_count: readManifestNumber(manifest.paper_ingestion, [
      "graph_presence_missing_paper_count",
      "graphPresenceMissingPaperCount",
      "graph_presence_missing_count",
      "graphPresenceMissingCount",
    ]),
  };
}

function isTerminalBatchStatus(value: unknown): boolean {
  const status = normalizeStageValue(value);
  return status === "failed" || status === "timed_out";
}

function isTerminalBatchItemStatus(value: unknown): boolean {
  const status = normalizeStageValue(value);
  return status === "failed" || status === "submit_failed" || status === "timed_out";
}

async function reconcileTerminalPaperIngestionUploadFailuresWhenGraphReady(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<{ manifest: ManifestLike; updated: boolean }> {
  if (params.stage !== "graph_build" || !isGraphPresenceReady(params.manifest)) {
    return { manifest: params.manifest, updated: false };
  }

  const state = normalizePaperIngestionState(params.manifest.paper_ingestion);
  const terminalRequests = state.queuedRequests.filter(
    isTerminalGraphReadyUploadFailureRequest
  );
  if (terminalRequests.length === 0) {
    return { manifest: params.manifest, updated: false };
  }

  const now = new Date().toISOString();
  const terminalRequestIds = new Set(
    terminalRequests.map((request) => request.requestId)
  );
  const terminalManifestPaths = new Set(
    terminalRequests
      .map((request) => request.manifestPath)
      .filter((entry): entry is string => Boolean(entry))
  );
  const graphPresence = readGraphPresenceSnapshot(params.manifest);

  for (const request of terminalRequests) {
    const reportPath = deriveGraphReadyUploadFailureReportPath(request);
    const resolvedReportPath = resolveProjectArtifactPath(params.projectRoot, reportPath);
    if (!resolvedReportPath) {
      continue;
    }
    await writeJsonEnsured(resolvedReportPath, {
      schema_version: 1,
      status: "warning",
      decision: "degraded_satisfied_current_graph",
      request_id: request.requestId,
      request_kind: request.requestKind,
      trigger_kind: request.triggerKind,
      manifest_path: request.manifestPath,
      previous_status: request.status,
      previous_last_error: request.lastError,
      previous_dead_letter_at: request.deadLetterAt,
      previous_dead_letter_reason: request.deadLetterReason,
      previous_validation_status: request.validationStatus,
      previous_validation_report_path: request.validationReportPath,
      graph_presence: graphPresence,
      reason:
        "PaperNexus upload reached a terminal failure after graph presence was already ready; the current graph is authoritative for stage advancement.",
      limitations: [
        "No additional PaperNexus import completion is credited to this request.",
        "The terminal upload failure is preserved in this report instead of keeping workflow runtime blocked.",
      ],
      created_at: now,
      updated_at: now,
    });
  }

  const queuedRequests = state.queuedRequests.map((request) => {
    if (!terminalRequestIds.has(request.requestId)) {
      return request;
    }
    const reportPath = deriveGraphReadyUploadFailureReportPath(request);
    return {
      ...request,
      status: "completed" as const,
      updatedAt: now,
      finishedAt: request.finishedAt ?? now,
      lastError: null,
      detail:
        "Terminal PaperNexus upload failure was degradably satisfied because graph presence is already ready.",
      validationStatus: "warning" as const,
      validationSummary:
        "PaperNexus upload reached a terminal failure after graph presence was ready; current graph accepted with a durable warning report.",
      validationReportPath: reportPath,
      nextRetryAt: null,
      deadLetterAt: null,
      deadLetterReason: null,
    };
  });

  const activeBatches = state.activeBatches.filter((batch) => {
    if (!isTerminalBatchStatus(batch.status)) {
      return true;
    }
    return batch.manifestPath ? !terminalManifestPaths.has(batch.manifestPath) : false;
  });
  const batchItems = state.batchItems.filter((item) => {
    if (!isTerminalBatchItemStatus(item.status)) {
      return true;
    }
    return item.manifestPath ? !terminalManifestPaths.has(item.manifestPath) : false;
  });

  const paperIngestionRecord =
    params.manifest.paper_ingestion &&
    typeof params.manifest.paper_ingestion === "object" &&
    !Array.isArray(params.manifest.paper_ingestion)
      ? (params.manifest.paper_ingestion as Record<string, unknown>)
      : {};
  const manifest = {
    ...params.manifest,
    paper_ingestion: {
      ...paperIngestionRecord,
      ...serializePaperIngestionState({
        ...state,
        runtimeStatus: "ready",
        waitingReason: null,
        activeBatches,
        batchItems,
        queuedRequests,
        repairRequired: false,
        repairReason: null,
        reconcileRequired: false,
        lastUpdatedAt: now,
      }),
      refresh_required: false,
    },
  };
  await writeJsonEnsured(
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ??
      `${params.projectRoot}/PROJECT_MANIFEST.json`,
    manifest
  );
  return { manifest, updated: true };
}

async function shouldMaterializeWritingSupport(params: {
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !WRITING_SUPPORT_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  return paperStory.status === "ready";
}

async function shouldRefreshCycleMemory(params: {
  stage: string | null;
}): Promise<boolean> {
  return Boolean(params.stage && CYCLE_MEMORY_PREP_STAGES.has(params.stage));
}

async function shouldMaterializeInnovationSynthesis(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !INNOVATION_SYNTHESIS_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStory.status !== "ready") {
    return false;
  }
  const current = normalizeInnovationSynthesisState(
    params.manifest.innovation_synthesis_state
  );
  const storyGap = normalizeStoryGapSearchRequisitionState(
    params.manifest.story_gap_search_requisition
  );
  const writePackage = normalizeWritePackageState(params.manifest.write_package);
  if (current.status === "missing") {
    return true;
  }
  if (storyGap.status === "queued" || storyGap.status === "running") {
    return true;
  }
  const stateTimestamp = parseTimestampMs(current.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStory.storySpinePath,
    paperStory.contributionToStoryBridgePath,
    paperStory.claimToExperimentMapPath,
    paperStory.claimEvidenceMatrixPath,
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    "academic_writer/RESULTS_QUESTION_ORDER.md",
    writePackage.evaluationSummaryPath,
    writePackage.ablationSummaryPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeResultsStoryline(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !RESULTS_STORYLINE_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStory.status !== "ready") {
    return false;
  }
  const current = normalizeResultsStorylineState(params.manifest.results_storyline);
  if (current.status === "missing") {
    return true;
  }
  const stateTimestamp = parseTimestampMs(current.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const writePackage = normalizeWritePackageState(params.manifest.write_package);
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStory.storySpinePath,
    paperStory.claimToExperimentMapPath,
    paperStory.claimEvidenceMatrixPath,
    paperStory.trackVerdictsPath,
    paperStory.unsupportedClaimsPath,
    paperStory.surveyStorylinePacketPath,
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    writePackage.evaluationSummaryPath,
    writePackage.ablationSummaryPath,
    "academic_writer/SURVEY_SECTION_BRIEFS.md",
    "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
    "academic_writer/SURVEY_SELF_REVIEW.md",
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeTitleAbstractIntroWorkbench(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !TITLE_ABSTRACT_INTRO_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStory.status !== "ready") {
    return false;
  }
  const current = normalizeTitleAbstractIntroWorkbenchState(
    params.manifest.title_abstract_intro_workbench
  );
  if (current.status === "missing") {
    return true;
  }
  const stateTimestamp = parseTimestampMs(current.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const resultsStoryline = normalizeResultsStorylineState(params.manifest.results_storyline);
  const innovationSynthesis = normalizeInnovationSynthesisState(
    params.manifest.innovation_synthesis_state
  );
  const reviewPressure = normalizeReviewPressurePacketState(
    params.manifest.review_pressure_packet
  );
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStory.storySpinePath,
    paperStory.challengeStatementPath,
    paperStory.contributionToStoryBridgePath,
    paperStory.claimToExperimentMapPath,
    paperStory.fallbackNarrativePath,
    reviewPressure.reverseOutlinePath,
    reviewPressure.limitationAuditPath,
    resultsStoryline.resultsQuestionOrderPath,
    innovationSynthesis.synthesisMemoPath,
    innovationSynthesis.integratedContributionStatementPath,
    "academic_writer/paper/main.tex",
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

function countBibEntries(source: string | null) {
  return [...String(source ?? "").matchAll(/@\w+\s*\{/g)].length;
}

function readManifestStatus(value: unknown, fields: string[]) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  for (const field of fields) {
    const normalized = normalizeStageValue(record[field]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function readManifestString(value: unknown, fields: string[]) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  for (const field of fields) {
    const raw = record[field];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readManifestNumber(value: unknown, fields: string[]) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  for (const field of fields) {
    const raw = record[field];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function isExplicitFailureStatus(status: string | null) {
  return ["blocked", "failed", "fail", "needs_revision", "rejected"].includes(status ?? "");
}

function hasHardAuthoringBlocker(manifest: ManifestLike) {
  const paperQcStatus = readManifestStatus(manifest.paper_qc, ["status"]);
  const compileStatus = readManifestStatus(manifest.paper_qc, [
    "compile_status",
    "compileStatus",
  ]);
  if (isExplicitFailureStatus(paperQcStatus) || isExplicitFailureStatus(compileStatus)) {
    return true;
  }

  const figureQcStatus = readManifestStatus(manifest.figure_qc, ["status"]);
  const captionStatus = readManifestStatus(manifest.figure_qc, [
    "caption_alignment_status",
    "captionAlignmentStatus",
  ]);
  const textStatus = readManifestStatus(manifest.figure_qc, [
    "text_alignment_status",
    "textAlignmentStatus",
  ]);
  const selectionStatus = readManifestStatus(manifest.figure_qc, [
    "selection_status",
    "selectionStatus",
  ]);
  if (
    isExplicitFailureStatus(figureQcStatus) ||
    isExplicitFailureStatus(captionStatus) ||
    isExplicitFailureStatus(textStatus) ||
    isExplicitFailureStatus(selectionStatus)
  ) {
    return true;
  }

  const citationStatus = readManifestStatus(manifest.citation_integrity, [
    "verification_status",
    "verificationStatus",
  ]);
  const hallucinatedCitationCount =
    readManifestNumber(manifest.citation_integrity, [
      "hallucinated_citation_count",
      "hallucinatedCitationCount",
    ]) ?? 0;
  const citationRecord =
    manifest.citation_integrity &&
    typeof manifest.citation_integrity === "object" &&
    !Array.isArray(manifest.citation_integrity)
      ? (manifest.citation_integrity as Record<string, unknown>)
      : {};
  if (
    isExplicitFailureStatus(citationStatus) ||
    hallucinatedCitationCount > 0 ||
      citationRecord.all_citations_real === false
  ) {
    return true;
  }

  return false;
}

function hasStaleReviewCloseoutIssue(manifest: ManifestLike) {
  const issueTracker = normalizeReviewIssueTrackerState(manifest.review_issue_tracker);
  return issueTracker.issues.some((issue) => {
    if (issue.status === "resolved" || issue.status === "waived") {
      return false;
    }
    return issue.issueId === "review-report-stale-after-authoring-refresh";
  });
}

async function reviewReportContainsNegativeVerdict(projectRoot: string): Promise<boolean> {
  const reviewReportPath = resolveProjectArtifactPath(
    projectRoot,
    "reviewer/REVIEW_REPORT.md"
  );
  const reviewReport = await readTextIfExists(reviewReportPath);
  if (!reviewReport) {
    return false;
  }
  try {
    const parsed = JSON.parse(reviewReport) as Record<string, unknown>;
    const status = normalizeStageValue(parsed.status);
    const verdict = normalizeStageValue(parsed.verdict);
    const negativeVerdicts = [
      "needs_revision",
      "not_ready",
      "major_revision",
      "reject",
      "rejected",
    ];
    return [status, verdict].some((value) =>
      negativeVerdicts.includes(value ?? "")
    );
  } catch {
    return /needs[_ -]?revision|not[_ -]?ready|major[_ -]?revision|\\breject(?:ed)?\\b/i.test(
      reviewReport
    );
  }
}

async function shouldReconcileAuthoringCloseout(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LOCAL_AUTHORING_CLOSEOUT_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const writingContract = normalizeWritingContractState(params.manifest.writing_contract);
  if (writingContract.paperMode === "survey") {
    return false;
  }
  if (
    params.stage === "write" &&
    !writingContract.kgStorylineRequired &&
    writingContract.paperMode !== "conference"
  ) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStory.status !== "ready") {
    return false;
  }
  if (hasHardAuthoringBlocker(params.manifest)) {
    return false;
  }
  if (params.stage === "submit") {
    const externalReview =
      params.manifest.external_review_state &&
      typeof params.manifest.external_review_state === "object" &&
      !Array.isArray(params.manifest.external_review_state)
        ? (params.manifest.external_review_state as Record<string, unknown>)
        : {};
    const externalReviewStatus = readManifestStatus(externalReview, ["status"]);
    if (
      externalReviewStatus &&
      !["missing", "pending", "none", "received"].includes(externalReviewStatus)
    ) {
      return false;
    }
  }
  const writePackage = normalizeWritePackageState(params.manifest.write_package);
  if (
    !["ready", "assembled", "approved"].includes(normalizeStageValue(writePackage.status) ?? "") &&
    !["write", "review"].includes(params.stage)
  ) {
    return false;
  }

  const mainTexPath =
    resolveProjectArtifactPath(params.projectRoot, "academic_writer/paper/main.tex") ??
    `${params.projectRoot}/academic_writer/paper/main.tex`;
  const refsBibPath =
    resolveProjectArtifactPath(params.projectRoot, "academic_writer/paper/refs.bib") ??
    `${params.projectRoot}/academic_writer/paper/refs.bib`;
  const mainTex = await readTextIfExists(mainTexPath);
  if (!mainTex || !/\\begin\{document\}/.test(mainTex) || (mainTex.match(/\\section\*?\{/g) ?? []).length < 6) {
    return true;
  }
  const refsBib = await readTextIfExists(refsBibPath);
  if (countBibEntries(refsBib) < 6) {
    return true;
  }
  const kgPacketPath = resolveProjectArtifactPath(
    params.projectRoot,
    writingContract.kgStorylinePacketPath ?? "academic_writer/KG_STORYLINE_PACKET.md"
  );
  if (
    writingContract.kgStorylineRequired &&
    (writingContract.kgStorylineStatus !== "ready" || !kgPacketPath || !(await pathExists(kgPacketPath)))
  ) {
    return true;
  }
  if (
    readManifestStatus(params.manifest.writing_session, ["status", "process_status"]) !==
    "ready_for_submit"
  ) {
    return true;
  }
  const citationStatus = readManifestStatus(params.manifest.citation_integrity, [
    "verification_status",
    "verificationStatus",
  ]);
  const citationRecord =
    params.manifest.citation_integrity &&
    typeof params.manifest.citation_integrity === "object" &&
    !Array.isArray(params.manifest.citation_integrity)
      ? (params.manifest.citation_integrity as Record<string, unknown>)
      : {};
  if (citationStatus !== "verified" || citationRecord.all_citations_real !== true) {
    return true;
  }
  if (params.stage === "submit") {
    const externalReview =
      params.manifest.external_review_state &&
      typeof params.manifest.external_review_state === "object" &&
      !Array.isArray(params.manifest.external_review_state)
        ? (params.manifest.external_review_state as Record<string, unknown>)
        : {};
    const externalReviewStatus = readManifestStatus(externalReview, ["status"]);
    if (
      externalReviewStatus &&
      !["missing", "pending", "none", "received"].includes(externalReviewStatus)
    ) {
      return false;
    }
  }
  const reviewPacketPath = resolveProjectArtifactPath(
    params.projectRoot,
    "reviewer/REVIEW_PACKET.json"
  );
  if (!reviewPacketPath || !(await pathExists(reviewPacketPath))) {
    return true;
  }
  const surfaceReviewPath = resolveProjectArtifactPath(
    params.projectRoot,
    "reviewer/SURFACE_REVIEW.json"
  );
  const figureSelectionReviewPath = resolveProjectArtifactPath(
    params.projectRoot,
    "reviewer/FIGURE_SELECTION_REVIEW.json"
  );
  if (
    !surfaceReviewPath ||
    !figureSelectionReviewPath ||
    !(await pathExists(surfaceReviewPath)) ||
    !(await pathExists(figureSelectionReviewPath))
  ) {
    return true;
  }
  if (
    hasStaleReviewCloseoutIssue(params.manifest) &&
    (await reviewReportContainsNegativeVerdict(params.projectRoot))
  ) {
    return true;
  }
  if (readManifestStatus(params.manifest.paragraph_logic_audit, ["status"]) !== "ready") {
    return true;
  }
  if (params.stage === "submit") {
    const externalReview =
      params.manifest.external_review_state &&
      typeof params.manifest.external_review_state === "object" &&
      !Array.isArray(params.manifest.external_review_state)
        ? (params.manifest.external_review_state as Record<string, unknown>)
        : {};
    const externalReviewStatus = readManifestStatus(externalReview, ["status"]);
    const externalReviewPath =
      typeof externalReview.external_review_path === "string"
        ? externalReview.external_review_path
        : typeof externalReview.externalReviewPath === "string"
          ? externalReview.externalReviewPath
          : null;
    const reviewResponsePath =
      typeof externalReview.review_response_path === "string"
        ? externalReview.review_response_path
        : typeof externalReview.reviewResponsePath === "string"
          ? externalReview.reviewResponsePath
          : null;
    const externalReviewResolvedPath = resolveProjectArtifactPath(
      params.projectRoot,
      externalReviewPath
    );
    const reviewResponseResolvedPath = resolveProjectArtifactPath(
      params.projectRoot,
      reviewResponsePath
    );
    const simulatedReviewResolvedPath = resolveProjectArtifactPath(
      params.projectRoot,
      "reviewer/SIMULATED_EXTERNAL_REVIEW.md"
    );
    if (
      externalReviewStatus !== "received" ||
      typeof externalReview.overall_recommendation !== "string" ||
      !externalReviewResolvedPath ||
      !reviewResponseResolvedPath ||
      !simulatedReviewResolvedPath ||
      !(await pathExists(externalReviewResolvedPath)) ||
      !(await pathExists(reviewResponseResolvedPath)) ||
      !(await pathExists(simulatedReviewResolvedPath))
    ) {
      return true;
    }
  }
  const figureRegistry = await readJsonIfExists<Record<string, unknown>>(
    resolveProjectArtifactPath(params.projectRoot, "academic_writer/FIGURE_REGISTRY.json")
  );
  const tableRegistry = await readJsonIfExists<Record<string, unknown>>(
    resolveProjectArtifactPath(params.projectRoot, "academic_writer/TABLE_REGISTRY.json")
  );
  const figureCount =
    typeof figureRegistry?.totalFigureCount === "number" ? figureRegistry.totalFigureCount : 0;
  const tableCount =
    typeof tableRegistry?.totalTableCount === "number" ? tableRegistry.totalTableCount : 0;
  const frameworkFigureCount =
    typeof figureRegistry?.frameworkFigureCount === "number"
      ? figureRegistry.frameworkFigureCount
      : 0;
  const experimentTableCount =
    typeof tableRegistry?.experimentTableCount === "number"
      ? tableRegistry.experimentTableCount
      : 0;
  return figureCount < 5 || tableCount < 4 || frameworkFigureCount < 1 || experimentTableCount < 2;
}

export async function maybePrepareWorkflowStageContracts(params: {
  projectRoot: string;
  manifest?: ManifestLike | null;
  stage: string | null;
  agentId?: string | null;
  trigger?: string | null;
  autoGate?: WorkflowAutoGateConfig | null;
  deps: StagePreflightDeps;
}): Promise<{
  manifest: ManifestLike;
  materializedContracts: string[];
  materializedArtifacts: WorkflowMaterializedArtifact[];
  emittedHookEvents: WorkflowHookEvent[];
  errors: Array<{ contract: string; message: string }>;
}> {
  const projectRoot = params.projectRoot;
  let manifest =
    params.manifest ??
    ((await readJsonIfExists<ManifestLike>(resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json"))) ??
      {});
  const materializedContracts: string[] = [];
  const errors: Array<{ contract: string; message: string }> = [];
  const trigger = params.trigger ?? "stage_preflight";

  const materializedArtifacts: WorkflowMaterializedArtifact[] = [];
  const emittedHookEvents: WorkflowHookEvent[] = [];

  const ideaCatalystReconciliation = await reconcileSatisfiedIdeaCatalystRequisition({
    projectRoot,
    manifest,
  });
  if (ideaCatalystReconciliation.updated) {
    manifest = ideaCatalystReconciliation.manifest;
    materializedContracts.push("idea_catalyst_requisition_reconciled");
    materializedArtifacts.push({
      contract: "idea_catalyst_requisition_reconciled",
      artifactPath: null,
      fingerprint: null,
      action: "reconciled",
    });
    emittedHookEvents.push({
      hookPoint: "artifact_materialized",
      contract: "idea_catalyst_requisition_reconciled",
      artifactPath: null,
    });
  }
  const literatureDiscoveryReconciliation =
    await reconcileSatisfiedLiteratureDiscoveryRequisition({
      projectRoot,
      manifest,
      stage: params.stage,
    });
  if (literatureDiscoveryReconciliation.updated) {
    manifest = literatureDiscoveryReconciliation.manifest;
    materializedContracts.push("literature_discovery_requisition_reconciled");
    materializedArtifacts.push({
      contract: "literature_discovery_requisition_reconciled",
      artifactPath: null,
      fingerprint: null,
      action: "reconciled",
    });
    emittedHookEvents.push({
      hookPoint: "artifact_materialized",
      contract: "literature_discovery_requisition_reconciled",
      artifactPath: null,
    });
  }
  const staleLiteratureDiscoveryReconciliation =
    await reconcileStaleLiteratureDiscoveryRequisition({
      projectRoot,
      manifest,
      stage: params.stage,
    });
  if (staleLiteratureDiscoveryReconciliation.updated) {
    manifest = staleLiteratureDiscoveryReconciliation.manifest;
    materializedContracts.push("literature_discovery_requisition_degraded");
    materializedArtifacts.push({
      contract: "literature_discovery_requisition_degraded",
      artifactPath: null,
      fingerprint: null,
      action: "reconciled",
    });
    emittedHookEvents.push({
      hookPoint: "artifact_materialized",
      contract: "literature_discovery_requisition_degraded",
      artifactPath: null,
    });
  }
  const graphReadyUploadFailureReconciliation =
    await reconcileTerminalPaperIngestionUploadFailuresWhenGraphReady({
      projectRoot,
      manifest,
      stage: params.stage,
    });
  if (graphReadyUploadFailureReconciliation.updated) {
    manifest = graphReadyUploadFailureReconciliation.manifest;
    materializedContracts.push("paper_ingestion_terminal_upload_degraded");
    materializedArtifacts.push({
      contract: "paper_ingestion_terminal_upload_degraded",
      artifactPath: null,
      fingerprint: null,
      action: "reconciled",
    });
    emittedHookEvents.push({
      hookPoint: "artifact_materialized",
      contract: "paper_ingestion_terminal_upload_degraded",
      artifactPath: null,
    });
  }

  const runStep = async (
    contract: string,
    shouldRun: (input: { projectRoot: string; manifest: ManifestLike; stage: string | null }) => Promise<boolean>,
    action: () => Promise<unknown>
  ) => {
    if (!(await shouldRun({ projectRoot, manifest, stage: params.stage }))) {
      return;
    }
    try {
      const result = await action();
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (result as Record<string, unknown>).materialized === false
      ) {
        return;
      }
      materializedContracts.push(contract);
      const generatedFiles = extractGeneratedFiles(result);
      if (generatedFiles.length > 0) {
        for (const generatedFile of generatedFiles) {
          materializedArtifacts.push({
            contract,
            artifactPath: generatedFile,
            fingerprint: null,
            action: "updated",
            kind: contract,
          });
          emittedHookEvents.push({
            hookPoint: "artifact_materialized",
            contract,
            artifactPath: generatedFile,
          });
        }
      } else {
        materializedArtifacts.push({
          contract,
          artifactPath: null,
          fingerprint: null,
          action: "updated",
          kind: contract,
        });
        emittedHookEvents.push({
          hookPoint: "artifact_materialized",
          contract,
          artifactPath: null,
        });
      }
      manifest =
        (await readJsonIfExists<ManifestLike>(
          resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json")
        )) ?? manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ contract, message });
    }
  };

  await runStep("papernexus_packet_contracts", shouldMaterializePapernexusPacketContracts, () =>
    (params.deps.materializePapernexusPacketContracts ?? materializePapernexusPacketContracts)({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("survey_review_state", shouldMaterializeSurveyReviewState, () =>
    params.deps.materializeSurveyReviewState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      surveyReviewMaterialization: {
        basis_stage: params.stage,
      },
    })
  );

  await runStep("ideation_contract", shouldMaterializeIdeationContract, () =>
    params.deps.materializeIdeationContract({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      ideationMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("innovation_reflection", shouldMaterializeInnovationReflection, () =>
    (
      params.deps.materializeInnovationReflection ??
      materializeInnovationReflection
    )({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("idea_catalyst_requisition", shouldQueueIdeaCatalystRequisition, () =>
    params.deps.queueIdeaCatalystRequisition({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("idea_catalyst", shouldMaterializeIdeaCatalyst, () =>
    params.deps.materializeIdeaCatalystState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      ideaCatalystMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("plan_state", shouldMaterializePlanState, () =>
    (params.deps.materializePlanState ?? materializePlanStateImpl)({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      planMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("code_experiment_bundle", shouldMaterializeCodeExperimentBundle, () =>
    (params.deps.materializeCodeExperimentBundle ?? materializeCodeExperimentBundleImpl)({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      codeMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("local_code_review_fallback", shouldMaterializeLocalCodeReviewFallback, () =>
    (
      params.deps.materializeLocalCodeReviewFallback ??
      materializeLocalCodeReviewFallback
    )({
      projectRoot,
      projectId:
        typeof manifest.project_id === "string"
          ? manifest.project_id
          : typeof manifest.projectId === "string"
            ? manifest.projectId
            : null,
      autoGate: params.autoGate ?? null,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("local_experiment_execution", shouldMaterializeLocalExperimentExecution, () =>
    (
      params.deps.materializeLocalExperimentExecution ??
      materializeLocalExperimentExecutionImpl
    )({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("storyline_planner", shouldMaterializeStorylinePlanner, () =>
    (params.deps.materializeStorylinePlannerState ?? materializeSurveyStorylinePlanner)({
      projectRoot,
      topic: normalizeSurveyReviewState(manifest.survey_review).topic,
      configuredMode:
        (normalizeStorylinePlannerState(manifest.storyline_planner)
          .configuredMode as
          | "heuristic"
          | "reviewer_judged"
          | "learned_shadow"
          | "learned_primary"
          | null) ?? "reviewer_judged",
    })
  );
  await runStep("paper_story_state", shouldMaterializePaperStory, () =>
    params.deps.materializePaperStoryState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      paperStoryMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("analysis_artifacts", shouldMaterializeAnalysisArtifacts, () =>
    (
      params.deps.materializeAnalysisArtifacts ??
      materializeAnalysisArtifactsImpl
    )({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("experiment_review_state", shouldMaterializeExperimentReview, () =>
    params.deps.materializeExperimentReviewState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      experimentReviewMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("review_pressure_packet", shouldMaterializeReviewPressure, () =>
    params.deps.materializeReviewPressurePacket({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      reviewPressureMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep(
    "literature_discovery_packet",
    shouldMaterializeLiteratureDiscoveryPacket,
    () =>
      params.deps.materializeLiteratureDiscoveryPacket({
        projectRoot,
        trigger,
        agentId: params.agentId ?? null,
        literatureDiscoveryMaterialization: {
          origin_stage: params.stage,
        },
      })
  );
  await runStep(
    "literature_discovery_requisition",
    shouldQueueLiteratureDiscoveryRequisition,
    async () => {
      const packetPath = resolveProjectArtifactPath(
        projectRoot,
        DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
      );
      const packet =
        (await readJsonIfExists<Record<string, unknown>>(packetPath ?? "")) ?? {};
      const packetTriggerKind =
        typeof packet.trigger_kind === "string"
          ? packet.trigger_kind
          : typeof packet.triggerKind === "string"
            ? packet.triggerKind
            : null;
      const packetSummary =
        typeof packet.discovery_reason === "string"
          ? packet.discovery_reason
          : typeof packet.discoveryReason === "string"
            ? packet.discoveryReason
            : null;
      const packetRequestId =
        typeof packet.discovery_id === "string"
          ? packet.discovery_id
          : typeof packet.discoveryId === "string"
            ? packet.discoveryId
            : null;
      return params.deps.queueLiteratureDiscoveryRequisition({
        projectRoot,
        packetPath: DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
        triggerKind: packetTriggerKind ?? `${params.stage ?? "review"}_literature_discovery`,
        originStage: params.stage,
        summary:
          packetSummary ??
          `Workflow-owned ${params.stage ?? "review"} literature discovery rerun for story support gaps.`,
        requestIdPrefix: packetRequestId ?? `${params.stage ?? "review"}-literature-discovery`,
      });
    }
  );
  await runStep("writing_support_artifacts", shouldMaterializeWritingSupport, async () => {
    const paperStoryState = normalizePaperStoryState(manifest.paper_story_state);
    const reviewPressureState = normalizeReviewPressurePacketState(
      manifest.review_pressure_packet
    );
    await materializeWritingSupportArtifacts({
      projectRoot,
      stage: params.stage,
      paperStoryState,
      reviewPressureState,
    });
  });
  await runStep("results_storyline", shouldMaterializeResultsStoryline, () =>
    (params.deps.materializeResultsStoryline ?? materializeResultsStoryline)({
      projectRoot,
      stage: params.stage,
    })
  );
  await runStep("innovation_synthesis_state", shouldMaterializeInnovationSynthesis, () =>
    (params.deps.materializeInnovationSynthesisState ?? materializeInnovationSynthesis)({
      projectRoot,
      stage: params.stage,
    })
  );
  await runStep(
    "title_abstract_intro_workbench",
    shouldMaterializeTitleAbstractIntroWorkbench,
    () =>
      (
      params.deps.materializeTitleAbstractIntroWorkbench ??
        materializeTitleAbstractIntroWorkbench
      )({
        projectRoot,
        stage: params.stage,
      })
  );
  await runStep("authoring_closeout", shouldReconcileAuthoringCloseout, () =>
    (params.deps.reconcileAuthoringCloseout ?? reconcileAuthoringCloseout)({
      projectRoot,
      compilePdf: true,
      currentStageOverride: params.stage,
    })
  );
  await runStep("frontier_mapping_state", shouldMaterializeFrontierMappingState, () =>
    (params.deps.materializeFrontierMappingState ?? materializeFrontierMappingState)({
      projectRoot,
      manifest,
    })
  );
  await runStep("writing_hook_policies", shouldMaterializeWritingSupport, async () => {
    const writingContract =
      manifest.writing_contract && typeof manifest.writing_contract === "object"
        ? manifest.writing_contract
        : {};
    const paperMode = normalizeWritingContractState(writingContract).paperMode;
    const topTierVerdict =
      typeof (manifest.opportunity_scorecard as Record<string, unknown> | undefined)?.verdict ===
      "string"
        ? ((manifest.opportunity_scorecard as Record<string, unknown>).verdict as string)
        : null;
    return (
      params.deps.materializeWritingHookPolicies ?? materializeWritingHookPolicies
    )({
      projectRoot,
      stage: params.stage,
      paperMode,
      topTierVerdict,
    });
  });
  await runStep(
    "intermediate_artifact_hook_policies",
    async ({ stage }) =>
      ["frontier_mapping", "idea", "analyze", "submit"].includes(stage ?? ""),
    async () => {
      const writingContract =
        manifest.writing_contract && typeof manifest.writing_contract === "object"
          ? manifest.writing_contract
          : {};
      const paperMode = normalizeWritingContractState(writingContract).paperMode;
      return (
        params.deps.materializeIntermediateArtifactHookPolicies ??
        materializeIntermediateArtifactHookPolicies
      )({
        projectRoot,
        stage: params.stage,
        paperMode,
      });
    }
  );
  await runStep(
    "revision_control_state",
    async ({ stage }) => ["write", "review", "submit"].includes(stage ?? ""),
    async () =>
      (
        params.deps.materializeRevisionControlState ?? materializeRevisionControlState
      )({
        projectRoot,
        stage: params.stage,
      })
  );
  await runStep(
    "execution_proof_state",
    async ({ stage }) => ["experiment", "analyze", "review", "write", "submit"].includes(stage ?? ""),
    async () =>
      (
        params.deps.materializeExecutionProofState ?? materializeExecutionProofState
      )({
        projectRoot,
      })
  );
  await runStep(
    "survey_visual_compiler",
    async ({ stage, manifest }) =>
      ["write", "review", "submit"].includes(stage ?? "") &&
      normalizeWritingContractState(
        manifest.writing_contract && typeof manifest.writing_contract === "object"
          ? manifest.writing_contract
          : {}
      ).paperMode === "survey",
    async () =>
      (
        params.deps.materializeSurveyVisualCompiler ?? materializeSurveyVisualCompiler
      )({
        projectRoot,
      })
  );
  await runStep(
    "survey_methodology_consistency",
    async ({ stage, manifest }) =>
      ["survey_review", "write", "review", "submit"].includes(stage ?? "") &&
      normalizeWritingContractState(
        manifest.writing_contract && typeof manifest.writing_contract === "object"
          ? manifest.writing_contract
          : {}
      ).paperMode === "survey",
    async () =>
      (
        params.deps.materializeSurveyMethodologyConsistency ??
        materializeSurveyMethodologyConsistency
      )({
        projectRoot,
      })
  );
  await runStep("cycle_memory", shouldRefreshCycleMemory, async () => {
    await materializeCycleMemory({
      projectRoot,
      stage: params.stage,
    });
  });

  return {
    manifest,
    materializedContracts,
    materializedArtifacts,
    emittedHookEvents,
    errors,
  };
}
