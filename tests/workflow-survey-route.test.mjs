import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeSurveyReviewState,
  runWorkflowAutoIterator,
  setOrchestrationState,
} from "../tools/workflow-guard.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# artifact\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeProjectRoot(prefix = "openclaw-research-survey-route-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readManifest(projectRoot) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8"));
}

test("survey project id recovers frontier_mapping into survey_review instead of idea", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    title: "GCD Survey TPAMI 2026",
    current_stage: "frontier_mapping",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    requesterSessionKey: "agent:researcher:discord:channel:1493115797856452619",
    sessionBindingKey: "binding:discord:researcher:channel:1493115797856452619",
  });
  const manifest = await readManifest(projectRoot);

  assert.equal(result.stageBefore, "survey_review");
  assert.equal(result.stageAfter, "survey_review");
  assert.equal(manifest.workflow_line, "survey");
  assert.equal(manifest.paper_type, "survey");
  assert.equal(manifest.writing_contract.paper_mode, "survey");
  assert.equal(manifest.survey_review.topic, "GCD Survey TPAMI 2026");
  assert.doesNotMatch(result.nextAction ?? "", /idea-phase|code|experiment/i);
});

test("completed survey_review advances to survey-mode write without code or experiment", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    title: "GCD Survey TPAMI 2026",
    workflow_line: "survey",
    paper_type: "survey",
    current_stage: "plan",
    owner_agent: "orchestrator",
    writing_contract: { paper_mode: "survey" },
    idle_research: { enabled: false },
    survey_review: {
      topic: "GCD survey",
      status: "completed",
      gate_ready: true,
      coverage_status: "ready",
      taxonomy_stability_status: "stable",
      representative_methods_status: "ready",
      benchmark_alignment_status: "aligned",
      gap_closure_status: "closed",
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });
  await writeJson(path.join(projectRoot, "researcher", "SURVEY_QUERY_REGISTRY.json"), {
    rounds: [{ query: "gcd survey" }, { query: "gcd review" }],
    candidate_paper_count: 12,
  });
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: [
      { canonical_id: "paper:1" },
      { canonical_id: "paper:2" },
      { canonical_id: "paper:3" },
      { canonical_id: "paper:4" },
      { canonical_id: "paper:5" },
      { canonical_id: "paper:6" },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    papers: [],
  });
  await writeJson(path.join(projectRoot, "researcher", "SURVEY_GATE_DIAGNOSTICS.json"), {
    ready: true,
  });
  await writeText(path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"));
  await writeText(path.join(projectRoot, "researcher", "SOTA_MATRIX.md"), [
    "# SOTA Matrix",
    "",
    "| Paper | Family | Dataset | Metric |",
    "| --- | --- | --- | --- |",
    "| A | Graph pretraining | SurveyBench | Accuracy |",
    "| B | Reasoning agents | GraphArena | F1 |",
    "| C | Hybrid systems | TaskGraph | mAP |",
  ].join("\n"));
  await writeText(path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"), [
    "# Coverage Summary",
    "",
    "- Search coverage spans core venues.",
    "- Included papers cover three benchmark families.",
    "- Blind spots are documented.",
  ].join("\n"));
  await writeText(path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"), [
    "# Literature Review",
    "",
    "## Taxonomy",
    "- Graph pretraining",
    "- Graph reasoning agents",
    "- Hybrid systems",
  ].join("\n"));
  await writeText(path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"), [
    "# Gap Synthesis",
    "",
    "## Open Problems",
    "- Benchmark coverage remains fragmented.",
    "- Cross-family comparison is still weak.",
  ].join("\n"));
  await writeText(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), [
    "# Survey Brief",
    "",
    "## Themes",
    "- Graph pretraining",
    "- Reasoning agents",
    "- Hybrid systems",
    "",
    "## Open Problems",
    "- Benchmark coverage remains fragmented.",
  ].join("\n"));

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    requesterSessionKey: "agent:researcher:discord:channel:1493115797856452619",
    sessionBindingKey: "binding:discord:researcher:channel:1493115797856452619",
  });
  const manifest = await readManifest(projectRoot);

  assert.equal(result.stageBefore, "survey_review");
  assert.equal(result.stageAfter, "write");
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.writing_contract.paper_mode, "survey");
  assert.equal(
    manifest.orchestration_state.pending_owner_candidate,
    "academic_writer"
  );
  assert.equal(
    manifest.orchestration_state.pending_stage_candidate,
    "write"
  );
  assert.equal(manifest.orchestration_state.handoff_phase, "prepared");
  const handoffStore = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(handoffStore.intents.length, 1);
  assert.equal(
    handoffStore.intents[0].fromSessionKey,
    "agent:researcher:discord:channel:1493115797856452619"
  );
  assert.equal(
    handoffStore.intents[0].sessionBindingKey,
    "binding:discord:researcher:channel:1493115797856452619"
  );
  assert.ok(
    !result.recommendedActions.some(
      (action) => action.owner === "coder" || action.stage === "code" || action.stage === "experiment"
    )
  );
});

test("materialize_survey_review_state creates a survey outline packet", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    current_stage: "survey_review",
    owner_agent: "researcher",
    workflow_line: "survey",
    paper_type: "survey",
    writing_contract: { paper_mode: "survey" },
    survey_review: { topic: "GCD survey", status: "searching" },
  });

  const result = await materializeSurveyReviewState({
    projectRoot,
    surveyReviewMaterialization: { topic: "GCD survey" },
  });

  assert.ok(result.generatedFiles.includes("researcher/SURVEY_OUTLINE.md"));
  assert.match(
    await fs.readFile(path.join(projectRoot, "researcher", "SURVEY_OUTLINE.md"), "utf8"),
    /Survey Outline/
  );
});

test("survey orchestration mutation toward code is repaired to survey_review", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    workflow_line: "survey",
    paper_type: "survey",
    current_stage: "survey_review",
    owner_agent: "researcher",
    writing_contract: { paper_mode: "survey" },
    survey_review: { topic: "GCD survey", status: "searching" },
  });

  const result = await setOrchestrationState({
    projectRoot,
    orchestrationState: {
      status: "running",
      current_owner: "researcher",
      next_transition_candidate: "code",
    },
  });

  assert.equal(result.state.nextTransitionCandidate, "survey_review");
});
