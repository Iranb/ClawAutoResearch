import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syncOpenClawAgentModels } from "../../scripts/sync_openclaw_agent_models.mjs";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("syncOpenClawAgentModels restores missing configured provider models from openclaw.json", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-model-sync-"));
  const openclawHome = path.join(tempRoot, ".openclaw");
  const agentDir = path.join(openclawHome, "agents", "academic_writer", "agent");
  const configPath = path.join(openclawHome, "openclaw.json");
  const modelsPath = path.join(agentDir, "models.json");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                { id: "qwen3.5-plus", name: "qwen3.5-plus" },
                { id: "qwen3.6-plus", name: "qwen3.6-plus" },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: ["bailian/qwen3.5-plus"],
            },
          },
          list: [
            {
              id: "academic_writer",
              agentDir,
              model: {
                primary: "bailian/qwen3.6-plus",
                fallbacks: ["bailian/qwen3.5-plus"],
              },
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    modelsPath,
    `${JSON.stringify(
      {
        providers: {
          bailian: {
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            apiKey: "",
            api: "openai-completions",
            models: [{ id: "qwen3.5-plus", name: "qwen3.5-plus" }],
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const summary = await syncOpenClawAgentModels({
    openclawHome,
    configPath,
    agentIds: ["academic_writer"],
  });

  assert.equal(summary.counts.repaired, 1);
  assert.equal(summary.results[0]?.status, "repaired");
  assert.deepEqual(summary.results[0]?.addedModelRefs, ["bailian/qwen3.6-plus"]);
  assert.deepEqual(summary.results[0]?.filledFields, ["bailian.apiKey"]);

  const nextModels = await readJson(modelsPath);
  assert.equal(nextModels.providers.bailian.apiKey, "test-key");
  assert.deepEqual(
    nextModels.providers.bailian.models.map((entry) => entry.id),
    ["qwen3.5-plus", "qwen3.6-plus"]
  );
});

test("syncOpenClawAgentModels supports dry-run without mutating models.json", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-model-sync-dry-"));
  const openclawHome = path.join(tempRoot, ".openclaw");
  const agentDir = path.join(openclawHome, "agents", "academic_writer", "agent");
  const configPath = path.join(openclawHome, "openclaw.json");
  const modelsPath = path.join(agentDir, "models.json");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                { id: "qwen3.5-plus", name: "qwen3.5-plus" },
                { id: "qwen3.6-plus", name: "qwen3.6-plus" },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
            },
          },
          list: [{ id: "academic_writer", agentDir }],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const original = {
    providers: {
      bailian: {
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "test-key",
        api: "openai-completions",
        models: [{ id: "qwen3.5-plus", name: "qwen3.5-plus" }],
      },
    },
  };
  await fs.writeFile(modelsPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

  const summary = await syncOpenClawAgentModels({
    openclawHome,
    configPath,
    agentIds: ["academic_writer"],
    dryRun: true,
  });

  assert.equal(summary.counts.dryRun, 1);
  assert.equal(summary.results[0]?.status, "dry-run");
  assert.deepEqual(summary.results[0]?.addedModelRefs, ["bailian/qwen3.6-plus"]);
  assert.deepEqual(await readJson(modelsPath), original);
});

test("syncOpenClawAgentModels keeps default fallbacks when an agent declares an empty fallback list", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-model-sync-default-fallback-"));
  const openclawHome = path.join(tempRoot, ".openclaw");
  const agentDir = path.join(openclawHome, "agents", "researcher", "agent");
  const configPath = path.join(openclawHome, "openclaw.json");
  const modelsPath = path.join(agentDir, "models.json");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                { id: "qwen3.5-plus", name: "qwen3.5-plus" },
                { id: "qwen3.6-plus", name: "qwen3.6-plus" },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: ["bailian/qwen3.5-plus"],
            },
          },
          list: [
            {
              id: "researcher",
              agentDir,
              model: {
                primary: "bailian/qwen3.6-plus",
                fallbacks: [],
              },
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    modelsPath,
    `${JSON.stringify(
      {
        providers: {
          bailian: {
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            apiKey: "test-key",
            api: "openai-completions",
            models: [],
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const summary = await syncOpenClawAgentModels({
    openclawHome,
    configPath,
    agentIds: ["researcher"],
  });

  assert.equal(summary.counts.repaired, 1);
  assert.deepEqual(summary.results[0]?.addedModelRefs, [
    "bailian/qwen3.6-plus",
    "bailian/qwen3.5-plus",
  ]);

  const nextModels = await readJson(modelsPath);
  assert.deepEqual(
    nextModels.providers.bailian.models.map((entry) => entry.id),
    ["qwen3.6-plus", "qwen3.5-plus"]
  );
});
