import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  setCitationCollectionState,
  setExperimentSearchState,
  setFigureQcState,
  setPaperIngestionState,
  setPaperQcState,
} from "../tools/workflow-guard-setters/ingestion-state-setters.ts";

async function makeProjectRoot(manifest) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-ingestion-setters-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("ingestion setters update paper ingestion, search, qc, citation, and figure state", async (t) => {
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
      multiSeedStatus: "ready",
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
