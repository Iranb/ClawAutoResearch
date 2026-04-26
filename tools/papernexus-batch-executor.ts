import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PaperIngestionBatchItem,
  PaperIngestionBatchRun,
  PaperIngestionCompletedPaper,
  PaperIngestionPaperOperation,
  PaperIngestionQueueProgress,
  PaperIngestionQueuedRequest,
} from "./workflow-guard";
import {
  inspectPapernexusRemoteAccess,
  summarizePapernexusRemoteAccessConfig,
  type PapernexusRemoteAccessConfig,
} from "./papernexus-secret";

export const PAPERNEXUS_RESEARCHER_SCRIPT_DIR =
  "skills/researcher/papernexus/scripts";
export const PAPERNEXUS_LEGACY_SCRIPT_DIR = "skills/papernexus/scripts";
export const PAPERNEXUS_BATCH_IMPORT_SCRIPT = "pn_batch_import.py";

type BatchImportSubcommand = "template" | "submit" | "status" | "wait";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandEnv = NodeJS.ProcessEnv;

type BatchImportSummary = {
  total?: number;
  submitted?: number;
  completed?: number;
  running?: number;
  pending?: number;
  failed?: number;
  notSubmitted?: number;
  submitFailed?: number;
  remaining?: number;
  overallPercent?: number;
};

type BatchImportItem = {
  paperId?: string;
  canonicalId?: string;
  title?: string;
  taskId?: string;
  status?: string;
  stage?: string;
  submitted?: boolean;
  synced?: boolean;
  matchedBy?: string;
  error?: string;
  finishedAt?: string;
  progress?: Record<string, unknown>;
};

type BatchImportPayload = {
  manifest?: string;
  corpus?: string;
  summary?: BatchImportSummary;
  queueSummary?: PaperIngestionQueueProgress | Record<string, unknown>;
  items?: BatchImportItem[];
  error?: string;
};

export type PapernexusBatchExecutionState = {
  request: PaperIngestionQueuedRequest;
  runtimeStatus: "waiting_import" | "waiting_graph" | "blocked";
  waitingReason: string;
  activeBatches: PaperIngestionBatchRun[];
  batchItems: PaperIngestionBatchItem[];
  paperOperations: PaperIngestionPaperOperation[];
  completedPapers: PaperIngestionCompletedPaper[];
  importTaskIds: string[];
  queueProgress: PaperIngestionQueueProgress | null;
  lastImportTaskId: string | null;
  lastImportStatus: string | null;
  repairRequired: boolean;
  repairReason: string | null;
  commandOutputs: {
    submitted?: CommandResult;
    waited?: CommandResult;
    status?: CommandResult;
  };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPapernexusScriptRelativePath(
  scriptName = PAPERNEXUS_BATCH_IMPORT_SCRIPT
): string {
  return path.posix.join(PAPERNEXUS_RESEARCHER_SCRIPT_DIR, scriptName);
}

export function resolvePapernexusScriptPath(
  scriptName = PAPERNEXUS_BATCH_IMPORT_SCRIPT
): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const overrideScriptDir = readString(process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR);
  const candidates = [
    overrideScriptDir ? path.resolve(overrideScriptDir, scriptName) : null,
    path.resolve(moduleDir, "..", PAPERNEXUS_RESEARCHER_SCRIPT_DIR, scriptName),
    path.resolve(moduleDir, "..", "..", PAPERNEXUS_RESEARCHER_SCRIPT_DIR, scriptName),
    path.resolve(process.cwd(), PAPERNEXUS_RESEARCHER_SCRIPT_DIR, scriptName),
    path.resolve(moduleDir, "..", PAPERNEXUS_LEGACY_SCRIPT_DIR, scriptName),
    path.resolve(moduleDir, "..", "..", PAPERNEXUS_LEGACY_SCRIPT_DIR, scriptName),
    path.resolve(process.cwd(), PAPERNEXUS_LEGACY_SCRIPT_DIR, scriptName),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `Could not locate PaperNexus script ${scriptName}. Checked: ${candidates.join(", ")}`
    );
  }
  return resolved;
}

export function buildPapernexusBatchImportCommandText(args: string[]): string {
  return [
    "python3",
    buildPapernexusScriptRelativePath(PAPERNEXUS_BATCH_IMPORT_SCRIPT),
    ...args.map((arg) =>
      arg.startsWith("-") || isBatchImportSubcommand(arg) ? arg : shellQuote(arg)
    ),
  ].join(" ");
}

function isBatchImportSubcommand(value: string | null | undefined): value is BatchImportSubcommand {
  return value === "template" || value === "submit" || value === "status" || value === "wait";
}

export function splitShellLike(commandText: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of commandText) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function stripBackgroundContinuation(args: string[]): string[] {
  const markerIndex = args.findIndex(
    (arg, index) =>
      arg === "__BACKGROUND_CONTINUATION__:" ||
      arg === "__BACKGROUND_CONTINUATION__" ||
      (arg === "--" &&
        /__BACKGROUND_CONTINUATION__:?/i.test(args[index + 1] ?? ""))
  );
  return markerIndex >= 0 ? args.slice(0, markerIndex) : args;
}

function argsFromCommandText(commandText: string | null): string[] {
  const tokens = commandText ? splitShellLike(commandText) : [];
  const scriptIndex = tokens.findIndex((token) =>
    /(?:^|\/)pn_batch_import\.py$/i.test(token)
  );
  if (scriptIndex < 0) {
    return [];
  }
  return stripBackgroundContinuation(tokens.slice(scriptIndex + 1));
}

export function getPapernexusBatchImportArgs(
  request: Pick<PaperIngestionQueuedRequest, "args" | "commandText">
): string[] {
  const args = request.args.length > 0 ? request.args : argsFromCommandText(request.commandText);
  return stripBackgroundContinuation(args);
}

function splitBatchArgs(args: string[]): {
  globalArgs: string[];
  subcommand: BatchImportSubcommand | null;
  subcommandArgs: string[];
} {
  const index = args.findIndex((arg) => isBatchImportSubcommand(arg));
  if (index < 0) {
    return { globalArgs: args, subcommand: null, subcommandArgs: [] };
  }
  return {
    globalArgs: args.slice(0, index),
    subcommand: args[index] as BatchImportSubcommand,
    subcommandArgs: args.slice(index + 1),
  };
}

function ensureJsonGlobalArg(args: string[]): string[] {
  if (args.includes("--json")) {
    return args;
  }
  const parsed = splitBatchArgs(args);
  if (!parsed.subcommand) {
    return [...args, "--json"];
  }
  return [...parsed.globalArgs, "--json", parsed.subcommand, ...parsed.subcommandArgs];
}

function replaceBatchSubcommand(
  args: string[],
  subcommand: BatchImportSubcommand,
  subcommandArgs: string[] = []
): string[] {
  const parsed = splitBatchArgs(args);
  return [...parsed.globalArgs, subcommand, ...subcommandArgs];
}

export function buildPapernexusBatchImportWaitArgs(
  args: string[],
  options?: {
    timeoutSeconds?: number;
    intervalSeconds?: number;
  }
): string[] {
  return replaceBatchSubcommand(args, "wait", [
    "--timeout",
    String(Math.max(1, Math.floor(options?.timeoutSeconds ?? 60))),
    "--interval",
    String(Math.max(0.1, options?.intervalSeconds ?? 5)),
  ]);
}

export function isPapernexusBatchImportLifecycleRequest(
  request: Pick<PaperIngestionQueuedRequest, "wrapper" | "commandText" | "args">
): boolean {
  if (request.wrapper === PAPERNEXUS_BATCH_IMPORT_SCRIPT) {
    return true;
  }
  return /(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/scripts\/)?pn_batch_import\.py\b/i.test(
    request.commandText ?? ""
  );
}

function parsePayload(result: CommandResult): BatchImportPayload | null {
  const text = result.stdout.trim() || result.stderr.trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BatchImportPayload)
      : null;
  } catch {
    return null;
  }
}

function runCommand(params: {
  projectRoot: string;
  scriptPath: string;
  args: string[];
  timeoutMs: number;
  env: CommandEnv;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", [params.scriptPath, ...ensureJsonGlobalArg(params.args)], {
      cwd: params.projectRoot,
      env: params.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, params.timeoutMs);
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function buildPapernexusCommandEnv(
  remoteAccess: PapernexusRemoteAccessConfig | null | undefined
): Promise<CommandEnv> {
  const env: CommandEnv = { ...process.env };
  const summary = summarizePapernexusRemoteAccessConfig(remoteAccess);
  if (summary.apiBaseUrl && !readString(env.PAPERNEXUS_API_BASE_URL)) {
    env.PAPERNEXUS_API_BASE_URL = summary.apiBaseUrl;
  }
  if (summary.mcpUrl && !readString(env.PAPERNEXUS_MCP_URL)) {
    env.PAPERNEXUS_MCP_URL = summary.mcpUrl;
  }

  const configuredTokenEnv = readString(summary.tokenEnv);
  if (readString(env.PAPERNEXUS_API_TOKEN)) {
    if (configuredTokenEnv && !readString(env[configuredTokenEnv])) {
      env[configuredTokenEnv] = env.PAPERNEXUS_API_TOKEN;
    }
    return env;
  }

  const inspection = await inspectPapernexusRemoteAccess(remoteAccess);
  if (inspection.token) {
    env.PAPERNEXUS_API_TOKEN = inspection.token;
    if (configuredTokenEnv) {
      env[configuredTokenEnv] = inspection.token;
    }
  }
  return env;
}

function normalizeItemStatus(value: string | null): PaperIngestionBatchItem["status"] {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "pending" || normalized === "running" || normalized === "completed" || normalized === "failed") {
    return normalized;
  }
  if (normalized === "submit-failed" || normalized === "submit_failed") {
    return "submit_failed";
  }
  return null;
}

function normalizeOperationStatus(
  value: PaperIngestionBatchItem["status"]
): PaperIngestionPaperOperation["status"] {
  if (value === "completed") {
    return "completed";
  }
  if (value === "failed" || value === "submit_failed") {
    return "failed";
  }
  return "running";
}

function batchStatusFromPayload(payload: BatchImportPayload | null): PaperIngestionBatchRun["status"] {
  const summary = payload?.summary;
  if (!summary) {
    return "running";
  }
  const total = Math.max(0, Math.floor(summary.total ?? 0));
  const failed = Math.max(0, Math.floor((summary.failed ?? 0) + (summary.submitFailed ?? 0)));
  const completed = Math.max(0, Math.floor(summary.completed ?? 0));
  const remaining = Math.max(0, Math.floor(summary.remaining ?? 0));
  if (total > 0 && completed >= total && failed === 0) {
    return "completed";
  }
  if (failed > 0 && remaining === 0) {
    return "failed";
  }
  return "running";
}

function batchItemKey(item: BatchImportItem): string | null {
  return readString(item.canonicalId) ?? readString(item.paperId) ?? readString(item.title);
}

function isTerminalFailedBatchStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "failed" || normalized === "submit-failed" || normalized === "submit_failed";
}

function isUnsubmittedBatchStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "not-submitted" || normalized === "not_submitted";
}

function mergeSubmitFailureDetails(params: {
  latest: BatchImportPayload | null;
  submitted: BatchImportPayload | null;
}): BatchImportPayload | null {
  if (!params.latest || !Array.isArray(params.latest.items)) {
    return params.latest;
  }
  const submitItems = Array.isArray(params.submitted?.items) ? params.submitted.items : [];
  const submitFailuresByKey = new Map<string, BatchImportItem>();
  for (const item of submitItems) {
    const key = batchItemKey(item);
    if (key && isTerminalFailedBatchStatus(item.status)) {
      submitFailuresByKey.set(key, item);
    }
  }
  if (submitFailuresByKey.size === 0) {
    return params.latest;
  }
  return {
    ...params.latest,
    items: params.latest.items.map((item) => {
      const key = batchItemKey(item);
      const submitFailure = key ? submitFailuresByKey.get(key) : null;
      if (!submitFailure) {
        return item;
      }
      return {
        ...item,
        ...submitFailure,
        status: submitFailure.status,
        error: readString(submitFailure.error) ?? readString(item.error) ?? undefined,
      };
    }),
    summary: params.latest.summary
      ? {
          ...params.latest.summary,
          failed:
            params.latest.summary.failed ??
            submitItems.filter((item) => isTerminalFailedBatchStatus(item.status)).length,
          submitFailed:
            params.latest.summary.submitFailed ??
            submitItems.filter((item) => isTerminalFailedBatchStatus(item.status)).length,
        }
      : params.latest.summary,
  };
}

function hasUnsubmittedBatchItems(payload: BatchImportPayload | null): boolean {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.some(
    (item) =>
      isUnsubmittedBatchStatus(item.status) ||
      (item.submitted === false && !readString(item.taskId))
  );
}

function summarizeTerminalBatchFailures(
  payload: BatchImportPayload | null,
  fallback: string
): string {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const failures = items
    .filter((item) => isTerminalFailedBatchStatus(item.status))
    .map((item) => {
      const label = readString(item.canonicalId) ?? readString(item.paperId) ?? readString(item.title) ?? "unknown-paper";
      const error = readString(item.error);
      return error ? `${label}: ${error}` : label;
    });
  if (failures.length === 0) {
    return readString(payload?.error) ?? fallback;
  }
  return `PaperNexus batch reported failed item(s): ${failures.slice(0, 5).join("; ")}${
    failures.length > 5 ? "; ..." : ""
  }`;
}

function normalizeQueueProgress(value: unknown): PaperIngestionQueueProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const total = readNumber(record.total);
  const pending = readNumber(record.pending);
  const running = readNumber(record.running);
  const completed = readNumber(record.completed);
  const failed = readNumber(record.failed);
  const remaining = readNumber(record.remaining);
  const overallPercent = readNumber(record.overallPercent ?? record.overall_percent);
  return {
    total: total == null ? null : Math.max(0, Math.floor(total)),
    pending: pending == null ? null : Math.max(0, Math.floor(pending)),
    running: running == null ? null : Math.max(0, Math.floor(running)),
    completed: completed == null ? null : Math.max(0, Math.floor(completed)),
    failed: failed == null ? null : Math.max(0, Math.floor(failed)),
    remaining: remaining == null ? null : Math.max(0, Math.floor(remaining)),
    overallPercent:
      overallPercent == null
        ? null
        : Math.max(0, Math.min(100, Math.round(overallPercent))),
  };
}

function payloadToStatePatch(params: {
  request: PaperIngestionQueuedRequest;
  payload: BatchImportPayload | null;
  argsForNextPass: string[];
  nowIso: string;
  terminal: boolean;
  failed: boolean;
  error: string | null;
}): Omit<PapernexusBatchExecutionState, "commandOutputs"> {
  const summary = params.payload?.summary ?? {};
  const items = Array.isArray(params.payload?.items) ? params.payload.items : [];
  const batchStatus = params.failed ? "failed" : batchStatusFromPayload(params.payload);
  const manifestPath =
    readString(params.request.manifestPath) ?? readString(params.payload?.manifest) ?? null;
  const importTaskIds = items
    .map((item) => readString(item.taskId))
    .filter((entry): entry is string => Boolean(entry));
  const batchItems: PaperIngestionBatchItem[] = items.map((item) => {
    const status = normalizeItemStatus(readString(item.status));
    return {
      manifestPath,
      paperId: readString(item.paperId),
      canonicalId: readString(item.canonicalId) ?? readString(item.paperId),
      title: readString(item.title),
      importTaskId: readString(item.taskId),
      status,
      stage: readString(item.stage),
      submitted: item.submitted === true,
      synced: item.synced === true,
      matchedBy: readString(item.matchedBy),
      error: readString(item.error),
      updatedAt: params.nowIso,
    };
  });
  const paperOperations: PaperIngestionPaperOperation[] = batchItems.map((item) => {
    const status = normalizeOperationStatus(item.status);
    return {
      canonicalId: item.canonicalId ?? item.paperId,
      title: item.title,
      importTaskId: item.importTaskId,
      phase: "import",
      status,
      timeoutSeconds: null,
      startedAt: params.request.startedAt ?? params.nowIso,
      deadlineAt: null,
      finishedAt: status === "completed" || status === "failed" ? params.nowIso : null,
      detail: item.error ?? null,
    };
  });
  const completedPapers = batchItems
    .filter((item) => item.synced || item.status === "completed")
    .map((item): PaperIngestionCompletedPaper => ({
      canonicalId: item.canonicalId ?? item.paperId,
      title: item.title,
      importTaskId: item.importTaskId,
    }));
  const activeBatches: PaperIngestionBatchRun[] = [
    {
      manifestPath,
      status: params.terminal ? batchStatus : "running",
      total: summary.total ?? params.request.paperCount,
      submitted: summary.submitted ?? null,
      completed: summary.completed ?? null,
      running: summary.running ?? null,
      pending: summary.pending ?? null,
      failed: summary.failed ?? null,
      submitFailed: summary.submitFailed ?? null,
      startedAt: params.request.startedAt ?? params.nowIso,
      updatedAt: params.nowIso,
      finishedAt: params.terminal ? params.nowIso : null,
      detail:
        params.error ??
        (params.terminal
          ? "PaperNexus batch import reached a terminal remote state."
          : "PaperNexus batch import is still running remotely; workflow will poll again."),
    },
  ];
  const failedItems = batchItems.filter(
    (item) => item.status === "failed" || item.status === "submit_failed"
  );
  const unsubmittedItems = items.filter((item) => isUnsubmittedBatchStatus(item.status));
  const waitingImport = !params.terminal && !params.failed;
  const nextRequest: PaperIngestionQueuedRequest = {
    ...params.request,
    status: params.failed ? "needs_repair" : params.terminal ? "completed" : "queued",
    args: params.argsForNextPass,
    commandText: buildPapernexusBatchImportCommandText(params.argsForNextPass),
    updatedAt: params.nowIso,
    startedAt: params.request.startedAt ?? params.nowIso,
    finishedAt: params.terminal || params.failed ? params.nowIso : params.request.finishedAt,
    lastAttemptAt: params.nowIso,
    lastRunId: `direct-papernexus-batch-${params.request.requestId}`,
    lastSessionKey: "local:papernexus:direct-batch-import",
    lastError: params.error,
    nextRetryAt: null,
    deadLetterAt: null,
    deadLetterReason: null,
    detail:
      params.error ??
      (params.terminal
        ? "Workflow-owned PaperNexus batch import completed remotely; graph presence verification is now authoritative."
        : unsubmittedItems.length > 0
          ? "Workflow-owned PaperNexus batch import still has manifest items without remote task ids; the next pass will retry submit for missing task references."
          : "Workflow-owned PaperNexus batch import submitted and is still running remotely; the next pass will poll/wait instead of resubmitting."),
  };
  if (params.failed) {
    nextRequest.deadLetterAt =
      (params.request.attemptCount ?? 0) + 1 >= (params.request.maxAttempts ?? 3)
        ? params.nowIso
        : null;
    nextRequest.deadLetterReason = nextRequest.deadLetterAt ? params.error : null;
    nextRequest.status = nextRequest.deadLetterAt ? "failed" : "needs_repair";
    nextRequest.attemptCount = (params.request.attemptCount ?? 0) + 1;
  } else if (splitBatchArgs(params.request.args).subcommand === "submit") {
    nextRequest.attemptCount = (params.request.attemptCount ?? 0) + 1;
  }
  return {
    request: nextRequest,
    runtimeStatus: params.failed ? "blocked" : waitingImport ? "waiting_import" : "waiting_graph",
    waitingReason: params.failed
      ? `PaperNexus batch import failed: ${params.error ?? "unknown error"}`
      : waitingImport
        ? unsubmittedItems.length > 0
          ? "PaperNexus remote batch import has unsubmitted manifest items; workflow will retry submit instead of treating the batch as terminal failure."
          : "PaperNexus remote batch import is still running; workflow will continue with bounded wait/status passes."
        : "PaperNexus remote batch import completed; waiting for graph presence verification.",
    activeBatches,
    batchItems,
    paperOperations,
    completedPapers,
    importTaskIds,
    queueProgress: normalizeQueueProgress(params.payload?.queueSummary),
    lastImportTaskId: importTaskIds[importTaskIds.length - 1] ?? null,
    lastImportStatus:
      failedItems.length > 0
        ? "failed"
        : params.terminal
          ? "completed"
          : items.length > 0
            ? "running"
            : null,
    repairRequired: params.failed,
    repairReason: params.failed ? params.error : null,
  };
}

function allItemsSynced(payload: BatchImportPayload | null): boolean {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) {
    return false;
  }
  return items.every(
    (item) =>
      item.synced === true ||
      (String(item.status ?? "").toLowerCase() === "completed" &&
        String(item.stage ?? "").toLowerCase() === "completed")
  );
}

function hasTerminalFailure(payload: BatchImportPayload | null): boolean {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.some((item) => isTerminalFailedBatchStatus(item.status));
}

function commandError(result: CommandResult, fallback: string): string {
  const payload = parsePayload(result);
  return (
    readString(payload?.error) ??
    readString(result.stderr) ??
    readString(result.stdout) ??
    fallback
  );
}

export async function executePapernexusBatchImportRequest(params: {
  projectRoot: string;
  request: PaperIngestionQueuedRequest;
  waitTimeoutSeconds?: number;
  waitIntervalSeconds?: number;
  commandTimeoutMs?: number;
  remoteAccess?: PapernexusRemoteAccessConfig | null;
}): Promise<PapernexusBatchExecutionState | null> {
  if (!isPapernexusBatchImportLifecycleRequest(params.request)) {
    return null;
  }
  const rawArgs = getPapernexusBatchImportArgs(params.request);
  const parsed = splitBatchArgs(rawArgs);
  if (!parsed.subcommand || !["submit", "status", "wait"].includes(parsed.subcommand)) {
    return null;
  }

  const scriptPath = resolvePapernexusScriptPath(PAPERNEXUS_BATCH_IMPORT_SCRIPT);
  const commandEnv = await buildPapernexusCommandEnv(params.remoteAccess);
  const waitArgs = buildPapernexusBatchImportWaitArgs(rawArgs, {
    timeoutSeconds: params.waitTimeoutSeconds,
    intervalSeconds: params.waitIntervalSeconds,
  });
  const statusArgs = replaceBatchSubcommand(rawArgs, "status");
  const commandOutputs: PapernexusBatchExecutionState["commandOutputs"] = {};

  let payload: BatchImportPayload | null = null;
  let submitPayload: BatchImportPayload | null = null;
  let failed = false;
  let terminal = false;
  let error: string | null = null;

  if (parsed.subcommand === "submit") {
    const submitted = await runCommand({
      projectRoot: params.projectRoot,
      scriptPath,
      args: rawArgs,
      timeoutMs: params.commandTimeoutMs ?? 180_000,
      env: commandEnv,
    });
    commandOutputs.submitted = submitted;
    submitPayload = parsePayload(submitted);
    if (submitted.exitCode !== 0) {
      failed = true;
      payload = submitPayload;
      error = summarizeTerminalBatchFailures(
        submitPayload,
        commandError(submitted, "PaperNexus batch submit failed.")
      );
    } else {
      payload = submitPayload;
    }
  }

  if (!failed) {
    const waited = await runCommand({
      projectRoot: params.projectRoot,
      scriptPath,
      args: waitArgs,
      timeoutMs:
        params.commandTimeoutMs ??
        Math.max(90_000, Math.floor((params.waitTimeoutSeconds ?? 60) * 1000) + 20_000),
      env: commandEnv,
    });
    commandOutputs.waited = waited;
    const waitPayload = mergeSubmitFailureDetails({
      latest: parsePayload(waited),
      submitted: submitPayload,
    });
    if (waited.exitCode === 0 && waitPayload) {
      payload = waitPayload;
      terminal = allItemsSynced(waitPayload);
      failed = hasTerminalFailure(waitPayload);
      error = failed
        ? summarizeTerminalBatchFailures(
            waitPayload,
            "PaperNexus batch wait reached terminal failed items."
          )
        : null;
    } else {
      const status = await runCommand({
        projectRoot: params.projectRoot,
        scriptPath,
        args: statusArgs,
        timeoutMs: params.commandTimeoutMs ?? 120_000,
        env: commandEnv,
      });
      commandOutputs.status = status;
      const statusPayload = mergeSubmitFailureDetails({
        latest: parsePayload(status),
        submitted: submitPayload,
      });
      if (status.exitCode !== 0) {
        failed = true;
        error = commandError(status, "PaperNexus batch status failed after wait timeout.");
        payload = statusPayload ?? payload;
      } else {
        payload = statusPayload ?? payload;
        terminal = allItemsSynced(payload);
        failed = hasTerminalFailure(payload) && !terminal;
        error = failed
          ? summarizeTerminalBatchFailures(
              payload,
              "PaperNexus batch status reported terminal failed items."
            )
          : null;
      }
    }
  }

  const nowIso = new Date().toISOString();
  const retrySubmitMissingItems =
    !terminal && !failed && hasUnsubmittedBatchItems(payload);
  const argsForNextPass = retrySubmitMissingItems
    ? replaceBatchSubcommand(rawArgs, "submit")
    : waitArgs;
  return {
    ...payloadToStatePatch({
      request: params.request,
      payload,
      argsForNextPass,
      nowIso,
      terminal,
      failed,
      error,
    }),
    commandOutputs,
  };
}
