import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowHooks } from "../tools/register-workflow-hooks.ts";
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";

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

test("before_prompt_build skips empty workflow-agent boot checks without a project or explicit command", async () => {
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  delete process.env.OPENCLAW_PROJECT;
  try {

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
        sessionKey: "agent:researcher:dashboard:main-empty",
        sessionId: "session-researcher",
        messageChannel: "main",
        trigger: "user",
      }
    );

    assert.equal(result, undefined);
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
  }
});

test("before_prompt_build still injects Workflow Guard into workflow agents with a project", async (t) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-project-inject-"));
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
  });
  await writeJson(path.join(workspaceDir, "TRACK_REGISTRY.json"), { tracks: [] });

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
      sessionKey: "agent:researcher:dashboard:project-inject",
      sessionId: "session-researcher",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Workflow Guard\]/);
});

test("before_prompt_build suppresses duplicate heartbeat guard injection for unchanged session state", async (t) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-heartbeat-dedupe-"));
  const harness = createHookHarness({
    injectWorkflowContext: true,
    heartbeatBackgroundChecks: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");

  t.after(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  await writeJson(path.join(workspaceDir, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    owner_agent: "reviewer",
    idle_research: { enabled: false },
  });
  await writeJson(path.join(workspaceDir, "TRACK_REGISTRY.json"), { tracks: [] });

  const ctx = {
    agentId: "reviewer",
    workspaceDir,
    sessionKey: "agent:reviewer:dashboard:heartbeat-dedupe",
    sessionId: "session-reviewer",
    messageChannel: "main",
    trigger: "heartbeat",
  };
  const event = {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "heartbeat" }],
      },
    ],
  };

  const first = await beforePromptBuild(event, ctx);
  const second = await beforePromptBuild(event, ctx);

  assert.match(first?.prependContext ?? "", /\[Workflow Guard\]/);
  assert.equal(second, undefined);
});

test("before_prompt_build auto-acknowledges pending handoff mailbox items for the current workflow agent", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-hook-mailbox-ack-")
  );
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "idea",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json"), {
    schemaVersion: 1,
    updatedAt: "2026-04-10T10:00:00.000Z",
    messages: [
      {
        id: "msg-handoff-1",
        fromAgent: "orchestrator",
        toAgent: "researcher",
        subject: "auto-iterator: idea owner handoff",
        body: "Please resume idea stage.",
        kind: "handoff",
        priority: "high",
        status: "pending",
        createdAt: "2026-04-10T10:00:00.000Z",
      },
    ],
  });

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
      workspaceDir: projectRoot,
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-researcher",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Workflow Guard\]/);
  const mailbox = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json"),
      "utf8"
    )
  );
  assert.equal(mailbox.messages[0].status, "acknowledged");
  assert.equal(typeof mailbox.messages[0].acknowledgedAt, "string");
});

test("before_prompt_build maps /paper-plan to survey-native planning for survey workflows", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-hook-survey-paper-plan-")
  );
  const harness = createHookHarness({
    injectWorkflowContext: true,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    workflow_line: "survey",
    paper_type: "survey",
    current_stage: "survey_review",
    owner_agent: "researcher",
    writing_contract: { paper_mode: "survey" },
    survey_review: {
      topic: "GCD survey",
      status: "searching",
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "/paper-plan" }],
        },
      ],
    },
    {
      agentId: "researcher",
      workspaceDir: projectRoot,
      sessionKey: "agent:researcher:dashboard:main",
      sessionId: "session-researcher",
      messageChannel: "main",
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Survey Paper Plan\]/);
  assert.match(result?.prependContext ?? "", /materialize_survey_review_state/);
  assert.match(result?.prependContext ?? "", /Do not create coder\/experiments stubs/i);
});

test("before_prompt_build follows the explicit dashboard channel binding instead of a generic main session", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-dashboard-binding-"));
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const harness = createHookHarness({
    injectWorkflowContext: true,
    enableChannelProjectBindings: true,
    projectsRoot,
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");
  const dashboardSessionKey = "agent:researcher:dashboard:main";
  const reviewChannelKey = "binding:discord:default:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    current_stage: "survey_review",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    survey_review: {
      status: "synthesizing",
      topic: "Generalized Category Discovery Survey",
      gate_ready: false,
      coverage_status: "partial",
      taxonomy_stability_status: "unstable",
      representative_methods_status: "partial",
      benchmark_alignment_status: "partial",
      gap_closure_status: "partial",
      gate_blocking_issues: ["Expand SOTA matrix coverage before write handoff."],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: dashboardSessionKey,
    messageChannel: "discord",
    channelKey: reviewChannelKey,
    projectRoot,
    boundByAgent: "researcher",
  });

  const result = await beforePromptBuild(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "continue the survey workflow" }],
        },
      ],
    },
    {
      agentId: "researcher",
      workspaceDir: "/Users/iranb/.openclaw/workspace-researcher",
      sessionKey: dashboardSessionKey,
      sessionId: "session-researcher",
      messageChannel: "discord",
      channelKey: reviewChannelKey,
      trigger: "user",
    }
  );

  assert.match(result?.prependContext ?? "", /\[Workflow Guard\]/);
  assert.match(result?.prependContext ?? "", /Project:\s+gcd-survey-tpami-2026/);
  assert.match(result?.prependContext ?? "", /channel_binding_key=binding:discord:default:channel:1491811255814586530/);
  assert.match(result?.prependContext ?? "", /Survey review: status=synthesizing/i);
  assert.match(result?.prependContext ?? "", /Survey gates: coverage=partial, taxonomy=unstable/i);
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

test("before_prompt_build ignores an out-of-root OPENCLAW_PROJECT instead of crashing", async (t) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hook-invalid-env-"));
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const harness = createHookHarness({
    injectWorkflowContext: true,
    projectsRoot: path.join(workspaceDir, "projects"),
  });
  const beforePromptBuild = harness.getHandler("before_prompt_build");
  process.env.OPENCLAW_PROJECT = path.join(os.tmpdir(), "openclaw-stray-project");

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

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

  assert.equal(result, undefined);
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
