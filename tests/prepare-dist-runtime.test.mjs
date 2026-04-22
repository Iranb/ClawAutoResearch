import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prepareDistRuntime } from "../scripts/prepare-dist-runtime.mjs";
import { verifyDistRuntime } from "../scripts/verify-dist-runtime.mjs";

async function writeFileEnsured(targetPath, contents) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, "utf8");
}

test("prepareDistRuntime copies workflow templates into dist/templates", async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "claw-auto-research-prepare-dist-")
  );
  const distRoot = path.join(repoRoot, "dist");
  const toolsRoot = path.join(repoRoot, "tools");

  await writeFileEnsured(
    path.join(distRoot, "tools", "example.js"),
    'export const value = 1;\n'
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "PROJECT_MANIFEST.json"),
    "{}\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "TRACK_REGISTRY.json"),
    "{}\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "EXPERIMENT_LEDGER.json"),
    "{}\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "IDLE_RESEARCH.example.json"),
    "{}\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "CLAIM_POLICY.md"),
    "# claim policy\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "memory", "ideation-memory.md"),
    "# ideation\n"
  );
  await writeFileEnsured(
    path.join(repoRoot, "templates", "memory", "experiment-memory.md"),
    "# experiment\n"
  );

  try {
    const result = await prepareDistRuntime({ repoRoot, distRoot, toolsRoot });
    assert.equal(result.templatesCopied, true);

    await verifyDistRuntime({ distRoot });

    for (const relativePath of [
      "PROJECT_MANIFEST.json",
      "TRACK_REGISTRY.json",
      "EXPERIMENT_LEDGER.json",
      "IDLE_RESEARCH.example.json",
      "CLAIM_POLICY.md",
      path.join("memory", "ideation-memory.md"),
      path.join("memory", "experiment-memory.md"),
    ]) {
      await fs.access(path.join(distRoot, "templates", relativePath));
    }
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
