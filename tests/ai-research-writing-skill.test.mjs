import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const skillRoot = path.join(
  process.cwd(),
  "skills",
  "academic_writer",
  "ai-research-prompt"
);

const filesToCheck = [
  path.join(skillRoot, "SKILL.md"),
  path.join(skillRoot, "awesome-ai-research-writing", "README.md"),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "01-translation.md"
  ),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "02-polish.md"
  ),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "03-logic-and-review.md"
  ),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "04-de-ai.md"
  ),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "05-figures-tables.md"
  ),
  path.join(
    skillRoot,
    "awesome-ai-research-writing",
    "prompts",
    "06-experiments.md"
  ),
];

const expectedSectionMarkers = [
  "## Purpose",
  "## When to Use",
  "## Input Contract",
  "## Output Contract",
  "## Hard Constraints",
  "## Procedure",
  "## Failure Modes",
];

test("ai research writing skill is rewritten as an English agent-first skill pack", async () => {
  const fileContents = await Promise.all(
    filesToCheck.map(async (filePath) => [filePath, await fs.readFile(filePath, "utf8")])
  );
  const contentByPath = new Map(fileContents);

  const skillContent = contentByPath.get(path.join(skillRoot, "SKILL.md"));
  assert.ok(skillContent);
  assert.match(skillContent, /^---[\s\S]*description:\s*Use when\b/m);
  assert.doesNotMatch(skillContent, /07-model-selection\.md|08-agent-skills\.md/);
  assert.doesNotMatch(skillContent, /[\u3400-\u9fff]/u);

  const readmeContent = contentByPath.get(
    path.join(skillRoot, "awesome-ai-research-writing", "README.md")
  );
  assert.ok(readmeContent);
  assert.doesNotMatch(readmeContent, /[\u3400-\u9fff]/u);

  for (const filePath of filesToCheck.slice(2)) {
    const content = contentByPath.get(filePath);
    assert.ok(content, `Expected ${filePath} to be readable.`);
    for (const marker of expectedSectionMarkers) {
      assert.match(
        content,
        new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
        `Expected ${filePath} to include section marker ${marker}.`
      );
    }
    assert.doesNotMatch(
      content,
      /[\u3400-\u9fff]/u,
      `Expected ${filePath} to be English-only.`
    );
  }
});
