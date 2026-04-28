import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeMcpPath(value) {
  const raw = readString(value) ?? "/mcp";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.replace(/\/{2,}/g, "/");
}

function localServeUrlFromConfig(config) {
  const serve = config?.serve && typeof config.serve === "object" ? config.serve : {};
  const host = readString(serve.host) ?? "127.0.0.1";
  const port = Number.isFinite(Number(serve.port)) ? Number(serve.port) : 4821;
  return {
    apiBaseUrl: `http://${host}:${port}`,
    mcpUrl: `http://${host}:${port}${normalizeMcpPath(serve.mcp?.path)}`,
  };
}

function isLoopbackUrl(value) {
  try {
    const parsed = new URL(String(value ?? ""));
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function resolveLocalPapernexusConfig(argv, options = {}) {
  const useLocal = hasFlag(argv, "--use-local-papernexus");
  const explicitMcpUrl = readString(argValue(argv, "--papernexus-mcp-url", null));
  const explicitApiBaseUrl = readString(argValue(argv, "--papernexus-api-base-url", null));
  const explicitAccessMode = readString(argValue(argv, "--papernexus-access-mode", null));
  const explicitTokenEnv = readString(argValue(argv, "--papernexus-token-env", null));
  const explicitSharedCorpus = readString(argValue(argv, "--papernexus-shared-corpus", null));
  const explicitSshTarget = readString(argValue(argv, "--papernexus-ssh-target", null));
  const explicitRemoteStagingRoot = readString(
    argValue(argv, "--papernexus-remote-staging-root", null)
  );
  const shouldResolve =
    useLocal ||
    Boolean(
      explicitMcpUrl ||
        explicitApiBaseUrl ||
        explicitAccessMode ||
        explicitTokenEnv ||
        explicitSharedCorpus ||
        explicitSshTarget ||
        explicitRemoteStagingRoot
    );

  if (!shouldResolve) {
    return {
      enabled: false,
      pluginOverrides: {},
      envOverrides: {},
      summary: null,
    };
  }

  const env = options.env ?? process.env;
  const tokenEnv = explicitTokenEnv ?? "PAPERNEXUS_API_TOKEN";
  const envToken = readString(env[tokenEnv]);
  const configPath = expandHomePath(
    argValue(argv, "--papernexus-local-config-path", path.join(os.homedir(), ".papernexus", "config.json"))
  );
  const explicitRemoteTargetIsLoopback =
    Boolean(explicitMcpUrl && isLoopbackUrl(explicitMcpUrl)) ||
    Boolean(explicitApiBaseUrl && isLoopbackUrl(explicitApiBaseUrl));
  const canUseLocalServeConfigToken = useLocal || explicitRemoteTargetIsLoopback;
  const shouldReadConfig = useLocal || (!envToken && canUseLocalServeConfigToken);
  const config = shouldReadConfig ? await readJson(configPath) : null;
  const localUrls = useLocal && config ? localServeUrlFromConfig(config) : {};
  const localToken = readString(config?.serve?.apiToken);
  const accessMode = explicitAccessMode ?? (explicitMcpUrl || useLocal ? "remote_mcp" : "auto");
  const mcpUrl = explicitMcpUrl ?? localUrls.mcpUrl ?? null;
  const apiBaseUrl = explicitApiBaseUrl ?? localUrls.apiBaseUrl ?? null;
  const envOverrides = {};
  const injectedLocalToken = !envToken && localToken && canUseLocalServeConfigToken;
  if (injectedLocalToken) {
    envOverrides[tokenEnv] = localToken;
  }
  if (mcpUrl && (useLocal || isLoopbackUrl(mcpUrl))) {
    envOverrides.PAPERNEXUS_ALLOW_LOCAL_MCP = "1";
  }
  if (explicitSharedCorpus && !readString(env.PAPERNEXUS_CORPUS)) {
    envOverrides.PAPERNEXUS_CORPUS = explicitSharedCorpus;
  }
  if (explicitSshTarget && !readString(env.PAPERNEXUS_SSH_TARGET)) {
    envOverrides.PAPERNEXUS_SSH_TARGET = explicitSshTarget;
  }
  if (
    explicitRemoteStagingRoot &&
    !readString(env.PAPERNEXUS_REMOTE_STAGING_ROOT)
  ) {
    envOverrides.PAPERNEXUS_REMOTE_STAGING_ROOT = explicitRemoteStagingRoot;
  }

  const pluginOverrides = {
    papernexusAccessMode: accessMode,
    papernexusApiTokenEnv: tokenEnv,
  };
  if (envToken || injectedLocalToken) {
    pluginOverrides.papernexusApiTokenSource = "env";
  }
  if (mcpUrl) {
    pluginOverrides.papernexusMcpUrl = mcpUrl;
    pluginOverrides.papernexusMcpTransport = "streamable-http";
    if (useLocal || isLoopbackUrl(mcpUrl)) {
      pluginOverrides.papernexusAllowLocalMcp = true;
    }
  }
  if (apiBaseUrl) {
    pluginOverrides.papernexusApiBaseUrl = apiBaseUrl;
  }
  if (explicitSharedCorpus) {
    pluginOverrides.papernexusSharedCorpus = explicitSharedCorpus;
  }
  const configuredSshTarget = explicitSshTarget ?? readString(env.PAPERNEXUS_SSH_TARGET);
  if (configuredSshTarget) {
    pluginOverrides.papernexusSshTarget = configuredSshTarget;
  }
  const configuredRemoteStagingRoot =
    explicitRemoteStagingRoot ?? readString(env.PAPERNEXUS_REMOTE_STAGING_ROOT);
  if (configuredRemoteStagingRoot) {
    pluginOverrides.papernexusRemoteStagingRoot = configuredRemoteStagingRoot;
  }

  return {
    enabled: true,
    pluginOverrides,
    envOverrides,
    summary: {
      configPath,
      accessMode,
      mcpUrl,
      apiBaseUrl,
      tokenEnv,
      tokenProvidedBy: envToken
        ? "environment"
        : injectedLocalToken
          ? "local_config"
          : mcpUrl || apiBaseUrl
            ? "runtime_access"
            : "missing",
      sharedCorpus: explicitSharedCorpus,
      corpusProvidedBy: explicitSharedCorpus
        ? readString(env.PAPERNEXUS_CORPUS)
          ? "environment"
          : "cli"
        : "missing",
      sshTarget: explicitSshTarget,
      sshTargetProvidedBy: explicitSshTarget
        ? readString(env.PAPERNEXUS_SSH_TARGET)
          ? "environment"
          : "cli"
        : "missing",
      remoteStagingRoot: explicitRemoteStagingRoot,
      remoteStagingRootProvidedBy: explicitRemoteStagingRoot
        ? readString(env.PAPERNEXUS_REMOTE_STAGING_ROOT)
          ? "environment"
          : "cli"
        : "missing",
    },
  };
}

export function appendLocalPapernexusArgs(argv, args) {
  for (const name of [
    "--use-local-papernexus",
    "--papernexus-local-config-path",
    "--papernexus-mcp-url",
    "--papernexus-api-base-url",
    "--papernexus-access-mode",
    "--papernexus-token-env",
    "--papernexus-shared-corpus",
    "--papernexus-ssh-target",
    "--papernexus-remote-staging-root",
  ]) {
    if (name === "--use-local-papernexus") {
      if (hasFlag(argv, name)) {
        args.push(name);
      }
      continue;
    }
    const value = argValue(argv, name, null);
    if (value !== null) {
      args.push(name, value);
    }
  }
}
