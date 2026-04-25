import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { appendRotatingJsonlLine } from "./workflow-jsonl-log.js";
import { getWorkflowRuntimeDir } from "./workflow-runtime-state.js";

export type WorkflowLocalOperatorRelayKind = "provider_capacity_cooldown";

export type WorkflowLocalOperatorRelayEntry = {
  relayId: string;
  idempotencyKey: string;
  recordedAt: string;
  projectId: string | null;
  projectRoot: string;
  queueKey: string | null;
  sessionKey: string | null;
  ownerAgent: string | null;
  stage: string | null;
  kind: WorkflowLocalOperatorRelayKind;
  status: "pending";
  summary: string;
  reason: string;
  cooldownUntil: string | null;
  operatorPrompt: string;
  details: Record<string, unknown> | null;
};

const RELAY_FILENAME = "workflow-local-operator-relay.jsonl";
const RELAY_MAX_BYTES = 1024 * 1024;
const RELAY_MAX_ARCHIVES = 3;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getWorkflowLocalOperatorRelayPath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), RELAY_FILENAME);
}

export async function readWorkflowLocalOperatorRelayEntries(
  projectRoot: string
): Promise<WorkflowLocalOperatorRelayEntry[]> {
  try {
    const raw = await fs.readFile(getWorkflowLocalOperatorRelayPath(projectRoot), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as WorkflowLocalOperatorRelayEntry];
        } catch {
          return [];
        }
      });
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

export async function appendWorkflowLocalOperatorRelay(params: {
  projectRoot: string;
  projectId?: string | null;
  idempotencyKey: string;
  queueKey?: string | null;
  sessionKey?: string | null;
  ownerAgent?: string | null;
  stage?: string | null;
  kind: WorkflowLocalOperatorRelayKind;
  summary: string;
  reason: string;
  cooldownUntil?: string | null;
  operatorPrompt: string;
  details?: Record<string, unknown> | null;
}): Promise<{ entry: WorkflowLocalOperatorRelayEntry; created: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  const idempotencyKey = readString(params.idempotencyKey);
  if (!idempotencyKey) {
    throw new Error("Workflow local operator relay requires an idempotency key.");
  }

  const existing = await readWorkflowLocalOperatorRelayEntries(projectRoot);
  const previous = existing.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (previous) {
    return { entry: previous, created: false };
  }

  const entry: WorkflowLocalOperatorRelayEntry = {
    relayId: randomUUID(),
    idempotencyKey,
    recordedAt: new Date().toISOString(),
    projectId: readString(params.projectId),
    projectRoot,
    queueKey: readString(params.queueKey),
    sessionKey: readString(params.sessionKey),
    ownerAgent: readString(params.ownerAgent),
    stage: readString(params.stage),
    kind: params.kind,
    status: "pending",
    summary: readString(params.summary) ?? "Workflow requires local operator intervention.",
    reason: readString(params.reason) ?? "Workflow runtime repair is blocked.",
    cooldownUntil: readString(params.cooldownUntil),
    operatorPrompt: readString(params.operatorPrompt) ?? "",
    details: params.details ?? null,
  };

  await appendRotatingJsonlLine({
    activeLogPath: getWorkflowLocalOperatorRelayPath(projectRoot),
    serializedLine: `${JSON.stringify(entry)}\n`,
    maxBytes: RELAY_MAX_BYTES,
    maxArchives: RELAY_MAX_ARCHIVES,
  });
  return { entry, created: true };
}
