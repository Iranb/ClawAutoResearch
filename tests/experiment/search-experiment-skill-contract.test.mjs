import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("coder search-experiment skill requires candidate review board before dispatch", async () => {
  const repoRoot = process.cwd();
  const skill = await fs.readFile(
    path.join(repoRoot, "skills", "coder", "search-experiment", "SKILL.md"),
    "utf8"
  );

  assert.match(skill, /next_candidate_guidance/);
  assert.match(skill, /candidate_review_board/);
  assert.match(skill, /performance_reviewer/);
  assert.match(skill, /innovation_reviewer/);
  assert.match(skill, /plan_reviewer/);
  assert.match(skill, /primary-metric improvement mechanism/i);
  assert.match(skill, /Innovation Packet \/ idea anchors/i);
  assert.match(skill, /plan\/search-spec consistency/i);
  assert.match(skill, /hard reject candidates that hit avoid lists or lack a new `one_change_signature`/i);
  assert.match(skill, /performance_reviewer=approve/);
  assert.match(skill, /at least 2 of 3 reviewer votes/i);
  assert.match(skill, /before calling `research_workflow\.request_experiment_git_op`/);
  assert.match(skill, /Do not launch parallel candidate branches/i);
});
