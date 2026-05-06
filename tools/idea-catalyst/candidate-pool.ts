import {
  asRecord,
  asString,
  asStringArray,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";

export type IdeaCatalystCandidate = {
  candidate_id: string;
  parent_candidate_id: string | null;
  generation_round: number;
  source_domain: string;
  frontier_type: string;
  transferred_mechanism: string;
  idea_fragment: Record<string, unknown>;
  evidence_chain_refs: unknown[];
  source_spans: unknown[];
  bridge_path_ids: string[];
  path_trace: unknown[];
  path_completeness: number;
  domain_distance: number;
  baseline_to_compare: string | null;
  primary_metric: string | null;
  falsifier_pilot: string | null;
  weakest_assumption: string | null;
  claim_cap: "hypothesis" | "exploratory" | "confirmatory";
  evidence_tier: "weak" | "moderate" | "strong";
  evidence_density: number;
  mechanism_support_density: number;
  supporting_papers: string[];
  source_path: string;
};

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
    const direct = asStringArray(record[key]);
    if (direct.length > 0) {
      return direct;
    }
  }
  return [];
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4));
}

function normalizePositiveScore(value: unknown, fallback: number) {
  const normalized = normalizeScore(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeDomainKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function readDomainDistance(params: {
  matrix: Record<string, unknown> | null;
  targetDomain: string | null;
  sourceDomain: string;
  fallback: unknown;
}) {
  const direct = normalizeScore(params.fallback);
  const matrix = params.matrix;
  if (!matrix) {
    return direct;
  }
  const distances = asRecord(matrix.distances) ?? matrix;
  const targetKey = normalizeDomainKey(params.targetDomain);
  const sourceKey = normalizeDomainKey(params.sourceDomain);
  const targetRow =
    asRecord(distances[targetKey]) ??
    asRecord(distances[params.targetDomain ?? ""]);
  const raw =
    targetRow?.[sourceKey] ??
    targetRow?.[params.sourceDomain] ??
    asRecord(targetRow?.[sourceKey])?.score ??
    asRecord(targetRow?.[params.sourceDomain])?.score;
  const normalized = normalizeScore(raw);
  return normalized > 0 ? normalized : direct;
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

function collectEvidenceRefs(record: Record<string, unknown>) {
  return [
    ...objectList(record.evidence_refs ?? record.evidenceRefs),
    ...objectList(record.evidence_chain_refs ?? record.evidenceChainRefs),
    ...objectList(record.supporting_evidence_refs ?? record.supportingEvidenceRefs),
  ];
}

function collectSourceSpans(record: Record<string, unknown>) {
  return [
    ...objectList(record.source_spans ?? record.sourceSpans),
    ...objectList(record.evidence_spans ?? record.evidenceSpans),
  ];
}

function collectPathTrace(record: Record<string, unknown>) {
  return [
    ...objectList(record.path_trace ?? record.pathTrace),
    ...objectList(record.path),
  ];
}

function firstNonEmpty(values: Array<string | null | undefined>, fallback: string) {
  return values.find((entry) => typeof entry === "string" && entry.trim()) ?? fallback;
}

function pickMechanism(
  record: Record<string, unknown>,
  sourceAnalysis?: Record<string, unknown> | null
) {
  const ideaFragment = asRecord(record.idea_fragment) ?? {};
  return firstNonEmpty(
    [
      pickString(record, [
        "transferred_mechanism",
        "transferredMechanism",
        "integration_mechanism",
        "integrationMechanism",
        "mechanism",
        "candidate_node_name",
        "candidateNodeName",
      ]),
      pickString(ideaFragment, [
        "transferred_mechanism",
        "transferredMechanism",
        "integration_mechanism",
        "integrationMechanism",
      ]),
      stringListFromRecord(record, ["matched_mechanisms", "matchedMechanisms"])[0],
      stringListFromRecord(sourceAnalysis ?? {}, [
        "shared_mechanisms",
        "sharedMechanisms",
      ])[0],
    ],
    "transferable mechanism"
  );
}

function buildFalsifierPilot(params: {
  mechanism: string;
  targetDomain: string;
  metric: string | null;
  baseline: string | null;
}) {
  const metric = params.metric ?? "primary metric";
  const baseline = params.baseline ?? "the baseline";
  return `Run a bounded pilot that ablates ${params.mechanism} and requires ${metric} to improve over ${baseline} without degrading evidence safety.`;
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
    return "strong" as const;
  }
  if (
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0 &&
    params.pathCompleteness >= 0.5
  ) {
    return "moderate" as const;
  }
  return "weak" as const;
}

function resolveClaimCap(params: {
  evidenceTier: "weak" | "moderate" | "strong";
  bridgePathIds: string[];
  sourceSpans: unknown[];
  pathCompleteness: number;
  baseline: string | null;
  metric: string | null;
}) {
  if (
    params.evidenceTier === "strong" &&
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0 &&
    params.pathCompleteness >= 0.75 &&
    params.baseline &&
    params.metric
  ) {
    return "confirmatory" as const;
  }
  if (
    params.evidenceTier !== "weak" &&
    params.bridgePathIds.length > 0 &&
    params.sourceSpans.length > 0
  ) {
    return "exploratory" as const;
  }
  return "hypothesis" as const;
}

function makeCandidate(params: {
  candidateId: string;
  parentCandidateId?: string | null;
  generationRound?: number;
  sourceDomain: string;
  frontierType: string;
  mechanism: string;
  ideaFragment: Record<string, unknown>;
  sourceRecord: Record<string, unknown>;
  sourceAnalysis?: Record<string, unknown> | null;
  targetDomain: string;
  baseline: string | null;
  metric: string | null;
  domainDistanceMatrix: Record<string, unknown> | null;
  sourcePath: string;
}) {
  const bridgePathIds = uniqueStrings([
    ...collectBridgePathIds(params.sourceRecord),
    ...collectBridgePathIds(params.sourceAnalysis ?? {}),
  ]);
  const evidenceChainRefs = [
    ...collectEvidenceRefs(params.sourceRecord),
    ...collectEvidenceRefs(params.sourceAnalysis ?? {}),
  ];
  const sourceSpans = [
    ...collectSourceSpans(params.sourceRecord),
    ...collectSourceSpans(params.sourceAnalysis ?? {}),
  ];
  const pathTrace = [
    ...collectPathTrace(params.sourceRecord),
    ...collectPathTrace(params.sourceAnalysis ?? {}),
  ];
  const pathCompleteness = Math.max(
    normalizeScore(
      pickNumber(params.sourceRecord, ["path_completeness", "pathCompleteness"])
    ),
    normalizeScore(
      pickNumber(params.sourceRecord, ["story_completeness", "storyCompleteness"])
    ),
    normalizeScore(
      pickNumber(params.sourceAnalysis ?? {}, [
        "path_completeness",
        "pathCompleteness",
      ])
    )
  );
  const evidenceDensity = Math.max(
    normalizePositiveScore(
      pickNumber(params.sourceRecord, ["evidence_density", "evidenceDensity"]),
      sourceSpans.length > 0 ? 0.5 : 0
    ),
    normalizePositiveScore(
      pickNumber(params.sourceAnalysis ?? {}, [
        "evidence_density",
        "evidenceDensity",
      ]),
      sourceSpans.length > 0 ? 0.5 : 0
    )
  );
  const mechanismSupportDensity = Math.max(
    normalizePositiveScore(
      pickNumber(params.sourceRecord, [
        "mechanism_support_density",
        "mechanismSupportDensity",
      ]),
      params.mechanism ? 0.5 : 0
    ),
    normalizePositiveScore(
      pickNumber(params.sourceAnalysis ?? {}, [
        "mechanism_support_density",
        "mechanismSupportDensity",
      ]),
      params.mechanism ? 0.5 : 0
    )
  );
  const explicitTier = pickString(params.sourceRecord, [
    "evidence_tier",
    "evidenceTier",
  ]);
  const evidenceTier =
    explicitTier === "strong" || explicitTier === "moderate" || explicitTier === "weak"
      ? explicitTier
      : resolveEvidenceTier({
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
    baseline: params.baseline,
    metric: params.metric,
  });
  const supportingPapers = uniqueStrings([
    ...stringListFromRecord(params.sourceRecord, [
      "supporting_papers",
      "supportingPapers",
    ]),
    ...stringListFromRecord(params.sourceAnalysis ?? {}, [
      "supporting_papers",
      "supportingPapers",
    ]),
  ]);

  return {
    candidate_id: params.candidateId,
    parent_candidate_id: params.parentCandidateId ?? null,
    generation_round: params.generationRound ?? 1,
    source_domain: params.sourceDomain,
    frontier_type: params.frontierType,
    transferred_mechanism: params.mechanism,
    idea_fragment: params.ideaFragment,
    evidence_chain_refs: evidenceChainRefs,
    source_spans: sourceSpans,
    bridge_path_ids: bridgePathIds,
    path_trace: pathTrace,
    path_completeness: pathCompleteness,
    domain_distance: readDomainDistance({
      matrix: params.domainDistanceMatrix,
      targetDomain: params.targetDomain,
      sourceDomain: params.sourceDomain,
      fallback:
        pickNumber(params.sourceRecord, ["domain_distance", "domainDistance"]) ??
        pickNumber(params.sourceAnalysis ?? {}, ["domain_distance", "domainDistance"]) ??
        0,
    }),
    baseline_to_compare: params.baseline,
    primary_metric: params.metric,
    falsifier_pilot:
      pickString(params.sourceRecord, ["falsifier_pilot", "falsifierPilot"]) ??
      buildFalsifierPilot({
        mechanism: params.mechanism,
        targetDomain: params.targetDomain,
        metric: params.metric,
        baseline: params.baseline,
      }),
    weakest_assumption:
      pickString(params.sourceRecord, [
        "weakest_assumption",
        "weakestAssumption",
      ]) ??
      `The ${params.mechanism} mechanism remains transferable from ${params.sourceDomain} to ${params.targetDomain}.`,
    claim_cap: claimCap,
    evidence_tier: evidenceTier,
    evidence_density: evidenceDensity,
    mechanism_support_density: mechanismSupportDensity,
    supporting_papers: supportingPapers,
    source_path: params.sourcePath,
  } satisfies IdeaCatalystCandidate;
}

function sourceAnalysesByDomain(bundle: Record<string, unknown>) {
  const analyses = recordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const byDomain = new Map<string, Record<string, unknown>>();
  for (const analysis of analyses) {
    const domain = pickString(analysis, [
      "source_domain",
      "sourceDomain",
      "domain",
    ]);
    if (domain) {
      byDomain.set(normalizeDomainKey(domain), analysis);
    }
  }
  return byDomain;
}

function scoutingDomainsByDomain(scoutingReport: Record<string, unknown>) {
  const domains = recordList(scoutingReport.candidate_domains);
  const byDomain = new Map<string, Record<string, unknown>>();
  for (const entry of domains) {
    const domain = pickString(entry, ["source_domain", "sourceDomain", "domain"]);
    if (domain) {
      byDomain.set(normalizeDomainKey(domain), entry);
    }
  }
  return byDomain;
}

function buildIdeaFragmentRecord(params: {
  title: string;
  coreInsight: string;
  mechanism: string;
  targetDomain: string;
  sourceDomain: string;
}) {
  return {
    title: params.title,
    core_insight: params.coreInsight,
    integration_mechanism: params.mechanism,
    challenge_resolution: `Use ${params.mechanism} from ${params.sourceDomain} to address ${params.targetDomain} challenge evidence.`,
    concrete_realization: `Operationalize ${params.mechanism} as a bounded ${params.targetDomain} pilot.`,
  };
}

function dedupeCandidates(candidates: IdeaCatalystCandidate[]) {
  const seen = new Set<string>();
  const result: IdeaCatalystCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.source_domain,
      candidate.transferred_mechanism,
      candidate.frontier_type,
      candidate.bridge_path_ids.join("|"),
      String(candidate.idea_fragment.title ?? ""),
    ]
      .join("::")
      .toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function ensureUniqueCandidateIds(candidates: IdeaCatalystCandidate[]) {
  const counts = new Map<string, number>();
  return candidates.map((candidate) => {
    const baseId = candidate.candidate_id || "ic-cand";
    const count = counts.get(baseId) ?? 0;
    counts.set(baseId, count + 1);
    if (count === 0) {
      return candidate;
    }
    return {
      ...candidate,
      candidate_id: `${baseId}-${count + 1}`,
    };
  });
}

function ensureMinimumCandidateVariants(
  candidates: IdeaCatalystCandidate[],
  dataStarvation: boolean
) {
  const result = [...candidates];
  const frontierTypes = ["transfer", "composition", "limitation", "contradiction"];
  let cursor = 0;
  while (!dataStarvation && result.length > 0 && result.length < 3) {
    const parent = result[cursor % result.length];
    if (!parent) {
      break;
    }
    const frontierType = frontierTypes[(cursor + result.length) % frontierTypes.length] ?? "transfer";
    result.push({
      ...parent,
      candidate_id: `${parent.candidate_id}-variant-${result.length + 1}`,
      parent_candidate_id: parent.candidate_id,
      generation_round: parent.generation_round + 1,
      frontier_type: frontierType,
      idea_fragment: {
        ...parent.idea_fragment,
        title: `${String(parent.idea_fragment.title ?? parent.candidate_id)} (${frontierType} variant)`,
      },
      source_path: `${parent.source_path}:variant`,
    });
    cursor += 1;
  }
  return result;
}

export function buildIdeaCatalystCandidatePool(params: {
  graphPacket: Record<string, unknown> | null;
  candidatePool: Record<string, unknown> | null;
  scoutingReport: Record<string, unknown> | null;
  targetDomain: string;
  selectedTrackId: string | null;
  baselineReference: string | null;
  primaryMetric: string | null;
}) {
  const bundle = asRecord(params.graphPacket) ?? {};
  const scoutingReport = asRecord(params.scoutingReport) ?? {};
  const sourceAnalyses = sourceAnalysesByDomain(bundle);
  const scoutingDomains = scoutingDomainsByDomain(scoutingReport);
  const bridgeRetrieval = asRecord(bundle.bridge_retrieval ?? bundle.bridgeRetrieval) ?? {};
  const structuralAnalogy = asRecord(bundle.structural_analogy ?? bundle.structuralAnalogy) ?? {};
  const ranking =
    asRecord(
      bundle.interdisciplinary_potential_ranking ??
        bundle.interdisciplinaryPotentialRanking
    ) ?? {};
  const domainDistanceMatrix =
    asRecord(bundle.domain_distance_matrix ?? bundle.domainDistanceMatrix) ??
    asRecord(scoutingReport.domain_distance_matrix ?? scoutingReport.domainDistanceMatrix) ??
    null;
  const dataStarvation =
    pickString(bundle, ["status"]) === "DATA_STARVATION" ||
    pickString(asRecord(bundle.requisition_report) ?? {}, ["status"]) ===
      "DATA_STARVATION";
  const candidates: IdeaCatalystCandidate[] = [];

  recordList(bundle.idea_fragments).forEach((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain"]) ?? "external";
    const sourceAnalysis = sourceAnalyses.get(normalizeDomainKey(sourceDomain)) ?? null;
    const mechanism = pickMechanism(entry, sourceAnalysis);
    const ideaFragment = asRecord(entry.idea_fragment) ??
      buildIdeaFragmentRecord({
        title:
          pickString(entry, ["title"]) ??
          `${sourceDomain} candidate ${index + 1}`,
        coreInsight:
          pickString(entry, ["core_insight", "coreInsight"]) ??
          pickString(entry, ["challenge_resolution", "challengeResolution"]) ??
          "PaperNexus graph-backed idea fragment.",
        mechanism,
        targetDomain: params.targetDomain,
        sourceDomain,
      });
    candidates.push(
      makeCandidate({
        candidateId:
          pickString(entry, ["candidate_id", "candidateId", "fragment_id", "fragmentId"]) ??
          `ic-cand-fragment-${index + 1}`,
        sourceDomain,
        frontierType: pickString(entry, ["frontier_type", "frontierType"]) ?? "transfer",
        mechanism,
        ideaFragment,
        sourceRecord: entry,
        sourceAnalysis,
        targetDomain: params.targetDomain,
        baseline: params.baselineReference,
        metric: params.primaryMetric,
        domainDistanceMatrix,
        sourcePath: `idea_fragments[${index}]`,
      })
    );
  });

  recordList(bridgeRetrieval.candidate_bridge_paths ?? bridgeRetrieval.candidateBridgePaths)
    .forEach((entry, index) => {
      const sourceDomain =
        pickString(entry, ["source_domain", "sourceDomain"]) ??
        asStringArray(entry.source_domains ?? entry.sourceDomains)[0] ??
        "external";
      const sourceAnalysis =
        sourceAnalyses.get(normalizeDomainKey(sourceDomain)) ?? null;
      const mechanism = pickMechanism(entry, sourceAnalysis);
      candidates.push(
        makeCandidate({
          candidateId:
            pickString(entry, ["candidate_id", "candidateId", "path_id", "pathId"]) ??
            `ic-cand-path-${index + 1}`,
          sourceDomain,
          frontierType: "bridge_path",
          mechanism,
          ideaFragment: buildIdeaFragmentRecord({
            title:
              pickString(entry, ["candidate_node_name", "candidateNodeName"]) ??
              `${sourceDomain} bridge path ${index + 1}`,
            coreInsight:
              stringListFromRecord(entry, ["matched_challenges", "matchedChallenges"])[0] ??
              `${sourceDomain} bridge path connects graph evidence to the target challenge.`,
            mechanism,
            targetDomain: params.targetDomain,
            sourceDomain,
          }),
          sourceRecord: entry,
          sourceAnalysis,
          targetDomain: params.targetDomain,
          baseline: params.baselineReference,
          metric: params.primaryMetric,
          domainDistanceMatrix,
          sourcePath: `bridge_retrieval.candidate_bridge_paths[${index}]`,
        })
      );
    });

  recordList(structuralAnalogy.alignments).forEach((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain"]) ?? "external";
    const sourceAnalysis =
      sourceAnalyses.get(normalizeDomainKey(sourceDomain)) ?? null;
    const mechanism = pickMechanism(entry, sourceAnalysis);
    candidates.push(
      makeCandidate({
        candidateId:
          pickString(entry, ["candidate_id", "candidateId", "bridge_path_id", "bridgePathId"]) ??
          `ic-cand-analogy-${index + 1}`,
        sourceDomain,
        frontierType: "structural_analogy",
        mechanism,
        ideaFragment: buildIdeaFragmentRecord({
          title:
            pickString(entry, ["candidate_node_name", "candidateNodeName"]) ??
            `${sourceDomain} structural analogy ${index + 1}`,
          coreInsight:
            pickString(entry, ["alignment_rationale", "alignmentRationale"]) ??
            `${sourceDomain} provides a structurally aligned transferable mechanism.`,
          mechanism,
          targetDomain: params.targetDomain,
          sourceDomain,
        }),
        sourceRecord: entry,
        sourceAnalysis,
        targetDomain: params.targetDomain,
        baseline: params.baselineReference,
        metric: params.primaryMetric,
        domainDistanceMatrix,
        sourcePath: `structural_analogy.alignments[${index}]`,
      })
    );
  });

  recordList(ranking.ranked_candidates ?? ranking.rankedCandidates).forEach((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain"]) ?? "external";
    const sourceAnalysis =
      sourceAnalyses.get(normalizeDomainKey(sourceDomain)) ?? null;
    const mechanism = pickMechanism(entry, sourceAnalysis);
    candidates.push(
      makeCandidate({
        candidateId:
          pickString(entry, ["candidate_id", "candidateId", "bridge_path_id", "bridgePathId"]) ??
          `ic-cand-ranking-${index + 1}`,
        sourceDomain,
        frontierType: "interdisciplinary_ranking",
        mechanism,
        ideaFragment: buildIdeaFragmentRecord({
          title:
            pickString(entry, ["candidate_node_name", "candidateNodeName"]) ??
            `${sourceDomain} ranked mechanism ${index + 1}`,
          coreInsight:
            pickString(entry, ["rationale"]) ??
            `${sourceDomain} ranks highly under PaperNexus interdisciplinary potential.`,
          mechanism,
          targetDomain: params.targetDomain,
          sourceDomain,
        }),
        sourceRecord: entry,
        sourceAnalysis,
        targetDomain: params.targetDomain,
        baseline: params.baselineReference,
        metric: params.primaryMetric,
        domainDistanceMatrix,
        sourcePath: `interdisciplinary_potential_ranking.ranked_candidates[${index}]`,
      })
    );
  });

  recordList(bundle.source_domain_analyses ?? bundle.cross_domain_analysis).forEach(
    (entry, index) => {
      const sourceDomain =
        pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
      const takeaways = recordList(entry.takeaways);
      const mechanism =
        stringListFromRecord(entry, ["shared_mechanisms", "sharedMechanisms"])[0] ??
        pickString(takeaways[0] ?? {}, ["mechanism", "concept"]) ??
        "transferable mechanism";
      candidates.push(
        makeCandidate({
          candidateId:
            pickString(entry, ["candidate_id", "candidateId"]) ??
            `ic-cand-domain-${index + 1}`,
          sourceDomain,
          frontierType: "source_domain_takeaway",
          mechanism,
          ideaFragment: buildIdeaFragmentRecord({
            title: `${sourceDomain} source-domain takeaway ${index + 1}`,
            coreInsight:
              pickString(takeaways[0] ?? {}, [
                "source_domain_formulation",
                "sourceDomainFormulation",
                "mechanism_explanation",
                "mechanismExplanation",
              ]) ??
              pickString(entry, ["selection_rationale", "selectionRationale"]) ??
              `${sourceDomain} contributes a transferable source-domain mechanism.`,
            mechanism,
            targetDomain: params.targetDomain,
            sourceDomain,
          }),
          sourceRecord: entry,
          sourceAnalysis: entry,
          targetDomain: params.targetDomain,
          baseline: params.baselineReference,
          metric: params.primaryMetric,
          domainDistanceMatrix,
          sourcePath: `source_domain_analyses[${index}]`,
        })
      );
    }
  );

  recordList(scoutingReport.candidate_domains).forEach((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
    const sourceAnalysis =
      sourceAnalyses.get(normalizeDomainKey(sourceDomain)) ??
      scoutingDomains.get(normalizeDomainKey(sourceDomain)) ??
      null;
    const takeaways = recordList(entry.takeaways);
    const mechanism =
      pickString(takeaways[0] ?? {}, ["mechanism", "concept"]) ??
      stringListFromRecord(entry, ["shared_mechanisms", "sharedMechanisms"])[0] ??
      "transferable mechanism";
    candidates.push(
      makeCandidate({
        candidateId:
          pickString(entry, ["candidate_id", "candidateId"]) ??
          `ic-cand-scout-${index + 1}`,
        sourceDomain,
        frontierType: "scouting_takeaway",
        mechanism,
        ideaFragment: buildIdeaFragmentRecord({
          title: `${sourceDomain} scouting candidate ${index + 1}`,
          coreInsight:
            pickString(takeaways[0] ?? {}, [
              "source_domain_formulation",
              "sourceDomainFormulation",
              "mechanism_explanation",
              "mechanismExplanation",
            ]) ??
            pickString(entry, ["rationale", "selection_rationale"]) ??
            `${sourceDomain} contributes a graph-backed scouting takeaway.`,
          mechanism,
          targetDomain: params.targetDomain,
          sourceDomain,
        }),
        sourceRecord: entry,
        sourceAnalysis,
        targetDomain: params.targetDomain,
        baseline: params.baselineReference,
        metric: params.primaryMetric,
        domainDistanceMatrix,
        sourcePath: `scouting_report.candidate_domains[${index}]`,
      })
    );
  });

  recordList(params.candidatePool?.candidates).forEach((entry, index) => {
    const sourceDomain =
      pickString(entry, ["source_domain", "sourceDomain", "domain"]) ??
      "target-domain";
    const mechanism = pickMechanism(entry, null);
    candidates.push(
      makeCandidate({
        candidateId:
          pickString(entry, ["candidate_id", "candidateId", "direction_id", "directionId"]) ??
          `ic-cand-legacy-${index + 1}`,
        sourceDomain,
        frontierType: "legacy_ideation_candidate",
        mechanism,
        ideaFragment: buildIdeaFragmentRecord({
          title: pickString(entry, ["title"]) ?? `Legacy candidate ${index + 1}`,
          coreInsight:
            pickString(entry, ["summary", "core_insight", "coreInsight"]) ??
            "Legacy ideation candidate retained for compatibility.",
          mechanism,
          targetDomain: params.targetDomain,
          sourceDomain,
        }),
        sourceRecord: entry,
        targetDomain: params.targetDomain,
        baseline: params.baselineReference,
        metric: params.primaryMetric,
        domainDistanceMatrix,
        sourcePath: `ideation_candidate_pool.candidates[${index}]`,
      })
    );
  });

  const deduped = ensureMinimumCandidateVariants(
    ensureUniqueCandidateIds(dedupeCandidates(candidates)),
    dataStarvation
  );

  return {
    schema_version: 1,
    contract_version: "idea-catalyst-candidate-pool-v1",
    data_starvation: dataStarvation,
    candidate_pool_size: deduped.length,
    candidates: deduped,
    generation_summary: {
      required_minimum_without_data_starvation: 3,
      source_paths: uniqueStrings(deduped.map((candidate) => candidate.source_path)),
      selected_track_id: params.selectedTrackId,
      baseline_reference: params.baselineReference,
      primary_metric: params.primaryMetric,
    },
  };
}
