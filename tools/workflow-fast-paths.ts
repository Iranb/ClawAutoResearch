import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bindChannelProjectForWorkflow,
  ensureWorkflowProjectRoot,
  type WorkflowGuardPolicy,
} from "./workflow-guard";
import {
  buildWorkflowSubagentSessionKey,
  derivePapernexusTaskLabel,
  looksLikePapernexusHeavyCommand,
  normalizeWorkflowSubagentParentSessionKey,
} from "./workflow-subagent-sessions";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAgentId(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

export type BackgroundRunRequest = {
  kind?: string;
  commandText?: string;
  summary?: string;
  topic?: string;
  title?: string;
  projectId?: string;
  projectRoot?: string;
  ensureProjectBinding?: boolean;
};

type BackgroundRunRegistryEntry = {
  ownerAgent: string;
  channelKey: string;
  requesterSessionKey: string;
  backgroundSessionKey: string;
  runId: string;
  kind: string;
  family: string;
  status: "active" | "idle";
  projectId: string | null;
  projectRoot: string | null;
  startedAt: string;
  lastCheckedAt: string | null;
  lastFinishedAt: string | null;
};

export type BackgroundRunAgentContext = {
  agentId?: string;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
};

export type BackgroundRunSnapshot = {
  role: string | null;
  projectRoot: string | null;
  projectId: string | null;
  channelProjectBindingsEnabled: boolean;
};

const MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL = 2;
const BACKGROUND_RUN_STALE_MS = 6 * 60 * 60 * 1000;
const BACKGROUND_RUN_REGISTRY_FILENAME = "openclaw-research-background-runs.json";

function deriveBackgroundRunFamily(kind: string): string {
  switch (kind) {
    case "research_pipeline":
    case "research_queue":
    case "resume_pipeline":
      return "research";
    case "papernexus_skill":
      return "papernexus";
    default:
      return kind || "generic";
  }
}

function backgroundRunRegistryEntryMatchesProject(
  entry: BackgroundRunRegistryEntry,
  projectId: string | null,
  projectRoot: string | null
): boolean {
  const normalizedProjectId = readString(projectId) ?? null;
  const normalizedProjectRoot = readString(projectRoot) ?? null;
  if (normalizedProjectId && entry.projectId) {
    return normalizedProjectId === entry.projectId;
  }
  if (normalizedProjectRoot && entry.projectRoot) {
    return path.normalize(normalizedProjectRoot) === path.normalize(entry.projectRoot);
  }
  return normalizedProjectId == null && normalizedProjectRoot == null;
}

function getBackgroundRunRegistryPath(): string {
  return path.join(os.tmpdir(), BACKGROUND_RUN_REGISTRY_FILENAME);
}

export async function clearBackgroundWorkflowRunRegistryForTests(): Promise<void> {
  await fs.rm(getBackgroundRunRegistryPath(), { force: true });
}

function deriveBackgroundRunChannelKey(params: {
  sessionKey?: string;
  messageChannel?: string;
}): string | null {
  const normalizedParent = normalizeWorkflowSubagentParentSessionKey(params.sessionKey);
  const sessionKey = readString(normalizedParent ?? params.sessionKey);
  if (sessionKey?.startsWith("agent:")) {
    const parts = sessionKey.split(":");
    if (parts.length > 2) {
      const suffix = parts.slice(2).join(":").trim();
      if (suffix) {
        return suffix;
      }
    }
  }
  return readString(params.messageChannel) ?? null;
}

async function readBackgroundRunRegistry(): Promise<BackgroundRunRegistryEntry[]> {
  try {
    const raw = await fs.readFile(getBackgroundRunRegistryPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const ownerAgent = normalizeAgentId(record.ownerAgent);
        const channelKey = readString(record.channelKey);
        const requesterSessionKey = readString(record.requesterSessionKey);
        const backgroundSessionKey = readString(record.backgroundSessionKey);
        const runId = readString(record.runId);
        const kind = readString(record.kind) ?? "generic";
        const family = readString(record.family) ?? deriveBackgroundRunFamily(kind);
        const status = readString(record.status) === "idle" ? "idle" : "active";
        const projectId = readString(record.projectId) ?? null;
        const projectRoot = readString(record.projectRoot) ?? null;
        const startedAt = readString(record.startedAt);
        const lastCheckedAt = readString(record.lastCheckedAt) ?? null;
        const lastFinishedAt = readString(record.lastFinishedAt) ?? null;
        if (
          !ownerAgent ||
          !channelKey ||
          !requesterSessionKey ||
          !backgroundSessionKey ||
          !runId ||
          !startedAt
        ) {
          return null;
        }
        return {
          ownerAgent,
          channelKey,
          requesterSessionKey,
          backgroundSessionKey,
          runId,
          kind,
          family,
          status,
          projectId,
          projectRoot,
          startedAt,
          lastCheckedAt,
          lastFinishedAt,
        } satisfies BackgroundRunRegistryEntry;
      })
      .filter((entry): entry is BackgroundRunRegistryEntry => Boolean(entry));
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

async function writeBackgroundRunRegistry(entries: BackgroundRunRegistryEntry[]): Promise<void> {
  const registryPath = getBackgroundRunRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function pruneBackgroundRunRegistry(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
}): Promise<BackgroundRunRegistryEntry[]> {
  const now = Date.now();
  const current = await readBackgroundRunRegistry();
  const kept: BackgroundRunRegistryEntry[] = [];
  for (const entry of current) {
    const freshnessReference =
      entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
    const freshnessMs = Date.parse(freshnessReference);
    if (!Number.isFinite(freshnessMs) || now - freshnessMs > BACKGROUND_RUN_STALE_MS) {
      continue;
    }
    let nextEntry: BackgroundRunRegistryEntry = {
      ...entry,
      lastCheckedAt: new Date(now).toISOString(),
    };
    if (entry.status === "active" && params.runtimeSubagent?.waitForRun) {
      try {
        const waited = await params.runtimeSubagent.waitForRun({
          runId: entry.runId,
          timeoutMs: 1,
        });
        if (waited.status === "ok" || waited.status === "error") {
          nextEntry = {
            ...nextEntry,
            status: "idle",
            lastFinishedAt: new Date(now).toISOString(),
          };
        }
      } catch {
        continue;
      }
    }
    kept.push(nextEntry);
  }
  await writeBackgroundRunRegistry(kept);
  return kept;
}

async function upsertBackgroundRunRegistryEntry(
  entry: BackgroundRunRegistryEntry
): Promise<void> {
  const current = await readBackgroundRunRegistry();
  const next = current.filter(
    (existing) => existing.backgroundSessionKey !== entry.backgroundSessionKey
  );
  next.push(entry);
  await writeBackgroundRunRegistry(next);
}

export function hasBackgroundContinuationMarker(
  text: string | null | undefined
): boolean {
  if (!text) {
    return false;
  }
  return (
    /BACKGROUND_WORKFLOW_CONTINUATION=1/i.test(text) ||
    /__BACKGROUND_CONTINUATION__\s*:\s*true/i.test(text)
  );
}

export function buildResearchPipelineBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/research-pipeline "topic" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildResearchQueueBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/research-queue "status" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildResumePipelineBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return "/resume-pipeline -- __BACKGROUND_CONTINUATION__: true";
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildPapernexusSkillBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return "/graph-build -- __BACKGROUND_CONTINUATION__: true";
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export async function startBackgroundWorkflowRun(params: {
  runtimeSubagent?: {
    run: (params: {
      sessionKey: string;
      message: string;
      lane?: string;
      deliver?: boolean;
      idempotencyKey?: string;
      extraSystemPrompt?: string;
    }) => Promise<{ runId: string }>;
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx: BackgroundRunAgentContext;
  snapshot: BackgroundRunSnapshot;
  backgroundRun: BackgroundRunRequest;
}) {
  if (!params.runtimeSubagent) {
    throw new Error(
      "Background workflow execution requires gateway runtime.subagent access."
    );
  }
  if (!params.agentCtx.sessionKey) {
    throw new Error(
      "Background workflow execution requires a resolved sessionKey for this channel."
    );
  }

  const normalizedKind = readString(params.backgroundRun.kind)?.toLowerCase() ?? "generic";
  const normalizedFamily = deriveBackgroundRunFamily(normalizedKind);
  const requestedCommandText = readString(params.backgroundRun.commandText);
  const topic =
    readString(params.backgroundRun.topic) ?? readString(params.backgroundRun.title);
  const shouldEnsureProjectBinding =
    params.backgroundRun.ensureProjectBinding === false ? false : true;

  let ensuredProject:
    | Awaited<ReturnType<typeof ensureWorkflowProjectRoot>>
    | null = null;
  if (shouldEnsureProjectBinding) {
    ensuredProject = await ensureWorkflowProjectRoot({
      policy: params.workflowPolicy,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      projectRoot: readString(params.backgroundRun.projectRoot) ?? params.snapshot.projectRoot,
      projectId: readString(params.backgroundRun.projectId) ?? params.snapshot.projectId,
      title: readString(params.backgroundRun.title),
      topic,
    });
    if (
      params.snapshot.channelProjectBindingsEnabled &&
      (params.agentCtx.sessionKey || params.agentCtx.sessionId)
    ) {
      await bindChannelProjectForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.agentCtx.workspaceDir,
        sessionKey: params.agentCtx.sessionKey,
        sessionId: params.agentCtx.sessionId,
        messageChannel: params.agentCtx.messageChannel,
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
        title: ensuredProject.title,
        topic,
        boundByAgent: params.agentCtx.agentId ?? params.snapshot.role,
        notes: "Auto-bound during slash fast-path workflow startup.",
      });
    }
  }

  const commandText =
    requestedCommandText ??
    (normalizedKind === "research_pipeline"
      ? buildResearchPipelineBackgroundCommand(
          `/research-pipeline "${topic ?? ensuredProject?.title ?? "research topic"}"`
        )
      : normalizedKind === "research_queue"
        ? buildResearchQueueBackgroundCommand(
            `/research-queue "${topic ?? ensuredProject?.title ?? "status"}"`
          )
      : normalizedKind === "papernexus_skill"
        ? buildPapernexusSkillBackgroundCommand("/graph-build")
      : null);
  if (!commandText) {
    throw new Error(
      "backgroundRun.commandText is required unless kind=research_pipeline."
    );
  }

  const ownerAgent =
    normalizeAgentId(params.agentCtx.agentId) ?? normalizeAgentId(params.snapshot.role);
  const channelKey = deriveBackgroundRunChannelKey({
    sessionKey: params.agentCtx.sessionKey,
    messageChannel: params.agentCtx.messageChannel,
  });
  const resolvedProjectId =
    ensuredProject?.projectId ??
    readString(params.backgroundRun.projectId) ??
    params.snapshot.projectId ??
    null;
  const resolvedProjectRoot =
    ensuredProject?.projectRoot ??
    readString(params.backgroundRun.projectRoot) ??
    params.snapshot.projectRoot ??
    null;
  let reusableBackgroundSessionKey: string | null = null;
  if (ownerAgent === "researcher" && channelKey) {
    const registryEntries = await pruneBackgroundRunRegistry({
      runtimeSubagent: params.runtimeSubagent,
    });
    reusableBackgroundSessionKey =
      registryEntries.find(
        (entry) =>
          entry.ownerAgent === "researcher" &&
          entry.channelKey === channelKey &&
          entry.status === "idle" &&
          entry.family === normalizedFamily &&
          backgroundRunRegistryEntryMatchesProject(
            entry,
            resolvedProjectId,
            resolvedProjectRoot
          )
      )?.backgroundSessionKey ?? null;
    const activeChannelEntries = registryEntries.filter(
      (entry) =>
        entry.ownerAgent === "researcher" &&
        entry.channelKey === channelKey &&
        entry.status === "active" &&
        entry.backgroundSessionKey !== reusableBackgroundSessionKey
    );
    if (activeChannelEntries.length >= MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL) {
      return {
        started: false,
        runId: null,
        sessionKey: null,
        projectRoot:
          ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
        projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
        summary:
          `Background workflow not started: this channel already has ` +
          `${MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL} active Researcher background subagents. ` +
          "Wait for one to finish before starting another.",
      };
    }
  }

  const backgroundSessionKey =
    reusableBackgroundSessionKey ??
    buildWorkflowSubagentSessionKey({
      parentSessionKey: params.agentCtx.sessionKey,
      purpose:
        normalizedKind === "papernexus_skill" && looksLikePapernexusHeavyCommand(commandText)
          ? "papernexus-skill"
          : `workflow-${normalizedKind}`,
      segments:
        normalizedKind === "papernexus_skill" && looksLikePapernexusHeavyCommand(commandText)
          ? [derivePapernexusTaskLabel(commandText), resolvedProjectId]
          : [resolvedProjectId, topic],
    }) ??
    params.agentCtx.sessionKey;

  const runId = (
    await params.runtimeSubagent.run({
      sessionKey: backgroundSessionKey,
      message: commandText,
      lane: "nested",
      deliver: false,
      idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
      extraSystemPrompt:
        "BACKGROUND_WORKFLOW_CONTINUATION=1\n" +
        "This run was launched from a slash-command fast path into a dedicated workflow subagent session.\n" +
        "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.\n" +
        "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
    })
  ).runId;

  if (ownerAgent === "researcher" && channelKey) {
    await upsertBackgroundRunRegistryEntry({
      ownerAgent,
      channelKey,
      requesterSessionKey: params.agentCtx.sessionKey,
      backgroundSessionKey,
      runId,
      kind: normalizedKind,
      family: normalizedFamily,
      status: "active",
      projectId: resolvedProjectId,
      projectRoot: resolvedProjectRoot,
      startedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastFinishedAt: null,
    });
  }

  return {
    started: true,
    runId,
    sessionKey: backgroundSessionKey,
    projectRoot:
      ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
    projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
    summary:
      readString(params.backgroundRun.summary) ??
      (normalizedKind === "research_pipeline"
        ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background research pipeline started for"} ${topic ?? ensuredProject?.title ?? "research topic"}.`
        : normalizedKind === "resume_pipeline"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background resume pipeline started for"} ${readString(params.backgroundRun.projectId) ?? params.snapshot.projectId ?? "the current project"}.`
        : normalizedKind === "papernexus_skill"
          ? `${reusableBackgroundSessionKey ? "Reused an idle dedicated PaperNexus subagent and started" : "PaperNexus-heavy workflow task started in a dedicated subagent for"} ${readString(params.backgroundRun.projectId) ?? ensuredProject?.projectId ?? "the current project"}.`
        : "Background workflow run started."),
  };
}
