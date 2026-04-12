import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";

export type WorkflowWriteScopeMode = "read_only" | "append_only" | "exclusive_write";

export type WorkflowWriteScopeClaim = {
  schemaVersion: 1;
  claimId: string;
  taskId: string | null;
  sessionKey: string;
  role: string | null;
  ownedDirs: string[];
  exclusiveFiles: string[];
  mode: WorkflowWriteScopeMode;
  claimedAt: string;
  heartbeatAt: string;
  leaseTtlMs: number;
  leaseExpiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
};

export type WorkflowWriteScopeStore = {
  schemaVersion: 1;
  projectRoot: string;
  projectId: string | null;
  updatedAt: string;
  claims: WorkflowWriteScopeClaim[];
};

const WRITE_SCOPE_FILENAME = "workflow-write-scopes.json";
const DEFAULT_EXCLUSIVE_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ARTIFACT_LEASE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LONG_RUNNING_LEASE_TTL_MS = 2 * 60 * 60 * 1000;

const ALWAYS_EXCLUSIVE_FILES = new Set([
  "PROJECT_MANIFEST.json",
  "TRACK_REGISTRY.json",
  ".openclaw-research/workflow-task-graph.json",
  ".openclaw-research/workflow-handoff-intents.json",
]);

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

function normalizeMode(value: unknown): WorkflowWriteScopeMode {
  return value === "read_only" || value === "append_only" || value === "exclusive_write"
    ? value
    : "read_only";
}

function normalizeProjectRelativePath(projectRoot: string, value: string): string {
  const resolved = path.resolve(projectRoot, value);
  const relative = path.relative(projectRoot, resolved);
  return relative && !relative.startsWith("..") ? relative : value;
}

function normalizeClaim(value: unknown, projectRoot: string): WorkflowWriteScopeClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const claimId = readString(record.claimId) ?? randomUUID();
  const sessionKey = readString(record.sessionKey);
  if (!sessionKey) {
    return null;
  }
  const leaseTtlMs = Math.max(
    1,
    Math.floor(readNumber(record.leaseTtlMs) ?? DEFAULT_EXCLUSIVE_LEASE_TTL_MS)
  );
  const claimedAt = readString(record.claimedAt) ?? nowIso();
  return {
    schemaVersion: 1,
    claimId,
    taskId: readString(record.taskId),
    sessionKey,
    role: readString(record.role),
    ownedDirs: normalizeStringArray(record.ownedDirs).map((entry) =>
      normalizeProjectRelativePath(projectRoot, entry)
    ),
    exclusiveFiles: normalizeStringArray(record.exclusiveFiles).map((entry) =>
      normalizeProjectRelativePath(projectRoot, entry)
    ),
    mode: normalizeMode(record.mode),
    claimedAt,
    heartbeatAt: readString(record.heartbeatAt) ?? claimedAt,
    leaseTtlMs,
    leaseExpiresAt:
      readString(record.leaseExpiresAt) ??
      new Date(new Date(claimedAt).getTime() + leaseTtlMs).toISOString(),
    releasedAt: readString(record.releasedAt),
    releaseReason: readString(record.releaseReason),
  };
}

export function getWorkflowWriteScopePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".openclaw-research", WRITE_SCOPE_FILENAME);
}

function lockPath(projectRoot: string): string {
  return `${getWorkflowWriteScopePath(projectRoot)}.lock`;
}

export async function readWorkflowWriteScopeStore(
  projectRoot: string
): Promise<WorkflowWriteScopeStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const raw = await readJsonIfExists<Partial<WorkflowWriteScopeStore>>(
    getWorkflowWriteScopePath(resolvedProjectRoot)
  );
  return {
    schemaVersion: 1,
    projectRoot: resolvedProjectRoot,
    projectId: readString(raw?.projectId),
    updatedAt: readString(raw?.updatedAt) ?? nowIso(),
    claims: Array.isArray(raw?.claims)
      ? raw.claims
          .map((entry) => normalizeClaim(entry, resolvedProjectRoot))
          .filter((entry): entry is WorkflowWriteScopeClaim => Boolean(entry))
      : [],
  };
}

export async function writeWorkflowWriteScopeStore(
  store: WorkflowWriteScopeStore
): Promise<void> {
  await writeJsonAtomicEnsured(getWorkflowWriteScopePath(store.projectRoot), {
    ...store,
    schemaVersion: 1,
    projectRoot: path.resolve(store.projectRoot),
    updatedAt: nowIso(),
  });
}

function isClaimActive(claim: WorkflowWriteScopeClaim, now = new Date()): boolean {
  return !claim.releasedAt && Date.parse(claim.leaseExpiresAt) > now.getTime();
}

function pathsConflict(a: string[], b: string[]): boolean {
  for (const left of a) {
    for (const right of b) {
      if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        return true;
      }
    }
  }
  return false;
}

export function getDefaultWorkflowWriteScopeLeaseTtlMs(params: {
  mode: WorkflowWriteScopeMode;
  ownedDirs?: string[];
  exclusiveFiles?: string[];
  longRunning?: boolean;
}): number {
  if (params.longRunning) {
    return DEFAULT_LONG_RUNNING_LEASE_TTL_MS;
  }
  if (params.mode === "exclusive_write") {
    return DEFAULT_EXCLUSIVE_LEASE_TTL_MS;
  }
  if ((params.ownedDirs ?? []).length > 0 || (params.exclusiveFiles ?? []).length > 0) {
    return DEFAULT_ARTIFACT_LEASE_TTL_MS;
  }
  return DEFAULT_EXCLUSIVE_LEASE_TTL_MS;
}

export async function claimWorkflowWriteScope(params: {
  projectRoot: string;
  projectId?: string | null;
  taskId?: string | null;
  sessionKey: string;
  role?: string | null;
  ownedDirs?: string[];
  exclusiveFiles?: string[];
  mode?: WorkflowWriteScopeMode;
  leaseTtlMs?: number;
  override?: boolean;
}): Promise<{
  claimed: boolean;
  claim: WorkflowWriteScopeClaim | null;
  conflicts: WorkflowWriteScopeClaim[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowWriteScopeStore(projectRoot);
      const now = new Date();
      const mode = params.mode ?? "read_only";
      const ownedDirs = normalizeStringArray(params.ownedDirs).map((entry) =>
        normalizeProjectRelativePath(projectRoot, entry)
      );
      const exclusiveFiles = [
        ...normalizeStringArray(params.exclusiveFiles).map((entry) =>
          normalizeProjectRelativePath(projectRoot, entry)
        ),
        ...Array.from(ALWAYS_EXCLUSIVE_FILES).filter((entry) =>
          normalizeStringArray(params.exclusiveFiles).includes(entry)
        ),
      ];
      const requestedPaths = [...ownedDirs, ...exclusiveFiles];
      const activeClaims = store.claims.filter((entry) => isClaimActive(entry, now));
      const conflicts =
        mode === "read_only"
          ? []
          : activeClaims.filter((entry) => {
              if (entry.sessionKey === params.sessionKey) {
                return false;
              }
              if (entry.mode === "read_only") {
                return false;
              }
              return pathsConflict(requestedPaths, [
                ...entry.ownedDirs,
                ...entry.exclusiveFiles,
              ]);
            });
      if (conflicts.length > 0 && params.override !== true) {
        return { claimed: false, claim: null, conflicts };
      }
      const leaseTtlMs =
        params.leaseTtlMs ??
        getDefaultWorkflowWriteScopeLeaseTtlMs({
          mode,
          ownedDirs,
          exclusiveFiles,
        });
      const claim: WorkflowWriteScopeClaim = {
        schemaVersion: 1,
        claimId: randomUUID(),
        taskId: readString(params.taskId),
        sessionKey: params.sessionKey,
        role: readString(params.role),
        ownedDirs,
        exclusiveFiles,
        mode,
        claimedAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
        leaseTtlMs,
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
        releasedAt: null,
        releaseReason: null,
      };
      await writeWorkflowWriteScopeStore({
        ...store,
        projectId: readString(params.projectId) ?? store.projectId,
        claims: [...store.claims, claim],
      });
      return { claimed: true, claim, conflicts: [] };
    },
  });
}

export async function releaseWorkflowWriteScope(params: {
  projectRoot: string;
  claimId: string;
  reason?: string | null;
}): Promise<WorkflowWriteScopeClaim | null> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowWriteScopeStore(projectRoot);
      const index = store.claims.findIndex((entry) => entry.claimId === params.claimId);
      if (index < 0) {
        return null;
      }
      const claims = [...store.claims];
      claims[index] = {
        ...claims[index],
        releasedAt: nowIso(),
        releaseReason: readString(params.reason) ?? "released",
      };
      await writeWorkflowWriteScopeStore({ ...store, claims });
      return claims[index];
    },
  });
}

export async function releaseStaleWorkflowWriteScopes(params: {
  projectRoot: string;
  now?: Date;
}): Promise<WorkflowWriteScopeClaim[]> {
  const projectRoot = path.resolve(params.projectRoot);
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowWriteScopeStore(projectRoot);
      const now = params.now ?? new Date();
      const released: WorkflowWriteScopeClaim[] = [];
      const claims = store.claims.map((entry) => {
        if (!entry.releasedAt && Date.parse(entry.leaseExpiresAt) <= now.getTime()) {
          const updated = {
            ...entry,
            releasedAt: now.toISOString(),
            releaseReason: "write_scope_stale_released",
          };
          released.push(updated);
          return updated;
        }
        return entry;
      });
      if (released.length > 0) {
        await writeWorkflowWriteScopeStore({ ...store, claims });
      }
      return released;
    },
  });
}
