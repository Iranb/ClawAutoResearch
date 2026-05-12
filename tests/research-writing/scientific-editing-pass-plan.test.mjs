import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeScientificEditingPassPlanState,
  recordScientificEditingPassResultState,
} from "../../tools/workflow-guard.ts";
import { normalizeWritingContractState } from "../../tools/workflow-guard-state/writing-contract.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, "utf8"));
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
  assert.match(report, /receipts remain external gate inputs/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  assert.equal(writingContract.scientificEditingRequired, true);
  assert.equal(writingContract.scientificEditingStatus, "planned");
  assert.equal(manifest.scientific_editing.citation_compile_gates_modified, false);

  const loopState = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json"),
      "utf8"
    )
  );
  assert.equal(
    loopState.reference_context.article_evidence_contract.writing_quality.paper_guru.status,
    "blocked"
  );
  assert.equal(
    loopState.reference_context.article_evidence_contract.writing_quality.paper_guru
      .required_pass_ids.length,
    6
  );
});

test("scientific editing pass results promote to ready only after all six passes and receipts land", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-scientific-editing-record-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "scientific-editing-record",
    paper_design_intake: {
      field: "computational social science",
    },
    writing_contract: {
      paper_mode: "conference",
      scientific_editing_required: true,
      scientific_editing_status: "pending",
    },
  });

  await materializeScientificEditingPassPlanState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
  });

  const passIds = [
    "pass_1_structure",
    "pass_2_argumentation",
    "pass_3_sentence_precision",
    "pass_4_grammar_terminology",
    "pass_5_typography_latex",
    "pass_6_integrity_audit",
  ];
  let finalResult = null;
  for (const passId of passIds.slice(0, 5)) {
    finalResult = await recordScientificEditingPassResultState({
      projectRoot,
      trigger: "test",
      agentId: "academic_writer",
      operationId: `scientific-editing:${passId}`,
      scientificEditingPassResult: {
        pass_id: passId,
        status: "completed",
        files_inspected: [`academic_writer/paper/sections/${passId}.tex`],
        edits_made: [`checked ${passId}`],
        ...(passId === "pass_6_integrity_audit"
          ? {
              compile_receipt_path: "academic_writer/build.log",
              reference_verification_receipt_path:
                "reviewer/CITATION_VERIFICATION.md",
              number_consistency_receipt_path: "academic_writer/NUMBER_AUDIT.md",
              claim_evidence_consistency_receipt_path:
                "reviewer/CLAIM_EVIDENCE_AUDIT.md",
              claim_ids: ["claim_consistency_gate_improves_gcd"],
              paper_ids: ["paper_fixmatch_2020"],
              paper_paragraph_ids: ["para_fixmatch_2020_sec3_p4"],
              trial_ids: ["trial_007"],
              citation_keys: ["sohn2020fixmatch"],
              section_id: "method",
              manuscript_paragraph_id: "method_p3",
            }
          : {}),
      },
    });
  }

  const blockedResult = await recordScientificEditingPassResultState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
    operationId: "scientific-editing:pass_6_integrity_audit:blocking",
    scientificEditingPassResult: {
      pass_id: "pass_6_integrity_audit",
      status: "completed",
      files_inspected: ["academic_writer/paper/sections/pass_6_integrity_audit.tex"],
      edits_made: ["checked pass_6_integrity_audit"],
      compile_receipt_path: "academic_writer/build.log",
      reference_verification_receipt_path: "reviewer/CITATION_VERIFICATION.md",
      number_consistency_receipt_path: "academic_writer/NUMBER_AUDIT.md",
      claim_ids: ["claim_consistency_gate_improves_gcd"],
      paper_ids: ["paper_fixmatch_2020"],
      paper_paragraph_ids: ["para_fixmatch_2020_sec3_p4"],
      trial_ids: ["trial_007"],
      citation_keys: ["sohn2020fixmatch"],
      section_id: "method",
      manuscript_paragraph_id: "method_p3",
    },
  });

  assert.equal(blockedResult.status, "blocked");
  assert.match(
    blockedResult.missingSignals.join("\n"),
    /claim-evidence consistency receipt/i
  );

  finalResult = await recordScientificEditingPassResultState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
    operationId: "scientific-editing:pass_6_integrity_audit:ready",
    scientificEditingPassResult: {
      pass_id: "pass_6_integrity_audit",
      status: "completed",
      files_inspected: ["academic_writer/paper/sections/pass_6_integrity_audit.tex"],
      edits_made: ["checked pass_6_integrity_audit"],
      compile_receipt_path: "academic_writer/build.log",
      reference_verification_receipt_path: "reviewer/CITATION_VERIFICATION.md",
      number_consistency_receipt_path: "academic_writer/NUMBER_AUDIT.md",
      claim_evidence_consistency_receipt_path:
        "reviewer/CLAIM_EVIDENCE_AUDIT.md",
      claim_ids: ["claim_consistency_gate_improves_gcd"],
      paper_ids: ["paper_fixmatch_2020"],
      paper_paragraph_ids: ["para_fixmatch_2020_sec3_p4"],
      trial_ids: ["trial_007"],
      citation_keys: ["sohn2020fixmatch"],
      section_id: "method",
      manuscript_paragraph_id: "method_p3",
    },
  });

  assert.ok(finalResult);
  assert.equal(finalResult.status, "ready");
  assert.equal(finalResult.paperGuruStatus, "ready");
  assert.deepEqual(finalResult.missingSignals, []);

  const ledger = await readJson(
    path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json")
  );
  assert.equal(ledger.status, "ready");
  assert.equal(ledger.pass_results.length, 6);
  assert.ok(ledger.compile_receipts.includes("academic_writer/build.log"));
  assert.ok(
    ledger.reference_verification_receipts.includes(
      "reviewer/CITATION_VERIFICATION.md"
    )
  );
  assert.ok(ledger.number_consistency_receipts.includes("academic_writer/NUMBER_AUDIT.md"));
  assert.ok(
    ledger.claim_evidence_consistency_receipts.includes(
      "reviewer/CLAIM_EVIDENCE_AUDIT.md"
    )
  );

  const manifest = await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"));
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  assert.equal(writingContract.scientificEditingStatus, "ready");
  assert.equal(manifest.scientific_editing.status, "ready");
  assert.equal(manifest.scientific_editing.completed_pass_count, 6);

  const loopState = await readJson(
    path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json")
  );
  const paperGuru =
    loopState.reference_context.article_evidence_contract.writing_quality.paper_guru;
  assert.equal(paperGuru.status, "ready");
  assert.deepEqual(paperGuru.completed_pass_ids, passIds);
  assert.ok(
    paperGuru.claim_evidence_consistency_receipts.includes(
      "reviewer/CLAIM_EVIDENCE_AUDIT.md"
    )
  );
  assert.ok(loopState.reference_context.article_evidence_contract.usages.length >= 1);
  assert.ok(
    loopState.reference_context.article_evidence_contract.usages.some(
      (usage) => usage.source_pass_id === "pass_6_integrity_audit"
    )
  );
  assert.ok(
    loopState.reference_context.article_evidence_contract.usages.some((usage) =>
      Array.isArray(usage.paper_paragraph_ids)
        ? usage.paper_paragraph_ids.includes("para_fixmatch_2020_sec3_p4")
        : false
    )
  );

  const report = await fs.readFile(
    path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_REPORT.md"),
    "utf8"
  );
  assert.match(report, /Status: ready/);
  assert.match(report, /Claim-evidence consistency receipts: reviewer\/CLAIM_EVIDENCE_AUDIT\.md/);
});

test("scientific editing pass results keep partial legacy ledgers blocked", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-scientific-editing-partial-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "scientific-editing-partial",
    writing_contract: {
      paper_mode: "conference",
      scientific_editing_required: true,
      scientific_editing_status: "pending",
      scientific_editing_ledger_path: "academic_writer/SCIENTIFIC_EDIT_LEDGER.json",
      scientific_editing_report_path: "academic_writer/SCIENTIFIC_EDIT_REPORT.md",
    },
  });
  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    schema_version: 1,
    status: "in_progress",
    pass_results: [
      {
        pass_id: "pass_1_structure",
        status: "completed",
        files_inspected: ["academic_writer/paper/main.tex"],
      },
    ],
  });

  const result = await recordScientificEditingPassResultState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
    operationId: "scientific-editing:partial-ledger",
    scientificEditingPassResult: {
      pass_id: "pass_6_integrity_audit",
      status: "completed",
      files_inspected: ["academic_writer/paper/main.tex"],
      compile_receipt_path: "academic_writer/build.log",
      reference_verification_receipt_path: "reviewer/CITATION_VERIFICATION.md",
      number_consistency_receipt_path: "academic_writer/NUMBER_AUDIT.md",
      claim_evidence_consistency_receipt_path:
        "reviewer/CLAIM_EVIDENCE_AUDIT.md",
    },
  });

  assert.equal(result.status, "in_progress");
  assert.match(result.missingSignals.join("\n"), /pass_2_argumentation/);

  const ledger = await readJson(
    path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json")
  );
  assert.equal(ledger.status, "in_progress");
  assert.deepEqual(ledger.completed_pass_ids.sort(), [
    "pass_1_structure",
    "pass_6_integrity_audit",
  ]);
  assert.ok(ledger.missing_pass_ids.includes("pass_2_argumentation"));
});
