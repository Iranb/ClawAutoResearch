import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  WORKFLOW_BROADCAST_MAX_INLINE_CHARS,
  WORKFLOW_BROADCAST_MAX_INLINE_FRAGMENT_CHARS,
} from "./handoff-defaults";

export type WorkflowBroadcastPayloadBudget = {
  schemaVersion: 1;
  broadcastId: string;
  idempotencyKey: string;
  projectId: string | null;
  projectRoot: string;
  channelKey: string | null;
  sessionKey: string | null;
  payloadPath: string | null;
  summary: string;
  fullMessageCharCount: number;
  postedMessageCharCount: number;
  truncated: boolean;
  maxInlineChars: number;
  deliveryMode: "inline" | "payload_pointer" | "outbox_only";
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function getWorkflowBroadcastPayloadDir(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    "workflow-broadcast-payloads"
  );
}

export function compactWorkflowBroadcastFragment(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  if (text.length <= WORKFLOW_BROADCAST_MAX_INLINE_FRAGMENT_CHARS) {
    return text;
  }
  return `${text.slice(0, WORKFLOW_BROADCAST_MAX_INLINE_FRAGMENT_CHARS - 24).trimEnd()} ... [truncated]`;
}

export async function applyWorkflowBroadcastBudget(params: {
  projectRoot: string | null;
  projectId?: string | null;
  channelKey?: string | null;
  sessionKey?: string | null;
  broadcastId: string;
  idempotencyKey: string;
  message: string;
  summary: string;
  maxInlineChars?: number | null;
  outboxOnly?: boolean;
}): Promise<{
  message: string;
  budget: WorkflowBroadcastPayloadBudget;
}> {
  const maxInlineChars =
    typeof params.maxInlineChars === "number" && Number.isFinite(params.maxInlineChars)
      ? Math.max(200, Math.floor(params.maxInlineChars))
      : WORKFLOW_BROADCAST_MAX_INLINE_CHARS;
  const projectRoot = params.projectRoot ? path.resolve(params.projectRoot) : null;
  const fullMessageCharCount = params.message.length;
  const shouldMaterialize =
    params.outboxOnly === true || fullMessageCharCount > maxInlineChars;
  let payloadPath: string | null = null;
  let postedMessage = params.message;

  if (shouldMaterialize && projectRoot) {
    const payloadDir = getWorkflowBroadcastPayloadDir(projectRoot);
    await fs.mkdir(payloadDir, { recursive: true });
    const hash = shortHash(
      [
        params.broadcastId,
        params.idempotencyKey,
        params.projectId ?? "unknown-project",
        params.summary,
      ].join("\n")
    );
    payloadPath = path.join(
      payloadDir,
      `broadcast-${hash}.md`
    );
    await fs.writeFile(payloadPath, params.message, "utf8");
    postedMessage = [
      "WORKFLOW_STAGE_BROADCAST=1",
      "BEGIN_UPDATE",
      "[Workflow Stage Update]",
      `Project: ${params.projectId ?? "unknown"}`,
      `[ARTIFACTS] ${compactWorkflowBroadcastFragment(params.summary) ?? "Workflow update available."}`,
      `[NEXT] Full update payload: ${payloadPath}`,
      "END_UPDATE",
      "Post the exact update between BEGIN_UPDATE and END_UPDATE to the current channel.",
      "Do not call tools, do not continue the workflow, and stop immediately after the update.",
    ].join("\n");
  } else if (shouldMaterialize) {
    postedMessage = `${params.message.slice(0, maxInlineChars - 32).trimEnd()}\n[truncated]\n`;
  }

  const budget: WorkflowBroadcastPayloadBudget = {
    schemaVersion: 1,
    broadcastId: params.broadcastId,
    idempotencyKey: params.idempotencyKey,
    projectId: readString(params.projectId),
    projectRoot: projectRoot ?? "",
    channelKey: readString(params.channelKey),
    sessionKey: readString(params.sessionKey),
    payloadPath,
    summary: params.summary,
    fullMessageCharCount,
    postedMessageCharCount: postedMessage.length,
    truncated: postedMessage !== params.message,
    maxInlineChars,
    deliveryMode:
      params.outboxOnly === true
        ? "outbox_only"
        : postedMessage === params.message
          ? "inline"
          : "payload_pointer",
    createdAt: nowIso(),
  };
  return { message: postedMessage, budget };
}
