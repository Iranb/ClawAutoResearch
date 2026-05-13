import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializePlanStateImpl } from "../../tools/workflow-guard-materializers/plan-state-materializer.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("plan materializer projects Idea-Catalyst fragments into planner bridge and unified loop state", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-plan-idea-bridge-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "plan-bridge",
    topic: "Use FixMatch-style confidence gating to improve GCD",
    current_stage: "plan",
    idea_catalyst: {
      status: "ready",
      idea_fragments_path: "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
      ranked_fragments_path: "researcher/idea-catalyst/RANKED_FRAGMENTS.json",
      selected_ideas_path: "researcher/idea-catalyst/SELECTED_IDEAS.json",
      idea_to_claim_map_path: "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
    },
    research_program: {
      status: "draft",
      primary_metric: "h_score",
      baseline_reference: "local GCD baseline",
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "Confidence gating improves GCD.",
          novelty_basis: "Transfer pseudo-label confidence gating from SSL.",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_FRAGMENTS.json"), {
    fragments: [
      {
        fragment_id: "frag-confidence-gate",
        title: "Confidence gate transfer",
        source_domain: "semi-supervised learning",
        transferred_mechanism: "confidence-gated pseudo-label consistency",
        source_spans: [
          {
            paper_id: "paper-fixmatch",
            paragraph_id: "para-fixmatch-method",
          },
        ],
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "RANKED_FRAGMENTS.json"), {
    ranking: [
      {
        fragment_id: "frag-confidence-gate",
        rank: 1,
        evidence_tier: "source_backed",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "SELECTED_IDEAS.json"), {
    selected_ideas: [
      {
        fragment_id: "frag-confidence-gate",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"), {
    mappings: [
      {
        fragment_id: "frag-confidence-gate",
        claim_id: "claim-confidence-gate",
      },
    ],
  });

  const result = await materializePlanStateImpl({
    projectRoot,
    trigger: "test",
    agentId: "orchestrator",
  });
  assert.ok(result.generatedFiles.includes("researcher/AUTORESEARCH_LOOP_STATE.json"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const bridge = manifest.planner_plan.idea_catalyst_bridge;
  assert.equal(bridge.status, "ready");
  assert.equal(bridge.fragments[0].fragment_id, "frag-confidence-gate");
  assert.deepEqual(bridge.fragments[0].paper_ids, ["paper-fixmatch"]);
  assert.deepEqual(bridge.fragments[0].paragraph_ids, ["para-fixmatch-method"]);
  assert.equal(bridge.claim_mappings[0].claim_id, "claim-confidence-gate");
  assert.equal(manifest.workflow_control.stage, "plan");
  assert.equal(manifest.workflow_control.owner, "orchestrator");
  assert.equal(manifest.workflow_control.next_action, "/experiment-phase");
  assert.equal(manifest.workflow_control.completion.status, "complete");
  assert.equal(manifest.workflow_control.completion.source, "plan_completion");

  const loopState = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json"),
      "utf8"
    )
  );
  assert.equal(loopState.planner_plan.idea_catalyst_bridge.status, "ready");
  assert.equal(loopState.advance.promoted_trial_count, 0);
});

test("plan materializer upserts Idea-Catalyst paragraph gap instead of duplicating it", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-plan-gap-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "plan-gap",
    topic: "Use graph-derived transfer ideas to improve a small CS benchmark",
    current_stage: "plan",
    idea_catalyst: {
      status: "ready",
      idea_fragments_path: "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    },
    research_program: {
      status: "draft",
      primary_metric: "accuracy",
      baseline_reference: "local baseline",
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "A transferred mechanism improves the benchmark.",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_FRAGMENTS.json"), {
    fragments: [
      {
        fragment_id: "frag-without-paragraph",
        title: "Fragment without paragraph anchor",
        source_domain: "systems",
      },
    ],
  });

  await materializePlanStateImpl({
    projectRoot,
    trigger: "test",
    agentId: "orchestrator",
  });
  await materializePlanStateImpl({
    projectRoot,
    trigger: "test",
    agentId: "orchestrator",
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const gaps = manifest.reference_context.article_evidence_contract.gaps.filter(
    (entry) => entry.gap_id === "planner_idea_catalyst_missing_paragraphs"
  );
  assert.equal(gaps.length, 1);

  const loopState = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json"),
      "utf8"
    )
  );
  const loopGaps =
    loopState.reference_context.article_evidence_contract.gaps.filter(
      (entry) => entry.gap_id === "planner_idea_catalyst_missing_paragraphs"
    );
  assert.equal(loopGaps.length, 1);
});
