import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  resolveBindingConversationFromCommandContext,
  resolveWorkflowCommandSessionTarget,
} from "../tools/workflow-commands.ts";

const execFile = promisify(execFileCb);

function makeApi() {
  return {
    config: {},
    pluginConfig: {
      enableChannelProjectBindings: true,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "researcher",
              sessionKey: "agent:researcher:discord:slash:owner",
            };
          },
        },
      },
      subagent: undefined,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerCommand() {},
  };
}

test("resolveBindingConversationFromCommandContext prefers native Discord originatingTo", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "discord",
    from: "discord:channel:gcd-lab",
    to: "slash:owner",
    originatingTo: "channel:gcd-lab",
    accountId: "default",
    messageThreadId: undefined,
  });

  assert.deepEqual(conversation, {
    channel: "discord",
    accountId: "default",
    conversationId: "channel:gcd-lab",
  });
});

test("resolveBindingConversationFromCommandContext supports native Discord DM contexts", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "discord",
    from: "discord:user-1",
    to: "slash:user-1",
    originatingTo: "user:user-1",
    accountId: "default",
    messageThreadId: undefined,
  });

  assert.deepEqual(conversation, {
    channel: "discord",
    accountId: "default",
    conversationId: "user:user-1",
  });
});

test("resolveBindingConversationFromCommandContext preserves native Discord thread contexts", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "discord",
    from: "discord:channel:gcd-lab",
    to: "slash:owner",
    originatingTo: "channel:gcd-lab",
    accountId: "default",
    messageThreadId: "thread-42",
  });

  assert.deepEqual(conversation, {
    channel: "discord",
    accountId: "default",
    conversationId: "channel:gcd-lab",
    threadId: "thread-42",
  });
});

test("resolveWorkflowCommandSessionTarget prefers CommandTargetSessionKey for native slash", () => {
  const target = resolveWorkflowCommandSessionTarget(
    makeApi(),
    {
      channel: "discord",
      from: "discord:channel:gcd-lab",
      to: "slash:owner",
      originatingTo: "channel:gcd-lab",
      accountId: "default",
      config: {},
      commandSource: "native",
      commandTargetSessionKey: "agent:researcher:discord:channel:gcd-lab",
      sessionKey: "agent:researcher:discord:slash:owner",
    },
    () => ({
      targetSessionKey: "agent:researcher:discord:channel:bound-from-binding",
    })
  );

  assert.equal(target.sessionKey, "agent:researcher:discord:channel:gcd-lab");
  assert.equal(target.agentId, "researcher");
  assert.equal(target.workspaceDir, "/tmp/workspace-researcher");
});

test("native slash replay harness starts /auto-research against a local projects root", async () => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-native-research-"));
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "run_discord_native_slash_replay_test.mjs"
  );
  const { stdout } = await execFile(process.execPath, [
    scriptPath,
    "--command",
    "auto-research",
    "--args",
    '"Generalized Category Discovery"',
    "--projects-root",
    projectsRoot,
    "--channel-id",
    "gcd-research-lab",
    "--user-id",
    "owner",
  ]);
  const output = JSON.parse(stdout);

  assert.match(output.result.text, /Full-auto research pipeline started/);
  assert.equal(
    output.nativeSlashContext.commandTargetSessionKey,
    "agent:researcher:discord:channel:gcd-research-lab"
  );
  const entries = await fs.readdir(projectsRoot);
  const projectDir = entries.find((entry) =>
    entry.includes("generalized-category-discovery")
  );
  assert.ok(projectDir);
  for (const relativePath of [
    "PROJECT_MANIFEST.json",
    "TRACK_REGISTRY.json",
    "CLAIM_POLICY.md",
    path.join("researcher", "EXPERIMENT_LEDGER.json"),
    path.join("researcher", "idle-research", "IDLE_RESEARCH.json"),
  ]) {
    await fs.access(path.join(projectsRoot, projectDir, relativePath));
  }
});

test("native slash replay harness starts /auto-review against a local projects root", async () => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-native-review-"));
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "run_discord_native_slash_replay_test.mjs"
  );
  const { stdout } = await execFile(process.execPath, [
    scriptPath,
    "--command",
    "auto-review",
    "--args",
    '"Generalized Category Discovery"',
    "--projects-root",
    projectsRoot,
    "--channel-id",
    "gcd-survey-lab",
    "--user-id",
    "owner",
  ]);
  const output = JSON.parse(stdout);

  assert.match(output.result.text, /Full-auto survey pipeline started/);
  assert.equal(
    output.nativeSlashContext.sessionKey,
    "agent:researcher:discord:slash:owner"
  );
  const entries = await fs.readdir(projectsRoot);
  const projectDir = entries.find((entry) =>
    entry.startsWith("survey-generalized-category-discovery")
  );
  assert.ok(projectDir);
  for (const relativePath of [
    "PROJECT_MANIFEST.json",
    "TRACK_REGISTRY.json",
    "CLAIM_POLICY.md",
    path.join("researcher", "EXPERIMENT_LEDGER.json"),
    path.join("researcher", "idle-research", "IDLE_RESEARCH.json"),
  ]) {
    await fs.access(path.join(projectsRoot, projectDir, relativePath));
  }
});
