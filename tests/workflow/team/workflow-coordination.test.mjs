import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { enqueueWorkflowTask } from "../../../tools/workflow-coordination.ts";

test("enqueueWorkflowTask serializes work for the same key", async () => {
  const events = [];

  await Promise.all([
    enqueueWorkflowTask({
      key: "workflow:test:same",
      task: async () => {
        events.push("first:start");
        await delay(25);
        events.push("first:end");
      },
    }),
    enqueueWorkflowTask({
      key: "workflow:test:same",
      task: async () => {
        events.push("second:start");
        events.push("second:end");
      },
    }),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("enqueueWorkflowTask allows reentrant execution for the active key", async () => {
  const events = [];

  await enqueueWorkflowTask({
    key: "workflow:test:reentrant",
    task: async () => {
      events.push("outer:start");
      await enqueueWorkflowTask({
        key: "workflow:test:reentrant",
        task: async () => {
          events.push("inner");
        },
      });
      events.push("outer:end");
    },
  });

  assert.deepEqual(events, ["outer:start", "inner", "outer:end"]);
});
