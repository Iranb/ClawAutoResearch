import * as path from "node:path";

import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickString,
} from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import {
  DEFAULT_GRAPH_BUILD_DECISION_PATH,
  GRAPH_BUILD_DECISION_AUTHORITY,
} from "./workflow-authority-registry";

export type GraphBuildDecisionState =
  | "complete"
  | "waiting"
  | "blocked"
  | "failed";

export type GraphBuildDecision = {
  schema_version: 1;
  authority: typeof GRAPH_BUILD_DECISION_AUTHORITY;
  decision: GraphBuildDecisionState;
  status: GraphBuildDecisionState;
  request_id: string | null;
  requisition_satisfaction_report_path: string | null;
  graph_presence_report_path: string | null;
  graph_receipt_path: string | null;
  source_index_path: string | null;
  source_backed_graph_claim: boolean;
  reason: string;
  limitations: string[];
  created_at: string;
  updated_at: string;
};

export function normalizeGraphBuildDecision(
  value: unknown
): GraphBuildDecision | null {
  const record = asRecord(value);
  if (!record || record.authority !== GRAPH_BUILD_DECISION_AUTHORITY) {
    return null;
  }
  const decision = normalizeStage(record.decision ?? record.status);
  if (
    decision !== "complete" &&
    decision !== "waiting" &&
    decision !== "blocked" &&
    decision !== "failed"
  ) {
    return null;
  }
  const now = pickString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]) ?? "";
  return {
    schema_version: 1,
    authority: GRAPH_BUILD_DECISION_AUTHORITY,
    decision,
    status: decision,
    request_id: pickString(record, ["request_id", "requestId"]) ?? null,
    requisition_satisfaction_report_path:
      pickString(record, [
        "requisition_satisfaction_report_path",
        "requisitionSatisfactionReportPath",
      ]) ?? null,
    graph_presence_report_path:
      pickString(record, ["graph_presence_report_path", "graphPresenceReportPath"]) ??
      null,
    graph_receipt_path:
      pickString(record, ["graph_receipt_path", "graphReceiptPath"]) ?? null,
    source_index_path:
      pickString(record, ["source_index_path", "sourceIndexPath"]) ?? null,
    source_backed_graph_claim:
      pickBoolean(record, ["source_backed_graph_claim", "sourceBackedGraphClaim"]) ===
      true,
    reason: pickString(record, ["reason"]) ?? "",
    limitations: asStringArray(record.limitations),
    created_at: pickString(record, ["created_at", "createdAt"]) ?? now,
    updated_at: now,
  };
}

export async function readGraphBuildDecision(
  projectRoot: string
): Promise<GraphBuildDecision | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, DEFAULT_GRAPH_BUILD_DECISION_PATH)
  );
  return normalizeGraphBuildDecision(raw);
}

export async function writeGraphBuildDecision(params: {
  projectRoot: string;
  decision: GraphBuildDecisionState;
  requestId?: string | null;
  requisitionSatisfactionReportPath?: string | null;
  graphPresenceReportPath?: string | null;
  graphReceiptPath?: string | null;
  sourceIndexPath?: string | null;
  sourceBackedGraphClaim?: boolean | null;
  reason: string;
  limitations?: string[];
  now: string;
}): Promise<string> {
  const decisionPath = path.join(
    params.projectRoot,
    DEFAULT_GRAPH_BUILD_DECISION_PATH
  );
  const payload: GraphBuildDecision = {
    schema_version: 1,
    authority: GRAPH_BUILD_DECISION_AUTHORITY,
    decision: params.decision,
    status: params.decision,
    request_id: params.requestId ?? null,
    requisition_satisfaction_report_path:
      params.requisitionSatisfactionReportPath ?? null,
    graph_presence_report_path: params.graphPresenceReportPath ?? null,
    graph_receipt_path: params.graphReceiptPath ?? null,
    source_index_path: params.sourceIndexPath ?? null,
    source_backed_graph_claim: params.sourceBackedGraphClaim === true,
    reason: params.reason,
    limitations: params.limitations ?? [],
    created_at: params.now,
    updated_at: params.now,
  };
  await writeJsonAtomicEnsured(decisionPath, payload);
  return DEFAULT_GRAPH_BUILD_DECISION_PATH;
}
