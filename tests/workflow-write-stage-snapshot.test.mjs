import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-write-stage-snapshot-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "write-stage-snapshot",
    current_stage: "write",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
  });
  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: params.runtime ?? {},
    logger: params.logger ?? {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  assert.ok(registeredTool);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "academic_writer",
          sessionKey:
            params.sessionKey ?? "agent:academic_writer:discord:group:paper-lab",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
          channelKey: params.channelKey,
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

test("research_workflow get_snapshot exposes section-granular write tasks using the writing contract order", async (t) => {
  const projectRoot = await makeProjectRoot();
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
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-write-preview",
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    writing_contract: {
      paper_mode: "survey",
      section_order: [
        "abstract",
        "introduction",
        "scope_and_protocol",
        "taxonomy",
        "evidence_synthesis",
        "benchmark_landscape",
        "open_problems",
        "conclusion",
      ],
    },
  });

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.deepEqual(
    snapshot.teamTaskPreview.map((task) => task.taskId),
    [
      "write.section.abstract",
      "write.section.introduction",
      "write.section.scope_and_protocol",
      "write.section.taxonomy",
      "write.section.evidence_synthesis",
      "write.section.benchmark_landscape",
      "write.section.open_problems",
      "write.section.conclusion",
      "write.polish_and_compile",
    ]
  );
});
