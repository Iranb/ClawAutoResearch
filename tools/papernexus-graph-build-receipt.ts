import * as path from "node:path";
import { writeJsonEnsured } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";

export const DEFAULT_PAPERNEXUS_GRAPH_BUILD_RECEIPT_PATH =
  "graph/PAPERNEXUS_GRAPH_BUILD_RECEIPT.json";

export type PapernexusGraphBuildReceiptStatus =
  | "waiting_import"
  | "waiting_graph_commit"
  | "source_blocked"
  | "graph_ready"
  | "evidence_ready"
  | "failed";

export type PapernexusGraphBuildReceipt = {
  schema_version: 1;
  request_id: string | null;
  run_id: string | null;
  corpus: string | null;
  status: PapernexusGraphBuildReceiptStatus;
  graph_visibility: "verified" | "unverified" | "unavailable";
  graph_fingerprint: string | null;
  checked_at: string;
  canonical_ids_requested: string[];
  canonical_ids_in_graph: string[];
  canonical_ids_missing: string[];
  source_backed_count: number;
  metadata_only_count: number;
  source_backed_graph_claim: boolean;
  active_in_graph_sources: string[];
  task_summary: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    remaining: number;
  };
  coverage: {
    min_required_satisfied: boolean;
    min_source_backed_papers: number;
    notes: string[];
  };
  evidence_packet_path: string | null;
  limitations: string[];
  repair_hints: string[];
};

export async function writePapernexusGraphBuildReceipt(params: {
  projectRoot: string;
  receipt: PapernexusGraphBuildReceipt;
}): Promise<string> {
  const receiptPath = DEFAULT_PAPERNEXUS_GRAPH_BUILD_RECEIPT_PATH;
  const resolvedPath =
    resolveProjectArtifactPath(params.projectRoot, receiptPath) ??
    path.join(params.projectRoot, receiptPath);
  await writeJsonEnsured(resolvedPath, params.receipt);
  return receiptPath;
}
