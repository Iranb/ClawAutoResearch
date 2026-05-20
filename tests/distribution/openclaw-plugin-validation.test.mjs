import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  validateOpenClawPluginRepository,
  formatOpenClawPluginValidationReport,
} from "../../scripts/validate-openclaw-plugin.mjs";

const execFileAsync = promisify(execFile);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildPackageJson(overrides = {}) {
  return {
    name: "claw-auto-research",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": {
        import: "./dist/index.js",
      },
      "./openclaw.plugin.json": "./openclaw.plugin.json",
    },
    engines: {
      node: ">=22.19.0",
    },
    peerDependencies: {
      openclaw: ">=2026.5.18",
    },
    peerDependenciesMeta: {
      openclaw: {
        optional: true,
      },
    },
    openclaw: {
      extensions: ["./dist/index.js"],
      pluginId: "ClawAutoResearch",
    },
    ...overrides,
  };
}

function buildManifest(overrides = {}) {
  return {
    id: "ClawAutoResearch",
    name: "ClawAutoResearch",
    description: "Test manifest",
    contracts: {
      tools: [
        "research_memory",
        "research_workflow",
        "auto_research",
        "auto_review",
      ],
    },
    toolMetadata: {
      research_memory: { optional: true },
      research_workflow: { optional: true },
      auto_research: { optional: true },
      auto_review: { optional: true },
    },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    ...overrides,
  };
}

async function writePluginFixture(repoRoot, { packageJson, manifest } = {}) {
  await writeJson(path.join(repoRoot, "package.json"), packageJson ?? buildPackageJson());
  await writeJson(
    path.join(repoRoot, "openclaw.plugin.json"),
    manifest ?? buildManifest()
  );
}

test("OpenClaw plugin validator accepts the current stable runtime contract", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-plugin-valid-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  await writePluginFixture(repoRoot);

  const result = await validateOpenClawPluginRepository({ repoRoot });
  assert.equal(result.ok, true);
  assert.equal(result.findingCount, 0);
  assert.match(formatOpenClawPluginValidationReport(result), /openclaw_plugin_validation_ok/);
  assert.equal(result.openclawCli.status, "skipped");
});

test("OpenClaw plugin validator rejects stale Node and OpenClaw floors", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-plugin-stale-floor-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  await writePluginFixture(repoRoot, {
    packageJson: buildPackageJson({
      engines: {
        node: ">=18.0.0",
      },
      peerDependencies: {
        openclaw: ">=2026.3.24",
      },
    }),
  });

  const result = await validateOpenClawPluginRepository({ repoRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.map((entry) => entry.code),
    ["node_floor_outdated", "openclaw_floor_outdated"]
  );
});

test("OpenClaw plugin validator CLI returns JSON failures", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-plugin-cli-failure-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  await writePluginFixture(repoRoot, {
    manifest: buildManifest({
      contracts: {
        tools: ["research_memory"],
      },
      toolMetadata: {
        research_memory: { optional: true },
      },
    }),
  });

  const scriptPath = path.join(process.cwd(), "scripts", "validate-openclaw-plugin.mjs");
  await assert.rejects(
    execFileAsync("node", [scriptPath, "--root", repoRoot, "--json"]),
    (error) => {
      assert.equal(error.code, 1);
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.ok(
        parsed.findings.some(
          (entry) => entry.code === "plugin_tool_contract_missing"
        )
      );
      assert.ok(
        parsed.findings.some(
          (entry) => entry.code === "plugin_tool_metadata_missing"
        )
      );
      return true;
    }
  );
});
