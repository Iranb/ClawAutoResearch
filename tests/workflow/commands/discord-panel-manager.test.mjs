import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildAutoresearchDiscordPanelComponentSpec,
  registerAutoresearchDiscordPanel,
} from "../../../tools/discord-panel-manager.ts";

function makePlugin(overrides = {}) {
  const services = [];
  const handlers = [];
  const sentPayloads = [];
  const api = {
    config: {},
    pluginConfig: {
      discordPanel: {
        enabled: true,
        channelId: "1503199948877856780",
        accountId: "researcher",
      actionMode: "test_panel",
      startupRefreshDelayMs: 120000,
    },
    },
    runtime: {
      channel: {
        outbound: {
          async loadAdapter(id) {
            assert.equal(id, "discord");
            return {
              async sendPayload(ctx) {
                sentPayloads.push(ctx);
                return {
                  channel: "discord",
                  messageId: "panel-message-1",
                  channelId: "1503199948877856780",
                };
              },
            };
          },
        },
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    registerTool() {},
    registerCommand() {},
    registerService(service) {
      services.push(service);
    },
    registerInteractiveHandler(handler) {
      handlers.push(handler);
    },
    ...overrides.api,
  };
  return {
    plugin: {
      api,
      getPluginConfig: () => api.pluginConfig,
      getMemoryPolicy: () => ({}),
      getWorkflowPolicy: () => ({}),
    },
    api,
    services,
    handlers,
    sentPayloads,
  };
}

function makeDiscordInteraction(overrides = {}) {
  const replies = [];
  const acknowledgements = [];
  return {
    ctx: {
      channel: "discord",
      accountId: "researcher",
      conversationId: "channel:1503199948877856780",
      senderId: "622667329897234442",
      auth: { isAuthorizedSender: true },
      interaction: {
        kind: "button",
        data: "autoresearch-panel:status",
        namespace: "autoresearch-panel",
        payload: "status",
        messageId: "panel-message-1",
      },
      respond: {
        async acknowledge() {
          acknowledgements.push({ method: "acknowledge" });
        },
        async reply(params) {
          replies.push({ method: "reply", ...params });
        },
        async followUp(params) {
          replies.push({ method: "followUp", ...params });
        },
      },
      requestConversationBinding: async () => ({ status: "error" }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
      ...overrides,
    },
    replies,
    acknowledgements,
  };
}

async function waitFor(assertion, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Timed out waiting for condition.");
}

test("persistent Discord panel spec uses namespaced reusable callbacks", () => {
  const spec = buildAutoresearchDiscordPanelComponentSpec({
    config: {
      enabled: true,
      channelId: "1503199948877856780",
      accountId: "researcher",
      actionMode: "test_panel",
      refreshIntervalMs: 1200000,
      startupRefreshDelayMs: 120000,
      activeActionTtlMs: 600000,
    },
    now: 1,
  });

  assert.equal(spec.reusable, true);
  assert.match(spec.text, /AutoResearch 控制面板/);
  assert.match(spec.text, /> - \[x\] 只读频道/);
  assert.match(spec.text, /> - \[ \] 模式：test-panel/);
  assert.deepEqual(
    spec.blocks[0].buttons.map((button) => button.label),
    ["Status", "Resume", "Graph", "Handoff", "Commands"]
  );
  assert.deepEqual(
    spec.blocks[0].buttons.map((button) => button.callbackData),
    [
      "autoresearch-panel:status",
      "autoresearch-panel:resume",
      "autoresearch-panel:graph",
      "autoresearch-panel:handoff",
      "autoresearch-panel:commands",
    ]
  );
});

test("panel service sends one reusable Discord component message and persists state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-panel-"));
  const harness = makePlugin();
  registerAutoresearchDiscordPanel(harness.plugin);

  assert.equal(harness.handlers.length, 1);
  assert.equal(harness.services.length, 1);

  await harness.services[0].start({
    config: harness.api.pluginConfig,
    stateDir,
    logger: harness.api.logger,
  });

  assert.equal(harness.sentPayloads.length, 1);
  assert.equal(harness.sentPayloads[0].to, "channel:1503199948877856780");
  assert.equal(harness.sentPayloads[0].accountId, "researcher");
  assert.equal(
    harness.sentPayloads[0].payload.channelData.discord.components.blocks[0].buttons[0]
      .callbackData,
    "autoresearch-panel:status"
  );

  const state = JSON.parse(
    await fs.readFile(path.join(stateDir, "autoresearch-discord-panel.json"), "utf8")
  );
  assert.equal(state.channelId, "1503199948877856780");
  assert.equal(state.accountId, "researcher");
  assert.equal(state.messageId, "panel-message-1");
});

test("test-panel button click edits the persistent message instead of running workflow", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-panel-"));
  const edits = [];
  const harness = makePlugin();
  registerAutoresearchDiscordPanel(harness.plugin, {
    async editPanelMessage(params) {
      edits.push(params);
      return { messageId: params.messageId, channelId: params.config.channelId };
    },
  });
  await harness.services[0].start({
    config: harness.api.pluginConfig,
    stateDir,
    logger: harness.api.logger,
  });

  const { ctx, replies, acknowledgements } = makeDiscordInteraction();
  await harness.handlers[0].handler(ctx);

  assert.equal(acknowledgements.length, 1);
  assert.equal(replies.length, 0);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, "panel-message-1");
  assert.match(edits[0].spec.text, /Status 测试触发成功/);

  const state = JSON.parse(
    await fs.readFile(path.join(stateDir, "autoresearch-discord-panel.json"), "utf8")
  );
  assert.equal(state.lastAction.action, "status");
  assert.match(state.lastAction.summary, /未执行/);
});

test("guarded workflow buttons report active state instead of duplicate launch", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-panel-"));
  const statePath = path.join(stateDir, "autoresearch-discord-panel.json");
  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      channelId: "1503199948877856780",
      accountId: "researcher",
      messageId: "panel-message-1",
      createdAt: 1000,
      updatedAt: 1000,
      activeAction: {
        action: "resume",
        label: "Resume",
        senderId: "622667329897234442",
        startedAt: 1000,
        expiresAt: 61000,
        summary: "/resume-pipeline 已接收。",
      },
    })}\n`,
    "utf8"
  );

  const edits = [];
  const harness = makePlugin({
    api: {
      pluginConfig: {
        discordPanel: {
          enabled: true,
          channelId: "1503199948877856780",
          accountId: "researcher",
          actionMode: "workflow",
          refreshIntervalMs: 1200000,
          startupRefreshDelayMs: 120000,
          activeActionTtlMs: 60000,
        },
      },
    },
  });
  registerAutoresearchDiscordPanel(harness.plugin, {
    now: () => 2000,
    async editPanelMessage(params) {
      edits.push(params);
      return { messageId: params.messageId, channelId: params.config.channelId };
    },
  });
  await harness.services[0].start({
    config: harness.api.pluginConfig,
    stateDir,
    logger: harness.api.logger,
  });

  const { ctx } = makeDiscordInteraction({
    interaction: {
      kind: "button",
      data: "autoresearch-panel:resume",
      namespace: "autoresearch-panel",
      payload: "resume",
      messageId: "panel-message-1",
    },
  });
  await harness.handlers[0].handler(ctx);

  assert.equal(edits.length, 2);
  assert.match(edits[1].spec.text, /不会重复启动/);
});

test("fresh panel fallback clears the superseded panel into a read-only notice", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-panel-"));
  const statePath = path.join(stateDir, "autoresearch-discord-panel.json");
  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      channelId: "1503199948877856780",
      accountId: "researcher",
      messageId: "panel-message-old",
      createdAt: 1000,
      updatedAt: 1000,
    })}\n`,
    "utf8"
  );

  const edits = [];
  let editAttempts = 0;
  const harness = makePlugin();
  registerAutoresearchDiscordPanel(harness.plugin, {
    async editPanelMessage(params) {
      editAttempts += 1;
      edits.push(params);
      if (editAttempts === 1) {
        throw new Error("transient edit failure");
      }
      return { messageId: params.messageId, channelId: params.config.channelId };
    },
  });

  await harness.services[0].start({
    config: harness.api.pluginConfig,
    stateDir,
    logger: harness.api.logger,
  });

  assert.equal(harness.sentPayloads.length, 1);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].messageId, "panel-message-old");
  assert.equal(edits[1].messageId, "panel-message-old");
  assert.match(edits[1].spec.text, /已刷新/);
  assert.equal(edits[1].spec.blocks, undefined);

  const state = JSON.parse(
    await fs.readFile(path.join(stateDir, "autoresearch-discord-panel.json"), "utf8")
  );
  assert.equal(state.messageId, "panel-message-1");
});

test("interval refresh keeps the existing panel when edit fails", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-panel-"));
  const statePath = path.join(stateDir, "autoresearch-discord-panel.json");
  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      channelId: "1503199948877856780",
      accountId: "researcher",
      messageId: "panel-message-existing",
      createdAt: 1000,
      updatedAt: 1000,
    })}\n`,
    "utf8"
  );

  let editAttempts = 0;
  const harness = makePlugin({
    api: {
      pluginConfig: {
        discordPanel: {
          enabled: true,
          channelId: "1503199948877856780",
          accountId: "researcher",
          actionMode: "test_panel",
          refreshIntervalMs: 1,
          startupRefreshDelayMs: 120000,
        },
      },
    },
  });
  registerAutoresearchDiscordPanel(harness.plugin, {
    async editPanelMessage(params) {
      editAttempts += 1;
      if (editAttempts > 1) {
        throw new Error("interval edit failure");
      }
      return { messageId: params.messageId, channelId: params.config.channelId };
    },
  });

  await harness.services[0].start({
    config: harness.api.pluginConfig,
    stateDir,
    logger: harness.api.logger,
  });

  assert.equal(harness.sentPayloads.length, 0);
  const state = await waitFor(async () => {
    assert.ok(editAttempts > 1);
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    assert.equal(parsed.lastReason, "interval");
    return parsed;
  });
  harness.services[0].stop();

  assert.equal(state.messageId, "panel-message-existing");
  assert.equal(state.lastReason, "interval");
});
