import { asRecord, asStringArray, normalizeStage, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type RevisionControlSource = {
  sourceType:
    | "file_audit"
    | "review_session"
    | "review_issue_tracker"
    | "external_review"
    | "rebuttal_response";
  sourceId: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  summary: string | null;
  artifactPaths: string[];
  reviewerRole: string | null;
};

export type RevisionControlState = {
  status: "idle" | "active" | "ready_for_recheck" | "blocked" | "complete";
  revisionRound: number;
  sourceStage: string | null;
  currentOwner: string | null;
  nextReviewerRole: string | null;
  activeRevisionPacketPath: string | null;
  aggregateRevisionMarkdownPath: string | null;
  openSources: RevisionControlSource[];
  requiredWriterArtifacts: string[];
  requiredReviewerArtifacts: string[];
  requiredCrossReviewArtifacts: string[];
  lastRevisionDispatchAt: string | null;
  lastRecheckRequestedAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

function normalizeSeverity(value: unknown): RevisionControlSource["severity"] {
  const normalized = normalizeStage(value);
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return "medium";
}

function normalizeSourceStatus(value: unknown): RevisionControlSource["status"] {
  return normalizeStage(value) === "resolved" ? "resolved" : "open";
}

function normalizeRevisionSource(value: unknown): RevisionControlSource | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const sourceType = pickString(record, ["sourceType", "source_type"]);
  const sourceId = pickString(record, ["sourceId", "source_id"]);
  if (!sourceType || !sourceId) {
    return null;
  }
  if (
    sourceType !== "file_audit" &&
    sourceType !== "review_session" &&
    sourceType !== "review_issue_tracker" &&
    sourceType !== "external_review" &&
    sourceType !== "rebuttal_response"
  ) {
    return null;
  }
  return {
    sourceType,
    sourceId,
    severity: normalizeSeverity(record.severity),
    status: normalizeSourceStatus(record.status),
    summary: pickString(record, ["summary"]),
    artifactPaths: asStringArray(record.artifactPaths ?? record.artifact_paths),
    reviewerRole: pickString(record, ["reviewerRole", "reviewer_role"]),
  };
}

function serializeRevisionSource(value: RevisionControlSource): Record<string, unknown> {
  return {
    source_type: value.sourceType,
    source_id: value.sourceId,
    severity: value.severity,
    status: value.status,
    summary: value.summary,
    artifact_paths: value.artifactPaths,
    reviewer_role: value.reviewerRole,
  };
}

export function normalizeRevisionControlState(value: unknown): RevisionControlState {
  const record = asRecord(value) ?? {};
  const status = normalizeStage(record.status);
  return {
    status:
      status === "active" ||
      status === "ready_for_recheck" ||
      status === "blocked" ||
      status === "complete"
        ? status
        : "idle",
    revisionRound: Math.max(0, Math.floor(pickNumber(record, ["revisionRound", "revision_round"]) ?? 0)),
    sourceStage: normalizeStage(record.sourceStage ?? record.source_stage),
    currentOwner: pickString(record, ["currentOwner", "current_owner"]),
    nextReviewerRole: pickString(record, ["nextReviewerRole", "next_reviewer_role"]),
    activeRevisionPacketPath: pickString(record, [
      "activeRevisionPacketPath",
      "active_revision_packet_path",
    ]),
    aggregateRevisionMarkdownPath: pickString(record, [
      "aggregateRevisionMarkdownPath",
      "aggregate_revision_markdown_path",
    ]),
    openSources: Array.isArray(record.openSources ?? record.open_sources)
      ? ((record.openSources ?? record.open_sources) as unknown[])
          .map((entry: unknown) => normalizeRevisionSource(entry))
          .filter((entry: RevisionControlSource | null): entry is RevisionControlSource => Boolean(entry))
      : [],
    requiredWriterArtifacts: asStringArray(
      record.requiredWriterArtifacts ?? record.required_writer_artifacts
    ),
    requiredReviewerArtifacts: asStringArray(
      record.requiredReviewerArtifacts ?? record.required_reviewer_artifacts
    ),
    requiredCrossReviewArtifacts: asStringArray(
      record.requiredCrossReviewArtifacts ?? record.required_cross_review_artifacts
    ),
    lastRevisionDispatchAt: pickString(record, [
      "lastRevisionDispatchAt",
      "last_revision_dispatch_at",
    ]),
    lastRecheckRequestedAt: pickString(record, [
      "lastRecheckRequestedAt",
      "last_recheck_requested_at",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeRevisionControlState(
  value: RevisionControlState
): Record<string, unknown> {
  return {
    status: value.status,
    revision_round: value.revisionRound,
    source_stage: value.sourceStage,
    current_owner: value.currentOwner,
    next_reviewer_role: value.nextReviewerRole,
    active_revision_packet_path: value.activeRevisionPacketPath,
    aggregate_revision_markdown_path: value.aggregateRevisionMarkdownPath,
    open_sources: value.openSources.map((entry) => serializeRevisionSource(entry)),
    required_writer_artifacts: value.requiredWriterArtifacts,
    required_reviewer_artifacts: value.requiredReviewerArtifacts,
    required_cross_review_artifacts: value.requiredCrossReviewArtifacts,
    last_revision_dispatch_at: value.lastRevisionDispatchAt,
    last_recheck_requested_at: value.lastRecheckRequestedAt,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
