#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function expandHome(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  return value.startsWith("~/") ? path.join(process.env.HOME ?? "", value.slice(2)) : value;
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    json: false,
    openclawHome: expandHome(process.env.OPENCLAW_HOME ?? `${process.env.HOME}/.openclaw`),
    configPath: null,
    agentIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--openclaw-home":
        args.openclawHome = expandHome(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--config-path":
        args.configPath = expandHome(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--agent":
        if (argv[index + 1]) {
          args.agentIds.push(argv[index + 1]);
          index += 1;
        }
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  args.configPath =
    args.configPath ?? expandHome(process.env.OPENCLAW_CONFIG_PATH ?? path.join(args.openclawHome, "openclaw.json"));
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/sync_openclaw_agent_models.mjs [options]",
      "",
      "Options:",
      "  --openclaw-home <dir>  OpenClaw home directory (default: ~/.openclaw)",
      "  --config-path <path>   openclaw.json path (default: $OPENCLAW_CONFIG_PATH or <home>/openclaw.json)",
      "  --agent <id>           Agent id to repair; repeatable. Defaults to all configured agents.",
      "  --dry-run              Report required repairs without writing files.",
      "  --json                 Emit JSON summary.",
    ].join("\n")
  );
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  const seen = new Set();
  const ordered = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function splitModelRef(modelRef) {
  if (typeof modelRef !== "string") {
    return null;
  }
  const trimmed = modelRef.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  return {
    provider: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
    ref: trimmed,
  };
}

function resolveAgentConfig(config, agentId) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list.find((entry) => entry && entry.id === agentId) ?? null;
}

function resolveConfiguredModelRefs(config, agentId) {
  const defaultsModel = config?.agents?.defaults?.model ?? {};
  const agentModel = resolveAgentConfig(config, agentId)?.model ?? {};
  const primary =
    typeof agentModel.primary === "string" && agentModel.primary.trim()
      ? agentModel.primary
      : defaultsModel.primary;
  const fallbacks = Array.isArray(agentModel.fallbacks)
    ? agentModel.fallbacks
    : Array.isArray(defaultsModel.fallbacks)
      ? defaultsModel.fallbacks
      : [];
  return uniqueStrings([primary, ...fallbacks]);
}

function resolveAgentDir(params) {
  const configured = resolveAgentConfig(params.config, params.agentId);
  if (typeof configured?.agentDir === "string" && configured.agentDir.trim()) {
    return expandHome(configured.agentDir.trim());
  }
  return path.join(params.openclawHome, "agents", params.agentId, "agent");
}

function ensureProviderEntry(targetProviders, providerId, sourceProvider) {
  if (!targetProviders[providerId]) {
    targetProviders[providerId] = clone(sourceProvider);
    return { created: true, filledFields: [], entry: targetProviders[providerId] };
  }

  const existing = targetProviders[providerId];
  const filledFields = [];
  for (const [key, value] of Object.entries(sourceProvider)) {
    if (key === "models") {
      continue;
    }
    if (!(key in existing)) {
      existing[key] = clone(value);
      filledFields.push(key);
    }
  }
  if (!Array.isArray(existing.models)) {
    existing.models = [];
  }
  return { created: false, filledFields, entry: existing };
}

function ensureModelsForProvider(params) {
  const result = {
    addedModelRefs: [],
    filledFields: [],
    missingRefs: [],
    changed: false,
  };
  const sourceProviders = params.config?.models?.providers ?? {};
  const providerGroups = new Map();

  for (const modelRef of params.modelRefs) {
    const parsed = splitModelRef(modelRef);
    if (!parsed) {
      result.missingRefs.push(modelRef);
      continue;
    }
    if (!providerGroups.has(parsed.provider)) {
      providerGroups.set(parsed.provider, []);
    }
    providerGroups.get(parsed.provider).push(parsed);
  }

  for (const [providerId, refs] of providerGroups.entries()) {
    const sourceProvider = sourceProviders[providerId];
    if (!sourceProvider || !Array.isArray(sourceProvider.models)) {
      result.missingRefs.push(...refs.map((entry) => entry.ref));
      continue;
    }

    const ensured = ensureProviderEntry(params.targetProviders, providerId, sourceProvider);
    if (ensured.created) {
      result.changed = true;
      result.addedModelRefs.push(...refs.map((entry) => entry.ref));
      continue;
    }

    if (ensured.filledFields.length > 0) {
      result.changed = true;
      result.filledFields.push(...ensured.filledFields.map((field) => `${providerId}.${field}`));
    }

    const existingModelIds = new Set(
      Array.isArray(ensured.entry.models)
        ? ensured.entry.models
            .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
            .filter(Boolean)
        : []
    );
    const sourceModelsById = new Map(
      sourceProvider.models
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => [entry.id, entry])
    );

    for (const ref of refs) {
      if (existingModelIds.has(ref.modelId)) {
        continue;
      }
      const sourceModel = sourceModelsById.get(ref.modelId);
      if (!sourceModel) {
        result.missingRefs.push(ref.ref);
        continue;
      }
      ensured.entry.models.push(clone(sourceModel));
      existingModelIds.add(ref.modelId);
      result.changed = true;
      result.addedModelRefs.push(ref.ref);
    }
  }

  result.addedModelRefs = uniqueStrings(result.addedModelRefs);
  result.filledFields = uniqueStrings(result.filledFields);
  result.missingRefs = uniqueStrings(result.missingRefs);
  return result;
}

export async function syncOpenClawAgentModels(params = {}) {
  const openclawHome = expandHome(
    params.openclawHome ?? process.env.OPENCLAW_HOME ?? `${process.env.HOME}/.openclaw`
  );
  const configPath = expandHome(
    params.configPath ?? process.env.OPENCLAW_CONFIG_PATH ?? path.join(openclawHome, "openclaw.json")
  );
  const config = await readJson(configPath);
  if (!config || typeof config !== "object") {
    throw new Error(`Failed to read openclaw config: ${configPath}`);
  }

  const configuredAgentIds = Array.isArray(config?.agents?.list)
    ? config.agents.list
        .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
        .filter(Boolean)
    : [];
  const agentIds = uniqueStrings(params.agentIds?.length ? params.agentIds : configuredAgentIds);
  const results = [];

  for (const agentId of agentIds) {
    const agentDir = resolveAgentDir({ config, openclawHome, agentId });
    const modelRefs = resolveConfiguredModelRefs(config, agentId);
    if (modelRefs.length === 0) {
      results.push({
        agentId,
        agentDir,
        status: "skipped",
        reason: "no configured model refs",
        addedModelRefs: [],
        filledFields: [],
        missingRefs: [],
      });
      continue;
    }

    const modelsPath = path.join(agentDir, "models.json");
    const existing =
      (await readJson(modelsPath, null)) ??
      {
        providers: {},
      };
    const target = {
      providers:
        existing && typeof existing === "object" && existing.providers && typeof existing.providers === "object"
          ? clone(existing.providers)
          : {},
    };
    const ensured = ensureModelsForProvider({
      config,
      targetProviders: target.providers,
      modelRefs,
    });

    if (!ensured.changed) {
      results.push({
        agentId,
        agentDir,
        status: ensured.missingRefs.length > 0 ? "skipped" : "noop",
        reason: ensured.missingRefs.length > 0 ? "missing provider models in openclaw.json" : null,
        addedModelRefs: [],
        filledFields: [],
        missingRefs: ensured.missingRefs,
      });
      continue;
    }

    const nextContents = `${JSON.stringify(target, null, 2)}\n`;
    if (!params.dryRun) {
      await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(modelsPath, nextContents, { mode: 0o600 });
    }

    results.push({
      agentId,
      agentDir,
      status: params.dryRun ? "dry-run" : "repaired",
      reason: null,
      addedModelRefs: ensured.addedModelRefs,
      filledFields: ensured.filledFields,
      missingRefs: ensured.missingRefs,
    });
  }

  return {
    openclawHome,
    configPath,
    results,
    counts: {
      total: results.length,
      repaired: results.filter((entry) => entry.status === "repaired").length,
      dryRun: results.filter((entry) => entry.status === "dry-run").length,
      noop: results.filter((entry) => entry.status === "noop").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
    },
  };
}

function formatEntry(entry) {
  if (entry.status === "noop") {
    return `NOOP ${entry.agentId}`;
  }
  if (entry.status === "skipped") {
    const suffix = entry.missingRefs.length > 0 ? ` missing=${entry.missingRefs.join(",")}` : "";
    return `SKIP ${entry.agentId} (${entry.reason ?? "skipped"})${suffix}`;
  }
  const verb = entry.status === "dry-run" ? "DRY-RUN" : "REPAIR";
  const details = [];
  if (entry.addedModelRefs.length > 0) {
    details.push(`added=${entry.addedModelRefs.join(",")}`);
  }
  if (entry.filledFields.length > 0) {
    details.push(`filled=${entry.filledFields.join(",")}`);
  }
  if (entry.missingRefs.length > 0) {
    details.push(`missing=${entry.missingRefs.join(",")}`);
  }
  return `${verb} ${entry.agentId}${details.length > 0 ? ` ${details.join(" ")}` : ""}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await syncOpenClawAgentModels({
    openclawHome: args.openclawHome,
    configPath: args.configPath,
    agentIds: args.agentIds,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const entry of summary.results) {
    console.log(formatEntry(entry));
  }
  console.log(
    `SUMMARY total=${summary.counts.total} repaired=${summary.counts.repaired} dryRun=${summary.counts.dryRun} noop=${summary.counts.noop} skipped=${summary.counts.skipped}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
