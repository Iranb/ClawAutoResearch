import {
  asRecord,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import type { IdeaCatalystCandidate } from "./candidate-pool";

type ScoreDimension =
  | "evidence_support"
  | "source_span_support"
  | "path_completeness"
  | "graph_novelty"
  | "domain_distance"
  | "mechanism_transferability"
  | "target_challenge_alignment"
  | "feasibility"
  | "falsifiability"
  | "baseline_metric_readiness"
  | "claim_safety"
  | "diversity_penalty";

type RejectionReason =
  | "weak_evidence"
  | "missing_metric"
  | "duplicate_mechanism"
  | "low_feasibility"
  | "claim_unsafe"
  | "missing_bridge_path";

const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  evidence_support: 0.14,
  source_span_support: 0.1,
  path_completeness: 0.1,
  graph_novelty: 0.08,
  domain_distance: 0.07,
  mechanism_transferability: 0.1,
  target_challenge_alignment: 0.1,
  feasibility: 0.09,
  falsifiability: 0.08,
  baseline_metric_readiness: 0.09,
  claim_safety: 0.1,
  diversity_penalty: 0.05,
};

const POSITIVE_DIMENSIONS: ScoreDimension[] = [
  "evidence_support",
  "source_span_support",
  "path_completeness",
  "graph_novelty",
  "domain_distance",
  "mechanism_transferability",
  "target_challenge_alignment",
  "feasibility",
  "falsifiability",
  "baseline_metric_readiness",
  "claim_safety",
];

function nowIso() {
  return new Date().toISOString();
}

function recordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4));
}

function boundedCountScore(count: number, denominator: number) {
  return normalizeScore(Math.max(0, count) / Math.max(1, denominator));
}

function normalizeDomainKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function candidateTitle(candidate: IdeaCatalystCandidate) {
  const fragment = asRecord(candidate.idea_fragment) ?? {};
  return (
    pickString(fragment, ["title"]) ??
    `${candidate.source_domain} ${candidate.transferred_mechanism}`.trim() ??
    candidate.candidate_id
  );
}

function nonEmptyTextScore(value: unknown, score = 1) {
  return typeof value === "string" && value.trim() ? score : 0;
}

function evidenceTierScore(candidate: IdeaCatalystCandidate) {
  if (candidate.evidence_tier === "strong") return 1;
  if (candidate.evidence_tier === "moderate") return 0.72;
  return 0.28;
}

function domainDistanceScore(distance: number) {
  const normalized = normalizeScore(distance);
  if (normalized === 0) {
    return 0.35;
  }
  if (normalized <= 0.8) {
    return Number((0.45 + normalized * 0.6).toFixed(4));
  }
  return Number(Math.max(0.55, 1 - (normalized - 0.8) * 1.25).toFixed(4));
}

function claimSafetyScore(candidate: IdeaCatalystCandidate) {
  if (candidate.claim_cap === "confirmatory") {
    return candidate.evidence_tier === "strong" &&
      candidate.source_spans.length > 0 &&
      candidate.bridge_path_ids.length > 0
      ? 1
      : 0.25;
  }
  if (candidate.claim_cap === "exploratory") {
    return candidate.evidence_tier === "weak" ? 0.45 : 0.85;
  }
  return candidate.evidence_tier === "weak" ? 0.7 : 0.78;
}

function diversityKey(candidate: IdeaCatalystCandidate) {
  return `${normalizeDomainKey(candidate.source_domain)}::${normalizeDomainKey(
    candidate.transferred_mechanism
  )}`;
}

function computeDuplicatePressure(
  candidate: IdeaCatalystCandidate,
  candidates: IdeaCatalystCandidate[]
) {
  const key = diversityKey(candidate);
  const duplicates = candidates.filter((entry) => diversityKey(entry) === key).length;
  return duplicates <= 1 ? 0 : boundedCountScore(duplicates - 1, 3);
}

function hardFilterReasons(candidate: IdeaCatalystCandidate): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (candidate.bridge_path_ids.length === 0) {
    reasons.push("missing_bridge_path");
  }
  if (!candidate.baseline_to_compare || !candidate.primary_metric) {
    reasons.push("missing_metric");
  }
  if (candidate.claim_cap === "confirmatory" && candidate.source_spans.length === 0) {
    reasons.push("claim_unsafe");
  }
  return uniqueStrings(reasons) as RejectionReason[];
}

function scoreCandidate(
  candidate: IdeaCatalystCandidate,
  candidates: IdeaCatalystCandidate[]
) {
  const fragment = asRecord(candidate.idea_fragment) ?? {};
  const evidenceRefCount = candidate.evidence_chain_refs.length;
  const sourceSpanCount = candidate.source_spans.length;
  const bridgePathCount = candidate.bridge_path_ids.length;
  const dimensions: Record<
    ScoreDimension,
    {
      score: number;
      weight: number;
      weighted_score: number;
      rationale: string;
      inputs: Record<string, unknown>;
      evidence_refs: unknown[];
    }
  > = {
    evidence_support: {
      score: normalizeScore(
        Math.max(
          evidenceTierScore(candidate),
          boundedCountScore(evidenceRefCount + sourceSpanCount, 4),
          candidate.evidence_density
        )
      ),
      weight: SCORE_WEIGHTS.evidence_support,
      weighted_score: 0,
      rationale:
        "Combines evidence tier, evidence-chain references, source spans, and PaperNexus evidence density.",
      inputs: {
        evidence_tier: candidate.evidence_tier,
        evidence_chain_ref_count: evidenceRefCount,
        source_span_count: sourceSpanCount,
        evidence_density: candidate.evidence_density,
      },
      evidence_refs: candidate.evidence_chain_refs,
    },
    source_span_support: {
      score: boundedCountScore(sourceSpanCount, 2),
      weight: SCORE_WEIGHTS.source_span_support,
      weighted_score: 0,
      rationale:
        "Rewards candidates that preserve PaperNexus source spans or evidence snippets.",
      inputs: { source_span_count: sourceSpanCount },
      evidence_refs: candidate.source_spans,
    },
    path_completeness: {
      score: normalizeScore(candidate.path_completeness),
      weight: SCORE_WEIGHTS.path_completeness,
      weighted_score: 0,
      rationale:
        "Uses PaperNexus path completeness for the target challenge to source mechanism path.",
      inputs: {
        bridge_path_count: bridgePathCount,
        path_completeness: candidate.path_completeness,
      },
      evidence_refs: candidate.bridge_path_ids,
    },
    graph_novelty: {
      score: normalizeScore(
        Math.max(
          candidate.frontier_type === "legacy_ideation_candidate" ? 0.45 : 0.74,
          candidate.domain_distance * 0.9
        )
      ),
      weight: SCORE_WEIGHTS.graph_novelty,
      weighted_score: 0,
      rationale:
        "Rewards candidates derived from PaperNexus frontier/path artifacts and non-trivial cross-domain distance.",
      inputs: {
        frontier_type: candidate.frontier_type,
        domain_distance: candidate.domain_distance,
        source_path: candidate.source_path,
      },
      evidence_refs: candidate.bridge_path_ids,
    },
    domain_distance: {
      score: domainDistanceScore(candidate.domain_distance),
      weight: SCORE_WEIGHTS.domain_distance,
      weighted_score: 0,
      rationale:
        "Scores far-but-transferable source domains while penalizing overly distant mechanisms.",
      inputs: { domain_distance: candidate.domain_distance },
      evidence_refs: candidate.bridge_path_ids,
    },
    mechanism_transferability: {
      score: normalizeScore(
        Math.max(
          candidate.mechanism_support_density,
          nonEmptyTextScore(candidate.transferred_mechanism, 0.68)
        )
      ),
      weight: SCORE_WEIGHTS.mechanism_transferability,
      weighted_score: 0,
      rationale:
        "Requires an explicit transferred mechanism and mechanism support density where PaperNexus provides it.",
      inputs: {
        transferred_mechanism: candidate.transferred_mechanism,
        mechanism_support_density: candidate.mechanism_support_density,
      },
      evidence_refs: candidate.evidence_chain_refs,
    },
    target_challenge_alignment: {
      score: normalizeScore(
        Math.max(
          nonEmptyTextScore(fragment.challenge_resolution, 0.72),
          nonEmptyTextScore(fragment.core_insight, 0.66),
          boundedCountScore(recordList(fragment.target_challenges).length, 2)
        )
      ),
      weight: SCORE_WEIGHTS.target_challenge_alignment,
      weighted_score: 0,
      rationale:
        "Checks whether the candidate carries an explicit target challenge resolution or core insight.",
      inputs: {
        core_insight_present: Boolean(pickString(fragment, ["core_insight", "coreInsight"])),
        challenge_resolution_present: Boolean(
          pickString(fragment, ["challenge_resolution", "challengeResolution"])
        ),
      },
      evidence_refs: candidate.bridge_path_ids,
    },
    feasibility: {
      score: normalizeScore(
        0.35 +
          nonEmptyTextScore(fragment.concrete_realization, 0.25) +
          nonEmptyTextScore(candidate.baseline_to_compare, 0.16) +
          nonEmptyTextScore(candidate.primary_metric, 0.16) +
          Math.min(0.08, candidate.mechanism_support_density * 0.08)
      ),
      weight: SCORE_WEIGHTS.feasibility,
      weighted_score: 0,
      rationale:
        "Rewards candidates with a concrete realization, baseline, metric, and operational mechanism support.",
      inputs: {
        concrete_realization_present: Boolean(
          pickString(fragment, ["concrete_realization", "concreteRealization"])
        ),
        baseline_to_compare: candidate.baseline_to_compare,
        primary_metric: candidate.primary_metric,
      },
      evidence_refs: candidate.evidence_chain_refs,
    },
    falsifiability: {
      score: normalizeScore(
        nonEmptyTextScore(candidate.falsifier_pilot, 0.58) +
          nonEmptyTextScore(candidate.weakest_assumption, 0.42)
      ),
      weight: SCORE_WEIGHTS.falsifiability,
      weighted_score: 0,
      rationale:
        "Requires both a falsifier pilot and weakest assumption before a candidate can drive planning.",
      inputs: {
        falsifier_pilot: candidate.falsifier_pilot,
        weakest_assumption: candidate.weakest_assumption,
      },
      evidence_refs: candidate.evidence_chain_refs,
    },
    baseline_metric_readiness: {
      score: normalizeScore(
        nonEmptyTextScore(candidate.baseline_to_compare, 0.5) +
          nonEmptyTextScore(candidate.primary_metric, 0.5)
      ),
      weight: SCORE_WEIGHTS.baseline_metric_readiness,
      weighted_score: 0,
      rationale:
        "Requires a baseline and primary metric before selected top-k handoff.",
      inputs: {
        baseline_to_compare: candidate.baseline_to_compare,
        primary_metric: candidate.primary_metric,
      },
      evidence_refs: [],
    },
    claim_safety: {
      score: claimSafetyScore(candidate),
      weight: SCORE_WEIGHTS.claim_safety,
      weighted_score: 0,
      rationale:
        "Aligns claim cap with evidence tier, source-span support, and bridge-path availability.",
      inputs: {
        claim_cap: candidate.claim_cap,
        evidence_tier: candidate.evidence_tier,
        source_span_count: sourceSpanCount,
        bridge_path_count: bridgePathCount,
      },
      evidence_refs: candidate.evidence_chain_refs,
    },
    diversity_penalty: {
      score: computeDuplicatePressure(candidate, candidates),
      weight: SCORE_WEIGHTS.diversity_penalty,
      weighted_score: 0,
      rationale:
        "Penalizes repeated source-domain plus transferred-mechanism combinations.",
      inputs: {
        source_domain: candidate.source_domain,
        transferred_mechanism: candidate.transferred_mechanism,
      },
      evidence_refs: [],
    },
  };

  for (const dimension of Object.keys(dimensions) as ScoreDimension[]) {
    const weighted =
      dimension === "diversity_penalty"
        ? -dimensions[dimension].score * dimensions[dimension].weight
        : dimensions[dimension].score * dimensions[dimension].weight;
    dimensions[dimension].weighted_score = Number(weighted.toFixed(4));
  }
  const weightedScore = Number(
    Object.values(dimensions)
      .reduce((sum, entry) => sum + entry.weighted_score, 0)
      .toFixed(4)
  );
  const reasons = hardFilterReasons(candidate);
  const restrictedToHypothesis =
    candidate.evidence_tier === "weak" || candidate.claim_cap === "hypothesis";
  return {
    candidate_id: candidate.candidate_id,
    title: candidateTitle(candidate),
    source_domain: candidate.source_domain,
    transferred_mechanism: candidate.transferred_mechanism,
    frontier_type: candidate.frontier_type,
    claim_cap: candidate.claim_cap,
    evidence_tier: candidate.evidence_tier,
    hard_filters: {
      rejection_reasons: reasons,
      eligible_for_selected_topk: reasons.length === 0,
      eligible_for_experiment:
        reasons.length === 0 &&
        candidate.evidence_tier !== "weak" &&
        candidate.source_spans.length > 0,
      restricted_to_hypothesis: restrictedToHypothesis,
    },
    dimensions,
    weighted_score: weightedScore,
    evidence_refs: candidate.evidence_chain_refs,
    source_spans: candidate.source_spans,
    bridge_path_ids: candidate.bridge_path_ids,
    rationale:
      reasons.length > 0
        ? `Blocked by hard filters: ${reasons.join(", ")}.`
        : restrictedToHypothesis
          ? "Eligible only as a hypothesis-capped candidate until stronger evidence is requisitioned."
          : "Eligible for evidence-aware top-k selection.",
  };
}

function buildPairwiseResults(
  scorecards: ReturnType<typeof scoreCandidate>[],
  candidatesById: Map<string, IdeaCatalystCandidate>
) {
  const wins = new Map(scorecards.map((entry) => [entry.candidate_id, 0]));
  const results: Array<Record<string, unknown>> = [];
  const eligible = scorecards.filter(
    (entry) => entry.hard_filters.eligible_for_selected_topk
  );
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const left = eligible[leftIndex];
      const right = eligible[rightIndex];
      if (!left || !right) continue;
      const leftCandidate = candidatesById.get(left.candidate_id);
      const rightCandidate = candidatesById.get(right.candidate_id);
      const leftPositive = POSITIVE_DIMENSIONS.reduce(
        (sum, dimension) => sum + left.dimensions[dimension].score,
        0
      );
      const rightPositive = POSITIVE_DIMENSIONS.reduce(
        (sum, dimension) => sum + right.dimensions[dimension].score,
        0
      );
      const leftDiversityPenalty =
        leftCandidate && rightCandidate && diversityKey(leftCandidate) === diversityKey(rightCandidate)
          ? 0.08
          : 0;
      const rightDiversityPenalty =
        leftCandidate && rightCandidate && diversityKey(rightCandidate) === diversityKey(leftCandidate)
          ? 0.08
          : 0;
      const leftScore = left.weighted_score + leftPositive * 0.01 - leftDiversityPenalty;
      const rightScore = right.weighted_score + rightPositive * 0.01 - rightDiversityPenalty;
      const winner = leftScore >= rightScore ? left : right;
      const loser = winner.candidate_id === left.candidate_id ? right : left;
      wins.set(winner.candidate_id, (wins.get(winner.candidate_id) ?? 0) + 1);
      results.push({
        candidate_a: left.candidate_id,
        candidate_b: right.candidate_id,
        judge_type: "deterministic_evidence_scorecard",
        allowed_evidence_scope: "candidate_existing_evidence_only",
        compared_dimensions: POSITIVE_DIMENSIONS,
        candidate_a_score: Number(leftScore.toFixed(4)),
        candidate_b_score: Number(rightScore.toFixed(4)),
        winner_candidate_id: winner.candidate_id,
        loser_candidate_id: loser.candidate_id,
        loser_reason:
          loser.dimensions.feasibility.score < 0.55
            ? "low_feasibility"
            : loser.evidence_tier === "weak"
              ? "weak_evidence"
              : "lower_evidence_weighted_score",
        rationale: `${winner.title} wins using persisted scorecard inputs and existing evidence refs; no new evidence was introduced by the judge.`,
        evidence_refs_compared: uniqueStrings([
          ...left.bridge_path_ids,
          ...right.bridge_path_ids,
        ]),
      });
    }
  }
  return { results, wins };
}

function chooseRejectionReason(
  scorecard: ReturnType<typeof scoreCandidate>,
  selectedKeys: Set<string>,
  candidate: IdeaCatalystCandidate
): RejectionReason {
  const hardReason = scorecard.hard_filters.rejection_reasons[0];
  if (hardReason) return hardReason;
  if (selectedKeys.has(diversityKey(candidate))) return "duplicate_mechanism";
  if (scorecard.dimensions.feasibility.score < 0.55) return "low_feasibility";
  if (candidate.evidence_tier === "weak") return "weak_evidence";
  return "low_feasibility";
}

export function buildIdeaCatalystTournament(params: {
  candidatePool: Record<string, unknown> | null;
  topK?: number;
}) {
  const pool = asRecord(params.candidatePool) ?? {};
  const candidates = recordList(pool.candidates) as unknown as IdeaCatalystCandidate[];
  const topK = Math.max(1, Math.min(3, Math.floor(params.topK ?? 3)));
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.candidate_id, candidate] as const)
  );
  const scorecards = candidates.map((candidate) => scoreCandidate(candidate, candidates));
  const { results: pairwiseResults, wins } = buildPairwiseResults(
    scorecards,
    candidatesById
  );
  const ranked = scorecards
    .map((entry) => ({
      ...entry,
      tournament_wins: wins.get(entry.candidate_id) ?? 0,
      tournament_score: Number(
        (entry.weighted_score + (wins.get(entry.candidate_id) ?? 0) * 0.025).toFixed(4)
      ),
    }))
    .sort((left, right) => {
      if (right.tournament_score !== left.tournament_score) {
        return right.tournament_score - left.tournament_score;
      }
      return right.weighted_score - left.weighted_score;
    });

  const selected: Array<Record<string, unknown>> = [];
  const selectedDiversityKeys = new Set<string>();
  for (const scorecard of ranked) {
    if (!scorecard.hard_filters.eligible_for_selected_topk) {
      continue;
    }
    const candidate = candidatesById.get(scorecard.candidate_id);
    if (!candidate) {
      continue;
    }
    const key = diversityKey(candidate);
    const remainingDifferent = ranked.some((entry) => {
      const other = candidatesById.get(entry.candidate_id);
      return (
        other &&
        entry.hard_filters.eligible_for_selected_topk &&
        !selected.some((selectedEntry) => selectedEntry.candidate_id === entry.candidate_id) &&
        !selectedDiversityKeys.has(diversityKey(other))
      );
    });
    if (selectedDiversityKeys.has(key) && remainingDifferent && selected.length > 0) {
      continue;
    }
    selected.push({
      ...candidate,
      selection_rank: selected.length + 1,
      selection_role:
        selected.length === 0
          ? "primary_track"
          : selected.length === 1
            ? "reserve_track"
            : "alternative_mechanism_track",
      score: scorecard.tournament_score,
      weighted_score: scorecard.weighted_score,
      scorecard_ref: scorecard.candidate_id,
      experiment_entry_allowed: scorecard.hard_filters.eligible_for_experiment,
      selection_reason: scorecard.hard_filters.restricted_to_hypothesis
        ? "Selected as hypothesis-only because it has a bridge path and experiment contract, but evidence still needs strengthening before confirmatory claims."
        : "Selected by evidence-aware scorecard and diversity-aware tournament.",
    });
    selectedDiversityKeys.add(key);
    if (selected.length >= topK) {
      break;
    }
  }

  const selectedIds = new Set(selected.map((entry) => String(entry.candidate_id)));
  const rejected = ranked
    .filter((entry) => !selectedIds.has(entry.candidate_id))
    .map((entry) => {
      const candidate = candidatesById.get(entry.candidate_id);
      const reason = candidate
        ? chooseRejectionReason(entry, selectedDiversityKeys, candidate)
        : "low_feasibility";
      return {
        candidate_id: entry.candidate_id,
        title: entry.title,
        source_domain: entry.source_domain,
        transferred_mechanism: entry.transferred_mechanism,
        frontier_type: entry.frontier_type,
        rejection_reason: reason,
        score: entry.tournament_score,
        weighted_score: entry.weighted_score,
        rationale:
          reason === "duplicate_mechanism"
            ? "Rejected to preserve top-k diversity by source domain and transferred mechanism."
            : entry.rationale,
        evidence_refs: entry.evidence_refs,
        bridge_path_ids: entry.bridge_path_ids,
        source_spans: entry.source_spans,
      };
    });

  const selectedDomains = uniqueStrings(
    selected.map((entry) => String(entry.source_domain ?? ""))
  );
  const selectedMechanisms = uniqueStrings(
    selected.map((entry) => String(entry.transferred_mechanism ?? ""))
  );
  const diversityException =
    selected.length > 1 &&
    (selectedDomains.length === 1 || selectedMechanisms.length === 1)
      ? {
          reason:
            "Top-k diversity could not be improved without selecting a lower-scoring or hard-filtered candidate.",
          selected_source_domains: selectedDomains,
          selected_transferred_mechanisms: selectedMechanisms,
        }
      : null;
  const generatedAt = nowIso();

  return {
    scorecard: {
      schema_version: 1,
      contract_version: "idea-catalyst-candidate-scorecard-v1",
      generated_at: generatedAt,
      weights: SCORE_WEIGHTS,
      scoring_policy: {
        hard_filters_first: true,
        llm_judge_policy:
          "LLM or deterministic judges may only compare existing candidate evidence; no invented evidence is allowed.",
        diversity_penalty_direction: "subtract",
      },
      candidates: ranked,
      diversity_exception: diversityException,
    },
    tournament: {
      schema_version: 1,
      contract_version: "idea-catalyst-candidate-tournament-v1",
      generated_at: generatedAt,
      candidate_count: candidates.length,
      eligible_candidate_count: ranked.filter(
        (entry) => entry.hard_filters.eligible_for_selected_topk
      ).length,
      pairwise_results: pairwiseResults,
      ranking: ranked.map((entry, index) => ({
        candidate_id: entry.candidate_id,
        rank: index + 1,
        title: entry.title,
        source_domain: entry.source_domain,
        transferred_mechanism: entry.transferred_mechanism,
        weighted_score: entry.weighted_score,
        tournament_score: entry.tournament_score,
        tournament_wins: entry.tournament_wins,
        claim_cap: entry.claim_cap,
        evidence_tier: entry.evidence_tier,
      })),
      diversity_summary: {
        selected_source_domain_count: selectedDomains.length,
        selected_transferred_mechanism_count: selectedMechanisms.length,
        diversity_exception: diversityException,
      },
    },
    selectedIdeas: {
      schema_version: 1,
      contract_version: "idea-catalyst-selected-ideas-v1",
      generated_at: generatedAt,
      top_k: topK,
      selected_count: selected.length,
      selected_ideas: selected,
      diversity_exception: diversityException,
    },
    rejectedIdeas: {
      schema_version: 1,
      contract_version: "idea-catalyst-rejected-ideas-v1",
      generated_at: generatedAt,
      rejected_count: rejected.length,
      rejected_ideas: rejected,
    },
  };
}
