import test from "node:test";
import assert from "node:assert/strict";

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
