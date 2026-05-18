import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canAdvance,
  evaluatePaperGuruGate,
  hydrateAutoResearchLoopState,
  recordAutoResearchAdvanceDecision,
} from "../../tools/autoresearch-loop-state.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("unified loop state blocks analyze when completed trial has zero primary-metric gain", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-loop-state-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "loop-zero-gain",
    current_stage: "experiment",
    papernexus_access_mode: "remote_mcp",
    papernexus_mcp_url: "http://10.126.56.41:4821/mcp",
    papernexus_api_token_source: "os_keychain",
    papernexus_api_token_service: "papernexus-api-token",
    papernexus_api_token_account: "10.126.56.41",
    paper_ingestion: {
      graph_presence_status: "ready",
    },
    idea_catalyst: {
      status: "ready",
    },
    experiment_search: {
      status: "searching",
      track_id: "track-main",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    experiments: [
      {
        experiment_id: "exp-zero",
        track_id: "track-main",
        status: "completed",
        decision: "advance",
        key_metric: {
          name: "h_score",
          value: 0.5,
          delta: 0,
        },
      },
    ],
  });

  const state = await hydrateAutoResearchLoopState({
    projectRoot,
    operationId: "test-hydrate",
    agentId: "researcher",
  });

  assert.equal(state.papernexus.server, "http://10.126.56.41:4821/mcp");
  assert.equal(state.papernexus.auth_source, "macos_keychain");
  assert.equal(state.papernexus.token_account, "10.126.56.41");
  assert.equal(state.trial_history[0].decision.outcome, "discard");
  assert.equal(canAdvance(state, "analyze").allowed, false);

  const decision = await recordAutoResearchAdvanceDecision({
    projectRoot,
    targetStage: "analyze",
    operationId: "test-record-analyze",
    agentId: "researcher",
  });
  assert.equal(decision.allowed, false);

  const persisted = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json"),
      "utf8"
    )
  );
  assert.equal(persisted.advance.analyze.allowed, false);
  assert.equal(persisted.next_action, "continue_tuning");
});

test("unified loop state treats below-threshold metric gains as continue tuning", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-loop-min-gain-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "loop-min-gain",
    current_stage: "experiment",
    experiment_search: {
      status: "searching",
      track_id: "track-main",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    experiments: [
      {
        experiment_id: "exp-small-gain",
        track_id: "track-main",
        status: "completed",
        decision: "advance",
        key_metric: {
          name: "h_score",
          value: 0.53,
          delta: 0.02,
        },
        metadata: {
          trial_contract: {
            primary_metric_contract: {
              metric_name: "h_score",
              direction: "higher_is_better",
              minimum_improvement: 0.05,
            },
          },
        },
      },
    ],
  });

  const state = await hydrateAutoResearchLoopState({
    projectRoot,
    operationId: "test-min-gain",
    agentId: "researcher",
  });

  assert.equal(state.trial_history[0].metric_delta, 0.02);
  assert.equal(state.trial_history[0].decision.outcome, "discard");
  assert.equal(canAdvance(state, "analyze").allowed, false);
});

test("plan advancement requires Idea-Catalyst bridge fragments in the unified state", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-loop-plan-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  await writeJson(manifestPath, {
    project_id: "loop-plan",
    current_stage: "plan",
    idea_catalyst: {
      status: "ready",
    },
  });

  const missingBridgeState = await hydrateAutoResearchLoopState({ projectRoot });
  assert.equal(canAdvance(missingBridgeState, "plan").allowed, false);

  await writeJson(manifestPath, {
    project_id: "loop-plan",
    current_stage: "plan",
    idea_catalyst: {
      status: "ready",
    },
    planner_plan: {
      idea_catalyst_bridge: {
        status: "ready",
        claim_mappings: [
          {
            fragment_id: "frag-1",
            claim_id: "claim-1",
          },
        ],
        fragments: [
          {
            fragment_id: "frag-1",
            paper_ids: ["paper-1"],
            paragraph_ids: ["para-1"],
          },
        ],
      },
    },
  });

  const bridgedState = await hydrateAutoResearchLoopState({ projectRoot });
  assert.equal(canAdvance(bridgedState, "plan").allowed, true);
});

test("PaperNexus local fallback is explicit and blocks remote graph-guided plan claims", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-loop-graph-level-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "loop-graph-level",
    current_stage: "plan",
    papernexus_api_base_url: "http://10.126.56.41:4821",
    papernexus_access_mode: "remote_mcp",
    paper_ingestion: {
      graph_presence_status: "ready",
      ready_proof_level: "none",
      papernexus_claim_level: "connectivity_only",
      papernexus_source_backed_graph_claim: false,
    },
    idea_catalyst: {
      status: "ready",
    },
    planner_plan: {
      idea_catalyst_bridge: {
        status: "ready",
        claim_mappings: [
          {
            fragment_id: "frag-1",
            claim_id: "claim-1",
          },
        ],
        fragments: [
          {
            fragment_id: "frag-1",
            paper_ids: ["paper-1"],
            paragraph_ids: ["para-1"],
          },
        ],
      },
    },
  });

  const state = await hydrateAutoResearchLoopState({ projectRoot });
  assert.equal(state.papernexus.evidence_level, "local_fallback");
  assert.equal(state.papernexus.degraded_graph_context, true);
  const decision = canAdvance(state, "plan");
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons[0], /remote PaperNexus evidence/i);
});

test("submit gate requires strong claim paragraph usage coverage", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-loop-submit-coverage-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const state = await hydrateAutoResearchLoopState({
    projectRoot,
    manifest: {
      project_id: "loop-submit-coverage",
      reference_context: {
        article_evidence_contract: {
          claims: [
            {
              claim_id: "claim-strong",
              strength: "strong",
              paper_ids: ["paper-1"],
            },
          ],
          usages: [
            {
              usage_id: "usage-1",
              claim_ids: ["claim-strong"],
              paper_ids: ["paper-1"],
            },
          ],
          writing_quality: {
            paper_guru: {
              status: "optional",
            },
          },
        },
      },
    },
  });
  const decision = canAdvance(state, "submit");
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons[0], /claim-paper-paragraph usage coverage/i);
});

test("PaperGuru gate requires six completed passes plus compile, reference, number, and claim-evidence receipts", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-paperguru-gate-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "paperguru-gate",
    writing_contract: {
      scientific_editing_required: true,
      scientific_editing_status: "ready",
      scientific_editing_passes: [
        "pass_1_structure",
        "pass_2_argumentation",
        "pass_3_sentence_precision",
        "pass_4_grammar_terminology",
        "pass_5_typography_latex",
        "pass_6_integrity_audit",
      ],
      scientific_editing_ledger_path: "academic_writer/SCIENTIFIC_EDIT_LEDGER.json",
      scientific_editing_report_path: "academic_writer/SCIENTIFIC_EDIT_REPORT.md",
    },
  });
  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    pass_results: [
      { pass_id: "pass_1_structure", status: "completed" },
      { pass_id: "pass_2_argumentation", status: "completed" },
    ],
  });
  await writeText(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_REPORT.md"), "# report\n");

  const blocked = await evaluatePaperGuruGate({ projectRoot });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.missingSignals.join("\n"), /pass_3_sentence_precision/);
  assert.match(blocked.missingSignals.join("\n"), /compile receipt/i);
  assert.match(blocked.missingSignals.join("\n"), /claim-evidence consistency/i);

  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    pass_results: [
      "pass_1_structure",
      "pass_2_argumentation",
      "pass_3_sentence_precision",
      "pass_4_grammar_terminology",
      "pass_5_typography_latex",
      "pass_6_integrity_audit",
    ].map((pass_id) => ({ pass_id, status: "completed" })),
    compile_receipts: ["academic_writer/build.log"],
    reference_verification_receipts: ["reviewer/CITATION_VERIFICATION.md"],
    number_consistency_receipts: ["academic_writer/NUMBER_AUDIT.md"],
  });

  const missingClaimEvidence = await evaluatePaperGuruGate({ projectRoot });
  assert.equal(missingClaimEvidence.status, "blocked");
  assert.match(
    missingClaimEvidence.missingSignals.join("\n"),
    /claim-evidence consistency receipt/i
  );

  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    pass_results: [
      "pass_1_structure",
      "pass_2_argumentation",
      "pass_3_sentence_precision",
      "pass_4_grammar_terminology",
      "pass_5_typography_latex",
      "pass_6_integrity_audit",
    ].map((pass_id) => ({ pass_id, status: "completed" })),
    compile_receipts: ["academic_writer/build.log"],
    reference_verification_receipts: ["reviewer/CITATION_VERIFICATION.md"],
    number_consistency_receipts: ["academic_writer/NUMBER_AUDIT.md"],
    claim_evidence_consistency_receipts: ["reviewer/CLAIM_EVIDENCE_AUDIT.md"],
  });

  const ready = await evaluatePaperGuruGate({ projectRoot });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.missingSignals, []);
  assert.deepEqual(ready.paperGuruState.claim_evidence_consistency_receipts, [
    "reviewer/CLAIM_EVIDENCE_AUDIT.md",
  ]);
});
