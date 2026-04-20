import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { asRecord, asString } from "./workflow-guard-core/coercion";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
export const AUTO_ITERATOR_STARTED_TIMEOUT_MS = 5 * 60 * 1000;
function normalizeForStableJson(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForStableJson(entry));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
        return Object.fromEntries(entries.map(([key, nestedValue]) => [key, normalizeForStableJson(nestedValue)]));
    }
    return value;
}
function stableJsonHash(value) {
    return createHash("sha256")
        .update(JSON.stringify(normalizeForStableJson(value)))
        .digest("hex")
        .slice(0, 16);
}
function parseIsoMillis(value) {
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}
function latestIso(values) {
    let latestValue = null;
    let latestMillis = null;
    for (const value of values) {
        const millis = parseIsoMillis(value ?? null);
        if (millis == null) {
            continue;
        }
        if (latestMillis == null || millis > latestMillis) {
            latestMillis = millis;
            latestValue = value ?? null;
        }
    }
    return latestValue;
}
async function getFileUpdatedAt(targetPath) {
    try {
        const stats = await fs.stat(targetPath);
        return stats.mtime.toISOString();
    }
    catch {
        return null;
    }
}
function readTrackEvidencePaths(projectRoot, trackRegistry) {
    if (!projectRoot || !Array.isArray(trackRegistry?.tracks)) {
        return [];
    }
    const paths = new Set();
    for (const entry of trackRegistry.tracks) {
        const track = asRecord(entry);
        if (!track) {
            continue;
        }
        const reasoningPacketDir = asString(track.reasoning_packet_dir ?? track.reasoningPacketDir);
        if (!reasoningPacketDir) {
            continue;
        }
        const resolvedPacketPath = resolveProjectArtifactPath(projectRoot, reasoningPacketDir);
        if (!resolvedPacketPath) {
            continue;
        }
        const normalizedPath = path.basename(resolvedPacketPath).toUpperCase() === "GRAPH_EVIDENCE.JSON"
            ? resolvedPacketPath
            : path.join(resolvedPacketPath, "GRAPH_EVIDENCE.json");
        paths.add(normalizedPath);
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
}
function normalizeMissingSignals(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
        .sort((left, right) => left.localeCompare(right));
}
function readSnapshotStateKey(snapshot) {
    return {
        projectId: asString(snapshot.projectId),
        projectRoot: asString(snapshot.projectRoot),
        currentStage: asString(snapshot.currentStage),
        currentMicroStage: asString(snapshot.currentMicroStage),
        ownerAgent: asString(snapshot.ownerAgent),
        recommendedOwner: asString(snapshot.recommendedOwner),
        nextAction: asString(snapshot.nextAction),
        resumeAction: asString(snapshot.resumeAction),
        blockingReason: asString(snapshot.blockingReason),
        workflowEvidenceStatus: asString(snapshot.workflowEvidenceStatus),
        workflowEvidenceSummary: asString(snapshot.workflowEvidenceSummary),
        missingStageSignals: normalizeMissingSignals(snapshot.missingStageSignals),
        graphPresenceStatus: asString(snapshot.graphPresenceStatus),
        paperIngestionRuntimeStatus: asString(snapshot.paperIngestionRuntimeStatus),
        researchProgramActiveTrackCount: typeof snapshot.researchProgramActiveTrackCount === "number"
            ? snapshot.researchProgramActiveTrackCount
            : null,
    };
}
export function normalizeWorkflowAutoIteratorAudit(value) {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const schemaVersionRaw = record.schemaVersion;
    const schemaVersion = typeof schemaVersionRaw === "number" && Number.isFinite(schemaVersionRaw)
        ? Math.trunc(schemaVersionRaw)
        : null;
    const explicitStatus = asString(record.status);
    const legacyResult = asRecord(record.result);
    const result = legacyResult ?? asRecord(record.result_payload);
    const status = explicitStatus
        ? (explicitStatus ?? "unknown")
        : result
            ? "completed"
            : "unknown";
    const startedAt = asString(record.startedAt ?? record.started_at);
    const completedAt = asString(record.completedAt ?? record.completed_at);
    const failedAt = asString(record.failedAt ?? record.failed_at);
    const updatedAt = asString(record.updatedAt ?? record.updated_at) ?? completedAt ?? failedAt ?? startedAt;
    const runId = asString(record.runId ?? record.run_id) ??
        asString(result?.runId ?? result?.run_id);
    const summary = asString(record.summary) ??
        asString(result?.blockingReason ?? result?.blocking_reason) ??
        (result
            ? `Auto iterator ${asString(result.stageBefore ?? result.stage_before) ?? "unknown"} -> ${asString(result.stageAfter ?? result.stage_after) ?? "unknown"}`
            : null);
    return {
        schemaVersion,
        status: status === "started" ||
            status === "completed" ||
            status === "failed" ||
            status === "aborted" ||
            status === "timed_out" ||
            status === "superseded"
            ? status
            : status === "missing"
                ? "missing"
                : "unknown",
        updatedAt,
        startedAt,
        completedAt,
        failedAt,
        runId,
        summary,
        basisRevision: asString(record.basisRevision ?? record.basis_revision),
        basisUpdatedAt: asString(record.basisUpdatedAt ?? record.basis_updated_at),
        result,
        error: asRecord(record.error),
    };
}
export function deriveEffectiveWorkflowAutoIteratorAudit(params) {
    const audit = params.audit;
    if (!audit || audit.status !== "started") {
        return audit;
    }
    const nowMillis = typeof params.now === "number"
        ? params.now
        : parseIsoMillis(typeof params.now === "string" ? params.now : null) ?? Date.now();
    const startedMillis = parseIsoMillis(audit.updatedAt ?? audit.startedAt);
    if (startedMillis == null || nowMillis - startedMillis < AUTO_ITERATOR_STARTED_TIMEOUT_MS) {
        return audit;
    }
    const timeoutMinutes = Math.round(AUTO_ITERATOR_STARTED_TIMEOUT_MS / 60000);
    return {
        ...audit,
        status: "timed_out",
        summary: audit.summary ??
            `Auto iterator run started at ${audit.updatedAt ?? audit.startedAt ?? "unknown time"} exceeded the ${timeoutMinutes}-minute terminal-audit window.`,
    };
}
export async function deriveWorkflowStateUpdatedAt(params) {
    const fileTimestamps = [];
    if (params.projectRoot) {
        const projectRoot = params.projectRoot;
        const trackEvidencePaths = readTrackEvidencePaths(projectRoot, params.trackRegistry);
        const candidatePaths = [
            path.join(projectRoot, "PROJECT_MANIFEST.json"),
            path.join(projectRoot, "TRACK_REGISTRY.json"),
            path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json"),
            path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
            ...trackEvidencePaths,
        ];
        const stats = await Promise.all(candidatePaths.map((targetPath) => getFileUpdatedAt(targetPath)));
        fileTimestamps.push(...stats);
    }
    return latestIso([
        asString(params.manifest?.updated_at),
        asString(params.manifest?.updatedAt),
        asString(asRecord(params.manifest?.audit)?.updated_at),
        asString(asRecord(params.manifest?.audit)?.updatedAt),
        asString(params.trackRegistry?.updated_at),
        asString(params.trackRegistry?.updatedAt),
        asString(params.mailbox?.updatedAt),
        asString(params.experimentLedger?.updatedAt),
        ...fileTimestamps,
    ]);
}
export async function deriveWorkflowStateRevision(params) {
    if (!params.projectRoot) {
        return null;
    }
    const trackEvidencePaths = readTrackEvidencePaths(params.projectRoot, params.trackRegistry);
    const trackEvidenceMetadata = await Promise.all(trackEvidencePaths.map(async (targetPath) => ({
        path: targetPath,
        updatedAt: await getFileUpdatedAt(targetPath),
    })));
    return stableJsonHash({
        snapshot: readSnapshotStateKey(params.snapshot),
        trackEvidenceMetadata,
    });
}
function doesAuditMatchSnapshot(params) {
    const auditResult = params.audit.result;
    if (!auditResult) {
        return null;
    }
    const auditMissingSignals = normalizeMissingSignals(auditResult.missingStageSignals ?? auditResult.missing_stage_signals);
    const snapshotMissingSignals = normalizeMissingSignals(params.snapshot.missingStageSignals);
    return (asString(auditResult.projectRoot ?? auditResult.project_root) ===
        asString(params.snapshot.projectRoot) &&
        asString(auditResult.projectId ?? auditResult.project_id) ===
            asString(params.snapshot.projectId) &&
        asString(auditResult.stageAfter ?? auditResult.stage_after) ===
            asString(params.snapshot.currentStage) &&
        asString(auditResult.ownerAfter ?? auditResult.owner_after) ===
            asString(params.snapshot.ownerAgent) &&
        asString(auditResult.blockingReason ?? auditResult.blocking_reason) ===
            asString(params.snapshot.blockingReason) &&
        JSON.stringify(auditMissingSignals) === JSON.stringify(snapshotMissingSignals));
}
function buildAuditSummary(params) {
    const audit = params.audit;
    if (!audit) {
        return "No auto-iterator audit recorded yet.";
    }
    const stageBefore = asString(audit.result?.stageBefore ?? audit.result?.stage_before) ?? "unknown";
    const stageAfter = asString(audit.result?.stageAfter ?? audit.result?.stage_after) ?? "unknown";
    const transition = `${stageBefore} -> ${stageAfter}`;
    if (audit.status === "timed_out") {
        return `Auto-iterator run timed out after starting at ${audit.startedAt ?? audit.updatedAt ?? "unknown time"} without a terminal audit.`;
    }
    if (audit.status === "superseded") {
        return `A newer auto-iterator run superseded the prior in-flight audit at ${audit.updatedAt ?? "unknown time"}.`;
    }
    if (audit.status === "aborted") {
        return `Auto-iterator run aborted at ${audit.updatedAt ?? "unknown time"} before writing a completed audit.`;
    }
    if (params.freshness === "stale") {
        return `Stale auto-iterator audit (${audit.status}) from ${audit.updatedAt ?? "unknown time"} for ${transition}; trust the live snapshot instead.`;
    }
    if (audit.status === "started") {
        return `Auto-iterator run started at ${audit.updatedAt ?? "unknown time"} and has not written a terminal audit yet.`;
    }
    if (audit.status === "failed") {
        return `Last auto-iterator run failed at ${audit.updatedAt ?? "unknown time"}${audit.summary ? `: ${audit.summary}` : "."}`;
    }
    if (params.matchesLiveState === true) {
        return `Fresh auto-iterator audit (${audit.status}) at ${audit.updatedAt ?? "unknown time"} for ${transition}.`;
    }
    return audit.summary ?? `Auto-iterator audit ${audit.status} at ${audit.updatedAt ?? "unknown time"}.`;
}
export async function resolveWorkflowRuntimeHealth(params) {
    const now = new Date().toISOString();
    const [stateUpdatedAt, stateRevision] = await Promise.all([
        deriveWorkflowStateUpdatedAt({
            projectRoot: params.projectRoot,
            manifest: params.manifest,
            trackRegistry: params.trackRegistry,
            mailbox: params.mailbox,
            experimentLedger: params.experimentLedger,
        }),
        deriveWorkflowStateRevision({
            projectRoot: params.projectRoot,
            snapshot: params.snapshot,
            trackRegistry: params.trackRegistry,
        }),
    ]);
    const audit = deriveEffectiveWorkflowAutoIteratorAudit({
        audit: normalizeWorkflowAutoIteratorAudit(params.autoIteratorAudit),
        now,
    });
    if (!audit) {
        return {
            stateRevision,
            stateUpdatedAt,
            autoIteratorAuditStatus: "missing",
            autoIteratorAuditFreshness: "missing",
            autoIteratorAuditUpdatedAt: null,
            autoIteratorAuditRunId: null,
            autoIteratorAuditStageBefore: null,
            autoIteratorAuditStageAfter: null,
            autoIteratorAuditMatchesLiveState: null,
            autoIteratorAuditSummary: "No auto-iterator audit recorded yet.",
        };
    }
    const matchesLiveState = doesAuditMatchSnapshot({
        audit,
        snapshot: params.snapshot,
    });
    const auditUpdatedMillis = parseIsoMillis(audit.updatedAt);
    const stateUpdatedMillis = parseIsoMillis(stateUpdatedAt);
    let freshness = "unknown";
    if (audit.basisRevision && stateRevision) {
        freshness = audit.basisRevision === stateRevision ? "fresh" : "stale";
    }
    else if (matchesLiveState === true) {
        freshness = "fresh";
    }
    else if (auditUpdatedMillis != null &&
        stateUpdatedMillis != null &&
        auditUpdatedMillis < stateUpdatedMillis) {
        freshness = "stale";
    }
    else if (matchesLiveState === false) {
        freshness = "stale";
    }
    else if (audit.status === "started") {
        freshness = "fresh";
    }
    if (audit.status === "timed_out" ||
        audit.status === "superseded" ||
        audit.status === "aborted") {
        freshness = "stale";
    }
    return {
        stateRevision,
        stateUpdatedAt,
        autoIteratorAuditStatus: audit.status,
        autoIteratorAuditFreshness: freshness,
        autoIteratorAuditUpdatedAt: audit.updatedAt,
        autoIteratorAuditRunId: audit.runId,
        autoIteratorAuditStageBefore: asString(audit.result?.stageBefore ?? audit.result?.stage_before) ?? null,
        autoIteratorAuditStageAfter: asString(audit.result?.stageAfter ?? audit.result?.stage_after) ?? null,
        autoIteratorAuditMatchesLiveState: matchesLiveState,
        autoIteratorAuditSummary: buildAuditSummary({
            audit,
            freshness,
            matchesLiveState,
        }),
    };
}
