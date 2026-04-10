import {
  queueWorkflowMailboxMessageImpl,
  acknowledgeWorkflowMailboxMessageImpl,
  readMailbox,
} from "./workflow-guard-collaboration";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";

type WorkflowMailboxRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

const WORKFLOW_ROLES = new Set<WorkflowMailboxRole>([
  "researcher",
  "planner",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
  "cross-reviewer",
]);

function normalizeRole(value: unknown): WorkflowMailboxRole | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value.trim().toLowerCase() as WorkflowMailboxRole;
  return WORKFLOW_ROLES.has(normalized) ? normalized : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildWorkflowDispatchMailboxSubject(params: {
  stage?: string | null;
  toAgent: string;
}): string {
  const stage = readString(params.stage)?.replace(/_/g, " ") ?? "workflow";
  return `dispatch: ${stage} handoff to ${params.toAgent}`;
}

function buildWorkflowDispatchMailboxBody(params: {
  projectId?: string | null;
  projectRoot: string;
  stage?: string | null;
  summary: string;
  command?: string | null;
  extraBody?: string | null;
  queueKey?: string | null;
}): string {
  return [
    `Project root: ${params.projectRoot}`,
    params.projectId ? `Project ID: ${params.projectId}` : null,
    params.stage ? `Stage: ${params.stage}` : null,
    `Task summary: ${params.summary}`,
    params.command ? `Immediate command: ${params.command}` : null,
    params.queueKey ? `Dispatch queue key: ${params.queueKey}` : null,
    params.extraBody?.trim() ? params.extraBody.trim() : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function ensureWorkflowDispatchMailboxMessage(params: {
  projectRoot: string;
  fromAgent?: string | null;
  toAgent: string;
  projectId?: string | null;
  stage?: string | null;
  summary: string;
  command?: string | null;
  extraBody?: string | null;
  queueKey?: string | null;
  existingMessageId?: string | null;
}): Promise<string | null> {
  const existingMessageId = readString(params.existingMessageId);
  const toAgent = normalizeRole(params.toAgent);
  if (!params.projectRoot || !toAgent) {
    return null;
  }
  if (existingMessageId) {
    const mailbox = await readMailbox({
      projectRoot: params.projectRoot,
      readJsonIfExists,
    });
    const existing = mailbox.messages.find((entry) => entry.id === existingMessageId) ?? null;
    if (existing) {
      return existingMessageId;
    }
  }
  const queued = await queueWorkflowMailboxMessageImpl({
    projectRoot: params.projectRoot,
    fromAgent: readString(params.fromAgent) ?? "researcher",
    toAgent,
    subject: buildWorkflowDispatchMailboxSubject({
      stage: params.stage,
      toAgent,
    }),
    body: buildWorkflowDispatchMailboxBody({
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      stage: params.stage,
      summary: params.summary,
      command: params.command,
      extraBody: params.extraBody,
      queueKey: params.queueKey,
    }),
    kind: "handoff",
    priority: "normal",
    readJsonIfExists,
    writeJsonEnsured: writeJsonAtomicEnsured,
  });
  return queued.id;
}

export async function waitForWorkflowMailboxAcknowledgement(params: {
  projectRoot: string;
  messageId: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<{
  acknowledged: boolean;
  acknowledgedAt: string | null;
}> {
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(100, Math.floor(params.timeoutMs))
      : 5_000;
  const pollMs =
    typeof params.pollMs === "number" && Number.isFinite(params.pollMs)
      ? Math.max(25, Math.floor(params.pollMs))
      : 100;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const mailbox = await readMailbox({
      projectRoot: params.projectRoot,
      readJsonIfExists,
    });
    const item = mailbox.messages.find((entry) => entry.id === params.messageId) ?? null;
    if (item?.status === "acknowledged") {
      return {
        acknowledged: true,
        acknowledgedAt: item.acknowledgedAt ?? null,
      };
    }
    await sleep(pollMs);
  }

  return {
    acknowledged: false,
    acknowledgedAt: null,
  };
}

export async function autoAcknowledgeWorkflowMailboxForAgent(params: {
  projectRoot: string;
  agentId?: string | null;
  messageIds?: string[] | null;
  handoffOnly?: boolean;
}): Promise<{
  acknowledgedIds: string[];
}> {
  const mailbox = await readMailbox({
    projectRoot: params.projectRoot,
    readJsonIfExists,
  });
  const allowedIds = new Set(
    Array.isArray(params.messageIds)
      ? params.messageIds
          .map((entry) => (typeof entry === "string" && entry.trim() ? entry.trim() : null))
          .filter((entry): entry is string => Boolean(entry))
      : []
  );
  const pendingTargets = mailbox.messages.filter((entry) => {
    if (entry.status !== "pending") {
      return false;
    }
    if (params.handoffOnly !== false && entry.kind !== "handoff") {
      return false;
    }
    if (allowedIds.size > 0 && !allowedIds.has(entry.id)) {
      return false;
    }
    const role = normalizeRole(params.agentId);
    return role ? entry.toAgent === role || entry.toAgent === "*" : false;
  });

  const acknowledgedIds: string[] = [];
  for (const item of pendingTargets) {
    const acknowledged = await acknowledgeWorkflowMailboxMessageImpl({
      projectRoot: params.projectRoot,
      messageId: item.id,
      agentId: params.agentId ?? undefined,
      readJsonIfExists,
      writeJsonEnsured: writeJsonAtomicEnsured,
      normalizeRole,
    });
    if (acknowledged) {
      acknowledgedIds.push(acknowledged.id);
    }
  }

  return { acknowledgedIds };
}
