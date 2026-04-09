import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import type {
  ResearchProgramPlanAlternative,
  ResearchProgramPlanSelection,
  ResearchProgramGlobalConstraints,
  ResearchProgramState,
  ResearchProgramTask,
  ResearchProgramTrack,
  ResearchProgramTrackBudget,
  ResearchProgramTrackWriteScope,
} from "../workflow-guard.js";

function normalizeLooseStringArray(value: unknown): string[] {
  const direct = asString(value);
  if (direct) {
    return [direct];
  }
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => normalizeLooseStringArray(entry)));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of ["items", "entries", "values", "list", "paths"]) {
    const nested = normalizeLooseStringArray(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }
  return uniqueStrings(
    Object.values(record)
      .map((entry) => asString(entry))
      .filter((entry): entry is string => Boolean(entry))
  );
}

function normalizeCollectionEntries(
  value: unknown,
  nestedKeys: string[]
): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of nestedKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    const nestedRecord = asRecord(candidate);
    if (nestedRecord) {
      const nestedValues = Object.values(nestedRecord).filter(
        (entry) => Array.isArray(entry) || asRecord(entry)
      );
      if (nestedValues.length > 0) {
        return nestedValues.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
      }
    }
  }
  return Object.values(record).filter((entry) => asRecord(entry));
}

function normalizeResearchProgramStageMatrix(value: unknown): string[] {
  const direct = asString(value);
  if (direct) {
    const normalized = normalizeStage(direct);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.flatMap((entry) => normalizeResearchProgramStageMatrix(entry))
    );
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of ["entries", "stages", "items", "phases"]) {
    const nested = normalizeResearchProgramStageMatrix(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }
  const explicit = pickString(record, [
    "stage",
    "stageId",
    "stage_id",
    "name",
    "phase",
    "id",
  ]);
  if (explicit) {
    const normalized = normalizeStage(explicit);
    return normalized ? [normalized] : [];
  }
  return uniqueStrings(
    Object.entries(record)
      .filter(([, entry]) => {
        if (typeof entry === "boolean") {
          return entry;
        }
        if (asString(entry)) {
          return true;
        }
        return asRecord(entry) != null;
      })
      .map(([key]) => normalizeStage(key) ?? "")
      .filter(Boolean)
  );
}

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
    allowedClaimIds: normalizeLooseStringArray(
      record.allowedClaimIds ?? record.allowed_claim_ids
    ),
    allowedFigureIds: normalizeLooseStringArray(
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

function normalizeResearchProgramPlanAlternativeStatus(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "candidate";
}

function normalizeResearchProgramPlanAlternative(
  value: unknown
): ResearchProgramPlanAlternative {
  const record = asRecord(value) ?? {};
  return {
    optionId:
      pickString(record, ["optionId", "option_id"]) ??
      `plan-option-${Math.random().toString(36).slice(2, 8)}`,
    linkedTrackId: pickString(record, ["linkedTrackId", "linked_track_id"]),
    sourceDirectionId: pickString(record, [
      "sourceDirectionId",
      "source_direction_id",
    ]),
    title: pickString(record, ["title"]),
    status: normalizeResearchProgramPlanAlternativeStatus(record.status),
    summary: pickString(record, ["summary"]),
    graphEvidencePaths: normalizeLooseStringArray(
      record.graphEvidencePaths ?? record.graph_evidence_paths
    ),
    keyRisks: normalizeLooseStringArray(record.keyRisks ?? record.key_risks),
  };
}

function serializeResearchProgramPlanAlternative(
  value: ResearchProgramPlanAlternative
): Record<string, unknown> {
  return {
    option_id: value.optionId,
    linked_track_id: value.linkedTrackId,
    source_direction_id: value.sourceDirectionId,
    title: value.title,
    status: value.status,
    summary: value.summary,
    graph_evidence_paths: value.graphEvidencePaths,
    key_risks: value.keyRisks,
  };
}

function normalizeResearchProgramPlanSelection(
  value: unknown
): ResearchProgramPlanSelection {
  const record = asRecord(value) ?? {};
  return {
    selectedOptionId: pickString(record, [
      "selectedOptionId",
      "selected_option_id",
    ]),
    selectedTrackId: pickString(record, [
      "selectedTrackId",
      "selected_track_id",
    ]),
    comparedOptionIds: normalizeLooseStringArray(
      record.comparedOptionIds ?? record.compared_option_ids
    ),
    rationale: pickString(record, ["rationale"]),
    decisiveGraphEvidencePaths: normalizeLooseStringArray(
      record.decisiveGraphEvidencePaths ?? record.decisive_graph_evidence_paths
    ),
    fallbackOptionIds: normalizeLooseStringArray(
      record.fallbackOptionIds ?? record.fallback_option_ids
    ),
    lastComparedAt: pickString(record, ["lastComparedAt", "last_compared_at"]),
  };
}

function serializeResearchProgramPlanSelection(
  value: ResearchProgramPlanSelection
): Record<string, unknown> {
  return {
    selected_option_id: value.selectedOptionId,
    selected_track_id: value.selectedTrackId,
    compared_option_ids: value.comparedOptionIds,
    rationale: value.rationale,
    decisive_graph_evidence_paths: value.decisiveGraphEvidencePaths,
    fallback_option_ids: value.fallbackOptionIds,
    last_compared_at: value.lastComparedAt,
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
    requiredBaselines: normalizeLooseStringArray(
      record.requiredBaselines ?? record.required_baselines
    ),
    requiredAblations: normalizeLooseStringArray(
      record.requiredAblations ?? record.required_ablations
    ),
    requiredControls: normalizeLooseStringArray(
      record.requiredControls ?? record.required_controls
    ),
    experimentStageMatrix: normalizeResearchProgramStageMatrix(
      record.experimentStageMatrix ?? record.experiment_stage_matrix
    ),
    budget: normalizeResearchProgramTrackBudget(record.budget),
    stopRules: normalizeLooseStringArray(record.stopRules ?? record.stop_rules),
    rollbackTriggers: normalizeLooseStringArray(
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
    dependencies: normalizeLooseStringArray(
      record.dependencies ?? record.depends_on
    ),
    entryCriteria: normalizeLooseStringArray(
      record.entryCriteria ?? record.entry_criteria
    ),
    expectedOutputs: normalizeLooseStringArray(
      record.expectedOutputs ?? record.expected_outputs
    ),
    retryBudget: pickNumber(record, ["retryBudget", "retry_budget"]),
    exitCriteria: normalizeLooseStringArray(
      record.exitCriteria ?? record.exit_criteria
    ),
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
  const trackEntries = normalizeCollectionEntries(record.tracks, [
    "tracks",
    "entries",
    "items",
  ]);
  const taskGraphEntries = normalizeCollectionEntries(
    record.taskGraph ?? record.task_graph,
    ["tasks", "entries", "items", "nodes"]
  );
  const planAlternativeEntries = normalizeCollectionEntries(
    record.planAlternatives ?? record.plan_alternatives,
    ["options", "alternatives", "entries", "items"]
  );
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
    datasets: normalizeLooseStringArray(record.datasets),
    constraints: normalizeLooseStringArray(record.constraints),
    successCriteria: normalizeLooseStringArray(
      record.successCriteria ?? record.success_criteria
    ),
    zoteroProjectPath: pickString(record, [
      "zoteroProjectPath",
      "zotero_project_path",
    ]),
    tracks: trackEntries.map((entry) => normalizeResearchProgramTrack(entry)),
    planAlternatives: planAlternativeEntries.map((entry: unknown) =>
      normalizeResearchProgramPlanAlternative(entry)
    ),
    planSelection: normalizeResearchProgramPlanSelection(
      record.planSelection ?? record.plan_selection
    ),
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
    plan_alternatives: value.planAlternatives.map((entry) =>
      serializeResearchProgramPlanAlternative(entry)
    ),
    plan_selection: serializeResearchProgramPlanSelection(value.planSelection),
    global_constraints: serializeResearchProgramGlobalConstraints(
      value.globalConstraints
    ),
    task_graph: value.taskGraph.map((entry) => serializeResearchProgramTask(entry)),
    last_updated_at: value.lastUpdatedAt,
    pending_reason: value.pendingReason,
  };
}
