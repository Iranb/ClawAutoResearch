import * as path from "node:path";

import { randomUUID } from "node:crypto";

import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { pathExists, readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  getExperimentSearchPath,
  loadExperimentSearchState,
  saveExperimentSearchStateFile,
} from "../workflow-guard-experiment-history";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  buildOneChangeSignature,
  collectBaselineDatasetEnvelope,
  collectInnovationAnchorPoints,
  normalizeExperimentInnerLoopContract,
} from "../workflow-experiment-loop";
import {
  normalizeExperimentSearchSpec,
  resolveExperimentSearchSpecPath,
} from "../workflow-guard-state/experiment-search-spec";
import { writePapernexusProgressFromManifest } from "../papernexus-progress";
import {
  normalizeCitationCollectionState,
  normalizeFigureQcState,
  normalizeExperimentSearchState,
  normalizePaperQcState,
  serializeCitationCollectionState,
  serializeFigureQcState,
  serializeExperimentSearchState,
  serializePaperQcState,
} from "../workflow-guard-state/execution-state";
import {
  mergeCompletedPaperEntries,
  mergePaperIngestionBatchItems,
  mergePaperIngestionBatchRuns,
  mergePaperIngestionOperations,
  mergePaperIngestionQueuedRequests,
  normalizePaperIngestionQueuedRequest,
  normalizePaperIngestionRuntimeStatus,
  normalizePaperIngestionState,
  serializePaperIngestionQueuedRequest,
  serializePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";

type ExperimentSearchState = ReturnType<typeof normalizeExperimentSearchState>;
type PaperQcState = ReturnType<typeof normalizePaperQcState>;
type CitationCollectionState = ReturnType<typeof normalizeCitationCollectionState>;
type FigureQcState = ReturnType<typeof normalizeFigureQcState>;
type PaperIngestionState = ReturnType<typeof normalizePaperIngestionState>;
type PaperIngestionCompletedPaper = PaperIngestionState["completedPapers"][number];
type PaperIngestionPaperOperation = PaperIngestionState["paperOperations"][number];
type PaperIngestionBatchRun = PaperIngestionState["activeBatches"][number];
type PaperIngestionQueuedRequest = PaperIngestionState["queuedRequests"][number];

async function readProjectManifest(projectRoot: string): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {}
  );
}

async function saveProjectManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
}

async function upsertJsonArtifact(
  targetPath: string | null,
  patch: Record<string, unknown>
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const current = (await readJsonIfExists<Record<string, unknown>>(targetPath)) ?? {};
  await writeJsonEnsured(targetPath, {
    ...current,
    ...patch,
  });
}

function isRuntimeReadyStatus(
  value: unknown,
  readyStates: readonly string[]
): boolean {
  const normalized = normalizeStage(value);
  return normalized ? readyStates.includes(normalized) : false;
}

function isExperimentSearchReadyForAnalysis(state: ExperimentSearchState): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "ready_for_analysis",
      "ready",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.multiSeedStatus, [
      "ready",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.plotPackStatus, [
      "ready",
      "complete",
      "completed",
    ]) &&
    Boolean(state.evaluationSummaryPath) &&
    Boolean(state.plotPackPath)
  );
}

export async function setExperimentSearchState(params: {
  projectRoot: string;
  experimentSearch: Record<string, unknown>;
}): Promise<{
  state: ExperimentSearchState;
  stateFilePath: string;
  stateFileExists: boolean;
  readyForAnalysis: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const patch = asRecord(params.experimentSearch) ?? {};
  const searchSpecPath =
    pickString(patch, ["searchSpecPath", "search_spec_path"]) ??
    current.searchSpecPath ??
    pickString(asRecord(manifest.experiment_search) ?? {}, [
      "searchSpecPath",
      "search_spec_path",
    ]) ??
    null;
  const specResolvedPath = resolveExperimentSearchSpecPath({
    projectRoot: params.projectRoot,
    manifest,
    searchSpecPath,
  });
  const searchSpec = normalizeExperimentSearchSpec(
    await readJsonIfExists<Record<string, unknown>>(specResolvedPath)
  );
  const innerLoop = normalizeExperimentInnerLoopContract(searchSpec);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const effectiveTrackId =
    pickString(patch, ["trackId", "track_id"]) ??
    current.trackId ??
    researchProgram.tracks.find((track) => track.status === "active")?.trackId ??
    null;
  const rawProgramTracks = Array.isArray(
    (manifest.research_program as Record<string, unknown> | undefined)?.tracks
  )
    ? (((manifest.research_program as Record<string, unknown>).tracks as unknown[]) ?? [])
        .map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)
            : null
        )
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const activeTrackRecords = rawProgramTracks.filter((track) => {
    const trackId = pickString(track, ["track_id", "trackId"]);
    const status = normalizeStage(track.status);
    return effectiveTrackId ? trackId === effectiveTrackId : status === "active";
  });
  const defaultOneChangeSignature = buildOneChangeSignature({
    trackRecords: activeTrackRecords,
  });
  const baselineDatasetEnvelope = collectBaselineDatasetEnvelope({
    manifest,
    trackRecords: activeTrackRecords,
  });
  const innovationAnchorPoints = collectInnovationAnchorPoints({
    manifest,
    trackRecords: activeTrackRecords,
  });
  const normalizedStatus = normalizeStage(patch.status) ?? current.status;
  const explicitMultiSeedStatus = normalizeStage(
    patch.multiSeedStatus ?? patch.multi_seed_status
  );
  const plotPackStatus =
    normalizeStage(patch.plotPackStatus ?? patch.plot_pack_status) ??
    current.plotPackStatus;
  const evaluationSummaryPath =
    pickString(patch, ["evaluationSummaryPath", "evaluation_summary_path"]) ??
    current.evaluationSummaryPath;
  const plotPackPath =
    pickString(patch, ["plotPackPath", "plot_pack_path"]) ?? current.plotPackPath;
  const inferredMultiSeedStatus =
    explicitMultiSeedStatus ??
    (normalizedStatus === "ready_for_analysis" &&
    isRuntimeReadyStatus(plotPackStatus, ["ready", "complete", "completed"]) &&
    Boolean(evaluationSummaryPath) &&
    Boolean(plotPackPath)
      ? "ready"
      : current.multiSeedStatus);
  const next: ExperimentSearchState = {
    ...current,
    status: normalizedStatus,
    projectId:
      pickString(patch, ["projectId", "project_id"]) ?? current.projectId,
    trackId: pickString(patch, ["trackId", "track_id"]) ?? current.trackId,
    currentMainStage:
      normalizeStage(patch.currentMainStage ?? patch.current_main_stage) ??
      current.currentMainStage,
    currentSubstage:
      normalizeStage(patch.currentSubstage ?? patch.current_substage) ??
      current.currentSubstage,
    validationStage:
      normalizeStage(patch.validationStage ?? patch.validation_stage) ??
      current.validationStage,
    innerLoopMode:
      normalizeStage(patch.innerLoopMode ?? patch.inner_loop_mode) ??
      current.innerLoopMode ??
      innerLoop.mode,
    trialTimeBudgetMinutes:
      pickNumber(patch, ["trialTimeBudgetMinutes", "trial_time_budget_minutes"]) ??
      current.trialTimeBudgetMinutes ??
      innerLoop.trialTimeBudgetMinutes,
    strictComparableBudget:
      pickBoolean(patch, ["strictComparableBudget", "strict_comparable_budget"]) ??
      current.strictComparableBudget ??
      innerLoop.strictComparableBudget,
    requireOneChangeSignature:
      pickBoolean(patch, [
        "requireOneChangeSignature",
        "require_one_change_signature",
      ]) ??
      current.requireOneChangeSignature ??
      innerLoop.requireOneChangeSignature,
    oneChangeSignature:
      pickString(patch, ["oneChangeSignature", "one_change_signature"]) ??
      current.oneChangeSignature ??
      defaultOneChangeSignature,
    oneChangeValidationStatus:
      normalizeStage(
        patch.oneChangeValidationStatus ?? patch.one_change_validation_status
      ) ??
      current.oneChangeValidationStatus ??
      (defaultOneChangeSignature ? "ready" : "missing"),
    keepDiscardRule:
      pickString(patch, ["keepDiscardRule", "keep_discard_rule"]) ??
      current.keepDiscardRule ??
      innerLoop.keepDiscardRule,
    lastTrialOutcome:
      pickString(patch, ["lastTrialOutcome", "last_trial_outcome"]) ??
      current.lastTrialOutcome,
    comparableTrialBudgetStatus:
      normalizeStage(
        patch.comparableTrialBudgetStatus ??
          patch.comparable_trial_budget_status
      ) ?? current.comparableTrialBudgetStatus,
    searchSessionId:
      pickString(patch, ["searchSessionId", "search_session_id"]) ??
      current.searchSessionId,
    searchSpecPath:
      pickString(patch, ["searchSpecPath", "search_spec_path"]) ??
      current.searchSpecPath,
    searchStatePath:
      pickString(patch, ["searchStatePath", "search_state_path"]) ??
      current.searchStatePath,
    frontierNodeIds:
      patch.frontierNodeIds || patch.frontier_node_ids
        ? asStringArray(patch.frontierNodeIds ?? patch.frontier_node_ids)
        : current.frontierNodeIds,
    bestNodeId: pickString(patch, ["bestNodeId", "best_node_id"]) ?? current.bestNodeId,
    incumbentExperimentId:
      pickString(patch, ["incumbentExperimentId", "incumbent_experiment_id"]) ??
      current.incumbentExperimentId,
    incumbentBranch:
      pickString(patch, ["incumbentBranch", "incumbent_branch"]) ??
      current.incumbentBranch,
    incumbentCommit:
      pickString(patch, ["incumbentCommit", "incumbent_commit"]) ??
      current.incumbentCommit,
    completedNodeIds:
      patch.completedNodeIds || patch.completed_node_ids
        ? asStringArray(patch.completedNodeIds ?? patch.completed_node_ids)
        : current.completedNodeIds,
    failedNodeIds:
      patch.failedNodeIds || patch.failed_node_ids
        ? asStringArray(patch.failedNodeIds ?? patch.failed_node_ids)
        : current.failedNodeIds,
    triedHyperparams:
      patch.triedHyperparams || patch.tried_hyperparams
        ? asStringArray(patch.triedHyperparams ?? patch.tried_hyperparams)
        : current.triedHyperparams,
    completedAblations:
      patch.completedAblations || patch.completed_ablations
        ? asStringArray(patch.completedAblations ?? patch.completed_ablations)
        : current.completedAblations,
    lastCandidateExperimentId:
      pickString(patch, ["lastCandidateExperimentId", "last_candidate_experiment_id"]) ??
      current.lastCandidateExperimentId,
    lastCandidateBranch:
      pickString(patch, ["lastCandidateBranch", "last_candidate_branch"]) ??
      current.lastCandidateBranch,
    lastCandidateCommit:
      pickString(patch, ["lastCandidateCommit", "last_candidate_commit"]) ??
      current.lastCandidateCommit,
    requestedGitOp:
      pickString(patch, ["requestedGitOp", "requested_git_op"]) ??
      current.requestedGitOp,
    gitOpStatus:
      normalizeStage(patch.gitOpStatus ?? patch.git_op_status) ??
      current.gitOpStatus,
    gitReviewStorePath:
      pickString(patch, ["gitReviewStorePath", "git_review_store_path"]) ??
      current.gitReviewStorePath,
    gitReviewPacketPath:
      pickString(patch, ["gitReviewPacketPath", "git_review_packet_path"]) ??
      current.gitReviewPacketPath,
    candidateWorktreePath:
      pickString(patch, ["candidateWorktreePath", "candidate_worktree_path"]) ??
      current.candidateWorktreePath,
    candidateBaseCommit:
      pickString(patch, ["candidateBaseCommit", "candidate_base_commit"]) ??
      current.candidateBaseCommit,
    candidateHeadCommit:
      pickString(patch, ["candidateHeadCommit", "candidate_head_commit"]) ??
      current.candidateHeadCommit,
    lastGitOpResult:
      pickString(patch, ["lastGitOpResult", "last_git_op_result"]) ??
      current.lastGitOpResult,
    lastDecision:
      pickString(patch, ["lastDecision", "last_decision"]) ??
      current.lastDecision,
    multiSeedStatus: inferredMultiSeedStatus,
    baselineFairnessStatus:
      normalizeStage(
        patch.baselineFairnessStatus ?? patch.baseline_fairness_status
      ) ?? current.baselineFairnessStatus,
    implementationConfidence:
      normalizeStage(
        patch.implementationConfidence ?? patch.implementation_confidence
      ) ?? current.implementationConfidence,
    searchExhaustionStatus:
      normalizeStage(
        patch.searchExhaustionStatus ?? patch.search_exhaustion_status
      ) ?? current.searchExhaustionStatus,
    ablationStatus:
      normalizeStage(patch.ablationStatus ?? patch.ablation_status) ??
      current.ablationStatus,
    innovationStatus:
      normalizeStage(patch.innovationStatus ?? patch.innovation_status) ??
      current.innovationStatus,
    decisionConfidence:
      normalizeStage(patch.decisionConfidence ?? patch.decision_confidence) ??
      current.decisionConfidence,
    recommendedNextAction:
      pickString(patch, [
        "recommendedNextAction",
        "recommended_next_action",
      ]) ?? current.recommendedNextAction,
    failureClusterIds:
      patch.failureClusterIds || patch.failure_cluster_ids
        ? asStringArray(patch.failureClusterIds ?? patch.failure_cluster_ids)
        : current.failureClusterIds,
    evidenceCleanlinessStatus:
      normalizeStage(
        patch.evidenceCleanlinessStatus ?? patch.evidence_cleanliness_status
      ) ?? current.evidenceCleanlinessStatus,
    evaluationSummaryPath,
    plotPackStatus,
    plotPackPath,
    stageProgressPath:
      pickString(patch, ["stageProgressPath", "stage_progress_path"]) ??
      current.stageProgressPath,
    checkpointPath:
      pickString(patch, ["checkpointPath", "checkpoint_path"]) ?? current.checkpointPath,
    graphMemoryPacketPath:
      pickString(patch, ["graphMemoryPacketPath", "graph_memory_packet_path"]) ??
      current.graphMemoryPacketPath,
    graphMemorySyncStatus:
      normalizeStage(patch.graphMemorySyncStatus ?? patch.graph_memory_sync_status) ??
      current.graphMemorySyncStatus,
    baselineDatasetEnvelope:
      patch.baselineDatasetEnvelope || patch.baseline_dataset_envelope
        ? asStringArray(
            patch.baselineDatasetEnvelope ?? patch.baseline_dataset_envelope
          )
        : current.baselineDatasetEnvelope.length > 0
          ? current.baselineDatasetEnvelope
          : baselineDatasetEnvelope,
    validatedDatasetEnvelope:
      patch.validatedDatasetEnvelope || patch.validated_dataset_envelope
        ? asStringArray(
            patch.validatedDatasetEnvelope ?? patch.validated_dataset_envelope
          )
        : current.validatedDatasetEnvelope,
    baselineDatasetCoverageStatus:
      normalizeStage(
        patch.baselineDatasetCoverageStatus ??
          patch.baseline_dataset_coverage_status
      ) ?? current.baselineDatasetCoverageStatus,
    baselineDatasetCoverageMissing:
      patch.baselineDatasetCoverageMissing || patch.baseline_dataset_coverage_missing
        ? asStringArray(
            patch.baselineDatasetCoverageMissing ??
              patch.baseline_dataset_coverage_missing
          )
        : current.baselineDatasetCoverageMissing,
    baselineDatasetCoverageSummary:
      pickString(patch, [
        "baselineDatasetCoverageSummary",
        "baseline_dataset_coverage_summary",
      ]) ?? current.baselineDatasetCoverageSummary,
    innovationAnchorPoints:
      patch.innovationAnchorPoints || patch.innovation_anchor_points
        ? asStringArray(
            patch.innovationAnchorPoints ?? patch.innovation_anchor_points
          )
        : current.innovationAnchorPoints.length > 0
          ? current.innovationAnchorPoints
          : innovationAnchorPoints,
    innovationDeviationStatus:
      normalizeStage(
        patch.innovationDeviationStatus ??
          patch.innovation_deviation_status
      ) ?? current.innovationDeviationStatus,
    innovationDeviationScore:
      pickNumber(patch, [
        "innovationDeviationScore",
        "innovation_deviation_score",
      ]) ?? current.innovationDeviationScore,
    innovationDeviationSummary:
      pickString(patch, [
        "innovationDeviationSummary",
        "innovation_deviation_summary",
      ]) ?? current.innovationDeviationSummary,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  if (normalizeStage(next.status) === "ready_for_analysis") {
    if (!next.baselineFairnessStatus || next.baselineFairnessStatus === "unknown") {
      next.baselineFairnessStatus = "ready";
    }
    if (!next.implementationConfidence || next.implementationConfidence === "unknown") {
      next.implementationConfidence = "trusted";
    }
    if (!next.ablationStatus || next.ablationStatus === "pending") {
      next.ablationStatus = "ready";
    }
    if (
      !next.evidenceCleanlinessStatus ||
      next.evidenceCleanlinessStatus === "unknown" ||
      next.evidenceCleanlinessStatus === "partial"
    ) {
      next.evidenceCleanlinessStatus = "ready";
    }
    if (!next.innovationStatus || next.innovationStatus === "unknown") {
      next.innovationStatus = "supported";
    }
  }

  manifest.experiment_search = serializeExperimentSearchState(next);
  await saveExperimentSearchStateFile({
    projectRoot: params.projectRoot,
    state: next,
    writeJsonEnsured,
  });
  await saveProjectManifest(params.projectRoot, manifest);

  const stateFilePath = next.searchStatePath
    ? path.isAbsolute(next.searchStatePath)
      ? next.searchStatePath
      : path.join(params.projectRoot, next.searchStatePath)
    : getExperimentSearchPath(params.projectRoot);
  return {
    state: next,
    stateFilePath,
    stateFileExists: await pathExists(stateFilePath),
    readyForAnalysis: isExperimentSearchReadyForAnalysis(next),
  };
}

export async function setPaperQcState(params: {
  projectRoot: string;
  paperQc: Record<string, unknown>;
}): Promise<{
  state: PaperQcState;
  latestReportResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizePaperQcState(manifest.paper_qc);
  const patch = asRecord(params.paperQc) ?? {};
  const next: PaperQcState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    compileStatus:
      normalizeStage(patch.compileStatus ?? patch.compile_status) ?? current.compileStatus,
    compileRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["compileRoundCount", "compile_round_count"]) ??
          current.compileRoundCount
      )
    ),
    chktexStatus:
      normalizeStage(patch.chktexStatus ?? patch.chktex_status) ?? current.chktexStatus,
    pageBudgetStatus:
      normalizeStage(patch.pageBudgetStatus ?? patch.page_budget_status) ??
      current.pageBudgetStatus,
    referenceStartPage:
      pickNumber(patch, ["referenceStartPage", "reference_start_page"]) ??
      current.referenceStartPage,
    bodyPageCount:
      pickNumber(patch, ["bodyPageCount", "body_page_count"]) ?? current.bodyPageCount,
    unusedFigureStatus:
      normalizeStage(patch.unusedFigureStatus ?? patch.unused_figure_status) ??
      current.unusedFigureStatus,
    invalidFigureRefStatus:
      normalizeStage(patch.invalidFigureRefStatus ?? patch.invalid_figure_ref_status) ??
      current.invalidFigureRefStatus,
    reflectionRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["reflectionRoundCount", "reflection_round_count"]) ??
          current.reflectionRoundCount
      )
    ),
    latestReportPath:
      pickString(patch, ["latestReportPath", "latest_report_path"]) ??
      current.latestReportPath,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.paper_qc = serializePaperQcState(next);
  await saveProjectManifest(params.projectRoot, manifest);

  return {
    state: next,
    latestReportResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.latestReportPath
    ),
    hardFailure: normalizeStage(next.status) !== "missing" &&
      [next.compileStatus, next.pageBudgetStatus, next.invalidFigureRefStatus].some(
        (value) => normalizeStage(value) === "fail"
      ),
  };
}

export async function setPaperIngestionState(params: {
  projectRoot: string;
  paperIngestion: Record<string, unknown>;
}): Promise<{
  state: PaperIngestionState;
  newlyCompletedPapers: PaperIngestionCompletedPaper[];
  newlyTerminalPaperOperations: PaperIngestionPaperOperation[];
  newlyTerminalBatches: PaperIngestionBatchRun[];
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizePaperIngestionState(manifest.paper_ingestion);
  const patch = asRecord(params.paperIngestion) ?? {};
  const importTaskIdsRaw = patch.import_task_ids ?? patch.importTaskIds;
  const completedPapersRaw = patch.completed_papers ?? patch.completedPapers;
  const paperOperationsRaw = patch.paper_operations ?? patch.paperOperations;
  const activeBatchesRaw = patch.active_batches ?? patch.activeBatches;
  const batchItemsRaw = patch.batch_items ?? patch.batchItems;
  const queuedRequestsRaw = patch.queued_requests ?? patch.queuedRequests;
  const patchState = normalizePaperIngestionState(patch);
  const hasFailedPapersPatch =
    Object.prototype.hasOwnProperty.call(patch, "failed_papers") ||
    Object.prototype.hasOwnProperty.call(patch, "failedPapers");
  const hasRetryableFailedPapersPatch =
    Object.prototype.hasOwnProperty.call(patch, "retryable_failed_papers") ||
    Object.prototype.hasOwnProperty.call(patch, "retryableFailedPapers");
  const hasNonRetryableFailedPapersPatch =
    Object.prototype.hasOwnProperty.call(patch, "non_retryable_failed_papers") ||
    Object.prototype.hasOwnProperty.call(patch, "nonRetryableFailedPapers");
  const completedPaperUpdate = mergeCompletedPaperEntries({
    current: current.completedPapers,
    patch: completedPapersRaw,
  });
  const paperOperationUpdate = mergePaperIngestionOperations({
    current: current.paperOperations,
    patch: paperOperationsRaw,
  });
  const batchRunUpdate = mergePaperIngestionBatchRuns({
    current: current.activeBatches,
    patch: activeBatchesRaw,
  });
  const batchItemUpdate = mergePaperIngestionBatchItems({
    current: current.batchItems,
    patch: batchItemsRaw,
  });
  const queuedRequestUpdate = mergePaperIngestionQueuedRequests({
    current: current.queuedRequests,
    patch: queuedRequestsRaw,
  });
  const next: PaperIngestionState = {
    ...current,
    runtimeStatus: normalizePaperIngestionRuntimeStatus(
      patch.runtimeStatus ?? patch.runtime_status ?? current.runtimeStatus
    ),
    waitingReason:
      pickString(patch, ["waitingReason", "waiting_reason"]) ?? current.waitingReason,
    importTaskIds: Array.isArray(importTaskIdsRaw)
      ? importTaskIdsRaw
          .map((entry: unknown) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : current.importTaskIds,
    lastImportTaskId:
      pickString(patch, ["lastImportTaskId", "last_import_task_id"]) ??
      current.lastImportTaskId,
    lastImportStatus:
      normalizeStage(patch.lastImportStatus ?? patch.last_import_status) ??
      current.lastImportStatus,
    completedPapers: completedPaperUpdate.completedPapers,
    paperOperations: paperOperationUpdate.paperOperations,
    activeBatches: batchRunUpdate.activeBatches,
    batchItems: batchItemUpdate.batchItems,
    queuedRequests: queuedRequestUpdate.queuedRequests,
    failedPapers: hasFailedPapersPatch ? patchState.failedPapers : current.failedPapers,
    retryableFailedPapers: hasRetryableFailedPapersPatch
      ? patchState.retryableFailedPapers
      : current.retryableFailedPapers,
    nonRetryableFailedPapers: hasNonRetryableFailedPapersPatch
      ? patchState.nonRetryableFailedPapers
      : current.nonRetryableFailedPapers,
    lastFailureScanAt:
      pickString(patch, ["lastFailureScanAt", "last_failure_scan_at"]) ??
      current.lastFailureScanAt,
    lastRetryManifestPath:
      pickString(patch, ["lastRetryManifestPath", "last_retry_manifest_path"]) ??
      current.lastRetryManifestPath,
    retryPolicy: patchState.retryPolicy ?? current.retryPolicy,
    retryRunId:
      pickString(patch, ["retryRunId", "retry_run_id"]) ?? current.retryRunId,
    retryStatus:
      pickString(patch, ["retryStatus", "retry_status"]) ?? current.retryStatus,
    retryAttemptCount:
      pickNumber(patch, ["retryAttemptCount", "retry_attempt_count"]) ??
      current.retryAttemptCount,
    sequentialRetryIntervalSeconds:
      pickNumber(patch, [
        "sequentialRetryIntervalSeconds",
        "sequential_retry_interval_seconds",
      ]) ?? current.sequentialRetryIntervalSeconds,
    lastBatchManifestPath:
      pickString(patch, ["lastBatchManifestPath", "last_batch_manifest_path"]) ??
      batchRunUpdate.activeBatches[batchRunUpdate.activeBatches.length - 1]?.manifestPath ??
      batchItemUpdate.batchItems[batchItemUpdate.batchItems.length - 1]?.manifestPath ??
      current.lastBatchManifestPath,
    graphVersionSeen:
      pickString(patch, ["graphVersionSeen", "graph_version_seen"]) ??
      current.graphVersionSeen,
    reconcileRequired:
      patch.reconcileRequired === true ||
      patch.reconcile_required === true ||
      (patch.reconcileRequired === false || patch.reconcile_required === false
        ? false
        : current.reconcileRequired),
    repairRequired:
      patch.repairRequired === true ||
      patch.repair_required === true ||
      (patch.repairRequired === false || patch.repair_required === false
        ? false
        : current.repairRequired),
    repairReason:
      pickString(patch, ["repairReason", "repair_reason"]) ??
      (patch.repairRequired === false || patch.repair_required === false
        ? null
        : current.repairReason),
    repairTargetCorpus:
      pickString(patch, ["repairTargetCorpus", "repair_target_corpus"]) ??
      (patch.repairRequired === false || patch.repair_required === false
        ? null
        : current.repairTargetCorpus),
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.paper_ingestion = {
    ...(asRecord(manifest.paper_ingestion) ?? {}),
    ...serializePaperIngestionState(next),
  };
  await saveProjectManifest(params.projectRoot, manifest);
  await writePapernexusProgressFromManifest({
    projectRoot: params.projectRoot,
    manifest,
    updatedAt: next.lastUpdatedAt,
  });

  return {
    state: next,
    newlyCompletedPapers: completedPaperUpdate.newlyCompletedPapers,
    newlyTerminalPaperOperations: paperOperationUpdate.newlyTerminalPaperOperations,
    newlyTerminalBatches: batchRunUpdate.newlyTerminalBatches,
  };
}

export async function setCitationCollectionState(params: {
  projectRoot: string;
  citationCollection: Record<string, unknown>;
}): Promise<{
  state: CitationCollectionState;
  progressResolvedPath: string | null;
  cacheBibResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeCitationCollectionState(manifest.citation_collection);
  const patch = asRecord(params.citationCollection) ?? {};
  const next: CitationCollectionState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    progressPath:
      pickString(patch, ["progressPath", "progress_path"]) ?? current.progressPath,
    cacheBibPath:
      pickString(patch, ["cacheBibPath", "cache_bib_path"]) ?? current.cacheBibPath,
    candidateCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["candidateCount", "candidate_count"]) ?? current.candidateCount
      )
    ),
    verifiedCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["verifiedCount", "verified_count"]) ?? current.verifiedCount
      )
    ),
    suspiciousCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["suspiciousCount", "suspicious_count"]) ??
          current.suspiciousCount
      )
    ),
    hallucinatedCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["hallucinatedCount", "hallucinated_count"]) ??
          current.hallucinatedCount
      )
    ),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.citation_collection = serializeCitationCollectionState(next);
  await saveProjectManifest(params.projectRoot, manifest);

  return {
    state: next,
    progressResolvedPath: resolveProjectArtifactPath(params.projectRoot, next.progressPath),
    cacheBibResolvedPath: resolveProjectArtifactPath(params.projectRoot, next.cacheBibPath),
    hardFailure:
      normalizeStage(next.status) !== "missing" &&
      (normalizeStage(next.status) === "blocked" || next.hallucinatedCount > 0),
  };
}

export async function setFigureQcState(params: {
  projectRoot: string;
  figureQc: Record<string, unknown>;
}): Promise<{
  state: FigureQcState;
  figureReviewResolvedPath: string | null;
  figureSelectionResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeFigureQcState(manifest.figure_qc);
  const patch = asRecord(params.figureQc) ?? {};
  const next: FigureQcState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    figureReviewPath:
      pickString(patch, ["figureReviewPath", "figure_review_path"]) ??
      current.figureReviewPath,
    figureSelectionPath:
      pickString(patch, ["figureSelectionPath", "figure_selection_path"]) ??
      current.figureSelectionPath,
    duplicateFigureStatus:
      normalizeStage(patch.duplicateFigureStatus ?? patch.duplicate_figure_status) ??
      current.duplicateFigureStatus,
    captionAlignmentStatus:
      normalizeStage(patch.captionAlignmentStatus ?? patch.caption_alignment_status) ??
      current.captionAlignmentStatus,
    textAlignmentStatus:
      normalizeStage(patch.textAlignmentStatus ?? patch.text_alignment_status) ??
      current.textAlignmentStatus,
    selectionStatus:
      normalizeStage(patch.selectionStatus ?? patch.selection_status) ??
      current.selectionStatus,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.figure_qc = serializeFigureQcState(next);
  await saveProjectManifest(params.projectRoot, manifest);

  const figureReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.figureReviewPath
  );
  const figureSelectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.figureSelectionPath
  );
  await upsertJsonArtifact(figureReviewResolvedPath, {
    status: next.status,
    duplicate_figure_status: next.duplicateFigureStatus,
    caption_alignment_status: next.captionAlignmentStatus,
    text_alignment_status: next.textAlignmentStatus,
    selection_status: next.selectionStatus,
    updated_at: next.lastUpdatedAt,
    source: "research_workflow.set_figure_qc",
  });
  await upsertJsonArtifact(figureSelectionResolvedPath, {
    status: next.status,
    selection_status: next.selectionStatus,
    duplicate_figure_status: next.duplicateFigureStatus,
    updated_at: next.lastUpdatedAt,
    source: "research_workflow.set_figure_qc",
  });

  return {
    state: next,
    figureReviewResolvedPath,
    figureSelectionResolvedPath,
    hardFailure:
      normalizeStage(next.status) !== "missing" &&
      [
        next.duplicateFigureStatus,
        next.captionAlignmentStatus,
        next.textAlignmentStatus,
        next.selectionStatus,
      ].some((value) => normalizeStage(value) === "fail"),
  };
}
