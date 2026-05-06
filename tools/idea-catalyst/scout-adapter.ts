import {
  asRecord,
  asString,
  asStringArray,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";

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
  const distances = asRecord(matrix.distances) ?? matrix;
  const targetRow = asRecord(distances[targetKey] ?? distances[targetDomain ?? ""]);
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

function recordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function objectList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringListFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const values = asStringArray(record[key]);
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

function normalizeScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4));
}

function collectBridgePathIds(record: Record<string, unknown>) {
  return uniqueStrings([
    pickString(record, ["bridge_path_id", "bridgePathId", "path_id", "pathId"]) ??
      "",
    ...stringListFromRecord(record, [
      "bridge_path_ids",
      "bridgePathIds",
      "supporting_bridge_paths",
      "supportingBridgePaths",
      "retrieved_nodes",
      "retrievedNodes",
    ]),
  ]);
}

function collectSourceSpans(
  record: Record<string, unknown>,
  fallback?: {
    id: string;
    paperTitle?: string | null;
    evidenceText?: string | null;
  }
) {
  const spans = [
    ...objectList(record.source_spans ?? record.sourceSpans),
    ...objectList(record.evidence_spans ?? record.evidenceSpans),
  ];
  if (spans.length > 0) {
    return spans;
  }
  const evidenceText =
    fallback?.evidenceText ??
    pickString(record, ["evidenceText", "evidence_text", "abstract", "text"]);
  if (!evidenceText) {
    return [];
  }
  return [
    {
      span_id: `${fallback?.id ?? "scout"}-evidence-text`,
      source_type: "evidence_snippet",
      paper_title: fallback?.paperTitle ?? null,
      evidence_text: evidenceText,
      source_span_available: false,
      explicit_or_inferred: "inferred_from_bridge_evidence_text",
    },
  ];
}

function collectEvidenceRefs(record: Record<string, unknown>) {
  return [
    ...objectList(record.evidence_refs ?? record.evidenceRefs),
    ...objectList(record.evidence_chain_refs ?? record.evidenceChainRefs),
    ...objectList(record.supporting_evidence_refs ?? record.supportingEvidenceRefs),
  ];
}

function collectPathTrace(record: Record<string, unknown>) {
  return [
    ...objectList(record.path_trace ?? record.pathTrace),
    ...objectList(record.path),
  ];
}

function resolveEvidenceTier(params: {
  bridgePathIds: string[];
  sourceSpans: unknown[];
  pathCompleteness: number;
  evidenceDensity: number;
}) {
  if (
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0 &&
    params.pathCompleteness >= 0.75 &&
    params.evidenceDensity > 0
  ) {
    return "strong";
  }
  if (
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0 &&
    params.pathCompleteness >= 0.5
  ) {
    return "moderate";
  }
  return "weak";
}

function resolveClaimCap(params: {
  evidenceTier: string;
  bridgePathIds: string[];
  sourceSpans: unknown[];
  pathCompleteness: number;
}) {
  if (
    params.evidenceTier === "strong" &&
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0 &&
    params.pathCompleteness >= 0.75
  ) {
    return "confirmatory";
  }
  if (
    params.evidenceTier !== "weak" &&
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0
  ) {
    return "exploratory";
  }
  return "hypothesis";
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
  const sourceSpans = collectSourceSpans(properties, {
    id: params.nodeId,
    paperTitle: supportingPapers[0] ?? null,
    evidenceText:
      pickString(properties, ["evidenceText", "evidence_text", "abstract", "text"]) ??
      null,
  });
  const bridgePathIds = collectBridgePathIds(properties);
  const pathCompleteness = normalizeScore(
    pickNumber(properties, ["path_completeness", "pathCompleteness"])
  );
  const evidenceDensity = Math.max(
    normalizeScore(pickNumber(properties, ["evidence_density", "evidenceDensity"])),
    sourceSpans.length > 0 ? 0.5 : 0
  );
  const mechanismSupportDensity = Math.max(
    normalizeScore(
      pickNumber(properties, [
        "mechanism_support_density",
        "mechanismSupportDensity",
      ])
    ),
    params.mechanism ? 0.5 : 0
  );
  const evidenceTier = resolveEvidenceTier({
    bridgePathIds,
    sourceSpans,
    pathCompleteness,
    evidenceDensity,
  });
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
    source_spans: sourceSpans,
    evidence_chain_refs: collectEvidenceRefs(properties),
    bridge_path_ids: bridgePathIds,
    path_trace: collectPathTrace(properties),
    path_completeness: pathCompleteness,
    evidence_density: evidenceDensity,
    mechanism_support_density: mechanismSupportDensity,
    evidence_tier: evidenceTier,
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
  const bridgeRetrieval =
    asRecord(params.graphPacket.bridge_retrieval ?? params.graphPacket.bridgeRetrieval) ??
    {};
  const bridgePathNodes = recordList(
    bridgeRetrieval.candidate_bridge_paths ?? bridgeRetrieval.candidateBridgePaths
  ).map((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain"]) ??
      asStringArray(entry.source_domains ?? entry.sourceDomains)[0] ??
      null;
    const mechanism =
      pickString(entry, [
        "candidate_node_name",
        "candidateNodeName",
        "mechanism",
      ]) ??
      stringListFromRecord(entry, ["matched_mechanisms", "matchedMechanisms"])[0] ??
      "cross-domain bridge path";
    return {
      node_id:
        pickString(entry, ["path_id", "pathId", "bridge_path_id", "bridgePathId"]) ??
        `bridge-path-${index + 1}`,
      node_name: mechanism,
      domain: sourceDomain,
      mechanism,
      score: Number(entry.combined_score ?? entry.combinedScore ?? 0.75),
      source: "paper_nexus_bridge_retrieval",
      properties: entry,
    };
  });
  if (explicitBridgeNodes.length > 0) {
    return [...explicitBridgeNodes, ...bridgePathNodes]
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
  if (bridgePathNodes.length > 0) {
    return bridgePathNodes;
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
  const sourceDomainAnalyses = recordList(
    graphPacket.source_domain_analyses ?? graphPacket.cross_domain_analysis
  );
  const sourceAnalysesByDomain = new Map(
    sourceDomainAnalyses
      .map((entry) => {
        const domain = pickString(entry, [
          "source_domain",
          "sourceDomain",
          "domain",
        ]);
        return domain ? [normalizeDomainKey(domain), entry] as const : null;
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] =>
        Boolean(entry)
      )
  );
  const bridgeRetrieval =
    asRecord(graphPacket.bridge_retrieval ?? graphPacket.bridgeRetrieval) ?? {};
  const bridgePathDomains = recordList(
    bridgeRetrieval.candidate_bridge_paths ?? bridgeRetrieval.candidateBridgePaths
  )
    .map(
      (entry) =>
        pickString(entry, ["source_domain", "sourceDomain"]) ??
        asStringArray(entry.source_domains ?? entry.sourceDomains)[0]
    )
    .filter((domain): domain is string => Boolean(domain));
  const ideaFragmentDomains = recordList(graphPacket.idea_fragments ?? graphPacket.ideaFragments)
    .map((entry) => pickString(entry, ["source_domain", "sourceDomain"]))
    .filter((domain): domain is string => Boolean(domain));

  const candidateDomains = uniqueDomains([
    ...asStringArray(graphPacket.candidate_domains ?? graphPacket.candidateDomains),
    ...asStringArray(topicSummary.candidate_domains ?? topicSummary.candidateDomains),
    ...bridgeDomains,
    ...sourceDomainAnalyses
      .map((entry) =>
        pickString(entry, ["source_domain", "sourceDomain", "domain"])
      )
      .filter((domain): domain is string => Boolean(domain)),
    ...bridgePathDomains,
    ...ideaFragmentDomains,
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
    const sourceAnalysis = sourceAnalysesByDomain.get(normalizeDomainKey(domain)) ?? null;
    const domainBridgeNodes = bridgeNodes.filter(
      (entry) => String(entry.domain ?? "").trim().toLowerCase() === normalizedDomain
    );
    const upstreamTakeaways = recordList(sourceAnalysis?.takeaways).map(
      (takeaway, takeawayIndex) => {
        const mechanism =
          pickString(takeaway, ["mechanism", "concept"]) ??
          stringListFromRecord(sourceAnalysis ?? {}, [
            "shared_mechanisms",
            "sharedMechanisms",
          ])[0] ??
          "cross-domain mechanism";
        const nodeId =
          pickString(takeaway, ["kg_node_id", "kgNodeId", "node_id", "nodeId"]) ??
          `${domain}-takeaway-${takeawayIndex + 1}`;
        const sourceSpans = [
          ...collectSourceSpans(takeaway, { id: nodeId }),
          ...collectSourceSpans(sourceAnalysis ?? {}, { id: `${domain}-analysis` }),
        ];
        const bridgePathIds = uniqueStrings([
          ...collectBridgePathIds(takeaway),
          ...collectBridgePathIds(sourceAnalysis ?? {}),
        ]);
        const pathCompleteness = Math.max(
          normalizeScore(
            pickNumber(takeaway, ["path_completeness", "pathCompleteness"])
          ),
          normalizeScore(
            pickNumber(sourceAnalysis ?? {}, [
              "path_completeness",
              "pathCompleteness",
            ])
          )
        );
        const evidenceDensity = Math.max(
          normalizeScore(
            pickNumber(takeaway, ["evidence_density", "evidenceDensity"])
          ),
          normalizeScore(
            pickNumber(sourceAnalysis ?? {}, [
              "evidence_density",
              "evidenceDensity",
            ])
          ),
          sourceSpans.length > 0 ? 0.5 : 0
        );
        const mechanismSupportDensity = Math.max(
          normalizeScore(
            pickNumber(takeaway, [
              "mechanism_support_density",
              "mechanismSupportDensity",
            ])
          ),
          normalizeScore(
            pickNumber(sourceAnalysis ?? {}, [
              "mechanism_support_density",
              "mechanismSupportDensity",
            ])
          ),
          mechanism ? 0.5 : 0
        );
        const evidenceTier =
          pickString(takeaway, ["evidence_tier", "evidenceTier"]) ??
          pickString(sourceAnalysis ?? {}, ["evidence_tier", "evidenceTier"]) ??
          resolveEvidenceTier({
            bridgePathIds,
            sourceSpans,
            pathCompleteness,
            evidenceDensity,
          });
        return {
          takeaway_id:
            pickString(takeaway, ["takeaway_id", "takeawayId"]) ??
            `${nodeId}-takeaway`,
          concept: pickString(takeaway, ["concept"]) ?? mechanism,
          mechanism,
          kg_node_id: nodeId,
          source_domain_formulation:
            pickString(takeaway, [
              "source_domain_formulation",
              "sourceDomainFormulation",
              "text",
            ]) ?? `${domain} frames ${mechanism} as a transferable mechanism.`,
          mechanism_explanation:
            pickString(takeaway, [
              "mechanism_explanation",
              "mechanismExplanation",
              "description",
            ]) ?? `${mechanism} can be translated into the target challenge.`,
          relevance_to_challenge:
            pickString(takeaway, [
              "relevance_to_challenge",
              "relevanceToChallenge",
            ]) ??
            chooseRelevantChallenge({
              mechanism,
              concept: pickString(takeaway, ["concept"]) ?? mechanism,
              challengeClusters: params.challengeClusters,
            }),
          selection_rationale:
            pickString(takeaway, [
              "selection_rationale",
              "selectionRationale",
            ]) ??
            pickString(sourceAnalysis ?? {}, [
              "selection_rationale",
              "selectionRationale",
              "domain_rationale",
              "domainRationale",
            ]) ??
            `Selected from PaperNexus source-domain analysis for ${domain}.`,
          supporting_papers: uniqueStrings([
            ...stringListFromRecord(takeaway, [
              "supporting_papers",
              "supportingPapers",
            ]),
            ...stringListFromRecord(sourceAnalysis ?? {}, [
              "supporting_papers",
              "supportingPapers",
            ]),
          ]).slice(0, 5),
          source_spans: sourceSpans,
          evidence_chain_refs: uniqueStrings([]).length
            ? []
            : [...collectEvidenceRefs(takeaway), ...collectEvidenceRefs(sourceAnalysis ?? {})],
          bridge_path_ids: bridgePathIds,
          path_trace: [
            ...collectPathTrace(takeaway),
            ...collectPathTrace(sourceAnalysis ?? {}),
          ],
          path_completeness: pathCompleteness,
          evidence_density: evidenceDensity,
          mechanism_support_density: mechanismSupportDensity,
          evidence_tier: evidenceTier,
        };
      }
    );
    const takeaways = upstreamTakeaways.length > 0
      ? upstreamTakeaways
      : domainBridgeNodes.map((entry) =>
      buildStructuredTakeaway({
        nodeId: entry.node_id,
        concept: entry.node_name,
        mechanism: entry.mechanism,
        domain: entry.domain,
        challengeClusters: params.challengeClusters,
        properties: entry.properties ?? null,
      })
    );
    const bridgePathIds = uniqueStrings([
      ...collectBridgePathIds(sourceAnalysis ?? {}),
      ...takeaways.flatMap((entry) => asStringArray(entry.bridge_path_ids)),
      ...domainBridgeNodes.map((entry) => entry.node_id),
    ]);
    const sourceSpans = takeaways.flatMap((entry) => objectList(entry.source_spans));
    const evidenceChainRefs = [
      ...collectEvidenceRefs(sourceAnalysis ?? {}),
      ...takeaways.flatMap((entry) => objectList(entry.evidence_chain_refs)),
    ];
    const pathTrace = [
      ...collectPathTrace(sourceAnalysis ?? {}),
      ...takeaways.flatMap((entry) => objectList(entry.path_trace)),
    ];
    const pathCompleteness = Math.max(
      normalizeScore(
        pickNumber(sourceAnalysis ?? {}, ["path_completeness", "pathCompleteness"])
      ),
      ...takeaways.map((entry) => normalizeScore(entry.path_completeness)),
      domainBridgeNodes.length > 0 ? 0.5 : 0
    );
    const evidenceDensity = Math.max(
      normalizeScore(
        pickNumber(sourceAnalysis ?? {}, ["evidence_density", "evidenceDensity"])
      ),
      ...takeaways.map((entry) => normalizeScore(entry.evidence_density)),
      sourceSpans.length > 0 ? 0.5 : 0
    );
    const mechanismSupportDensity = Math.max(
      normalizeScore(
        pickNumber(sourceAnalysis ?? {}, [
          "mechanism_support_density",
          "mechanismSupportDensity",
        ])
      ),
      ...takeaways.map((entry) => normalizeScore(entry.mechanism_support_density)),
      takeaways.length > 0 ? 0.5 : 0
    );
    const evidenceTier =
      pickString(sourceAnalysis ?? {}, ["evidence_tier", "evidenceTier"]) ??
      resolveEvidenceTier({
        bridgePathIds,
        sourceSpans,
        pathCompleteness,
        evidenceDensity,
      });
    const claimCap = resolveClaimCap({
      evidenceTier,
      bridgePathIds,
      sourceSpans,
      pathCompleteness,
    });
    const evidenceCount = Math.max(
      domainBridgeNodes.length,
      takeaways.length,
      bridgePathIds.length,
      sourceSpans.length
    );
    const relevanceRatio = Number(
      Math.min(1, Math.max(evidenceCount / 2, sourceSpans.length / 2)).toFixed(2)
    );
    const bridgeQuality = Number(
      Math.min(
        1,
        Math.max(
          domainBridgeNodes.reduce((sum, entry) => sum + Number(entry.score ?? 0), 0) /
            Math.max(1, domainBridgeNodes.length),
          pathCompleteness,
          evidenceDensity,
          mechanismSupportDensity
        )
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
        : sourceAnalysis
          ? `Derived from PaperNexus source-domain analysis for ${domain}.`
          : `Kept as a candidate domain because the graph basis packet still points to ${domain} as a plausible source domain.`,
      retrieved_nodes: domainBridgeNodes.map((entry) => entry.node_id),
      takeaways,
      relevance_ratio: relevanceRatio,
      bridge_quality: bridgeQuality,
      bridge_path_ids: bridgePathIds,
      path_trace: pathTrace,
      evidence_chain_refs: evidenceChainRefs,
      source_spans: sourceSpans,
      source_span_count: sourceSpans.length,
      path_completeness: pathCompleteness,
      evidence_density: evidenceDensity,
      mechanism_support_density: mechanismSupportDensity,
      evidence_tier: evidenceTier,
      claim_cap: claimCap,
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
    domain_distance_matrix: domainDistanceMatrix,
    evidence_summary: {
      total_bridge_nodes: bridgeNodes.length,
      total_candidate_domains: candidateDomainEntries.length,
      source_span_count: candidateDomainEntries.reduce(
        (sum, entry) => sum + Number(entry.source_span_count ?? 0),
        0
      ),
      bridge_path_count: candidateDomainEntries.reduce(
        (sum, entry) => sum + asStringArray(entry.bridge_path_ids).length,
        0
      ),
      max_path_completeness: Math.max(
        ...candidateDomainEntries.map((entry) =>
          Number(entry.path_completeness ?? 0)
        ),
        0
      ),
      max_evidence_density: Math.max(
        ...candidateDomainEntries.map((entry) => Number(entry.evidence_density ?? 0)),
        0
      ),
      max_mechanism_support_density: Math.max(
        ...candidateDomainEntries.map((entry) =>
          Number(entry.mechanism_support_density ?? 0)
        ),
        0
      ),
      fallback_required: bridgeNodes.length === 0,
    },
    mode: "graph-first-llm-fallback",
  };
}
