import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("strict E2E paper gate rejects shallow placeholder content", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-content-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "content-gate",
    current_stage: "review",
    owner_agent: "reviewer",
    writing_contract: {
      paper_mode: "conference",
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Introduction}",
      "TODO placeholder smoke paper \\cite{demo}.",
      "\\section{Results}",
      "A short result mentions baseline accuracy.",
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@article{demo,title={Demo},author={A},year={2026}}\n"
  );

  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    "experiment",
    "--strict-content",
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.strictContent, true);
  assert.equal(payload.finalVerdict, "fail");
  assert.equal(payload.contentQuality.status, "fail");
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "no_placeholder_language" && entry.ok === false
    ),
    true
  );
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "paper_word_count_min" && entry.ok === false
    ),
    true
  );
});
