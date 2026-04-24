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
    "--projects-root",
    projectsRoot,
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.bootstrapTransport, "local");
  assert.equal(payload.result.experiment.transport, "local");
  assert.equal(payload.result.survey.transport, "local");
  assert.equal(payload.result.experiment.harness.finalVerdict, "pass");
  assert.equal(payload.result.survey.harness.finalVerdict, "pass");
  assert.ok((payload.result.experiment.handoffs ?? []).length >= 5);
  assert.ok((payload.result.survey.handoffs ?? []).length >= 2);
  assert.doesNotMatch(JSON.stringify(payload), /agent:[^"]*:discord:/);

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
  assert.ok(await fs.access(path.join(payload.result.experiment.projectRoot, "academic_writer", "paper", "main.pdf")).then(() => true, () => false));
  assert.ok(await fs.access(path.join(payload.result.survey.projectRoot, "academic_writer", "paper", "main.pdf")).then(() => true, () => false));
});
