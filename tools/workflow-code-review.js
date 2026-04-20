import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
const PANEL_ROLES = [
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
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function readString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clampScore(value) {
    const numeric = readNumber(value);
    if (numeric == null) {
        return 0;
    }
    return Math.max(0, Math.min(10, numeric));
}
function collectStrings(value) {
    if (typeof value === "string" && value.trim()) {
        return [value.trim()];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectStrings(entry));
    }
    if (value && typeof value === "object") {
        return Object.values(value).flatMap((entry) => collectStrings(entry));
    }
    return [];
}
function normalizeDimensionScores(value) {
    const record = asRecord(value);
    return Object.fromEntries(Object.entries(record)
        .map(([key, score]) => [key, clampScore(score)])
        .filter(([, score]) => Number.isFinite(score)));
}
function normalizeVerdict(value) {
    const verdict = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (verdict === "pass" || verdict === "revise" || verdict === "rollback" || verdict === "block") {
        return verdict;
    }
    return "block";
}
function extractJsonObject(text) {
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
async function readJsonIfExists(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
async function writeJsonEnsured(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function thresholdForCode(config) {
    return config.thresholds.code_to_experiment ?? config.thresholds.review_to_write;
}
function summarizeAggregate(aggregate) {
    if (aggregate.status === "approved") {
        return `Code innovation review approved with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.reviewCount} review(s).`;
    }
    if (aggregate.status === "rejected") {
        return `Code innovation review rejected with avg ${aggregate.averageScore?.toFixed(2) ?? "n/a"} and ${aggregate.blockerCount} blocker(s).`;
    }
    return "Code innovation review is still waiting for enough reviewer results.";
}
function listRecordText(value) {
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
        const preferred = readString(record.id) ??
            readString(record.step_id) ??
            readString(record.ablation_id) ??
            readString(record.title) ??
            readString(record.label) ??
            readString(record.objective) ??
            readString(record.summary) ??
            null;
        const covers = collectStrings(record.covers ??
            record.cover ??
            record.innovation_point ??
            record.innovationPoint ??
            record.innovation_point_id ??
            record.innovationPointId ??
            record.targets);
        return [preferred, ...covers].filter((item) => Boolean(item));
    });
}
function listImplementationProofText(value) {
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
        const primary = readString(record.id) ??
            readString(record.point_id) ??
            readString(record.pointId) ??
            readString(record.symbol) ??
            readString(record.path) ??
            readString(record.file) ??
            readString(record.hook) ??
            readString(record.entry_point) ??
            readString(record.entryPoint) ??
            readString(record.objective) ??
            readString(record.summary) ??
            null;
        const covers = collectStrings(record.covers ??
            record.cover ??
            record.innovation_point ??
            record.innovationPoint ??
            record.innovation_point_id ??
            record.innovationPointId ??
            record.targets);
        return [primary, ...covers].filter((item) => Boolean(item));
    });
}
async function collectBundleChecks(projectRoot) {
    const root = path.join(projectRoot, "coder", "experiments");
    const bundles = [];
    const queue = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === "ENOENT") {
                continue;
            }
            throw error;
        }
        const manifestPath = path.join(current, "EXPERIMENT_MANIFEST.json");
        const hasManifest = entries.some((entry) => entry.isFile() && entry.name === "EXPERIMENT_MANIFEST.json");
        if (hasManifest) {
            const record = asRecord(await readJsonIfExists(manifestPath));
            const implementationProof = asRecord(record.implementation_proof ?? record.implementationProof);
            bundles.push({
                dir: path.relative(projectRoot, current) || current,
                trackId: readString(record.track_id ?? record.trackId),
                question: readString(record.question ?? record.experiment_question ?? record.objective),
                hypothesis: readString(record.hypothesis ?? record.track_hypothesis ?? record.trackHypothesis) ??
                    null,
                noveltyBasis: readString(record.novelty_basis ?? record.noveltyBasis) ?? null,
                baselineReference: readString(record.baseline_reference ?? record.baselineReference ?? record.baseline) ??
                    null,
                primaryBaselineMetric: readString(record.primary_baseline_metric ??
                    record.primaryBaselineMetric ??
                    record.main_metric) ?? null,
                targetImprovement: readString(record.target_improvement ??
                    record.targetImprovement ??
                    record.success_threshold) ?? null,
                baselineTrainingProtocol: readString(record.baseline_training_protocol ??
                    record.baselineTrainingProtocol ??
                    record.baseline_training_setup ??
                    record.baselineTrainingSetup) ?? null,
                baselineEvalProtocol: readString(record.baseline_eval_protocol ??
                    record.baselineEvalProtocol ??
                    record.eval_protocol ??
                    record.evalProtocol) ?? null,
                innovationPoints: listRecordText(record.innovation_points ?? record.innovationPoints),
                validationSteps: listRecordText(record.validation_steps ?? record.validationSteps),
                ablationPlan: listRecordText(record.ablation_plan ?? record.ablationPlan),
                implementationChangedFiles: collectStrings(implementationProof.changed_files ?? implementationProof.changedFiles),
                implementationIntegrationPoints: listImplementationProofText(implementationProof.integration_points ?? implementationProof.integrationPoints),
                implementationActivationSignals: listImplementationProofText(implementationProof.activation_signals ?? implementationProof.activationSignals),
                implementationExecutionCommand: readString(implementationProof.execution_command ??
                    implementationProof.executionCommand ??
                    implementationProof.run_command ??
                    implementationProof.runCommand) ?? null,
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
async function collectExecutionProofSummary(projectRoot) {
    const proofRecord = asRecord(await readJsonIfExists(path.join(projectRoot, "researcher", "EXECUTION_PROOF.json")));
    if (Object.keys(proofRecord).length === 0) {
        return null;
    }
    return {
        status: readString(proofRecord.status),
        receiptCount: Math.max(0, Math.floor(readNumber(proofRecord.receipt_count ?? proofRecord.receiptCount) ?? 0)),
        lineageMatchedReceiptCount: Math.max(0, Math.floor(readNumber(proofRecord.lineage_matched_receipt_count ??
            proofRecord.lineageMatchedReceiptCount) ?? 0)),
        candidateCommit: readString(proofRecord.candidate_commit ?? proofRecord.candidateCommit),
        expectedStageRunId: readString(proofRecord.expected_stage_run_id ?? proofRecord.expectedStageRunId),
        receiptExperimentId: readString(proofRecord.primary_receipt_experiment_id ??
            proofRecord.primaryReceiptExperimentId),
        receiptRunId: readString(proofRecord.primary_receipt_run_id ?? proofRecord.primaryReceiptRunId),
        receiptStageRunId: readString(proofRecord.primary_receipt_stage_run_id ??
            proofRecord.primaryReceiptStageRunId),
        receiptGitCommit: readString(proofRecord.primary_receipt_git_commit ??
            proofRecord.primaryReceiptGitCommit),
        pendingReason: readString(proofRecord.pending_reason ?? proofRecord.pendingReason),
    };
}
export function getCodeReviewStorePath(projectRoot) {
    return path.join(projectRoot, ".openclaw-research", "code-review-state.json");
}
export function getCodeReviewPacketDir(projectRoot) {
    return path.join(projectRoot, "reviewer", "code-review");
}
export async function readCodeReviewStore(projectRoot) {
    const record = asRecord(await readJsonIfExists(getCodeReviewStorePath(projectRoot)));
    const currentRoundRecord = asRecord(record.currentRound);
    const attempts = Array.isArray(currentRoundRecord.attempts)
        ? currentRoundRecord.attempts
            .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
            .map((entry) => {
            const attempt = entry;
            const attemptStatus = (() => {
                const raw = readString(attempt.status)?.toLowerCase();
                if (raw === "completed" || raw === "error") {
                    return raw;
                }
                return "pending";
            })();
            return {
                reviewerRole: readString(attempt.reviewerRole) ??
                    "reviewer",
                sessionKey: readString(attempt.sessionKey) ?? "",
                runId: readString(attempt.runId),
                status: attemptStatus,
                launchedAt: readString(attempt.launchedAt) ?? new Date().toISOString(),
                completedAt: readString(attempt.completedAt),
                error: readString(attempt.error),
                result: attempt.result && typeof attempt.result === "object"
                    ? parseCodeReviewResult(JSON.stringify(attempt.result), readString(attempt.result.reviewerRole) ??
                        (readString(attempt.reviewerRole) ??
                            "reviewer"))
                    : null,
            };
        })
        : [];
    const currentRoundStatus = (() => {
        const raw = readString(currentRoundRecord.status)?.toLowerCase();
        if (raw === "approved" || raw === "rejected") {
            return raw;
        }
        return "reviewing";
    })();
    const currentRound = attempts.length > 0 || Object.keys(currentRoundRecord).length > 0
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
            aggregate: currentRoundRecord.aggregate &&
                typeof currentRoundRecord.aggregate === "object" &&
                !Array.isArray(currentRoundRecord.aggregate)
                ? currentRoundRecord.aggregate
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
export async function saveCodeReviewStore(projectRoot, store) {
    await writeJsonEnsured(getCodeReviewStorePath(projectRoot), {
        ...store,
        schemaVersion: 1,
    });
}
export function buildCodeReviewFingerprint(packet) {
    const normalizedPacket = {
        ...packet,
        manifestUpdatedAt: null,
        summary: [...packet.summary].sort(),
        activeTracks: [...packet.activeTracks].sort((left, right) => left.trackId.localeCompare(right.trackId)),
        bundleChecks: [...packet.bundleChecks].sort((left, right) => left.dir.localeCompare(right.dir)),
        artifactChecks: [...packet.artifactChecks].sort((left, right) => left.path.localeCompare(right.path)),
        executionProof: packet.executionProof,
    };
    return createHash("sha1")
        .update(JSON.stringify(normalizedPacket))
        .digest("hex");
}
export async function materializeCodeReviewPacket(params) {
    const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
    const manifest = asRecord(await readJsonIfExists(manifestPath));
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
    const artifactChecks = await Promise.all(DEFAULT_PACKET_ARTIFACTS.map(async (relativePath) => ({
        path: relativePath,
        exists: await pathExists(path.join(params.projectRoot, relativePath)),
    })));
    const executionProof = await collectExecutionProofSummary(params.projectRoot);
    const summary = [
        `Project root: ${params.projectRoot}`,
        `Active tracks: ${activeTracks.map((track) => track.trackId).join(", ") || "none"}`,
        `Bundle count: ${bundleChecks.length}`,
        executionProof
            ? `Execution proof: status=${executionProof.status ?? "unset"}, receipts=${executionProof.receiptCount}, lineage_matched=${executionProof.lineageMatchedReceiptCount}, candidate_commit=${executionProof.candidateCommit ?? "unset"}, run_id=${executionProof.receiptRunId ?? "unset"}, stage_run_id=${executionProof.receiptStageRunId ?? "unset"}, git_commit=${executionProof.receiptGitCommit ?? "unset"}`
            : "Execution proof: unavailable",
        "Review checklist: code must stay baseline-grounded, target the declared primary metric, preserve baseline training/eval unless deviations are documented, and validate each innovation point step-by-step.",
    ];
    const packet = {
        gateId: "CODE-REVIEW",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        stage: "code",
        manifestUpdatedAt: readString(manifest.updated_at ?? manifest.updatedAt ?? manifest.last_heartbeat_at) ?? null,
        activeTracks,
        bundleChecks,
        artifactChecks,
        executionProof,
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
        "- confirm implementation_proof shows where each innovation point is actually wired into code and how execution will prove it was activated",
        "- confirm the bundle remains executable and preserves baseline training/eval protocol unless explicit deviations are documented",
        "",
        "## Summary",
        ...summary.map((line) => `- ${line}`),
        "",
        "## Execution Proof",
        ...(executionProof
            ? [
                `- status=${executionProof.status ?? "unset"}, receipts=${executionProof.receiptCount}, lineage_matched=${executionProof.lineageMatchedReceiptCount}, candidate_commit=${executionProof.candidateCommit ?? "unset"}, expected_stage_run_id=${executionProof.expectedStageRunId ?? "unset"}`,
                `- receipt_experiment=${executionProof.receiptExperimentId ?? "unset"}, receipt_run_id=${executionProof.receiptRunId ?? "unset"}, receipt_stage_run_id=${executionProof.receiptStageRunId ?? "unset"}, receipt_git_commit=${executionProof.receiptGitCommit ?? "unset"}`,
                ...(executionProof.pendingReason ? [`- pending_reason=${executionProof.pendingReason}`] : []),
            ]
            : ["- unavailable"]),
        "",
        "## Active Tracks",
        ...activeTracks.map((track) => `- ${track.trackId}: hypothesis=${track.hypothesis ?? "unset"}, novelty_basis=${track.noveltyBasis ?? "unset"}, main_metric=${track.mainMetric ?? "unset"}`),
        "",
        "## Bundles",
        ...bundleChecks.map((bundle) => `- ${bundle.dir}: track=${bundle.trackId ?? "unset"}, metric=${bundle.primaryBaselineMetric ?? "unset"}, target=${bundle.targetImprovement ?? "unset"}, innovation_points=${bundle.innovationPoints.join("; ") || "none"}, validation_steps=${bundle.validationSteps.join("; ") || "none"}, ablation_plan=${bundle.ablationPlan.join("; ") || "none"}, implementation_changed_files=${bundle.implementationChangedFiles.join("; ") || "none"}, integration_points=${bundle.implementationIntegrationPoints.join("; ") || "none"}, activation_signals=${bundle.implementationActivationSignals.join("; ") || "none"}, execution_command=${bundle.implementationExecutionCommand ?? "unset"}`),
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
export function buildCodeReviewPrompt(params) {
    const focus = params.reviewerRole === "researcher"
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
        JSON.stringify({
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
        }, null, 2),
        "```",
    ].join("\n");
}
export function parseCodeReviewResult(rawText, reviewerRole) {
    const fallback = {
        reviewerRole,
        verdict: "block",
        overallScore: 0,
        dimensionScores: {},
        criticalBlockers: [],
        majorIssues: [],
        suggestedRollbackStage: null,
        reviewedArtifacts: [],
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
    }
    catch (error) {
        return {
            ...fallback,
            criticalBlockers: [
                `Failed to parse structured code review JSON: ${error instanceof Error ? error.message : String(error)}`,
            ],
            summary: "Reviewer response JSON could not be parsed.",
        };
    }
}
export function aggregateCodeReviewRound(round, config) {
    const threshold = thresholdForCode(config);
    const results = round.attempts
        .map((attempt) => attempt.result)
        .filter((result) => Boolean(result));
    const reviewCount = results.length;
    const averageScore = reviewCount > 0
        ? results.reduce((sum, result) => sum + result.overallScore, 0) / reviewCount
        : null;
    const minScore = reviewCount > 0
        ? Math.min(...results.map((result) => result.overallScore))
        : null;
    const blockerCount = results.reduce((sum, result) => sum + result.criticalBlockers.length, 0);
    const verdictCounts = results.reduce((acc, result) => {
        acc[result.verdict] = (acc[result.verdict] ?? 0) + 1;
        return acc;
    }, {});
    const rollbackVotes = results
        .map((result) => result.suggestedRollbackStage)
        .filter((value) => Boolean(value));
    const suggestedRollbackStage = rollbackVotes.length > 0
        ? rollbackVotes.sort((left, right) => rollbackVotes.filter((value) => value === right).length -
            rollbackVotes.filter((value) => value === left).length)[0]
        : null;
    const approved = reviewCount >= Math.max(1, config.quorum) &&
        blockerCount === 0 &&
        (averageScore ?? 0) >= threshold.avg &&
        (minScore ?? 0) >= threshold.minSingle &&
        (verdictCounts.block ?? 0) === 0 &&
        (verdictCounts.rollback ?? 0) === 0;
    const status = approved
        ? "approved"
        : reviewCount >= Math.max(1, config.quorum) &&
            ((verdictCounts.block ?? 0) > 0 || (verdictCounts.rollback ?? 0) > 0)
            ? "rejected"
            : "reviewing";
    const aggregate = {
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
export function createCodeReviewRound(params) {
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
export async function evaluateCodeAutoReview(params) {
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
            reason: "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
        };
    }
    const aggregate = round.aggregate ?? aggregateCodeReviewRound(round, params.autoGate);
    if (aggregate.approved) {
        return { blocking: false, reason: null };
    }
    return {
        blocking: true,
        reason: aggregate.status === "rejected"
            ? `CODE innovation review rejected the current implementation packet. ${aggregate.summary}`
            : "CODE innovation review is still pending reviewer quorum.",
    };
}
export function defaultCodeReviewPanel() {
    return [...PANEL_ROLES];
}
export function evaluateCodeReviewQuorum(params) {
    const { round, autoGate, autoMode } = params;
    const threshold = autoGate.thresholds.code_to_experiment?.avg ?? 8.0;
    const requiredReviewers = Math.max(2, autoGate.quorum);
    const now = new Date().toISOString();
    if (!round) {
        return {
            passed: false,
            quorumMet: false,
            requiredReviewers,
            collectedReviewers: 0,
            averageScore: null,
            minScore: null,
            threshold,
            results: [],
            reason: "No code review round exists.",
            evaluatedAt: now,
        };
    }
    const completed = round.attempts.filter((a) => a.status === "completed" && a.result !== null);
    const results = completed.map((a) => ({
        reviewerRole: a.result.reviewerRole,
        score: a.result.overallScore,
        verdict: a.result.verdict,
    }));
    const quorumMet = results.length >= requiredReviewers;
    const scores = results.map((r) => r.score);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const minScore = scores.length > 0 ? Math.min(...scores) : null;
    const scoresPassing = averageScore !== null && averageScore >= threshold;
    const passed = quorumMet && scoresPassing;
    let reason;
    if (passed) {
        reason = `Quorum passed: ${results.length}/${requiredReviewers} reviews, avg=${averageScore?.toFixed(2)} >= ${threshold}.`;
    }
    else if (!quorumMet) {
        reason = `Quorum not met: ${results.length}/${requiredReviewers} reviews collected.`;
    }
    else {
        reason = `Scores below threshold: avg=${averageScore?.toFixed(2)} < ${threshold}.`;
    }
    return {
        passed,
        quorumMet,
        requiredReviewers,
        collectedReviewers: results.length,
        averageScore: averageScore !== null ? Math.round(averageScore * 100) / 100 : null,
        minScore: minScore !== null ? Math.round(minScore * 100) / 100 : null,
        threshold,
        results,
        reason,
        evaluatedAt: now,
    };
}
