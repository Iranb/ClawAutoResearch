import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeSurveyStorylinePlanner } from "../tools/research-writing/survey-storyline-planner.ts";

async function ensureDir(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function writeFixtureProject(tempRoot, fixture) {
  await ensureDir(path.join(tempRoot, "PROJECT_MANIFEST.json"));
  await fs.writeFile(
    path.join(tempRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: fixture.project_id ?? "fixture-storyline-project",
        current_stage: "review",
        owner_agent: "researcher",
        workflow_line: "survey",
        survey_review: {
          status: "completed",
          topic: fixture.topic,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const artifacts = fixture.artifacts ?? {};
  for (const [relativePath, payload] of Object.entries(artifacts)) {
    const targetPath = path.join(tempRoot, relativePath);
    await ensureDir(targetPath);
    if (typeof payload === "string") {
      await fs.writeFile(targetPath, payload, "utf8");
    } else {
      await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }
  }
}

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    throw new Error("Usage: node scripts/replay_survey_storyline_planner.mjs <fixture.json>");
  }
  const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-survey-storyline-replay-")
  );
  try {
    await writeFixtureProject(projectRoot, rawFixture);
    const result = await materializeSurveyStorylinePlanner({
      projectRoot,
      topic: rawFixture.topic ?? null,
      configuredMode: "reviewer_judged",
    });
    const report = {
      fixture: path.basename(fixturePath),
      topic: rawFixture.topic ?? null,
      primary_selection: result.selection,
      shadow_selection: result.shadowSelection,
      planner_state: result.state,
      packet_summary: {
        selected_strategy_id: result.packet.selectedStrategyId,
        intellectual_center_section: result.packet.intellectualCenterSection,
        body_section_order: result.packet.bodySectionOrder,
      },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
