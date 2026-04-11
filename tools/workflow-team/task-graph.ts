import path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";
import type {
  WorkflowStageTaskPreview,
  WorkflowTaskVerificationRule,
} from "./stage-profiles";

export type WorkflowTaskGraphTaskStatus =
  | "claimable"
  | "claimed"
  | "verifying"
  | "needs_repair"
  | "satisfied"
  | "optional";

export type WorkflowTaskVerificationStatus =
  | "not_required"
  | "pending"
  | "passed"
  | "failed";

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
  dependsOn: string[];
  verificationRule: WorkflowTaskVerificationRule;
  verificationStatus: WorkflowTaskVerificationStatus;
  lease: WorkflowTaskLease | null;
  satisfiedAt: string | null;
  satisfiedBy: string | null;
  completionNote: string | null;
  latestEventKind: string | null;
  latestEventSummary: string | null;
  latestEventAt: string | null;
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
  blockedCount: number;
  claimedCount: number;
  verifyingCount: number;
  needsRepairCount: number;
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

function mapPreviewStatusToVerificationStatus(
  value: WorkflowStageTaskPreview["status"],
  verificationRule: WorkflowTaskVerificationRule
): WorkflowTaskVerificationStatus {
  if (verificationRule === "none") {
    return "not_required";
  }
  return value === "ready" ? "passed" : "pending";
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
    statusRaw === "completed"
      ? "satisfied"
      : statusRaw === "blocked"
        ? "claimable"
        : statusRaw === "claimed" ||
            statusRaw === "verifying" ||
            statusRaw === "needs_repair" ||
            statusRaw === "satisfied" ||
            statusRaw === "optional"
          ? (statusRaw as WorkflowTaskGraphTaskStatus)
          : "claimable";
  const leaseRecord =
    record.lease && typeof record.lease === "object" && !Array.isArray(record.lease)
      ? (record.lease as Record<string, unknown>)
      : null;
  const verificationRuleRaw =
    typeof record.verificationRule === "string" && record.verificationRule.trim()
      ? record.verificationRule.trim()
      : "none";
  const verificationRule = [
    "none",
    "benchmark_protocol",
    "statistical_evidence",
    "ablation_evidence",
    "mechanism_evidence",
    "venue_competition",
    "reproducibility_pack",
    "camera_ready_evidence",
    "write_closeout",
    "submit_closeout",
  ].includes(verificationRuleRaw)
    ? (verificationRuleRaw as WorkflowTaskVerificationRule)
    : "none";
  const verificationStatusRaw =
    typeof record.verificationStatus === "string" && record.verificationStatus.trim()
      ? record.verificationStatus.trim()
      : verificationRule === "none"
        ? "not_required"
        : "pending";
  const verificationStatus = [
    "not_required",
    "pending",
    "passed",
    "failed",
  ].includes(verificationStatusRaw)
    ? (verificationStatusRaw as WorkflowTaskVerificationStatus)
    : verificationRule === "none"
      ? "not_required"
      : "pending";
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
    dependsOn: Array.isArray(record.dependsOn ?? record.depends_on)
      ? (record.dependsOn ?? record.depends_on).filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
        )
      : [],
    verificationRule,
    verificationStatus,
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
    satisfiedAt:
      typeof record.satisfiedAt === "string" && record.satisfiedAt.trim()
        ? record.satisfiedAt
        : null,
    satisfiedBy:
      typeof record.satisfiedBy === "string" && record.satisfiedBy.trim()
        ? record.satisfiedBy
        : null,
    completionNote:
      typeof record.completionNote === "string" && record.completionNote.trim()
        ? record.completionNote
        : null,
    latestEventKind:
      typeof record.latestEventKind === "string" && record.latestEventKind.trim()
        ? record.latestEventKind
        : null,
    latestEventSummary:
      typeof record.latestEventSummary === "string" && record.latestEventSummary.trim()
        ? record.latestEventSummary
        : null,
    latestEventAt:
      typeof record.latestEventAt === "string" && record.latestEventAt.trim()
        ? record.latestEventAt
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

function applyTaskEvent(
  task: WorkflowTaskGraphTask,
  kind: string,
  summary: string | null
): WorkflowTaskGraphTask {
  return {
    ...task,
    latestEventKind: kind,
    latestEventSummary: summary,
    latestEventAt: nowIso(),
  };
}

function areTaskDependenciesSatisfied(
  tasks: WorkflowTaskGraphTask[],
  task: WorkflowTaskGraphTask
): boolean {
  if (!task.dependsOn.length) {
    return true;
  }
  const satisfiedIds = new Set(
    tasks.filter((entry) => entry.status === "satisfied").map((entry) => entry.taskId)
  );
  return task.dependsOn.every((taskId) => satisfiedIds.has(taskId));
}

function releaseExpiredTask(task: WorkflowTaskGraphTask, now = Date.now()): WorkflowTaskGraphTask {
  if (!task.lease || !isLeaseExpired(task.lease, now)) {
    return task;
  }
  return applyTaskEvent({
    ...task,
    status: "claimable",
    lease: null,
    satisfiedAt: null,
    satisfiedBy: null,
    completionNote: null,
    verificationStatus:
      task.verificationRule === "none"
        ? "not_required"
        : task.status === "needs_repair"
          ? "failed"
          : "pending",
  }, "lease_expired", "Task lease expired and returned to claimable state.");
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
    claimableCount: tasks.filter(
      (task) => task.status === "claimable" && areTaskDependenciesSatisfied(tasks, task)
    ).length,
    blockedCount: tasks.filter(
      (task) =>
        (task.status === "claimable" && !areTaskDependenciesSatisfied(tasks, task)) ||
        task.status === "needs_repair"
    ).length,
    claimedCount: tasks.filter((task) => task.status === "claimed").length,
    verifyingCount: tasks.filter((task) => task.status === "verifying").length,
    needsRepairCount: tasks.filter((task) => task.status === "needs_repair").length,
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
            : existingTask?.status === "verifying" && existingTask.lease
              ? "verifying"
              : existingTask?.status === "needs_repair" && existingTask.lease
                ? "needs_repair"
                : mapPreviewStatusToTaskStatus(task.status),
        reason: task.reason,
        dependsOn: Array.isArray(task.dependsOn) ? [...task.dependsOn] : [],
        verificationRule: task.verificationRule ?? "none",
        verificationStatus:
          existingTask?.status === "satisfied"
            ? "passed"
            : existingTask?.status === "needs_repair"
              ? "failed"
              : mapPreviewStatusToVerificationStatus(
                  task.status,
                  task.verificationRule ?? "none"
                ),
        lease:
          existingTask &&
          (existingTask.status === "claimed" ||
            existingTask.status === "verifying" ||
            existingTask.status === "needs_repair") &&
          existingTask.lease
            ? existingTask.lease
            : null,
        satisfiedAt:
          existingTask?.status === "satisfied" ? existingTask.satisfiedAt : null,
        satisfiedBy:
          existingTask?.status === "satisfied" ? existingTask.satisfiedBy : null,
        completionNote:
          existingTask?.status === "satisfied" || existingTask?.status === "needs_repair"
            ? existingTask.completionNote
            : null,
        latestEventKind: existingTask?.latestEventKind ?? "materialized",
        latestEventSummary:
          existingTask?.latestEventSummary ??
          (task.status === "ready"
            ? "Task already satisfied by current evidence state."
            : "Task materialized from the current stage profile."),
        latestEventAt: existingTask?.latestEventAt ?? nowIso(),
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
      const nextTasks = store.tasks.map((task) => releaseExpiredTask(task));
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { claimed: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (current.status === "optional" || current.status === "satisfied") {
        return { claimed: false, reason: `task_not_claimable:${current.status}`, task: current };
      }
      if (!areTaskDependenciesSatisfied(nextTasks, current)) {
        return { claimed: false, reason: "dependency_blocked", task: current };
      }
      if (
        (current.status === "claimed" ||
          current.status === "verifying" ||
          current.status === "needs_repair") &&
        current.lease &&
        !isLeaseExpired(current.lease) &&
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { claimed: false, reason: "already_claimed", task: current };
      }
      const lease =
        (current.status === "claimed" ||
          current.status === "verifying" ||
          current.status === "needs_repair") &&
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
        satisfiedAt: null,
        satisfiedBy: null,
        completionNote: null,
        verificationStatus:
          current.verificationRule === "none" ? "not_required" : "pending",
      };
      nextTasks[taskIndex] = applyTaskEvent(
        claimedTask,
        "claimed",
        `Claimed by ${params.role ?? params.sessionKey}.`
      );
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
        (current.status !== "claimed" &&
          current.status !== "verifying" &&
          current.status !== "needs_repair") ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { renewed: false, reason: "not_owned", task: current };
      }
      const renewedTask: WorkflowTaskGraphTask = {
        ...current,
        lease: refreshLease(current.lease, params.ttlMs),
      };
      nextTasks[taskIndex] = applyTaskEvent(
        renewedTask,
        "lease_renewed",
        "Task lease heartbeat renewed."
      );
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
        (current.status !== "claimed" &&
          current.status !== "verifying" &&
          current.status !== "needs_repair") ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { released: false, reason: "not_owned", task: current };
      }
      const releasedTask: WorkflowTaskGraphTask = applyTaskEvent({
        ...current,
        status: "claimable",
        lease: null,
        satisfiedAt: null,
        satisfiedBy: null,
        completionNote: null,
        verificationStatus:
          current.verificationRule === "none" ? "not_required" : "pending",
      }, "released", "Task released back to the claimable queue.");
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

export async function releaseWorkflowTasksForSession(params: {
  projectRoot: string;
  sessionKey: string;
}): Promise<{
  releasedTaskIds: string[];
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { releasedTaskIds: [] };
      }
      const releasedTaskIds: string[] = [];
      const nextTasks = store.tasks.map((task) => {
        if (
          (task.status === "claimed" ||
            task.status === "verifying" ||
            task.status === "needs_repair") &&
          task.lease?.sessionKey === params.sessionKey
        ) {
          releasedTaskIds.push(task.taskId);
          return applyTaskEvent({
            ...task,
            status: "claimable" as const,
            lease: null,
            satisfiedAt: null,
            satisfiedBy: null,
            completionNote: null,
            verificationStatus:
              task.verificationRule === "none" ? "not_required" : "pending",
          }, "released", "Task released because the owning session exited.");
        }
        return task;
      });
      if (releasedTaskIds.length > 0) {
        await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
          ...store,
          generatedAt: nowIso(),
          tasks: nextTasks,
        });
      }
      return { releasedTaskIds };
    },
  });
}

export async function reconcileWorkflowTaskGraphLeases(params: {
  projectRoot: string;
}): Promise<{
  releasedTaskIds: string[];
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { releasedTaskIds: [] };
      }
      const now = Date.now();
      const releasedTaskIds: string[] = [];
      const nextTasks = store.tasks.map((task) => {
        if (
          (task.status === "claimed" ||
            task.status === "verifying" ||
            task.status === "needs_repair") &&
          isLeaseExpired(task.lease, now)
        ) {
          releasedTaskIds.push(task.taskId);
          return releaseExpiredTask(task, now);
        }
        return task;
      });
      if (releasedTaskIds.length > 0) {
        await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
          ...store,
          generatedAt: nowIso(),
          tasks: nextTasks,
        });
      }
      return { releasedTaskIds };
    },
  });
}

export async function claimNextWorkflowTaskForOwner(params: {
  projectRoot: string;
  owner: string;
  sessionKey: string;
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
      const nextTasks = store.tasks.map((task) => releaseExpiredTask(task));
      const existingOwned =
        nextTasks.find(
          (task) =>
            (task.status === "claimed" ||
              task.status === "verifying" ||
              task.status === "needs_repair") &&
            task.lease?.sessionKey === params.sessionKey
        ) ?? null;
      if (existingOwned) {
        return { claimed: true, reason: "already_owned", task: existingOwned };
      }
      const nextTask =
        nextTasks.find(
          (task) =>
            task.status === "claimable" &&
            task.owner === params.owner &&
            areTaskDependenciesSatisfied(nextTasks, task)
        ) ?? null;
      if (!nextTask) {
        return { claimed: false, reason: "no_matching_claimable_task", task: null };
      }
      const claimedTasks = nextTasks.map((task) =>
        task.taskId === nextTask.taskId
          ? {
              ...task,
              status: "claimed" as const,
              lease: buildLease({
                sessionKey: params.sessionKey,
                role: params.owner,
                ttlMs: params.ttlMs,
              }),
              satisfiedAt: null,
              satisfiedBy: null,
              completionNote: null,
              verificationStatus:
                task.verificationRule === "none" ? "not_required" : "pending",
              latestEventKind: "claimed",
              latestEventSummary: `Claimed by ${params.owner}.`,
              latestEventAt: nowIso(),
            }
          : task
      );
      const claimedTask =
        claimedTasks.find((task) => task.taskId === nextTask.taskId) ?? null;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: claimedTasks,
      });
      return { claimed: true, reason: null, task: claimedTask };
    },
  });
}

export async function markWorkflowTaskVerifying(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
}): Promise<{
  verifying: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { verifying: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { verifying: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (
        (current.status !== "claimed" && current.status !== "needs_repair") ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { verifying: false, reason: "not_owned", task: current };
      }
      const verifyingTask = applyTaskEvent(
        {
          ...current,
          status: "verifying",
          verificationStatus:
            current.verificationRule === "none" ? "not_required" : "pending",
        },
        "verifying",
        "Task completion is being verified."
      );
      nextTasks[taskIndex] = verifyingTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { verifying: true, reason: null, task: verifyingTask };
    },
  });
}

export async function markWorkflowTaskNeedsRepair(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
  reason?: string | null;
}): Promise<{
  updated: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { updated: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { updated: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (
        (current.status !== "claimed" &&
          current.status !== "verifying" &&
          current.status !== "needs_repair") ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { updated: false, reason: "not_owned", task: current };
      }
      const failedTask = applyTaskEvent(
        {
          ...current,
          status: "needs_repair",
          verificationStatus:
            current.verificationRule === "none" ? "not_required" : "failed",
          completionNote:
            typeof params.reason === "string" && params.reason.trim()
              ? params.reason.trim()
              : current.completionNote,
        },
        "verification_failed",
        typeof params.reason === "string" && params.reason.trim()
          ? params.reason.trim()
          : "Task verification failed."
      );
      nextTasks[taskIndex] = failedTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { updated: true, reason: null, task: failedTask };
    },
  });
}

export async function completeWorkflowTask(params: {
  projectRoot: string;
  taskId: string;
  sessionKey: string;
  role?: string | null;
  completionNote?: string | null;
}): Promise<{
  completed: boolean;
  reason: string | null;
  task: WorkflowTaskGraphTask | null;
}> {
  return withAdvisoryLock({
    lockPath: getWorkflowTaskGraphLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTaskGraphStore(params.projectRoot);
      if (!store) {
        return { completed: false, reason: "task_graph_missing", task: null };
      }
      const nextTasks = [...store.tasks];
      const taskIndex = nextTasks.findIndex((task) => task.taskId === params.taskId);
      if (taskIndex < 0) {
        return { completed: false, reason: "task_missing", task: null };
      }
      const current = nextTasks[taskIndex];
      if (
        (current.status !== "claimed" && current.status !== "verifying") ||
        !current.lease ||
        current.lease.sessionKey !== params.sessionKey
      ) {
        return { completed: false, reason: "not_owned", task: current };
      }
      const completedTask: WorkflowTaskGraphTask = applyTaskEvent({
        ...current,
        status: "satisfied",
        lease: null,
        verificationStatus:
          current.verificationRule === "none" ? "not_required" : "passed",
        satisfiedAt: nowIso(),
        satisfiedBy:
          typeof params.role === "string" && params.role.trim()
            ? params.role.trim()
            : current.owner,
        completionNote:
          typeof params.completionNote === "string" && params.completionNote.trim()
            ? params.completionNote.trim()
            : null,
      }, "completed", params.completionNote?.trim() || "Task completed and verified.");
      nextTasks[taskIndex] = completedTask;
      await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), {
        ...store,
        generatedAt: nowIso(),
        tasks: nextTasks,
      });
      return { completed: true, reason: null, task: completedTask };
    },
  });
}
