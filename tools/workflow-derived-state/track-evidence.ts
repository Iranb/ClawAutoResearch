import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  asStringArray,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { pathExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

export const TRACK_GRAPH_EVIDENCE_FILE_NAME = "GRAPH_EVIDENCE.json";

type TrackLike = Record<string, unknown>;
type DiagnosticSeverity = "info" | "warning" | "error";

export type TrackEvidencePresence =
  | "missing"
  | "inline_only"
  | "file_backed"
  | "mixed"
  | "invalid";

export type TrackEvidenceDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  repairable: boolean;
  source: "inline" | "artifact" | "resolver";
  path?: string | null;
  field?: string | null;
};

export type TrackEvidenceRepairableMetadata = {
  repairable: boolean;
  repairableSignals: string[];
  suggestedOwner: "workflow" | "story" | "owner" | "unknown";
  suggestedAction: "materialize_graph_evidence" | "repair_graph_evidence" | null;
};

export type TrackInnovationEvidenceState = {
  presence: TrackEvidencePresence;
  evidencePointers: string[];
  linkedGraphNodes: string[];
  relationPatterns: string[];
  hasGraphBackedInnovationEvidence: boolean;
  hasStructuralGraphEvidence: boolean;
  hasStoryFacingTrackGraphSupport: boolean;
  graphEvidencePath: string | null;
  importedFromGraphEvidence: boolean;
  diagnostics: TrackEvidenceDiagnostic[];
  repairable: TrackEvidenceRepairableMetadata;
};

type ResolvedEvidenceRecord = {
  evidencePointers: string[];
  linkedGraphNodes: string[];
  relationPatterns: string[];
  diagnostics: TrackEvidenceDiagnostic[];
};

type ArtifactReadState =
  | {
      status: "missing";
      record: null;
      diagnostics: TrackEvidenceDiagnostic[];
    }
  | {
      status: "usable";
      record: TrackLike;
      diagnostics: TrackEvidenceDiagnostic[];
    }
  | {
      status: "invalid";
      record: null;
      diagnostics: TrackEvidenceDiagnostic[];
    };

function normalizeEvidencePointer(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function normalizeArtifactPath(relativeDir: string): string {
  return path.posix.join(relativeDir.replace(/\\/g, "/"), TRACK_GRAPH_EVIDENCE_FILE_NAME);
}

function isExplicitGraphEvidencePointer(value: string): boolean {
  const normalized = normalizeEvidencePointer(value).toLowerCase();
  return (
    normalized.includes("/graph_evidence.json") ||
    normalized.endsWith("graph_evidence.json") ||
    normalized.includes("graph_innovation_evidence") ||
    normalized.startsWith("graph/") ||
    normalized.includes("/graph/") ||
    normalized.startsWith("researcher/reasoning/") ||
    normalized.includes("/reasoning/")
  );
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
          return normalizeEvidencePointer(entry);
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
    asRecord(source.graph_innovation_evidence),
    asRecord(source.graphInnovationEvidence),
  ].filter((entry): entry is TrackLike => Boolean(entry));
}

function collectEvidencePointers(record: TrackLike): string[] {
  return uniqueStrings([
    ...asStringArray(record.evidence_pointers ?? record.evidencePointers).map(
      normalizeEvidencePointer
    ),
    ...asStringArray(record.graph_evidence_pointers ?? record.graphEvidencePointers).map(
      normalizeEvidencePointer
    ),
    ...asStringArray(
      record.graph_innovation_evidence_pointers ?? record.graphInnovationEvidencePointers
    ).map(normalizeEvidencePointer),
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
        record.graphNodeEntries ??
        record.graph_innovation_node_entries ??
        record.graphInnovationNodeEntries,
      ["node_id", "nodeId", "paper_id", "paperId", "id"],
      16
    ),
  ]).slice(0, 16);
}

function collectRelationPatterns(record: TrackLike): string[] {
  return uniqueStrings([
    ...asStringArray(record.relation_patterns ?? record.relationPatterns),
    ...asStringArray(record.graph_relation_patterns ?? record.graphRelationPatterns),
    ...asStringArray(
      record.graph_innovation_relation_patterns ?? record.graphInnovationRelationPatterns
    ),
    ...normalizeObjectArrayStrings(
      record.relation_pattern_entries ??
        record.relationPatternEntries ??
        record.relations ??
        record.graph_innovation_relations ??
        record.graphInnovationRelations,
      ["pattern", "relation_pattern", "relationPattern", "relation"],
      16
    ),
  ]).slice(0, 16);
}

function buildDiagnostics(
  evidencePointers: string[],
  linkedGraphNodes: string[],
  relationPatterns: string[],
  options: {
    importedFromGraphEvidence: boolean;
    graphEvidencePath: string | null;
    artifactStatus: ArtifactReadState["status"];
    inlineOnly: boolean;
  }
): TrackEvidenceDiagnostic[] {
  const diagnostics: TrackEvidenceDiagnostic[] = [];
  if (evidencePointers.length > 0 || linkedGraphNodes.length > 0 || relationPatterns.length > 0) {
    diagnostics.push({
      code: options.importedFromGraphEvidence
        ? "graph_evidence.imported"
        : "graph_evidence.inline_only",
      severity: "info",
      message: options.importedFromGraphEvidence
        ? "Track graph evidence was imported from the workflow-owned artifact."
        : "Track graph evidence is available inline on the track record.",
      repairable: options.importedFromGraphEvidence,
      source: options.importedFromGraphEvidence ? "artifact" : "inline",
      path: options.graphEvidencePath,
    });
  } else if (options.artifactStatus === "missing") {
    diagnostics.push({
      code: "graph_evidence.missing_artifact",
      severity: "warning",
      message: "Track graph evidence artifact is not yet present.",
      repairable: true,
      source: "resolver",
      path: options.graphEvidencePath,
    });
  } else if (options.artifactStatus === "invalid") {
    diagnostics.push({
      code: "graph_evidence.empty_payload",
      severity: "warning",
      message: "Track graph evidence artifact exists, but it does not contain usable evidence.",
      repairable: true,
      source: "artifact",
      path: options.graphEvidencePath,
    });
  }

  return diagnostics;
}

function buildRepairableMetadata(params: {
  evidencePointers: string[];
  linkedGraphNodes: string[];
  relationPatterns: string[];
  graphEvidencePath: string | null;
  artifactStatus: ArtifactReadState["status"];
}): TrackEvidenceRepairableMetadata {
  const hasUsableEvidence =
    params.evidencePointers.length > 0 ||
    params.linkedGraphNodes.length > 0 ||
    params.relationPatterns.length > 0;
  const repairableSignals: string[] = [];

  if (params.artifactStatus === "usable") {
    repairableSignals.push("graph_evidence.materialization_pending");
  } else if (params.artifactStatus === "invalid") {
    repairableSignals.push("graph_evidence.empty_payload");
  } else if (params.artifactStatus === "missing" && !hasUsableEvidence && params.graphEvidencePath) {
    repairableSignals.push("graph_evidence.missing_artifact");
  }

  const repairable = repairableSignals.length > 0;
  return {
    repairable,
    repairableSignals,
    suggestedOwner: repairable ? "workflow" : "owner",
    suggestedAction: repairable
      ? params.artifactStatus === "invalid"
        ? "repair_graph_evidence"
        : "materialize_graph_evidence"
      : null,
  };
}

function buildEvidenceState(params: {
  presence: TrackEvidencePresence;
  evidencePointers: string[];
  linkedGraphNodes: string[];
  relationPatterns: string[];
  graphEvidencePath: string | null;
  importedFromGraphEvidence: boolean;
  diagnostics: TrackEvidenceDiagnostic[];
  artifactStatus: ArtifactReadState["status"];
}): TrackInnovationEvidenceState {
  const hasGraphBackedInnovationEvidence =
    params.evidencePointers.length > 0 ||
    params.linkedGraphNodes.length > 0 ||
    params.relationPatterns.length > 0;
  const hasStructuralGraphEvidence =
    params.linkedGraphNodes.length > 0 || params.relationPatterns.length > 0;
  return {
    presence: params.presence,
    evidencePointers: params.evidencePointers,
    linkedGraphNodes: params.linkedGraphNodes,
    relationPatterns: params.relationPatterns,
    hasGraphBackedInnovationEvidence,
    hasStructuralGraphEvidence,
    hasStoryFacingTrackGraphSupport:
      hasStructuralGraphEvidence ||
      params.importedFromGraphEvidence ||
      params.evidencePointers.some((entry) => isExplicitGraphEvidencePointer(entry)),
    graphEvidencePath: params.graphEvidencePath,
    importedFromGraphEvidence: params.importedFromGraphEvidence,
    diagnostics: params.diagnostics,
    repairable: buildRepairableMetadata({
      evidencePointers: params.evidencePointers,
      linkedGraphNodes: params.linkedGraphNodes,
      relationPatterns: params.relationPatterns,
      graphEvidencePath: params.graphEvidencePath,
      artifactStatus: params.artifactStatus,
    }),
  };
}

function mergeEvidenceRecords(records: TrackLike[]): ResolvedEvidenceRecord {
  const evidencePointers = uniqueStrings(
    records.flatMap((record) => collectEvidencePointers(record))
  ).slice(0, 12);
  const linkedGraphNodes = uniqueStrings(
    records.flatMap((record) => collectLinkedGraphNodes(record))
  ).slice(0, 16);
  const relationPatterns = uniqueStrings(
    records.flatMap((record) => collectRelationPatterns(record))
  ).slice(0, 16);
  return {
    evidencePointers,
    linkedGraphNodes,
    relationPatterns,
    diagnostics: [],
  };
}

async function readGraphEvidenceArtifact(graphEvidenceResolvedPath: string): Promise<ArtifactReadState> {
  if (!(await pathExists(graphEvidenceResolvedPath))) {
    return {
      status: "missing",
      record: null,
      diagnostics: [],
    };
  }

  try {
    const raw = await fs.readFile(graphEvidenceResolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return {
        status: "invalid",
        record: null,
        diagnostics: [
          {
            code: "graph_evidence.invalid_json",
            severity: "error",
            message: "Track graph evidence artifact is not a JSON object.",
            repairable: true,
            source: "artifact",
            path: graphEvidenceResolvedPath,
          },
        ],
      };
    }
    const nestedRecords = collectEvidenceRecords(record);
    const imported = mergeEvidenceRecords(nestedRecords);
    if (
      imported.evidencePointers.length === 0 &&
      imported.linkedGraphNodes.length === 0 &&
      imported.relationPatterns.length === 0
    ) {
      return {
        status: "invalid",
        record: null,
        diagnostics: [
          {
            code: "graph_evidence.empty_payload",
            severity: "warning",
            message: "Track graph evidence artifact did not contain usable evidence.",
            repairable: true,
            source: "artifact",
            path: graphEvidenceResolvedPath,
          },
        ],
      };
    }
    return {
      status: "usable",
      record,
      diagnostics: [],
    };
  } catch {
    return {
      status: "invalid",
      record: null,
      diagnostics: [
        {
          code: "graph_evidence.invalid_json",
          severity: "error",
          message: "Track graph evidence artifact could not be parsed.",
          repairable: true,
          source: "artifact",
          path: graphEvidenceResolvedPath,
        },
      ],
    };
  }
}

function getInlineEvidence(source: TrackLike | null): ResolvedEvidenceRecord {
  return mergeEvidenceRecords(collectEvidenceRecords(source));
}

function mergeDiagnosticEntries(
  primary: TrackEvidenceDiagnostic[],
  secondary: TrackEvidenceDiagnostic[]
): TrackEvidenceDiagnostic[] {
  const seen = new Set<string>();
  const merged: TrackEvidenceDiagnostic[] = [];
  for (const entry of [...primary, ...secondary]) {
    const key = `${entry.code}:${entry.path ?? ""}:${entry.field ?? ""}:${entry.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

export function resolveTrackInnovationEvidence(
  source: TrackLike | null | undefined
): TrackInnovationEvidenceState {
  const inline = getInlineEvidence(source ?? null);
  const hasInlineEvidence =
    inline.evidencePointers.length > 0 ||
    inline.linkedGraphNodes.length > 0 ||
    inline.relationPatterns.length > 0;
  const diagnostics = buildDiagnostics(
    inline.evidencePointers,
    inline.linkedGraphNodes,
    inline.relationPatterns,
    {
      importedFromGraphEvidence: false,
      graphEvidencePath: null,
      artifactStatus: "missing",
      inlineOnly: hasInlineEvidence,
    }
  );
  return buildEvidenceState({
    presence: hasInlineEvidence ? "inline_only" : "missing",
    evidencePointers: inline.evidencePointers,
    linkedGraphNodes: inline.linkedGraphNodes,
    relationPatterns: inline.relationPatterns,
    graphEvidencePath: null,
    importedFromGraphEvidence: false,
    diagnostics,
    artifactStatus: "missing",
  });
}

export function normalizeTrackInnovationEvidence(
  source: TrackLike | null | undefined
): TrackInnovationEvidenceState {
  return resolveTrackInnovationEvidence(source);
}

export async function loadTrackInnovationEvidence(params: {
  projectRoot: string;
  track: TrackLike | null | undefined;
}): Promise<TrackInnovationEvidenceState> {
  const track = params.track ?? null;
  const inline = getInlineEvidence(track);
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
  const artifact = graphEvidenceResolvedPath
    ? await readGraphEvidenceArtifact(graphEvidenceResolvedPath)
    : {
        status: "missing" as const,
        record: null,
        diagnostics: [],
      };
  const imported = artifact.record ? getInlineEvidence(artifact.record) : null;
  const hasImportedEvidence =
    Boolean(imported) &&
    Boolean(
      imported &&
        (imported.evidencePointers.length > 0 ||
          imported.linkedGraphNodes.length > 0 ||
          imported.relationPatterns.length > 0)
    );
  const evidencePointers = uniqueStrings([
    ...inline.evidencePointers,
    ...(imported?.evidencePointers ?? []),
  ]).slice(0, 12);
  const linkedGraphNodes = uniqueStrings([
    ...inline.linkedGraphNodes,
    ...(imported?.linkedGraphNodes ?? []),
  ]).slice(0, 16);
  const relationPatterns = uniqueStrings([
    ...inline.relationPatterns,
    ...(imported?.relationPatterns ?? []),
  ]).slice(0, 16);
  const hasMergedEvidence =
    evidencePointers.length > 0 || linkedGraphNodes.length > 0 || relationPatterns.length > 0;
  const hasInlineEvidence =
    inline.evidencePointers.length > 0 ||
    inline.linkedGraphNodes.length > 0 ||
    inline.relationPatterns.length > 0;
  const presence: TrackEvidencePresence = hasImportedEvidence
    ? hasInlineEvidence
      ? "mixed"
      : "file_backed"
    : hasMergedEvidence
      ? "inline_only"
      : artifact.status === "invalid"
        ? "invalid"
        : "missing";
  const diagnostics = mergeDiagnosticEntries(
    mergeDiagnosticEntries(inline.diagnostics, artifact.diagnostics),
    buildDiagnostics(evidencePointers, linkedGraphNodes, relationPatterns, {
      importedFromGraphEvidence: hasImportedEvidence,
      graphEvidencePath,
      artifactStatus: artifact.status,
      inlineOnly: hasInlineEvidence && !hasImportedEvidence,
    })
  );
  return buildEvidenceState({
    presence,
    evidencePointers,
    linkedGraphNodes,
    relationPatterns,
    graphEvidencePath,
    importedFromGraphEvidence: hasImportedEvidence,
    diagnostics,
    artifactStatus: artifact.status,
  });
}

export function trackHasGraphBackedInnovationEvidence(
  track: TrackLike | null | undefined
): boolean {
  return resolveTrackInnovationEvidence(track).hasGraphBackedInnovationEvidence;
}

export function hasStoryFacingTrackGraphSupport(
  state: TrackInnovationEvidenceState
): boolean {
  return state.hasStoryFacingTrackGraphSupport;
}
