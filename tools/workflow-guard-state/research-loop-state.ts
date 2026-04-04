import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

const DEFAULT_BRAINSTORM_CYCLE_DIR = "researcher/brainstorm-cycle";
const DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/TOPIC_SUMMARY.json`;
const DEFAULT_BRAINSTORM_RESEARCH_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/RESEARCH_BRIEF.json`;
const DEFAULT_BRAINSTORM_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/BRAINSTORM_BRIEF.json`;
const DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/LOGIC_CHAIN.md`;
const DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/EVIDENCE_CHAIN.md`;
const DEFAULT_BRAINSTORM_REASONING_TRACE_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REASONING_TRACE.jsonl`;
const DEFAULT_BRAINSTORM_QUESTION_PACKET_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/QUESTION_PACKET.md`;
const DEFAULT_BRAINSTORM_WORKING_MEMORY_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/WORKING_MEMORY.json`;
const DEFAULT_BRAINSTORM_SYNTHESIS_PACKET_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/SYNTHESIS_PACKET.md`;
const DEFAULT_BRAINSTORM_REFLECTION_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REFLECTION_CHAIN.json`;
const DEFAULT_BRAINSTORM_THEORY_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/THEORY_BRIEF.json`;
const DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/STORYLINE_BRIEF.json`;

type IdleResearchStateLike = {
  enabled: boolean;
  topic: string | null;
  objective: string | null;
  querySeeds: string[];
  preferredVenues: string[];
  maxPapersPerCycle: number;
  cooldownMinutes: number;
  lastRunAt: string | null;
  lastDigestPath: string | null;
  lastSourceUpdateAt: string | null;
  status: string;
  pendingReason: string | null;
  nextQueryHint: string | null;
  refreshGraphOnNewCorePapers: boolean;
  lastRoundNewCanonicalPapers: number;
  lastRoundNewCorePapers: number;
};

type IdeationTop3SnapshotLike = {
  refreshedAt: string | null;
  selectedDirectionId: string | null;
  selectedTrackId: string | null;
  topDirectionTitles: string[];
  top3SummaryPath: string | null;
  rankingHistoryPath: string | null;
  researchProposalPath: string | null;
};

type InnovationReflectionStateLike = {
  requiredAfterExperiments: boolean;
  status: string;
  lastReflectionAt: string | null;
  lastReflectionPath: string | null;
  reflectedThroughExperimentUpdateAt: string | null;
  reflectedExperimentIds: string[];
  pendingReason: string | null;
  latestIdeationTop3: IdeationTop3SnapshotLike | null;
};

type BrainstormCycleOptionStateLike = {
  optionId: string;
  title: string | null;
  summary: string | null;
  score: number | null;
  status: string | null;
  verdict: string | null;
};

type BrainstormCycleRoundStateLike = {
  roundId: string;
  label: string | null;
  status: string | null;
  focus: string | null;
  options: BrainstormCycleOptionStateLike[];
};

type BrainstormCycleStateLike = {
  status: string;
  mode: string | null;
  topic: string | null;
  basisStage: string | null;
  trackId: string | null;
  provider: string | null;
  providerMode: string | null;
  providerStatus: string | null;
  providerLastRunAt: string | null;
  providerLastError: string | null;
  contractVersion: number | null;
  rounds: BrainstormCycleRoundStateLike[];
  selectedRoundId: string | null;
  selectedOptionId: string | null;
  selectedOptionTitle: string | null;
  selectedOptionScore: number | null;
  selectionMode: string | null;
  topicSummaryPath: string | null;
  researchBriefPath: string | null;
  brainstormBriefPath: string | null;
  logicChainPath: string | null;
  evidenceChainPath: string | null;
  reasoningTracePath: string | null;
  questionPacketPath: string | null;
  workingMemoryPath: string | null;
  synthesisPacketPath: string | null;
  reflectionChainPath: string | null;
  theoryBriefPath: string | null;
  storylineBriefPath: string | null;
  graphVersionSeen: string | null;
  importTaskIdsSeen: string[];
  latestRunAt: string | null;
  pendingReason: string | null;
};

export function normalizeIdleResearchState(
  value: unknown
): IdleResearchStateLike {
  const record = asRecord(value) ?? {};
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? false,
    topic: pickString(record, ["topic"]),
    objective: pickString(record, ["objective"]),
    querySeeds: asStringArray(record.querySeeds ?? record.query_seeds),
    preferredVenues: asStringArray(
      record.preferredVenues ?? record.preferred_venues
    ),
    maxPapersPerCycle: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["maxPapersPerCycle", "max_papers_per_cycle"]) ?? 5
      )
    ),
    cooldownMinutes: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["cooldownMinutes", "cooldown_minutes"]) ?? 30
      )
    ),
    lastRunAt: pickString(record, ["lastRunAt", "last_run_at"]),
    lastDigestPath: pickString(record, ["lastDigestPath", "last_digest_path"]),
    lastSourceUpdateAt: pickString(record, [
      "lastSourceUpdateAt",
      "last_source_update_at",
    ]),
    status: normalizeStage(record.status) ?? "disabled",
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    nextQueryHint: pickString(record, ["nextQueryHint", "next_query_hint"]),
    refreshGraphOnNewCorePapers:
      pickBoolean(record, [
        "refreshGraphOnNewCorePapers",
        "refresh_graph_on_new_core_papers",
      ]) ?? true,
    lastRoundNewCanonicalPapers: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "lastRoundNewCanonicalPapers",
          "last_round_new_canonical_papers",
        ]) ?? 0
      )
    ),
    lastRoundNewCorePapers: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "lastRoundNewCorePapers",
          "last_round_new_core_papers",
        ]) ?? 0
      )
    ),
  };
}

export function computeIdleResearchNextDueAt(
  state: IdleResearchStateLike
): string | null {
  if (state.cooldownMinutes <= 0 || !state.lastRunAt) {
    return state.lastRunAt;
  }
  const lastRunMs = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    return null;
  }
  return new Date(lastRunMs + state.cooldownMinutes * 60 * 1000).toISOString();
}

export function isIdleResearchDue(state: IdleResearchStateLike): boolean {
  if (!state.enabled || !state.topic) {
    return false;
  }
  if (state.status === "running") {
    return false;
  }
  if (!state.lastRunAt || state.cooldownMinutes <= 0) {
    return true;
  }
  const nextDueAt = computeIdleResearchNextDueAt(state);
  if (!nextDueAt) {
    return true;
  }
  return Date.now() >= Date.parse(nextDueAt);
}

export function serializeIdleResearchState(
  state: IdleResearchStateLike
): Record<string, unknown> {
  return {
    enabled: state.enabled,
    topic: state.topic,
    objective: state.objective,
    query_seeds: state.querySeeds,
    preferred_venues: state.preferredVenues,
    max_papers_per_cycle: state.maxPapersPerCycle,
    cooldown_minutes: state.cooldownMinutes,
    last_run_at: state.lastRunAt,
    last_digest_path: state.lastDigestPath,
    last_source_update_at: state.lastSourceUpdateAt,
    status: state.status,
    pending_reason: state.pendingReason,
    next_query_hint: state.nextQueryHint,
    refresh_graph_on_new_core_papers: state.refreshGraphOnNewCorePapers,
    last_round_new_canonical_papers: state.lastRoundNewCanonicalPapers,
    last_round_new_core_papers: state.lastRoundNewCorePapers,
  };
}

export function normalizeIdeationTop3Snapshot(
  value: unknown
): IdeationTop3SnapshotLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    refreshedAt: pickString(record, ["refreshedAt", "refreshed_at"]),
    selectedDirectionId: pickString(record, [
      "selectedDirectionId",
      "selected_direction_id",
    ]),
    selectedTrackId: pickString(record, ["selectedTrackId", "selected_track_id"]),
    topDirectionTitles: asStringArray(
      record.topDirectionTitles ?? record.top_direction_titles
    ),
    top3SummaryPath: pickString(record, ["top3SummaryPath", "top3_summary_path"]),
    rankingHistoryPath: pickString(record, [
      "rankingHistoryPath",
      "ranking_history_path",
    ]),
    researchProposalPath: pickString(record, [
      "researchProposalPath",
      "research_proposal_path",
    ]),
  };
}

export function serializeIdeationTop3Snapshot(
  state: IdeationTop3SnapshotLike | null
): Record<string, unknown> | null {
  if (!state) {
    return null;
  }
  return {
    refreshed_at: state.refreshedAt,
    selected_direction_id: state.selectedDirectionId,
    selected_track_id: state.selectedTrackId,
    top_direction_titles: state.topDirectionTitles,
    top3_summary_path: state.top3SummaryPath,
    ranking_history_path: state.rankingHistoryPath,
    research_proposal_path: state.researchProposalPath,
  };
}

export function normalizeInnovationReflectionState(
  value: unknown
): InnovationReflectionStateLike {
  const record = asRecord(value) ?? {};
  return {
    requiredAfterExperiments:
      pickBoolean(record, [
        "requiredAfterExperiments",
        "required_after_experiments",
      ]) ?? true,
    status: normalizeStage(record.status) ?? "missing",
    lastReflectionAt: pickString(record, [
      "lastReflectionAt",
      "last_reflection_at",
    ]),
    lastReflectionPath: pickString(record, [
      "lastReflectionPath",
      "last_reflection_path",
    ]),
    reflectedThroughExperimentUpdateAt: pickString(record, [
      "reflectedThroughExperimentUpdateAt",
      "reflected_through_experiment_update_at",
    ]),
    reflectedExperimentIds: asStringArray(
      record.reflectedExperimentIds ?? record.reflected_experiment_ids
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    latestIdeationTop3: normalizeIdeationTop3Snapshot(
      record.latestIdeationTop3 ?? record.latest_ideation_top3
    ),
  };
}

export function serializeInnovationReflectionState(
  state: InnovationReflectionStateLike
): Record<string, unknown> {
  return {
    required_after_experiments: state.requiredAfterExperiments,
    status: state.status,
    last_reflection_at: state.lastReflectionAt,
    last_reflection_path: state.lastReflectionPath,
    reflected_through_experiment_update_at:
      state.reflectedThroughExperimentUpdateAt,
    reflected_experiment_ids: state.reflectedExperimentIds,
    pending_reason: state.pendingReason,
    latest_ideation_top3: serializeIdeationTop3Snapshot(state.latestIdeationTop3),
  };
}

export function normalizeBrainstormCycleOptionState(
  value: unknown
): BrainstormCycleOptionStateLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const optionId =
    pickString(record, ["optionId", "option_id"]) ??
    pickString(record, ["id"]);
  if (!optionId) {
    return null;
  }
  return {
    optionId,
    title: pickString(record, ["title", "name"]),
    summary: pickString(record, ["summary", "description"]),
    score: pickNumber(record, ["score", "ranking_score", "rank_score"]),
    status: normalizeStage(record.status),
    verdict: pickString(record, ["verdict", "decision"]),
  };
}

export function serializeBrainstormCycleOptionState(
  state: BrainstormCycleOptionStateLike
): Record<string, unknown> {
  return {
    option_id: state.optionId,
    title: state.title,
    summary: state.summary,
    score: state.score,
    status: state.status,
    verdict: state.verdict,
  };
}

export function normalizeBrainstormCycleRoundState(
  value: unknown
): BrainstormCycleRoundStateLike | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const roundId =
    pickString(record, ["roundId", "round_id"]) ??
    pickString(record, ["id"]);
  if (!roundId) {
    return null;
  }
  const rawOptions = Array.isArray(record.options) ? record.options : [];
  return {
    roundId,
    label: pickString(record, ["label", "name"]),
    status: normalizeStage(record.status),
    focus: pickString(record, ["focus"]),
    options: rawOptions
      .map((option) => normalizeBrainstormCycleOptionState(option))
      .filter(
        (option): option is BrainstormCycleOptionStateLike => Boolean(option)
      ),
  };
}

export function serializeBrainstormCycleRoundState(
  state: BrainstormCycleRoundStateLike
): Record<string, unknown> {
  return {
    round_id: state.roundId,
    label: state.label,
    status: state.status,
    focus: state.focus,
    options: state.options.map((option) =>
      serializeBrainstormCycleOptionState(option)
    ),
  };
}

export function normalizeBrainstormCycleState(
  value: unknown
): BrainstormCycleStateLike {
  const record = asRecord(value) ?? {};
  const rounds = Array.isArray(record.rounds)
    ? record.rounds
        .map((round) => normalizeBrainstormCycleRoundState(round))
        .filter((round): round is BrainstormCycleRoundStateLike => Boolean(round))
    : [];
  const normalizedStatus = normalizeStage(record.status) ?? "missing";
  const normalizedLatestRunAt = pickString(record, [
    "latestRunAt",
    "latest_run_at",
  ]);
  return {
    status: normalizedStatus,
    mode: pickString(record, ["mode"]),
    topic: pickString(record, ["topic"]),
    basisStage: normalizeStage(record.basisStage ?? record.basis_stage),
    trackId: pickString(record, ["trackId", "track_id"]),
    provider: pickString(record, ["provider"]) ?? "workflow_core_brainstorm",
    providerMode:
      pickString(record, ["providerMode", "provider_mode"]) ?? "core",
    providerStatus:
      normalizeStage(record.providerStatus ?? record.provider_status) ??
      (["ready", "reconciled"].includes(normalizedStatus) ? "ready" : "pending"),
    providerLastRunAt:
      pickString(record, ["providerLastRunAt", "provider_last_run_at"]) ??
      normalizedLatestRunAt,
    providerLastError: pickString(record, [
      "providerLastError",
      "provider_last_error",
    ]),
    contractVersion:
      pickNumber(record, ["contractVersion", "contract_version"]) ?? 1,
    rounds,
    selectedRoundId: pickString(record, ["selectedRoundId", "selected_round_id"]),
    selectedOptionId: pickString(record, [
      "selectedOptionId",
      "selected_option_id",
    ]),
    selectedOptionTitle: pickString(record, [
      "selectedOptionTitle",
      "selected_option_title",
    ]),
    selectedOptionScore: pickNumber(record, [
      "selectedOptionScore",
      "selected_option_score",
    ]),
    selectionMode: pickString(record, ["selectionMode", "selection_mode"]),
    topicSummaryPath:
      pickString(record, ["topicSummaryPath", "topic_summary_path"]) ??
      DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH,
    researchBriefPath:
      pickString(record, ["researchBriefPath", "research_brief_path"]) ??
      DEFAULT_BRAINSTORM_RESEARCH_BRIEF_PATH,
    brainstormBriefPath:
      pickString(record, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
      DEFAULT_BRAINSTORM_BRIEF_PATH,
    logicChainPath:
      pickString(record, ["logicChainPath", "logic_chain_path"]) ??
      DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH,
    evidenceChainPath:
      pickString(record, ["evidenceChainPath", "evidence_chain_path"]) ??
      DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH,
    reasoningTracePath:
      pickString(record, ["reasoningTracePath", "reasoning_trace_path"]) ??
      DEFAULT_BRAINSTORM_REASONING_TRACE_PATH,
    questionPacketPath:
      pickString(record, ["questionPacketPath", "question_packet_path"]) ??
      DEFAULT_BRAINSTORM_QUESTION_PACKET_PATH,
    workingMemoryPath:
      pickString(record, ["workingMemoryPath", "working_memory_path"]) ??
      DEFAULT_BRAINSTORM_WORKING_MEMORY_PATH,
    synthesisPacketPath:
      pickString(record, ["synthesisPacketPath", "synthesis_packet_path"]) ??
      DEFAULT_BRAINSTORM_SYNTHESIS_PACKET_PATH,
    reflectionChainPath:
      pickString(record, ["reflectionChainPath", "reflection_chain_path"]) ??
      DEFAULT_BRAINSTORM_REFLECTION_CHAIN_PATH,
    theoryBriefPath:
      pickString(record, ["theoryBriefPath", "theory_brief_path"]) ??
      DEFAULT_BRAINSTORM_THEORY_BRIEF_PATH,
    storylineBriefPath:
      pickString(record, ["storylineBriefPath", "storyline_brief_path"]) ??
      DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH,
    graphVersionSeen: pickString(record, ["graphVersionSeen", "graph_version_seen"]),
    importTaskIdsSeen: asStringArray(
      record.importTaskIdsSeen ?? record.import_task_ids_seen
    ),
    latestRunAt: normalizedLatestRunAt,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeBrainstormCycleState(
  state: BrainstormCycleStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    mode: state.mode,
    topic: state.topic,
    basis_stage: state.basisStage,
    track_id: state.trackId,
    provider: state.provider,
    provider_mode: state.providerMode,
    provider_status: state.providerStatus,
    provider_last_run_at: state.providerLastRunAt,
    provider_last_error: state.providerLastError,
    contract_version: state.contractVersion,
    rounds: state.rounds.map((round) => serializeBrainstormCycleRoundState(round)),
    selected_round_id: state.selectedRoundId,
    selected_option_id: state.selectedOptionId,
    selected_option_title: state.selectedOptionTitle,
    selected_option_score: state.selectedOptionScore,
    selection_mode: state.selectionMode,
    topic_summary_path: state.topicSummaryPath,
    research_brief_path: state.researchBriefPath,
    brainstorm_brief_path: state.brainstormBriefPath,
    logic_chain_path: state.logicChainPath,
    evidence_chain_path: state.evidenceChainPath,
    reasoning_trace_path: state.reasoningTracePath,
    question_packet_path: state.questionPacketPath,
    working_memory_path: state.workingMemoryPath,
    synthesis_packet_path: state.synthesisPacketPath,
    reflection_chain_path: state.reflectionChainPath,
    theory_brief_path: state.theoryBriefPath,
    storyline_brief_path: state.storylineBriefPath,
    graph_version_seen: state.graphVersionSeen,
    import_task_ids_seen: state.importTaskIdsSeen,
    latest_run_at: state.latestRunAt,
    pending_reason: state.pendingReason,
  };
}
