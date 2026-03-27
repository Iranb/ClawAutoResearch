function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const PAPERNEXUS_SLASH_COMMAND_RE =
  /^\s*\/(?:graph-build|frontier-mapping|papernexus(?:-agentic-reasoning)?|papernexus-reflection)\b/i;

const PAPERNEXUS_CLI_COMMAND_RE =
  /\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:status|query|brainstorm|ideas|context|impact|analyze|watch|materialize|llm-optimize|build-graph|merge-graph|write-index|enhance|service|logs)\b/i;
const PAPERNEXUS_API_COMMAND_RE =
  /\b(?:curl|wget|fetch)\b[\s\S]*\/api\/(?:imports|status|query|context|impact|ideas|brainstorm|graph|enhance|logs)(?:\b|\/|\?)/i;

function slugSessionSegment(value: string | null | undefined): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || null;
}

export function normalizeWorkflowSubagentParentSessionKey(
  sessionKey: string | null | undefined
): string | null {
  const raw = readString(sessionKey);
  if (!raw) {
    return null;
  }
  const subagentMarker = raw.indexOf(":subagent:");
  if (subagentMarker > 0) {
    return raw.slice(0, subagentMarker);
  }
  return raw;
}

export function isWorkflowSubagentSessionKey(
  sessionKey: string | null | undefined
): boolean {
  const raw = readString(sessionKey);
  return Boolean(raw && raw.includes(":subagent:"));
}

export function looksLikePapernexusHeavyCommand(
  text: string | null | undefined
): boolean {
  const raw = readString(text);
  if (!raw) {
    return false;
  }
  return (
    PAPERNEXUS_SLASH_COMMAND_RE.test(raw) ||
    PAPERNEXUS_CLI_COMMAND_RE.test(raw) ||
    PAPERNEXUS_API_COMMAND_RE.test(raw)
  );
}

export function derivePapernexusTaskLabel(
  text: string | null | undefined
): string {
  const raw = readString(text)?.toLowerCase() ?? "";
  if (!raw) {
    return "task";
  }
  const slashMatch = raw.match(
    /^\s*\/(graph-build|frontier-mapping|papernexus(?:-agentic-reasoning)?|papernexus-reflection)\b/i
  );
  if (slashMatch?.[1]) {
    return slashMatch[1];
  }
  for (const label of [
    "imports",
    "query",
    "brainstorm",
    "ideas",
    "context",
    "impact",
    "analyze",
    "watch",
    "materialize",
    "llm-optimize",
    "build-graph",
    "merge-graph",
    "write-index",
    "enhance",
    "service",
    "logs",
  ]) {
    const re = new RegExp(`\\b${label.replace("-", "\\-")}\\b`, "i");
    if (re.test(raw)) {
      return label;
    }
  }
  return "task";
}

export function buildWorkflowSubagentSessionKey(params: {
  parentSessionKey: string | null | undefined;
  purpose: string;
  segments?: Array<string | null | undefined>;
}): string | null {
  const parent = normalizeWorkflowSubagentParentSessionKey(params.parentSessionKey);
  if (!parent) {
    return null;
  }
  const purpose = slugSessionSegment(params.purpose) ?? "workflow-task";
  const detailSegments = (params.segments ?? [])
    .map((segment) => slugSessionSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return `${parent}:subagent:${[purpose, ...detailSegments].join(":")}`;
}
