import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_WORKFLOW_AUTO_GATE,
  type WorkflowAutoGateConfig,
  type WorkflowAutoGateMode,
  type WorkflowAutoMode,
  resolveWorkflowAutoGateModeForStage,
  resolveWorkflowAutoGateStageKey,
} from "./workflow-auto-mode";
import {
  buildWorkflowPanelDiscussionPrompt,
  createWorkflowPanelDiscussionRound,
  parseWorkflowPanelDiscussionResult,
  type WorkflowPanelDiscussionAttempt,
  type WorkflowPanelDiscussionResult,
} from "./workflow-panel-discussion";

export type GateReviewReviewerRole = "analyzer" | "reviewer" | "cross-reviewer";

export type GateReviewVerdict = "pass" | "revise" | "rollback" | "block";

export type GateReviewResult = {
  reviewerRole: GateReviewReviewerRole;
  verdict: GateReviewVerdict;
  overallScore: number;
  dimensionScores: Record<string, number>;
  criticalBlockers: string[];
  majorIssues: string[];
  suggestedRollbackStage: string | null;
  reviewedArtifacts: string[];
  summary: string | null;
  createdAt: string;
  runId: string | null;
  rawText: string | null;
};

export type GateReviewAttempt = {
  reviewerRole: GateReviewReviewerRole;
  sessionKey: string;
  runId: string | null;
  status: "pending" | "completed" | "error";
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: GateReviewResult | null;
};

export type GateReviewAggregate = {
  approved: boolean;
  status: "reviewing" | "approved" | "rejected";
  thresholdAvg: number;
  thresholdMinSingle: number;
  quorum: number;
  reviewCount: number;
  averageScore: number | null;
  minScore: number | null;
  blockerCount: number;
  verdictCounts: Record<string, number>;
  suggestedRollbackStage: string | null;
  summary: string;
};

export type GateReviewRound = {
  gateId: string;
  stage: string | null;
  roundId: string;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  status: "reviewing" | "approved" | "rejected";
  launchedAt: string;
  updatedAt: string;
  attempts: GateReviewAttempt[];
  aggregate: GateReviewAggregate | null;
};

export type GateReviewStore = {
  schemaVersion: 1;
  updatedAt: string;
  roundsStarted: number;
  currentRound: GateReviewRound | null;
};

export type GateReviewPacket = {
  gateId: string;
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  manifestUpdatedAt: string | null;
  artifactChecks: Array<{
    path: string;
    exists: boolean;
  }>;
  citationIntegrity: Record<string, unknown>;
  writingContract: Record<string, unknown>;
  innovationReflection: Record<string, unknown>;
  gates: Record<string, unknown>;
  summary: string[];
};

const PANEL_ROLES: GateReviewReviewerRole[] = ["reviewer", "cross-reviewer", "analyzer"];

const DEFAULT_PACKET_ARTIFACTS = [
  "graph/GRAPH_BUILD_REPORT.md",
  "graph/GRAPH_PRESENCE_CHECK.json",
  "analyzer/NARRATIVE_REPORT.md",
  "analyzer/CLAIM_EVIDENCE_MATRIX.md",
  "analyzer/QUALITY_AUDIT.md",
  "reviewer/REVIEW_REPORT.md",
  "reviewer/CITATION_VERIFICATION.md",
  "academic_writer/PAPER_PLAN.md",
  "academic_writer/STORYLINE_SKETCH.md",
  "academic_writer/WRITING_SIGNALS.md",
  "academic_writer/paper/main.pdf",
  "academic_writer/THEORY_APPENDIX_PLAN.md",
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

function clampScore(value: unknown): number {
  const numeric = readNumber(value);
  if (numeric == null) {
    return 0;
  }
  return Math.max(0, Math.min(10, numeric));
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

async function findPrefixedFile(dirPath: string, prefix: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const match = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .sort((left, right) => right.name.localeCompare(left.name))[0];
    return match ? path.join(path.basename(dirPath), match.name) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
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

function normalizeDimensionScores(value: unknown): Record<string, number> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, score]) => [key, clampScore(score)])
      .filter(([, score]) => Number.isFinite(score))
  );
}

function normalizeVerdict(value: unknown): GateReviewVerdict {
  const verdict = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (verdict === "pass" || verdict === "revise" || verdict === "rollback" || verdict === "block") {
    return verdict;
  }
  return "block";
}

function thresholdForStage(
  stage: string | null,
  config: WorkflowAutoGateConfig
) {
  if (stage === "review") {
    return config.thresholds.review_to_write;
  }
  if (stage === "write") {
    return config.thresholds.write_to_submit;
  }
  return config.thresholds.submit_to_done;
}

function summarizeAggregate(aggregate: GateReviewAggregate): string {
  if (aggregate.status === "approved") {
    return `Auto gate review approved with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.reviewCount} review(s).`;
  }
  if (aggregate.status === "rejected") {
    return `Auto gate review rejected with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.blockerCount} blocker(s).`;
  }
  return "Auto gate review is still waiting for enough reviewer results.";
}

export function getGateReviewStorePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "gate-review-state.json");
}

export function getGateReviewPacketDir(projectRoot: string, gateId: string): string {
  return path.join(projectRoot, "reviewer", "gates", gateId);
}

export async function readGateReviewStore(projectRoot: string): Promise<GateReviewStore> {
  const record = asRecord(
    await readJsonIfExists<Record<string, unknown>>(getGateReviewStorePath(projectRoot))
  );
  const currentRoundRecord = asRecord(record.currentRound);
  const attempts = Array.isArray(currentRoundRecord.attempts)
    ? currentRoundRecord.attempts
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const attempt = entry as Record<string, unknown>;
          const attemptStatus: GateReviewAttempt["status"] = (() => {
            const status = readString(attempt.status);
            if (status === "completed" || status === "error") {
              return status;
            }
            return "pending";
          })();
          return {
            reviewerRole:
              (readString(attempt.reviewerRole) as GateReviewReviewerRole | null) ?? "reviewer",
            sessionKey: readString(attempt.sessionKey) ?? "",
            runId: readString(attempt.runId),
            status: attemptStatus,
            launchedAt: readString(attempt.launchedAt) ?? new Date(0).toISOString(),
            completedAt: readString(attempt.completedAt),
            error: readString(attempt.error),
            result:
              attempt.result && typeof attempt.result === "object" && !Array.isArray(attempt.result)
                ? parseGateReviewResult(
                    JSON.stringify(attempt.result),
                    (readString((attempt.result as Record<string, unknown>).reviewerRole) as GateReviewReviewerRole | null) ??
                      ((readString(attempt.reviewerRole) as GateReviewReviewerRole | null) ?? "reviewer")
                  )
                : null,
          };
        })
    : [];
  const currentRoundStatus: GateReviewRound["status"] = (() => {
    const status = readString(currentRoundRecord.status);
    if (status === "approved" || status === "rejected") {
      return status;
    }
    return "reviewing";
  })();
  const currentRound: GateReviewRound | null =
    readString(currentRoundRecord.gateId) && readString(currentRoundRecord.roundId)
      ? {
          gateId: readString(currentRoundRecord.gateId) ?? "GATE-5",
          stage: readString(currentRoundRecord.stage),
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
              ? (currentRoundRecord.aggregate as GateReviewAggregate)
              : null,
        }
      : null;
  return {
    schemaVersion: 1,
    updatedAt: readString(record.updatedAt) ?? new Date(0).toISOString(),
    roundsStarted:
      typeof record.roundsStarted === "number" && Number.isFinite(record.roundsStarted)
        ? Math.max(0, Math.floor(record.roundsStarted))
        : 0,
    currentRound,
  };
}

export async function saveGateReviewStore(
  projectRoot: string,
  store: GateReviewStore
): Promise<void> {
  await writeJsonEnsured(getGateReviewStorePath(projectRoot), {
    schemaVersion: 1,
    updatedAt: store.updatedAt,
    roundsStarted: store.roundsStarted,
    currentRound: store.currentRound,
  });
}

export function buildGateReviewFingerprint(packet: GateReviewPacket): string {
  const normalizedPacket: GateReviewPacket = {
    ...packet,
    // Runtime migration touches manifest.updated_at; gate rounds should stay stable
    // unless the gate-relevant packet contents actually changed.
    manifestUpdatedAt: null,
  };
  return createHash("sha1")
    .update(JSON.stringify(normalizedPacket))
    .digest("hex");
}

export async function materializeGateReviewPacket(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  gateId: string;
}): Promise<{
  packet: GateReviewPacket;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  reviewedArtifacts: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = asRecord(
    await readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json"))
  );
  const citationIntegrity = asRecord(manifest.citation_integrity);
  const writingContract = asRecord(manifest.writing_contract);
  const innovationReflection = asRecord(manifest.innovation_reflection);
  const gates = asRecord(manifest.gates);
  const externalReviewPath = await findPrefixedFile(path.join(projectRoot, "reviewer"), "external_review_");
  const rebuttalPath = await findPrefixedFile(path.join(projectRoot, "reviewer"), "rebuttal_");
  const artifactCandidates = [...DEFAULT_PACKET_ARTIFACTS];
  if (externalReviewPath) {
    artifactCandidates.push(externalReviewPath);
  }
  if (rebuttalPath) {
    artifactCandidates.push(rebuttalPath);
  }
  const reviewedArtifacts = Array.from(new Set(artifactCandidates));
  const artifactChecks = await Promise.all(
    reviewedArtifacts.map(async (relativePath) => ({
      path: relativePath,
      exists: await pathExists(path.join(projectRoot, relativePath)),
    }))
  );
  const packet: GateReviewPacket = {
    gateId: params.gateId,
    projectId: params.projectId,
    projectRoot,
    stage: params.stage,
    manifestUpdatedAt: readString(manifest.updated_at),
    artifactChecks,
    citationIntegrity,
    writingContract,
    innovationReflection,
    gates,
    summary: [
      `Project ID: ${params.projectId ?? path.basename(projectRoot)}`,
      `Stage: ${params.stage ?? "unknown"}`,
      `Gate: ${params.gateId}`,
      `Citation verification status: ${readString(citationIntegrity.verification_status) ?? "unset"}`,
      `Writing template status: ${readString(writingContract.template_status) ?? "unset"}`,
      `Innovation reflection status: ${readString(innovationReflection.status) ?? "unset"}`,
      `Artifact coverage: ${artifactChecks.filter((entry) => entry.exists).length}/${artifactChecks.length}`,
    ],
  };
  const packetDir = getGateReviewPacketDir(projectRoot, params.gateId);
  const packetPath = path.join(packetDir, "AUTO_GATE_PACKET.md");
  const packetJsonPath = path.join(packetDir, "AUTO_GATE_PACKET.json");
  const packetFingerprint = buildGateReviewFingerprint(packet);
  const markdown = [
    `# Auto Gate Review Packet`,
    "",
    ...packet.summary.map((line) => `- ${line}`),
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
  ].join("\n");
  await fs.mkdir(packetDir, { recursive: true });
  await fs.writeFile(packetPath, `${markdown}\n`, "utf8");
  await writeJsonEnsured(packetJsonPath, {
    ...packet,
    packetFingerprint,
  });
  return {
    packet,
    packetPath,
    packetJsonPath,
    packetFingerprint,
    reviewedArtifacts,
  };
}

export function buildAutoGateReviewPrompt(params: {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  gateId: string;
  reviewerRole: GateReviewReviewerRole;
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
      discussionId: `gate-review-${params.gateId.toLowerCase()}`,
      topic: `Evaluate whether ${params.gateId} should pass`,
      stage: params.stage,
      participants: defaultGateReviewPanel(),
      maxRounds: 2,
      quorum: defaultGateReviewPanel().length,
      resolvedDecisions: ["pass", "approved"],
      blockedDecisions: ["block", "rollback", "rejected"],
      packetArtifacts: [],
      promptInstructions:
        "Review only the packet and referenced project artifacts. Do not expand scope beyond gate evaluation. Also score quality, evidence, clarity, citation, and publishability in the JSON response.",
      summary: [],
      context: {},
    },
  });
}

function maybeAssistantLikeMessage(message: Record<string, unknown>): boolean {
  const role = readString(message.role)?.toLowerCase();
  const type = readString(message.type)?.toLowerCase();
  return role === "assistant" || type === "assistant" || type === "message";
}

export function extractLatestAssistantText(messages: unknown[]): string | null {
  for (const entry of [...messages].reverse()) {
    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (!maybeAssistantLikeMessage(record) && !Array.isArray(record.content)) {
      continue;
    }
    const strings = collectStrings(record.content ?? record);
    const joined = strings.join("\n").trim();
    if (joined) {
      return joined;
    }
  }
  return null;
}

export function parseGateReviewResult(
  text: string,
  reviewerRole: GateReviewReviewerRole
): GateReviewResult {
  const now = new Date().toISOString();
  try {
    let normalizedText = text;
    const extracted = extractJsonObject(text);
    if (extracted) {
      const preParsed = asRecord(JSON.parse(extracted));
      if (readString(preParsed.decision) == null && readString(preParsed.verdict) != null) {
        normalizedText = JSON.stringify({
          ...preParsed,
          decision: readString(preParsed.verdict),
        });
      }
    }
    const jsonText = extractJsonObject(normalizedText) ?? normalizedText;
    const record = asRecord(JSON.parse(jsonText));
    const generic = parseWorkflowPanelDiscussionResult(normalizedText, reviewerRole);
    const dimensionScores = normalizeDimensionScores(record.dimensionScores);
    return {
      reviewerRole,
      verdict: normalizeVerdict(record.verdict ?? generic.decision),
      overallScore: clampScore(record.overallScore),
      dimensionScores,
      criticalBlockers: collectStrings(record.criticalBlockers ?? generic.blockers),
      majorIssues: collectStrings(record.majorIssues ?? generic.actionItems),
      suggestedRollbackStage: readString(record.suggestedRollbackStage),
      reviewedArtifacts: collectStrings(record.reviewedArtifacts),
      summary: readString(record.summary) ?? generic.summary,
      createdAt: generic.createdAt ?? now,
      runId: readString(record.runId) ?? generic.runId,
      rawText: generic.rawText,
    };
  } catch (error) {
    return {
      reviewerRole,
      verdict: "block",
      overallScore: 0,
      dimensionScores: {},
      criticalBlockers: [
        `Failed to parse structured gate review JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      majorIssues: [],
      suggestedRollbackStage: "write",
      reviewedArtifacts: [],
      summary: "Reviewer did not return valid structured JSON.",
      createdAt: now,
      runId: null,
      rawText: text,
    };
  }
}

export function aggregateGateReviewRound(
  round: GateReviewRound,
  config: WorkflowAutoGateConfig
): GateReviewAggregate {
  const threshold = thresholdForStage(round.stage, config);
  const completed = round.attempts
    .map((attempt) => attempt.result)
    .filter((result): result is GateReviewResult => Boolean(result));
  const reviewCount = completed.length;
  const totalScore = completed.reduce((sum, result) => sum + result.overallScore, 0);
  const averageScore = reviewCount > 0 ? totalScore / reviewCount : null;
  const minScore =
    reviewCount > 0 ? Math.min(...completed.map((result) => result.overallScore)) : null;
  const blockerCount = completed.reduce(
    (sum, result) =>
      sum +
      result.criticalBlockers.length +
      (result.verdict === "block" || result.verdict === "rollback" ? 1 : 0),
    0
  );
  const verdictCounts = completed.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const rollbackSuggestion =
    completed.find((result) => result.suggestedRollbackStage)?.suggestedRollbackStage ?? null;
  const approved =
    reviewCount >= Math.max(1, config.quorum) &&
    blockerCount === 0 &&
    (averageScore ?? 0) >= threshold.avg &&
    (minScore ?? 0) >= threshold.minSingle &&
    (verdictCounts.pass ?? 0) >= Math.max(1, config.quorum);
  const status =
    approved
      ? "approved"
      : reviewCount >= PANEL_ROLES.length || blockerCount > 0
        ? "rejected"
        : "reviewing";
  const aggregate: GateReviewAggregate = {
    approved,
    status,
    thresholdAvg: threshold.avg,
    thresholdMinSingle: threshold.minSingle,
    quorum: config.quorum,
    reviewCount,
    averageScore,
    minScore,
    blockerCount,
    verdictCounts,
    suggestedRollbackStage: rollbackSuggestion,
    summary: "",
  };
  aggregate.summary = summarizeAggregate(aggregate);
  return aggregate;
}

export function createGateReviewRound(params: {
  gateId: string;
  stage: string | null;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  attempts: GateReviewAttempt[];
}): GateReviewRound {
  const round = createWorkflowPanelDiscussionRound({
    policy: {
      discussionId: `gate-review-${params.gateId.toLowerCase()}`,
      topic: `Evaluate whether ${params.gateId} should pass`,
      stage: params.stage,
      participants: defaultGateReviewPanel(),
      maxRounds: 2,
      quorum: defaultGateReviewPanel().length,
      resolvedDecisions: ["pass", "approved"],
      blockedDecisions: ["block", "rollback", "rejected"],
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
                decision: attempt.result.verdict,
                confidence: attempt.result.overallScore,
                recommendedOwner: null,
                actionItems: attempt.result.majorIssues,
                blockers: attempt.result.criticalBlockers,
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
    gateId: params.gateId,
    stage: params.stage,
    roundId: round.roundId,
    packetPath: round.packetPath,
    packetJsonPath: round.packetJsonPath,
    packetFingerprint: round.packetFingerprint,
    status: "reviewing",
    launchedAt: round.launchedAt,
    updatedAt: round.updatedAt,
    attempts: params.attempts,
    aggregate: null,
  };
}

export async function evaluateSubmitAutoGate(params: {
  projectRoot: string;
  autoMode: WorkflowAutoMode;
  autoGate: WorkflowAutoGateConfig;
  hasStageWorkRemaining: boolean;
}): Promise<{ blocking: boolean; reason: string | null }> {
  if (params.hasStageWorkRemaining) {
    return { blocking: true, reason: "GATE-5 waits until all submit artifacts are present." };
  }
  return {
    blocking: true,
    reason:
      "GATE-5 revision decision is mandatory at SUBMIT for the OpenReview-facing submission path; wait for explicit human confirmation before DONE.",
  };
}

export function defaultGateReviewPanel(): GateReviewReviewerRole[] {
  return [...PANEL_ROLES];
}

export function resolveAutoGateIdForStage(stage: string | null): string | null {
  const stageKey = resolveWorkflowAutoGateStageKey(stage);
  if (stageKey === "review_to_write") {
    return "GATE-REVIEW-TO-WRITE";
  }
  if (stageKey === "write_to_submit") {
    return "GATE-WRITE-TO-SUBMIT";
  }
  if (stageKey === "submit_to_done") {
    return "GATE-5";
  }
  return null;
}

export function resolveAutoGateMode(params: {
  stage: string | null;
  autoGate: WorkflowAutoGateConfig;
}): WorkflowAutoGateMode | null {
  return resolveWorkflowAutoGateModeForStage({
    stage: params.stage,
    config: params.autoGate,
  });
}

export function buildAutoGatePanelDiscussionPolicy(params: {
  projectRoot: string;
  gateId: string;
  stage: string | null;
  autoGate: WorkflowAutoGateConfig;
  packetPath: string;
  packetJsonPath: string;
  reviewedArtifacts?: string[];
}): Record<string, unknown> {
  const threshold = thresholdForStage(params.stage, params.autoGate);
  return {
    discussionId: `gate-review-${params.gateId.toLowerCase()}`,
    topic: `Evaluate whether ${params.gateId} should pass`,
    stage: params.stage,
    participants: defaultGateReviewPanel(),
    maxRounds: params.autoGate.maxReviewRounds,
    quorum: params.autoGate.quorum,
    resolvedDecisions: ["pass", "approved"],
    blockedDecisions: ["block", "rollback", "rejected"],
    packetArtifacts: uniqueStrings([
      path.relative(params.projectRoot, params.packetPath),
      path.relative(params.projectRoot, params.packetJsonPath),
      ...(params.reviewedArtifacts ?? []),
    ]),
    promptInstructions:
      "Review only the gate packet and referenced project artifacts. Do not expand scope beyond gate evaluation. Return a gate verdict with scoring, blockers, rollback advice, and a concise summary.",
    summary: [
      `Gate: ${params.gateId}`,
      `Stage: ${params.stage ?? "unknown"}`,
      `Threshold avg: ${threshold.avg}`,
      `Threshold minSingle: ${threshold.minSingle}`,
    ],
    context: {
      gateId: params.gateId,
      gateStage: params.stage,
      thresholdAvg: threshold.avg,
      thresholdMinSingle: threshold.minSingle,
      packetPath: params.packetPath,
      packetJsonPath: params.packetJsonPath,
      reviewedArtifacts: params.reviewedArtifacts ?? [],
    },
  };
}

export function defaultAutoGateConfig(): WorkflowAutoGateConfig {
  return {
    ...DEFAULT_WORKFLOW_AUTO_GATE,
    thresholds: {
      ...DEFAULT_WORKFLOW_AUTO_GATE.thresholds,
    },
  };
}

// ---------------------------------------------------------------------------
// Score-based auto-gate evaluation
// ---------------------------------------------------------------------------

export type AutoGateScoreEvaluation = {
  pass: boolean;
  reason: string;
  averageScore: number | null;
  minSingleScore: number | null;
  thresholdAvg: number;
  thresholdMinSingle: number;
  scoreRecordCount: number;
};

type ScoreRecordLike = {
  stage?: string;
  average?: number;
  minSingle?: number;
  min_single?: number;
  recommendation?: string;
};

export function evaluateAutoGate(
  stage: string | null,
  manifest: Record<string, unknown> | null,
  config: WorkflowAutoGateConfig
): AutoGateScoreEvaluation {
  const thresholdKey = stage === "code"
    ? "code_to_experiment"
    : stage === "review"
      ? "review_to_write"
      : stage === "write"
        ? "write_to_submit"
        : stage === "submit"
          ? "submit_to_done"
          : null;

  const threshold = thresholdKey
    ? config.thresholds[thresholdKey as keyof typeof config.thresholds]
    : null;
  const thresholdAvg = threshold?.avg ?? 7.0;
  const thresholdMinSingle = threshold?.minSingle ?? 6.0;

  // Read score_records from review_issue_tracker in manifest
  const reviewTracker =
    manifest && typeof manifest === "object"
      ? ((manifest as Record<string, unknown>).review_issue_tracker as Record<string, unknown> | undefined)
      : null;
  const rawRecords = Array.isArray(reviewTracker?.score_records)
    ? reviewTracker!.score_records as ScoreRecordLike[]
    : Array.isArray(reviewTracker?.scoreRecords)
      ? reviewTracker!.scoreRecords as ScoreRecordLike[]
      : [];

  // Filter to records matching the current gate stage
  const gateStage = thresholdKey ?? stage ?? "";
  const stageRecords = rawRecords.filter(
    (r) => typeof r.stage === "string" && r.stage === gateStage
  );

  if (stageRecords.length === 0) {
    return {
      pass: false,
      reason: `No score records found for gate "${gateStage}". At least ${config.quorum} review(s) required.`,
      averageScore: null,
      minSingleScore: null,
      thresholdAvg,
      thresholdMinSingle,
      scoreRecordCount: 0,
    };
  }

  if (stageRecords.length < config.quorum) {
    return {
      pass: false,
      reason: `Only ${stageRecords.length}/${config.quorum} review(s) collected for gate "${gateStage}".`,
      averageScore: null,
      minSingleScore: null,
      thresholdAvg,
      thresholdMinSingle,
      scoreRecordCount: stageRecords.length,
    };
  }

  const avgScores = stageRecords
    .map((r) => (typeof r.average === "number" ? r.average : null))
    .filter((v): v is number => v !== null);
  const minScores = stageRecords
    .map((r) => {
      const v = typeof r.minSingle === "number" ? r.minSingle : typeof r.min_single === "number" ? r.min_single : null;
      return v;
    })
    .filter((v): v is number => v !== null);

  const overallAvg =
    avgScores.length > 0
      ? avgScores.reduce((sum, v) => sum + v, 0) / avgScores.length
      : null;
  const overallMin =
    minScores.length > 0 ? Math.min(...minScores) : null;

  const avgPass = overallAvg !== null && overallAvg >= thresholdAvg;
  const minPass = overallMin !== null && overallMin >= thresholdMinSingle;
  const pass = avgPass && minPass;

  const reasons: string[] = [];
  if (!avgPass) {
    reasons.push(
      `Average score ${overallAvg?.toFixed(2) ?? "N/A"} below threshold ${thresholdAvg}`
    );
  }
  if (!minPass) {
    reasons.push(
      `Min single score ${overallMin?.toFixed(2) ?? "N/A"} below threshold ${thresholdMinSingle}`
    );
  }

  return {
    pass,
    reason: pass
      ? `Gate "${gateStage}" passed: avg=${overallAvg?.toFixed(2)}, min=${overallMin?.toFixed(2)}.`
      : reasons.join("; "),
    averageScore: overallAvg !== null ? Math.round(overallAvg * 100) / 100 : null,
    minSingleScore: overallMin !== null ? Math.round(overallMin * 100) / 100 : null,
    thresholdAvg,
    thresholdMinSingle,
    scoreRecordCount: stageRecords.length,
  };
}
