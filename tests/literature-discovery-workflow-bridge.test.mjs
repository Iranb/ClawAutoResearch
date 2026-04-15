import test from "node:test";
import assert from "node:assert/strict";

import {
  hasActiveLiteratureDiscoveryRequest,
  shouldRouteLiteratureDiscoveryToGraphBuild,
} from "../tools/literature-discovery/workflow-bridge.ts";

test("graph-ready dormant literature discovery requests still keep workflow-owned graph reentry active", () => {
  const paperIngestion = {
    queued_requests: [
      {
        request_id: "review-gap-1",
        status: "queued",
        trigger_kind: "review_literature_discovery",
        attempt_count: 0,
      },
    ],
  };

  assert.equal(
    hasActiveLiteratureDiscoveryRequest({
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    true,
  );
  assert.equal(
    shouldRouteLiteratureDiscoveryToGraphBuild({
      currentStage: "review",
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    true,
  );
  assert.equal(
    shouldRouteLiteratureDiscoveryToGraphBuild({
      currentStage: "graph_build",
      paperIngestion,
      graphPresenceStatus: "ready",
    }),
    false,
  );
});
