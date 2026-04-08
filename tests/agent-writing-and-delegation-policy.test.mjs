import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("writer, reviewer, and cross-reviewer SOULs share the writing constitution", async () => {
  const [writerSoul, reviewerSoul, crossReviewerSoul] = await Promise.all([
    readRepoFile("agents/academic_writer/SOUL.md"),
    readRepoFile("agents/reviewer/SOUL.md"),
    readRepoFile("agents/cross-reviewer/SOUL.md"),
  ]);

  for (const [label, content] of [
    ["academic_writer", writerSoul],
    ["reviewer", reviewerSoul],
    ["cross-reviewer", crossReviewerSoul],
  ]) {
    assert.match(
      content,
      /Shared Writing Constitution/i,
      `Expected ${label} SOUL to declare the shared writing constitution.`
    );
    assert.match(
      content,
      /formal academic tone/i,
      `Expected ${label} SOUL to require formal academic tone.`
    );
    assert.match(
      content,
      /consistent terminology/i,
      `Expected ${label} SOUL to require terminology consistency.`
    );
    assert.match(
      content,
      /proper paragraphs/i,
      `Expected ${label} SOUL to prohibit bullet-dump manuscript prose.`
    );
  }

  assert.match(writerSoul, /one paragraph = one message|one paragraph for one message/i);
  assert.match(writerSoul, /topic sentence|first sentence/i);
  assert.match(writerSoul, /bridge to the next paragraph|smooth transitions/i);
  assert.match(reviewerSoul, /evaluate prose against the shared writing constitution/i);
  assert.match(crossReviewerSoul, /review prose against the shared writing constitution/i);
});

test("core agent prompts document an interruptible delegation policy", async () => {
  const [researcherAgents, writerAgents, reviewerAgents, crossReviewerAgents] =
    await Promise.all([
      readRepoFile("agents/researcher/AGENTS.md"),
      readRepoFile("agents/academic_writer/AGENTS.md"),
      readRepoFile("agents/reviewer/AGENTS.md"),
      readRepoFile("agents/cross-reviewer/AGENTS.md"),
    ]);

  for (const [label, content] of [
    ["researcher", researcherAgents],
    ["academic_writer", writerAgents],
    ["reviewer", reviewerAgents],
    ["cross-reviewer", crossReviewerAgents],
  ]) {
    assert.match(
      content,
      /Responsiveness (?:&|and) Delegation Policy/i,
      `Expected ${label} AGENTS to describe the delegation policy.`
    );
    assert.match(
      content,
      /interruptible/i,
      `Expected ${label} AGENTS to keep the main session interruptible.`
    );
    assert.match(
      content,
      /Goal:/i,
      `Expected ${label} AGENTS to include the required sub-agent brief fields.`
    );
    assert.match(
      content,
      /Current phase:/i,
      `Expected ${label} AGENTS to include the milestone report format.`
    );
  }

  assert.match(researcherAgents, />20 seconds/i);
  assert.match(researcherAgents, />2 minutes/i);
  assert.match(writerAgents, /5-10 minutes|5–10 minutes/i);
  assert.match(reviewerAgents, /stop the current branch immediately|stop the current review branch immediately/i);
  assert.match(crossReviewerAgents, /single-turn inline review|one-turn inline review/i);
});

test("agent bootstrap guides stay within a prompt-safe size budget while preserving stable role rules", async () => {
  const agentFiles = [
    "agents/researcher/AGENTS.md",
    "agents/orchestrator/AGENTS.md",
    "agents/coder/AGENTS.md",
    "agents/analyzer/AGENTS.md",
    "agents/academic_writer/AGENTS.md",
    "agents/reviewer/AGENTS.md",
    "agents/cross-reviewer/AGENTS.md",
  ];

  for (const relativePath of agentFiles) {
    const content = await readRepoFile(relativePath);
    assert.ok(
      content.length <= 12_000,
      `Expected ${relativePath} to stay under the bootstrap prompt budget, got ${content.length} chars.`
    );
    assert.match(
      content,
      /\.openclaw-research|PROJECTS_ROOT/i,
      `Expected ${relativePath} to preserve the stable runtime/project scope rules.`
    );
    assert.match(
      content,
      /HEARTBEAT_OK/i,
      `Expected ${relativePath} to keep the heartbeat contract visible.`
    );
  }
});
