import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("researcher literature-review skill is indexed and wired into the early literature-to-idea workflow", async () => {
  const repoRoot = process.cwd();
  const skillIndex = await readJson(path.join(repoRoot, "skills", "index.json"));
  const researcherSkills = skillIndex.researcher;

  assert.ok(Array.isArray(researcherSkills));
  assert.ok(
    researcherSkills.includes("./researcher/literature-review"),
    "Expected researcher literature-review skill to be registered in skills/index.json."
  );

  const skillPath = path.join(repoRoot, "skills", "researcher", "literature-review", "SKILL.md");
  const skillContent = await fs.readFile(skillPath, "utf8");
  assert.match(skillContent, /^---[\s\S]*name:\s*literature-review/m);
  assert.match(skillContent, /research-lit -> \/literature-review -> \/graph-build -> \/frontier-mapping -> \/idea-phase/i);
  assert.match(skillContent, /INCLUDED_PAPERS\.json/i);
  assert.match(skillContent, /EXCLUDED_PAPERS\.json/i);
  assert.match(skillContent, /SOTA_MATRIX\.md/i);
  assert.match(skillContent, /GAP_SYNTHESIS\.md/i);

  const docs = [
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "frontier-mapping", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "research-pipeline", "SKILL.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
  ];

  for (const filePath of docs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /literature-review/i,
      `Expected ${filePath} to mention the new literature-review skill.`
    );
  }

  const ideaPhase = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    "utf8"
  );
  assert.match(
    ideaPhase,
    /SOTA_MATRIX\.md|GAP_SYNTHESIS\.md/i,
    "Expected idea-phase to consume the literature review packet when present."
  );
});
