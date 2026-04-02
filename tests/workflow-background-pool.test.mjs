import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-workflow-background-pool.json"
);

import {
  clearBackgroundWorkflowRunRegistryForTests,
  listBackgroundWorkflowRuns,
  recordBackgroundWorkflowRun,
  retireBackgroundWorkflowRuns,
} from "../tools/workflow-background-pool.ts";

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test("workflow background pool lists and retires researcher sessions", async () => {
  const deletedSessionKeys = [];
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    requesterSessionKey: "agent:researcher:discord:channel:test-room",
    backgroundSessionKey: "agent:researcher:discord:channel:test-room:subagent:abc",
    runId: "run:test",
    family: "research",
    kind: "resume_pipeline",
  });

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
  });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].status, "active");

  const retired = await retireBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    statuses: ["active"],
    deleteSessions: true,
    runtimeSubagent: {
      async deleteSession(params) {
        deletedSessionKeys.push(params.sessionKey);
      },
    },
  });

  assert.equal(retired.removed.length, 1);
  assert.deepEqual(deletedSessionKeys, [
    "agent:researcher:discord:channel:test-room:subagent:abc",
  ]);
});
