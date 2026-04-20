import { asRecord, asStringArray, normalizeStage, pickBoolean, pickNumber, pickString, } from "./workflow-guard-core/coercion";
const TOKEN_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "under",
    "over",
    "method",
    "methods",
    "model",
    "models",
    "baseline",
    "dataset",
    "datasets",
    "experiment",
    "experiments",
    "results",
    "improves",
    "improve",
]);
function uniqueStrings(values) {
    const seen = new Set();
    const ordered = [];
    for (const value of values) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        ordered.push(normalized);
    }
    return ordered;
}
function collectTextTokens(text) {
    return new Set(String(text ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 4)
        .filter((entry) => !TOKEN_STOPWORDS.has(entry)));
}
export function normalizeExperimentInnerLoopContract(specLike) {
    const record = asRecord(specLike) ?? {};
    const innerLoop = asRecord(record.innerLoopPolicy ?? record.inner_loop_policy) ?? {};
    const budgetRecord = asRecord(record.budget) ?? {};
    return {
        mode: normalizeStage(innerLoop.mode ?? record.inner_loop_mode ?? record.innerLoopMode) ??
            "karpathy_fast_keep_discard",
        trialTimeBudgetMinutes: pickNumber(innerLoop, [
            "trialTimeBudgetMinutes",
            "trial_time_budget_minutes",
        ]) ??
            pickNumber(budgetRecord, [
                "trialTimeBudgetMinutes",
                "trial_time_budget_minutes",
            ]) ??
            5,
        strictComparableBudget: pickBoolean(innerLoop, [
            "strictComparableBudget",
            "strict_comparable_budget",
        ]) ?? true,
        requireOneChangeSignature: pickBoolean(innerLoop, [
            "requireOneChangeSignature",
            "require_one_change_signature",
        ]) ?? true,
        keepDiscardRule: pickString(innerLoop, ["keepDiscardRule", "keep_discard_rule"]) ??
            "primary_metric_keep_discard",
    };
}
export function normalizeExperimentOuterLoopPolicy(specLike) {
    const record = asRecord(specLike) ?? {};
    const outerLoop = asRecord(record.outerLoopPolicy ?? record.outer_loop_policy) ?? {};
    return {
        requireBaselineDatasetCoverageForEffectiveCandidates: pickBoolean(outerLoop, [
            "requireBaselineDatasetCoverageForEffectiveCandidates",
            "require_baseline_dataset_coverage_for_effective_candidates",
        ]) ?? true,
        innovationDeviationTolerance: normalizeStage(outerLoop.innovationDeviationTolerance ??
            outerLoop.innovation_deviation_tolerance) ?? "wide",
    };
}
export function buildOneChangeSignature(params) {
    const trackRecords = params.trackRecords ?? [];
    return (uniqueStrings(trackRecords.flatMap((track) => [
        ...asStringArray(track.innovation_points ?? track.innovationPoints),
        pickString(track, ["hypothesis"]),
        pickString(track, ["novelty_basis", "noveltyBasis"]),
    ]))[0] ?? null);
}
export function collectInnovationAnchorPoints(params) {
    const manifest = params.manifest ?? {};
    const trackRecords = params.trackRecords ?? [];
    const researchProgram = asRecord(manifest.research_program) ?? {};
    return uniqueStrings([
        pickString(researchProgram, ["goal", "problem_statement", "problemStatement"]),
        ...trackRecords.flatMap((track) => [
            ...asStringArray(track.innovation_points ?? track.innovationPoints),
            pickString(track, ["hypothesis"]),
            pickString(track, ["novelty_basis", "noveltyBasis"]),
        ]),
    ]);
}
export function collectBaselineDatasetEnvelope(params) {
    const manifest = params.manifest ?? {};
    const trackRecords = params.trackRecords ?? [];
    const researchProgram = asRecord(manifest.research_program);
    return uniqueStrings([
        ...asStringArray(researchProgram?.datasets),
        ...trackRecords.flatMap((track) => asStringArray(track.datasets ?? track.dataset_scope ?? track.datasetScope)),
    ]);
}
export function collectValidatedDatasetsFromLedger(params) {
    const ledger = asRecord(params.ledgerLike) ?? {};
    const experiments = Array.isArray(ledger.experiments) ? ledger.experiments : [];
    return uniqueStrings(experiments
        .map((entry) => asRecord(entry))
        .filter((entry) => Boolean(entry))
        .filter((entry) => {
        const experimentId = pickString(entry, ["experimentId", "experiment_id"]);
        const trackId = pickString(entry, ["trackId", "track_id"]);
        if (Array.isArray(params.experimentIds) &&
            params.experimentIds.length > 0 &&
            experimentId &&
            params.experimentIds.includes(experimentId)) {
            return true;
        }
        if (params.trackId && trackId === params.trackId) {
            return true;
        }
        return params.trackId == null && (!params.experimentIds || params.experimentIds.length === 0);
    })
        .flatMap((entry) => {
        const metadata = asRecord(entry.metadata) ?? {};
        return [
            ...asStringArray(metadata.datasets),
            ...asStringArray(metadata.dataset_names),
            ...asStringArray(metadata.validation_datasets),
            ...asStringArray(metadata.eval_datasets),
            ...asStringArray(metadata.benchmark_datasets),
        ];
    }));
}
export function deriveBaselineDatasetCoverage(params) {
    const baselineDatasets = uniqueStrings(params.baselineDatasets);
    const validatedDatasets = uniqueStrings(params.validatedDatasets);
    const missingDatasets = baselineDatasets.filter((entry) => !validatedDatasets.includes(entry));
    if (!params.required || baselineDatasets.length === 0) {
        return {
            status: "unknown",
            baselineDatasets,
            validatedDatasets,
            missingDatasets: [],
            summary: null,
        };
    }
    if (validatedDatasets.length === 0) {
        return {
            status: "unknown",
            baselineDatasets,
            validatedDatasets,
            missingDatasets,
            summary: "No validated dataset evidence is recorded yet, so baseline-dataset coverage cannot be judged.",
        };
    }
    if (missingDatasets.length === 0) {
        return {
            status: "covered",
            baselineDatasets,
            validatedDatasets,
            missingDatasets,
            summary: `Validated datasets cover the baseline dataset envelope: ${validatedDatasets.join(", ")}.`,
        };
    }
    return {
        status: missingDatasets.length === baselineDatasets.length ? "missing" : "partial",
        baselineDatasets,
        validatedDatasets,
        missingDatasets,
        summary: `Validated datasets still miss baseline-referenced datasets: ${missingDatasets.join(", ")}.`,
    };
}
export function deriveInnovationDeviation(params) {
    const anchorPoints = uniqueStrings(params.anchorPoints);
    const candidateText = params.candidateTexts.join("\n");
    if (anchorPoints.length === 0 || !candidateText.trim()) {
        return {
            status: "unknown",
            score: null,
            anchorPoints,
            summary: null,
        };
    }
    const anchorTokens = new Set();
    for (const anchor of anchorPoints) {
        for (const token of collectTextTokens(anchor)) {
            anchorTokens.add(token);
        }
    }
    const candidateTokens = collectTextTokens(candidateText);
    if (anchorTokens.size === 0 || candidateTokens.size === 0) {
        return {
            status: "unknown",
            score: null,
            anchorPoints,
            summary: null,
        };
    }
    let overlap = 0;
    for (const token of anchorTokens) {
        if (candidateTokens.has(token)) {
            overlap += 1;
        }
    }
    const score = overlap / anchorTokens.size;
    const tolerance = normalizeStage(params.tolerance) ?? "wide";
    const alignedThreshold = tolerance === "strict" ? 0.35 : 0.18;
    const partialThreshold = tolerance === "strict" ? 0.15 : 0.05;
    const status = score >= alignedThreshold
        ? "aligned"
        : score >= partialThreshold
            ? "partial_drift"
            : "broad_drift";
    return {
        status,
        score,
        anchorPoints,
        summary: status === "aligned"
            ? "Current candidate remains broadly aligned with the original innovation anchors."
            : status === "partial_drift"
                ? "Current candidate still overlaps with the original innovation anchors, but the emphasis is drifting."
                : "Current candidate shows little overlap with the original innovation anchors and may be drifting away from the intended innovation.",
    };
}
export function deriveMeasuredTrialDurationMinutes(params) {
    const ledger = asRecord(params.ledgerLike) ?? {};
    const experiments = Array.isArray(ledger.experiments) ? ledger.experiments : [];
    const preferred = new Set(params.preferredExperimentIds ?? []);
    const matching = experiments
        .map((entry) => asRecord(entry))
        .filter((entry) => Boolean(entry))
        .filter((entry) => {
        const experimentId = pickString(entry, ["experimentId", "experiment_id"]);
        return preferred.size === 0 || (experimentId != null && preferred.has(experimentId));
    })
        .sort((left, right) => {
        const leftTs = Date.parse(pickString(left, ["updatedAt", "updated_at", "completedAt", "completed_at"]) ??
            new Date(0).toISOString());
        const rightTs = Date.parse(pickString(right, ["updatedAt", "updated_at", "completedAt", "completed_at"]) ??
            new Date(0).toISOString());
        return rightTs - leftTs;
    });
    const entry = matching[0] ?? null;
    if (!entry) {
        return null;
    }
    const launchedAt = pickString(entry, [
        "launchedAt",
        "launched_at",
        "startedAt",
        "started_at",
    ]);
    const completedAt = pickString(entry, [
        "completedAt",
        "completed_at",
        "updatedAt",
        "updated_at",
    ]);
    const launchedMs = launchedAt ? Date.parse(launchedAt) : Number.NaN;
    const completedMs = completedAt ? Date.parse(completedAt) : Number.NaN;
    if (!Number.isFinite(launchedMs) || !Number.isFinite(completedMs) || completedMs < launchedMs) {
        return null;
    }
    return Math.round(((completedMs - launchedMs) / 60000) * 100) / 100;
}
export function deriveComparableTrialBudgetStatus(params) {
    if (!params.innerLoop.strictComparableBudget) {
        return "not_required";
    }
    if (params.innerLoop.trialTimeBudgetMinutes == null) {
        return "missing_budget";
    }
    if (params.measuredDurationMinutes == null) {
        return "unknown";
    }
    return params.measuredDurationMinutes <= params.innerLoop.trialTimeBudgetMinutes
        ? "within_budget"
        : "over_budget";
}
