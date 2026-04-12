import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  WorkflowHandoffEvent,
  WorkflowHandoffStatus,
} from "./handoff-types";

const HANDOFF_EVENTS_FILENAME = "workflow-handoff-events.jsonl";

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getWorkflowHandoffEventsPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    HANDOFF_EVENTS_FILENAME
  );
}

export async function appendWorkflowHandoffEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  intentId?: string | null;
  idempotencyKey?: string | null;
  kind: string;
  fromStatus?: WorkflowHandoffStatus | null;
  toStatus?: WorkflowHandoffStatus | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<WorkflowHandoffEvent> {
  const projectRoot = path.resolve(params.projectRoot);
  const event: WorkflowHandoffEvent = {
    schemaVersion: 1,
    eventId: randomUUID(),
    intentId: readString(params.intentId),
    idempotencyKey: readString(params.idempotencyKey),
    projectId: readString(params.projectId),
    projectRoot,
    kind: params.kind,
    fromStatus: params.fromStatus ?? null,
    toStatus: params.toStatus ?? null,
    summary: readString(params.summary),
    details: params.details ?? null,
    recordedAt: nowIso(),
  };
  const eventsPath = getWorkflowHandoffEventsPath(projectRoot);
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export async function readWorkflowHandoffEvents(
  projectRoot: string
): Promise<WorkflowHandoffEvent[]> {
  const eventsPath = getWorkflowHandoffEventsPath(projectRoot);
  try {
    const raw = await fs.readFile(eventsPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as WorkflowHandoffEvent;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is WorkflowHandoffEvent => Boolean(entry));
  } catch {
    return [];
  }
}
