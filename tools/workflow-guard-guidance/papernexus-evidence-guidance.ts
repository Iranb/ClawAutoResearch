import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

export const DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_MD =
  "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md";

function resolveEvidencePacketPath(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): string {
  const packet = deps.asRecord(params.manifest?.papernexus_evidence_packet);
  return (
    deps.asString(packet?.markdown_path) ??
    deps.asString(packet?.markdownPath) ??
    deps.asString(packet?.path) ??
    DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_MD
  );
}

export function buildPapernexusEvidenceGuidance(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];
  const stage = params.currentStage ?? "";
  const isWritingStage = ["write", "review", "submit"].includes(stage);
  if (!isWritingStage) {
    return { prepend, append };
  }
  if (
    params.role !== "academic_writer" &&
    params.role !== "reviewer" &&
    params.role !== "cross-reviewer"
  ) {
    return { prepend, append };
  }

  const packetPath = resolveEvidencePacketPath(params, deps);
  append.push(
    `PaperNexus evidence boundary: use ${packetPath} plus source-backed graph/import artifacts for manuscript claims; unsupported claims become TODO/search requests rather than prose.`
  );
  append.push(
    "PaperNexus metadataGraph boundary: metadata-only candidates may guide coverage, taxonomy, related-work search, and limitations; they require literature_discovery supplement with Markdown/PDF source evidence before supporting claims, comparisons, or result figures."
  );

  if (params.role === "reviewer" || params.role === "cross-reviewer") {
    append.push(
      "Evidence review rule: separate supported, partial, and unsupported claims, then return write/weaken/defer/search_more guidance without treating model memory as evidence."
    );
  }

  return { prepend, append };
}
