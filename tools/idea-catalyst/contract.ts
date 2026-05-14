import * as path from "node:path";

import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import {
  DEFAULT_IDEA_CATALYST_CONTRACT_PATH,
  IDEA_CATALYST_CONTRACT_AUTHORITY,
} from "../workflow-authority-registry";

export type IdeaCatalystContractStatus =
  | "ready"
  | "requisition"
  | "blocked"
  | "failed";

export type IdeaCatalystContract = {
  schema_version: 1;
  authority: typeof IDEA_CATALYST_CONTRACT_AUTHORITY;
  status: IdeaCatalystContractStatus;
  source_requisition_report_path: string | null;
  graph_decision_path: string | null;
  literature_packet_path: string | null;
  payload_paths: string[];
  idea_fragments: Record<string, unknown>[];
  supporting_papers: string[];
  source_spans: Record<string, unknown>[];
  evidence_chain_refs: Record<string, unknown>[];
  claim_cap: "hypothesis" | "supported";
  reason: string;
  limitations: string[];
  created_at: string;
  updated_at: string;
};

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
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

export function normalizeIdeaCatalystContract(
  value: unknown
): IdeaCatalystContract | null {
  const record = asRecord(value);
  if (!record || record.authority !== IDEA_CATALYST_CONTRACT_AUTHORITY) {
    return null;
  }
  const status = normalizeStage(record.status);
  if (
    status !== "ready" &&
    status !== "requisition" &&
    status !== "blocked" &&
    status !== "failed"
  ) {
    return null;
  }
  return {
    schema_version: 1,
    authority: IDEA_CATALYST_CONTRACT_AUTHORITY,
    status,
    source_requisition_report_path:
      pickString(record, [
        "source_requisition_report_path",
        "sourceRequisitionReportPath",
      ]) ?? null,
    graph_decision_path:
      pickString(record, ["graph_decision_path", "graphDecisionPath"]) ?? null,
    literature_packet_path:
      pickString(record, ["literature_packet_path", "literaturePacketPath"]) ??
      null,
    payload_paths: asStringArray(record.payload_paths ?? record.payloadPaths),
    idea_fragments: recordList(record.idea_fragments ?? record.ideaFragments),
    supporting_papers: asStringArray(
      record.supporting_papers ?? record.supportingPapers
    ),
    source_spans: recordList(record.source_spans ?? record.sourceSpans),
    evidence_chain_refs: recordList(
      record.evidence_chain_refs ?? record.evidenceChainRefs
    ),
    claim_cap:
      pickString(record, ["claim_cap", "claimCap"]) === "supported"
        ? "supported"
        : "hypothesis",
    reason: pickString(record, ["reason"]) ?? "",
    limitations: asStringArray(record.limitations),
    created_at: pickString(record, ["created_at", "createdAt"]) ?? "",
    updated_at:
      pickString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]) ??
      "",
  };
}

export async function readIdeaCatalystContract(
  projectRoot: string
): Promise<IdeaCatalystContract | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, DEFAULT_IDEA_CATALYST_CONTRACT_PATH)
  );
  return normalizeIdeaCatalystContract(raw);
}

export function collectIdeaContractEvidenceFromBundle(value: unknown): {
  ideaFragments: Record<string, unknown>[];
  supportingPapers: string[];
  sourceSpans: Record<string, unknown>[];
  evidenceChainRefs: Record<string, unknown>[];
} {
  const bundle = unwrapPacketBundle(value);
  const ideaFragments = recordList(bundle?.idea_fragments ?? bundle?.ideaFragments);
  const sourceAnalyses = [
    ...recordList(bundle?.source_domain_analyses),
    ...recordList(bundle?.sourceDomainAnalyses),
    ...recordList(bundle?.cross_domain_analysis),
    ...recordList(bundle?.crossDomainAnalysis),
  ];
  const supportingPapers = uniqueStrings([
    ...ideaFragments.flatMap((fragment) =>
      asStringArray(fragment.supporting_papers ?? fragment.supportingPapers)
    ),
    ...sourceAnalyses.flatMap((analysis) =>
      asStringArray(analysis.supporting_papers ?? analysis.supportingPapers)
    ),
  ]);
  const sourceSpans = ideaFragments.flatMap((fragment) =>
    recordList(fragment.source_spans ?? fragment.sourceSpans)
  );
  const evidenceChainRefs = ideaFragments.flatMap((fragment) =>
    recordList(fragment.evidence_chain_refs ?? fragment.evidenceChainRefs)
  );
  return {
    ideaFragments,
    supportingPapers,
    sourceSpans,
    evidenceChainRefs,
  };
}

export async function writeIdeaCatalystContract(params: {
  projectRoot: string;
  status: IdeaCatalystContractStatus;
  sourceRequisitionReportPath?: string | null;
  graphDecisionPath?: string | null;
  literaturePacketPath?: string | null;
  payloadPaths?: string[];
  ideaFragments?: Record<string, unknown>[];
  supportingPapers?: string[];
  sourceSpans?: Record<string, unknown>[];
  evidenceChainRefs?: Record<string, unknown>[];
  claimCap?: "hypothesis" | "supported";
  reason: string;
  limitations?: string[];
  now: string;
}): Promise<string> {
  const contract: IdeaCatalystContract = {
    schema_version: 1,
    authority: IDEA_CATALYST_CONTRACT_AUTHORITY,
    status: params.status,
    source_requisition_report_path: params.sourceRequisitionReportPath ?? null,
    graph_decision_path: params.graphDecisionPath ?? null,
    literature_packet_path: params.literaturePacketPath ?? null,
    payload_paths: uniqueStrings(params.payloadPaths ?? []),
    idea_fragments: params.ideaFragments ?? [],
    supporting_papers: uniqueStrings(params.supportingPapers ?? []),
    source_spans: params.sourceSpans ?? [],
    evidence_chain_refs: params.evidenceChainRefs ?? [],
    claim_cap: params.claimCap ?? "hypothesis",
    reason: params.reason,
    limitations: params.limitations ?? [],
    created_at: params.now,
    updated_at: params.now,
  };
  await writeJsonEnsured(
    path.join(params.projectRoot, DEFAULT_IDEA_CATALYST_CONTRACT_PATH),
    contract
  );
  return DEFAULT_IDEA_CATALYST_CONTRACT_PATH;
}
