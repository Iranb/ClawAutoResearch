/**
 * Peer and target parsers for Discord and Telegram channels.
 */

import type { ConversationRef } from "openclaw/plugin-sdk/conversation-runtime";
import type { RoutePeer } from "./types.js";
import type { WorkflowCommandContext } from "./types.js";

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBindingToken(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const stringValue =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : readString(value);
  return stringValue ? stringValue.trim().toLowerCase() : null;
}

export function normalizeWorkflowBindingChannelKey(
  value: string | null | undefined
): string | null {
  const normalized = normalizeBindingToken(value);
  if (!normalized) {
    return null;
  }
  const subagentMarker = normalized.indexOf(":subagent:");
  return subagentMarker > 0 ? normalized.slice(0, subagentMarker) : normalized;
}

export function isWeakWorkflowBindingChannelKey(
  value: string | null | undefined
): boolean {
  const normalized = normalizeWorkflowBindingChannelKey(value);
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith("agent:")) {
    return true;
  }
  if (normalized === "main" || normalized === "dashboard") {
    return true;
  }
  if (normalized.endsWith(":main")) {
    return true;
  }
  return false;
}

export function isSpecificWorkflowBindingChannelKey(
  value: string | null | undefined
): boolean {
  const normalized = normalizeWorkflowBindingChannelKey(value);
  if (!normalized || isWeakWorkflowBindingChannelKey(normalized)) {
    return false;
  }
  if (
    normalized.startsWith("binding:") ||
    normalized.startsWith("channel:") ||
    normalized.startsWith("user:") ||
    normalized.includes(":thread:")
  ) {
    return true;
  }
  return normalized.split(":").filter(Boolean).length >= 2;
}

export function buildWorkflowConversationBindingKey(params: {
  channel?: string | null;
  accountId?: string | number | null;
  conversationId?: string | null;
  threadId?: string | number | null;
}): string | null {
  const channel = normalizeBindingToken(params.channel);
  const conversationId = normalizeWorkflowBindingChannelKey(params.conversationId);
  if (!channel || !conversationId) {
    return null;
  }
  const accountId = normalizeBindingToken(params.accountId ?? "default") ?? "default";
  const threadId = normalizeBindingToken(params.threadId);
  return threadId
    ? `binding:${channel}:${accountId}:${conversationId}:thread:${threadId}`
    : `binding:${channel}:${accountId}:${conversationId}`;
}

export function buildWorkflowConversationBindingKeyFromConversation(
  conversation: ConversationRef | null | undefined
): string | null {
  if (!conversation) {
    return null;
  }
  return buildWorkflowConversationBindingKey({
    channel: conversation.channel,
    accountId: conversation.accountId,
    conversationId: conversation.conversationId,
    threadId:
      typeof conversation.threadId === "number" || typeof conversation.threadId === "string"
        ? conversation.threadId
        : null,
  });
}

export function stripDiscordPrefix(raw: string): string {
  return raw.startsWith("discord:") ? raw.slice("discord:".length) : raw;
}

export function parseDiscordPeer(raw: string): RoutePeer | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("slash:")) {
    return null;
  }
  const normalized = stripDiscordPrefix(trimmed);
  const mentionMatch = /^<@!?(\d+)>$/.exec(normalized);
  if (mentionMatch?.[1]) {
    return { kind: "direct", id: mentionMatch[1] };
  }
  if (normalized.startsWith("user:")) {
    return { kind: "direct", id: normalized.slice("user:".length).trim() };
  }
  if (normalized.startsWith("channel:")) {
    return { kind: "channel", id: normalized.slice("channel:".length).trim() };
  }
  if (raw.startsWith("discord:") && !normalized.includes(":")) {
    return { kind: "direct", id: normalized };
  }
  if (/^\d+$/.test(normalized)) {
    return { kind: "channel", id: normalized };
  }
  return { kind: "channel", id: normalized };
}

function resolveDiscordConversationCandidate(
  ctx: Pick<WorkflowCommandContext, "from" | "to" | "originatingTo">
): string | null {
  const candidates = [
    readString(ctx.originatingTo),
    readString(ctx.from),
    readString(ctx.to),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const parsed = parseDiscordPeer(candidate);
    if (parsed) {
      return `${parsed.kind === "direct" ? "user" : "channel"}:${parsed.id}`;
    }
  }
  return null;
}

export function stripTelegramInternalPrefixes(raw: string): string {
  let trimmed = raw.trim();
  let strippedTelegramPrefix = false;
  while (true) {
    const next = (() => {
      if (/^(telegram|tg):/i.test(trimmed)) {
        strippedTelegramPrefix = true;
        return trimmed.replace(/^(telegram|tg):/i, "").trim();
      }
      if (strippedTelegramPrefix && /^group:/i.test(trimmed)) {
        return trimmed.replace(/^group:/i, "").trim();
      }
      return trimmed;
    })();
    if (next === trimmed) {
      return trimmed;
    }
    trimmed = next;
  }
}

export function parseTelegramTarget(raw: string): {
  chatId: string;
  threadId?: string | number;
  kind: RoutePeer["kind"];
} | null {
  const normalized = stripTelegramInternalPrefixes(raw);
  if (!normalized) {
    return null;
  }
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(normalized);
  if (topicMatch?.[1] && topicMatch[2]) {
    return {
      chatId: topicMatch[1],
      threadId: Number.parseInt(topicMatch[2], 10),
      kind: topicMatch[1].startsWith("-") ? "group" : "direct",
    };
  }
  const colonMatch = /^(.+):(\d+)$/.exec(normalized);
  if (colonMatch?.[1] && colonMatch[2]) {
    return {
      chatId: colonMatch[1],
      threadId: Number.parseInt(colonMatch[2], 10),
      kind: colonMatch[1].startsWith("-") ? "group" : "direct",
    };
  }
  return {
    chatId: normalized,
    kind: normalized.startsWith("-") ? "group" : "direct",
  };
}

export function resolveBindingConversationFromCommandContext(
  ctx: Pick<
    WorkflowCommandContext,
    "channel" | "from" | "to" | "accountId" | "messageThreadId" | "originatingTo"
  >
): ConversationRef | null {
  const accountId = readString(ctx.accountId) ?? "default";

  if (ctx.channel === "telegram") {
    const rawTarget = readString(ctx.to) ?? readString(ctx.from);
    if (!rawTarget) {
      return null;
    }
    const parsed = parseTelegramTarget(rawTarget);
    if (!parsed) {
      return null;
    }
    return {
      channel: "telegram",
      accountId,
      conversationId: parsed.chatId,
      ...(ctx.messageThreadId != null
        ? { threadId: ctx.messageThreadId }
        : parsed.threadId != null
          ? { threadId: parsed.threadId }
          : {}),
    };
  }

  if (ctx.channel === "discord") {
    const conversationId = resolveDiscordConversationCandidate(ctx);
    if (conversationId) {
      return {
        channel: "discord",
        accountId,
        conversationId,
        ...(ctx.messageThreadId != null ? { threadId: ctx.messageThreadId } : {}),
      };
    }
  }

  return null;
}

export function resolveBindingChannelKeyFromContext(
  ctx: Partial<
    Pick<
      WorkflowCommandContext,
      "channel" | "from" | "to" | "accountId" | "messageThreadId" | "originatingTo"
    >
  > & {
    messageChannel?: string | null;
    channelKey?: string | null;
    conversationId?: string | null;
    threadId?: string | number | null;
  }
): string | null {
  const explicit = normalizeWorkflowBindingChannelKey(readString(ctx.channelKey));
  if (explicit && isSpecificWorkflowBindingChannelKey(explicit)) {
    return explicit;
  }

  const channel = readString(ctx.messageChannel) ?? readString(ctx.channel);
  const explicitConversationId = readString(ctx.conversationId);
  const explicitThreadId =
    ctx.threadId ??
    (typeof ctx.messageThreadId === "number" || typeof ctx.messageThreadId === "string"
      ? ctx.messageThreadId
      : null);
  if (channel && explicitConversationId) {
    return buildWorkflowConversationBindingKey({
      channel,
      accountId: readString(ctx.accountId) ?? "default",
      conversationId: explicitConversationId,
      threadId: explicitThreadId,
    });
  }

  const conversation = resolveBindingConversationFromCommandContext({
    channel: readString(ctx.channel) ?? readString(ctx.messageChannel) ?? "",
    from: readString(ctx.from),
    to: readString(ctx.to),
    originatingTo: readString(ctx.originatingTo),
    accountId: readString(ctx.accountId),
    messageThreadId:
      typeof ctx.messageThreadId === "number" || typeof ctx.messageThreadId === "string"
        ? ctx.messageThreadId
        : typeof explicitThreadId === "number" || typeof explicitThreadId === "string"
          ? explicitThreadId
          : undefined,
  });
  return buildWorkflowConversationBindingKeyFromConversation(conversation);
}

export function resolveRoutePeerFromCommandContext(
  ctx: Pick<WorkflowCommandContext, "channel" | "from" | "to" | "originatingTo">
): RoutePeer | null {
  if (ctx.channel === "telegram") {
    const rawTarget = readString(ctx.to) ?? readString(ctx.from);
    const parsed = rawTarget ? parseTelegramTarget(rawTarget) : null;
    if (!parsed) {
      return null;
    }
    return {
      kind: parsed.kind,
      id: parsed.chatId,
    };
  }

  if (ctx.channel === "discord") {
    const candidates = [readString(ctx.originatingTo), readString(ctx.from), readString(ctx.to)].filter(
      (value): value is string => Boolean(value)
    );
    for (const candidate of candidates) {
      const parsed = parseDiscordPeer(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

export function extractAgentIdFromSessionKey(
  sessionKey: string | null | undefined
): string | null {
  const trimmed = readString(sessionKey);
  if (!trimmed) {
    return null;
  }
  const match = /^agent:([^:]+):/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : null;
}

export function extractQuotedSegment(value: string | undefined): string | undefined {
  const trimmed = readString(value);
  if (!trimmed) {
    return undefined;
  }
  const doubleQuoted = /^"([^"]+)"/.exec(trimmed);
  if (doubleQuoted?.[1]) {
    return doubleQuoted[1].trim();
  }
  const singleQuoted = /^'([^']+)'/.exec(trimmed);
  if (singleQuoted?.[1]) {
    return singleQuoted[1].trim();
  }
  return trimmed.split(/\s+--\s+/u, 1)[0]?.trim() || undefined;
}

export function formatWorkflowCommandArgument(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/u.test(value)
    ? value
    : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
