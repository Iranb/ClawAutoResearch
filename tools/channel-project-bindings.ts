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
  projectRoot?: string;
  role?: string;
  parentSessionKey?: string;
  threadBindingKey?: string;
  depth?: number;
}

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

export type ResolvedProjectContext = {
  enabled: boolean;
  channelKey: string | null;
  projectRoot: string | null;
  projectId: string | null;
  source: "channel_binding" | "env" | "none";
  storePath: string;
  binding: ChannelProjectBindingRecord | null;
};

const DEFAULT_POLICY: Required<ChannelProjectBindingPolicy> = {
  enableChannelProjectBindings: false,
  channelProjectBindingsPath: "",
  projectsRoot: "",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const normalized = normalizeChannelKey(value);
  if (!normalized) {
    return null;
  }
  const subagentMarker = normalized.indexOf(":subagent:");
  return subagentMarker > 0 ? normalized.slice(0, subagentMarker) : normalized;
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
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
  await fsp.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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
  if (!context) {
    return null;
  }
  const explicit = normalizeBindingChannelKey(asString(context.channelKey) ?? null);
  if (explicit) {
    return explicit;
  }
  const fromSessionKey = sessionKeyToChannelKey(asString(context.sessionKey));
  if (fromSessionKey) {
    return fromSessionKey;
  }
  const sessionId = normalizeChannelKey(asString(context.sessionId) ?? null);
  if (sessionId) {
    return `session:${sessionId}`;
  }
  return null;
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
  const channelKey = resolveChannelProjectKey(context);
  if (!policy.enableChannelProjectBindings || !channelKey) {
    return {
      enabled: policy.enableChannelProjectBindings,
      storePath,
      channelKey,
      binding: null,
    };
  }
  const store = readStore(storePath);
  const directBinding =
    store.bindings.find((entry) => entry.channelKey === channelKey) ?? null;
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
      channelKey,
      binding: directBinding,
    };
  }
  if (projectsRoot) {
    try {
      const candidateStorePaths = fs
        .readdirSync(projectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          path.join(
            projectsRoot,
            entry.name,
            ".openclaw-research",
            "channel-project-bindings.json"
          )
        )
        .filter((candidate) => candidate !== storePath);
      let matchedBinding: ChannelProjectBindingRecord | null = null;
      let matchedStorePath = storePath;
      for (const candidatePath of candidateStorePaths) {
        const candidateStore = readStore(candidatePath);
        const candidateBinding =
          candidateStore.bindings.find((entry) => entry.channelKey === channelKey) ?? null;
        if (!candidateBinding) {
          continue;
        }
        if (
          !isProjectRootWithinProjectsRoot({
            projectRoot: candidateBinding.projectRoot,
            projectsRoot,
          })
        ) {
          continue;
        }
        if (
          !matchedBinding ||
          new Date(candidateBinding.updatedAt).getTime() >
            new Date(matchedBinding.updatedAt).getTime()
        ) {
          matchedBinding = candidateBinding;
          matchedStorePath = candidatePath;
        }
      }
      if (matchedBinding) {
        return {
          enabled: true,
          storePath: matchedStorePath,
          channelKey,
          binding: matchedBinding,
        };
      }
    } catch {
      // Ignore projectsRoot scan failures and fall back to the local store.
    }
  }
  return {
    enabled: true,
    storePath,
    channelKey,
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
    try {
      const storePaths = fs
        .readdirSync(projectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          path.join(
            projectsRoot,
            entry.name,
            ".openclaw-research",
            "channel-project-bindings.json"
          )
        );
      for (const candidatePath of storePaths) {
        const candidateStore = readStore(candidatePath);
        for (const binding of candidateStore.bindings) {
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
      }
    } catch {
      // Ignore scan failures and fall back to the local store.
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
        agentId: asString(params.context?.role),
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
    const validatedProjectRoot =
      projectsRoot
        ? assertProjectRootWithinProjectsRoot({
            projectRoot: envProjectRoot,
            projectsRoot,
            sourceLabel: "OPENCLAW_PROJECT",
          })
        : envProjectRoot;
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
  const existing = store.bindings.find((entry) => entry.channelKey === channelKey) ?? null;
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
      role: asString(context.role) ?? asString(params.boundByAgent) ?? null,
      sessionKey: context.sessionKey,
      sessionId: context.sessionId,
      parentSessionKey: context.parentSessionKey,
      threadBindingKey: context.threadBindingKey,
      depth: context.depth,
    });
  const workflowActorId =
    asString(context.role) ?? asString(params.boundByAgent) ?? null;
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
  const binding: ChannelProjectBindingRecord = {
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
  store.bindings = [
    ...store.bindings.filter((entry) => entry.channelKey !== channelKey),
    binding,
  ].sort((left, right) => left.channelKey.localeCompare(right.channelKey));
  await saveStore(storePath, store);
  return {
    enabled: true,
    storePath,
    binding,
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
  const channelKey = resolveChannelProjectKey(context);
  const projectsRoot = getProjectsRoot(policy);
  if (!channelKey) {
    throw new Error("Unable to resolve the current channel key for project unbinding.");
  }
  let effectiveStorePath = storePath;
  let store = readStore(storePath);
  if (
    !store.bindings.some((entry) => entry.channelKey === channelKey) &&
    projectsRoot
  ) {
    const candidateStorePaths = await listCandidateProjectBindingStorePaths(projectsRoot);
    for (const candidatePath of candidateStorePaths) {
      if (candidatePath === storePath) {
        continue;
      }
      const candidateStore = readStore(candidatePath);
      if (candidateStore.bindings.some((entry) => entry.channelKey === channelKey)) {
        effectiveStorePath = candidatePath;
        store = candidateStore;
        break;
      }
    }
  }
  const nextBindings = store.bindings.filter((entry) => entry.channelKey !== channelKey);
  const removed = nextBindings.length !== store.bindings.length;
  if (removed) {
    store.bindings = nextBindings;
    await saveStore(effectiveStorePath, store);
  }
  return {
    enabled: true,
    storePath: effectiveStorePath,
    channelKey,
    removed,
  };
}
