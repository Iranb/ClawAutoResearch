import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../runtime-api.js";
import type {
  ConversationRef,
  SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import {
  buildWorkflowSnapshot,
  ensureWorkflowProjectRoot,
  getResearchProgramStateSummary,
  getWorkflowGuardPolicy,
  inferTargetRoleFromToolParams,
  runWorkflowAutoIterator,
  setResearchProgramState,
} from "./workflow-guard";
import {
  buildGraphBuildBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildResumePipelineBackgroundCommand,
  drainQueuedBackgroundWorkflowRuns,
  startBackgroundWorkflowRun,
  type BackgroundRunRequest,
} from "./workflow-fast-paths";
import {
  getGateReviewStorePath,
  readGateReviewStore,
} from "./workflow-auto-gate";
import {
  getCodeReviewStorePath,
  readCodeReviewStore,
} from "./workflow-code-review.js";
import {
  getAutoModeDiscussionStorePath,
  readAutoModeDiscussionStore,
} from "./workflow-auto-discussion";
import { enqueueWorkflowTask, resolveWorkflowQueueKey } from "./workflow-coordination";

type WorkflowBackgroundCommandKind =
  | "research_pipeline"
  | "research_queue"
  | "resume_pipeline"
  | "graph_build";

type WorkflowCommandKind =
  | WorkflowBackgroundCommandKind
  | "project_init"
  | "workflow_status";

type WorkflowCommandDependencies = {
  resolveConversationBindingRecord: (
    conversation: ConversationRef
  ) => SessionBindingRecord | null;
  buildWorkflowSnapshot: typeof buildWorkflowSnapshot;
  runWorkflowAutoIterator: typeof runWorkflowAutoIterator;
  startBackgroundWorkflowRun: typeof startBackgroundWorkflowRun;
};

type WorkflowCommandApi = Pick<
  OpenClawPluginApi,
  "config" | "pluginConfig" | "runtime" | "logger" | "registerCommand"
>;

type RoutePeer = {
  kind: "direct" | "group" | "channel";
  id: string;
};

type ResolvedWorkflowCommandTarget = {
  sessionKey: string | null;
  agentId: string | null;
  workspaceDir: string | null;
  bindingConversation: ConversationRef | null;
};

type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;
type WorkflowAutoIteratorResult = Awaited<ReturnType<typeof runWorkflowAutoIterator>>;
type WorkflowGateReviewStore = Awaited<ReturnType<typeof readGateReviewStore>>;
type WorkflowCodeReviewStore = Awaited<ReturnType<typeof readCodeReviewStore>>;
type WorkflowAutoDiscussionStore = Awaited<ReturnType<typeof readAutoModeDiscussionStore>>;

type ExistingWorkflowProjectSelection = {
  projectId: string;
  projectRoot: string;
};

const DEFAULT_DEPS: WorkflowCommandDependencies = {
  resolveConversationBindingRecord: defaultResolveConversationBindingRecord,
  buildWorkflowSnapshot,
  runWorkflowAutoIterator,
  startBackgroundWorkflowRun,
};

const COMMAND_LABELS: Record<WorkflowCommandKind, string> = {
  research_pipeline: "/research-pipeline",
  research_queue: "/research-queue",
  resume_pipeline: "/resume-pipeline",
  graph_build: "/graph-build",
  project_init: "/project-init",
  workflow_status: "/workflow-status",
};

let cachedConversationRuntime:
  | {
      resolveConversationBindingRecord?: WorkflowCommandDependencies["resolveConversationBindingRecord"];
    }
  | null
  | undefined;

function getConversationRuntime() {
  if (cachedConversationRuntime !== undefined) {
    return cachedConversationRuntime;
  }
  try {
    const require = createRequire(import.meta.url);
    cachedConversationRuntime = require("openclaw/plugin-sdk/conversation-runtime");
  } catch {
    cachedConversationRuntime = null;
  }
  return cachedConversationRuntime;
}

function defaultResolveConversationBindingRecord(
  conversation: ConversationRef
): ReturnType<WorkflowCommandDependencies["resolveConversationBindingRecord"]> {
  return getConversationRuntime()?.resolveConversationBindingRecord?.(conversation) ?? null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolvePluginConfig(
  api: Pick<WorkflowCommandApi, "config" | "pluginConfig">
): Record<string, unknown> | undefined {
  if (api.config && api.pluginConfig) {
    return {
      ...api.config,
      ...api.pluginConfig,
    };
  }
  return api.pluginConfig ?? api.config;
}

function stripDiscordPrefix(raw: string): string {
  return raw.startsWith("discord:") ? raw.slice("discord:".length) : raw;
}

function parseDiscordPeer(raw: string): RoutePeer | null {
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
  if (/^\d+$/.test(normalized)) {
    return { kind: "channel", id: normalized };
  }
  return { kind: "channel", id: normalized };
}

function stripTelegramInternalPrefixes(raw: string): string {
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

function parseTelegramTarget(raw: string): {
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
    PluginCommandContext,
    "channel" | "from" | "to" | "accountId" | "messageThreadId"
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
    const candidates = [readString(ctx.from), readString(ctx.to)].filter(
      (value): value is string => Boolean(value)
    );
    for (const candidate of candidates) {
      const parsed = parseDiscordPeer(candidate);
      if (!parsed) {
        continue;
      }
      return {
        channel: "discord",
        accountId,
        conversationId: `${parsed.kind === "direct" ? "user" : "channel"}:${parsed.id}`,
      };
    }
  }

  return null;
}

function resolveRoutePeerFromCommandContext(
  ctx: Pick<PluginCommandContext, "channel" | "from" | "to">
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
    const candidates = [readString(ctx.from), readString(ctx.to)].filter(
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

function extractAgentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const trimmed = readString(sessionKey);
  if (!trimmed) {
    return null;
  }
  const match = /^agent:([^:]+):/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : null;
}

function extractQuotedSegment(value: string | undefined): string | undefined {
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

function formatWorkflowCommandArgument(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/u.test(value)
    ? value
    : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function injectGraphBuildRepairFlags(
  commandText: string | undefined,
  snapshot: WorkflowSnapshot
): string {
  const base = readString(commandText) ?? "/graph-build";
  if (!snapshot.paperIngestionRepairRequired) {
    return buildGraphBuildBackgroundCommand(base);
  }
  let next = base;
  if (!/--repair-import\b/i.test(next)) {
    next = `${next.trim()} --repair-import true`;
  }
  if (
    snapshot.paperIngestionRepairTargetCorpus &&
    !/--shared-corpus\b/i.test(next)
  ) {
    next =
      `${next.trim()} --shared-corpus ` +
      formatWorkflowCommandArgument(snapshot.paperIngestionRepairTargetCorpus);
  }
  return buildGraphBuildBackgroundCommand(next);
}

function formatResearchProgramOnboardingGapLabels(gaps: string[]): string {
  return gaps
    .map((gap) =>
      gap
        .replace(/^PROJECT_MANIFEST\.json\.research_program\./, "")
        .replace(/\s+\(recommended:.*\)$/, "")
    )
    .join(", ");
}

function buildBackgroundRunRequest(
  kind: WorkflowBackgroundCommandKind,
  ctx: Pick<PluginCommandContext, "args" | "commandBody">,
  overrides: Partial<BackgroundRunRequest> = {}
): BackgroundRunRequest {
  if (kind === "research_pipeline") {
    return {
      kind,
      commandText: buildResearchPipelineBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary: "Background research pipeline started.",
      ...overrides,
    };
  }
  if (kind === "research_queue") {
    return {
      kind,
      commandText: buildResearchQueueBackgroundCommand(ctx.commandBody),
      summary: "Background research queue task started.",
      ...overrides,
    };
  }
  if (kind === "graph_build") {
    return {
      kind,
      commandText: buildGraphBuildBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary:
        overrides.summary ??
        `Background graph build started for ${
          readString(overrides.projectId) ?? "the current project"
        }.`,
      ...overrides,
    };
  }
  return {
    kind,
    commandText: buildResumePipelineBackgroundCommand(ctx.commandBody),
    summary:
      overrides.summary ??
      `Background resume pipeline started for ${
        readString(overrides.projectId) ?? "the current project"
      }.`,
    ...overrides,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveExistingWorkflowProjectSelection(params: {
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>;
  projectId: string | undefined;
}): Promise<ExistingWorkflowProjectSelection | null> {
  const projectId = readString(params.projectId);
  if (!projectId) {
    return null;
  }
  const projectsRoot = readString(params.workflowPolicy.projectsRoot);
  if (!projectsRoot) {
    throw new Error(
      "projectsRoot is not configured for openclaw-research, so /resume-pipeline cannot resolve an explicit project id."
    );
  }
  const projectRoot = path.resolve(projectsRoot, projectId);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(
      `No existing workflow project found for "${projectId}" under ${projectsRoot}.`
    );
  }
  return {
    projectId,
    projectRoot,
  };
}

function compactStatusText(value: string | null | undefined, maxLength = 240): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "none";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function joinStatusList(values: string[]): string {
  return values.length > 0 ? values.join("; ") : "none";
}

function formatAutoModeSection(params: {
  autoIteratorResult: WorkflowAutoIteratorResult | null;
}) {
  const result = params.autoIteratorResult;
  if (!result) {
    return ["Auto mode: unavailable (no active project root resolved)."];
  }
  const totalMitigationRounds =
    result.autoModeMitigationRoundsStarted + result.autoModeMitigationRoundsRemaining;
  const lines = [
    `Auto mode: configured=${result.configuredAutoMode}, effective=${result.effectiveAutoMode}, risk=${result.autoModeRiskLevel}`,
    `Auto mitigation: status=${result.autoModeMitigationStatus ?? "none"}, rounds=${result.autoModeMitigationRoundsStarted}/${totalMitigationRounds}, remaining=${result.autoModeMitigationRoundsRemaining}, fingerprint=${result.autoModeRiskFingerprint ?? "none"}`,
  ];
  if (result.autoModeReasons.length > 0) {
    lines.push("Auto mode reasons:");
    for (const reason of result.autoModeReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return lines;
}

function formatAutoDiscussionSection(params: {
  projectRoot: string | null;
  discussionStore: WorkflowAutoDiscussionStore | null;
}) {
  if (!params.projectRoot || !params.discussionStore?.currentRound) {
    return ["Auto discussion: no persisted discussion round for the current project."];
  }
  const round = params.discussionStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto discussion: status=${round.status}, stage=${round.stage ?? "unknown"}, risk=${round.riskLevel}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto discussion store: ${getAutoModeDiscussionStorePath(params.projectRoot)}`,
    `Auto discussion packet: ${round.packetPath}`,
    `Auto discussion summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
    `Auto discussion recommended owner: ${aggregate?.recommendedOwner ?? "none"}`,
  ];
  if ((aggregate?.actionItems?.length ?? 0) > 0) {
    lines.push(`Auto discussion action items: ${joinStatusList(aggregate?.actionItems ?? [])}`);
  }
  if ((aggregate?.blockers?.length ?? 0) > 0) {
    lines.push(`Auto discussion blockers: ${joinStatusList(aggregate?.blockers ?? [])}`);
  }
  lines.push("Auto discussion content:");
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - ${attempt.reviewerRole}: status=${attempt.status}${
        result
          ? `, assessment=${result.riskAssessment}, confidence=${result.confidence.toFixed(1)}`
          : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.actionItems?.length ?? 0) > 0) {
      lines.push(`    action items: ${joinStatusList(result?.actionItems ?? [])}`);
    }
    if ((result?.blockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.blockers ?? [])}`);
    }
    if (result?.rawText) {
      lines.push(`    response: ${compactStatusText(result.rawText, 320)}`);
    }
  }
  return lines;
}

function formatGateReviewSection(params: {
  projectRoot: string | null;
  gateReviewStore: WorkflowGateReviewStore | null;
}) {
  if (!params.projectRoot || !params.gateReviewStore?.currentRound) {
    return ["Auto gate review: no persisted gate review round for the current project."];
  }
  const round = params.gateReviewStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto gate review: status=${round.status}, gate=${round.gateId}, stage=${round.stage ?? "unknown"}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto gate review store: ${getGateReviewStorePath(params.projectRoot)}`,
    `Auto gate review packet: ${round.packetPath}`,
    `Auto gate review summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
  ];
  if (aggregate) {
    lines.push(
      `Auto gate review scores: avg=${aggregate.averageScore?.toFixed(2) ?? "n/a"}, min=${aggregate.minScore?.toFixed(2) ?? "n/a"}, blockers=${aggregate.blockerCount}`
    );
  }
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - gate reviewer ${attempt.reviewerRole}: status=${attempt.status}${
        result ? `, verdict=${result.verdict}, score=${result.overallScore.toFixed(1)}` : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.majorIssues?.length ?? 0) > 0) {
      lines.push(`    major issues: ${joinStatusList(result?.majorIssues ?? [])}`);
    }
    if ((result?.criticalBlockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.criticalBlockers ?? [])}`);
    }
  }
  return lines;
}

function formatCodeReviewSection(params: {
  projectRoot: string | null;
  codeReviewStore: WorkflowCodeReviewStore | null;
}) {
  if (!params.projectRoot || !params.codeReviewStore?.currentRound) {
    return ["Auto code review: no persisted code review round for the current project."];
  }
  const round = params.codeReviewStore.currentRound;
  const aggregate = round.aggregate;
  const lines = [
    `Auto code review: status=${round.status}, gate=${round.gateId}, stage=${round.stage ?? "unknown"}, reviews=${aggregate?.reviewCount ?? 0}`,
    `Auto code review store: ${getCodeReviewStorePath(params.projectRoot)}`,
    `Auto code review packet: ${round.packetPath}`,
    `Auto code review summary: ${aggregate?.summary ?? "pending reviewer quorum"}`,
  ];
  if (aggregate) {
    lines.push(
      `Auto code review scores: avg=${aggregate.averageScore?.toFixed(2) ?? "n/a"}, min=${aggregate.minScore?.toFixed(2) ?? "n/a"}, blockers=${aggregate.blockerCount}`
    );
  }
  for (const attempt of round.attempts) {
    const result = attempt.result;
    lines.push(
      `  - code reviewer ${attempt.reviewerRole}: status=${attempt.status}${
        result ? `, verdict=${result.verdict}, score=${result.overallScore.toFixed(1)}` : ""
      }`
    );
    lines.push(`    summary: ${compactStatusText(result?.summary ?? attempt.error)}`);
    if ((result?.majorIssues?.length ?? 0) > 0) {
      lines.push(`    major issues: ${joinStatusList(result?.majorIssues ?? [])}`);
    }
    if ((result?.criticalBlockers?.length ?? 0) > 0) {
      lines.push(`    blockers: ${joinStatusList(result?.criticalBlockers ?? [])}`);
    }
  }
  return lines;
}

function formatWorkflowStatusText(params: {
  snapshot: WorkflowSnapshot;
  commandLabel: string;
  targetSessionKey: string;
  autoIteratorResult: WorkflowAutoIteratorResult | null;
  discussionStore: WorkflowAutoDiscussionStore | null;
  gateReviewStore: WorkflowGateReviewStore | null;
  codeReviewStore: WorkflowCodeReviewStore | null;
}) {
  const { snapshot } = params;
  const unreadMailboxCount = Array.isArray(snapshot.unreadMailbox)
    ? snapshot.unreadMailbox.length
    : 0;
  const hasPaperIngestionSummary =
    Boolean(snapshot.paperIngestionRuntimeStatus) ||
    (snapshot.paperIngestionImportTaskCount ?? 0) > 0 ||
    (snapshot.paperIngestionCompletedPaperCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionTimedOutOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionFailedOperationCount ?? 0) > 0 ||
    (snapshot.paperIngestionBatchCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveBatchCount ?? 0) > 0 ||
    (snapshot.paperIngestionPendingBatchItemCount ?? 0) > 0 ||
    (snapshot.paperIngestionSyncedBatchItemCount ?? 0) > 0 ||
    (snapshot.paperIngestionFailedBatchItemCount ?? 0) > 0 ||
    snapshot.paperIngestionReconcileRequired ||
    snapshot.paperIngestionRepairRequired;
  const lines = [
    "Workflow Status",
    `Session: ${params.targetSessionKey}`,
    `Role: ${snapshot.role ?? "unknown"}`,
    `Project: ${snapshot.projectId ?? "unset"} (${snapshot.projectResolutionSource})`,
    `Stage: ${snapshot.currentStage ?? "unknown"} / ${snapshot.currentMicroStage ?? "unknown"}`,
    `Owner: ${snapshot.ownerAgent ?? "unset"}${snapshot.recommendedOwner ? `, expected=${snapshot.recommendedOwner}` : ""}`,
    `Next action: ${snapshot.nextAction ?? "none"}`,
    `Resume action: ${snapshot.resumeAction ?? params.commandLabel}`,
    `Blocking reason: ${snapshot.blockingReason ?? "none"}`,
    `Mailbox: ${unreadMailboxCount} unread`,
    `Idle research: enabled=${snapshot.idleResearchEnabled ? "true" : "false"}, due=${snapshot.idleResearchDue ? "true" : "false"}, topic=${snapshot.idleResearchTopic ?? "unset"}`,
    `Graph refresh: ${snapshot.graphRefreshRequired ? `required (${snapshot.graphRefreshReason ?? "pending"})` : "not required"}`,
    ...(hasPaperIngestionSummary
      ? [
          `PaperNexus ingestion: status=${snapshot.paperIngestionRuntimeStatus ?? "unknown"}, import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0}, completed_papers=${snapshot.paperIngestionCompletedPaperCount ?? 0}, active_ops=${snapshot.paperIngestionActiveOperationCount ?? 0}, timed_out=${snapshot.paperIngestionTimedOutOperationCount ?? 0}, failed=${snapshot.paperIngestionFailedOperationCount ?? 0}, batches=${snapshot.paperIngestionBatchCount ?? 0}, active_batches=${snapshot.paperIngestionActiveBatchCount ?? 0}, batch_pending_items=${snapshot.paperIngestionPendingBatchItemCount ?? 0}, batch_synced_items=${snapshot.paperIngestionSyncedBatchItemCount ?? 0}, batch_failed_items=${snapshot.paperIngestionFailedBatchItemCount ?? 0}, queued_requests=${snapshot.paperIngestionQueuedRequestCount ?? 0}, running_requests=${snapshot.paperIngestionRunningRequestCount ?? 0}, reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`,
          ...(snapshot.paperIngestionRepairRequired
            ? [
                `PaperNexus repair: required=true, target_corpus=${snapshot.paperIngestionRepairTargetCorpus ?? "unset"}, reason=${snapshot.paperIngestionRepairReason ?? "pending"}`,
              ]
            : []),
          ...(snapshot.paperIngestionLastBatchManifestPath
            ? [
                `PaperNexus batch manifest: ${snapshot.paperIngestionLastBatchManifestPath}`,
            ]
          : []),
        ]
      : []),
    ...(snapshot.brainstormCycleStatus || snapshot.brainstormCycleProvider
      ? [
          `Brainstorm contract: provider=${snapshot.brainstormCycleProvider ?? "unset"}, provider_mode=${snapshot.brainstormCycleProviderMode ?? "unset"}, provider_status=${snapshot.brainstormCycleProviderStatus ?? "unset"}, contract_version=${snapshot.brainstormCycleContractVersion ?? "unset"}, bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`,
        ]
      : []),
    `Innovation reflection: status=${snapshot.innovationReflectionStatus ?? "unknown"}, due=${snapshot.innovationReflectionDue ? "true" : "false"}`,
    `Experiment sync: ${snapshot.experimentSyncRequired ? `required (${snapshot.experimentPapernexusSyncStatus ?? "pending"})` : "not required"}`,
  ];
  if (snapshot.experimentSearchStatus && snapshot.experimentSearchStatus !== "missing") {
    lines.push(
      `Experiment search: status=${snapshot.experimentSearchStatus}, main_stage=${snapshot.experimentSearchCurrentMainStage ?? "unset"}, substage=${snapshot.experimentSearchCurrentSubstage ?? "unset"}, best_node=${snapshot.experimentSearchBestNodeId ?? "unset"}, multi_seed=${snapshot.experimentSearchMultiSeedStatus ?? "unset"}, plot_pack=${snapshot.experimentSearchPlotPackStatus ?? "unset"}`
    );
  }
  if (
    snapshot.researchProgramStatus ||
    (snapshot.researchProgramOnboardingMissing ?? []).length > 0
  ) {
    lines.push(
      `Research program: status=${snapshot.researchProgramStatus ?? "missing"}, onboarding=${snapshot.researchProgramOnboardingStatus ?? "unknown"}, goal=${snapshot.researchProgramPrimaryGoal ?? "unset"}, baseline=${snapshot.researchProgramBaselineReference ?? "unset"}, primary_metric=${snapshot.researchProgramPrimaryMetricName ?? "unset"}, datasets=${snapshot.researchProgramDatasetCount ?? 0}, success_criteria=${snapshot.researchProgramSuccessCriteriaCount ?? 0}, active_tracks=${snapshot.researchProgramActiveTrackCount ?? 0}/${snapshot.researchProgramTrackCount ?? 0}`
    );
    if (snapshot.researchProgramZoteroProjectPath) {
      lines.push(
        `Research program Zotero path: ${snapshot.researchProgramZoteroProjectPath}`
      );
    }
    if ((snapshot.researchProgramOnboardingMissing ?? []).length > 0) {
      lines.push(
        `Research program checklist: missing=${snapshot.researchProgramOnboardingMissing.join(", ")}`
      );
    }
  }
  if (snapshot.writingSessionStatus && snapshot.writingSessionStatus !== "missing") {
    lines.push(
      `Writing session: status=${snapshot.writingSessionStatus}, current_section=${snapshot.writingCurrentSection ?? "unset"}, section_review=${snapshot.writingCurrentSectionReviewVerdict ?? "unknown"}`
    );
    lines.push(
      `Writing evidence coverage: status=${snapshot.writingGraphEvidenceCoverageStatus ?? "unknown"}, packets_ready=${snapshot.writingSectionPacketsReady ? "true" : "false"}`
    );
  }
  if (snapshot.reviewSessionStatus && snapshot.reviewSessionStatus !== "missing") {
    lines.push(
      `Review session: status=${snapshot.reviewSessionStatus}, scope=${snapshot.reviewSessionStageScope ?? "unset"}, round=${snapshot.reviewSessionRound ?? 0}, verdict=${snapshot.reviewSessionVerdict ?? "unknown"}`
    );
    const reviewRubric = snapshot.reviewRubricSummary ?? {};
    const rubricPairs = [
      ["originality", reviewRubric.originality],
      ["quality", reviewRubric.quality],
      ["clarity", reviewRubric.clarity],
      ["significance", reviewRubric.significance],
      ["soundness", reviewRubric.soundness],
      ["citation_integrity", reviewRubric.citationIntegrity],
      ["graph_evidence", reviewRubric.graphGroundedEvidenceSufficiency],
    ].filter(([, value]) => typeof value === "number");
    if (rubricPairs.length > 0) {
      lines.push(
        `Reviewer rubric: ${rubricPairs
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`
      );
    }
  }
  if (
    snapshot.reviewIssueTrackerStatus &&
    snapshot.reviewIssueTrackerStatus !== "missing"
  ) {
    lines.push(
      `Review issues: status=${snapshot.reviewIssueTrackerStatus}, critical=${snapshot.reviewIssueCriticalCount ?? 0}, high=${snapshot.reviewIssueHighCount ?? 0}, medium=${snapshot.reviewIssueMediumCount ?? 0}, low=${snapshot.reviewIssueLowCount ?? 0}`
    );
  }
  if (
    snapshot.graphGuidedWritingStatus &&
    snapshot.graphGuidedWritingStatus !== "missing"
  ) {
    const missingClaims = Array.isArray(snapshot.graphGuidedWritingMissingEvidenceClaims)
      ? snapshot.graphGuidedWritingMissingEvidenceClaims
      : [];
    lines.push(
      `Graph-guided writing: status=${snapshot.graphGuidedWritingStatus}, evidence_coverage=${snapshot.graphGuidedWritingEvidenceCoverageStatus ?? "unknown"}, missing_claims=${missingClaims.join(",") || "none"}`
    );
    if (snapshot.graphGuidedWritingScholarReserved) {
      lines.push(
        `Scholar fallback slot: reserved=${snapshot.graphGuidedWritingScholarSkillSlot ?? "true"}`
      );
    } else {
      lines.push("Scholar fallback slot: reserved=false");
    }
  }
  if (
    snapshot.citationCollectionStatus &&
    snapshot.citationCollectionStatus !== "missing"
  ) {
    lines.push(
      `Citation collection: status=${snapshot.citationCollectionStatus}, verified=${snapshot.citationCollectionVerifiedCount ?? 0}/${snapshot.citationCollectionCandidateCount ?? 0}, suspicious=${snapshot.citationCollectionSuspiciousCount ?? 0}, hallucinated=${snapshot.citationCollectionHallucinatedCount ?? 0}`
    );
  }
  if (snapshot.paperQcStatus && snapshot.paperQcStatus !== "missing") {
    lines.push(
      `Paper QC: status=${snapshot.paperQcStatus}, compile=${snapshot.paperQcCompileStatus ?? "unset"}, chktex=${snapshot.paperQcChktexStatus ?? "unset"}, page_budget=${snapshot.paperQcPageBudgetStatus ?? "unset"}`
    );
  }
  if (snapshot.figureQcStatus && snapshot.figureQcStatus !== "missing") {
    lines.push(
      `Figure QC: status=${snapshot.figureQcStatus}, duplicate_figures=${snapshot.figureQcDuplicateFigureStatus ?? "unset"}, caption_alignment=${snapshot.figureQcCaptionAlignmentStatus ?? "unset"}, text_alignment=${snapshot.figureQcTextAlignmentStatus ?? "unset"}, selection=${snapshot.figureQcSelectionStatus ?? "unset"}`
    );
  }
  if (
    snapshot.externalReviewStatus &&
    snapshot.externalReviewStatus !== "missing"
  ) {
    lines.push(
      `External review: status=${snapshot.externalReviewStatus}, recommendation=${snapshot.externalReviewRecommendation ?? "unset"}, required_action=${snapshot.externalReviewRequiredAction ?? "unset"}`
    );
  }
  if (!snapshot.projectRoot) {
    lines.push(
      "Project binding: no active project is currently bound to this conversation or workflow session."
    );
  }
  lines.push("");
  lines.push(...formatAutoModeSection({ autoIteratorResult: params.autoIteratorResult }));
  lines.push("");
  lines.push(...formatAutoDiscussionSection({
    projectRoot: snapshot.projectRoot ?? null,
    discussionStore: params.discussionStore,
  }));
  lines.push("");
  lines.push(...formatGateReviewSection({
    projectRoot: snapshot.projectRoot ?? null,
    gateReviewStore: params.gateReviewStore,
  }));
  lines.push("");
  lines.push(...formatCodeReviewSection({
    projectRoot: snapshot.projectRoot ?? null,
    codeReviewStore: params.codeReviewStore,
  }));
  return lines.join("\n");
}

export function resolveWorkflowCommandSessionTarget(
  api: Pick<WorkflowCommandApi, "runtime">,
  ctx: Pick<
    PluginCommandContext,
    "channel" | "from" | "to" | "accountId" | "messageThreadId" | "config"
  >,
  resolveBindingRecord: WorkflowCommandDependencies["resolveConversationBindingRecord"] = DEFAULT_DEPS.resolveConversationBindingRecord
): ResolvedWorkflowCommandTarget {
  const bindingConversation = resolveBindingConversationFromCommandContext(ctx);
  const bindingRecord = bindingConversation
    ? resolveBindingRecord(bindingConversation)
    : null;
  const routePeer = resolveRoutePeerFromCommandContext(ctx);
  const route = routePeer
    ? api.runtime?.channel?.routing?.resolveAgentRoute?.({
        cfg: ctx.config,
        channel: ctx.channel,
        accountId: ctx.accountId,
        peer: routePeer,
      })
    : null;
  const sessionKey = readString(bindingRecord?.targetSessionKey) ?? readString(route?.sessionKey) ?? null;
  const agentId =
    extractAgentIdFromSessionKey(sessionKey) ?? readString(route?.agentId) ?? null;
  const workspaceDir =
    agentId && typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
      ? api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId)
      : null;
  return {
    sessionKey,
    agentId,
    workspaceDir: readString(workspaceDir) ?? null,
    bindingConversation,
  };
}

function createBackgroundWorkflowCommandHandler(
  api: WorkflowCommandApi,
  kind: WorkflowBackgroundCommandKind,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS[kind];
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy);
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetSessionKey = target.sessionKey;

      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a Researcher-bound conversation or keep the prompt-path fallback enabled.",
        };
      }

      const targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: targetSessionKey,
      });
      const requiresResearcherSession =
        kind === "research_pipeline" || kind === "research_queue";
      if (requiresResearcherSession && targetRole !== "researcher") {
        return {
          text:
            `❌ ${commandLabel} can only start from a Researcher workflow session. ` +
            `Current target: ${targetRole ?? target.agentId ?? target.sessionKey}.`,
        };
      }
      if (!requiresResearcherSession && !targetRole) {
        return {
          text:
            `❌ ${commandLabel} requires a workflow-owned session for this conversation. ` +
            `Current target: ${target.agentId ?? target.sessionKey}.`,
        };
      }

      const snapshot = await deps.buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey,
        messageChannel: ctx.channel,
      });
      if (kind === "graph_build" && !snapshot.projectRoot) {
        return {
          text:
            `❌ ${commandLabel} requires a project-bound workflow conversation. ` +
            "Run it from a conversation already bound to a project or resume the project first.",
        };
      }
      const explicitProject =
        kind === "resume_pipeline"
          ? await resolveExistingWorkflowProjectSelection({
              workflowPolicy,
              projectId: extractQuotedSegment(ctx.args),
            })
          : null;

      if (kind === "resume_pipeline" && !explicitProject && !snapshot.projectRoot) {
        return {
          text:
            `❌ ${commandLabel} could not resolve a project to resume. ` +
            "Run it from a project-bound workflow conversation or pass an explicit project id.",
        };
      }

      const result = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: explicitProject?.projectRoot ?? snapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingConversation?.conversationId,
        }),
        label: `workflow_command:${kind}`,
        logger: api.logger,
        task: async () => {
          const currentSnapshot = await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
          });
          const commandSnapshot =
            explicitProject != null
              ? {
                  ...currentSnapshot,
                  projectRoot: explicitProject.projectRoot,
                  projectId: explicitProject.projectId,
                }
              : currentSnapshot;
          const graphBuildCommandText =
            kind === "graph_build"
              ? injectGraphBuildRepairFlags(ctx.commandBody, commandSnapshot)
              : undefined;

      const resolvedBackgroundAgentId =
        kind === "graph_build"
          ? "researcher"
          : target.agentId ?? currentSnapshot.role ?? undefined;
      const resolvedBackgroundWorkspaceDir =
        kind === "graph_build" &&
        typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
          ? readString(api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, "researcher")) ??
            target.workspaceDir ??
            undefined
          : target.workspaceDir ?? undefined;

          return deps.startBackgroundWorkflowRun({
            runtimeSubagent: api.runtime?.subagent,
            workflowPolicy,
            agentCtx: {
              agentId: resolvedBackgroundAgentId,
              workspaceDir: resolvedBackgroundWorkspaceDir,
              sessionKey: targetSessionKey,
              messageChannel: ctx.channel,
            },
            snapshot: commandSnapshot,
            backgroundRun: buildBackgroundRunRequest(kind, ctx, {
              ...(graphBuildCommandText ? { commandText: graphBuildCommandText } : {}),
              projectId:
                explicitProject?.projectId ??
                (kind === "graph_build" ? commandSnapshot.projectId ?? undefined : undefined),
              projectRoot:
                explicitProject?.projectRoot ??
                (kind === "graph_build" ? commandSnapshot.projectRoot ?? undefined : undefined),
            }),
          });
        },
      });

      return {
        text: result.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to start workflow command background run.", {
        kind,
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to start the background workflow: ${message}`,
      };
    }
  };
}

function createProjectInitCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.project_init;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: target.sessionKey,
      });
      const topic = extractQuotedSegment(ctx.args);
      const snapshot = target.sessionKey && targetRole
        ? await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: target.sessionKey,
            messageChannel: ctx.channel,
          })
        : null;
      const ensuredProject = await ensureWorkflowProjectRoot({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: target.sessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingConversation?.conversationId,
        projectRoot: snapshot?.projectRoot ?? null,
        projectId: snapshot?.projectId ?? null,
        title: topic ?? snapshot?.projectId ?? null,
        topic,
      });
      const currentSummary = await getResearchProgramStateSummary({
        projectRoot: ensuredProject.projectRoot,
      });
      const seededGoal =
        topic ?? currentSummary.state.goal ?? ensuredProject.title;
      const update = await setResearchProgramState({
        projectRoot: ensuredProject.projectRoot,
        researchProgram: {
          status:
            currentSummary.state.status === "missing"
              ? "draft"
              : currentSummary.state.status,
          goal: currentSummary.state.goal ?? seededGoal,
          problem_statement:
            currentSummary.state.problemStatement ?? seededGoal,
          zotero_project_path:
            currentSummary.state.zoteroProjectPath ??
            `bot/${ensuredProject.projectId}`,
          pending_reason:
            currentSummary.state.pendingReason ??
            "Complete the onboarding contract before graph grounding.",
        },
      });
      const missingLabels = formatResearchProgramOnboardingGapLabels(
        update.onboardingGaps
      );
      return {
        text:
          `Project init saved for ${ensuredProject.projectId}. ` +
          `Research program onboarding=${update.onboardingStatus}. ` +
          `Zotero path=${update.state.zoteroProjectPath ?? `bot/${ensuredProject.projectId}`}. ` +
          (missingLabels ? `missing=${missingLabels}` : "missing=none"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to initialize workflow project onboarding.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to initialize the workflow project: ${message}`,
      };
    }
  };
}

function createWorkflowStatusCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.workflow_status;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy);
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetSessionKey = target.sessionKey;

      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a workflow-bound conversation.",
        };
      }

      const previewSnapshot = await deps.buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey,
        messageChannel: ctx.channel,
      });

      const statusState = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: previewSnapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingConversation?.conversationId,
        }),
        label: "workflow_command:workflow_status",
        logger: api.logger,
        task: async () => {
          const snapshot = await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
          });
          const resolvedProjectRoot = snapshot.projectRoot ?? null;
          const autoIteratorResult = resolvedProjectRoot
            ? await deps.runWorkflowAutoIterator({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
                agentId: target.agentId ?? snapshot.role ?? undefined,
                mode: "command-status",
                queueMailbox: false,
              })
            : null;
          const [discussionStore, gateReviewStore, codeReviewStore] = resolvedProjectRoot
            ? await Promise.all([
                readAutoModeDiscussionStore(resolvedProjectRoot),
                readGateReviewStore(resolvedProjectRoot),
                readCodeReviewStore(resolvedProjectRoot),
              ])
            : [null, null, null];
          return {
            snapshot,
            autoIteratorResult,
            discussionStore,
            gateReviewStore,
            codeReviewStore,
          };
        },
      });

      return {
        text: formatWorkflowStatusText({
          snapshot: statusState.snapshot,
          commandLabel,
          targetSessionKey,
          autoIteratorResult: statusState.autoIteratorResult,
          discussionStore: statusState.discussionStore,
          gateReviewStore: statusState.gateReviewStore,
          codeReviewStore: statusState.codeReviewStore,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to resolve workflow status command.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to read workflow status: ${message}`,
      };
    }
  };
}

async function maybeReplayQueuedWorkflowRunsFromCommandRuntime(
  api: WorkflowCommandApi,
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>
): Promise<void> {
  if (!workflowPolicy.projectsRoot) {
    return;
  }
  try {
    await drainQueuedBackgroundWorkflowRuns({
      runtimeSubagent: api.runtime?.subagent,
      workflowPolicy,
      projectsRoot: workflowPolicy.projectsRoot,
      ignoreRetryBackoff: true,
    });
  } catch (error) {
    api.logger?.debug?.("Failed opportunistic workflow queue replay from command runtime.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createResearchWorkflowCommands(
  api: WorkflowCommandApi,
  deps: Partial<WorkflowCommandDependencies> = {}
): OpenClawPluginCommandDefinition[] {
  const resolvedDeps: WorkflowCommandDependencies = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  return [
    {
      name: "project-init",
      description:
        "Initialize or refresh the guided workflow onboarding contract for the current project.",
      acceptsArgs: true,
      handler: createProjectInitCommandHandler(api, resolvedDeps),
    },
    {
      name: "research-pipeline",
      description:
        "Start the research pipeline as a background continuation for the current Researcher session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "research_pipeline",
        resolvedDeps
      ),
    },
    {
      name: "research-queue",
      description:
        "Run the research queue flow as a background continuation for the current Researcher session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "research_queue",
        resolvedDeps
      ),
    },
    {
      name: "resume-pipeline",
      description:
        "Resume and reconcile the current workflow project, optionally targeting an explicit existing project id.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "resume_pipeline",
        resolvedDeps
      ),
    },
    {
      name: "graph-build",
      description:
        "Run the bounded graph-readiness and brainstorm-refresh pass for the current project in a background Researcher continuation.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "graph_build",
        resolvedDeps
      ),
    },
    {
      name: "workflow-status",
      description:
        "Show the current workflow snapshot for this bound conversation or workflow session.",
      acceptsArgs: false,
      handler: createWorkflowStatusCommandHandler(api, resolvedDeps),
    },
  ];
}

export function registerResearchWorkflowCommands(
  api: WorkflowCommandApi,
  deps: Partial<WorkflowCommandDependencies> = {}
): void {
  for (const command of createResearchWorkflowCommands(api, deps)) {
    api.registerCommand(command);
  }
}
