import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  smokeOpenClawPluginRuntime,
  formatOpenClawPluginRuntimeSmokeReport,
} from "../../scripts/smoke-openclaw-plugin-runtime.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFixtureRuntime(repoRoot) {
  await fs.mkdir(path.join(repoRoot, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "dist", "index.js"),
    [
      "export default {",
      '  id: "FixturePlugin",',
      '  name: "FixturePlugin",',
      '  description: "Fixture plugin",',
      "  register(api) {",
      "    api.registerTool({",
      '      name: "declared_tool",',
      '      description: "Declared tool.",',
      '      parameters: { type: "object", additionalProperties: false, properties: {} },',
      "      async execute() { return { content: [{ type: \"text\", text: \"ok\" }] }; },",
      '    }, { name: "declared_tool", optional: true });',
      "    api.registerTool({",
      '      name: "extra_tool",',
      '      description: "Extra tool.",',
      '      parameters: { type: "object", additionalProperties: false, properties: {} },',
      "      async execute() { return { content: [{ type: \"text\", text: \"ok\" }] }; },",
      '    }, { name: "extra_tool", optional: true });',
      "    api.registerCommand({ name: \"fixture\", description: \"Fixture command\", handler() { return { text: \"ok\" }; } });",
      "    api.on(\"fixture_hook\", () => undefined);",
      "    api.registerService({ id: \"fixture-service\", start() {} });",
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8"
  );
}

test("OpenClaw runtime smoke registers manifest tool contracts from dist", async () => {
  const result = await smokeOpenClawPluginRuntime({ repoRoot: process.cwd() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.registeredTools, [
    "auto_research",
    "auto_review",
    "research_memory",
    "research_workflow",
  ]);
  assert.ok(result.commandNames.length > 0);
  assert.ok(result.hookNames.length > 0);
  assert.ok(result.serviceIds.length > 0);
  assert.match(
    formatOpenClawPluginRuntimeSmokeReport(result),
    /openclaw_plugin_runtime_smoke_ok/
  );
});

test("OpenClaw runtime smoke reports dist runtime and manifest tool drift", async (t) => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-plugin-runtime-smoke-drift-")
  );
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(repoRoot, "openclaw.plugin.json"), {
    id: "FixturePlugin",
    name: "FixturePlugin",
    contracts: {
      tools: ["declared_tool", "missing_tool"],
    },
  });
  await writeFixtureRuntime(repoRoot);

  const result = await smokeOpenClawPluginRuntime({ repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      (entry) =>
        entry.code === "plugin_runtime_tool_contract_not_registered" &&
        entry.message.includes("missing_tool")
    )
  );
  assert.ok(
    result.findings.some(
      (entry) =>
        entry.code === "plugin_runtime_registered_tool_missing_manifest_contract" &&
        entry.message.includes("extra_tool")
    )
  );
});
