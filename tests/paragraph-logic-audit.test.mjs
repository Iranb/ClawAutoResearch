import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeParagraphLogicAudit } from "../tools/research-writing/paragraph-logic-audit.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("materializeParagraphLogicAudit marks ready when adjacent paragraphs are explicitly bridged", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-paragraph-logic-ready-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "logic-ready",
    writing_contract: {
      section_order: ["introduction"],
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "introduction.tex"),
    [
      "Generalized category discovery remains hard because pseudo-label noise distorts class boundaries. This motivates a workflow that centers confirmation-bias control.",
      "",
      "To address this, the next paragraph focuses on how the paper organizes evidence around debiasing mechanisms. That bridge keeps the reader on the same argument spine.",
    ].join("\n")
  );

  const result = await materializeParagraphLogicAudit({ projectRoot });
  assert.equal(result.state.status, "ready");
  assert.equal(result.blockingIssues.length, 0);
});

test("materializeParagraphLogicAudit marks blocked when adjacent paragraphs jump without anchors or transitions", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-paragraph-logic-blocked-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "logic-blocked",
    writing_contract: {
      section_order: ["introduction"],
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "introduction.tex"),
    [
      "Generalized category discovery remains hard because pseudo-label noise distorts class boundaries. This motivates a workflow that centers confirmation-bias control.",
      "",
      "Rack temperature alarms and fan failures require maintenance coordination in large datacenters. Operators archive those thermals for capacity planning.",
    ].join("\n")
  );

  const result = await materializeParagraphLogicAudit({ projectRoot });
  assert.equal(result.state.status, "blocked");
  assert.equal(result.blockingIssues.length > 0, true);

  const report = await fs.readFile(
    path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.md"),
    "utf8"
  );
  assert.match(report, /adjacent paragraphs change topic/i);
});

test("materializeParagraphLogicAudit records advisory section-to-section handoff issues", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-paragraph-logic-sections-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "logic-section-handoff",
    writing_contract: {
      section_order: ["introduction", "related_work"],
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "introduction.tex"),
    [
      "Generalized category discovery remains hard because pseudo-label noise distorts class boundaries. This motivates a workflow that centers confirmation-bias control.",
      "",
      "These challenges make evidence discipline essential for the paper's core argument. The section therefore frames why a controlled debiasing mechanism matters.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "related_work.tex"),
    [
      "Foundation model deployment policies often track GPU rack power envelopes in multi-tenant clusters. Those scheduling constraints shape system operations in large datacenters.",
      "",
      "Prior literature also studies unrelated operational heuristics. Those heuristics do not recover the class-boundary argument from the introduction.",
    ].join("\n")
  );

  const result = await materializeParagraphLogicAudit({ projectRoot });
  assert.equal(result.state.sectionTransitionAdvisoryIssueCount > 0, true);

  const report = await fs.readFile(
    path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.md"),
    "utf8"
  );
  assert.match(report, /Section Transition Issues/i);
  assert.match(report, /introduction -> related_work/i);
});
