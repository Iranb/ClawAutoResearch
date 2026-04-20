import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateAutoGate, defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import { groundCitationsInGraph } from "../tools/research-writing/citation-grounding.ts";
import { maybeAdvanceAutoGateReviewForProject } from "../tools/register-workflow-service.ts";
import { syncExperimentOutcomesToGraph } from "../tools/workflow-guard-state/paper-ingestion.ts";
import { setReviewIssueTrackerState } from "../tools/workflow-guard.ts";

async function makeProjectRoot(prefix) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("syncExperimentOutcomesToGraph does not emit an invalid USES edge and clears sync only on success", async () => {
  const ledger = {
    summary: {
      papernexus_sync_required: true,
      papernexus_last_sync_at: null,
    },
    experiments: [
      {
        experiment_id: "exp-1",
        status: "completed",
        hypothesis_ref: "claim:main",
        method_ref: "method:router",
        result_summary: "Support precision improved.",
      },
    ],
  };
  const calls = [];

  const result = await syncExperimentOutcomesToGraph({
    projectRoot: "/tmp/demo-project",
    ledger,
    mcpClient: {
      async callTool(toolName, params) {
        calls.push({ toolName, params });
        return { ok: true, data: { persisted: true }, error: null };
      },
    },
    now: "2026-04-06T12:00:00.000Z",
  });

  assert.equal(result.synced, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "mutate_graph");
  assert.equal(calls[0].params.dryRun, false);
  assert.equal(calls[0].params.operations[0].action, "upsert_node");
  assert.equal(calls[0].params.operations[0].type, "Finding");
  assert.equal(calls[0].params.operations[0].id, "finding:exp-1");
  assert.equal(calls[0].params.operations[1].action, "upsert_relationship");
  assert.equal(calls[0].params.operations[1].type, "SUPPORTED_BY");
  assert.deepEqual(calls[0].params.operations[1].target, { id: "finding:exp-1" });
  assert.equal(
    calls[0].params.operations.some(
      (operation) => operation.type === "USES" || operation.edgeType === "USES"
    ),
    false
  );
  assert.equal(calls[0].params.operations[0].properties.methodRef, "method:router");
  assert.equal(ledger.experiments[0].papernexusSync.status, "synced");
  assert.equal(ledger.summary.papernexus_sync_required, false);
  assert.equal(ledger.summary.papernexus_last_sync_at, "2026-04-06T12:00:00.000Z");
});

test("syncExperimentOutcomesToGraph keeps the sync-required flag set when graph mutation fails", async () => {
  const ledger = {
    summary: {
      papernexus_sync_required: true,
      papernexus_last_sync_at: null,
    },
    experiments: [
      {
        experiment_id: "exp-1",
        status: "failed",
        hypothesis_ref: "claim:main",
        result_summary: "The hypothesis did not hold.",
      },
    ],
  };

  const result = await syncExperimentOutcomesToGraph({
    projectRoot: "/tmp/demo-project",
    ledger,
    mcpClient: {
      async callTool() {
        return { ok: false, data: null, error: "schema rejected edge" };
      },
    },
    now: "2026-04-06T12:30:00.000Z",
  });

  assert.equal(result.synced, false);
  assert.equal(ledger.experiments[0].papernexusSync.status, "failed");
  assert.equal(ledger.summary.papernexus_sync_required, true);
  assert.equal(ledger.summary.papernexus_last_sync_at, null);
});

test("setReviewIssueTrackerState persists score records and evaluateAutoGate uses them", async (t) => {
  const projectRoot = await makeProjectRoot("openclaw-review-fixes-");
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      status: "ready",
      score_records: [
        {
          reviewer_id: "reviewer",
          stage: "code_to_experiment",
          scores: {
            novelty: 8.2,
            technical_soundness: 8.4,
            clarity: 8.1,
            significance: 8.0,
            reproducibility: 8.3,
          },
          average: 8.2,
          min_single: 8.0,
          recommendation: "advance",
          timestamp: "2026-04-06T13:00:00.000Z",
        },
        {
          reviewer_id: "orchestrator",
          stage: "code_to_experiment",
          scores: {
            novelty: 8.4,
            technical_soundness: 8.5,
            clarity: 8.1,
            significance: 8.2,
            reproducibility: 8.0,
          },
          average: 8.24,
          min_single: 8.0,
          recommendation: "advance",
          timestamp: "2026-04-06T13:01:00.000Z",
        },
      ],
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(Array.isArray(manifest.review_issue_tracker?.score_records), true);
  assert.equal(manifest.review_issue_tracker.score_records.length, 2);

  const evaluation = evaluateAutoGate("code", manifest, defaultAutoGateConfig());
  assert.equal(evaluation.pass, true);
  assert.equal(evaluation.scoreRecordCount, 2);
});

test("maybeAdvanceAutoGateReviewForProject rejects submit when recorded scores miss the threshold", async (t) => {
  const projectRoot = await makeProjectRoot("openclaw-auto-gate-submit-");
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        review_issue_tracker: {
          score_records: [
            {
              reviewer_id: "reviewer",
              stage: "submit_to_done",
              scores: {
                novelty: 8.5,
                technical_soundness: 8.6,
                clarity: 8.4,
                significance: 8.5,
                reproducibility: 8.3,
              },
              average: 8.46,
              min_single: 8.3,
              recommendation: "revise",
              timestamp: "2026-04-06T15:00:00.000Z",
            },
            {
              reviewer_id: "cross-reviewer",
              stage: "submit_to_done",
              scores: {
                novelty: 8.4,
                technical_soundness: 8.5,
                clarity: 8.5,
                significance: 8.4,
                reproducibility: 8.2,
              },
              average: 8.4,
              min_single: 8.2,
              recommendation: "revise",
              timestamp: "2026-04-06T15:01:00.000Z",
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await maybeAdvanceAutoGateReviewForProject({
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
    projectRoot,
    projectId: "demo-project",
    autoIteratorResult: {
      effectiveAutoMode: "aggressive",
      gateBlocking: true,
      stageAfter: "submit",
    },
  });

  assert.equal(result.reason, "already_rejected");
  assert.equal(result.status, "rejected");
  assert.equal(result.reviewCount, 2);
  assert.equal(result.approved, false);
});

test("groundCitationsInGraph treats MCP text content with query results as verified citations", async (t) => {
  const projectRoot = await makeProjectRoot("openclaw-citation-grounding-");
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "Recent work builds on \\\\cite{smith2024router}.\n"
  );

  const result = await groundCitationsInGraph({
    projectRoot,
    draftPath: "academic_writer/paper/main.tex",
    mcpClient: {
      async callTool() {
        return {
          ok: true,
          data: {
            content: [
              {
                type: "text",
                text:
                  'Results for "smith2024router":\n' +
                  "- Evidence-aligned routing (DocumentLayer, 1 matches, score 7.10)\n" +
                  "  • Paper: Evidence-Aligned Routing for Support Precision\n" +
                  "    Matches the citation query in the indexed corpus.",
              },
            ],
          },
          error: null,
        };
      },
    },
  });

  assert.equal(result.totalCitations, 1);
  assert.equal(result.verifiedCount, 1);
  assert.equal(result.unverifiedCount, 0);
});

test("plugin schema exposes autoGate.thresholds.code_to_experiment", async () => {
  const pluginJson = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "openclaw.plugin.json"), "utf8")
  );

  assert.ok(
    pluginJson?.configSchema?.properties?.autoGate?.properties?.thresholds?.properties
      ?.code_to_experiment
  );
});

test("plugin schema exposes autoGate.gateModes.review_to_write", async () => {
  const pluginJson = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "openclaw.plugin.json"), "utf8")
  );

  assert.ok(
    pluginJson?.configSchema?.properties?.autoGate?.properties?.gateModes?.properties
      ?.review_to_write
  );
});

test("default auto gate config keeps submit_to_done manual while earlier gates use panel mode", () => {
  const config = defaultAutoGateConfig();
  assert.equal(config.gateModes.review_to_write, "panel_gate");
  assert.equal(config.gateModes.write_to_submit, "panel_gate");
  assert.equal(config.gateModes.submit_to_done, "manual_gate");
});
