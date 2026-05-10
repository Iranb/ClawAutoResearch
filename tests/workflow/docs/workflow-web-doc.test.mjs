import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function read(repoRoot, relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("package.json exposes VitePress docs scripts", async () => {
  const repoRoot = process.cwd();
  const pkg = JSON.parse(await read(repoRoot, "package.json"));

  assert.equal(typeof pkg.scripts?.["docs:dev"], "string");
  assert.equal(typeof pkg.scripts?.["docs:build"], "string");
  assert.equal(typeof pkg.scripts?.["docs:preview"], "string");
  assert.match(pkg.scripts["docs:build"], /vitepress\s+build\s+docs/);
  assert.equal(typeof pkg.devDependencies?.vitepress, "string");
});

test("VitePress config defines the unified docs portal and GitHub Pages base handling", async () => {
  const repoRoot = process.cwd();
  const config = await read(repoRoot, "docs/.vitepress/config.mts");

  assert.match(config, /defineConfig/);
  assert.match(config, /ClawAutoResearch Docs/);
  assert.match(config, /Get Started|快速开始/);
  assert.match(config, /Workflow|工作流/);
  assert.match(config, /Lobster Handoffs|lobster-handoffs/);
  assert.match(config, /Graph & Memory|图谱与记忆/);
  assert.match(config, /Agents & Skills|角色与技能/);
  assert.match(config, /Runtime & Reference|运行时与参考/);
  assert.match(config, /Dev & Ops|开发与运维/);
  assert.match(config, /Internal History|内部历史/);
  assert.match(config, /GITHUB_REPOSITORY/);
  assert.match(config, /base:/);
});

test("home page and detailed docs pages cover the current system design", async () => {
  const repoRoot = process.cwd();
  const checks = [
    [
      "docs/index.md",
      [/ClawAutoResearch/, /VitePress/, /PaperNexus/, /PROJECT_MANIFEST\.json/, /workflow-guard/],
    ],
    [
      "docs/get-started/installation.md",
      [/install\.sh/, /projectsRoot/, /research_workflow/, /heartbeat/],
    ],
    [
      "docs/get-started/project-lifecycle.md",
      [/\/project-init/, /\/graph-build/, /\/resume-pipeline/, /graph presence/],
    ],
    [
      "docs/architecture/workflow-control-plane.md",
      [/auto_iterator_tick/, /graph_build/, /frontier_mapping/, /research_program/, /Lobster|handoff/],
    ],
    [
      "docs/architecture/lobster-handoffs.md",
      [/Lobster/, /dispatch_task/, /auto_iterator_tick/, /fallbackToNative/, /workflow-mailbox/],
    ],
    [
      "docs/architecture/graph-memory.md",
      [/PaperNexus/, /EXPERIMENT_LEDGER\.json/, /innovation_reflection/, /papernexusSharedCorpus/],
    ],
    [
      "docs/architecture/agents-and-skills.md",
      [/researcher/, /orchestrator/, /academic_writer/, /workflow mailbox/],
    ],
    [
      "docs/reference/commands-and-tools.md",
      [/\/research-pipeline/, /\/show-commands/, /research_workflow/, /research_memory/, /auto_iterator_tick/],
    ],
    [
      "docs/reference/state-contracts.md",
      [/PROJECT_MANIFEST\.json/, /TRACK_REGISTRY\.json/, /workflow-mailbox\.json/, /paper_story_state/],
    ],
    [
      "docs/reference/module-map.md",
      [/tools\/workflow-guard\.ts/, /tools\/lobster-handoff\.ts/, /tools\/graph-presence\.ts/, /tools\/research-writing/],
    ],
    [
      "docs/reference/configuration.md",
      [/projectsRoot/, /enableWorkflowMailbox/, /lobsterHandoff/, /papernexusAccessMode/, /papernexusSharedCorpus/],
    ],
    [
      "docs/operations/github-pages.md",
      [/GitHub Pages/, /vitepress build docs/, /\.github\/workflows/, /base/],
    ],
    [
      "docs/internal-history.md",
      [/docs\/superpowers/, /specs/, /plans/],
    ],
  ];

  for (const [relativePath, patterns] of checks) {
    const content = await read(repoRoot, relativePath);
    for (const pattern of patterns) {
      assert.match(content, pattern, `${relativePath} should include ${pattern}`);
    }
  }
});

test("legacy entrypoints point readers to the new unified docs portal", async () => {
  const repoRoot = process.cwd();
  const markdownEntries = [
    "README.md",
    "README_zh.md",
    "README_BEGINNER_zh.md",
    "CONFIG.md",
    "WORKSPACE.md",
    "DOC/README.md",
    "DOC/overview.md",
    "DOC/overview_zh.md",
  ];

  for (const relativePath of markdownEntries) {
    const content = await read(repoRoot, relativePath);
    assert.match(content, /docs\//i, `${relativePath} should reference the new docs root`);
    assert.match(content, /VitePress|Docs Portal|统一文档站/i, `${relativePath} should mention the new docs portal`);
  }

  const legacyHtml = await read(repoRoot, "DOC/web/workflow-handbook.html");
  assert.match(legacyHtml, /http-equiv="refresh"/i);
  assert.match(legacyHtml, /\.\.\/\.\.\/docs\//i);
});
