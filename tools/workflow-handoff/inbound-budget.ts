import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKFLOW_INBOUND_DEFAULT_BUDGET_MS } from "./handoff-defaults";

export type WorkflowInboundTurnStatus =
  | "started"
  | "completed_inline"
  | "deferred"
  | "timed_out"
  | "failed";

export type WorkflowInboundTurnRecord = {
  schemaVersion: 1;
  turnId: string;
  projectId: string | null;
  projectRoot: string;
  channelKey: string | null;
  sessionKey: string | null;
  agentId: string | null;
  action: string;
  status: WorkflowInboundTurnStatus;
  inboundBudgetMs: number;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  deferredRunId: string | null;
  deferredQueueKey: string | null;
  idempotencyKey: string;
  summaryPath: string | null;
  error: string | null;
};

export type WorkflowInboundBudgetContext = {
  turn: WorkflowInboundTurnRecord;
  startedAtMs: number;
  deadlineAtMs: number;
  remainingMs: () => number;
  isExhausted: (reserveMs?: number) => boolean;
};

const INBOUND_TURNS_FILENAME = "workflow-inbound-turns.jsonl";

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getWorkflowInboundTurnsPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    INBOUND_TURNS_FILENAME
  );
}

async function appendWorkflowInboundTurnRecord(
  record: WorkflowInboundTurnRecord
): Promise<void> {
  const targetPath = getWorkflowInboundTurnsPath(record.projectRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.appendFile(targetPath, `${JSON.stringify(record)}\n`, "utf8");
}

export function createWorkflowInboundBudgetContext(params: {
  projectRoot: string;
  projectId?: string | null;
  channelKey?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  action: string;
  inboundBudgetMs?: number | null;
  idempotencyKey?: string | null;
}): WorkflowInboundBudgetContext {
  const startedAtMs = Date.now();
  const inboundBudgetMs =
    typeof params.inboundBudgetMs === "number" && Number.isFinite(params.inboundBudgetMs)
      ? Math.max(100, Math.floor(params.inboundBudgetMs))
      : WORKFLOW_INBOUND_DEFAULT_BUDGET_MS;
  const turnId = randomUUID();
  const turn: WorkflowInboundTurnRecord = {
    schemaVersion: 1,
    turnId,
    projectId: readString(params.projectId),
    projectRoot: path.resolve(params.projectRoot),
    channelKey: readString(params.channelKey),
    sessionKey: readString(params.sessionKey),
    agentId: readString(params.agentId),
    action: params.action,
    status: "started",
    inboundBudgetMs,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: null,
    elapsedMs: null,
    deferredRunId: null,
    deferredQueueKey: null,
    idempotencyKey:
      readString(params.idempotencyKey) ??
      [
        "inbound-turn",
        readString(params.projectId) ?? "unknown-project",
        readString(params.channelKey) ?? "unknown-channel",
        params.action,
      ].join(":"),
    summaryPath: null,
    error: null,
  };
  const deadlineAtMs = startedAtMs + inboundBudgetMs;
  return {
    turn,
    startedAtMs,
    deadlineAtMs,
    remainingMs: () => Math.max(0, deadlineAtMs - Date.now()),
    isExhausted: (reserveMs = 0) => Date.now() + Math.max(0, reserveMs) >= deadlineAtMs,
  };
}

export async function recordWorkflowInboundTurnStarted(
  context: WorkflowInboundBudgetContext
): Promise<void> {
  const records = await readWorkflowInboundTurnRecords(context.turn.projectRoot);
  const existing = records
    .filter((entry) => entry.idempotencyKey === context.turn.idempotencyKey)
    .at(-1);
  if (
    existing?.status === "started" &&
    Date.now() - Date.parse(existing.startedAt) <= existing.inboundBudgetMs
  ) {
    Object.assign(context.turn, existing);
    return;
  }
  await appendWorkflowInboundTurnRecord(context.turn);
}

export async function recordWorkflowInboundTurnCompleted(params: {
  context: WorkflowInboundBudgetContext;
  status: Exclude<WorkflowInboundTurnStatus, "started">;
  deferredRunId?: string | null;
  deferredQueueKey?: string | null;
  summaryPath?: string | null;
  error?: string | null;
}): Promise<WorkflowInboundTurnRecord> {
  const completedAtMs = Date.now();
  const record: WorkflowInboundTurnRecord = {
    ...params.context.turn,
    status: params.status,
    completedAt: nowIso(),
    elapsedMs: completedAtMs - params.context.startedAtMs,
    deferredRunId: readString(params.deferredRunId),
    deferredQueueKey: readString(params.deferredQueueKey),
    summaryPath: readString(params.summaryPath),
    error: readString(params.error),
  };
  await appendWorkflowInboundTurnRecord(record);
  return record;
}

export async function readWorkflowInboundTurnRecords(
  projectRoot: string
): Promise<WorkflowInboundTurnRecord[]> {
  const targetPath = getWorkflowInboundTurnsPath(projectRoot);
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as WorkflowInboundTurnRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is WorkflowInboundTurnRecord => Boolean(entry));
  } catch {
    return [];
  }
}

export async function withWorkflowInboundBudget<T>(params: {
  projectRoot: string;
  projectId?: string | null;
  channelKey?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  action: string;
  inboundBudgetMs?: number | null;
  task: (context: WorkflowInboundBudgetContext) => Promise<T>;
}): Promise<T> {
  const context = createWorkflowInboundBudgetContext(params);
  await recordWorkflowInboundTurnStarted(context);
  try {
    const result = await params.task(context);
    await recordWorkflowInboundTurnCompleted({
      context,
      status: context.isExhausted() ? "deferred" : "completed_inline",
    });
    return result;
  } catch (error) {
    await recordWorkflowInboundTurnCompleted({
      context,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
