import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowHooks } from "../tools/register-workflow-hooks.ts";

function createHookHarness(pluginConfig = {}) {
  const handlers = new Map();
  const api = {
    runtime: {},
    logger: {},
    pluginConfig,
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowHooks(plugin);
  return {
    getHandler(name) {
      const handler = handlers.get(name);
      assert.equal(typeof handler, "function", `Expected hook ${name} to be registered`);
      return handler;
    },
  };
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("before_prompt_build does not inject Workflow Guard into non-workflow agents", async () => {
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello from dashboard" }],
        },
      ],
    },
    {
      agentId: "designer",
      workspaceDir: "/tmp/custom-agent-workspace",
      sessionKey: "agent:designer:dashboard:main",
      sessionId: "session-designer",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.equal(result, undefined);
});

test("before_prompt_build does not inject Workflow Guard into custom dashboard agents that inherit a workflow-like session key", async () => {
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello from dashboard" }],
        },
      ],
    },
    {
      agentId: "designer",
      workspaceDir: "/tmp/custom-agent-workspace",
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-designer",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.equal(result, undefined);
});

test("before_prompt_build still injects Workflow Guard into workflow agents", async () => {
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "continue the workflow" }],
        },
      ],
    },
    {
      agentId: "researcher",
      workspaceDir: "/tmp/researcher-workspace",
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-researcher",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Workflow Guard\]/);
});

test("before_prompt_build does not materialize stage contracts while reading workflow state", async (t) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-readonly-"));
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");

  t.after(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  await writeJson(path.join(workspaceDir, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "idea",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    research_program: {
      status: "approved",
      goal: "repair idea stage",
      problem_statement: "sparse ideation state",
      baseline_reference: "SimGCD",
      primary_metric: "All ACC",
      datasets: ["CUB-200"],
      success_criteria: ["All ACC > 53.4%"],
      zotero_project_path: "bot/demo-project",
      tracks: [],
    },
    innovation_reflection: {
      status: "fresh",
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
  });
  await writeJson(path.join(workspaceDir, "TRACK_REGISTRY.json"), {
    tracks: [],
  });
  const ideationPacketPath = path.join(
    workspaceDir,
    "researcher",
    "ideation",
    "GRAPH_IDEATION_PACKET.json"
  );

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "continue the workflow" }],
        },
      ],
    },
    {
      agentId: "researcher",
      workspaceDir,
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-researcher",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Workflow Guard\]/);
  await assert.rejects(fs.stat(ideationPacketPath));
});

test("before_tool_call ignores workflow-specific guards for custom agents that inherit a workflow-like session key", async () => {
  const harness = createHookHarness({
    blockDiscordAgentMentions: true,
  });
  const beforeToolCall = harness.getHandler("before_tool_call");

  const result = await beforeToolCall(
    {
      toolName: "message",
      params: {
        content: "@researcher please take a look",
      },
    },
    {
      agentId: "designer",
      workspaceDir: "/tmp/custom-agent-workspace",
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-designer",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.equal(result, undefined);
});
