import * as fs from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { appendWorkflowRuntimeEvent } from "./workflow-runtime-state.js";
import {
  appendRotatingJsonlLine,
  readRotatingJsonlTail,
} from "./workflow-jsonl-log.js";

export type WorkflowTraceEventKind =
  | "tool_action"
  | "auto_iterator"
  | "prompt_assembly"
  | "write_package_assembly";

export type WorkflowTraceEvent = {
  recordedAt: string;
  projectId: string | null;
  projectRoot: string;
  kind: WorkflowTraceEventKind;
  action: string;
  functionName: string;
  stage: string | null;
  owner: string | null;
  agentId: string | null;
  sessionKey: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
};

const TRACE_DIR_NAME = "openclaw-research-workflow-trace";
const PROJECT_LOCAL_TRACE_FILENAME = "workflow-trace.jsonl";
const DEFAULT_WORKFLOW_TRACE_MAX_BYTES = 1024 * 1024;
const DEFAULT_WORKFLOW_TRACE_MAX_ARCHIVES = 5;

function sanitizeTraceSegment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workflow";
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getWorkflowTraceRotationConfig() {
  return {
    maxBytes: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_TRACE_MAX_BYTES",
      DEFAULT_WORKFLOW_TRACE_MAX_BYTES
    ),
    maxArchives: readPositiveIntegerEnv(
      "OPENCLAW_WORKFLOW_TRACE_MAX_ARCHIVES",
      DEFAULT_WORKFLOW_TRACE_MAX_ARCHIVES
    ),
  };
}

export function getWorkflowTraceLogPath(params: {
  projectRoot: string;
  projectId?: string | null;
}): string {
  return path.join(
    path.resolve(params.projectRoot),
    ".openclaw-research",
    PROJECT_LOCAL_TRACE_FILENAME
  );
}

export function getWorkflowTempTraceLogPath(params: {
  projectRoot: string;
  projectId?: string | null;
}): string {
  const projectRootSegment = sanitizeTraceSegment(path.basename(params.projectRoot));
  const projectIdSegment = sanitizeTraceSegment(
    params.projectId ?? path.basename(params.projectRoot)
  );
  return path.join(
    os.tmpdir(),
    TRACE_DIR_NAME,
    `${projectIdSegment}__${projectRootSegment}.jsonl`
  );
}

export async function appendWorkflowTraceEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  kind: WorkflowTraceEventKind;
  action: string;
  functionName: string;
  stage?: string | null;
  owner?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<{ logPath: string; event: WorkflowTraceEvent }> {
  const projectRoot = path.resolve(params.projectRoot);
  const logPath = getWorkflowTraceLogPath({
    projectRoot,
    projectId: params.projectId ?? null,
  });
  const tempMirrorPath = getWorkflowTempTraceLogPath({
    projectRoot,
    projectId: params.projectId ?? null,
  });
  const event: WorkflowTraceEvent = {
    recordedAt: new Date().toISOString(),
    projectId: params.projectId ?? null,
    projectRoot,
    kind: params.kind,
    action: params.action,
    functionName: params.functionName,
    stage: params.stage ?? null,
    owner: params.owner ?? null,
    agentId: params.agentId ?? null,
    sessionKey: params.sessionKey ?? null,
    summary: params.summary ?? null,
    details: params.details ?? null,
  };
  const { maxBytes, maxArchives } = getWorkflowTraceRotationConfig();
  await appendRotatingJsonlLine({
    activeLogPath: logPath,
    serializedLine: `${JSON.stringify(event)}\n`,
    maxBytes,
    maxArchives,
  });
  await fs.mkdir(path.dirname(tempMirrorPath), { recursive: true });
  await fs.appendFile(tempMirrorPath, `${JSON.stringify(event)}\n`, "utf8");
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId: params.projectId ?? null,
    kind: `trace_${params.kind}`,
    summary: params.summary ?? `${params.functionName}:${params.action}`,
    details: {
      action: params.action,
      functionName: params.functionName,
      stage: params.stage ?? null,
      owner: params.owner ?? null,
      agentId: params.agentId ?? null,
      sessionKey: params.sessionKey ?? null,
      traceMirrorPath: logPath,
      tempTraceMirrorPath: tempMirrorPath,
      ...(params.details ?? {}),
    },
  });
  return { logPath, event };
}

export async function readWorkflowTraceTail(params: {
  projectRoot: string;
  projectId?: string | null;
  tailLines: number;
}): Promise<{ exists: boolean; lineCount: number; tail: string[] }> {
  const { maxArchives } = getWorkflowTraceRotationConfig();
  return readRotatingJsonlTail({
    activeLogPath: getWorkflowTraceLogPath({
      projectRoot: params.projectRoot,
      projectId: params.projectId ?? null,
    }),
    maxArchives,
    tailLines: params.tailLines,
  });
}
