import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

function createResearchWorkflowTool(projectRoot) {
  process.env.OPENCLAW_PROJECT = projectRoot;
  let registeredTool = null;
  const api = {
    runtime: {},
    logger: {},
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: projectRoot,
          agentId: "researcher",
          sessionKey: "agent:researcher:test",
          sessionId: "session-test",
          messageChannel: "discord",
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

async function expectToolError(tool, params, pattern) {
  await assert.rejects(
    async () => {
      await tool.execute("test-call", params);
    },
    pattern
  );
}

async function makeSearchGitProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-search-git-")
  );
  const now = "2026-04-10T10:00:00.000Z";
  const trackId = "track-a";
  const projectId = "demo-project";
  const searchSessionId = "search-demo";
  const incumbentBranch = `incumbent-${trackId}`;
  const candidateBranchPrefix = `candidate-${trackId}/`;

  await writeText(path.join(projectRoot, "model.txt"), "baseline\n");
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: searchSessionId,
    project_id: projectId,
    track_id: trackId,
    git_strategy: {
      incumbent_branch: incumbentBranch,
      candidate_branch_prefix: candidateBranchPrefix,
      require_clean_candidate_history: true,
      promotion_commit_policy: "ff_only",
      discard_unpromoted_candidates: true,
    },
    comparison_policy: {
      compare_against: "baseline_then_incumbent",
      promotion_rule: "beat_incumbent_or_equal_simpler",
      non_promotion_signals: ["gap_reduction", "smoother_curve"],
    },
    graph_memory_basis: {
      packet_path: "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
      sync_status_path: "researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json",
    },
  });

  await runGit(projectRoot, ["init", "-b", "main"]);
  await runGit(projectRoot, ["config", "user.email", "codex@example.com"]);
  await runGit(projectRoot, ["config", "user.name", "Codex"]);
  await runGit(projectRoot, ["add", "."]);
  await runGit(projectRoot, ["commit", "-m", "initial baseline"]);
  await runGit(projectRoot, ["branch", incumbentBranch]);
  const incumbentCommit = await runGit(projectRoot, [
    "rev-parse",
    incumbentBranch,
  ]);

  const experimentSearch = {
    status: "running",
    project_id: projectId,
    track_id: trackId,
    search_session_id: searchSessionId,
    search_spec_path: "planner/EXPERIMENT_SEARCH_SPEC.json",
    search_state_path: "researcher/EXPERIMENT_SEARCH.json",
    incumbent_branch: incumbentBranch,
    incumbent_commit: incumbentCommit,
    incumbent_experiment_id: "exp-base",
    baseline_experiment_id: "exp-base",
    frontier_experiment_ids: [],
    completed_experiment_ids: [],
    failed_experiment_ids: [],
    discarded_experiment_ids: [],
    multi_seed_status: "pending",
    plot_pack_status: "pending",
    graph_memory_packet_path: "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
    graph_memory_sync_status: "unknown",
    created_at: now,
    last_updated_at: now,
  };

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: "experiment",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    experiment_memory: {
      ledger_path: "researcher/EXPERIMENT_LEDGER.json",
      last_ledger_update_at: now,
      papernexus_sync_required: false,
      papernexus_sync_status: "unknown",
      graph_memory_packet_path: "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json",
      graph_memory_sync_status_path:
        "researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json",
      graph_memory_last_materialized_at: null,
    },
    experiment_search: experimentSearch,
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json"), experimentSearch);
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: projectId,
    updatedAt: now,
    experiments: [
      {
        experimentId: "exp-base",
        trackId,
        name: "baseline",
        status: "done",
        decision: "advance",
        configRef: incumbentBranch,
        summary: "baseline incumbent",
        updatedAt: now,
        notes: [],
        metadata: {
          searchGit: {
            incumbentBranch,
            incumbentCommit,
            retained: true,
          },
        },
        papernexusSync: {
          status: "synced",
          corpus: null,
          lastSyncedAt: now,
          nodeRefs: [],
          notes: null,
        },
      },
    ],
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-base",
      lastFailedExperimentId: null,
      bestKnownConfigRef: incumbentBranch,
      lastDecisionSummary: "baseline: advance",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
  });

  return { projectRoot, incumbentCommit, incumbentBranch, candidateBranchPrefix, trackId };
}

test("research_workflow enforces multi-agent review before creating and promoting candidate worktrees", async () => {
  const { projectRoot, trackId, incumbentCommit, incumbentBranch, candidateBranchPrefix } =
    await makeSearchGitProject();
  const tool = createResearchWorkflowTool(projectRoot);
  const candidateWorktreePath = path.join(
    os.tmpdir(),
    `openclaw-candidate-${Date.now()}`
  );

  const requested = await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "create_candidate_worktree",
      experiment_id: "exp-cand-1",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_branch: `${candidateBranchPrefix}exp-cand-1`,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  assert.equal(requested.reviewState.actionType, "create_candidate_worktree");
  assert.equal(requested.searchState.requestedGitOp, "create_candidate_worktree");
  assert.equal(requested.reviewState.incumbentCommit, incumbentCommit);

  await expectToolError(
    tool,
    { action: "apply_experiment_git_op" },
    /multi-agent approval|not approved/i
  );

  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
      promotion_basis_signals: ["primary_metric_win", "promotion_rule_satisfied"],
      promotion_evidence_summary: "Primary metric beat the incumbent under the approved promotion rule.",
    },
  });

  const created = await executeWorkflowTool(tool, {
    action: "apply_experiment_git_op",
  });
  assert.equal(created.gitResult.actionType, "create_candidate_worktree");
  assert.equal(created.searchState.lastCandidateExperimentId, "exp-cand-1");
  assert.equal(created.searchState.candidateWorktreePath, candidateWorktreePath);
  await fs.access(candidateWorktreePath);

  await writeText(path.join(candidateWorktreePath, "model.txt"), "candidate-win\n");
  await runGit(candidateWorktreePath, ["add", "model.txt"]);
  await runGit(candidateWorktreePath, ["commit", "-m", "candidate improvement"]);
  const candidateCommit = await runGit(candidateWorktreePath, ["rev-parse", "HEAD"]);

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "promote_candidate",
      experiment_id: "exp-cand-1",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      candidate_branch: `${candidateBranchPrefix}exp-cand-1`,
      candidate_commit: candidateCommit,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
      promotion_basis_signals: ["primary_metric_win", "promotion_rule_satisfied"],
      promotion_evidence_summary: "Primary metric beat the incumbent under the approved promotion rule.",
    },
  });

  const promoted = await executeWorkflowTool(tool, {
    action: "apply_experiment_git_op",
  });
  assert.ok(promoted.ledgerEntry, JSON.stringify(promoted, null, 2));
  assert.equal(promoted.gitResult.actionType, "promote_candidate");
  assert.equal(promoted.searchState.incumbentExperimentId, "exp-cand-1");
  assert.equal(promoted.searchState.incumbentCommit, candidateCommit);
  assert.equal(
    await runGit(projectRoot, ["rev-parse", incumbentBranch]),
    candidateCommit
  );
  await assert.rejects(
    fs.access(candidateWorktreePath),
    /ENOENT|no such file or directory/i
  );
  await assert.rejects(
    runGit(projectRoot, ["rev-parse", `refs/heads/${candidateBranchPrefix}exp-cand-1`]),
    /fatal/i
  );

  const ledger = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), "utf8")
  );
  const promotedEntry = ledger.experiments.find(
    (entry) => (entry.experimentId ?? entry.experiment_id) === "exp-cand-1"
  );
  assert.equal(promotedEntry.decision, "advance");
  assert.equal(promotedEntry.status, "merged");
  const packet = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "papernexus", "EXPERIMENT_MEMORY_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(packet.track_id, trackId);
  const syncStatus = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "papernexus",
        "EXPERIMENT_MEMORY_SYNC_STATUS.json"
      ),
      "utf8"
    )
  );
  assert.equal(syncStatus.status, "pending");
});

test("research_workflow can discard a reviewed candidate and keep the loss in workflow-owned memory only", async () => {
  const { projectRoot, trackId, incumbentCommit, incumbentBranch, candidateBranchPrefix } =
    await makeSearchGitProject();
  const tool = createResearchWorkflowTool(projectRoot);
  const candidateWorktreePath = path.join(
    os.tmpdir(),
    `openclaw-candidate-discard-${Date.now()}`
  );

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "create_candidate_worktree",
      experiment_id: "exp-cand-2",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_branch: `${candidateBranchPrefix}exp-cand-2`,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
    },
  });
  await executeWorkflowTool(tool, {
    action: "apply_experiment_git_op",
  });

  await writeText(path.join(candidateWorktreePath, "model.txt"), "candidate-lose\n");
  await runGit(candidateWorktreePath, ["add", "model.txt"]);
  await runGit(candidateWorktreePath, ["commit", "-m", "candidate lose"]);
  const candidateCommit = await runGit(candidateWorktreePath, ["rev-parse", "HEAD"]);

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "discard_candidate",
      experiment_id: "exp-cand-2",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      candidate_branch: `${candidateBranchPrefix}exp-cand-2`,
      candidate_commit: candidateCommit,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
    },
  });

  const discarded = await executeWorkflowTool(tool, {
    action: "apply_experiment_git_op",
  });
  assert.ok(discarded.ledgerEntry, JSON.stringify(discarded, null, 2));
  assert.equal(discarded.gitResult.actionType, "discard_candidate");
  assert.match(discarded.searchState.discardedExperimentIds.join(","), /exp-cand-2/);
  await assert.rejects(
    fs.access(candidateWorktreePath),
    /ENOENT|no such file or directory/i
  );
  await assert.rejects(
    runGit(projectRoot, ["rev-parse", `refs/heads/${candidateBranchPrefix}exp-cand-2`]),
    /fatal/i
  );

  const ledger = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), "utf8")
  );
  const discardedEntry = ledger.experiments.find(
    (entry) => (entry.experimentId ?? entry.experiment_id) === "exp-cand-2"
  );
  assert.equal(discardedEntry.decision, "discard");
  assert.equal(discardedEntry.status, "completed");
});

test("research_workflow blocks promotion when the recorded basis only cites non-promotion signals", async () => {
  const { projectRoot, trackId, incumbentCommit, incumbentBranch } =
    await makeSearchGitProject();
  const tool = createResearchWorkflowTool(projectRoot);
  const candidateWorktreePath = path.join(
    os.tmpdir(),
    `openclaw-candidate-nonpromotion-${Date.now()}`
  );

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "create_candidate_worktree",
      experiment_id: "exp-cand-3",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
    },
  });
  await executeWorkflowTool(tool, { action: "apply_experiment_git_op" });

  await writeText(path.join(candidateWorktreePath, "model.txt"), "candidate\n");
  await runGit(candidateWorktreePath, ["add", "model.txt"]);
  await runGit(candidateWorktreePath, ["commit", "-m", "candidate change"]);
  const candidateCommit = await runGit(candidateWorktreePath, ["rev-parse", "HEAD"]);

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "promote_candidate",
      experiment_id: "exp-cand-3",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_branch: `candidate-${trackId}/exp-cand-3`,
      candidate_commit: candidateCommit,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
      promotion_basis_signals: ["gap_reduction", "smoother_curve"],
      promotion_evidence_summary: "The curve is smoother and the gap closed faster.",
    },
  });

  await assert.rejects(
    async () => {
      await executeWorkflowTool(tool, { action: "apply_experiment_git_op" });
    },
    /non-promotion signals/i
  );
});

test("research_workflow records search-session discard metadata in the ledger", async () => {
  const { projectRoot, trackId, incumbentCommit, incumbentBranch } =
    await makeSearchGitProject();
  const tool = createResearchWorkflowTool(projectRoot);
  const candidateWorktreePath = path.join(
    os.tmpdir(),
    `openclaw-candidate-metadata-${Date.now()}`
  );

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "create_candidate_worktree",
      experiment_id: "exp-cand-4",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
    },
  });
  await executeWorkflowTool(tool, { action: "apply_experiment_git_op" });

  await executeWorkflowTool(tool, {
    action: "request_experiment_git_op",
    experimentGitRequest: {
      action_type: "discard_candidate",
      experiment_id: "exp-cand-4",
      track_id: trackId,
      incumbent_branch: incumbentBranch,
      incumbent_commit: incumbentCommit,
      candidate_branch: `candidate-${trackId}/exp-cand-4`,
      candidate_worktree_path: candidateWorktreePath,
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_git_review",
    experimentGitReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      analyzer_verdict: "pass",
      cross_reviewer_status: "ready",
      cross_reviewer_verdict: "pass",
      action_approved: true,
      discard_reason: "Candidate stayed under the incumbent after a fair comparison.",
      failure_class: "scientific",
    },
  });
  await executeWorkflowTool(tool, { action: "apply_experiment_git_op" });

  const ledger = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
      "utf8"
    )
  );
  const discardedEntry = ledger.experiments.find(
    (entry) => entry.experiment_id === "exp-cand-4"
  );
  assert.equal(
    discardedEntry.metadata.searchGit.searchSessionId,
    "search-demo"
  );
  assert.equal(
    discardedEntry.metadata.searchGit.discardReason,
    "Candidate stayed under the incumbent after a fair comparison."
  );
  assert.equal(discardedEntry.metadata.searchGit.failureClass, "scientific");
});
