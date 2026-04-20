import * as path from "node:path";
import { createHash } from "node:crypto";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { asRecord, pickString } from "./workflow-guard-core/coercion";
import { DEFAULT_EXPERIMENT_SEARCH_REVIEW_STATE_PATH, isExperimentSearchReviewCompleted, normalizeExperimentSearchReviewState, serializeExperimentSearchReviewState, } from "./workflow-guard-state/experiment-search-review.js";
export function getExperimentSearchReviewStatePath(projectRoot, configuredPath) {
    const targetPath = configuredPath?.trim() || DEFAULT_EXPERIMENT_SEARCH_REVIEW_STATE_PATH;
    return path.isAbsolute(targetPath) ? targetPath : path.join(projectRoot, targetPath);
}
export async function loadExperimentSearchReviewState(params) {
    const manifestRecord = asRecord(params.manifest);
    const configuredPath = pickString(asRecord(manifestRecord?.experiment_search) ?? {}, [
        "gitReviewStorePath",
        "git_review_store_path",
    ]);
    const raw = await readJsonIfExists(getExperimentSearchReviewStatePath(params.projectRoot, configuredPath));
    if (raw) {
        return normalizeExperimentSearchReviewState(raw);
    }
    return normalizeExperimentSearchReviewState(null);
}
export async function saveExperimentSearchReviewStateFile(params) {
    await writeJsonEnsured(getExperimentSearchReviewStatePath(params.projectRoot, params.state.stateFilePath), serializeExperimentSearchReviewState(params.state));
}
export function buildExperimentSearchReviewPacketFingerprint(params) {
    return createHash("sha1")
        .update(JSON.stringify({
        actionType: params.actionType,
        searchSessionId: params.searchSessionId,
        experimentId: params.experimentId,
        candidateBranch: params.candidateBranch,
        incumbentBranch: params.incumbentBranch,
        packet: params.packet,
    }))
        .digest("hex");
}
export function buildExperimentSearchReviewSummary(state) {
    const bits = [
        `status=${state.status}`,
        `micro_stage=${state.microStage ?? "unknown"}`,
        `action=${state.actionType ?? "unknown"}`,
        `planner=${state.plannerStatus}`,
        `analyzer=${state.analyzerStatus}`,
        `cross=${state.crossReviewerStatus}`,
        `approved=${state.actionApproved ? "true" : "false"}`,
    ];
    if (state.blockerCount > 0) {
        bits.push(`blockers=${state.blockerCount}`);
    }
    return bits.join(", ");
}
export function resolveExperimentSearchReviewNextOwner(params) {
    if (!params.state.actionType || params.state.actionStatus === "applied") {
        return null;
    }
    if (!isExperimentSearchReviewCompleted({ status: params.state.plannerStatus })) {
        return "planner";
    }
    if (!isExperimentSearchReviewCompleted({
        status: params.state.analyzerStatus,
        verdict: params.state.analyzerVerdict,
    })) {
        return "analyzer";
    }
    if (!isExperimentSearchReviewCompleted({
        status: params.state.crossReviewerStatus,
        verdict: params.state.crossReviewerVerdict,
    })) {
        return "cross-reviewer";
    }
    if (params.state.actionApproved) {
        return "coder";
    }
    return "researcher";
}
export function buildExperimentSearchReviewCommand(params) {
    switch (params.owner) {
        case "planner":
            return "Review the requested experiment-search git action, ensure the candidate stays inside the approved search envelope, and update planner/EXPERIMENT_SEARCH_GIT_PLAN.md plus experiment_search_review_state.planner_status.";
        case "analyzer":
            return "Audit the requested experiment-search git action for attribution purity, baseline fairness, retention-rule compliance, and git lineage safety, then update analyzer/EXPERIMENT_SEARCH_GIT_REASONABLENESS_REPORT.md plus experiment_search_review_state.analyzer_* fields.";
        case "cross-reviewer":
            return "Attack the requested experiment-search git action independently for confounds, branch pollution, premature promotion, or unsafe discard, then update cross-reviewer/EXPERIMENT_SEARCH_GIT_ATTACK_REPORT.md plus experiment_search_review_state.cross_reviewer_* fields.";
        case "researcher":
            return "Synthesize planner/analyzer/cross-reviewer findings for the experiment-search git action and set experiment_search_review_state.action_approved only when the operation is truly justified.";
        case "coder":
            return "Execute the approved experiment-search git action through research_workflow.apply_experiment_search_git_action; do not run git worktree/branch promotion commands directly.";
        default:
            return null;
    }
}
