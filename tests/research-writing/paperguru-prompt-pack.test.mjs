import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const promptPackRoot = path.join(
  repoRoot,
  "skills",
  "academic_writer",
  "paperguru-prompt-pack"
);

async function readPromptReference(name) {
  return fs.readFile(path.join(promptPackRoot, "references", name), "utf8");
}

test("PaperGuru prompt pack is indexed and keeps full writing, figure, editing, and PaperNexus prompt ranges", async () => {
  const skillIndex = JSON.parse(
    await fs.readFile(path.join(repoRoot, "skills", "index.json"), "utf8")
  );

  assert.ok(
    skillIndex.academic_writer.includes("./academic_writer/paperguru-prompt-pack")
  );

  const [writing, figures, editing, literature] = await Promise.all([
    readPromptReference("writing-prompts.md"),
    readPromptReference("figure-prompts.md"),
    readPromptReference("editing-pass-prompts.md"),
    readPromptReference("literature-query-prompts.md"),
  ]);

  for (const id of ["W0", "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "W13"]) {
    assert.match(writing, new RegExp(`## ${id}\\.`));
  }
  assert.match(writing, /Do not fabricate citations/);
  assert.match(writing, /Do not change the repository citation gate/);

  for (const id of ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"]) {
    assert.match(figures, new RegExp(`## ${id}\\.`));
  }
  assert.match(figures, /Never include fabricated numeric results/);
  assert.match(figures, /Route to Python\/data plotting/);
  assert.match(figures, /set generation_status to `blocked_needs_real_data`/);

  for (const id of ["E0", "E1", "E2", "E3", "E4", "E5", "E6"]) {
    assert.match(editing, new RegExp(`## ${id}\\.`));
  }
  assert.match(editing, /Do not collapse the passes into one general/);
  assert.match(editing, /do not modify the\s+repository citation or compile gate/i);

  for (const id of ["L1", "L2"]) {
    assert.match(literature, new RegExp(`## ${id}\\.`));
  }
  assert.match(literature, /requires PaperNexus import: yes\/no/);
});
