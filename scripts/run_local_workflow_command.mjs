#!/usr/bin/env node
import path from "node:path";
import {
  argValue,
  dispatchWorkflowCommand,
  loadWorkflowHarnessPluginConfig,
  resolveWorkflowHarnessProjectsRoot,
} from "./workflow_command_harness_lib.mjs";

async function main() {
  const commandName = argValue(process.argv, "--command");
  if (!commandName) {
    console.error(
      "Usage: node scripts/run_local_workflow_command.mjs --command <name> [--args \"...\"] [--project-root <path>] [--projects-root <path>] [--source-config-path <openclaw.json>] [--session-key <key>] [--channel local|discord] [--conversation-id <id>]"
    );
    process.exit(2);
  }

  const args = argValue(process.argv, "--args", "");
  const projectRootArg = argValue(process.argv, "--project-root");
  const projectRoot = projectRootArg ? path.resolve(projectRootArg) : null;
  const sourceConfigPath = argValue(process.argv, "--source-config-path", null);
  const channel = argValue(process.argv, "--channel", "local");
  const conversationId = argValue(process.argv, "--conversation-id", "local-command");
  const sessionKey =
    argValue(process.argv, "--session-key") ??
    `agent:researcher:${channel}:${conversationId}`;
  const from = argValue(
    process.argv,
    "--from",
    channel === "discord"
      ? `discord:channel:${conversationId}`
      : `local:conversation:${conversationId}`
  );
  const to = argValue(
    process.argv,
    "--to",
    channel === "discord" ? `slash:${conversationId}` : from
  );
  const projectsRoot = await resolveWorkflowHarnessProjectsRoot({
    projectsRoot: argValue(process.argv, "--projects-root", null),
    projectRoot,
    sourceConfigPath,
    fallback: process.cwd(),
  });
  const pluginConfig = await loadWorkflowHarnessPluginConfig({
    sourceConfigPath,
    projectsRoot,
  });

  const output = await dispatchWorkflowCommand({
    commandName,
    args,
    projectRoot,
    projectsRoot,
    sessionKey,
    channel,
    from,
    to,
    emitFallbackNote: process.argv.includes("--emit-fallback-note"),
    pluginConfig,
    contextExtras: {
      sessionKey,
      conversationId,
      ...(channel === "local"
        ? {
            originatingChannel: "local",
            originatingTo: `conversation:${conversationId}`,
          }
        : {}),
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

await main();
