import path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";

export type WorkflowTeamRoundStatus = "not_applicable" | "blocked" | "active" | "ready";

export type WorkflowTeamRoundStore = {
  schemaVersion: 1;
  source: "stage_task_graph_v1";
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  leadRole: string | null;
  topTierVerdict: string | null;
  evidenceCloseoutStatus: EvidenceCloseoutSummary["status"];
  taskGraphPath: string | null;
  taskCount: number;
  claimableCount: number;
  claimedCount: number;
  satisfiedCount: number;
  optionalCount: number;
  activeSessionKeys: string[];
  lastClaimedTaskId: string | null;
  generatedAt: string;
  updatedAt: string;
};

const TEAM_ROUND_FILENAME = "workflow-team-round.json";

function nowIso(): string {
  return new Date().toISOString();
}

export function getWorkflowTeamRoundPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", TEAM_ROUND_FILENAME);
}

function getWorkflowTeamRoundLockPath(projectRoot: string): string {
  return `${getWorkflowTeamRoundPath(projectRoot)}.lock`;
}

export async function readWorkflowTeamRoundStore(
  projectRoot: string
): Promise<WorkflowTeamRoundStore | null> {
  const store = await readJsonIfExists<WorkflowTeamRoundStore>(
    getWorkflowTeamRoundPath(projectRoot)
  );
  if (!store) {
    return null;
  }
  return {
    schemaVersion: 1,
    source: "stage_task_graph_v1",
    projectId:
      typeof store.projectId === "string" && store.projectId.trim()
        ? store.projectId.trim()
        : null,
    projectRoot,
    stage:
      typeof store.stage === "string" && store.stage.trim()
        ? store.stage.trim()
        : null,
    leadRole:
      typeof store.leadRole === "string" && store.leadRole.trim()
        ? store.leadRole.trim()
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
    taskGraphPath:
      typeof store.taskGraphPath === "string" && store.taskGraphPath.trim()
        ? store.taskGraphPath.trim()
        : null,
    taskCount: Number.isFinite(store.taskCount) ? Math.max(0, Math.floor(store.taskCount)) : 0,
    claimableCount: Number.isFinite(store.claimableCount)
      ? Math.max(0, Math.floor(store.claimableCount))
      : 0,
    claimedCount: Number.isFinite(store.claimedCount)
      ? Math.max(0, Math.floor(store.claimedCount))
      : 0,
    satisfiedCount: Number.isFinite(store.satisfiedCount)
      ? Math.max(0, Math.floor(store.satisfiedCount))
      : 0,
    optionalCount: Number.isFinite(store.optionalCount)
      ? Math.max(0, Math.floor(store.optionalCount))
      : 0,
    activeSessionKeys: Array.isArray(store.activeSessionKeys)
      ? store.activeSessionKeys.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
        )
      : [],
    lastClaimedTaskId:
      typeof store.lastClaimedTaskId === "string" && store.lastClaimedTaskId.trim()
        ? store.lastClaimedTaskId.trim()
        : null,
    generatedAt:
      typeof store.generatedAt === "string" && store.generatedAt.trim()
        ? store.generatedAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof store.updatedAt === "string" && store.updatedAt.trim()
        ? store.updatedAt
        : new Date(0).toISOString(),
  };
}

function deriveTeamRoundStatus(params: {
  topTierVerdict: string | null;
  evidenceCloseoutStatus: EvidenceCloseoutSummary["status"];
  taskCount: number;
  claimableCount: number;
  claimedCount: number;
}): WorkflowTeamRoundStatus {
  if (params.topTierVerdict !== "worth_top_tier_bet" && params.taskCount === 0) {
    return "not_applicable";
  }
  if (params.evidenceCloseoutStatus === "blocked" && params.claimedCount === 0) {
    return "blocked";
  }
  if (params.claimableCount === 0 && params.claimedCount === 0) {
    return "ready";
  }
  return "active";
}

export async function materializeWorkflowTeamRound(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  leadRole: string | null;
  topTierVerdict: string | null;
  evidenceCloseoutStatus: EvidenceCloseoutSummary["status"];
  taskGraphPath: string | null;
  taskCount: number;
  claimableCount: number;
  claimedCount: number;
  satisfiedCount: number;
  optionalCount: number;
}): Promise<WorkflowTeamRoundStore> {
  const existing = await readWorkflowTeamRoundStore(params.projectRoot);
  const sameStage = existing?.stage === params.stage;
  const now = nowIso();
  const store: WorkflowTeamRoundStore = {
    schemaVersion: 1,
    source: "stage_task_graph_v1",
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stage: params.stage,
    leadRole: params.leadRole,
    topTierVerdict: params.topTierVerdict,
    evidenceCloseoutStatus: params.evidenceCloseoutStatus,
    taskGraphPath: params.taskGraphPath,
    taskCount: params.taskCount,
    claimableCount: params.claimableCount,
    claimedCount: params.claimedCount,
    satisfiedCount: params.satisfiedCount,
    optionalCount: params.optionalCount,
    activeSessionKeys: sameStage ? existing?.activeSessionKeys ?? [] : [],
    lastClaimedTaskId: sameStage ? existing?.lastClaimedTaskId ?? null : null,
    generatedAt: sameStage ? existing?.generatedAt ?? now : now,
    updatedAt: now,
  };
  await writeJsonAtomicEnsured(getWorkflowTeamRoundPath(params.projectRoot), store);
  return {
    ...store,
    source: "stage_task_graph_v1",
    evidenceCloseoutStatus: params.evidenceCloseoutStatus,
  };
}

export async function recordWorkflowTeamRoundClaim(params: {
  projectRoot: string;
  sessionKey: string;
  taskId: string;
}): Promise<WorkflowTeamRoundStore | null> {
  return withAdvisoryLock({
    lockPath: getWorkflowTeamRoundLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTeamRoundStore(params.projectRoot);
      if (!store) {
        return null;
      }
      const alreadyTracked = store.activeSessionKeys.includes(params.sessionKey);
      const nextStore: WorkflowTeamRoundStore = {
        ...store,
        activeSessionKeys: Array.from(new Set([...store.activeSessionKeys, params.sessionKey])),
        lastClaimedTaskId: params.taskId,
        claimableCount: alreadyTracked ? store.claimableCount : Math.max(0, store.claimableCount - 1),
        claimedCount: alreadyTracked ? store.claimedCount : store.claimedCount + 1,
        updatedAt: nowIso(),
      };
      await writeJsonAtomicEnsured(getWorkflowTeamRoundPath(params.projectRoot), nextStore);
      return nextStore;
    },
  });
}

export async function releaseWorkflowTeamRoundSession(params: {
  projectRoot: string;
  sessionKey: string;
}): Promise<WorkflowTeamRoundStore | null> {
  return withAdvisoryLock({
    lockPath: getWorkflowTeamRoundLockPath(params.projectRoot),
    task: async () => {
      const store = await readWorkflowTeamRoundStore(params.projectRoot);
      if (!store) {
        return null;
      }
      const existed = store.activeSessionKeys.includes(params.sessionKey);
      const nextStore: WorkflowTeamRoundStore = {
        ...store,
        activeSessionKeys: store.activeSessionKeys.filter((key) => key !== params.sessionKey),
        claimableCount: existed ? store.claimableCount + 1 : store.claimableCount,
        claimedCount: existed ? Math.max(0, store.claimedCount - 1) : store.claimedCount,
        updatedAt: nowIso(),
      };
      await writeJsonAtomicEnsured(getWorkflowTeamRoundPath(params.projectRoot), nextStore);
      return nextStore;
    },
  });
}

export function summarizeWorkflowTeamRoundStore(store: WorkflowTeamRoundStore | null): {
  status: WorkflowTeamRoundStatus;
  activeSessionCount: number;
} {
  if (!store) {
    return {
      status: "not_applicable",
      activeSessionCount: 0,
    };
  }
  return {
    status: deriveTeamRoundStatus({
      topTierVerdict: store.topTierVerdict,
      evidenceCloseoutStatus: store.evidenceCloseoutStatus,
      taskCount: store.taskCount,
      claimableCount: store.claimableCount,
      claimedCount: store.claimedCount,
    }),
    activeSessionCount: store.activeSessionKeys.length,
  };
}
