import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SURVEY_BRIEF_PATH,
  DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH,
  DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_GAP_SYNTHESIS_PATH,
  DEFAULT_SURVEY_INCLUDED_PAPERS_PATH,
  DEFAULT_SURVEY_LITERATURE_PATH,
  DEFAULT_SURVEY_LITERATURE_REVIEW_PATH,
  DEFAULT_SURVEY_QUERY_REGISTRY_PATH,
  DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH,
  DEFAULT_SURVEY_SOTA_MATRIX_PATH,
} from "../tools/workflow-guard-state/survey-review.ts";
import { materializeSurveyReviewState } from "../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeSurveyProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-survey-materializer-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-graph-reasoning",
    current_stage: "survey_review",
    owner_agent: "researcher",
    survey_review: {
      topic: "Graph reasoning survey",
      mode: "deep",
    },
  });
  return projectRoot;
}

test("materializeSurveyReviewState reconciles survey artifacts into completed durable state", async (t) => {
  const projectRoot = await makeSurveyProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_QUERY_REGISTRY_PATH), {
    rounds: [
      { query: "graph reasoning survey", provider: "papers-cool" },
      { query: "graph reasoning review", provider: "pasa-paper-search" },
    ],
  });
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_PATH), "# Literature\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH),
    "# Review Protocol\n"
  );
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_INCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2501.00001" }, { canonical_id: "arxiv:2501.00002" }],
  });
  await writeJson(path.join(projectRoot, DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH), {
    papers: [{ canonical_id: "arxiv:2401.00003" }],
  });
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_LITERATURE_REVIEW_PATH),
    "# Literature Review\n"
  );
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_SOTA_MATRIX_PATH), "# SOTA Matrix\n");
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_GAP_SYNTHESIS_PATH),
    "# Gap Synthesis\n"
  );
  await writeText(
    path.join(projectRoot, DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH),
    "# Coverage Summary\n"
  );
  await writeText(path.join(projectRoot, DEFAULT_SURVEY_BRIEF_PATH), "# Survey Brief\n");

  const result = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  assert.equal(result.state.status, "completed");
  assert.equal(result.state.currentPhase, "complete");
  assert.equal(result.state.queryRoundCount, 2);
  assert.equal(result.state.includedPaperCount, 2);
  assert.equal(result.state.excludedPaperCount, 1);
  assert.equal(result.state.graphGroundedBriefReady, true);
});
