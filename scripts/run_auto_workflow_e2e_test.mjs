#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildE2EProjectsDashboard } from "./build-e2e-project-dashboard.mjs";
import { syncOpenClawAgentModels } from "./sync_openclaw_agent_models.mjs";
import {
  appendLocalPapernexusArgs,
  resolveLocalPapernexusConfig,
} from "./local_papernexus_config.mjs";
import { buildWorkflowTransportContext } from "./workflow_transport_context.mjs";

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

function formatUsage() {
  return [
    "Usage: node scripts/run_auto_workflow_e2e_test.mjs [command] [options]",
    "",
    "Commands:",
    "  full                  Run both /auto-research and /auto-review lanes.",
    "  /auto-research        Run the experiment research lane.",
    "  /auto-review          Run the survey/review lane.",
    "",
    "Options:",
    "  --mode live|fixture   Select live OpenClaw runtime or deterministic fixture mode.",
    "  --topic <text>        Research topic.",
    "  --projects-root <dir> Project root for generated workflow projects.",
    "  --project-id <id>     Explicit project id.",
    "  --reuse-project       Use the configured projects root instead of a run-local one.",
    "  --timeout-ms <ms>     Overall child-run timeout.",
    "  --max-iterations <n>  Live auto-iterator budget.",
    "  --bootstrap-transport local|discord",
    "                         local-live debug path or Discord native-slash parity path.",
    "  --papernexus-use-ssh-tunnel",
    "                         Tunnel --papernexus-mcp-url through --papernexus-ssh-target.",
    "  --papernexus-ssh-tunnel-port <port>",
    "                         Local port for the PaperNexus SSH tunnel.",
    "  --strict-content      Enforce publication-depth content quality checks in the paper harness.",
    "  --allow-partial       Treat partial live progress as a reportable outcome.",
    "  --json                Print the summary JSON.",
    "  --help, -h            Show this help text without starting a run.",
    "",
  ].join("\n");
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

export function normalizeAutoWorkflowBootstrapTransport(value) {
  const token = normalizeToken(value || "local");
  if (["local", "local-live", "no-discord"].includes(token)) {
    return "local";
  }
  if (["discord", "discord-parity", "native-slash", "slash"].includes(token)) {
    return "discord";
  }
  throw new Error(
    `Unknown bootstrap transport "${value}". Use local/local-live or discord/discord-parity.`
  );
}

export function shouldAutoGenerateLiveProjectId(params) {
  return Boolean(
    params?.mode === "live" &&
      normalizeAutoWorkflowBootstrapTransport(params?.bootstrapTransport ?? "local") === "local" &&
      !params?.reuseProject &&
      !params?.projectIdArg
  );
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
    normalizeAutoWorkflowBootstrapTransport(params?.bootstrapTransport ?? "local") === "local"
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
  const entries =
    config?.plugins?.entries && typeof config.plugins.entries === "object"
      ? config.plugins.entries
      : {};
  const pluginEntry =
    entries.ClawAutoResearch ??
    entries["claw-auto-research"] ??
    entries.openclawResearch ??
    entries["openclaw-research"] ??
    null;
  const pluginConfig =
    pluginEntry?.config && typeof pluginEntry.config === "object"
      ? pluginEntry.config
      : pluginEntry && typeof pluginEntry === "object"
        ? pluginEntry
        : {};
  const candidates = [
    pluginConfig?.projectsRoot,
    pluginConfig?.projects_root,
    config?.projectsRoot,
    config?.projects_root,
    config?.workflow?.projectsRoot,
    config?.workflow?.projects_root,
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

export async function resolveAutoWorkflowProjectsRoot(params) {
  const explicitProjectsRoot =
    typeof params?.projectsRoot === "string" && params.projectsRoot.trim()
      ? params.projectsRoot
      : null;
  if (explicitProjectsRoot) {
    return path.resolve(expandHomePath(explicitProjectsRoot));
  }
  const fallbackRoot = path.resolve(expandHomePath(params?.fallback ?? process.cwd()));
  if (params?.mode === "live" && params?.isolatedGateway === true && !params?.reuseProject) {
    return fallbackRoot;
  }
  if (params?.mode === "live" && params?.sourceConfigPath) {
    const configuredProjectsRoot = await readConfiguredProjectsRoot(params.sourceConfigPath);
    if (configuredProjectsRoot) {
      return path.resolve(expandHomePath(configuredProjectsRoot));
    }
  }
  return fallbackRoot;
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

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function safeUrlForDetail(value) {
  const raw = readString(value);
  if (!raw) {
    return "unset";
  }
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|auth|credential|password/i.test(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return "invalid_url";
  }
}

function envPresenceDetail(env, names) {
  return names
    .map((name) => `${name}=${readString(env?.[name]) ? "set" : "unset"}`)
    .join(" ");
}

function resolveGatewayTokenSource(params) {
  if (readString(params.gatewayToken)) {
    return "cli";
  }
  if (readString(params.env?.OPENCLAW_GATEWAY_TOKEN)) {
    return "environment";
  }
  if (readString(params.config?.gateway?.auth?.token)) {
    return "config";
  }
  return "missing";
}

function resolvePapernexusTokenValue(localPapernexus, env) {
  const tokenEnv =
    readString(localPapernexus?.summary?.tokenEnv) ??
    readString(localPapernexus?.pluginOverrides?.papernexusApiTokenEnv);
  if (!tokenEnv) {
    return null;
  }
  return (
    readString(localPapernexus?.envOverrides?.[tokenEnv]) ??
    readString(env?.[tokenEnv]) ??
    null
  );
}

async function probeHttpReachability(params) {
  const url = readString(params.url);
  if (!url) {
    return { ok: false, detail: "endpoint=unset" };
  }
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, detail: "fetch=unavailable" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(params.timeoutMs) ? params.timeoutMs : 2500
  );
  const headers = {};
  const token = readString(params.token);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return {
      ok: response.status < 500,
      detail: `endpoint=${safeUrlForDetail(url)} status=${response.status}`,
    };
  } catch (error) {
    const reason =
      error?.name === "AbortError"
        ? "timeout"
        : readString(error?.code) ?? readString(error?.name) ?? "error";
    return {
      ok: false,
      detail: `endpoint=${safeUrlForDetail(url)} error=${reason}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPapernexusSshTunnelCommand(localPapernexus) {
  const tunnel = localPapernexus?.summary?.sshTunnel;
  if (!tunnel?.enabled) {
    return null;
  }
  const sshTarget = readString(tunnel.sshTarget);
  const localHost = readString(tunnel.localHost) ?? "127.0.0.1";
  const remoteHost = readString(tunnel.remoteHost);
  const localPort = Number(tunnel.localPort);
  const remotePort = Number(tunnel.remotePort);
  if (
    !sshTarget ||
    !remoteHost ||
    !Number.isFinite(localPort) ||
    localPort <= 0 ||
    !Number.isFinite(remotePort) ||
    remotePort <= 0
  ) {
    return {
      ok: false,
      command: "ssh",
      args: [],
      detail: "invalid PaperNexus SSH tunnel config",
    };
  }
  const forwarding = `${localHost}:${Math.floor(localPort)}:${remoteHost}:${Math.floor(remotePort)}`;
  return {
    ok: true,
    command: "ssh",
    args: [
      "-N",
      "-L",
      forwarding,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      sshTarget,
    ],
    detail: `${forwarding} via ${sshTarget}`,
  };
}

async function startPapernexusSshTunnel(localPapernexus) {
  const tunnelCommand = buildPapernexusSshTunnelCommand(localPapernexus);
  if (!tunnelCommand) {
    return { enabled: false, check: null, child: null };
  }
  if (!tunnelCommand.ok) {
    return {
      enabled: true,
      check: {
        name: "papernexus_ssh_tunnel",
        ok: false,
        detail: tunnelCommand.detail,
      },
      child: null,
    };
  }
  let stderr = "";
  const child = spawn(tunnelCommand.command, tunnelCommand.args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const cleanup = () => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  };
  process.once("exit", cleanup);
  const started = await new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    child.once("error", (error) => {
      done({
        ok: false,
        detail: `ssh spawn failed: ${readString(error?.message) ?? "unknown"}`,
      });
    });
    child.once("exit", (code, signal) => {
      done({
        ok: false,
        detail: `ssh tunnel exited before ready code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderr.slice(0, 300)}`,
      });
    });
    setTimeout(() => {
      done({ ok: true, detail: tunnelCommand.detail });
    }, 750);
  });
  return {
    enabled: true,
    check: {
      name: "papernexus_ssh_tunnel",
      ok: started.ok,
      detail: started.detail,
    },
    child: started.ok ? child : null,
  };
}

async function stopPapernexusSshTunnel(tunnel) {
  const child = tunnel?.child;
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function collectAutoWorkflowEnvironmentPreflight(params = {}) {
  const env = params.env ?? process.env;
  const root = params.repoRoot ?? repoRoot;
  const checks = [];
  const packageJsonPath = path.join(root, "package.json");
  const packageLockPath = path.join(root, "package-lock.json");
  const nodeModulesPath = path.join(root, "node_modules");
  const typescriptPackagePath = path.join(nodeModulesPath, "typescript", "package.json");
  const [packageJsonExists, packageLockExists, nodeModulesExists, typescriptExists] =
    await Promise.all([
      pathExists(packageJsonPath),
      pathExists(packageLockPath),
      pathExists(nodeModulesPath),
      pathExists(typescriptPackagePath),
    ]);
  checks.push({
    name: "repo_package_json",
    ok: packageJsonExists,
    detail: packageJsonPath,
  });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node_version",
    ok: Number.isFinite(nodeMajor) && nodeMajor >= 18,
    detail: process.versions.node,
  });
  checks.push({
    name: "node_dependencies",
    ok: params.mode !== "live" || (nodeModulesExists && packageLockExists && typescriptExists),
    detail: `required=${params.mode === "live"} node_modules=${nodeModulesExists ? "present" : "missing"} package_lock=${packageLockExists ? "present" : "missing"} typescript=${typescriptExists ? "present" : "missing"}`,
  });
  checks.push({
    name: "runtime_env",
    ok: Boolean(readString(env.HOME) && readString(env.PATH)),
    detail: envPresenceDetail(env, [
      "HOME",
      "PATH",
      "OPENCLAW_GATEWAY_TOKEN",
      "PAPERNEXUS_API_TOKEN",
      "PAPERNEXUS_CORPUS",
    ]),
  });

  const localPapernexus = params.localPapernexus ?? {};
  const paperSummary = localPapernexus.summary ?? null;
  if (localPapernexus.enabled && paperSummary) {
    const endpoint = readString(paperSummary.mcpUrl) ?? readString(paperSummary.apiBaseUrl);
    const tokenProvidedBy = readString(paperSummary.tokenProvidedBy) ?? "missing";
    checks.push({
      name: "papernexus_config",
      ok: Boolean(endpoint),
      detail: `enabled accessMode=${paperSummary.accessMode ?? "unset"} endpoint=${safeUrlForDetail(endpoint)} token=${tokenProvidedBy} corpus=${paperSummary.corpusProvidedBy ?? "missing"} sshTarget=${readString(paperSummary.sshTarget) ? "set" : "unset"} remoteStagingRoot=${readString(paperSummary.remoteStagingRoot) ? "set" : "unset"}`,
    });
    if (endpoint) {
      const reachability = await probeHttpReachability({
        url: endpoint,
        token: resolvePapernexusTokenValue(localPapernexus, env),
        timeoutMs: params.papernexusProbeTimeoutMs,
        fetchImpl: params.fetchImpl,
      });
      checks.push({
        name: "papernexus_reachability",
        ok: reachability.ok,
        detail: reachability.detail,
      });
    }
  } else {
    checks.push({
      name: "papernexus_config",
      ok: true,
      detail: "not_requested_by_e2e_override",
    });
  }

  if (params.mode === "live") {
    const bootstrapTransport = normalizeAutoWorkflowBootstrapTransport(
      params.bootstrapTransport ?? "local"
    );
    const config = await readJson(params.sourceConfigPath, {});
    const tokenSource = resolveGatewayTokenSource({
      gatewayToken: params.gatewayToken,
      env,
      config,
    });
    if (bootstrapTransport === "discord" && !params.isolatedGateway) {
      checks.push({
        name: "discord_readiness",
        ok: tokenSource !== "missing",
        detail: `transport=discord isolated_gateway=false gateway_token_source=${tokenSource}`,
      });
    } else if (bootstrapTransport === "discord") {
      checks.push({
        name: "discord_readiness",
        ok: true,
        detail: "transport=discord isolated_gateway=true native_slash_replay=true external_discord_token=not_required",
      });
    } else {
      checks.push({
        name: "discord_readiness",
        ok: true,
        detail: "transport=local not_required",
      });
    }
  }

  return checks;
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

function profileExists(authProfile, profileId) {
  if (typeof profileId !== "string" || !profileId.trim()) {
    return false;
  }
  const profile = authProfile?.profiles?.[profileId.trim()];
  return Boolean(
    profile &&
      typeof profile === "object" &&
      !Array.isArray(profile) &&
      Object.keys(profile).length > 0
  );
}

function authStateLastGoodProfileForProvider(authState, providerId) {
  if (typeof providerId !== "string" || !providerId.trim()) {
    return null;
  }
  const profileId = authState?.lastGood?.[providerId.trim()];
  return typeof profileId === "string" && profileId.trim() ? profileId.trim() : null;
}

function credentialStatusForProvider(params) {
  const provider = params.modelsCatalog?.providers?.[params.providerId];
  if (providerHasInlineCredential(provider)) {
    return "inline";
  }
  if (params.authProfile && valueContainsProvider(params.authProfile, params.providerId)) {
    return "auth-profile";
  }
  const lastGoodProfileId = authStateLastGoodProfileForProvider(
    params.authState,
    params.providerId
  );
  if (lastGoodProfileId && profileExists(params.authProfile, lastGoodProfileId)) {
    return `auth-state:${lastGoodProfileId}`;
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
      authState: params.authState,
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
  const finalTurn = Array.isArray(value.turns) ? value.turns.at(-1) : null;
  const finalManifest = finalTurn?.manifest ?? value.manifest ?? value.finalManifest ?? null;
  const workflowControl =
    finalManifest?.workflow_control && typeof finalManifest.workflow_control === "object"
      ? finalManifest.workflow_control
      : null;
  return {
    lane: name,
    transport: value.transport ?? null,
    conversationId: value.conversationId ?? null,
    projectRoot: value.projectRoot ?? null,
    bootstrapSessionKey: value.bootstrap?.sessionKey ?? null,
    bootstrapRunId: value.bootstrap?.runId ?? null,
    bootstrapFallbackTransport: value.bootstrap?.fallbackTransport ?? null,
    finalVerdict: value.harness?.finalVerdict ?? null,
    strictContent: value.harness?.strictContent ?? null,
    failureReason: value.failureReason ?? value.harness?.failureReason ?? value.harness?.error ?? null,
    reportPath: value.harness?.reportPath ?? null,
    scorecardPath: value.harness?.scorecardPath ?? null,
    progressNarrativePath: value.harness?.progressNarrativePath ?? null,
    progressChartPath: value.harness?.progressChartPath ?? null,
    progressChartHtmlPath: value.harness?.progressChartHtmlPath ?? null,
    runLedgerPath: value.harness?.runLedgerPath ?? null,
    runTrendPath: value.harness?.runTrendPath ?? null,
    dashboardPath: value.harness?.dashboardPath ?? null,
    benchmarkAdapterScorecardPath: value.harness?.benchmarkAdapterScorecardPath ?? null,
    domainEvaluatorContractPath: value.harness?.domainEvaluatorContractPath ?? null,
    reviewerCalibrationPath: value.harness?.reviewerCalibrationPath ?? null,
    copyeditStyleAuditPath: value.harness?.copyeditStyleAuditPath ?? null,
    experimentLeaseContractPath: value.harness?.experimentLeaseContractPath ?? null,
    platformProfilePath: value.harness?.platformProfilePath ?? null,
    checklistPath: value.harness?.checklistPath ?? null,
    timelinePath: value.harness?.timelinePath ?? null,
    qualityScore100: value.harness?.qualityScore100 ?? value.harness?.scorecard?.quality_score?.score_100 ?? null,
    claimStrengthCap: value.harness?.claimStrengthCap ?? value.harness?.scorecard?.verdict?.claim_strength_cap ?? null,
    finalStage:
      finalManifest?.current_stage ?? workflowControl?.stage ?? null,
    finalOwner:
      finalManifest?.owner_agent ?? workflowControl?.owner ?? null,
    nextAction:
      finalManifest?.next_action ?? workflowControl?.nextAction ?? workflowControl?.next_action ?? null,
    blockingReason:
      finalManifest?.blocking_reason ??
      workflowControl?.blockingReason ??
      workflowControl?.blocking_reason ??
      null,
    workflowControl: workflowControl
      ? {
          stage: workflowControl.stage ?? null,
          owner: workflowControl.owner ?? null,
          nextAction: workflowControl.nextAction ?? workflowControl.next_action ?? null,
          blockingReason:
            workflowControl.blockingReason ?? workflowControl.blocking_reason ?? null,
          completionStatus:
            workflowControl.completionStatus ?? workflowControl.completion_status ?? null,
          runtimeState: workflowControl.runtimeState ?? workflowControl.runtime_state ?? null,
          contractSource: workflowControl.contractSource ?? workflowControl.contract_source ?? null,
        }
      : null,
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

function compactLaneTrace(lane) {
  const turns = Array.isArray(lane.turns) ? lane.turns : [];
  const progressedTurnCount = turns.filter((turn) => turn.progressed === true).length;
  return {
    lane: lane.lane,
    transport: lane.transport,
    projectRoot: lane.projectRoot,
    finalVerdict: lane.finalVerdict,
    failureReason: lane.failureReason,
    finalStage: lane.finalStage,
    finalOwner: lane.finalOwner,
    nextAction: lane.nextAction,
    blockingReason: lane.blockingReason,
    workflowControl: lane.workflowControl,
    turnCount: lane.turnCount,
    progressedTurnCount,
    lastTurn: turns.at(-1) ?? null,
    handoffCount: lane.handoffCount,
    qualityScore100: lane.qualityScore100,
    claimStrengthCap: lane.claimStrengthCap,
  };
}

export function buildAutoWorkflowTraceEvalScorecard(params) {
  const resultSummary = params?.resultSummary ?? {};
  const lanes = Array.isArray(resultSummary.lanes) ? resultSummary.lanes : [];
  const preflight = Array.isArray(params?.preflight) ? params.preflight : [];
  const failedPreflight = preflight.filter((entry) => entry?.ok === false);
  return {
    generatedAt: params?.generatedAt ?? new Date().toISOString(),
    status: params?.status ?? null,
    failureReason: params?.failureReason ?? null,
    command: params?.command?.displayCommand ?? params?.command?.canonicalCommand ?? null,
    topic: params?.topic ?? null,
    mode: params?.mode ?? null,
    bootstrapTransport: params?.bootstrapTransport ?? null,
    preflight: {
      passed: failedPreflight.length === 0,
      failed: failedPreflight.map((entry) => ({
        name: entry.name,
        detail: entry.detail,
      })),
      totalCount: preflight.length,
      failedCount: failedPreflight.length,
    },
    transportParity: params?.transportParity ?? null,
    runtimeCloseout: params?.runtimeCloseout ?? null,
    lanes: lanes.map(compactLaneTrace),
  };
}

function readManifestStageStatus(manifest, snakeName, camelName = snakeName) {
  const snake = manifest?.[snakeName];
  const camel = manifest?.[camelName];
  const value = snake && typeof snake === "object" ? snake : camel;
  if (!value || typeof value !== "object") {
    return null;
  }
  return value.status ?? value.stage ?? value.verdict ?? null;
}

function readQueuedPaperIngestionRequests(manifest) {
  const paperIngestion = readRecord(manifest?.paper_ingestion) ?? readRecord(manifest?.paperIngestion);
  const queuedRequests = paperIngestion?.queued_requests ?? paperIngestion?.queuedRequests;
  return Array.isArray(queuedRequests) ? queuedRequests.filter((entry) => readRecord(entry)) : [];
}

function isWorkflowOwnedLiteratureRequisition(request) {
  const requestKind = readString(request.request_kind ?? request.requestKind);
  const triggerKind = readString(request.trigger_kind ?? request.triggerKind);
  const category = readString(request.category);
  const manifestPath = readString(request.manifest_path ?? request.manifestPath);
  const commandText = readString(request.command_text ?? request.commandText);
  return Boolean(
    requestKind === "requisition" ||
      category === "literature_discovery" ||
      /literature|idea_catalyst|investigation_requisition/i.test(triggerKind ?? "") ||
      /INVESTIGATION_REQUISITION\.json|literature-discovery/i.test(manifestPath ?? "") ||
      /literature_discovery|schedule_papernexus_import/i.test(commandText ?? "")
  );
}

function readQueueProgressSummary(request) {
  const queueProgress = readRecord(request.queue_progress) ?? readRecord(request.queueProgress) ?? {};
  return {
    sequence: readNumber(queueProgress.sequence ?? queueProgress.seq),
    lastEventAt:
      readString(queueProgress.last_event_at) ??
      readString(queueProgress.lastEventAt) ??
      readString(queueProgress.updated_at) ??
      readString(queueProgress.updatedAt),
    remaining: readNumber(queueProgress.remaining),
    completed: readNumber(queueProgress.completed),
    failed: readNumber(queueProgress.failed),
    overallPercent: readNumber(queueProgress.overall_percent ?? queueProgress.overallPercent),
  };
}

function queueProgressHasRemoteEvidence(queueProgress) {
  return Boolean(
    queueProgress.sequence !== null ||
      queueProgress.lastEventAt ||
      queueProgress.remaining !== null ||
      queueProgress.completed !== null ||
      queueProgress.failed !== null ||
      queueProgress.overallPercent !== null
  );
}

function selectLatestLiteratureRequisition(manifest) {
  const requests = readQueuedPaperIngestionRequests(manifest).filter(
    isWorkflowOwnedLiteratureRequisition
  );
  if (requests.length === 0) {
    return null;
  }
  return requests
    .map((request, index) => ({
      request,
      index,
      timestamp:
        Date.parse(
          readString(request.updated_at ?? request.updatedAt) ??
            readString(request.started_at ?? request.startedAt) ??
            readString(request.created_at ?? request.createdAt) ??
            ""
        ) || 0,
    }))
    .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)[0]
    .request;
}

function parsePaperSourceIndexEntries(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => readRecord(entry));
  }
  const record = readRecord(raw);
  if (!record) {
    return [];
  }
  for (const key of ["papers", "entries", "items", "sources", "canonical_papers", "canonicalPapers"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry) => readRecord(entry));
    }
    const nested = readRecord(value);
    if (nested) {
      return Object.values(nested).filter((entry) => readRecord(entry));
    }
  }
  return Object.values(record).filter((entry) => readRecord(entry));
}

function isSourceBackedPaperEntry(entry) {
  const sourcePath =
    readString(entry.source_path) ??
    readString(entry.sourcePath) ??
    readString(entry.local_path) ??
    readString(entry.localPath);
  if (sourcePath) {
    return true;
  }
  const sourceKind = (
    readString(entry.source_kind) ??
    readString(entry.sourceKind) ??
    ""
  ).toLowerCase();
  if (["markdown", "md", "pdf", "html", "xml"].includes(sourceKind)) {
    return true;
  }
  const sourceProvider = (
    readString(entry.source_provider) ??
    readString(entry.sourceProvider) ??
    ""
  ).toLowerCase();
  return Boolean(
    sourceProvider &&
      !["metadata", "metadata_only", "remote_corpus_summary", "unknown"].includes(sourceProvider)
  );
}

async function readPaperSourceIndexEvidence(projectRoot) {
  if (!projectRoot) {
    return {
      path: null,
      paperCount: 0,
      sourceBackedPaperCount: 0,
    };
  }
  const relativePath = path.join("researcher", "PAPER_SOURCE_INDEX.json");
  const sourceIndexPath = path.join(projectRoot, relativePath);
  const raw = await readJson(sourceIndexPath, null);
  const entries = parsePaperSourceIndexEntries(raw);
  return {
    path: entries.length > 0 ? relativePath : null,
    paperCount: entries.length,
    sourceBackedPaperCount: entries.filter(isSourceBackedPaperEntry).length,
  };
}

function classifyLiteratureRequisition(request, sourceIndexEvidence) {
  if (!request) {
    return null;
  }
  const status = readString(request.status) ?? "unknown";
  const startedAt = readString(request.started_at ?? request.startedAt);
  const attemptCount = readNumber(request.attempt_count ?? request.attemptCount) ?? 0;
  const lastRunId = readString(request.last_run_id ?? request.lastRunId);
  const queueProgress = readQueueProgressSummary(request);
  const validationStatus = readString(request.validation_status ?? request.validationStatus);
  const hasSourceEvidence =
    (sourceIndexEvidence?.sourceBackedPaperCount ?? 0) > 0 && validationStatus !== "invalid";

  if (status === "completed" && hasSourceEvidence) {
    return "literature_requisition_completed_source_indexed";
  }
  if (status === "failed" || status === "needs_repair" || validationStatus === "invalid") {
    return "literature_requisition_failed_needs_repair";
  }
  if (status === "completed") {
    return "literature_requisition_completed_no_sources";
  }
  if (queueProgressHasRemoteEvidence(queueProgress)) {
    return "literature_requisition_remote_progress";
  }
  if (status === "running" || startedAt || attemptCount > 0 || lastRunId) {
    return "literature_requisition_launched_waiting_remote";
  }
  if (status === "queued") {
    return "literature_requisition_unlaunched";
  }
  return `literature_requisition_${status}`;
}

function summarizeLiteratureRequisition(manifest, sourceIndexEvidence) {
  const request = selectLatestLiteratureRequisition(manifest);
  if (!request) {
    return null;
  }
  const queueProgress = readQueueProgressSummary(request);
  return {
    summaryStatus: classifyLiteratureRequisition(request, sourceIndexEvidence),
    requestId: readString(request.request_id ?? request.requestId),
    requestKind: readString(request.request_kind ?? request.requestKind),
    triggerKind: readString(request.trigger_kind ?? request.triggerKind),
    status: readString(request.status),
    attemptCount: readNumber(request.attempt_count ?? request.attemptCount) ?? 0,
    startedAt: readString(request.started_at ?? request.startedAt),
    lastRunId: readString(request.last_run_id ?? request.lastRunId),
    lastSessionKey: readString(request.last_session_key ?? request.lastSessionKey),
    validationStatus: readString(request.validation_status ?? request.validationStatus),
    validationReportPath: readString(request.validation_report_path ?? request.validationReportPath),
    queueProgress,
    sourceIndex: sourceIndexEvidence ?? {
      path: null,
      paperCount: 0,
      sourceBackedPaperCount: 0,
    },
  };
}

function summarizeResearchHarnessLane(lane, manifest, scorecard, artifacts = {}) {
  return {
    lane: lane.lane,
    projectRoot: lane.projectRoot,
    finalVerdict: lane.finalVerdict,
    finalStage: lane.finalStage ?? manifest?.current_stage ?? null,
    finalOwner: lane.finalOwner ?? manifest?.owner_agent ?? null,
    topic: {
      status:
        readManifestStageStatus(manifest, "topic_search") ??
        readManifestStageStatus(manifest, "literature_discovery") ??
        scorecard?.literature_research_controller?.status ??
        null,
    },
    literature: {
      status:
        readManifestStageStatus(manifest, "literature_review") ??
        scorecard?.literature_research_controller?.status ??
        null,
      decision: scorecard?.literature_research_controller?.decision ?? null,
      coverageScore100:
        scorecard?.literature_research_controller?.coverage_score_100 ?? null,
      papernexusStatus: scorecard?.papernexus_certification?.status ?? null,
      sourceBackedGraphClaim:
        scorecard?.papernexus_certification?.source_backed_graph_claim ?? null,
      requisition: summarizeLiteratureRequisition(
        manifest,
        artifacts.paperSourceIndexEvidence
      ),
    },
    ideation: {
      status:
        readManifestStageStatus(manifest, "ideation") ??
        readManifestStageStatus(manifest, "idea_catalyst", "ideaCatalyst") ??
        readManifestStageStatus(manifest, "innovation_synthesis_state", "innovationSynthesisState") ??
        null,
    },
    experiment: {
      status:
        readManifestStageStatus(manifest, "experiment_search", "experimentSearch") ??
        readManifestStageStatus(manifest, "experiment_loop", "experimentLoop") ??
        scorecard?.experiment_lease_contract?.status ??
        null,
      benchmarkStatus: scorecard?.benchmark_adapter?.status ?? null,
      ledgerCount: scorecard?.evidence_coverage?.experiment_ledger_count ?? null,
      claimGuardrail: scorecard?.experiment_lease_contract?.claim_guardrail ?? null,
    },
    writing: {
      status:
        readManifestStageStatus(manifest, "writing") ??
        readManifestStageStatus(manifest, "paper_qc", "paperQc") ??
        scorecard?.verdict?.final_verdict ??
        null,
      claimStrengthCap: scorecard?.verdict?.claim_strength_cap ?? lane.claimStrengthCap ?? null,
      qualityScore100: scorecard?.quality_score?.score_100 ?? lane.qualityScore100 ?? null,
      copyeditStatus: scorecard?.copyedit_style_audit?.status ?? null,
      reviewerCalibrationStatus: scorecard?.reviewer_calibration?.status ?? null,
    },
    artifactPaths: {
      scorecardPath: lane.scorecardPath ?? null,
      reportPath: lane.reportPath ?? null,
      checklistPath: lane.checklistPath ?? null,
      timelinePath: lane.timelinePath ?? null,
    },
  };
}

export async function buildAutoWorkflowResearchHarnessScorecard(params) {
  const resultSummary = params?.resultSummary ?? {};
  const lanes = Array.isArray(resultSummary.lanes) ? resultSummary.lanes : [];
  const laneSummaries = [];
  for (const lane of lanes) {
    const manifest = lane.projectRoot
      ? await readJson(path.join(lane.projectRoot, "PROJECT_MANIFEST.json"), {})
      : {};
    const scorecard = lane.scorecardPath
      ? await readJson(lane.scorecardPath, {})
      : {};
    const paperSourceIndexEvidence = await readPaperSourceIndexEvidence(lane.projectRoot);
    laneSummaries.push(
      summarizeResearchHarnessLane(lane, manifest, scorecard, {
        paperSourceIndexEvidence,
      })
    );
  }
  return {
    generatedAt: params?.generatedAt ?? new Date().toISOString(),
    status: params?.status ?? null,
    topic: params?.topic ?? resultSummary.topic ?? null,
    mode: params?.mode ?? resultSummary.mode ?? null,
    bootstrapTransport: params?.bootstrapTransport ?? resultSummary.bootstrapTransport ?? null,
    lanes: laneSummaries,
  };
}

function compactArtifactPaths(paths) {
  return Object.fromEntries(
    Object.entries(paths).filter(([, value]) => readString(value))
  );
}

function summarizeChecklistLanes(resultSummary) {
  const lanes = Array.isArray(resultSummary?.lanes) ? resultSummary.lanes : [];
  return lanes.map((lane) => ({
    lane: lane.lane ?? null,
    transport: lane.transport ?? null,
    projectRoot: lane.projectRoot ?? null,
    finalVerdict: lane.finalVerdict ?? null,
    finalStage: lane.finalStage ?? null,
    finalOwner: lane.finalOwner ?? null,
    blockingReason: lane.blockingReason ?? lane.failureReason ?? null,
  }));
}

function buildPrChecklistResidualRisks(params) {
  const risks = [];
  const failedPreflight = Array.isArray(params.preflight)
    ? params.preflight.filter((entry) => entry?.ok === false)
    : [];
  if (failedPreflight.length > 0) {
    risks.push(`preflight_failed:${failedPreflight.map((entry) => entry.name).join(",")}`);
  }
  if (params.status !== "pass") {
    risks.push(`run_status_${params.status ?? "unknown"}`);
  }
  if (params.mode !== "live") {
    risks.push("fixture_mode_does_not_prove_live_runtime_dispatch");
  }
  if (params.bootstrapTransport !== "discord") {
    risks.push("discord_transport_parity_not_covered_by_this_run");
  }
  if (params.transportParity?.userPathAligned === false) {
    const laneIssues = Array.isArray(params.transportParity?.lanes)
      ? params.transportParity.lanes
          .flatMap((lane) =>
            Array.isArray(lane?.alignmentIssues)
              ? lane.alignmentIssues.map((issue) => `${lane?.lane ?? "lane"}:${issue}`)
              : []
          )
          .filter(Boolean)
      : [];
    risks.push(
      laneIssues.length > 0
        ? `transport_parity_user_path_misaligned:${laneIssues.slice(0, 5).join(",")}`
        : "transport_parity_user_path_misaligned"
    );
  }
  const lanes = Array.isArray(params.resultSummary?.lanes) ? params.resultSummary.lanes : [];
  if (!lanes.some((lane) => lane.finalStage === "writing" || lane.finalStage === "write")) {
    risks.push("writing_stage_not_reached_by_this_run");
  }
  return risks.length > 0
    ? risks
    : ["no_run_level_residual_risk_detected_by_checklist"];
}

export function buildAutoWorkflowPrChecklist(params = {}) {
  const preflight = Array.isArray(params.preflight) ? params.preflight : [];
  const failedPreflight = preflight.filter((entry) => entry?.ok === false);
  const lanes = summarizeChecklistLanes(params.resultSummary);
  const artifactPaths = compactArtifactPaths({
    summaryPath: params.summaryPath,
    markdownSummaryPath: params.markdownSummaryPath,
    traceEvalScorecardPath: params.traceEvalScorecardPath,
    researchHarnessScorecardPath: params.researchHarnessScorecardPath,
    projectsDashboardPath: params.projectsDashboardPath,
    projectsDashboardHtmlPath: params.projectsDashboardHtmlPath,
    payloadPath: params.payloadPath,
    stdoutPath: params.stdoutPath,
    stderrPath: params.stderrPath,
  });
  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    status: params.status ?? null,
    failureReason: params.failureReason ?? null,
    command: params.command?.displayCommand ?? params.command?.canonicalCommand ?? null,
    topic: params.topic ?? null,
    mode: params.mode ?? null,
    bootstrapTransport: params.bootstrapTransport ?? null,
    changeSummary: [
      "AutoWorkflow E2E runner produced durable run summary, trace/eval scorecard, research harness scorecard, and PR checklist artifacts.",
    ],
    validationEvidence: [
      {
        name: "environment_preflight",
        status: failedPreflight.length === 0 ? "pass" : "fail",
        detail: `${preflight.length} checks, ${failedPreflight.length} failed`,
        failed: failedPreflight.map((entry) => ({
          name: entry.name,
          detail: entry.detail,
        })),
      },
      {
        name: "trace_eval_scorecard",
        status: readString(params.traceEvalScorecardPath) ? "available" : "missing",
        artifactPath: params.traceEvalScorecardPath ?? null,
      },
      {
        name: "research_harness_scorecard",
        status: readString(params.researchHarnessScorecardPath) ? "available" : "missing",
        artifactPath: params.researchHarnessScorecardPath ?? null,
      },
      {
        name: "transport_parity",
        status:
          params.transportParity?.userPathAligned === false
            ? "fail"
            : params.transportParity
              ? "recorded"
              : "missing",
        profile: params.transportParity?.profile ?? null,
        expectedCommandSource: params.transportParity?.expectedCommandSource ?? null,
      },
      {
        name: "lane_final_verdicts",
        status: lanes.length > 0 && lanes.every((lane) => lane.finalVerdict === "pass")
          ? "pass"
          : lanes.length > 0
            ? "partial"
            : "missing",
        lanes,
      },
    ],
    artifactPaths,
    externalSideEffects: {
      liveRuntimeDispatch: params.mode === "live",
      papernexusNetworkProbe: preflight.some((entry) => entry?.name === "papernexus_reachability"),
      discordGatewayUse: params.bootstrapTransport === "discord",
      writes: [params.runRoot, params.projectsRoot].filter(Boolean),
      secretsRedacted: true,
      statement:
        params.mode === "live"
          ? "Live mode may create or resume workflow projects, dispatch runtime work, and probe configured PaperNexus/Gateway endpoints."
          : "Fixture mode writes only local run artifacts and does not dispatch live workflow work.",
    },
    rollback: {
      strategy:
        "Revert the code diff, remove or archive the generated run root, and do not reuse live project state as clean evidence without inspecting runtime sessions first.",
      liveProjectState:
        "If live mode dispatched work, back up the project .openclaw-research state before marking stale queue/session/mailbox entries terminal or superseded.",
    },
    residualRisks: buildPrChecklistResidualRisks(params),
  };
}

export function formatAutoWorkflowPrChecklistMarkdown(checklist) {
  const validation = Array.isArray(checklist.validationEvidence)
    ? checklist.validationEvidence
    : [];
  const artifacts = checklist.artifactPaths ?? {};
  return [
    "# AutoWorkflow PR Checklist",
    "",
    `- Status: ${checklist.status ?? "unknown"}`,
    `- Command: ${checklist.command ?? "unknown"}`,
    `- Topic: ${checklist.topic ?? "unknown"}`,
    `- Mode: ${checklist.mode ?? "unknown"}`,
    `- Bootstrap transport: ${checklist.bootstrapTransport ?? "unknown"}`,
    "",
    "## Validation Evidence",
    "",
    ...validation.map((entry) => `- ${entry.name}: ${entry.status}`),
    "",
    "## Artifacts",
    "",
    ...Object.entries(artifacts).map(([name, value]) => `- ${name}: ${value}`),
    "",
    "## External Side Effects",
    "",
    `- Live runtime dispatch: ${checklist.externalSideEffects?.liveRuntimeDispatch ? "yes" : "no"}`,
    `- PaperNexus network probe: ${checklist.externalSideEffects?.papernexusNetworkProbe ? "yes" : "no"}`,
    `- Discord/Gateway use: ${checklist.externalSideEffects?.discordGatewayUse ? "yes" : "no"}`,
    `- Statement: ${checklist.externalSideEffects?.statement ?? "unknown"}`,
    "",
    "## Residual Risks",
    "",
    ...(checklist.residualRisks ?? []).map((risk) => `- ${risk}`),
    "",
    "## Rollback",
    "",
    `- Strategy: ${checklist.rollback?.strategy ?? "unknown"}`,
    `- Live project state: ${checklist.rollback?.liveProjectState ?? "unknown"}`,
    "",
  ].join("\n");
}

function transportProfileForBootstrapTransport(bootstrapTransport) {
  return normalizeAutoWorkflowBootstrapTransport(bootstrapTransport) === "discord"
    ? "discord-parity"
    : "local-live";
}

function localFallbackInjected(workflowLocalFallback) {
  const codeReviewFallbackAfterMs =
    workflowLocalFallback?.codeReviewFallbackAfterMs ?? null;
  const autoModeDiscussionFallbackAfterMs =
    workflowLocalFallback?.autoModeDiscussionFallbackAfterMs ?? null;
  return Boolean(
    codeReviewFallbackAfterMs !== null ||
      autoModeDiscussionFallbackAfterMs !== null
  );
}

function isExpectedNativeSlashReplayFallback(value) {
  const text = String(value ?? "").toLowerCase();
  return text.includes("isolated native slash replay") || text.includes("isolated native slash bootstrap");
}

function buildLaneTransportAlignmentIssues({
  bootstrapTransport,
  lane,
  context,
  actualTransport,
  actualCommandSource,
  bootstrapFallbackTransport,
  actualBootstrapSessionKey,
  actualCommandTargetSessionKey,
}) {
  const issues = [];
  if (actualTransport !== bootstrapTransport) {
    issues.push(`transport_mismatch_expected_${bootstrapTransport}_actual_${actualTransport ?? "missing"}`);
  }
  if (actualCommandSource !== context.commandSource) {
    issues.push(`command_source_mismatch_expected_${context.commandSource}_actual_${actualCommandSource ?? "missing"}`);
  }
  if (bootstrapTransport === "discord") {
    if (bootstrapFallbackTransport && !isExpectedNativeSlashReplayFallback(bootstrapFallbackTransport)) {
      issues.push("unexpected_bootstrap_fallback_transport");
    }
    if (!String(actualBootstrapSessionKey ?? "").includes(":discord:")) {
      issues.push("bootstrap_session_not_discord_scoped");
    }
    if (!String(actualCommandTargetSessionKey ?? "").includes(":discord:")) {
      issues.push("command_target_session_not_discord_scoped");
    }
    if (!String(lane.originatingChannel ?? context.originatingChannel ?? "").startsWith("discord")) {
      issues.push("originating_channel_not_discord");
    }
  }
  return issues;
}

function expectedLaneNames(command) {
  if (command?.lane === "full") {
    return ["experiment", "survey"];
  }
  return [command?.lane === "survey" ? "survey" : "experiment"];
}

function expectedConversationIdForLane(baseConversationId, lane, requestedLane) {
  if (!baseConversationId) {
    return null;
  }
  return requestedLane === "full" ? `${baseConversationId}-${lane}` : baseConversationId;
}

function buildExpectedTransportContextSummary(params) {
  const context = buildWorkflowTransportContext({
    transport: params.bootstrapTransport,
    lane: params.lane,
    conversationId: params.conversationId,
    accountId: "default",
    userId: "owner",
  });
  const commandExtras = context.commandContextExtras();
  return {
    transport: context.transport,
    lane: context.lane,
    conversationId: context.conversationId,
    accountId: context.accountId,
    channel: context.channel,
    from: context.from,
    to: context.to,
    originatingChannel: context.originatingChannel,
    originatingTo: context.originatingTo,
    requesterChannel: context.requesterChannel,
    channelKey: context.channelKey,
    bootstrapSessionKey: context.bootstrapSessionKey,
    commandTargetSessionKey: context.commandTargetSessionKey,
    commandSource: commandExtras.commandSource ?? "local",
  };
}

export function buildAutoWorkflowTransportParityScorecard(params) {
  const bootstrapTransport = normalizeAutoWorkflowBootstrapTransport(params?.bootstrapTransport);
  const command = params?.command ?? normalizeAutoWorkflowCommand("full");
  const resultSummary = params?.resultSummary ?? {};
  const workflowLocalFallback = params?.workflowLocalFallback ?? null;
  const resultLanes = Array.isArray(resultSummary.lanes) ? resultSummary.lanes : [];
  const laneInputs =
    resultLanes.length > 0
      ? resultLanes
      : expectedLaneNames(command).map((lane) => ({
          lane,
          conversationId: expectedConversationIdForLane(
            params?.conversationId,
            lane,
            command.lane
          ),
        }));
  const lanes = laneInputs.map((lane) => {
    const laneName = lane.lane === "survey" ? "survey" : "experiment";
    const context = buildExpectedTransportContextSummary({
      bootstrapTransport,
      lane: laneName,
      conversationId:
        lane.conversationId ??
        expectedConversationIdForLane(params?.conversationId, laneName, command.lane),
    });
    const actualTransport = lane.transport ?? bootstrapTransport;
    const actualCommandSource = lane.commandSource ?? lane.actualCommandSource ?? context.commandSource;
    const bootstrapFallbackTransport = lane.bootstrapFallbackTransport ?? null;
    const actualBootstrapSessionKey = lane.bootstrapSessionKey ?? context.bootstrapSessionKey;
    const actualCommandTargetSessionKey = lane.commandTargetSessionKey ?? context.commandTargetSessionKey;
    const actualOriginatingChannel = lane.originatingChannel ?? context.originatingChannel;
    const actualOriginatingTo = lane.originatingTo ?? context.originatingTo;
    const alignmentIssues = buildLaneTransportAlignmentIssues({
      bootstrapTransport,
      lane,
      context,
      actualTransport,
      actualCommandSource,
      bootstrapFallbackTransport,
      actualBootstrapSessionKey,
      actualCommandTargetSessionKey,
    });
    return {
      lane: laneName,
      transport: actualTransport,
      conversationId: lane.conversationId ?? context.conversationId,
      projectRoot: lane.projectRoot ?? null,
      projectId: lane.projectRoot ? path.basename(lane.projectRoot) : null,
      finalVerdict: lane.finalVerdict ?? null,
      failureReason: lane.failureReason ?? null,
      expectedCommandSource: context.commandSource,
      actualCommandSource,
      bootstrapSessionKey: actualBootstrapSessionKey,
      commandTargetSessionKey: actualCommandTargetSessionKey,
      originatingChannel: actualOriginatingChannel,
      originatingTo: actualOriginatingTo,
      expectedOriginatingChannel: context.originatingChannel,
      expectedOriginatingTo: context.originatingTo,
      routePeer: context.to,
      bindingChannelKey: context.channelKey,
      bootstrapRunId: lane.bootstrapRunId ?? null,
      bootstrapFallbackTransport,
      userPathAligned: alignmentIssues.length === 0,
      alignmentIssues,
    };
  });
  return {
    profile: transportProfileForBootstrapTransport(bootstrapTransport),
    mode: params?.mode ?? null,
    bootstrapTransport,
    userPathAligned: lanes.length > 0 && lanes.every((lane) => lane.userPathAligned),
    expectedCommandSource: bootstrapTransport === "discord" ? "native" : "local",
    hiddenProjectIdOverrideUsed: Boolean(params?.projectIdArg || params?.generatedProjectId),
    requestedProjectId: params?.projectIdArg ?? null,
    generatedProjectId: params?.generatedProjectId ?? null,
    effectiveProjectId: params?.explicitProjectId ?? resultSummary.projectId ?? null,
    localFallbackInjected: localFallbackInjected(workflowLocalFallback),
    localFallback: workflowLocalFallback,
    lanes,
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

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

const E2E_ACTIVE_SESSION_STATUSES = new Set(["active"]);
const E2E_ACTIVE_QUEUE_STATUSES = new Set(["queued", "pending", "launching", "running"]);

async function terminalizeRuntimeResidueFile(params) {
  const store = await readJson(params.filePath, null);
  if (!store || typeof store !== "object") {
    return {
      filePath: params.filePath,
      changedCount: 0,
      backupPath: null,
      missing: true,
    };
  }
  const entries = Array.isArray(store.entries) ? store.entries : null;
  if (!entries) {
    return {
      filePath: params.filePath,
      changedCount: 0,
      backupPath: null,
      missing: false,
    };
  }

  let changedCount = 0;
  const nextEntries = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || !params.activeStatuses.has(String(entry.status ?? ""))) {
      return entry;
    }
    changedCount += 1;
    return {
      ...entry,
      status: "superseded",
      lastCheckedAt: params.finishedAt,
      lastFinishedAt: entry.lastFinishedAt ?? params.finishedAt,
      terminalReason: params.reason,
      supersededAt: params.finishedAt,
      lastError: [entry.lastError, params.reason].filter(Boolean).join(" "),
    };
  });

  if (changedCount === 0) {
    return {
      filePath: params.filePath,
      changedCount,
      backupPath: null,
      missing: false,
    };
  }

  const backupPath = `${params.filePath}.e2e-closeout-backup-${params.finishedAt.replace(/[:.]/g, "")}`;
  await fs.copyFile(params.filePath, backupPath);
  await fs.writeFile(
    params.filePath,
    `${JSON.stringify({ ...store, updatedAt: params.finishedAt, entries: nextEntries }, null, 2)}\n`,
    "utf8"
  );
  return {
    filePath: params.filePath,
    changedCount,
    backupPath,
    missing: false,
  };
}

export async function terminalizeAutoWorkflowE2ERuntimeResidue(params) {
  if (params?.mode !== "live") {
    return {
      enabled: false,
      reason: "non_live_mode",
      lanes: [],
      sessionCount: 0,
      queueCount: 0,
    };
  }
  const projectsRoot = params?.projectsRoot ? path.resolve(params.projectsRoot) : null;
  if (!projectsRoot) {
    return {
      enabled: false,
      reason: "missing_projects_root",
      lanes: [],
      sessionCount: 0,
      queueCount: 0,
    };
  }
  const lanes = [];
  for (const lane of params?.resultSummary?.lanes ?? []) {
    const projectRoot = lane?.projectRoot ? path.resolve(lane.projectRoot) : null;
    if (!projectRoot) {
      continue;
    }
    if (!isPathInside(projectsRoot, projectRoot)) {
      lanes.push({
        lane: lane.lane ?? null,
        projectRoot,
        skipped: true,
        reason: "project_root_outside_e2e_projects_root",
      });
      continue;
    }
    const runtimeDir = path.join(projectRoot, ".openclaw-research");
    const reason = params.reason ?? "e2e_harness_closeout_superseded";
    const [sessions, queue] = await Promise.all([
      terminalizeRuntimeResidueFile({
        filePath: path.join(runtimeDir, "workflow-runtime-sessions.json"),
        activeStatuses: E2E_ACTIVE_SESSION_STATUSES,
        finishedAt: params.finishedAt,
        reason,
      }),
      terminalizeRuntimeResidueFile({
        filePath: path.join(runtimeDir, "workflow-runtime-queue.json"),
        activeStatuses: E2E_ACTIVE_QUEUE_STATUSES,
        finishedAt: params.finishedAt,
        reason,
      }),
    ]);
    lanes.push({
      lane: lane.lane ?? null,
      projectRoot,
      skipped: false,
      sessions,
      queue,
    });
  }
  return {
    enabled: true,
    reason: params.reason ?? "e2e_harness_closeout_superseded",
    lanes,
    sessionCount: lanes.reduce((total, lane) => total + (lane.sessions?.changedCount ?? 0), 0),
    queueCount: lanes.reduce((total, lane) => total + (lane.queue?.changedCount ?? 0), 0),
  };
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
  const checks = await collectAutoWorkflowEnvironmentPreflight({
    mode: params.mode,
    bootstrapTransport: params.bootstrapTransport,
    sourceConfigPath: params.sourceConfigPath,
    isolatedGateway: params.isolatedGateway,
    gatewayToken: params.gatewayToken,
    localPapernexus: params.localPapernexus,
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
        const authStatePath = path.join(agentDir, "auth-state.json");
        const modelsPath = path.join(agentDir, "models.json");
        const modelsCatalog = await readJson(modelsPath, null);
        const authProfile = await readJson(authProfilePath, null);
        const authState = await readJson(authStatePath, null);
        const runtimeCheck = verifyAgentRuntimeModelConfig({
          config,
          agentId: role,
          agentDir,
          modelsCatalog,
          authProfile,
          authState,
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

export function formatHumanSummary(summary) {
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
    `trace/eval scorecard: ${summary.traceEvalScorecardPath ?? "unknown"}`,
    `research harness scorecard: ${summary.researchHarnessScorecardPath ?? "unknown"}`,
    `PR checklist: ${summary.prChecklistPath ?? "unknown"}`,
    `projects dashboard: ${summary.projectsDashboardHtmlPath ?? "unknown"}`,
    `projects dashboard json: ${summary.projectsDashboardPath ?? "unknown"}`,
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
  if (summary.transportParity) {
    lines.push(
      `transport parity: ${summary.transportParity.profile} aligned=${summary.transportParity.userPathAligned === false ? "false" : summary.transportParity.userPathAligned === true ? "true" : "unknown"} commandSource=${summary.transportParity.expectedCommandSource} localFallbackInjected=${summary.transportParity.localFallbackInjected} hiddenProjectIdOverride=${summary.transportParity.hiddenProjectIdOverrideUsed}`
    );
    for (const lane of summary.transportParity.lanes ?? []) {
      const laneIssues =
        Array.isArray(lane.alignmentIssues) && lane.alignmentIssues.length > 0
          ? lane.alignmentIssues.slice(0, 5).join(",")
          : "none";
      lines.push(
        `transport parity ${lane.lane}: aligned=${lane.userPathAligned === false ? "false" : lane.userPathAligned === true ? "true" : "unknown"} issues=${laneIssues} target=${lane.commandTargetSessionKey ?? "unknown"} origin=${lane.originatingChannel ?? "unknown"}:${lane.originatingTo ?? "unknown"} project=${lane.projectId ?? "unknown"}`
      );
    }
  }
  if (summary.runtimeCloseout?.enabled) {
    lines.push(
      `runtime closeout: sessions=${summary.runtimeCloseout.sessionCount ?? 0} queues=${summary.runtimeCloseout.queueCount ?? 0} reason=${summary.runtimeCloseout.reason ?? "unknown"}`
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
      `run trend: ${lane.runTrendPath ?? "unknown"}`,
      `benchmark adapter: ${lane.benchmarkAdapterScorecardPath ?? "unknown"}`,
      `domain evaluator: ${lane.domainEvaluatorContractPath ?? "unknown"}`,
      `reviewer calibration: ${lane.reviewerCalibrationPath ?? "unknown"}`,
      `copyedit/style audit: ${lane.copyeditStyleAuditPath ?? "unknown"}`,
      `experiment lease: ${lane.experimentLeaseContractPath ?? "unknown"}`,
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
    const harnessLane = (summary.researchHarnessScorecard?.lanes ?? []).find(
      (entry) => entry?.lane === lane.lane
    );
    const requisition = harnessLane?.literature?.requisition;
    if (requisition) {
      const progress = requisition.queueProgress ?? {};
      lines.push(
        `literature requisition: ${requisition.summaryStatus ?? "unknown"} status=${requisition.status ?? "unknown"} attempt=${requisition.attemptCount ?? "unknown"} started_at=${requisition.startedAt ?? "null"} run=${requisition.lastRunId ?? "null"} queue_sequence=${progress.sequence ?? "null"} remaining=${progress.remaining ?? "null"} completed=${progress.completed ?? "null"} failed=${progress.failed ?? "null"}`
      );
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
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(formatUsage());
    return;
  }

  const command = normalizeAutoWorkflowCommand(
    argValue(argv, "--command", null) ?? firstPositional(argv) ?? "full"
  );
  const topic = argValue(argv, "--topic", "Generalized Category Discovery");
  const mode = normalizeAutoWorkflowMode(argValue(argv, "--mode", "live"));
  const bootstrapTransport = normalizeAutoWorkflowBootstrapTransport(
    argValue(argv, "--bootstrap-transport", "local")
  );
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
  const strictContent = hasFlag(argv, "--strict-content");
  const noPreflight = hasFlag(argv, "--no-preflight");
  const isolatedGateway = !hasFlag(argv, "--no-isolated-gateway");
  const timestamp = timestampSlug();
  const reuseProject = hasFlag(argv, "--reuse-project");
  if (mode === "live" && bootstrapTransport === "discord" && projectIdArg) {
    throw new Error(
      "--project-id cannot be used with live Discord parity because a real native slash command cannot carry the hidden project id override. Use local-live for project-id-specific tests."
    );
  }
  const generatedProjectId =
    shouldAutoGenerateLiveProjectId({
      mode,
      bootstrapTransport,
      reuseProject,
      projectIdArg,
    })
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
  const projectsRoot = await resolveAutoWorkflowProjectsRoot({
    mode,
    sourceConfigPath,
    projectsRoot: argValue(argv, "--projects-root", null),
    fallback: path.join(runRoot, "projects"),
    isolatedGateway,
    reuseProject,
  });
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
  const gatewayUrl = argValue(argv, "--gateway-url", null);
  const gatewayToken = argValue(argv, "--gateway-token", null);

  await fs.mkdir(runRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });

  const papernexusSshTunnel = await startPapernexusSshTunnel(localPapernexus);
  const papernexusTunnelChecks = papernexusSshTunnel.check
    ? [papernexusSshTunnel.check]
    : [];
  const preflightChecks = noPreflight
    ? [{ name: "preflight", ok: true, detail: "skipped" }]
    : [
        ...papernexusTunnelChecks,
        ...(await preflight({
          mode,
          sourceConfigPath: effectiveSourceConfig.configPath,
          isolatedGateway,
          skipAgentAuthPreflight,
          skipAgentModelSync,
          skipGatewayRestartAfterAgentSync,
          agentAuthRoles,
          agentAuthProviders,
          bootstrapTransport,
          gatewayToken,
          localPapernexus,
        })),
      ];
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
  if (gatewayUrl) {
    childArgs.push("--gateway-url", gatewayUrl);
  }
  if (gatewayToken) {
    childArgs.push("--gateway-token", gatewayToken);
  }
  if (childMaxIterations !== null) {
    childArgs.push("--max-iterations", String(childMaxIterations));
  }
  if (strictContent) {
    childArgs.push("--strict-content");
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
  await stopPapernexusSshTunnel(papernexusSshTunnel);

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
  const runtimeCloseout = await terminalizeAutoWorkflowE2ERuntimeResidue({
    mode,
    projectsRoot,
    resultSummary,
    finishedAt,
    reason:
      status === "pass"
        ? "e2e_harness_pass_closeout"
        : `e2e_harness_${failureReason ?? status}_closeout`,
  });
  const summaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.json");
  const markdownSummaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.md");
  const traceEvalScorecardPath = path.join(runRoot, "TRACE_EVAL_SCORECARD.json");
  const researchHarnessScorecardPath = path.join(runRoot, "RESEARCH_HARNESS_SCORECARD.json");
  const prChecklistPath = path.join(runRoot, "PR_CHECKLIST.json");
  const prChecklistMarkdownPath = path.join(runRoot, "PR_CHECKLIST.md");
  const stdoutPath = path.join(runRoot, "stdout.log");
  const stderrPath = path.join(runRoot, "stderr.log");
  const payloadPath = path.join(runRoot, "payload.json");
  const snapshots = await collectProjectSnapshots({ runRoot, resultSummary });
  let projectsDashboard = null;
  try {
    projectsDashboard = await buildE2EProjectsDashboard({ projectsRoot });
  } catch (error) {
    projectsDashboard = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const transportParity = buildAutoWorkflowTransportParityScorecard({
    command,
    mode,
    bootstrapTransport,
    conversationId,
    resultSummary,
    workflowLocalFallback: workflowLocalFallback.summary,
    projectIdArg,
    generatedProjectId,
    explicitProjectId,
  });
  const traceEvalScorecard = buildAutoWorkflowTraceEvalScorecard({
    generatedAt: finishedAt,
    status,
    failureReason,
    command,
    topic,
    mode,
    bootstrapTransport,
    preflight: preflightChecks,
    resultSummary,
    transportParity,
    runtimeCloseout,
  });
  const researchHarnessScorecard = await buildAutoWorkflowResearchHarnessScorecard({
    generatedAt: finishedAt,
    status,
    topic,
    mode,
    bootstrapTransport,
    resultSummary,
  });
  const prChecklist = buildAutoWorkflowPrChecklist({
    generatedAt: finishedAt,
    status,
    failureReason,
    command,
    topic,
    mode,
    bootstrapTransport,
    preflight: preflightChecks,
    resultSummary,
    transportParity,
    summaryPath,
    markdownSummaryPath,
    traceEvalScorecardPath,
    researchHarnessScorecardPath,
    projectsDashboardPath: projectsDashboard.projectsDashboardPath ?? null,
    projectsDashboardHtmlPath: projectsDashboard.projectsDashboardHtmlPath ?? null,
    payloadPath,
    stdoutPath,
    stderrPath,
    runRoot,
    projectsRoot,
    runtimeCloseout,
  });
  const prChecklistMarkdown = formatAutoWorkflowPrChecklistMarkdown(prChecklist);
  const summary = {
    status,
    failureReason,
    startedAt,
    finishedAt,
    command,
    topic,
    projectId: resultSummary.projectId ?? explicitProjectId,
    mode,
    strictContent,
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
    runtimeCloseout,
    transportParity,
    traceEvalScorecardPath,
    traceEvalScorecard,
    researchHarnessScorecardPath,
    researchHarnessScorecard,
    prChecklistPath,
    prChecklistMarkdownPath,
    prChecklist,
    snapshots,
    snapshotRoot: path.join(runRoot, "snapshots"),
    projectsDashboardPath: projectsDashboard.projectsDashboardPath ?? null,
    projectsDashboardHtmlPath: projectsDashboard.projectsDashboardHtmlPath ?? null,
    projectsDashboard: projectsDashboard.summary ?? projectsDashboard,
    summaryPath,
    markdownSummaryPath,
    stdoutPath,
    stderrPath,
    payloadPath,
    localPapernexus: localPapernexus.summary,
    workflowLocalFallback: workflowLocalFallback.summary,
    modelOverride: modelOverrideSummary,
  };

  await Promise.all([
    writeText(summary.stdoutPath, child.stdout ?? ""),
    writeText(summary.stderrPath, child.stderr ?? ""),
    writeText(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
    writeText(traceEvalScorecardPath, `${JSON.stringify(traceEvalScorecard, null, 2)}\n`),
    writeText(
      researchHarnessScorecardPath,
      `${JSON.stringify(researchHarnessScorecard, null, 2)}\n`
    ),
    writeText(prChecklistPath, `${JSON.stringify(prChecklist, null, 2)}\n`),
    writeText(prChecklistMarkdownPath, prChecklistMarkdown),
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
