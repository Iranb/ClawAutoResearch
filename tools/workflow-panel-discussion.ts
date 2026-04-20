import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { readJsonIfExists } from "./workflow-guard-core/fs";
import { asRecord, asStringArray, normalizeStage, pickNumber, pickString } from "./workflow-guard-core/coercion";
import type { DispatchableWorkflowRole } from "./agent-task-dispatch";

export type WorkflowPanelParticipantRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

export type WorkflowPanelDecisionStatus =
  | "reviewing"
  | "resolved"
  | "needs_changes"
  | "blocked";

export type WorkflowPanelDiscussionDecision =
  | "resolved"
  | "needs_changes"
  | "blocked"
  | "pass"
  | "revise"
  | "rollback"
  | "approved"
  | "rejected";

export type WorkflowPanelDiscussionPolicy = {
  discussionId: string;
  topic: string;
  stage: string | null;
  participants: WorkflowPanelParticipantRole[];
  maxRounds: number;
  quorum: number;
  resolvedDecisions: string[];
  blockedDecisions: string[];
  packetArtifacts: string[];
  promptInstructions: string | null;
  summary: string[];
  context: Record<string, unknown>;
};

export type WorkflowPanelDiscussionPacket = {
  discussionId: string;
  topic: string;
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  participants: WorkflowPanelParticipantRole[];
  maxRounds: number;
  quorum: number;
  resolvedDecisions: string[];
  blockedDecisions: string[];
  artifactChecks: Array<{
    path: string;
    exists: boolean;
  }>;
  promptInstructions: string | null;
  context: Record<string, unknown>;
  summary: string[];
};

export type WorkflowPanelDiscussionResult = {
  reviewerRole: WorkflowPanelParticipantRole;
  decision: string;
  confidence: number;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string | null;
  createdAt: string;
  runId: string | null;
  rawText: string | null;
};

export type WorkflowPanelDiscussionAttempt = {
  reviewerRole: WorkflowPanelParticipantRole;
  sessionKey: string;
  runId: string | null;
  queueKey?: string | null;
  status: "pending" | "completed" | "error";
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: WorkflowPanelDiscussionResult | null;
};

export type WorkflowPanelDiscussionAggregate = {
  status: WorkflowPanelDecisionStatus;
  quorum: number;
  reviewCount: number;
  averageConfidence: number | null;
  decisionCounts: Record<string, number>;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string;
};

export type WorkflowPanelDiscussionRound = {
  discussionId: string;
  topic: string;
  stage: string | null;
  roundId: string;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  status: WorkflowPanelDecisionStatus;
  participants: WorkflowPanelParticipantRole[];
  maxRounds: number;
  launchedAt: string;
  updatedAt: string;
  attempts: WorkflowPanelDiscussionAttempt[];
  aggregate: WorkflowPanelDiscussionAggregate | null;
};

export type WorkflowPanelDiscussionStore = {
  schemaVersion: 1;
  updatedAt: string;
  roundsStartedByFingerprint: Record<string, number>;
  currentRound: WorkflowPanelDiscussionRound | null;
};

const DEFAULT_PARTICIPANTS: WorkflowPanelParticipantRole[] = [
  "researcher",
  "reviewer",
  "analyzer",
];

const DEFAULT_PACKET_ARTIFACTS = ["PROJECT_MANIFEST.json", "TRACK_REGISTRY.json"];
const DEFAULT_RESOLVED_DECISIONS = ["resolved", "pass", "approved"];
const DEFAULT_BLOCKED_DECISIONS = ["blocked", "block", "rollback", "rejected"];

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      collectStrings(entry)
    );
  }
  return [];
}

function normalizeParticipantRole(value: unknown): WorkflowPanelParticipantRole | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "researcher" ||
    normalized === "planner" ||
    normalized === "orchestrator" ||
    normalized === "coder" ||
    normalized === "analyzer" ||
    normalized === "academic_writer" ||
    normalized === "reviewer" ||
    normalized === "cross-reviewer"
  ) {
    return normalized;
  }
  return null;
}

function normalizeOwner(value: unknown): DispatchableWorkflowRole | null {
  const normalized = normalizeParticipantRole(value);
  if (
    normalized === "researcher" ||
    normalized === "orchestrator" ||
    normalized === "coder" ||
    normalized === "analyzer" ||
    normalized === "academic_writer" ||
    normalized === "reviewer" ||
    normalized === "cross-reviewer"
  ) {
    return normalized;
  }
  return null;
}

function clampConfidence(value: unknown): number {
  const numeric = readNumber(value);
  if (numeric == null) {
    return 0;
  }
  return Math.max(0, Math.min(10, numeric));
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return null;
}

function mostCommonOwner(
  owners: Array<DispatchableWorkflowRole | null>
): DispatchableWorkflowRole | null {
  const counts = new Map<DispatchableWorkflowRole, number>();
  for (const owner of owners) {
    if (!owner) {
      continue;
    }
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function summarizeAggregate(aggregate: WorkflowPanelDiscussionAggregate): string {
  if (aggregate.status === "resolved") {
    return `Panel discussion resolved after ${aggregate.reviewCount} review(s).`;
  }
  if (aggregate.status === "blocked") {
    return `Panel discussion remains blocked after ${aggregate.reviewCount} review(s).`;
  }
  if (aggregate.status === "needs_changes") {
    return `Panel discussion recommends another bounded remediation round after ${aggregate.reviewCount} review(s).`;
  }
  return "Panel discussion is still waiting for reviewer quorum.";
}

export function normalizeWorkflowPanelDiscussionPolicy(
  value: unknown
): WorkflowPanelDiscussionPolicy {
  const record = asRecord(value) ?? {};
  const participants = uniqueStrings([
    ...asStringArray(record.participants),
    ...asStringArray(record.reviewerRoles ?? record.reviewer_roles),
  ])
    .map((entry) => normalizeParticipantRole(entry))
    .filter((entry): entry is WorkflowPanelParticipantRole => Boolean(entry));
  const normalizedParticipants =
    participants.length > 0 ? participants : [...DEFAULT_PARTICIPANTS];
  const maxRounds = Math.max(
    1,
    Math.floor(
      pickNumber(record, ["maxRounds", "max_rounds"]) ?? 2
    )
  );
  const quorum = Math.max(
    1,
    Math.min(
      normalizedParticipants.length,
      Math.floor(pickNumber(record, ["quorum"]) ?? normalizedParticipants.length)
    )
  );
  return {
    discussionId:
      pickString(record, ["discussionId", "discussion_id"]) ?? "generic-panel-discussion",
    topic: pickString(record, ["topic"]) ?? "generic workflow discussion",
    stage: normalizeStage(record.stage),
    participants: normalizedParticipants,
    maxRounds,
    quorum,
    resolvedDecisions:
      asStringArray(record.resolvedDecisions ?? record.resolved_decisions).length > 0
        ? asStringArray(record.resolvedDecisions ?? record.resolved_decisions).map((entry) =>
            entry.trim().toLowerCase()
          )
        : [...DEFAULT_RESOLVED_DECISIONS],
    blockedDecisions:
      asStringArray(record.blockedDecisions ?? record.blocked_decisions).length > 0
        ? asStringArray(record.blockedDecisions ?? record.blocked_decisions).map((entry) =>
            entry.trim().toLowerCase()
          )
        : [...DEFAULT_BLOCKED_DECISIONS],
    packetArtifacts: uniqueStrings([
      ...DEFAULT_PACKET_ARTIFACTS,
      ...asStringArray(record.packetArtifacts ?? record.packet_artifacts),
      ...asStringArray(record.artifactPaths ?? record.artifact_paths),
    ]),
    promptInstructions:
      pickString(record, ["promptInstructions", "prompt_instructions"]) ?? null,
    summary: uniqueStrings(
      asStringArray(record.summary).length > 0
        ? asStringArray(record.summary)
        : collectStrings(record.context)
    ).slice(0, 12),
    context: asRecord(record.context) ?? {},
  };
}

export function getWorkflowPanelDiscussionStorePath(
  projectRoot: string,
  discussionId: string
): string {
  return path.join(
    projectRoot,
    ".openclaw-research",
    "panel-discussions",
    `${discussionId}.json`
  );
}

export function getWorkflowPanelDiscussionPacketDir(
  projectRoot: string,
  discussionId: string
): string {
  return path.join(projectRoot, "reviewer", "panel-discussions", discussionId);
}

export function buildWorkflowPanelDiscussionFingerprint(params: {
  discussionId: string;
  topic: string;
  stage: string | null;
  summary: string[];
  participants: WorkflowPanelParticipantRole[];
  context?: Record<string, unknown>;
}): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        discussionId: params.discussionId,
        topic: params.topic,
        stage: params.stage ?? null,
        summary: [...params.summary].sort(),
        participants: [...params.participants].sort(),
        context: params.context ?? {},
      })
    )
    .digest("hex");
}

export async function readWorkflowPanelDiscussionStore(
  projectRoot: string,
  discussionId: string
): Promise<WorkflowPanelDiscussionStore> {
  const record = asRecord(
    await readJsonIfExists<Record<string, unknown>>(
      getWorkflowPanelDiscussionStorePath(projectRoot, discussionId)
    )
  ) ?? {};
  const currentRoundRecord = asRecord(record.currentRound) ?? {};
  const attempts = Array.isArray(currentRoundRecord.attempts)
    ? currentRoundRecord.attempts
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const attempt = entry as Record<string, unknown>;
          const participant =
            normalizeParticipantRole(attempt.reviewerRole ?? attempt.participantRole) ??
            "reviewer";
          const status = readString(attempt.status);
          return {
            reviewerRole: participant,
            sessionKey: readString(attempt.sessionKey) ?? "",
            runId: readString(attempt.runId),
            queueKey: readString(attempt.queueKey),
            status:
              status === "completed" || status === "error" ? status : "pending",
            launchedAt: readString(attempt.launchedAt) ?? new Date(0).toISOString(),
            completedAt: readString(attempt.completedAt),
            error: readString(attempt.error),
            result:
              attempt.result && typeof attempt.result === "object" && !Array.isArray(attempt.result)
                ? (() => {
                    const parsed = parseWorkflowPanelDiscussionResult(
                      JSON.stringify(attempt.result),
                      participant
                    );
                    const resultRecord = attempt.result as Record<string, unknown>;
                    return {
                      ...parsed,
                      createdAt:
                        readString(resultRecord.createdAt) ?? parsed.createdAt,
                      runId: readString(resultRecord.runId) ?? parsed.runId,
                      rawText: readString(resultRecord.rawText) ?? parsed.rawText,
                    };
                  })()
                : null,
          } satisfies WorkflowPanelDiscussionAttempt;
        })
    : [];
  const roundsStartedByFingerprint = asRecord(record.roundsStartedByFingerprint) ?? {};
  const normalizedRoundsStartedByFingerprint = Object.fromEntries(
    Object.entries(roundsStartedByFingerprint)
      .filter(([key]) => Boolean(key))
      .map(([key, value]) => [
        key,
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, Math.floor(value))
          : 0,
      ])
  );
  const currentRound: WorkflowPanelDiscussionRound | null =
    readString(currentRoundRecord.roundId) && readString(currentRoundRecord.packetFingerprint)
      ? {
          discussionId:
            pickString(currentRoundRecord, ["discussionId", "discussion_id"]) ?? discussionId,
          topic: pickString(currentRoundRecord, ["topic"]) ?? "generic workflow discussion",
          stage: normalizeStage(currentRoundRecord.stage),
          roundId: readString(currentRoundRecord.roundId) ?? randomUUID(),
          packetPath: readString(currentRoundRecord.packetPath) ?? "",
          packetJsonPath: readString(currentRoundRecord.packetJsonPath) ?? "",
          packetFingerprint: readString(currentRoundRecord.packetFingerprint) ?? "",
          status:
            (normalizeStage(currentRoundRecord.status) as WorkflowPanelDecisionStatus | null) ??
            "reviewing",
          participants:
            asStringArray(currentRoundRecord.participants)
              .map((entry) => normalizeParticipantRole(entry))
              .filter((entry): entry is WorkflowPanelParticipantRole => Boolean(entry)),
          maxRounds: Math.max(
            1,
            Math.floor(pickNumber(currentRoundRecord, ["maxRounds", "max_rounds"]) ?? 2)
          ),
          launchedAt: readString(currentRoundRecord.launchedAt) ?? new Date(0).toISOString(),
          updatedAt: readString(currentRoundRecord.updatedAt) ?? new Date(0).toISOString(),
          attempts,
          aggregate:
            currentRoundRecord.aggregate &&
            typeof currentRoundRecord.aggregate === "object" &&
            !Array.isArray(currentRoundRecord.aggregate)
              ? (currentRoundRecord.aggregate as WorkflowPanelDiscussionAggregate)
              : null,
        }
      : null;
  return {
    schemaVersion: 1,
    updatedAt: readString(record.updatedAt) ?? new Date(0).toISOString(),
    roundsStartedByFingerprint: normalizedRoundsStartedByFingerprint,
    currentRound,
  };
}

export async function saveWorkflowPanelDiscussionStore(
  projectRoot: string,
  discussionId: string,
  store: WorkflowPanelDiscussionStore
): Promise<void> {
  const targetPath = getWorkflowPanelDiscussionStorePath(projectRoot, discussionId);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function materializeWorkflowPanelDiscussionPacket(params: {
  projectRoot: string;
  projectId: string | null;
  policy: WorkflowPanelDiscussionPolicy;
}): Promise<{
  packet: WorkflowPanelDiscussionPacket;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const artifactChecks = await Promise.all(
    params.policy.packetArtifacts.map(async (relativePath) => ({
      path: relativePath,
      exists: await fs
        .access(path.join(projectRoot, relativePath))
        .then(() => true)
        .catch(() => false),
    }))
  );
  const packet: WorkflowPanelDiscussionPacket = {
    discussionId: params.policy.discussionId,
    topic: params.policy.topic,
    projectId: params.projectId,
    projectRoot,
    stage: params.policy.stage,
    participants: params.policy.participants,
    maxRounds: params.policy.maxRounds,
    quorum: params.policy.quorum,
    resolvedDecisions: params.policy.resolvedDecisions,
    blockedDecisions: params.policy.blockedDecisions,
    artifactChecks,
    promptInstructions: params.policy.promptInstructions,
    context: params.policy.context,
    summary:
      params.policy.summary.length > 0
        ? params.policy.summary
        : [
            `Topic: ${params.policy.topic}`,
            `Participants: ${params.policy.participants.join(", ")}`,
            `Stage: ${params.policy.stage ?? "unknown"}`,
          ],
  };
  const packetDir = getWorkflowPanelDiscussionPacketDir(projectRoot, params.policy.discussionId);
  const packetPath = path.join(packetDir, "PANEL_DISCUSSION_PACKET.md");
  const packetJsonPath = path.join(packetDir, "PANEL_DISCUSSION_PACKET.json");
  const packetFingerprint = buildWorkflowPanelDiscussionFingerprint({
    discussionId: params.policy.discussionId,
    topic: params.policy.topic,
    stage: params.policy.stage,
    summary: packet.summary,
    participants: params.policy.participants,
    context: params.policy.context,
  });
  const markdown = [
    "# Workflow Panel Discussion Packet",
    "",
    `- discussion_id: ${packet.discussionId}`,
    `- topic: ${packet.topic}`,
    `- project: ${packet.projectId ?? "unknown"}`,
    `- project_root: ${packet.projectRoot}`,
    `- stage: ${packet.stage ?? "unknown"}`,
    `- participants: ${packet.participants.join(", ")}`,
    `- max_rounds: ${packet.maxRounds}`,
    `- quorum: ${packet.quorum}`,
    "",
    "## Summary",
    ...packet.summary.map((line) => `- ${line}`),
    "",
    packet.promptInstructions ? "## Prompt Instructions" : null,
    packet.promptInstructions ?? null,
    "",
    "## Artifact Checks",
    ...packet.artifactChecks.map((entry) => `- [${entry.exists ? "x" : " "}] ${entry.path}`),
    "",
    "## Context",
    "```json",
    JSON.stringify(packet.context, null, 2),
    "```",
    "",
    "## Packet",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n");
  await fs.mkdir(packetDir, { recursive: true });
  await fs.writeFile(packetPath, `${markdown}\n`, "utf8");
  await fs.writeFile(packetJsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return {
    packet,
    packetPath,
    packetJsonPath,
    packetFingerprint,
  };
}

export function createWorkflowPanelDiscussionRound(params: {
  policy: WorkflowPanelDiscussionPolicy;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  attempts?: WorkflowPanelDiscussionAttempt[];
}): WorkflowPanelDiscussionRound {
  const now = nowIso();
  return {
    discussionId: params.policy.discussionId,
    topic: params.policy.topic,
    stage: params.policy.stage,
    roundId: randomUUID(),
    packetPath: params.packetPath,
    packetJsonPath: params.packetJsonPath,
    packetFingerprint: params.packetFingerprint,
    status: "reviewing",
    participants: [...params.policy.participants],
    maxRounds: params.policy.maxRounds,
    launchedAt: now,
    updatedAt: now,
    attempts:
      params.attempts ??
      params.policy.participants.map((reviewerRole) => ({
        reviewerRole,
        sessionKey: "",
        runId: null,
        status: "pending" as const,
        launchedAt: now,
        completedAt: null,
        error: null,
        result: null,
      })),
    aggregate: null,
  };
}

export function buildWorkflowPanelDiscussionPrompt(params: {
  projectRoot: string;
  projectId: string | null;
  reviewerRole: WorkflowPanelParticipantRole;
  policy: WorkflowPanelDiscussionPolicy;
  packetPath: string;
  packetJsonPath: string;
}): string {
  const allowedDecisions = uniqueStrings([
    ...params.policy.resolvedDecisions,
    ...params.policy.blockedDecisions,
    "needs_changes",
  ]);
  return [
    `Workflow panel discussion request for ${params.reviewerRole}.`,
    `Project: ${params.projectId ?? "unknown"} (${params.projectRoot})`,
    `Discussion ID: ${params.policy.discussionId}`,
    `Topic: ${params.policy.topic}`,
    `Stage: ${params.policy.stage ?? "unknown"}`,
    `Packet: ${params.packetPath}`,
    `Packet JSON: ${params.packetJsonPath}`,
    "",
    params.policy.promptInstructions ??
      "Review only the packet and referenced artifacts, then return one structured decision with bounded action items.",
    "",
    "Return JSON only:",
    "```json",
    JSON.stringify(
      {
        decision: allowedDecisions.join(" | "),
        confidence: 0,
        recommendedOwner:
          "researcher | orchestrator | coder | analyzer | academic_writer | reviewer | cross-reviewer | null",
        actionItems: [],
        blockers: [],
        summary: "one concise paragraph",
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

export function parseWorkflowPanelDiscussionResult(
  rawText: string,
  reviewerRole: WorkflowPanelParticipantRole
): WorkflowPanelDiscussionResult {
  const now = nowIso();
  try {
    const jsonText = extractJsonObject(rawText) ?? rawText;
    const record = asRecord(JSON.parse(jsonText)) ?? {};
    return {
      reviewerRole,
      decision:
        pickString(record, ["decision"])?.toLowerCase() ?? "blocked",
      confidence: clampConfidence(record.confidence),
      recommendedOwner: normalizeOwner(record.recommendedOwner),
      actionItems: uniqueStrings(collectStrings(record.actionItems)),
      blockers: uniqueStrings(collectStrings(record.blockers)),
      summary: readString(record.summary),
      createdAt: now,
      runId: readString(record.runId),
      rawText,
    };
  } catch (error) {
    return {
      reviewerRole,
      decision: "blocked",
      confidence: 0,
      recommendedOwner: "researcher",
      actionItems: [],
      blockers: [
        `Failed to parse structured panel discussion JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      summary: "Reviewer did not return valid structured JSON.",
      createdAt: now,
      runId: null,
      rawText,
    };
  }
}

export function aggregateWorkflowPanelDiscussionRound(params: {
  round: WorkflowPanelDiscussionRound;
  policy: WorkflowPanelDiscussionPolicy;
}): WorkflowPanelDiscussionAggregate {
  const completed = params.round.attempts
    .map((attempt) => attempt.result)
    .filter((result): result is WorkflowPanelDiscussionResult => Boolean(result));
  const reviewCount = completed.length;
  const averageConfidence =
    reviewCount > 0
      ? completed.reduce((sum, result) => sum + result.confidence, 0) / reviewCount
      : null;
  const decisionCounts = completed.reduce<Record<string, number>>((acc, result) => {
    acc[result.decision] = (acc[result.decision] ?? 0) + 1;
    return acc;
  }, {});
  const resolvedVotes = completed.filter((result) =>
    params.policy.resolvedDecisions.includes(result.decision)
  ).length;
  const blockedVotes = completed.filter((result) =>
    params.policy.blockedDecisions.includes(result.decision)
  ).length;
  const status: WorkflowPanelDecisionStatus =
    resolvedVotes >= Math.max(1, params.policy.quorum) && blockedVotes === 0
      ? "resolved"
      : blockedVotes > 0 && reviewCount >= Math.max(1, params.policy.quorum)
        ? "blocked"
        : reviewCount >= params.round.participants.length ||
            reviewCount >= Math.max(1, params.policy.quorum)
          ? "needs_changes"
          : "reviewing";
  const aggregate: WorkflowPanelDiscussionAggregate = {
    status,
    quorum: Math.max(1, params.policy.quorum),
    reviewCount,
    averageConfidence,
    decisionCounts,
    recommendedOwner:
      mostCommonOwner(completed.map((result) => result.recommendedOwner)) ??
      "researcher",
    actionItems: uniqueStrings(completed.flatMap((result) => result.actionItems)),
    blockers: uniqueStrings(completed.flatMap((result) => result.blockers)),
    summary: "",
  };
  aggregate.summary = summarizeAggregate(aggregate);
  return aggregate;
}

export async function materializeWorkflowPanelDiscussionState(params: {
  projectRoot: string;
  projectId: string | null;
  policyLike: unknown;
}): Promise<{
  policy: WorkflowPanelDiscussionPolicy;
  packet: WorkflowPanelDiscussionPacket;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  store: WorkflowPanelDiscussionStore;
  currentRound: WorkflowPanelDiscussionRound;
  createdRound: boolean;
}> {
  const policy = normalizeWorkflowPanelDiscussionPolicy(params.policyLike);
  const packet = await materializeWorkflowPanelDiscussionPacket({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    policy,
  });
  const store = await readWorkflowPanelDiscussionStore(
    params.projectRoot,
    policy.discussionId
  );
  const current = store.currentRound;
  const createdRound =
    !current || current.packetFingerprint !== packet.packetFingerprint;
  const nextRound = createdRound
    ? createWorkflowPanelDiscussionRound({
        policy,
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
        packetFingerprint: packet.packetFingerprint,
      })
    : current;
  const nextStore: WorkflowPanelDiscussionStore = {
    schemaVersion: 1,
    updatedAt: nowIso(),
    roundsStartedByFingerprint: {
      ...store.roundsStartedByFingerprint,
      [packet.packetFingerprint]: createdRound
        ? (store.roundsStartedByFingerprint[packet.packetFingerprint] ?? 0) + 1
        : store.roundsStartedByFingerprint[packet.packetFingerprint] ?? 0,
    },
    currentRound: nextRound,
  };
  await saveWorkflowPanelDiscussionStore(
    params.projectRoot,
    policy.discussionId,
    nextStore
  );
  return {
    policy,
    packet: packet.packet,
    packetPath: packet.packetPath,
    packetJsonPath: packet.packetJsonPath,
    packetFingerprint: packet.packetFingerprint,
    store: nextStore,
    currentRound: nextRound,
    createdRound,
  };
}
