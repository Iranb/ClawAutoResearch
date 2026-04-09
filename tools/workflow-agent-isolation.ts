export type WorkflowIsolationMode = "workflow_roles_only" | "channel_shared";

export const DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES = [
  "researcher",
  "planner",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
  "cross-reviewer",
] as const;

type WorkflowBindingIsolationShape = {
  workflowIsolationMode?: string | null;
  workflowAllowedRoles?: unknown;
  workflowAllowedAgentIds?: unknown;
  workflowRole?: string | null;
  workflowSessionKey?: string | null;
  workflowBroadcastSessionKey?: string | null;
  sessionKeySample?: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeWorkflowActorId(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("cross-reviewer") || normalized.includes("cross_reviewer")) {
    return "cross-reviewer";
  }
  if (
    normalized.includes("academic_writer") ||
    normalized.includes("academic-writer") ||
    normalized === "writer"
  ) {
    return "academic_writer";
  }
  return normalized;
}

function extractAgentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const raw = readString(sessionKey);
  if (!raw?.startsWith("agent:")) {
    return null;
  }
  const parts = raw.split(":");
  return normalizeWorkflowActorId(parts[1] ?? null);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = readString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export function normalizeWorkflowIsolationMode(value: unknown): WorkflowIsolationMode {
  return readString(value) === "channel_shared"
    ? "channel_shared"
    : "workflow_roles_only";
}

export function normalizeWorkflowAllowedRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES];
  }
  const allowedSet = new Set(DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES);
  return uniqueStrings(
    value
      .map((entry) => normalizeWorkflowActorId(entry))
      .filter((entry): entry is string => Boolean(entry && allowedSet.has(entry as never)))
  );
}

export function normalizeWorkflowAllowedAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((entry) => normalizeWorkflowActorId(entry)));
}

export function isProjectWorkflowAgentId(
  agentId: string | null | undefined,
  allowedRoles: readonly string[] = DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES,
  allowedAgentIds: readonly string[] = []
): boolean {
  const normalized = normalizeWorkflowActorId(agentId);
  if (!normalized) {
    return false;
  }
  return allowedAgentIds.includes(normalized) || allowedRoles.includes(normalized);
}

export function isWorkflowManagedAgentContext(params: {
  agentId?: string | null;
  sessionKey?: string | null;
  workflowRole?: string | null;
  visibleBindingWorkflowRole?: string | null;
  allowedRoles?: readonly string[];
  allowedAgentIds?: readonly string[];
}): boolean {
  const allowedRoles = params.allowedRoles ?? DEFAULT_PROJECT_WORKFLOW_ALLOWED_ROLES;
  const allowedAgentIds = params.allowedAgentIds ?? [];
  const candidates = [
    params.agentId,
    params.workflowRole,
    params.visibleBindingWorkflowRole,
    extractAgentIdFromSessionKey(params.sessionKey),
  ];
  return candidates.some((candidate) =>
    isProjectWorkflowAgentId(candidate, allowedRoles, allowedAgentIds)
  );
}

export function isWorkflowBindingVisibleToAgent(params: {
  binding: WorkflowBindingIsolationShape | null | undefined;
  agentId?: string | null;
  sessionKey?: string | null;
}): boolean {
  if (!params.binding) {
    return false;
  }
  const mode = normalizeWorkflowIsolationMode(params.binding.workflowIsolationMode);
  if (mode === "channel_shared") {
    return true;
  }
  const normalizedAgentId = normalizeWorkflowActorId(params.agentId);
  if (!normalizedAgentId) {
    return false;
  }
  return isProjectWorkflowAgentId(
    normalizedAgentId,
    normalizeWorkflowAllowedRoles(params.binding.workflowAllowedRoles),
    normalizeWorkflowAllowedAgentIds(params.binding.workflowAllowedAgentIds)
  );
}

function canUseSessionForWorkflowBroadcast(params: {
  sessionKey?: string | null;
  workflowRole?: string | null;
  allowedRoles: readonly string[];
  allowedAgentIds: readonly string[];
}): boolean {
  const fromSession = extractAgentIdFromSessionKey(params.sessionKey);
  if (fromSession) {
    return isProjectWorkflowAgentId(fromSession, params.allowedRoles, params.allowedAgentIds);
  }
  return isProjectWorkflowAgentId(
    params.workflowRole,
    params.allowedRoles,
    params.allowedAgentIds
  );
}

export function resolveWorkflowBroadcastSessionKey(
  binding: WorkflowBindingIsolationShape | null | undefined
): string | null {
  if (!binding) {
    return null;
  }
  const mode = normalizeWorkflowIsolationMode(binding.workflowIsolationMode);
  const allowedRoles = normalizeWorkflowAllowedRoles(binding.workflowAllowedRoles);
  const allowedAgentIds = normalizeWorkflowAllowedAgentIds(binding.workflowAllowedAgentIds);
  const candidates = [
    readString(binding.workflowBroadcastSessionKey),
    readString(binding.workflowSessionKey),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      canUseSessionForWorkflowBroadcast({
        sessionKey: candidate,
        workflowRole: binding.workflowRole,
        allowedRoles,
        allowedAgentIds,
      })
    ) {
      return candidate;
    }
  }
  const sample = readString(binding.sessionKeySample);
  if (!sample) {
    return null;
  }
  if (mode === "channel_shared") {
    return sample;
  }
  return canUseSessionForWorkflowBroadcast({
    sessionKey: sample,
    workflowRole: binding.workflowRole,
    allowedRoles,
    allowedAgentIds,
  })
    ? sample
    : null;
}
