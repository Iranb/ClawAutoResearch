import { asRecord, normalizeStage, pickBoolean, pickNumber, pickString, } from "../workflow-guard-core/coercion";
export const DEFAULT_STORYLINE_PLANNER_CANDIDATES_PATH = "academic_writer/SURVEY_STORYLINE_CANDIDATES.json";
export const DEFAULT_STORYLINE_PLANNER_JUDGE_PACKET_PATH = "academic_writer/SURVEY_STORYLINE_JUDGE_PACKET.json";
export const DEFAULT_STORYLINE_PLANNER_SELECTION_PATH = "academic_writer/SURVEY_STORYLINE_SELECTION.json";
export const DEFAULT_STORYLINE_PLANNER_SHADOW_SELECTION_PATH = "academic_writer/SURVEY_STORYLINE_SHADOW_SELECTION.json";
export function normalizeStorylinePlannerState(value) {
    const record = asRecord(value) ?? {};
    return {
        status: normalizeStage(record.status) ?? "missing",
        configuredMode: pickString(record, ["configuredMode", "configured_mode"]),
        activePrimaryMode: pickString(record, ["activePrimaryMode", "active_primary_mode"]),
        fallbackToHeuristic: pickBoolean(record, ["fallbackToHeuristic", "fallback_to_heuristic"]) ?? true,
        fallbackTriggered: pickBoolean(record, ["fallbackTriggered", "fallback_triggered"]) ?? false,
        fallbackReason: pickString(record, ["fallbackReason", "fallback_reason"]),
        shadowMode: pickString(record, ["shadowMode", "shadow_mode"]),
        shadowDiffStatus: normalizeStage(record.shadowDiffStatus ?? record.shadow_diff_status) ?? null,
        selectionConfidence: typeof pickNumber(record, ["selectionConfidence", "selection_confidence"]) === "number"
            ? Math.max(0, Math.min(1, pickNumber(record, ["selectionConfidence", "selection_confidence"]) ?? 0))
            : null,
        candidatePath: pickString(record, ["candidatePath", "candidate_path"]) ??
            DEFAULT_STORYLINE_PLANNER_CANDIDATES_PATH,
        judgePacketPath: pickString(record, ["judgePacketPath", "judge_packet_path"]) ??
            DEFAULT_STORYLINE_PLANNER_JUDGE_PACKET_PATH,
        selectionPath: pickString(record, ["selectionPath", "selection_path"]) ??
            DEFAULT_STORYLINE_PLANNER_SELECTION_PATH,
        shadowSelectionPath: pickString(record, ["shadowSelectionPath", "shadow_selection_path"]) ??
            DEFAULT_STORYLINE_PLANNER_SHADOW_SELECTION_PATH,
        selectionFingerprint: pickString(record, ["selectionFingerprint", "selection_fingerprint"]),
        pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
        lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    };
}
export function serializeStorylinePlannerState(value) {
    return {
        status: value.status,
        configured_mode: value.configuredMode,
        active_primary_mode: value.activePrimaryMode,
        fallback_to_heuristic: value.fallbackToHeuristic,
        fallback_triggered: value.fallbackTriggered,
        fallback_reason: value.fallbackReason,
        shadow_mode: value.shadowMode,
        shadow_diff_status: value.shadowDiffStatus,
        selection_confidence: value.selectionConfidence,
        candidate_path: value.candidatePath,
        judge_packet_path: value.judgePacketPath,
        selection_path: value.selectionPath,
        shadow_selection_path: value.shadowSelectionPath,
        selection_fingerprint: value.selectionFingerprint,
        pending_reason: value.pendingReason,
        last_updated_at: value.lastUpdatedAt,
    };
}
