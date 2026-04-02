import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import type {
  IdeationContractState,
  IdeationGraphBasisPaths,
  IdeationGraphIndicesState,
} from "../workflow-guard.js";

const DEFAULT_BRAINSTORM_CYCLE_DIR = "researcher/brainstorm-cycle";
const DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/TOPIC_SUMMARY.json`;
const DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/LOGIC_CHAIN.md`;
const DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/EVIDENCE_CHAIN.md`;
const DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/STORYLINE_BRIEF.json`;
const DEFAULT_IDEATION_DIR = "researcher/ideation";
const DEFAULT_IDEATION_PACKET_PATH =
  `${DEFAULT_IDEATION_DIR}/GRAPH_IDEATION_PACKET.json`;
const DEFAULT_IDEATION_IDEA_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/IDEA_TREE.md`;
const DEFAULT_IDEATION_NOVELTY_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/NOVELTY_TREE.md`;
const DEFAULT_IDEATION_CHALLENGE_INSIGHT_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/CHALLENGE_INSIGHT_TREE.md`;
const DEFAULT_IDEATION_SOLUTION_CHECK_PATH =
  `${DEFAULT_IDEATION_DIR}/WELL_ESTABLISHED_SOLUTION_CHECK.md`;
const DEFAULT_IDEATION_CROSS_DOMAIN_TRANSFER_PATH =
  `${DEFAULT_IDEATION_DIR}/CROSS_DOMAIN_TRANSFER.md`;
const DEFAULT_IDEATION_PROBLEM_DECOMPOSITION_PATH =
  `${DEFAULT_IDEATION_DIR}/PROBLEM_DECOMPOSITION.md`;
const DEFAULT_IDEATION_CANDIDATE_POOL_PATH =
  `${DEFAULT_IDEATION_DIR}/CANDIDATE_POOL.json`;
const DEFAULT_IDEATION_RANKING_HISTORY_PATH =
  `${DEFAULT_IDEATION_DIR}/RANKING_HISTORY.json`;
const DEFAULT_IDEATION_TOURNAMENT_SCOREBOARD_PATH =
  `${DEFAULT_IDEATION_DIR}/TOURNAMENT_SCOREBOARD.json`;
const DEFAULT_IDEATION_TOP3_SUMMARY_PATH =
  `${DEFAULT_IDEATION_DIR}/TOP3_DIRECTION_SUMMARY.md`;
const DEFAULT_IDEATION_RESEARCH_PROPOSAL_PATH =
  `${DEFAULT_IDEATION_DIR}/RESEARCH_PROPOSAL.md`;

export function normalizeIdeationGraphBasisPaths(
  value: unknown
): IdeationGraphBasisPaths {
  const record = asRecord(value) ?? {};
  return {
    papernexusStatusPath:
      pickString(record, ["papernexusStatusPath", "papernexus_status_path"]) ??
      "graph/PAPERNEXUS_STATUS.json",
    frontierReportPath:
      pickString(record, ["frontierReportPath", "frontier_report"]) ??
      "researcher/FRONTIER_REPORT.md",
    anchorIndexPath:
      pickString(record, ["anchorIndexPath", "anchor_index_path"]) ??
      "graph/ANCHOR_INDEX.md",
    limitationFrontierPath:
      pickString(record, ["limitationFrontierPath", "limitation_frontier_path"]) ??
      "graph/LIMITATION_FRONTIER.md",
    contradictionFrontierPath:
      pickString(
        record,
        ["contradictionFrontierPath", "contradiction_frontier_path"]
      ) ?? "graph/CONTRADICTION_FRONTIER.md",
    transferFrontierPath:
      pickString(record, ["transferFrontierPath", "transfer_frontier_path"]) ??
      "graph/TRANSFER_FRONTIER.md",
    compositionFrontierPath:
      pickString(record, ["compositionFrontierPath", "composition_frontier_path"]) ??
      "graph/COMPOSITION_FRONTIER.md",
    topicSummaryPath:
      pickString(record, ["topicSummaryPath", "topic_summary_path"]) ??
      DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH,
    logicChainPath:
      pickString(record, ["logicChainPath", "logic_chain_path"]) ??
      DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH,
    evidenceChainPath:
      pickString(record, ["evidenceChainPath", "evidence_chain_path"]) ??
      DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH,
    storylineBriefPath:
      pickString(record, ["storylineBriefPath", "storyline_brief_path"]) ??
      DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH,
  };
}

export function serializeIdeationGraphBasisPaths(
  value: IdeationGraphBasisPaths
): Record<string, unknown> {
  return {
    papernexus_status_path: value.papernexusStatusPath,
    frontier_report: value.frontierReportPath,
    anchor_index_path: value.anchorIndexPath,
    limitation_frontier_path: value.limitationFrontierPath,
    contradiction_frontier_path: value.contradictionFrontierPath,
    transfer_frontier_path: value.transferFrontierPath,
    composition_frontier_path: value.compositionFrontierPath,
    topic_summary_path: value.topicSummaryPath,
    logic_chain_path: value.logicChainPath,
    evidence_chain_path: value.evidenceChainPath,
    storyline_brief_path: value.storylineBriefPath,
  };
}

export function normalizeIdeationGraphIndicesState(
  value: unknown
): IdeationGraphIndicesState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    noveltyCandidateClusters: asStringArray(
      record.noveltyCandidateClusters ?? record.novelty_candidate_clusters
    ),
    challengeClusters: asStringArray(
      record.challengeClusters ?? record.challenge_clusters
    ),
    insightClusters: asStringArray(
      record.insightClusters ?? record.insight_clusters
    ),
    occupiedSolutionZones: asStringArray(
      record.occupiedSolutionZones ?? record.occupied_solution_zones
    ),
    transferBridges: asStringArray(
      record.transferBridges ?? record.transfer_bridges
    ),
    lastRefreshAt: pickString(record, ["lastRefreshAt", "last_refresh_at"]),
  };
}

export function serializeIdeationGraphIndicesState(
  value: IdeationGraphIndicesState
): Record<string, unknown> {
  return {
    status: value.status,
    novelty_candidate_clusters: value.noveltyCandidateClusters,
    challenge_clusters: value.challengeClusters,
    insight_clusters: value.insightClusters,
    occupied_solution_zones: value.occupiedSolutionZones,
    transfer_bridges: value.transferBridges,
    last_refresh_at: value.lastRefreshAt,
  };
}

export function normalizeIdeationContractState(value: unknown): IdeationContractState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    contractVersion:
      Math.max(
        1,
        Math.floor(
          pickNumber(record, ["contractVersion", "contract_version"]) ?? 1
        )
      ),
    longTermGoal: pickString(record, ["longTermGoal", "long_term_goal"]),
    problemScope: pickString(record, ["problemScope", "problem_scope"]),
    basisStage: normalizeStage(record.basisStage ?? record.basis_stage),
    graphBasisPaths: normalizeIdeationGraphBasisPaths(
      record.graphBasisPaths ?? record.graph_basis_paths
    ),
    graphIdeationIndices: normalizeIdeationGraphIndicesState(
      record.graphIdeationIndices ?? record.graph_ideation_indices
    ),
    ideaTreePath:
      pickString(record, ["ideaTreePath", "idea_tree_path"]) ??
      DEFAULT_IDEATION_IDEA_TREE_PATH,
    noveltyTreePath:
      pickString(record, ["noveltyTreePath", "novelty_tree_path"]) ??
      DEFAULT_IDEATION_NOVELTY_TREE_PATH,
    challengeInsightTreePath:
      pickString(record, [
        "challengeInsightTreePath",
        "challenge_insight_tree_path",
      ]) ?? DEFAULT_IDEATION_CHALLENGE_INSIGHT_TREE_PATH,
    solutionCheckPath:
      pickString(record, ["solutionCheckPath", "solution_check_path"]) ??
      DEFAULT_IDEATION_SOLUTION_CHECK_PATH,
    crossDomainTransferPath:
      pickString(record, [
        "crossDomainTransferPath",
        "cross_domain_transfer_path",
      ]) ?? DEFAULT_IDEATION_CROSS_DOMAIN_TRANSFER_PATH,
    problemDecompositionPath:
      pickString(record, [
        "problemDecompositionPath",
        "problem_decomposition_path",
      ]) ?? DEFAULT_IDEATION_PROBLEM_DECOMPOSITION_PATH,
    candidatePoolPath:
      pickString(record, ["candidatePoolPath", "candidate_pool_path"]) ??
      DEFAULT_IDEATION_CANDIDATE_POOL_PATH,
    rankingHistoryPath:
      pickString(record, ["rankingHistoryPath", "ranking_history_path"]) ??
      DEFAULT_IDEATION_RANKING_HISTORY_PATH,
    tournamentScoreboardPath:
      pickString(record, [
        "tournamentScoreboardPath",
        "tournament_scoreboard_path",
      ]) ?? DEFAULT_IDEATION_TOURNAMENT_SCOREBOARD_PATH,
    top3SummaryPath:
      pickString(record, ["top3SummaryPath", "top3_summary_path"]) ??
      DEFAULT_IDEATION_TOP3_SUMMARY_PATH,
    researchProposalPath:
      pickString(record, ["researchProposalPath", "research_proposal_path"]) ??
      DEFAULT_IDEATION_RESEARCH_PROPOSAL_PATH,
    graphIdeationPacketPath:
      pickString(record, [
        "graphIdeationPacketPath",
        "graph_ideation_packet_path",
      ]) ?? DEFAULT_IDEATION_PACKET_PATH,
    selectedDirectionId:
      pickString(record, ["selectedDirectionId", "selected_direction_id"]),
    selectedTrackId:
      pickString(record, ["selectedTrackId", "selected_track_id"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeIdeationContractState(
  value: IdeationContractState
): Record<string, unknown> {
  return {
    status: value.status,
    contract_version: value.contractVersion,
    long_term_goal: value.longTermGoal,
    problem_scope: value.problemScope,
    basis_stage: value.basisStage,
    graph_basis_paths: serializeIdeationGraphBasisPaths(value.graphBasisPaths),
    graph_ideation_indices: serializeIdeationGraphIndicesState(
      value.graphIdeationIndices
    ),
    idea_tree_path: value.ideaTreePath,
    novelty_tree_path: value.noveltyTreePath,
    challenge_insight_tree_path: value.challengeInsightTreePath,
    solution_check_path: value.solutionCheckPath,
    cross_domain_transfer_path: value.crossDomainTransferPath,
    problem_decomposition_path: value.problemDecompositionPath,
    candidate_pool_path: value.candidatePoolPath,
    ranking_history_path: value.rankingHistoryPath,
    tournament_scoreboard_path: value.tournamentScoreboardPath,
    top3_summary_path: value.top3SummaryPath,
    research_proposal_path: value.researchProposalPath,
    graph_ideation_packet_path: value.graphIdeationPacketPath,
    selected_direction_id: value.selectedDirectionId,
    selected_track_id: value.selectedTrackId,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
