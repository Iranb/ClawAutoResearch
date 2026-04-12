import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import { getWorkflowHandoffDefaultBudget } from "./handoff-defaults";
import type { WorkflowHandoffReason } from "./handoff-types";

export type WorkflowRepairQueueItem = {
  schemaVersion: 1;
  repairId: string;
  sourceTaskId: string | null;
  sourceIntentId: string | null;
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  failureKind: WorkflowHandoffReason;
  failureReason: string;
  verificationRule: string | null;
  failureFingerprint: string;
  repairLineageId: string;
  parentRepairId: string | null;
  repairDepth: number;
  maxRepairDepth: number;
  originalOwner: string | null;
  repairOwner: string;
  fallbackOwners: string[];
  retryBudgetRemaining: number;
  staleClaimAfterMs: number;
  nextEligibleAt: string | null;
  status: "queued" | "claimed" | "completed" | "failed" | "escalated";
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRepairQueueStore = {
  schemaVersion: 1;
  projectId: string | null;
  projectRoot: string;
  updatedAt: string;
  items: WorkflowRepairQueueItem[];
};

const REPAIR_QUEUE_FILENAME = "workflow-repair-queue.json";
const DEFAULT_MAX_REPAIR_DEPTH = 2;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const stringValue = readString(item);
    if (!stringValue || seen.has(stringValue)) {
      continue;
    }
    seen.add(stringValue);
    result.push(stringValue);
  }
  return result;
}

function normalizeFailureKind(value: unknown): WorkflowHandoffReason {
  const raw = readString(value);
  return raw ? (raw as WorkflowHandoffReason) : "verification_failed";
}

function normalizeRepairStatus(
  value: unknown
): WorkflowRepairQueueItem["status"] {
  return value === "claimed" ||
    value === "completed" ||
    value === "failed" ||
    value === "escalated"
    ? value
    : "queued";
}

export function buildWorkflowFailureFingerprint(params: {
  projectRoot: string;
  workflowLine?: string | null;
  stage?: string | null;
  failureKind: WorkflowHandoffReason;
  verificationRule?: string | null;
  failureReason: string;
  sourceTaskId?: string | null;
}): string {
  const normalized = [
    path.resolve(params.projectRoot),
    params.workflowLine ?? "unknown-line",
    params.stage ?? "unknown-stage",
    params.failureKind,
    params.verificationRule ?? "no-rule",
    params.failureReason.trim().replace(/\s+/g, " ").toLowerCase(),
    params.sourceTaskId ?? "no-task",
  ].join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeItem(value: unknown, projectRoot: string): WorkflowRepairQueueItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const repairId = readString(record.repairId) ?? randomUUID();
  const failureKind = normalizeFailureKind(record.failureKind);
  const failureReason = readString(record.failureReason);
  const repairOwner = readString(record.repairOwner);
  const failureFingerprint = readString(record.failureFingerprint);
  const repairLineageId = readString(record.repairLineageId);
  if (!failureReason || !repairOwner || !failureFingerprint || !repairLineageId) {
    return null;
  }
  return {
    schemaVersion: 1,
    repairId,
    sourceTaskId: readString(record.sourceTaskId),
    sourceIntentId: readString(record.sourceIntentId),
    projectId: readString(record.projectId),
    projectRoot: path.resolve(readString(record.projectRoot) ?? projectRoot),
    stage: readString(record.stage),
    failureKind,
    failureReason,
    verificationRule: readString(record.verificationRule),
    failureFingerprint,
    repairLineageId,
    parentRepairId: readString(record.parentRepairId),
    repairDepth: Math.max(0, Math.floor(readNumber(record.repairDepth) ?? 0)),
    maxRepairDepth: Math.max(
      0,
      Math.floor(readNumber(record.maxRepairDepth) ?? DEFAULT_MAX_REPAIR_DEPTH)
    ),
    originalOwner: readString(record.originalOwner),
    repairOwner,
    fallbackOwners: normalizeStringArray(record.fallbackOwners),
    retryBudgetRemaining: Math.max(
      0,
      Math.floor(
        readNumber(record.retryBudgetRemaining) ??
          getWorkflowHandoffDefaultBudget(failureKind).repairBudget
      )
    ),
    staleClaimAfterMs: Math.max(
      0,
      Math.floor(
        readNumber(record.staleClaimAfterMs) ??
          getWorkflowHandoffDefaultBudget(failureKind).staleClaimAfterMs ??
          0
      )
    ),
    nextEligibleAt: readString(record.nextEligibleAt),
    status: normalizeRepairStatus(record.status),
    createdAt: readString(record.createdAt) ?? nowIso(),
    updatedAt: readString(record.updatedAt) ?? nowIso(),
  };
}

export function getWorkflowRepairQueuePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".openclaw-research", REPAIR_QUEUE_FILENAME);
}

function lockPath(projectRoot: string): string {
  return `${getWorkflowRepairQueuePath(projectRoot)}.lock`;
}

export async function readWorkflowRepairQueueStore(
  projectRoot: string
): Promise<WorkflowRepairQueueStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const raw = await readJsonIfExists<Partial<WorkflowRepairQueueStore>>(
    getWorkflowRepairQueuePath(resolvedProjectRoot)
  );
  return {
    schemaVersion: 1,
    projectId: readString(raw?.projectId),
    projectRoot: resolvedProjectRoot,
    updatedAt: readString(raw?.updatedAt) ?? nowIso(),
    items: Array.isArray(raw?.items)
      ? raw.items
          .map((entry) => normalizeItem(entry, resolvedProjectRoot))
          .filter((entry): entry is WorkflowRepairQueueItem => Boolean(entry))
      : [],
  };
}

export async function writeWorkflowRepairQueueStore(
  store: WorkflowRepairQueueStore
): Promise<void> {
  await writeJsonAtomicEnsured(getWorkflowRepairQueuePath(store.projectRoot), {
    ...store,
    schemaVersion: 1,
    projectRoot: path.resolve(store.projectRoot),
    updatedAt: nowIso(),
  });
}

export async function createWorkflowRepairQueueItem(params: {
  projectRoot: string;
  projectId?: string | null;
  sourceTaskId?: string | null;
  sourceIntentId?: string | null;
  stage?: string | null;
  workflowLine?: string | null;
  failureKind: WorkflowHandoffReason;
  failureReason: string;
  verificationRule?: string | null;
  failureFingerprint?: string | null;
  repairLineageId?: string | null;
  parentRepairId?: string | null;
  repairDepth?: number;
  maxRepairDepth?: number;
  originalOwner?: string | null;
  repairOwner: string;
  fallbackOwners?: string[];
}): Promise<{ item: WorkflowRepairQueueItem; created: boolean; escalated: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowRepairQueueStore(projectRoot);
      const failureFingerprint =
        readString(params.failureFingerprint) ??
        buildWorkflowFailureFingerprint({
          projectRoot,
          workflowLine: params.workflowLine,
          stage: params.stage,
          failureKind: params.failureKind,
          verificationRule: params.verificationRule,
          failureReason: params.failureReason,
          sourceTaskId: params.sourceTaskId,
        });
      const activeExisting = store.items.find(
        (entry) =>
          entry.failureFingerprint === failureFingerprint &&
          (entry.status === "queued" || entry.status === "claimed" || entry.status === "failed")
      );
      if (activeExisting) {
        return { item: activeExisting, created: false, escalated: false };
      }
      const repairDepth = Math.max(0, Math.floor(params.repairDepth ?? 0));
      const maxRepairDepth = Math.max(
        0,
        Math.floor(params.maxRepairDepth ?? DEFAULT_MAX_REPAIR_DEPTH)
      );
      const budget = getWorkflowHandoffDefaultBudget(params.failureKind);
      const item: WorkflowRepairQueueItem = {
        schemaVersion: 1,
        repairId: randomUUID(),
        sourceTaskId: readString(params.sourceTaskId),
        sourceIntentId: readString(params.sourceIntentId),
        projectId: readString(params.projectId),
        projectRoot,
        stage: readString(params.stage),
        failureKind: params.failureKind,
        failureReason: params.failureReason,
        verificationRule: readString(params.verificationRule),
        failureFingerprint,
        repairLineageId:
          readString(params.repairLineageId) ??
          readString(params.sourceTaskId) ??
          randomUUID(),
        parentRepairId: readString(params.parentRepairId),
        repairDepth,
        maxRepairDepth,
        originalOwner: readString(params.originalOwner),
        repairOwner: params.repairOwner,
        fallbackOwners: normalizeStringArray(params.fallbackOwners),
        retryBudgetRemaining: Math.max(0, budget.repairBudget),
        staleClaimAfterMs: Math.max(0, budget.staleClaimAfterMs ?? 0),
        nextEligibleAt: null,
        status: repairDepth >= maxRepairDepth ? "escalated" : "queued",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeWorkflowRepairQueueStore({
        ...store,
        projectId: item.projectId ?? store.projectId,
        items: [...store.items, item],
      });
      return {
        item,
        created: true,
        escalated: item.status === "escalated",
      };
    },
  });
}

export async function updateWorkflowRepairQueueItem(params: {
  projectRoot: string;
  repairId: string;
  status?: WorkflowRepairQueueItem["status"];
  retryBudgetDelta?: number;
  nextEligibleAt?: string | null;
}): Promise<WorkflowRepairQueueItem | null> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowRepairQueueStore(projectRoot);
      const index = store.items.findIndex((entry) => entry.repairId === params.repairId);
      if (index < 0) {
        return null;
      }
      const current = store.items[index];
      const retryBudgetRemaining = Math.max(
        0,
        current.retryBudgetRemaining + Math.floor(params.retryBudgetDelta ?? 0)
      );
      const status =
        params.status ??
        (retryBudgetRemaining <= 0 && current.status !== "completed"
          ? "escalated"
          : current.status);
      const updated: WorkflowRepairQueueItem = {
        ...current,
        status,
        retryBudgetRemaining,
        nextEligibleAt:
          params.nextEligibleAt === undefined ? current.nextEligibleAt : params.nextEligibleAt,
        updatedAt: nowIso(),
      };
      const nextItems = [...store.items];
      nextItems[index] = updated;
      await writeWorkflowRepairQueueStore({
        ...store,
        items: nextItems,
      });
      return updated;
    },
  });
}

export async function closeWorkflowRepairItemsForTask(params: {
  projectRoot: string;
  sourceTaskId?: string | null;
  sourceIntentId?: string | null;
}): Promise<WorkflowRepairQueueItem[]> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowRepairQueueStore(projectRoot);
      const closed: WorkflowRepairQueueItem[] = [];
      const items = store.items.map((entry) => {
        const matchesTask =
          params.sourceTaskId && entry.sourceTaskId === params.sourceTaskId;
        const matchesIntent =
          params.sourceIntentId && entry.sourceIntentId === params.sourceIntentId;
        if (
          (matchesTask || matchesIntent) &&
          (entry.status === "queued" ||
            entry.status === "claimed" ||
            entry.status === "failed")
        ) {
          const updated: WorkflowRepairQueueItem = {
            ...entry,
            status: "completed",
            updatedAt: nowIso(),
          };
          closed.push(updated);
          return updated;
        }
        return entry;
      });
      if (closed.length > 0) {
        await writeWorkflowRepairQueueStore({ ...store, items });
      }
      return closed;
    },
  });
}
