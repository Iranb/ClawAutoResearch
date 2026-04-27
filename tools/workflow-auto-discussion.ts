import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DispatchableWorkflowRole } from "./agent-task-dispatch";
import {
  aggregateWorkflowPanelDiscussionRound,
  buildWorkflowPanelDiscussionPrompt,
  createWorkflowPanelDiscussionRound,
  parseWorkflowPanelDiscussionResult,
  type WorkflowPanelDiscussionAttempt,
  type WorkflowPanelDiscussionResult,
} from "./workflow-panel-discussion";

export type AutoModeDiscussionReviewerRole =
  | "researcher"
  | "analyzer"
  | "reviewer";

export type AutoModeDiscussionAssessment =
  | "resolved"
  | "needs_changes"
  | "blocked";

export type AutoModeDiscussionResult = {
  reviewerRole: AutoModeDiscussionReviewerRole;
  riskAssessment: AutoModeDiscussionAssessment;
  confidence: number;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string | null;
  createdAt: string;
  runId: string | null;
  rawText: string | null;
};

export type AutoModeDiscussionAttempt = {
  reviewerRole: AutoModeDiscussionReviewerRole;
  sessionKey: string;
  runId: string | null;
  queueKey?: string | null;
  status: "pending" | "completed" | "error";
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: AutoModeDiscussionResult | null;
};

export type AutoModeDiscussionAggregate = {
  status: "reviewing" | "resolved" | "needs_changes" | "blocked";
  quorum: number;
  reviewCount: number;
  averageConfidence: number | null;
  assessmentCounts: Record<string, number>;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string;
};

export type AutoModeDiscussionRound = {
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  roundId: string;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  status: "reviewing" | "resolved" | "needs_changes" | "blocked";
  launchedAt: string;
  updatedAt: string;
  attempts: AutoModeDiscussionAttempt[];
  aggregate: AutoModeDiscussionAggregate | null;
};

export type AutoModeDiscussionStore = {
  schemaVersion: 1;
  updatedAt: string;
  roundsStartedByFingerprint: Record<string, number>;
  currentRound: AutoModeDiscussionRound | null;
};

export type AutoModeDiscussionPacket = {
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  riskFingerprint: string;
  ownerAfter: string | null;
  nextAction: string | null;
  blockingReason: string | null;
  riskReasons: string[];
  missingStageSignals: string[];
  artifactChecks: Array<{
    path: string;
    exists: boolean;
  }>;
  citationIntegrity: Record<string, unknown>;
  writingContract: Record<string, unknown>;
  innovationReflection: Record<string, unknown>;
  paperIngestion: Record<string, unknown>;
  gates: Record<string, unknown>;
  summary: string[];
};

const PANEL_ROLES: AutoModeDiscussionReviewerRole[] = [
  "researcher",
  "analyzer",
  "reviewer",
];

const DEFAULT_DISCUSSION_ARTIFACTS = [
  "PROJECT_MANIFEST.json",
  "TRACK_REGISTRY.json",
  "CLAIM_POLICY.md",
  "graph/GRAPH_BUILD_REPORT.md",
  "graph/GRAPH_PRESENCE_CHECK.json",
  "analyzer/CLAIM_EVIDENCE_MATRIX.md",
  "analyzer/QUALITY_AUDIT.md",
  "reviewer/REVIEW_REPORT.md",
  "reviewer/CITATION_VERIFICATION.md",
  "academic_writer/PAPER_PLAN.md",
  "academic_writer/WRITING_SIGNALS.md",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function clampConfidence(value: unknown): number {
  const numeric = readNumber(value);
  if (numeric == null) {
    return 0;
  }
  return Math.max(0, Math.min(10, numeric));
}

function normalizeAssessment(value: unknown): AutoModeDiscussionAssessment {
  const assessment = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    assessment === "resolved" ||
    assessment === "needs_changes" ||
    assessment === "blocked"
  ) {
    return assessment;
  }
  return "blocked";
}

function normalizeOwner(value: unknown): DispatchableWorkflowRole | null {
  const owner = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    owner === "researcher" ||
    owner === "orchestrator" ||
    owner === "coder" ||
    owner === "analyzer" ||
    owner === "academic_writer" ||
    owner === "reviewer" ||
    owner === "cross-reviewer"
  ) {
    return owner;
  }
  return null;
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

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
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

async function writeJsonEnsured(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeAggregate(aggregate: AutoModeDiscussionAggregate): string {
  if (aggregate.status === "resolved") {
    return `Auto risk discussion resolved the current risk with avg confidence ${aggregate.averageConfidence?.toFixed(2) ?? "n/a"}.`;
  }
  if (aggregate.status === "blocked") {
    return `Auto risk discussion still sees blockers after ${aggregate.reviewCount} review(s).`;
  }
  if (aggregate.status === "needs_changes") {
    return `Auto risk discussion recommends another remediation round after ${aggregate.reviewCount} review(s).`;
  }
  return "Auto risk discussion is still waiting for enough reviewer results.";
}

export function getAutoModeDiscussionStorePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "auto-mode-discussion-state.json");
}

export function getAutoModeDiscussionPacketDir(projectRoot: string): string {
  return path.join(projectRoot, "reviewer", "auto-mode-discussion");
}

export function buildAutoModeDiscussionFingerprint(params: {
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  riskReasons: string[];
  missingStageSignals?: string[];
  blockingReason?: string | null;
}): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        stage: params.stage ?? null,
        riskLevel: params.riskLevel,
        riskReasons: [...params.riskReasons].sort(),
        missingStageSignals: [...(params.missingStageSignals ?? [])].sort(),
        blockingReason: params.blockingReason ?? null,
      })
    )
    .digest("hex");
}

export async function readAutoModeDiscussionStore(
  projectRoot: string
): Promise<AutoModeDiscussionStore> {
  const record = asRecord(
    await readJsonIfExists<Record<string, unknown>>(getAutoModeDiscussionStorePath(projectRoot))
  );
  const currentRoundRecord = asRecord(record.currentRound);
  const attempts = Array.isArray(currentRoundRecord.attempts)
    ? currentRoundRecord.attempts
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const attempt = entry as Record<string, unknown>;
          const attemptStatus: AutoModeDiscussionAttempt["status"] = (() => {
            const status = readString(attempt.status);
            if (status === "completed" || status === "error") {
              return status;
            }
            return "pending";
          })();
          return {
            reviewerRole:
              (readString(attempt.reviewerRole) as AutoModeDiscussionReviewerRole | null) ??
              "reviewer",
            sessionKey: readString(attempt.sessionKey) ?? "",
            runId: readString(attempt.runId),
            queueKey: readString(attempt.queueKey),
            status: attemptStatus,
            launchedAt: readString(attempt.launchedAt) ?? new Date(0).toISOString(),
            completedAt: readString(attempt.completedAt),
            error: readString(attempt.error),
            result:
              attempt.result && typeof attempt.result === "object" && !Array.isArray(attempt.result)
                ? parseAutoModeDiscussionResult(
                    JSON.stringify(attempt.result),
                    (readString(
                      (attempt.result as Record<string, unknown>).reviewerRole
                    ) as AutoModeDiscussionReviewerRole | null) ??
                      ((readString(attempt.reviewerRole) as AutoModeDiscussionReviewerRole | null) ??
                        "reviewer")
                  )
                : null,
          };
        })
    : [];
  const currentRoundStatus: AutoModeDiscussionRound["status"] = (() => {
    const status = readString(currentRoundRecord.status);
    if (
      status === "resolved" ||
      status === "needs_changes" ||
      status === "blocked"
    ) {
      return status;
    }
    return "reviewing";
  })();
  const roundsStartedByFingerprint = asRecord(record.roundsStartedByFingerprint);
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
  const currentRound: AutoModeDiscussionRound | null =
    readString(currentRoundRecord.roundId) && readString(currentRoundRecord.packetFingerprint)
      ? {
          stage: readString(currentRoundRecord.stage),
          riskLevel:
            (readString(currentRoundRecord.riskLevel) as
              | AutoModeDiscussionRound["riskLevel"]
              | null) ?? "caution",
          roundId: readString(currentRoundRecord.roundId) ?? randomUUID(),
          packetPath: readString(currentRoundRecord.packetPath) ?? "",
          packetJsonPath: readString(currentRoundRecord.packetJsonPath) ?? "",
          packetFingerprint: readString(currentRoundRecord.packetFingerprint) ?? "",
          status: currentRoundStatus,
          launchedAt:
            readString(currentRoundRecord.launchedAt) ?? new Date(0).toISOString(),
          updatedAt:
            readString(currentRoundRecord.updatedAt) ?? new Date(0).toISOString(),
          attempts,
          aggregate:
            currentRoundRecord.aggregate &&
            typeof currentRoundRecord.aggregate === "object" &&
            !Array.isArray(currentRoundRecord.aggregate)
              ? (currentRoundRecord.aggregate as AutoModeDiscussionAggregate)
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

export async function saveAutoModeDiscussionStore(
  projectRoot: string,
  store: AutoModeDiscussionStore
): Promise<void> {
  await writeJsonEnsured(getAutoModeDiscussionStorePath(projectRoot), {
    schemaVersion: 1,
    updatedAt: store.updatedAt,
    roundsStartedByFingerprint: store.roundsStartedByFingerprint,
    currentRound: store.currentRound,
  });
}

export async function materializeAutoModeDiscussionPacket(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  riskReasons: string[];
  missingStageSignals: string[];
  ownerAfter: string | null;
  nextAction: string | null;
  blockingReason: string | null;
}): Promise<{
  packet: AutoModeDiscussionPacket;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = asRecord(
    await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))
  );
  const citationIntegrity = asRecord(manifest.citation_integrity);
  const writingContract = asRecord(manifest.writing_contract);
  const innovationReflection = asRecord(manifest.innovation_reflection);
  const paperIngestion = asRecord(manifest.paper_ingestion);
  const gates = asRecord(manifest.gates);
  const artifactChecks = await Promise.all(
    DEFAULT_DISCUSSION_ARTIFACTS.map(async (relativePath) => ({
      path: relativePath,
      exists: await pathExists(path.join(projectRoot, relativePath)),
    }))
  );
  const riskFingerprint = buildAutoModeDiscussionFingerprint({
    stage: params.stage,
    riskLevel: params.riskLevel,
    riskReasons: params.riskReasons,
    missingStageSignals: params.missingStageSignals,
    blockingReason: params.blockingReason,
  });
  const packet: AutoModeDiscussionPacket = {
    projectId: params.projectId,
    projectRoot,
    stage: params.stage,
    riskLevel: params.riskLevel,
    riskFingerprint,
    ownerAfter: params.ownerAfter,
    nextAction: params.nextAction,
    blockingReason: params.blockingReason,
    riskReasons: params.riskReasons,
    missingStageSignals: params.missingStageSignals,
    artifactChecks,
    citationIntegrity,
    writingContract,
    innovationReflection,
    paperIngestion,
    gates,
    summary: [
      `Project ID: ${params.projectId ?? path.basename(projectRoot)}`,
      `Stage: ${params.stage ?? "unknown"}`,
      `Risk level: ${params.riskLevel}`,
      `Current owner: ${params.ownerAfter ?? "unknown"}`,
      `Next action: ${params.nextAction ?? "unset"}`,
      `Blocking reason: ${params.blockingReason ?? "none"}`,
      `Artifact coverage: ${artifactChecks.filter((entry) => entry.exists).length}/${artifactChecks.length}`,
    ],
  };
  const packetDir = getAutoModeDiscussionPacketDir(projectRoot);
  const packetPath = path.join(packetDir, "AUTO_MODE_DISCUSSION_PACKET.md");
  const packetJsonPath = path.join(packetDir, "AUTO_MODE_DISCUSSION_PACKET.json");
  const markdown = [
    "# Auto Mode Risk Discussion Packet",
    "",
    ...packet.summary.map((line) => `- ${line}`),
    "",
    "## Risk Reasons",
    ...packet.riskReasons.map((line) => `- ${line}`),
    "",
    "## Missing Stage Signals",
    ...(packet.missingStageSignals.length > 0
      ? packet.missingStageSignals.map((line) => `- ${line}`)
      : ["- none"]),
    "",
    "## Artifact Checks",
    ...artifactChecks.map((entry) => `- [${entry.exists ? "x" : " "}] ${entry.path}`),
    "",
    "## Citation Integrity",
    "```json",
    JSON.stringify(citationIntegrity, null, 2),
    "```",
    "",
    "## Writing Contract",
    "```json",
    JSON.stringify(writingContract, null, 2),
    "```",
    "",
    "## Innovation Reflection",
    "```json",
    JSON.stringify(innovationReflection, null, 2),
    "```",
    "",
    "## Paper Ingestion",
    "```json",
    JSON.stringify(paperIngestion, null, 2),
    "```",
    "",
    "## Gates",
    "```json",
    JSON.stringify(gates, null, 2),
    "```",
  ].join("\n");
  await fs.mkdir(packetDir, { recursive: true });
  await fs.writeFile(packetPath, `${markdown}\n`, "utf8");
  await writeJsonEnsured(packetJsonPath, packet);
  return {
    packet,
    packetPath,
    packetJsonPath,
    packetFingerprint: riskFingerprint,
  };
}

export function buildAutoModeDiscussionPrompt(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  reviewerRole: AutoModeDiscussionReviewerRole;
  packetPath: string;
  packetJsonPath: string;
}): string {
  return buildWorkflowPanelDiscussionPrompt({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    reviewerRole: params.reviewerRole,
    packetPath: params.packetPath,
    packetJsonPath: params.packetJsonPath,
    policy: {
      discussionId: "auto-mode-discussion",
      topic: "Decide whether the current auto mode can continue after one bounded remediation pass",
      stage: params.stage,
      participants: defaultAutoModeDiscussionPanel(),
      maxRounds: 2,
      quorum: defaultAutoModeDiscussionPanel().length,
      resolvedDecisions: ["resolved"],
      blockedDecisions: ["blocked"],
      packetArtifacts: [],
      promptInstructions:
        `Focus on whether the project can stay in the current auto mode after one more bounded remediation cycle. Current risk level: ${params.riskLevel}. Review only the packet and the referenced artifacts.`,
      summary: [],
      context: {},
    },
  });
}

function buildLocalAutoModeDiscussionResult(params: {
  packet: AutoModeDiscussionPacket;
  reviewerRole: AutoModeDiscussionReviewerRole;
  runId: string;
  reason: string;
  createdAt: string;
}): AutoModeDiscussionResult {
  const needsBoundedRemediation =
    params.packet.riskLevel === "severe" ||
    params.packet.missingStageSignals.length > 0;
  const blockers = needsBoundedRemediation
    ? uniqueStrings([
        ...params.packet.missingStageSignals,
        ...params.packet.riskReasons,
      ]).slice(0, 8)
    : [];
  const actionItems = needsBoundedRemediation
    ? (blockers.length > 0
        ? blockers.map((item) => `Resolve before continuing auto mode: ${item}`)
        : ["Run one bounded remediation pass before continuing auto mode."])
    : [
        "Continue the current handoff with bounded monitoring; provider capacity prevented live panel review.",
      ];
  return {
    reviewerRole: params.reviewerRole,
    riskAssessment: needsBoundedRemediation ? "needs_changes" : "resolved",
    confidence: needsBoundedRemediation ? 6.2 : 7.4,
    recommendedOwner:
      normalizeOwner(params.packet.ownerAfter) ??
      (needsBoundedRemediation ? "researcher" : null),
    actionItems,
    blockers,
    summary: needsBoundedRemediation
      ? `Local ${params.reviewerRole} auto-mode risk review requested one bounded remediation pass because hard risk signals remain.`
      : `Local ${params.reviewerRole} auto-mode risk review allowed the current handoff to continue because the risk packet is caution-level and required stage signals are present.`,
    createdAt: params.createdAt,
    runId: params.runId,
    rawText: JSON.stringify({
      source: "local_static_auto_mode_discussion",
      reason: params.reason,
      reviewerRole: params.reviewerRole,
      riskAssessment: needsBoundedRemediation ? "needs_changes" : "resolved",
      riskLevel: params.packet.riskLevel,
      missingStageSignalCount: params.packet.missingStageSignals.length,
      blockerCount: blockers.length,
    }),
  };
}

export function buildLocalAutoModeDiscussionAttempts(params: {
  packet: AutoModeDiscussionPacket;
  packetFingerprint: string;
  participants?: AutoModeDiscussionReviewerRole[];
  reason: string;
  createdAt?: string | null;
}): AutoModeDiscussionAttempt[] {
  const createdAt = readString(params.createdAt) ?? new Date().toISOString();
  const participants = params.participants ?? defaultAutoModeDiscussionPanel();
  return participants.map((reviewerRole) => {
    const runId = `local-auto-discussion:${params.packetFingerprint}:${reviewerRole}`;
    return {
      reviewerRole,
      sessionKey: `local:auto-mode-discussion:${reviewerRole}`,
      runId,
      queueKey: null,
      status: "completed",
      launchedAt: createdAt,
      completedAt: createdAt,
      error: null,
      result: buildLocalAutoModeDiscussionResult({
        packet: params.packet,
        reviewerRole,
        runId,
        reason: params.reason,
        createdAt,
      }),
    };
  });
}

export function parseAutoModeDiscussionResult(
  text: string,
  reviewerRole: AutoModeDiscussionReviewerRole
): AutoModeDiscussionResult {
  let normalizedText = text;
  try {
    const jsonText = extractJsonObject(text) ?? text;
    const record = asRecord(JSON.parse(jsonText));
    if (
      readString(record.decision) == null &&
      readString(record.riskAssessment) != null
    ) {
      normalizedText = JSON.stringify({
        ...record,
        decision: readString(record.riskAssessment),
      });
    }
  } catch {
    // Fall back to the generic parser on the original text.
  }
  const parsed = parseWorkflowPanelDiscussionResult(normalizedText, reviewerRole);
  return {
    reviewerRole,
    riskAssessment: normalizeAssessment(parsed.decision),
    confidence: parsed.confidence,
    recommendedOwner: parsed.recommendedOwner,
    actionItems: parsed.actionItems,
    blockers: parsed.blockers,
    summary: parsed.summary,
    createdAt: parsed.createdAt,
    runId: parsed.runId,
    rawText: parsed.rawText,
  };
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

export function aggregateAutoModeDiscussionRound(
  round: AutoModeDiscussionRound,
  quorum: number
): AutoModeDiscussionAggregate {
  const genericRound = {
    discussionId: "auto-mode-discussion",
    topic: "Auto mode risk discussion",
    stage: round.stage,
    roundId: round.roundId,
    packetPath: round.packetPath,
    packetJsonPath: round.packetJsonPath,
    packetFingerprint: round.packetFingerprint,
    status: round.status,
    participants: defaultAutoModeDiscussionPanel(),
    maxRounds: 2,
    launchedAt: round.launchedAt,
    updatedAt: round.updatedAt,
    attempts: round.attempts.map(
      (attempt) =>
        ({
          ...attempt,
          result: attempt.result
            ? ({
                reviewerRole: attempt.result.reviewerRole,
                decision: attempt.result.riskAssessment,
                confidence: attempt.result.confidence,
                recommendedOwner: attempt.result.recommendedOwner,
                actionItems: attempt.result.actionItems,
                blockers: attempt.result.blockers,
                summary: attempt.result.summary,
                createdAt: attempt.result.createdAt,
                runId: attempt.result.runId,
                rawText: attempt.result.rawText,
              } satisfies WorkflowPanelDiscussionResult)
            : null,
        } satisfies WorkflowPanelDiscussionAttempt)
    ),
    aggregate: null,
  };
  const aggregate = aggregateWorkflowPanelDiscussionRound({
    round: genericRound,
    policy: {
      discussionId: "auto-mode-discussion",
      topic: "Auto mode risk discussion",
      stage: round.stage,
      participants: defaultAutoModeDiscussionPanel(),
      maxRounds: 2,
      quorum,
      resolvedDecisions: ["resolved"],
      blockedDecisions: ["blocked"],
      packetArtifacts: [],
      promptInstructions: null,
      summary: [],
      context: {},
    },
  });
  return {
    status: aggregate.status,
    quorum: aggregate.quorum,
    reviewCount: aggregate.reviewCount,
    averageConfidence: aggregate.averageConfidence,
    assessmentCounts: aggregate.decisionCounts,
    recommendedOwner: aggregate.recommendedOwner,
    actionItems: aggregate.actionItems,
    blockers: aggregate.blockers,
    summary: aggregate.summary,
  };
}

export function createAutoModeDiscussionRound(params: {
  stage: string | null;
  riskLevel: "stable" | "caution" | "severe";
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  attempts: AutoModeDiscussionAttempt[];
}): AutoModeDiscussionRound {
  const round = createWorkflowPanelDiscussionRound({
    policy: {
      discussionId: "auto-mode-discussion",
      topic: "Auto mode risk discussion",
      stage: params.stage,
      participants: defaultAutoModeDiscussionPanel(),
      maxRounds: 2,
      quorum: defaultAutoModeDiscussionPanel().length,
      resolvedDecisions: ["resolved"],
      blockedDecisions: ["blocked"],
      packetArtifacts: [],
      promptInstructions: null,
      summary: [],
      context: {},
    },
    packetPath: params.packetPath,
    packetJsonPath: params.packetJsonPath,
    packetFingerprint: params.packetFingerprint,
    attempts: params.attempts.map(
      (attempt) =>
        ({
          ...attempt,
          result: attempt.result
            ? ({
                reviewerRole: attempt.result.reviewerRole,
                decision: attempt.result.riskAssessment,
                confidence: attempt.result.confidence,
                recommendedOwner: attempt.result.recommendedOwner,
                actionItems: attempt.result.actionItems,
                blockers: attempt.result.blockers,
                summary: attempt.result.summary,
                createdAt: attempt.result.createdAt,
                runId: attempt.result.runId,
                rawText: attempt.result.rawText,
              } satisfies WorkflowPanelDiscussionResult)
            : null,
        } satisfies WorkflowPanelDiscussionAttempt)
    ),
  });
  return {
    stage: round.stage,
    riskLevel: params.riskLevel,
    roundId: round.roundId,
    packetPath: round.packetPath,
    packetJsonPath: round.packetJsonPath,
    packetFingerprint: round.packetFingerprint,
    status: round.status,
    launchedAt: round.launchedAt,
    updatedAt: round.updatedAt,
    attempts: params.attempts,
    aggregate: null,
  };
}

export function defaultAutoModeDiscussionPanel(): AutoModeDiscussionReviewerRole[] {
  return [...PANEL_ROLES];
}
