import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeIdeationContractImpl } from "../../../tools/workflow-guard-materializers/ideation-contract-materializer.ts";
import { materializePaperStoryStateImpl } from "../../../tools/workflow-guard-materializers/paper-story-materializer.ts";
import { materializeReviewPressurePacketImpl } from "../../../tools/workflow-guard-materializers/review-pressure-materializer.ts";
import { buildDynamicTasksImpl } from "../../../tools/workflow-guard-guidance/dynamic-tasks.ts";
import { buildPapernexusGuidance } from "../../../tools/workflow-guard-guidance/papernexus-guidance.ts";
import { buildWritingGuidance } from "../../../tools/workflow-guard-guidance/writing-guidance.ts";
import { collectGraphBuildStageMissingSignals } from "../../../tools/workflow-guard-stages/foundation-stage-signals.ts";
import {
  deriveGraphBuildPartialReadiness,
  derivePaperIngestionWorkflowDecision,
  hasActiveWorkflowOwnedPaperUpload,
  normalizePaperIngestionState,
} from "../../../tools/workflow-guard-state/paper-ingestion.ts";
import {
  asRecord,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickString,
} from "../../../tools/workflow-guard-core/coercion.ts";
import {
  getExperimentMemorySummaryImpl,
  recordCitationVerificationImpl,
  recordIdleResearchRunImpl,
  recordInnovationReflectionImpl,
  upsertExperimentLedgerEntryImpl,
} from "../../../tools/workflow-guard-recorders/state-recorders.ts";
import { runWorkflowAutoIteratorImpl } from "../../../tools/workflow-guard-runtime/auto-iterator.ts";
import {
  buildPapernexusSyncStateFromGraphPresence,
  papernexusSyncStateAllowsWorkflowContinue,
} from "../../../tools/papernexus-sync-state.ts";
import {
  derivePapernexusProgressSnapshotFromSyncState,
} from "../../../tools/papernexus-progress.ts";

test("workflow guard materializer and guidance modules expose dedicated entrypoints", () => {
  assert.equal(typeof materializeIdeationContractImpl, "function");
  assert.equal(typeof materializePaperStoryStateImpl, "function");
  assert.equal(typeof materializeReviewPressurePacketImpl, "function");
  assert.equal(typeof buildDynamicTasksImpl, "function");
  assert.equal(typeof buildPapernexusGuidance, "function");
  assert.equal(typeof buildWritingGuidance, "function");
  assert.equal(typeof recordCitationVerificationImpl, "function");
  assert.equal(typeof recordIdleResearchRunImpl, "function");
  assert.equal(typeof recordInnovationReflectionImpl, "function");
  assert.equal(typeof getExperimentMemorySummaryImpl, "function");
  assert.equal(typeof upsertExperimentLedgerEntryImpl, "function");
  assert.equal(typeof runWorkflowAutoIteratorImpl, "function");
});

test("PaperNexus sync state blocks remote summary-only graph readiness and drives progress projection", () => {
  const syncState = buildPapernexusSyncStateFromGraphPresence({
    projectId: "summary-only-demo",
    authorityMode: "remote_mcp",
    corpus: "GCD",
    graphPresence: {
      projectId: "summary-only-demo",
      checkedAt: "2026-05-11T00:00:00.000Z",
      status: "ready",
      verificationMode: "remote_corpus_summary",
      reportPath: "graph/GRAPH_PRESENCE_CHECK.json",
      paperSourceIndexPath: "researcher/PAPER_SOURCE_INDEX.json",
      expectedPaperCount: 1,
      presentPaperCount: 1,
      missingPaperCount: 0,
      readyProofLevel: "remote_summary",
      sourceBackedPresentCount: 0,
      paperIndexPresentCount: 0,
      corpusName: "GCD",
      refreshRequired: false,
      refreshReason: null,
      repairRequired: false,
      repairReason: null,
      presentPapers: [{ canonical_id: "arxiv:2501.00001", title: "Demo" }],
      missingPapers: [],
      graphBuildWorkflowStatus: "ready",
      graphBuildCanContinue: true,
      graphBuildRequiresImport: false,
      graphBuildStatusReason: null,
    },
    certificationSummary: {
      sourceBackedGraphClaim: false,
      reportPath: "graph/PAPERNEXUS_TASK_CERTIFICATION.json",
      limitations: ["remote_corpus_summary_without_per_paper_source_spans"],
      taskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      queueRemaining: 0,
      metadataOnlyPaperCount: 1,
      sourceBackedPaperCount: 0,
    },
  });

  assert.equal(syncState.graph_presence.status, "degraded");
  assert.equal(syncState.workflow_projection.can_continue, false);
  assert.equal(papernexusSyncStateAllowsWorkflowContinue(syncState), false);
  assert.ok(
    syncState.conflicts.includes(
      "graph_presence_reported_ready_without_usable_proof:remote_summary"
    )
  );

  const progress = derivePapernexusProgressSnapshotFromSyncState({ syncState });
  assert.equal(progress.phase, "verifying_graph");
  assert.equal(progress.graph_check.status, "degraded");
  assert.equal(progress.next_action, syncState.workflow_projection.next_action);
});

test("PaperNexus sync state allows failed imports when source-backed graph evidence is ready", () => {
  const syncState = buildPapernexusSyncStateFromGraphPresence({
    projectId: "failed-import-ready-demo",
    authorityMode: "remote_mcp",
    corpus: "GCD",
    graphPresence: {
      projectId: "failed-import-ready-demo",
      checkedAt: "2026-05-11T00:00:00.000Z",
      status: "ready",
      verificationMode: "canonical_paper_index",
      reportPath: "graph/GRAPH_PRESENCE_CHECK.json",
      paperSourceIndexPath: "researcher/PAPER_SOURCE_INDEX.json",
      expectedPaperCount: 1,
      presentPaperCount: 1,
      missingPaperCount: 0,
      readyProofLevel: "source_span",
      sourceBackedPresentCount: 1,
      paperIndexPresentCount: 1,
      corpusName: "GCD",
      refreshRequired: false,
      refreshReason: null,
      repairRequired: false,
      repairReason: null,
      presentPapers: [
        {
          canonical_id: "arxiv:2501.00001",
          title: "Demo",
          corpus_source_key: "paper:arxiv:2501.00001",
          has_paper_index_evidence: true,
          has_source_span_evidence: true,
        },
      ],
      missingPapers: [],
      graphBuildWorkflowStatus: "ready",
      graphBuildCanContinue: true,
      graphBuildRequiresImport: false,
      graphBuildStatusReason: null,
    },
    certificationSummary: {
      sourceBackedGraphClaim: true,
      reportPath: "graph/PAPERNEXUS_TASK_CERTIFICATION.json",
      limitations: ["failed_import_tasks"],
      taskCount: 2,
      completedTaskCount: 1,
      failedTaskCount: 1,
      queueRemaining: 0,
      metadataOnlyPaperCount: 0,
      sourceBackedPaperCount: 1,
    },
    receiptPath: "graph/PAPERNEXUS_GRAPH_BUILD_RECEIPT.json",
    receipt: {
      schema_version: 1,
      status: "graph_ready",
      graph_visibility: "verified",
      source_backed_count: 1,
      source_backed_graph_claim: true,
      task_summary: {
        total: 2,
        pending: 0,
        running: 0,
        completed: 1,
        failed: 1,
        remaining: 0,
      },
      coverage: {
        min_required_satisfied: true,
        min_source_backed_papers: 1,
        notes: ["failed_import_tasks"],
      },
    },
  });

  assert.equal(syncState.imports.failed_count, 1);
  assert.equal(syncState.proof.min_required_satisfied, true);
  assert.equal(syncState.workflow_projection.can_continue, true);
  assert.equal(papernexusSyncStateAllowsWorkflowContinue(syncState), true);
  assert.equal(
    syncState.conflicts.includes("graph_ready_with_failed_import_tasks"),
    false
  );
});

test("graph_build stage accepts partial graph coverage when missing papers are repair-only", async () => {
  const manifest = {
    project_id: "partial-graph-demo",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "blocked",
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_papers",
      graph_presence_expected_papers: 2,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [
        { canonical_id: "arxiv:1803.02999", title: "On First-Order Meta-Learning Algorithms" },
      ],
      queued_requests: [
        {
          request_id: "req-partial",
          status: "needs_repair",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-partial/batch-import.json",
          last_error: "backend rejected one source",
        },
      ],
      batch_items: [
        {
          canonical_id: "arxiv:2410.11206",
          status: "completed",
          synced: true,
          import_task_id: "task-fixmatch",
        },
        {
          canonical_id: "arxiv:1803.02999",
          status: "submit_failed",
          error: "backend rejected one source",
        },
      ],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/partial-graph-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/partial-graph-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:1803.02999",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
});

test("graph_build stage accepts local source fallback after terminal PaperNexus failure", async () => {
  const manifest = {
    project_id: "local-source-graph-fallback-demo",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "waiting_import",
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_papers",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 0,
      graph_presence_missing_papers: [
        {
          canonical_id: "arxiv:2410.11206",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
          source_kind: "markdown",
          source_provider: "arxiv2md-api",
        },
      ],
      queued_requests: [
        {
          request_id: "req-dead-letter",
          request_kind: "upload_manifest",
          status: "queued",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-dead-letter/batch-import.json",
          last_error: "HTTP 502 for MCP tools/call:",
          finished_at: "2026-04-26T00:01:00.000Z",
          attempt_count: 3,
          max_attempts: 3,
          dead_letter_at: "2026-04-26T00:01:00.000Z",
          dead_letter_reason: "HTTP 502 for MCP tools/call:",
        },
      ],
      active_batches: [
        {
          manifest_path: "researcher/paper-staging/queued-imports/req-dead-letter/batch-import.json",
          status: "running",
          total: 1,
          detail: "HTTP 502 for MCP tools/call:",
        },
      ],
      batch_items: [],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/local-source-graph-fallback-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/local-source-graph-fallback-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:2410.11206",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
});

test("graph_build stage blocks local source fallback after remote PaperNexus failure", async () => {
  const paperIngestion = {
    runtime_status: "waiting_graph",
    graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
    graph_presence_status: "missing_corpus",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 0,
    graph_presence_missing_papers: [
      {
        canonical_id: "arxiv:2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_kind: "markdown",
        source_provider: "arxiv2md-api",
      },
    ],
    queued_requests: [
      {
        request_id: "req-remote-dead-letter",
        request_kind: "upload_manifest",
        status: "needs_repair",
        wrapper: "pn_batch_import.py",
        manifest_path:
          "researcher/paper-staging/queued-imports/req-remote-dead-letter/batch-import.json",
        command_text:
          "python3 skills/researcher/papernexus/scripts/pn_batch_import.py --mcp-url http://10.126.56.30:4821/mcp --manifest researcher/paper-staging/queued-imports/req-remote-dead-letter/batch-import.json wait",
        last_error: "MCP request tools/call failed: [Errno 61] Connection refused",
        attempt_count: 3,
        max_attempts: 3,
      },
    ],
    active_batches: [],
    batch_items: [],
  };
  const state = normalizePaperIngestionState(paperIngestion);
  const readiness = deriveGraphBuildPartialReadiness({
    paperIngestion,
    state,
    graphPresenceStatus: "missing_corpus",
  });

  assert.equal(readiness.ready, false);

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/remote-source-graph-fallback-demo",
      manifest: {
        project_id: "remote-source-graph-fallback-demo",
        current_stage: "graph_build",
        paper_ingestion: paperIngestion,
      },
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/remote-source-graph-fallback-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:2410.11206",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.ok(
    missing.some((entry) =>
      /paper_ingestion\.graph_presence_status = ready/i.test(entry)
    )
  );
});

test("graph_build remote mode requires source-backed sync state with receipt proof", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "remote-graph-build-receipt-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const manifest = {
    project_id: "remote-receipt-demo",
    current_stage: "graph_build",
    paper_ingestion: {
      papernexus_access_mode: "remote_mcp",
      papernexus_mcp_url: "http://papernexus.example/mcp",
      graph_presence_checked_at: "2026-05-11T00:00:00.000Z",
      graph_presence_status: "ready",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [],
    },
  };
  const deps = {
    pathExists: async () => true,
    isNonEmptyDirectory: async () => true,
    fileHasMeaningfulJsonContent: async () => true,
    manifestFieldExists: (source, pathSpec) => {
      let cursor = source;
      for (const segment of pathSpec) {
        cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
      }
      return cursor !== undefined && cursor !== null;
    },
    getExperimentLedgerPath: () => path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
    pickString,
    normalizeResearchProgramState: () => ({}),
    getResearchProgramOnboardingGaps: () => [],
    asRecord,
    normalizeGraphPresenceStatus,
    normalizePaperIngestionState,
    hasActiveWorkflowOwnedPaperUpload,
    derivePaperIngestionWorkflowDecision,
    summarizeGraphPresenceMissing: () => null,
    getBrainstormCycleMissingSignals: async () => [],
    normalizeStage,
  };

  const missingWithoutSyncState = await collectGraphBuildStageMissingSignals(
    {
      projectRoot,
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    deps
  );
  assert.ok(
    missingWithoutSyncState.some((entry) =>
      /PAPERNEXUS_SYNC_STATE\.json/.test(entry)
    )
  );

  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "graph", "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        request_id: "req-1",
        run_id: "run-1",
        corpus: "remote-receipt-demo",
        status: "graph_ready",
        graph_visibility: "verified",
        graph_fingerprint: "remote-receipt-demo:2026-05-11",
        checked_at: "2026-05-11T00:00:00.000Z",
        canonical_ids_requested: ["arxiv:2501.00001"],
        canonical_ids_in_graph: ["arxiv:2501.00001"],
        canonical_ids_missing: [],
        source_backed_count: 1,
        metadata_only_count: 0,
        source_backed_graph_claim: true,
        active_in_graph_sources: ["paper:arxiv:2501.00001"],
        task_summary: {
          total: 1,
          pending: 0,
          running: 0,
          completed: 1,
          failed: 0,
          remaining: 0,
        },
        coverage: {
          min_required_satisfied: true,
          min_source_backed_papers: 1,
          notes: [],
        },
        evidence_packet_path: null,
        limitations: [],
        repair_hints: [],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const missingWithReceiptOnly = await collectGraphBuildStageMissingSignals(
    {
      projectRoot,
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    deps
  );
  assert.ok(
    missingWithReceiptOnly.some((entry) =>
      /PAPERNEXUS_SYNC_STATE\.json/.test(entry)
    )
  );

  await fs.writeFile(
    path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        project_id: "remote-receipt-demo",
        generated_at: "2026-05-11T00:00:00.000Z",
        authority: {
          mode: "remote_mcp",
          corpus: "remote-receipt-demo",
          api_fallback_used: false,
          tool_versions: {},
        },
        desired_corpus: {
          source: "researcher/PAPER_SOURCE_INDEX.json",
          paper_count: 1,
          papers: ["arxiv:2501.00001"],
        },
        discovery: {
          metadata_only_count: 0,
          source_resolved_count: 1,
        },
        imports: {
          total_count: 1,
          pending_count: 0,
          running_count: 0,
          completed_count: 1,
          failed_count: 0,
          remaining_count: 0,
          tasks: [],
        },
        graph_presence: {
          status: "ready",
          ready_proof_level: "source_span",
          verification_mode: "canonical_paper_index",
          expected_paper_count: 1,
          present_paper_count: 1,
          missing_paper_count: 0,
          source_backed_present_count: 1,
          paper_index_present_count: 1,
          present_papers: [],
          missing_papers: [],
        },
        proof: {
          latest_receipt_path: "graph/PAPERNEXUS_GRAPH_BUILD_RECEIPT.json",
          certification_path: "graph/PAPERNEXUS_TASK_CERTIFICATION.json",
          graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
          source_backed_graph_claim: true,
          graph_visibility: "verified",
          graph_fingerprint: "remote-receipt-demo:2026-05-11",
          min_required_satisfied: true,
        },
        workflow_projection: {
          runtime_status: "ready",
          can_continue: true,
          blocking_reason: null,
          next_action: "continue workflow",
        },
        conflicts: [],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const missingWithReadySyncState = await collectGraphBuildStageMissingSignals(
    {
      projectRoot,
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    deps
  );
  assert.deepEqual(missingWithReadySyncState, []);

  const readyReceiptPath = path.join(
    projectRoot,
    "graph",
    "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"
  );
  const readyReceipt = JSON.parse(await fs.readFile(readyReceiptPath, "utf8"));
  readyReceipt.task_summary = {
    total: 2,
    pending: 0,
    running: 0,
    completed: 1,
    failed: 1,
    remaining: 0,
  };
  await fs.writeFile(
    readyReceiptPath,
    `${JSON.stringify(readyReceipt, null, 2)}\n`,
    "utf8"
  );

  const readySyncStatePath = path.join(
    projectRoot,
    "graph",
    "PAPERNEXUS_SYNC_STATE.json"
  );
  const readySyncState = JSON.parse(await fs.readFile(readySyncStatePath, "utf8"));
  readySyncState.imports = {
    ...readySyncState.imports,
    total_count: 2,
    pending_count: 0,
    running_count: 0,
    completed_count: 1,
    failed_count: 1,
    remaining_count: 0,
  };
  await fs.writeFile(
    readySyncStatePath,
    `${JSON.stringify(readySyncState, null, 2)}\n`,
    "utf8"
  );

  const missingWithFailedImportReadySyncState =
    await collectGraphBuildStageMissingSignals(
      {
        projectRoot,
        manifest,
        trackRegistry: null,
        experimentLedger: null,
      },
      deps
    );
  assert.deepEqual(missingWithFailedImportReadySyncState, []);

  await fs.writeFile(
    path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        project_id: "remote-receipt-demo",
        generated_at: "2026-05-11T00:00:00.000Z",
        authority: {
          mode: "remote_mcp",
          corpus: "remote-receipt-demo",
          api_fallback_used: false,
          tool_versions: {},
        },
        desired_corpus: {
          source: "researcher/PAPER_SOURCE_INDEX.json",
          paper_count: 1,
          papers: ["arxiv:2501.00001"],
        },
        discovery: {
          metadata_only_count: 1,
          source_resolved_count: 0,
        },
        imports: {
          total_count: 1,
          pending_count: 0,
          running_count: 0,
          completed_count: 1,
          failed_count: 0,
          remaining_count: 0,
          tasks: [],
        },
        graph_presence: {
          status: "degraded",
          ready_proof_level: "remote_summary",
          verification_mode: "remote_corpus_summary",
          expected_paper_count: 1,
          present_paper_count: 1,
          missing_paper_count: 0,
          source_backed_present_count: 0,
          paper_index_present_count: 0,
          present_papers: [],
          missing_papers: [],
        },
        proof: {
          latest_receipt_path: "graph/PAPERNEXUS_GRAPH_BUILD_RECEIPT.json",
          certification_path: "graph/PAPERNEXUS_TASK_CERTIFICATION.json",
          graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
          source_backed_graph_claim: false,
          graph_visibility: "unverified",
          graph_fingerprint: "remote-receipt-demo:stale",
          min_required_satisfied: false,
        },
        workflow_projection: {
          runtime_status: "degraded",
          can_continue: false,
          blocking_reason: "summary-only state must not override PaperNexus graph proof",
          next_action: "refresh PaperNexus graph presence with per-paper source-backed evidence",
        },
        conflicts: [],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const missingWithBlockedSyncState = await collectGraphBuildStageMissingSignals(
    {
      projectRoot,
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    deps
  );
  assert.ok(
    missingWithBlockedSyncState.some((entry) =>
      /sync state must be source-backed ready/i.test(entry)
    )
  );
});

test("paper ingestion decision ignores stale graph-build PaperNexus batches once graph presence is ready", () => {
  const state = normalizePaperIngestionState({
    runtime_status: "waiting_import",
    graph_presence_status: "ready",
    queued_requests: [
      {
        request_id: "graph-build-source-catchup-demo",
        request_kind: "upload_manifest",
        status: "queued",
        wrapper: "pn_batch_import.py",
        manifest_path:
          "researcher/paper-staging/queued-imports/graph-build-source-catchup-demo/batch-import.json",
        created_at: "2026-05-06T00:00:00.000Z",
        updated_at: "2026-05-06T00:00:00.000Z",
        last_run_id: "direct-papernexus-batch-graph-build-source-catchup-demo",
        last_session_key: "local:papernexus:direct-batch-import",
        trigger_kind: "graph_build_source_catchup",
        attempt_count: 1,
      },
    ],
    active_batches: [
      {
        manifest_path:
          "researcher/paper-staging/queued-imports/graph-build-source-catchup-demo/batch-import.json",
        status: "running",
        total: 6,
      },
    ],
    paper_operations: [
      {
        canonical_id: "arxiv:2603.21852",
        import_task_id: "imp:eml",
        phase: "import",
        status: "running",
        started_at: "2026-05-06T00:00:00.000Z",
        finished_at: "2026-05-06T00:05:00.000Z",
      },
    ],
  });

  const decision = derivePaperIngestionWorkflowDecision({
    state,
    graphPresenceStatus: "ready",
  });

  assert.equal(decision.action, "continue");
  assert.equal(decision.blocking, false);
  assert.match(decision.reason ?? "", /graph presence is ready/i);
  assert.equal(decision.activeBatchCount, 1);
  assert.equal(decision.queuedRequestCount, 1);
  assert.equal(decision.dormantQueuedRequestCount, 0);
  assert.equal(decision.activeOperationCount, 0);
});

test("graph_build partial readiness treats queued source catch-up imports as active work", () => {
  const paperIngestion = {
    runtime_status: "blocked",
    graph_presence_status: "missing_corpus",
    graph_presence_expected_papers: 2,
    graph_presence_present_papers: 0,
    graph_presence_missing_papers: [
      {
        canonical_id: "arxiv:2511.03685",
        title: "Structured Matrix Scaling for Multi-Class Calibration",
        source_kind: "pdf",
        source_path: "researcher/paper-staging/pdf/2511.03685.pdf",
      },
      {
        canonical_id: "arxiv:2512.17527",
        title: "SafeBench-Seq",
        source_kind: "markdown",
        source_path: "researcher/paper-staging/md/2512.17527.md",
      },
    ],
    queued_requests: [
      {
        request_id: "graph-build-source-catchup-old",
        request_kind: "upload_manifest",
        status: "needs_repair",
        wrapper: "pn_batch_import.py",
        trigger_kind: "graph_build_source_catchup",
        manifest_path:
          "researcher/paper-staging/queued-imports/graph-build-source-catchup-old/batch-import.json",
        last_error: "MCP request tools/call failed: [Errno 61] Connection refused",
      },
      {
        request_id: "graph-build-source-catchup-current",
        request_kind: "upload_manifest",
        status: "queued",
        wrapper: "pn_batch_import.py",
        trigger_kind: "graph_build_source_catchup",
        manifest_path:
          "researcher/paper-staging/queued-imports/graph-build-source-catchup-current/batch-import.json",
        created_at: "2026-05-10T15:00:44.252Z",
        updated_at: "2026-05-10T15:00:44.252Z",
        attempt_count: 0,
      },
    ],
  };
  const state = normalizePaperIngestionState(paperIngestion);

  const readiness = deriveGraphBuildPartialReadiness({
    paperIngestion,
    state,
    graphPresenceStatus: "missing_corpus",
  });
  const decision = derivePaperIngestionWorkflowDecision({
    state,
    graphPresenceStatus: "missing_corpus",
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.hardActiveCount > 0, true);
  assert.equal(decision.action, "wait");
  assert.equal(decision.queuedRequestCount, 1);
  assert.equal(decision.hardActiveCount > 0, true);
  assert.equal(decision.queuedLaunchabilityStatus, "queued_but_dispatchable");
});

test("graph_build prerequisite stays satisfied downstream after local source fallback", async () => {
  const manifest = {
    project_id: "downstream-local-source-fallback-demo",
    current_stage: "frontier_mapping",
    paper_ingestion: {
      runtime_status: "waiting_graph",
      repair_required: true,
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_corpus",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 0,
      graph_presence_missing_papers: [
        {
          canonical_id: "arxiv:2410.11206",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
          source_kind: "markdown",
          source_provider: "arxiv2md-api",
        },
      ],
      queued_requests: [
        {
          request_id: "req-dormant",
          request_kind: "upload_manifest",
          status: "failed",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-dormant/batch-import.json",
          attempt_count: 3,
          max_attempts: 3,
          dead_letter_at: "2026-04-26T00:05:00.000Z",
        },
      ],
      active_batches: [],
      batch_items: [],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/downstream-local-source-fallback-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/downstream-local-source-fallback-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:2410.11206",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
});

test("buildWritingGuidance surfaces story-first and adversarial review reminders for writer/reviewer roles", () => {
  const writerGuidance = buildWritingGuidance(
    {
      role: "academic_writer",
      currentStage: "write",
      manifest: {
        paper_story_state: {
          status: "ready",
          story_spine_path: "academic_writer/story/STORY_SPINE.md",
          claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
          fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
        },
        review_pressure_packet: {
          status: "ready",
          reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
          reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
          unsupported_claim_audit_path:
            "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
        },
      },
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: "conference",
        bodyPageBudget: 9,
        referencePageBudget: 2,
        bodyWordTargetMin: 4500,
        bodyWordTargetMax: 6000,
        kgStorylineRequired: true,
        kgStorylinePacketPath: "academic_writer/KG_STORYLINE_PACKET.json",
        kgStorylineStatus: "ready",
        templateMappingPath: "academic_writer/TEMPLATE_MAPPING.md",
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "red",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP", "CrossRef"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusApiTokenEnv: null,
      papernexusApiTokenSource: null,
      papernexusApiTokenService: null,
      papernexusApiTokenAccount: null,
      papernexusMineruHttpUrl: null,
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(
    writerGuidance.prepend.some((entry) => /story spine|claim-to-experiment|fallback/i.test(entry))
  );
  assert.ok(
    writerGuidance.prepend.some((entry) => /Writing flow map:/i.test(entry))
  );
  assert.ok(
    writerGuidance.append.some((entry) => /reject-first|reverse-outline|unsupported/i.test(entry))
  );
  assert.ok(
    writerGuidance.append.some((entry) => /Revision loop rule:/i.test(entry))
  );

  const reviewerGuidance = buildWritingGuidance(
    {
      role: "reviewer",
      currentStage: "write",
      manifest: {
        review_pressure_packet: {
          status: "ready",
          reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
          novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
        },
      },
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: null,
        bodyPageBudget: null,
        referencePageBudget: null,
        bodyWordTargetMin: null,
        bodyWordTargetMax: null,
        kgStorylineRequired: false,
        kgStorylinePacketPath: null,
        kgStorylineStatus: null,
        templateMappingPath: null,
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "green",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusApiTokenEnv: null,
      papernexusApiTokenSource: null,
      papernexusApiTokenService: null,
      papernexusApiTokenAccount: null,
      papernexusMineruHttpUrl: null,
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(
    reviewerGuidance.prepend.some((entry) => /citation integrity gate/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.prepend.some((entry) => /Writing flow map:/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.append.some((entry) => /reject-first|novelty attack/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.append.some((entry) => /Review routing rule:/i.test(entry))
  );
});

test("buildPapernexusGuidance teaches researcher to use remote MCP when remote_mcp is configured", () => {
  const guidance = buildPapernexusGuidance(
    {
      role: "researcher",
      currentStage: "graph_build",
      manifest: null,
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: null,
        bodyPageBudget: null,
        referencePageBudget: null,
        bodyWordTargetMin: null,
        bodyWordTargetMax: null,
        kgStorylineRequired: false,
        kgStorylinePacketPath: null,
        kgStorylineStatus: null,
        templateMappingPath: null,
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "green",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusMcpUrl: "https://papernexus.example/mcp",
      papernexusMcpTransport: "streamable-http",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenSource: "auto",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
      papernexusMineruHttpUrl: null,
      papernexusAccessMode: "remote_mcp",
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(guidance.prepend.some((entry) => /remote_mcp/i.test(entry)));
  assert.ok(
    guidance.prepend.some(
      (entry) => /PaperNexus MCP|research_lookup|research_briefing|idea_catalyst|import_workflow/i.test(entry)
    )
  );
  assert.ok(
    guidance.prepend.some(
      (entry) =>
        /MCP tool names, not shell commands/i.test(entry) &&
        /pn_graph_query\.py.*pn_research_chains\.py/i.test(entry)
    )
  );
});
