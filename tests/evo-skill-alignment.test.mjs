import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("Evo-inspired ideation and paper-review skills are explicitly supported in the workflow", async () => {
  const repoRoot = process.cwd();
  const skillIndex = await readJson(path.join(repoRoot, "skills", "index.json"));

  assert.ok(
    skillIndex.researcher.includes("./researcher/research-ideation"),
    "Expected researcher research-ideation skill to be registered in skills/index.json."
  );
  assert.ok(
    skillIndex.reviewer.includes("./reviewer/paper-review"),
    "Expected reviewer paper-review skill to be registered in skills/index.json."
  );
  for (const skillPath of [
    "./researcher/idea-catalyst-decompose",
    "./researcher/idea-catalyst-translate",
    "./researcher/idea-catalyst-scout",
    "./researcher/idea-catalyst-gatekeeper",
    "./researcher/idea-catalyst-integrator",
  ]) {
    assert.ok(
      skillIndex.researcher.includes(skillPath),
      `Expected researcher ${skillPath} to be registered in skills/index.json.`
    );
  }
  assert.ok(
    skillIndex.reviewer.includes("./reviewer/idea-catalyst-judge"),
    "Expected reviewer idea-catalyst-judge skill to be registered in skills/index.json."
  );

  const researchIdeation = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "research-ideation", "SKILL.md"),
    "utf8"
  );
  assert.match(researchIdeation, /novelty tree/i);
  assert.match(researchIdeation, /challenge-insight tree/i);
  assert.match(researchIdeation, /well-established solution check/i);
  assert.match(researchIdeation, /cross-domain transfer/i);
  assert.match(researchIdeation, /problem decomposition/i);
  assert.match(researchIdeation, /materialize_ideation_contract/i);

  const ideaTournament = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "idea-tournament", "SKILL.md"),
    "utf8"
  );
  assert.match(ideaTournament, /technique/i);
  assert.match(ideaTournament, /domain/i);
  assert.match(ideaTournament, /formulation/i);
  assert.match(ideaTournament, /propose -> review -> refine|propose.*review.*refine/is);
  assert.match(ideaTournament, /elo|pairwise/i);
  assert.match(ideaTournament, /top-3/i);
  assert.match(ideaTournament, /research proposal/i);

  const scoutSkill = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "idea-catalyst-scout", "SKILL.md"),
    "utf8"
  );
  assert.match(scoutSkill, /graph-first/i);
  assert.match(scoutSkill, /distance/i);

  const paperReview = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "paper-review", "SKILL.md"),
    "utf8"
  );
  assert.match(paperReview, /reject-first/i);
  assert.match(paperReview, /unsupported claim/i);
  assert.match(paperReview, /reverse-outline|reverse outline/i);
  assert.match(paperReview, /limitation/i);

  const judgeSkill = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "idea-catalyst-judge", "SKILL.md"),
    "utf8"
  );
  assert.match(judgeSkill, /pairwise|elo/i);
  assert.match(
    judgeSkill,
    /generator must not judge its own output|must not judge/i
  );

  const docs = [
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "reviewer", "AGENTS.md"),
    path.join(repoRoot, "WORKFLOW.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "agents.md"),
  ];

  for (const filePath of docs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /research-ideation|paper-review|idea-catalyst/i,
      `Expected ${filePath} to mention the Evo-inspired skill additions.`
    );
  }
});
