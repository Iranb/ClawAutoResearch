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
        current_stage: "submit",
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
    "academic_writer/WRITING_SIGNALS.md",
    "academic_writer/PAPER_QC.md",
    "academic_writer/paper/main.tex",
    "academic_writer/paper/main.pdf",
    "academic_writer/paper/refs.bib",
    "reviewer/CITATION_VERIFICATION.md",
    "reviewer/REVIEW_PACKET.json",
    "reviewer/REVIEW_ISSUES.json",
  ]) {
    const targetPath = path.join(projectRoot, artifact);
    if (artifact.endsWith("main.tex")) {
      await write(
        targetPath,
        "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nSee prior work \\cite{demo}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n"
      );
    } else if (artifact.endsWith("refs.bib")) {
      await write(
        targetPath,
        "@article{demo,\n  title={Demo},\n  author={Tester, T.},\n  journal={Test Journal},\n  year={2026}\n}\n"
      );
    } else if (artifact.endsWith("CITATION_VERIFICATION.md")) {
      await write(
        targetPath,
        "# Citation Verification\n\n- suspicious: 0\n- hallucinated: 0\n"
      );
    } else if (artifact.endsWith("REVIEW_ISSUES.json")) {
      await write(
        targetPath,
        JSON.stringify({ issues: [], open_counts: { critical: 0, high: 0, medium: 0, low: 0 } }, null, 2) + "\n"
      );
    } else if (artifact.endsWith(".json")) {
      await write(targetPath, "{}\n");
    } else {
      await write(targetPath, "# ok\n");
    }
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
