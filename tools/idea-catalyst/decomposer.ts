type DecompositionPacketParams = {
  targetDomain: string;
  longTermGoal: string | null;
  problemStatement: string | null;
  selectedTrackId: string | null;
  challengeClusters: string[];
  graphChallengeClusters?: string[];
  occupiedSolutionZones?: string[];
  transferBridges?: string[];
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

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
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

function matchingEntries(target: string, candidates: string[], threshold = 0.34) {
  return uniqueStrings(candidates).filter((candidate) => {
    const normalizedTarget = target.toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    return (
      normalizedTarget.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedTarget) ||
      tokenOverlapScore(target, candidate) >= threshold
    );
  });
}

function describeRemainingChallenges(challenge: string, targetDomain: string) {
  return [
    `Find a non-incremental mechanism that addresses "${challenge}" in ${targetDomain}.`,
    `Collect cross-domain evidence that explains why "${challenge}" remains unresolved under current ${targetDomain} assumptions.`,
  ];
}

export function buildIdeaCatalystDecompositionPacket(
  params: DecompositionPacketParams
) {
  const graphChallengeClusters = uniqueStrings(params.graphChallengeClusters ?? []);
  const occupiedSolutionZones = uniqueStrings(params.occupiedSolutionZones ?? []);
  const transferBridgeMechanisms = uniqueStrings(
    (params.transferBridges ?? []).map((entry) => {
      const [, ...rest] = String(entry || "").split(":");
      return rest.join(":").trim() || String(entry || "").trim();
    })
  );

  return {
    version: 2,
    target_domain: params.targetDomain,
    long_term_goal: params.longTermGoal,
    problem_statement: params.problemStatement,
    selected_track_id: params.selectedTrackId,
    questions: uniqueStrings(params.challengeClusters).map((challenge, index) => {
      const graphSignalMatches = matchingEntries(challenge, graphChallengeClusters);
      const occupiedMatches = matchingEntries(challenge, occupiedSolutionZones, 0.25);
      const transferBridgeMatches = matchingEntries(challenge, transferBridgeMechanisms);
      const coverageStatus = occupiedMatches.length
        ? "resolved"
        : graphSignalMatches.length || transferBridgeMatches.length
          ? "partial"
          : "unexplored";

      return {
        question_id: `q${index + 1}`,
        priority: index + 1,
        domain_specific_question: challenge,
        coverage_status: coverageStatus,
        coverage_evidence: {
          graph_signal_matches: graphSignalMatches,
          occupied_solution_matches: occupiedMatches,
          transfer_bridge_matches: transferBridgeMatches,
        },
        remaining_non_incremental_challenges:
          coverageStatus === "resolved"
            ? []
            : describeRemainingChallenges(challenge, params.targetDomain),
      };
    }),
  };
}
