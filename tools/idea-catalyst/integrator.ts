type IdeaCatalystCandidate = {
  candidate_id?: string | null;
  source_domain?: string | null;
  target_domain?: string | null;
  frontier_type?: string | null;
  transferred_mechanism?: string | null;
  idea_fragment?: Record<string, unknown> | null;
  evidence_chain_refs?: unknown[] | null;
  source_spans?: unknown[] | null;
  bridge_path_ids?: string[] | null;
  path_trace?: unknown[] | null;
  path_completeness?: number | null;
  domain_distance?: number | null;
  baseline_to_compare?: string | null;
  primary_metric?: string | null;
  falsifier_pilot?: string | null;
  weakest_assumption?: string | null;
  claim_cap?: string | null;
  evidence_tier?: string | null;
  evidence_density?: number | null;
  mechanism_support_density?: number | null;
  direction_id?: string | null;
  track_id?: string | null;
  title?: string | null;
  summary?: string | null;
  novelty?: number | null;
  feasibility?: number | null;
  relevance?: number | null;
  clarity?: number | null;
  composite_score?: number | null;
};

type ScoutingTakeaway = {
  takeaway_id?: string | null;
  concept?: string | null;
  mechanism?: string | null;
  kg_node_id?: string | null;
  source_domain_formulation?: string | null;
  mechanism_explanation?: string | null;
  relevance_to_challenge?: string | null;
  selection_rationale?: string | null;
  supporting_papers?: string[] | null;
};

type ScoutingDomainEntry = {
  domain?: string | null;
  takeaways?: ScoutingTakeaway[] | null;
};

type ScoutingReportLike = {
  candidate_domains?: ScoutingDomainEntry[] | null;
};

type DecompositionQuestion = {
  question_id?: string | null;
  domain_specific_question?: string | null;
  domain_agnostic_question?: string | null;
  coverage_status?: string | null;
  coverage_evidence?: {
    graph_signal_matches?: string[] | null;
    transfer_bridge_matches?: string[] | null;
  } | null;
  remaining_non_incremental_challenges?:
    | Array<{
        challenge_specific?: string | null;
        challenge_agnostic?: string | null;
      }>
    | null;
};

type DecompositionPacketLike = {
  questions?: DecompositionQuestion[] | null;
};

type IntegratorParams = {
  candidates: IdeaCatalystCandidate[];
  sourceDomains: string[];
  targetDomain: string;
  selectedTrackId: string | null;
  problemStatement: string | null;
  baselineReference?: string | null;
  primaryMetric?: string | null;
  scoutingReport?: ScoutingReportLike | null;
  decompositionPacket?: DecompositionPacketLike | null;
};

function uniqueStrings(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function tokenize(value: string) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function overlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function objectList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(value.map((entry) => String(entry ?? "")).filter(Boolean))
    : [];
}

function choosePrimaryQuestion(params: {
  candidate: IdeaCatalystCandidate;
  questions: DecompositionQuestion[];
}) {
  const summary = `${params.candidate.title ?? ""} ${params.candidate.summary ?? ""}`.trim();
  const ranked = params.questions
    .map((question) => ({
      question,
      score: Math.max(
        overlapScore(summary, question.domain_specific_question ?? ""),
        overlapScore(summary, question.domain_agnostic_question ?? ""),
        ...(Array.isArray(question.remaining_non_incremental_challenges)
          ? question.remaining_non_incremental_challenges.map((entry) =>
              Math.max(
                overlapScore(summary, entry.challenge_specific ?? ""),
                overlapScore(summary, entry.challenge_agnostic ?? "")
              )
            )
          : [0])
      ),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.question ?? params.questions[0] ?? null;
}

function getTakeawaysForDomain(
  scoutingReport: ScoutingReportLike | null | undefined,
  domain: string
) {
  const candidateDomains = Array.isArray(scoutingReport?.candidate_domains)
    ? scoutingReport?.candidate_domains ?? []
    : [];
  const match = candidateDomains.find(
    (entry) => String(entry?.domain ?? "").trim().toLowerCase() === domain.toLowerCase()
  );
  return Array.isArray(match?.takeaways) ? match.takeaways : [];
}

function buildTargetDomainElements(params: {
  question: DecompositionQuestion | null;
  targetDomain: string;
}) {
  if (!params.question) {
    return [params.targetDomain];
  }
  return uniqueStrings([
    params.targetDomain,
    String(params.question.domain_specific_question ?? "").trim(),
    ...((params.question.coverage_evidence?.graph_signal_matches ?? []).map((entry) =>
      String(entry || "").trim()
    )),
    ...((params.question.coverage_evidence?.transfer_bridge_matches ?? []).map((entry) =>
      String(entry || "").trim()
    )),
  ]).slice(0, 4);
}

function buildConcreteApproach(params: {
  candidate: IdeaCatalystCandidate;
  selectedTakeaways: ScoutingTakeaway[];
  question: DecompositionQuestion | null;
  problemStatement: string | null;
}) {
  const firstTakeaway = params.selectedTakeaways[0];
  const ideaFragment = asRecord(params.candidate.idea_fragment);
  const proposedApproach =
    pickString(ideaFragment, ["concrete_realization", "concreteRealization"]) ??
    params.candidate.summary ??
    `Recontextualize ${firstTakeaway?.mechanism ?? "source-domain mechanisms"} into ${params.problemStatement ?? "the target problem"}.`;
  const keyInnovations = uniqueStrings([
    params.candidate.title ?? "",
    params.candidate.transferred_mechanism
      ? `Transfer ${params.candidate.transferred_mechanism} into the target-domain method design`
      : "",
    firstTakeaway?.mechanism
      ? `Transfer ${firstTakeaway.mechanism} into the target-domain method design`
      : "",
    firstTakeaway?.relevance_to_challenge
      ? `Directly address ${firstTakeaway.relevance_to_challenge}`
      : "",
    params.question?.domain_agnostic_question
      ? `Operationalize the domain-agnostic challenge "${params.question.domain_agnostic_question}"`
      : "",
  ]).slice(0, 4);
  return {
    proposed_approach: proposedApproach,
    key_innovations: keyInnovations.length
      ? keyInnovations
      : ["Graph-grounded interdisciplinary synthesis"],
  };
}

export function buildIdeaCatalystIdeaFragments(params: IntegratorParams) {
  const questions = Array.isArray(params.decompositionPacket?.questions)
    ? params.decompositionPacket?.questions ?? []
    : [];
  const fragments = params.candidates.slice(0, 6).flatMap((candidate, index) => {
    const candidateSourceDomain =
      candidate.source_domain && String(candidate.source_domain).trim()
        ? String(candidate.source_domain).trim()
        : null;
    const chosenDomains = candidateSourceDomain
      ? [candidateSourceDomain]
      : params.sourceDomains.length
      ? [params.sourceDomains[index % params.sourceDomains.length]]
      : [];
    return chosenDomains.map((domain, domainIndex) => {
      const question = choosePrimaryQuestion({ candidate, questions });
      const domainTakeaways = getTakeawaysForDomain(params.scoutingReport, domain);
      const ideaFragment = asRecord(candidate.idea_fragment);
      const candidateId =
        candidate.candidate_id ??
        candidate.direction_id ??
        `dir-${index + 1}`;
      const bridgePathIds = uniqueStrings([
        ...stringList(candidate.bridge_path_ids),
        ...domainTakeaways.flatMap((takeaway) =>
          stringList((takeaway as Record<string, unknown>).bridge_path_ids)
        ),
      ]);
      const sourceSpans = [
        ...objectList(candidate.source_spans),
        ...domainTakeaways.flatMap((takeaway) =>
          objectList((takeaway as Record<string, unknown>).source_spans)
        ),
      ];
      const evidenceChainRefs = [
        ...objectList(candidate.evidence_chain_refs),
        ...domainTakeaways.flatMap((takeaway) =>
          objectList((takeaway as Record<string, unknown>).evidence_chain_refs)
        ),
      ];
      const pathTrace = [
        ...objectList(candidate.path_trace),
        ...domainTakeaways.flatMap((takeaway) =>
          objectList((takeaway as Record<string, unknown>).path_trace)
        ),
      ];
      const transferredMechanism =
        candidate.transferred_mechanism ??
        pickString(ideaFragment, [
          "transferred_mechanism",
          "transferredMechanism",
          "integration_mechanism",
          "integrationMechanism",
        ]) ??
        domainTakeaways[0]?.mechanism ??
        "cross-domain mechanism";
      const baselineToCompare =
        candidate.baseline_to_compare ?? params.baselineReference ?? null;
      const primaryMetric = candidate.primary_metric ?? params.primaryMetric ?? null;
      const falsifierPilot =
        candidate.falsifier_pilot ??
        (primaryMetric && baselineToCompare
          ? `Run a bounded pilot that removes ${transferredMechanism} and requires ${primaryMetric} to remain above ${baselineToCompare}.`
          : null);
      const weakestAssumption =
        candidate.weakest_assumption ??
        `The ${transferredMechanism} mechanism transfers from ${domain} to ${params.targetDomain} without changing the baseline protocol.`;
      const claimCap = candidate.claim_cap ?? "hypothesis";
      const evidenceTier = candidate.evidence_tier ?? "weak";
      const selectedTakeaways = domainTakeaways.slice(0, 2).map((takeaway, takeawayIndex) => ({
        takeaway_id:
          takeaway.takeaway_id ??
          `${candidateId}-${domainIndex + 1}-takeaway-${takeawayIndex + 1}`,
        source_domain_formulation:
          takeaway.source_domain_formulation ??
          takeaway.concept ??
          `Transferable ${domain} formulation`,
        mechanism_explanation:
          takeaway.mechanism_explanation ??
          takeaway.mechanism ??
          "Bridge mechanism remains implicit in the current graph packet.",
        selection_rationale:
          takeaway.selection_rationale ??
          `Selected because ${domain} contains graph-supported takeaways relevant to the target challenge.`,
        supporting_papers: Array.isArray(takeaway.supporting_papers)
          ? takeaway.supporting_papers
          : [],
        source_spans: objectList((takeaway as Record<string, unknown>).source_spans),
        evidence_chain_refs: objectList(
          (takeaway as Record<string, unknown>).evidence_chain_refs
        ),
      }));
      const targetDomainElements = buildTargetDomainElements({
        question,
        targetDomain: params.targetDomain,
      });
      const concreteRealization = buildConcreteApproach({
        candidate,
        selectedTakeaways: domainTakeaways,
        question,
        problemStatement: params.problemStatement,
      });

      const fragment = {
        fragment_id: `${candidateId}-${domainIndex + 1}`,
        track_id: candidate.track_id ?? params.selectedTrackId ?? null,
        direction_id: candidate.direction_id ?? null,
        candidate_id: candidate.candidate_id ?? null,
        title: `${
          pickString(ideaFragment, ["title"]) ??
          candidate.title ??
          `Direction ${index + 1}`
        } via ${domain}`,
        source_domain: domain,
        target_domain: params.targetDomain,
        frontier_type: candidate.frontier_type ?? null,
        transferred_mechanism: transferredMechanism,
        core_insight:
          pickString(ideaFragment, ["core_insight", "coreInsight"]) ??
          candidate.summary ??
          domainTakeaways[0]?.mechanism_explanation ??
          domainTakeaways[0]?.source_domain_formulation ??
          "Graph-grounded interdisciplinary idea fragment.",
        integration_mechanism: {
          target_domain_elements: targetDomainElements,
          selected_takeaways: selectedTakeaways,
          synthesis_approach:
            candidate.summary ??
            `Use ${domain} takeaways to address ${question?.domain_specific_question ?? params.problemStatement ?? "the active research problem"} while preserving target-domain constraints.`,
        },
        challenge_resolution: {
          addresses_target_challenge:
            question?.domain_specific_question ??
            candidate.summary ??
            "Addresses the selected cross-domain target challenge.",
          addresses_source_limitations:
            domainTakeaways[0]?.selection_rationale ??
            "Mitigates source-domain assumptions through graph-grounded adaptation.",
          addresses_research_problem:
            params.problemStatement ??
            question?.domain_agnostic_question ??
            "Addresses the active research problem through interdisciplinary synthesis.",
        },
        concrete_realization: concreteRealization,
        baseline_to_compare: baselineToCompare,
        primary_metric: primaryMetric,
        falsifier_pilot: falsifierPilot,
        weakest_assumption: weakestAssumption,
        expected_advantage:
          primaryMetric && baselineToCompare
            ? `Expected to improve ${primaryMetric} against ${baselineToCompare} while preserving evidence safety.`
            : "Expected to improve the target challenge under a bounded pilot.",
        claim_cap: claimCap,
        evidence_tier: evidenceTier,
        evidence_chain_refs: evidenceChainRefs,
        source_spans: sourceSpans,
        bridge_path_ids: bridgePathIds,
        path_trace: pathTrace,
        path_completeness: Number(candidate.path_completeness ?? 0),
        domain_distance: Number(candidate.domain_distance ?? 0),
        evidence_density: Number(candidate.evidence_density ?? 0),
        mechanism_support_density: Number(candidate.mechanism_support_density ?? 0),
        novelty: Number(candidate.novelty ?? 0.8),
        feasibility: Number(candidate.feasibility ?? 0.72),
        relevance: Number(candidate.relevance ?? 0.8),
        clarity: Number(candidate.clarity ?? 0.78),
        interdisciplinary_potential: Number(candidate.composite_score ?? 0.78),
      };
      return {
        ...fragment,
        idea_fragment: {
          title: fragment.title,
          core_insight: fragment.core_insight,
          integration_mechanism: fragment.integration_mechanism,
          challenge_resolution: fragment.challenge_resolution,
          concrete_realization: fragment.concrete_realization,
          baseline_to_compare: fragment.baseline_to_compare,
          primary_metric: fragment.primary_metric,
          falsifier_pilot: fragment.falsifier_pilot,
          weakest_assumption: fragment.weakest_assumption,
          expected_advantage: fragment.expected_advantage,
          claim_cap: fragment.claim_cap,
          evidence_tier: fragment.evidence_tier,
          evidence_chain_refs: fragment.evidence_chain_refs,
          source_spans: fragment.source_spans,
          bridge_path_ids: fragment.bridge_path_ids,
          path_trace: fragment.path_trace,
        },
      };
    });
  });
  return { fragments };
}
