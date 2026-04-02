import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("researcher workspace-update skill is indexed and install supports non-interactive yes mode", async () => {
  const repoRoot = process.cwd();
  const skillIndex = await readJson(path.join(repoRoot, "skills", "index.json"));
  const researcherSkills = skillIndex.researcher;

  assert.ok(Array.isArray(researcherSkills));
  assert.ok(
    researcherSkills.includes("./researcher/workspace-update"),
    "Expected researcher workspace-update skill to be registered in skills/index.json."
  );

  const skillPath = path.join(
    repoRoot,
    "skills",
    "researcher",
    "workspace-update",
    "SKILL.md"
  );
  const skillContent = await fs.readFile(skillPath, "utf8");
  assert.match(skillContent, /ClawAutoResearch/i);
  assert.match(skillContent, /install\.sh/i);
  assert.match(skillContent, /--yes/);
  assert.match(
    skillContent,
    /\/Users\/iranb\/Library\/Mobile Documents\/com~apple~CloudDocs\/OpenClawThings\/ClawAutoResearch/
  );

  const installScript = await fs.readFile(path.join(repoRoot, "install.sh"), "utf8");
  assert.match(installScript, /--yes/);
  assert.match(installScript, /ASSUME_YES|OPENCLAW_INSTALL_ASSUME_YES/);
});
