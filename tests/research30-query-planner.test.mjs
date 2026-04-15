import test from "node:test";
import assert from "node:assert/strict";

import { buildBroadPaperSearchPlan } from "../tools/research30/query-planner.ts";
import { matchVenueRegistry } from "../tools/research30/venue-registry.ts";

test("query planner emits deterministic multi-family queries and venue packs", () => {
  const plan = buildBroadPaperSearchPlan({
    topic: "graph neural network retrieval augmentation for multimodal reasoning",
    depth: "default",
  });

  assert.ok(plan.queries.length >= 4);
  assert.ok(plan.preferredVenuePacks.length >= 1);
  assert.ok(plan.queries.some((entry) => entry.family === "direct"));
  assert.ok(plan.queries.some((entry) => entry.family === "task_method"));
  assert.ok(plan.queries.some((entry) => entry.family === "venue_pack"));
});

test("venue registry normalizes common top-tier aliases", () => {
  const match = matchVenueRegistry({
    venue: "Advances in Neural Information Processing Systems",
    preferredPacks: ["cs_ml_core"],
  });

  assert.equal(match.venueFamily, "neurips");
  assert.ok(match.venuePackHits.includes("cs_ml_core"));
});
