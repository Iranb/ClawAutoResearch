import path from "node:path";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";
import type { WorkflowStageTaskPreview } from "./stage-profiles";

export type WorkflowTaskGraphTaskStatus = "claimable" | "satisfied" | "optional";

export type WorkflowTaskGraphTask = {
  taskId: string;
  title: string;
  owner: string | null;
  status: WorkflowTaskGraphTaskStatus;
  reason: string | null;
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
  satisfiedCount: number;
  optionalCount: number;
};

const TASK_GRAPH_FILENAME = "workflow-task-graph.json";

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
    statusRaw === "satisfied" || statusRaw === "optional"
      ? (statusRaw as WorkflowTaskGraphTaskStatus)
      : "claimable";
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
  };
}

export function getWorkflowTaskGraphPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", TASK_GRAPH_FILENAME);
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
    claimableCount: tasks.filter((task) => task.status === "claimable").length,
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
  const store: WorkflowTaskGraphStore = {
    schemaVersion: 1,
    source: "stage_preview_v1",
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stage: params.stage,
    topTierVerdict: params.topTierVerdict,
    evidenceCloseoutStatus: params.evidenceCloseout.status,
    generatedAt: nowIso(),
    tasks: params.previewTasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      owner: task.owner,
      status: mapPreviewStatusToTaskStatus(task.status),
      reason: task.reason,
    })),
  };
  await writeJsonAtomicEnsured(getWorkflowTaskGraphPath(params.projectRoot), store);
  return store;
}
