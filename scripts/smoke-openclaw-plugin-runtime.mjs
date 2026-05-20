import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function finding(code, message, filePath) {
  return { code, message, path: filePath ?? null };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadPluginEntry(repoRoot) {
  const entryPath = path.join(repoRoot, "dist", "index.js");
  try {
    await fs.access(entryPath);
  } catch {
    throw new Error(
      `OpenClaw runtime smoke requires ${entryPath}. Run npm run build after TypeScript compilation.`
    );
  }

  const module = await import(`${pathToFileURL(entryPath).href}?smoke=${Date.now()}`);
  const entry = asObject(module.default);
  if (entry && typeof entry.register === "function") {
    return entry;
  }
  if (typeof module.registerOpenClawResearchPlugin === "function") {
    return {
      id: null,
      name: null,
      description: null,
      register: module.registerOpenClawResearchPlugin,
    };
  }
  throw new Error("dist/index.js does not export a plugin entry register function.");
}

function createRuntimeSmokeApi({ repoRoot, projectsRoot }) {
  const registrations = {
    tools: [],
    commands: [],
    services: [],
    hooks: [],
    interactiveHandlers: [],
  };
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  const api = {
    id: "ClawAutoResearch",
    name: "ClawAutoResearch",
    config: {},
    pluginConfig: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId = "researcher") {
          return path.join(repoRoot, ".openclaw-research", "smoke", "workspace", agentId);
        },
        resolveAgentDir(_cfg, agentId = "researcher") {
          return path.join(repoRoot, ".openclaw-research", "smoke", "agents", agentId);
        },
        resolveAgentTimeoutMs() {
          return 1000;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:local:openclaw-runtime-smoke",
            };
          },
        },
      },
      subagent: {
        async run() {
          return { runId: "openclaw-runtime-smoke-run" };
        },
      },
    },
    logger,
    registerTool(spec, options) {
      registrations.tools.push({ spec, options: options ?? {} });
    },
    registerCommand(command) {
      registrations.commands.push(command);
    },
    registerService(service) {
      registrations.services.push(service);
    },
    registerInteractiveHandler(registration) {
      registrations.interactiveHandlers.push(registration);
    },
    on(hookName, handler, options) {
      registrations.hooks.push({ hookName, handler, options: options ?? {} });
    },
  };

  return { api, registrations };
}

function materializeTool(entry) {
  if (typeof entry.spec !== "function") {
    return entry.spec;
  }
  return entry.spec({
    workspaceDir: "/tmp/openclaw-runtime-smoke-workspace",
    agentId: "researcher",
    sessionKey: "agent:researcher:local:openclaw-runtime-smoke",
    messageChannel: "local",
    conversationId: "openclaw-runtime-smoke",
  });
}

function validateToolShape({ entry, tool, repoRoot }) {
  const findings = [];
  const optionName = asObject(entry.options)?.name;
  const toolName = typeof tool?.name === "string" ? tool.name : optionName;

  if (!tool || typeof tool !== "object") {
    findings.push(
      finding(
        "plugin_runtime_tool_materialization_failed",
        `Registered tool ${optionName ?? "<unknown>"} did not materialize a tool spec.`,
        repoRoot
      )
    );
    return { toolName, findings };
  }

  if (!toolName) {
    findings.push(
      finding(
        "plugin_runtime_tool_name_missing",
        "Registered tool must expose a stable name.",
        repoRoot
      )
    );
  }
  if (optionName && tool.name && optionName !== tool.name) {
    findings.push(
      finding(
        "plugin_runtime_tool_name_mismatch",
        `registerTool option name ${optionName} must match materialized tool name ${tool.name}.`,
        repoRoot
      )
    );
  }
  if (typeof tool?.description !== "string" || !tool.description.trim()) {
    findings.push(
      finding(
        "plugin_runtime_tool_description_missing",
        `Registered tool ${toolName ?? "<unknown>"} must expose a description.`,
        repoRoot
      )
    );
  }
  if (!asObject(tool?.parameters)) {
    findings.push(
      finding(
        "plugin_runtime_tool_parameters_invalid",
        `Registered tool ${toolName ?? "<unknown>"} must expose an object parameters schema.`,
        repoRoot
      )
    );
  }
  if (typeof tool?.execute !== "function") {
    findings.push(
      finding(
        "plugin_runtime_tool_execute_missing",
        `Registered tool ${toolName ?? "<unknown>"} must expose execute().`,
        repoRoot
      )
    );
  }

  return { toolName, findings };
}

export async function smokeOpenClawPluginRuntime({
  repoRoot = process.cwd(),
  projectsRoot = path.join(process.cwd(), ".openclaw-research", "runtime-smoke-projects"),
} = {}) {
  const manifestPath = path.join(repoRoot, "openclaw.plugin.json");
  const manifest = await readJsonFile(manifestPath);
  const entry = await loadPluginEntry(repoRoot);
  const { api, registrations } = createRuntimeSmokeApi({ repoRoot, projectsRoot });
  const findings = [];

  if (entry.id && entry.id !== manifest.id) {
    findings.push(
      finding(
        "plugin_runtime_entry_id_mismatch",
        "dist plugin entry id must match openclaw.plugin.json id.",
        path.join(repoRoot, "dist", "index.js")
      )
    );
  }

  entry.register(api);

  const materializedTools = [];
  for (const toolEntry of registrations.tools) {
    try {
      const tool = materializeTool(toolEntry);
      const validation = validateToolShape({ entry: toolEntry, tool, repoRoot });
      findings.push(...validation.findings);
      if (validation.toolName) {
        materializedTools.push(validation.toolName);
      }
    } catch (error) {
      findings.push(
        finding(
          "plugin_runtime_tool_materialization_failed",
          error instanceof Error ? error.message : String(error),
          repoRoot
        )
      );
    }
  }

  const manifestTools = uniqueSorted(stringArray(asObject(manifest.contracts)?.tools));
  const registeredTools = uniqueSorted(materializedTools);
  for (const toolName of manifestTools) {
    if (!registeredTools.includes(toolName)) {
      findings.push(
        finding(
          "plugin_runtime_tool_contract_not_registered",
          `openclaw.plugin.json contracts.tools declares ${toolName}, but dist runtime did not register it.`,
          manifestPath
        )
      );
    }
  }
  for (const toolName of registeredTools) {
    if (!manifestTools.includes(toolName)) {
      findings.push(
        finding(
          "plugin_runtime_registered_tool_missing_manifest_contract",
          `dist runtime registered ${toolName}, but openclaw.plugin.json contracts.tools does not declare it.`,
          manifestPath
        )
      );
    }
  }

  if (registrations.commands.length === 0) {
    findings.push(
      finding(
        "plugin_runtime_commands_missing",
        "Mixed-capability plugin runtime must register command handlers.",
        repoRoot
      )
    );
  }
  if (registrations.hooks.length === 0) {
    findings.push(
      finding(
        "plugin_runtime_hooks_missing",
        "Mixed-capability plugin runtime must register workflow hooks.",
        repoRoot
      )
    );
  }
  if (registrations.services.length === 0) {
    findings.push(
      finding(
        "plugin_runtime_services_missing",
        "Mixed-capability plugin runtime must register workflow services.",
        repoRoot
      )
    );
  }

  return {
    ok: findings.length === 0,
    findingCount: findings.length,
    findings,
    entry: {
      id: entry.id ?? null,
      name: entry.name ?? null,
      description: entry.description ?? null,
    },
    manifestTools,
    registeredTools,
    commandNames: uniqueSorted(
      registrations.commands.map((command) => command?.name)
    ),
    hookNames: uniqueSorted(
      registrations.hooks.map((hook) => hook?.hookName)
    ),
    serviceIds: uniqueSorted(
      registrations.services.map((service) => service?.id)
    ),
    interactiveHandlers: registrations.interactiveHandlers.map((handler) => ({
      channel: handler?.channel ?? null,
      namespace: handler?.namespace ?? null,
    })),
  };
}

export function formatOpenClawPluginRuntimeSmokeReport(result) {
  if (result.ok) {
    return [
      "openclaw_plugin_runtime_smoke_ok",
      `tools=${result.registeredTools.join(",")}`,
      `commands=${result.commandNames.length}`,
      `hooks=${result.hookNames.length}`,
      `services=${result.serviceIds.length}`,
      `interactive_handlers=${result.interactiveHandlers.length}`,
    ].join(" ");
  }

  return [
    `openclaw_plugin_runtime_smoke_failed count=${result.findingCount}`,
    ...result.findings.map((entry) =>
      `${entry.code}${entry.path ? ` path=${entry.path}` : ""}: ${entry.message}`
    ),
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    repoRoot: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.repoRoot = path.resolve(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await smokeOpenClawPluginRuntime({
    repoRoot: args.repoRoot,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatOpenClawPluginRuntimeSmokeReport(result));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("[smoke-openclaw-plugin-runtime] failed");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
