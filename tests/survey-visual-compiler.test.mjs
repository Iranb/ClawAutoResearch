import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeSurveyVisualCompiler } from "../tools/research-writing/survey-visual-compiler.ts";
import { materializeSurveyMethodologyConsistency } from "../tools/research-authoring/survey-methodology-consistency.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# stub\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("survey visual compiler materializes evidence rows, compiler state, and insertion map", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-survey-visual-compiler-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-demo",
    current_stage: "write",
    survey_review: {
      topic: "OmniModel survey",
    },
    survey_visual_compiler_state: {
      status: "missing",
    },
  });
  await writeText(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), "# brief\n- six families\n- benchmark clusters\n");
  await writeText(path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"), "# lit\n- family comparison\n- contradiction zone\n");
  await writeText(path.join(projectRoot, "researcher", "SOTA_MATRIX.md"), "# sota\n- benchmark row one\n- benchmark row two\n");
  await writeText(path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"), "# gaps\n- robustness gap\n");
  await writeText(path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"), "# protocol\n- 2022-2025\n- dataset coverage\n");
  await writeJson(path.join(projectRoot, "academic_writer", "SURVEY_VISUAL_ASSET_INDEX.json"), {
    figureSpecs: [
      "academic_writer/paper/figures/survey_taxonomy_map.md",
      "academic_writer/paper/figures/survey_benchmark_comparison_map.md",
    ],
  });

  const result = await materializeSurveyVisualCompiler({ projectRoot });
  assert.equal(result.rowCount > 0, true);

  const rows = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "SURVEY_VISUAL_EVIDENCE_ROWS.json"), "utf8")
  );
  assert.equal(Array.isArray(rows.rows), true);
  assert.equal(rows.rows.length > 0, true);

  const compilerState = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "SURVEY_VISUAL_COMPILER_STATE.json"), "utf8")
  );
  assert.equal(compilerState.status, "ready");

  const insertionMap = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "SURVEY_VISUAL_INSERTION_MAP.json"), "utf8")
  );
  assert.equal(Array.isArray(insertionMap.inserts), true);
  assert.equal(insertionMap.inserts.length >= 2, true);
});

test("survey methodology consistency flags count and year drift", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-survey-methodology-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-demo",
    current_stage: "review",
    survey_review: {
      years: "2022-2025",
      review_protocol_path: "researcher/REVIEW_PROTOCOL.md",
      included_papers_path: "researcher/INCLUDED_PAPERS.json",
      excluded_papers_path: "researcher/EXCLUDED_PAPERS.json",
    },
  });
  await writeText(path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"), "# protocol\nJanuary 2023 to December 2025\n31 papers\n");
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: Array.from({ length: 31 }, (_, index) => ({ id: `p-${index + 1}`, source: "arXiv" })),
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    papers: Array.from({ length: 15 }, (_, index) => ({ id: `x-${index + 1}` })),
  });
  await writeText(path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex"), "We review 51 papers published between 2022-2025.\n");
  await writeText(path.join(projectRoot, "academic_writer", "paper", "sections", "introduction.tex"), "This survey covers 2022-2025.\n");
  await writeText(path.join(projectRoot, "academic_writer", "paper", "sections", "scope_and_protocol.tex"), "We included 31 papers from 2023-2025.\n");

  const result = await materializeSurveyMethodologyConsistency({ projectRoot });
  assert.equal(result.ready, false);
  assert.equal(result.blockingIssues.length >= 2, true);

  const stored = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "SURVEY_METHODOLOGY_CONSISTENCY.json"), "utf8")
  );
  assert.equal(stored.ready, false);
});
