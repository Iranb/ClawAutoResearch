import {
  asRecord,
  normalizeStage,
  pickString,
} from "../workflow-guard-core/coercion";
import { isTerminalExperimentStatus } from "../workflow-guard-experiment-history";
import { normalizeIdeationContractState } from "../workflow-guard-state/ideation-contract";
import { defaultResearchProgramZoteroProjectPath } from "../workflow-guard-project/project-context";
import { normalizeBrainstormCycleState } from "../workflow-guard-state/research-loop-state";

type ResearchProgramState = ReturnType<
  typeof import("../workflow-guard-state/research-program").normalizeResearchProgramState
>;
type IdeationContractState = ReturnType<typeof normalizeIdeationContractState>;
type InnovationReflectionState = ReturnType<
  typeof import("../workflow-guard-state/research-loop-state").normalizeInnovationReflectionState
>;
type BrainstormCycleState = ReturnType<typeof normalizeBrainstormCycleState>;

const REQUIRED_RESEARCH_PROGRAM_EXPERIMENT_STAGES = [
  "baseline_implementation",
  "baseline_tuning",
  "creative_research",
  "ablation_studies",
];

export function formatWorkflowShellArgument(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/u.test(value)
    ? value
    : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

export function getResearchProgramValidationErrors(
  state: ResearchProgramState
): string[] {
  const errors: string[] = [];
  const activeTracks = state.tracks.filter((track) => normalizeStage(track.status) === "active");
  if (!["approved", "ready", "running"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.research_program.status must be approved/ready/running (current: ${state.status})`
    );
  }
  if (!state.goal) {
    errors.push("PROJECT_MANIFEST.json.research_program.goal is required");
  }
  if (activeTracks.length === 0) {
    errors.push(
      "PROJECT_MANIFEST.json.research_program must define at least one active track"
    );
  }
  if (state.globalConstraints.maxActiveTracks != null) {
    if (activeTracks.length > state.globalConstraints.maxActiveTracks) {
      errors.push(
        `active track count ${activeTracks.length} exceeds research_program.global_constraints.max_active_tracks=${state.globalConstraints.maxActiveTracks}`
      );
    }
  }
  for (const track of activeTracks) {
    if (!track.hypothesis) {
      errors.push(`research_program track ${track.trackId} missing hypothesis`);
    }
    if (!track.noveltyBasis) {
      errors.push(`research_program track ${track.trackId} missing novelty_basis`);
    }
    if (!track.mainMetric) {
      errors.push(`research_program track ${track.trackId} missing main_metric`);
    }
    if (!track.successThreshold) {
      errors.push(`research_program track ${track.trackId} missing success_threshold`);
    }
    if (track.requiredBaselines.length === 0) {
      errors.push(`research_program track ${track.trackId} requires at least one baseline`);
    }
    if (track.requiredAblations.length === 0) {
      errors.push(`research_program track ${track.trackId} requires at least one ablation`);
    }
    if (track.stopRules.length === 0) {
      errors.push(`research_program track ${track.trackId} requires stop_rules`);
    }
    if (track.rollbackTriggers.length === 0) {
      errors.push(
        `research_program track ${track.trackId} requires rollback_triggers`
      );
    }
    const stageMatrix = new Set(
      track.experimentStageMatrix.map((entry) => normalizeStage(entry) ?? entry)
    );
    for (const requiredStage of REQUIRED_RESEARCH_PROGRAM_EXPERIMENT_STAGES) {
      if (!stageMatrix.has(requiredStage)) {
        errors.push(
          `research_program track ${track.trackId} is missing experiment_stage_matrix entry ${requiredStage}`
        );
      }
    }
    if (
      track.writeScope.allowedClaimIds.length === 0 &&
      track.writeScope.allowedFigureIds.length === 0
    ) {
      errors.push(
        `research_program track ${track.trackId} must declare write_scope allowed claims or figures`
      );
    }
    if (
      track.budget.gpuHours == null &&
      track.budget.maxRuns == null &&
      track.budget.maxDebugIterations == null
    ) {
      errors.push(`research_program track ${track.trackId} must declare a budget`);
    }
  }
  for (const track of activeTracks) {
    const hasTask = state.taskGraph.some(
      (task) =>
        task.trackId === track.trackId &&
        task.entryCriteria.length > 0 &&
        task.expectedOutputs.length > 0 &&
        task.exitCriteria.length > 0
    );
    if (!hasTask) {
      errors.push(
        `research_program track ${track.trackId} requires task_graph coverage with entry/output/exit criteria`
      );
    }
  }
  if (
    state.planSelection.selectedTrackId &&
    !state.tracks.some((track) => track.trackId === state.planSelection.selectedTrackId)
  ) {
    errors.push(
      `research_program.plan_selection.selected_track_id (${state.planSelection.selectedTrackId}) must reference a declared track`
    );
  }
  if (
    state.planSelection.selectedOptionId &&
    !state.planAlternatives.some(
      (option) => option.optionId === state.planSelection.selectedOptionId
    )
  ) {
    errors.push(
      `research_program.plan_selection.selected_option_id (${state.planSelection.selectedOptionId}) must reference research_program.plan_alternatives`
    );
  }
  return errors;
}

export function getResearchProgramOnboardingGaps(params: {
  state: ResearchProgramState;
  projectId?: string | null;
}): string[] {
  const { state } = params;
  const gaps: string[] = [];
  if (!state.goal) {
    gaps.push("PROJECT_MANIFEST.json.research_program.goal");
  }
  if (!state.problemStatement) {
    gaps.push("PROJECT_MANIFEST.json.research_program.problem_statement");
  }
  if (!state.baselineReference) {
    gaps.push("PROJECT_MANIFEST.json.research_program.baseline_reference");
  }
  if (!state.primaryMetric) {
    gaps.push("PROJECT_MANIFEST.json.research_program.primary_metric");
  }
  if (state.datasets.length === 0) {
    gaps.push("PROJECT_MANIFEST.json.research_program.datasets");
  }
  if (state.successCriteria.length === 0) {
    gaps.push("PROJECT_MANIFEST.json.research_program.success_criteria");
  }
  if (!state.zoteroProjectPath) {
    gaps.push(
      `PROJECT_MANIFEST.json.research_program.zotero_project_path (recommended: ${
        defaultResearchProgramZoteroProjectPath(params.projectId) ??
        "<zoteroProjectRoot>/<project-id>"
      })`
    );
  }
  return gaps;
}

export function getResearchProgramOnboardingStatus(params: {
  state: ResearchProgramState;
  projectId?: string | null;
}): string {
  return getResearchProgramOnboardingGaps(params).length === 0
    ? "ready"
    : "incomplete";
}

export function getResearchProgramPlanValidationErrors(params: {
  state: ResearchProgramState;
  ideationContract?: IdeationContractState | null;
}): string[] {
  const errors: string[] = [];
  const comparedOptionIds = [...new Set(params.state.planSelection.comparedOptionIds)];
  if (params.state.planAlternatives.length < 2) {
    errors.push(
      "PROJECT_MANIFEST.json.research_program.plan_alternatives must compare at least two graph-grounded options"
    );
  }
  if (!params.state.planSelection.selectedOptionId) {
    errors.push("PROJECT_MANIFEST.json.research_program.plan_selection.selected_option_id is required");
  }
  if (!params.state.planSelection.selectedTrackId) {
    errors.push("PROJECT_MANIFEST.json.research_program.plan_selection.selected_track_id is required");
  }
  if (comparedOptionIds.length < 2) {
    errors.push(
      "PROJECT_MANIFEST.json.research_program.plan_selection.compared_option_ids must record at least two compared options"
    );
  }
  if (
    params.state.planSelection.selectedOptionId &&
    comparedOptionIds.length > 0 &&
    !comparedOptionIds.includes(params.state.planSelection.selectedOptionId)
  ) {
    errors.push(
      "research_program.plan_selection.selected_option_id must also appear in compared_option_ids"
    );
  }
  if (!params.state.planSelection.rationale) {
    errors.push("PROJECT_MANIFEST.json.research_program.plan_selection.rationale is required");
  }
  if (params.state.planSelection.decisiveGraphEvidencePaths.length === 0) {
    errors.push(
      "PROJECT_MANIFEST.json.research_program.plan_selection.decisive_graph_evidence_paths must cite graph-backed evidence"
    );
  }
  if (
    params.state.planSelection.selectedTrackId &&
    params.ideationContract?.selectedTrackId &&
    params.state.planSelection.selectedTrackId !== params.ideationContract.selectedTrackId
  ) {
    errors.push(
      `research_program.plan_selection.selected_track_id should stay aligned with ideation_contract.selected_track_id (${params.ideationContract.selectedTrackId})`
    );
  }

  const selectedOption = params.state.planSelection.selectedOptionId
    ? params.state.planAlternatives.find(
        (option) => option.optionId === params.state.planSelection.selectedOptionId
      ) ?? null
    : null;
  if (selectedOption) {
    if (selectedOption.status !== "selected") {
      errors.push(
        `research_program.plan_alternatives option ${selectedOption.optionId} must have status=selected`
      );
    }
    if (
      selectedOption.linkedTrackId &&
      params.state.planSelection.selectedTrackId &&
      selectedOption.linkedTrackId !== params.state.planSelection.selectedTrackId
    ) {
      errors.push(
        `research_program.plan_alternatives option ${selectedOption.optionId} should point at selected_track_id=${params.state.planSelection.selectedTrackId}`
      );
    }
  }

  for (const optionId of comparedOptionIds) {
    const option =
      params.state.planAlternatives.find((entry) => entry.optionId === optionId) ?? null;
    if (!option) {
      errors.push(
        `research_program.plan_selection.compared_option_ids references missing option ${optionId}`
      );
      continue;
    }
    if (!option.title) {
      errors.push(`research_program.plan_alternatives option ${option.optionId} missing title`);
    }
    if (!option.summary) {
      errors.push(`research_program.plan_alternatives option ${option.optionId} missing summary`);
    }
    if (option.graphEvidencePaths.length === 0) {
      errors.push(
        `research_program.plan_alternatives option ${option.optionId} must cite graph_evidence_paths`
      );
    }
  }

  return errors;
}

export function isInnovationReflectionDue(params: {
  state: InnovationReflectionState;
  ledger: unknown;
}): boolean {
  const basis = getInnovationReflectionBasis(params.ledger);
  if (!params.state.requiredAfterExperiments || basis.experimentIds.length === 0) {
    return false;
  }
  if (params.state.status === "running") {
    return false;
  }
  if (!params.state.lastReflectionAt || !params.state.lastReflectionPath) {
    return true;
  }
  if (!params.state.reflectedThroughExperimentUpdateAt) {
    return true;
  }
  if (
    basis.latestExperimentUpdateAt &&
    Date.parse(params.state.reflectedThroughExperimentUpdateAt) <
      Date.parse(basis.latestExperimentUpdateAt)
  ) {
    return true;
  }
  if (params.state.status === "pending" || params.state.status === "stale") {
    return true;
  }
  const reflectedIds = new Set(params.state.reflectedExperimentIds);
  return basis.experimentIds.some((experimentId) => !reflectedIds.has(experimentId));
}

export function isBrainstormCycleReady(state: BrainstormCycleState): boolean {
  return ["ready", "reconciled"].includes(normalizeStage(state.status) ?? "");
}

export function getBrainstormCycleValidationErrors(
  state: BrainstormCycleState
): string[] {
  const errors: string[] = [];
  if (!state.topic) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.topic is required");
  }
  if (!state.basisStage) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.basis_stage is required");
  }
  if (!state.provider) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.provider is required");
  }
  if (!state.providerMode) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.provider_mode is required");
  }
  if (!Number.isFinite(state.contractVersion ?? NaN)) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.contract_version is required");
  }
  for (const [field, value] of [
    ["topic_summary_path", state.topicSummaryPath],
    ["research_brief_path", state.researchBriefPath],
    ["brainstorm_brief_path", state.brainstormBriefPath],
    ["logic_chain_path", state.logicChainPath],
    ["evidence_chain_path", state.evidenceChainPath],
    ["reasoning_trace_path", state.reasoningTracePath],
    ["question_packet_path", state.questionPacketPath],
    ["working_memory_path", state.workingMemoryPath],
    ["synthesis_packet_path", state.synthesisPacketPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.brainstorm_cycle.${field} is required`);
    }
  }
  if (isBrainstormCycleReady(state)) {
    if (!["ready", "reconciled"].includes(normalizeStage(state.providerStatus) ?? "")) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.provider_status = ready|reconciled is required when the brainstorm cycle is ready"
      );
    }
    if (state.rounds.length === 0) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.rounds must contain at least one completed brainstorm round"
      );
    }
    if (!state.selectedRoundId) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.selected_round_id is required when the brainstorm cycle is ready"
      );
    }
    if (!state.selectedOptionId) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.selected_option_id is required when the brainstorm cycle is ready"
      );
    }
  }
  return errors;
}

function getInnovationReflectionBasis(ledger: unknown): {
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
} {
  const ledgerRecord = asRecord(ledger);
  const experiments = Array.isArray(ledgerRecord?.experiments)
    ? ledgerRecord.experiments
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const reflectable = experiments
    .filter((entry) =>
      Boolean(
        normalizeStage(entry.status) ||
          entry.completedAt ||
          entry.decision ||
          entry.keyMetric ||
          entry.failureSignature ||
          (Array.isArray(entry.resultPaths) && entry.resultPaths.length > 0) ||
          (Array.isArray(entry.evidencePointers) && entry.evidencePointers.length > 0)
      )
    )
    .sort((left, right) => {
      const leftUpdated = pickString(left, ["updatedAt", "updated_at"]) ?? "";
      const rightUpdated = pickString(right, ["updatedAt", "updated_at"]) ?? "";
      return rightUpdated.localeCompare(leftUpdated);
    });
  return {
    latestExperimentUpdateAt:
      reflectable.length > 0
        ? pickString(reflectable[0], ["updatedAt", "updated_at"])
        : null,
    experimentIds: reflectable
      .map((entry) => pickString(entry, ["experimentId", "experiment_id"]) ?? null)
      .filter((entry): entry is string => Boolean(entry)),
  };
}

export function countTerminalExperimentEntries(ledger: unknown): number {
  return getExperimentLedgerEntries(ledger).filter((entry) =>
    isTerminalExperimentStatus(normalizeStage(pickString(entry, ["status"])) ?? null)
  ).length;
}

export function countFinishedExperimentEntriesAwaitingReconciliation(params: {
  ledger: unknown;
  experimentSearch: { status?: string | null } | null | undefined;
}): number {
  if (normalizeStage(params.experimentSearch?.status) === "ready_for_analysis") {
    return 0;
  }
  return getExperimentLedgerEntries(params.ledger).filter((entry) => {
    const status = normalizeStage(pickString(entry, ["status"])) ?? null;
    if (!isTerminalExperimentStatus(status)) {
      return false;
    }
    const resultPaths = entry.resultPaths ?? entry.result_paths;
    const evidencePointers = entry.evidencePointers ?? entry.evidence_pointers;
    return Boolean(
      pickString(entry, ["completedAt", "completed_at", "finishedAt", "finished_at"]) ||
        (Array.isArray(resultPaths) && resultPaths.length > 0) ||
        (Array.isArray(evidencePointers) && evidencePointers.length > 0) ||
        asRecord(entry.keyMetric ?? entry.key_metric ?? entry.metric) ||
        asRecord(entry.metrics)
    );
  }).length;
}

function getExperimentLedgerEntries(
  ledger: unknown
): Array<Record<string, unknown>> {
  const ledgerRecord = asRecord(ledger);
  return Array.isArray(ledgerRecord?.experiments)
    ? ledgerRecord.experiments
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}
