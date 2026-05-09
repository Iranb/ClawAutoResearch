import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

test("auto-research and auto-review can bootstrap to a passing deterministic E2E closeout", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-command-e2e-test-"));
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "run_auto_command_end_to_end.mjs"),
    "--topic",
    "Generalized Category Discovery",
    "--lane",
    "full",
    "--mode",
    "fixture",
    "--bootstrap-transport",
    "local",
    "--conversation-id",
    "e2e-unit-conversation",
    "--projects-root",
    projectsRoot,
    "--strict-content",
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.bootstrapTransport, "local");
  assert.equal(payload.strictContent, true);
  assert.equal(payload.conversationId, "e2e-unit-conversation");
  assert.equal(payload.result.experiment.transport, "local");
  assert.equal(payload.result.survey.transport, "local");
  assert.equal(payload.result.experiment.conversationId, "e2e-unit-conversation-experiment");
  assert.equal(payload.result.survey.conversationId, "e2e-unit-conversation-survey");
  assert.match(payload.result.experiment.bootstrap.sessionKey, /e2e-unit-conversation-experiment/);
  assert.match(payload.result.survey.bootstrap.sessionKey, /e2e-unit-conversation-survey/);
  assert.equal(payload.result.experiment.harness.finalVerdict, "pass");
  assert.equal(payload.result.survey.harness.finalVerdict, "pass");
  assert.equal(payload.result.experiment.harness.strictContent, true);
  assert.equal(payload.result.survey.harness.strictContent, true);
  assert.equal(payload.result.experiment.harness.contentQuality.status, "pass");
  assert.equal(payload.result.survey.harness.contentQuality.status, "pass");
  assert.ok((payload.result.experiment.handoffs ?? []).length >= 5);
  assert.ok((payload.result.survey.handoffs ?? []).length >= 2);
  assert.doesNotMatch(JSON.stringify(payload), /agent:[^"]*:discord:/);
  assert.doesNotMatch(JSON.stringify(payload), /gcd-research-local|gcd-survey-local/);

  const experimentReport = await fs.readFile(
    path.join(payload.result.experiment.projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"),
    "utf8"
  );
  const surveyReport = await fs.readFile(
    path.join(payload.result.survey.projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"),
    "utf8"
  );

  assert.match(experimentReport, /final_verdict: pass/);
  assert.match(surveyReport, /final_verdict: pass/);
  const surveyChecklist = JSON.parse(
    await fs.readFile(
      path.join(payload.result.survey.projectRoot, ".openclaw-research", "E2E_ARTIFACT_CHECKLIST.json"),
      "utf8"
    )
  );
  const surveyChecks = new Map(
    surveyChecklist.content_quality.checks.map((entry) => [entry.name, entry])
  );
  assert.equal(surveyChecks.get("paper_word_count_min").ok, true);
  assert.equal(surveyChecks.get("citation_density_min").ok, true);
  assert.equal(surveyChecks.get("bibliography_depth_min").ok, true);
  assert.equal(surveyChecks.get("sota_matrix_rows_min").ok, true);
  assert.equal(payload.result.survey.harness.benchmarkAdapter.status, "pass");
  assert.ok(await fs.access(path.join(payload.result.experiment.projectRoot, "academic_writer", "paper", "main.pdf")).then(() => true, () => false));
  assert.ok(await fs.access(path.join(payload.result.survey.projectRoot, "academic_writer", "paper", "main.pdf")).then(() => true, () => false));
});
