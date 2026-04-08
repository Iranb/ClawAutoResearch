import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizeStage } from "../workflow-guard-core/coercion";
import { pathExists, readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  extractReviewIssues as extractReviewIssuesFromModule,
  summarizeReviewIssuesFromManifest as summarizeReviewIssuesFromManifestFromModule,
} from "../workflow-guard-prompt-support";
import {
  normalizeReviewIssueCounts,
  normalizeReviewIssueState,
  normalizeReviewIssueTrackerState,
  normalizeFigureQcState,
  normalizePaperQcState,
  serializeFigureQcState,
  serializePaperQcState,
  serializeReviewIssueCounts,
  serializeReviewIssueState,
  serializeReviewIssueTrackerState,
} from "../workflow-guard-state/execution-state";

type PaperQcStateLike = ReturnType<typeof normalizePaperQcState>;
type FigureQcStateLike = ReturnType<typeof normalizeFigureQcState>;
type ReviewIssueCountsLike = ReturnType<typeof normalizeReviewIssueCounts>;
type ReviewIssueStateLike = ReturnType<typeof normalizeReviewIssueState>;
type ReviewIssueTrackerStateLike = ReturnType<typeof normalizeReviewIssueTrackerState>;

type ManifestLike = {
  paper_qc?: unknown;
  figure_qc?: unknown;
  review_issue_tracker?: unknown;
  citation_collection?: unknown;
};

type ReviewIssueBlocker = {
  code: string;
  label: string;
  description: string;
  targetArtifact: string | null;
};

function isReviewIssueResolvedStatus(status: string | null): boolean {
  return ["fixed", "verified", "waived", "closed", "resolved"].includes(
    normalizeStage(status) ?? ""
  );
}

async function readProjectManifest(projectRoot: string): Promise<ManifestLike> {
  return (await readJsonIfExists<ManifestLike>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  )) ?? {};
}

export function isResolvedReviewIssueStatus(status: string | null): boolean {
  return isReviewIssueResolvedStatus(status);
}

export function countReviewIssueLanes(issues: ReviewIssueStateLike[]): {
  surface: number;
  submission: number;
} {
  let surface = 0;
  let submission = 0;
  for (const issue of issues) {
    if (isReviewIssueResolvedStatus(issue.status)) {
      continue;
    }
    const lane = normalizeStage(issue.lane);
    if (lane === "surface") {
      surface += 1;
    } else if (lane === "submission") {
      submission += 1;
    }
  }
  return { surface, submission };
}

export function hasUnwaivedMediumOrHigherReviewIssues(
  state: ReviewIssueTrackerStateLike
): boolean {
  if (state.status === "waived") {
    return false;
  }
  if (state.issues.length === 0) {
    return (
      state.openCounts.critical > 0 ||
      state.openCounts.high > 0 ||
      state.openCounts.medium > 0
    );
  }
  return state.issues.some((issue) => {
    if (isReviewIssueResolvedStatus(issue.status)) {
      return false;
    }
    const severity = normalizeStage(issue.severity);
    if (!["critical", "high", "medium"].includes(severity ?? "")) {
      return false;
    }
    return !(severity === "medium" && issue.waiverReason);
  });
}

export function hasBlockingReviewIssues(state: ReviewIssueTrackerStateLike): boolean {
  if (state.status === "waived") {
    return false;
  }
  if (state.issues.length > 0) {
    return state.issues.some((issue) => {
      if (isReviewIssueResolvedStatus(issue.status)) {
        return false;
      }
      const severity = normalizeStage(issue.severity);
      return severity === "critical" || severity === "high";
    });
  }
  return state.openCounts.critical > 0 || state.openCounts.high > 0;
}

export function extractReviewIssues(value: unknown): ReviewIssueStateLike[] {
  return extractReviewIssuesFromModule(value) as ReviewIssueStateLike[];
}

export function summarizeReviewIssuesFromManifest(value: unknown): {
  issues: ReviewIssueStateLike[];
  counts: ReviewIssueCountsLike;
} {
  return summarizeReviewIssuesFromManifestFromModule(value) as {
    issues: ReviewIssueStateLike[];
    counts: ReviewIssueCountsLike;
  };
}

export async function hydrateReviewIssueTrackerState(params: {
  projectRoot: string;
  value: unknown;
}): Promise<ReviewIssueTrackerStateLike> {
  const state = normalizeReviewIssueTrackerState(params.value);
  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.issueManifestPath
  );
  if (!issueManifestResolvedPath || !(await pathExists(issueManifestResolvedPath))) {
    return state;
  }
  const issueManifest = await readJsonIfExists<Record<string, unknown> | unknown[]>(
    issueManifestResolvedPath
  );
  if (!issueManifest) {
    return state;
  }
  const issueManifestRecord =
    issueManifest && typeof issueManifest === "object" && !Array.isArray(issueManifest)
      ? (issueManifest as Record<string, unknown>)
      : null;
  if (issueManifestRecord) {
    const hydratedState = normalizeReviewIssueTrackerState(issueManifestRecord);
    const hasExplicitCounts =
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "open_counts") ||
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "openCounts");
    return {
      ...state,
      status: hydratedState.status ?? state.status,
      issues: hydratedState.issues.length > 0 ? hydratedState.issues : state.issues,
      openCounts: hasExplicitCounts ? hydratedState.openCounts : state.openCounts,
      scoreRecords:
        hydratedState.scoreRecords.length > 0 ? hydratedState.scoreRecords : state.scoreRecords,
      lastReviewRound:
        hydratedState.lastReviewRound > 0 ? hydratedState.lastReviewRound : state.lastReviewRound,
      lastUpdatedAt: hydratedState.lastUpdatedAt ?? state.lastUpdatedAt,
      pendingReason: hydratedState.pendingReason ?? state.pendingReason,
    };
  }
  const hydrated = summarizeReviewIssuesFromManifest(issueManifest);
  return {
    ...state,
    issues: hydrated.issues,
    openCounts: hydrated.counts,
  };
}

export function buildWritePackageAssemblyIssues(params: {
  blockingInputs: ReviewIssueBlocker[];
  existingIssues: ReviewIssueStateLike[];
  now: string;
}): ReviewIssueStateLike[] {
  const nextById = new Map<string, ReviewIssueStateLike>();
  for (const issue of params.existingIssues) {
    nextById.set(issue.issueId, issue);
  }

  const activeIds = new Set<string>();
  for (const blocker of params.blockingInputs) {
    const issueId = `write-package-${blocker.code}`;
    activeIds.add(issueId);
    const current = nextById.get(issueId);
    nextById.set(issueId, {
      issueId,
      lane: "evidence",
      severity: "medium",
      title: `write_package missing: ${blocker.label}`,
      description: blocker.description,
      targetStage: "write",
      targetArtifact: blocker.targetArtifact,
      openedBy: "write_package_assembler",
      owner: "academic_writer",
      status: "open",
      fixArtifactPaths: blocker.targetArtifact ? [blocker.targetArtifact] : [],
      verifiedAt: null,
      waiverReason: current?.waiverReason ?? null,
      createdAt: current?.createdAt ?? params.now,
      updatedAt: params.now,
    });
  }

  for (const [issueId, issue] of nextById.entries()) {
    if (!issueId.startsWith("write-package-")) {
      continue;
    }
    if (activeIds.has(issueId)) {
      continue;
    }
    if (isReviewIssueResolvedStatus(issue.status)) {
      continue;
    }
    nextById.set(issueId, {
      ...issue,
      status: "closed",
      verifiedAt: params.now,
      updatedAt: params.now,
    });
  }

  return [...nextById.values()].sort((left, right) =>
    (left.issueId ?? "").localeCompare(right.issueId ?? "")
  );
}

async function persistReviewIssueTrackerState(params: {
  projectRoot: string;
  state: ReviewIssueTrackerStateLike;
}): Promise<void> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  manifest.review_issue_tracker = serializeReviewIssueTrackerState(params.state);
  await writeJsonEnsured(manifestPath, manifest);

  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    params.state.issueManifestPath
  );
  if (issueManifestResolvedPath) {
    await writeJsonEnsured(issueManifestResolvedPath, {
      status: params.state.status,
      last_review_round: params.state.lastReviewRound,
      updated_at: params.state.lastUpdatedAt,
      pending_reason: params.state.pendingReason,
      open_counts: serializeReviewIssueCounts(params.state.openCounts),
      score_records: params.state.scoreRecords,
      issues: params.state.issues.map((issue) => serializeReviewIssueState(issue)),
    });
  }
}

export async function syncWritePackageAssemblyIssues(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  blockingInputs: ReviewIssueBlocker[];
  now: string;
}): Promise<ReviewIssueTrackerStateLike> {
  const currentTracker = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: params.manifest.review_issue_tracker,
  });
  const issues = buildWritePackageAssemblyIssues({
    blockingInputs: params.blockingInputs,
    existingIssues: currentTracker.issues,
    now: params.now,
  });
  const unresolvedCount = issues.filter(
    (issue) => !isReviewIssueResolvedStatus(issue.status)
  ).length;
  const counts = summarizeReviewIssuesFromManifest(issues).counts;
  const nextTracker: ReviewIssueTrackerStateLike = {
    ...currentTracker,
    status: unresolvedCount > 0 ? "open" : "ready",
    issueManifestPath: currentTracker.issueManifestPath,
    issues,
    lastReviewRound: currentTracker.lastReviewRound,
    pendingReason:
        unresolvedCount > 0
        ? "write_package assembly still has unresolved upstream evidence gaps."
        : null,
    lastUpdatedAt: params.now,
    openCounts: counts,
  };

  await persistReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    state: {
      ...nextTracker,
      issues,
      openCounts: counts,
    },
  });

  return {
    ...nextTracker,
    issues,
    openCounts: counts,
  };
}

export async function getPaperQcStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: PaperQcStateLike;
  latestReportResolvedPath: string | null;
  latestReportExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = (await readProjectManifest(params.projectRoot)) as ManifestLike;
  const state = normalizePaperQcState(manifest.paper_qc);
  const latestReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.latestReportPath
  );
  return {
    state,
    latestReportResolvedPath,
    latestReportExists: latestReportResolvedPath
      ? await pathExists(latestReportResolvedPath)
      : false,
    hardFailure: isPaperQcHardFailure(state),
  };
}

export function isPaperQcHardFailure(state: PaperQcStateLike): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return [state.compileStatus, state.pageBudgetStatus, state.invalidFigureRefStatus].some(
    (value) => normalizeStage(value) === "fail"
  );
}

export async function getFigureQcStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: FigureQcStateLike;
  figureReviewResolvedPath: string | null;
  figureReviewExists: boolean;
  figureSelectionResolvedPath: string | null;
  figureSelectionExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const state = normalizeFigureQcState(manifest.figure_qc);
  const figureReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.figureReviewPath
  );
  const figureSelectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.figureSelectionPath
  );
  return {
    state,
    figureReviewResolvedPath,
    figureReviewExists: figureReviewResolvedPath
      ? await pathExists(figureReviewResolvedPath)
      : false,
    figureSelectionResolvedPath,
    figureSelectionExists: figureSelectionResolvedPath
      ? await pathExists(figureSelectionResolvedPath)
      : false,
    hardFailure: isFigureQcHardFailure(state),
  };
}

export function isFigureQcHardFailure(state: FigureQcStateLike): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return [
    state.duplicateFigureStatus,
    state.captionAlignmentStatus,
    state.textAlignmentStatus,
    state.selectionStatus,
  ].some((value) => normalizeStage(value) === "fail");
}

export async function getReviewIssueTrackerStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ReviewIssueTrackerStateLike;
  issueManifestResolvedPath: string | null;
  issueManifestExists: boolean;
  hardBlockersOpen: boolean;
  mediumOrHigherIssuesNeedDisposition: boolean;
  surfaceIssueCount: number;
  submissionIssueCount: number;
}> {
  const manifest = await readProjectManifest(params.projectRoot);
  const state = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: manifest.review_issue_tracker,
  });
  const laneCounts = countReviewIssueLanes(state.issues);
  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.issueManifestPath
  );
  return {
    state,
    issueManifestResolvedPath,
    issueManifestExists: issueManifestResolvedPath
      ? await pathExists(issueManifestResolvedPath)
      : false,
    hardBlockersOpen: hasBlockingReviewIssues(state),
    mediumOrHigherIssuesNeedDisposition: hasUnwaivedMediumOrHigherReviewIssues(state),
    surfaceIssueCount: laneCounts.surface,
    submissionIssueCount: laneCounts.submission,
  };
}
