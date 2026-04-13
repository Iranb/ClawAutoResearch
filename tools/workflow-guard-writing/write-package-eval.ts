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
  pendingReason?: string | null;
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

export type WritingProcessReadiness = {
  processStatus:
    | "missing"
    | "bootstrapping"
    | "outline_ready"
    | "drafting"
    | "section_review"
    | "manuscript_complete"
    | "compile_ready"
    | "ready_for_submit";
  requiredSections: string[];
  draftedSections: string[];
  reviewedSections: string[];
  finalizedSections: string[];
  compileSafeSections: string[];
  missingSections: string[];
  staleSections: string[];
  nextSuggestedSection: string | null;
  rebuildNeeded: boolean;
  rebuildReason: string | null;
  summary: string;
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

function orderedUniqueSections(params: {
  writingSession: WritingSessionStateLike;
  writingContract: WritingContractStateLike;
}): string[] {
  const ordered = [
    ...params.writingContract.sectionOrder,
    ...params.writingContract.requiredSections,
    ...params.writingSession.draftOrder,
    ...Object.keys(params.writingSession.sectionPackets),
  ]
    .map((entry) => normalizeStage(entry) ?? entry)
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const section of ordered) {
    if (seen.has(section)) {
      continue;
    }
    seen.add(section);
    result.push(section);
  }
  return result;
}

export function evaluateWritingProcessReadiness(params: {
  writingSession: WritingSessionStateLike;
  writingContract: WritingContractStateLike;
}): WritingProcessReadiness {
  const orderedSections = orderedUniqueSections(params);
  const requiredSections = params.writingContract.requiredSections
    .map((entry) => normalizeStage(entry) ?? entry)
    .filter(Boolean);
  const draftedSections = Object.entries(params.writingSession.sectionPackets)
    .filter(([, packet]) => {
      const status = normalizeStage(packet.status);
      return status !== "missing" && status !== "pending";
    })
    .map(([section]) => section);
  const reviewedSections = Object.entries(params.writingSession.sectionPackets)
    .filter(([, packet]) => {
      const verdict = normalizeStage(packet.reviewVerdict);
      return verdict === "publication_ready" || verdict === "ready";
    })
    .map(([section]) => section);
  const finalizedSections = params.writingSession.finalizedSections
    .map((entry) => normalizeStage(entry) ?? entry)
    .filter(Boolean);
  const compileSafeSections = params.writingSession.compileSafeSections
    .map((entry) => normalizeStage(entry) ?? entry)
    .filter(Boolean);
  const missingSections = requiredSections.filter(
    (section) => !draftedSections.includes(section)
  );
  const staleSections = Object.entries(params.writingSession.sectionPackets)
    .filter(([, packet]) => packet.stale || normalizeStage(packet.status) === "stale")
    .map(([section]) => section);
  const anyDrafts = draftedSections.length > 0;
  const anyReviews = reviewedSections.length > 0;
  const allRequiredDrafted =
    requiredSections.length > 0 &&
    requiredSections.every((section) => draftedSections.includes(section));
  const allRequiredReviewed =
    requiredSections.length > 0 &&
    requiredSections.every((section) => reviewedSections.includes(section));
  const allRequiredFinalized =
    requiredSections.length > 0 &&
    requiredSections.every((section) => finalizedSections.includes(section));
  const allRequiredCompileSafe =
    requiredSections.length > 0 &&
    requiredSections.every((section) => compileSafeSections.includes(section));

  const normalizedStatus = normalizeStage(params.writingSession.status);
  const noPackets = Object.keys(params.writingSession.sectionPackets).length === 0;
  const rebuildNeeded =
    noPackets &&
    !params.writingSession.currentSection &&
    draftedSections.length === 0 &&
    normalizedStatus !== "ready_for_submit" &&
    normalizedStatus !== "draft_complete";

  let processStatus: WritingProcessReadiness["processStatus"];
  if (
    normalizedStatus === "ready_for_submit" ||
    (allRequiredCompileSafe &&
      isRuntimeReadyStatus(params.writingSession.graphEvidenceCoverageStatus, [
        "covered",
        "ready",
        "complete",
        "completed",
      ]))
  ) {
    processStatus = "ready_for_submit";
  } else if (allRequiredCompileSafe) {
    processStatus = "compile_ready";
  } else if (allRequiredFinalized) {
    processStatus = "manuscript_complete";
  } else if (
    allRequiredDrafted &&
    (allRequiredReviewed || anyReviews || staleSections.length > 0)
  ) {
    processStatus = "section_review";
  } else if (
    rebuildNeeded ||
    normalizedStatus === "bootstrapping" ||
    normalizedStatus === "missing" ||
    normalizedStatus === "pending"
  ) {
    processStatus = "bootstrapping";
  } else if (allRequiredDrafted || anyDrafts || normalizedStatus === "draft_complete") {
    processStatus = "drafting";
  } else if (orderedSections.length > 0 || params.writingSession.currentSection) {
    processStatus = "outline_ready";
  } else {
    processStatus = "missing";
  }

  const nextSuggestedSection =
    missingSections[0] ??
    staleSections[0] ??
    orderedSections.find(
      (section) =>
        !finalizedSections.includes(section) && !compileSafeSections.includes(section)
    ) ??
    params.writingSession.currentSection ??
    null;

  const summary = [
    `process=${processStatus}`,
    `drafted=${draftedSections.length}/${requiredSections.length || orderedSections.length || 0}`,
    `reviewed=${reviewedSections.length}`,
    `finalized=${finalizedSections.length}`,
    `compile_safe=${compileSafeSections.length}`,
    nextSuggestedSection ? `next=${nextSuggestedSection}` : null,
    rebuildNeeded ? `rebuild=${params.writingSession.pendingReason ?? "full bootstrap needed"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    processStatus,
    requiredSections,
    draftedSections,
    reviewedSections,
    finalizedSections,
    compileSafeSections,
    missingSections,
    staleSections,
    nextSuggestedSection,
    rebuildNeeded,
    rebuildReason: rebuildNeeded
      ? params.writingSession.pendingReason ?? "No reusable section packets or drafts were detected."
      : null,
    summary,
  };
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
