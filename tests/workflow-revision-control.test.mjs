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

test("materializeRevisionControlState includes blocked paragraph logic audit as a revision source", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-paragraph-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    paragraph_logic_audit: {
      status: "blocked",
      audit_json_path: "academic_writer/PARAGRAPH_LOGIC_AUDIT.json",
      audit_report_path: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      reverse_outline_path: "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
      blocking_issue_count: 2,
      pending_reason: "Paragraph handoffs in introduction and discussion remain weak.",
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
    hook_points: {},
    hooks: {},
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "active");
  assert.equal(
    result.state.openSources.some((entry) => entry.sourceType === "paragraph_logic_audit"),
    true
  );
  assert.equal(result.state.nextReviewerRole, "cross-reviewer");
});

test("materializeRevisionControlState drops stale resolved hook sources and runtime-only hook failures", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-stale-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    paragraph_logic_audit: {
      status: "ready",
      pending_reason: null,
    },
    citation_integrity: {
      verification_status: "verified",
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
    updated_at: "2026-04-27T16:50:00.000Z",
    hook_points: {
      before_stage_handoff: {
        review: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          updated_at: "2026-04-27T16:40:00.000Z",
        },
      },
      artifact_materialized: {
        write: {
          aggregate_status: "passed",
          aggregate_verdict: "pass",
          updated_at: "2026-04-27T16:50:00.000Z",
        },
      },
      before_handoff_activation: {
        write: {
          aggregate_status: "escalated",
          aggregate_verdict: "block",
          updated_at: "2026-04-27T16:50:00.000Z",
        },
      },
    },
    hooks: {
      "builtin.auto-mode-risk:review": {
        hook_id: "builtin.auto-mode-risk:review",
        stage: "review",
        hook_point: "before_stage_handoff",
        status: "revise_requested",
        blocked_reason:
          "PROJECT_MANIFEST.json.paragraph_logic_audit.status must be ready before REVIEW closeout (current: pending)",
        updated_at: "2026-04-27T16:40:00.000Z",
      },
      "builtin.auto-mode-risk:setup": {
        hook_id: "builtin.auto-mode-risk:setup",
        stage: "setup",
        hook_point: "before_stage_handoff",
        status: "failed",
        blocked_reason: "Embedded workflow run is not tracked in the local registry.",
        updated_at: "2026-04-25T07:18:04.195Z",
      },
      "paper-plan-figure-anchor-audit": {
        hook_id: "paper-plan-figure-anchor-audit",
        stage: "write",
        hook_point: "artifact_materialized",
        status: "escalated",
        blocked_reason: "Workflow hook review is currently running.",
        escalation_reason: "Workflow hook exceeded the configured retry budget.",
        active_round: {
          status: "pending",
          filePath: "academic_writer/FIGURE_ANCHOR_PLAN.md",
          packetPath: "reviewer/file-audits/paper-plan-figure-anchor-audit/round-1/AUDIT_PACKET.md",
          reportMarkdownPath:
            "reviewer/file-audits/paper-plan-figure-anchor-audit/round-1/AUDIT_REPORT.md",
          result: null,
        },
        updated_at: "2026-04-27T16:49:59.000Z",
      },
      "main-tex-consistency-audit": {
        hook_id: "main-tex-consistency-audit",
        stage: "write",
        hook_point: "before_handoff_activation",
        status: "escalated",
        blocked_reason: "Workflow hook review is currently running.",
        escalation_reason: "Workflow hook exceeded the configured retry budget.",
        active_round: {
          status: "pending",
          filePath: "academic_writer/paper/main.tex",
          packetPath: "reviewer/file-audits/main-tex-consistency-audit/round-3/AUDIT_PACKET.md",
          reportMarkdownPath:
            "reviewer/file-audits/main-tex-consistency-audit/round-3/AUDIT_REPORT.md",
          result: null,
        },
        updated_at: "2026-04-27T16:50:00.000Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "idle");
  assert.deepEqual(result.state.openSources, []);
  const packet = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVISION_CONTROL_PACKET.json"), "utf8")
  );
  assert.equal(packet.status, "idle");
  assert.deepEqual(packet.open_sources, []);
});

test("materializeRevisionControlState ignores external reviews that only require human decision", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-human-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "submit",
    external_review_state: {
      status: "received",
      provider: "paperreview.ai",
      external_review_path: "reviewer/external_review.md",
      review_response_path: "reviewer/rebuttal.md",
      overall_recommendation: "minor_revision",
      required_action: "human_decision",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: new Date().toISOString(),
    hook_points: {
      before_stage_handoff: {
        submit: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          updated_at: "2026-05-07T10:04:12.000Z",
        },
      },
    },
    hooks: {
      "builtin.submit-readiness:submit": {
        hook_id: "builtin.submit-readiness:submit",
        stage: "submit",
        hook_point: "before_stage_handoff",
        status: "revise_requested",
        last_verdict: "revise",
        blocked_reason: "Submit transition still requires manual confirmation.",
        updated_at: "2026-05-07T10:04:12.000Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "submit",
  });

  assert.equal(result.state.status, "idle");
  assert.equal(result.state.openSources.length, 0);
});

test("materializeRevisionControlState keeps non-human submit readiness failures as revision sources", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-submit-failure-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "submit",
    external_review_state: {
      status: "missing",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: new Date().toISOString(),
    hook_points: {
      before_stage_handoff: {
        submit: {
          aggregate_status: "failed",
          aggregate_verdict: "block",
          updated_at: "2026-05-07T10:04:12.000Z",
        },
      },
    },
    hooks: {
      "builtin.submit-readiness:submit": {
        hook_id: "builtin.submit-readiness:submit",
        stage: "submit",
        hook_point: "before_stage_handoff",
        status: "failed",
        last_verdict: "block",
        blocked_reason: "Submit readiness thresholds are not satisfied.",
        updated_at: "2026-05-07T10:04:12.000Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "submit",
  });

  assert.equal(result.state.status, "active");
  assert.equal(result.state.openSources.length, 1);
  assert.equal(result.state.openSources[0].sourceId, "builtin.submit-readiness:submit");
});

test("materializeRevisionControlState drops stale builtin auto-mode risk hooks after risk stabilizes", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-auto-risk-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    auto_dispatch_diagnostics: {
      status: "waiting",
      blocking_layer: "hook",
      blocking_reason: "revision_control_active",
      risk_fingerprint: null,
    },
    auto_mode_remediation: {
      status: "resolved",
    },
    review_issue_tracker: {
      status: "resolved",
      open_counts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      issues: [],
    },
    external_review_state: {
      status: "received",
      required_action: "human_decision",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: "2026-05-07T09:46:53.968Z",
    hook_points: {
      before_stage_handoff: {
        idea: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          updated_at: "2026-05-07T09:20:00.000Z",
        },
        setup: {
          aggregate_status: "failed",
          aggregate_verdict: "block",
          updated_at: "2026-05-07T09:20:00.000Z",
        },
      },
    },
    hooks: {
      "builtin.auto-mode-risk:idea": {
        hook_id: "builtin.auto-mode-risk:idea",
        stage: "idea",
        hook_point: "before_stage_handoff",
        status: "failed",
        blocked_reason: "Auto-mode risk discussion still reports blocking issues.",
        updated_at: "2026-05-07T09:20:00.000Z",
      },
      "builtin.auto-mode-risk:setup": {
        hook_id: "builtin.auto-mode-risk:setup",
        stage: "setup",
        hook_point: "before_stage_handoff",
        status: "failed",
        blocked_reason: "PROJECT_MANIFEST.json.idle_research",
        updated_at: "2026-05-07T09:20:00.000Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "write",
  });

  assert.equal(result.state.status, "idle");
  assert.deepEqual(result.state.openSources, []);
});

test("materializeRevisionControlState keeps builtin auto-mode risk hooks while risk is current", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-active-risk-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    auto_dispatch_diagnostics: {
      status: "degraded",
      blocking_layer: "risk",
      risk_fingerprint: "risk-write-1",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: "2026-05-07T09:46:53.968Z",
    hook_points: {
      before_stage_handoff: {
        write: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          updated_at: "2026-05-07T09:46:53.968Z",
        },
      },
    },
    hooks: {
      "builtin.auto-mode-risk:write": {
        hook_id: "builtin.auto-mode-risk:write",
        stage: "write",
        hook_point: "before_stage_handoff",
        status: "revise_requested",
        blocked_reason: "Auto-mode risk discussion requested another mitigation pass.",
        updated_at: "2026-05-07T09:46:53.968Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "write",
  });

  assert.equal(result.state.status, "active");
  assert.equal(result.state.openSources.length, 1);
  assert.equal(result.state.openSources[0].sourceId, "builtin.auto-mode-risk:write");
});

test("materializeRevisionControlState does not let stale remediation hide current auto-mode risk", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-revision-control-current-risk-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    auto_dispatch_diagnostics: {
      status: "degraded",
      blocking_layer: "risk",
      risk_fingerprint: "risk-write-2",
    },
    auto_mode_remediation: {
      status: "resolved",
    },
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"), {
    schemaVersion: 1,
    updated_at: "2026-05-07T09:46:53.968Z",
    hook_points: {
      before_stage_handoff: {
        write: {
          aggregate_status: "revise_requested",
          aggregate_verdict: "revise",
          updated_at: "2026-05-07T09:46:53.968Z",
        },
      },
    },
    hooks: {
      "builtin.auto-mode-risk:write": {
        hook_id: "builtin.auto-mode-risk:write",
        stage: "write",
        hook_point: "before_stage_handoff",
        status: "revise_requested",
        blocked_reason: "Auto-mode risk discussion requested another mitigation pass.",
        updated_at: "2026-05-07T09:46:53.968Z",
      },
    },
  });

  const result = await materializeRevisionControlState({
    projectRoot,
    stage: "write",
  });

  assert.equal(result.state.status, "active");
  assert.equal(result.state.openSources.length, 1);
  assert.equal(result.state.openSources[0].sourceId, "builtin.auto-mode-risk:write");
});
