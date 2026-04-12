import path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";

export type WorkflowAgentCapabilityRecord = {
  schemaVersion: 1;
  sessionKey: string;
  sessionId: string | null;
  role: string | null;
  agentId: string | null;
  projectRoot: string | null;
  messageChannel: string | null;
  canUseResearchWorkflow: boolean;
  canUsePaperNexusRemote: boolean;
  canReceiveNativeDispatch: boolean;
  canRunExecPacket: boolean;
  canUseLobster: boolean;
  capabilityTtlMs: number;
  confidence: "unknown" | "low" | "medium" | "high";
  degradedReason: string | null;
  lastSeenAt: string;
  expiresAt: string;
};

export type WorkflowAgentCapabilityStore = {
  schemaVersion: 1;
  projectRoot: string;
  projectId: string | null;
  updatedAt: string;
  records: WorkflowAgentCapabilityRecord[];
};

const CAPABILITY_FILENAME = "workflow-agent-capabilities.json";
export const FOREGROUND_WORKFLOW_TOOL_CAPABILITY_TTL_MS = 10 * 60 * 1000;
export const NATIVE_DISPATCH_CAPABILITY_TTL_MS = 5 * 60 * 1000;
export const CHANNEL_ONLY_CAPABILITY_TTL_MS = 2 * 60 * 1000;
export const LOBSTER_CAPABILITY_TTL_MS = 2 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeConfidence(
  value: unknown
): WorkflowAgentCapabilityRecord["confidence"] {
  return value === "low" || value === "medium" || value === "high" ? value : "unknown";
}

function normalizeRecord(value: unknown): WorkflowAgentCapabilityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionKey = readString(record.sessionKey);
  if (!sessionKey) {
    return null;
  }
  const lastSeenAt = readString(record.lastSeenAt) ?? nowIso();
  const capabilityTtlMs = Math.max(
    1,
    Math.floor(readNumber(record.capabilityTtlMs) ?? NATIVE_DISPATCH_CAPABILITY_TTL_MS)
  );
  return {
    schemaVersion: 1,
    sessionKey,
    sessionId: readString(record.sessionId),
    role: readString(record.role),
    agentId: readString(record.agentId),
    projectRoot: readString(record.projectRoot),
    messageChannel: readString(record.messageChannel),
    canUseResearchWorkflow: readBoolean(record.canUseResearchWorkflow),
    canUsePaperNexusRemote: readBoolean(record.canUsePaperNexusRemote),
    canReceiveNativeDispatch: readBoolean(record.canReceiveNativeDispatch),
    canRunExecPacket: readBoolean(record.canRunExecPacket),
    canUseLobster: readBoolean(record.canUseLobster),
    capabilityTtlMs,
    confidence: normalizeConfidence(record.confidence),
    degradedReason: readString(record.degradedReason),
    lastSeenAt,
    expiresAt:
      readString(record.expiresAt) ??
      new Date(new Date(lastSeenAt).getTime() + capabilityTtlMs).toISOString(),
  };
}

export function getWorkflowAgentCapabilityPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    CAPABILITY_FILENAME
  );
}

function lockPath(projectRoot: string): string {
  return `${getWorkflowAgentCapabilityPath(projectRoot)}.lock`;
}

export async function readWorkflowAgentCapabilityStore(
  projectRoot: string
): Promise<WorkflowAgentCapabilityStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const raw = await readJsonIfExists<Partial<WorkflowAgentCapabilityStore>>(
    getWorkflowAgentCapabilityPath(resolvedProjectRoot)
  );
  return {
    schemaVersion: 1,
    projectRoot: resolvedProjectRoot,
    projectId: readString(raw?.projectId),
    updatedAt: readString(raw?.updatedAt) ?? nowIso(),
    records: Array.isArray(raw?.records)
      ? raw.records
          .map(normalizeRecord)
          .filter((entry): entry is WorkflowAgentCapabilityRecord => Boolean(entry))
      : [],
  };
}

export async function writeWorkflowAgentCapabilityStore(
  store: WorkflowAgentCapabilityStore
): Promise<void> {
  await writeJsonAtomicEnsured(getWorkflowAgentCapabilityPath(store.projectRoot), {
    ...store,
    schemaVersion: 1,
    projectRoot: path.resolve(store.projectRoot),
    updatedAt: nowIso(),
  });
}

export async function upsertWorkflowAgentCapability(params: {
  projectRoot: string;
  projectId?: string | null;
  sessionKey: string;
  sessionId?: string | null;
  role?: string | null;
  agentId?: string | null;
  messageChannel?: string | null;
  canUseResearchWorkflow?: boolean;
  canUsePaperNexusRemote?: boolean;
  canReceiveNativeDispatch?: boolean;
  canRunExecPacket?: boolean;
  canUseLobster?: boolean;
  capabilityTtlMs?: number;
  confidence?: WorkflowAgentCapabilityRecord["confidence"];
}): Promise<WorkflowAgentCapabilityRecord> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowAgentCapabilityStore(projectRoot);
      const index = store.records.findIndex((entry) => entry.sessionKey === params.sessionKey);
      const now = new Date();
      const ttl = Math.max(
        1,
        Math.floor(params.capabilityTtlMs ?? FOREGROUND_WORKFLOW_TOOL_CAPABILITY_TTL_MS)
      );
      const previous = index >= 0 ? store.records[index] : null;
      const next: WorkflowAgentCapabilityRecord = {
        schemaVersion: 1,
        sessionKey: params.sessionKey,
        sessionId: readString(params.sessionId) ?? previous?.sessionId ?? null,
        role: readString(params.role) ?? previous?.role ?? null,
        agentId: readString(params.agentId) ?? previous?.agentId ?? null,
        projectRoot,
        messageChannel: readString(params.messageChannel) ?? previous?.messageChannel ?? null,
        canUseResearchWorkflow:
          params.canUseResearchWorkflow ?? previous?.canUseResearchWorkflow ?? false,
        canUsePaperNexusRemote:
          params.canUsePaperNexusRemote ?? previous?.canUsePaperNexusRemote ?? false,
        canReceiveNativeDispatch:
          params.canReceiveNativeDispatch ?? previous?.canReceiveNativeDispatch ?? true,
        canRunExecPacket: params.canRunExecPacket ?? previous?.canRunExecPacket ?? false,
        canUseLobster: params.canUseLobster ?? previous?.canUseLobster ?? false,
        capabilityTtlMs: ttl,
        confidence: params.confidence ?? previous?.confidence ?? "medium",
        degradedReason: null,
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
      };
      const records = [...store.records];
      if (index >= 0) {
        records[index] = next;
      } else {
        records.push(next);
      }
      await writeWorkflowAgentCapabilityStore({
        ...store,
        projectId: readString(params.projectId) ?? store.projectId,
        records,
      });
      return next;
    },
  });
}

export async function downgradeWorkflowAgentCapability(params: {
  projectRoot: string;
  sessionKey: string;
  reason: string;
}): Promise<WorkflowAgentCapabilityRecord | null> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowAgentCapabilityStore(projectRoot);
      const index = store.records.findIndex((entry) => entry.sessionKey === params.sessionKey);
      if (index < 0) {
        return null;
      }
      const records = [...store.records];
      records[index] = {
        ...records[index],
        canUseResearchWorkflow: false,
        canRunExecPacket: false,
        canUseLobster: false,
        confidence: "low",
        degradedReason: params.reason,
        expiresAt: nowIso(),
        lastSeenAt: nowIso(),
      };
      await writeWorkflowAgentCapabilityStore({
        ...store,
        records,
      });
      return records[index];
    },
  });
}

export function isWorkflowAgentCapabilityFresh(
  record: WorkflowAgentCapabilityRecord,
  now = new Date()
): boolean {
  return Date.parse(record.expiresAt) > now.getTime() && record.confidence !== "low";
}

export async function selectWorkflowCapableSession(params: {
  projectRoot: string;
  role?: string | null;
  requiresResearchWorkflow?: boolean;
  requiresPaperNexusRemote?: boolean;
  requiresExecPacket?: boolean;
  requiresLobster?: boolean;
}): Promise<WorkflowAgentCapabilityRecord | null> {
  const store = await readWorkflowAgentCapabilityStore(params.projectRoot);
  const now = new Date();
  const candidates = store.records
    .filter((entry) => isWorkflowAgentCapabilityFresh(entry, now))
    .filter((entry) => !params.role || entry.role === params.role || entry.agentId === params.role)
    .filter((entry) =>
      params.requiresResearchWorkflow ? entry.canUseResearchWorkflow : true
    )
    .filter((entry) =>
      params.requiresPaperNexusRemote ? entry.canUsePaperNexusRemote : true
    )
    .filter((entry) => (params.requiresExecPacket ? entry.canRunExecPacket : true))
    .filter((entry) => (params.requiresLobster ? entry.canUseLobster : true));
  return (
    candidates.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ??
    null
  );
}
