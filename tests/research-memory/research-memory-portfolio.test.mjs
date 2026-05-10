import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializePortfolioCycleMemory } from "../../tools/research-memory-portfolio.ts";

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProjectsRoot() {
  const projectsRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-portfolio-memory-")
  );
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  await fs.mkdir(alphaRoot, { recursive: true });
  await fs.mkdir(betaRoot, { recursive: true });

  await writeJson(path.join(alphaRoot, "PROJECT_MANIFEST.json"), { project_id: "alpha" });
  await writeJson(path.join(betaRoot, "PROJECT_MANIFEST.json"), { project_id: "beta" });

  await writeJson(path.join(alphaRoot, "memory", "IDE_CYCLE_MEMORY.json"), {
    transferablePatterns: ["graph-grounded routing", "bounded claims"],
    doNotRepeat: ["generic prose-only polishing"],
  });
  await writeJson(path.join(alphaRoot, "memory", "IVE_CYCLE_MEMORY.json"), {
    claimSupportFindings: ["claim-2 partial because evidence is sparse"],
    experimentLessons: ["Keep router-only ablation"],
  });
  await writeJson(path.join(alphaRoot, "memory", "ESE_CYCLE_MEMORY.json"), {
    reviewPressurePatterns: ["novelty looks incremental"],
    rebuttalStrategies: ["downgrade_claim"],
  });

  await writeJson(path.join(betaRoot, "memory", "IDE_CYCLE_MEMORY.json"), {
    transferablePatterns: ["graph-grounded routing", "figure-first story"],
    doNotRepeat: ["broad unsupported claims"],
  });
  await writeJson(path.join(betaRoot, "memory", "IVE_CYCLE_MEMORY.json"), {
    claimSupportFindings: ["claim-3 unsupported without boundary evidence"],
    experimentLessons: ["Keep baseline protocol unchanged"],
  });
  await writeJson(path.join(betaRoot, "memory", "ESE_CYCLE_MEMORY.json"), {
    reviewPressurePatterns: ["scope boundary missing"],
    rebuttalStrategies: ["rebut_with_existing_evidence"],
  });

  return { projectsRoot, alphaRoot };
}

test("portfolio cycle memory aggregates sibling project lessons into a global memory packet", async (t) => {
  const { projectsRoot, alphaRoot } = await makeProjectsRoot();
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  const result = await materializePortfolioCycleMemory({
    projectRoot: alphaRoot,
  });

  assert.equal(result.status, "ready");
  assert.ok(result.projectsConsidered >= 2);
  assert.ok(
    result.transferablePatterns.some((entry) => /graph-grounded routing/i.test(entry))
  );
  assert.ok(result.reviewPressurePatterns.some((entry) => /incremental|scope/i.test(entry)));
  assert.ok(result.rebuttalStrategies.some((entry) => /downgrade_claim/i.test(entry)));

  const persisted = JSON.parse(
    await fs.readFile(path.join(alphaRoot, "memory", "PORTFOLIO_CYCLE_MEMORY.json"), "utf8")
  );
  assert.equal(persisted.status, "ready");
  assert.ok(Array.isArray(persisted.project_ids));
});
