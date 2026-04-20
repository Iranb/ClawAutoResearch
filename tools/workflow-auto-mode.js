import { createHash } from "node:crypto";
const DEFAULT_THRESHOLD = {
    avg: 8.2,
    minSingle: 7.5,
};
export const DEFAULT_WORKFLOW_AUTO_MODE = "off";
export const DEFAULT_WORKFLOW_AUTO_GATE = {
    enabled: false,
    allowAutonomousDone: false,
    maxReviewRounds: 2,
    maxMitigationRounds: 2,
    reviewTimeoutMinutes: 20,
    experimentMonitorCooldownMs: 5 * 60 * 1000,
    quorum: 2,
    thresholds: {
        code_to_experiment: {
            avg: 8.0,
            minSingle: 7.2,
        },
        review_to_write: {
            avg: 7.8,
            minSingle: 7.0,
        },
        write_to_submit: {
            avg: 8.2,
            minSingle: 7.5,
        },
        submit_to_done: {
            avg: 8.8,
            minSingle: 8.0,
        },
    },
};
function clampScore(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.min(10, value));
}
function normalizeThreshold(value, fallback) {
    const record = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const avg = clampScore(record.avg, fallback.avg);
    const minSingle = clampScore(record.minSingle, fallback.minSingle);
    return {
        avg,
        minSingle: Math.min(avg, minSingle),
    };
}
export function normalizeWorkflowAutoMode(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "conservative" || normalized === "aggressive") {
        return normalized;
    }
    return DEFAULT_WORKFLOW_AUTO_MODE;
}
export function normalizeWorkflowAutoGateConfig(value) {
    const record = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const thresholdRecord = record.thresholds &&
        typeof record.thresholds === "object" &&
        !Array.isArray(record.thresholds)
        ? record.thresholds
        : {};
    return {
        enabled: typeof record.enabled === "boolean"
            ? record.enabled
            : DEFAULT_WORKFLOW_AUTO_GATE.enabled,
        allowAutonomousDone: typeof record.allowAutonomousDone === "boolean"
            ? record.allowAutonomousDone
            : DEFAULT_WORKFLOW_AUTO_GATE.allowAutonomousDone,
        maxReviewRounds: typeof record.maxReviewRounds === "number" && Number.isFinite(record.maxReviewRounds)
            ? Math.max(1, Math.floor(record.maxReviewRounds))
            : DEFAULT_WORKFLOW_AUTO_GATE.maxReviewRounds,
        maxMitigationRounds: typeof record.maxMitigationRounds === "number" &&
            Number.isFinite(record.maxMitigationRounds)
            ? Math.max(1, Math.floor(record.maxMitigationRounds))
            : DEFAULT_WORKFLOW_AUTO_GATE.maxMitigationRounds,
        reviewTimeoutMinutes: typeof record.reviewTimeoutMinutes === "number" &&
            Number.isFinite(record.reviewTimeoutMinutes)
            ? Math.max(1, Math.floor(record.reviewTimeoutMinutes))
            : DEFAULT_WORKFLOW_AUTO_GATE.reviewTimeoutMinutes,
        experimentMonitorCooldownMs: typeof record.experimentMonitorCooldownMs === "number" &&
            Number.isFinite(record.experimentMonitorCooldownMs)
            ? Math.max(1_000, Math.floor(record.experimentMonitorCooldownMs))
            : DEFAULT_WORKFLOW_AUTO_GATE.experimentMonitorCooldownMs,
        quorum: typeof record.quorum === "number" && Number.isFinite(record.quorum)
            ? Math.max(1, Math.floor(record.quorum))
            : DEFAULT_WORKFLOW_AUTO_GATE.quorum,
        thresholds: {
            code_to_experiment: normalizeThreshold(thresholdRecord.code_to_experiment, DEFAULT_WORKFLOW_AUTO_GATE.thresholds.code_to_experiment),
            review_to_write: normalizeThreshold(thresholdRecord.review_to_write, DEFAULT_WORKFLOW_AUTO_GATE.thresholds.review_to_write),
            write_to_submit: normalizeThreshold(thresholdRecord.write_to_submit, DEFAULT_WORKFLOW_AUTO_GATE.thresholds.write_to_submit),
            submit_to_done: normalizeThreshold(thresholdRecord.submit_to_done, DEFAULT_WORKFLOW_AUTO_GATE.thresholds.submit_to_done ?? DEFAULT_THRESHOLD),
        },
    };
}
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
function normalizeStatus(value) {
    const status = readString(value)?.toLowerCase() ?? null;
    return status && status !== "unknown" ? status : null;
}
function includesPattern(items, pattern) {
    return items.some((item) => pattern.test(item));
}
function addReason(reasons, message) {
    if (!reasons.includes(message)) {
        reasons.push(message);
    }
}
export function buildWorkflowAutoModeRiskFingerprint(params) {
    if (params.riskLevel === "stable" && params.reasons.length === 0) {
        return null;
    }
    return createHash("sha1")
        .update(JSON.stringify({
        stage: readString(params.stage)?.toLowerCase() ?? null,
        riskLevel: params.riskLevel,
        reasons: [...params.reasons].sort(),
        missingStageSignals: [...(params.missingStageSignals ?? [])].sort(),
    }))
        .digest("hex");
}
export function evaluateWorkflowAutoModeRisk(params) {
    const configuredMode = normalizeWorkflowAutoMode(params.configuredMode);
    if (configuredMode === "off") {
        return {
            configuredMode,
            riskLevel: "stable",
            reasons: [],
            riskFingerprint: null,
        };
    }
    const manifest = asRecord(params.manifest);
    const stage = readString(params.stage)?.toLowerCase() ?? null;
    const missingStageSignals = Array.isArray(params.missingStageSignals)
        ? params.missingStageSignals.filter((item) => typeof item === "string")
        : [];
    const reasons = [];
    let riskLevel = "stable";
    if (params.regressed) {
        riskLevel = "severe";
        addReason(reasons, "Workflow regressed to an earlier stage.");
    }
    if ((params.revisionCount ?? 0) >= 2) {
        riskLevel = "severe";
        addReason(reasons, "Project has accumulated multiple revision rounds.");
    }
    const gates = asRecord(manifest.gates);
    for (const [gateName, rawStatus] of Object.entries(gates)) {
        const status = normalizeStatus(rawStatus);
        if (!status || status === "pending" || status === "approved" || status === "ready") {
            continue;
        }
        if (["blocked", "block", "failed", "fail", "rejected", "reject", "hold", "stopped"].includes(status)) {
            riskLevel = "severe";
            addReason(reasons, `Gate ${gateName} is ${status}.`);
            continue;
        }
        if (riskLevel === "stable") {
            riskLevel = "caution";
        }
        addReason(reasons, `Gate ${gateName} is ${status}.`);
    }
    const citationIntegrity = asRecord(manifest.citation_integrity);
    const citationStatus = normalizeStatus(citationIntegrity.verification_status);
    const hallucinatedCitationCount = readNumber(citationIntegrity.hallucinated_citation_count);
    if ((hallucinatedCitationCount ?? 0) > 0) {
        riskLevel = "severe";
        addReason(reasons, "Citation integrity reports hallucinated citations.");
    }
    else if ((stage === "write" || stage === "submit") &&
        citationStatus &&
        citationStatus !== "verified") {
        if (riskLevel === "stable") {
            riskLevel = "caution";
        }
        addReason(reasons, `Citation verification is ${citationStatus}.`);
    }
    const innovationReflection = asRecord(manifest.innovation_reflection);
    const innovationStatus = normalizeStatus(innovationReflection.status);
    if (innovationStatus &&
        ["stale", "missing", "pending"].includes(innovationStatus) &&
        ["idea", "plan", "code", "experiment", "analyze", "review", "write", "submit"].includes(stage ?? "")) {
        if (riskLevel === "stable") {
            riskLevel = "caution";
        }
        addReason(reasons, `Innovation reflection is ${innovationStatus}.`);
    }
    const paperIngestion = asRecord(manifest.paper_ingestion);
    const graphPresenceStatus = normalizeStatus(paperIngestion.graph_presence_status);
    if (["graph_build", "frontier_mapping", "idea"].includes(stage ?? "") &&
        graphPresenceStatus &&
        graphPresenceStatus !== "ready") {
        riskLevel = "severe";
        addReason(reasons, `Graph presence is ${graphPresenceStatus}.`);
    }
    if (paperIngestion.refresh_required === true) {
        if (riskLevel === "stable") {
            riskLevel = "caution";
        }
        addReason(reasons, "Paper ingestion indicates the graph needs refresh.");
    }
    const writingContract = asRecord(manifest.writing_contract);
    const templateRequired = writingContract.template_required === true;
    const templateStatus = normalizeStatus(writingContract.template_status);
    if ((stage === "write" || stage === "submit") &&
        templateRequired &&
        templateStatus &&
        !["ready", "optional"].includes(templateStatus)) {
        riskLevel = "severe";
        addReason(reasons, `Writing template status is ${templateStatus}.`);
    }
    if (includesPattern(missingStageSignals, /graph_presence_status|GRAPH_PRESENCE|missing canonical papers|graph_source_dir|paper_source_dir/i)) {
        riskLevel = "severe";
        addReason(reasons, "Graph-related stage signals are missing.");
    }
    if (includesPattern(missingStageSignals, /citation_integrity|verification_status|hallucination|CITATION_VERIFICATION/i)) {
        riskLevel = "severe";
        addReason(reasons, "Citation integrity stage signals are missing.");
    }
    if (includesPattern(missingStageSignals, /writing_contract\.template_path|appendix_theory|KG_STORYLINE|PAPER_PLAN\.md/i)) {
        if (riskLevel === "stable") {
            riskLevel = "caution";
        }
        addReason(reasons, "Writing-stage control artifacts are incomplete.");
    }
    return {
        configuredMode,
        riskLevel,
        reasons,
        riskFingerprint: buildWorkflowAutoModeRiskFingerprint({
            stage,
            riskLevel,
            reasons,
            missingStageSignals,
        }),
    };
}
export function resolveEffectiveWorkflowAutoMode(params) {
    const riskEvaluation = params.riskEvaluation ??
        evaluateWorkflowAutoModeRisk({
            configuredMode: params.configuredMode,
            stage: params.stage,
            regressed: params.regressed,
            revisionCount: params.revisionCount,
            missingStageSignals: params.missingStageSignals,
            manifest: params.manifest,
        });
    const configuredMode = riskEvaluation.configuredMode;
    if (configuredMode === "off") {
        return {
            configuredMode,
            effectiveMode: "off",
            riskLevel: riskEvaluation.riskLevel,
            reasons: riskEvaluation.reasons,
            riskFingerprint: riskEvaluation.riskFingerprint,
            mitigationStatus: null,
            mitigationRoundsStarted: 0,
            mitigationRoundsRemaining: 0,
        };
    }
    const reasons = [...riskEvaluation.reasons];
    let effectiveMode = configuredMode;
    const riskActive = riskEvaluation.riskLevel !== "stable";
    const mitigationStatus = params.mitigationStatus ?? null;
    const mitigationRoundsStarted = Math.max(0, params.mitigationRoundsStarted ?? 0);
    const mitigationMaxRounds = Math.max(1, params.mitigationMaxRounds ?? 1);
    const mitigationRoundsRemaining = mitigationRoundsStarted < mitigationMaxRounds;
    if (riskActive && mitigationStatus === "resolved") {
        addReason(reasons, "Auto discussion panel resolved the current risk, so the configured auto mode is preserved.");
        effectiveMode = configuredMode;
    }
    else if (riskActive && mitigationRoundsRemaining) {
        addReason(reasons, `Auto discussion rounds remaining before downgrade: ${mitigationMaxRounds - mitigationRoundsStarted}/${mitigationMaxRounds}.`);
        effectiveMode = configuredMode;
    }
    else if (configuredMode === "aggressive") {
        if (riskActive) {
            addReason(reasons, "Auto discussion rounds were exhausted without resolving the current risk, so auto mode was reduced.");
        }
        effectiveMode =
            riskEvaluation.riskLevel === "severe"
                ? "off"
                : riskEvaluation.riskLevel === "caution"
                    ? "conservative"
                    : "aggressive";
    }
    else if (configuredMode === "conservative") {
        if (riskActive && riskEvaluation.riskLevel === "severe") {
            addReason(reasons, "Auto discussion rounds were exhausted without resolving the current risk, so auto mode was reduced.");
        }
        effectiveMode = riskEvaluation.riskLevel === "severe" ? "off" : "conservative";
    }
    return {
        configuredMode,
        effectiveMode,
        riskLevel: riskEvaluation.riskLevel,
        reasons,
        riskFingerprint: riskEvaluation.riskFingerprint,
        mitigationStatus,
        mitigationRoundsStarted,
        mitigationRoundsRemaining: Math.max(0, mitigationMaxRounds - mitigationRoundsStarted),
    };
}
