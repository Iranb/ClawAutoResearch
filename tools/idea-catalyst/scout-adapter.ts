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

function buildDomainSearchQueries(params: {
  domain: string;
  targetDomain: string | null;
  challengeClusters: string[];
}): Array<{ domain: string; query: string; rationale: string }> {
  const challengeTerms = uniqueStrings(params.challengeClusters).slice(0, 3);
  if (challengeTerms.length === 0) {
    return [
      {
        domain: params.domain,
        query: `${params.domain} transferable principle for ${params.targetDomain ?? "target-domain"} innovation`,
        rationale:
          "Fallback cross-domain scouting query when no explicit challenge cluster is available.",
      },
    ];
  }
  return challengeTerms.map((challenge) => ({
    domain: params.domain,
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

  const bridgeNodes = params.transferBridges.map((entry, index) => {
    const [domain, ...rest] = String(entry || "").split(":");
    const mechanism = rest.join(":").trim() || String(entry || "").trim();
    return {
      node_id: `bridge-${index + 1}`,
      node_name: mechanism,
      domain: domain?.trim() || null,
      mechanism,
      score: 0.75,
      source: "graph_transfer_bridge",
    };
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
    const takeaways = domainBridgeNodes.map((entry) => ({
      concept: entry.node_name,
      mechanism: entry.mechanism,
      kg_node_id: entry.node_id,
    }));
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
      domain_distance: Number((0.55 + index * 0.05).toFixed(2)),
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

  return {
    target_domain: targetDomain,
    challenge_clusters: uniqueStrings(params.challengeClusters),
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
