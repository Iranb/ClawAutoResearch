import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeInnovationSynthesis } from "../tools/research-writing/innovation-synthesis.ts";

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("innovation synthesis infers a bounded GCD contribution from experiment manifests", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-innovation-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "innovation-fallback",
    current_stage: "write",
    workflow_line: "experiment",
    research_program: {
      status: "active",
      goal: "Use FixMatch generalization ideas to improve GCD.",
      problem_statement:
        "Generalized category discovery needs a bounded known/novel evidence contract.",
      tracks: [
        {
          track_id: "track-gcd",
          status: "active",
          hypothesis: "",
          novelty_basis: "",
        },
      ],
    },
    write_package: {
      status: "ready",
      winning_track_ids: ["track-gcd"],
    },
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
    },
    results_storyline: { status: "ready" },
    title_abstract_intro_workbench: { status: "ready" },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
    "A FixMatch-style consistency filter can bound pseudo-label acceptance in generalized category discovery."
  );
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "# Claim Evidence Matrix\n\nThe local experiment supports a FixMatch-style consistency filtering claim for GCD.\n"
  );
  await writeText(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    "# Unsupported Claims\n\nNo unsupported GCD claims remain.\n"
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-gcd",
      "exp-1__fixmatch_gcd",
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: "exp-1",
      method: "FixMatch weak/strong consistency filtering for generalized category discovery.",
      metrics: {
        h_score: 0.3404,
        known_accuracy: 0.8778,
        novel_accuracy: 0.2111,
      },
    }
  );

  const result = await materializeInnovationSynthesis({ projectRoot, stage: "write" });
  assert.equal(result.state.status, "ready");
  assert.equal(result.state.innovationPoints.length, 1);
  assert.match(
    result.state.innovationPoints[0].claim ?? "",
    /FixMatch-style consistency filtering/i
  );
  assert.equal(result.storyGapSearch, null);
});
