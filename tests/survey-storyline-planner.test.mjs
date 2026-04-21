import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { materializeSurveyStorylinePlanner } from "../tools/research-writing/survey-storyline-planner.ts";

const execFile = promisify(execFileCallback);

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeSurveyPlannerProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-survey-storyline-planner-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-gcd",
    current_stage: "review",
    owner_agent: "researcher",
    workflow_line: "survey",
    survey_review: {
      status: "completed",
      topic: "Generalized Category Discovery",
    },
  });
  await Promise.all([
    writeText(
      path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
      "# Survey Brief\n\n## Themes\n- Prototype-centric methods\n- Prompt-driven methods\n\n## Benchmark Landscape\n- Comparisons only make sense when open-set assumptions match.\n\n## Open Problems\n- Metric drift still distorts reported wins.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
      "# Literature Review\n\n## Taxonomy\n- Prototype-centric methods\n- Prompt-driven methods\n\n## Benchmark Caveats\n- Several papers are non-comparable because they change open-set assumptions.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
      "# SOTA Matrix\n\n| Method | Family | Notes | Dataset | Metric |\n| --- | --- | --- | --- | --- |\n| A | Prototype | non-comparable protocol caveat | CIFAR100 | Accuracy |\n| B | Prompt | evaluation drift warning | ImageNet100 | H-score |\n| C | Hybrid | metric mismatch warning | CUB | F1 |\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
      "# Gap Synthesis\n\n## Open Problems\n- Result tables still mix non-comparable open-set assumptions.\n- Benchmark wins remain fragile under metric drift.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
      "# Coverage Summary\n\n- Search coverage spans core benchmark families.\n- Scope boundaries and blind spots are explicit.\n- Evaluation drift remains central.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"),
      "# Review Protocol\n\n- Benchmark comparisons must stay tied to dataset split and metric assumptions.\n- Non-comparable settings should be called out explicitly.\n"
    ),
    writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
      papers: [
        { canonical_id: "arxiv:2501.00001", title: "Paper A", year: 2025 },
        { canonical_id: "arxiv:2501.00002", title: "Paper B", year: 2025 },
        { canonical_id: "arxiv:2501.00003", title: "Paper C", year: 2024 },
      ],
    }),
    writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
      backgroundPapers: [
        {
          title: "Open World Recognition Survey",
          reason: "boundary reference when open-set assumptions shift",
        },
      ],
    }),
    writeJson(
      path.join(projectRoot, "researcher", "CANDIDATE_SCREENING_DECISIONS.json"),
      {
        decisions: [
          {
            title: "Open World Recognition Survey",
            decision: "background",
            reason: "boundary reference when open-set assumptions shift",
          },
        ],
      }
    ),
  ]);
  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: params.runtime ?? {},
    logger: params.logger ?? {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "researcher",
          sessionKey: params.sessionKey ?? "agent:researcher:test",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

test("materializeSurveyStorylinePlanner writes candidate, judge, selection, and shadow artifacts", async (t) => {
  const projectRoot = await makeSurveyPlannerProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeSurveyStorylinePlanner({
    projectRoot,
    topic: "Generalized Category Discovery",
    configuredMode: "reviewer_judged",
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.activePrimaryMode, "reviewer_judged");
  assert.equal(result.selection.selectedStrategyId, "evaluation_crisis_first");
  assert.equal(result.shadowSelection.mode, "learned_shadow");
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_STORYLINE_CANDIDATES.json"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_STORYLINE_JUDGE_PACKET.json"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_STORYLINE_SELECTION.json"));
  assert.ok(
    result.generatedFiles.includes("academic_writer/SURVEY_STORYLINE_SHADOW_SELECTION.json")
  );
});

test("research_workflow exposes storyline planner materialization and summary actions", async (t) => {
  const projectRoot = await makeSurveyPlannerProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.OPENCLAW_PROJECT = projectRoot;

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const materialized = await executeWorkflowTool(tool, {
    action: "materialize_storyline_planner_state",
    storylinePlannerMaterialization: {
      topic: "Generalized Category Discovery",
      configured_mode: "reviewer_judged",
    },
  });
  assert.equal(materialized.state.status, "ready");

  const summary = await executeWorkflowTool(tool, {
    action: "get_storyline_planner_state",
  });
  assert.equal(summary.state.status, "ready");
  assert.equal(summary.candidateExists, true);
  assert.equal(summary.judgePacketExists, true);
  assert.equal(summary.selectionExists, true);
  assert.equal(summary.shadowSelectionExists, true);
});

test("replay_survey_storyline_planner replays benchmark-first fixture deterministically", async () => {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "storyline-planner",
    "benchmark-first.json"
  );
  const { stdout } = await execFile("node", [
    "scripts/replay_survey_storyline_planner.mjs",
    fixturePath,
  ], {
    cwd: process.cwd(),
  });
  const report = JSON.parse(stdout);
  assert.equal(report.primary_selection.selectedStrategyId, "evaluation_crisis_first");
  assert.equal(report.packet_summary.intellectual_center_section, "benchmark_landscape");
});

test("replay_survey_storyline_planner replays taxonomy-first fixture deterministically", async () => {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "storyline-planner",
    "taxonomy-first.json"
  );
  const { stdout } = await execFile("node", [
    "scripts/replay_survey_storyline_planner.mjs",
    fixturePath,
  ], {
    cwd: process.cwd(),
  });
  const report = JSON.parse(stdout);
  assert.equal(report.primary_selection.selectedStrategyId, "taxonomy_first");
  assert.equal(report.packet_summary.intellectual_center_section, "taxonomy");
});
