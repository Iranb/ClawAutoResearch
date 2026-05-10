import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

export const DEFAULT_PAPERNEXUS_EVIDENCE_INPUT_PATH =
  "researcher/papernexus/PAPERNEXUS_EVIDENCE_INPUT.json";
export const DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_PATH =
  "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.json";
export const DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_MD_PATH =
  "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md";

export type PapernexusEvidenceStatus = "supported" | "partial" | "unsupported";
export type PapernexusRecommendedAction = "write" | "weaken" | "defer" | "search_more";

export type PapernexusEvidenceClaim = {
  claim_id: string;
  claim_text: string;
  evidence_status: PapernexusEvidenceStatus;
  source_nodes: string[];
  source_artifacts: string[];
  citation_keys_if_known: string[];
  missing_evidence: string[];
  recommended_action: PapernexusRecommendedAction;
};

export type PapernexusEvidenceBaseline = {
  family_name: string;
  representative_papers: string[];
  why_it_is_relevant: string | null;
  fairness_boundary: string | null;
  has_direct_comparison_data: boolean;
  source_artifacts: string[];
};

export type PapernexusFigureEvidence = {
  figure_id: string;
  evidence_status: PapernexusEvidenceStatus;
  source_artifacts: string[];
  missing_evidence: string[];
};

export type PapernexusEvidencePacket = {
  schema_version: 1;
  status: "ready" | "empty";
  created_at: string;
  evidence_boundary: string;
  source_artifacts: string[];
  summary: {
    supported_claim_count: number;
    partial_claim_count: number;
    unsupported_claim_count: number;
    baseline_family_count: number;
    figure_evidence_count: number;
  };
  claims: PapernexusEvidenceClaim[];
  baselines: PapernexusEvidenceBaseline[];
  figure_evidence: PapernexusFigureEvidence[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function readRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function readStringList(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.flatMap((entry) => {
        const direct = asString(entry);
        if (direct) {
          return [direct];
        }
        const record = asRecord(entry);
        if (!record) {
          return [];
        }
        for (const key of keys) {
          const candidate = asString(record[key]);
          if (candidate) {
            return [candidate];
          }
        }
        return [];
      })
    );
  }
  const direct = asString(value);
  return direct ? [direct] : [];
}

function normalizeEvidenceStatus(value: unknown): PapernexusEvidenceStatus | null {
  const normalized = normalizeStage(value);
  if (
    normalized === "supported" ||
    normalized === "partial" ||
    normalized === "unsupported"
  ) {
    return normalized;
  }
  return null;
}

function deriveEvidenceStatus(params: {
  explicit: unknown;
  sourceNodes: string[];
  sourceArtifacts: string[];
  citationKeys: string[];
}): PapernexusEvidenceStatus {
  const explicit = normalizeEvidenceStatus(params.explicit);
  if (explicit) {
    return explicit;
  }
  if (params.sourceNodes.length > 0 && params.sourceArtifacts.length > 0) {
    return "supported";
  }
  if (
    params.sourceNodes.length > 0 ||
    params.sourceArtifacts.length > 0 ||
    params.citationKeys.length > 0
  ) {
    return "partial";
  }
  return "unsupported";
}

function normalizeRecommendedAction(
  value: unknown,
  status: PapernexusEvidenceStatus,
  missingEvidence: string[]
): PapernexusRecommendedAction {
  const normalized = normalizeStage(value);
  if (
    normalized === "write" ||
    normalized === "weaken" ||
    normalized === "defer" ||
    normalized === "search_more"
  ) {
    return normalized;
  }
  if (status === "supported") {
    return "write";
  }
  if (status === "partial") {
    return "weaken";
  }
  return missingEvidence.length > 0 ? "search_more" : "defer";
}

function normalizeClaim(
  record: Record<string, unknown>,
  index: number
): PapernexusEvidenceClaim {
  const sourceNodes = readStringList(
    record.source_nodes ?? record.sourceNodes ?? record.source_backed_nodes,
    ["node_id", "nodeId", "id", "title", "name"]
  );
  const sourceArtifacts = readStringList(
    record.source_artifacts ?? record.sourceArtifacts ?? record.artifacts,
    ["path", "artifact_path", "artifactPath", "source"]
  );
  const citationKeys = readStringList(
    record.citation_keys_if_known ??
      record.citationKeysIfKnown ??
      record.citation_keys ??
      record.citationKeys,
    ["key", "citation_key", "citationKey"]
  );
  const missingEvidence = readStringList(
    record.missing_evidence ?? record.missingEvidence,
    ["reason", "item", "text"]
  );
  const evidenceStatus = deriveEvidenceStatus({
    explicit: record.evidence_status ?? record.evidenceStatus,
    sourceNodes,
    sourceArtifacts,
    citationKeys,
  });

  return {
    claim_id:
      pickString(record, ["claim_id", "claimId", "id"]) ?? `claim-${index + 1}`,
    claim_text:
      pickString(record, ["claim_text", "claimText", "claim", "text"]) ??
      "TODO: unspecified claim text",
    evidence_status: evidenceStatus,
    source_nodes: sourceNodes,
    source_artifacts: sourceArtifacts,
    citation_keys_if_known: citationKeys,
    missing_evidence: missingEvidence,
    recommended_action: normalizeRecommendedAction(
      record.recommended_action ?? record.recommendedAction,
      evidenceStatus,
      missingEvidence
    ),
  };
}

function normalizeBaseline(
  record: Record<string, unknown>,
  index: number
): PapernexusEvidenceBaseline {
  return {
    family_name:
      pickString(record, ["family_name", "familyName", "name"]) ??
      `baseline-family-${index + 1}`,
    representative_papers: readStringList(
      record.representative_papers ?? record.representativePapers ?? record.papers,
      ["title", "paper_title", "paperTitle", "citation_key", "citationKey"]
    ),
    why_it_is_relevant: pickString(record, [
      "why_it_is_relevant",
      "whyItIsRelevant",
      "relevance",
    ]),
    fairness_boundary: pickString(record, [
      "fairness_boundary",
      "fairnessBoundary",
      "boundary",
    ]),
    has_direct_comparison_data:
      pickBoolean(record, [
        "has_direct_comparison_data",
        "hasDirectComparisonData",
        "direct_comparison_data",
        "directComparisonData",
      ]) ?? false,
    source_artifacts: readStringList(
      record.source_artifacts ?? record.sourceArtifacts,
      ["path", "artifact_path", "artifactPath", "source"]
    ),
  };
}

function normalizeFigureEvidence(
  record: Record<string, unknown>,
  index: number
): PapernexusFigureEvidence {
  const sourceArtifacts = readStringList(
    record.source_artifacts ?? record.sourceArtifacts ?? record.artifacts,
    ["path", "artifact_path", "artifactPath", "source"]
  );
  const missingEvidence = readStringList(
    record.missing_evidence ?? record.missingEvidence,
    ["reason", "item", "text"]
  );
  return {
    figure_id:
      pickString(record, ["figure_id", "figureId", "id"]) ?? `figure-${index + 1}`,
    evidence_status: deriveEvidenceStatus({
      explicit: record.evidence_status ?? record.evidenceStatus,
      sourceNodes: readStringList(record.source_nodes ?? record.sourceNodes, [
        "node_id",
        "nodeId",
        "id",
      ]),
      sourceArtifacts,
      citationKeys: [],
    }),
    source_artifacts: sourceArtifacts,
    missing_evidence: missingEvidence,
  };
}

function collectInputRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return (
    asRecord(record.papernexus_evidence) ??
    asRecord(record.paper_nexus_evidence) ??
    asRecord(record.evidence_packet_input) ??
    record
  );
}

export function buildPapernexusEvidencePacket(params: {
  input: unknown;
  createdAt?: string | null;
  sourceArtifacts?: string[] | null;
}): PapernexusEvidencePacket {
  const input = collectInputRecord(params.input);
  const claims = readRecordList(
    input.claims ?? input.candidate_claims ?? input.claim_evidence
  ).map((entry, index) => normalizeClaim(entry, index));
  const baselines = readRecordList(
    input.baselines ?? input.baseline_families ?? input.prior_work_families
  ).map((entry, index) => normalizeBaseline(entry, index));
  const figureEvidence = readRecordList(
    input.figure_evidence ?? input.figures ?? input.figureEvidence
  ).map((entry, index) => normalizeFigureEvidence(entry, index));
  const sourceArtifacts = uniqueStrings([
    ...asStringArray(input.source_artifacts ?? input.sourceArtifacts),
    ...(params.sourceArtifacts ?? []),
    ...claims.flatMap((claim) => claim.source_artifacts),
    ...baselines.flatMap((baseline) => baseline.source_artifacts),
    ...figureEvidence.flatMap((figure) => figure.source_artifacts),
  ]);

  return {
    schema_version: 1,
    status:
      claims.length > 0 || baselines.length > 0 || figureEvidence.length > 0
        ? "ready"
        : "empty",
    created_at: params.createdAt ?? nowIso(),
    evidence_boundary:
      "Use only source-backed graph nodes, imported paper packets, verified metadata, experiment artifacts, and user-provided files. Do not treat model memory as PaperNexus evidence.",
    source_artifacts: sourceArtifacts,
    summary: {
      supported_claim_count: claims.filter(
        (claim) => claim.evidence_status === "supported"
      ).length,
      partial_claim_count: claims.filter(
        (claim) => claim.evidence_status === "partial"
      ).length,
      unsupported_claim_count: claims.filter(
        (claim) => claim.evidence_status === "unsupported"
      ).length,
      baseline_family_count: baselines.length,
      figure_evidence_count: figureEvidence.length,
    },
    claims,
    baselines,
    figure_evidence: figureEvidence,
  };
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function renderPapernexusEvidencePacketMarkdown(
  packet: PapernexusEvidencePacket
): string {
  const claimRows =
    packet.claims.length > 0
      ? packet.claims
          .map(
            (claim) =>
              `| ${claim.claim_id} | ${claim.evidence_status} | ${claim.recommended_action} | ${claim.claim_text} | ${renderList(claim.source_artifacts)} | ${renderList(claim.missing_evidence)} |`
          )
          .join("\n")
      : "| none | unsupported | defer | No claims were supplied. | none | add PaperNexus evidence input |";
  const baselineRows =
    packet.baselines.length > 0
      ? packet.baselines
          .map(
            (baseline) =>
              `| ${baseline.family_name} | ${renderList(baseline.representative_papers)} | ${baseline.has_direct_comparison_data ? "yes" : "no"} | ${baseline.fairness_boundary ?? "unset"} |`
          )
          .join("\n")
      : "| none | none | no | unset |";
  const figureRows =
    packet.figure_evidence.length > 0
      ? packet.figure_evidence
          .map(
            (figure) =>
              `| ${figure.figure_id} | ${figure.evidence_status} | ${renderList(figure.source_artifacts)} | ${renderList(figure.missing_evidence)} |`
          )
          .join("\n")
      : "| none | unsupported | none | add figure evidence or keep a placeholder |";

  return [
    "# PaperNexus Evidence Packet",
    "",
    `Created: ${packet.created_at}`,
    "",
    "## Evidence Boundary",
    "",
    packet.evidence_boundary,
    "",
    "## Summary",
    "",
    `- Supported claims: ${packet.summary.supported_claim_count}`,
    `- Partial claims: ${packet.summary.partial_claim_count}`,
    `- Unsupported claims: ${packet.summary.unsupported_claim_count}`,
    `- Baseline families: ${packet.summary.baseline_family_count}`,
    `- Figure evidence entries: ${packet.summary.figure_evidence_count}`,
    "",
    "## Claims",
    "",
    "| Claim ID | Status | Action | Claim | Source Artifacts | Missing Evidence |",
    "|---|---|---|---|---|---|",
    claimRows,
    "",
    "## Baselines",
    "",
    "| Family | Representative Papers | Direct Comparison Data | Fairness Boundary |",
    "|---|---|---|---|",
    baselineRows,
    "",
    "## Figure Evidence",
    "",
    "| Figure | Status | Source Artifacts | Missing Evidence |",
    "|---|---|---|---|",
    figureRows,
    "",
  ].join("\n");
}

export async function materializePapernexusEvidencePacket(params: {
  projectRoot: string;
  input?: unknown;
  inputPath?: string | null;
  outputPath?: string | null;
  markdownPath?: string | null;
  createdAt?: string | null;
}): Promise<{
  packetPath: string;
  markdownPath: string;
  generatedFiles: string[];
  packet: PapernexusEvidencePacket;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath =
    resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ??
    path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const inputPath = params.inputPath ?? DEFAULT_PAPERNEXUS_EVIDENCE_INPUT_PATH;
  const resolvedInputPath = resolveProjectArtifactPath(projectRoot, inputPath);
  const input =
    params.input ??
    (await readJsonIfExists<Record<string, unknown>>(resolvedInputPath)) ??
    asRecord(manifest.papernexus_evidence) ??
    {};
  const packet = buildPapernexusEvidencePacket({
    input,
    createdAt: params.createdAt,
    sourceArtifacts: inputPath ? [inputPath] : [],
  });
  const packetPath = params.outputPath ?? DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_PATH;
  const markdownPath =
    params.markdownPath ?? DEFAULT_PAPERNEXUS_EVIDENCE_PACKET_MD_PATH;
  const resolvedPacketPath =
    resolveProjectArtifactPath(projectRoot, packetPath) ??
    path.join(projectRoot, packetPath);
  const resolvedMarkdownPath =
    resolveProjectArtifactPath(projectRoot, markdownPath) ??
    path.join(projectRoot, markdownPath);

  await writeJsonEnsured(resolvedPacketPath, packet);
  await writeTextEnsured(
    resolvedMarkdownPath,
    renderPapernexusEvidencePacketMarkdown(packet)
  );

  manifest.papernexus_evidence_packet = {
    schema_version: 1,
    status: packet.status,
    json_path: packetPath,
    markdown_path: markdownPath,
    supported_claim_count: packet.summary.supported_claim_count,
    partial_claim_count: packet.summary.partial_claim_count,
    unsupported_claim_count: packet.summary.unsupported_claim_count,
    last_updated_at: packet.created_at,
  };
  await writeJsonEnsured(manifestPath, manifest);

  return {
    packetPath,
    markdownPath,
    generatedFiles: [packetPath, markdownPath, "PROJECT_MANIFEST.json"],
    packet,
  };
}
