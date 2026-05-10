import test from "node:test";
import assert from "node:assert/strict";

import { unwrapToolResult } from "../../lobster/scripts/openclaw-tool.mjs";
import {
  buildDispatchPlan,
  extractAgentIdFromSessionKey,
} from "../../lobster/scripts/research-stage-handoff.mjs";

test("extractAgentIdFromSessionKey parses the current workflow role", () => {
  assert.equal(
    extractAgentIdFromSessionKey("agent:researcher:discord:group:birds-room"),
    "researcher"
  );
  assert.equal(extractAgentIdFromSessionKey("agent:coder:main"), "coder");
  assert.equal(extractAgentIdFromSessionKey("main"), null);
});

test("buildDispatchPlan skips dispatch when the current agent still owns the stage", () => {
  const plan = buildDispatchPlan({
    currentAgentId: "researcher",
    tickResult: {
      ownerAfter: "researcher",
      projectId: "gcd-part-manifold-2026",
      stageAfter: "graph_build",
      nextAction: "Continue graph build.",
    },
  });

  assert.equal(plan.shouldDispatch, false);
  assert.equal(plan.reason, "current_agent_is_owner");
});

test("buildDispatchPlan produces a deterministic handoff when ownership changes", () => {
  const plan = buildDispatchPlan({
    currentAgentId: "researcher",
    tickResult: {
      ownerAfter: "orchestrator",
      projectId: "gcd-part-manifold-2026",
      stageAfter: "plan",
      nextAction: "Run /plan-phase and write PLAN.md.",
      blockingReason: null,
    },
  });

  assert.equal(plan.shouldDispatch, true);
  assert.equal(plan.toAgent, "orchestrator");
  assert.match(plan.subject, /gcd-part-manifold-2026/i);
  assert.match(plan.body, /Run \/plan-phase and write PLAN\.md\./i);
});

test("unwrapToolResult prefers details and parses JSON content", () => {
  assert.deepEqual(unwrapToolResult({ details: { ok: true } }), { ok: true });
  assert.deepEqual(unwrapToolResult({ content: "{\"ok\":true}" }), { ok: true });
  assert.equal(unwrapToolResult({ content: "plain text" }), "plain text");
});
