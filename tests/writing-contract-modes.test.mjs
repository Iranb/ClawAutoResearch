import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWritingContractStateSummary,
  setWritingContractState,
} from "../tools/workflow-guard.ts";

async function makeTempProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-writing-mode-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("conference mode preset populates bundled template, budgets, and KG storyline defaults", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await setWritingContractState({
    projectRoot,
    writingContract: {
      paper_mode: "conference",
    },
  });

  assert.equal(result.state.paperMode, "conference");
  assert.equal(result.state.bodyPageBudget, 9);
  assert.equal(result.state.referencePageBudget, 2);
  assert.equal(result.state.kgStorylineRequired, true);
  assert.equal(result.state.templateName, "conference-9p-body-2p-refs");
  assert.equal(result.state.kgStorylinePacketPath, "academic_writer/KG_STORYLINE_PACKET.md");
  assert.equal(result.templateExists, true);
  assert.ok(result.state.sectionOrder.includes("results"));
  assert.ok(result.state.sectionOrder.includes("discussion"));
  assert.ok(result.state.sectionOrder.includes("limitations"));
});

test("journal mode preset exposes 12-plus-2 writing envelope through summary", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await setWritingContractState({
    projectRoot,
    writingContract: {
      paper_mode: "journal",
    },
  });

  const summary = await getWritingContractStateSummary({ projectRoot });
  assert.equal(summary.state.paperMode, "journal");
  assert.equal(summary.state.bodyPageBudget, 12);
  assert.equal(summary.state.referencePageBudget, 2);
  assert.equal(summary.state.bodyWordTargetMin, 7000);
  assert.equal(summary.state.bodyWordTargetMax, 9500);
  assert.equal(summary.templateReady, true);
});
