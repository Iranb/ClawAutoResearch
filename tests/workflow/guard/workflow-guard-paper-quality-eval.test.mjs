import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWritePackageAssemblyIssues,
  countReviewIssueLanes,
  isFigureQcHardFailure,
  isPaperQcHardFailure,
  isResolvedReviewIssueStatus,
} from "../../../tools/workflow-guard-writing/paper-quality-eval.ts";

test("paper and figure QC hard-failure checks ignore missing states", () => {
  assert.equal(
    isPaperQcHardFailure({
      status: "missing",
      compileStatus: "fail",
      compileRoundCount: 0,
      chktexStatus: "fail",
      pageBudgetStatus: "fail",
      referenceStartPage: null,
      bodyPageCount: null,
      unusedFigureStatus: "pending",
      invalidFigureRefStatus: "fail",
      reflectionRoundCount: 0,
      latestReportPath: null,
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    false
  );
  assert.equal(
    isFigureQcHardFailure({
      status: "missing",
      figureReviewPath: null,
      figureSelectionPath: null,
      duplicateFigureStatus: "fail",
      captionAlignmentStatus: "fail",
      textAlignmentStatus: "fail",
      selectionStatus: "fail",
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    false
  );
});

test("paper and figure QC hard-failure checks flag failing statuses", () => {
  assert.equal(
    isPaperQcHardFailure({
      status: "ready",
      compileStatus: "pass",
      compileRoundCount: 1,
      chktexStatus: "pass",
      pageBudgetStatus: "fail",
      referenceStartPage: null,
      bodyPageCount: null,
      unusedFigureStatus: "pending",
      invalidFigureRefStatus: "pending",
      reflectionRoundCount: 0,
      latestReportPath: null,
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    true
  );
  assert.equal(
    isFigureQcHardFailure({
      status: "ready",
      figureReviewPath: "reviewer/FIGURE_REVIEW.md",
      figureSelectionPath: "reviewer/FIGURE_SELECTION.md",
      duplicateFigureStatus: "pass",
      captionAlignmentStatus: "pass",
      textAlignmentStatus: "pass",
      selectionStatus: "fail",
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    true
  );
});

test("review issue lane counting ignores resolved issues", () => {
  assert.deepEqual(
    countReviewIssueLanes([
      {
        issueId: "surface-1",
        lane: "surface",
        severity: "medium",
        title: "surface issue",
        description: null,
        targetStage: null,
        targetArtifact: null,
        openedBy: null,
        owner: null,
        status: "open",
        fixArtifactPaths: [],
        verifiedAt: null,
        waiverReason: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        issueId: "submission-1",
        lane: "submission",
        severity: "high",
        title: "submission issue",
        description: null,
        targetStage: null,
        targetArtifact: null,
        openedBy: null,
        owner: null,
        status: "resolved",
        fixArtifactPaths: [],
        verifiedAt: null,
        waiverReason: null,
        createdAt: null,
        updatedAt: null,
      },
    ]),
    { surface: 1, submission: 0 }
  );
  assert.equal(isResolvedReviewIssueStatus("waived"), true);
});

test("buildWritePackageAssemblyIssues opens evidence issues for blockers", () => {
  const issues = buildWritePackageAssemblyIssues({
    blockingInputs: [
      {
        code: "figure_pack",
        label: "figure pack",
        description: "write_package assembly could not derive a figure pack.",
        targetArtifact: "academic_writer/FIGURE_PACK.json",
      },
    ],
    existingIssues: [],
    now: "2026-04-08T00:00:00.000Z",
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.issueId, "write-package-figure_pack");
  assert.equal(issues[0]?.status, "open");
  assert.equal(issues[0]?.owner, "academic_writer");
});
