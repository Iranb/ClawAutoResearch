import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  findIgnoredConflictCopies,
  findSourceJavaScriptShadowPairs,
  formatConflictCopyReport,
} from "../../scripts/check_source_hygiene.mjs";

const execFileAsync = promisify(execFile);

async function writeFileEnsured(targetPath, contents = "") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, "utf8");
}

test("source hygiene diagnostic reports local conflict copies without scanning generated dirs", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-source-hygiene-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  await writeFileEnsured(path.join(repoRoot, "tools", "worker 2.ts"), "stale\n");
  await writeFileEnsured(path.join(repoRoot, "tests", "workflow", "runtime 2", "x.test.mjs"), "stale\n");
  await writeFileEnsured(path.join(repoRoot, ".openclaw-research", "runtime 2.json"), "generated\n");
  await writeFileEnsured(path.join(repoRoot, "docs", ".vitepress", "dist", "page 2.html"), "generated\n");
  await writeFileEnsured(path.join(repoRoot, "dist", "tools", "compiled 2.js"), "generated\n");
  await writeFileEnsured(path.join(repoRoot, "node_modules 2", "pkg", "index.js"), "generated\n");
  await writeFileEnsured(path.join(repoRoot, "tools", "worker.ts"), "current\n");

  const report = await findIgnoredConflictCopies({ repoRoot });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((entry) => entry.path),
    ["tests/workflow/runtime 2", "tools/worker 2.ts"]
  );
  assert.match(formatConflictCopyReport(report), /source_hygiene_conflict_copies_found count=2/);
});

test("source hygiene CLI is read-only by default and fails only when requested", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-source-hygiene-cli-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  await writeFileEnsured(path.join(repoRoot, "tools", "shadow 2.ts"), "stale\n");
  const scriptPath = path.join(process.cwd(), "scripts", "check_source_hygiene.mjs");

  const defaultRun = await execFileAsync("node", [scriptPath, "--root", repoRoot]);
  assert.match(defaultRun.stdout, /source_hygiene_conflict_copies_found count=1/);

  await assert.rejects(
    execFileAsync("node", [
      scriptPath,
      "--root",
      repoRoot,
      "--json",
      "--fail-on-findings",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.findingCount, 1);
      assert.equal(parsed.findings[0]?.path, "tools/shadow 2.ts");
      return true;
    }
  );
});

test("source hygiene can report TypeScript source files shadowed by sibling JavaScript", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-source-hygiene-js-shadow-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  await writeFileEnsured(path.join(repoRoot, "tools", "workflow-guard.ts"), "export const current = true;\n");
  await writeFileEnsured(path.join(repoRoot, "tools", "workflow-guard.js"), "export const stale = true;\n");
  await writeFileEnsured(path.join(repoRoot, "tools", "passive.ts"), "export const current = true;\n");
  await writeFileEnsured(path.join(repoRoot, "tools", "passive.js"), "export const stale = true;\n");
  await writeFileEnsured(
    path.join(repoRoot, "tools", "consumer.ts"),
    "import { stale } from './workflow-guard.js';\n"
  );
  await writeFileEnsured(path.join(repoRoot, "tools", "only-js.js"), "export const ok = true;\n");
  await writeFileEnsured(path.join(repoRoot, "dist", "tools", "generated.ts"), "generated\n");
  await writeFileEnsured(path.join(repoRoot, "dist", "tools", "generated.js"), "generated\n");
  await writeFileEnsured(
    path.join(repoRoot, "dist", "tools", "generated-consumer.ts"),
    "import '../../tools/passive.js';\n"
  );

  const report = await findSourceJavaScriptShadowPairs({ repoRoot });
  assert.equal(report.ok, false);
  const passivePair = report.shadowPairs.find(
    (pair) => pair.jsPath === "tools/passive.js"
  );
  const activePair = report.shadowPairs.find(
    (pair) => pair.jsPath === "tools/workflow-guard.js"
  );
  assert.equal(report.shadowPairCount, 2);
  assert.deepEqual(passivePair, {
    kind: "source_js_shadow",
    importedBy: [],
    jsPath: "tools/passive.js",
    sourceImportCount: 0,
    tsPath: "tools/passive.ts",
  });
  assert.deepEqual(activePair, {
    kind: "source_js_shadow",
    importedBy: ["tools/consumer.ts"],
    jsPath: "tools/workflow-guard.js",
    sourceImportCount: 1,
    tsPath: "tools/workflow-guard.ts",
  });

  const scriptPath = path.join(process.cwd(), "scripts", "check_source_hygiene.mjs");
  await assert.rejects(
    execFileAsync("node", [
      scriptPath,
      "--root",
      repoRoot,
      "--json",
      "--include-js-shadows",
      "--fail-on-findings",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.findingCount, 0);
      assert.equal(parsed.jsShadowPairCount, 2);
      const parsedActivePair = parsed.jsShadowPairs.find(
        (pair) => pair.jsPath === "tools/workflow-guard.js"
      );
      const parsedPassivePair = parsed.jsShadowPairs.find(
        (pair) => pair.jsPath === "tools/passive.js"
      );
      assert.equal(parsedActivePair?.sourceImportCount, 1);
      assert.deepEqual(parsedActivePair?.importedBy, ["tools/consumer.ts"]);
      assert.equal(parsedPassivePair?.sourceImportCount, 0);
      assert.deepEqual(parsedPassivePair?.importedBy, []);
      return true;
    }
  );
});
