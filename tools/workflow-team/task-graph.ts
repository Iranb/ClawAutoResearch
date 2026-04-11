import path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";
import type { WorkflowStageTaskPreview } from "./stage-profiles";

export type WorkflowTaskGraphTaskStatus =
  | "claimable"
  | "claimed"
  | "satisfied"
  | "optional";

export type WorkflowTaskLease = {
  sessionKey: string;
  role: string | null;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type WorkflowTaskGraphTask = {
  taskId: string;
  title: string;
  owner: string | null;
  status: WorkflowTaskGraphTaskStatus;
  reason: string | null;
  lease: WorkflowTaskLease | null;
};

export type WorkflowTaskGraphStore = {
  schemaVersion: 1;
  source: "stage_preview_v1";
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  topTierVerdict: string | null;
  evidenceCloseoutStatus: EvidenceCloseoutSummary["status"];
  generatedAt: string;
  tasks: WorkflowTaskGraphTask[];
};

export type WorkflowTaskGraphSummary = {
  taskCount: number;
  claimableCount: number;
  claimedCount: number;
  satisfiedCount: number;
  optionalCount: number;
};

const TASK_GRAPH_FILENAME = "workflow-task-graph.json";
const DEFAULT_TASK_LEASE_TTL_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function mapPreviewStatusToTaskStatus(
  value: WorkflowStageTaskPreview["status"]
): WorkflowTaskGraphTaskStatus {
  switch (value) {
    case "ready":
      return "satisfied";
    case "optional":
      return "optional";
    case "blocked":
    default:
      return "claimable";
  }
}

function normalizeTask(
  value: unknown
): WorkflowTaskGraphTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const taskId =
    typeof record.taskId === "string" && record.taskId.trim()
      ? record.taskId.trim()
      : null;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : null;
  if (!taskId || !title) {
    return null;
  }
  const statusRaw =
    typeof record.status === "string" && record.status.trim()
      ? record.status.trim().toLowerCase()
      : "claimable";
  const status: WorkflowTaskGraphTaskStatus =
    statusRaw === "claimed" || statusRaw === "satisfied" || statusRaw === "optional"
      ? (statusRaw as WorkflowTaskGraphTaskStatus)
      : "claimable";
  const leaseRecord =
    record.lease && typeof record.lease === "object" && !Array.isArray(record.lease)
      ? (record.lease as Record<string, unknown>)
      : null;
  return {
    taskId,
    title,
    owner:
      typeof record.owner === "string" && record.owner.trim()
        ? record.owner.trim()
        : null,
    status,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : null,
    lease:
      leaseRecord &&
      typeof leaseRecord.sessionKey === "string" &&
      leaseRecord.sessionKey.trim()
        ? {
            sessionKey: leaseRecord.sessionKey.trim(),
            role:
              typeof leaseRecord.role === "string" && leaseRecord.role.trim()
                ? leaseRecord.role.trim()
                : null,
            claimedAt:
              typeof leaseRecord.claimedAt === "string" && leaseRecord.claimedAt.trim()
                ? leaseRecord.claimedAt
                : new Date(0).toISOString(),
            heartbeatAt:
              typeof leaseRecord.heartbeatAt === "string" && leaseRecord.heartbeatAt.trim()
                ? leaseRecord.heartbeatAt
                : new Date(0).toISOString(),
            expiresAt:
              typeof leaseRecord.expiresAt === "string" && leaseRecord.expiresAt.trim()
                ? leaseRecord.expiresAt
                : new Date(0).toISOString(),
          }
        : null,
  };
}

function buildLease(params: {
  sessionKey: string;
  role?: string | null;
  now?: string;
  ttlMs?: number;
}): WorkflowTaskLease {
  const now = params.now ?? nowIso();
  const ttlMs =
    typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs)
      ? Math.max(1_000, Math.floor(params.ttlMs))
      : DEFAULT_TASK_LEASE_TTL_MS;
  return {
    sessionKey: params.sessionKey,
    role:
      typeof params.role === "string" && params.role.trim() ? params.role.trim() : null,
    claimedAt: now,
    heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  };
}

function refreshLease(existing: WorkflowTaskLease, ttlMs?: number): WorkflowTaskLease {
  const now = nowIso();
  const ttl =
    typeof ttlMs === "number" && Number.isFinite(ttlMs)
      ? Math.max(1_000, Math.floor(ttlMs))
      : DEFAULT_TASK_LEASE_TTL_MS;
  return {
    ...existing,
    heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
  };
}

function isLeaseExpired(lease: WorkflowTaskLease | null, now = Date.now()): boolean {
  if (!lease) {
    return false;
  }
  const expiresAt = Date.parse(lease.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function getWorkflowTaskGraphPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", TASK_GRAPH_FILENAME);
}

function getWorkflowTaskGraphLockPath(projectRoot: string): string {
  return `${getWorkflowTaskGraphPath(projectRoot)}.lock`;
}

export async function readWorkflowTaskGraphStore(
  projectRoot: string
): Promise<WorkflowTaskGraphStore | null> {
  const store = await readJsonIfExists<WorkflowTaskGraphStore>(
    getWorkflowTaskGraphPath(projectRoot)
  );
  if (!store || !Array.isArray(store.tasks)) {
    return null;
  }
  return {
    schemaVersion: 1,
    source: "stage_preview_v1",
    projectId:
      typeof store.projectId === "string" && store.projectId.trim()
        ? store.projectId.trim()
        : null,
    projectRoot,
    stage:
      typeof store.stage === "string" && store.stage.trim()
        ? store.stage.trim()
        : null,
    topTierVerdict:
      typeof store.topTierVerdict === "string" && store.topTierVerdict.trim()
        ? store.topTierVerdict.trim()
        : null,
    evidenceCloseoutStatus:
      store.evidenceCloseoutStatus === "ready" ||
      store.evidenceCloseoutStatus === "blocked"
        ? store.evidenceCloseoutStatus
        : "not_applicable",
    generatedAt:
      typeof store.generatedAt === "string" && store.generatedAt.trim()
        ? store.generatedAt
        : new Date(0).toISOString(),
    tasks: store.tasks
      .map((task) => normalizeTask(task))
      .filter((task): task is WorkflowTaskGraphTask => Boolean(task)),
  };
}

export function summarizeWorkflowTaskGraphStore(
  store: WorkflowTaskGraphStore | null
): WorkflowTaskGraphSummary {
  const tasks = store?.tasks ?? [];
  return {
    taskCount: tasks.length,
    claimableCount: tasks.filter((task) => task.status === "claimable").length,
    claimedCount: tasks.filter((task) => task.status === "claimed").length,
    satisfiedCount: tasks.filter((task) => task.status === "satisfied").length,
    optionalCount: tasks.filter((task) => task.status === "optional").length,
  };
}

export async function materializeWorkflowTaskGraph(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  topTierVerdict: string | null;
  evidenceCloseout: EvidenceCloseoutSummary;
  previewTasks: WorkflowStageTaskPreview[];
}): Promise<WorkflowTaskGraphStore> {
  const existing = await readWorkflowTaskGraphStore(params.projectRoot);
  const existingByTaskId = new Map(
    (existing?.stage === params.stage ? existing.tasks : []).map((task) => [task.taskId, task])
  );
  const store: WorkflowTaskGraphStore = {
    schemaVersion: 1,
    source: "stage_preview_v1",
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stage: params.stage,
    topTierVerdict: params.topTierVerdict,
    evidenceCloseoutStatus: params.evidenceCloseout.status,
    generatedAt: nowIso(),
    tasks: params.previewTasks.map((task) => {
      const existingTask = existingByTaskId.get(task.taskId) ?? null;
      return {
        taskId: task.taskId,
        title: task.title,
        owner: task.owner,
        status:
          existingTask?.status === "claimed" && existingTask.lease
            ? "claimed"
            : mapPreviewStatusToTaskStatus(task.status),
        reason: task.reason,
        lease:
          existingTask?.status === "claimed" && existingTask.lease
            ? existingTask.lease
            : null,
      };
    }),
  };
  await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), store);
  return store;
}

export async function claimWorkflowTask(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
  role?: string | null;
  ttlMs?: number;
}): Promise<{
  claimed: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { claimed: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { claimed: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (current.status === "optional" || current.status === "satisfied") {
        return { claimed: false, reason: `task_not_claimable:${current.status}`, task: current };
      }
      if (
        current.status === "claimed" &&
        current.lease &&
        !isLeaseExpired(current.lease) &&
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { claimed: false, reason: "already_claimed", task: current };
      }
      const lease =
        current.status === "claimed" &&
        current.lease &&
        current.lease.sessionKey === params.sessionKey
          ? refreshLease(current.lease, params.ttlMs)
          : buildLease({
              sessionKey: params.sessionKey,
              role: params.role ?? null,
              ttlMs: params.ttlMs,
            });
      const claimedTask: WorkflowTaskGraphTask = {
        ...current,
        status: "claimed",
        lease,
      };
      nextTasks[taskIndex] = claimedTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { claimed: true, reason: null, task: claimedTask };
    },
  });
}

export async function renewWorkflowTaskLease(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
  ttlMs?: number;
}): Promise<{
  renewed: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { renewed: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { renewed: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (
        current.status !== "claimed" ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { renewed: false, reason: "not_owned", task: current };
      }
      const renewedTask: WorkflowTaskGraphTask = {
        ...current,
        lease: refreshLease(current.lease, params.ttlMs),
      };
      nextTasks[taskIndex] = renewedTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { renewed: true, reason: null, task: renewedTask };
    },
  });
}

export async function releaseWorkflowTaskClaim(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
}): Promise<{
  released: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { released: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { released: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (
        current.status !== "claimed" ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { released: false, reason: "not_owned", task: current };
      }
      const releasedTask: WorkflowTaskGraphTask = {
        ...current,
        status: "claimable",
        lease: null,
      };
      nextTasks[taskIndex] = releasedTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { released: true, reason: null, task: releasedTask };
    },
  });
}
