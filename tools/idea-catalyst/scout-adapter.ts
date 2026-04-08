import { asRecord, asString, asStringArray, pickString, uniqueStrings } from "../workflow-guard-core/coercion";

function parseBridgeDomain(entry: string): string | null {
  const value = String(entry || "").trim();
  if (!value) return null;
  const [domain] = value.split(":");
  const cleaned = domain.trim();
  return cleaned || null;
}

function uniqueDomains(values: string[]): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(value);
  }
  return entries;
}

function normalizeDomainKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function scoreDomainDistanceFromMatrix(
  matrix: Record<string, unknown> | null,
  targetDomain: string | null,
  sourceDomain: string
) {
  const sourceKey = normalizeDomainKey(sourceDomain);
  const targetKey = normalizeDomainKey(targetDomain);
  if (!matrix || !targetKey || !sourceKey) {
    return null;
  }
  const targetRow = asRecord(matrix[targetKey] ?? matrix[targetDomain ?? ""]);
  if (!targetRow) {
    return null;
  }
  const rawValue =
    targetRow[sourceKey] ??
    targetRow[sourceDomain] ??
    asRecord(targetRow[sourceKey])?.score ??
    asRecord(targetRow[sourceDomain])?.score;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return null;
  }
  return Number(Math.max(0, Math.min(1, rawValue)).toFixed(2));
}

function overlapScore(left: string, right: string) {
  const leftTokens = new Set(
    String(left || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((entry) => entry.length >= 3)
  );
  const rightTokens = new Set(
    String(right || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((entry) => entry.length >= 3)
  );
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

function chooseRelevantChallenge(params: {
  mechanism: string;
  concept: string;
  challengeClusters: string[];
}) {
  const ranked = uniqueStrings(params.challengeClusters)
    .map((challenge) => ({
      challenge,
      score: Math.max(
        overlapScore(params.mechanism, challenge),
        overlapScore(params.concept, challenge)
      ),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.challenge ?? params.challengeClusters[0] ?? "unresolved target-domain challenge";
}

function buildStructuredTakeaway(params: {
  nodeId: string;
  concept: string;
  mechanism: string;
  domain: string | null;
  challengeClusters: string[];
  properties?: Record<string, unknown> | null;
}) {
  const relevantChallenge = chooseRelevantChallenge({
    mechanism: params.mechanism,
    concept: params.concept,
    challengeClusters: params.challengeClusters,
  });
  const properties = params.properties ?? {};
  const sourceFormulation =
    pickString(properties, ["abstract", "text", "evidenceText", "description"]) ??
    `${params.domain ?? "Source domain"} frames ${params.concept} as a mechanism for ${relevantChallenge}.`;
  const mechanismExplanation =
    pickString(properties, ["evidenceText", "abstract", "text", "description"]) ??
    `${params.mechanism} helps regulate ${relevantChallenge} under changing conditions.`;
  const supportingPapers = uniqueStrings([
    ...asStringArray(
      properties?.supporting_papers ??
        properties?.supportingPapers ??
        properties?.paper_ids ??
        properties?.paperIds
    ),
    pickString(properties, ["paper_id", "paperId"]) ?? "",
  ]).slice(0, 5);
  return {
    takeaway_id: `${params.nodeId}-takeaway`,
    concept: params.concept,
    mechanism: params.mechanism,
    kg_node_id: params.nodeId,
    source_domain_formulation: sourceFormulation,
    mechanism_explanation: mechanismExplanation,
    relevance_to_challenge: relevantChallenge,
    selection_rationale: `Selected because ${params.domain ?? "the source domain"} offers transferable evidence for "${relevantChallenge}".`,
    supporting_papers: supportingPapers,
  };
}

function normalizeBridgeNodes(params: {
  graphPacket: Record<string, unknown>;
  transferBridges: string[];
  challengeClusters: string[];
}) {
  const explicitBridgeNodes = Array.isArray(params.graphPacket.bridge_nodes)
    ? params.graphPacket.bridge_nodes
    : Array.isArray(params.graphPacket.bridgeNodes)
      ? params.graphPacket.bridgeNodes
      : [];
  if (explicitBridgeNodes.length > 0) {
    return explicitBridgeNodes
      .map((entry, index) => {
        const record = asRecord(entry) ?? {};
        const nodeId = pickString(record, ["node_id", "nodeId"]) ?? `bridge-${index + 1}`;
        const domain = pickString(record, ["domain"]);
        const mechanism =
          pickString(record, ["mechanism"]) ??
          pickString(record, ["node_name", "nodeName"]) ??
          "cross-domain mechanism";
        const concept =
          pickString(record, ["node_name", "nodeName"]) ?? mechanism;
        const properties = asRecord(record.properties) ?? null;
        return {
          node_id: nodeId,
          node_name: concept,
          domain,
          mechanism,
          score: Number(record.score ?? 0.75),
          source: pickString(record, ["source"]) ?? "graph_bridge_node",
          properties,
        };
      })
      .filter((entry) => Boolean(entry.domain || entry.mechanism));
  }
  return params.transferBridges.map((entry, index) => {
    const [domain, ...rest] = String(entry || "").split(":");
    const mechanism = rest.join(":").trim() || String(entry || "").trim();
    return {
      node_id: `bridge-${index + 1}`,
      node_name: mechanism,
      domain: domain?.trim() || null,
      mechanism,
      score: 0.75,
      source: "graph_transfer_bridge",
      properties: null,
    };
  });
}

function buildDomainSearchQueries(params: {
  domain: string;
  targetDomain: string | null;
  challengeClusters: string[];
}): Array<{ query: string; rationale: string }> {
  const challengeTerms = uniqueStrings(params.challengeClusters).slice(0, 3);
  if (challengeTerms.length === 0) {
    return [
      {
        query: `${params.domain} transferable principle for ${params.targetDomain ?? "target-domain"} innovation`,
        rationale:
          "Fallback cross-domain scouting query when no explicit challenge cluster is available.",
      },
    ];
  }
  return challengeTerms.map((challenge) => ({
    query: `${params.domain} ${challenge} transferable principle ${params.targetDomain ?? "target-domain"}`.trim(),
    rationale: `Acquire source-domain evidence for the target challenge "${challenge}".`,
  }));
}

export function deriveIdeaCatalystScoutReport(params: {
  graphIdeationPacket: Record<string, unknown> | null;
  topicSummary: Record<string, unknown> | null;
  challengeClusters: string[];
  transferBridges: string[];
  targetDomain: string | null;
}) {
  const graphPacket = asRecord(params.graphIdeationPacket) ?? {};
  const topicSummary = asRecord(params.topicSummary) ?? {};
  const targetDomain =
    params.targetDomain ??
    pickString(graphPacket, ["target_domain", "targetDomain"]) ??
    pickString(topicSummary, ["target_domain", "targetDomain"]);

  const bridgeDomains = params.transferBridges
    .map(parseBridgeDomain)
    .filter((domain): domain is string => Boolean(domain));

  const candidateDomains = uniqueDomains([
    ...asStringArray(graphPacket.candidate_domains ?? graphPacket.candidateDomains),
    ...asStringArray(topicSummary.candidate_domains ?? topicSummary.candidateDomains),
    ...bridgeDomains,
  ]).filter((domain) => domain !== targetDomain);

  const domainDistanceMatrix =
    (asRecord(graphPacket.domain_distance_matrix) ??
      asRecord(graphPacket.domainDistanceMatrix) ??
      asRecord(topicSummary.domain_distance_matrix) ??
      asRecord(topicSummary.domainDistanceMatrix) ??
      null);

  const bridgeNodes = normalizeBridgeNodes({
    graphPacket,
    transferBridges: params.transferBridges,
    challengeClusters: params.challengeClusters,
  });

  const mechanismMatches = uniqueStrings(params.challengeClusters).map((challenge, index) => ({
    mechanism: challenge,
    via_node_id: bridgeNodes[index]?.node_id ?? null,
    matched_domains: uniqueStrings(
      bridgeNodes
        .filter((entry) => entry.mechanism === challenge || entry.node_name === challenge)
        .map((entry) => entry.domain)
        .filter((domain): domain is string => Boolean(domain))
    ),
  }));

  const candidateDomainEntries = candidateDomains.map((domain, index) => {
    const normalizedDomain = domain.toLowerCase();
    const domainBridgeNodes = bridgeNodes.filter(
      (entry) => String(entry.domain ?? "").trim().toLowerCase() === normalizedDomain
    );
    const takeaways = domainBridgeNodes.map((entry) =>
      buildStructuredTakeaway({
        nodeId: entry.node_id,
        concept: entry.node_name,
        mechanism: entry.mechanism,
        domain: entry.domain,
        challengeClusters: params.challengeClusters,
        properties: entry.properties ?? null,
      })
    );
    const evidenceCount = Math.max(domainBridgeNodes.length, takeaways.length);
    const relevanceRatio = Number(Math.min(1, evidenceCount / 2).toFixed(2));
    const bridgeQuality = Number(
      Math.min(
        1,
        domainBridgeNodes.reduce((sum, entry) => sum + Number(entry.score ?? 0), 0) /
          Math.max(1, domainBridgeNodes.length)
      ).toFixed(2)
    );
    const pruned = evidenceCount === 0;
    return {
      domain,
      domain_distance:
        scoreDomainDistanceFromMatrix(domainDistanceMatrix, targetDomain, domain) ??
        Number((0.55 + index * 0.05).toFixed(2)),
      selection_basis: domainBridgeNodes.length > 0 ? "shared_mechanisms" : "llm_fallback_candidate",
      rationale: domainBridgeNodes.length > 0
        ? `Derived from graph transfer bridge evidence for ${domain}.`
        : `Kept as a candidate domain because the graph basis packet still points to ${domain} as a plausible source domain.`,
      retrieved_nodes: domainBridgeNodes.map((entry) => entry.node_id),
      takeaways,
      relevance_ratio: relevanceRatio,
      bridge_quality: bridgeQuality,
      evidence_density: evidenceCount,
      pruned,
      prune_reason: pruned
        ? "No graph-backed bridge nodes or takeaways were found for this domain."
        : null,
      search_queries: buildDomainSearchQueries({
        domain,
        targetDomain,
        challengeClusters: params.challengeClusters,
      }),
    };
  });

  const selectedSourceDomains = candidateDomainEntries
    .filter((entry) => entry.pruned !== true)
    .sort((left, right) => {
      if (right.bridge_quality !== left.bridge_quality) {
        return right.bridge_quality - left.bridge_quality;
      }
      if (right.relevance_ratio !== left.relevance_ratio) {
        return right.relevance_ratio - left.relevance_ratio;
      }
      return right.evidence_density - left.evidence_density;
    })
    .map((entry) => entry.domain);
  const prunedDomains = candidateDomainEntries
    .filter((entry) => entry.pruned === true)
    .map((entry) => entry.domain);
  const bridgeEvidenceTier =
    bridgeNodes.length >= 2 && selectedSourceDomains.length >= 2
      ? "strong"
      : bridgeNodes.length >= 1 && selectedSourceDomains.length >= 1
        ? "moderate"
        : "weak";
  const crossDomainSearches = candidateDomainEntries.map((entry) => ({
    domain: entry.domain,
    domain_rationale: entry.rationale,
    queries: entry.search_queries.map((queryEntry) => queryEntry.query),
  }));

  return {
    target_domain: targetDomain,
    challenge_clusters: uniqueStrings(params.challengeClusters),
    cross_domain_searches: crossDomainSearches,
    candidate_domains: candidateDomainEntries,
    selected_source_domains: selectedSourceDomains,
    pruned_domains: prunedDomains,
    bridge_nodes: bridgeNodes,
    bridge_evidence_tier: bridgeEvidenceTier,
    mechanism_matches: mechanismMatches,
    source_domain_count: selectedSourceDomains.length,
    evidence_summary: {
      total_bridge_nodes: bridgeNodes.length,
      total_candidate_domains: candidateDomainEntries.length,
      fallback_required: bridgeNodes.length === 0,
    },
    mode: "graph-first-llm-fallback",
  };
}
