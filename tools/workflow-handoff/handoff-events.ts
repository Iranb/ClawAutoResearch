import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  WorkflowHandoffEvent,
  WorkflowHandoffStatus,
} from "./handoff-types";
import {
  appendRotatingJsonlLine,
  readRotatingJsonlTail,
} from "../workflow-jsonl-log.js";

const HANDOFF_EVENTS_FILENAME = "workflow-handoff-events.jsonl";
const DEFAULT_WORKFLOW_HANDOFF_EVENTS_MAX_BYTES = 1024 * 1024;
const DEFAULT_WORKFLOW_HANDOFF_EVENTS_MAX_ARCHIVES = 5;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getWorkflowHandoffEventsRotationConfig() {
  return {
    maxBytes: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_HANDOFF_EVENTS_MAX_BYTES",
      DEFAULT_WORKFLOW_HANDOFF_EVENTS_MAX_BYTES
    ),
    maxArchives: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_HANDOFF_EVENTS_MAX_ARCHIVES",
      DEFAULT_WORKFLOW_HANDOFF_EVENTS_MAX_ARCHIVES
    ),
  };
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
  const { maxBytes, maxArchives } = getWorkflowHandoffEventsRotationConfig();
  await appendRotatingJsonlLine({
    activeLogPath: eventsPath,
    serializedLine: `${JSON.stringify(event)}\n`,
    maxBytes,
    maxArchives,
  });
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

export async function readWorkflowHandoffEventsTail(params: {
  projectRoot: string;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  const { maxArchives } = getWorkflowHandoffEventsRotationConfig();
  return readRotatingJsonlTail({
    activeLogPath: getWorkflowHandoffEventsPath(params.projectRoot),
    maxArchives,
    tailLines: params.tailLines,
  });
}
