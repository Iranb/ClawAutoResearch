import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveQueuedLiteratureDiscoveryForegroundFastPath,
} from "../tools/register-workflow-hooks.ts";

test("resolveQueuedLiteratureDiscoveryForegroundFastPath prefers queued literature discovery requests with command text", () => {
  const fastPath = resolveQueuedLiteratureDiscoveryForegroundFastPath({
    paperIngestion: {
      queued_requests: [
        {
          request_id: "plain-upload",
          trigger_kind: "manual_upload",
          status: "queued",
          command_text: "python3 scripts/pn_batch_import.py --manifest /tmp/upload.json submit",
        },
        {
          request_id: "lit-gap-1",
          trigger_kind: "idea_literature_discovery",
          status: "queued",
          command_text:
            "LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION\nRequest id: lit-gap-1",
        },
      ],
    },
  });

  assert.deepEqual(fastPath, {
    requestId: "lit-gap-1",
    commandText:
      "LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION\nRequest id: lit-gap-1 -- __BACKGROUND_CONTINUATION__: true",
    status: "queued",
  });
});

test("resolveQueuedLiteratureDiscoveryForegroundFastPath does not relaunch already running literature discovery work", () => {
  const fastPath = resolveQueuedLiteratureDiscoveryForegroundFastPath({
    paperIngestion: {
      queued_requests: [
        {
          request_id: "lit-gap-running",
          trigger_kind: "review_literature_discovery",
          status: "running",
          command_text:
            "LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION\nRequest id: lit-gap-running",
        },
      ],
    },
  });

  assert.equal(fastPath, null);
});
