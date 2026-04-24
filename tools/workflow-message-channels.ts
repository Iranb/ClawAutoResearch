function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeWorkflowMessageChannel(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

export function isWorkflowNotificationOnlyMessageChannel(value: unknown): boolean {
  return normalizeWorkflowMessageChannel(value) === "discord";
}

export function isWorkflowNotificationOnlySessionKey(value: unknown): boolean {
  const normalized = readString(value)?.toLowerCase() ?? null;
  return Boolean(normalized && /^agent:[^:]+:discord(?::|$)/.test(normalized));
}

export function isWorkflowNotificationOnlyChannelKey(value: unknown): boolean {
  const normalized = readString(value)?.toLowerCase() ?? null;
  return Boolean(
    normalized &&
      (normalized.startsWith("discord:") ||
        normalized.startsWith("binding:discord:"))
  );
}

export function shouldUseChannelProjectBindingForWorkflow(params: {
  messageChannel?: unknown;
  channelKey?: unknown;
  sessionKey?: unknown;
}): boolean {
  return !(
    isWorkflowNotificationOnlyMessageChannel(params.messageChannel) ||
    isWorkflowNotificationOnlyChannelKey(params.channelKey) ||
    isWorkflowNotificationOnlySessionKey(params.sessionKey)
  );
}
