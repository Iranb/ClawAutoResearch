import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setReviewIssueTrackerState } from "../../../tools/workflow-guard-setters/review-state-setters.ts";

async function makeProjectRoot(manifest) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-review-setters-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("review setters update issue tracker state and persist the issue manifest", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    review_issue_tracker: {
      status: "missing",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      issues: [
        {
          issue_id: "issue-1",
          severity: "critical",
          status: "open",
        },
      ],
    },
  });

  assert.equal(result.hardBlockersOpen, true);
  assert.equal(result.mediumOrHigherIssuesNeedDisposition, true);
  await fs.access(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"));
});
