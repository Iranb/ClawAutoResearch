import { asRecord, normalizeStage, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type ExecutionProofState = {
  status: "missing" | "pending" | "ready" | "blocked";
  path: string | null;
  receiptCount: number;
  ledgerMatchedReceiptCount: number;
  lineageMatchedReceiptCount: number;
  candidateCommit: string | null;
  expectedStageRunId: string | null;
  primaryReceiptExperimentId: string | null;
  primaryReceiptRunId: string | null;
  primaryReceiptStageRunId: string | null;
  primaryReceiptGitCommit: string | null;
  primaryReceiptPath: string | null;
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
    candidateCommit: pickString(record, ["candidateCommit", "candidate_commit"]),
    expectedStageRunId: pickString(record, ["expectedStageRunId", "expected_stage_run_id"]),
    primaryReceiptExperimentId: pickString(record, [
      "primaryReceiptExperimentId",
      "primary_receipt_experiment_id",
    ]),
    primaryReceiptRunId: pickString(record, ["primaryReceiptRunId", "primary_receipt_run_id"]),
    primaryReceiptStageRunId: pickString(record, [
      "primaryReceiptStageRunId",
      "primary_receipt_stage_run_id",
    ]),
    primaryReceiptGitCommit: pickString(record, [
      "primaryReceiptGitCommit",
      "primary_receipt_git_commit",
    ]),
    primaryReceiptPath: pickString(record, ["primaryReceiptPath", "primary_receipt_path"]),
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
    candidate_commit: value.candidateCommit,
    expected_stage_run_id: value.expectedStageRunId,
    primary_receipt_experiment_id: value.primaryReceiptExperimentId,
    primary_receipt_run_id: value.primaryReceiptRunId,
    primary_receipt_stage_run_id: value.primaryReceiptStageRunId,
    primary_receipt_git_commit: value.primaryReceiptGitCommit,
    primary_receipt_path: value.primaryReceiptPath,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
