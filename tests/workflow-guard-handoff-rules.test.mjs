import test from "node:test";
import assert from "node:assert/strict";

import {
  hasAgentMention,
  isWorkflowChannelHandoffMessage,
  normalizeWorkflowChannelMentions,
  sanitizeAgentMentions,
  sanitizeMessageToolParams,
} from "../tools/workflow-guard-policies/handoff-rules.ts";

test("handoff rules preserve one raw mention and sanitize duplicates in workflow handoff messages", () => {
  const normalized = normalizeWorkflowChannelMentions(
    "[STATUS] review complete\n[HANDOFF] next owner: @Reviewer\n[ARTIFACTS] REVIEW_PACKET.md\n[NEXT] /write-paper\n@Reviewer please take it from here."
  );

  assert.equal(hasAgentMention(normalized), true);
  assert.equal(isWorkflowChannelHandoffMessage(normalized), true);
  assert.match(normalized, /\[HANDOFF\] next owner: @Reviewer/);
  assert.match(normalized, /\n\[reviewer\] please take it from here\./i);
});

test("handoff rules normalize non-handoff mentions and sanitize message tool params", () => {
  assert.equal(sanitizeAgentMentions("Ping @Academic_Writer about this"), "Ping [writer] about this");
  const nextParams = sanitizeMessageToolParams({
    text: "Hello @Orchestrator",
    caption: "no mentions here",
  });
  assert.deepEqual(nextParams, { text: "Hello [orchestrator]", caption: "no mentions here" });
});

