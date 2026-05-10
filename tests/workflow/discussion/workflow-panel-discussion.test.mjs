import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  aggregateWorkflowPanelDiscussionRound,
  buildWorkflowPanelDiscussionPrompt,
  createWorkflowPanelDiscussionRound,
  materializeWorkflowPanelDiscussionState,
  parseWorkflowPanelDiscussionResult,
  readWorkflowPanelDiscussionStore,
} from "../../../tools/workflow-panel-discussion.ts";

test("materializeWorkflowPanelDiscussionState creates a reusable configurable discussion packet and round", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-panel-discussion-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "{}\n", "utf8");

  const result = await materializeWorkflowPanelDiscussionState({
    projectRoot,
    projectId: "demo-project",
    policyLike: {
      discussionId: "write-logic-review",
      topic: "Check whether section-to-section logic is coherent",
      stage: "review",
      participants: ["reviewer", "cross-reviewer", "analyzer"],
      maxRounds: 3,
      quorum: 2,
      summary: ["focus on section-to-section handoffs", "check rebuttal appendix consistency"],
      context: {
        packet: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      },
    },
  });

  assert.equal(result.policy.discussionId, "write-logic-review");
  assert.equal(result.policy.participants.length, 3);
  assert.equal(result.currentRound.maxRounds, 3);
  assert.equal(result.currentRound.attempts.length, 3);
  assert.equal(result.createdRound, true);

  const store = await readWorkflowPanelDiscussionStore(projectRoot, "write-logic-review");
  assert.equal(store.currentRound?.topic, "Check whether section-to-section logic is coherent");
});

test("aggregateWorkflowPanelDiscussionRound respects configurable decision rules", async () => {
  const policy = {
    discussionId: "custom-discussion",
    topic: "Decide whether the revise packet is sufficient",
    stage: "review",
    participants: ["reviewer", "cross-reviewer", "analyzer"],
    maxRounds: 2,
    quorum: 2,
    resolvedDecisions: ["resolved", "pass"],
    blockedDecisions: ["blocked", "rollback"],
    packetArtifacts: [],
    promptInstructions: null,
    summary: [],
    context: {},
  };
  const round = createWorkflowPanelDiscussionRound({
    policy,
    packetPath: "packet.md",
    packetJsonPath: "packet.json",
    packetFingerprint: "fp-1",
    attempts: [
      {
        reviewerRole: "reviewer",
        sessionKey: "s1",
        runId: "r1",
        status: "completed",
        launchedAt: new Date(0).toISOString(),
        completedAt: new Date(0).toISOString(),
        error: null,
        result: parseWorkflowPanelDiscussionResult(
          JSON.stringify({
            decision: "resolved",
            confidence: 8.5,
            recommendedOwner: "academic_writer",
            actionItems: ["tighten section transitions"],
            blockers: [],
            summary: "Looks repairable and sufficient.",
          }),
          "reviewer"
        ),
      },
      {
        reviewerRole: "cross-reviewer",
        sessionKey: "s2",
        runId: "r2",
        status: "completed",
        launchedAt: new Date(0).toISOString(),
        completedAt: new Date(0).toISOString(),
        error: null,
        result: parseWorkflowPanelDiscussionResult(
          JSON.stringify({
            decision: "pass",
            confidence: 8.0,
            recommendedOwner: "academic_writer",
            actionItems: ["carry the same logic into the response appendix"],
            blockers: [],
            summary: "Pass after one bounded pass.",
          }),
          "cross-reviewer"
        ),
      },
    ],
  });

  const aggregate = aggregateWorkflowPanelDiscussionRound({ round, policy });
  assert.equal(aggregate.status, "resolved");
  assert.equal(aggregate.reviewCount, 2);
  assert.equal(aggregate.recommendedOwner, "academic_writer");
});

test("buildWorkflowPanelDiscussionPrompt exposes configurable topic and allowed decisions", () => {
  const prompt = buildWorkflowPanelDiscussionPrompt({
    projectRoot: "/tmp/demo",
    projectId: "demo-project",
    reviewerRole: "reviewer",
    policy: {
      discussionId: "gate-discussion",
      topic: "Decide whether the paper should stay in review",
      stage: "review",
      participants: ["reviewer", "cross-reviewer"],
      maxRounds: 2,
      quorum: 2,
      resolvedDecisions: ["resolved", "pass"],
      blockedDecisions: ["blocked", "rollback"],
      packetArtifacts: [],
      promptInstructions: "Focus on logical coherence and revise packet sufficiency.",
      summary: [],
      context: {},
    },
    packetPath: "packet.md",
    packetJsonPath: "packet.json",
  });

  assert.match(prompt, /Decide whether the paper should stay in review/i);
  assert.match(prompt, /resolved \| pass \| blocked \| rollback \| needs_changes/i);
});
