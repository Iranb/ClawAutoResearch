import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  buildWorkflowRuntimeSessionBinding,
  normalizeWorkflowSubagentParentSessionKey,
  type WorkflowRuntimeSessionBinding,
} from "./workflow-subagent-sessions";
import {
  isProjectWorkflowAgentId,
  isWorkflowBindingVisibleToAgent,
  normalizeWorkflowAllowedAgentIds,
  normalizeWorkflowAllowedRoles,
  normalizeWorkflowIsolationMode,
  resolveWorkflowBroadcastSessionKey,
  type WorkflowIsolationMode,
} from "./workflow-agent-isolation.js";
import {
  assertProjectRootWithinProjectsRoot,
  isProjectRootWithinProjectsRoot,
} from "./workflow-guard-project-state";
import {
  isSpecificWorkflowBindingChannelKey,
  isWeakWorkflowBindingChannelKey,
  normalizeWorkflowBindingChannelKey,
  resolveBindingChannelKeyFromContext,
} from "./workflow-commands/parsers.js";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import { readRotatingJsonlTail, appendRotatingJsonlLine } from "./workflow-jsonl-log.js";
import { readWorkflowRuntimeSessionsStore } from "./workflow-runtime-state.js";

export interface ChannelProjectBindingPolicy {
  enableChannelProjectBindings?: boolean;
  channelProjectBindingsPath?: string;
  projectsRoot?: string;
}

export interface ChannelProjectBindingContext {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  projectRoot?: string;
  role?: string;
  agentId?: string;
  parentSessionKey?: string;
  threadBindingKey?: string;
  depth?: number;
}

const DEFAULT_CHANNEL_BINDING_AUDIT_MAX_BYTES = 512 * 1024;
const DEFAULT_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES = 5;

export type InvalidEnvProjectRootMode = "throw" | "ignore";

export interface ChannelProjectBindingRecord {
  channelKey: string;
  projectRoot: string;
  projectId: string | null;
  messageChannel: string | null;
  sessionKeySample: string | null;
  sessionId: string | null;
  boundAt: string;
  updatedAt: string;
  boundByAgent: string | null;
  notes: string | null;
  workflowRole: string | null;
  workflowSessionKey: string | null;
  workflowSessionId: string | null;
  parentWorkflowSessionKey: string | null;
  threadBindingKey: string | null;
  depth: number | null;
  lineageKey: string | null;
  workflowBindingMode: "explicit_thread" | "derived_thread" | "channel_only";
  workflowIsolationMode: WorkflowIsolationMode;
  workflowAllowedRoles: string[];
  workflowAllowedAgentIds: string[];
  workflowBroadcastSessionKey: string | null;
}

type ChannelProjectBindingsStore = {
  schemaVersion: 1;
  updatedAt: string;
  bindings: ChannelProjectBindingRecord[];
};

type ChannelProjectBindingIndexEntry = ChannelProjectBindingRecord & {
  storePath: string;
};

type ChannelProjectBindingIndexStore = {
  schemaVersion: 1;
  updatedAt: string;
  bindings: ChannelProjectBindingIndexEntry[];
};

export type ResolvedProjectContext = {
  enabled: boolean;
  channelKey: string | null;
  projectRoot: string | null;
  projectId: string | null;
  source: "channel_binding" | "env" | "none";
  storePath: string;
  binding: ChannelProjectBindingRecord | null;
};

export type ChannelProjectBindingAuditAction = "bind" | "rebind" | "unbind";

export type ChannelProjectBindingAuditEvent = {
  schemaVersion: 1;
  eventId: string;
  action: ChannelProjectBindingAuditAction;
  recordedAt: string;
  channelKey: string;
  projectRoot: string | null;
  projectId: string | null;
  previousProjectRoot: string | null;
  previousProjectId: string | null;
  messageChannel: string | null;
  sessionKey: string | null;
  sessionId: string | null;
  workflowSessionKey: string | null;
  workflowRole: string | null;
  actor: string | null;
  notes: string | null;
  storePath: string;
};

export type ChannelProjectBindingGateReason =
  | "binding_gate_disabled"
  | "binding_match"
  | "binding_project_mismatch"
  | "binding_missing"
  | "session_project_match"
  | "session_project_missing";

export type ChannelProjectBindingGateResult = {
  allowed: boolean;
  reason: ChannelProjectBindingGateReason;
  matchedBy: "binding" | "session" | "none";
  channelKey: string | null;
  expectedProjectRoot: string;
  expectedProjectId: string | null;
  currentBinding: ChannelProjectBindingRecord | null;
  matchedSessionKey: string | null;
};

const DEFAULT_POLICY: Required<ChannelProjectBindingPolicy> = {
  enableChannelProjectBindings: false,
  channelProjectBindingsPath: "",
  projectsRoot: "",
};

const BINDING_INDEX_CACHE_TTL_MS = 30_000;
const bindingIndexCache = new Map<
  string,
  { loadedAt: number; fileMtimeMs: number | null; store: ChannelProjectBindingIndexStore }
>();

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getChannelBindingAuditRotationConfig() {
  return {
    maxBytes: readPositiveIntegerEnv(
      "OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_BYTES",
      DEFAULT_CHANNEL_BINDING_AUDIT_MAX_BYTES
    ),
    maxArchives: readPositiveIntegerEnv(
      "OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES",
      DEFAULT_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES
    ),
  };
}

function resolveContextActorId(
  context: Pick<ChannelProjectBindingContext, "role" | "agentId"> | null | undefined
): string | null {
  return asString(context?.role) ?? asString(context?.agentId);
}

function expandHome(value: string): string {
  if (value === "~") {
    return process.env.HOME ?? value;
  }
  if (value.startsWith("~/")) {
    const home = process.env.HOME;
    return home ? path.join(home, value.slice(2)) : value;
  }
  return value;
}

function normalizePolicy(
  policy: ChannelProjectBindingPolicy | undefined
): Required<ChannelProjectBindingPolicy> {
  return {
    enableChannelProjectBindings:
      policy?.enableChannelProjectBindings === true
        ? true
        : DEFAULT_POLICY.enableChannelProjectBindings,
    channelProjectBindingsPath: DEFAULT_POLICY.channelProjectBindingsPath,
    projectsRoot:
      asString(policy?.projectsRoot) ??
      DEFAULT_POLICY.projectsRoot,
  };
}

function normalizeChannelKey(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function normalizeBindingChannelKey(value: string | null): string | null {
  return normalizeWorkflowBindingChannelKey(value);
}

function sessionKeyToChannelKey(sessionKey: string | null): string | null {
  const normalized = normalizeChannelKey(
    normalizeWorkflowSubagentParentSessionKey(sessionKey) ?? sessionKey
  );
  if (!normalized) {
    return null;
  }
  if (!normalized.startsWith("agent:")) {
    return normalized;
  }
  const parts = normalized.split(":");
  if (parts.length < 3) {
    return normalized;
  }
  return parts.slice(2).join(":");
}

type ChannelProjectBindingLookup = {
  primaryKey: string | null;
  lookupKeys: string[];
  projectScanKeys: string[];
  strength: "explicit" | "session" | "session_id" | "none";
};

function uniqueBindingKeys(values: Array<string | null | undefined>): string[] {
  const keys: string[] = [];
  for (const value of values) {
    const normalized = normalizeBindingChannelKey(value ?? null);
    if (normalized && !keys.includes(normalized)) {
      keys.push(normalized);
    }
  }
  return keys;
}

function isExplicitThreadBindingKey(value: string | null | undefined): boolean {
  const normalized = normalizeBindingChannelKey(value ?? null);
  return Boolean(normalized && !normalized.startsWith("agent:"));
}

function isStrongExplicitChannelKey(value: string | null | undefined): boolean {
  return isSpecificWorkflowBindingChannelKey(normalizeBindingChannelKey(value ?? null));
}

function isProjectScannableSessionChannelKey(
  value: string | null | undefined
): boolean {
  const normalized = normalizeBindingChannelKey(value ?? null);
  return Boolean(normalized && !isWeakWorkflowBindingChannelKey(normalized));
}

function resolveChannelProjectLookup(
  context: ChannelProjectBindingContext | undefined
): ChannelProjectBindingLookup {
  if (!context) {
    return {
      primaryKey: null,
      lookupKeys: [],
      projectScanKeys: [],
      strength: "none",
    };
  }

  const explicitDerivedKey = resolveBindingChannelKeyFromContext({
    messageChannel: asString(context.messageChannel) ?? null,
    channelKey: asString(context.channelKey) ?? null,
    accountId: asString(context.accountId) ?? undefined,
    conversationId: asString(context.conversationId) ?? null,
    threadId:
      typeof context.threadId === "number" || typeof context.threadId === "string"
        ? context.threadId
        : null,
  });
  const explicitThreadBindingKey = isExplicitThreadBindingKey(context.threadBindingKey)
    ? normalizeBindingChannelKey(asString(context.threadBindingKey) ?? null)
    : null;
  const explicitKeys = uniqueBindingKeys([
    explicitDerivedKey,
    explicitThreadBindingKey,
    isStrongExplicitChannelKey(asString(context.channelKey) ?? null)
      ? asString(context.channelKey) ?? null
      : null,
    asString(context.conversationId) ?? null,
  ]);
  const fromSessionKey = sessionKeyToChannelKey(asString(context.sessionKey));
  const sessionId = normalizeChannelKey(asString(context.sessionId) ?? null);
  if (explicitKeys.length > 0) {
    return {
      primaryKey: explicitKeys[0] ?? null,
      lookupKeys: uniqueBindingKeys([
        ...explicitKeys,
        fromSessionKey,
        sessionId ? `session:${sessionId}` : null,
      ]),
      projectScanKeys: explicitKeys,
      strength: "explicit",
    };
  }
  if (fromSessionKey) {
    return {
      primaryKey: fromSessionKey,
      lookupKeys: [fromSessionKey],
      projectScanKeys: isProjectScannableSessionChannelKey(fromSessionKey)
        ? [fromSessionKey]
        : [],
      strength: isProjectScannableSessionChannelKey(fromSessionKey)
        ? "session"
        : "none",
    };
  }
  if (sessionId) {
    return {
      primaryKey: `session:${sessionId}`,
      lookupKeys: [`session:${sessionId}`],
      projectScanKeys: [],
      strength: "session_id",
    };
  }
  return {
    primaryKey: null,
    lookupKeys: [],
    projectScanKeys: [],
    strength: "none",
  };
}

function findBindingByKeys(
  bindings: ChannelProjectBindingRecord[],
  lookupKeys: string[]
): ChannelProjectBindingRecord | null {
  for (const key of lookupKeys) {
    const match = bindings.find((entry) => entry.channelKey === key) ?? null;
    if (match) {
      return match;
    }
  }
  return null;
}

function getWorkspaceRoot(context: ChannelProjectBindingContext): string {
  const workspaceDir =
    asString(context.workspaceDir) ??
    asString(process.env.OPENCLAW_WORKSPACE) ??
    process.cwd();
  return path.resolve(expandHome(workspaceDir));
}

function getProjectScopedStorePath(projectRoot: string): string {
  return path.join(
    path.resolve(expandHome(projectRoot)),
    ".openclaw-research",
    "channel-project-bindings.json"
  );
}

export function getProjectBindingAuditPath(projectRoot: string): string {
  return path.join(
    path.resolve(expandHome(projectRoot)),
    ".openclaw-research",
    "channel-project-binding-audit.jsonl"
  );
}

function getProjectsRoot(policy: Required<ChannelProjectBindingPolicy>): string | null {
  const explicit = asString(policy.projectsRoot);
  return explicit ? path.resolve(expandHome(explicit)) : null;
}

function getProjectsScopedFallbackStorePath(projectsRoot: string): string {
  return path.join(
    path.resolve(expandHome(projectsRoot)),
    ".openclaw-research",
    "channel-project-bindings.json"
  );
}

function emptyBindingIndexStore(): ChannelProjectBindingIndexStore {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    bindings: [],
  };
}

export function getProjectsBindingIndexPath(projectsRoot: string): string {
  return path.join(
    path.resolve(expandHome(projectsRoot)),
    ".openclaw-research",
    "channel-project-bindings.index.json"
  );
}

export function getProjectsBindingAuditPath(projectsRoot: string): string {
  return path.join(
    path.resolve(expandHome(projectsRoot)),
    ".openclaw-research",
    "channel-project-binding-audit.jsonl"
  );
}

export async function readChannelProjectBindingAuditTail(params: {
  auditPath: string;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  const { maxArchives } = getChannelBindingAuditRotationConfig();
  return readRotatingJsonlTail({
    activeLogPath: params.auditPath,
    maxArchives,
    tailLines: params.tailLines,
  });
}

export async function readProjectBindingAuditTail(params: {
  projectRoot: string;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  return readChannelProjectBindingAuditTail({
    auditPath: getProjectBindingAuditPath(params.projectRoot),
    tailLines: params.tailLines,
  });
}

export async function readProjectsBindingAuditTail(params: {
  projectsRoot: string;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  return readChannelProjectBindingAuditTail({
    auditPath: getProjectsBindingAuditPath(params.projectsRoot),
    tailLines: params.tailLines,
  });
}

async function listCandidateProjectBindingStorePaths(
  projectsRoot: string
): Promise<string[]> {
  try {
    const entries = await fsp.readdir(projectsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(
          projectsRoot,
          entry.name,
          ".openclaw-research",
          "channel-project-bindings.json"
        )
      );
  } catch {
    return [];
  }
}

function normalizeRecord(record: Partial<ChannelProjectBindingRecord>): ChannelProjectBindingRecord | null {
  const channelKey = normalizeBindingChannelKey(asString(record.channelKey) ?? null);
  const projectRoot = asString(record.projectRoot);
  if (!channelKey || !projectRoot) {
    return null;
  }
  return {
    channelKey,
    projectRoot: path.resolve(expandHome(projectRoot)),
    projectId: asString(record.projectId) ?? path.basename(projectRoot),
    messageChannel: normalizeChannelKey(asString(record.messageChannel) ?? null),
    sessionKeySample: asString(record.sessionKeySample),
    sessionId: asString(record.sessionId),
    boundAt: asString(record.boundAt) ?? new Date(0).toISOString(),
    updatedAt: asString(record.updatedAt) ?? new Date(0).toISOString(),
    boundByAgent: normalizeChannelKey(asString(record.boundByAgent) ?? null),
    notes: asString(record.notes),
    workflowRole: asString(record.workflowRole) ?? null,
    workflowSessionKey: asString(record.workflowSessionKey) ?? null,
    workflowSessionId: asString(record.workflowSessionId) ?? null,
    parentWorkflowSessionKey: asString(record.parentWorkflowSessionKey) ?? null,
    threadBindingKey: asString(record.threadBindingKey) ?? null,
    depth:
      typeof record.depth === "number" && Number.isFinite(record.depth)
        ? Math.max(0, Math.floor(record.depth))
        : null,
    lineageKey: asString(record.lineageKey) ?? null,
    workflowBindingMode:
      record.workflowBindingMode === "explicit_thread" ||
      record.workflowBindingMode === "derived_thread"
        ? record.workflowBindingMode
        : "channel_only",
    workflowIsolationMode: normalizeWorkflowIsolationMode(record.workflowIsolationMode),
    workflowAllowedRoles: normalizeWorkflowAllowedRoles(record.workflowAllowedRoles),
    workflowAllowedAgentIds: normalizeWorkflowAllowedAgentIds(
      record.workflowAllowedAgentIds
    ),
    workflowBroadcastSessionKey:
      asString(record.workflowBroadcastSessionKey) ??
      asString(record.workflowSessionKey) ??
      null,
  };
}

function normalizeIndexEntry(
  record: Partial<ChannelProjectBindingIndexEntry>
): ChannelProjectBindingIndexEntry | null {
  const binding = normalizeRecord(record);
  const storePath = asString(record.storePath);
  if (!binding || !storePath) {
    return null;
  }
  return {
    ...binding,
    storePath: path.resolve(expandHome(storePath)),
  };
}

function normalizeBindingIndexStore(
  value: unknown
): ChannelProjectBindingIndexStore {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bindings = Array.isArray(record.bindings)
    ? record.bindings
        .map((entry) => normalizeIndexEntry(entry as Partial<ChannelProjectBindingIndexEntry>))
        .filter((entry): entry is ChannelProjectBindingIndexEntry => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    updatedAt: asString(record.updatedAt) ?? new Date(0).toISOString(),
    bindings,
  };
}

function readBindingIndex(projectsRoot: string): ChannelProjectBindingIndexStore {
  const indexPath = getProjectsBindingIndexPath(projectsRoot);
  let fileMtimeMs: number | null = null;
  try {
    fileMtimeMs = fs.statSync(indexPath).mtimeMs;
  } catch {
    fileMtimeMs = null;
  }
  const cached = bindingIndexCache.get(indexPath);
  if (
    cached &&
    Date.now() - cached.loadedAt <= BINDING_INDEX_CACHE_TTL_MS &&
    cached.fileMtimeMs === fileMtimeMs
  ) {
    return cached.store;
  }
  let store: ChannelProjectBindingIndexStore;
  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    store = normalizeBindingIndexStore(JSON.parse(raw));
  } catch {
    store = emptyBindingIndexStore();
  }
  bindingIndexCache.set(indexPath, {
    loadedAt: Date.now(),
    fileMtimeMs,
    store,
  });
  return store;
}

async function readStoreAsync(storePath: string): Promise<ChannelProjectBindingsStore> {
  const parsed = await readJsonIfExists<{
    updatedAt?: string;
    bindings?: Array<Partial<ChannelProjectBindingRecord>>;
  }>(storePath);
  if (!parsed) {
    return {
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      bindings: [],
    };
  }
  const bindings = Array.isArray(parsed.bindings)
    ? parsed.bindings
        .map((entry) => normalizeRecord(entry))
        .filter((entry): entry is ChannelProjectBindingRecord => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    updatedAt: asString(parsed.updatedAt) ?? new Date(0).toISOString(),
    bindings,
  };
}

async function saveBindingIndex(
  projectsRoot: string,
  store: ChannelProjectBindingIndexStore
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  const indexPath = getProjectsBindingIndexPath(projectsRoot);
  await writeJsonAtomicEnsured(indexPath, store);
  let fileMtimeMs: number | null = null;
  try {
    fileMtimeMs = (await fsp.stat(indexPath)).mtimeMs;
  } catch {
    fileMtimeMs = null;
  }
  bindingIndexCache.set(indexPath, {
    loadedAt: Date.now(),
    fileMtimeMs,
    store,
  });
}

export async function rebuildProjectsBindingIndex(params: {
  projectsRoot: string;
}): Promise<ChannelProjectBindingIndexStore> {
  const projectsRoot = path.resolve(expandHome(params.projectsRoot));
  const indexPath = getProjectsBindingIndexPath(projectsRoot);
  return withAdvisoryLock({
    lockPath: `${indexPath}.lock`,
    task: async () => {
      let entries: Array<fs.Dirent<string>> = [];
      try {
        entries = (await fsp.readdir(projectsRoot, {
          withFileTypes: true,
          encoding: "utf8",
        })) as Array<fs.Dirent<string>>;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : null;
        if (code === "ENOENT") {
          const empty = emptyBindingIndexStore();
          await saveBindingIndex(projectsRoot, empty);
          return empty;
        }
        throw error;
      }
      const storePaths = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          path.join(
            projectsRoot,
            entry.name,
            ".openclaw-research",
            "channel-project-bindings.json"
          )
        );
      const stores = await Promise.all(
        storePaths.map(async (storePath) => ({
          storePath,
          store: await readStoreAsync(storePath),
        }))
      );
      const bindings: ChannelProjectBindingIndexEntry[] = [];
      for (const candidate of stores) {
        for (const binding of candidate.store.bindings) {
          if (
            !isProjectRootWithinProjectsRoot({
              projectRoot: binding.projectRoot,
              projectsRoot,
            })
          ) {
            continue;
          }
          bindings.push({
            ...binding,
            storePath: path.resolve(expandHome(candidate.storePath)),
          });
        }
      }
      const next: ChannelProjectBindingIndexStore = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        bindings: bindings.sort((left, right) =>
          left.channelKey.localeCompare(right.channelKey)
        ),
      };
      await saveBindingIndex(projectsRoot, next);
      return next;
    },
  });
}

export async function ensureProjectsBindingIndex(params: {
  projectsRoot: string;
  maxAgeMs?: number;
}): Promise<ChannelProjectBindingIndexStore> {
  const projectsRoot = path.resolve(expandHome(params.projectsRoot));
  const indexPath = getProjectsBindingIndexPath(projectsRoot);
  const maxAgeMs =
    typeof params.maxAgeMs === "number" && Number.isFinite(params.maxAgeMs)
      ? Math.max(0, Math.floor(params.maxAgeMs))
      : BINDING_INDEX_CACHE_TTL_MS;
  const current = await readJsonIfExists<ChannelProjectBindingIndexStore>(indexPath);
  const normalized = current ? normalizeBindingIndexStore(current) : null;
  const updatedAtMs = normalized?.updatedAt ? Date.parse(normalized.updatedAt) : NaN;
  if (
    normalized &&
    Number.isFinite(updatedAtMs) &&
    Date.now() - updatedAtMs <= maxAgeMs
  ) {
    let fileMtimeMs: number | null = null;
    try {
      fileMtimeMs = (await fsp.stat(indexPath)).mtimeMs;
    } catch {
      fileMtimeMs = null;
    }
    bindingIndexCache.set(indexPath, {
      loadedAt: Date.now(),
      fileMtimeMs,
      store: normalized,
    });
    return normalized;
  }
  return rebuildProjectsBindingIndex({
    projectsRoot,
  });
}

export function invalidateProjectsBindingIndexCache(projectsRoot: string): void {
  const indexPath = getProjectsBindingIndexPath(path.resolve(expandHome(projectsRoot)));
  bindingIndexCache.delete(indexPath);
}

async function updateBindingIndexForProjectStore(params: {
  projectsRoot: string;
  storePath: string;
  store: ChannelProjectBindingsStore;
}): Promise<void> {
  const current = readBindingIndex(params.projectsRoot);
  const normalizedStorePath = path.resolve(expandHome(params.storePath));
  const nextBindings = current.bindings.filter(
    (entry) => entry.storePath !== normalizedStorePath
  );
  for (const binding of params.store.bindings) {
    if (
      !isProjectRootWithinProjectsRoot({
        projectRoot: binding.projectRoot,
        projectsRoot: params.projectsRoot,
      })
    ) {
      continue;
    }
    nextBindings.push({
      ...binding,
      storePath: normalizedStorePath,
    });
  }
  await saveBindingIndex(params.projectsRoot, {
    schemaVersion: 1,
    updatedAt: current.updatedAt,
    bindings: nextBindings.sort((left, right) =>
      left.channelKey.localeCompare(right.channelKey)
    ),
  });
}

async function pruneCompetingBindingsAcrossProjects(params: {
  projectsRoot: string;
  keepStorePath: string;
  keepProjectRoot: string;
  aliasKeys: string[];
}): Promise<void> {
  const candidateStorePaths = await listCandidateProjectBindingStorePaths(params.projectsRoot);
  const normalizedKeepStorePath = path.resolve(expandHome(params.keepStorePath));
  const normalizedKeepProjectRoot = path.resolve(expandHome(params.keepProjectRoot));
  for (const candidatePath of candidateStorePaths) {
    const normalizedCandidatePath = path.resolve(expandHome(candidatePath));
    if (normalizedCandidatePath === normalizedKeepStorePath) {
      continue;
    }
    const candidateStore = await readStoreAsync(normalizedCandidatePath);
    const removedBindings = candidateStore.bindings.filter(
      (entry) =>
        params.aliasKeys.includes(entry.channelKey) &&
        path.resolve(entry.projectRoot) !== normalizedKeepProjectRoot
    );
    if (removedBindings.length === 0) {
      continue;
    }
    candidateStore.bindings = candidateStore.bindings.filter(
      (entry) =>
        !(
          params.aliasKeys.includes(entry.channelKey) &&
          path.resolve(entry.projectRoot) !== normalizedKeepProjectRoot
        )
    );
    await saveStore(normalizedCandidatePath, candidateStore);
    await updateBindingIndexForProjectStore({
      projectsRoot: params.projectsRoot,
      storePath: normalizedCandidatePath,
      store: candidateStore,
    });
    await appendBindingAuditEvents({
      projectsRoot: params.projectsRoot,
      projectRoot: removedBindings[0]?.projectRoot ?? null,
      events: removedBindings.map((binding) => ({
        schemaVersion: 1,
        eventId: randomUUID(),
        action: "unbind" as const,
        recordedAt: new Date().toISOString(),
        channelKey: binding.channelKey,
        projectRoot: binding.projectRoot,
        projectId: binding.projectId,
        previousProjectRoot: binding.projectRoot,
        previousProjectId: binding.projectId,
        messageChannel: binding.messageChannel,
        sessionKey: binding.sessionKeySample,
        sessionId: binding.sessionId,
        workflowSessionKey: binding.workflowSessionKey,
        workflowRole: binding.workflowRole,
        actor: "workflow",
        notes:
          "Superseded because the same channel was explicitly rebound to a newer workflow project.",
        storePath: normalizedCandidatePath,
      })),
    });
  }
}

function readStore(storePath: string): ChannelProjectBindingsStore {
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number;
      updatedAt?: string;
      bindings?: Array<Partial<ChannelProjectBindingRecord>>;
    };
    const bindings = Array.isArray(parsed.bindings)
      ? parsed.bindings
          .map((entry) => normalizeRecord(entry))
          .filter((entry): entry is ChannelProjectBindingRecord => Boolean(entry))
      : [];
    return {
      schemaVersion: 1,
      updatedAt: asString(parsed.updatedAt) ?? new Date(0).toISOString(),
      bindings,
    };
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      bindings: [],
    };
  }
}

async function saveStore(
  storePath: string,
  store: ChannelProjectBindingsStore
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  await writeJsonAtomicEnsured(storePath, store);
}

async function appendBindingAuditEvents(params: {
  projectsRoot?: string | null;
  projectRoot?: string | null;
  events: ChannelProjectBindingAuditEvent[];
}): Promise<void> {
  const auditTargets = new Set<string>();
  const projectRoot = asString(params.projectRoot);
  const projectsRoot = asString(params.projectsRoot);
  if (projectRoot) {
    auditTargets.add(getProjectBindingAuditPath(projectRoot));
  }
  if (projectsRoot) {
    auditTargets.add(getProjectsBindingAuditPath(projectsRoot));
  }
  if (auditTargets.size === 0 || params.events.length === 0) {
    return;
  }
  const payload =
    params.events
      .map((event) => JSON.stringify(event))
      .join("\n")
      .concat("\n");
  const { maxBytes, maxArchives } = getChannelBindingAuditRotationConfig();
  for (const auditPath of auditTargets) {
    await appendRotatingJsonlLine({
      activeLogPath: auditPath,
      serializedLine: payload,
      maxBytes,
      maxArchives,
    });
  }
}

function bindingRootsMatch(expectedProjectRoot: string, binding: ChannelProjectBindingRecord): boolean {
  return path.resolve(binding.projectRoot) === path.resolve(expectedProjectRoot);
}

function collectSessionProjectKeys(sessionKey: string | null): string[] {
  if (!sessionKey) {
    return [];
  }
  return uniqueBindingKeys([
    sessionKey,
    normalizeWorkflowSubagentParentSessionKey(sessionKey) ?? null,
  ]);
}

async function findProjectOwnedSessionMatch(params: {
  projectRoot: string;
  sessionKey: string | null;
}): Promise<string | null> {
  const sessionKeys = collectSessionProjectKeys(params.sessionKey);
  if (sessionKeys.length === 0) {
    return null;
  }
  const store = await readWorkflowRuntimeSessionsStore(params.projectRoot).catch(() => null);
  if (!store) {
    return null;
  }
  for (const entry of store.entries) {
    if (
      path.resolve(entry.projectRoot ?? params.projectRoot) !==
      path.resolve(params.projectRoot)
    ) {
      continue;
    }
    if (!["active", "idle", "needs_repair"].includes(entry.status)) {
      continue;
    }
    const candidateKeys = collectSessionProjectKeys(entry.sessionKey).concat(
      collectSessionProjectKeys(entry.requesterSessionKey ?? null),
      collectSessionProjectKeys(entry.parentSessionKey ?? null)
    );
    const matchedKey = candidateKeys.find((candidate) => sessionKeys.includes(candidate)) ?? null;
    if (matchedKey) {
      return matchedKey;
    }
  }
  return null;
}

export async function evaluateChannelProjectBindingGate(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
  projectRoot: string;
  projectId?: string | null;
  sessionKey?: string | null;
  allowSessionProjectFallback?: boolean;
  allowSessionFallbackOnBindingMismatch?: boolean;
}): Promise<ChannelProjectBindingGateResult> {
  const policy = normalizePolicy(params.policy);
  if (!policy.enableChannelProjectBindings) {
    return {
      allowed: true,
      reason: "binding_gate_disabled",
      matchedBy: "none",
      channelKey: resolveChannelProjectKey({
        ...(params.context ?? {}),
        sessionKey: params.sessionKey ?? params.context?.sessionKey,
      }),
      expectedProjectRoot: path.resolve(expandHome(params.projectRoot)),
      expectedProjectId: asString(params.projectId) ?? path.basename(params.projectRoot),
      currentBinding: null,
      matchedSessionKey: null,
    };
  }

  const expectedProjectRoot = path.resolve(expandHome(params.projectRoot));
  const expectedProjectId =
    asString(params.projectId) ?? path.basename(expectedProjectRoot);
  const context: ChannelProjectBindingContext = {
    ...(params.context ?? {}),
    sessionKey: params.sessionKey ?? params.context?.sessionKey,
  };
  const lookup = getChannelProjectBinding({
    policy,
    context,
  });

  if (lookup.binding && bindingRootsMatch(expectedProjectRoot, lookup.binding)) {
    return {
      allowed: true,
      reason: "binding_match",
      matchedBy: "binding",
      channelKey: lookup.channelKey,
      expectedProjectRoot,
      expectedProjectId,
      currentBinding: lookup.binding,
      matchedSessionKey: null,
    };
  }

  const sessionMatch =
    params.allowSessionProjectFallback === true
      ? await findProjectOwnedSessionMatch({
          projectRoot: expectedProjectRoot,
          sessionKey: asString(context.sessionKey) ?? null,
        })
      : null;
  if (
    sessionMatch &&
    (!lookup.binding || params.allowSessionFallbackOnBindingMismatch === true)
  ) {
    return {
      allowed: true,
      reason: "session_project_match",
      matchedBy: "session",
      channelKey: lookup.channelKey,
      expectedProjectRoot,
      expectedProjectId,
      currentBinding: lookup.binding,
      matchedSessionKey: sessionMatch,
    };
  }

  return {
    allowed: false,
    reason: lookup.binding
      ? "binding_project_mismatch"
      : params.allowSessionProjectFallback
        ? "session_project_missing"
        : "binding_missing",
    matchedBy: "none",
    channelKey: lookup.channelKey,
    expectedProjectRoot,
    expectedProjectId,
    currentBinding: lookup.binding,
    matchedSessionKey: sessionMatch,
  };
}

export function resolveChannelProjectBindingsPath(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
}): string {
  const policy = normalizePolicy(params.policy);
  const projectsRoot = getProjectsRoot(policy);
  const projectRoot = asString(params.context?.projectRoot);
  if (projectRoot && projectsRoot) {
    return getProjectScopedStorePath(
      assertProjectRootWithinProjectsRoot({
        projectRoot,
        projectsRoot,
        sourceLabel: "Channel-project binding",
      })
    );
  }
  if (projectsRoot) {
    return getProjectsScopedFallbackStorePath(projectsRoot);
  }
  const workspaceRoot = getWorkspaceRoot(params.context ?? {});
  return path.join(workspaceRoot, ".openclaw-research", "channel-project-bindings.json");
}

export function resolveChannelProjectKey(
  context: ChannelProjectBindingContext | undefined
): string | null {
  return resolveChannelProjectLookup(context).primaryKey;
}

export function getDirectProjectRootFromEnv(): string | null {
  const direct = asString(process.env.OPENCLAW_PROJECT);
  return direct ? path.resolve(expandHome(direct)) : null;
}

export function getChannelProjectBinding(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
  channelKey?: string;
}): {
  enabled: boolean;
  storePath: string;
  channelKey: string | null;
  binding: ChannelProjectBindingRecord | null;
} {
  const policy = normalizePolicy(params.policy);
  const context = {
    ...(params.context ?? {}),
    channelKey: params.channelKey ?? params.context?.channelKey,
  };
  const storePath = resolveChannelProjectBindingsPath({ policy, context });
  const lookup = resolveChannelProjectLookup(context);
  if (!policy.enableChannelProjectBindings || !lookup.primaryKey) {
    return {
      enabled: policy.enableChannelProjectBindings,
      storePath,
      channelKey: lookup.primaryKey,
      binding: null,
    };
  }
  const store = readStore(storePath);
  const directBinding = findBindingByKeys(store.bindings, lookup.lookupKeys);
  const projectsRoot = getProjectsRoot(policy);
  if (
    directBinding &&
    (!projectsRoot ||
      isProjectRootWithinProjectsRoot({
        projectRoot: directBinding.projectRoot,
        projectsRoot,
      }))
  ) {
    return {
      enabled: true,
      storePath,
      channelKey: lookup.primaryKey,
      binding: directBinding,
    };
  }
  if (projectsRoot && lookup.projectScanKeys.length > 0) {
    try {
      const index = readBindingIndex(projectsRoot);
      const matchedCandidates: Array<{
        binding: ChannelProjectBindingRecord;
        storePath: string;
      }> = [];
      for (const candidateEntry of index.bindings) {
        if (candidateEntry.storePath === storePath) {
          continue;
        }
        if (
          !isProjectRootWithinProjectsRoot({
            projectRoot: candidateEntry.projectRoot,
            projectsRoot,
          })
        ) {
          continue;
        }
        if (!lookup.projectScanKeys.includes(candidateEntry.channelKey)) {
          continue;
        }
        matchedCandidates.push({
          binding: candidateEntry,
          storePath: candidateEntry.storePath,
        });
      }
      const uniqueMatchedProjectRoots = new Set(
        matchedCandidates.map((entry) => path.resolve(entry.binding.projectRoot))
      );
      if (uniqueMatchedProjectRoots.size > 1) {
        return {
          enabled: true,
          storePath,
          channelKey: lookup.primaryKey,
          binding: null,
        };
      }
      const matchedCandidate = matchedCandidates.sort(
        (left, right) =>
          new Date(right.binding.updatedAt).getTime() -
          new Date(left.binding.updatedAt).getTime()
      )[0];
      if (matchedCandidate) {
        return {
          enabled: true,
          storePath: matchedCandidate.storePath,
          channelKey: lookup.primaryKey,
          binding: matchedCandidate.binding,
        };
      }
    } catch {
      // Ignore projectsRoot scan failures and fall back to the local store.
    }
  }
  return {
    enabled: true,
    storePath,
    channelKey: lookup.primaryKey,
    binding: null,
  };
}

export function listChannelProjectBindings(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
}): {
  enabled: boolean;
  storePath: string;
  bindings: ChannelProjectBindingRecord[];
} {
  const policy = normalizePolicy(params.policy);
  const storePath = resolveChannelProjectBindingsPath({
    policy,
    context: params.context,
  });
  const projectsRoot = getProjectsRoot(policy);
  if (projectsRoot) {
    const bindingsByKey = new Map<string, ChannelProjectBindingRecord>();
    const index = readBindingIndex(projectsRoot);
    for (const binding of index.bindings) {
      if (
        !isProjectRootWithinProjectsRoot({
          projectRoot: binding.projectRoot,
          projectsRoot,
        })
      ) {
        continue;
      }
      const existing = bindingsByKey.get(binding.channelKey);
      if (
        !existing ||
        new Date(binding.updatedAt).getTime() >
          new Date(existing.updatedAt).getTime()
      ) {
        bindingsByKey.set(binding.channelKey, binding);
      }
    }
    if (bindingsByKey.size > 0) {
      return {
        enabled: policy.enableChannelProjectBindings,
        storePath: projectsRoot,
        bindings: [...bindingsByKey.values()].sort((left, right) =>
          left.channelKey.localeCompare(right.channelKey)
        ),
      };
    }
  }
  return {
    enabled: policy.enableChannelProjectBindings,
    storePath,
    bindings: readStore(storePath).bindings,
  };
}

export function resolveProjectContext(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
  invalidEnvProjectRootMode?: InvalidEnvProjectRootMode;
}): ResolvedProjectContext {
  const policy = normalizePolicy(params.policy);
  const projectsRoot = getProjectsRoot(policy);
  const storePath = resolveChannelProjectBindingsPath({
    policy,
    context: params.context,
  });
  if (policy.enableChannelProjectBindings) {
    const bindingLookup = getChannelProjectBinding({
      policy,
      context: params.context,
    });
    if (
      bindingLookup.binding &&
      isWorkflowBindingVisibleToAgent({
        binding: bindingLookup.binding,
        agentId: resolveContextActorId(params.context),
        sessionKey: asString(params.context?.sessionKey),
      })
    ) {
      return {
        enabled: true,
        channelKey: bindingLookup.channelKey,
        projectRoot: bindingLookup.binding.projectRoot,
        projectId:
          bindingLookup.binding.projectId ??
          path.basename(bindingLookup.binding.projectRoot),
        source: "channel_binding",
        storePath,
        binding: bindingLookup.binding,
      };
    }
  }

  const envProjectRoot = getDirectProjectRootFromEnv();
  if (envProjectRoot) {
    let validatedProjectRoot = envProjectRoot;
    if (projectsRoot) {
      try {
        validatedProjectRoot = assertProjectRootWithinProjectsRoot({
          projectRoot: envProjectRoot,
          projectsRoot,
          sourceLabel: "OPENCLAW_PROJECT",
        });
      } catch (error) {
        if (params.invalidEnvProjectRootMode === "ignore") {
          return {
            enabled: policy.enableChannelProjectBindings,
            channelKey: resolveChannelProjectKey(params.context),
            projectRoot: null,
            projectId: null,
            source: "none",
            storePath,
            binding: null,
          };
        }
        throw error;
      }
    }
    return {
      enabled: policy.enableChannelProjectBindings,
      channelKey: resolveChannelProjectKey(params.context),
      projectRoot: validatedProjectRoot,
      projectId: path.basename(validatedProjectRoot),
      source: "env",
      storePath,
      binding: null,
    };
  }

  return {
    enabled: policy.enableChannelProjectBindings,
    channelKey: resolveChannelProjectKey(params.context),
    projectRoot: null,
    projectId: null,
    source: "none",
    storePath,
    binding: null,
  };
}

export async function setChannelProjectBinding(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
  channelKey?: string;
  projectRoot: string;
  projectId?: string | null;
  messageChannel?: string | null;
  boundByAgent?: string | null;
  notes?: string | null;
  runtimeSession?: WorkflowRuntimeSessionBinding | null;
}): Promise<{
  enabled: boolean;
  storePath: string;
  binding: ChannelProjectBindingRecord;
}> {
  const policy = normalizePolicy(params.policy);
  if (!policy.enableChannelProjectBindings) {
    throw new Error("Channel-project bindings are disabled by plugin policy.");
  }
  const context = {
    ...(params.context ?? {}),
    channelKey: params.channelKey ?? params.context?.channelKey,
    projectRoot: params.projectRoot,
  };
  const channelKey = resolveChannelProjectKey(context);
  if (!channelKey) {
    throw new Error("Unable to resolve the current channel key for project binding.");
  }
  const projectRoot = path.resolve(expandHome(params.projectRoot));
  const projectsRoot = getProjectsRoot(policy);
  await fsp.access(projectRoot);
  if (projectsRoot) {
    assertProjectRootWithinProjectsRoot({
      projectRoot,
      projectsRoot,
      sourceLabel: "Channel-project binding",
    });
  }

  const storePath = resolveChannelProjectBindingsPath({ policy, context });
  const store = readStore(storePath);
  const now = new Date().toISOString();
  const aliasKeys = uniqueBindingKeys([
    channelKey,
    sessionKeyToChannelKey(asString(context.sessionKey)),
  ]).filter(
    (key) => key === channelKey || !isWeakWorkflowBindingChannelKey(key)
  );
  const existing =
    store.bindings.find((entry) => aliasKeys.includes(entry.channelKey)) ?? null;
  const workflowIsolationMode =
    existing?.workflowIsolationMode ?? normalizeWorkflowIsolationMode(null);
  const workflowAllowedRoles =
    existing?.workflowAllowedRoles ?? normalizeWorkflowAllowedRoles(null);
  const workflowAllowedAgentIds =
    existing?.workflowAllowedAgentIds ?? normalizeWorkflowAllowedAgentIds(null);
  const runtimeSession =
    params.runtimeSession ??
    buildWorkflowRuntimeSessionBinding({
      projectRoot,
      projectId: params.projectId,
      role: resolveContextActorId(context) ?? asString(params.boundByAgent) ?? null,
      sessionKey: context.sessionKey,
      sessionId: context.sessionId,
      parentSessionKey: context.parentSessionKey,
      threadBindingKey: context.threadBindingKey,
      depth: context.depth,
    });
  const workflowActorId = resolveContextActorId(context) ?? asString(params.boundByAgent) ?? null;
  const actorMayOwnWorkflowBinding =
    workflowIsolationMode === "channel_shared" ||
    isProjectWorkflowAgentId(
      workflowActorId,
      workflowAllowedRoles,
      workflowAllowedAgentIds
    );
  const workflowSessionKey = actorMayOwnWorkflowBinding
    ? runtimeSession.sessionKey
    : existing?.workflowSessionKey ?? null;
  const workflowSessionId = actorMayOwnWorkflowBinding
    ? runtimeSession.sessionId
    : existing?.workflowSessionId ?? null;
  const workflowRole = actorMayOwnWorkflowBinding
    ? runtimeSession.role
    : existing?.workflowRole ?? null;
  const parentWorkflowSessionKey = actorMayOwnWorkflowBinding
    ? runtimeSession.parentSessionKey
    : existing?.parentWorkflowSessionKey ?? null;
  const threadBindingKey = actorMayOwnWorkflowBinding
    ? runtimeSession.threadBindingKey
    : existing?.threadBindingKey ?? null;
  const depth = actorMayOwnWorkflowBinding
    ? runtimeSession.depth
    : existing?.depth ?? null;
  const lineageKey = actorMayOwnWorkflowBinding
    ? runtimeSession.lineageKey
    : existing?.lineageKey ?? null;
  const workflowBindingMode = actorMayOwnWorkflowBinding
    ? runtimeSession.bindingMode
    : existing?.workflowBindingMode ?? "channel_only";
  const baseBinding: ChannelProjectBindingRecord = {
    channelKey,
    projectRoot,
    projectId: asString(params.projectId) ?? path.basename(projectRoot),
    messageChannel:
      normalizeChannelKey(asString(params.messageChannel) ?? null) ??
      normalizeChannelKey(asString(context.messageChannel) ?? null),
    sessionKeySample: asString(context.sessionKey),
    sessionId: asString(context.sessionId),
    boundAt: existing?.boundAt ?? now,
    updatedAt: now,
    boundByAgent:
      normalizeChannelKey(asString(params.boundByAgent) ?? null) ??
      existing?.boundByAgent ??
      null,
    notes: asString(params.notes) ?? existing?.notes ?? null,
    workflowRole,
    workflowSessionKey,
    workflowSessionId,
    parentWorkflowSessionKey,
    threadBindingKey,
    depth,
    lineageKey,
    workflowBindingMode,
    workflowIsolationMode,
    workflowAllowedRoles,
    workflowAllowedAgentIds,
    workflowBroadcastSessionKey: actorMayOwnWorkflowBinding
      ? runtimeSession.sessionKey
      : resolveWorkflowBroadcastSessionKey(existing),
  };
  const nextBindings = aliasKeys.map<ChannelProjectBindingRecord>((key) => ({
    ...baseBinding,
    channelKey: key,
  }));
  store.bindings = [
    ...store.bindings.filter((entry) => !aliasKeys.includes(entry.channelKey)),
    ...nextBindings,
  ].sort((left, right) => left.channelKey.localeCompare(right.channelKey));
  await saveStore(storePath, store);
  if (projectsRoot) {
    await pruneCompetingBindingsAcrossProjects({
      projectsRoot,
      keepStorePath: storePath,
      keepProjectRoot: projectRoot,
      aliasKeys,
    });
    await updateBindingIndexForProjectStore({
      projectsRoot,
      storePath,
      store,
    });
  }
  await appendBindingAuditEvents({
    projectsRoot,
    projectRoot,
    events: [
      {
        schemaVersion: 1,
        eventId: randomUUID(),
        action: existing ? "rebind" : "bind",
        recordedAt: now,
        channelKey,
        projectRoot,
        projectId: baseBinding.projectId,
        previousProjectRoot: existing?.projectRoot ?? null,
        previousProjectId: existing?.projectId ?? null,
        messageChannel: baseBinding.messageChannel,
        sessionKey: baseBinding.sessionKeySample,
        sessionId: baseBinding.sessionId,
        workflowSessionKey: baseBinding.workflowSessionKey,
        workflowRole: baseBinding.workflowRole,
        actor: baseBinding.boundByAgent,
        notes: baseBinding.notes,
        storePath,
      },
    ],
  });
  return {
    enabled: true,
    storePath,
    binding: baseBinding,
  };
}

export async function clearChannelProjectBinding(params: {
  policy?: ChannelProjectBindingPolicy;
  context?: ChannelProjectBindingContext;
  channelKey?: string;
}): Promise<{
  enabled: boolean;
  storePath: string;
  channelKey: string | null;
  removed: boolean;
}> {
  const policy = normalizePolicy(params.policy);
  if (!policy.enableChannelProjectBindings) {
    throw new Error("Channel-project bindings are disabled by plugin policy.");
  }
  const context = {
    ...(params.context ?? {}),
    channelKey: params.channelKey ?? params.context?.channelKey,
  };
  const storePath = resolveChannelProjectBindingsPath({ policy, context });
  const lookup = resolveChannelProjectLookup(context);
  const projectsRoot = getProjectsRoot(policy);
  if (!lookup.primaryKey) {
    throw new Error("Unable to resolve the current channel key for project unbinding.");
  }
  let effectiveStorePath = storePath;
  let store = readStore(storePath);
  if (
    !findBindingByKeys(store.bindings, lookup.lookupKeys) &&
    projectsRoot &&
    lookup.projectScanKeys.length > 0
  ) {
    const indexMatch =
      readBindingIndex(projectsRoot).bindings.find((entry) =>
        lookup.projectScanKeys.includes(entry.channelKey)
      ) ?? null;
    if (indexMatch && indexMatch.storePath !== storePath) {
      effectiveStorePath = indexMatch.storePath;
      store = readStore(indexMatch.storePath);
    } else {
      const candidateStorePaths = await listCandidateProjectBindingStorePaths(projectsRoot);
      for (const candidatePath of candidateStorePaths) {
        if (candidatePath === storePath) {
          continue;
        }
        const candidateStore = readStore(candidatePath);
        if (findBindingByKeys(candidateStore.bindings, lookup.projectScanKeys)) {
          effectiveStorePath = candidatePath;
          store = candidateStore;
          break;
        }
      }
    }
  }
  const removableKeys = new Set(lookup.lookupKeys);
  const removedBindings = store.bindings.filter((entry) =>
    removableKeys.has(entry.channelKey)
  );
  const nextBindings = store.bindings.filter((entry) => !removableKeys.has(entry.channelKey));
  const removed = nextBindings.length !== store.bindings.length;
  if (removed) {
    store.bindings = nextBindings;
    await saveStore(effectiveStorePath, store);
    if (projectsRoot) {
      await updateBindingIndexForProjectStore({
        projectsRoot,
        storePath: effectiveStorePath,
        store,
      });
    }
    await appendBindingAuditEvents({
      projectsRoot,
      projectRoot: removedBindings[0]?.projectRoot ?? null,
      events: removedBindings.map((binding) => ({
        schemaVersion: 1,
        eventId: randomUUID(),
        action: "unbind" as const,
        recordedAt: new Date().toISOString(),
        channelKey: binding.channelKey,
        projectRoot: binding.projectRoot,
        projectId: binding.projectId,
        previousProjectRoot: binding.projectRoot,
        previousProjectId: binding.projectId,
        messageChannel: binding.messageChannel,
        sessionKey: binding.sessionKeySample,
        sessionId: binding.sessionId,
        workflowSessionKey: binding.workflowSessionKey,
        workflowRole: binding.workflowRole,
        actor: normalizeChannelKey(asString(context.role) ?? null),
        notes: binding.notes,
        storePath: effectiveStorePath,
      })),
    });
  }
  return {
    enabled: true,
    storePath: effectiveStorePath,
    channelKey: lookup.primaryKey,
    removed,
  };
}
