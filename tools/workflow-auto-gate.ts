import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_WORKFLOW_AUTO_GATE,
  type WorkflowAutoGateConfig,
  type WorkflowAutoMode,
} from "./workflow-auto-mode";

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
  return createHash("sha1")
    .update(JSON.stringify(packet))
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
  return [
    `Auto gate review request for ${params.reviewerRole}.`,
    `Project ID: ${params.projectId ?? path.basename(params.projectRoot)}`,
    `Project root: ${params.projectRoot}`,
    `Current stage: ${params.stage ?? "unknown"}`,
    `Gate: ${params.gateId}`,
    `Read this review packet first: ${params.packetPath}`,
    `Structured packet JSON: ${params.packetJsonPath}`,
    "Review only the packet and the referenced project artifacts. Do not expand scope beyond gate evaluation.",
    "Return ONLY valid JSON with this schema:",
    `{
  "verdict": "pass | revise | rollback | block",
  "overallScore": 0-10,
  "dimensionScores": { "quality": 0-10, "evidence": 0-10, "clarity": 0-10, "citation": 0-10, "publishability": 0-10 },
  "criticalBlockers": ["..."],
  "majorIssues": ["..."],
  "suggestedRollbackStage": "write | analyze | experiment | review | null",
  "reviewedArtifacts": ["relative/path"],
  "summary": "one concise paragraph"
}`,
  ].join("\n");
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
    const jsonText = extractJsonObject(text) ?? text;
    const record = asRecord(JSON.parse(jsonText));
    const dimensionScores = normalizeDimensionScores(record.dimensionScores);
    return {
      reviewerRole,
      verdict: normalizeVerdict(record.verdict),
      overallScore: clampScore(record.overallScore),
      dimensionScores,
      criticalBlockers: collectStrings(record.criticalBlockers),
      majorIssues: collectStrings(record.majorIssues),
      suggestedRollbackStage: readString(record.suggestedRollbackStage),
      reviewedArtifacts: collectStrings(record.reviewedArtifacts),
      summary: readString(record.summary),
      createdAt: now,
      runId: readString(record.runId),
      rawText: text,
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
  const now = new Date().toISOString();
  return {
    gateId: params.gateId,
    stage: params.stage,
    roundId: randomUUID(),
    packetPath: params.packetPath,
    packetJsonPath: params.packetJsonPath,
    packetFingerprint: params.packetFingerprint,
    status: "reviewing",
    launchedAt: now,
    updatedAt: now,
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
  if (params.autoMode !== "aggressive" || !params.autoGate.enabled) {
    return {
      blocking: true,
      reason: "GATE-5 revision decision is mandatory at SUBMIT; wait for human response before DONE.",
    };
  }
  if (!params.autoGate.allowAutonomousDone) {
    return {
      blocking: true,
      reason: "GATE-5 auto review is enabled, but autonomous DONE is disabled by policy.",
    };
  }
  const store = await readGateReviewStore(params.projectRoot);
  const round = store.currentRound;
  if (!round || round.stage !== "submit" || round.gateId !== "GATE-5") {
    return {
      blocking: true,
      reason: "GATE-5 auto review is pending; wait for the reviewer panel to score the packet.",
    };
  }
  const aggregate = round.aggregate ?? aggregateGateReviewRound(round, params.autoGate);
  if (aggregate.approved) {
    return { blocking: false, reason: null };
  }
  return {
    blocking: true,
    reason:
      aggregate.status === "rejected"
        ? `GATE-5 auto review rejected the submission packet. ${aggregate.summary}`
        : "GATE-5 auto review is still pending reviewer quorum.",
  };
}

export function defaultGateReviewPanel(): GateReviewReviewerRole[] {
  return [...PANEL_ROLES];
}

export function defaultAutoGateConfig(): WorkflowAutoGateConfig {
  return {
    ...DEFAULT_WORKFLOW_AUTO_GATE,
    thresholds: {
      ...DEFAULT_WORKFLOW_AUTO_GATE.thresholds,
    },
  };
}
