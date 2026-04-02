import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("workflow web handbook exists and includes bilingual workflow content", async () => {
  const repoRoot = process.cwd();
  const filePath = path.join(repoRoot, "DOC", "web", "workflow-handbook.html");
  const content = await fs.readFile(filePath, "utf8");

  assert.match(content, /data-lang-btn="en"/);
  assert.match(content, /data-lang-btn="zh"/);
  assert.match(content, /Stage Flow|阶段流/);
  assert.match(content, /PROJECT_MANIFEST\.json/);
  assert.match(content, /\/monitor-experiment/);
  assert.match(content, /GATE-5/);
});

test("docs index exposes the workflow web handbook", async () => {
  const repoRoot = process.cwd();
  const docs = [
    path.join(repoRoot, "DOC", "README.md"),
    path.join(repoRoot, "DOC", "overview.md"),
    path.join(repoRoot, "DOC", "overview_zh.md"),
  ];

  for (const filePath of docs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /workflow-handbook\.html/i);
  }
});
