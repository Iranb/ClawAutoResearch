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

test("query planner sanitizes noisy survey topics and removes duplicate query texts", () => {
  const plan = buildBroadPaperSearchPlan({
    topic: "cites:10.1109/cvpr52688.2022.00734 Generalized Category Discovery v3 follow-up extensions",
    depth: "default",
  });

  assert.ok(plan.queries.length >= 3);
  assert.equal(
    plan.queries.some((entry) => /\bv3\b/i.test(entry.query)),
    false
  );
  assert.equal(
    plan.queries.some((entry) => /10\.1109|cvpr52688|follow-up|extensions/i.test(entry.query)),
    false
  );
  assert.equal(
    new Set(plan.queries.map((entry) => entry.query.toLowerCase())).size,
    plan.queries.length
  );
});

test("venue registry normalizes common top-tier aliases", () => {
  const match = matchVenueRegistry({
    venue: "Advances in Neural Information Processing Systems",
    preferredPacks: ["cs_ml_core"],
  });

  assert.equal(match.venueFamily, "neurips");
  assert.ok(match.venuePackHits.includes("cs_ml_core"));
});
