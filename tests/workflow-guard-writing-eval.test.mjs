import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateWritingProcessReadiness,
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

test("evaluateWritingProcessReadiness prefers incremental drafting over full rebuilds", () => {
  const readiness = evaluateWritingProcessReadiness({
    writingContract: {
      requiredSections: ["abstract", "introduction", "results"],
      sectionOrder: ["abstract", "introduction", "results"],
    },
    writingSession: {
      status: "drafting",
      currentSection: "results",
      draftOrder: ["abstract", "introduction", "results"],
      finalizedSections: [],
      compileSafeSections: [],
      sectionPackets: {
        abstract: makeSectionPacket({
          status: "finalized",
          reviewVerdict: "publication_ready",
        }),
        introduction: makeSectionPacket({
          packetPath: "academic_writer/paper/sections/introduction.json",
          status: "drafted",
          reviewVerdict: null,
        }),
      },
      graphEvidenceCoverageStatus: "partial",
      pendingReason: null,
    },
  });

  assert.equal(readiness.processStatus, "drafting");
  assert.equal(readiness.rebuildNeeded, false);
  assert.deepEqual(readiness.missingSections, ["results"]);
  assert.equal(readiness.nextSuggestedSection, "results");
});

test("evaluateWritingProcessReadiness only flags rebuilds when no reusable draft state exists", () => {
  const readiness = evaluateWritingProcessReadiness({
    writingContract: {
      requiredSections: ["abstract", "introduction"],
      sectionOrder: ["abstract", "introduction"],
    },
    writingSession: {
      status: "missing",
      currentSection: null,
      draftOrder: [],
      finalizedSections: [],
      compileSafeSections: [],
      sectionPackets: {},
      graphEvidenceCoverageStatus: "missing",
      pendingReason: "No sections have been materialized yet.",
    },
  });

  assert.equal(readiness.processStatus, "bootstrapping");
  assert.equal(readiness.rebuildNeeded, true);
  assert.match(readiness.summary, /rebuild=No sections have been materialized yet/i);
});

test("evaluateWritingProcessReadiness treats finalized compile-safe sections as ready even without section packets", () => {
  const surveySections = [
    "abstract",
    "introduction",
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
    "conclusion",
  ];
  const readiness = evaluateWritingProcessReadiness({
    writingContract: {
      requiredSections: surveySections,
      sectionOrder: surveySections,
    },
    writingSession: {
      status: "draft_complete",
      currentSection: "conclusion",
      draftOrder: surveySections,
      finalizedSections: surveySections,
      compileSafeSections: surveySections,
      sectionPackets: {},
      graphEvidenceCoverageStatus: "complete",
      pendingReason: null,
    },
  });

  assert.equal(readiness.processStatus, "ready_for_submit");
  assert.equal(readiness.rebuildNeeded, false);
  assert.deepEqual(readiness.missingSections, []);
  assert.deepEqual(readiness.draftedSections, surveySections);
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
