import * as path from "node:path";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { defaultResearchProgramZoteroProjectPath } from "../workflow-guard-project-state";
import {
  computeIdleResearchNextDueAt,
  isIdleResearchDue,
  normalizeIdleResearchState,
  serializeIdleResearchState,
} from "../workflow-guard-state/research-loop-state";
import {
  normalizeBrainstormCycleState,
  serializeBrainstormCycleState,
} from "../workflow-guard-state/research-loop-state";
import {
  normalizeResearchProgramState,
  serializeResearchProgramState,
  serializeResearchProgramTask,
  serializeResearchProgramTrack,
} from "../workflow-guard-state/research-program";
import {
  getSurveyReviewStateSummary,
  normalizeSurveyReviewState,
  serializeSurveyReviewState,
} from "../workflow-guard-state/survey-review";
import {
  normalizeIdeationContractState,
  serializeIdeationContractState,
} from "../workflow-guard-state/ideation-contract";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "../workflow-guard-state/paper-story";
import {
  normalizeReviewPressurePacketState,
  serializeReviewPressurePacketState,
} from "../workflow-guard-state/review-pressure";
import {
  normalizeOrchestrationState,
  serializeOrchestrationState,
  normalizeExperimentSearchState,
  serializeExperimentSearchState,
  normalizeWritePackageState,
  serializeWritePackageState,
} from "../workflow-guard-state/execution-state";
import {
  coerceCompletedReviewStatus,
  normalizeExperimentReviewVerdict,
  normalizeExperimentReviewState,
  serializeExperimentReviewState,
} from "../workflow-guard-state/experiment-review";
import {
  getExperimentSearchPath,
  loadExperimentSearchState,
  saveExperimentSearchStateFile,
} from "../workflow-guard-experiment-history";
import {
  normalizeExperimentInnerLoopContract,
} from "../workflow-experiment-loop";
import { inferExperimentSearchContractDefaults } from "./experiment-search-inference";
import {
  normalizeExperimentSearchSpec,
  resolveExperimentSearchSpecPath,
} from "../workflow-guard-state/experiment-search-spec";
import {
  getExperimentReviewStatePath,
  loadExperimentReviewState,
  saveExperimentReviewStateFile,
} from "../workflow-auto-experiment-review";
import { summarizeIdeationContractState } from "../workflow-guard-summaries/ideation-contract-summary";
import { summarizePaperStoryState } from "../workflow-guard-summaries/paper-story-summary";
import { summarizeReviewPressurePacketState } from "../workflow-guard-summaries/review-pressure-summary";
import { STAGE_REQUIREMENTS } from "../workflow-guard-policies/role-policy";
import {
  getWritePackageValidationErrors,
  isRuntimeReadyStatus,
} from "../workflow-guard-writing/write-package-eval";

type IdleResearchState = ReturnType<typeof normalizeIdleResearchState>;
type BrainstormCycleState = ReturnType<typeof normalizeBrainstormCycleState>;
type ResearchProgramState = ReturnType<typeof normalizeResearchProgramState>;
type IdeationContractState = ReturnType<typeof normalizeIdeationContractState>;
type PaperStoryState = ReturnType<typeof normalizePaperStoryState>;
type ReviewPressurePacketState = ReturnType<typeof normalizeReviewPressurePacketState>;
type OrchestrationState = ReturnType<typeof normalizeOrchestrationState>;
type WritePackageState = ReturnType<typeof normalizeWritePackageState>;
type ExperimentSearchState = ReturnType<typeof normalizeExperimentSearchState>;
type ExperimentReviewState = ReturnType<typeof normalizeExperimentReviewState>;
type SurveyReviewState = ReturnType<typeof normalizeSurveyReviewState>;

const DEFAULT_BRAINSTORM_CYCLE_DIR = "researcher/brainstorm-cycle";

const DEFAULT_RESEARCH_REVIEW_STATE_PATH = "researcher/REVIEW_STATE.json";
const DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH =
  "reviewer/SUBMISSION_SIMULATION_REVIEW.json";

const REQUIRED_RESEARCH_PROGRAM_EXPERIMENT_STAGES = [
  "baseline_implementation",
  "baseline_tuning",
  "creative_research",
  "ablation_studies",
];

function getManifestPath(projectRoot: string): string {
  return path.join(projectRoot, "PROJECT_MANIFEST.json");
}

async function readManifestEnsured(projectRoot: string): Promise<Record<string, unknown>> {
  return (await readJsonIfExists<Record<string, unknown>>(getManifestPath(projectRoot))) ?? {};
}

async function saveManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(getManifestPath(projectRoot), manifest);
}

async function fileHasMeaningfulJsonContent(
  targetPath: string | null
): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  try {
    const raw = await readJsonIfExists<unknown>(targetPath);
    if (raw == null) {
      return false;
    }
    if (Array.isArray(raw)) {
      return raw.length > 0;
    }
    if (typeof raw === "object") {
      return Object.keys(raw as Record<string, unknown>).length > 0;
    }
    if (typeof raw === "string") {
      return raw.trim().length > 0;
    }
    return true;
  } catch {
    return false;
  }
}

async function fileHasNonWhitespaceContent(targetPath: string | null): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  const raw = await readTextIfExists(targetPath);
  return Boolean(raw && raw.trim().length > 0);
}

function getBrainstormCycleRootRelativeDir(trackId: string | null): string {
  const normalizedTrackId = trackId?.trim().replace(/[\\/]/g, "_") ?? null;
  if (normalizedTrackId) {
    return `researcher/reasoning/${normalizedTrackId}`;
  }
  return DEFAULT_BRAINSTORM_CYCLE_DIR;
}

function getBrainstormCycleDefaultPaths(trackId: string | null): {
  topicSummaryPath: string;
  researchBriefPath: string;
  brainstormBriefPath: string;
  logicChainPath: string;
  evidenceChainPath: string;
  reasoningTracePath: string;
  questionPacketPath: string;
  workingMemoryPath: string;
  synthesisPacketPath: string;
  reflectionChainPath: string;
  theoryBriefPath: string;
  storylineBriefPath: string;
} {
  const root = getBrainstormCycleRootRelativeDir(trackId);
  return {
    topicSummaryPath: `${root}/TOPIC_SUMMARY.json`,
    researchBriefPath: `${root}/RESEARCH_BRIEF.json`,
    brainstormBriefPath: `${root}/BRAINSTORM_BRIEF.json`,
    logicChainPath: `${root}/LOGIC_CHAIN.md`,
    evidenceChainPath: `${root}/EVIDENCE_CHAIN.md`,
    reasoningTracePath: `${root}/REASONING_TRACE.jsonl`,
    questionPacketPath: `${root}/QUESTION_PACKET.md`,
    workingMemoryPath: `${root}/WORKING_MEMORY.json`,
    synthesisPacketPath: `${root}/SYNTHESIS_PACKET.md`,
    reflectionChainPath: `${root}/REFLECTION_CHAIN.json`,
    theoryBriefPath: `${root}/THEORY_BRIEF.json`,
    storylineBriefPath: `${root}/STORYLINE_BRIEF.json`,
  };
}

function isBrainstormCycleReady(state: BrainstormCycleState): boolean {
  return ["ready", "reconciled"].includes(normalizeStage(state.status) ?? "");
}

function getBrainstormCycleValidationErrors(
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

async function summarizeBrainstormCycleState(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
  topicSummaryResolvedPath: string | null;
  topicSummaryExists: boolean;
  researchBriefResolvedPath: string | null;
  researchBriefExists: boolean;
  brainstormBriefResolvedPath: string | null;
  brainstormBriefExists: boolean;
  logicChainResolvedPath: string | null;
  logicChainExists: boolean;
  evidenceChainResolvedPath: string | null;
  evidenceChainExists: boolean;
  reasoningTraceResolvedPath: string | null;
  reasoningTraceExists: boolean;
  questionPacketResolvedPath: string | null;
  questionPacketExists: boolean;
  workingMemoryResolvedPath: string | null;
  workingMemoryExists: boolean;
  synthesisPacketResolvedPath: string | null;
  synthesisPacketExists: boolean;
}> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const validationErrors = getBrainstormCycleValidationErrors(state);
  const topicSummaryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.topicSummaryPath
  );
  const researchBriefResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.researchBriefPath
  );
  const brainstormBriefResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.brainstormBriefPath
  );
  const logicChainResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.logicChainPath
  );
  const evidenceChainResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.evidenceChainPath
  );
  const reasoningTraceResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.reasoningTracePath
  );
  const questionPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.questionPacketPath
  );
  const workingMemoryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.workingMemoryPath
  );
  const synthesisPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.synthesisPacketPath
  );
  const contentChecks = await Promise.all([
    fileHasMeaningfulJsonContent(topicSummaryResolvedPath),
    fileHasMeaningfulJsonContent(researchBriefResolvedPath),
    fileHasMeaningfulJsonContent(brainstormBriefResolvedPath),
    fileHasNonWhitespaceContent(logicChainResolvedPath),
    fileHasNonWhitespaceContent(evidenceChainResolvedPath),
    fileHasNonWhitespaceContent(reasoningTraceResolvedPath),
    fileHasNonWhitespaceContent(questionPacketResolvedPath),
    fileHasMeaningfulJsonContent(workingMemoryResolvedPath),
    fileHasNonWhitespaceContent(synthesisPacketResolvedPath),
  ]);
  const chainBundleReady =
    isBrainstormCycleReady(state) &&
    validationErrors.length === 0 &&
    contentChecks.every(Boolean);
  return {
    state,
    validationErrors,
    chainBundleReady,
    topicSummaryResolvedPath,
    topicSummaryExists: contentChecks[0],
    researchBriefResolvedPath,
    researchBriefExists: contentChecks[1],
    brainstormBriefResolvedPath,
    brainstormBriefExists: contentChecks[2],
    logicChainResolvedPath,
    logicChainExists: contentChecks[3],
    evidenceChainResolvedPath,
    evidenceChainExists: contentChecks[4],
    reasoningTraceResolvedPath,
    reasoningTraceExists: contentChecks[5],
    questionPacketResolvedPath,
    questionPacketExists: contentChecks[6],
    workingMemoryResolvedPath,
    workingMemoryExists: contentChecks[7],
    synthesisPacketResolvedPath,
    synthesisPacketExists: contentChecks[8],
  };
}

function getResearchProgramValidationErrors(
  state: ResearchProgramState
): string[] {
  const errors: string[] = [];
  const activeTracks = state.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
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
      errors.push(`research_program track ${track.trackId} requires rollback_triggers`);
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

function getResearchProgramOnboardingGaps(params: {
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
        defaultResearchProgramZoteroProjectPath(params.projectId) ?? "bot/<project-id>"
      })`
    );
  }
  return gaps;
}

function getResearchProgramOnboardingStatus(params: {
  state: ResearchProgramState;
  projectId?: string | null;
}): string {
  return getResearchProgramOnboardingGaps(params).length === 0
    ? "ready"
    : "incomplete";
}

function getIdeationContractValidationErrors(
  state: IdeationContractState
): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.ideation_contract.status = ready|reconciled|approved (current: ${state.status})`
    );
  }
  if (!Number.isFinite(state.contractVersion ?? NaN)) {
    errors.push("PROJECT_MANIFEST.json.ideation_contract.contract_version is required");
  }
  for (const [field, value] of [
    ["long_term_goal", state.longTermGoal],
    ["basis_stage", state.basisStage],
    ["idea_tree_path", state.ideaTreePath],
    ["novelty_tree_path", state.noveltyTreePath],
    ["challenge_insight_tree_path", state.challengeInsightTreePath],
    ["solution_check_path", state.solutionCheckPath],
    ["cross_domain_transfer_path", state.crossDomainTransferPath],
    ["problem_decomposition_path", state.problemDecompositionPath],
    ["candidate_pool_path", state.candidatePoolPath],
    ["ranking_history_path", state.rankingHistoryPath],
    ["tournament_scoreboard_path", state.tournamentScoreboardPath],
    ["top3_summary_path", state.top3SummaryPath],
    ["research_proposal_path", state.researchProposalPath],
    ["graph_ideation_packet_path", state.graphIdeationPacketPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.ideation_contract.${field} is required`);
    }
  }
  if (state.graphIdeationIndices.status === "missing") {
    errors.push(
      "PROJECT_MANIFEST.json.ideation_contract.graph_ideation_indices.status must not be missing"
    );
  }
  return errors;
}

function getPaperStoryStateValidationErrors(state: PaperStoryState): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.paper_story_state.status = ready|reconciled|approved (current: ${state.status})`
    );
  }
  for (const [field, value] of [
    ["task_summary_path", state.taskSummaryPath],
    ["challenge_statement_path", state.challengeStatementPath],
    ["insight_summary_path", state.insightSummaryPath],
    ["contribution_map_path", state.contributionMapPath],
    ["advantage_map_path", state.advantageMapPath],
    ["story_spine_path", state.storySpinePath],
    ["pipeline_figure_sketch_path", state.pipelineFigureSketchPath],
    ["module_motivation_map_path", state.moduleMotivationMapPath],
    ["claim_to_experiment_map_path", state.claimToExperimentMapPath],
    ["idea_to_claim_map_path", state.ideaToClaimMapPath],
    ["fallback_narrative_path", state.fallbackNarrativePath],
    ["rejection_risk_table_path", state.rejectionRiskTablePath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.paper_story_state.${field} is required`);
    }
  }
  if (normalizeStage(state.claimSupportStatus) === "unsupported") {
    errors.push(
      `PROJECT_MANIFEST.json.paper_story_state.claim_support_status must not be unsupported before WRITE (current: ${state.claimSupportStatus})`
    );
  }
  return errors;
}

function getReviewPressurePacketValidationErrors(
  state: ReviewPressurePacketState
): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.review_pressure_packet.status = ready|reconciled|approved (current: ${state.status})`
    );
  }
  for (const [field, value] of [
    ["reject_first_review_path", state.rejectFirstReviewPath],
    ["novelty_attack_path", state.noveltyAttackPath],
    ["unsupported_claim_audit_path", state.unsupportedClaimAuditPath],
    ["reverse_outline_path", state.reverseOutlinePath],
    ["figure_table_qc_path", state.figureTableQcPath],
    ["limitation_audit_path", state.limitationAuditPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(
        `PROJECT_MANIFEST.json.review_pressure_packet.${field} is required`
      );
    }
  }
  return errors;
}

function getOrchestrationStateValidationErrors(
  state: OrchestrationState,
  currentStage: string | null
): string[] {
  const errors: string[] = [];
  if (!["running", "ready", "waiting", "blocked"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.orchestration_state.status must be ready/running/waiting/blocked (current: ${state.status})`
    );
  }
  if (!state.currentOwner) {
    errors.push("PROJECT_MANIFEST.json.orchestration_state.current_owner is required");
  }
  if (!state.nextTransitionCandidate) {
    errors.push(
      "PROJECT_MANIFEST.json.orchestration_state.next_transition_candidate is required"
    );
  }
  if (currentStage && state.nextTransitionCandidate) {
    const expectedNext = STAGE_REQUIREMENTS[currentStage]?.nextStage ?? null;
    if (
      expectedNext &&
      normalizeStage(state.nextTransitionCandidate) !== normalizeStage(expectedNext)
    ) {
      errors.push(
        `orchestration_state.next_transition_candidate should be ${expectedNext} while current_stage=${currentStage} (current: ${state.nextTransitionCandidate})`
      );
    }
  }
  if (state.retryBudgetRemaining != null && state.retryBudgetRemaining < 0) {
    errors.push(
      "PROJECT_MANIFEST.json.orchestration_state.retry_budget_remaining must be >= 0"
    );
  }
  return errors;
}

function isExperimentSearchReadyForAnalysis(
  state: ExperimentSearchState
): boolean {
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

export async function setIdleResearchState(params: {
  projectRoot: string;
  idleResearch: Record<string, unknown>;
}): Promise<{
  state: IdleResearchState;
  due: boolean;
  nextDueAt: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeIdleResearchState(manifest.idle_research);
  const patch = asRecord(params.idleResearch) ?? {};
  const next: IdleResearchState = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    topic: pickString(patch, ["topic"]) ?? current.topic,
    objective: pickString(patch, ["objective"]) ?? current.objective,
    querySeeds:
      patch.querySeeds || patch.query_seeds
        ? asStringArray(patch.querySeeds ?? patch.query_seeds)
        : current.querySeeds,
    preferredVenues:
      patch.preferredVenues || patch.preferred_venues
        ? asStringArray(patch.preferredVenues ?? patch.preferred_venues)
        : current.preferredVenues,
    maxPapersPerCycle:
      Math.max(
        1,
        Math.floor(
          pickNumber(patch, ["maxPapersPerCycle", "max_papers_per_cycle"]) ??
            current.maxPapersPerCycle
        )
      ),
    cooldownMinutes:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, ["cooldownMinutes", "cooldown_minutes"]) ??
            current.cooldownMinutes
        )
      ),
    status: normalizeStage(patch.status) ?? current.status,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    nextQueryHint:
      pickString(patch, ["nextQueryHint", "next_query_hint"]) ??
      current.nextQueryHint,
    refreshGraphOnNewCorePapers:
      pickBoolean(patch, [
        "refreshGraphOnNewCorePapers",
        "refresh_graph_on_new_core_papers",
      ]) ?? current.refreshGraphOnNewCorePapers,
    lastRunAt:
      pickString(patch, ["lastRunAt", "last_run_at"]) ?? current.lastRunAt,
    lastDigestPath:
      pickString(patch, ["lastDigestPath", "last_digest_path"]) ??
      current.lastDigestPath,
    lastSourceUpdateAt:
      pickString(patch, ["lastSourceUpdateAt", "last_source_update_at"]) ??
      current.lastSourceUpdateAt,
    lastRoundNewCanonicalPapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, [
            "lastRoundNewCanonicalPapers",
            "last_round_new_canonical_papers",
          ]) ?? current.lastRoundNewCanonicalPapers
        )
      ),
    lastRoundNewCorePapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, [
            "lastRoundNewCorePapers",
            "last_round_new_core_papers",
          ]) ?? current.lastRoundNewCorePapers
        )
      ),
  };

  if (!next.enabled) {
    next.status = "disabled";
  } else if (next.topic && next.status === "disabled") {
    next.status = "pending";
  }

  manifest.idle_research = serializeIdleResearchState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: isIdleResearchDue(next),
    nextDueAt: computeIdleResearchNextDueAt(next),
  };
}

export async function setBrainstormCycleState(params: {
  projectRoot: string;
  brainstormCycle: Record<string, unknown>;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const patch = asRecord(params.brainstormCycle) ?? {};
  const requestedTrackId =
    pickString(patch, ["trackId", "track_id"]) ?? current.trackId;
  const trackId = requestedTrackId?.trim().replace(/[\\/]/g, "_") ?? null;
  const defaultPaths = getBrainstormCycleDefaultPaths(trackId);
  const preferScopedDefaults = Boolean(trackId && trackId !== current.trackId);
  const next = normalizeBrainstormCycleState({
    ...serializeBrainstormCycleState(current),
    ...patch,
    trackId,
    track_id: trackId,
    provider:
      pickString(patch, ["provider"]) ?? current.provider ?? "workflow_core_brainstorm",
    provider_mode:
      pickString(patch, ["providerMode", "provider_mode"]) ??
      current.providerMode ??
      "core",
    provider_status:
      normalizeStage(patch.providerStatus ?? patch.provider_status) ??
      current.providerStatus ??
      (isBrainstormCycleReady(current) ? "ready" : "pending"),
    provider_last_run_at:
      pickString(patch, ["providerLastRunAt", "provider_last_run_at"]) ??
      current.providerLastRunAt,
    provider_last_error:
      pickString(patch, ["providerLastError", "provider_last_error"]) ??
      current.providerLastError,
    contract_version:
      pickNumber(patch, ["contractVersion", "contract_version"]) ??
      current.contractVersion ??
      1,
    topic_summary_path:
      pickString(patch, ["topicSummaryPath", "topic_summary_path"]) ??
      (preferScopedDefaults ? defaultPaths.topicSummaryPath : current.topicSummaryPath) ??
      defaultPaths.topicSummaryPath,
    research_brief_path:
      pickString(patch, ["researchBriefPath", "research_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.researchBriefPath : current.researchBriefPath) ??
      defaultPaths.researchBriefPath,
    brainstorm_brief_path:
      pickString(patch, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.brainstormBriefPath : current.brainstormBriefPath) ??
      defaultPaths.brainstormBriefPath,
    logic_chain_path:
      pickString(patch, ["logicChainPath", "logic_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.logicChainPath : current.logicChainPath) ??
      defaultPaths.logicChainPath,
    evidence_chain_path:
      pickString(patch, ["evidenceChainPath", "evidence_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.evidenceChainPath : current.evidenceChainPath) ??
      defaultPaths.evidenceChainPath,
    reasoning_trace_path:
      pickString(patch, ["reasoningTracePath", "reasoning_trace_path"]) ??
      (preferScopedDefaults ? defaultPaths.reasoningTracePath : current.reasoningTracePath) ??
      defaultPaths.reasoningTracePath,
    question_packet_path:
      pickString(patch, ["questionPacketPath", "question_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.questionPacketPath : current.questionPacketPath) ??
      defaultPaths.questionPacketPath,
    working_memory_path:
      pickString(patch, ["workingMemoryPath", "working_memory_path"]) ??
      (preferScopedDefaults ? defaultPaths.workingMemoryPath : current.workingMemoryPath) ??
      defaultPaths.workingMemoryPath,
    synthesis_packet_path:
      pickString(patch, ["synthesisPacketPath", "synthesis_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.synthesisPacketPath : current.synthesisPacketPath) ??
      defaultPaths.synthesisPacketPath,
    reflection_chain_path:
      pickString(patch, ["reflectionChainPath", "reflection_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.reflectionChainPath : current.reflectionChainPath) ??
      defaultPaths.reflectionChainPath,
    theory_brief_path:
      pickString(patch, ["theoryBriefPath", "theory_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.theoryBriefPath : current.theoryBriefPath) ??
      defaultPaths.theoryBriefPath,
    storyline_brief_path:
      pickString(patch, ["storylineBriefPath", "storyline_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.storylineBriefPath : current.storylineBriefPath) ??
      defaultPaths.storylineBriefPath,
    latest_run_at:
      pickString(patch, ["latestRunAt", "latest_run_at"]) ??
      new Date().toISOString(),
  });

  manifest.brainstorm_cycle = serializeBrainstormCycleState(next);
  await saveManifest(params.projectRoot, manifest);
  const summary = await summarizeBrainstormCycleState({
    projectRoot: params.projectRoot,
    manifest,
  });
  return {
    state: next,
    validationErrors: summary.validationErrors,
    chainBundleReady: summary.chainBundleReady,
  };
}

export async function setResearchProgramState(params: {
  projectRoot: string;
  researchProgram: Record<string, unknown>;
}): Promise<{
  state: ResearchProgramState;
  validationErrors: string[];
  onboardingStatus: string;
  onboardingGaps: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeResearchProgramState(manifest.research_program);
  const patch = asRecord(params.researchProgram) ?? {};
  const normalizedPatch = normalizeResearchProgramState(patch);
  const hasTracksPatch = Object.prototype.hasOwnProperty.call(patch, "tracks");
  const hasTaskGraphPatch =
    Object.prototype.hasOwnProperty.call(patch, "taskGraph") ||
    Object.prototype.hasOwnProperty.call(patch, "task_graph");
  const merged = normalizeResearchProgramState({
    ...serializeResearchProgramState(current),
    ...patch,
    tracks: hasTracksPatch
      ? normalizedPatch.tracks.length > 0
        ? normalizedPatch.tracks.map((track) => serializeResearchProgramTrack(track))
        : current.tracks.map((track) => serializeResearchProgramTrack(track))
      : current.tracks.map((track) => serializeResearchProgramTrack(track)),
    task_graph:
      hasTaskGraphPatch
        ? normalizedPatch.taskGraph.length > 0
          ? normalizedPatch.taskGraph.map((task) => serializeResearchProgramTask(task))
          : current.taskGraph.map((task) => serializeResearchProgramTask(task))
        : current.taskGraph.map((task) => serializeResearchProgramTask(task)),
    global_constraints:
      asRecord(patch.globalConstraints ?? patch.global_constraints) ?? current.globalConstraints,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.research_program = serializeResearchProgramState(merged);
  await saveManifest(params.projectRoot, manifest);
  const projectId = pickString(manifest, ["project_id", "projectId"]);
  return {
    state: merged,
    validationErrors: getResearchProgramValidationErrors(merged),
    onboardingStatus: getResearchProgramOnboardingStatus({ state: merged, projectId }),
    onboardingGaps: getResearchProgramOnboardingGaps({ state: merged, projectId }),
  };
}

export async function setSurveyReviewState(params: {
  projectRoot: string;
  surveyReview: Record<string, unknown>;
}): Promise<{
  state: SurveyReviewState;
  ready: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeSurveyReviewState(manifest.survey_review);
  const patch = asRecord(params.surveyReview) ?? {};
  const next = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(current),
    ...patch,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.survey_review = serializeSurveyReviewState(next);
  manifest.workflow_line = "survey";
  manifest.paper_type = "survey";
  manifest.writing_contract = {
    ...(asRecord(manifest.writing_contract) ?? {}),
    paper_mode: "survey",
  };
  manifest.current_stage = "survey_review";
  manifest.current_micro_stage = next.currentPhase ?? "survey_requested";
  manifest.owner_agent = STAGE_REQUIREMENTS.survey_review?.owner ?? "researcher";
  await saveManifest(params.projectRoot, manifest);
  return getSurveyReviewStateSummary(manifest);
}

export async function setIdeationContractState(params: {
  projectRoot: string;
  ideationContract: Record<string, unknown>;
}): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeIdeationContractState(manifest.ideation_contract);
  const patch = asRecord(params.ideationContract) ?? {};
  const next = normalizeIdeationContractState({
    ...serializeIdeationContractState(current),
    ...patch,
    graph_basis_paths:
      asRecord(patch.graphBasisPaths ?? patch.graph_basis_paths) ??
      current.graphBasisPaths,
    graph_ideation_indices:
      asRecord(patch.graphIdeationIndices ?? patch.graph_ideation_indices) ??
      current.graphIdeationIndices,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.ideation_contract = serializeIdeationContractState(next);
  await saveManifest(params.projectRoot, manifest);
  const summary = await summarizeIdeationContractState({
    projectRoot: params.projectRoot,
    manifest,
    getIdeationContractValidationErrors,
    fileHasMeaningfulJsonContent,
    fileHasNonWhitespaceContent,
  });
  return {
    state: summary.state,
    validationErrors: summary.validationErrors,
    graphIdeationPacketResolvedPath: summary.graphIdeationPacketResolvedPath,
    graphIdeationPacketExists: summary.graphIdeationPacketExists,
    researchProposalResolvedPath: summary.researchProposalResolvedPath,
    researchProposalExists: summary.researchProposalExists,
  };
}

export async function setPaperStoryState(params: {
  projectRoot: string;
  paperStoryState: Record<string, unknown>;
}): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizePaperStoryState(manifest.paper_story_state);
  const patch = asRecord(params.paperStoryState) ?? {};
  const next = normalizePaperStoryState({
    ...serializePaperStoryState(current),
    ...patch,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.paper_story_state = serializePaperStoryState(next);
  await saveManifest(params.projectRoot, manifest);
  const summary = await summarizePaperStoryState({
    projectRoot: params.projectRoot,
    manifest,
    getPaperStoryStateValidationErrors,
    fileHasNonWhitespaceContent,
  });
  return {
    state: summary.state,
    validationErrors: summary.validationErrors,
    storySpineResolvedPath: summary.storySpineResolvedPath,
    storySpineExists: summary.storySpineExists,
    claimToExperimentMapResolvedPath: summary.claimToExperimentMapResolvedPath,
    claimToExperimentMapExists: summary.claimToExperimentMapExists,
  };
}

export async function setReviewPressurePacketState(params: {
  projectRoot: string;
  reviewPressurePacket: Record<string, unknown>;
}): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeReviewPressurePacketState(
    manifest.review_pressure_packet
  );
  const patch = asRecord(params.reviewPressurePacket) ?? {};
  const next = normalizeReviewPressurePacketState({
    ...serializeReviewPressurePacketState(current),
    ...patch,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.review_pressure_packet = serializeReviewPressurePacketState(next);
  await saveManifest(params.projectRoot, manifest);
  const summary = await summarizeReviewPressurePacketState({
    projectRoot: params.projectRoot,
    manifest,
    getReviewPressurePacketValidationErrors,
    fileHasNonWhitespaceContent,
  });
  return {
    state: summary.state,
    validationErrors: summary.validationErrors,
    rejectFirstReviewResolvedPath: summary.rejectFirstReviewResolvedPath,
    rejectFirstReviewExists: summary.rejectFirstReviewExists,
    unsupportedClaimAuditResolvedPath: summary.unsupportedClaimAuditResolvedPath,
    unsupportedClaimAuditExists: summary.unsupportedClaimAuditExists,
  };
}

export async function setOrchestrationState(params: {
  projectRoot: string;
  orchestrationState: Record<string, unknown>;
}): Promise<{
  state: OrchestrationState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeOrchestrationState(manifest.orchestration_state);
  const patch = asRecord(params.orchestrationState) ?? {};
  const surveyProject =
    normalizeStage(manifest.current_stage) === "survey_review" ||
    normalizeSurveyReviewState(manifest.survey_review).status !== "missing" ||
    normalizeStage((asRecord(manifest.writing_contract) ?? {}).paper_mode) === "survey" ||
    normalizeStage(manifest.workflow_line) === "survey" ||
    normalizeStage(manifest.paper_type) === "survey";
  const requestedTransition = pickString(patch, [
    "nextTransitionCandidate",
    "next_transition_candidate",
  ]);
  const surveyUnsafeTransition =
    surveyProject &&
    ["idea", "plan", "code", "experiment", "analyze"].includes(
      normalizeStage(requestedTransition) ?? ""
    );
  const next: OrchestrationState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    activeTicketId:
      pickString(patch, ["activeTicketId", "active_ticket_id"]) ??
      current.activeTicketId,
    stageRunId:
      pickString(patch, ["stageRunId", "stage_run_id"]) ?? current.stageRunId,
    currentExecutionId:
      pickString(patch, ["currentExecutionId", "current_execution_id"]) ??
      current.currentExecutionId,
    currentOwner:
      pickString(patch, ["currentOwner", "current_owner"]) ?? current.currentOwner,
    nextOwner:
      pickString(patch, ["nextOwner", "next_owner"]) ?? current.nextOwner,
    pendingHandoffId:
      pickString(patch, ["pendingHandoffId", "pending_handoff_id"]) ??
      current.pendingHandoffId,
    pendingOwnerCandidate:
      pickString(patch, ["pendingOwnerCandidate", "pending_owner_candidate"]) ??
      current.pendingOwnerCandidate,
    pendingStageCandidate:
      pickString(patch, ["pendingStageCandidate", "pending_stage_candidate"]) ??
      current.pendingStageCandidate,
    handoffPhase:
      pickString(patch, ["handoffPhase", "handoff_phase"]) ??
      current.handoffPhase,
    ownerClaimedAt:
      pickString(patch, ["ownerClaimedAt", "owner_claimed_at"]) ??
      current.ownerClaimedAt,
    ownerActivationDeadline:
      pickString(patch, [
        "ownerActivationDeadline",
        "owner_activation_deadline",
      ]) ?? current.ownerActivationDeadline,
    rollbackTargetOwner:
      pickString(patch, ["rollbackTargetOwner", "rollback_target_owner"]) ??
      current.rollbackTargetOwner,
    lastHandoffError:
      pickString(patch, ["lastHandoffError", "last_handoff_error"]) ??
      current.lastHandoffError,
    nextTransitionCandidate:
      surveyUnsafeTransition
        ? "survey_review"
        : requestedTransition ?? current.nextTransitionCandidate,
    blockingCategory:
      pickString(patch, ["blockingCategory", "blocking_category"]) ??
      current.blockingCategory,
    blockingReason:
      pickString(patch, ["blockingReason", "blocking_reason"]) ??
      current.blockingReason,
    rollbackReasonCategory:
      pickString(patch, [
        "rollbackReasonCategory",
        "rollback_reason_category",
      ]) ?? current.rollbackReasonCategory,
    rollbackEvidenceSummary:
      pickString(patch, [
        "rollbackEvidenceSummary",
        "rollback_evidence_summary",
      ]) ?? current.rollbackEvidenceSummary,
    retryBudgetRemaining:
      pickNumber(patch, ["retryBudgetRemaining", "retry_budget_remaining"]) ??
      current.retryBudgetRemaining,
    lastContractEvalAt:
      pickString(patch, ["lastContractEvalAt", "last_contract_eval_at"]) ??
      current.lastContractEvalAt,
    lastContractEvalResult:
      pickString(patch, [
        "lastContractEvalResult",
        "last_contract_eval_result",
      ]) ?? current.lastContractEvalResult,
    rollbackTargetStage:
      pickString(patch, ["rollbackTargetStage", "rollback_target_stage"]) ??
      current.rollbackTargetStage,
    resumeCursor:
      pickString(patch, ["resumeCursor", "resume_cursor"]) ?? current.resumeCursor,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };
  manifest.orchestration_state = serializeOrchestrationState(next);
  await saveManifest(params.projectRoot, manifest);
  return {
    state: next,
    validationErrors: getOrchestrationStateValidationErrors(
      next,
      normalizeStage(manifest.current_stage)
    ),
  };
}

export async function setWritePackageState(params: {
  projectRoot: string;
  writePackage: Record<string, unknown>;
}): Promise<{
  state: WritePackageState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritePackageState(manifest.write_package);
  const patch = asRecord(params.writePackage) ?? {};
  const next: WritePackageState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    assemblyStatus:
      normalizeStage(patch.assemblyStatus ?? patch.assembly_status) ??
      current.assemblyStatus,
    assemblyMode:
      pickString(patch, ["assemblyMode", "assembly_mode"]) ??
      current.assemblyMode,
    winningTrackIds:
      patch.winningTrackIds || patch.winning_track_ids
        ? asStringArray(patch.winningTrackIds ?? patch.winning_track_ids)
        : current.winningTrackIds,
    claimEvidenceMatrixPath:
      pickString(patch, [
        "claimEvidenceMatrixPath",
        "claim_evidence_matrix_path",
      ]) ?? current.claimEvidenceMatrixPath,
    narrativeReportPath:
      pickString(patch, ["narrativeReportPath", "narrative_report_path"]) ??
      current.narrativeReportPath,
    trackVerdictsPath:
      pickString(patch, ["trackVerdictsPath", "track_verdicts_path"]) ??
      current.trackVerdictsPath,
    unsupportedClaimsPath:
      pickString(patch, ["unsupportedClaimsPath", "unsupported_claims_path"]) ??
      current.unsupportedClaimsPath,
    baselineSummaryPath:
      pickString(patch, ["baselineSummaryPath", "baseline_summary_path"]) ??
      current.baselineSummaryPath,
    researchSummaryPath:
      pickString(patch, ["researchSummaryPath", "research_summary_path"]) ??
      current.researchSummaryPath,
    ablationSummaryPath:
      pickString(patch, ["ablationSummaryPath", "ablation_summary_path"]) ??
      current.ablationSummaryPath,
    evaluationSummaryPath:
      pickString(patch, ["evaluationSummaryPath", "evaluation_summary_path"]) ??
      current.evaluationSummaryPath,
    figurePackPath:
      pickString(patch, ["figurePackPath", "figure_pack_path"]) ??
      current.figurePackPath,
    tablePackPath:
      pickString(patch, ["tablePackPath", "table_pack_path"]) ??
      current.tablePackPath,
    proofPacketDir:
      pickString(patch, ["proofPacketDir", "proof_packet_dir"]) ??
      current.proofPacketDir,
    citationCandidatesPath:
      pickString(patch, [
        "citationCandidatesPath",
        "citation_candidates_path",
      ]) ?? current.citationCandidatesPath,
    packageManifestPath:
      pickString(patch, ["packageManifestPath", "package_manifest_path"]) ??
      current.packageManifestPath,
    assemblyReportPath:
      pickString(patch, ["assemblyReportPath", "assembly_report_path"]) ??
      current.assemblyReportPath,
    sectionAssemblyQueuePath:
      pickString(patch, [
        "sectionAssemblyQueuePath",
        "section_assembly_queue_path",
      ]) ?? current.sectionAssemblyQueuePath,
    sourceArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["sourceArtifactCount", "source_artifact_count"]) ??
          current.sourceArtifactCount
      )
    ),
    derivedArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["derivedArtifactCount", "derived_artifact_count"]) ??
          current.derivedArtifactCount
      )
    ),
    assembledAt:
      pickString(patch, ["assembledAt", "assembled_at"]) ?? current.assembledAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };
  manifest.write_package = serializeWritePackageState(next);
  await saveManifest(params.projectRoot, manifest);
  return {
    state: next,
    validationErrors: getWritePackageValidationErrors(next),
  };
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
  const manifest = await readManifestEnsured(params.projectRoot);
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
    return current.trackId ? trackId === current.trackId : status === "active";
  });
  const inferredContractDefaults = await inferExperimentSearchContractDefaults({
    projectRoot: params.projectRoot,
    manifest,
    trackRecords: activeTrackRecords,
    trackId:
      pickString(patch, ["trackId", "track_id"]) ??
      current.trackId ??
      null,
    experimentId:
      pickString(patch, [
        "lastCandidateExperimentId",
        "last_candidate_experiment_id",
        "incumbentExperimentId",
        "incumbent_experiment_id",
      ]) ??
      current.lastCandidateExperimentId ??
      current.incumbentExperimentId ??
      null,
  });
  const defaultOneChangeSignature = inferredContractDefaults.oneChangeSignature;
  const baselineDatasetEnvelope = inferredContractDefaults.baselineDatasetEnvelope;
  const innovationAnchorPoints = inferredContractDefaults.innovationAnchorPoints;
  const next: ExperimentSearchState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
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
    bestNodeId:
      pickString(patch, ["bestNodeId", "best_node_id"]) ?? current.bestNodeId,
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
    multiSeedStatus:
      normalizeStage(patch.multiSeedStatus ?? patch.multi_seed_status) ??
      current.multiSeedStatus,
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
    evaluationSummaryPath:
      pickString(patch, [
        "evaluationSummaryPath",
        "evaluation_summary_path",
      ]) ?? current.evaluationSummaryPath,
    plotPackStatus:
      normalizeStage(patch.plotPackStatus ?? patch.plot_pack_status) ??
      current.plotPackStatus,
    plotPackPath:
      pickString(patch, ["plotPackPath", "plot_pack_path"]) ??
      current.plotPackPath,
    stageProgressPath:
      pickString(patch, ["stageProgressPath", "stage_progress_path"]) ??
      current.stageProgressPath,
    checkpointPath:
      pickString(patch, ["checkpointPath", "checkpoint_path"]) ??
      current.checkpointPath,
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
    if (!next.oneChangeSignature && defaultOneChangeSignature) {
      next.oneChangeSignature = defaultOneChangeSignature;
    }
    if (
      next.oneChangeSignature &&
      (!next.oneChangeValidationStatus ||
        next.oneChangeValidationStatus === "unknown" ||
        next.oneChangeValidationStatus === "missing")
    ) {
      next.oneChangeValidationStatus = "ready";
    }
    if (
      !next.comparableTrialBudgetStatus ||
      next.comparableTrialBudgetStatus === "unknown"
    ) {
      next.comparableTrialBudgetStatus = "within_budget";
    }
    if (
      next.validatedDatasetEnvelope.length === 0 &&
      inferredContractDefaults.bundleDatasetEnvelope.length > 0
    ) {
      next.validatedDatasetEnvelope = inferredContractDefaults.bundleDatasetEnvelope;
    }
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
  await saveManifest(params.projectRoot, manifest);

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

export async function setExperimentReviewState(params: {
  projectRoot: string;
  experimentReview: Record<string, unknown>;
}): Promise<{
  state: ExperimentReviewState;
  stateFilePath: string;
  stateFileExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = await loadExperimentReviewState({
    projectRoot: params.projectRoot,
    manifest,
  });
  const patch = asRecord(params.experimentReview) ?? {};
  const explicitLaunchApproved =
    pickBoolean(patch, ["launchApproved", "launch_approved"]) ?? current.launchApproved;
  const analyzerVerdict =
    normalizeExperimentReviewVerdict(
      pickString(patch, ["analyzerVerdict", "analyzer_verdict"]) ??
        patch.analyzerStatus ??
        patch.analyzer_status
    ) ?? current.analyzerVerdict;
  const crossReviewerVerdict =
    normalizeExperimentReviewVerdict(
      pickString(patch, ["crossReviewerVerdict", "cross_reviewer_verdict"]) ??
        patch.crossReviewerStatus ??
        patch.cross_reviewer_status
    ) ?? current.crossReviewerVerdict;
  const next: ExperimentReviewState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    launchMode:
      pickString(patch, ["launchMode", "launch_mode"]) === "reviewed_auto"
        ? "reviewed_auto"
        : pickString(patch, ["launchMode", "launch_mode"]) === "manual"
          ? "manual"
          : current.launchMode,
    microStage:
      normalizeStage(patch.microStage ?? patch.micro_stage) ?? current.microStage,
    reviewRound: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["reviewRound", "review_round"]) ?? current.reviewRound
      )
    ),
    stateFilePath:
      pickString(patch, ["stateFilePath", "state_file_path"]) ??
      current.stateFilePath,
    packetPath: pickString(patch, ["packetPath", "packet_path"]) ?? current.packetPath,
    plannerPlanPath:
      pickString(patch, ["plannerPlanPath", "planner_plan_path"]) ??
      current.plannerPlanPath,
    analyzerReportPath:
      pickString(patch, ["analyzerReportPath", "analyzer_report_path"]) ??
      current.analyzerReportPath,
    crossReviewerReportPath:
      pickString(patch, ["crossReviewerReportPath", "cross_reviewer_report_path"]) ??
      current.crossReviewerReportPath,
    launchDecisionPath:
      pickString(patch, ["launchDecisionPath", "launch_decision_path"]) ??
      current.launchDecisionPath,
    packetFingerprint:
      pickString(patch, ["packetFingerprint", "packet_fingerprint"]) ??
      current.packetFingerprint,
    targetTrackIds:
      patch.targetTrackIds || patch.target_track_ids
        ? asStringArray(patch.targetTrackIds ?? patch.target_track_ids)
        : current.targetTrackIds,
    claimIds:
      patch.claimIds || patch.claim_ids
        ? asStringArray(patch.claimIds ?? patch.claim_ids)
        : current.claimIds,
    graphPacketPaths:
      patch.graphPacketPaths || patch.graph_packet_paths
        ? asStringArray(patch.graphPacketPaths ?? patch.graph_packet_paths)
        : current.graphPacketPaths,
    plannerStatus:
      normalizeStage(patch.plannerStatus ?? patch.planner_status) ??
      current.plannerStatus,
    analyzerStatus: coerceCompletedReviewStatus(
      patch.analyzerStatus ?? patch.analyzer_status,
      analyzerVerdict,
      current.analyzerStatus
    ),
    crossReviewerStatus: coerceCompletedReviewStatus(
      patch.crossReviewerStatus ?? patch.cross_reviewer_status,
      crossReviewerVerdict,
      current.crossReviewerStatus
    ),
    synthesisStatus:
      normalizeStage(patch.synthesisStatus ?? patch.synthesis_status) ??
      current.synthesisStatus,
    analyzerVerdict,
    crossReviewerVerdict,
    launchApproved: explicitLaunchApproved,
    blockerCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["blockerCount", "blocker_count"]) ??
          current.blockerCount
      )
    ),
    blockers:
      patch.blockers ? asStringArray(patch.blockers) : current.blockers,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastLaunchApprovedAt:
      pickString(patch, ["lastLaunchApprovedAt", "last_launch_approved_at"]) ??
      (explicitLaunchApproved && !current.lastLaunchApprovedAt
        ? new Date().toISOString()
        : current.lastLaunchApprovedAt),
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.experiment_review_state = serializeExperimentReviewState(next);
  await saveExperimentReviewStateFile({
    projectRoot: params.projectRoot,
    state: next,
  });
  await saveManifest(params.projectRoot, manifest);

  const stateFilePath = getExperimentReviewStatePath(params.projectRoot);
  return {
    state: next,
    stateFilePath,
    stateFileExists: await pathExists(stateFilePath),
  };
}
