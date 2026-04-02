import { asRecord, normalizeStage, pickString } from "../workflow-guard-core/coercion";
import type { ReviewPressurePacketState } from "../workflow-guard.js";

const DEFAULT_REVIEW_PRESSURE_DIR = "reviewer/story-pressure";
const DEFAULT_REJECT_FIRST_REVIEW_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/REJECT_FIRST_REVIEW.md`;
const DEFAULT_NOVELTY_ATTACK_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/NOVELTY_ATTACK.md`;
const DEFAULT_UNSUPPORTED_CLAIM_AUDIT_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/UNSUPPORTED_CLAIM_AUDIT.md`;
const DEFAULT_REVERSE_OUTLINE_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/REVERSE_OUTLINE.md`;
const DEFAULT_FIGURE_TABLE_QC_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/FIGURE_TABLE_QC.md`;
const DEFAULT_LIMITATION_AUDIT_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/LIMITATION_AUDIT.md`;

export function normalizeReviewPressurePacketState(
  value: unknown
): ReviewPressurePacketState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    rejectFirstReviewPath:
      pickString(record, [
        "rejectFirstReviewPath",
        "reject_first_review_path",
      ]) ?? DEFAULT_REJECT_FIRST_REVIEW_PATH,
    noveltyAttackPath:
      pickString(record, ["noveltyAttackPath", "novelty_attack_path"]) ??
      DEFAULT_NOVELTY_ATTACK_PATH,
    unsupportedClaimAuditPath:
      pickString(record, [
        "unsupportedClaimAuditPath",
        "unsupported_claim_audit_path",
      ]) ?? DEFAULT_UNSUPPORTED_CLAIM_AUDIT_PATH,
    reverseOutlinePath:
      pickString(record, ["reverseOutlinePath", "reverse_outline_path"]) ??
      DEFAULT_REVERSE_OUTLINE_PATH,
    figureTableQcPath:
      pickString(record, ["figureTableQcPath", "figure_table_qc_path"]) ??
      DEFAULT_FIGURE_TABLE_QC_PATH,
    limitationAuditPath:
      pickString(record, ["limitationAuditPath", "limitation_audit_path"]) ??
      DEFAULT_LIMITATION_AUDIT_PATH,
    statusReason: pickString(record, ["statusReason", "status_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeReviewPressurePacketState(
  value: ReviewPressurePacketState
): Record<string, unknown> {
  return {
    status: value.status,
    reject_first_review_path: value.rejectFirstReviewPath,
    novelty_attack_path: value.noveltyAttackPath,
    unsupported_claim_audit_path: value.unsupportedClaimAuditPath,
    reverse_outline_path: value.reverseOutlinePath,
    figure_table_qc_path: value.figureTableQcPath,
    limitation_audit_path: value.limitationAuditPath,
    status_reason: value.statusReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
