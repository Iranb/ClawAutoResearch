import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("workflow-owned upload docs teach queued ingestion requests instead of direct agent-owned uploads", async () => {
  const repoRoot = process.cwd();
  const files = [
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "research-pipeline", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "graph-build", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "resume-pipeline", "SKILL.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "TOOLS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
    path.join(repoRoot, "tools", "workflow-guard.ts"),
  ];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /queue_paper_ingestion/i,
      `Expected ${filePath} to teach workflow-owned queued paper ingestion.`
    );
  }
});
