import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-workflow-tool-"));
}

async function loadDistAutoWorkflowModules() {
  const distRoot = path.join(process.cwd(), "dist", "tools");
  const [{ createPluginRegistrationContext }, { registerAutoWorkflowTools }] =
    await Promise.all([
      import(pathToFileURL(path.join(distRoot, "plugin-registration-shared.js")).href),
      import(pathToFileURL(path.join(distRoot, "register-auto-workflow-tools.js")).href),
    ]);
  return { createPluginRegistrationContext, registerAutoWorkflowTools };
}

function makeApi(projectsRoot) {
  const tools = [];
  const commands = [];
  const services = [];
  const hooks = [];
  return {
    tools,
    commands,
    services,
    hooks,
    config: {},
    pluginConfig: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:local:tool-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          return { runId: "bg-run-1" };
        },
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerTool(spec, options) {
      tools.push({ spec, options });
    },
    registerCommand(command) {
      commands.push(command);
    },
    registerService(service) {
      services.push(service);
    },
    registerInteractiveHandler() {},
    on(hookName, handler, options) {
      hooks.push({ hookName, handler, options });
    },
  };
}

function materializeTool(entry, context = {}) {
  const tool =
    typeof entry.spec === "function" ? entry.spec(context) : entry.spec;
  assert.ok(tool, `expected tool ${entry.options?.name ?? "<unknown>"} to materialize`);
  return tool;
}

function findRegisteredTool(api, name) {
  return api.tools.find((entry) => entry.options?.name === name);
}

async function executeText(tool, params) {
  const result = await tool.execute("tool-call-1", params);
  return result.content.map((entry) => entry.text).join("\n");
}

test("plugin entry and manifest declare auto workflow tool aliases", async () => {
  const [entrySource, manifestSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "index.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "openclaw.plugin.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(entrySource, /registerAutoWorkflowTools\(plugin\)/);
  assert.deepEqual(
    manifest.contracts.tools.filter((name) =>
      ["research_memory", "research_workflow", "auto_research", "auto_review"].includes(name)
    ),
    ["research_memory", "research_workflow", "auto_research", "auto_review"]
  );
  assert.equal(manifest.toolMetadata.auto_research.optional, true);
  assert.equal(manifest.toolMetadata.auto_review.optional, true);
});

test("auto_research and auto_review tools reuse canonical command bootstrap", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const backgroundRuns = [];
  const { createPluginRegistrationContext, registerAutoWorkflowTools } =
    await loadDistAutoWorkflowModules();

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi(projectsRoot);
  const plugin = createPluginRegistrationContext(api);
  registerAutoWorkflowTools(plugin, {
    async startBackgroundWorkflowRun(params) {
      backgroundRuns.push(params);
      return {
        started: true,
        runId: `bg-run-${backgroundRuns.length}`,
        sessionKey: params.agentCtx.sessionKey,
        projectRoot: params.backgroundRun.projectRoot,
        projectId: params.backgroundRun.projectId,
        summary:
          params.backgroundRun.kind === "survey_review"
            ? "Full-auto survey pipeline started."
            : "Full-auto research pipeline started.",
      };
    },
  });

  const autoResearchTool = materializeTool(findRegisteredTool(api, "auto_research"), {
    messageChannel: "local",
    conversationId: "tool-research",
    sessionKey: "agent:researcher:local:tool-research",
  });
  const researchText = await executeText(autoResearchTool, {
    topic: "GCD confirmation bias mitigation",
    context: "Preserve SimGCD baseline fairness.",
  });
  assert.match(researchText, /Full-auto research pipeline started/);

  const autoReviewTool = materializeTool(findRegisteredTool(api, "auto_review"), {
    messageChannel: "local",
    conversationId: "tool-review",
    sessionKey: "agent:researcher:local:tool-review",
  });
  const reviewText = await executeText(autoReviewTool, {
    topic: "Graph reasoning survey",
  });
  assert.match(reviewText, /Full-auto survey pipeline started/);

  assert.deepEqual(
    backgroundRuns.map((entry) => entry.backgroundRun.kind),
    ["research_pipeline", "survey_review"]
  );
  assert.match(
    backgroundRuns[0].backgroundRun.extraSystemPrompt ?? "",
    /Preserve SimGCD baseline fairness/
  );
  assert.equal(
    backgroundRuns[0].agentCtx.sessionKey,
    "agent:researcher:local:tool-research"
  );
  assert.equal(
    backgroundRuns[1].agentCtx.sessionKey,
    "agent:researcher:local:tool-review"
  );

  await fs.access(
    path.join(projectsRoot, "gcd-confirmation-bias-mitigation", "PROJECT_MANIFEST.json")
  );
  await fs.access(
    path.join(projectsRoot, "survey-graph-reasoning-survey", "PROJECT_MANIFEST.json")
  );
});
