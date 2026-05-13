import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { detectWorkflowPaperArtifactTerminal } from "../../../tools/workflow-paper-terminal.ts";

test("paper artifact terminal detection reads canonical workflow_control before stale projection", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-paper-terminal-canonical-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), {
    recursive: true,
  });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.tex"), "body\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf\n", "utf8");

  const result = await detectWorkflowPaperArtifactTerminal({
    projectRoot,
    lane: "experiment",
    manifest: {
      current_stage: "plan",
      owner_agent: "orchestrator",
      blocking_reason: "stale projection blocker",
      workflow_control: {
        schema_version: 1,
        contract_id: "workflow-control:test",
        reconciled_at: "2026-05-12T12:00:00.000Z",
        stage: "submit",
        owner: "reviewer",
        next_action: "/auto-review",
        status: "ready",
        blocking_reason: null,
        completion: {
          status: "complete",
          source: "submit_completion",
          reason: null,
        },
        runtime_state: "idle",
        queue_key: null,
        session_key: null,
      },
      write_package: { status: "ready" },
      paper_qc: { status: "passed" },
      experiment_search: { status: "ready_for_analysis" },
    },
  });

  assert.equal(result.terminal, true);
  assert.equal(result.reason, "live_paper_artifact_ready");
  assert.equal(result.details.stage, "submit");
  assert.equal(result.details.owner, "reviewer");
  assert.equal(result.details.blockingReason, null);
});
