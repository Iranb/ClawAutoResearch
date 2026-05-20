import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prepareDistRuntime } from "../../scripts/prepare-dist-runtime.mjs";
import { verifyDistRuntime } from "../../scripts/verify-dist-runtime.mjs";

async function writeFileEnsured(targetPath, contents) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, "utf8");
}

async function writeRequiredTemplates(repoRoot) {
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
  await writeRequiredTemplates(repoRoot);

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

test("prepareDistRuntime removes ignored iCloud conflict copy build artifacts", async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "claw-auto-research-prepare-dist-conflict-")
  );
  const distRoot = path.join(repoRoot, "dist");
  const toolsRoot = path.join(repoRoot, "tools");

  await writeFileEnsured(
    path.join(distRoot, "tools", "literature-discovery", "requisition-executor 2.js"),
    "export const stale = true;\n"
  );
  await writeFileEnsured(
    path.join(distRoot, "tools", "literature-discovery", "requisition-executor 2.d.ts"),
    "export declare const stale = true;\n"
  );
  await writeFileEnsured(
    path.join(distRoot, "tools", "literature-discovery", "requisition-executor.js"),
    "export const current = true;\n"
  );
  await writeRequiredTemplates(repoRoot);

  try {
    await assert.rejects(
      verifyDistRuntime({ distRoot }),
      /ignored iCloud conflict artifacts in dist/
    );

    const result = await prepareDistRuntime({ repoRoot, distRoot, toolsRoot });
    assert.equal(result.removedConflictArtifactCount, 2);

    await assert.doesNotReject(verifyDistRuntime({ distRoot }));
    await fs.access(
      path.join(distRoot, "tools", "literature-discovery", "requisition-executor.js")
    );
    await assert.rejects(
      fs.access(
        path.join(
          distRoot,
          "tools",
          "literature-discovery",
          "requisition-executor 2.js"
        )
      )
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("tsconfig excludes ignored iCloud conflict source copies from broad tools include", async () => {
  const tsconfig = JSON.parse(await fs.readFile("tsconfig.json", "utf8"));
  assert.ok(
    tsconfig.include.includes("tools/**/*.ts"),
    "test assumes tools/**/*.ts remains the broad compile include"
  );
  assert.ok(
    tsconfig.exclude.includes("**/* [0-9].*"),
    "tsconfig must exclude iCloud conflict copies such as tools/foo 2.ts"
  );
});
