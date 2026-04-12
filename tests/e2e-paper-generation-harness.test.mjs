import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

test("E2E paper generation harness materializes report, checklist, and timeline", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-harness-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await write(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "e2e-demo",
        current_stage: "write",
        owner_agent: "academic_writer",
        writing_contract: { paper_mode: "survey" },
      },
      null,
      2
    )}\n`
  );
  for (const artifact of [
    "researcher/SURVEY_QUERY_REGISTRY.json",
    "researcher/INCLUDED_PAPERS.json",
    "researcher/EXCLUDED_PAPERS.json",
    "researcher/LITERATURE_REVIEW.md",
    "researcher/SOTA_MATRIX.md",
    "researcher/GAP_SYNTHESIS.md",
    "researcher/COVERAGE_SUMMARY.md",
    "researcher/SURVEY_BRIEF.md",
    "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
    "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
    "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
    "academic_writer/PAPER_PLAN.md",
    "academic_writer/story/STORY_SPINE.md",
    "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    "academic_writer/paper/main.tex",
    "academic_writer/paper/refs.bib",
    "reviewer/CITATION_VERIFICATION.md",
  ]) {
    await write(path.join(projectRoot, artifact), artifact.endsWith(".json") ? "{}\n" : "# ok\n");
  }

  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/run-e2e-paper-generation.mjs",
    "--project-root",
    projectRoot,
    "--lane",
    "survey",
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.finalVerdict, "pass");
  assert.equal(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"), "utf8").then((text) => /final_verdict: pass/.test(text)),
    true
  );
  const checklist = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "E2E_ARTIFACT_CHECKLIST.json"),
      "utf8"
    )
  );
  assert.equal(checklist.final_verdict, "pass");
});
