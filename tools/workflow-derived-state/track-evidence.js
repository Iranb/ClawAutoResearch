import * as fs from "node:fs/promises";
import * as path from "node:path";
import { asRecord, asStringArray, pickString, uniqueStrings, } from "../workflow-guard-core/coercion";
import { pathExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
export const TRACK_GRAPH_EVIDENCE_FILE_NAME = "GRAPH_EVIDENCE.json";
function normalizeEvidencePointer(value) {
    return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}
function normalizeArtifactPath(relativeDir) {
    return path.posix.join(relativeDir.replace(/\\/g, "/"), TRACK_GRAPH_EVIDENCE_FILE_NAME);
}
function isExplicitGraphEvidencePointer(value) {
    const normalized = normalizeEvidencePointer(value).toLowerCase();
    return (normalized.includes("/graph_evidence.json") ||
        normalized.endsWith("graph_evidence.json") ||
        normalized.includes("graph_innovation_evidence") ||
        normalized.startsWith("graph/") ||
        normalized.includes("/graph/") ||
        normalized.startsWith("researcher/reasoning/") ||
        normalized.includes("/reasoning/"));
}
function normalizeObjectArrayStrings(value, objectKeys, limit) {
    if (!Array.isArray(value)) {
        return [];
    }
    return uniqueStrings(value
        .map((entry) => {
        if (typeof entry === "string") {
            return normalizeEvidencePointer(entry);
        }
        const record = asRecord(entry);
        return record ? pickString(record, objectKeys) ?? "" : "";
    })
        .filter(Boolean)).slice(0, limit);
}
function collectEvidenceRecords(source) {
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
    ].filter((entry) => Boolean(entry));
}
function collectEvidencePointers(record) {
    return uniqueStrings([
        ...asStringArray(record.evidence_pointers ?? record.evidencePointers).map(normalizeEvidencePointer),
        ...asStringArray(record.graph_evidence_pointers ?? record.graphEvidencePointers).map(normalizeEvidencePointer),
        ...asStringArray(record.graph_innovation_evidence_pointers ?? record.graphInnovationEvidencePointers).map(normalizeEvidencePointer),
        ...normalizeObjectArrayStrings(record.evidence_pointer_entries ?? record.evidencePointerEntries ?? record.evidence, ["pointer", "path", "artifact_path", "artifactPath", "reference", "ref"], 12),
        ...asStringArray(record.bridge_path_ids ?? record.bridgePathIds).map((entry) => `paper_nexus:bridge_path:${normalizeEvidencePointer(entry)}`),
        ...normalizeObjectArrayStrings(record.evidence_chain_refs ?? record.evidenceChainRefs, ["ref_id", "refId", "node_id", "nodeId", "source", "reference", "ref"], 16).map((entry) => `paper_nexus:evidence_ref:${entry}`),
        ...normalizeObjectArrayStrings(record.source_spans ?? record.sourceSpans, [
            "span_id",
            "spanId",
            "snippet_node_id",
            "snippetNodeId",
            "paper_id",
            "paperId",
        ], 16).map((entry) => `paper_nexus:source_span:${entry}`),
    ]).slice(0, 12);
}
function collectLinkedGraphNodes(record) {
    return uniqueStrings([
        ...asStringArray(record.linked_graph_nodes ?? record.linkedGraphNodes),
        ...asStringArray(record.graph_nodes ?? record.graphNodes),
        ...asStringArray(record.node_ids ?? record.nodeIds),
        ...normalizeObjectArrayStrings(record.linked_graph_node_entries ??
            record.linkedGraphNodeEntries ??
            record.graph_node_entries ??
            record.graphNodeEntries ??
            record.graph_innovation_node_entries ??
            record.graphInnovationNodeEntries, ["node_id", "nodeId", "paper_id", "paperId", "id"], 16),
        ...normalizeObjectArrayStrings(record.evidence_chain_refs ?? record.evidenceChainRefs, ["node_id", "nodeId", "snippet_node_id", "snippetNodeId"], 16),
        ...normalizeObjectArrayStrings(record.source_spans ?? record.sourceSpans, [
            "snippet_node_id",
            "snippetNodeId",
            "paper_id",
            "paperId",
        ], 16),
    ]).slice(0, 16);
}
function collectRelationPatterns(record) {
    return uniqueStrings([
        ...asStringArray(record.relation_patterns ?? record.relationPatterns),
        ...asStringArray(record.graph_relation_patterns ?? record.graphRelationPatterns),
        ...asStringArray(record.graph_innovation_relation_patterns ?? record.graphInnovationRelationPatterns),
        ...normalizeObjectArrayStrings(record.relation_pattern_entries ??
            record.relationPatternEntries ??
            record.relations ??
            record.graph_innovation_relations ??
            record.graphInnovationRelations, ["pattern", "relation_pattern", "relationPattern", "relation"], 16),
        ...asStringArray(record.bridge_path_ids ?? record.bridgePathIds).map((entry) => `paper_nexus_bridge_path:${entry}`),
        ...(pickString(record, ["transferred_mechanism", "transferredMechanism"])
            ? [
                `paper_nexus_transferred_mechanism:${pickString(record, [
                    "transferred_mechanism",
                    "transferredMechanism",
                ])}`,
            ]
            : []),
    ]).slice(0, 16);
}
function buildDiagnostics(evidencePointers, linkedGraphNodes, relationPatterns, options) {
    const diagnostics = [];
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
    }
    else if (options.artifactStatus === "missing") {
        diagnostics.push({
            code: "graph_evidence.missing_artifact",
            severity: "warning",
            message: "Track graph evidence artifact is not yet present.",
            repairable: true,
            source: "resolver",
            path: options.graphEvidencePath,
        });
    }
    else if (options.artifactStatus === "invalid") {
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
function buildRepairableMetadata(params) {
    const hasUsableEvidence = params.evidencePointers.length > 0 ||
        params.linkedGraphNodes.length > 0 ||
        params.relationPatterns.length > 0;
    const repairableSignals = [];
    if (params.artifactStatus === "usable") {
        repairableSignals.push("graph_evidence.materialization_pending");
    }
    else if (params.artifactStatus === "invalid") {
        repairableSignals.push("graph_evidence.empty_payload");
    }
    else if (params.artifactStatus === "missing" && !hasUsableEvidence && params.graphEvidencePath) {
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
function buildEvidenceState(params) {
    const hasGraphBackedInnovationEvidence = params.evidencePointers.length > 0 ||
        params.linkedGraphNodes.length > 0 ||
        params.relationPatterns.length > 0;
    const hasStructuralGraphEvidence = params.linkedGraphNodes.length > 0 || params.relationPatterns.length > 0;
    return {
        presence: params.presence,
        evidencePointers: params.evidencePointers,
        linkedGraphNodes: params.linkedGraphNodes,
        relationPatterns: params.relationPatterns,
        hasGraphBackedInnovationEvidence,
        hasStructuralGraphEvidence,
        hasStoryFacingTrackGraphSupport: hasStructuralGraphEvidence ||
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
function mergeEvidenceRecords(records) {
    const evidencePointers = uniqueStrings(records.flatMap((record) => collectEvidencePointers(record))).slice(0, 12);
    const linkedGraphNodes = uniqueStrings(records.flatMap((record) => collectLinkedGraphNodes(record))).slice(0, 16);
    const relationPatterns = uniqueStrings(records.flatMap((record) => collectRelationPatterns(record))).slice(0, 16);
    return {
        evidencePointers,
        linkedGraphNodes,
        relationPatterns,
        diagnostics: [],
    };
}
async function readGraphEvidenceArtifact(graphEvidenceResolvedPath) {
    if (!(await pathExists(graphEvidenceResolvedPath))) {
        return {
            status: "missing",
            record: null,
            diagnostics: [],
        };
    }
    try {
        const raw = await fs.readFile(graphEvidenceResolvedPath, "utf8");
        const parsed = JSON.parse(raw);
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
        if (imported.evidencePointers.length === 0 &&
            imported.linkedGraphNodes.length === 0 &&
            imported.relationPatterns.length === 0) {
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
    }
    catch {
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
function getInlineEvidence(source) {
    return mergeEvidenceRecords(collectEvidenceRecords(source));
}
function mergeDiagnosticEntries(primary, secondary) {
    const seen = new Set();
    const merged = [];
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
export function resolveTrackInnovationEvidence(source) {
    const inline = getInlineEvidence(source ?? null);
    const hasInlineEvidence = inline.evidencePointers.length > 0 ||
        inline.linkedGraphNodes.length > 0 ||
        inline.relationPatterns.length > 0;
    const diagnostics = buildDiagnostics(inline.evidencePointers, inline.linkedGraphNodes, inline.relationPatterns, {
        importedFromGraphEvidence: false,
        graphEvidencePath: null,
        artifactStatus: "missing",
        inlineOnly: hasInlineEvidence,
    });
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
export function normalizeTrackInnovationEvidence(source) {
    return resolveTrackInnovationEvidence(source);
}
export async function loadTrackInnovationEvidence(params) {
    const track = params.track ?? null;
    const inline = getInlineEvidence(track);
    const reasoningPacketDir = pickString(track ?? {}, [
        "reasoning_packet_dir",
        "reasoningPacketDir",
    ]);
    const graphEvidencePath = reasoningPacketDir
        ? normalizeArtifactPath(reasoningPacketDir)
        : null;
    const graphEvidenceResolvedPath = resolveProjectArtifactPath(params.projectRoot, graphEvidencePath);
    const artifact = graphEvidenceResolvedPath
        ? await readGraphEvidenceArtifact(graphEvidenceResolvedPath)
        : {
            status: "missing",
            record: null,
            diagnostics: [],
        };
    const imported = artifact.record ? getInlineEvidence(artifact.record) : null;
    const hasImportedEvidence = Boolean(imported) &&
        Boolean(imported &&
            (imported.evidencePointers.length > 0 ||
                imported.linkedGraphNodes.length > 0 ||
                imported.relationPatterns.length > 0));
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
    const hasMergedEvidence = evidencePointers.length > 0 || linkedGraphNodes.length > 0 || relationPatterns.length > 0;
    const hasInlineEvidence = inline.evidencePointers.length > 0 ||
        inline.linkedGraphNodes.length > 0 ||
        inline.relationPatterns.length > 0;
    const presence = hasImportedEvidence
        ? hasInlineEvidence
            ? "mixed"
            : "file_backed"
        : hasMergedEvidence
            ? "inline_only"
            : artifact.status === "invalid"
                ? "invalid"
                : "missing";
    const diagnostics = mergeDiagnosticEntries(mergeDiagnosticEntries(inline.diagnostics, artifact.diagnostics), buildDiagnostics(evidencePointers, linkedGraphNodes, relationPatterns, {
        importedFromGraphEvidence: hasImportedEvidence,
        graphEvidencePath,
        artifactStatus: artifact.status,
        inlineOnly: hasInlineEvidence && !hasImportedEvidence,
    }));
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
export function trackHasGraphBackedInnovationEvidence(track) {
    return resolveTrackInnovationEvidence(track).hasGraphBackedInnovationEvidence;
}
export function hasStoryFacingTrackGraphSupport(state) {
    return state.hasStoryFacingTrackGraphSupport;
}
