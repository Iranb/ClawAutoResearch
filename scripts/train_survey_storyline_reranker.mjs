import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectSurveyStorylineSignals,
  buildSurveyStorylineCandidates,
} from "../tools/research-writing/survey-storyline.ts";
import {
  buildSurveyStorylineFeatureVector,
} from "../tools/research-writing/survey-storyline-planner.ts";
import {
  trainLearnedStorylineModel,
  writeLearnedStorylineModel,
} from "../tools/research-writing/survey-storyline-model.ts";

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
  const fixturePaths = process.argv.slice(2);
  if (fixturePaths.length === 0) {
    throw new Error(
      "Usage: node scripts/train_survey_storyline_reranker.mjs <fixture.json> [fixture2.json ...]"
    );
  }

  const examples = [];
  for (const fixturePath of fixturePaths) {
    const rawFixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    if (typeof rawFixture.expected_primary_strategy_id !== "string") {
      throw new Error(
        `Fixture ${fixturePath} is missing expected_primary_strategy_id`
      );
    }
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "openclaw-survey-storyline-train-")
    );
    try {
      await writeFixtureProject(projectRoot, rawFixture);
      const signals = await collectSurveyStorylineSignals({
        projectRoot,
        topic: rawFixture.topic ?? null,
      });
      const candidates = buildSurveyStorylineCandidates({
        topic: signals.topic,
        familyLines: signals.familyLines,
        benchmarkLines: signals.benchmarkLines,
        benchmarkPressureLines: signals.benchmarkPressureLines,
        gapLines: signals.gapLines,
        contradictionLines: signals.contradictionLines,
        coverageLines: signals.coverageLines,
        backgroundLines: signals.backgroundLines,
        litReviewText: signals.literatureReviewText,
        surveyBriefText: signals.surveyBriefText,
        reviewProtocolText: signals.reviewProtocolText,
      });
      examples.push({
        fixtureName: path.basename(fixturePath),
        expectedStrategyId: rawFixture.expected_primary_strategy_id,
        candidateFeatureVectors: candidates.map((candidate) => ({
          strategyId: candidate.strategyId,
          featureVector: buildSurveyStorylineFeatureVector(signals, candidate),
        })),
      });
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  }

  const model = trainLearnedStorylineModel({
    examples,
  });
  const outputPath = await writeLearnedStorylineModel({ model });
  process.stdout.write(
    `${JSON.stringify(
      {
        output_path: outputPath,
        model_id: model.modelId,
        training_example_count: model.trainingExampleCount,
        confidence_margin_threshold: model.confidenceMarginThreshold,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
