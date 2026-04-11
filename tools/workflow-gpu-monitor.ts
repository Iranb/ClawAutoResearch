import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { asRecord, normalizeStage, pickString } from "./workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import {
  getExperimentLedgerPath,
  isTerminalExperimentStatus,
  normalizeExperimentLedger,
} from "./workflow-guard-experiment-history";

const execFileAsync = promisify(execFile);

export const DEFAULT_EXPERIMENT_GPU_MONITOR_PATH =
  "researcher/EXPERIMENT_GPU_MONITOR.json";
const DEFAULT_GPU_MONITOR_STALE_MS = 10 * 60 * 1000;
const DEFAULT_SSH_TIMEOUT_MS = 15_000;

type RemoteRunRecord = {
  experimentId: string | null;
  experimentName: string | null;
  trackId: string | null;
  server: string | null;
  gpuId: string | null;
  screenName: string | null;
  status: string | null;
  remoteRunPath: string;
};

export type ExperimentGpuAssignment = {
  experimentId: string | null;
  experimentName: string | null;
  trackId: string | null;
  gpuId: string | null;
  screenName: string | null;
  remoteRunPath: string | null;
  recordedStatus: string | null;
  occupancy: "busy" | "idle" | "unknown";
  screenState: "present" | "missing" | "unknown";
  likelyFinished: boolean;
  conclusion: "running" | "likely_finished" | "unknown";
  reason: string;
};

export type ExperimentGpuServerSnapshot = {
  server: string;
  checkedAt: string;
  status: "ok" | "error";
  command: string;
  error: string | null;
  screenNames: string[];
  gpus: Array<{
    gpuId: string;
    name: string | null;
    memoryUsedMiB: number | null;
    memoryTotalMiB: number | null;
    utilizationGpu: number | null;
    occupancy: "busy" | "idle" | "unknown";
    assignedExperimentIds: string[];
    assignedScreenNames: string[];
  }>;
  assignments: ExperimentGpuAssignment[];
  busyAssignedGpuCount: number;
  idleAssignedGpuCount: number;
  likelyFinishedRunCount: number;
};

export type ExperimentGpuMonitorState = {
  schemaVersion: 1;
  checkedAt: string | null;
  status: "missing" | "fresh" | "stale" | "error";
  staleAfterMs: number;
  monitorPath: string;
  serverCount: number;
  activeTrackedRunCount: number;
  busyAssignedGpuCount: number;
  idleAssignedGpuCount: number;
  likelyFinishedRunCount: number;
  recommendation: "none" | "refresh_needed" | "monitor_running" | "reconcile_finished";
  servers: ExperimentGpuServerSnapshot[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRemoteRunStatus(value: unknown): string | null {
  return normalizeStage(value);
}

function isActiveRemoteRunStatus(status: string | null): boolean {
  return Boolean(
    status &&
      ["queued", "launching", "submitted", "running", "waiting", "monitoring"].includes(status)
  );
}

function getMonitorFilePath(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_EXPERIMENT_GPU_MONITOR_PATH);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findRemoteRunFiles(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) {
    return [];
  }
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findRemoteRunFiles(targetPath)));
      continue;
    }
    if (entry.isFile() && entry.name === "REMOTE_RUN.json") {
      files.push(targetPath);
    }
  }
  return files;
}

async function loadRemoteRunRecords(projectRoot: string): Promise<RemoteRunRecord[]> {
  const coderRoot = path.join(projectRoot, "coder");
  const files = await findRemoteRunFiles(coderRoot);
  const records: RemoteRunRecord[] = [];
  for (const filePath of files) {
    const raw = await readJsonIfExists<Record<string, unknown>>(filePath);
    const record = asRecord(raw);
    if (!record) {
      continue;
    }
    const server = pickString(record, ["server"]);
    const gpuId = pickString(record, ["gpuId", "gpu_id"]);
    const screenName = pickString(record, ["screenName", "screen_name"]);
    const status = normalizeRemoteRunStatus(record.status);
    const experimentId =
      pickString(record, ["experimentId", "experiment_id"]) ??
      pickString(record, ["experimentName", "experiment_name", "name"]);
    records.push({
      experimentId,
      experimentName: pickString(record, ["experimentName", "experiment_name", "name"]),
      trackId: pickString(record, ["trackId", "track_id"]),
      server,
      gpuId,
      screenName,
      status,
      remoteRunPath: path.relative(projectRoot, filePath),
    });
  }
  return records;
}

async function loadLedgerBackedRunRecords(projectRoot: string): Promise<RemoteRunRecord[]> {
  const ledgerPath = getExperimentLedgerPath(projectRoot);
  const raw = await readJsonIfExists<Record<string, unknown>>(ledgerPath);
  if (!raw) {
    return [];
  }
  const ledger = normalizeExperimentLedger(raw, path.basename(projectRoot));
  return ledger.experiments
    .filter((entry) => !isTerminalExperimentStatus(entry.status))
    .map((entry) => ({
      experimentId: entry.experimentId,
      experimentName: entry.name,
      trackId: entry.trackId,
      server: entry.server,
      gpuId: entry.gpuId,
      screenName: entry.screenName,
      status: entry.status,
      remoteRunPath: null,
    }))
    .map((entry) => ({
      ...entry,
      remoteRunPath: entry.remoteRunPath ?? "",
    }));
}

async function resolveProjectServers(projectRoot: string): Promise<string[]> {
  const projectServers = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "servers.json")
  );
  const list = Array.isArray(projectServers?.list)
    ? projectServers.list
        .map((entry) => readString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const defaultServer = readString(projectServers?.default);
  return Array.from(new Set([...(defaultServer ? [defaultServer] : []), ...list]));
}

function parseScreenNames(screenSection: string): string[] {
  return screenSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/\.(.+?)\s+\(/);
      return match?.[1]?.trim() ?? null;
    })
    .filter((value): value is string => Boolean(value));
}

function parseGpuLines(gpuSection: string): Array<{
  gpuId: string;
  name: string | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  utilizationGpu: number | null;
  occupancy: "busy" | "idle" | "unknown";
}> {
  return gpuSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [gpuIdRaw, nameRaw, memoryUsedRaw, memoryTotalRaw, utilizationRaw] = line
        .split(",")
        .map((entry) => entry.trim());
      const memoryUsedMiB = Number(memoryUsedRaw);
      const memoryTotalMiB = Number(memoryTotalRaw);
      const utilizationGpu = Number(utilizationRaw);
      const memoryRatio =
        Number.isFinite(memoryUsedMiB) &&
        Number.isFinite(memoryTotalMiB) &&
        memoryTotalMiB > 0
          ? memoryUsedMiB / memoryTotalMiB
          : null;
      const occupancy =
        Number.isFinite(utilizationGpu) &&
        utilizationGpu >= 10
          ? "busy"
          : memoryRatio !== null && memoryRatio >= 0.2
            ? "busy"
            : Number.isFinite(utilizationGpu) || memoryRatio !== null
              ? "idle"
              : "unknown";
      return {
        gpuId: gpuIdRaw,
        name: nameRaw || null,
        memoryUsedMiB: Number.isFinite(memoryUsedMiB) ? memoryUsedMiB : null,
        memoryTotalMiB: Number.isFinite(memoryTotalMiB) ? memoryTotalMiB : null,
        utilizationGpu: Number.isFinite(utilizationGpu) ? utilizationGpu : null,
        occupancy,
      };
    });
}

async function queryServerGpuStatus(params: {
  server: string;
  sshTimeoutMs?: number;
}) {
  const command =
    "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits; " +
    "printf '\\n---SCREENS---\\n'; " +
    "screen -ls 2>/dev/null || true";
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", params.server, command],
      {
        timeout: params.sshTimeoutMs ?? DEFAULT_SSH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: process.env,
      }
    );
    const [gpuSection, screenSection = ""] = stdout.split("\n---SCREENS---\n");
    return {
      status: "ok" as const,
      command,
      error: null,
      gpus: parseGpuLines(gpuSection ?? ""),
      screenNames: parseScreenNames(screenSection),
    };
  } catch (error) {
    return {
      status: "error" as const,
      command,
      error: error instanceof Error ? error.message : String(error),
      gpus: [],
      screenNames: [],
    };
  }
}

function buildAssignment(params: {
  run: RemoteRunRecord;
  gpuSnapshot:
    | {
        gpuId: string;
        occupancy: "busy" | "idle" | "unknown";
      }
    | undefined;
  screenNames: string[];
}): ExperimentGpuAssignment {
  const occupancy = params.gpuSnapshot?.occupancy ?? "unknown";
  const screenState = params.run.screenName
    ? params.screenNames.includes(params.run.screenName)
      ? "present"
      : "missing"
    : "unknown";
  const likelyFinished =
    occupancy === "idle" &&
    (screenState === "missing" || screenState === "unknown") &&
    isActiveRemoteRunStatus(params.run.status);
  const conclusion =
    occupancy === "busy" || screenState === "present"
      ? "running"
      : likelyFinished
        ? "likely_finished"
        : "unknown";
  const reason =
    conclusion === "running"
      ? screenState === "present"
        ? "screen session still present"
        : "assigned GPU still looks busy"
      : conclusion === "likely_finished"
        ? "assigned GPU is idle and the screen session is gone"
        : "GPU or screen state is inconclusive";
  return {
    experimentId: params.run.experimentId,
    experimentName: params.run.experimentName,
    trackId: params.run.trackId,
    gpuId: params.run.gpuId,
    screenName: params.run.screenName,
    remoteRunPath: params.run.remoteRunPath || null,
    recordedStatus: params.run.status,
    occupancy,
    screenState,
    likelyFinished,
    conclusion,
    reason,
  };
}

function buildEmptyGpuMonitorState(projectRoot: string): ExperimentGpuMonitorState {
  return {
    schemaVersion: 1,
    checkedAt: null,
    status: "missing",
    staleAfterMs: DEFAULT_GPU_MONITOR_STALE_MS,
    monitorPath: DEFAULT_EXPERIMENT_GPU_MONITOR_PATH,
    serverCount: 0,
    activeTrackedRunCount: 0,
    busyAssignedGpuCount: 0,
    idleAssignedGpuCount: 0,
    likelyFinishedRunCount: 0,
    recommendation: "none",
    servers: [],
  };
}

function summarizeGpuMonitorState(
  state: ExperimentGpuMonitorState
): ExperimentGpuMonitorState {
  const checkedAtMs = state.checkedAt ? Date.parse(state.checkedAt) : NaN;
  const isStale =
    Number.isFinite(checkedAtMs) &&
    Date.now() - checkedAtMs > (state.staleAfterMs || DEFAULT_GPU_MONITOR_STALE_MS);
  const status =
    state.serverCount === 0
      ? "missing"
      : state.servers.some((entry) => entry.status === "error")
        ? "error"
        : isStale
          ? "stale"
          : "fresh";
  const recommendation =
    state.likelyFinishedRunCount > 0
      ? "reconcile_finished"
      : state.activeTrackedRunCount > 0
        ? "monitor_running"
        : status === "stale"
          ? "refresh_needed"
          : "none";
  return {
    ...state,
    status,
    recommendation,
  };
}

export async function refreshExperimentGpuMonitor(params: {
  projectRoot: string;
  server?: string | null;
  servers?: string[] | null;
  sshTimeoutMs?: number;
}): Promise<{ state: ExperimentGpuMonitorState; monitorPath: string }> {
  const projectRoot = path.resolve(params.projectRoot);
  const remoteRunFiles = await loadRemoteRunRecords(projectRoot);
  const ledgerRuns = await loadLedgerBackedRunRecords(projectRoot);
  const activeRunMap = new Map<string, RemoteRunRecord>();
  for (const run of [...remoteRunFiles, ...ledgerRuns]) {
    if (!isActiveRemoteRunStatus(run.status)) {
      continue;
    }
    const key =
      [run.experimentId, run.server, run.gpuId, run.screenName].filter(Boolean).join("::") ||
      run.remoteRunPath;
    if (!key) {
      continue;
    }
    activeRunMap.set(key, run);
  }
  const activeRuns = [...activeRunMap.values()];
  const projectServers = await resolveProjectServers(projectRoot);
  const requestedServers = Array.isArray(params.servers)
    ? params.servers.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const serverSet = new Set<string>([
    ...(params.server ? [params.server] : []),
    ...requestedServers,
    ...projectServers,
    ...activeRuns
      .map((run) => run.server)
      .filter((entry): entry is string => Boolean(entry)),
  ]);
  const checkedAt = new Date().toISOString();
  const servers: ExperimentGpuServerSnapshot[] = [];
  for (const server of serverSet) {
    const queried = await queryServerGpuStatus({
      server,
      sshTimeoutMs: params.sshTimeoutMs,
    });
    const assignments = activeRuns
      .filter((run) => run.server === server)
      .map((run) =>
        buildAssignment({
          run,
          gpuSnapshot: queried.gpus.find((gpu) => gpu.gpuId === (run.gpuId ?? "")),
          screenNames: queried.screenNames,
        })
      );
    const gpus = queried.gpus.map((gpu) => {
      const gpuAssignments = assignments.filter((assignment) => assignment.gpuId === gpu.gpuId);
      return {
        ...gpu,
        assignedExperimentIds: gpuAssignments
          .map((assignment) => assignment.experimentId)
          .filter((entry): entry is string => Boolean(entry)),
        assignedScreenNames: gpuAssignments
          .map((assignment) => assignment.screenName)
          .filter((entry): entry is string => Boolean(entry)),
      };
    });
    servers.push({
      server,
      checkedAt,
      status: queried.status,
      command: queried.command,
      error: queried.error,
      screenNames: queried.screenNames,
      gpus,
      assignments,
      busyAssignedGpuCount: assignments.filter((entry) => entry.occupancy === "busy").length,
      idleAssignedGpuCount: assignments.filter((entry) => entry.occupancy === "idle").length,
      likelyFinishedRunCount: assignments.filter((entry) => entry.likelyFinished).length,
    });
  }
  const state = summarizeGpuMonitorState({
    schemaVersion: 1,
    checkedAt,
    status: "fresh",
    staleAfterMs: DEFAULT_GPU_MONITOR_STALE_MS,
    monitorPath: DEFAULT_EXPERIMENT_GPU_MONITOR_PATH,
    serverCount: servers.length,
    activeTrackedRunCount: activeRuns.length,
    busyAssignedGpuCount: servers.reduce((sum, server) => sum + server.busyAssignedGpuCount, 0),
    idleAssignedGpuCount: servers.reduce((sum, server) => sum + server.idleAssignedGpuCount, 0),
    likelyFinishedRunCount: servers.reduce(
      (sum, server) => sum + server.likelyFinishedRunCount,
      0
    ),
    recommendation: "none",
    servers,
  });
  const monitorPath = getMonitorFilePath(projectRoot);
  await writeJsonEnsured(monitorPath, state);
  return { state, monitorPath: DEFAULT_EXPERIMENT_GPU_MONITOR_PATH };
}

export async function getExperimentGpuMonitorStateSummary(params: {
  projectRoot: string;
}): Promise<{ state: ExperimentGpuMonitorState; ready: boolean }> {
  const monitorPath = getMonitorFilePath(params.projectRoot);
  const raw = await readJsonIfExists<Record<string, unknown>>(monitorPath);
  if (!raw) {
    return {
      state: buildEmptyGpuMonitorState(params.projectRoot),
      ready: false,
    };
  }
  const record = asRecord(raw) ?? {};
  const serversRaw = Array.isArray(record.servers) ? record.servers : [];
  const servers: ExperimentGpuServerSnapshot[] = serversRaw.map((entry) => {
    const item = asRecord(entry) ?? {};
    const assignmentsRaw = Array.isArray(item.assignments) ? item.assignments : [];
    const gpusRaw = Array.isArray(item.gpus) ? item.gpus : [];
    return {
      server: pickString(item, ["server"]) ?? "unknown-server",
      checkedAt:
        pickString(item, ["checkedAt", "checked_at"]) ??
        new Date(0).toISOString(),
      status: pickString(item, ["status"]) === "error" ? "error" : "ok",
      command: pickString(item, ["command"]) ?? "",
      error: pickString(item, ["error"]),
      screenNames: Array.isArray(item.screenNames)
        ? item.screenNames.map((value) => readString(value)).filter((value): value is string => Boolean(value))
        : [],
      gpus: gpusRaw.map((gpuEntry) => {
        const gpu = asRecord(gpuEntry) ?? {};
        return {
          gpuId: pickString(gpu, ["gpuId", "gpu_id"]) ?? "unknown",
          name: pickString(gpu, ["name"]),
          memoryUsedMiB: readNumber(gpu.memoryUsedMiB ?? gpu.memory_used_mib),
          memoryTotalMiB: readNumber(gpu.memoryTotalMiB ?? gpu.memory_total_mib),
          utilizationGpu: readNumber(gpu.utilizationGpu ?? gpu.utilization_gpu),
          occupancy:
            pickString(gpu, ["occupancy"]) === "busy"
              ? "busy"
              : pickString(gpu, ["occupancy"]) === "idle"
                ? "idle"
                : "unknown",
          assignedExperimentIds: Array.isArray(gpu.assignedExperimentIds)
            ? gpu.assignedExperimentIds
                .map((value) => readString(value))
                .filter((value): value is string => Boolean(value))
            : [],
          assignedScreenNames: Array.isArray(gpu.assignedScreenNames)
            ? gpu.assignedScreenNames
                .map((value) => readString(value))
                .filter((value): value is string => Boolean(value))
            : [],
        };
      }),
      assignments: assignmentsRaw.map((assignmentEntry) => {
        const assignment = asRecord(assignmentEntry) ?? {};
        return {
          experimentId: pickString(assignment, ["experimentId", "experiment_id"]),
          experimentName: pickString(assignment, ["experimentName", "experiment_name"]),
          trackId: pickString(assignment, ["trackId", "track_id"]),
          gpuId: pickString(assignment, ["gpuId", "gpu_id"]),
          screenName: pickString(assignment, ["screenName", "screen_name"]),
          remoteRunPath: pickString(assignment, ["remoteRunPath", "remote_run_path"]),
          recordedStatus: pickString(assignment, ["recordedStatus", "recorded_status"]),
          occupancy:
            pickString(assignment, ["occupancy"]) === "busy"
              ? "busy"
              : pickString(assignment, ["occupancy"]) === "idle"
                ? "idle"
                : "unknown",
          screenState:
            pickString(assignment, ["screenState", "screen_state"]) === "present"
              ? "present"
              : pickString(assignment, ["screenState", "screen_state"]) === "missing"
                ? "missing"
                : "unknown",
          likelyFinished: assignment.likelyFinished === true || assignment.likely_finished === true,
          conclusion:
            pickString(assignment, ["conclusion"]) === "running"
              ? "running"
              : pickString(assignment, ["conclusion"]) === "likely_finished"
                ? "likely_finished"
                : "unknown",
          reason: pickString(assignment, ["reason"]) ?? "unknown",
        };
      }),
      busyAssignedGpuCount:
        readNumber(item.busyAssignedGpuCount ?? item.busy_assigned_gpu_count) ?? 0,
      idleAssignedGpuCount:
        readNumber(item.idleAssignedGpuCount ?? item.idle_assigned_gpu_count) ?? 0,
      likelyFinishedRunCount:
        readNumber(item.likelyFinishedRunCount ?? item.likely_finished_run_count) ?? 0,
    };
  });
  const state = summarizeGpuMonitorState({
    schemaVersion: 1,
    checkedAt: pickString(record, ["checkedAt", "checked_at"]),
    status:
      pickString(record, ["status"]) === "error"
        ? "error"
        : pickString(record, ["status"]) === "stale"
          ? "stale"
          : pickString(record, ["status"]) === "fresh"
            ? "fresh"
            : "missing",
    staleAfterMs:
      readNumber(record.staleAfterMs ?? record.stale_after_ms) ?? DEFAULT_GPU_MONITOR_STALE_MS,
    monitorPath:
      pickString(record, ["monitorPath", "monitor_path"]) ??
      DEFAULT_EXPERIMENT_GPU_MONITOR_PATH,
    serverCount: readNumber(record.serverCount ?? record.server_count) ?? servers.length,
    activeTrackedRunCount:
      readNumber(record.activeTrackedRunCount ?? record.active_tracked_run_count) ?? 0,
    busyAssignedGpuCount:
      readNumber(record.busyAssignedGpuCount ?? record.busy_assigned_gpu_count) ?? 0,
    idleAssignedGpuCount:
      readNumber(record.idleAssignedGpuCount ?? record.idle_assigned_gpu_count) ?? 0,
    likelyFinishedRunCount:
      readNumber(record.likelyFinishedRunCount ?? record.likely_finished_run_count) ?? 0,
    recommendation:
      pickString(record, ["recommendation"]) === "reconcile_finished"
        ? "reconcile_finished"
        : pickString(record, ["recommendation"]) === "monitor_running"
          ? "monitor_running"
          : pickString(record, ["recommendation"]) === "refresh_needed"
            ? "refresh_needed"
            : "none",
    servers,
  });
  return {
    state,
    ready: state.status === "fresh" || state.status === "stale" || state.status === "error",
  };
}
