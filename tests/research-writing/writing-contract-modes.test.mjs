import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWritingContractStateSummary,
  setWritingContractState,
} from "../../tools/workflow-guard.ts";
import {
  DEFAULT_SCIENTIFIC_EDITING_PASSES,
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../../tools/workflow-guard-state/writing-contract.ts";

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
  assert.equal(result.state.projectTemplatePath?.startsWith("academic_writer/template_bundle/"), true);
  assert.equal(result.templateCopyStatus, "ready");
  assert.equal(result.state.mainTextProofStyle, "lemma_result_only");
  assert.equal(result.state.proofAppendixRequired, true);
  assert.equal(result.state.proofAppendixPath, "academic_writer/paper/sections/appendix_theory.tex");
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
  assert.equal(summary.templateCopyStatus, "ready");
  assert.ok(summary.projectTemplateResolvedPath);
  assert.ok(summary.templateResolvedPath);
});

test("survey mode preset exposes survey sections and disables theory-first requirements", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await setWritingContractState({
    projectRoot,
    writingContract: {
      paper_mode: "survey",
    },
  });

  assert.equal(result.state.paperMode, "survey");
  assert.equal(result.state.bodyPageBudget, 12);
  assert.equal(result.state.referencePageBudget, 4);
  assert.equal(result.state.kgStorylineRequired, false);
  assert.equal(result.state.proofAppendixRequired, false);
  assert.equal(result.state.templateName, "survey-review");
  assert.ok(result.state.sectionOrder.includes("taxonomy"));
  assert.ok(result.state.sectionOrder.includes("benchmark_landscape"));
  assert.ok(result.state.sectionOrder.includes("open_problems"));
  assert.equal(result.templateCopyStatus, "ready");
});

test("configured default conference template is copied into the project before writing", async (t) => {
  const projectRoot = await makeTempProject();
  const externalTemplateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-template-src-")
  );
  const externalTemplatePath = path.join(externalTemplateRoot, "main.tex");
  const stylePath = path.join(externalTemplateRoot, "custom.cls");

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(externalTemplateRoot, { recursive: true, force: true });
  });

  await fs.writeFile(externalTemplatePath, "\\documentclass{custom}\n", "utf8");
  await fs.writeFile(stylePath, "% custom class\n", "utf8");

  const result = await setWritingContractState({
    projectRoot,
    policy: {
      defaultConferenceTemplatePath: externalTemplatePath,
    },
    writingContract: {
      paper_mode: "conference",
    },
  });

  assert.equal(result.templateCopyStatus, "ready");
  assert.ok(result.projectTemplateResolvedPath);
  assert.equal(result.projectTemplateResolvedPath.startsWith(projectRoot), true);
  assert.equal(result.projectTemplateResolvedPath.includes("academic_writer/template_bundle"), true);
  const copiedStyle = path.join(path.dirname(result.projectTemplateResolvedPath), "custom.cls");
  await fs.access(result.projectTemplateResolvedPath);
  await fs.access(copiedStyle);
});

test("writing contract preserves five-pass scientific editing controls", () => {
  const state = normalizeWritingContractState({
    scientific_editing_required: true,
    scientific_editing_status: "ready",
    scientific_editing_passes: ["logical_flow", "numerical_consistency"],
    scientific_editing_ledger_path: "academic_writer/custom-ledger.json",
    scientific_editing_report_path: "academic_writer/custom-report.md",
    last_scientific_editing_at: "2026-05-08T00:00:00.000Z",
  });

  assert.equal(state.scientificEditingRequired, true);
  assert.equal(state.scientificEditingStatus, "ready");
  assert.deepEqual(state.scientificEditingPasses, [
    "logical_flow",
    "numerical_consistency",
  ]);
  assert.equal(
    state.scientificEditingLedgerPath,
    "academic_writer/custom-ledger.json"
  );

  const defaults = normalizeWritingContractState({});
  assert.deepEqual(
    defaults.scientificEditingPasses,
    DEFAULT_SCIENTIFIC_EDITING_PASSES
  );
  assert.equal(defaults.scientificEditingRequired, false);
  assert.equal(defaults.scientificEditingStatus, "optional");

  const serialized = serializeWritingContractState(state);
  assert.equal(serialized.scientific_editing_required, true);
  assert.deepEqual(serialized.scientific_editing_passes, [
    "logical_flow",
    "numerical_consistency",
  ]);
  assert.equal(
    serialized.scientific_editing_report_path,
    "academic_writer/custom-report.md"
  );
});
