import * as fs from "node:fs/promises";
import * as path from "node:path";

import { appendWorkflowRuntimeEvent } from "./workflow-runtime-state.js";
import {
  appendRotatingJsonlLine,
  readRotatingJsonlTail,
} from "./workflow-jsonl-log.js";

export type WorkflowDiagnosticStatus =
  | "started"
  | "completed"
  | "waiting"
  | "blocked"
  | "degraded"
  | "failed";

export type WorkflowDiagnosticComponent =
  | "service"
  | "auto_iterator"
  | "stage_preflight"
  | "experiment_decision"
  | "dispatch"
  | "runtime_maintenance"
  | "runtime_recovery"
  | "handoff"
  | "hook";

export type WorkflowDiagnosticEvent = {
  recordedAt: string;
  projectId: string | null;
  projectRoot: string;
  component: WorkflowDiagnosticComponent;
  action: string;
  status: WorkflowDiagnosticStatus;
  stage: string | null;
  owner: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
};

const WORKFLOW_DIAGNOSTICS_FILENAME = "workflow-diagnostics.jsonl";
const DEFAULT_WORKFLOW_DIAGNOSTICS_MAX_BYTES = 512 * 1024;
const DEFAULT_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES = 5;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getWorkflowDiagnosticsRotationConfig() {
  return {
    maxBytes: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES",
      DEFAULT_WORKFLOW_DIAGNOSTICS_MAX_BYTES
    ),
    maxArchives: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES",
      DEFAULT_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES
    ),
  };
}

export function getWorkflowDiagnosticsLogPath(params: {
  projectRoot: string;
}): string {
  return path.join(
    path.resolve(params.projectRoot),
    ".openclaw-research",
    WORKFLOW_DIAGNOSTICS_FILENAME
  );
}

export function getWorkflowDiagnosticsArchiveLogPath(params: {
  projectRoot: string;
  index: number;
}): string {
  return getWorkflowDiagnosticsLogPath({
    projectRoot: params.projectRoot,
  }).replace(/\.jsonl$/, `.${Math.max(1, Math.floor(params.index))}.jsonl`);
}

export async function readWorkflowDiagnosticEventTail(params: {
  projectRoot: string;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  const projectRoot = path.resolve(params.projectRoot);
  const { maxArchives } = getWorkflowDiagnosticsRotationConfig();
  return readRotatingJsonlTail({
    activeLogPath: getWorkflowDiagnosticsLogPath({ projectRoot }),
    maxArchives,
    tailLines: params.tailLines,
  });
}

export async function appendWorkflowDiagnosticEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  component: WorkflowDiagnosticComponent;
  action: string;
  status: WorkflowDiagnosticStatus;
  stage?: string | null;
  owner?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<WorkflowDiagnosticEvent> {
  const projectRoot = path.resolve(params.projectRoot);
  const logPath = getWorkflowDiagnosticsLogPath({ projectRoot });
  const event: WorkflowDiagnosticEvent = {
    recordedAt: new Date().toISOString(),
    projectId: params.projectId ?? null,
    projectRoot,
    component: params.component,
    action: params.action,
    status: params.status,
    stage: params.stage ?? null,
    owner: params.owner ?? null,
    summary: params.summary ?? null,
    details: params.details ?? null,
  };
  const serializedEvent = `${JSON.stringify(event)}\n`;
  const { maxBytes, maxArchives } = getWorkflowDiagnosticsRotationConfig();
  const rotation = await appendRotatingJsonlLine({
    activeLogPath: logPath,
    serializedLine: serializedEvent,
    maxBytes,
    maxArchives,
  });
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId: params.projectId ?? null,
    kind: "workflow_diagnostic_event",
    summary:
      params.summary ??
      `${params.component}:${params.action}:${params.status}`,
    details: {
      component: params.component,
      action: params.action,
      status: params.status,
      stage: params.stage ?? null,
      owner: params.owner ?? null,
      diagnosticLogPath: logPath,
      diagnosticsLogRotated: rotation.rotated,
      diagnosticsArchivePath: rotation.archivedPath,
      ...(params.details ?? {}),
    },
  });
  return event;
}

export async function readWorkflowDiagnosticEvents(
  projectRoot: string
): Promise<WorkflowDiagnosticEvent[]> {
  try {
    const raw = await fs.readFile(
      getWorkflowDiagnosticsLogPath({ projectRoot }),
      "utf8"
    );
    return raw
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as WorkflowDiagnosticEvent);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
