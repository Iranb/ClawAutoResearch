const AGENT_MENTION_REGEX =
  /(^|[\s([{"'`|])@(researcher|orchestrator|coder|analyzer|academic[_-]?writer|writer|reviewer|cross[_-]?reviewer|openclaw)\b/gi;

function normalizeMentionLabel(roleName: string): string {
  const raw = String(roleName || "").trim().toLowerCase().replace(/_/g, "-");
  return raw === "academic-writer" || raw === "writer"
    ? "writer"
    : raw === "cross-reviewer"
      ? "cross-reviewer"
      : raw;
}

export function sanitizeAgentMentions(text: string): string {
  return text.replace(AGENT_MENTION_REGEX, (_match, prefix: string, roleName: string) => {
    return `${prefix}[${normalizeMentionLabel(roleName)}]`;
  });
}

export function hasAgentMention(text: string): boolean {
  AGENT_MENTION_REGEX.lastIndex = 0;
  return AGENT_MENTION_REGEX.test(text);
}

export function isWorkflowChannelHandoffMessage(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  return (
    /\[STATUS\]/i.test(text) &&
    /\[HANDOFF\]/i.test(text) &&
    /\[ARTIFACTS\]/i.test(text) &&
    /\[NEXT\]/i.test(text)
  );
}

export function normalizeWorkflowChannelMentions(text: string): string {
  if (!hasAgentMention(text)) {
    return text;
  }
  if (!isWorkflowChannelHandoffMessage(text)) {
    return sanitizeAgentMentions(text);
  }
  let preservedRawMention = false;
  return text.replace(
    AGENT_MENTION_REGEX,
    (match, prefix: string, roleName: string) => {
      if (!preservedRawMention) {
        preservedRawMention = true;
        return match;
      }
      return `${prefix}[${normalizeMentionLabel(roleName)}]`;
    }
  );
}

export function sanitizeMessageToolParams(
  params: Record<string, unknown>
): Record<string, unknown> | null {
  const nextParams: Record<string, unknown> = { ...params };
  let changed = false;
  for (const key of ["text", "content", "message", "caption"]) {
    if (typeof params[key] !== "string") {
      continue;
    }
    const rawText = params[key] as string;
    if (!hasAgentMention(rawText)) {
      continue;
    }
    nextParams[key] = normalizeWorkflowChannelMentions(rawText);
    changed = true;
  }
  return changed ? nextParams : null;
}

