import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeSurveyReferenceAlignment } from "../tools/research-authoring/survey-reference-alignment.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("survey reference alignment flags method/bibliography drift in manuscript sections", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-survey-reference-alignment-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo",
    survey_review: {
      sota_matrix_path: "researcher/SOTA_MATRIX.md",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_IDENTITY_REGISTRY.json"), {
    entries: [
      { title: "Graph Pretraining for SurveyBench", year: 2025 },
    ],
  });
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    [
      "# SOTA Matrix",
      "",
      "| Method | Family | Year | Dataset | Metric |",
      "| --- | --- | --- | --- | --- |",
      "| Graph Pretraining for SurveyBench | Foundation | 2025 | SurveyBench | Accuracy |",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "taxonomy.tex"),
    "We group the field into Retrieval Agents and Planning Agents."
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "evidence_synthesis.tex"),
    "Graph Pretraining for SurveyBench (2024) remains the main baseline."
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "benchmark_landscape.tex"),
    "SurveyBench and Accuracy define the main comparison axis."
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    '@inproceedings{other,title={Other Method},year={2025}}\n'
  );

  const result = await materializeSurveyReferenceAlignment({ projectRoot });

  assert.equal(result.ready, false);
  assert.equal(result.blockingIssues.some((issue) => /bibliography entries/i.test(issue)), true);
  assert.equal(result.blockingIssues.some((issue) => /year mentions drift/i.test(issue)), true);
  await fs.access(path.join(projectRoot, "researcher", "SURVEY_REFERENCE_ALIGNMENT.json"));
});
