import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveWorkflowGraphContext,
  isGraphSensitiveWorkflowStage,
  shouldRefreshWorkflowGraphPresence,
} from "../../../tools/workflow-kernel/graph-context.ts";

test("isGraphSensitiveWorkflowStage recognizes the current graph-sensitive stages", () => {
  assert.equal(isGraphSensitiveWorkflowStage("graph_build"), true);
  assert.equal(isGraphSensitiveWorkflowStage("frontier_mapping"), true);
  assert.equal(isGraphSensitiveWorkflowStage("idea"), true);
  assert.equal(isGraphSensitiveWorkflowStage("plan"), false);
});

test("deriveWorkflowGraphContext resolves ready state from durable paper_ingestion fields", () => {
  const context = deriveWorkflowGraphContext({
    manifest: {
      paper_ingestion: {
        graph_presence_status: "ready",
        graph_presence_checked_at: "2026-04-11T08:00:00.000Z",
        refresh_required: false,
        repair_required: false,
        runtime_status: "ready",
        graph_build_workflow_status: "ready",
        graph_build_can_continue: true,
        graph_build_requires_import: false,
        graph_build_requires_source_repair: false,
      },
    },
    stage: "graph_build",
    nowIso: "2026-04-11T08:00:10.000Z",
    minRefreshIntervalMs: 15_000,
  });

  assert.equal(context.graphSensitive, true);
  assert.equal(context.status, "ready");
  assert.equal(context.graphPresenceStatus, "ready");
  assert.equal(context.refreshRequired, false);
  assert.equal(context.recentlyChecked, true);
  assert.equal(context.runtimeStatus, "ready");
  assert.equal(context.graphBuildWorkflowStatus, "ready");
  assert.equal(context.graphBuildCanContinue, true);
  assert.equal(context.graphBuildRequiresImport, false);
  assert.equal(context.graphBuildRequiresSourceRepair, false);
});

test("deriveWorkflowGraphContext exposes durable graph-build workflow contracts", () => {
  const context = deriveWorkflowGraphContext({
    manifest: {
      paper_ingestion: {
        graph_presence_status: "missing_papers",
        graph_presence_checked_at: "2026-04-11T08:00:00.000Z",
        refresh_required: false,
        runtime_status: "ready",
        graph_build_workflow_status: "degraded",
        graph_build_can_continue: true,
        graph_build_requires_import: false,
        graph_build_requires_source_repair: false,
        graph_build_status_reason:
          "Graph is partially populated; workflow may continue with degraded coverage.",
      },
    },
    stage: "frontier_mapping",
    nowIso: "2026-04-11T08:00:20.000Z",
    minRefreshIntervalMs: 15_000,
  });

  assert.equal(context.status, "stale");
  assert.equal(context.graphPresenceStatus, "missing_papers");
  assert.equal(context.graphBuildWorkflowStatus, "degraded");
  assert.equal(context.graphBuildCanContinue, true);
  assert.equal(context.graphBuildRequiresImport, false);
  assert.equal(context.graphBuildRequiresSourceRepair, false);
  assert.match(context.graphBuildStatusReason ?? "", /partially populated/i);
});

test("deriveWorkflowGraphContext treats missing corpus checks as unavailable graph context", () => {
  const context = deriveWorkflowGraphContext({
    manifest: {
      paper_ingestion: {
        graph_presence_status: "missing_papers",
        refresh_required: true,
      },
    },
    stage: "idea",
    nowIso: "2026-04-11T08:00:10.000Z",
    graphPresenceCheck: {
      projectRoot: "/tmp/demo",
      projectId: "demo",
      checkedAt: "2026-04-11T08:00:00.000Z",
      status: "missing_corpus",
      blockingReason: "missing corpus",
      reportPath: "graph/GRAPH_PRESENCE_CHECK.json",
      paperSourceIndexPath: null,
      usedPaperSourceIndex: false,
      expectedPaperCount: 0,
      presentPaperCount: 0,
      missingPaperCount: 0,
      corpusRoot: null,
      corpusName: null,
      corpusManifestPath: null,
      corpusMetaPath: null,
      refreshRequired: true,
      refreshReason: "missing corpus",
      repairRequired: false,
      repairReason: null,
      repairTargetCorpus: null,
      presentPapers: [],
      missingPapers: [],
      manifestUpdated: false,
    },
  });

  assert.equal(context.status, "unavailable");
  assert.equal(context.graphPresenceCheckStatus, "missing_corpus");
  assert.equal(context.refreshRequired, true);
});

test("shouldRefreshWorkflowGraphPresence preserves refresh semantics for stale graph-sensitive stages", () => {
  assert.equal(
    shouldRefreshWorkflowGraphPresence({
      manifest: {
        paper_ingestion: {
          graph_presence_status: "ready",
          graph_presence_checked_at: "2026-04-11T08:00:00.000Z",
          refresh_required: false,
        },
      },
      stage: "graph_build",
      nowIso: "2026-04-11T08:00:05.000Z",
      minRefreshIntervalMs: 15_000,
    }),
    false
  );

  assert.equal(
    shouldRefreshWorkflowGraphPresence({
      manifest: {
        paper_ingestion: {
          graph_presence_status: "missing_papers",
          graph_presence_checked_at: "2026-04-11T08:00:00.000Z",
          refresh_required: true,
        },
      },
      stage: "idea",
      nowIso: "2026-04-11T08:00:05.000Z",
      minRefreshIntervalMs: 15_000,
    }),
    true
  );

  assert.equal(
    shouldRefreshWorkflowGraphPresence({
      manifest: {
        paper_ingestion: {
          graph_presence_status: "missing_papers",
          graph_presence_checked_at: "2026-04-11T08:00:00.000Z",
          refresh_required: false,
        },
      },
      stage: "frontier_mapping",
      nowIso: "2026-04-11T08:00:05.000Z",
      minRefreshIntervalMs: 15_000,
    }),
    false
  );
});
