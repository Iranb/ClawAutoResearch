import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeScientificEditingPassPlanState } from "../../tools/workflow-guard.ts";
import { normalizeWritingContractState } from "../../tools/workflow-guard-state/writing-contract.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("scientific editing pass plan creates six ordered passes without touching citation or compile gates", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-scientific-editing-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "scientific-editing",
    paper_design_intake: {
      field: "computational social science",
    },
    writing_contract: {
      paper_mode: "conference",
      scientific_editing_required: true,
      scientific_editing_status: "pending",
    },
  });

  const result = await materializeScientificEditingPassPlanState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
  });

  assert.equal(result.status, "planned");
  assert.equal(result.passes.length, 6);
  assert.deepEqual(
    result.passes.map((entry) => entry.pass_id),
    [
      "pass_1_structure",
      "pass_2_argumentation",
      "pass_3_sentence_precision",
      "pass_4_grammar_terminology",
      "pass_5_typography_latex",
      "pass_6_integrity_audit",
    ]
  );
  assert.match(result.passes[4].prompt, /do not change citation\/compile gate behavior/i);
  assert.match(result.passes[5].prompt, /does not run new citation\/compile gate behavior/i);

  const ledger = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"),
      "utf8"
    )
  );
  assert.equal(ledger.completion_policy.citation_compile_gates_modified, false);

  const report = await fs.readFile(
    path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_REPORT.md"),
    "utf8"
  );
  assert.match(report, /Pass 6 is an integrity audit only/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  assert.equal(writingContract.scientificEditingRequired, true);
  assert.equal(writingContract.scientificEditingStatus, "planned");
  assert.equal(manifest.scientific_editing.citation_compile_gates_modified, false);
});
