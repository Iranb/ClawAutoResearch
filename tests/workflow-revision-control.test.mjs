import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeRevisionControlState } from "../tools/research-writing/revision-control.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# stub\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("materializeRevisionControlState aggregates review session, issue tracker, and hook revision sources", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    review_session: {
      status: "completed",
      round: 2,
      verdict: "revise",
      reviewer_summary: "Scope drift is still unresolved.",
      review_packet_path: "reviewer/REVIEW_PACKET.json",
      latest_review_path: "reviewer/REVIEW_REPORT.md",
      blocking_artifacts: ["academic_writer/paper/main.tex"],
    },
    review_issue_tracker: {
      status: "open",
      issues: [
        {
          issue_id: "issue-1",
          severity: "high",
          title: "Fix unsupported benchmark claim",
          target_artifact: "academic_writer/paper/main.tex",
          fix_artifact_paths: ["academic_writer/paper/sections/results.tex"],
          opened_by: "reviewer",
          status: "open",
        },
      ],
      last_review_round: 2,
    },
    paper_story_state: {
      status: "ready",
      revision_cycle_path: "academic_writer/PAPER_REVISION_STATE.json",
    },
    external_review_state: {
      status: "missing",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: new Date().toISOString(),
    hook_points: {
      before_stage_handoff: {
        review: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          aggregate_revision_packet_path:
            "reviewer/file-audits/_aggregate/review-before_stage_handoff-academic_writer/AGGREGATE_REVISION_PACKET.md",
        },
      },
    },
    hooks: {
      "main-tex-audit": {
        hook_id: "main-tex-audit",
        stage: "review",
        hook_point: "before_stage_handoff",
        status: "revise_requested",
        active_round: {
          filePath: "academic_writer/paper/main.tex",
          packetPath: "reviewer/file-audits/main-tex/round-1/AUDIT_PACKET.md",
          reportMarkdownPath: "reviewer/file-audits/main-tex/round-1/AUDIT_REPORT.md",
        },
        last_revision_dispatch: {
          dispatched_at: "2026-04-17T10:00:00.000Z",
          target_role: "academic_writer",
          aggregate_revision_packet_path:
            "reviewer/file-audits/_aggregate/review-before_stage_handoff-academic_writer/AGGREGATE_REVISION_PACKET.md",
        },
      },
    },
  });
  await writeText(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"), "# review\n");
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"), {
    status: "completed",
    verdict: "revise",
    action_items: ["Tighten scope."],
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "active");
  assert.equal(result.state.currentOwner, "academic_writer");
  assert.equal(result.state.openSources.length >= 2, true);
  assert.ok(
    result.state.openSources.some((entry) => entry.sourceType === "review_session")
  );
  assert.ok(
    result.state.openSources.some((entry) => entry.sourceType === "review_issue_tracker")
  );
  assert.ok(
    result.state.openSources.some((entry) => entry.sourceType === "file_audit")
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.revision_control_state.status, "active");
  assert.equal(
    manifest.revision_control_state.active_revision_packet_path,
    "reviewer/file-audits/_aggregate/review-before_stage_handoff-academic_writer/AGGREGATE_REVISION_PACKET.md"
  );
});
