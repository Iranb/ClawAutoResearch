import path from "node:path";

import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";

export type WorkflowAgentSessionRegistryEntry = {
  role: string;
  sessionKey: string;
  sessionId: string | null;
  projectId: string | null;
  projectRoot: string;
  currentStage: string | null;
  status: "active" | "idle" | "unknown";
  source: "workflow_tool" | "dispatch" | "recovery";
  updatedAt: string;
};

export type WorkflowAgentSessionRegistryStore = {
  schemaVersion: 1;
  updatedAt: string;
  entries: WorkflowAgentSessionRegistryEntry[];
};

const REGISTRY_PATH = ".openclaw-research/workflow-agent-sessions.json";

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRegistryPath(projectRoot: string) {
  return path.join(path.resolve(projectRoot), REGISTRY_PATH);
}

function getRegistryLockPath(projectRoot: string) {
  return `${getRegistryPath(projectRoot)}.lock`;
}

export async function readWorkflowAgentSessionRegistry(
  projectRoot: string
): Promise<WorkflowAgentSessionRegistryStore> {
  return (
    (await readJsonIfExists<WorkflowAgentSessionRegistryStore>(
      getRegistryPath(projectRoot)
    )) ?? {
      schemaVersion: 1,
      updatedAt: nowIso(),
      entries: [],
    }
  );
}

export async function upsertWorkflowAgentSessionRegistryEntry(params: {
  projectRoot: string;
  role: string;
  sessionKey: string;
  sessionId?: string | null;
  projectId?: string | null;
  currentStage?: string | null;
  status?: "active" | "idle" | "unknown";
  source?: "workflow_tool" | "dispatch" | "recovery";
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const role = readString(params.role);
  const sessionKey = readString(params.sessionKey);
  if (!role || !sessionKey) {
    return await readWorkflowAgentSessionRegistry(projectRoot);
  }
  return withAdvisoryLock({
    lockPath: getRegistryLockPath(projectRoot),
    task: async () => {
      const store = await readWorkflowAgentSessionRegistry(projectRoot);
      const entry: WorkflowAgentSessionRegistryEntry = {
        role,
        sessionKey,
        sessionId: readString(params.sessionId),
        projectId: readString(params.projectId),
        projectRoot,
        currentStage: readString(params.currentStage),
        status: params.status ?? "active",
        source: params.source ?? "workflow_tool",
        updatedAt: nowIso(),
      };
      const nextEntries = store.entries.filter(
        (candidate) =>
          !(
            candidate.role === entry.role &&
            (candidate.sessionKey === entry.sessionKey ||
              (candidate.sessionId &&
                entry.sessionId &&
                candidate.sessionId === entry.sessionId))
          )
      );
      nextEntries.unshift(entry);
      const next: WorkflowAgentSessionRegistryStore = {
        schemaVersion: 1,
        updatedAt: entry.updatedAt,
        entries: nextEntries.slice(0, 64),
      };
      await writeJsonAtomicEnsured(getRegistryPath(projectRoot), next);
      return next;
    },
  });
}

export async function getPreferredWorkflowAgentSession(params: {
  projectRoot: string;
  role: string;
  currentStage?: string | null;
}): Promise<WorkflowAgentSessionRegistryEntry | null> {
  const role = readString(params.role);
  if (!role) {
    return null;
  }
  const store = await readWorkflowAgentSessionRegistry(params.projectRoot);
  const currentStage = readString(params.currentStage);
  const matches = store.entries.filter((entry) => {
    if (entry.role !== role) {
      return false;
    }
    if (entry.status !== "active") {
      return false;
    }
    if (!currentStage || !entry.currentStage) {
      return true;
    }
    return entry.currentStage === currentStage;
  });
  return matches[0] ?? null;
}
