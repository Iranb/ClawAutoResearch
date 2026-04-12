import fs from "node:fs/promises";
import path from "node:path";
import { appendWorkflowRuntimeEvent } from "./workflow-runtime-state.js";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";

export type WorkflowRuntimeIncidentKind =
  | "lobster_fallback"
  | "repair_exhausted"
  | "repair_orphan_session"
  | "broadcast_delivery_failed"
  | "discord_inbound_timeout";

export type WorkflowRuntimeIncidentSeverity = "warning" | "error";

export type WorkflowRuntimeIncidentStatus = "open" | "resolved";

export type WorkflowRuntimeIncidentEntry = {
  incidentId: string;
  idempotencyKey: string;
  kind: WorkflowRuntimeIncidentKind;
  severity: WorkflowRuntimeIncidentSeverity;
  status: WorkflowRuntimeIncidentStatus;
  summary: string;
  projectId: string | null;
  projectRoot: string;
  queueKey: string | null;
  sessionKey: string | null;
  backend: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastError: string | null;
  occurrenceCount: number;
  details: Record<string, unknown> | null;
};

export type WorkflowRuntimeIncidentsStore = {
  schemaVersion: 1;
  updatedAt: string;
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowRuntimeIncidentEntry[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getWorkflowRuntimeIncidentsPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    "workflow-runtime-incidents.json"
  );
}

function normalizeIncidentEntry(
  projectRoot: string,
  value: unknown
): WorkflowRuntimeIncidentEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const incidentId =
    readString(record.incidentId ?? record.incident_id) ??
    readString(record.idempotencyKey ?? record.idempotency_key);
  const idempotencyKey = readString(
    record.idempotencyKey ?? record.idempotency_key
  );
  const kind = readString(record.kind) as WorkflowRuntimeIncidentKind | null;
  const summary = readString(record.summary);
  const firstSeenAt = readString(record.firstSeenAt ?? record.first_seen_at);
  const lastSeenAt = readString(record.lastSeenAt ?? record.last_seen_at);
  if (!incidentId || !idempotencyKey || !kind || !summary || !firstSeenAt || !lastSeenAt) {
    return null;
  }
  const severity = readString(record.severity);
  const status = readString(record.status);
  return {
    incidentId,
    idempotencyKey,
    kind,
    severity: severity === "error" ? "error" : "warning",
    status: status === "resolved" ? "resolved" : "open",
    summary,
    projectId: readString(record.projectId ?? record.project_id),
    projectRoot: readString(record.projectRoot ?? record.project_root) ?? path.resolve(projectRoot),
    queueKey: readString(record.queueKey ?? record.queue_key),
    sessionKey: readString(record.sessionKey ?? record.session_key),
    backend: readString(record.backend),
    firstSeenAt,
    lastSeenAt,
    lastError: readString(record.lastError ?? record.last_error),
    occurrenceCount: Math.max(
      1,
      Math.floor(
        typeof record.occurrenceCount === "number"
          ? record.occurrenceCount
          : Number(record.occurrenceCount ?? 1)
      )
    ),
    details: asRecord(record.details),
  };
}

function normalizeStore(
  projectRoot: string,
  projectId: string | null,
  value: unknown
): WorkflowRuntimeIncidentsStore {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record.entries
        .map((entry) => normalizeIncidentEntry(projectRoot, entry))
        .filter((entry): entry is WorkflowRuntimeIncidentEntry => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    updatedAt: readString(record?.updatedAt ?? record?.updated_at) ?? nowIso(),
    projectId: readString(record?.projectId ?? record?.project_id) ?? projectId,
    projectRoot: readString(record?.projectRoot ?? record?.project_root) ?? path.resolve(projectRoot),
    entries,
  };
}

export async function readWorkflowRuntimeIncidentsStore(
  projectRoot: string,
  projectId?: string | null
): Promise<WorkflowRuntimeIncidentsStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedProjectId = readString(projectId) ?? path.basename(resolvedProjectRoot);
  const store = await readJsonIfExists<WorkflowRuntimeIncidentsStore>(
    getWorkflowRuntimeIncidentsPath(resolvedProjectRoot)
  );
  return normalizeStore(resolvedProjectRoot, resolvedProjectId, store);
}

export async function writeWorkflowRuntimeIncidentsStore(params: {
  projectRoot: string;
  projectId?: string | null;
  entries: WorkflowRuntimeIncidentEntry[];
}): Promise<WorkflowRuntimeIncidentsStore> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = readString(params.projectId) ?? path.basename(projectRoot);
  const nextStore = normalizeStore(projectRoot, projectId, {
    schemaVersion: 1,
    updatedAt: nowIso(),
    projectId,
    projectRoot,
    entries: params.entries,
  });
  await writeJsonAtomicEnsured(getWorkflowRuntimeIncidentsPath(projectRoot), nextStore);
  return nextStore;
}

export async function recordWorkflowRuntimeIncident(params: {
  projectRoot: string;
  projectId?: string | null;
  idempotencyKey: string;
  kind: WorkflowRuntimeIncidentKind;
  severity?: WorkflowRuntimeIncidentSeverity;
  status?: WorkflowRuntimeIncidentStatus;
  summary: string;
  queueKey?: string | null;
  sessionKey?: string | null;
  backend?: string | null;
  error?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<WorkflowRuntimeIncidentEntry> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = readString(params.projectId) ?? path.basename(projectRoot);
  const storePath = getWorkflowRuntimeIncidentsPath(projectRoot);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  return withAdvisoryLock({
    lockPath: `${storePath}.lock`,
    task: async () => {
      const store = await readWorkflowRuntimeIncidentsStore(projectRoot, projectId);
      const currentAt = nowIso();
      const existingIndex = store.entries.findIndex(
        (entry) => entry.idempotencyKey === params.idempotencyKey
      );
      const nextEntry: WorkflowRuntimeIncidentEntry = existingIndex >= 0
        ? {
            ...store.entries[existingIndex],
            severity: params.severity ?? store.entries[existingIndex].severity,
            status: params.status ?? "open",
            summary: params.summary,
            queueKey: readString(params.queueKey) ?? store.entries[existingIndex].queueKey,
            sessionKey:
              readString(params.sessionKey) ?? store.entries[existingIndex].sessionKey,
            backend: readString(params.backend) ?? store.entries[existingIndex].backend,
            lastSeenAt: currentAt,
            lastError: readString(params.error) ?? store.entries[existingIndex].lastError,
            occurrenceCount: store.entries[existingIndex].occurrenceCount + 1,
            details: params.details ?? store.entries[existingIndex].details,
          }
        : {
            incidentId: `${params.kind}:${params.idempotencyKey}`,
            idempotencyKey: params.idempotencyKey,
            kind: params.kind,
            severity: params.severity ?? "warning",
            status: params.status ?? "open",
            summary: params.summary,
            projectId,
            projectRoot,
            queueKey: readString(params.queueKey),
            sessionKey: readString(params.sessionKey),
            backend: readString(params.backend),
            firstSeenAt: currentAt,
            lastSeenAt: currentAt,
            lastError: readString(params.error),
            occurrenceCount: 1,
            details: params.details ?? null,
          };
      const nextEntries = [...store.entries];
      if (existingIndex >= 0) {
        nextEntries[existingIndex] = nextEntry;
      } else {
        nextEntries.push(nextEntry);
      }
      await writeWorkflowRuntimeIncidentsStore({
        projectRoot,
        projectId,
        entries: nextEntries.sort((left, right) =>
          left.lastSeenAt.localeCompare(right.lastSeenAt)
        ),
      });
      await appendWorkflowRuntimeEvent({
        projectRoot,
        projectId,
        kind: "runtime_incident",
        summary: `${nextEntry.kind}: ${nextEntry.summary}`,
        details: {
          incidentId: nextEntry.incidentId,
          severity: nextEntry.severity,
          queueKey: nextEntry.queueKey,
          sessionKey: nextEntry.sessionKey,
          backend: nextEntry.backend,
          occurrenceCount: nextEntry.occurrenceCount,
        },
      });
      return nextEntry;
    },
  });
}
