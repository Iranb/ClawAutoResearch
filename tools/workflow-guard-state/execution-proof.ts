import { asRecord, normalizeStage, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type ExecutionProofState = {
  status: "missing" | "pending" | "ready" | "blocked";
  path: string | null;
  receiptCount: number;
  ledgerMatchedReceiptCount: number;
  lineageMatchedReceiptCount: number;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_EXECUTION_PROOF_PATH = "researcher/EXECUTION_PROOF.json";

export function normalizeExecutionProofState(value: unknown): ExecutionProofState {
  const record = asRecord(value) ?? {};
  const status = normalizeStage(record.status);
  return {
    status:
      status === "ready" ||
      status === "blocked" ||
      status === "pending" ||
      status === "missing"
        ? status
        : "missing",
    path: pickString(record, ["path"]) ?? DEFAULT_EXECUTION_PROOF_PATH,
    receiptCount: Math.max(0, Math.floor(pickNumber(record, ["receiptCount", "receipt_count"]) ?? 0)),
    ledgerMatchedReceiptCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["ledgerMatchedReceiptCount", "ledger_matched_receipt_count"]) ?? 0
      )
    ),
    lineageMatchedReceiptCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "lineageMatchedReceiptCount",
          "lineage_matched_receipt_count",
        ]) ?? 0
      )
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeExecutionProofState(
  value: ExecutionProofState
): Record<string, unknown> {
  return {
    status: value.status,
    path: value.path,
    receipt_count: value.receiptCount,
    ledger_matched_receipt_count: value.ledgerMatchedReceiptCount,
    lineage_matched_receipt_count: value.lineageMatchedReceiptCount,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
