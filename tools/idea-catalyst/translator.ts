type DecompositionQuestion = {
  question_id?: string | null;
  domain_specific_question?: string | null;
  domain_agnostic_question?: string | null;
  coverage_status?: string | null;
  coverage_evidence?: {
    graph_signal_matches?: string[] | null;
    occupied_solution_matches?: string[] | null;
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

function deriveMechanismHypothesis(question: DecompositionQuestion) {
  const domainSpecificQuestion =
    question.domain_specific_question ?? "the target challenge";
  const transferBridgeMatches = Array.isArray(
    question.coverage_evidence?.transfer_bridge_matches
  )
    ? question.coverage_evidence?.transfer_bridge_matches ?? []
    : [];
  if (transferBridgeMatches.length > 0) {
    return `Adapt the mechanism behind ${transferBridgeMatches[0]} to address ${domainSpecificQuestion.toLowerCase()}.`;
  }
  return `Abstract the control or adaptation mechanism underlying ${domainSpecificQuestion.toLowerCase()} so it can be transferred across domains.`;
}

function extractChallengeAgnosticConstraints(question: DecompositionQuestion) {
  const rawChallenges = Array.isArray(question.remaining_non_incremental_challenges)
    ? question.remaining_non_incremental_challenges
    : [];
  return rawChallenges
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      return String(entry.challenge_agnostic ?? "").trim() || null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function buildCoverageAwareAbstraction(question: DecompositionQuestion, index: number) {
  const domainSpecificQuestion =
    question.domain_specific_question ?? `challenge ${index + 1}`;
  const domainAgnosticQuestion =
    question.domain_agnostic_question ??
    `How can a system address ${String(domainSpecificQuestion).toLowerCase()} under changing collaborators, constraints, and environments?`;
  const coverageStatus = question.coverage_status ?? "partial";
  const transferAxes = uniqueStrings([
    ...(question.coverage_evidence?.graph_signal_matches ?? []),
    ...(question.coverage_evidence?.transfer_bridge_matches ?? []),
  ]);
  const unresolvedConstraints = extractChallengeAgnosticConstraints(question);

  if (coverageStatus === "unexplored") {
    return {
      question_id: question.question_id ?? `q${index + 1}`,
      domain_specific_question: domainSpecificQuestion,
      coverage_status: coverageStatus,
      domain_agnostic_question: domainAgnosticQuestion,
      mechanism_hypothesis: null,
      transfer_axes: [],
      unresolved_constraints: unresolvedConstraints,
      strategy: "exploratory",
    };
  }

  if (coverageStatus === "partial") {
    return {
      question_id: question.question_id ?? `q${index + 1}`,
      domain_specific_question: domainSpecificQuestion,
      coverage_status: coverageStatus,
      domain_agnostic_question: domainAgnosticQuestion,
      mechanism_hypothesis: deriveMechanismHypothesis(question),
      transfer_axes: transferAxes,
      unresolved_constraints: unresolvedConstraints,
      strategy: "targeted",
    };
  }

  return {
    question_id: question.question_id ?? `q${index + 1}`,
    domain_specific_question: domainSpecificQuestion,
    coverage_status: coverageStatus,
    domain_agnostic_question: domainAgnosticQuestion,
    mechanism_hypothesis: transferAxes.length
      ? `Leverage the already-supported mechanisms behind ${transferAxes[0]} to preserve the current target-domain advantage.`
      : null,
    transfer_axes: transferAxes,
    unresolved_constraints: unresolvedConstraints,
    strategy: "resolved",
  };
}

export function buildIdeaCatalystAbstractionPacket(
  decompositionPacket: DecompositionPacketLike,
  targetDomain: string
) {
  const questions = Array.isArray(decompositionPacket.questions)
    ? decompositionPacket.questions
    : [];
  return {
    version: 2,
    target_domain: targetDomain,
    abstractions: questions.map((question, index) =>
      buildCoverageAwareAbstraction(question, index)
    ),
  };
}
