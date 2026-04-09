import path from "node:path";
import {
  asRecord,
  asStringArray,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";

export const TRACK_GRAPH_EVIDENCE_FILE_NAME = "GRAPH_EVIDENCE.json";

type TrackLike = Record<string, unknown>;

export type TrackInnovationEvidenceState = {
  evidencePointers: string[];
  linkedGraphNodes: string[];
  relationPatterns: string[];
  hasGraphBackedInnovationEvidence: boolean;
  hasStructuralGraphEvidence: boolean;
  graphEvidencePath: string | null;
  importedFromGraphEvidence: boolean;
};

function normalizeEvidencePointer(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function isExplicitGraphEvidencePointer(value: string): boolean {
  const normalized = normalizeEvidencePointer(value).toLowerCase();
  return (
    normalized.includes("/graph_evidence.json") ||
    normalized.endsWith("graph_evidence.json") ||
    normalized.startsWith("graph/") ||
    normalized.includes("/graph/") ||
    normalized.startsWith("researcher/papernexus/") ||
    normalized.includes("/papernexus/")
  );
}

function normalizeArtifactPath(relativeDir: string): string {
  return path.posix.join(relativeDir.replace(/\\/g, "/"), TRACK_GRAPH_EVIDENCE_FILE_NAME);
}

function normalizeObjectArrayStrings(
  value: unknown,
  objectKeys: string[],
  limit: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        const record = asRecord(entry);
        return record ? pickString(record, objectKeys) ?? "" : "";
      })
      .filter(Boolean)
  ).slice(0, limit);
}

function collectEvidenceRecords(source: TrackLike | null): TrackLike[] {
  if (!source) {
    return [];
  }
  return [
    source,
    asRecord(source.graph_evidence),
    asRecord(source.graphEvidence),
    asRecord(source.graph_backed_innovation_evidence),
    asRecord(source.graphBackedInnovationEvidence),
  ].filter((entry): entry is TrackLike => Boolean(entry));
}

function collectEvidencePointers(record: TrackLike): string[] {
  return uniqueStrings([
    ...asStringArray(record.evidence_pointers ?? record.evidencePointers),
    ...asStringArray(record.graph_evidence_pointers ?? record.graphEvidencePointers),
    ...normalizeObjectArrayStrings(
      record.evidence_pointer_entries ?? record.evidencePointerEntries ?? record.evidence,
      ["pointer", "path", "artifact_path", "artifactPath", "reference", "ref"],
      12
    ),
  ]).slice(0, 12);
}

function collectLinkedGraphNodes(record: TrackLike): string[] {
  return uniqueStrings([
    ...asStringArray(record.linked_graph_nodes ?? record.linkedGraphNodes),
    ...asStringArray(record.graph_nodes ?? record.graphNodes),
    ...asStringArray(record.node_ids ?? record.nodeIds),
    ...normalizeObjectArrayStrings(
      record.linked_graph_node_entries ??
        record.linkedGraphNodeEntries ??
        record.graph_node_entries ??
        record.graphNodeEntries,
      ["node_id", "nodeId", "paper_id", "paperId", "id"],
      16
    ),
  ]).slice(0, 16);
}

function collectRelationPatterns(record: TrackLike): string[] {
  return uniqueStrings([
    ...asStringArray(record.relation_patterns ?? record.relationPatterns),
    ...asStringArray(record.graph_relation_patterns ?? record.graphRelationPatterns),
    ...normalizeObjectArrayStrings(
      record.relation_pattern_entries ??
        record.relationPatternEntries ??
        record.relations,
      ["pattern", "relation_pattern", "relationPattern", "relation"],
      16
    ),
  ]).slice(0, 16);
}

function buildEvidenceState(
  evidencePointers: string[],
  linkedGraphNodes: string[],
  relationPatterns: string[],
  graphEvidencePath: string | null,
  importedFromGraphEvidence: boolean
): TrackInnovationEvidenceState {
  return {
    evidencePointers,
    linkedGraphNodes,
    relationPatterns,
    hasGraphBackedInnovationEvidence:
      evidencePointers.length > 0 ||
      linkedGraphNodes.length > 0 ||
      relationPatterns.length > 0,
    hasStructuralGraphEvidence:
      linkedGraphNodes.length > 0 || relationPatterns.length > 0,
    graphEvidencePath,
    importedFromGraphEvidence,
  };
}

export function normalizeTrackInnovationEvidence(
  source: TrackLike | null | undefined
): TrackInnovationEvidenceState {
  const records = collectEvidenceRecords(source ?? null);
  const evidencePointers = uniqueStrings(
    records.flatMap((record) => collectEvidencePointers(record))
  ).slice(0, 12);
  const linkedGraphNodes = uniqueStrings(
    records.flatMap((record) => collectLinkedGraphNodes(record))
  ).slice(0, 16);
  const relationPatterns = uniqueStrings(
    records.flatMap((record) => collectRelationPatterns(record))
  ).slice(0, 16);
  return buildEvidenceState(evidencePointers, linkedGraphNodes, relationPatterns, null, false);
}

export async function loadTrackInnovationEvidence(params: {
  projectRoot: string;
  track: TrackLike | null | undefined;
}): Promise<TrackInnovationEvidenceState> {
  const track = params.track ?? null;
  const canonical = normalizeTrackInnovationEvidence(track);
  const reasoningPacketDir = pickString(track ?? {}, [
    "reasoning_packet_dir",
    "reasoningPacketDir",
  ]);
  const graphEvidencePath = reasoningPacketDir
    ? normalizeArtifactPath(reasoningPacketDir)
    : null;
  const graphEvidenceResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    graphEvidencePath
  );
  const artifactRecord = graphEvidenceResolvedPath
    ? await readJsonIfExists<TrackLike>(graphEvidenceResolvedPath)
    : null;
  const imported = normalizeTrackInnovationEvidence(artifactRecord);
  return buildEvidenceState(
    uniqueStrings([...canonical.evidencePointers, ...imported.evidencePointers]).slice(0, 12),
    uniqueStrings([...canonical.linkedGraphNodes, ...imported.linkedGraphNodes]).slice(0, 16),
    uniqueStrings([...canonical.relationPatterns, ...imported.relationPatterns]).slice(0, 16),
    graphEvidencePath,
    imported.hasGraphBackedInnovationEvidence
  );
}

export function trackHasGraphBackedInnovationEvidence(
  track: TrackLike | null | undefined
): boolean {
  return normalizeTrackInnovationEvidence(track).hasGraphBackedInnovationEvidence;
}

export function hasStoryFacingTrackGraphSupport(
  state: TrackInnovationEvidenceState
): boolean {
  return (
    state.hasStructuralGraphEvidence ||
    state.importedFromGraphEvidence ||
    state.evidencePointers.some((entry) => isExplicitGraphEvidencePointer(entry))
  );
}
