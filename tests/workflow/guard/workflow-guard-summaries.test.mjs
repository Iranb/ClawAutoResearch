import test from "node:test";
import assert from "node:assert/strict";

import { summarizeIdeationContractState } from "../../../tools/workflow-guard-summaries/ideation-contract-summary.ts";
import { summarizePaperStoryState } from "../../../tools/workflow-guard-summaries/paper-story-summary.ts";
import { summarizeReviewPressurePacketState } from "../../../tools/workflow-guard-summaries/review-pressure-summary.ts";
import { summarizePaperIngestionState } from "../../../tools/workflow-guard-summaries/paper-ingestion-summary.ts";
import { summarizeWritingContractState } from "../../../tools/workflow-guard-summaries/writing-contract-summary.ts";

test("workflow guard summary modules expose dedicated summary builders", () => {
  assert.equal(typeof summarizeIdeationContractState, "function");
  assert.equal(typeof summarizePaperStoryState, "function");
  assert.equal(typeof summarizeReviewPressurePacketState, "function");
  assert.equal(typeof summarizePaperIngestionState, "function");
  assert.equal(typeof summarizeWritingContractState, "function");
});
