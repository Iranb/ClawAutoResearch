function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const PAPERNEXUS_CLI_LABELS = [
  "research-brief",
  "brainstorm-brief",
  "evidence-chain",
  "reflection-chain",
  "path-trace",
  "theory-brief",
  "storyline-brief",
  "paper-enhancement",
  "corpus-meta",
  "build-graph",
  "merge-graph",
  "write-index",
  "llm-optimize",
  "materialize",
  "enhancements",
  "enhance",
  "imports",
  "corpora",
  "corpus",
  "status",
  "query",
  "brainstorm",
  "ideas",
  "context",
  "impact",
  "analyze",
  "watch",
  "service",
  "logs",
] as const;

const PAPERNEXUS_API_LABELS = [
  "brainstorm-brief",
  "research-brief",
  "evidence-chain",
  "reflection-chain",
  "storyline-brief",
  "theory-brief",
  "paper-enhancement",
  "path-trace",
  "corpus-meta",
  "enhancements",
  "brainstorm",
  "imports",
  "context",
  "impact",
  "ideas",
  "query",
  "corpora",
  "corpus",
  "graph",
  "enhance",
  "status",
  "logs",
] as const;

const PAPERNEXUS_LIVE_GRAPH_CLI_READ_LABELS = [
  "research-brief",
  "brainstorm-brief",
  "evidence-chain",
  "reflection-chain",
  "path-trace",
  "theory-brief",
  "storyline-brief",
  "paper-enhancement",
  "corpus-meta",
  "enhancements",
  "corpora",
  "corpus",
  "status",
  "query",
  "brainstorm",
  "ideas",
  "context",
  "impact",
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PAPERNEXUS_CLI_LABEL_PATTERN = PAPERNEXUS_CLI_LABELS.map(escapeRegex).join("|");
const PAPERNEXUS_API_LABEL_PATTERN = PAPERNEXUS_API_LABELS.map(escapeRegex).join("|");

const PAPERNEXUS_SLASH_COMMAND_RE =
  /^\s*\/(?:graph-build|frontier-mapping|papernexus(?:-agentic-reasoning)?|papernexus-reflection)\b/i;

const PAPERNEXUS_CLI_COMMAND_RE =
  new RegExp(
    String.raw`\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:${PAPERNEXUS_CLI_LABEL_PATTERN})\b`,
    "i"
  );
const PAPERNEXUS_API_COMMAND_RE =
  new RegExp(
    String.raw`\b(?:curl|wget|fetch)\b[\s\S]*\/api\/(?:${PAPERNEXUS_API_LABEL_PATTERN})(?:\b|\/|\?)`,
    "i"
  );
const PAPERNEXUS_LIVE_GRAPH_CLI_READ_RE = new RegExp(
  String.raw`\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:${PAPERNEXUS_LIVE_GRAPH_CLI_READ_LABELS.map(escapeRegex).join("|")})\b`,
  "i"
);

function extractPapernexusApiLabel(text: string): string | null {
  const match = text.match(
    new RegExp(String.raw`\/api\/(${PAPERNEXUS_API_LABEL_PATTERN})(?:\b|\/|\?)`, "i")
  );
  const candidate = match?.[1]?.toLowerCase() ?? null;
  return candidate && PAPERNEXUS_API_LABELS.includes(candidate as (typeof PAPERNEXUS_API_LABELS)[number])
    ? candidate
    : null;
}

function extractPapernexusCliLabel(text: string): string | null {
  for (const label of PAPERNEXUS_CLI_LABELS) {
    const re = new RegExp(`\\b${escapeRegex(label)}\\b`, "i");
    if (re.test(text)) {
      return label;
    }
  }
  return null;
}

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

export function looksLikePapernexusLiveGraphCliReadCommand(
  text: string | null | undefined
): boolean {
  const raw = readString(text);
  if (!raw) {
    return false;
  }
  return PAPERNEXUS_LIVE_GRAPH_CLI_READ_RE.test(raw);
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
  const apiLabel = extractPapernexusApiLabel(raw);
  if (apiLabel) {
    return apiLabel;
  }
  const cliLabel = extractPapernexusCliLabel(raw);
  if (cliLabel) {
    return cliLabel;
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
