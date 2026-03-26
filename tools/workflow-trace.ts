import * as fs from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";

export type WorkflowTraceEventKind = "tool_action" | "auto_iterator";

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

function sanitizeTraceSegment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workflow";
}

export function getWorkflowTraceLogPath(params: {
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
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
  return { logPath, event };
}
