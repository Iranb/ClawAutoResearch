import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeIdeationContractState,
  serializeIdeationContractState,
  serializeIdeationGraphIndicesState,
} from "../workflow-guard-state/ideation-contract";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "../workflow-guard-state/paper-story";
import {
  normalizeReviewPressurePacketState,
  serializeReviewPressurePacketState,
} from "../workflow-guard-state/review-pressure";
import {
  DEFAULT_KG_STORYLINE_PACKET_PATH,
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import {
  normalizeGraphGuidedWritingState,
  serializeGraphGuidedWritingState,
} from "../workflow-guard-state/authoring-review-state";
import {
  normalizeIdeaCatalystState,
  serializeIdeaCatalystState,
} from "../idea-catalyst/state";

export const DEFAULT_MECHANISM_BRIDGE_PACKET_PATH =
  "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json";
export const DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH =
  "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json";
export const DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH =
  "researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json";
export const DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH =
  "researcher/papernexus/GRAPH_STORYLINE_PACKET.json";
export const DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH =
  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json";

function nowIso() {
  return new Date().toISOString();
}

function normalizeStringList(value: unknown): string[] {
  return uniqueStrings(asStringArray(value));
}

function readPacketList(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = record[key];
    const values = normalizeStringList(raw);
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

function readStringListFromObjects(
  values: unknown,
  candidateKeys: string[]
): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return uniqueStrings(
    values
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        for (const key of candidateKeys) {
          const value = asString(entry[key]);
          if (value) {
            return value;
          }
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry))
  );
}

function readRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function unwrapPacketBundle(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    asRecord(record.packet_bundle) ??
    asRecord(record.packetBundle) ??
    record
  );
}

function deriveBridgeEvidenceTierFromBundle(bundle: Record<string, unknown>) {
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const analyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const supportingPaperCount = analyses.reduce((sum, analysis) => {
    const direct = readPacketList(analysis, ["supporting_papers", "supportingPapers"]).length;
    const takeawayPapers = readRecordList(analysis.takeaways).reduce((inner, takeaway) => {
      return inner + readPacketList(takeaway, ["supporting_papers", "supportingPapers"]).length;
    }, 0);
    return sum + direct + takeawayPapers;
  }, 0);
  if (ideaFragments.length >= 2 || supportingPaperCount >= 6) {
    return "strong";
  }
  if (ideaFragments.length >= 1 || supportingPaperCount >= 2 || analyses.length >= 1) {
    return "moderate";
  }
  return "weak";
}

function deriveMechanismBridgePacketFromBundle(bundle: Record<string, unknown>) {
  const decomposition = asRecord(bundle.decomposition) ?? {};
  const crossDomainQueries = readRecordList(
    bundle.cross_domain_searches ?? bundle.cross_domain_queries
  );
  const sourceDomainAnalyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const candidateDomains = uniqueStrings([
    ...crossDomainQueries
      .map((entry) => pickString(entry, ["domain", "source_domain", "sourceDomain"]))
      .filter((entry): entry is string => Boolean(entry)),
    ...sourceDomainAnalyses
      .map((entry) => pickString(entry, ["source_domain", "sourceDomain", "domain"]))
      .filter((entry): entry is string => Boolean(entry)),
  ]);
  const selectedDomains = uniqueStrings(
    sourceDomainAnalyses
      .filter((entry) => {
        const takeaways = readRecordList(entry.takeaways);
        const supportingPapers = readPacketList(entry, ["supporting_papers", "supportingPapers"]);
        return takeaways.length > 0 || supportingPapers.length > 0;
      })
      .map((entry) => pickString(entry, ["source_domain", "sourceDomain", "domain"]))
      .filter((entry): entry is string => Boolean(entry))
  );
  const prunedDomains = uniqueStrings(
    candidateDomains.filter((domain) => !selectedDomains.includes(domain))
  );
  const transferBridges = uniqueStrings([
    ...sourceDomainAnalyses.flatMap((entry) => {
      const domain =
        pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
      const sharedMechanisms = readPacketList(entry, [
        "shared_mechanisms",
        "sharedMechanisms",
      ]).map((mechanism) => `${domain}:${mechanism}`);
      const takeawayConcepts = readRecordList(entry.takeaways)
        .map(
          (takeaway) =>
            pickString(takeaway, [
              "concept",
              "mechanism",
              "mechanism_explanation",
              "source_domain_formulation",
            ]) ?? null
        )
        .filter((value): value is string => Boolean(value))
        .map((value) => `${domain}:${value}`);
      return [...sharedMechanisms, ...takeawayConcepts];
    }),
    ...ideaFragments
      .map((entry) => {
        const domain =
          pickString(entry, ["source_domain", "sourceDomain"]) ?? "external";
        const ideaFragmentRecord = asRecord(entry.idea_fragment);
        const mechanism =
          pickString(entry, ["integration_mechanism", "integrationMechanism"]) ??
          pickString(ideaFragmentRecord ?? {}, [
            "integration_mechanism",
            "integrationMechanism",
          ]);
        return mechanism ? `${domain}:${mechanism}` : null;
      })
      .filter((value): value is string => Boolean(value)),
  ]);
  const bridgeNodes = sourceDomainAnalyses.flatMap((entry, analysisIndex) => {
    const domain =
      pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
    return readRecordList(entry.takeaways).map((takeaway, takeawayIndex) => ({
      node_id:
        pickString(takeaway, ["kg_node_id", "kgNodeId", "node_id", "nodeId"]) ??
        `bundle-${analysisIndex + 1}-${takeawayIndex + 1}`,
      node_name:
        pickString(takeaway, [
          "concept",
          "source_domain_formulation",
          "mechanism",
          "mechanism_explanation",
        ]) ?? `${domain} bridge takeaway`,
      domain,
      mechanism:
        pickString(takeaway, ["mechanism", "mechanism_explanation"]) ??
        readPacketList(entry, ["shared_mechanisms", "sharedMechanisms"])[0] ??
        null,
      properties: {
        abstract:
          pickString(takeaway, [
            "source_domain_formulation",
            "mechanism_explanation",
            "selection_rationale",
          ]) ?? null,
        evidenceText:
          pickString(takeaway, ["selection_rationale"]) ??
          pickString(entry, ["selection_rationale", "selectionRationale"]) ??
          pickString(entry, ["domain_rationale", "domainRationale"]) ??
          null,
        supporting_papers: readPacketList(takeaway, [
          "supporting_papers",
          "supportingPapers",
        ]),
        source_spans: readRecordList(takeaway.source_spans ?? takeaway.sourceSpans),
        evidence_chain_refs: readRecordList(
          takeaway.evidence_chain_refs ?? takeaway.evidenceChainRefs
        ),
      },
    }));
  });

  return {
    target_domain:
      pickString(decomposition, ["fine_grained_domain", "fineGrainedDomain"]) ??
      pickString(bundle, ["target_domain", "targetDomain"]) ??
      null,
    candidate_domains: candidateDomains,
    selected_domains: selectedDomains,
    pruned_domains: prunedDomains,
    bridge_evidence_tier: deriveBridgeEvidenceTierFromBundle(bundle),
    transfer_bridges: transferBridges,
    bridge_nodes: bridgeNodes,
    bridge_retrieval:
      asRecord(bundle.bridge_retrieval ?? bundle.bridgeRetrieval) ?? null,
    structural_analogy:
      asRecord(bundle.structural_analogy ?? bundle.structuralAnalogy) ?? null,
    interdisciplinary_potential_ranking:
      asRecord(
        bundle.interdisciplinary_potential_ranking ??
          bundle.interdisciplinaryPotentialRanking
      ) ?? null,
    interdisciplinary_ranking:
      asRecord(bundle.interdisciplinary_ranking ?? bundle.interdisciplinaryRanking) ??
      null,
    domain_distance_matrix:
      asRecord(bundle.domain_distance_matrix ?? bundle.domainDistanceMatrix) ?? null,
    domain_distance_policy:
      asRecord(bundle.domain_distance_policy ?? bundle.domainDistancePolicy) ?? null,
    source_domain_analyses: sourceDomainAnalyses,
    cross_domain_analysis: sourceDomainAnalyses,
    idea_fragments: ideaFragments,
    requisition_report:
      asRecord(bundle.requisition_report ?? bundle.requisitionReport) ?? null,
  };
}

function deriveChallengeInsightPacketFromBundle(bundle: Record<string, unknown>) {
  const decomposition = asRecord(bundle.decomposition) ?? {};
  const targetDomainAnalyses = readRecordList(bundle.target_domain_analysis);
  const sourceDomainAnalyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const challengeClusters = uniqueStrings([
    ...readRecordList(decomposition.questions ?? decomposition.research_questions)
      .map((entry) =>
        pickString(entry, [
          "domain_specific_question",
          "domainSpecificQuestion",
          "question",
        ])
      )
      .filter((entry): entry is string => Boolean(entry)),
    ...targetDomainAnalyses.flatMap((entry) =>
      readRecordList(entry.remaining_challenges).map(
        (challenge) =>
          pickString(challenge, [
            "domain_specific_challenge_question",
            "domainSpecificChallengeQuestion",
            "name",
          ]) ?? null
      )
    ).filter((entry): entry is string => Boolean(entry)),
  ]);
  const insightClusters = uniqueStrings([
    ...ideaFragments
      .map((entry) => {
        const ideaFragmentRecord = asRecord(entry.idea_fragment);
        return (
          pickString(entry, ["core_insight", "coreInsight"]) ??
          pickString(ideaFragmentRecord ?? {}, ["core_insight", "coreInsight"])
        );
      })
      .filter((entry): entry is string => Boolean(entry)),
    ...sourceDomainAnalyses.flatMap((entry) =>
      readRecordList(entry.takeaways).map(
        (takeaway) =>
          pickString(takeaway, [
            "source_domain_formulation",
            "sourceDomainFormulation",
            "mechanism_explanation",
            "mechanismExplanation",
          ]) ?? null
      )
    ).filter((entry): entry is string => Boolean(entry)),
  ]);

  return {
    target_domain:
      pickString(decomposition, ["fine_grained_domain", "fineGrainedDomain"]) ??
      pickString(bundle, ["target_domain", "targetDomain"]) ??
      null,
    challenge_clusters: challengeClusters,
    insight_clusters: insightClusters,
    occupied_solution_zones: [],
  };
}

function mergeMechanismBridgePackets(
  base: Record<string, unknown> | null,
  derived: Record<string, unknown> | null
) {
  if (!base) return derived;
  if (!derived) return base;
  return {
    ...base,
    ...derived,
    target_domain:
      pickString(derived, ["target_domain", "targetDomain"]) ??
      pickString(base, ["target_domain", "targetDomain"]) ??
      null,
    candidate_domains: uniqueStrings([
      ...readPacketList(base, ["candidate_domains", "candidateDomains"]),
      ...readPacketList(derived, ["candidate_domains", "candidateDomains"]),
    ]),
    selected_domains: uniqueStrings([
      ...readPacketList(base, ["selected_domains", "selectedDomains"]),
      ...readPacketList(derived, ["selected_domains", "selectedDomains"]),
    ]),
    pruned_domains: uniqueStrings([
      ...readPacketList(base, ["pruned_domains", "prunedDomains"]),
      ...readPacketList(derived, ["pruned_domains", "prunedDomains"]),
    ]),
    transfer_bridges: uniqueStrings([
      ...readPacketList(base, ["transfer_bridges", "transferBridges"]),
      ...readPacketList(derived, ["transfer_bridges", "transferBridges"]),
    ]),
    bridge_evidence_tier:
      pickString(derived, ["bridge_evidence_tier", "bridgeEvidenceTier"]) ??
      pickString(base, ["bridge_evidence_tier", "bridgeEvidenceTier"]) ??
      null,
    bridge_nodes: [
      ...readRecordList(base.bridge_nodes),
      ...readRecordList(derived.bridge_nodes),
    ],
    bridge_retrieval:
      asRecord(derived.bridge_retrieval ?? derived.bridgeRetrieval) ??
      asRecord(base.bridge_retrieval ?? base.bridgeRetrieval) ??
      null,
    structural_analogy:
      asRecord(derived.structural_analogy ?? derived.structuralAnalogy) ??
      asRecord(base.structural_analogy ?? base.structuralAnalogy) ??
      null,
    interdisciplinary_potential_ranking:
      asRecord(
        derived.interdisciplinary_potential_ranking ??
          derived.interdisciplinaryPotentialRanking
      ) ??
      asRecord(
        base.interdisciplinary_potential_ranking ??
          base.interdisciplinaryPotentialRanking
      ) ??
      null,
    interdisciplinary_ranking:
      asRecord(derived.interdisciplinary_ranking ?? derived.interdisciplinaryRanking) ??
      asRecord(base.interdisciplinary_ranking ?? base.interdisciplinaryRanking) ??
      null,
    domain_distance_matrix:
      asRecord(derived.domain_distance_matrix ?? derived.domainDistanceMatrix) ??
      asRecord(base.domain_distance_matrix ?? base.domainDistanceMatrix) ??
      null,
    domain_distance_policy:
      asRecord(derived.domain_distance_policy ?? derived.domainDistancePolicy) ??
      asRecord(base.domain_distance_policy ?? base.domainDistancePolicy) ??
      null,
    source_domain_analyses: [
      ...readRecordList(base.source_domain_analyses ?? base.sourceDomainAnalyses),
      ...readRecordList(
        derived.source_domain_analyses ?? derived.sourceDomainAnalyses
      ),
    ],
    cross_domain_analysis: [
      ...readRecordList(base.cross_domain_analysis ?? base.crossDomainAnalysis),
      ...readRecordList(
        derived.cross_domain_analysis ?? derived.crossDomainAnalysis
      ),
    ],
    idea_fragments: [
      ...readRecordList(base.idea_fragments ?? base.ideaFragments),
      ...readRecordList(derived.idea_fragments ?? derived.ideaFragments),
    ],
    requisition_report:
      asRecord(derived.requisition_report ?? derived.requisitionReport) ??
      asRecord(base.requisition_report ?? base.requisitionReport) ??
      null,
  };
}

function mergeChallengeInsightPackets(
  base: Record<string, unknown> | null,
  derived: Record<string, unknown> | null
) {
  if (!base) return derived;
  if (!derived) return base;
  return {
    ...base,
    ...derived,
    target_domain:
      pickString(derived, ["target_domain", "targetDomain"]) ??
      pickString(base, ["target_domain", "targetDomain"]) ??
      null,
    challenge_clusters: uniqueStrings([
      ...readPacketList(base, ["challenge_clusters", "challengeClusters"]),
      ...readPacketList(derived, ["challenge_clusters", "challengeClusters"]),
    ]),
    insight_clusters: uniqueStrings([
      ...readPacketList(base, ["insight_clusters", "insightClusters"]),
      ...readPacketList(derived, ["insight_clusters", "insightClusters"]),
    ]),
    occupied_solution_zones: uniqueStrings([
      ...readPacketList(base, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ]),
      ...readPacketList(derived, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ]),
    ]),
  };
}

function deriveTransferBridges(packet: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...readPacketList(packet, ["transfer_bridges", "transferBridges"]),
    ...readStringListFromObjects(packet.bridge_nodes, [
      "bridge_label",
      "bridgeLabel",
      "label",
      "transfer_bridge",
      "transferBridge",
    ]),
    ...readStringListFromObjects(packet.bridge_nodes, ["node_name", "nodeName"]).map(
      (entry) => {
        const domain = readStringListFromObjects(packet.bridge_nodes, ["domain"]).find(
          () => true
        );
        return domain ? `${domain}:${entry}` : entry;
      }
    ),
  ]);
}

function buildKgStorylineMarkdown(packet: Record<string, unknown>) {
  const taskSummary =
    pickString(packet, ["task_summary", "taskSummary"]) ?? "unset";
  const challengeStatement =
    pickString(packet, ["challenge_statement", "challengeStatement"]) ?? "unset";
  const insightSummary =
    pickString(packet, ["insight_summary", "insightSummary"]) ?? "unset";
  const contributionBullets = readPacketList(packet, [
    "contribution_bullets",
    "contributionBullets",
  ]);
  const advantageBullets = readPacketList(packet, [
    "advantage_bullets",
    "advantageBullets",
  ]);
  const limitationBoundaries = readPacketList(packet, [
    "limitation_boundaries",
    "limitationBoundaries",
  ]);
  const relatedWorkTension = readPacketList(packet, [
    "related_work_tension",
    "relatedWorkTension",
  ]);
  const missingClaims = readPacketList(packet, ["missing_claims", "missingClaims"]);
  const renderBullets = (values: string[]) =>
    values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none";

  return `# KG Storyline Packet

## Task
${taskSummary}

## Challenge
${challengeStatement}

## Insight
${insightSummary}

## Contribution
${renderBullets(contributionBullets)}

## Advantage
${renderBullets(advantageBullets)}

## Related Work Tension
${renderBullets(relatedWorkTension)}

## Limitation Boundaries
${renderBullets(limitationBoundaries)}

## Missing Claims
${renderBullets(missingClaims)}
`;
}

export async function materializePapernexusPacketContracts(params: {
  projectRoot: string;
  packetPaths?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath =
    resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ??
    path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const packetPaths = asRecord(params.packetPaths) ?? {};
  const generatedFiles: string[] = [];

  const mechanismBridgePacketPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["mechanismBridgePacketPath", "mechanism_bridge_packet_path"]) ??
        DEFAULT_MECHANISM_BRIDGE_PACKET_PATH
    ) ?? path.join(projectRoot, DEFAULT_MECHANISM_BRIDGE_PACKET_PATH);
  const challengeInsightPacketPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["challengeInsightPacketPath", "challenge_insight_packet_path"]) ??
        DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH
    ) ?? path.join(projectRoot, DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH);
  const graphStorylinePacketSourcePath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["graphStorylinePacketPath", "graph_storyline_packet_path"]) ??
        DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH
    ) ?? path.join(projectRoot, DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH);
  const ideaCatalystPacketBundlePath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, [
        "ideaCatalystPacketBundlePath",
        "idea_catalyst_packet_bundle_path",
      ]) ?? DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH
    ) ?? path.join(projectRoot, DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH);

  const [rawMechanismBridgePacket, rawChallengeInsightPacket, graphStorylinePacket, rawIdeaCatalystPacketBundle] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(mechanismBridgePacketPath),
      readJsonIfExists<Record<string, unknown>>(challengeInsightPacketPath),
      readJsonIfExists<Record<string, unknown>>(graphStorylinePacketSourcePath),
      readJsonIfExists<Record<string, unknown>>(ideaCatalystPacketBundlePath),
    ]);
  const ideaCatalystPacketBundle = unwrapPacketBundle(rawIdeaCatalystPacketBundle);
  const derivedMechanismBridgePacket = ideaCatalystPacketBundle
    ? deriveMechanismBridgePacketFromBundle(ideaCatalystPacketBundle)
    : null;
  const derivedChallengeInsightPacket = ideaCatalystPacketBundle
    ? deriveChallengeInsightPacketFromBundle(ideaCatalystPacketBundle)
    : null;
  const mechanismBridgePacket = mergeMechanismBridgePackets(
    rawMechanismBridgePacket,
    derivedMechanismBridgePacket
  );
  const challengeInsightPacket = mergeChallengeInsightPackets(
    rawChallengeInsightPacket,
    derivedChallengeInsightPacket
  );

  if (ideaCatalystPacketBundle && mechanismBridgePacket) {
    await writeJsonEnsured(mechanismBridgePacketPath, mechanismBridgePacket);
    generatedFiles.push(path.relative(projectRoot, mechanismBridgePacketPath));
  }
  if (ideaCatalystPacketBundle && challengeInsightPacket) {
    await writeJsonEnsured(challengeInsightPacketPath, challengeInsightPacket);
    generatedFiles.push(path.relative(projectRoot, challengeInsightPacketPath));
  }

  const currentIdeation = normalizeIdeationContractState(manifest.ideation_contract);
  const currentWriting = normalizeWritingContractState(manifest.writing_contract);
  const currentGraphGuidedWriting = normalizeGraphGuidedWritingState(
    manifest.graph_guided_writing
  );
  const currentIdeaCatalyst = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const currentPaperStory = normalizePaperStoryState(manifest.paper_story_state);
  const currentReviewPressure = normalizeReviewPressurePacketState(
    manifest.review_pressure_packet
  );

  const transferBridges = mechanismBridgePacket
    ? deriveTransferBridges(mechanismBridgePacket)
    : [];
  const candidateSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, [
        "candidate_domains",
        "candidateDomains",
        "source_domains",
        "sourceDomains",
      ])
    : [];
  const selectedSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, [
        "selected_domains",
        "selectedDomains",
      ])
    : [];
  const prunedSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, ["pruned_domains", "prunedDomains"])
    : [];
  const bridgeEvidenceTier = mechanismBridgePacket
    ? pickString(mechanismBridgePacket, [
        "bridge_evidence_tier",
        "bridgeEvidenceTier",
      ])
    : null;
  const challengeClusters = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, [
        "challenge_clusters",
        "challengeClusters",
      ])
    : [];
  const insightClusters = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, ["insight_clusters", "insightClusters"])
    : [];
  const occupiedSolutionZones = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ])
    : [];

  const nextIdeation = normalizeIdeationContractState({
    ...serializeIdeationContractState(currentIdeation),
    graph_ideation_indices: {
      ...serializeIdeationGraphIndicesState(currentIdeation.graphIdeationIndices),
      challenge_clusters: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.challengeClusters,
        ...challengeClusters,
      ]),
      insight_clusters: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.insightClusters,
        ...insightClusters,
      ]),
      occupied_solution_zones: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.occupiedSolutionZones,
        ...occupiedSolutionZones,
      ]),
      transfer_bridges: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.transferBridges,
        ...transferBridges,
      ]),
      candidate_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.candidateSourceDomains,
        ...candidateSourceDomains,
      ]),
      selected_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.selectedSourceDomains,
        ...selectedSourceDomains,
      ]),
      pruned_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.prunedSourceDomains,
        ...prunedSourceDomains,
      ]),
      bridge_evidence_tier:
        bridgeEvidenceTier ??
        currentIdeation.graphIdeationIndices.bridgeEvidenceTier,
      last_refresh_at: nowIso(),
      status:
        currentIdeation.status === "ready" ||
        challengeClusters.length > 0 ||
        insightClusters.length > 0 ||
        transferBridges.length > 0
          ? "ready"
          : currentIdeation.graphIdeationIndices.status,
    },
    last_updated_at: nowIso(),
  });
  manifest.ideation_contract = serializeIdeationContractState(nextIdeation);

  const nextIdeaCatalyst = normalizeIdeaCatalystState({
    ...serializeIdeaCatalystState(currentIdeaCatalyst),
    target_domain:
      pickString(mechanismBridgePacket ?? {}, ["target_domain", "targetDomain"]) ??
      pickString(graphStorylinePacket ?? {}, ["target_domain", "targetDomain"]) ??
      currentIdeaCatalyst.targetDomain,
    source_domains: uniqueStrings([
      ...currentIdeaCatalyst.sourceDomains,
      ...selectedSourceDomains,
    ]),
    bridge_count:
      transferBridges.length > 0
        ? transferBridges.length
        : currentIdeaCatalyst.bridgeCount,
    last_updated_at: nowIso(),
  });
  manifest.idea_catalyst = serializeIdeaCatalystState(nextIdeaCatalyst);

  if (graphStorylinePacket) {
    const kgStorylinePacketPath =
      resolveProjectArtifactPath(
        projectRoot,
        pickString(packetPaths, [
          "kgStorylinePacketPath",
          "kg_storyline_packet_path",
        ]) ?? DEFAULT_KG_STORYLINE_PACKET_PATH
      ) ?? path.join(projectRoot, DEFAULT_KG_STORYLINE_PACKET_PATH);
    await writeTextEnsured(
      kgStorylinePacketPath,
      buildKgStorylineMarkdown(graphStorylinePacket)
    );
    generatedFiles.push(path.relative(projectRoot, kgStorylinePacketPath));

    const totalHeadlineClaimCount = Math.max(
      0,
      Math.floor(
        pickNumber(graphStorylinePacket, [
          "total_headline_claim_count",
          "totalHeadlineClaimCount",
        ]) ?? 0
      )
    );
    const coveredHeadlineClaimCount = Math.max(
      0,
      Math.floor(
        pickNumber(graphStorylinePacket, [
          "covered_headline_claim_count",
          "coveredHeadlineClaimCount",
        ]) ?? totalHeadlineClaimCount
      )
    );
    const missingEvidenceClaims = readPacketList(graphStorylinePacket, [
      "missing_claims",
      "missingClaims",
    ]);
    const claimEvidencePacketPaths = readPacketList(graphStorylinePacket, [
      "claim_evidence_packet_paths",
      "claimEvidencePacketPaths",
    ]);
    const kgStatus =
      normalizeStage(
        graphStorylinePacket.kg_storyline_status ??
          graphStorylinePacket.kgStorylineStatus ??
          graphStorylinePacket.status
      ) ??
      (missingEvidenceClaims.length === 0 ? "ready" : "pending");

    const nextWriting = normalizeWritingContractState({
      ...serializeWritingContractState(currentWriting),
      kg_storyline_required:
        pickBoolean(graphStorylinePacket, [
          "kg_storyline_required",
          "kgStorylineRequired",
        ]) ?? true,
      kg_storyline_status: kgStatus,
      kg_storyline_packet_path: path.relative(projectRoot, kgStorylinePacketPath),
    });
    manifest.writing_contract = serializeWritingContractState(nextWriting);

    const nextGraphGuidedWriting = normalizeGraphGuidedWritingState({
      ...serializeGraphGuidedWritingState(currentGraphGuidedWriting),
      status: kgStatus,
      claim_evidence_packet_paths: uniqueStrings([
        ...currentGraphGuidedWriting.claimEvidencePacketPaths,
        ...claimEvidencePacketPaths,
      ]),
      covered_headline_claim_count:
        coveredHeadlineClaimCount || currentGraphGuidedWriting.coveredHeadlineClaimCount,
      total_headline_claim_count:
        totalHeadlineClaimCount || currentGraphGuidedWriting.totalHeadlineClaimCount,
      evidence_coverage_status:
        normalizeStage(
          graphStorylinePacket.evidence_coverage_status ??
            graphStorylinePacket.evidenceCoverageStatus
        ) ??
        (missingEvidenceClaims.length === 0 ? "covered" : "pending"),
      missing_evidence_claims: missingEvidenceClaims,
      last_updated_at: nowIso(),
      pending_reason:
        missingEvidenceClaims.length > 0
          ? "PaperNexus storyline packet still reports missing claim evidence."
          : null,
    });
    manifest.graph_guided_writing =
      serializeGraphGuidedWritingState(nextGraphGuidedWriting);

    const nextPaperStory = normalizePaperStoryState({
      ...serializePaperStoryState(currentPaperStory),
      last_updated_at: currentPaperStory.lastUpdatedAt ?? null,
    });
    manifest.paper_story_state = serializePaperStoryState(nextPaperStory);

    const nextReviewPressure = normalizeReviewPressurePacketState({
      ...serializeReviewPressurePacketState(currentReviewPressure),
      last_updated_at: currentReviewPressure.lastUpdatedAt ?? null,
    });
    manifest.review_pressure_packet =
      serializeReviewPressurePacketState(nextReviewPressure);
  }

  await writeJsonEnsured(manifestPath, manifest);

  return {
    state: {
      mechanismBridgePacketReady: Boolean(mechanismBridgePacket),
      challengeInsightPacketReady: Boolean(challengeInsightPacket),
      graphStorylinePacketReady: Boolean(graphStorylinePacket),
      ideaCatalystPacketBundleReady: Boolean(ideaCatalystPacketBundle),
      transferBridgeCount: transferBridges.length,
      selectedSourceDomainCount: selectedSourceDomains.length,
      bridgeEvidenceTier,
    },
    generatedFiles,
  };
}
