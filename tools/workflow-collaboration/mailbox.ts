import {
  acknowledgeWorkflowMailboxMessageImpl,
  getMailboxPath,
  queueWorkflowMailboxMessageImpl,
  readMailbox,
  readWorkflowMailboxForAgentImpl,
  saveMailbox,
  type WorkflowMailboxItemLike,
  type WorkflowMailboxStoreLike,
} from "../workflow-guard-collaboration";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";

export type WorkflowMailboxItem = WorkflowMailboxItemLike;
export type WorkflowMailboxStore = WorkflowMailboxStoreLike;

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

export { getMailboxPath };

export async function readWorkflowMailbox(projectRoot: string): Promise<WorkflowMailboxStore> {
  return readMailbox({ projectRoot, readJsonIfExists });
}

export async function writeWorkflowMailbox(params: {
  projectRoot: string;
  mailbox: WorkflowMailboxStore;
}): Promise<void> {
  await saveMailbox({
    projectRoot: params.projectRoot,
    mailbox: params.mailbox,
    writeJsonEnsured: writeJsonAtomicEnsured,
  });
}

export async function queueWorkflowMailboxMessage(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  kind?: string;
  priority?: string;
}): Promise<WorkflowMailboxItem> {
  return queueWorkflowMailboxMessageImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured: writeJsonAtomicEnsured,
  });
}

export async function acknowledgeWorkflowMailboxMessage(params: {
  projectRoot: string;
  messageId: string;
  agentId?: string;
}): Promise<WorkflowMailboxItem | null> {
  return acknowledgeWorkflowMailboxMessageImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured: writeJsonAtomicEnsured,
    normalizeRole,
  });
}

export async function readWorkflowMailboxForAgent(params: {
  projectRoot: string;
  agentId?: string;
  limit?: number;
  includeAcknowledged?: boolean;
}): Promise<WorkflowMailboxItem[]> {
  return readWorkflowMailboxForAgentImpl({
    ...params,
    readJsonIfExists,
    normalizeRole,
  });
}
