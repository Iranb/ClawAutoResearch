import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

export type IdeaCatalystState = {
  status: string;
  contractVersion: number;
  mode: string;
  microStage: string | null;
  decompositionPacketPath: string;
  abstractionPacketPath: string;
  scoutingReportPath: string;
  gateDecisionPath: string;
  ideaFragmentsPath: string;
  rankedFragmentsPath: string;
  investigationRequisitionPath: string;
  sessionStatePath: string;
  targetDomain: string | null;
  sourceDomains: string[];
  bridgeCount: number;
  topFragmentId: string | null;
  requisitionRequired: boolean;
  lastRequisitionCycle: string | null;
  requisitionRetryBudget: number | null;
  requisitionSaturated: boolean;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export type CatalystIterationCoverageSummary = {
  totalQuestions: number;
  resolvedQuestions: number;
  partialQuestions: number;
  unexploredQuestions: number;
  unresolvedQuestions: number;
};

export type CatalystIterationRecord = {
  iteration: number;
  strategy: string;
  coverageSummary: CatalystIterationCoverageSummary;
  selectedDomains: string[];
  prunedDomains: string[];
  bridgeEvidenceTier: string | null;
  gateDecision: string | null;
  timestamp: string | null;
};

export type CatalystSessionState = {
  status: string;
  microStage: string | null;
  trigger: string | null;
  agentId: string | null;
  iterationCount: number;
  iterations: CatalystIterationRecord[];
  finalStrategy: string | null;
  bridgeEvidenceTier: string | null;
  selectedSourceDomains: string[];
  prunedSourceDomains: string[];
  topFragmentId: string | null;
  updatedAt: string | null;
};

const DEFAULT_DIR = "researcher/idea-catalyst";

export const DEFAULT_IDEA_CATALYST_PATHS = {
  decompositionPacketPath: `${DEFAULT_DIR}/DECOMPOSITION_PACKET.json`,
  abstractionPacketPath: `${DEFAULT_DIR}/ABSTRACTION_PACKET.json`,
  scoutingReportPath: `${DEFAULT_DIR}/SCOUTING_REPORT.json`,
  gateDecisionPath: `${DEFAULT_DIR}/GATE_DECISION.json`,
  ideaFragmentsPath: `${DEFAULT_DIR}/IDEA_FRAGMENTS.json`,
  rankedFragmentsPath: `${DEFAULT_DIR}/RANKED_FRAGMENTS.json`,
  investigationRequisitionPath: `${DEFAULT_DIR}/INVESTIGATION_REQUISITION.json`,
  sessionStatePath: `${DEFAULT_DIR}/CATALYST_SESSION_STATE.json`,
};

function normalizeCatalystIterationCoverageSummary(
  value: unknown
): CatalystIterationCoverageSummary {
  const record = asRecord(value) ?? {};
  return {
    totalQuestions: Math.max(
      0,
      Math.floor(pickNumber(record, ["totalQuestions", "total_questions"]) ?? 0)
    ),
    resolvedQuestions: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["resolvedQuestions", "resolved_questions"]) ?? 0
      )
    ),
    partialQuestions: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["partialQuestions", "partial_questions"]) ?? 0
      )
    ),
    unexploredQuestions: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["unexploredQuestions", "unexplored_questions"]) ?? 0
      )
    ),
    unresolvedQuestions: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["unresolvedQuestions", "unresolved_questions"]) ?? 0
      )
    ),
  };
}

function serializeCatalystIterationCoverageSummary(
  value: CatalystIterationCoverageSummary
): Record<string, unknown> {
  return {
    total_questions: value.totalQuestions,
    resolved_questions: value.resolvedQuestions,
    partial_questions: value.partialQuestions,
    unexplored_questions: value.unexploredQuestions,
    unresolved_questions: value.unresolvedQuestions,
  };
}

function normalizeCatalystIterationRecord(
  value: unknown,
  index: number
): CatalystIterationRecord {
  const record = asRecord(value) ?? {};
  return {
    iteration: Math.max(
      0,
      Math.floor(pickNumber(record, ["iteration"]) ?? index)
    ),
    strategy: pickString(record, ["strategy"]) ?? "initial_scan",
    coverageSummary: normalizeCatalystIterationCoverageSummary(
      record.coverageSummary ?? record.coverage_summary
    ),
    selectedDomains: asStringArray(
      record.selectedDomains ?? record.selected_domains
    ),
    prunedDomains: asStringArray(record.prunedDomains ?? record.pruned_domains),
    bridgeEvidenceTier: pickString(record, [
      "bridgeEvidenceTier",
      "bridge_evidence_tier",
    ]),
    gateDecision: pickString(record, ["gateDecision", "gate_decision"]),
    timestamp: pickString(record, ["timestamp"]),
  };
}

function serializeCatalystIterationRecord(
  value: CatalystIterationRecord
): Record<string, unknown> {
  return {
    iteration: value.iteration,
    strategy: value.strategy,
    coverage_summary: serializeCatalystIterationCoverageSummary(
      value.coverageSummary
    ),
    selected_domains: value.selectedDomains,
    pruned_domains: value.prunedDomains,
    bridge_evidence_tier: value.bridgeEvidenceTier,
    gate_decision: value.gateDecision,
    timestamp: value.timestamp,
  };
}

export function normalizeCatalystSessionState(
  value: unknown
): CatalystSessionState {
  const record = asRecord(value) ?? {};
  const iterations = Array.isArray(record.iterations)
    ? record.iterations.map((entry, index) =>
        normalizeCatalystIterationRecord(entry, index)
      )
    : [];
  return {
    status: normalizeStage(record.status) ?? "missing",
    microStage: normalizeStage(record.microStage ?? record.micro_stage),
    trigger: pickString(record, ["trigger"]),
    agentId: pickString(record, ["agentId", "agent_id"]),
    iterationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["iterationCount", "iteration_count"]) ??
          iterations.length
      )
    ),
    iterations,
    finalStrategy: pickString(record, ["finalStrategy", "final_strategy"]),
    bridgeEvidenceTier: pickString(record, [
      "bridgeEvidenceTier",
      "bridge_evidence_tier",
    ]),
    selectedSourceDomains: asStringArray(
      record.selectedSourceDomains ?? record.selected_source_domains
    ),
    prunedSourceDomains: asStringArray(
      record.prunedSourceDomains ?? record.pruned_source_domains
    ),
    topFragmentId: pickString(record, ["topFragmentId", "top_fragment_id"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

export function serializeCatalystSessionState(
  value: CatalystSessionState
): Record<string, unknown> {
  return {
    status: value.status,
    micro_stage: value.microStage,
    trigger: value.trigger,
    agent_id: value.agentId,
    iteration_count: value.iterationCount,
    iterations: value.iterations.map(serializeCatalystIterationRecord),
    final_strategy: value.finalStrategy,
    bridge_evidence_tier: value.bridgeEvidenceTier,
    selected_source_domains: value.selectedSourceDomains,
    pruned_source_domains: value.prunedSourceDomains,
    top_fragment_id: value.topFragmentId,
    updated_at: value.updatedAt,
  };
}

export function getCatalystSessionStateValidationErrors(
  state: CatalystSessionState
): string[] {
  const errors: string[] = [];
  if (state.iterationCount !== state.iterations.length) {
    errors.push(
      `CATALYST_SESSION_STATE.iteration_count must match iterations.length (current: ${state.iterationCount} vs ${state.iterations.length})`
    );
  }
  for (const [index, iteration] of state.iterations.entries()) {
    if (iteration.iteration !== index) {
      errors.push(
        `CATALYST_SESSION_STATE.iterations[${index}].iteration should equal ${index} (current: ${iteration.iteration})`
      );
    }
    if (!iteration.strategy) {
      errors.push(
        `CATALYST_SESSION_STATE.iterations[${index}].strategy is required`
      );
    }
  }
  return errors;
}

export function summarizeIdeaCatalystSessionState(value: unknown) {
  const state = normalizeCatalystSessionState(value);
  return {
    state,
    ready: state.status === "ready",
    validationErrors: getCatalystSessionStateValidationErrors(state),
  };
}

export function normalizeIdeaCatalystState(value: unknown): IdeaCatalystState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    contractVersion: Math.max(
      1,
      Math.floor(pickNumber(record, ["contractVersion", "contract_version"]) ?? 1)
    ),
    mode: pickString(record, ["mode"]) ?? "graph-first",
    microStage: normalizeStage(record.microStage ?? record.micro_stage),
    decompositionPacketPath:
      pickString(record, ["decompositionPacketPath", "decomposition_packet_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.decompositionPacketPath,
    abstractionPacketPath:
      pickString(record, ["abstractionPacketPath", "abstraction_packet_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.abstractionPacketPath,
    scoutingReportPath:
      pickString(record, ["scoutingReportPath", "scouting_report_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.scoutingReportPath,
    gateDecisionPath:
      pickString(record, ["gateDecisionPath", "gate_decision_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.gateDecisionPath,
    ideaFragmentsPath:
      pickString(record, ["ideaFragmentsPath", "idea_fragments_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.ideaFragmentsPath,
    rankedFragmentsPath:
      pickString(record, ["rankedFragmentsPath", "ranked_fragments_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.rankedFragmentsPath,
    investigationRequisitionPath:
      pickString(record, [
        "investigationRequisitionPath",
        "investigation_requisition_path",
      ]) ?? DEFAULT_IDEA_CATALYST_PATHS.investigationRequisitionPath,
    sessionStatePath:
      pickString(record, ["sessionStatePath", "session_state_path"]) ??
      DEFAULT_IDEA_CATALYST_PATHS.sessionStatePath,
    targetDomain: pickString(record, ["targetDomain", "target_domain"]),
    sourceDomains: asStringArray(record.sourceDomains ?? record.source_domains),
    bridgeCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["bridgeCount", "bridge_count"]) ?? 0)
    ),
    topFragmentId: pickString(record, ["topFragmentId", "top_fragment_id"]),
    requisitionRequired:
      pickBoolean(record, ["requisitionRequired", "requisition_required"]) ?? false,
    lastRequisitionCycle: pickString(record, [
      "lastRequisitionCycle",
      "last_requisition_cycle",
    ]),
    requisitionRetryBudget: (() => {
      const budget = pickNumber(record, [
        "requisitionRetryBudget",
        "requisition_retry_budget",
      ]);
      return typeof budget === "number" && Number.isFinite(budget)
        ? Math.max(0, Math.floor(budget))
        : null;
    })(),
    requisitionSaturated:
      pickBoolean(record, ["requisitionSaturated", "requisition_saturated"]) ?? false,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeIdeaCatalystState(
  value: IdeaCatalystState
): Record<string, unknown> {
  return {
    status: value.status,
    contract_version: value.contractVersion,
    mode: value.mode,
    micro_stage: value.microStage,
    decomposition_packet_path: value.decompositionPacketPath,
    abstraction_packet_path: value.abstractionPacketPath,
    scouting_report_path: value.scoutingReportPath,
    gate_decision_path: value.gateDecisionPath,
    idea_fragments_path: value.ideaFragmentsPath,
    ranked_fragments_path: value.rankedFragmentsPath,
    investigation_requisition_path: value.investigationRequisitionPath,
    session_state_path: value.sessionStatePath,
    target_domain: value.targetDomain,
    source_domains: value.sourceDomains,
    bridge_count: value.bridgeCount,
    top_fragment_id: value.topFragmentId,
    requisition_required: value.requisitionRequired,
    last_requisition_cycle: value.lastRequisitionCycle,
    requisition_retry_budget: value.requisitionRetryBudget,
    requisition_saturated: value.requisitionSaturated,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function getIdeaCatalystValidationErrors(state: IdeaCatalystState): string[] {
  const errors: string[] = [];
  if (!["missing", "pending", "ready", "requisition"].includes(state.status)) {
    errors.push(
      `PROJECT_MANIFEST.json.idea_catalyst.status = missing|pending|ready|requisition (current: ${state.status})`
    );
  }
  if (state.status === "ready") {
    if (!state.targetDomain) {
      errors.push("PROJECT_MANIFEST.json.idea_catalyst.target_domain is required");
    }
    if (!state.sourceDomains.length) {
      errors.push("PROJECT_MANIFEST.json.idea_catalyst.source_domains must contain at least one domain");
    }
  }
  return errors;
}

export function summarizeIdeaCatalystState(manifest: Record<string, unknown>) {
  const state = normalizeIdeaCatalystState(manifest.idea_catalyst);
  return {
    state,
    ready: state.status === "ready",
    validationErrors: getIdeaCatalystValidationErrors(state),
  };
}

export async function getIdeaCatalystStateSummary(params: { projectRoot: string }) {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? ""
    )) ?? {};
  return summarizeIdeaCatalystState(manifest);
}

export async function setIdeaCatalystState(params: {
  projectRoot: string;
  ideaCatalyst: Record<string, unknown>;
}) {
  const manifestPath =
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? "";
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const next = normalizeIdeaCatalystState({
    ...serializeIdeaCatalystState(current),
    ...params.ideaCatalyst,
  });
  manifest.idea_catalyst = serializeIdeaCatalystState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return summarizeIdeaCatalystState(manifest);
}
