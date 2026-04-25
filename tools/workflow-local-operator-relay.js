import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { appendRotatingJsonlLine } from "./workflow-jsonl-log.js";
import { getWorkflowRuntimeDir } from "./workflow-runtime-state.js";

const RELAY_FILENAME = "workflow-local-operator-relay.jsonl";
const RELAY_MAX_BYTES = 1024 * 1024;
const RELAY_MAX_ARCHIVES = 3;

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getWorkflowLocalOperatorRelayPath(projectRoot) {
  return path.join(getWorkflowRuntimeDir(projectRoot), RELAY_FILENAME);
}

export async function readWorkflowLocalOperatorRelayEntries(projectRoot) {
  try {
    const raw = await fs.readFile(getWorkflowLocalOperatorRelayPath(projectRoot), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function appendWorkflowLocalOperatorRelay(params) {
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

  const entry = {
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
