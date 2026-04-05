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

  const [mechanismBridgePacket, challengeInsightPacket, graphStorylinePacket] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(mechanismBridgePacketPath),
      readJsonIfExists<Record<string, unknown>>(challengeInsightPacketPath),
      readJsonIfExists<Record<string, unknown>>(graphStorylinePacketSourcePath),
    ]);

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

  const generatedFiles: string[] = [];

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
      transferBridgeCount: transferBridges.length,
      selectedSourceDomainCount: selectedSourceDomains.length,
      bridgeEvidenceTier,
    },
    generatedFiles,
  };
}
