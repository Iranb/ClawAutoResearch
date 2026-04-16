import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("researcher exposes markxiv between the direct arxiv2md API and legacy arxiv2md, and docs follow the new order", async () => {
  const repoRoot = process.cwd();
  const skillIndexPath = path.join(repoRoot, "skills", "index.json");
  const skillIndex = await readJson(skillIndexPath);
  const researcherSkills = skillIndex.researcher;

  assert.ok(Array.isArray(researcherSkills));

  const huggingFaceIndex = researcherSkills.indexOf("./researcher/hugging-face-paper-pages");
  const directMarkdownIndex = researcherSkills.indexOf("./researcher/arxiv2md-api");
  const markxivIndex = researcherSkills.indexOf("./researcher/markxiv");
  const arxiv2mdIndex = researcherSkills.indexOf("./researcher/arxiv2md");

  assert.notEqual(huggingFaceIndex, -1);
  assert.notEqual(directMarkdownIndex, -1);
  assert.notEqual(markxivIndex, -1);
  assert.notEqual(arxiv2mdIndex, -1);
  assert.ok(
    huggingFaceIndex < directMarkdownIndex &&
      directMarkdownIndex < markxivIndex &&
      markxivIndex < arxiv2mdIndex,
    "Expected markxiv to sit between arxiv2md-api and arxiv2md."
  );

  const newSkillRoot = path.join(repoRoot, "skills", "researcher", "markxiv");
  const skillMarkdown = await fs.readFile(path.join(newSkillRoot, "SKILL.md"), "utf8");
  const skillScript = await fs.readFile(
    path.join(newSkillRoot, "scripts", "fetch_markxiv.py"),
    "utf8"
  );

  assert.match(skillMarkdown, /^---[\s\S]*name:\s*markxiv/m);
  assert.match(skillMarkdown, /https:\/\/markxiv\.org\/abs\//);
  assert.match(skillScript, /https:\/\/markxiv\.org\/abs\//);

  const fullOrderDocs = [
    path.join(repoRoot, "DOC", "overview.md"),
    path.join(repoRoot, "DOC", "overview_zh.md"),
    path.join(repoRoot, "DOC", "concepts", "architecture.md"),
    path.join(repoRoot, "DOC", "concepts", "papernexus-memory-and-reflection.md"),
    path.join(repoRoot, "skills", "researcher", "papers-cool", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "hugging-face-paper-pages", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "markxiv", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "arxiv2md", "SKILL.md"),
    path.join(repoRoot, "tools", "workflow-guard.ts"),
  ];
  const listOrderDocs = [
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
  ];

  const expectedOrderPattern =
    /hugging-face-paper-pages[\s\S]{0,220}arxiv2md-api[\s\S]{0,220}markxiv[\s\S]{0,220}arxiv2md[\s\S]{0,220}(PDF|pdf)/i;
  const expectedListOrderPattern =
    /hugging-face-paper-pages[\s\S]{0,220}arxiv2md-api[\s\S]{0,220}markxiv[\s\S]{0,220}arxiv2md/i;

  for (const filePath of fullOrderDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      expectedOrderPattern,
      `Expected ${filePath} to mention the new markdown-first ingestion order.`
    );
  }

  for (const filePath of listOrderDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      expectedListOrderPattern,
      `Expected ${filePath} to list the new markdown fallback order.`
    );
  }
});

test("workflow-owned researcher skills describe remote-only staging instead of local PaperNexus storage", async () => {
  const repoRoot = process.cwd();
  const docsThatMustAvoidLocalStorage = [
    path.join(repoRoot, "skills", "researcher", "research-pipeline", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "papers-cool", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "hugging-face-paper-pages", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "arxiv2md-api", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "markxiv", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "arxiv2md", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "graph-build", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "frontier-mapping", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
  ];

  for (const filePath of docsThatMustAvoidLocalStorage) {
    const content = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /~\/\.papernexus\/papers|\/Users\/iranb\/\.papernexus\/papers|~\/\.papernexus\/index-store|PAPERNEXUS_ROOT|src\/cli\/index\.js (?:query|context|impact|ideas|brainstorm|status)/i,
      `Expected ${filePath} to avoid local PaperNexus storage/CLI guidance in remote-only mode.`
    );
  }

  const docsThatMustTeachRemoteOnly = [
    path.join(repoRoot, "skills", "researcher", "research-pipeline", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "graph-build", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "frontier-mapping", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "hugging-face-paper-pages", "SKILL.md"),
  ];

  for (const filePath of docsThatMustTeachRemoteOnly) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /remote PaperNexus|HTTP MCP|MCP-first|research_lookup|research_briefing|idea_catalyst|import_workflow|pn_stage_sync\.py|pn_import_submit\.py|pn_import_queue\.py|pn_batch_import\.py/i,
      `Expected ${filePath} to teach MCP-first remote PaperNexus workflow usage with queued import wrappers as fallback.`
    );
  }
});

test("researcher-facing PaperNexus skills and persona docs stay MCP-first instead of teaching raw typed REST calls", async () => {
  const repoRoot = process.cwd();
  const files = [
    path.join(repoRoot, "skills", "researcher", "papernexus", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "papernexus-agentic-reasoning", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "innovation-reflection", "SKILL.md"),
    path.join(repoRoot, "skills", "analyzer", "papernexus-reflection", "SKILL.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "TOOLS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
  ];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /remote PaperNexus HTTP MCP|MCP-first|research_lookup|research_briefing|idea_catalyst|import_workflow/i,
      `Expected ${filePath} to teach the HTTP MCP-first control plane.`
    );
    assert.doesNotMatch(
      content,
      /POST \/api\/(?:query|context|impact|ideas|brainstorm|path-trace|evidence-chain|reflection-chain|research-brief|brainstorm-brief|theory-brief|storyline-brief)|GET \/api\/(?:imports|corpus|corpus-meta|enhancements|paper-enhancement)/i,
      `Expected ${filePath} to avoid teaching raw typed REST calls as the primary agent interface.`
    );
  }
});

test("workflow-owned PaperNexus docs teach MCP-first live graph access and wrapper-backed import fallback", async () => {
  const repoRoot = process.cwd();
  const files = [
    path.join(repoRoot, "skills", "researcher", "papernexus", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "papernexus-agentic-reasoning", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "graph-build", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "innovation-reflection", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "resume-pipeline", "SKILL.md"),
    path.join(repoRoot, "skills", "analyzer", "papernexus-reflection", "SKILL.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "TOOLS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
  ];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /remote PaperNexus HTTP MCP|MCP-first|research_lookup|research_briefing|idea_catalyst|import_workflow/i,
      `Expected ${filePath} to teach workflow-owned MCP-first PaperNexus access.`
    );
    assert.match(
      content,
      /pn_stage_sync\.py|pn_import_submit\.py|pn_import_queue\.py|pn_batch_import\.py/i,
      `Expected ${filePath} to preserve queued import wrapper guidance.`
    );
    assert.doesNotMatch(
      content,
      /papernexus query|papernexus context|papernexus impact|papernexus ideas|papernexus brainstorm|papernexus watch|papernexus materialize|papernexus build-graph|papernexus merge-graph|papernexus write-index/i,
      `Expected ${filePath} to avoid legacy live-graph PaperNexus CLI guidance.`
    );
  }

  const workflowGuardPath = path.join(repoRoot, "tools", "workflow-guard.ts");
  const workflowGuard = await fs.readFile(workflowGuardPath, "utf8");
  assert.match(
    workflowGuard,
    /research_lookup|research_briefing|idea_catalyst|import_workflow/i,
    `Expected ${workflowGuardPath} to teach the workflow-owned PaperNexus MCP control plane.`
  );
});
