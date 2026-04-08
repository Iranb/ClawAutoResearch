import { normalizeStage } from "../workflow-guard-core/coercion";

type WritingSectionPacketStateLike = {
  status: string;
  reviewVerdict: string | null;
  stale: boolean;
  forbiddenUnsupportedClaims: string[];
  missingCitationPlaceholders: string[];
};

type WritingSessionStateLike = {
  status: string;
  currentSection: string | null;
  draftOrder: string[];
  finalizedSections: string[];
  compileSafeSections: string[];
  sectionPackets: Record<string, WritingSectionPacketStateLike>;
  graphEvidenceCoverageStatus: string;
};

type GraphGuidedWritingStateLike = {
  enabled: boolean;
  status: string;
  evidenceCoverageStatus: string;
  missingEvidenceClaims: string[];
};

type ExternalReviewStateLike = {
  status: string;
  overallRecommendation: string | null;
};

type WritingContractStateLike = {
  requiredSections: string[];
  sectionOrder: string[];
};

type WritePackageStateLike = {
  status: string;
  winningTrackIds: string[];
  claimEvidenceMatrixPath: string | null;
  narrativeReportPath: string | null;
  trackVerdictsPath: string | null;
  unsupportedClaimsPath: string | null;
  baselineSummaryPath: string | null;
  researchSummaryPath: string | null;
  ablationSummaryPath: string | null;
  evaluationSummaryPath: string | null;
  figurePackPath: string | null;
  tablePackPath: string | null;
  proofPacketDir: string | null;
  citationCandidatesPath: string | null;
};

function isArrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isRuntimeReadyStatus(
  value: unknown,
  readyStates: readonly string[]
): boolean {
  const normalized = normalizeStage(value);
  return normalized ? readyStates.includes(normalized) : false;
}

export function areWritingSectionPacketsReady(
  state: WritingSessionStateLike
): boolean {
  const packets = Object.values(state.sectionPackets);
  return (
    packets.length > 0 &&
    packets.every((packet) => {
      const packetStatus = normalizeStage(packet.status);
      const reviewVerdict = normalizeStage(packet.reviewVerdict);
      return (
        !packet.stale &&
        packet.forbiddenUnsupportedClaims.length === 0 &&
        packet.missingCitationPlaceholders.length === 0 &&
        (packetStatus === "finalized" ||
          packetStatus === "locked" ||
          packetStatus === "compile_safe" ||
          reviewVerdict === "publication_ready")
      );
    })
  );
}

export function isWritingSessionReadyForSubmit(
  state: WritingSessionStateLike
): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "ready_for_submit",
      "ready",
      "finalized",
      "complete",
      "completed",
    ]) &&
    areWritingSectionPacketsReady(state) &&
    isRuntimeReadyStatus(state.graphEvidenceCoverageStatus, [
      "covered",
      "ready",
      "complete",
      "completed",
    ])
  );
}

export function isGraphGuidedWritingReadyForSubmit(
  state: GraphGuidedWritingStateLike
): boolean {
  if (!state.enabled) {
    return true;
  }
  return (
    isRuntimeReadyStatus(state.status, [
      "ready",
      "covered",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.evidenceCoverageStatus, [
      "covered",
      "ready",
      "complete",
      "completed",
    ]) &&
    state.missingEvidenceClaims.length === 0
  );
}

export function isExternalReviewConclusionReady(
  state: ExternalReviewStateLike
): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "received",
      "ready",
      "complete",
      "completed",
      "accepted_for_handoff",
    ]) &&
    Boolean(state.overallRecommendation)
  );
}

export function getWritingSectionContractViolations(params: {
  writingSession: WritingSessionStateLike;
  writingContract: WritingContractStateLike;
}): string[] {
  const violations: string[] = [];
  const finalLikeStatuses = new Set(["finalized", "frozen"]);
  for (const section of params.writingContract.requiredSections) {
    const normalized = normalizeStage(section) ?? section;
    const packet = params.writingSession.sectionPackets[normalized];
    if (!packet) {
      violations.push(`writing_session missing section packet for required section ${section}`);
      continue;
    }
    if (packet.status === "stale" || packet.stale) {
      violations.push(`section packet ${section} is stale`);
    }
    if (
      params.writingSession.finalizedSections.includes(normalized) &&
      !finalLikeStatuses.has(packet.status)
    ) {
      violations.push(
        `finalized section ${section} must have packet status finalized/frozen (current: ${packet.status})`
      );
    }
    if (
      params.writingSession.compileSafeSections.includes(normalized) &&
      !params.writingSession.finalizedSections.includes(normalized)
    ) {
      violations.push(`compile_safe section ${section} must also be finalized`);
    }
  }
  const currentSection = params.writingSession.currentSection;
  if (currentSection) {
    const packet = params.writingSession.sectionPackets[currentSection];
    if (packet && packet.status === "frozen") {
      violations.push(`current_section ${currentSection} cannot be frozen`);
    }
  }
  return violations;
}

export function getWritePackageValidationErrors(
  state: WritePackageStateLike
): string[] {
  const errors: string[] = [];
  if (!["ready", "assembled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.write_package.status must be ready/assembled/approved (current: ${state.status})`
    );
  }
  if (state.winningTrackIds.length === 0) {
    errors.push("PROJECT_MANIFEST.json.write_package.winning_track_ids is required");
  }
  for (const [field, value] of [
    ["claim_evidence_matrix_path", state.claimEvidenceMatrixPath],
    ["narrative_report_path", state.narrativeReportPath],
    ["track_verdicts_path", state.trackVerdictsPath],
    ["unsupported_claims_path", state.unsupportedClaimsPath],
    ["baseline_summary_path", state.baselineSummaryPath],
    ["research_summary_path", state.researchSummaryPath],
    ["ablation_summary_path", state.ablationSummaryPath],
    ["evaluation_summary_path", state.evaluationSummaryPath],
    ["figure_pack_path", state.figurePackPath],
    ["table_pack_path", state.tablePackPath],
    ["proof_packet_dir", state.proofPacketDir],
    ["citation_candidates_path", state.citationCandidatesPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.write_package.${field} is required`);
    }
  }
  return errors;
}
