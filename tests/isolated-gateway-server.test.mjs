import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIsolatedGatewayConfig,
  waitForPort,
} from "../scripts/isolated_gateway_server.mjs";

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

test("isolated gateway config strips external message channels by default", () => {
  const config = buildIsolatedGatewayConfig({
    sourceConfig: {
      channels: {
        discord: { enabled: true, accounts: { researcher: { token: "secret" } } },
        imessage: { enabled: true },
        "openclaw-weixin": { accounts: { default: { token: "secret" } } },
      },
      plugins: {
        entries: {
          discord: { enabled: true },
          "openclaw-weixin": { enabled: true },
          acpx: { enabled: true },
          ClawAutoResearch: { enabled: false, config: { autoMode: "conservative" } },
        },
      },
      bindings: [
        { agentId: "researcher", match: { channel: "discord", accountId: "researcher" } },
        { agentId: "local", match: { channel: "local", accountId: "default" } },
      ],
      broadcast: { channel: ["researcher"] },
      messages: { queue: { byChannel: { discord: "collect", local: "collect" } } },
    },
    port: 43210,
    token: "isolated-token",
    projectsRoot: "/tmp/projects",
  });

  assert.deepEqual(config.channels, {});
  assert.equal(config.plugins.entries.discord, undefined);
  assert.equal(config.plugins.entries["openclaw-weixin"], undefined);
  assert.equal(config.plugins.entries.acpx.enabled, true);
  assert.equal(config.plugins.entries.ClawAutoResearch.enabled, true);
  assert.equal(config.plugins.entries.ClawAutoResearch.config.projectsRoot, "/tmp/projects");
  assert.deepEqual(config.bindings, [
    { agentId: "local", match: { channel: "local", accountId: "default" } },
  ]);
  assert.deepEqual(config.broadcast, {});
  assert.deepEqual(config.messages.queue.byChannel, { local: "collect" });
  assert.equal(config.gateway.port, 43210);
  assert.equal(config.gateway.auth.token, "isolated-token");
});
