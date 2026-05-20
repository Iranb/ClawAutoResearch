import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createResearchWorkflowCommands } from "../tools/workflow-commands.ts";
import { getWorkflowGuardPolicy } from "../tools/workflow-guard.ts";
import { startBackgroundWorkflowRun as startRealBackgroundWorkflowRun } from "../tools/workflow-fast-paths.ts";
import { shouldUseChannelProjectBindingForWorkflow } from "../tools/workflow-message-channels.ts";

export function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return fallback;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function normalizeWorkflowCommandName(commandName) {
  const normalized = String(commandName ?? "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replaceAll("_", "-");
  const aliases = {
    autoresearch: "auto-research",
    "auto-research": "auto-research",
    autoreview: "auto-review",
    "auto-review": "auto-review",
  };
  return aliases[normalized] ?? normalized;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(isRecord(value) ? value : {}));
}

export function expandHomePath(value) {
  const raw = String(value ?? "").trim();
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function normalizeHarnessPluginConfig(config, projectsRoot) {
  const base = cloneRecord(config);
  return {
    ...base,
    projectsRoot,
    enableChannelProjectBindings:
      base.enableChannelProjectBindings === false ? false : true,
    heartbeatBackgroundChecks:
      base.heartbeatBackgroundChecks === false ? false : true,
    enableWorkflowMailbox:
      base.enableWorkflowMailbox === false ? false : true,
  };
}

export function extractClawAutoResearchPluginConfig(openclawConfig) {
  const entries = isRecord(openclawConfig?.plugins?.entries)
    ? openclawConfig.plugins.entries
    : {};
  const pluginEntry =
    entries.ClawAutoResearch ??
    entries["claw-auto-research"] ??
    entries.openclawResearch ??
    entries["openclaw-research"] ??
    null;
  if (isRecord(pluginEntry?.config)) {
    return cloneRecord(pluginEntry.config);
  }
  if (isRecord(pluginEntry)) {
    return cloneRecord(pluginEntry);
  }
  if (isRecord(openclawConfig?.workflow)) {
    return cloneRecord(openclawConfig.workflow);
  }
  return {};
}

export function configuredProjectsRootFromOpenClawConfig(openclawConfig) {
  const pluginConfig = extractClawAutoResearchPluginConfig(openclawConfig);
  const candidates = [
    pluginConfig.projectsRoot,
    pluginConfig.projects_root,
    openclawConfig?.projectsRoot,
    openclawConfig?.projects_root,
    openclawConfig?.workflow?.projectsRoot,
    openclawConfig?.workflow?.projects_root,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export async function resolveWorkflowHarnessProjectsRoot(options = {}) {
  if (options.projectsRoot) {
    return path.resolve(expandHomePath(options.projectsRoot));
  }
  if (options.projectRoot) {
    return path.dirname(path.resolve(expandHomePath(options.projectRoot)));
  }
  const sourceConfigPath = expandHomePath(
    options.sourceConfigPath ?? path.join(os.homedir(), ".openclaw", "openclaw.json")
  );
  const sourceConfig = (await readJson(sourceConfigPath)) ?? {};
  const configuredProjectsRoot = configuredProjectsRootFromOpenClawConfig(sourceConfig);
  if (configuredProjectsRoot) {
    return path.resolve(expandHomePath(configuredProjectsRoot));
  }
  return path.resolve(expandHomePath(options.fallback ?? process.cwd()));
}

export async function loadWorkflowHarnessPluginConfig(options = {}) {
  const sourceConfigPath = expandHomePath(
    options.sourceConfigPath ?? path.join(os.homedir(), ".openclaw", "openclaw.json")
  );
  const sourceConfig = (await readJson(sourceConfigPath)) ?? {};
  const projectsRoot = await resolveWorkflowHarnessProjectsRoot({
    sourceConfigPath,
    projectsRoot: options.projectsRoot,
    fallback: process.cwd(),
  });
  return normalizeHarnessPluginConfig(
    {
      ...extractClawAutoResearchPluginConfig(sourceConfig),
      ...(isRecord(options.overrides) ? options.overrides : {}),
    },
    projectsRoot
  );
}

export async function pathExists(filePath) {
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
      const runPath = path.join(baseDir, "LOCAL_WORKFLOW_COMMAND_BACKGROUND_RUN.json");
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

export async function buildLocalSnapshot(projectRoot) {
  if (!projectRoot) {
    return {
      projectId: null,
      projectRoot: null,
      currentStage: null,
      title: null,
      paperIngestionRepairRequired: false,
    };
  }
  const manifest = (await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {};
  const workflowControl = isRecord(manifest.workflow_control)
    ? manifest.workflow_control
    : {};
  return {
    projectId: manifest.project_id ?? path.basename(projectRoot),
    projectRoot,
    currentStage:
      workflowControl.stage ?? manifest.current_stage ?? manifest.currentStage ?? null,
    title: manifest.title ?? null,
    workflowLine: manifest.workflow_line ?? manifest.writing_contract?.paper_mode ?? null,
    paperIngestionRepairRequired: manifest.paper_ingestion?.refresh_required === true,
    paperIngestionRepairTargetCorpus:
      manifest.paper_ingestion?.shared_corpus ??
      manifest.paper_ingestion?.repair_target_corpus ??
      null,
  };
}

function extractAgentId(sessionKey, fallback = "researcher") {
  const match = /^agent:([^:]+):/i.exec(sessionKey ?? "");
  return match?.[1] ?? fallback;
}

export async function dispatchWorkflowCommand(options) {
  const {
    commandName,
    args = "",
    projectRoot: rawProjectRoot = null,
    projectsRoot: rawProjectsRoot = null,
    sessionKey,
    channel = "discord",
    from,
    to,
    accountId = "default",
    workspaceDir: rawWorkspaceDir = null,
    contextExtras = {},
    emitFallbackNote = false,
    runtimeSubagent = undefined,
    backgroundExecutionMode = "fixture",
    logger = null,
    pluginConfig: rawPluginConfig = null,
  } = options;

  const projectRoot = rawProjectRoot ? path.resolve(rawProjectRoot) : null;
  const workspaceDir = rawWorkspaceDir ? path.resolve(rawWorkspaceDir) : projectRoot ?? process.cwd();
  const projectsRoot = rawProjectsRoot
    ? path.resolve(rawProjectsRoot)
    : projectRoot
      ? path.dirname(projectRoot)
      : process.cwd();
  const agentId = extractAgentId(
    contextExtras.commandTargetSessionKey ?? contextExtras.sessionKey ?? sessionKey,
    "researcher"
  );
  const normalizedCommandName = normalizeWorkflowCommandName(commandName);
  const projectId = projectRoot ? path.basename(projectRoot) : null;
  const backgroundRuns = [];
  const pluginConfig = normalizeHarnessPluginConfig(rawPluginConfig, projectsRoot);

  const api = {
    config: pluginConfig,
    pluginConfig,
    logger: {
      debug(...args) {
        logger?.debug?.(...args);
      },
      info(...args) {
        logger?.info?.(...args);
      },
      warn(...args) {
        logger?.warn?.(...args);
      },
    },
    runtime: {
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              sessionKey: contextExtras.commandTargetSessionKey ?? sessionKey,
              agentId,
            };
          },
        },
      },
      agent: {
        resolveAgentWorkspaceDir() {
          return workspaceDir;
        },
      },
      subagent: runtimeSubagent,
    },
    registerCommand() {},
  };

  const commands = createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: contextExtras.commandTargetSessionKey ?? sessionKey,
      };
    },
    async buildWorkflowSnapshot() {
      return await buildLocalSnapshot(projectRoot);
    },
    async startBackgroundWorkflowRun(params) {
      const effectiveProjectRoot =
        params.snapshot?.projectRoot ??
        params.backgroundRun?.projectRoot ??
        projectRoot;
      const effectiveProjectId =
        params.snapshot?.projectId ??
        params.backgroundRun?.projectId ??
        (effectiveProjectRoot ? path.basename(effectiveProjectRoot) : projectId);
      const snapshot = await buildLocalSnapshot(effectiveProjectRoot);
      if (backgroundExecutionMode === "live") {
        const workflowPolicy = getWorkflowGuardPolicy(api.pluginConfig);
        const liveResult = await startRealBackgroundWorkflowRun({
          workflowRuntime: params.workflowRuntime,
          workflowPolicy,
          agentCtx: {
            agentId,
            workspaceDir: effectiveProjectRoot ?? workspaceDir,
            sessionKey: contextExtras.commandTargetSessionKey ?? sessionKey,
            sessionId: undefined,
            messageChannel: channel,
            channelKey: contextExtras.channelKey ?? null,
          },
          snapshot: {
            role: agentId,
            projectRoot: effectiveProjectRoot,
            projectId: effectiveProjectId,
            currentStage: snapshot.currentStage ?? null,
            title: snapshot.title ?? null,
            channelProjectBindingsEnabled: shouldUseChannelProjectBindingForWorkflow({
              messageChannel: channel,
              channelKey: contextExtras.channelKey ?? null,
              sessionKey: contextExtras.commandTargetSessionKey ?? sessionKey,
            }),
          },
          backgroundRun: params.backgroundRun,
        });
        const payload = {
          recordedAt: new Date().toISOString(),
          source: "workflow_command_harness_live",
          backgroundRun: params.backgroundRun,
          snapshot,
          started: liveResult,
        };
        const runPath = await writeBackgroundRunReceipt({
          projectRoot: effectiveProjectRoot,
          projectId: effectiveProjectId,
          payload,
        });
        backgroundRuns.push({ ...payload, runPath });
        return {
          ...liveResult,
          runPath,
        };
      }
      const payload = {
        recordedAt: new Date().toISOString(),
        source: "workflow_command_harness",
        backgroundRun: params.backgroundRun,
        snapshot,
      };
      const runPath = await writeBackgroundRunReceipt({
        projectRoot: effectiveProjectRoot,
        projectId: effectiveProjectId,
        payload,
      });
      backgroundRuns.push({ ...payload, runPath });
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

  const command = commands.find((entry) => entry.name === normalizedCommandName);
  if (!command) {
    throw new Error(`Unknown workflow command: ${commandName}`);
  }

  if (projectRoot && !(await pathExists(projectRoot))) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }

  const commandBody = `/${normalizedCommandName}${args ? ` ${args}` : ""}`;
  const result = await command.handler({
    args,
    commandBody,
    channel,
    from,
    to,
    accountId,
    config: {},
    sessionKey,
    ...contextExtras,
  });

  return {
    command: `/${normalizedCommandName}`,
    requestedCommand: `/${String(commandName ?? "").trim().replace(/^\/+/, "")}`,
    args,
    projectRoot,
    projectsRoot,
    sessionKey,
    result,
    backgroundRuns,
    fallbackTransport: emitFallbackNote
      ? backgroundExecutionMode === "live"
        ? "Executed through local command handler with live runtime subagent support."
        : "Executed through local command handler because external transport is not part of this harness."
      : null,
  };
}
