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
