import { execFile } from "node:child_process";
import type {
  PapernexusMcpClientConfig,
  PapernexusRemoteMcpTransport,
} from "./papernexus-packets/mcp-client";

export type PapernexusApiTokenSource = "env" | "os_keychain" | "auto";

export type PapernexusRemoteAccessConfig = {
  apiBaseUrl?: string | null;
  mcpUrl?: string | null;
  mcpTransport?: string | null;
  mcpTimeoutMs?: number | null;
  tokenSource?: string | null;
  tokenEnv?: string | null;
  tokenService?: string | null;
  tokenAccount?: string | null;
  mineruHttpUrl?: string | null;
  tokenLookupTimeoutMs?: number | null;
};

export type PapernexusRemoteAccessSummary = {
  apiBaseUrl: string | null;
  mcpUrl: string | null;
  mcpTransport: PapernexusRemoteMcpTransport | null;
  mcpTimeoutMs: number;
  tokenSourceConfigured: PapernexusApiTokenSource;
  tokenEnv: string | null;
  tokenService: string | null;
  tokenAccount: string | null;
  mineruHttpUrl: string | null;
  tokenLookupTimeoutMs: number;
};

export type PapernexusRemoteAccessInspection = {
  token: string | null;
  tokenAvailable: boolean;
  tokenSourceResolved: "env" | "os_keychain" | null;
  tokenError: string | null;
  summary: PapernexusRemoteAccessSummary;
};

type CommandRunnerResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: unknown;
};

export type PapernexusCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number }
) => Promise<CommandRunnerResult>;

type InspectPapernexusRemoteAccessOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  commandRunner?: PapernexusCommandRunner;
};

const DEFAULT_TOKEN_SERVICE = "papernexus-api-token";
const DEFAULT_TOKEN_ACCOUNT = "default";
const DEFAULT_LOOKUP_TIMEOUT_MS = 2000;
const DEFAULT_MCP_TIMEOUT_MS = 30_000;

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(250, Math.floor(value))
    : DEFAULT_LOOKUP_TIMEOUT_MS;
}

function asMcpTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1000, Math.floor(value))
    : DEFAULT_MCP_TIMEOUT_MS;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function normalizePapernexusApiTokenSource(value: unknown): PapernexusApiTokenSource {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z]+/g, "_") : "";
  if (normalized === "env") {
    return "env";
  }
  if (
    normalized === "os_keychain" ||
    normalized === "oskeychain" ||
    normalized === "keychain"
  ) {
    return "os_keychain";
  }
  return "auto";
}

export function normalizePapernexusMcpTransport(
  value: unknown
): PapernexusRemoteMcpTransport | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z]+/g, "_") : "";
  if (normalized === "streamable_http") {
    return "streamable-http";
  }
  return null;
}

export function summarizePapernexusRemoteAccessConfig(
  config: PapernexusRemoteAccessConfig | null | undefined
): PapernexusRemoteAccessSummary {
  const mcpUrl = asOptionalString(config?.mcpUrl) ?? null;
  const mcpTransportRaw = asOptionalString(config?.mcpTransport);
  const mcpTransport =
    normalizePapernexusMcpTransport(mcpTransportRaw) ??
    (mcpUrl && !mcpTransportRaw ? "streamable-http" : null);
  return {
    apiBaseUrl: asOptionalString(config?.apiBaseUrl) ?? null,
    mcpUrl,
    mcpTransport,
    mcpTimeoutMs: asMcpTimeoutMs(config?.mcpTimeoutMs),
    tokenSourceConfigured: normalizePapernexusApiTokenSource(config?.tokenSource),
    tokenEnv: asOptionalString(config?.tokenEnv) ?? null,
    tokenService: asOptionalString(config?.tokenService) ?? DEFAULT_TOKEN_SERVICE,
    tokenAccount: asOptionalString(config?.tokenAccount) ?? DEFAULT_TOKEN_ACCOUNT,
    mineruHttpUrl: asOptionalString(config?.mineruHttpUrl) ?? null,
    tokenLookupTimeoutMs: asTimeoutMs(config?.tokenLookupTimeoutMs),
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { timeoutMs: number }
): Promise<CommandRunnerResult> {
  return await new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const maybeCode =
            typeof (error as { code?: number | string }).code === "number"
              ? ((error as { code?: number }).code ?? null)
              : null;
          resolve({
            ok: false,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: maybeCode,
            error,
          });
          return;
        }
        resolve({
          ok: true,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: 0,
        });
      }
    );
  });
}

async function lookupTokenInOsKeychain(params: {
  platform: NodeJS.Platform;
  summary: PapernexusRemoteAccessSummary;
  commandRunner: PapernexusCommandRunner;
}): Promise<{
  token: string | null;
  error: string | null;
}> {
  const { platform, summary, commandRunner } = params;
  if (platform === "darwin") {
    const result = await commandRunner(
      "security",
      [
        "find-generic-password",
        "-s",
        summary.tokenService ?? DEFAULT_TOKEN_SERVICE,
        "-a",
        summary.tokenAccount ?? DEFAULT_TOKEN_ACCOUNT,
        "-w",
      ],
      { timeoutMs: summary.tokenLookupTimeoutMs }
    );
    const token = result.stdout.trim();
    if (result.ok && token) {
      return { token, error: null };
    }
    return {
      token: null,
      error:
        result.stderr.trim() ||
        "macOS Keychain lookup failed for the configured PaperNexus token entry.",
    };
  }

  if (platform === "linux") {
    const result = await commandRunner(
      "secret-tool",
      [
        "lookup",
        "service",
        summary.tokenService ?? DEFAULT_TOKEN_SERVICE,
        "account",
        summary.tokenAccount ?? DEFAULT_TOKEN_ACCOUNT,
      ],
      { timeoutMs: summary.tokenLookupTimeoutMs }
    );
    const token = result.stdout.trim();
    if (result.ok && token) {
      return { token, error: null };
    }
    return {
      token: null,
      error:
        result.stderr.trim() ||
        "Secret Service lookup failed for the configured PaperNexus token entry.",
    };
  }

  if (platform === "win32") {
    const service = escapePowerShellSingleQuoted(summary.tokenService ?? DEFAULT_TOKEN_SERVICE);
    const account = escapePowerShellSingleQuoted(summary.tokenAccount ?? DEFAULT_TOKEN_ACCOUNT);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault",
      `$cred = $vault.Retrieve('${service}', '${account}')`,
      "$cred.RetrievePassword()",
      "[Console]::Out.Write($cred.Password)",
    ].join("; ");
    const result = await commandRunner(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeoutMs: summary.tokenLookupTimeoutMs }
    );
    const token = result.stdout.trim();
    if (result.ok && token) {
      return { token, error: null };
    }
    return {
      token: null,
      error:
        result.stderr.trim() ||
        "Windows PasswordVault lookup failed for the configured PaperNexus token entry.",
    };
  }

  return {
    token: null,
    error: `Unsupported platform for native PaperNexus keychain lookup: ${platform}`,
  };
}

export async function inspectPapernexusRemoteAccess(
  config: PapernexusRemoteAccessConfig | null | undefined,
  options: InspectPapernexusRemoteAccessOptions = {}
): Promise<PapernexusRemoteAccessInspection> {
  const summary = summarizePapernexusRemoteAccessConfig(config);
  const explicitlyConfigured =
    summary.apiBaseUrl !== null ||
    summary.mcpUrl !== null ||
    summary.tokenEnv !== null ||
    summary.mineruHttpUrl !== null ||
    summary.tokenSourceConfigured !== "auto" ||
    summary.tokenService !== DEFAULT_TOKEN_SERVICE ||
    summary.tokenAccount !== DEFAULT_TOKEN_ACCOUNT;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;

  if (!explicitlyConfigured) {
    return {
      token: null,
      tokenAvailable: false,
      tokenSourceResolved: null,
      tokenError: "PaperNexus remote access is not configured.",
      summary,
    };
  }

  if (summary.tokenSourceConfigured === "env") {
    const token = summary.tokenEnv ? env[summary.tokenEnv]?.trim() ?? "" : "";
    return {
      token: token || null,
      tokenAvailable: token.length > 0,
      tokenSourceResolved: token.length > 0 ? "env" : null,
      tokenError:
        token.length > 0
          ? null
          : summary.tokenEnv
            ? `Environment variable ${summary.tokenEnv} is unset or empty.`
            : "No PaperNexus token environment variable is configured.",
      summary,
    };
  }

  if (summary.tokenSourceConfigured === "auto" && summary.tokenEnv) {
    const envToken = env[summary.tokenEnv]?.trim() ?? "";
    if (envToken.length > 0) {
      return {
        token: envToken,
        tokenAvailable: true,
        tokenSourceResolved: "env",
        tokenError: null,
        summary,
      };
    }
  }

  const keychainLookup = await lookupTokenInOsKeychain({
    platform,
    summary,
    commandRunner,
  });
  if (keychainLookup.token) {
    return {
      token: keychainLookup.token,
      tokenAvailable: true,
      tokenSourceResolved: "os_keychain",
      tokenError: null,
      summary,
    };
  }

  if (summary.tokenSourceConfigured === "auto") {
    const envHint = summary.tokenEnv
      ? `env ${summary.tokenEnv} was not set`
      : "no token env was configured";
    return {
      token: null,
      tokenAvailable: false,
      tokenSourceResolved: null,
      tokenError: `${envHint}; keychain lookup also failed: ${keychainLookup.error}`,
      summary,
    };
  }

  return {
    token: null,
    tokenAvailable: false,
    tokenSourceResolved: null,
    tokenError: keychainLookup.error,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Access mode resolution — remote API vs. remote MCP vs. local MCP
// ---------------------------------------------------------------------------

export type PapernexusAccessMode = "remote_api" | "remote_mcp" | "local_mcp" | "auto";

export type PapernexusAccessResolution = {
  mode: "remote_api" | "remote_mcp" | "local_mcp" | "unavailable";
  remoteInspection: PapernexusRemoteAccessInspection | null;
  corpusRoot: string | null;
  error: string | null;
};

export function normalizePapernexusAccessMode(value: unknown): PapernexusAccessMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z_]+/g, "_") : "";
  if (normalized === "remote_api") return "remote_api";
  if (normalized === "remote_mcp") return "remote_mcp";
  if (normalized === "local_mcp") return "local_mcp";
  return "auto";
}

function buildRemoteApiUnavailableError(
  inspection: PapernexusRemoteAccessInspection
): string {
  if (!inspection.summary.apiBaseUrl) {
    return "Remote API base URL is not configured.";
  }
  return inspection.tokenError ?? "Remote API token not available.";
}

function buildRemoteMcpUnavailableError(
  inspection: PapernexusRemoteAccessInspection,
  corpusRoot: string | null
): string {
  if (!inspection.summary.mcpUrl) {
    return "Remote MCP URL is not configured.";
  }
  if (!inspection.summary.mcpTransport) {
    return "Remote MCP transport is unsupported. Currently only streamable-http is supported.";
  }
  if (!corpusRoot) {
    return "Remote MCP requires a corpus identifier/path but none was provided.";
  }
  return inspection.tokenError ?? "Remote MCP token not available.";
}

export async function resolvePapernexusAccessPath(
  config: PapernexusRemoteAccessConfig | null | undefined,
  options: {
    accessMode?: PapernexusAccessMode;
    corpusRoot?: string | null;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    commandRunner?: PapernexusCommandRunner;
    checkLocalBin?: (bin: string) => Promise<boolean>;
  } = {}
): Promise<PapernexusAccessResolution> {
  const accessMode = options.accessMode ?? "auto";
  const corpusRoot = options.corpusRoot ?? null;
  let remoteInspection: PapernexusRemoteAccessInspection | null = null;

  const getRemoteInspection = async (): Promise<PapernexusRemoteAccessInspection> => {
    if (remoteInspection) {
      return remoteInspection;
    }
    remoteInspection = await inspectPapernexusRemoteAccess(config, {
      env: options.env,
      platform: options.platform,
      commandRunner: options.commandRunner,
    });
    return remoteInspection;
  };

  // Remote API path
  if (accessMode === "remote_api" || accessMode === "auto") {
    const inspection = await getRemoteInspection();
    if (inspection.summary.apiBaseUrl && inspection.tokenAvailable) {
      return {
        mode: "remote_api",
        remoteInspection: inspection,
        corpusRoot,
        error: null,
      };
    }
    if (accessMode === "remote_api") {
      return {
        mode: "unavailable",
        remoteInspection: inspection,
        corpusRoot,
        error: buildRemoteApiUnavailableError(inspection),
      };
    }
    // accessMode === "auto" — fall through to remote MCP, then local MCP
  }

  // Remote MCP path
  if (accessMode === "remote_mcp" || accessMode === "auto") {
    const inspection = await getRemoteInspection();
    if (
      inspection.summary.mcpUrl &&
      inspection.summary.mcpTransport === "streamable-http" &&
      corpusRoot &&
      inspection.tokenAvailable
    ) {
      return {
        mode: "remote_mcp",
        remoteInspection: inspection,
        corpusRoot,
        error: null,
      };
    }
    if (accessMode === "remote_mcp") {
      return {
        mode: "unavailable",
        remoteInspection: inspection,
        corpusRoot,
        error: buildRemoteMcpUnavailableError(inspection, corpusRoot),
      };
    }
  }

  // Local MCP path
  if (accessMode === "local_mcp" || accessMode === "auto") {
    if (!corpusRoot) {
      return {
        mode: "unavailable",
        remoteInspection: null,
        corpusRoot: null,
        error: "Local MCP requires a corpus root path but none was provided.",
      };
    }
    const checkBin = options.checkLocalBin ?? defaultCheckLocalBin;
    const binAvailable = await checkBin("papernexus");
    if (binAvailable) {
      return {
        mode: "local_mcp",
        remoteInspection: null,
        corpusRoot,
        error: null,
      };
    }
    if (accessMode === "local_mcp") {
      return {
        mode: "unavailable",
        remoteInspection: null,
        corpusRoot,
        error: "papernexus CLI not found on PATH.",
      };
    }
  }

  return {
    mode: "unavailable",
    remoteInspection,
    corpusRoot,
    error: "Neither remote API, remote MCP, nor local MCP is available.",
  };
}

export async function resolvePapernexusMcpClientConfig(
  config: PapernexusRemoteAccessConfig | null | undefined,
  options: {
    accessMode?: PapernexusAccessMode;
    corpusRoot?: string | null;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    commandRunner?: PapernexusCommandRunner;
    checkLocalBin?: (bin: string) => Promise<boolean>;
  } = {}
): Promise<{
  access: PapernexusAccessResolution;
  clientConfig: PapernexusMcpClientConfig | null;
  error: string | null;
}> {
  const access = await resolvePapernexusAccessPath(config, options);
  if (access.mode === "local_mcp") {
    return {
      access,
      clientConfig: {
        transport: "stdio",
        corpusRoot: access.corpusRoot ?? "",
        timeoutMs: summarizePapernexusRemoteAccessConfig(config).mcpTimeoutMs,
      },
      error: null,
    };
  }

  if (
    access.mode === "remote_mcp" &&
    access.remoteInspection?.summary.mcpUrl &&
    access.remoteInspection.summary.mcpTransport
  ) {
    const headers =
      access.remoteInspection.token && access.remoteInspection.token.trim().length > 0
        ? {
            Authorization: `Bearer ${access.remoteInspection.token}`,
          }
        : undefined;
    return {
      access,
      clientConfig: {
        transport: access.remoteInspection.summary.mcpTransport,
        url: access.remoteInspection.summary.mcpUrl,
        headers,
        corpusRoot: access.corpusRoot ?? "",
        timeoutMs: access.remoteInspection.summary.mcpTimeoutMs,
      },
      error: null,
    };
  }

  return {
    access,
    clientConfig: null,
    error:
      access.mode === "remote_api"
        ? "Resolved PaperNexus access mode is remote_api; no MCP client should be constructed."
        : access.error ?? "No PaperNexus MCP client configuration could be resolved.",
  };
}

async function defaultCheckLocalBin(bin: string): Promise<boolean> {
  const { execFile: execFileCb } = await import("node:child_process");
  return new Promise((resolve) => {
    execFileCb(
      process.platform === "win32" ? "where" : "which",
      [bin],
      { timeout: 3000, windowsHide: true },
      (error) => resolve(!error)
    );
  });
}
