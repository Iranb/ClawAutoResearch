import test from "node:test";
import assert from "node:assert/strict";

import { waitForPort } from "../scripts/isolated_gateway_server.mjs";

test("isolated gateway port wait fails promptly when gateway exits before listening", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    waitForPort({
      port: 9,
      timeoutMs: 30_000,
      exitPromise: Promise.resolve({ code: 1, signal: null }),
    }),
    /exited before opening port/
  );

  assert.equal(Date.now() - startedAt < 2_000, true);
});
