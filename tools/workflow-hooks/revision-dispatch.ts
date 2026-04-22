import * as fs from "node:fs/promises";
import path from "node:path";
import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
} from "../agent-task-dispatch";
import { writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type { WorkflowExecutionRuntimeLike } from "../workflow-execution-runtime.js";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowHookExecutionResult,
  WorkflowHookPoint,
  WorkflowHookRevisionDispatchState,
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

type RuntimeSubagentApi = WorkflowExecutionRuntimeLike & {
  run: NonNullable<WorkflowExecutionRuntimeLike["run"]>;
};
type OptionalRuntimeSubagentApi = WorkflowExecutionRuntimeLike;

function toDispatchRole(value: string | null | undefined): DispatchableWorkflowRole | null {
  if (
    value === "researcher" ||
    value === "planner" ||
    value === "orchestrator" ||
    value === "coder" ||
    value === "analyzer" ||
    value === "academic_writer" ||
    value === "reviewer" ||
    value === "cross-reviewer"
  ) {
    return value;
  }
  return null;
}

export function getAggregateRevisionPacketPath(params: {
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  targetRole?: string | null;
}): string {
  const stagePart = params.stage ?? "global";
  const targetPart = params.targetRole ? `-${params.targetRole}` : "";
  return path.join(
    "reviewer",
    "file-audits",
    "_aggregate",
    `${stagePart}-${params.hookPoint}${targetPart}`,
    "AGGREGATE_REVISION_PACKET.md"
  );
}

async function writeAggregateRevisionPacket(params: {
  projectRoot: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  targetRole?: string | null;
  executions: Array<{
    policy: WorkflowFileAuditHookPolicy;
    execution: WorkflowHookExecutionResult;
  }>;
}): Promise<string> {
  const markdownPath = getAggregateRevisionPacketPath({
    hookPoint: params.hookPoint,
    stage: params.stage,
    targetRole: params.targetRole,
  });
  const jsonPath = markdownPath.replace(/\.md$/i, ".json");
  const resolvedMarkdown = resolveProjectArtifactPath(params.projectRoot, markdownPath);
  const resolvedJson = resolveProjectArtifactPath(params.projectRoot, jsonPath);
  if (!resolvedMarkdown || !resolvedJson) {
    return markdownPath;
  }
  const payload = {
    hookPoint: params.hookPoint,
    stage: params.stage,
    targetRole: params.targetRole ?? null,
    generatedAt: nowIso(),
    items: params.executions.map(({ policy, execution }) => ({
      hookId: policy.hookId,
      targetRole: policy.targetRole,
      auditorRole: policy.auditorRole,
      filePath: policy.filePath,
      verdict: execution.result?.verdict ?? execution.verdict,
      summary: execution.result?.summary ?? execution.blockingReason,
      requiredFixes: execution.result?.requiredFixes ?? [],
      reviewedArtifacts: execution.result?.reviewedArtifacts ?? [],
      reportDir: policy.reportDir,
      reportPath: null,
    })),
  };
  const markdown = [
    "# Aggregate Hook Revision Packet",
    "",
    `- hook_point: ${params.hookPoint}`,
    `- stage: ${params.stage ?? "unknown"}`,
    `- generated_at: ${payload.generatedAt}`,
    "",
    ...payload.items.flatMap((item) => [
      `## ${item.hookId}`,
      `- target_role: ${item.targetRole ?? "unknown"}`,
      `- auditor_role: ${item.auditorRole}`,
      `- file_path: ${item.filePath}`,
      `- verdict: ${item.verdict ?? "unknown"}`,
      "",
      "### Summary",
      item.summary ?? "No summary provided.",
      "",
      "### Required Fixes",
      ...(item.requiredFixes.length > 0
        ? item.requiredFixes.map((entry) => `- ${entry}`)
        : ["- none"]),
      "",
    ]),
  ].join("\n");
  await fs.mkdir(path.dirname(resolvedMarkdown), { recursive: true });
  await fs.writeFile(resolvedMarkdown, `${markdown}\n`, "utf8");
  await writeJsonEnsured(resolvedJson, payload);
  return markdownPath;
}

export async function dispatchAggregateHookRevision(params: {
  runtimeSubagent?: OptionalRuntimeSubagentApi;
  requesterSessionKey?: string | null;
  requesterChannel?: string | null;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  executions: Array<{
    policy: WorkflowFileAuditHookPolicy;
    execution: WorkflowHookExecutionResult;
  }>;
}): Promise<WorkflowHookRevisionDispatchState[]> {
  const byTarget = new Map<
    DispatchableWorkflowRole,
    Array<{ policy: WorkflowFileAuditHookPolicy; execution: WorkflowHookExecutionResult }>
  >();
  for (const item of params.executions) {
    const dispatchRole = toDispatchRole(item.policy.reviseOwnerRole ?? item.policy.targetRole);
    if (!dispatchRole) {
      continue;
    }
    const bucket = byTarget.get(dispatchRole) ?? [];
    bucket.push(item);
    byTarget.set(dispatchRole, bucket);
  }
  const results: WorkflowHookRevisionDispatchState[] = [];
  for (const [targetRole, items] of byTarget.entries()) {
    const packetPath = await writeAggregateRevisionPacket({
      projectRoot: params.projectRoot,
      hookPoint: params.hookPoint,
      stage: params.stage,
      targetRole,
      executions: items,
    });
    const dispatch = await dispatchWorkflowTaskToAgent({
      runtimeSubagent:
        params.runtimeSubagent && typeof params.runtimeSubagent.run === "function"
          ? (params.runtimeSubagent as RuntimeSubagentApi)
          : undefined,
      requesterSessionKey: params.requesterSessionKey ?? undefined,
      requesterChannel: params.requesterChannel ?? undefined,
      fromRole: "reviewer",
      toRole: targetRole,
      projectRoot: params.projectRoot,
      projectId: params.projectId ?? undefined,
      stage: params.stage,
      summary: `Workflow hooks requested revision before ${params.hookPoint}.`,
      command:
        items.find((entry) => entry.policy.reviseCommand)?.policy.reviseCommand ??
        "Revise the target file(s), update durable artifacts, then rerun research_workflow.auto_iterator_tick.",
      requireMailboxAcknowledgement: true,
      extraBody: [
        `Aggregate revision packet: ${packetPath}`,
        "The following hooks requested revision:",
        ...items.map(
          ({ policy, execution }) =>
            `- ${policy.hookId} on ${policy.filePath}: ${
              execution.result?.summary ?? execution.blockingReason ?? execution.verdict ?? "revise"
            }`
        ),
      ].join("\n"),
    });
    results.push({
      runId: dispatch.runId,
      sessionKey: dispatch.sessionKey,
      dispatchedAt: nowIso(),
      targetRole,
      aggregateRevisionPacketPath: packetPath,
    });
  }
  return results;
}
