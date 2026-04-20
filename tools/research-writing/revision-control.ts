import * as path from "node:path";

import { readJsonIfExists, readTextIfExists, writeJsonEnsured, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeExternalReviewState,
  normalizeReviewSessionState,
} from "../workflow-guard-state/authoring-review-state";
import { normalizeReviewIssueTrackerState } from "../workflow-guard-state/execution-state";
import {
  normalizeRevisionControlState,
  serializeRevisionControlState,
  type RevisionControlSource,
  type RevisionControlState,
} from "../workflow-guard-state/revision-control";
import { normalizeParagraphLogicAuditState } from "../workflow-guard-state/paragraph-logic-audit";
import { readWorkflowHooksStateStore } from "../workflow-hooks/state.js";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import {
  hydrateReviewIssueTrackerState,
  hasBlockingReviewIssues,
  hasUnwaivedMediumOrHigherReviewIssues,
} from "../workflow-guard-writing/paper-quality-eval";

export const DEFAULT_REVISION_CONTROL_PACKET_JSON_PATH =
  "reviewer/REVISION_CONTROL_PACKET.json";
export const DEFAULT_REVISION_CONTROL_PACKET_MD_PATH =
  "reviewer/REVISION_CONTROL_PACKET.md";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function buildIssueTrackerSources(
  issueTracker: ReturnType<typeof normalizeReviewIssueTrackerState>
): RevisionControlSource[] {
  const detailedSources = issueTracker.issues
    .filter((issue) => issue.status !== "resolved")
    .filter((issue) => {
      const severity = issue.severity ?? "low";
      return severity === "medium" || severity === "high" || severity === "critical";
    })
    .map((issue) => {
      const severity: RevisionControlSource["severity"] =
        issue.severity === "critical" ||
        issue.severity === "high" ||
        issue.severity === "medium" ||
        issue.severity === "low"
          ? issue.severity
          : "medium";
      return {
        sourceType: "review_issue_tracker" as const,
        sourceId: issue.issueId,
        severity,
        status: "open" as const,
        summary: issue.title ?? issue.description ?? null,
        artifactPaths: uniqueStrings([
          issue.targetArtifact,
          ...(issue.fixArtifactPaths ?? []),
        ]),
        reviewerRole: issue.openedBy ?? "reviewer",
      };
    });
  if (detailedSources.length > 0) {
    return detailedSources;
  }
  const aggregateCount =
    (issueTracker.openCounts.critical ?? 0) +
    (issueTracker.openCounts.high ?? 0) +
    (issueTracker.openCounts.medium ?? 0);
  if (aggregateCount <= 0) {
    return [];
  }
  return [
    {
      sourceType: "review_issue_tracker",
      sourceId: "aggregate-open-review-issues",
      severity:
        (issueTracker.openCounts.critical ?? 0) > 0
          ? "critical"
          : (issueTracker.openCounts.high ?? 0) > 0
            ? "high"
            : "medium",
      status: "open",
      summary:
        issueTracker.pendingReason ??
        `Review issue tracker still has open medium+ items (critical=${issueTracker.openCounts.critical}, high=${issueTracker.openCounts.high}, medium=${issueTracker.openCounts.medium}).`,
      artifactPaths: uniqueStrings([issueTracker.issueManifestPath]),
      reviewerRole: "reviewer",
    },
  ];
}

function buildReviewSessionSource(
  reviewSession: ReturnType<typeof normalizeReviewSessionState>
): RevisionControlSource[] {
  const verdict = reviewSession.verdict?.toLowerCase() ?? null;
  if (verdict !== "revise" && verdict !== "block" && verdict !== "not_ready") {
    return [];
  }
  return [
    {
      sourceType: "review_session",
      sourceId: `review-round-${reviewSession.round || 0}`,
      severity: verdict === "block" ? "high" : "medium",
      status: "open",
      summary: reviewSession.reviewerSummary,
      artifactPaths: uniqueStrings([
        reviewSession.reviewPacketPath,
        reviewSession.latestReviewPath,
        ...(reviewSession.blockingArtifacts ?? []),
      ]),
      reviewerRole: "reviewer",
    },
  ];
}

function buildExternalReviewSource(
  externalReview: ReturnType<typeof normalizeExternalReviewState>
): RevisionControlSource[] {
  if (!externalReview.requiredAction || externalReview.requiredAction === "none") {
    return [];
  }
  return [
    {
      sourceType: "external_review",
      sourceId: externalReview.submissionId ?? "external-review",
      severity:
        externalReview.requiredAction === "rollback_write" ||
        externalReview.requiredAction === "major_revision"
          ? "high"
          : "medium",
      status: "open",
      summary: externalReview.overallRecommendation ?? externalReview.pendingReason,
      artifactPaths: uniqueStrings([
        externalReview.externalReviewPath,
        externalReview.reviewResponsePath,
      ]),
      reviewerRole: "reviewer",
    },
  ];
}

function buildParagraphLogicAuditSource(
  paragraphLogicAudit: ReturnType<typeof normalizeParagraphLogicAuditState>
): RevisionControlSource[] {
  if (paragraphLogicAudit.status !== "blocked") {
    return [];
  }
  return [
    {
      sourceType: "paragraph_logic_audit",
      sourceId: "paragraph-logic-audit",
      severity: "medium",
      status: "open",
      summary:
        paragraphLogicAudit.pendingReason ??
        `Paragraph logic audit still has ${paragraphLogicAudit.blockingIssueCount} blocking issue(s).`,
      artifactPaths: uniqueStrings([
        paragraphLogicAudit.auditJsonPath,
        paragraphLogicAudit.auditReportPath,
        paragraphLogicAudit.reverseOutlinePath,
      ]),
      reviewerRole: "cross-reviewer",
    },
  ];
}

function buildHookSources(
  hookStore: Awaited<ReturnType<typeof readWorkflowHooksStateStore>>
): {
  sources: RevisionControlSource[];
  lastRevisionDispatchAt: string | null;
  aggregateRevisionPacketPath: string | null;
  nextReviewerRole: string | null;
} {
  const sources: RevisionControlSource[] = [];
  let lastRevisionDispatchAt: string | null = null;
  let aggregateRevisionPacketPath: string | null = null;
  let nextReviewerRole: string | null = null;

  for (const state of Object.values(hookStore.hooks)) {
    if (state.status !== "revise_requested" && state.status !== "failed" && state.status !== "escalated") {
      continue;
    }
    const source: RevisionControlSource = {
      sourceType: "file_audit" as const,
      sourceId: state.hookId,
      severity: state.status === "failed" || state.status === "escalated" ? "high" : "medium",
      status: "open" as const,
      summary:
        state.activeRound?.reportMarkdownPath ??
        state.blockedReason ??
        state.escalationReason ??
        null,
      artifactPaths: uniqueStrings([
        state.activeRound?.filePath,
        state.activeRound?.reportMarkdownPath,
        state.activeRound?.packetPath,
      ]),
      reviewerRole: "reviewer",
    };
    sources.push(source);
    if (state.lastRevisionDispatch?.dispatchedAt) {
      if (!lastRevisionDispatchAt || state.lastRevisionDispatch.dispatchedAt > lastRevisionDispatchAt) {
        lastRevisionDispatchAt = state.lastRevisionDispatch.dispatchedAt;
        aggregateRevisionPacketPath =
          state.lastRevisionDispatch.aggregateRevisionPacketPath ?? aggregateRevisionPacketPath;
        nextReviewerRole = state.lastRevisionDispatch.targetRole ?? nextReviewerRole;
      }
    }
  }

  for (const pointStages of Object.values(hookStore.hookPoints)) {
    for (const aggregate of Object.values(pointStages)) {
      if (
        (aggregate.aggregateStatus === "revise_requested" ||
          aggregate.aggregateStatus === "failed" ||
          aggregate.aggregateStatus === "escalated") &&
        aggregate.aggregateRevisionPacketPath &&
        !aggregateRevisionPacketPath
      ) {
        aggregateRevisionPacketPath = aggregate.aggregateRevisionPacketPath;
      }
    }
  }

  return {
    sources,
    lastRevisionDispatchAt,
    aggregateRevisionPacketPath,
    nextReviewerRole,
  };
}

export async function materializeRevisionControlState(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: RevisionControlState;
  packetJsonPath: string;
  packetMarkdownPath: string;
  generatedFiles: string[];
}> {
  const { state, manifest } = await deriveRevisionControlState(params);
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const packetJsonPath = DEFAULT_REVISION_CONTROL_PACKET_JSON_PATH;
  const packetMarkdownPath = DEFAULT_REVISION_CONTROL_PACKET_MD_PATH;
  const packetJsonResolved = resolveProjectArtifactPath(params.projectRoot, packetJsonPath);
  const packetMarkdownResolved = resolveProjectArtifactPath(params.projectRoot, packetMarkdownPath);
  if (!packetJsonResolved || !packetMarkdownResolved) {
    throw new Error("Unable to resolve revision control packet paths.");
  }

  await writeJsonEnsured(packetJsonResolved, {
    schema_version: 1,
    generated_at: state.lastUpdatedAt,
    ...serializeRevisionControlState(state),
  });
  const markdown = [
    "# Revision Control Packet",
    "",
    `- status: ${state.status}`,
    `- revision_round: ${state.revisionRound}`,
    `- source_stage: ${state.sourceStage ?? "unknown"}`,
    `- current_owner: ${state.currentOwner ?? "unset"}`,
    `- next_reviewer_role: ${state.nextReviewerRole ?? "unset"}`,
    "",
    "## Pending Reason",
    state.pendingReason ?? "none",
    "",
    "## Open Sources",
    ...(state.openSources.length > 0
      ? state.openSources.flatMap((source) => [
          `### ${source.sourceType}:${source.sourceId}`,
          `- severity: ${source.severity}`,
          `- reviewer_role: ${source.reviewerRole ?? "unset"}`,
          `- summary: ${source.summary ?? "none"}`,
          ...(source.artifactPaths.length > 0
            ? source.artifactPaths.map((entry) => `- artifact: ${entry}`)
            : ["- artifact: none"]),
          "",
        ])
      : ["- none", ""]),
  ].join("\n");
  await writeTextEnsured(packetMarkdownResolved, `${markdown}\n`);

  manifest.revision_control_state = serializeRevisionControlState(state);
  await writeJsonEnsured(manifestPath, manifest);

  return {
    state,
    packetJsonPath,
    packetMarkdownPath,
    generatedFiles: [packetJsonPath, packetMarkdownPath],
  };
}

export async function deriveRevisionControlState(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: RevisionControlState;
  manifest: Record<string, unknown>;
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const reviewSession = normalizeReviewSessionState(manifest.review_session);
  const issueTracker = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: manifest.review_issue_tracker,
  });
  const externalReview = normalizeExternalReviewState(manifest.external_review_state);
  const paragraphLogicAudit = normalizeParagraphLogicAuditState(
    manifest.paragraph_logic_audit
  );
  const hookStore = await readWorkflowHooksStateStore(params.projectRoot);
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);

  const hookSummary = buildHookSources(hookStore);
  const openSources = [
    ...hookSummary.sources,
    ...buildReviewSessionSource(reviewSession),
    ...buildIssueTrackerSources(issueTracker),
    ...buildExternalReviewSource(externalReview),
    ...buildParagraphLogicAuditSource(paragraphLogicAudit),
  ];

  const sourceStage =
    params.stage ??
    (typeof manifest.current_stage === "string" ? manifest.current_stage : null);
  const currentOwner =
    openSources.length > 0
      ? "academic_writer"
      : null;
  const nextReviewerRole =
    hookSummary.nextReviewerRole ??
    (openSources.some((entry) => entry.reviewerRole === "cross-reviewer")
      ? "cross-reviewer"
      : openSources.length > 0
        ? "reviewer"
        : null);
  const requiredWriterArtifacts = uniqueStrings([
    ...openSources.flatMap((entry) => entry.artifactPaths),
    paperStory.revisionCyclePath,
    reviewSession.reviewPacketPath,
  ]);
  const requiredReviewerArtifacts = uniqueStrings([
    reviewSession.reviewPacketPath,
    externalReview.externalReviewPath,
  ]);
  const requiredCrossReviewArtifacts = uniqueStrings(
    openSources
      .filter((entry) => entry.reviewerRole === "cross-reviewer")
      .flatMap((entry) => entry.artifactPaths)
  );
  const pendingReason =
    openSources.length > 0
      ? uniqueStrings(openSources.map((entry) => entry.summary)).slice(0, 2).join(" | ") || "Revision sources remain open."
      : null;

  const state: RevisionControlState = normalizeRevisionControlState({
    status:
      openSources.length > 0
        ? "active"
        : hookSummary.lastRevisionDispatchAt
          ? "complete"
          : "idle",
    revision_round: Math.max(reviewSession.round ?? 0, issueTracker.lastReviewRound ?? 0),
    source_stage: sourceStage,
    current_owner: currentOwner,
    next_reviewer_role: nextReviewerRole,
    active_revision_packet_path:
      hookSummary.aggregateRevisionPacketPath ?? DEFAULT_REVISION_CONTROL_PACKET_JSON_PATH,
    aggregate_revision_markdown_path:
      hookSummary.aggregateRevisionPacketPath?.replace(/\.json$/i, ".md") ??
      DEFAULT_REVISION_CONTROL_PACKET_MD_PATH,
    open_sources: openSources,
    required_writer_artifacts: requiredWriterArtifacts,
    required_reviewer_artifacts: requiredReviewerArtifacts,
    required_cross_review_artifacts: requiredCrossReviewArtifacts,
    last_revision_dispatch_at: hookSummary.lastRevisionDispatchAt,
    last_recheck_requested_at: null,
    pending_reason:
      pendingReason ??
      (hasBlockingReviewIssues(issueTracker) || hasUnwaivedMediumOrHigherReviewIssues(issueTracker)
        ? "Outstanding review issues still need disposition."
        : null),
    last_updated_at: new Date().toISOString(),
  });
  return {
    state,
    manifest,
  };
}
