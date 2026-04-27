import {
  isProviderCapacityFailure,
  providerCapacityFailureMessage,
} from "./provider-capacity.js";

type WorkflowRuntimeSessionMessageReader = {
  getSessionMessages?: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
};

const DEFAULT_PROVIDER_CAPACITY_MESSAGE_LIMIT = 80;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasVisibleContent(value: unknown): boolean {
  const text = readString(value);
  if (text) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasVisibleContent(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return Boolean(
    readString(record.text) ||
      readString(record.thinking) ||
      readString(record.name) ||
      readString(record.toolName) ||
      readString(record.toolCallId)
  );
}

function isProgressAfterProviderErrorBoundary(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  const role = readString(record.role)?.toLowerCase() ?? null;
  const stopReason = readString(record.stopReason)?.toLowerCase() ?? null;
  if (stopReason && stopReason !== "error") {
    return true;
  }
  if (role === "tool" || role === "toolresult" || role === "tool_result") {
    return true;
  }
  if (role === "assistant" && stopReason !== "error") {
    return hasVisibleContent(record.content);
  }
  return false;
}

function providerCapacityMessage(value: unknown): string | null {
  if (isProviderCapacityFailure(value)) {
    return providerCapacityFailureMessage(value);
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of ["message", "data", "details"]) {
    const nested = record[key];
    if (nested && isProviderCapacityFailure(nested)) {
      return providerCapacityFailureMessage(nested);
    }
  }
  return null;
}

export function detectRecentProviderCapacityFromSessionMessages(
  messages: unknown[],
  limit = DEFAULT_PROVIDER_CAPACITY_MESSAGE_LIMIT
): string | null {
  const maxMessages =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : DEFAULT_PROVIDER_CAPACITY_MESSAGE_LIMIT;
  let scanned = 0;
  for (let index = messages.length - 1; index >= 0 && scanned < maxMessages; index -= 1) {
    scanned += 1;
    const message = messages[index];
    const capacityMessage = providerCapacityMessage(message);
    if (capacityMessage) {
      return capacityMessage;
    }
    if (isProgressAfterProviderErrorBoundary(message)) {
      return null;
    }
  }
  return null;
}

export async function inspectRecentSessionProviderCapacity(params: {
  workflowRuntime?: WorkflowRuntimeSessionMessageReader | null;
  sessionKey: string;
  limit?: number;
}): Promise<string | null> {
  if (!params.workflowRuntime?.getSessionMessages) {
    return null;
  }
  try {
    const result = await params.workflowRuntime.getSessionMessages({
      sessionKey: params.sessionKey,
      limit: params.limit ?? DEFAULT_PROVIDER_CAPACITY_MESSAGE_LIMIT,
    });
    return detectRecentProviderCapacityFromSessionMessages(result.messages ?? []);
  } catch {
    return null;
  }
}
