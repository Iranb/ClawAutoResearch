import { asRecord, asStringArray, normalizeStage, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type ParagraphLogicAuditState = {
  status: "missing" | "pending" | "ready" | "blocked";
  auditJsonPath: string | null;
  auditReportPath: string | null;
  reverseOutlinePath: string | null;
  auditedSectionCount: number;
  multiParagraphSectionCount: number;
  auditedParagraphCount: number;
  blockingIssueCount: number;
  advisoryIssueCount: number;
  sectionTransitionBlockingIssueCount: number;
  sectionTransitionAdvisoryIssueCount: number;
  weakestSections: string[];
  nextRepairAction: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH =
  "academic_writer/PARAGRAPH_LOGIC_AUDIT.json";
export const DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH =
  "academic_writer/PARAGRAPH_LOGIC_AUDIT.md";
export const DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH =
  "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md";

export function normalizeParagraphLogicAuditState(
  value: unknown
): ParagraphLogicAuditState {
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
    auditJsonPath:
      pickString(record, ["auditJsonPath", "audit_json_path"]) ??
      DEFAULT_PARAGRAPH_LOGIC_AUDIT_JSON_PATH,
    auditReportPath:
      pickString(record, ["auditReportPath", "audit_report_path"]) ??
      DEFAULT_PARAGRAPH_LOGIC_AUDIT_REPORT_PATH,
    reverseOutlinePath:
      pickString(record, ["reverseOutlinePath", "reverse_outline_path"]) ??
      DEFAULT_PARAGRAPH_LOGIC_REVERSE_OUTLINE_PATH,
    auditedSectionCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["auditedSectionCount", "audited_section_count"]) ?? 0)
    ),
    multiParagraphSectionCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "multiParagraphSectionCount",
          "multi_paragraph_section_count",
        ]) ?? 0
      )
    ),
    auditedParagraphCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["auditedParagraphCount", "audited_paragraph_count"]) ?? 0)
    ),
    blockingIssueCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["blockingIssueCount", "blocking_issue_count"]) ?? 0)
    ),
    advisoryIssueCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["advisoryIssueCount", "advisory_issue_count"]) ?? 0)
    ),
    sectionTransitionBlockingIssueCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "sectionTransitionBlockingIssueCount",
          "section_transition_blocking_issue_count",
        ]) ?? 0
      )
    ),
    sectionTransitionAdvisoryIssueCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "sectionTransitionAdvisoryIssueCount",
          "section_transition_advisory_issue_count",
        ]) ?? 0
      )
    ),
    weakestSections: asStringArray(record.weakestSections ?? record.weakest_sections),
    nextRepairAction: pickString(record, ["nextRepairAction", "next_repair_action"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeParagraphLogicAuditState(
  value: ParagraphLogicAuditState
): Record<string, unknown> {
  return {
    status: value.status,
    audit_json_path: value.auditJsonPath,
    audit_report_path: value.auditReportPath,
    reverse_outline_path: value.reverseOutlinePath,
    audited_section_count: value.auditedSectionCount,
    multi_paragraph_section_count: value.multiParagraphSectionCount,
    audited_paragraph_count: value.auditedParagraphCount,
    blocking_issue_count: value.blockingIssueCount,
    advisory_issue_count: value.advisoryIssueCount,
    section_transition_blocking_issue_count: value.sectionTransitionBlockingIssueCount,
    section_transition_advisory_issue_count: value.sectionTransitionAdvisoryIssueCount,
    weakest_sections: value.weakestSections,
    next_repair_action: value.nextRepairAction,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
