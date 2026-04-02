import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("workflow indexes Zotero-aware literature management and selected scientific skills by role", async () => {
  const repoRoot = process.cwd();
  const skillIndex = await readJson(path.join(repoRoot, "skills", "index.json"));

  assert.ok(skillIndex.researcher.includes("./researcher/zotero-project-library"));
  assert.ok(skillIndex.researcher.includes("./researcher/scientific-brainstorming"));
  assert.ok(skillIndex.academic_writer.includes("./academic_writer/citation-management"));
  assert.ok(skillIndex.academic_writer.includes("./academic_writer/venue-templates"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/scientific-critical-thinking"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/scholar-evaluation"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/peer-review"));
  assert.ok(skillIndex.coder.includes("./coder/scientific-visualization"));
});

test("workflow docs and agent guides mention Zotero bot collections and the new scientific-skill handoffs", async () => {
  const repoRoot = process.cwd();
  const docs = [
    path.join(repoRoot, "WORKFLOW.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
    path.join(repoRoot, "DOC", "reference", "agents.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "agents", "academic_writer", "SOUL.md"),
    path.join(repoRoot, "agents", "reviewer", "AGENTS.md"),
    path.join(repoRoot, "agents", "reviewer", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "AGENTS.md"),
    path.join(repoRoot, "agents", "coder", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "TOOLS.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "literature-review", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "review-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "citation-integrity-gate", "SKILL.md"),
    path.join(repoRoot, "skills", "coder", "implement-experiment", "SKILL.md"),
  ];

  const zoteroDocs = [
    path.join(repoRoot, "WORKFLOW.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
    path.join(repoRoot, "DOC", "reference", "agents.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "agents", "academic_writer", "SOUL.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "literature-review", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
  ];

  for (const filePath of zoteroDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /zotero|bot\/<project-id>|bot collection|zotero project/i,
      `Expected ${filePath} to mention Zotero-backed project literature management.`
    );
  }

  const writerDocs = [
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
  ];
  for (const filePath of writerDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /citation-management/i);
    assert.match(content, /venue-templates/i);
  }

  const reviewerDocs = [
    path.join(repoRoot, "agents", "reviewer", "AGENTS.md"),
    path.join(repoRoot, "skills", "reviewer", "review-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "citation-integrity-gate", "SKILL.md"),
  ];
  for (const filePath of reviewerDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /scientific-critical-thinking/i);
    assert.match(content, /scholar-evaluation/i);
    assert.match(content, /peer-review/i);
  }

  const coderDocs = [
    path.join(repoRoot, "agents", "coder", "AGENTS.md"),
    path.join(repoRoot, "agents", "coder", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "TOOLS.md"),
    path.join(repoRoot, "skills", "coder", "implement-experiment", "SKILL.md"),
  ];
  for (const filePath of coderDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /scientific-visualization/i);
  }
});

test("scientific-visualization skill captures publication and matplotlib guardrails for Coder", async () => {
  const repoRoot = process.cwd();
  const skillPath = path.join(
    repoRoot,
    "skills",
    "coder",
    "scientific-visualization",
    "SKILL.md"
  );
  const content = await fs.readFile(skillPath, "utf8");

  assert.match(content, /object-oriented API|Figure\/Axes|fig,\s*ax/i);
  assert.match(content, /subplot_mosaic|GridSpec/i);
  assert.match(content, /colorblind-safe|Okabe-Ito/i);
  assert.match(content, /PDF|SVG|PNG/i);
  assert.match(content, /Analyzer/i);
  assert.match(content, /baseline vs proposed|baseline and proposed/i);
});
