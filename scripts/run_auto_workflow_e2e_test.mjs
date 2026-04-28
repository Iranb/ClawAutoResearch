#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncOpenClawAgentModels } from "./sync_openclaw_agent_models.mjs";
import {
  appendLocalPapernexusArgs,
  resolveLocalPapernexusConfig,
} from "./local_papernexus_config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArgValue(argv, name, fallback = null) {
  const raw = argValue(argv, name, null);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeIntegerArgValue(argv, names, fallback = null) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = argValue(argv, name, null);
    if (raw === null) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function firstPositional(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current.startsWith("--")) {
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    return current;
  }
  return null;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "topic";
}

function expandHomePath(value) {
  const raw = String(value ?? "").trim();
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replace(/\.\d+Z$/, "Z");
}

function runIdSuffixFromTimestamp(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function defaultProjectIdForAutoWorkflowRun(params) {
  const command =
    typeof params?.command === "object" && params.command
      ? params.command
      : normalizeAutoWorkflowCommand(params?.command ?? "full");
  const topicSlug = slugify(params?.topic ?? "topic");
  const suffix = runIdSuffixFromTimestamp(params?.timestamp ?? timestampSlug());
  const lanePrefix = command.lane === "survey" ? "survey" : "research";
  return `${lanePrefix}-${suffix}-${topicSlug}`
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function normalizeAutoWorkflowCommand(value) {
  const token = normalizeToken(value || "full");
  if (["full", "both", "all"].includes(token)) {
    return {
      requestedCommand: value || "full",
      canonicalCommand: "full",
      displayCommand: "full",
      lane: "full",
    };
  }
  if (["autoresearch", "auto-research", "research", "experiment"].includes(token)) {
    return {
      requestedCommand: value || "/auto-research",
      canonicalCommand: "auto-research",
      displayCommand: "/auto-research",
      lane: "experiment",
    };
  }
  if (["autoreview", "auto-review", "review", "survey"].includes(token)) {
    return {
      requestedCommand: value || "/auto-review",
      canonicalCommand: "auto-review",
      displayCommand: "/auto-review",
      lane: "survey",
    };
  }
  throw new Error(
    `Unknown auto workflow command "${value}". Use /autoresearch, /auto-research, /autoreview, /auto-review, or full.`
  );
}

export function normalizeAutoWorkflowMode(value) {
  const token = normalizeToken(value || "live");
  if (["live", "real", "runtime"].includes(token)) {
    return "live";
  }
  if (["fixture", "deterministic", "mock", "regression"].includes(token)) {
    return "fixture";
  }
  throw new Error(`Unknown E2E mode "${value}". Use live/real or fixture/deterministic.`);
}

export function deriveAutoWorkflowChildMaxIterations(params) {
  const explicit = Number(params?.maxIterations);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  if (params?.mode !== "live") {
    return null;
  }
  const timeoutMs = Number(params?.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 90;
  }
  return Math.min(240, Math.max(24, Math.ceil(timeoutMs / 30_000)));
}

const CODE_REVIEW_LOCAL_FALLBACK_ENV = "OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS";
const AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_ENV =
  "OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS";
const DEFAULT_NO_DISCORD_E2E_LOCAL_FALLBACK_AFTER_MS = 30_000;

function parseNonNegativeInteger(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function shouldDefaultNoDiscordE2eLocalFallbacks(params) {
  return (
    params?.mode === "live" &&
    normalizeToken(params?.bootstrapTransport ?? "local") === "local"
  );
}

export function resolveAutoWorkflowLocalFallbackEnv(params, baseEnv = process.env) {
  const defaultAfterMs = shouldDefaultNoDiscordE2eLocalFallbacks(params)
    ? DEFAULT_NO_DISCORD_E2E_LOCAL_FALLBACK_AFTER_MS
    : null;
  const sharedExplicit = parseNonNegativeInteger(params?.workflowLocalFallbackAfterMs);
  const explicitCodeReview =
    parseNonNegativeInteger(params?.codeReviewLocalFallbackAfterMs) ?? sharedExplicit;
  const explicitDiscussion =
    parseNonNegativeInteger(params?.autoModeDiscussionLocalFallbackAfterMs) ?? sharedExplicit;

  const envOverrides = {};
  const resolveOne = (name, explicitValue) => {
    if (explicitValue !== null) {
      envOverrides[name] = String(explicitValue);
      return { value: explicitValue, source: "cli" };
    }
    const rawEnv = baseEnv?.[name];
    if (typeof rawEnv === "string" && rawEnv.trim() !== "") {
      const parsedEnv = parseNonNegativeInteger(rawEnv);
      if (parsedEnv !== null) {
        return { value: parsedEnv, source: "environment" };
      }
      if (defaultAfterMs !== null) {
        envOverrides[name] = String(defaultAfterMs);
        return { value: defaultAfterMs, source: "invalid_environment_default" };
      }
      return { value: null, source: "invalid_environment" };
    }
    if (defaultAfterMs !== null) {
      envOverrides[name] = String(defaultAfterMs);
      return { value: defaultAfterMs, source: "local_e2e_default" };
    }
    return { value: null, source: "unset" };
  };

  const codeReview = resolveOne(CODE_REVIEW_LOCAL_FALLBACK_ENV, explicitCodeReview);
  const autoModeDiscussion = resolveOne(
    AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_ENV,
    explicitDiscussion
  );

  return {
    envOverrides,
    summary: {
      defaultAfterMs,
      codeReviewFallbackAfterMs: codeReview.value,
      codeReviewSource: codeReview.source,
      autoModeDiscussionFallbackAfterMs: autoModeDiscussion.value,
      autoModeDiscussionSource: autoModeDiscussion.source,
      envKeys: {
        codeReview: CODE_REVIEW_LOCAL_FALLBACK_ENV,
        autoModeDiscussion: AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_ENV,
      },
    },
  };
}

export function configuredProjectsRootFromOpenClawConfig(config) {
  const candidates = [
    config?.projectsRoot,
    config?.projects_root,
    config?.workflow?.projectsRoot,
    config?.workflow?.projects_root,
    config?.plugins?.entries?.ClawAutoResearch?.config?.projectsRoot,
    config?.plugins?.entries?.ClawAutoResearch?.config?.projects_root,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

async function readConfiguredProjectsRoot(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    return configuredProjectsRootFromOpenClawConfig(parsed);
  } catch {
    return null;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
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

async function findExecutable(name) {
  const pathEntries = String(process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const candidates =
    process.platform === "win32"
      ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
      : [name];
  for (const directory of pathEntries) {
    for (const candidate of candidates) {
      const filePath = path.join(directory, candidate);
      try {
        await fs.access(filePath, fs.constants.X_OK);
        return filePath;
      } catch {}
    }
  }
  return null;
}

function splitListArg(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function resolveAutoWorkflowModelOverrideArg(argv) {
  const primary =
    argValue(argv, "--agent-model-primary", null) ??
    argValue(argv, "--agent-model-ref", null) ??
    argValue(argv, "--model-ref", null) ??
    argValue(argv, "--model", null);
  const fallbacks = splitListArg(
    argValue(argv, "--agent-model-fallbacks", null) ??
      argValue(argv, "--model-fallbacks", "")
  );
  const primaryRef = typeof primary === "string" && primary.trim() ? primary.trim() : null;
  if (!primaryRef && fallbacks.length === 0) {
    return {
      enabled: false,
      primary: null,
      fallbacks: [],
      requestedRefs: [],
    };
  }
  const invalidRefs = uniqueStrings([primaryRef, ...fallbacks]).filter(
    (entry) => entry && !splitModelRef(entry)
  );
  if (invalidRefs.length > 0) {
    throw new Error(
      `Invalid model ref ${invalidRefs.join(", ")}. Use provider/model, for example codex/gpt-5.4.`
    );
  }
  return {
    enabled: true,
    primary: primaryRef,
    fallbacks,
    requestedRefs: uniqueStrings([primaryRef, ...fallbacks]),
  };
}

function applyAutoWorkflowModelOverride(config, override) {
  const next = cloneJson(config);
  if (!override?.enabled) {
    return next;
  }
  const applyModelOverride = (modelConfig) => {
    const currentModel =
      modelConfig && typeof modelConfig === "object" ? modelConfig : {};
    const overridden = {
      ...currentModel,
      ...(override.primary ? { primary: override.primary } : {}),
    };
    if (override.primary || override.fallbacks.length > 0) {
      overridden.fallbacks = override.fallbacks;
    }
    return overridden;
  };
  next.agents = next.agents && typeof next.agents === "object" ? next.agents : {};
  next.agents.defaults =
    next.agents.defaults && typeof next.agents.defaults === "object"
      ? next.agents.defaults
      : {};
  next.agents.defaults.model = applyModelOverride(next.agents.defaults.model);
  if (Array.isArray(next.agents.list)) {
    next.agents.list = next.agents.list.map((agent) => {
      if (!agent || typeof agent !== "object") {
        return agent;
      }
      return {
        ...agent,
        model: applyModelOverride(agent.model),
      };
    });
  }
  return next;
}

function configuredAgentIds(config, extraAgentIds = []) {
  const fromConfig = Array.isArray(config?.agents?.list)
    ? config.agents.list
        .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
        .filter(Boolean)
    : [];
  return uniqueStrings([...extraAgentIds, ...fromConfig]);
}

function mergeProviderCatalogEntry(targetProvider, sourceProvider, requiredModelIds) {
  const nextProvider =
    targetProvider && typeof targetProvider === "object" ? targetProvider : {};
  const source = sourceProvider && typeof sourceProvider === "object" ? sourceProvider : {};
  let changed = false;

  for (const [key, value] of Object.entries(source)) {
    if (key === "models") {
      continue;
    }
    if (!(key in nextProvider) || nextProvider[key] === null || nextProvider[key] === "") {
      nextProvider[key] = cloneJson(value);
      changed = true;
    }
  }

  const existingModels = Array.isArray(nextProvider.models)
    ? nextProvider.models
    : [];
  if (!Array.isArray(nextProvider.models)) {
    nextProvider.models = existingModels;
    changed = true;
  }
  const existingModelIds = new Set(
    existingModels
      .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
      .filter(Boolean)
  );
  const sourceModels = Array.isArray(source.models) ? source.models : [];
  for (const modelId of requiredModelIds) {
    if (existingModelIds.has(modelId)) {
      continue;
    }
    const sourceModel = sourceModels.find((entry) => entry && entry.id === modelId);
    if (!sourceModel) {
      continue;
    }
    nextProvider.models.push(cloneJson(sourceModel));
    existingModelIds.add(modelId);
    changed = true;
  }

  return { provider: nextProvider, changed };
}

async function backfillModelOverrideProviderCatalogs(params) {
  const refs = params.modelRefs.map(splitModelRef).filter(Boolean);
  const byProvider = new Map();
  for (const ref of refs) {
    if (!byProvider.has(ref.provider)) {
      byProvider.set(ref.provider, new Set());
    }
    byProvider.get(ref.provider).add(ref.modelId);
  }
  if (byProvider.size === 0) {
    return [];
  }

  params.config.models =
    params.config.models && typeof params.config.models === "object" ? params.config.models : {};
  params.config.models.providers =
    params.config.models.providers && typeof params.config.models.providers === "object"
      ? params.config.models.providers
      : {};

  const agentIds = configuredAgentIds(params.config, params.agentIds);
  const backfilled = [];
  for (const [providerId, modelIds] of byProvider.entries()) {
    const currentProvider = params.config.models.providers[providerId];
    const currentModelIds = new Set(
      Array.isArray(currentProvider?.models)
        ? currentProvider.models
            .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
            .filter(Boolean)
        : []
    );
    const missingModelIds = [...modelIds].filter((modelId) => !currentModelIds.has(modelId));
    if (currentProvider && missingModelIds.length === 0) {
      continue;
    }

    let sourceProvider = null;
    let sourceAgentId = null;
    for (const agentId of agentIds) {
      const agentDir = resolveAgentDir(params.config, params.openclawHome, agentId);
      const modelsCatalog = await readJson(path.join(agentDir, "models.json"), null);
      const candidate = modelsCatalog?.providers?.[providerId];
      const candidateModels = new Set(
        Array.isArray(candidate?.models)
          ? candidate.models
              .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
              .filter(Boolean)
          : []
      );
      if ([...modelIds].every((modelId) => candidateModels.has(modelId))) {
        sourceProvider = candidate;
        sourceAgentId = agentId;
        break;
      }
    }
    if (!sourceProvider) {
      continue;
    }

    const merged = mergeProviderCatalogEntry(
      currentProvider,
      sourceProvider,
      [...modelIds]
    );
    if (merged.changed || !currentProvider) {
      params.config.models.providers[providerId] = merged.provider;
      backfilled.push({
        provider: providerId,
        models: [...modelIds],
        sourceAgentId,
      });
    }
  }
  return backfilled;
}

export async function materializeAutoWorkflowModelOverrideConfig(params) {
  if (!params.modelOverride?.enabled) {
    return {
      configPath: params.sourceConfigPath,
      summary: null,
      cleanup: async () => {},
    };
  }
  const sourceConfigPath = path.resolve(expandHomePath(params.sourceConfigPath));
  const sourceConfig = await readJson(sourceConfigPath, null);
  if (!sourceConfig || typeof sourceConfig !== "object") {
    throw new Error(`Failed to read OpenClaw config for model override: ${sourceConfigPath}`);
  }

  const openclawHome = resolveOpenClawHome(sourceConfigPath);
  const nextConfig = applyAutoWorkflowModelOverride(sourceConfig, params.modelOverride);
  const configuredRefs = uniqueStrings(
    params.modelOverride.requestedRefs.length > 0
      ? params.modelOverride.requestedRefs
      : configuredModelRefsForAgent(nextConfig, params.agentIds?.[0] ?? "researcher")
  );
  const backfilledProviders = await backfillModelOverrideProviderCatalogs({
    config: nextConfig,
    openclawHome,
    agentIds: params.agentIds ?? [],
    modelRefs: configuredRefs,
  });

  const tempConfigPath = path.join(
    openclawHome,
    `.openclaw-auto-workflow-${process.pid}-${Date.now()}.json`
  );
  await fs.writeFile(tempConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    mode: 0o600,
  });

  return {
    configPath: tempConfigPath,
    summary: {
      primary: params.modelOverride.primary,
      fallbacks:
        params.modelOverride.fallbacks.length > 0 ? params.modelOverride.fallbacks : null,
      requestedRefs: configuredRefs,
      sourceConfigPath,
      temporaryConfigPath: tempConfigPath,
      backfilledProviders,
    },
    cleanup: async () => {
      await fs.rm(tempConfigPath, { force: true });
    },
  };
}

function resolveOpenClawHome(configPath) {
  const expanded = expandHomePath(configPath);
  return path.dirname(path.resolve(expanded));
}

function resolveAgentConfig(config, agentId) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  return list.find((entry) => entry && entry.id === agentId) ?? null;
}

function resolveAgentDir(config, openclawHome, agentId) {
  const configured = resolveAgentConfig(config, agentId);
  if (typeof configured?.agentDir === "string" && configured.agentDir.trim()) {
    return expandHomePath(configured.agentDir.trim());
  }
  return path.join(openclawHome, "agents", agentId, "agent");
}

function readModelPrimaryRef(modelConfig) {
  if (typeof modelConfig === "string" && modelConfig.trim()) {
    return modelConfig;
  }
  return typeof modelConfig?.primary === "string" && modelConfig.primary.trim()
    ? modelConfig.primary
    : null;
}

function readModelFallbackRefs(modelConfig) {
  return Array.isArray(modelConfig?.fallbacks) ? modelConfig.fallbacks : [];
}

export function configuredModelRefsForAgent(config, agentId) {
  const defaultsModel = config?.agents?.defaults?.model ?? null;
  const agentModel = resolveAgentConfig(config, agentId)?.model ?? null;
  const primary =
    readModelPrimaryRef(agentModel) ?? readModelPrimaryRef(defaultsModel);
  return uniqueStrings([
    primary,
    ...readModelFallbackRefs(agentModel),
    ...readModelFallbackRefs(defaultsModel),
  ]);
}

function modelCatalogHasRef(modelsCatalog, parsedRef) {
  const provider = modelsCatalog?.providers?.[parsedRef.provider];
  if (!provider || typeof provider !== "object") {
    return false;
  }
  return Array.isArray(provider.models)
    ? provider.models.some((entry) => entry && entry.id === parsedRef.modelId)
    : false;
}

function providerHasInlineCredential(provider) {
  if (!provider || typeof provider !== "object") {
    return false;
  }
  return ["apiKey", "api_key", "token", "bearerToken", "bearer_token"].some(
    (key) => typeof provider[key] === "string" && provider[key].trim().length > 0
  );
}

function valueContainsProvider(value, provider) {
  const expected = String(provider).toLowerCase();
  if (typeof value === "string") {
    return value.trim().toLowerCase() === expected;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => valueContainsProvider(entry, provider));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase() === expected) {
      return true;
    }
    if (
      ["provider", "provider_id", "providerId", "type", "name"].includes(key) &&
      valueContainsProvider(entry, provider)
    ) {
      return true;
    }
    if (valueContainsProvider(entry, provider)) {
      return true;
    }
  }
  return false;
}

function credentialStatusForProvider(params) {
  const provider = params.modelsCatalog?.providers?.[params.providerId];
  if (providerHasInlineCredential(provider)) {
    return "inline";
  }
  if (params.authProfile && valueContainsProvider(params.authProfile, params.providerId)) {
    return "auth-profile";
  }
  for (const acceptedProvider of params.acceptedAuthProviders ?? []) {
    if (params.authProfile && valueContainsProvider(params.authProfile, acceptedProvider)) {
      return `auth-profile:${acceptedProvider}`;
    }
  }
  return "missing";
}

export function verifyAgentRuntimeModelConfig(params) {
  const modelRefs = configuredModelRefsForAgent(params.config, params.agentId);
  if (modelRefs.length === 0) {
    return {
      ok: false,
      detail: `${params.agentId}: no configured model refs in openclaw.json`,
    };
  }

  const missingModels = [];
  const missingCredentials = [];
  const credentialStatuses = [];

  for (const modelRef of modelRefs) {
    const parsed = splitModelRef(modelRef);
    if (!parsed) {
      missingModels.push(modelRef);
      continue;
    }
    if (!modelCatalogHasRef(params.modelsCatalog, parsed)) {
      missingModels.push(modelRef);
      continue;
    }
    const credentialStatus = credentialStatusForProvider({
      modelsCatalog: params.modelsCatalog,
      authProfile: params.authProfile,
      providerId: parsed.provider,
      acceptedAuthProviders: params.acceptedAuthProviders,
    });
    credentialStatuses.push(`${parsed.provider}:${credentialStatus}`);
    if (credentialStatus === "missing") {
      missingCredentials.push(parsed.provider);
    }
  }

  const ok = missingModels.length === 0 && missingCredentials.length === 0;
  const parts = [
    `${params.agentId}: configured=${modelRefs.join(",")}`,
    `agentDir=${params.agentDir}`,
  ];
  if (credentialStatuses.length > 0) {
    parts.push(`credentials=${uniqueStrings(credentialStatuses).join(",")}`);
  }
  if (missingModels.length > 0) {
    parts.push(`missing_models=${missingModels.join(",")}`);
  }
  if (missingCredentials.length > 0) {
    parts.push(`missing_credentials=${uniqueStrings(missingCredentials).join(",")}`);
  }
  return { ok, detail: parts.join(" ") };
}

export function shouldRestartGatewayAfterAgentModelSync(params) {
  return Boolean(
    params?.mode === "live" &&
      !params?.isolatedGateway &&
      !params?.skipAgentModelSync &&
      !params?.skipGatewayRestartAfterAgentSync &&
      Number(params?.repairedCount ?? 0) > 0
  );
}

export function shouldEnableAgentModelSyncWatchdog(params) {
  return Boolean(
    params?.mode === "live" &&
      !params?.isolatedGateway &&
      !params?.skipAgentModelSync &&
      !params?.noPreflight &&
      Number(params?.intervalMs ?? 0) > 0 &&
      Array.isArray(params?.agentIds) &&
      params.agentIds.length > 0
  );
}

async function runProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  const timeoutMs = options.timeoutMs ?? 0;
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdout.push(text);
    options.onStdout?.(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderr.push(text);
    options.onStderr?.(text);
  });

  const exit = await new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ code: 127, signal: null, error });
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, error: null });
    });
  });
  if (timer) {
    clearTimeout(timer);
  }
  return {
    code: timedOut ? 124 : exit.code,
    signal: exit.signal,
    error: exit.error,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    timedOut,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gatewayHealthUrlFromOpenClawConfig(config) {
  const gateway = config?.gateway ?? {};
  const host = gateway.bind === "loopback" ? "127.0.0.1" : gateway.host ?? "127.0.0.1";
  const port = gateway.port ?? 18789;
  return `http://${host}:${port}/health`;
}

async function waitForGatewayHealthFromConfig(config, timeoutMs = 30_000) {
  const healthUrl = gatewayHealthUrlFromOpenClawConfig(config);
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return { ok: true, detail: healthUrl };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  return {
    ok: false,
    detail: `${healthUrl}: ${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")}`,
  };
}

async function restartOpenClawGatewayAfterAgentSync(params) {
  if (!params.openclawPath) {
    return { ok: false, detail: "openclaw CLI not found" };
  }
  const restarted = await runProcess(params.openclawPath, ["gateway", "restart"], {
    timeoutMs: params.restartTimeoutMs ?? 90_000,
  });
  if (restarted.code !== 0) {
    const detail = (restarted.stderr || restarted.stdout || restarted.error?.message || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 500);
    return {
      ok: false,
      detail: `openclaw gateway restart failed exit=${restarted.code}${detail ? ` ${detail}` : ""}`,
    };
  }
  const health = await waitForGatewayHealthFromConfig(
    params.config,
    params.healthTimeoutMs ?? 30_000
  );
  return {
    ok: health.ok,
    detail: health.ok
      ? `openclaw gateway restart ok; health=${health.detail}`
      : `openclaw gateway restart ok; health failed ${health.detail}`,
  };
}

function startAgentModelSyncWatchdog(params) {
  const intervalMs = Math.max(0, Math.floor(Number(params.intervalMs ?? 0)));
  const status = {
    enabled: shouldEnableAgentModelSyncWatchdog({
      mode: params.mode,
      isolatedGateway: params.isolatedGateway,
      skipAgentModelSync: params.skipAgentModelSync,
      noPreflight: params.noPreflight,
      intervalMs,
      agentIds: params.agentIds,
    }),
    intervalMs,
    runs: 0,
    repaired: 0,
    noop: 0,
    skipped: 0,
    errors: [],
  };
  if (!status.enabled) {
    return {
      status,
      stop: async () => status,
    };
  }

  let stopped = false;
  let timer = null;
  let running = null;
  const openclawHome = resolveOpenClawHome(params.configPath);
  const recordError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    status.errors.push(message.slice(0, 500));
    if (status.errors.length > 5) {
      status.errors.shift();
    }
  };
  const runOnce = async () => {
    if (stopped || running) {
      return;
    }
    running = (async () => {
      try {
        const summary = await syncOpenClawAgentModels({
          openclawHome,
          configPath: params.configPath,
          agentIds: params.agentIds,
        });
        status.runs += 1;
        status.repaired += summary.counts.repaired;
        status.noop += summary.counts.noop;
        status.skipped += summary.counts.skipped;
      } catch (error) {
        status.runs += 1;
        recordError(error);
      } finally {
        running = null;
        if (!stopped) {
          timer = setTimeout(() => {
            void runOnce();
          }, intervalMs);
        }
      }
    })();
    await running;
  };

  void runOnce();
  return {
    status,
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      while (running) {
        await running;
      }
      return status;
    },
  };
}

function parseJsonPayload(rawText) {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function summarizeLane(name, value) {
  if (!value) {
    return null;
  }
  return {
    lane: name,
    transport: value.transport ?? null,
    conversationId: value.conversationId ?? null,
    projectRoot: value.projectRoot ?? null,
    finalVerdict: value.harness?.finalVerdict ?? null,
    strictContent: value.harness?.strictContent ?? null,
    failureReason: value.failureReason ?? value.harness?.failureReason ?? value.harness?.error ?? null,
    reportPath: value.harness?.reportPath ?? null,
    scorecardPath: value.harness?.scorecardPath ?? null,
    progressNarrativePath: value.harness?.progressNarrativePath ?? null,
    progressChartPath: value.harness?.progressChartPath ?? null,
    progressChartHtmlPath: value.harness?.progressChartHtmlPath ?? null,
    runLedgerPath: value.harness?.runLedgerPath ?? null,
    dashboardPath: value.harness?.dashboardPath ?? null,
    benchmarkAdapterScorecardPath: value.harness?.benchmarkAdapterScorecardPath ?? null,
    domainEvaluatorContractPath: value.harness?.domainEvaluatorContractPath ?? null,
    platformProfilePath: value.harness?.platformProfilePath ?? null,
    checklistPath: value.harness?.checklistPath ?? null,
    timelinePath: value.harness?.timelinePath ?? null,
    qualityScore100: value.harness?.qualityScore100 ?? value.harness?.scorecard?.quality_score?.score_100 ?? null,
    claimStrengthCap: value.harness?.claimStrengthCap ?? value.harness?.scorecard?.verdict?.claim_strength_cap ?? null,
    turnCount: Array.isArray(value.turns) ? value.turns.length : null,
    turns: Array.isArray(value.turns)
      ? value.turns.map((turn) => ({
          stage: turn.stage ?? null,
          owner: turn.owner ?? null,
          progressed: turn.progressed ?? null,
          progressReason: turn.progressReason ?? null,
        }))
      : [],
    handoffCount: Array.isArray(value.handoffs) ? value.handoffs.length : null,
  };
}

function summarizePayload(payload) {
  const result = payload?.result ?? {};
  const lanes = [
    summarizeLane("experiment", result.experiment),
    summarizeLane("survey", result.survey),
  ].filter(Boolean);
  return {
    topic: payload?.topic ?? null,
    projectId: payload?.projectId ?? payload?.project_id ?? null,
    lane: payload?.lane ?? null,
    mode: payload?.mode ?? null,
    bootstrapTransport: payload?.bootstrapTransport ?? null,
    conversationId: payload?.conversationId ?? null,
    projectsRoot: payload?.projectsRoot ?? null,
    lanes,
  };
}

function verdictStatus(summary, allowPartial) {
  if (!summary?.lanes?.length) {
    return "fail";
  }
  const verdicts = summary.lanes.map((lane) => lane.finalVerdict ?? "missing");
  if (verdicts.every((verdict) => verdict === "pass")) {
    return "pass";
  }
  if (allowPartial && verdicts.every((verdict) => verdict === "pass" || verdict === "partial")) {
    return "partial";
  }
  return "fail";
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function copyIfExists(sourcePath, destinationPath) {
  if (!(await pathExists(sourcePath))) {
    return false;
  }
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  return true;
}

async function collectProjectSnapshots(params) {
  const snapshots = [];
  const snapshotSpecs = [
    "PROJECT_MANIFEST.json",
    path.join("graph", "GRAPH_PRESENCE_CHECK.json"),
    path.join("graph", "PAPERNEXUS_STATUS.json"),
    path.join("graph", "PAPERNEXUS_PROGRESS.json"),
    path.join(".openclaw-research", "workflow-runtime-queue.json"),
    path.join(".openclaw-research", "workflow-runtime-sessions.json"),
    path.join(".openclaw-research", "workflow-mailbox.json"),
    path.join(".openclaw-research", "workflow-handoff-intents.json"),
    path.join(".openclaw-research", "workflow-diagnostics.jsonl"),
    path.join(".openclaw-research", "workflow-events.jsonl"),
  ];
  for (const lane of params.resultSummary.lanes ?? []) {
    if (!lane.projectRoot) {
      continue;
    }
    const laneSnapshotRoot = path.join(params.runRoot, "snapshots", lane.lane);
    const copied = [];
    for (const relativePath of snapshotSpecs) {
      const sourcePath = path.join(lane.projectRoot, relativePath);
      const destinationPath = path.join(laneSnapshotRoot, relativePath);
      if (await copyIfExists(sourcePath, destinationPath)) {
        copied.push(destinationPath);
      }
    }
    snapshots.push({
      lane: lane.lane,
      projectRoot: lane.projectRoot,
      snapshotRoot: laneSnapshotRoot,
      copied,
    });
  }
  return snapshots;
}

async function preflight(params) {
  const checks = [];
  const packageJsonPath = path.join(repoRoot, "package.json");
  checks.push({
    name: "repo_package_json",
    ok: await pathExists(packageJsonPath),
    detail: packageJsonPath,
  });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node_version",
    ok: Number.isFinite(nodeMajor) && nodeMajor >= 18,
    detail: process.versions.node,
  });

  if (params.mode === "live") {
    const openclawPath = await findExecutable("openclaw");
    checks.push({
      name: "openclaw_cli",
      ok: Boolean(openclawPath),
      detail: openclawPath ?? "not found in PATH",
    });
    if (params.isolatedGateway) {
      checks.push({
        name: "source_openclaw_config",
        ok: await pathExists(params.sourceConfigPath),
        detail: params.sourceConfigPath,
      });
    }
    if (!params.skipAgentAuthPreflight) {
      const openclawHome = resolveOpenClawHome(params.sourceConfigPath);
      const config = await readJson(params.sourceConfigPath, null);
      if (!config || typeof config !== "object") {
        checks.push({
          name: "openclaw_runtime_config",
          ok: false,
          detail: `failed to read ${params.sourceConfigPath}`,
        });
        return checks;
      }

      let syncSummary = null;
      if (!params.skipAgentModelSync) {
        try {
          syncSummary = await syncOpenClawAgentModels({
            openclawHome,
            configPath: params.sourceConfigPath,
            agentIds: params.agentAuthRoles,
          });
          const blocked = syncSummary.results.filter(
            (entry) => entry.status === "skipped" && entry.missingRefs?.length > 0
          );
          checks.push({
            name: "agent_model_sync",
            ok: blocked.length === 0,
            detail: `total=${syncSummary.counts.total} repaired=${syncSummary.counts.repaired} noop=${syncSummary.counts.noop} skipped=${syncSummary.counts.skipped}${blocked.length > 0 ? ` missing=${blocked.map((entry) => `${entry.agentId}:${entry.missingRefs.join(",")}`).join(";")}` : ""}`,
          });
        } catch (error) {
          checks.push({
            name: "agent_model_sync",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (
        shouldRestartGatewayAfterAgentModelSync({
          mode: params.mode,
          isolatedGateway: params.isolatedGateway,
          skipAgentModelSync: params.skipAgentModelSync,
          skipGatewayRestartAfterAgentSync: params.skipGatewayRestartAfterAgentSync,
          repairedCount: syncSummary?.counts?.repaired ?? 0,
        })
      ) {
        const restart = await restartOpenClawGatewayAfterAgentSync({
          openclawPath,
          config,
        });
        checks.push({
          name: "gateway_restart_after_agent_model_sync",
          ok: restart.ok,
          detail: restart.detail,
        });
        if (restart.ok) {
          try {
            const postRestartSync = await syncOpenClawAgentModels({
              openclawHome,
              configPath: params.sourceConfigPath,
              agentIds: params.agentAuthRoles,
            });
            const blocked = postRestartSync.results.filter(
              (entry) => entry.status === "skipped" && entry.missingRefs?.length > 0
            );
            checks.push({
              name: "agent_model_sync_after_gateway_restart",
              ok: blocked.length === 0,
              detail: `total=${postRestartSync.counts.total} repaired=${postRestartSync.counts.repaired} noop=${postRestartSync.counts.noop} skipped=${postRestartSync.counts.skipped}${blocked.length > 0 ? ` missing=${blocked.map((entry) => `${entry.agentId}:${entry.missingRefs.join(",")}`).join(";")}` : ""}`,
            });
          } catch (error) {
            checks.push({
              name: "agent_model_sync_after_gateway_restart",
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      for (const role of params.agentAuthRoles ?? []) {
        const agentDir = resolveAgentDir(config, openclawHome, role);
        const authProfilePath = path.join(agentDir, "auth-profiles.json");
        const modelsPath = path.join(agentDir, "models.json");
        const modelsCatalog = await readJson(modelsPath, null);
        const authProfile = await readJson(authProfilePath, null);
        const runtimeCheck = verifyAgentRuntimeModelConfig({
          config,
          agentId: role,
          agentDir,
          modelsCatalog,
          authProfile,
          acceptedAuthProviders: params.agentAuthProviders,
        });
        checks.push({
          name: `agent_runtime_model:${role}`,
          ok: runtimeCheck.ok,
          detail: runtimeCheck.detail,
        });
      }
    }
  }

  return checks;
}

function formatHumanSummary(summary) {
  const lines = [
    `Auto workflow E2E: ${summary.status}`,
    `command: ${summary.command.displayCommand}`,
    `topic: ${summary.topic}`,
    `project id: ${summary.projectId ?? "auto"}`,
    `mode: ${summary.mode}`,
    `conversation: ${summary.conversationId}`,
    `run root: ${summary.runRoot}`,
    `projects root: ${summary.projectsRoot}`,
    `summary: ${summary.summaryPath}`,
  ];
  if (summary.localPapernexus) {
    lines.push(
      `PaperNexus: ${summary.localPapernexus.accessMode} ${summary.localPapernexus.mcpUrl ?? summary.localPapernexus.apiBaseUrl ?? "unset"} token=${summary.localPapernexus.tokenProvidedBy}`
    );
  }
  if (summary.workflowLocalFallback) {
    lines.push(
      `local fallback: code-review=${summary.workflowLocalFallback.codeReviewFallbackAfterMs ?? "unset"}ms (${summary.workflowLocalFallback.codeReviewSource}), discussion=${summary.workflowLocalFallback.autoModeDiscussionFallbackAfterMs ?? "unset"}ms (${summary.workflowLocalFallback.autoModeDiscussionSource})`
    );
  }
  for (const lane of summary.result.lanes) {
    lines.push(
      "",
      `${lane.lane}: ${lane.finalVerdict ?? "missing"}`,
      `project: ${lane.projectRoot ?? "unknown"}`,
      `report: ${lane.reportPath ?? "unknown"}`,
      `scorecard: ${lane.scorecardPath ?? "unknown"}`,
      `progress chart: ${lane.progressChartHtmlPath ?? lane.progressChartPath ?? "unknown"}`,
      `dashboard: ${lane.dashboardPath ?? "unknown"}`,
      `run ledger: ${lane.runLedgerPath ?? "unknown"}`,
      `benchmark adapter: ${lane.benchmarkAdapterScorecardPath ?? "unknown"}`,
      `domain evaluator: ${lane.domainEvaluatorContractPath ?? "unknown"}`,
      `platform profile: ${lane.platformProfilePath ?? "unknown"}`,
      `claim cap: ${lane.claimStrengthCap ?? "unknown"}`,
      `quality score: ${lane.qualityScore100 ?? "unknown"}`
    );
    if (lane.turnCount !== null) {
      lines.push(`turns: ${lane.turnCount}`);
    }
    if (lane.handoffCount !== null) {
      lines.push(`handoffs: ${lane.handoffCount}`);
    }
    if (lane.failureReason) {
      lines.push(`lane failure: ${lane.failureReason}`);
    }
  }
  const failedPreflight = summary.preflight.filter((entry) => !entry.ok);
  if (failedPreflight.length > 0) {
    lines.push("", "preflight failures:");
    for (const check of failedPreflight) {
      lines.push(`- ${check.name}: ${check.detail}`);
    }
  }
  if (summary.snapshots?.length) {
    lines.push("", "snapshots:");
    for (const snapshot of summary.snapshots) {
      lines.push(`- ${snapshot.lane}: ${snapshot.snapshotRoot}`);
    }
  }
  if (summary.failureReason) {
    lines.push("", `failure: ${summary.failureReason}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv) {
  const command = normalizeAutoWorkflowCommand(
    argValue(argv, "--command", null) ?? firstPositional(argv) ?? "full"
  );
  const topic = argValue(argv, "--topic", "Generalized Category Discovery");
  const mode = normalizeAutoWorkflowMode(argValue(argv, "--mode", "live"));
  const bootstrapTransport = argValue(argv, "--bootstrap-transport", "local");
  const projectIdArg = argValue(argv, "--project-id", null);
  const profile = argValue(argv, "--profile", null);
  const sourceConfigPath =
    argValue(argv, "--source-config-path", null) ??
    (profile === "dev"
      ? path.join(os.homedir(), ".openclaw-dev", "openclaw.json")
      : path.join(os.homedir(), ".openclaw", "openclaw.json"));
  const jsonOutput = hasFlag(argv, "--json");
  const quiet = hasFlag(argv, "--quiet") || jsonOutput;
  const allowPartial = hasFlag(argv, "--allow-partial");
  const noPreflight = hasFlag(argv, "--no-preflight");
  const isolatedGateway = !hasFlag(argv, "--no-isolated-gateway");
  const configuredProjectsRoot =
    mode === "live" && !isolatedGateway ? await readConfiguredProjectsRoot(sourceConfigPath) : null;
  const timestamp = timestampSlug();
  const reuseProject = hasFlag(argv, "--reuse-project");
  const generatedProjectId =
    mode === "live" && !reuseProject && !projectIdArg
      ? defaultProjectIdForAutoWorkflowRun({ command, topic, timestamp })
      : null;
  const explicitProjectId = projectIdArg ?? generatedProjectId;
  const runRoot = path.resolve(
    argValue(
      argv,
      "--run-root",
      path.join(repoRoot, ".openclaw-research", "e2e-runs", `${timestamp}-${command.lane}-${slugify(topic)}`)
    )
  );
  const projectsRoot = path.resolve(
    expandHomePath(argValue(argv, "--projects-root", configuredProjectsRoot ?? path.join(runRoot, "projects")))
  );
  const conversationId = argValue(
    argv,
    "--conversation-id",
    `e2e-${timestamp}-${command.lane}-${slugify(topic)}`
  );
  const timeoutMs = numberArgValue(argv, "--timeout-ms", mode === "live" ? 45 * 60_000 : 5 * 60_000);
  const maxIterations = numberArgValue(argv, "--max-iterations", null);
  const childMaxIterations = deriveAutoWorkflowChildMaxIterations({
    mode,
    timeoutMs,
    maxIterations,
  });
  const gatewayStartupTimeoutMs = numberArgValue(argv, "--gateway-startup-timeout-ms", null);
  const bootstrapTimeoutMs = numberArgValue(argv, "--bootstrap-timeout-ms", null);
  const projectRootTimeoutMs = numberArgValue(argv, "--project-root-timeout-ms", null);
  const stageTimeoutMs = numberArgValue(argv, "--stage-timeout-ms", null);
  const agentWaitTimeoutMs = numberArgValue(argv, "--agent-wait-timeout-ms", null);
  const progressPollMs = numberArgValue(argv, "--progress-poll-ms", null);
  const maxNoProgressTurns = numberArgValue(argv, "--max-no-progress-turns", null);
  const workflowLocalFallbackAfterMs = nonNegativeIntegerArgValue(
    argv,
    "--workflow-local-fallback-after-ms",
    null
  );
  const codeReviewLocalFallbackAfterMs = nonNegativeIntegerArgValue(
    argv,
    ["--code-review-local-fallback-after-ms", "--local-review-fallback-after-ms"],
    null
  );
  const autoModeDiscussionLocalFallbackAfterMs = nonNegativeIntegerArgValue(
    argv,
    [
      "--auto-mode-discussion-local-fallback-after-ms",
      "--local-discussion-fallback-after-ms",
    ],
    null
  );
  const skipAgentAuthPreflight = hasFlag(argv, "--skip-agent-auth-preflight");
  const skipAgentModelSync = hasFlag(argv, "--skip-agent-model-sync");
  const skipGatewayRestartAfterAgentSync = hasFlag(
    argv,
    "--skip-gateway-restart-after-agent-sync"
  );
  const agentModelSyncIntervalMs = numberArgValue(
    argv,
    "--agent-model-sync-interval-ms",
    mode === "live" && !isolatedGateway ? 1_000 : 0
  );
  const agentAuthRoles = splitListArg(
    argValue(argv, "--agent-auth-roles", "researcher,analyzer,reviewer,academic_writer")
  );
  const agentAuthProviders = splitListArg(
    argValue(argv, "--agent-auth-providers", "")
  );
  const modelOverride = resolveAutoWorkflowModelOverrideArg(argv);
  if (modelOverride.enabled && !isolatedGateway) {
    throw new Error(
      "--agent-model-primary/--model-ref requires the default isolated gateway mode so the temporary OpenClaw config is actually used."
    );
  }
  const effectiveSourceConfig = await materializeAutoWorkflowModelOverrideConfig({
    sourceConfigPath,
    modelOverride,
    agentIds: agentAuthRoles,
  });
  const localPapernexus = await resolveLocalPapernexusConfig(argv);
  const workflowLocalFallback = resolveAutoWorkflowLocalFallbackEnv({
    mode,
    bootstrapTransport,
    workflowLocalFallbackAfterMs,
    codeReviewLocalFallbackAfterMs,
    autoModeDiscussionLocalFallbackAfterMs,
  });

  await fs.mkdir(runRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });

  const preflightChecks = noPreflight
    ? [{ name: "preflight", ok: true, detail: "skipped" }]
    : await preflight({
        mode,
        sourceConfigPath: effectiveSourceConfig.configPath,
        isolatedGateway,
        skipAgentAuthPreflight,
        skipAgentModelSync,
        skipGatewayRestartAfterAgentSync,
        agentAuthRoles,
        agentAuthProviders,
      });
  const preflightOk = preflightChecks.every((entry) => entry.ok);

  const childArgs = [
    path.join(repoRoot, "scripts", "run_auto_command_end_to_end.mjs"),
    "--topic",
    topic,
    "--lane",
    command.lane,
    "--mode",
    mode,
    "--bootstrap-transport",
    bootstrapTransport,
    "--conversation-id",
    conversationId,
    "--projects-root",
    projectsRoot,
  ];
  if (explicitProjectId) {
    childArgs.push("--project-id", explicitProjectId);
  }
  if (profile) {
    childArgs.push("--profile", profile);
  }
  if (effectiveSourceConfig.configPath) {
    childArgs.push("--source-config-path", effectiveSourceConfig.configPath);
  }
  const gatewayUrl = argValue(argv, "--gateway-url", null);
  const gatewayToken = argValue(argv, "--gateway-token", null);
  if (gatewayUrl) {
    childArgs.push("--gateway-url", gatewayUrl);
  }
  if (gatewayToken) {
    childArgs.push("--gateway-token", gatewayToken);
  }
  if (childMaxIterations !== null) {
    childArgs.push("--max-iterations", String(childMaxIterations));
  }
  if (gatewayStartupTimeoutMs !== null) {
    childArgs.push("--gateway-startup-timeout-ms", String(gatewayStartupTimeoutMs));
  }
  if (bootstrapTimeoutMs !== null) {
    childArgs.push("--bootstrap-timeout-ms", String(bootstrapTimeoutMs));
  }
  if (projectRootTimeoutMs !== null) {
    childArgs.push("--project-root-timeout-ms", String(projectRootTimeoutMs));
  }
  if (stageTimeoutMs !== null) {
    childArgs.push("--stage-timeout-ms", String(stageTimeoutMs));
  }
  if (agentWaitTimeoutMs !== null) {
    childArgs.push("--agent-wait-timeout-ms", String(agentWaitTimeoutMs));
  }
  if (progressPollMs !== null) {
    childArgs.push("--progress-poll-ms", String(progressPollMs));
  }
  if (maxNoProgressTurns !== null) {
    childArgs.push("--max-no-progress-turns", String(maxNoProgressTurns));
  }
  if (!isolatedGateway) {
    childArgs.push("--no-isolated-gateway");
  }
  appendLocalPapernexusArgs(argv, childArgs);

  const startedAt = new Date().toISOString();
  await writeText(
    path.join(runRoot, "command.txt"),
    [`node ${childArgs.map((part) => JSON.stringify(part)).join(" ")}`, ""].join("\n")
  );

  let child = {
    code: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    error: null,
  };
  let payload = null;
  let resultSummary = {
    topic,
    lane: command.lane,
    mode,
    projectId: explicitProjectId,
    bootstrapTransport,
    conversationId,
    projectsRoot,
    lanes: [],
  };
  let failureReason = null;
  let agentModelSyncWatchdog = {
    enabled: false,
    intervalMs: agentModelSyncIntervalMs,
    runs: 0,
    repaired: 0,
    noop: 0,
    skipped: 0,
    errors: [],
  };

  if (!preflightOk) {
    failureReason = "preflight_failed";
  } else {
    const watchdog = startAgentModelSyncWatchdog({
      mode,
      isolatedGateway,
      skipAgentModelSync,
      noPreflight,
      intervalMs: agentModelSyncIntervalMs,
      configPath: sourceConfigPath,
      agentIds: agentAuthRoles,
    });
    try {
      child = await runProcess(process.execPath, childArgs, {
        cwd: repoRoot,
        env: {
          ...localPapernexus.envOverrides,
          ...workflowLocalFallback.envOverrides,
        },
        timeoutMs,
        onStdout: quiet ? null : (text) => process.stdout.write(text),
        onStderr: quiet ? null : (text) => process.stderr.write(text),
      });
    } finally {
      agentModelSyncWatchdog = await watchdog.stop();
    }
    payload = parseJsonPayload(child.stdout);
    if (payload) {
      resultSummary = summarizePayload(payload);
      if (!resultSummary.projectId && explicitProjectId) {
        resultSummary.projectId = explicitProjectId;
      }
    }
    if (child.timedOut) {
      failureReason = "timeout";
    } else if (child.error) {
      failureReason = child.error.message;
    } else if (child.code !== 0) {
      failureReason = `child_exit_${child.code}`;
    } else if (!payload) {
      failureReason = "missing_json_payload";
    }
  }

  let modelOverrideSummary = effectiveSourceConfig.summary;
  if (modelOverrideSummary) {
    try {
      await effectiveSourceConfig.cleanup();
      modelOverrideSummary = {
        ...modelOverrideSummary,
        temporaryConfigRemoved: true,
      };
    } catch (error) {
      modelOverrideSummary = {
        ...modelOverrideSummary,
        temporaryConfigRemoved: false,
        cleanupError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const status =
    failureReason === null
      ? verdictStatus(resultSummary, allowPartial)
      : "fail";
  if (status === "fail" && failureReason === null) {
    const laneFailures = resultSummary.lanes
      .map((lane) => lane.failureReason)
      .filter(Boolean);
    failureReason = laneFailures.length > 0
      ? laneFailures.join("; ")
      : "final_verdict_not_pass";
  }

  const finishedAt = new Date().toISOString();
  const summaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.json");
  const markdownSummaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.md");
  const snapshots = await collectProjectSnapshots({ runRoot, resultSummary });
  const summary = {
    status,
    failureReason,
    startedAt,
    finishedAt,
    command,
    topic,
    projectId: resultSummary.projectId ?? explicitProjectId,
    mode,
    bootstrapTransport,
    conversationId,
    runRoot,
    projectsRoot,
    preflight: preflightChecks,
    agentModelSyncWatchdog,
    child: {
      code: child.code,
      signal: child.signal ?? null,
      timedOut: child.timedOut,
    },
    result: resultSummary,
    snapshots,
    snapshotRoot: path.join(runRoot, "snapshots"),
    summaryPath,
    markdownSummaryPath,
    stdoutPath: path.join(runRoot, "stdout.log"),
    stderrPath: path.join(runRoot, "stderr.log"),
    payloadPath: path.join(runRoot, "payload.json"),
    localPapernexus: localPapernexus.summary,
    workflowLocalFallback: workflowLocalFallback.summary,
    modelOverride: modelOverrideSummary,
  };

  await Promise.all([
    writeText(summary.stdoutPath, child.stdout ?? ""),
    writeText(summary.stderrPath, child.stderr ?? ""),
    writeText(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
    writeText(summary.payloadPath, payload ? `${JSON.stringify(payload, null, 2)}\n` : "null\n"),
    writeText(markdownSummaryPath, formatHumanSummary(summary)),
  ]);

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanSummary(summary));
  }

  if (status === "fail") {
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
