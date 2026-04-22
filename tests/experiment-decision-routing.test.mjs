import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runWorkflowAutoIteratorImpl } from "../tools/workflow-guard-runtime/auto-iterator.ts";
import { evaluateExperimentSearchDecision } from "../tools/workflow-experiment-decision.ts";

async function makeTempProject() {
  return await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-experiment-routing-")
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function buildDeps(overrides = {}) {
  return {
    normalizePolicy: () => ({
      autoMode: "conservative",
      autoGate: { maxMitigationRounds: 0 },
      agentContactCooldownSeconds: 0,
      teamRuntime: { enabled: false },
    }),
    loadExperimentLedgerIfExists: async () => overrides.experimentLedger ?? null,
    readGateState: async () => ({
      currentStage: "experiment",
      lastGate: null,
      gateStatus: null,
      gateTimestamp: null,
      defaultActionExecutedAt: null,
      revisionCount: 0,
    }),
    normalizeRole: () => "researcher",
    inferProjectId: () => "demo-project",
    normalizeWritePackageState: () => ({ status: "missing" }),
    assembleWritePackage: async () => ({}),
    checkGraphPresenceForWorkflow: async () => ({
      status: "ready",
      missingCanonicalIds: [],
      matchedCanonicalIds: [],
    }),
    getPreviousStagesForRegression: () => [],
    getMissingStageSignals: async ({ currentStage }) =>
      overrides.missingStageSignals?.[currentStage] ?? [],
    evaluateWorkflowAutoModeRisk: () => ({
      riskLevel: "stable",
      reasons: [],
      riskFingerprint: null,
    }),
    readAutoModeDiscussionStore: async () => null,
    resolveEffectiveWorkflowAutoMode: ({ configuredMode }) => ({
      configuredMode,
      effectiveMode: configuredMode,
      riskLevel: "stable",
      reasons: [],
      riskFingerprint: null,
      mitigationStatus: null,
      mitigationRoundsStarted: 0,
      mitigationRoundsRemaining: 0,
    }),
    evaluateGateBlocking: async () => ({
      blocking: false,
      reason: null,
      timedDefaultTriggered: false,
    }),
    isSurveyWorkflow: () => false,
    ensureSurveyWorkflowIdentity: (manifest) => ({ manifest: manifest ?? {}, updated: false }),
    resolveStageForWorkflowLine: ({ stage }) => stage,
    resolveNextStageForWorkflow: ({ stage }) =>
      stage === "experiment" ? "analyze" : stage === "plan" ? "code" : null,
    STAGE_REQUIREMENTS: {
      experiment: { nextStage: "analyze" },
      plan: { nextStage: "code" },
      analyze: { nextStage: "write" },
    },
    stageOwner: (stage) => {
      if (stage === "plan") return "orchestrator";
      if (stage === "code") return "coder";
      if (stage === "analyze") return "analyzer";
      return "researcher";
    },
    normalizeExperimentSearchState: (value) => ({ ...(value ?? {}) }),
    normalizeAutonomousExecutionState: () => ({
      experimentLaunchMode: "manual",
      maxExperimentReviewRounds: 0,
      requireAnalyzerReview: false,
      requireCrossReview: false,
    }),
    loadExperimentReviewState:
      overrides.loadExperimentReviewState ?? (async () => ({})),
    isReviewedAutoExperimentLaunchEnabled: () => false,
    resolveExperimentReviewNextOwner: () => null,
    deriveExperimentReviewMicroStage: () => null,
    buildExperimentReviewCommand: () => null,
    hasActiveExperimentRuns: () => false,
    hasFinishedExperimentWorkAwaitingReconciliation: () => false,
    evaluateExperimentSearchDecision,
    buildExperimentMonitorCommand: () =>
      "Run /monitor-experiment to reconcile durable runtime signals.",
    buildGraphImportRepairGuidance: () => "repair-graph",
    formatStageCommand: (stage) => (stage ? `/${stage}-phase` : null),
    STAGE_ENTRY_MICRO_STAGES: {
      experiment: "experiment_entry",
      plan: "plan_entry",
    },
    saveManifest: async (projectRoot, manifest) => {
      await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
    },
    saveGateState: async () => ({}),
    maybeQueueAutoIteratorMailbox: async () => ({
      queued: false,
      messageId: null,
      cooldownRemainingSeconds: null,
    }),
    formatStageSummary: (stage) => (stage ? `${stage} summary` : null),
    normalizeIdleResearchState: () => ({ topic: null }),
    isIdleResearchDue: () => false,
    syncProjectsStateEntry: async () => false,
    readProjectsStateRaw: async () => ({}),
    writeAutoIteratorAudit: async () => null,
    appendWorkflowTraceEvent: async () => ({}),
    materializeIdeationContract: async () => ({}),
    materializePaperStoryState: async () => ({}),
    materializeReviewPressurePacket: async () => ({}),
    materializeExperimentReviewState: async () => ({}),
    materializeSurveyReviewState: async () => ({}),
    materializeIdeaCatalystState: async () => ({}),
    materializeLiteratureDiscoveryPacket: async () => ({}),
    materializePapernexusPacketContracts: async () => ({}),
    queueIdeaCatalystRequisition: async () => ({}),
    queueLiteratureDiscoveryRequisition: async () => ({}),
  };
}

test("experiment decision handoff routes bounded repair work to coder", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "baseline_parity",
    owner_agent: "researcher",
    autonomous_execution: {},
    experiment_search: {
      status: "running",
      baseline_fairness_status: "pending",
      implementation_confidence: "unknown",
      multi_seed_status: "pending",
      plot_pack_status: "pending",
      ablation_status: "pending",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "partial",
    },
    orchestration_state: {},
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  const result = await runWorkflowAutoIteratorImpl(
    {
      projectRoot,
      mode: "test",
      queueMailbox: false,
    },
    buildDeps()
  );

  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.ownerAfter, "coder");
  assert.equal(result.experimentDecision, "repair_implementation");
  assert.equal(result.recommendedActions[0]?.kind, "drive_stage");
  assert.equal(result.recommendedActions[0]?.owner, "coder");
});

test("experiment decision routes not-yet-started experiment launch back to researcher", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "experiment_launch_requested",
    owner_agent: "coder",
    autonomous_execution: {},
    experiment_search: {
      status: "not_started",
      baseline_fairness_status: "unknown",
      implementation_confidence: "unknown",
      multi_seed_status: "pending",
      plot_pack_status: "pending",
      ablation_status: "pending",
      search_exhaustion_status: "unknown",
      evidence_cleanliness_status: "unknown",
    },
    orchestration_state: {
      status: "running",
      current_owner: "coder",
      next_transition_candidate: "analyze",
    },
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  const result = await runWorkflowAutoIteratorImpl(
    {
      projectRoot,
      mode: "test",
      queueMailbox: false,
    },
    buildDeps()
  );

  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.ownerAfter, "researcher");
  assert.equal(result.experimentDecision, "launch_pending");
  assert.match(result.nextAction ?? "", /\/experiment-phase/i);
  assert.equal(result.recommendedActions[0]?.kind, "drive_stage");
  assert.equal(result.recommendedActions[0]?.owner, "researcher");
});

test("experiment decision rollback routes the workflow back to plan with synced orchestration state", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "decision",
    owner_agent: "researcher",
    autonomous_execution: {},
    experiment_search: {
      status: "ready_for_analysis",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "ready",
      plot_pack_status: "ready",
      ablation_status: "ready",
      search_exhaustion_status: "exhausted",
      evidence_cleanliness_status: "clean",
      evaluation_summary_path: "researcher/artifacts/results/metrics.json",
      plot_pack_path: "researcher/artifacts/results/metrics.json",
    },
    orchestration_state: {
      status: "running",
      current_owner: "researcher",
      next_transition_candidate: "analyze",
      rollback_target_stage: "plan",
    },
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  const result = await runWorkflowAutoIteratorImpl(
    {
      projectRoot,
      mode: "test",
      queueMailbox: false,
    },
    buildDeps({
      experimentLedger: {
        project_id: "demo-project",
        experiments: [
          {
            experimentId: "exp-1",
            status: "failed",
            decision: "discard",
            failureSignature: "under baseline after fair comparison",
            notes: ["scientific regression"],
          },
          {
            experimentId: "exp-2",
            status: "failed",
            decision: "discard",
            failureSignature: "under baseline after fair comparison",
            notes: ["scientific regression"],
          },
        ],
      },
    })
  );

  const manifest = await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"));
  assert.equal(result.stageAfter, "plan");
  assert.equal(result.ownerAfter, "orchestrator");
  assert.equal(result.experimentDecision, "rollback_to_plan");
  assert.equal(result.experimentRollbackStage, "plan");
  assert.equal(manifest.current_stage, "plan");
  assert.equal(manifest.orchestration_state.current_owner, "orchestrator");
  assert.equal(manifest.orchestration_state.next_transition_candidate, "code");
  assert.equal(manifest.orchestration_state.rollback_target_stage, "plan");
});

test("experiment decision prefers coder search-experiment dispatch for active bounded search loops", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "local_hparam_search",
    owner_agent: "researcher",
    autonomous_execution: {},
    experiment_search: {
      status: "running",
      searchSessionId: "search-demo",
      searchSpecPath: "planner/EXPERIMENT_SEARCH_SPEC.json",
      baselineFairnessStatus: "ready",
      implementationConfidence: "trusted",
      multiSeedStatus: "pending",
      plotPackStatus: "pending",
      ablationStatus: "pending",
      searchExhaustionStatus: "active",
      evidenceCleanlinessStatus: "clean",
    },
    orchestration_state: {},
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-demo",
    comparison_policy: {
      non_promotion_signals: ["gap_reduction", "smoother_curve"],
    },
  });

  const result = await runWorkflowAutoIteratorImpl(
    {
      projectRoot,
      mode: "test",
      queueMailbox: false,
    },
    buildDeps()
  );

  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.ownerAfter, "coder");
  assert.equal(result.experimentDecision, "continue_tuning");
  assert.match(result.nextAction ?? "", /\/search-experiment/i);
});

test("experiment decision keeps review blockers with researcher instead of misrouting them to coder", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "review_blockers",
    owner_agent: "researcher",
    autonomous_execution: {},
    experiment_search: {
      status: "running",
      searchSessionId: "search-demo",
      searchSpecPath: "planner/EXPERIMENT_SEARCH_SPEC.json",
      baselineFairnessStatus: "ready",
      implementationConfidence: "trusted",
      multiSeedStatus: "pending",
      plotPackStatus: "pending",
      ablationStatus: "pending",
      searchExhaustionStatus: "active",
      evidenceCleanlinessStatus: "clean",
    },
    experiment_review_state: {
      blocker_count: 1,
      blockers: ["launch packet needs another analyzer pass"],
    },
    orchestration_state: {},
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-demo",
  });

  const result = await runWorkflowAutoIteratorImpl(
    {
      projectRoot,
      mode: "test",
      queueMailbox: false,
    },
    buildDeps({
      loadExperimentReviewState: async () => ({
        blocker_count: 1,
        blockers: ["launch packet needs another analyzer pass"],
      }),
    })
  );

  assert.equal(result.experimentDecision, "repair_implementation");
  assert.equal(result.ownerAfter, "researcher");
  assert.match(result.nextAction ?? "", /resolve the outstanding experiment review blockers/i);
});
