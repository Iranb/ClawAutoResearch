import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickString,
} from "../workflow-guard-core/coercion";

export type TitleCandidate = {
  title: string;
  focus: string | null;
  alignment: string;
  riskFlags: string[];
};

export type TitleAbstractIntroWorkbenchState = {
  status: string;
  selectedTitle: string | null;
  titleCandidates: TitleCandidate[];
  titleCandidatesPath: string | null;
  abstractWorkbenchPath: string | null;
  introWorkbenchPath: string | null;
  alignmentStatus: string;
  workbenchFingerprint: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_TITLE_CANDIDATES_PATH =
  "academic_writer/TITLE_CANDIDATES.md";
export const DEFAULT_ABSTRACT_WORKBENCH_PATH =
  "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md";
export const DEFAULT_INTRO_WORKBENCH_PATH =
  "academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md";

function normalizeTitleCandidate(value: unknown): TitleCandidate | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const title = pickString(record, ["title"]);
  if (!title) {
    return null;
  }
  return {
    title,
    focus: pickString(record, ["focus"]),
    alignment: normalizeStage(record.alignment) ?? "unknown",
    riskFlags: asStringArray(record.riskFlags ?? record.risk_flags),
  };
}

function serializeTitleCandidate(
  value: TitleCandidate
): Record<string, unknown> {
  return {
    title: value.title,
    focus: value.focus,
    alignment: value.alignment,
    risk_flags: value.riskFlags,
  };
}

export function normalizeTitleAbstractIntroWorkbenchState(
  value: unknown
): TitleAbstractIntroWorkbenchState {
  const record = asRecord(value) ?? {};
  const candidatesRaw = Array.isArray(record.titleCandidates ?? record.title_candidates)
    ? ((record.titleCandidates ?? record.title_candidates) as unknown[])
    : [];
  return {
    status: normalizeStage(record.status) ?? "missing",
    selectedTitle: pickString(record, ["selectedTitle", "selected_title"]),
    titleCandidates: candidatesRaw
      .map((entry) => normalizeTitleCandidate(entry))
      .filter((entry): entry is TitleCandidate => Boolean(entry)),
    titleCandidatesPath:
      pickString(record, [
        "titleCandidatesPath",
        "title_candidates_path",
      ]) ?? DEFAULT_TITLE_CANDIDATES_PATH,
    abstractWorkbenchPath:
      pickString(record, [
        "abstractWorkbenchPath",
        "abstract_workbench_path",
      ]) ?? DEFAULT_ABSTRACT_WORKBENCH_PATH,
    introWorkbenchPath:
      pickString(record, [
        "introWorkbenchPath",
        "intro_workbench_path",
      ]) ?? DEFAULT_INTRO_WORKBENCH_PATH,
    alignmentStatus:
      normalizeStage(record.alignmentStatus ?? record.alignment_status) ?? "missing",
    workbenchFingerprint: pickString(record, [
      "workbenchFingerprint",
      "workbench_fingerprint",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeTitleAbstractIntroWorkbenchState(
  value: TitleAbstractIntroWorkbenchState
): Record<string, unknown> {
  return {
    status: value.status,
    selected_title: value.selectedTitle,
    title_candidates: value.titleCandidates.map((entry) =>
      serializeTitleCandidate(entry)
    ),
    title_candidates_path: value.titleCandidatesPath,
    abstract_workbench_path: value.abstractWorkbenchPath,
    intro_workbench_path: value.introWorkbenchPath,
    alignment_status: value.alignmentStatus,
    workbench_fingerprint: value.workbenchFingerprint,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
