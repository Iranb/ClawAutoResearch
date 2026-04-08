import test from "node:test";
import assert from "node:assert/strict";

import {
  isExternalReviewConclusionReady,
  isGraphGuidedWritingReadyForSubmit,
  isWritingSessionReadyForSubmit,
} from "../tools/workflow-guard-writing/write-package-eval.ts";

function makeSectionPacket(overrides = {}) {
  return {
    sectionClass: null,
    goal: null,
    allowedClaims: [],
    requiredGraphEvidencePointers: [],
    forbiddenUnsupportedClaims: [],
    missingCitationPlaceholders: [],
    requiredCitationCount: 0,
    requiredFigureIds: [],
    dependentSections: [],
    stale: false,
    packetPath: "academic_writer/paper/sections/abstract.json",
    draftPath: null,
    reviewPath: null,
    reviewVerdict: "publication_ready",
    status: "finalized",
    updatedAt: "2026-04-08T00:00:00.000Z",
    ...overrides,
  };
}

test("isWritingSessionReadyForSubmit accepts finalized packets with covered graph evidence", () => {
  const state = {
    status: "ready",
    currentSection: "abstract",
    draftOrder: ["abstract"],
    finalizedSections: ["abstract"],
    compileSafeSections: ["abstract"],
    sectionPackets: {
      abstract: makeSectionPacket(),
    },
    headlineClaimEvidenceStatus: "ready",
    graphEvidenceCoverageStatus: "covered",
    graphEvidenceCoverageSummary: "all claims grounded",
    citationPlanMode: "graph_only",
    externalScholarQueryMode: "none",
    futureScholarVerificationSkill: null,
    lastUpdatedAt: "2026-04-08T00:00:00.000Z",
    pendingReason: null,
  };

  assert.equal(isWritingSessionReadyForSubmit(state), true);
});

test("isWritingSessionReadyForSubmit blocks stale section packets", () => {
  const state = {
    status: "ready",
    currentSection: "abstract",
    draftOrder: ["abstract"],
    finalizedSections: ["abstract"],
    compileSafeSections: ["abstract"],
    sectionPackets: {
      abstract: makeSectionPacket({
        stale: true,
      }),
    },
    headlineClaimEvidenceStatus: "ready",
    graphEvidenceCoverageStatus: "covered",
    graphEvidenceCoverageSummary: "all claims grounded",
    citationPlanMode: "graph_only",
    externalScholarQueryMode: "none",
    futureScholarVerificationSkill: null,
    lastUpdatedAt: "2026-04-08T00:00:00.000Z",
    pendingReason: null,
  };

  assert.equal(isWritingSessionReadyForSubmit(state), false);
});

test("isGraphGuidedWritingReadyForSubmit ignores disabled graph guidance", () => {
  assert.equal(
    isGraphGuidedWritingReadyForSubmit({
      enabled: false,
      status: "missing",
      anchorIndexPath: null,
      frontierFiles: [],
      literaturePath: null,
      claimEvidencePacketPaths: [],
      requiredEvidencePointerCount: 0,
      coveredHeadlineClaimCount: 0,
      totalHeadlineClaimCount: 0,
      evidenceCoverageStatus: "missing",
      missingEvidenceClaims: ["claim-a"],
      citationSourceMode: "graph_only",
      scholarQueryReserved: false,
      scholarQuerySkillSlot: null,
      lastUpdatedAt: null,
      pendingReason: null,
    }),
    true
  );
});

test("isExternalReviewConclusionReady requires a recommendation", () => {
  assert.equal(
    isExternalReviewConclusionReady({
      status: "received",
      provider: "stanford",
      reviewSkill: "paperreview-submit",
      sourceLabel: "external",
      submissionId: "sub-1",
      submittedPdfPath: null,
      externalReviewPath: null,
      reviewResponsePath: null,
      overallRecommendation: null,
      requiredAction: null,
      lastPolledAt: null,
      lastUpdatedAt: null,
      pendingReason: null,
    }),
    false
  );
});
