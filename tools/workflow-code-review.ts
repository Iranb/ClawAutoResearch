import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowAutoGateConfig, WorkflowAutoMode } from "./workflow-auto-mode.js";

export type CodeReviewReviewerRole = "researcher" | "orchestrator" | "reviewer";

export type CodeReviewVerdict = "pass" | "revise" | "rollback" | "block";

export type CodeReviewResult = {
  reviewerRole: CodeReviewReviewerRole;
  verdict: CodeReviewVerdict;
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

export type CodeReviewAttempt = {
  reviewerRole: CodeReviewReviewerRole;
  sessionKey: string;
  runId: string | null;
  status: "pending" | "completed" | "error";
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: CodeReviewResult | null;
};

export type CodeReviewAggregate = {
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

export type CodeReviewRound = {
  gateId: "CODE-REVIEW";
  stage: "code";
  roundId: string;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  status: "reviewing" | "approved" | "rejected";
  launchedAt: string;
  updatedAt: string;
  attempts: CodeReviewAttempt[];
  aggregate: CodeReviewAggregate | null;
};

export type CodeReviewStore = {
  schemaVersion: 1;
  updatedAt: string;
  roundsStarted: number;
  currentRound: CodeReviewRound | null;
};

export type CodeReviewPacket = {
  gateId: "CODE-REVIEW";
  projectId: string | null;
  projectRoot: string;
  stage: "code";
  manifestUpdatedAt: string | null;
  activeTracks: Array<{
    trackId: string;
    hypothesis: string | null;
    noveltyBasis: string | null;
    mainMetric: string | null;
    requiredBaselines: string[];
    requiredAblations: string[];
    requiredControls: string[];
  }>;
  bundleChecks: Array<{
    dir: string;
    trackId: string | null;
    question: string | null;
    hypothesis: string | null;
    noveltyBasis: string | null;
    baselineReference: string | null;
    primaryBaselineMetric: string | null;
    targetImprovement: string | null;
    baselineTrainingProtocol: string | null;
    baselineEvalProtocol: string | null;
    innovationPoints: string[];
    validationSteps: string[];
    ablationPlan: string[];
  }>;
  artifactChecks: Array<{
    path: string;
    exists: boolean;
  }>;
  summary: string[];
};

const PANEL_ROLES: CodeReviewReviewerRole[] = [
  "researcher",
  "orchestrator",
  "reviewer",
];

const DEFAULT_PACKET_ARTIFACTS = [
  "orchestrator/PLAN.md",
  "orchestrator/TODOS.md",
  "orchestrator/PLAN_AUDIT.md",
  "coder/EXPERIMENT_INDEX.md",
  "TRACK_REGISTRY.json",
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

function normalizeDimensionScores(value: unknown): Record<string, number> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, score]) => [key, clampScore(score)])
      .filter(([, score]) => Number.isFinite(score))
  );
}

function normalizeVerdict(value: unknown): CodeReviewVerdict {
  const verdict = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (verdict === "pass" || verdict === "revise" || verdict === "rollback" || verdict === "block") {
    return verdict;
  }
  return "block";
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

function thresholdForCode(config: WorkflowAutoGateConfig) {
  return config.thresholds.code_to_experiment ?? config.thresholds.review_to_write;
}

function summarizeAggregate(aggregate: CodeReviewAggregate): string {
  if (aggregate.status === "approved") {
    return `Code innovation review approved with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.reviewCount} review(s).`;
  }
  if (aggregate.status === "rejected") {
    return `Code innovation review rejected with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.blockerCount} blocker(s).`;
  }
  return "Code innovation review is still waiting for enough reviewer results.";
}

function listRecordText(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return [entry.trim()];
    }
    const record = asRecord(entry);
    if (Object.keys(record).length === 0) {
      return [];
    }
    const preferred =
      readString(record.id) ??
      readString(record.step_id) ??
      readString(record.ablation_id) ??
      readString(record.title) ??
      readString(record.label) ??
      readString(record.objective) ??
      readString(record.summary) ??
      null;
    const covers = collectStrings(
      record.covers ??
        record.cover ??
        record.innovation_point ??
        record.innovationPoint ??
        record.innovation_point_id ??
        record.innovationPointId ??
        record.targets
    );
    return [preferred, ...covers].filter((item): item is string => Boolean(item));
  });
}

async function collectBundleChecks(projectRoot: string) {
  const root = path.join(projectRoot, "coder", "experiments");
  const bundles: CodeReviewPacket["bundleChecks"] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const manifestPath = path.join(current, "EXPERIMENT_MANIFEST.json");
    const hasManifest = entries.some(
      (entry) => entry.isFile() && entry.name === "EXPERIMENT_MANIFEST.json"
    );
    if (hasManifest) {
      const record = asRecord(
        await readJsonIfExists<Record<string, unknown>>(manifestPath)
      );
      bundles.push({
        dir: path.relative(projectRoot, current) || current,
        trackId: readString(record.track_id ?? record.trackId),
        question: readString(record.question ?? record.experiment_question ?? record.objective),
        hypothesis:
          readString(record.hypothesis ?? record.track_hypothesis ?? record.trackHypothesis) ??
          null,
        noveltyBasis:
          readString(record.novelty_basis ?? record.noveltyBasis) ?? null,
        baselineReference:
          readString(record.baseline_reference ?? record.baselineReference ?? record.baseline) ??
          null,
        primaryBaselineMetric:
          readString(
            record.primary_baseline_metric ??
              record.primaryBaselineMetric ??
              record.main_metric
          ) ?? null,
        targetImprovement:
          readString(
            record.target_improvement ??
              record.targetImprovement ??
              record.success_threshold
          ) ?? null,
        baselineTrainingProtocol:
          readString(
            record.baseline_training_protocol ??
              record.baselineTrainingProtocol ??
              record.baseline_training_setup ??
              record.baselineTrainingSetup
          ) ?? null,
        baselineEvalProtocol:
          readString(
            record.baseline_eval_protocol ??
              record.baselineEvalProtocol ??
              record.eval_protocol ??
              record.evalProtocol
          ) ?? null,
        innovationPoints: listRecordText(
          record.innovation_points ?? record.innovationPoints
        ),
        validationSteps: listRecordText(
          record.validation_steps ?? record.validationSteps
        ),
        ablationPlan: listRecordText(record.ablation_plan ?? record.ablationPlan),
      });
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
      }
    }
  }

  return bundles;
}

export function getCodeReviewStorePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "code-review-state.json");
}

export function getCodeReviewPacketDir(projectRoot: string): string {
  return path.join(projectRoot, "reviewer", "code-review");
}

export async function readCodeReviewStore(projectRoot: string): Promise<CodeReviewStore> {
  const record = asRecord(
    await readJsonIfExists<Record<string, unknown>>(getCodeReviewStorePath(projectRoot))
  );
  const currentRoundRecord = asRecord(record.currentRound);
  const attempts = Array.isArray(currentRoundRecord.attempts)
    ? currentRoundRecord.attempts
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const attempt = entry as Record<string, unknown>;
          const attemptStatus: CodeReviewAttempt["status"] = (() => {
            const raw = readString(attempt.status)?.toLowerCase();
            if (raw === "completed" || raw === "error") {
              return raw;
            }
            return "pending";
          })();
          return {
            reviewerRole:
              (readString(attempt.reviewerRole) as CodeReviewReviewerRole | null) ??
              "reviewer",
            sessionKey: readString(attempt.sessionKey) ?? "",
            runId: readString(attempt.runId),
            status: attemptStatus,
            launchedAt: readString(attempt.launchedAt) ?? new Date().toISOString(),
            completedAt: readString(attempt.completedAt),
            error: readString(attempt.error),
            result:
              attempt.result && typeof attempt.result === "object"
                ? parseCodeReviewResult(
                    JSON.stringify(attempt.result),
                    (readString((attempt.result as Record<string, unknown>).reviewerRole) as
                      | CodeReviewReviewerRole
                      | null) ??
                      ((readString(attempt.reviewerRole) as CodeReviewReviewerRole | null) ??
                        "reviewer")
                  )
                : null,
          };
        })
    : [];
  const currentRoundStatus: CodeReviewRound["status"] = (() => {
    const raw = readString(currentRoundRecord.status)?.toLowerCase();
    if (raw === "approved" || raw === "rejected") {
      return raw;
    }
    return "reviewing";
  })();
  const currentRound: CodeReviewRound | null =
    attempts.length > 0 || Object.keys(currentRoundRecord).length > 0
      ? {
          gateId: "CODE-REVIEW",
          stage: "code",
          roundId: readString(currentRoundRecord.roundId) ?? randomUUID(),
          packetPath: readString(currentRoundRecord.packetPath) ?? "",
          packetJsonPath: readString(currentRoundRecord.packetJsonPath) ?? "",
          packetFingerprint: readString(currentRoundRecord.packetFingerprint) ?? "",
          status: currentRoundStatus,
          launchedAt: readString(currentRoundRecord.launchedAt) ?? new Date().toISOString(),
          updatedAt: readString(currentRoundRecord.updatedAt) ?? new Date().toISOString(),
          attempts,
          aggregate:
            currentRoundRecord.aggregate &&
            typeof currentRoundRecord.aggregate === "object" &&
            !Array.isArray(currentRoundRecord.aggregate)
              ? (currentRoundRecord.aggregate as CodeReviewAggregate)
              : null,
        }
      : null;
  return {
    schemaVersion: 1,
    updatedAt: readString(record.updatedAt) ?? new Date().toISOString(),
    roundsStarted: Math.max(0, Math.floor(readNumber(record.roundsStarted) ?? 0)),
    currentRound,
  };
}

export async function saveCodeReviewStore(
  projectRoot: string,
  store: CodeReviewStore
): Promise<void> {
  await writeJsonEnsured(getCodeReviewStorePath(projectRoot), {
    ...store,
    schemaVersion: 1,
  });
}

export function buildCodeReviewFingerprint(packet: CodeReviewPacket): string {
  const normalizedPacket: CodeReviewPacket = {
    ...packet,
    manifestUpdatedAt: null,
    summary: [...packet.summary].sort(),
    activeTracks: [...packet.activeTracks].sort((left, right) =>
      left.trackId.localeCompare(right.trackId)
    ),
    bundleChecks: [...packet.bundleChecks].sort((left, right) =>
      left.dir.localeCompare(right.dir)
    ),
    artifactChecks: [...packet.artifactChecks].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
  };
  return createHash("sha1")
    .update(JSON.stringify(normalizedPacket))
    .digest("hex");
}

export async function materializeCodeReviewPacket(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<{
  packet: CodeReviewPacket;
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = asRecord(
    await readJsonIfExists<Record<string, unknown>>(manifestPath)
  );
  const researchProgram = asRecord(manifest.research_program);
  const trackRecords = Array.isArray(researchProgram.tracks) ? researchProgram.tracks : [];
  const activeTracks = trackRecords
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => asRecord(entry))
    .filter((entry) => readString(entry.status)?.toLowerCase() === "active")
    .map((entry) => ({
      trackId: readString(entry.track_id ?? entry.trackId) ?? "unknown-track",
      hypothesis: readString(entry.hypothesis),
      noveltyBasis: readString(entry.novelty_basis ?? entry.noveltyBasis),
      mainMetric: readString(entry.main_metric ?? entry.mainMetric),
      requiredBaselines: collectStrings(entry.required_baselines ?? entry.requiredBaselines),
      requiredAblations: collectStrings(entry.required_ablations ?? entry.requiredAblations),
      requiredControls: collectStrings(entry.required_controls ?? entry.requiredControls),
    }));
  const bundleChecks = await collectBundleChecks(params.projectRoot);
  const artifactChecks = await Promise.all(
    DEFAULT_PACKET_ARTIFACTS.map(async (relativePath) => ({
      path: relativePath,
      exists: await pathExists(path.join(params.projectRoot, relativePath)),
    }))
  );

  const summary = [
    `Project root: ${params.projectRoot}`,
    `Active tracks: ${activeTracks.map((track) => track.trackId).join(", ") || "none"}`,
    `Bundle count: ${bundleChecks.length}`,
    "Review checklist: code must stay baseline-grounded, target the declared primary metric, preserve baseline training/eval unless deviations are documented, and validate each innovation point step-by-step.",
  ];

  const packet: CodeReviewPacket = {
    gateId: "CODE-REVIEW",
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stage: "code",
    manifestUpdatedAt:
      readString(manifest.updated_at ?? manifest.updatedAt ?? manifest.last_heartbeat_at) ?? null,
    activeTracks,
    bundleChecks,
    artifactChecks,
    summary,
  };

  const packetDir = getCodeReviewPacketDir(params.projectRoot);
  const packetPath = path.join(packetDir, "CODE_REVIEW_PACKET.md");
  const packetJsonPath = path.join(packetDir, "CODE_REVIEW_PACKET.json");
  const packetFingerprint = buildCodeReviewFingerprint(packet);

  const markdown = [
    "# CODE Innovation Review Packet",
    "",
    `- project: ${params.projectId ?? "unknown"}`,
    `- project_root: ${params.projectRoot}`,
    `- active_tracks: ${activeTracks.map((track) => track.trackId).join(", ") || "none"}`,
    `- bundle_count: ${bundleChecks.length}`,
    "",
    "## Review Goals",
    "- confirm each code bundle still implements the active innovation track rather than drifting away from it",
    "- confirm the implementation is baseline-grounded and aims at the declared primary baseline metric",
    "- confirm validation_steps and ablation_plan can incrementally verify each innovation point",
    "- confirm the bundle remains executable and preserves baseline training/eval protocol unless explicit deviations are documented",
    "",
    "## Summary",
    ...summary.map((line) => `- ${line}`),
    "",
    "## Active Tracks",
    ...activeTracks.map(
      (track) =>
        `- ${track.trackId}: hypothesis=${track.hypothesis ?? "unset"}, novelty_basis=${track.noveltyBasis ?? "unset"}, main_metric=${track.mainMetric ?? "unset"}`
    ),
    "",
    "## Bundles",
    ...bundleChecks.map(
      (bundle) =>
        `- ${bundle.dir}: track=${bundle.trackId ?? "unset"}, metric=${bundle.primaryBaselineMetric ?? "unset"}, target=${bundle.targetImprovement ?? "unset"}, innovation_points=${bundle.innovationPoints.join("; ") || "none"}, validation_steps=${bundle.validationSteps.join("; ") || "none"}, ablation_plan=${bundle.ablationPlan.join("; ") || "none"}`
    ),
    "",
    "## Artifact Checks",
    ...artifactChecks.map((artifact) => `- ${artifact.path}: ${artifact.exists ? "present" : "missing"}`),
    "",
    "## JSON",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.mkdir(packetDir, { recursive: true });
  await fs.writeFile(packetPath, markdown, "utf8");
  await writeJsonEnsured(packetJsonPath, packet);

  return {
    packet,
    packetPath,
    packetJsonPath,
    packetFingerprint,
  };
}

export function buildCodeReviewPrompt(params: {
  projectRoot: string;
  projectId: string | null;
  reviewerRole: CodeReviewReviewerRole;
  packetPath: string;
  packetJsonPath: string;
}): string {
  const focus =
    params.reviewerRole === "researcher"
      ? "Focus on innovation alignment: does the code still implement the active hypothesis and novelty basis, and is the target metric really baseline-centered?"
      : params.reviewerRole === "orchestrator"
        ? "Focus on validation structure: do validation_steps and ablation_plan incrementally verify each innovation point and keep one variable per experiment?"
        : "Focus on scientific execution quality: can this bundle execute safely, preserve baseline training/eval protocol, and measure the declared primary metric faithfully?";

  return [
    `Code innovation review request for ${params.reviewerRole}.`,
    `Project: ${params.projectId ?? "unknown"} (${params.projectRoot})`,
    `Packet: ${params.packetPath}`,
    `Packet JSON: ${params.packetJsonPath}`,
    "",
    focus,
    "",
    "Return JSON only:",
    "```json",
    JSON.stringify(
      {
        verdict: "pass | revise | rollback | block",
        overallScore: 0,
        dimensionScores: {
          innovation_alignment: 0,
          baseline_fidelity: 0,
          validation_plan: 0,
          execution_readiness: 0,
        },
        criticalBlockers: [],
        majorIssues: [],
        suggestedRollbackStage: null,
        reviewedArtifacts: [],
        summary: "short justification",
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

export function parseCodeReviewResult(
  rawText: string,
  reviewerRole: CodeReviewReviewerRole
): CodeReviewResult {
  const fallback = {
    reviewerRole,
    verdict: "block" as const,
    overallScore: 0,
    dimensionScores: {},
    criticalBlockers: [] as string[],
    majorIssues: [] as string[],
    suggestedRollbackStage: null,
    reviewedArtifacts: [] as string[],
    summary: null,
    createdAt: new Date().toISOString(),
    runId: null,
    rawText,
  };
  const jsonSource = extractJsonObject(rawText);
  if (!jsonSource) {
    return {
      ...fallback,
      criticalBlockers: ["No structured code review JSON was found in the reviewer response."],
      summary: "Reviewer response did not contain the required JSON payload.",
    };
  }
  try {
    const parsed = asRecord(JSON.parse(jsonSource));
    return {
      reviewerRole,
      verdict: normalizeVerdict(parsed.verdict),
      overallScore: clampScore(parsed.overallScore),
      dimensionScores: normalizeDimensionScores(parsed.dimensionScores),
      criticalBlockers: collectStrings(parsed.criticalBlockers),
      majorIssues: collectStrings(parsed.majorIssues),
      suggestedRollbackStage: readString(parsed.suggestedRollbackStage),
      reviewedArtifacts: collectStrings(parsed.reviewedArtifacts),
      summary: readString(parsed.summary),
      createdAt: new Date().toISOString(),
      runId: readString(parsed.runId),
      rawText,
    };
  } catch (error) {
    return {
      ...fallback,
      criticalBlockers: [
        `Failed to parse structured code review JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      summary: "Reviewer response JSON could not be parsed.",
    };
  }
}

export function aggregateCodeReviewRound(
  round: CodeReviewRound,
  config: WorkflowAutoGateConfig
): CodeReviewAggregate {
  const threshold = thresholdForCode(config);
  const results = round.attempts
    .map((attempt) => attempt.result)
    .filter((result): result is CodeReviewResult => Boolean(result));
  const reviewCount = results.length;
  const averageScore =
    reviewCount > 0
      ? results.reduce((sum, result) => sum + result.overallScore, 0) / reviewCount
      : null;
  const minScore =
    reviewCount > 0
      ? Math.min(...results.map((result) => result.overallScore))
      : null;
  const blockerCount = results.reduce(
    (sum, result) => sum + result.criticalBlockers.length,
    0
  );
  const verdictCounts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const rollbackVotes = results
    .map((result) => result.suggestedRollbackStage)
    .filter((value): value is string => Boolean(value));
  const suggestedRollbackStage =
    rollbackVotes.length > 0
      ? rollbackVotes.sort(
          (left, right) =>
            rollbackVotes.filter((value) => value === right).length -
            rollbackVotes.filter((value) => value === left).length
        )[0]
      : null;
  const approved =
    reviewCount >= Math.max(1, config.quorum) &&
    blockerCount === 0 &&
    (averageScore ?? 0) >= threshold.avg &&
    (minScore ?? 0) >= threshold.minSingle &&
    (verdictCounts.block ?? 0) === 0 &&
    (verdictCounts.rollback ?? 0) === 0;
  const status: CodeReviewAggregate["status"] =
    approved
      ? "approved"
      : reviewCount >= Math.max(1, config.quorum) &&
          ((verdictCounts.block ?? 0) > 0 || (verdictCounts.rollback ?? 0) > 0)
        ? "rejected"
        : "reviewing";
  const aggregate: CodeReviewAggregate = {
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
    suggestedRollbackStage,
    summary: "",
  };
  aggregate.summary = summarizeAggregate(aggregate);
  return aggregate;
}

export function createCodeReviewRound(params: {
  stage: "code";
  packetPath: string;
  packetJsonPath: string;
  packetFingerprint: string;
  attempts: CodeReviewAttempt[];
}): CodeReviewRound {
  const now = new Date().toISOString();
  return {
    gateId: "CODE-REVIEW",
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

export async function evaluateCodeAutoReview(params: {
  projectRoot: string;
  autoMode: WorkflowAutoMode;
  autoGate: WorkflowAutoGateConfig;
  hasStageWorkRemaining: boolean;
}): Promise<{ blocking: boolean; reason: string | null }> {
  if (params.hasStageWorkRemaining) {
    return { blocking: false, reason: null };
  }
  if (params.autoMode !== "aggressive" || !params.autoGate.enabled) {
    return { blocking: false, reason: null };
  }
  const store = await readCodeReviewStore(params.projectRoot);
  const round = store.currentRound;
  if (!round || round.stage !== "code" || round.gateId !== "CODE-REVIEW") {
    return {
      blocking: true,
      reason:
        "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
    };
  }
  const aggregate = round.aggregate ?? aggregateCodeReviewRound(round, params.autoGate);
  if (aggregate.approved) {
    return { blocking: false, reason: null };
  }
  return {
    blocking: true,
    reason:
      aggregate.status === "rejected"
        ? `CODE innovation review rejected the current implementation packet. ${aggregate.summary}`
        : "CODE innovation review is still pending reviewer quorum.",
  };
}

export function defaultCodeReviewPanel(): CodeReviewReviewerRole[] {
  return [...PANEL_ROLES];
}
