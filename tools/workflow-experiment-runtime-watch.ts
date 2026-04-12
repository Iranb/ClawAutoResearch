import fs from "node:fs/promises";
import path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStatus(value: unknown): string | null {
  const normalized = readString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? null;
  return normalized || null;
}

async function findFilesByName(rootDir: string, fileName: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  for (const entry of entries) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFilesByName(targetPath, fileName)));
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(targetPath);
    }
  }
  return results;
}

async function resolveRemoteRunPath(params: {
  projectRoot: string;
  experimentId?: string | null;
  remoteRunPath?: string | null;
}) {
  const explicit = readString(params.remoteRunPath);
  if (explicit) {
    return path.isAbsolute(explicit)
      ? path.resolve(explicit)
      : path.resolve(params.projectRoot, explicit);
  }
  const experimentId = readString(params.experimentId);
  if (!experimentId) {
    return null;
  }
  const candidates = await findFilesByName(path.join(params.projectRoot, "coder"), "REMOTE_RUN.json");
  for (const filePath of candidates) {
    const raw = await readJsonIfExists<Record<string, unknown>>(filePath);
    if (!raw) continue;
    const candidateExperimentId =
      readString(raw.experiment_id) ??
      readString(raw.experimentId) ??
      readString(raw.experiment_name) ??
      readString(raw.experimentName);
    if (candidateExperimentId === experimentId) {
      return filePath;
    }
  }
  return null;
}

function buildResultSummary(params: {
  signal: Record<string, unknown>;
  remoteRun: Record<string, unknown>;
}) {
  return {
    experiment_id:
      readString(params.signal.experimentId) ??
      readString(params.signal.experiment_id) ??
      readString(params.remoteRun.experiment_id) ??
      readString(params.remoteRun.experimentId),
    status:
      normalizeStatus(params.signal.status) ??
      normalizeStatus(params.remoteRun.status),
    key_metric: params.signal.keyMetric ?? params.signal.key_metric ?? null,
    metrics: typeof params.signal.metrics === "object" ? params.signal.metrics : null,
    result_paths: Array.isArray(params.signal.resultPaths)
      ? params.signal.resultPaths
      : Array.isArray(params.signal.result_paths)
        ? params.signal.result_paths
        : [],
    updated_at: new Date().toISOString(),
  };
}

export async function recordExperimentRuntimeSignal(params: {
  projectRoot: string;
  runtimeSignal: Record<string, unknown>;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const signal = params.runtimeSignal ?? {};
  const remoteRunPath = await resolveRemoteRunPath({
    projectRoot,
    experimentId: readString(signal.experimentId) ?? readString(signal.experiment_id),
    remoteRunPath: readString(signal.remoteRunPath) ?? readString(signal.remote_run_path),
  });
  if (!remoteRunPath) {
    throw new Error("Could not resolve REMOTE_RUN.json for experiment runtime signal.");
  }
  const runDir = path.dirname(remoteRunPath);
  const currentRemoteRun =
    (await readJsonIfExists<Record<string, unknown>>(remoteRunPath)) ?? {};
  const status =
    normalizeStatus(signal.status) ??
    normalizeStatus(currentRemoteRun.status) ??
    "running";
  const now = new Date().toISOString();

  const nextRemoteRun: Record<string, unknown> = {
    ...currentRemoteRun,
    status,
    updated_at: now,
    updatedAt: now,
    launched_at:
      readString(signal.launchedAt) ??
      readString(signal.launched_at) ??
      currentRemoteRun.launched_at ??
      currentRemoteRun.launchedAt ??
      currentRemoteRun.started_at ??
      currentRemoteRun.startedAt ??
      now,
    completed_at:
      ["completed", "done", "failed", "timeout", "stalled", "killed", "cancelled"].includes(status)
        ? readString(signal.completedAt) ??
          readString(signal.completed_at) ??
          currentRemoteRun.completed_at ??
          currentRemoteRun.completedAt ??
          now
        : null,
    result_paths:
      signal.resultPaths ??
      signal.result_paths ??
      currentRemoteRun.result_paths ??
      currentRemoteRun.resultPaths ??
      [],
    failure_signature:
      readString(signal.failureSignature) ??
      readString(signal.failure_signature) ??
      currentRemoteRun.failure_signature ??
      currentRemoteRun.failureSignature ??
      null,
  };

  await writeJsonEnsured(remoteRunPath, nextRemoteRun);

  const heartbeatPath = path.join(runDir, "RUN_HEARTBEAT.json");
  const terminalPath = path.join(runDir, "RUN_TERMINAL.json");
  const resultSummaryPath = path.join(runDir, "RESULT_SUMMARY.json");
  const failureSignaturePath = path.join(runDir, "FAILURE_SIGNATURE.json");

  if (
    ["queued", "launching", "submitted", "running", "waiting", "monitoring"].includes(status)
  ) {
    await writeJsonEnsured(heartbeatPath, {
      experiment_id:
        readString(nextRemoteRun.experiment_id) ??
        readString(nextRemoteRun.experimentId),
      status,
      heartbeat_at: now,
      server: readString(nextRemoteRun.server),
      gpu_id: readString(nextRemoteRun.gpu_id) ?? readString(nextRemoteRun.gpuId),
      screen_name:
        readString(nextRemoteRun.screen_name) ?? readString(nextRemoteRun.screenName),
    });
  }

  if (
    ["completed", "done", "failed", "timeout", "stalled", "killed", "cancelled"].includes(status)
  ) {
    await writeJsonEnsured(terminalPath, {
      experiment_id:
        readString(nextRemoteRun.experiment_id) ??
        readString(nextRemoteRun.experimentId),
      status,
      terminal_at: readString(nextRemoteRun.completed_at) ?? now,
      result_paths: nextRemoteRun.result_paths ?? [],
      failure_signature: nextRemoteRun.failure_signature ?? null,
    });
  }

  if (
    signal.keyMetric != null ||
    signal.key_metric != null ||
    signal.metrics != null ||
    (Array.isArray(nextRemoteRun.result_paths) && nextRemoteRun.result_paths.length > 0)
  ) {
    await writeJsonEnsured(
      resultSummaryPath,
      buildResultSummary({
        signal,
        remoteRun: nextRemoteRun,
      })
    );
  }

  if (readString(nextRemoteRun.failure_signature)) {
    await writeJsonEnsured(failureSignaturePath, {
      experiment_id:
        readString(nextRemoteRun.experiment_id) ??
        readString(nextRemoteRun.experimentId),
      failure_signature: readString(nextRemoteRun.failure_signature),
      updated_at: now,
    });
  }

  return {
    remoteRunPath: path.relative(projectRoot, remoteRunPath),
    heartbeatPath: path.relative(projectRoot, heartbeatPath),
    terminalPath:
      await readJsonIfExists(terminalPath) != null
        ? path.relative(projectRoot, terminalPath)
        : null,
    resultSummaryPath:
      await readJsonIfExists(resultSummaryPath) != null
        ? path.relative(projectRoot, resultSummaryPath)
        : null,
    failureSignaturePath:
      await readJsonIfExists(failureSignaturePath) != null
        ? path.relative(projectRoot, failureSignaturePath)
        : null,
    status,
  };
}
