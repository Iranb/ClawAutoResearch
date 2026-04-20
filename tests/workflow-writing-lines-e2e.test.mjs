import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializePaperStoryState,
  materializeSurveyReviewState,
  runWorkflowAutoIterator,
} from "../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# artifact\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeProjectRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readManifest(projectRoot) {
  return JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8"),
  );
}

async function seedSurveyReviewProject(projectRoot) {
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-graph-reasoning",
    title: "Graph Reasoning Survey",
    current_stage: "survey_review",
    current_micro_stage: "survey_requested",
    owner_agent: "researcher",
    updated_at: "2026-04-09T12:30:00.000Z",
    survey_review: {
      topic: "Graph reasoning survey",
      mode: "deep",
    },
  });

  await writeJson(
    path.join(projectRoot, "researcher", "SURVEY_QUERY_REGISTRY.json"),
    {
      rounds: [
        { query: "graph reasoning survey", provider: "papers-cool" },
        { query: "graph reasoning review", provider: "pasa-paper-search" },
      ],
      candidate_paper_count: 12,
    },
  );
  await writeText(
    path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"),
    "# Review Protocol\n\n- Main benchmarks: SurveyBench, GraphArena.\n- Main metrics: Accuracy, F1.\n",
  );
  await writeJson(
    path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"),
    {
      papers: [
        { canonical_id: "arxiv:2501.00001" },
        { canonical_id: "arxiv:2501.00002" },
        { canonical_id: "arxiv:2501.00004" },
        { canonical_id: "arxiv:2501.00005" },
        { canonical_id: "arxiv:2501.00006" },
        { canonical_id: "arxiv:2501.00007" },
      ],
    },
  );
  await writeJson(
    path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"),
    {
      papers: [{ canonical_id: "arxiv:2401.00003" }],
    },
  );
  await writeText(
    path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
    [
      "# Literature Review",
      "",
      "## Taxonomy",
      "- Graph pretraining",
      "- Graph reasoning agents",
    ].join("\n"),
  );
  await writeText(path.join(projectRoot, "researcher", "SOTA_MATRIX.md"), "# SOTA Matrix\n");
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    [
      "# SOTA Matrix",
      "",
      "| Paper | Family | Dataset | Metric |",
      "| --- | --- | --- | --- |",
      "| A | Graph pretraining | SurveyBench | Accuracy |",
      "| B | Reasoning agents | GraphArena | F1 |",
      "| C | Hybrid systems | TaskGraph | mAP |",
    ].join("\n"),
  );
  await writeText(
    path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
    "# Gap Synthesis\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n- Cross-family comparison is still weak.\n",
  );
  await writeText(
    path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
    "# Coverage Summary\n\n- Search coverage spans core venues.\n- Included papers cover three benchmark families.\n- Blind spots are documented.\n",
  );
  await writeText(
    path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
    "# Survey Brief\n\n## Themes\n- Graph pretraining\n- Graph reasoning agents\n- Hybrid systems\n\n## Open Problems\n- Benchmark coverage remains fragmented.\n",
  );
}

test("end-to-end survey paper line advances survey review into survey-mode write without experiment-only theory blockers", async (t) => {
  const projectRoot = await makeProjectRoot(
    "openclaw-research-writing-line-survey-",
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await seedSurveyReviewProject(projectRoot);

  const surveyState = await materializeSurveyReviewState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });
  assert.equal(surveyState.state.status, "completed");

  const storyState = await materializePaperStoryState({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });
  assert.equal(storyState.state.status, "ready");

  const transition = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const manifestAfterTransition = await readManifest(projectRoot);

  assert.equal(transition.stageBefore, "survey_review");
  assert.equal(transition.stageAfter, "write");
  assert.equal(manifestAfterTransition.current_stage, "survey_review");
  assert.equal(manifestAfterTransition.owner_agent, "researcher");
  assert.equal(
    manifestAfterTransition.orchestration_state.pending_owner_candidate,
    "academic_writer",
  );
  assert.equal(
    manifestAfterTransition.orchestration_state.pending_stage_candidate,
    "write",
  );
  assert.equal(
    manifestAfterTransition.orchestration_state.handoff_phase,
    "prepared",
  );
  assert.equal(manifestAfterTransition.writing_contract.paper_mode, "survey");
  assert.deepEqual(manifestAfterTransition.writing_contract.required_sections, [
    "abstract",
    "introduction",
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
    "conclusion",
  ]);
  assert.equal(manifestAfterTransition.writing_contract.proof_appendix_required, false);

  manifestAfterTransition.current_stage = "write";
  manifestAfterTransition.current_micro_stage = "writing_requested";
  manifestAfterTransition.owner_agent = "academic_writer";
  delete manifestAfterTransition.paper_story_state;
  delete manifestAfterTransition.review_pressure_packet;
  manifestAfterTransition.orchestration_state = {
    ...(manifestAfterTransition.orchestration_state ?? {}),
    current_owner: "academic_writer",
    pending_handoff_id: null,
    pending_owner_candidate: null,
    pending_stage_candidate: null,
    handoff_phase: "activated",
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifestAfterTransition);

  const writeGate = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(writeGate.stageBefore, "write");
  assert.equal(writeGate.stageAfter, "write");
  assert.ok(
    writeGate.missingStageSignals.some((signal) =>
      /writing process is not bootstrapped yet|writing process is /i.test(signal),
    ),
  );
  assert.ok(
    !writeGate.missingStageSignals.some((signal) =>
      /appendix_theory\.tex|THEORY_STATE\.json/i.test(signal),
    ),
  );
  assert.ok(
    !writeGate.missingStageSignals.some((signal) =>
      /framework figure|experiment\/result tables/i.test(signal),
    ),
  );
  assert.ok(
    !writeGate.missingStageSignals.some((signal) =>
      /paper_story_state|idea fragments|review_pressure_packet/i.test(signal),
    ),
  );
});

test("misrouted survey projects self-heal back onto survey_review instead of looping through experiment stages", async (t) => {
  const projectRoot = await makeProjectRoot(
    "openclaw-research-writing-line-survey-recovery-",
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await seedSurveyReviewProject(projectRoot);

  const manifest = await readManifest(projectRoot);
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "judging";
  manifest.owner_agent = "researcher";
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
    paper_mode: "survey",
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  const healedManifest = await readManifest(projectRoot);

  assert.equal(result.stageBefore, "survey_review");
  assert.equal(result.stageAfter, "write");
  assert.equal(healedManifest.current_stage, "survey_review");
  assert.equal(healedManifest.owner_agent, "researcher");
  assert.equal(
    healedManifest.orchestration_state.pending_owner_candidate,
    "academic_writer",
  );
  assert.equal(
    healedManifest.orchestration_state.pending_stage_candidate,
    "write",
  );
  assert.equal(healedManifest.writing_contract.paper_mode, "survey");
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /graph-backed innovation evidence|active track .*missing/i.test(signal),
    ),
  );
});
