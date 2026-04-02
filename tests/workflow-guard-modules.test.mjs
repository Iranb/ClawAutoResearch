import test from "node:test";
import assert from "node:assert/strict";

import { materializeIdeationContractImpl } from "../tools/workflow-guard-materializers/ideation-contract-materializer.ts";
import { materializePaperStoryStateImpl } from "../tools/workflow-guard-materializers/paper-story-materializer.ts";
import { materializeReviewPressurePacketImpl } from "../tools/workflow-guard-materializers/review-pressure-materializer.ts";
import { buildDynamicTasksImpl } from "../tools/workflow-guard-guidance/dynamic-tasks.ts";
import { buildPapernexusGuidance } from "../tools/workflow-guard-guidance/papernexus-guidance.ts";
import { buildWritingGuidance } from "../tools/workflow-guard-guidance/writing-guidance.ts";
import {
  getExperimentMemorySummaryImpl,
  recordCitationVerificationImpl,
  recordIdleResearchRunImpl,
  recordInnovationReflectionImpl,
  upsertExperimentLedgerEntryImpl,
} from "../tools/workflow-guard-recorders/state-recorders.ts";
import { runWorkflowAutoIteratorImpl } from "../tools/workflow-guard-runtime/auto-iterator.ts";

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
