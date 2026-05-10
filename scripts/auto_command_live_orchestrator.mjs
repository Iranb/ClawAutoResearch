import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  dispatchWorkflowCommand,
  loadWorkflowHarnessPluginConfig,
} from "./workflow_command_harness_lib.mjs";
import { createGatewayRuntimeSubagent } from "./gateway_runtime_subagent.mjs";
import { startIsolatedGateway } from "./isolated_gateway_server.mjs";
import { buildWorkflowTransportContext } from "./workflow_transport_context.mjs";
import {
  getWorkflowGuardPolicy,
  runWorkflowAutoIterator,
} from "../tools/workflow-guard.ts";
import { handoffWorkflowTaskToAgent } from "../tools/workflow-execution/delivery-adapter.ts";
import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import { deliverWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-delivery.ts";
import { transitionWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-store.ts";
import { detectWorkflowPaperArtifactTerminal } from "../tools/workflow-paper-terminal.ts";

const ACTIVE_LOCAL_HANDOFF_STATUSES = new Set([
  "prepared",
  "pending",
  "queued",
  "dispatching",
  "dispatched",
  "delivered",
  "acknowledged",
  "claimed",
  "activated",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAssistantTexts(messages) {
  return (messages ?? [])
    .filter((entry) => entry?.role === "assistant")
    .flatMap((entry) => Array.isArray(entry?.content) ? entry.content : [])
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(projectRoot) {
  return (
    (await readJsonIfExists(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {}
  );
}

function issueOpenCount(reviewIssues) {
  const counts = reviewIssues?.open_counts;
  if (counts && typeof counts === "object") {
    return Object.values(counts).reduce((total, value) => {
      const numeric = Number(value);
      return total + (Number.isFinite(numeric) && numeric > 0 ? numeric : 0);
    }, 0);
  }
  if (Array.isArray(reviewIssues?.issues)) {
    return reviewIssues.issues.filter((issue) => {
      const status = readString(issue?.status) ?? "open";
      return !["closed", "resolved", "done"].includes(status);
    }).length;
  }
  return reviewIssues?.status === "open" ? 1 : 0;
}

function isReadyReviewVerdict(value) {
  const normalized = readString(value)?.toLowerCase();
  return [
    "ready",
    "pass",
    "passed",
    "approved",
    "accept",
    "accepted",
    "complete",
    "completed",
  ].includes(normalized ?? "");
}

function isBlockingRevisionActionItem(value) {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /\b(proceed|advance|submit|submission|submit-stage|camera-ready|ready)\b/.test(normalized) &&
    !/\b(revis|fix|address|block|change|strengthen|rewrite|missing|unsupported|overclaim)\b/.test(normalized)
  ) {
    return false;
  }
  return /\b(revis|fix|address|block|change|strengthen|rewrite|missing|unsupported|overclaim|clarif|correct|add stronger)\b/.test(
    normalized
  );
}

export async function detectLiveSubstantiveRevisionTerminal(params) {
  const manifest = params.manifest ?? {};
  const stage = readString(manifest.current_stage) ?? "";
  const owner = readString(manifest.owner_agent) ?? "";
  if (stage !== "write" || owner !== "academic_writer") {
    return { terminal: false, reason: null, details: {} };
  }

  const paperPdfPath = path.join(params.projectRoot, "academic_writer", "paper", "main.pdf");
  const reviewPacketPath = path.join(params.projectRoot, "reviewer", "REVIEW_PACKET.json");
  const reviewIssuesPath = path.join(params.projectRoot, "reviewer", "REVIEW_ISSUES.json");
  const revisionPacketJsonPath = path.join(
    params.projectRoot,
    "reviewer",
    "REVISION_CONTROL_PACKET.json"
  );
  const revisionPacketMarkdownPath = path.join(
    params.projectRoot,
    "reviewer",
    "REVISION_CONTROL_PACKET.md"
  );
  const revisionStatePath = path.join(
    params.projectRoot,
    "academic_writer",
    "PAPER_REVISION_STATE.json"
  );

  const [
    pdfExists,
    reviewPacket,
    reviewIssues,
    revisionPacketExists,
    revisionPacketMarkdownExists,
    revisionState,
  ] = await Promise.all([
    pathExists(paperPdfPath),
    readJsonIfExists(reviewPacketPath),
    readJsonIfExists(reviewIssuesPath),
    pathExists(revisionPacketJsonPath),
    pathExists(revisionPacketMarkdownPath),
    readJsonIfExists(revisionStatePath),
  ]);
  const actionItems = Array.isArray(reviewPacket?.action_items)
    ? reviewPacket.action_items
    : [];
  const actionItemCount = actionItems.length;
  const blockingActionItemCount = actionItems.filter(isBlockingRevisionActionItem).length;
  const openIssueCount = issueOpenCount(reviewIssues);
  const synthesisStatus =
    readString(manifest.innovation_synthesis_state?.status) ??
    readString(manifest.innovationSynthesisState?.status);
  const revisionStatus = readString(revisionState?.status);
  const reviewVerdict =
    readString(reviewPacket?.verdict) ??
    readString(manifest.review_session?.verdict) ??
    readString(manifest.reviewSession?.verdict);
  const reviewStatus =
    readString(reviewPacket?.status) ??
    readString(manifest.review_session?.status) ??
    readString(manifest.reviewSession?.status);
  const reviewReady =
    openIssueCount === 0 &&
    (isReadyReviewVerdict(reviewVerdict) || isReadyReviewVerdict(reviewStatus));
  const blockingRevisionStatus =
    ["active", "needs_revision", "blocked", "required"].includes(
      revisionStatus?.toLowerCase() ?? ""
    );
  const terminal =
    pdfExists &&
    !reviewReady &&
    (synthesisStatus === "needs_revision" ||
      openIssueCount > 0 ||
      blockingActionItemCount > 0 ||
      blockingRevisionStatus);

  return {
    terminal,
    reason: terminal ? "live_reviewer_revision_requested" : null,
    details: {
      stage,
      owner,
      pdfExists,
      synthesisStatus: synthesisStatus ?? null,
      reviewIssueCount: openIssueCount,
      actionItemCount,
      blockingActionItemCount,
      reviewVerdict: reviewVerdict ?? null,
      reviewStatus: reviewStatus ?? null,
      reviewReady,
      revisionPacketExists: revisionPacketExists || revisionPacketMarkdownExists,
      revisionStatus: revisionStatus ?? null,
    },
  };
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const detectLivePaperArtifactTerminal = detectWorkflowPaperArtifactTerminal;

const LIVE_PAPER_ARTIFACT_TERMINAL_STAGES = new Set([
  "write",
  "review",
  "submit",
  "done",
]);

function liveStageAllowsPaperArtifactTerminal(manifest) {
  const stage = readString(manifest?.current_stage);
  return LIVE_PAPER_ARTIFACT_TERMINAL_STAGES.has(stage ?? "");
}

async function detectStageScopedLivePaperArtifactTerminal(params) {
  if (!liveStageAllowsPaperArtifactTerminal(params.manifest)) {
    return {
      terminal: false,
      reason: null,
      details: {
        stage: readString(params.manifest?.current_stage),
        skippedReason: "workflow_not_in_paper_terminal_stage",
      },
    };
  }
  return detectLivePaperArtifactTerminal(params);
}

function sameProjectRoot(left, right) {
  const normalizedLeft = readString(left);
  const normalizedRight = readString(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return path.resolve(normalizedLeft) === path.resolve(normalizedRight);
}

function projectIdMatches(entryProjectId, projectId) {
  const expected = readString(projectId);
  if (!expected) {
    return true;
  }
  const actual = readString(entryProjectId);
  return !actual || actual === expected;
}

function roleMatches(entry, owner) {
  const expected = readString(owner);
  if (!expected || !entry || typeof entry !== "object") {
    return false;
  }
  return [
    entry.role,
    entry.ownerAgent,
    entry.owner_agent,
    entry.agentId,
    entry.agent_id,
    entry.toRole,
    entry.to_role,
  ]
    .map(readString)
    .includes(expected);
}

function stageMatches(entry, stage) {
  const expected = readString(stage);
  if (!expected || !entry || typeof entry !== "object") {
    return false;
  }
  return [
    entry.currentStage,
    entry.current_stage,
    entry.stageAfter,
    entry.stage_after,
    entry.stage,
  ]
    .map(readString)
    .includes(expected);
}

function entryProjectMatches(entry, projectRoot, projectId) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const root = readString(entry.projectRoot ?? entry.project_root);
  if (root && !sameProjectRoot(root, projectRoot)) {
    return false;
  }
  return projectIdMatches(entry.projectId ?? entry.project_id, projectId);
}

function isActiveRuntimeSession(entry, params) {
  if (!entryProjectMatches(entry, params.projectRoot, params.projectId)) {
    return false;
  }
  if (readString(entry.status) !== "active") {
    return false;
  }
  return roleMatches(entry, params.owner);
}

function isActiveAgentSession(entry, params) {
  if (!entryProjectMatches(entry, params.projectRoot, params.projectId)) {
    return false;
  }
  if (readString(entry.status) !== "active") {
    return false;
  }
  if (!roleMatches(entry, params.owner)) {
    return false;
  }
  const currentStage = readString(entry.currentStage ?? entry.current_stage);
  return !currentStage || stageMatches(entry, params.stage);
}

function isActiveHandoffIntent(entry, params) {
  if (!entryProjectMatches(entry, params.projectRoot, params.projectId)) {
    return false;
  }
  if (!ACTIVE_LOCAL_HANDOFF_STATUSES.has(readString(entry.status))) {
    return false;
  }
  return roleMatches(entry, params.owner) && stageMatches(entry, params.stage);
}

export async function readLiveWorkflowActivation(params) {
  const manifest = params.manifest ?? (await readManifest(params.projectRoot));
  if (
    readString(manifest.current_stage) === readString(params.stage) &&
    readString(manifest.owner_agent) === readString(params.owner)
  ) {
    return { active: true, reason: "manifest_owner_stage_assigned" };
  }

  const runtimeSessions = await readJsonIfExists(
    path.join(params.projectRoot, ".openclaw-research", "workflow-runtime-sessions.json")
  );
  if (
    Array.isArray(runtimeSessions?.entries) &&
    runtimeSessions.entries.some((entry) => isActiveRuntimeSession(entry, params))
  ) {
    return { active: true, reason: "runtime_session_active" };
  }

  const agentSessions = await readJsonIfExists(
    path.join(params.projectRoot, ".openclaw-research", "workflow-agent-sessions.json")
  );
  if (
    Array.isArray(agentSessions?.entries) &&
    agentSessions.entries.some((entry) => isActiveAgentSession(entry, params))
  ) {
    return { active: true, reason: "agent_session_active" };
  }

  const handoffIntents = await readJsonIfExists(
    path.join(params.projectRoot, ".openclaw-research", "workflow-handoff-intents.json")
  );
  if (
    Array.isArray(handoffIntents?.intents) &&
    handoffIntents.intents.some((entry) => isActiveHandoffIntent(entry, params))
  ) {
    return { active: true, reason: "handoff_intent_active" };
  }

  return { active: false, reason: null };
}

function parseProjectRootFromCommandText(text) {
  const match = /project_root=(.+)$/m.exec(text ?? "");
  return match?.[1]?.trim() ?? null;
}

function deriveProjectRootFromBootstrap(bootstrap) {
  return (
    bootstrap.backgroundRuns?.at?.(-1)?.started?.projectRoot ??
    bootstrap.backgroundRuns?.at?.(-1)?.backgroundRun?.projectRoot ??
    parseProjectRootFromCommandText(bootstrap.result?.text) ??
    null
  );
}

function slugifyTopic(topic) {
  const normalized = String(topic ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "research-topic";
}

function workflowProgressFingerprint(manifest) {
  const paperIngestion =
    manifest?.paper_ingestion && typeof manifest.paper_ingestion === "object"
      ? manifest.paper_ingestion
      : {};
  const queuedRequests = Array.isArray(paperIngestion.queued_requests)
    ? paperIngestion.queued_requests
    : Array.isArray(paperIngestion.queuedRequests)
      ? paperIngestion.queuedRequests
      : [];
  const activeBatches = Array.isArray(paperIngestion.active_batches)
    ? paperIngestion.active_batches
    : Array.isArray(paperIngestion.activeBatches)
      ? paperIngestion.activeBatches
      : [];
  const paperOperations = Array.isArray(paperIngestion.paper_operations)
    ? paperIngestion.paper_operations
    : Array.isArray(paperIngestion.paperOperations)
      ? paperIngestion.paperOperations
      : [];
  const batchItems = Array.isArray(paperIngestion.batch_items)
    ? paperIngestion.batch_items
    : Array.isArray(paperIngestion.batchItems)
      ? paperIngestion.batchItems
      : [];
  const completedPapers = Array.isArray(paperIngestion.completed_papers)
    ? paperIngestion.completed_papers
    : Array.isArray(paperIngestion.completedPapers)
      ? paperIngestion.completedPapers
      : [];
  return JSON.stringify({
    stage: manifest?.current_stage ?? null,
    owner: manifest?.owner_agent ?? null,
    nextAction: manifest?.next_action ?? manifest?.resume_action ?? null,
    workflowStatus: manifest?.workflow_status ?? manifest?.status ?? null,
    blockingReason:
      manifest?.blocking_reason ??
      manifest?.last_blocking_reason ??
      paperIngestion.blocking_reason ??
      paperIngestion.waiting_reason ??
      null,
    graphPresenceStatus:
      paperIngestion.graph_presence_status ?? paperIngestion.graphPresenceStatus ?? null,
    graphPresenceExpected:
      paperIngestion.graph_presence_expected_papers ??
      paperIngestion.graphPresenceExpectedPapers ??
      null,
    graphPresencePresent:
      paperIngestion.graph_presence_present_papers ??
      paperIngestion.graphPresencePresentPapers ??
      null,
    graphPresenceMissing:
      paperIngestion.graph_presence_missing_papers ??
      paperIngestion.graphPresenceMissingPapers ??
      null,
    paperRuntimeStatus:
      paperIngestion.runtime_status ?? paperIngestion.runtimeStatus ?? null,
    queuedRequests: queuedRequests.map((request) => ({
      requestId: request?.request_id ?? request?.requestId ?? null,
      status: request?.status ?? null,
      wrapper: request?.wrapper ?? null,
      paperCount: request?.paper_count ?? request?.paperCount ?? null,
      attemptCount: request?.attempt_count ?? request?.attemptCount ?? null,
      lastRunId: request?.last_run_id ?? request?.lastRunId ?? null,
      validationStatus:
        request?.validation_status ?? request?.validationStatus ?? null,
    })),
    activeBatchCount: activeBatches.length,
    paperOperationCount: paperOperations.length,
    batchItemCount: batchItems.length,
    completedPaperCount: completedPapers.length,
    repairRequired:
      paperIngestion.repair_required ?? paperIngestion.repairRequired ?? null,
    retryStatus:
      paperIngestion.retry_status ?? paperIngestion.retryStatus ?? null,
  });
}

function normalizedRuntimeEntries(store) {
  return Array.isArray(store?.entries) ? store.entries : [];
}

function discussionRoundFingerprint(store) {
  const round = store?.currentRound;
  if (!round || typeof round !== "object") {
    return null;
  }
  return {
    roundId: round.roundId ?? null,
    stage: round.stage ?? null,
    status: round.status ?? null,
    packetFingerprint: round.packetFingerprint ?? null,
    aggregateStatus: round.aggregate?.status ?? null,
    attempts: Array.isArray(round.attempts)
      ? round.attempts.map((attempt) => ({
          reviewerRole: attempt?.reviewerRole ?? null,
          queueKey: attempt?.queueKey ?? null,
          runId: attempt?.runId ?? null,
          status: attempt?.status ?? null,
          completedAt: attempt?.completedAt ?? null,
          error: attempt?.error ?? null,
        }))
      : [],
  };
}

export async function workflowRuntimeProgressFingerprint(projectRoot) {
  const runtimeDir = path.join(projectRoot, ".openclaw-research");
  const [queue, sessions, handoffs, autoDiscussion, codeReview] = await Promise.all([
    readJsonIfExists(path.join(runtimeDir, "workflow-runtime-queue.json")),
    readJsonIfExists(path.join(runtimeDir, "workflow-runtime-sessions.json")),
    readJsonIfExists(path.join(runtimeDir, "workflow-handoff-intents.json")),
    readJsonIfExists(path.join(runtimeDir, "auto-mode-discussion-state.json")),
    readJsonIfExists(path.join(runtimeDir, "code-review-state.json")),
  ]);
  const queueEntries = normalizedRuntimeEntries(queue).map((entry) => ({
    queueKey: entry?.queueKey ?? null,
    kind: entry?.kind ?? null,
    ownerAgent: entry?.ownerAgent ?? entry?.owner_agent ?? entry?.agent ?? null,
    status: entry?.status ?? null,
    runId: entry?.runId ?? entry?.run_id ?? null,
    attemptCount: entry?.attemptCount ?? entry?.attempt_count ?? null,
    nextRetryAt: entry?.nextRetryAt ?? entry?.next_retry_at ?? null,
    lastError: entry?.lastError ?? entry?.last_error ?? entry?.error ?? null,
  }));
  const sessionEntries = normalizedRuntimeEntries(sessions).map((entry) => ({
    sessionKey: entry?.sessionKey ?? entry?.session_key ?? null,
    queueKey: entry?.queueKey ?? entry?.queue_key ?? null,
    kind: entry?.kind ?? null,
    ownerAgent: entry?.ownerAgent ?? entry?.owner_agent ?? entry?.agentId ?? null,
    status: entry?.status ?? null,
    runId: entry?.runId ?? entry?.run_id ?? null,
    lastFinishedAt: entry?.lastFinishedAt ?? entry?.last_finished_at ?? null,
    lastError: entry?.lastError ?? entry?.last_error ?? null,
  }));
  const handoffEntries = (Array.isArray(handoffs?.intents) ? handoffs.intents : []).map(
    (entry) => ({
      intentId: entry?.intentId ?? entry?.intent_id ?? entry?.id ?? null,
      stage: entry?.stageAfter ?? entry?.stage_after ?? entry?.stage ?? null,
      ownerAfter: entry?.ownerAfter ?? entry?.owner_after ?? entry?.toRole ?? null,
      status: entry?.status ?? null,
      queueKey: entry?.queueKey ?? entry?.queue_key ?? null,
      updatedAt: entry?.updatedAt ?? entry?.updated_at ?? null,
    })
  );
  return JSON.stringify({
    queueEntries,
    sessionEntries,
    handoffEntries,
    autoDiscussion: {
      updatedAt: autoDiscussion?.updatedAt ?? null,
      roundsStartedByFingerprint: autoDiscussion?.roundsStartedByFingerprint ?? null,
      currentRound: discussionRoundFingerprint(autoDiscussion),
    },
    codeReview: {
      updatedAt: codeReview?.updatedAt ?? null,
      currentRound: discussionRoundFingerprint(codeReview),
    },
  });
}

export function buildLiveConversationId(lane, date = new Date()) {
  const prefix = lane === "survey" ? "gcd-survey-live" : "gcd-research-live";
  const timestamp = date.toISOString().replaceAll(":", "").replace(/\.\d+Z$/, "Z");
  return `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function buildLiveAutoIteratorParams({
  projectRoot,
  workflowPolicy,
  mode = "test",
  queueMailbox = false,
}) {
  return {
    projectRoot,
    mode,
    queueMailbox,
    policy: workflowPolicy,
  };
}

function ensureSlashCommandText(text, fallback) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.startsWith("/") ? normalized : fallback;
}

const STAGE_COMMAND_ALLOWLIST = {
  setup: ["project-init", "research-pipeline", "resume-pipeline", "survey-pipeline"],
  survey_review: ["survey-pipeline", "review-phase"],
  graph_build: ["graph-build", "research-pipeline", "survey-graph-build"],
  frontier_mapping: ["frontier-mapping", "research-pipeline"],
  idea: ["idea-phase", "innovation-reflection", "research-pipeline"],
  plan: ["plan-research"],
  code: ["implement-experiment"],
  experiment: [
    "experiment-phase",
    "parallel-experiments",
    "run-experiment",
    "search-experiment",
    "monitor-experiment",
  ],
  analyze: ["analyze-results"],
  review: ["review-phase"],
  write: ["paper-phase"],
  submit: ["paper-phase"],
  revise: ["resume-pipeline"],
  done: ["resume-pipeline"],
};

function commandNameFromSlashText(text) {
  const normalized = String(text ?? "").trim();
  const match = normalized.match(/^\/([a-z][a-z0-9-]*)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function extractFirstSlashCommandName(text) {
  const match = String(text ?? "").match(/\/([a-z][a-z0-9-]*)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function stageAllowsCommand(stage, commandText) {
  const commandName = commandNameFromSlashText(commandText);
  if (!commandName) {
    return false;
  }
  const allowed = STAGE_COMMAND_ALLOWLIST[String(stage ?? "")] ?? [];
  return allowed.includes(commandName);
}

function slashCommandMentionCompatibleWithStage(stage, text) {
  const commandName = extractFirstSlashCommandName(text);
  if (!commandName) {
    return null;
  }
  const allowed = STAGE_COMMAND_ALLOWLIST[String(stage ?? "")] ?? [];
  return allowed.includes(commandName) ? `/${commandName}` : null;
}

function defaultStageCommand(params) {
  const stage = String(params.stage ?? "setup");
  const topicArg = JSON.stringify(params.topic);
  if (stage === "setup" || stage === "graph_build" || stage === "frontier_mapping") {
    return params.lane === "survey" ? `/survey-pipeline ${topicArg}` : `/research-pipeline ${topicArg}`;
  }
  if (stage === "survey_review") {
    return `/survey-pipeline ${topicArg}`;
  }
  if (stage === "idea") {
    return "/idea-phase";
  }
  if (stage === "plan") {
    return "/plan-research";
  }
  if (stage === "code") {
    return "/implement-experiment";
  }
  if (stage === "experiment") {
    return "/experiment-phase";
  }
  if (stage === "analyze") {
    return "/analyze-results";
  }
  if (stage === "write") {
    return "/paper-phase";
  }
  if (stage === "review") {
    return "/review-phase";
  }
  return params.lane === "survey" ? `/survey-pipeline ${topicArg}` : `/research-pipeline ${topicArg}`;
}

export function deriveStageCommand(params) {
  const stage = String(params.iterator?.stageAfter ?? params.manifest.current_stage ?? "setup");
  const actionCommand =
    params.iterator?.recommendedActions?.find(
      (entry) =>
        entry &&
        entry.kind === "drive_stage" &&
        entry.stage === stage &&
        typeof entry.command === "string" &&
        stageAllowsCommand(stage, entry.command)
    )?.command ?? null;
  if (actionCommand) {
    return actionCommand;
  }

  const iteratorSlash = [params.iterator?.nextAction, params.iterator?.resumeAction]
    .map((entry) => String(entry ?? "").trim())
    .find((entry) => stageAllowsCommand(stage, entry));
  if (iteratorSlash) {
    return iteratorSlash;
  }

  const iteratorMention = [params.iterator?.nextAction, params.iterator?.resumeAction]
    .map((entry) => slashCommandMentionCompatibleWithStage(stage, entry))
    .find(Boolean);
  if (iteratorMention) {
    return iteratorMention;
  }

  const manifestSlash = [params.manifest.next_action, params.manifest.resume_action]
    .map((entry) => String(entry ?? "").trim())
    .find((entry) => entry.startsWith("/") && stageAllowsCommand(stage, entry));
  if (manifestSlash) {
    return manifestSlash;
  }

  const manifestMention = [params.manifest.next_action, params.manifest.resume_action]
    .map((entry) => slashCommandMentionCompatibleWithStage(stage, entry))
    .find(Boolean);
  if (manifestMention) {
    return manifestMention;
  }

  return defaultStageCommand({ lane: params.lane, stage, topic: params.topic });
}

export function resolveLiveStageHandoffRevision(iterator) {
  const pending =
    iterator?.pendingHandoff === true &&
    iterator?.pendingHandoffPhase === "prepared";
  const executionId =
    typeof iterator?.pendingHandoffExecutionId === "string" &&
    iterator.pendingHandoffExecutionId.trim()
      ? iterator.pendingHandoffExecutionId.trim()
      : null;
  return pending ? executionId : null;
}

function buildStageExtraBody(params) {
  const lines = [
    `You are the current workflow owner for stage ${params.stage}.`,
    "Do the stage work for real. Do not stop at a plan or status update.",
    "Use the project-local workflow tools and artifacts as the source of truth.",
    `Topic: ${params.topic}.`,
  ];
  if (params.stage === "graph_build") {
    lines.push(
      "Complete topic-grounded literature retrieval and graph build.",
      "Find canonical papers for the topic, populate project-local source artifacts, and keep working until graph presence is ready or you can explain a concrete hard blocker.",
      "Do not stop at 'missing_sources' if retrieval has not been attempted yet.",
      "Use workflow tools and retrieval/graph tooling directly instead of asking for another slash command."
    );
  }
  if (params.stage === "frontier_mapping" || params.stage === "idea") {
    lines.push(
      "Use the current graph and literature packet to derive real ideation outputs, not a placeholder summary."
    );
  }
  if (params.stage === "plan") {
    lines.push(
      "Produce a real research plan with concrete experiment/design decisions, not a placeholder checklist."
    );
  }
  if (params.stage === "code" || params.stage === "experiment") {
    lines.push(
      "Execute real experiment work and keep durable experiment artifacts current.",
      "If the experiment workflow requires tuning or repair, follow through instead of returning a status-only note."
    );
  }
  if (params.stage === "analyze") {
    lines.push(
      "Produce real analysis outputs that can support the paper draft."
    );
  }
  if (params.stage === "write") {
    lines.push(
      "Generate real paper prose. Each section should contain multiple paragraphs with concrete claims, evidence, and transitions.",
      "Do not leave one-sentence placeholders or skeletal section stubs."
    );
  }
  if (params.stage === "review") {
    lines.push(
      "Review the actual draft, request revisions if needed, and only after the content is stable run citation calibration and final closeout.",
      "Citation calibration belongs after substantive content changes are done."
    );
  }
  if (params.lane === "survey") {
    lines.push(
      "This is a survey workflow. Focus on retrieval coverage, taxonomy stability, benchmark alignment, representative methods, and survey synthesis."
    );
  } else {
    lines.push(
      "This is an experiment workflow. Focus on research framing, experiment execution, analysis, and evidence-backed writing."
    );
  }
  return lines.join("\n");
}

export function buildLiveHandoffWorkflowTaskParams(params) {
  return {
    workflowRuntime: params.runtimeSubagent,
    requesterSessionKey: params.fromSessionKey,
    requesterChannel: params.transportContext.requesterChannel,
    fromRole: params.fromRole,
    toRole: params.owner,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    stage: params.stage,
    summary:
      `Complete workflow stage ${params.stage} for project ${params.projectId}. Use the command and workflow state below.`,
    command: params.command,
    requireMailboxAcknowledgement: true,
    extraBody: buildStageExtraBody({
      lane: params.lane,
      stage: params.stage,
      topic: params.topic,
    }),
    waitTimeoutMs: params.agentWaitTimeoutMs ?? 90_000,
    retryOnTimeout: true,
    enableSpawnFallback: true,
    autoModeActive: true,
  };
}

async function waitForProjectRoot(projectRoot, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (projectRoot && (await pathExists(path.join(projectRoot, "PROJECT_MANIFEST.json")))) {
      return true;
    }
    await sleep(1_000);
  }
  return false;
}

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function gatewayStartupErrorWithLogs(error, isolatedGateway) {
  const chunks = [errorMessage(error)];
  const stderr = isolatedGateway?.logs?.stderr;
  const stdout = isolatedGateway?.logs?.stdout;
  if (stderr) {
    chunks.push(`isolated gateway stderr tail:\n${stderr.slice(-4_000)}`);
  }
  if (stdout) {
    chunks.push(`isolated gateway stdout tail:\n${stdout.slice(-2_000)}`);
  }
  return new Error(chunks.join("\n\n"));
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function waitForProgress(params) {
  const startedAt = Date.now();
  let latestManifest = params.baselineManifest;
  const baselineFingerprint = workflowProgressFingerprint(params.baselineManifest);
  const baselineRuntimeFingerprint = await workflowRuntimeProgressFingerprint(
    params.projectRoot
  );
  while (Date.now() - startedAt < params.timeoutMs) {
    latestManifest = await readManifest(params.projectRoot);
    const currentStage = String(latestManifest.current_stage ?? "");
    const currentOwner = String(latestManifest.owner_agent ?? "");
    const pdfExists = await pathExists(
      path.join(params.projectRoot, "academic_writer", "paper", "main.pdf")
    );
    if (pdfExists && (currentStage === "submit" || currentStage === "done")) {
      return { progressed: true, manifest: latestManifest, reason: "terminal" };
    }
    const artifactTerminal = await detectStageScopedLivePaperArtifactTerminal({
      projectRoot: params.projectRoot,
      manifest: latestManifest,
      lane: params.lane,
    });
    if (artifactTerminal.terminal) {
      return {
        progressed: true,
        manifest: latestManifest,
        reason: artifactTerminal.reason,
        terminal: artifactTerminal,
      };
    }
    if (
      currentStage !== String(params.baselineManifest.current_stage ?? "") ||
      currentOwner !== String(params.baselineManifest.owner_agent ?? "")
    ) {
      return { progressed: true, manifest: latestManifest, reason: "stage_or_owner_changed" };
    }
    if (workflowProgressFingerprint(latestManifest) !== baselineFingerprint) {
      return { progressed: true, manifest: latestManifest, reason: "workflow_state_changed" };
    }
    const latestRuntimeFingerprint = await workflowRuntimeProgressFingerprint(
      params.projectRoot
    );
    if (latestRuntimeFingerprint !== baselineRuntimeFingerprint) {
      return { progressed: true, manifest: latestManifest, reason: "runtime_state_changed" };
    }
    await sleep(params.pollMs);
  }
  return { progressed: false, manifest: latestManifest, reason: "timeout" };
}

async function runLiveStageTurn(params) {
  const {
    runtimeSubagent,
    projectRoot,
    projectId,
    lane,
    manifest,
    iterator,
    topic,
    transportContext,
    previousRole,
    agentWaitTimeoutMs,
    stageTimeoutMs,
    progressPollMs,
  } = params;
  const owner = String(iterator.ownerAfter ?? manifest.owner_agent ?? "researcher");
  const stage = String(iterator.stageAfter ?? manifest.current_stage ?? "setup");
  const command = ensureSlashCommandText(
    deriveStageCommand({ lane, manifest, iterator, topic }),
    lane === "survey" ? `/survey-pipeline ${JSON.stringify(topic)}` : `/research-pipeline ${JSON.stringify(topic)}`
  );
  const fromRole = previousRole ?? "researcher";
  const fromSessionKey = transportContext.sessionKeyFor(fromRole);
  const sameOwner = owner === fromRole;
  const pendingHandoffExecutionId = resolveLiveStageHandoffRevision(iterator);

  if (sameOwner) {
    const started = await runtimeSubagent.run({
      sessionKey: transportContext.sessionKeyFor(owner),
      message: [
        `Complete workflow stage ${stage} for project ${projectId}.`,
        `Suggested command context: ${command}`,
        buildStageExtraBody({ lane, stage, topic }),
      ].join("\n"),
      projectRoot,
      projectId,
      workspaceDir: projectRoot,
      ownerAgent: owner,
      requesterSessionKey: fromSessionKey,
      messageChannel: transportContext.requesterChannel,
      lane: "nested",
      deliver: false,
      idempotencyKey: `live-stage:${projectId}:${stage}:${Date.now()}`,
      originatingChannel: transportContext.originatingChannel,
      originatingTo: transportContext.originatingTo,
      originatingAccountId: transportContext.accountId,
    });
    const waitPromise = runtimeSubagent.waitForRun
      ? runtimeSubagent
          .waitForRun({
            runId: started.runId,
            timeoutMs: agentWaitTimeoutMs ?? 120_000,
          })
          .catch((error) => ({ status: "error", error: errorMessage(error) }))
      : Promise.resolve({ status: "unavailable" });
    const progressPromise = waitForProgress({
      projectRoot,
      baselineManifest: manifest,
      lane,
      timeoutMs: stageTimeoutMs ?? 180_000,
      pollMs: progressPollMs ?? 5_000,
    });
    const first = await Promise.race([
      waitPromise.then((waited) => ({ type: "wait", waited })),
      progressPromise.then((progress) => ({ type: "progress", progress })),
    ]);
    const progress =
      first.type === "progress" && first.progress.progressed
        ? first.progress
        : await progressPromise;
    const waited =
      first.type === "wait"
        ? first.waited
        : { status: "skipped_after_progress" };
    return {
      owner,
      stage,
      command,
      intentId: null,
      progressed: progress.progressed,
      progressReason:
        progress.progressed
          ? progress.reason
          : waited?.status === "timeout"
            ? "agent_timeout"
            : progress.reason,
      manifest: progress.manifest,
    };
  }

  const created = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId,
    workflowLine: lane === "survey" ? "survey" : "experiment",
    stageBefore: String(manifest.current_stage ?? null),
    stageAfter: stage,
    ownerBefore: fromRole,
    ownerAfter: owner,
    fromSessionKey,
    executionId: pendingHandoffExecutionId,
    manifestRevision: pendingHandoffExecutionId,
    nextAction: command,
    deliveryPlan: {
      channels: ["native_runtime"],
      requireAck: true,
      maxAttemptsTotal: 1,
      maxAttemptsByChannel: { native_runtime: 1 },
      fallbackAfterMs: 0,
      staleClaimAfterMs: agentWaitTimeoutMs ?? 120_000,
      ackDeadlineAt: new Date(Date.now() + (agentWaitTimeoutMs ?? 120_000)).toISOString(),
    },
  });

  const delivered = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      nativeDispatch: async (intent) => {
        const dispatch = await handoffWorkflowTaskToAgent(buildLiveHandoffWorkflowTaskParams({
          runtimeSubagent,
          fromRole,
          owner,
          projectRoot,
          projectId,
          stage,
          command,
          fromSessionKey,
          transportContext,
          lane,
          topic,
          agentWaitTimeoutMs,
        }));
        return {
          ok: dispatch.dispatched,
          runId: dispatch.runId,
          sessionKey: dispatch.sessionKey,
          error: dispatch.error,
        };
      },
    },
  });

  if (!delivered.delivered) {
    const activation = await readLiveWorkflowActivation({
      projectRoot,
      projectId,
      stage,
      owner,
      manifest,
    });
    const shouldObserveLocalRuntime =
      activation.active ||
      delivered.reason === "delivery_attempt_budget_exhausted" ||
      delivered.reason === "handoff_ack_timeout";
    if (!shouldObserveLocalRuntime) {
      throw new Error(`Failed to dispatch live stage ${stage}: ${delivered.reason ?? "unknown"}`);
    }
    const progress = await waitForProgress({
      projectRoot,
      baselineManifest: manifest,
      lane,
      timeoutMs: stageTimeoutMs ?? 180_000,
      pollMs: progressPollMs ?? 5_000,
    });
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: delivered.intent.intentId,
      toStatus: progress.progressed ? "superseded" : "failed",
      summary: progress.progressed
        ? `${owner} made progress on ${stage} through local workflow runtime after live dispatch did not receive an acknowledgement.`
        : `${owner} did not make observable progress on ${stage} after live dispatch did not receive an acknowledgement.`,
      terminalReason: progress.progressed ? "local_runtime_superseded_live_dispatch" : "live_stage_timeout",
    }).catch(() => null);
    return {
      owner,
      stage,
      command,
      intentId: delivered.intent.intentId,
      progressed: progress.progressed,
      progressReason: progress.progressed
        ? progress.reason
        : activation.active
          ? `local_runtime_${activation.reason}`
          : delivered.reason ?? "dispatch_not_acknowledged",
      manifest: progress.manifest,
    };
  }

  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: delivered.intent.intentId,
    toStatus: "acknowledged",
    summary: `${owner} acknowledged ${stage} handoff.`,
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: delivered.intent.intentId,
    toStatus: "claimed",
    summary: `${owner} claimed ${stage} handoff.`,
    patch: {
      claimedAt: new Date().toISOString(),
      claimLeaseExpiresAt: new Date(Date.now() + (agentWaitTimeoutMs ?? 120_000)).toISOString(),
    },
  });

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    lane,
    timeoutMs: stageTimeoutMs ?? 180_000,
    pollMs: progressPollMs ?? 5_000,
  });

  if (progress.progressed) {
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: delivered.intent.intentId,
      toStatus: "completed",
      summary: `${owner} completed ${stage} handoff.`,
    });
  } else {
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: delivered.intent.intentId,
      toStatus: "failed",
      summary: `${owner} did not make observable progress on ${stage} within the timeout.`,
      terminalReason: "live_stage_timeout",
    });
  }

  return {
    owner,
    stage,
    command,
    intentId: delivered.intent.intentId,
    progressed: progress.progressed,
    progressReason: progress.reason,
    manifest: progress.manifest,
  };
}

async function runHarness(projectRoot, lane, options = {}) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const args = [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    lane,
  ];
  if (options.strictContent) {
    args.push("--strict-content");
  }
  const { stdout } = await execFileAsync(process.execPath, args);
  return JSON.parse(stdout);
}

async function runHarnessOrFailure(projectRoot, lane, options = {}) {
  try {
    return await runHarness(projectRoot, lane, options);
  } catch (error) {
    return {
      finalVerdict: "fail",
      strictContent: Boolean(options.strictContent),
      reportPath: null,
      scorecardPath: null,
      progressNarrativePath: null,
      progressChartPath: null,
      progressChartHtmlPath: null,
      runLedgerPath: null,
      runTrendPath: null,
      dashboardPath: null,
      benchmarkAdapterScorecardPath: null,
      domainEvaluatorContractPath: null,
      reviewerCalibrationPath: null,
      copyeditStyleAuditPath: null,
      experimentLeaseContractPath: null,
      platformProfilePath: null,
      checklistPath: null,
      timelinePath: null,
      qualityScore100: null,
      claimStrengthCap: "blocked",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function liveNoProgressFailureReason(params) {
  const blockingReason =
    params.turn?.manifest?.blocking_reason ??
    params.turn?.manifest?.orchestration_state?.blocking_reason ??
    params.manifest?.blocking_reason ??
    null;
  return [
    "live_no_progress",
    `stage=${params.turn?.stage ?? params.stage ?? "unknown"}`,
    `owner=${params.turn?.owner ?? params.owner ?? "unknown"}`,
    `reason=${params.turn?.progressReason ?? "unknown"}`,
    blockingReason ? `blocking=${String(blockingReason).slice(0, 500)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function liveBootstrapFailureReason(params) {
  return [
    params.phase ?? "live_bootstrap_failed",
    `command=${params.commandName ?? "unknown"}`,
    `project=${params.projectId ?? path.basename(params.projectRoot ?? "") ?? "unknown"}`,
    params.error ? `error=${errorMessage(params.error).slice(0, 800)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function failedLiveHarness(failureReason) {
  return {
    finalVerdict: "fail",
    strictContent: true,
    reportPath: null,
    scorecardPath: null,
    progressNarrativePath: null,
    progressChartPath: null,
    progressChartHtmlPath: null,
    runLedgerPath: null,
    runTrendPath: null,
    dashboardPath: null,
    benchmarkAdapterScorecardPath: null,
    domainEvaluatorContractPath: null,
    reviewerCalibrationPath: null,
    copyeditStyleAuditPath: null,
    experimentLeaseContractPath: null,
    platformProfilePath: null,
    checklistPath: null,
    timelinePath: null,
    qualityScore100: null,
    claimStrengthCap: "blocked",
    error: failureReason,
  };
}

function buildLiveBootstrapFailureResult(params) {
  const failureReason = liveBootstrapFailureReason(params);
  return {
    transport: params.bootstrapTransport,
    conversationId: params.conversationId,
    bootstrap: params.bootstrap ?? null,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    turns: [],
    harness: failedLiveHarness(failureReason),
    failureReason,
  };
}

export async function runAutoCommandEndToEndLive(params) {
  const { lane, topic, projectsRoot } = params;
  const commandName = lane === "survey" ? "auto-review" : "auto-research";
  const explicitProjectId = params.projectId ?? null;
  const bootstrapTransport = params.bootstrapTransport === "discord" ? "discord" : "local";
  const conversationId = params.conversationId ?? buildLiveConversationId(lane);
  const transportContext = buildWorkflowTransportContext({
    transport: bootstrapTransport,
    lane,
    conversationId,
    accountId: "default",
    userId: "owner",
  });
  const isolatedGatewayEnabled = params.isolatedGateway !== false;
  const gatewayStartupTimeoutMs = positiveNumber(
    params.gatewayStartupTimeoutMs,
    isolatedGatewayEnabled ? 180_000 : 30_000
  );
  const isolatedGateway =
    isolatedGatewayEnabled
      ? await startIsolatedGateway({
          projectsRoot,
          sourceConfigPath: params.sourceConfigPath,
          pluginConfigOverrides: params.pluginConfigOverrides,
          envOverrides: params.envOverrides,
          timeoutMs: Math.max(90_000, gatewayStartupTimeoutMs),
        })
      : null;
  const pluginConfig = await loadWorkflowHarnessPluginConfig({
    sourceConfigPath: isolatedGateway?.configPath ?? params.sourceConfigPath,
    projectsRoot: isolatedGateway?.projectsRoot ?? projectsRoot,
    overrides: params.pluginConfigOverrides,
  });
  const effectiveProjectsRoot = isolatedGateway?.projectsRoot ?? projectsRoot;
  const expectedProjectId =
    explicitProjectId ??
    (lane === "survey" ? `survey-${slugifyTopic(topic)}` : slugifyTopic(topic));
  const expectedProjectRoot = path.join(effectiveProjectsRoot, expectedProjectId);
  const bootstrapTimeoutMs = positiveNumber(params.bootstrapTimeoutMs, 180_000);
  const projectRootTimeoutMs = positiveNumber(params.projectRootTimeoutMs, 60_000);
  const workflowPolicy = getWorkflowGuardPolicy(pluginConfig);
  let gateway = null;
  try {
    try {
      gateway = await createGatewayRuntimeSubagent({
        profile: params.profile,
        url: isolatedGateway?.url ?? params.gatewayUrl,
        token: isolatedGateway?.token ?? params.gatewayToken,
        startupTimeoutMs: gatewayStartupTimeoutMs,
        originatingChannel: transportContext.originatingChannel,
        originatingTo: transportContext.originatingTo,
        originatingAccountId: transportContext.accountId,
      });
    } catch (error) {
      return buildLiveBootstrapFailureResult({
        phase: "live_gateway_connect_failed",
        bootstrapTransport,
        conversationId,
        commandName,
        projectId: expectedProjectId,
        projectRoot: expectedProjectRoot,
        error: gatewayStartupErrorWithLogs(error, isolatedGateway),
      });
    }
    const runtimeSubagent = gateway.runtimeSubagent;
    let bootstrap = null;
    try {
      const bootstrapPromise =
        bootstrapTransport === "local"
          ? dispatchWorkflowCommand({
              commandName,
              args: JSON.stringify(topic),
              projectsRoot: effectiveProjectsRoot,
              workspaceDir: effectiveProjectsRoot,
              sessionKey: transportContext.bootstrapSessionKey,
              channel: transportContext.channel,
              from: transportContext.from,
              to: transportContext.to,
              accountId: transportContext.accountId,
              contextExtras: {
                ...transportContext.commandContextExtras(),
                ...(explicitProjectId ? { projectId: explicitProjectId } : {}),
              },
              emitFallbackNote: true,
              runtimeSubagent,
              backgroundExecutionMode: "live",
              pluginConfig,
            })
          : (async () => {
              const started = await gateway.client.chatSend({
                sessionKey: transportContext.bootstrapSessionKey,
                message: `/${commandName} ${JSON.stringify(topic)}`,
                idempotencyKey: `native-bootstrap:${commandName}:${Date.now()}`,
                originatingChannel: transportContext.originatingChannel,
                originatingTo: transportContext.originatingTo,
                originatingAccountId: transportContext.accountId,
                timeoutMs: 30_000,
              });
              if (started?.status !== "started" || typeof started?.runId !== "string") {
                throw new Error(`Native slash bootstrap did not start correctly: ${JSON.stringify(started)}`);
              }
              const waited = await gateway.client.agentWait({
                runId: started.runId,
                timeoutMs: Math.min(bootstrapTimeoutMs, 120_000),
              });
              if (waited?.status === "error") {
                throw new Error(`Native slash bootstrap failed: ${waited.error ?? "agent.wait returned error"}`);
              }
              const slashHistory = await gateway.client.chatHistory({
                sessionKey: transportContext.bootstrapSessionKey,
                limit: 20,
                timeoutMs: 30_000,
              });
              const assistantTexts = extractAssistantTexts(slashHistory.messages);
              return {
                command: `/${commandName}`,
                args: JSON.stringify(topic),
                projectRoot: null,
                projectsRoot: effectiveProjectsRoot,
                sessionKey: transportContext.bootstrapSessionKey,
                result: {
                  text: assistantTexts.at(-1) ?? "",
                },
                backgroundRuns: [],
                fallbackTransport: "Executed through isolated native slash bootstrap.",
                runId: started.runId,
              };
            })();
      bootstrap = await withTimeout(
        bootstrapPromise,
        bootstrapTimeoutMs,
        `${commandName} live bootstrap`
      );
    } catch (error) {
      return buildLiveBootstrapFailureResult({
        phase: "live_bootstrap_failed",
        bootstrapTransport,
        conversationId,
        commandName,
        projectId: expectedProjectId,
        projectRoot: expectedProjectRoot,
        error,
      });
    }

    const projectRoot =
      deriveProjectRootFromBootstrap(bootstrap) ??
      expectedProjectRoot;
    if (!projectRoot) {
      return buildLiveBootstrapFailureResult({
        phase: "live_project_root_missing",
        bootstrapTransport,
        conversationId,
        commandName,
        bootstrap,
        projectId: expectedProjectId,
        projectRoot: expectedProjectRoot,
        error: new Error(`Failed to derive project root from ${commandName} bootstrap.`),
      });
    }
    const ready = await waitForProjectRoot(projectRoot, projectRootTimeoutMs);
    if (!ready) {
      return buildLiveBootstrapFailureResult({
        phase: "live_project_root_missing",
        bootstrapTransport,
        conversationId,
        commandName,
        bootstrap,
        projectId: explicitProjectId ?? path.basename(projectRoot),
        projectRoot,
        error: new Error(
          `Project root did not materialize within ${projectRootTimeoutMs}ms: ${projectRoot}`
        ),
      });
    }
    const actualProjectId = path.basename(projectRoot);

    const turns = [];
    let previousRole = "researcher";
    const maxIterations = params.maxIterations ?? 12;
    const maxNoProgressTurns = Math.max(
      1,
      Math.floor(
        typeof params.maxNoProgressTurns === "number" && Number.isFinite(params.maxNoProgressTurns)
          ? params.maxNoProgressTurns
          : 1
      )
    );
    let noProgressTurns = 0;
    for (let index = 0; index < maxIterations; index += 1) {
      const manifest = await readManifest(projectRoot);
      const pdfExists = await pathExists(
        path.join(projectRoot, "academic_writer", "paper", "main.pdf")
      );
      if (pdfExists && ["submit", "done"].includes(String(manifest.current_stage ?? ""))) {
        break;
      }
      const artifactTerminal = await detectStageScopedLivePaperArtifactTerminal({
        projectRoot,
        manifest,
        lane,
      });
      if (artifactTerminal.terminal) {
        const harness = await runHarnessOrFailure(projectRoot, lane, { strictContent: true });
        return {
          transport: bootstrapTransport,
          conversationId,
          bootstrap,
          projectId: actualProjectId,
          projectRoot,
          turns,
          harness,
          failureReason:
            harness.finalVerdict === "pass"
              ? null
              : "live_paper_artifact_ready_but_harness_failed",
          terminal: artifactTerminal,
        };
      }
      const revisionTerminal = await detectLiveSubstantiveRevisionTerminal({
        projectRoot,
        manifest,
        lane,
      });
      if (revisionTerminal.terminal) {
        const harness = await runHarnessOrFailure(projectRoot, lane, { strictContent: true });
        return {
          transport: bootstrapTransport,
          conversationId,
          bootstrap,
          projectId: actualProjectId,
          projectRoot,
          turns,
          harness,
          failureReason: revisionTerminal.reason,
          terminal: revisionTerminal,
        };
      }
      const iterator = await runWorkflowAutoIterator(buildLiveAutoIteratorParams({
        projectRoot,
        workflowPolicy,
      }));
      const manifestAfterIterator = await readManifest(projectRoot);
      const iteratorChangedStageOrOwner =
        String(manifestAfterIterator.current_stage ?? "") !==
          String(manifest.current_stage ?? "") ||
        String(manifestAfterIterator.owner_agent ?? "") !==
          String(manifest.owner_agent ?? "");
      if (iteratorChangedStageOrOwner) {
        const turn = {
          owner: String(
            manifestAfterIterator.owner_agent ??
              iterator.ownerAfter ??
              previousRole ??
              "researcher"
          ),
          stage: String(
            manifestAfterIterator.current_stage ??
              iterator.stageAfter ??
              manifest.current_stage ??
              "setup"
          ),
          command: null,
          intentId: null,
          progressed: true,
          progressReason: "auto_iterator_state_change",
          manifest: manifestAfterIterator,
        };
        turns.push(turn);
        previousRole = turn.owner;
        noProgressTurns = 0;
        if (["submit", "done"].includes(String(turn.manifest.current_stage ?? ""))) {
          break;
        }
        continue;
      }
      const turn = await runLiveStageTurn({
        runtimeSubagent,
        projectRoot,
        projectId: actualProjectId,
        lane,
        topic,
        manifest,
        iterator,
        transportContext,
        previousRole,
        agentWaitTimeoutMs: params.agentWaitTimeoutMs ?? null,
        stageTimeoutMs: params.stageTimeoutMs ?? null,
        progressPollMs: params.progressPollMs ?? null,
      });
      turns.push(turn);
      previousRole = turn.owner;
      if (turn.progressed) {
        noProgressTurns = 0;
      } else {
        noProgressTurns += 1;
        if (noProgressTurns >= maxNoProgressTurns) {
          const failureReason = liveNoProgressFailureReason({
            turn,
            manifest,
          });
          const harness = await runHarnessOrFailure(projectRoot, lane, { strictContent: true });
          return {
            transport: bootstrapTransport,
            conversationId,
            bootstrap,
            projectId: actualProjectId,
            projectRoot,
            turns,
            harness,
            failureReason,
          };
        }
      }
      if (["submit", "done"].includes(String(turn.manifest.current_stage ?? ""))) {
        break;
      }
    }

    const harness = await runHarness(projectRoot, lane, { strictContent: true });
    return {
      transport: bootstrapTransport,
      conversationId,
      bootstrap,
      projectId: actualProjectId,
      projectRoot,
      turns,
      harness,
    };
  } finally {
    await gateway?.stop?.();
    await isolatedGateway?.stop?.();
  }
}
