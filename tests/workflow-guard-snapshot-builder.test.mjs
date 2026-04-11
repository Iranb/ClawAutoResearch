import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setChannelProjectBinding } from "../tools/channel-project-bindings.ts";
import {
  loadWorkflowProjectState,
} from "../tools/workflow-guard-project/project-context.ts";
import {
  buildWorkflowSnapshotFromProjectState,
} from "../tools/workflow-guard-project/snapshot-builder.ts";
import { materializeWorkflowTaskGraph } from "../tools/workflow-team/task-graph.ts";
import { materializeWorkflowTeamRound } from "../tools/workflow-team/team-round.ts";

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-snapshot-builder-"));
}

async function makeProject(workspaceRoot, projectId = "demo-project") {
  const projectRoot = path.join(workspaceRoot, "projects", projectId);
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "plan",
        owner_agent: "researcher",
        research_program: {
          status: "ready",
          goal: "Model a workflow guard split",
          problem_statement: "The facade is too large.",
          baseline_reference: "workflow-guard.ts",
          primary_metric: "module_count",
          datasets: ["repo"],
          success_criteria: ["split the module"],
          zotero_project_path: "bot/demo-project",
        },
        writing_contract: {
          template_required: false,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeTrackRegistry(projectRoot, tracks) {
  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify({ tracks }, null, 2)}\n`,
    "utf8"
  );
}

async function writeMailbox(projectRoot, messages) {
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        messages,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeAutoIteratorAudit(projectRoot, audit) {
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
    "utf8"
  );
}

test("snapshot builder preserves project context and emits derived fields", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-split");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-split",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return ["PROJECT_MANIFEST.json.current_stage"];
      },
    }
  );

  assert.equal(snapshot.projectRoot, projectRoot);
  assert.equal(snapshot.projectId, "workflow-guard-split");
  assert.equal(snapshot.projectResolutionSource, "channel_binding");
  assert.equal(snapshot.channelProjectBindingKey, "discord:group:paper-lab");
  assert.equal(snapshot.channelProjectBindingWorkflowSessionKey, sessionKey);
  assert.equal(snapshot.currentStage, "plan");
  assert.equal(snapshot.recommendedOwner, "orchestrator");
  assert.deepEqual(snapshot.missingStageSignals, ["PROJECT_MANIFEST.json.current_stage"]);
  assert.equal(snapshot.researchProgramOnboardingStatus, "ready");
  assert.ok(snapshot.allowedWriteScopes.includes("{PROJ}/PROJECT_MANIFEST.json"));
  assert.ok(snapshot.backgroundTasks.some((task) => task.includes("Continue literature survey")));
});

test("snapshot builder surfaces evidence contract summaries from manifest state", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-evidence-contracts");
  const sessionKey = "agent:researcher:discord:group:evidence-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "ready_for_analysis";
  manifest.benchmark_protocol = {
    status: "ready",
    benchmark_family: "OpenWorldGraphBench",
    protocol_lock_path: "researcher/BENCHMARK_PROTOCOL.json",
    locked: true,
    drift_status: "pass",
  };
  manifest.statistical_evidence = {
    status: "ready",
    aggregate_path: "analyzer/STATISTICAL_EVIDENCE.json",
    claim_strength_status: "strong",
    significant_result_count: 3,
    insufficient_seed_count: 1,
  };
  manifest.venue_competition = {
    status: "partial",
    target_venues: ["ICLR", "NeurIPS"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "ready",
  };
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
    graph_context_status: "ready",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "workflow-evidence-contracts",
    stage: "experiment",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: false,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "experiment.lock_benchmark_protocol",
        title: "Lock the benchmark protocol",
        owner: "orchestrator",
        status: "blocked",
        reason: "Benchmark/statistical/ablation evidence is still incomplete.",
      },
    ],
  });
  await materializeWorkflowTeamRound({
    projectRoot,
    projectId: "workflow-evidence-contracts",
    stage: "experiment",
    leadRole: "researcher",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseoutStatus: "blocked",
    taskGraphPath: path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
    taskCount: 1,
    claimableCount: 1,
    blockedCount: 0,
    claimedCount: 0,
    verifyingCount: 0,
    needsRepairCount: 0,
    satisfiedCount: 0,
    optionalCount: 0,
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-evidence-contracts",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.benchmarkProtocolStatus, "ready");
  assert.equal(snapshot.benchmarkProtocolFamily, "OpenWorldGraphBench");
  assert.equal(snapshot.benchmarkProtocolLocked, true);
  assert.equal(snapshot.benchmarkProtocolDriftStatus, "pass");
  assert.equal(snapshot.statisticalEvidenceStatus, "ready");
  assert.equal(snapshot.statisticalEvidenceClaimStrengthStatus, "strong");
  assert.equal(snapshot.statisticalEvidenceSignificantResultCount, 3);
  assert.equal(snapshot.statisticalEvidenceInsufficientSeedCount, 1);
  assert.equal(snapshot.venueCompetitionStatus, "partial");
  assert.deepEqual(snapshot.venueCompetitionTargetVenues, ["ICLR", "NeurIPS"]);
  assert.equal(snapshot.venueCompetitionAcceptanceRiskStatus, "moderate");
  assert.equal(snapshot.venueCompetitionGraphContextStatus, "ready");
  assert.equal(snapshot.opportunityScorecardStatus, "ready");
  assert.equal(snapshot.opportunityScorecardVerdict, "worth_top_tier_bet");
  assert.equal(snapshot.opportunityScorecardGraphContextStatus, "ready");
  assert.equal(snapshot.evidenceCloseoutStatus, "blocked");
  assert.equal(snapshot.evidenceCloseoutTopTierVerdict, "worth_top_tier_bet");
  assert.equal(snapshot.evidenceCloseoutExperimentAnalyzeReady, false);
  assert.equal(snapshot.evidenceCloseoutAnalyzeReviewReady, false);
  assert.equal(snapshot.evidenceCloseoutWriteReady, false);
  assert.equal(snapshot.evidenceCloseoutSubmitReady, false);
  assert.equal(snapshot.evidenceCloseoutGraphDependentBlockerCount, 0);
  assert.ok((snapshot.evidenceCloseoutTopBlockers ?? []).length >= 1);
  assert.ok(Array.isArray(snapshot.teamTaskPreview));
  assert.ok(
    snapshot.teamTaskPreview.some((task) =>
      task.taskId === "experiment.lock_benchmark_protocol"
    )
  );
  assert.equal(snapshot.teamTaskGraphTaskCount, 1);
  assert.equal(snapshot.teamTaskGraphClaimableCount, 1);
  assert.equal(snapshot.teamTaskGraphClaimedCount, 0);
  assert.equal(snapshot.teamTaskGraphSatisfiedCount, 0);
  assert.equal(snapshot.teamRoundStatus, "blocked");
  assert.equal(snapshot.teamRoundLeadRole, "researcher");
  assert.equal(snapshot.teamRoundActiveSessionCount, 0);
});

test("snapshot builder suppresses stale waiting blockers once missing stage signals are cleared", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-blocker");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track fd-gcd-freq-debiased missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-blocker",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.deepEqual(snapshot.missingStageSignals, []);
  assert.equal(snapshot.blockingReason, null);
});

test("snapshot builder marks stale auto-iterator audits without regressing live ready evidence state", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-audit");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
      ],
    },
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeAutoIteratorAudit(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-04-09T08:59:36.572Z",
    result: {
      projectRoot,
      projectId: "workflow-guard-stale-audit",
      stageBefore: "idea",
      stageAfter: "idea",
      ownerAfter: "researcher",
      blockingReason:
        "active track track-main missing graph-backed innovation evidence",
      missingStageSignals: [
        "active track track-main missing graph-backed innovation evidence",
      ],
    },
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-audit",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "ready");
  assert.equal(snapshot.blockingReason, null);
  assert.equal(snapshot.autoIteratorAuditStatus, "completed");
  assert.equal(snapshot.autoIteratorAuditFreshness, "stale");
  assert.equal(snapshot.autoIteratorAuditMatchesLiveState, false);
  assert.match(snapshot.autoIteratorAuditSummary ?? "", /stale auto-iterator audit/i);
});

test("snapshot builder downgrades orphan started auto-iterator audits to timed_out", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-started-audit");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeAutoIteratorAudit(projectRoot, {
    schemaVersion: 2,
    runId: "started-audit",
    status: "started",
    startedAt: "2026-04-09T08:59:36.572Z",
    updatedAt: "2026-04-09T08:59:36.572Z",
    summary: "Auto iterator started for default mode.",
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-started-audit",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.autoIteratorAuditStatus, "timed_out");
  assert.equal(snapshot.autoIteratorAuditFreshness, "stale");
  assert.match(snapshot.autoIteratorAuditSummary ?? "", /timed out/i);
});

test("snapshot builder filters stale auto-iterator mailbox handoffs whose blocker no longer matches", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-stale-mailbox");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeMailbox(projectRoot, [
    {
      id: "stale-auto-iterator",
      fromAgent: "orchestrator",
      toAgent: "researcher",
      subject: "auto-iterator: idea owner handoff",
      body: [
        "Please resume idea stage.",
        "Next action: Run /idea-phase.",
        "Missing stage signals: active track fd-gcd-freq-debiased missing graph-backed innovation evidence; active track talon-gcd-bias missing graph-backed innovation evidence",
      ].join("\n"),
      kind: "handoff",
      priority: "high",
      status: "pending",
      createdAt: "2026-04-09T07:13:26.090Z",
    },
  ]);

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-stale-mailbox",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.deepEqual(snapshot.missingStageSignals, []);
  assert.deepEqual(snapshot.unreadMailbox, []);
});

test("snapshot builder surfaces survey review state for projectless review workflows", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "survey-graph-reasoning");
  const sessionKey = "agent:researcher:discord:group:survey-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "survey-graph-reasoning",
        current_stage: "survey_review",
        owner_agent: "researcher",
        survey_review: {
          status: "screening",
          current_phase: "screening",
          topic: "Graph reasoning survey",
          mode: "deep",
          candidate_paper_count: 80,
          included_paper_count: 24,
          excluded_paper_count: 31,
          graph_grounded_brief_ready: false,
          gate_ready: false,
          coverage_status: "partial",
          taxonomy_stability_status: "unstable",
          representative_methods_status: "partial",
          benchmark_alignment_status: "partial",
          gap_closure_status: "partial",
          gate_blocking_issues: [
            "Expand SOTA matrix coverage before write handoff.",
          ],
          diagnostics_path: "researcher/SURVEY_GATE_DIAGNOSTICS.json",
          survey_brief_path: "researcher/SURVEY_BRIEF.md",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "survey-graph-reasoning",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
        maxWorkflowInboxMessages: 3,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.currentStage, "survey_review");
  assert.equal(snapshot.surveyReviewStatus, "screening");
  assert.equal(snapshot.surveyReviewCurrentPhase, "screening");
  assert.equal(snapshot.surveyReviewTopic, "Graph reasoning survey");
  assert.equal(snapshot.surveyReviewMode, "deep");
  assert.equal(snapshot.surveyReviewCandidatePaperCount, 80);
  assert.equal(snapshot.surveyReviewIncludedPaperCount, 24);
  assert.equal(snapshot.surveyReviewExcludedPaperCount, 31);
  assert.equal(snapshot.surveyReviewGraphGroundedBriefReady, false);
  assert.equal(snapshot.surveyReviewGateReady, false);
  assert.equal(snapshot.surveyReviewCoverageStatus, "partial");
  assert.equal(snapshot.surveyReviewTaxonomyStabilityStatus, "unstable");
  assert.equal(snapshot.surveyReviewRepresentativeMethodsStatus, "partial");
  assert.equal(snapshot.surveyReviewBenchmarkAlignmentStatus, "partial");
  assert.equal(snapshot.surveyReviewGapClosureStatus, "partial");
  assert.equal(snapshot.surveyReviewGateBlockingIssueCount, 1);
  assert.equal(
    snapshot.surveyReviewDiagnosticsPath,
    "researcher/SURVEY_GATE_DIAGNOSTICS.json"
  );
  assert.equal(snapshot.surveyReviewSurveyBriefPath, "researcher/SURVEY_BRIEF.md");
});

test("snapshot builder classifies file-backed track evidence as repairable and distinguishes it from missing evidence", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-file-backed-evidence");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      reasoning_packet_dir: "researcher/reasoning/track-main",
    },
  ]);
  await fs.mkdir(path.join(projectRoot, "researcher", "reasoning", "track-main"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
    `${JSON.stringify(
      {
        graph_innovation_evidence: {
          evidence_pointers: [
            "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
          ],
          linked_graph_nodes: ["paper:router"],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-file-backed-evidence",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "repairable");
  assert.match(
    snapshot.workflowEvidenceSummary,
    /file-backed GRAPH_EVIDENCE\.json pending canonicalization/i
  );
  assert.notEqual(snapshot.blockingReason, null);
  assert.doesNotMatch(snapshot.blockingReason, /waiting for researcher to satisfy/i);
});

test("snapshot builder clears stale blocker text when derived evidence readiness is satisfied", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "workflow-guard-ready-evidence");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTrackRegistry(projectRoot, [
    {
      track_id: "track-main",
      status: "active",
      reasoning_packet_dir: "researcher/reasoning/track-main",
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
      ],
    },
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.blocking_reason =
    "Waiting for researcher to satisfy: active track track-main missing graph-backed innovation evidence";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "workflow-guard-ready-evidence",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const projectState = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  const snapshot = await buildWorkflowSnapshotFromProjectState(
    {
      policy: {
        enableChannelProjectBindings: true,
      },
      agentId: "researcher",
      projectState,
    },
    {
      async getMissingStageSignals() {
        return [];
      },
    }
  );

  assert.equal(snapshot.workflowEvidenceStatus, "ready");
  assert.match(snapshot.workflowEvidenceSummary, /inline graph evidence present/i);
  assert.equal(snapshot.blockingReason, null);
});
