#!/usr/bin/env node
import path from "node:path";

import {
  argValue,
  dispatchWorkflowCommand,
} from "./workflow_command_harness_lib.mjs";

function buildUsage() {
  return [
    "Usage: node scripts/run_discord_native_slash_replay_test.mjs --command <name> [--args '\"topic\"']",
    "       [--projects-root <path>] [--project-root <path>] [--agent-id researcher]",
    "       [--user-id owner] [--channel-id native-test] [--account-id default]",
  ].join("\n");
}

async function main() {
  const argv = process.argv;
  const commandName = argValue(argv, "--command");
  if (!commandName) {
    console.error(buildUsage());
    process.exit(2);
  }

  const args = argValue(argv, "--args", "");
  const channel = "discord";
  const agentId = argValue(argv, "--agent-id", "researcher");
  const userId = argValue(argv, "--user-id", "owner");
  const accountId = argValue(argv, "--account-id", "default");
  const channelId = argValue(argv, "--channel-id", "native-slash-test");
  const projectRootArg = argValue(argv, "--project-root");
  const projectRoot = projectRootArg ? path.resolve(projectRootArg) : null;
  const projectsRoot =
    argValue(argv, "--projects-root") ??
    (projectRoot ? path.dirname(projectRoot) : process.cwd());
  const slashSessionKey =
    argValue(argv, "--session-key") ??
    `agent:${agentId}:discord:slash:${userId}`;
  const commandTargetSessionKey =
    argValue(argv, "--command-target-session-key") ??
    `agent:${agentId}:discord:channel:${channelId}`;
  const from = argValue(argv, "--from", `discord:channel:${channelId}`);
  const to = argValue(argv, "--to", `slash:${userId}`);
  const originatingTo = argValue(argv, "--originating-to", `channel:${channelId}`);
  const originatingChannel = argValue(argv, "--originating-channel", "discord");

  const output = await dispatchWorkflowCommand({
    commandName,
    args,
    projectRoot,
    projectsRoot,
    sessionKey: slashSessionKey,
    channel,
    from,
    to,
    accountId,
    contextExtras: {
      sessionKey: slashSessionKey,
      commandSource: "native",
      commandAuthorized: true,
      commandTargetSessionKey,
      originatingChannel,
      originatingTo,
    },
    emitFallbackNote: true,
  });

  output.nativeSlashContext = {
    sessionKey: slashSessionKey,
    commandTargetSessionKey,
    commandAuthorized: true,
    from,
    to,
    originatingChannel,
    originatingTo,
  };

  console.log(JSON.stringify(output, null, 2));
}

await main();
