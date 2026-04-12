#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createResearchWorkflowCommands } from "../tools/workflow-commands.ts";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeBackgroundRunReceipt(params) {
  const preferredDir = params.projectRoot
    ? path.join(params.projectRoot, ".openclaw-research")
    : path.join(process.cwd(), ".openclaw-research");
  const fallbackDir = path.join(
    os.tmpdir?.() ?? "/tmp",
    "openclaw-local-command",
    params.projectId ?? "unbound-project"
  );
  for (const baseDir of [preferredDir, fallbackDir]) {
    try {
      await fs.mkdir(baseDir, { recursive: true });
      const runPath = path.join(
        baseDir,
        "LOCAL_WORKFLOW_COMMAND_BACKGROUND_RUN.json"
      );
      await fs.writeFile(runPath, `${JSON.stringify(params.payload, null, 2)}\n`, "utf8");
      return runPath;
    } catch (error) {
      if ((error?.code ?? null) === "EPERM") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to persist local workflow command background receipt.");
}

async function buildLocalSnapshot(projectRoot) {
  if (!projectRoot) {
    return {
      projectId: null,
      projectRoot: null,
      currentStage: null,
      title: null,
      paperIngestionRepairRequired: false,
    };
  }
  const manifest =
    (await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {};
  return {
    projectId: manifest.project_id ?? path.basename(projectRoot),
    projectRoot,
    currentStage: manifest.current_stage ?? null,
    title: manifest.title ?? null,
    workflowLine:
      manifest.workflow_line ??
      manifest.writing_contract?.paper_mode ??
      null,
    paperIngestionRepairRequired:
      manifest.paper_ingestion?.refresh_required === true,
    paperIngestionRepairTargetCorpus:
      manifest.paper_ingestion?.shared_corpus ??
      manifest.paper_ingestion?.repair_target_corpus ??
      null,
  };
}

async function main() {
  const commandName = argValue("--command");
  if (!commandName) {
    console.error(
      "Usage: node scripts/run_local_workflow_command.mjs --command <name> [--args \"...\"] [--project-root <path>] [--session-key <key>] [--channel discord]"
    );
    process.exit(2);
  }

  const args = argValue("--args", "");
  const projectRootArg = argValue("--project-root");
  const projectRoot = projectRootArg ? path.resolve(projectRootArg) : null;
  const projectId = projectRoot ? path.basename(projectRoot) : null;
  const sessionKey =
    argValue("--session-key") ??
    `agent:researcher:${argValue("--channel", "discord")}:local-command`;
  const channel = argValue("--channel", "discord");
  const from = argValue("--from", channel === "discord" ? "discord:channel:local-command" : "local-command");
  const to = argValue("--to", from);
  const workspaceDir = projectRoot ?? process.cwd();
  const projectsRoot =
    argValue("--projects-root") ??
    (projectRoot ? path.dirname(projectRoot) : process.cwd());

  const backgroundRuns = [];
  const api = {
    config: {
      projectsRoot,
      enableChannelProjectBindings: true,
      heartbeatBackgroundChecks: true,
      enableWorkflowMailbox: true,
    },
    pluginConfig: {
      projectsRoot,
      enableChannelProjectBindings: true,
      heartbeatBackgroundChecks: true,
      enableWorkflowMailbox: true,
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
    },
    runtime: {
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              sessionKey,
              agentId: "researcher",
            };
          },
        },
      },
      agent: {
        resolveAgentWorkspaceDir() {
          return workspaceDir;
        },
      },
      subagent: undefined,
    },
    registerCommand() {},
  };

  const commands = createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: sessionKey,
      };
    },
    async buildWorkflowSnapshot() {
      return await buildLocalSnapshot(projectRoot);
    },
    async startBackgroundWorkflowRun(params) {
      const snapshot = await buildLocalSnapshot(projectRoot);
      const payload = {
        recordedAt: new Date().toISOString(),
        source: "run_local_workflow_command",
        backgroundRun: params.backgroundRun,
        snapshot,
      };
      const runPath = await writeBackgroundRunReceipt({
        projectRoot,
        projectId,
        payload,
      });
      backgroundRuns.push(payload);
      return {
        started: true,
        queued: false,
        summary:
          params.backgroundRun.summary ??
          `Locally materialized background run for ${params.backgroundRun.kind}.`,
        runId: `local-${params.backgroundRun.kind}`,
        queueKey: `local:${params.backgroundRun.kind}`,
        runPath,
      };
    },
  });

  const command = commands.find((entry) => entry.name === commandName);
  if (!command) {
    console.error(`Unknown workflow command: ${commandName}`);
    process.exit(2);
  }

  if (projectRoot && !(await pathExists(projectRoot))) {
    console.error(`Project root does not exist: ${projectRoot}`);
    process.exit(2);
  }

  const commandBody = `/${commandName}${args ? ` ${args}` : ""}`;
  const result = await command.handler({
    args,
    commandBody,
    channel,
    from,
    to,
    accountId: "default",
    config: {},
  });

  const output = {
    command: `/${commandName}`,
    args,
    projectRoot,
    sessionKey,
    result,
    backgroundRuns,
    fallbackTransport: hasFlag("--emit-fallback-note")
      ? "Executed through local command handler because non-interactive agent transport is unreliable."
      : null,
  };
  console.log(JSON.stringify(output, null, 2));
}

await main();
