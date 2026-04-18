import * as path from "node:path";

import { normalizeStage } from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  hasBlockingReviewIssues,
  hasUnwaivedMediumOrHigherReviewIssues,
  hydrateReviewIssueTrackerState,
  summarizeReviewIssuesFromManifest,
} from "../workflow-guard-writing/paper-quality-eval";
import { normalizeReviewScoreRecords } from "../workflow-guard-state/authoring-review-state";
import {
  normalizeReviewIssueCounts,
  normalizeReviewIssueState,
  normalizeReviewIssueTrackerState,
  serializeReviewIssueCounts,
  serializeReviewIssueState,
  serializeReviewIssueTrackerState,
} from "../workflow-guard-state/execution-state";
import { materializeRevisionControlState } from "../research-writing/revision-control";

type ReviewIssueTrackerState = ReturnType<typeof normalizeReviewIssueTrackerState>;
type ReviewIssueState = ReturnType<typeof normalizeReviewIssueState>;

async function readProjectManifest(projectRoot: string): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {}
  );
}

async function saveProjectManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
}

async function upsertJsonArtifact(
  targetPath: string | null,
  patch: Record<string, unknown>
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const current = (await readJsonIfExists<Record<string, unknown>>(targetPath)) ?? {};
  await writeJsonEnsured(targetPath, {
    ...current,
    ...patch,
  });
}

export async function setReviewIssueTrackerState(params: {
  projectRoot: string;
  reviewIssueTracker: Record<string, unknown>;
}): Promise<{
  state: ReviewIssueTrackerState;
  issueManifestResolvedPath: string | null;
  hardBlockersOpen: boolean;
  mediumOrHigherIssuesNeedDisposition: boolean;
  revisionControl: Awaited<ReturnType<typeof materializeRevisionControlState>>["state"];
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: manifest.review_issue_tracker,
  });
  const patch = params.reviewIssueTracker ?? {};
  const hasScoreRecordPatch =
    Object.prototype.hasOwnProperty.call(patch, "scoreRecords") ||
    Object.prototype.hasOwnProperty.call(patch, "score_records");
  let next: ReviewIssueTrackerState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    issues: Array.isArray(patch.issues)
      ? patch.issues.map((issue) => normalizeReviewIssueState(issue))
      : current.issues,
    scoreRecords: hasScoreRecordPatch
      ? normalizeReviewScoreRecords(patch.scoreRecords ?? patch.score_records)
      : current.scoreRecords,
    openCounts:
      patch.openCounts || patch.open_counts
        ? normalizeReviewIssueCounts(patch.openCounts ?? patch.open_counts)
        : current.openCounts,
    issueManifestPath:
      (typeof patch.issueManifestPath === "string" ? patch.issueManifestPath : null) ??
      (typeof patch.issue_manifest_path === "string"
        ? patch.issue_manifest_path
        : null) ??
      current.issueManifestPath,
    lastReviewRound: Math.max(
      0,
      Math.floor(
        typeof patch.lastReviewRound === "number"
          ? patch.lastReviewRound
          : typeof patch.last_review_round === "number"
            ? patch.last_review_round
            : current.lastReviewRound
      )
    ),
    lastUpdatedAt:
      (typeof patch.lastUpdatedAt === "string" ? patch.lastUpdatedAt : null) ??
      (typeof patch.last_updated_at === "string" ? patch.last_updated_at : null) ??
      new Date().toISOString(),
    pendingReason:
      (typeof patch.pendingReason === "string" ? patch.pendingReason : null) ??
      (typeof patch.pending_reason === "string" ? patch.pending_reason : null) ??
      current.pendingReason,
  };

  if (Array.isArray(patch.issues) && !(patch.openCounts || patch.open_counts)) {
    next.openCounts = summarizeReviewIssuesFromManifest(next.issues).counts;
  }

  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.issueManifestPath
  );
  if (issueManifestResolvedPath) {
    await upsertJsonArtifact(issueManifestResolvedPath, {
      status: next.status,
      last_review_round: next.lastReviewRound,
      updated_at: next.lastUpdatedAt,
      pending_reason: next.pendingReason,
      open_counts: serializeReviewIssueCounts(next.openCounts),
      score_records: next.scoreRecords,
      issues: next.issues.map((issue) => serializeReviewIssueState(issue)),
    });
  }

  next = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: serializeReviewIssueTrackerState(next),
  });

  manifest.review_issue_tracker = serializeReviewIssueTrackerState(next);
  await saveProjectManifest(params.projectRoot, manifest);

  const revisionControl = (
    await materializeRevisionControlState({
      projectRoot: params.projectRoot,
      stage: "review",
    })
  ).state;

  return {
    state: next,
    issueManifestResolvedPath,
    hardBlockersOpen: hasBlockingReviewIssues(next),
    mediumOrHigherIssuesNeedDisposition: hasUnwaivedMediumOrHigherReviewIssues(next),
    revisionControl,
  };
}
