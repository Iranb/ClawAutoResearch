import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  setBrainstormCycleState,
  setIdleResearchState,
  setIdeationContractState,
  setOrchestrationState,
  setPaperStoryState,
  setResearchProgramState,
  setReviewPressurePacketState,
  setWritePackageState,
} from "../tools/workflow-guard-setters/research-state-setters.ts";
import {
  setExternalReviewState,
  setGraphGuidedWritingState,
  setReviewSessionState,
  setWritingContractState,
  setWritingSessionState,
} from "../tools/workflow-guard-setters/writing-state-setters.ts";
import {
  setFigureQcState,
  setCitationCollectionState,
  setExperimentSearchState,
  setPaperIngestionState,
  setPaperQcState,
} from "../tools/workflow-guard-setters/ingestion-state-setters.ts";
import {
  setReviewIssueTrackerState,
} from "../tools/workflow-guard-setters/review-state-setters.ts";

async function makeProjectRoot(manifest) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-setters-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("research setters persist idle research disabling and brainstorm cycle paths", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    idle_research: {
      enabled: true,
      topic: "graph search",
      status: "pending",
      cooldown_minutes: 30,
    },
    brainstorm_cycle: {
      status: "pending",
      topic: "graph search",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const idleResult = await setIdleResearchState({
    projectRoot,
    idleResearch: {
      enabled: false,
      status: "ready",
    },
  });
  assert.equal(idleResult.state.enabled, false);
  assert.equal(idleResult.state.status, "disabled");

  const brainstormResult = await setBrainstormCycleState({
    projectRoot,
    brainstormCycle: {
      trackId: "track/a",
      topic: "graph search",
      basisStage: "idea",
      provider: "workflow_core_brainstorm",
      providerMode: "core",
      contractVersion: 1,
      rounds: [],
    },
  });
  assert.equal(brainstormResult.state.trackId, "track_a");
  assert.ok(Array.isArray(brainstormResult.validationErrors));
});

test("writing setters copy bundled templates and update session state", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    writing_contract: {
      template_required: false,
    },
    writing_session: {
      status: "missing",
      current_section: "abstract",
      draft_order: [],
      finalized_sections: [],
      compile_safe_sections: [],
      section_packets: {},
      headline_claim_evidence_status: "pending",
      graph_evidence_coverage_status: "pending",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
      future_scholar_verification_skill: "future/literature-dehallucination",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const contractResult = await setWritingContractState({
    projectRoot,
    writingContract: {
      paperMode: "conference",
    },
  });
  assert.equal(contractResult.templateReady, true);
  assert.equal(contractResult.templateCopyStatus, "ready");
  assert.ok(contractResult.projectTemplateResolvedPath);
  await fs.access(contractResult.projectTemplateResolvedPath);

  const sessionResult = await setWritingSessionState({
    projectRoot,
    writingSession: {
      currentSection: "abstract",
      draftOrder: ["abstract"],
      finalizedSections: ["abstract"],
      compileSafeSections: ["abstract"],
      sectionPackets: {
        abstract: {
          section: "abstract",
          status: "finalized",
          packetPath: "academic_writer/abstract.json",
          draftPath: "academic_writer/abstract.md",
          reviewPath: "reviewer/abstract.md",
          allowedClaims: [],
          requiredGraphEvidencePointers: [],
          forbiddenUnsupportedClaims: [],
          missingCitationPlaceholders: [],
          requiredCitationCount: 0,
          requiredFigureIds: [],
          dependentSections: [],
          stale: false,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
    },
  });
  assert.equal(sessionResult.state.currentSection, "abstract");
  assert.equal(sessionResult.readyForSubmit, true);
});

test("review setters persist review issue counts and review pressure metadata", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    review_issue_tracker: {
      status: "missing",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
    },
    review_pressure_packet: {
      status: "missing",
    },
    review_session: {
      status: "missing",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const issueResult = await setReviewIssueTrackerState({
    projectRoot,
    reviewIssueTracker: {
      issues: [
        {
          issue_id: "issue-1",
          severity: "critical",
          status: "open",
        },
      ],
    },
  });
  assert.equal(issueResult.hardBlockersOpen, true);
  assert.equal(issueResult.mediumOrHigherIssuesNeedDisposition, true);
  assert.equal(issueResult.revisionControl.status, "active");

  const pressureResult = await setReviewPressurePacketState({
    projectRoot,
    reviewPressurePacket: {
      status: "ready",
      rejectFirstReviewPath: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      noveltyAttackPath: "reviewer/story-pressure/NOVELTY_ATTACK.md",
      unsupportedClaimAuditPath:
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      reverseOutlinePath: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      figureTableQcPath: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
      limitationAuditPath: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    },
  });
  assert.equal(pressureResult.state.status, "ready");

  const sessionResult = await setReviewSessionState({
    projectRoot,
    reviewSession: {
      status: "ready",
      stageScope: "write",
      round: 1,
      reviewPacketPath: "reviewer/REVIEW_PACKET.json",
      graphEvidenceSummaryPath: "reviewer/GRAPH_EVIDENCE_SUMMARY.md",
      latestReviewPath: "reviewer/REVIEW_REPORT.md",
      verdict: "ready",
      rubric: { originality: 0.8, quality: 0.9 },
      reviewerSummary: "looks good",
      actionItems: ["none"],
      blockingArtifacts: [],
    },
  });
  assert.equal(sessionResult.state.round, 1);
  assert.equal(sessionResult.revisionControl.status, "active");
});

test("ingestion setters persist paper ingestion merges and QC state", async (t) => {
  const projectRoot = await makeProjectRoot({
    project_id: "demo-project",
    paper_ingestion: {
      runtime_status: "idle",
    },
    experiment_search: {
      status: "not_started",
    },
    paper_qc: {
      status: "missing",
    },
    citation_collection: {
      status: "missing",
    },
    figure_qc: {
      status: "missing",
    },
  });

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const paperResult = await setPaperIngestionState({
    projectRoot,
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Import still running",
      completed_papers: [
        {
          canonical_id: "paper-1",
          title: "Demo Paper",
        },
      ],
      paper_operations: [
        {
          canonical_id: "paper-1",
          phase: "import",
          status: "completed",
        },
      ],
      last_updated_at: "2026-04-08T00:00:00.000Z",
    },
  });
  assert.equal(paperResult.newlyCompletedPapers.length, 1);
  assert.equal(paperResult.newlyTerminalPaperOperations.length, 1);

  const searchResult = await setExperimentSearchState({
    projectRoot,
    experimentSearch: {
      status: "ready_for_analysis",
      plotPackStatus: "ready",
      evaluationSummaryPath: "researcher/EXPERIMENT_EVAL.md",
      plotPackPath: "researcher/PLOT_PACK.md",
      stageProgressPath: "researcher/STAGE_PROGRESS.md",
      checkpointPath: "researcher/CHECKPOINT.md",
    },
  });
  assert.equal(searchResult.readyForAnalysis, true);

  const qcResult = await setPaperQcState({
    projectRoot,
    paperQc: {
      status: "ready",
      compileStatus: "ready",
      pageBudgetStatus: "ready",
      invalidFigureRefStatus: "ready",
      latestReportPath: "reviewer/PAPER_QC.md",
    },
  });
  assert.equal(qcResult.hardFailure, false);

  const citationResult = await setCitationCollectionState({
    projectRoot,
    citationCollection: {
      status: "ready",
      progressPath: "reviewer/CITATION_PROGRESS.md",
      cacheBibPath: "academic_writer/paper/refs.bib",
    },
  });
  assert.equal(citationResult.hardFailure, false);

  const figureResult = await setFigureQcState({
    projectRoot,
    figureQc: {
      status: "ready",
      figureReviewPath: "reviewer/FIGURE_QC.md",
      figureSelectionPath: "reviewer/FIGURE_SELECTION.md",
      duplicateFigureStatus: "ready",
      captionAlignmentStatus: "ready",
      textAlignmentStatus: "ready",
      selectionStatus: "ready",
    },
  });
  assert.equal(figureResult.hardFailure, false);
});
