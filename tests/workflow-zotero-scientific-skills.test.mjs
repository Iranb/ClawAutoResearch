import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("workflow indexes Zotero-aware literature management and selected scientific skills by role", async () => {
  const repoRoot = process.cwd();
  const skillIndex = await readJson(path.join(repoRoot, "skills", "index.json"));

  assert.ok(skillIndex.researcher.includes("./researcher/zotero-project-library"));
  assert.ok(skillIndex.researcher.includes("./researcher/scientific-brainstorming"));
  assert.ok(skillIndex.academic_writer.includes("./academic_writer/citation-management"));
  assert.ok(skillIndex.academic_writer.includes("./academic_writer/venue-templates"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/scientific-critical-thinking"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/scholar-evaluation"));
  assert.ok(skillIndex.reviewer.includes("./reviewer/peer-review"));
  assert.ok(skillIndex.coder.includes("./coder/scientific-visualization"));
});

test("workflow docs and agent guides mention Zotero bot collections and the new scientific-skill handoffs", async () => {
  const repoRoot = process.cwd();
  const docs = [
    path.join(repoRoot, "WORKFLOW.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
    path.join(repoRoot, "DOC", "reference", "agents.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "agents", "academic_writer", "SOUL.md"),
    path.join(repoRoot, "agents", "reviewer", "AGENTS.md"),
    path.join(repoRoot, "agents", "reviewer", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "AGENTS.md"),
    path.join(repoRoot, "agents", "coder", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "TOOLS.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "literature-review", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "review-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "citation-integrity-gate", "SKILL.md"),
    path.join(repoRoot, "skills", "coder", "implement-experiment", "SKILL.md"),
  ];

  const zoteroDocs = [
    path.join(repoRoot, "WORKFLOW.md"),
    path.join(repoRoot, "DOC", "reference", "skills.md"),
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
    path.join(repoRoot, "DOC", "reference", "agents.md"),
    path.join(repoRoot, "agents", "researcher", "AGENTS.md"),
    path.join(repoRoot, "agents", "researcher", "SOUL.md"),
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "agents", "academic_writer", "SOUL.md"),
    path.join(repoRoot, "skills", "researcher", "research-lit", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "graph-build", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "literature-review", "SKILL.md"),
    path.join(repoRoot, "skills", "researcher", "idea-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
  ];

  for (const filePath of zoteroDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(
      content,
      /zotero|bot\/<project-id>|bot collection|zotero project/i,
      `Expected ${filePath} to mention Zotero-backed project literature management.`
    );
  }

  const slashCommands = await fs.readFile(
    path.join(repoRoot, "DOC", "reference", "slash-commands.md"),
    "utf8"
  );
  assert.match(slashCommands, /\/zotero-sync/i);
  assert.match(slashCommands, /zoteroProjectRoot|configured.*project.*path|global.*root/i);
  assert.match(
    slashCommands,
    /remove.*project collection|项目 collection 移除|不删除|不丢进|do not delete|do not trash/i
  );

  const configDoc = await fs.readFile(
    path.join(repoRoot, "DOC", "reference", "configuration.md"),
    "utf8"
  );
  assert.match(configDoc, /zoteroApiKey/i);
  assert.match(configDoc, /zoteroApiKeyEnv/i);

  const zoteroSkill = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "zotero-project-library", "SKILL.md"),
    "utf8"
  );
  assert.match(zoteroSkill, /apiKey|API key/i);
  assert.match(zoteroSkill, /never print|never persist/i);

  const writerDocs = [
    path.join(repoRoot, "agents", "academic_writer", "AGENTS.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
    path.join(repoRoot, "skills", "academic_writer", "citation-preflight", "SKILL.md"),
  ];
  for (const filePath of writerDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /citation-management/i);
    assert.match(content, /venue-templates/i);
  }
  const paperPlan = await fs.readFile(
    path.join(repoRoot, "skills", "academic_writer", "paper-plan", "SKILL.md"),
    "utf8"
  );
  assert.match(paperPlan, /IDEA_TO_CLAIM_MAP\.json/i);
  assert.match(paperPlan, /idea fragments|idea-to-claim/i);
  assert.match(paperPlan, /PREWRITE_REJECTION_SIMULATION\.md/i);
  assert.match(paperPlan, /CONTRIBUTION_TO_STORY_BRIDGE\.md/i);
  assert.match(paperPlan, /FIGURE_ANCHOR_PLAN\.md/i);
  assert.match(paperPlan, /thesis crystallization|thesis statement/i);
  assert.match(paperPlan, /so what/i);
  assert.match(paperPlan, /what did we know before|delta/i);

  const paperWrite = await fs.readFile(
    path.join(repoRoot, "skills", "academic_writer", "paper-write", "SKILL.md"),
    "utf8"
  );
  assert.match(paperWrite, /WRITING_REFERENCE_BUNDLE\.json/i);
  assert.match(paperWrite, /FALLBACK_ACTIVATION\.json/i);
  assert.match(paperWrite, /PAPER_REVISION_STATE\.json/i);
  assert.match(paperWrite, /self-attack/i);
  assert.match(paperWrite, /writing quality|AI-typical|burstiness/i);
  assert.match(paperWrite, /reader'?s journey|where am i\?|load-bearing paragraph|clarity test/i);
  assert.match(paperWrite, /claim verification|major distortion|unverifiable/i);

  const researchPaperWriting = await fs.readFile(
    path.join(repoRoot, "skills", "academic_writer", "research-paper-writing", "SKILL.md"),
    "utf8"
  );
  assert.match(researchPaperWriting, /counterintuitive-writing\.md/i);
  assert.match(researchPaperWriting, /story-planning-rules\.md/i);
  assert.match(researchPaperWriting, /self-attack-protocol\.md/i);
  assert.match(researchPaperWriting, /figure-centric-writing\.md/i);
  assert.match(researchPaperWriting, /writing-quality-check\.md/i);
  assert.match(researchPaperWriting, /writing-judgment-framework\.md/i);
  assert.match(researchPaperWriting, /thesis-crystallization\.md/i);

  const reviewerDocs = [
    path.join(repoRoot, "agents", "reviewer", "AGENTS.md"),
    path.join(repoRoot, "skills", "reviewer", "review-phase", "SKILL.md"),
    path.join(repoRoot, "skills", "reviewer", "citation-integrity-gate", "SKILL.md"),
  ];
  for (const filePath of reviewerDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /scientific-critical-thinking/i);
    assert.match(content, /scholar-evaluation/i);
    assert.match(content, /peer-review/i);
  }
  const reviewPhase = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "review-phase", "SKILL.md"),
    "utf8"
  );
  assert.match(reviewPhase, /internal validity|external validity|contribution/i);
  assert.match(
    reviewPhase,
    /originality|methodological rigor|evidence sufficiency|argument coherence|writing quality/i
  );

  const paperReview = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "paper-review", "SKILL.md"),
    "utf8"
  );
  assert.match(paperReview, /internal validity|external validity|contribution/i);
  assert.match(
    paperReview,
    /claim verification|major distortion|unverifiable|three lenses/i
  );
  const reviewResponse = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "review-response", "SKILL.md"),
    "utf8"
  );
  assert.match(reviewResponse, /champion/i);
  assert.match(
    reviewResponse,
    /fix_now|downgrade_claim|defer_with_scope_boundary|rebut_with_existing_evidence/i
  );
  assert.match(reviewResponse, /red|amber|green/i);

  const rebuttalTemplate = await fs.readFile(
    path.join(repoRoot, "skills", "reviewer", "review-response", "REBUTTAL_TEMPLATE.md"),
    "utf8"
  );
  assert.match(rebuttalTemplate, /Champion Strategy/i);
  assert.match(rebuttalTemplate, /Priority Color/i);

  const ideaTournament = await fs.readFile(
    path.join(repoRoot, "skills", "researcher", "idea-tournament", "SKILL.md"),
    "utf8"
  );
  assert.match(ideaTournament, /15/i);
  assert.match(ideaTournament, /9/i);
  assert.match(ideaTournament, /scarcity/i);

  const coderDocs = [
    path.join(repoRoot, "agents", "coder", "AGENTS.md"),
    path.join(repoRoot, "agents", "coder", "SOUL.md"),
    path.join(repoRoot, "agents", "coder", "TOOLS.md"),
    path.join(repoRoot, "skills", "coder", "implement-experiment", "SKILL.md"),
  ];
  for (const filePath of coderDocs) {
    const content = await fs.readFile(filePath, "utf8");
    assert.match(content, /scientific-visualization/i);
  }
});

test("scientific-visualization skill captures publication and matplotlib guardrails for Coder", async () => {
  const repoRoot = process.cwd();
  const skillPath = path.join(
    repoRoot,
    "skills",
    "coder",
    "scientific-visualization",
    "SKILL.md"
  );
  const content = await fs.readFile(skillPath, "utf8");

  assert.match(content, /object-oriented API|Figure\/Axes|fig,\s*ax/i);
  assert.match(content, /subplot_mosaic|GridSpec/i);
  assert.match(content, /colorblind-safe|Okabe-Ito/i);
  assert.match(content, /PDF|SVG|PNG/i);
  assert.match(content, /Analyzer/i);
  assert.match(content, /baseline vs proposed|baseline and proposed/i);
});
