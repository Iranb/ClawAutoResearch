import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import type {
  ResearchProgramGlobalConstraints,
  ResearchProgramState,
  ResearchProgramTask,
  ResearchProgramTrack,
  ResearchProgramTrackBudget,
  ResearchProgramTrackWriteScope,
} from "../workflow-guard.js";

function normalizeResearchProgramTrackBudget(
  value: unknown
): ResearchProgramTrackBudget {
  const record = asRecord(value) ?? {};
  return {
    gpuHours: pickNumber(record, ["gpuHours", "gpu_hours"]),
    maxRuns: pickNumber(record, ["maxRuns", "max_runs"]),
    maxDebugIterations: pickNumber(record, [
      "maxDebugIterations",
      "max_debug_iterations",
    ]),
  };
}

function serializeResearchProgramTrackBudget(
  value: ResearchProgramTrackBudget
): Record<string, unknown> {
  return {
    gpu_hours: value.gpuHours,
    max_runs: value.maxRuns,
    max_debug_iterations: value.maxDebugIterations,
  };
}

function normalizeResearchProgramTrackWriteScope(
  value: unknown
): ResearchProgramTrackWriteScope {
  const record = asRecord(value) ?? {};
  return {
    allowedClaimIds: asStringArray(
      record.allowedClaimIds ?? record.allowed_claim_ids
    ),
    allowedFigureIds: asStringArray(
      record.allowedFigureIds ?? record.allowed_figure_ids
    ),
  };
}

function serializeResearchProgramTrackWriteScope(
  value: ResearchProgramTrackWriteScope
): Record<string, unknown> {
  return {
    allowed_claim_ids: value.allowedClaimIds,
    allowed_figure_ids: value.allowedFigureIds,
  };
}

export function normalizeResearchProgramTrack(value: unknown): ResearchProgramTrack {
  const record = asRecord(value) ?? {};
  return {
    trackId:
      pickString(record, ["trackId", "track_id"]) ??
      `track-${Math.random().toString(36).slice(2, 8)}`,
    priority: pickNumber(record, ["priority"]),
    status: normalizeStage(record.status) ?? "draft",
    hypothesis: pickString(record, ["hypothesis"]),
    noveltyBasis: pickString(record, ["noveltyBasis", "novelty_basis"]),
    mainMetric: pickString(record, ["mainMetric", "main_metric"]),
    successThreshold: pickString(record, [
      "successThreshold",
      "success_threshold",
    ]),
    requiredBaselines: asStringArray(
      record.requiredBaselines ?? record.required_baselines
    ),
    requiredAblations: asStringArray(
      record.requiredAblations ?? record.required_ablations
    ),
    requiredControls: asStringArray(
      record.requiredControls ?? record.required_controls
    ),
    experimentStageMatrix: asStringArray(
      record.experimentStageMatrix ?? record.experiment_stage_matrix
    ).map((entry) => normalizeStage(entry) ?? entry),
    budget: normalizeResearchProgramTrackBudget(record.budget),
    stopRules: asStringArray(record.stopRules ?? record.stop_rules),
    rollbackTriggers: asStringArray(
      record.rollbackTriggers ?? record.rollback_triggers
    ),
    writeScope: normalizeResearchProgramTrackWriteScope(
      record.writeScope ?? record.write_scope
    ),
  };
}

export function serializeResearchProgramTrack(
  value: ResearchProgramTrack
): Record<string, unknown> {
  return {
    track_id: value.trackId,
    priority: value.priority,
    status: value.status,
    hypothesis: value.hypothesis,
    novelty_basis: value.noveltyBasis,
    main_metric: value.mainMetric,
    success_threshold: value.successThreshold,
    required_baselines: value.requiredBaselines,
    required_ablations: value.requiredAblations,
    required_controls: value.requiredControls,
    experiment_stage_matrix: value.experimentStageMatrix,
    budget: serializeResearchProgramTrackBudget(value.budget),
    stop_rules: value.stopRules,
    rollback_triggers: value.rollbackTriggers,
    write_scope: serializeResearchProgramTrackWriteScope(value.writeScope),
  };
}

export function normalizeResearchProgramTask(value: unknown): ResearchProgramTask {
  const record = asRecord(value) ?? {};
  return {
    taskId:
      pickString(record, ["taskId", "task_id"]) ??
      `task-${Math.random().toString(36).slice(2, 8)}`,
    stage: normalizeStage(record.stage),
    trackId: pickString(record, ["trackId", "track_id"]),
    owner: pickString(record, ["owner"]),
    dependencies: asStringArray(record.dependencies),
    entryCriteria: asStringArray(record.entryCriteria ?? record.entry_criteria),
    expectedOutputs: asStringArray(record.expectedOutputs ?? record.expected_outputs),
    retryBudget: pickNumber(record, ["retryBudget", "retry_budget"]),
    exitCriteria: asStringArray(record.exitCriteria ?? record.exit_criteria),
  };
}

export function serializeResearchProgramTask(
  value: ResearchProgramTask
): Record<string, unknown> {
  return {
    task_id: value.taskId,
    stage: value.stage,
    track_id: value.trackId,
    owner: value.owner,
    dependencies: value.dependencies,
    entry_criteria: value.entryCriteria,
    expected_outputs: value.expectedOutputs,
    retry_budget: value.retryBudget,
    exit_criteria: value.exitCriteria,
  };
}

export function normalizeResearchProgramGlobalConstraints(
  value: unknown
): ResearchProgramGlobalConstraints {
  const record = asRecord(value) ?? {};
  return {
    maxActiveTracks: pickNumber(record, [
      "maxActiveTracks",
      "max_active_tracks",
    ]),
    mustRunMultiSeedBeforeAnalysis:
      pickBoolean(record, [
        "mustRunMultiSeedBeforeAnalysis",
        "must_run_multi_seed_before_analysis",
      ]) ?? true,
    mustRunPlotAggregationBeforeWrite:
      pickBoolean(record, [
        "mustRunPlotAggregationBeforeWrite",
        "must_run_plot_aggregation_before_write",
      ]) ?? true,
  };
}

function serializeResearchProgramGlobalConstraints(
  value: ResearchProgramGlobalConstraints
): Record<string, unknown> {
  return {
    max_active_tracks: value.maxActiveTracks,
    must_run_multi_seed_before_analysis: value.mustRunMultiSeedBeforeAnalysis,
    must_run_plot_aggregation_before_write: value.mustRunPlotAggregationBeforeWrite,
  };
}

export function normalizeResearchProgramState(value: unknown): ResearchProgramState {
  const record = asRecord(value) ?? {};
  const taskGraphEntries = Array.isArray(record.taskGraph ?? record.task_graph)
    ? ((record.taskGraph ?? record.task_graph) as unknown[])
    : [];
  return {
    programVersion: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["programVersion", "program_version"]) ?? 1
      )
    ),
    status: normalizeStage(record.status) ?? "missing",
    goal: pickString(record, ["goal"]),
    problemStatement: pickString(record, [
      "problemStatement",
      "problem_statement",
    ]),
    baselineReference: pickString(record, [
      "baselineReference",
      "baseline_reference",
    ]),
    primaryMetric: pickString(record, ["primaryMetric", "primary_metric"]),
    datasets: asStringArray(record.datasets),
    constraints: asStringArray(record.constraints),
    successCriteria: asStringArray(
      record.successCriteria ?? record.success_criteria
    ),
    zoteroProjectPath: pickString(record, [
      "zoteroProjectPath",
      "zotero_project_path",
    ]),
    tracks: Array.isArray(record.tracks)
      ? record.tracks.map((entry) => normalizeResearchProgramTrack(entry))
      : [],
    globalConstraints: normalizeResearchProgramGlobalConstraints(
      record.globalConstraints ?? record.global_constraints
    ),
    taskGraph: taskGraphEntries.map((entry: unknown) =>
      normalizeResearchProgramTask(entry)
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeResearchProgramState(
  value: ResearchProgramState
): Record<string, unknown> {
  return {
    program_version: value.programVersion,
    status: value.status,
    goal: value.goal,
    problem_statement: value.problemStatement,
    baseline_reference: value.baselineReference,
    primary_metric: value.primaryMetric,
    datasets: value.datasets,
    constraints: value.constraints,
    success_criteria: value.successCriteria,
    zotero_project_path: value.zoteroProjectPath,
    tracks: value.tracks.map((entry) => serializeResearchProgramTrack(entry)),
    global_constraints: serializeResearchProgramGlobalConstraints(
      value.globalConstraints
    ),
    task_graph: value.taskGraph.map((entry) => serializeResearchProgramTask(entry)),
    last_updated_at: value.lastUpdatedAt,
    pending_reason: value.pendingReason,
  };
}
