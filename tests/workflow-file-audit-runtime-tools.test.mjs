import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";

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
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "researcher",
          sessionKey: params.sessionKey ?? "agent:researcher:test",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
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

test("research_workflow can set and read file audit policy and materialize a packet", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-tool-file-audit-")
  );
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

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "Draft body.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "review",
        owner_agent: "reviewer",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });

  const setResult = await executeWorkflowTool(tool, {
    action: "set_file_audit_policy",
    fileAuditPolicy: {
      hook_id: "writer-main-tex",
      hook_type: "file_audit",
      stage: "review",
      hook_point: "before_stage_handoff",
      target_role: "academic_writer",
      auditor_role: "reviewer",
      file_path: "academic_writer/paper/main.tex",
      requirement_prompt: "Check the draft.",
    },
  });
  assert.equal(setResult.auditHooks.length, 1);

  const summary = await executeWorkflowTool(tool, {
    action: "get_file_audit_state",
  });
  assert.equal(summary.policy.auditHooks.length, 1);

  const packet = await executeWorkflowTool(tool, {
    action: "materialize_file_audit_packet",
    hookId: "writer-main-tex",
  });
  assert.match(packet.packetPath, /AUDIT_PACKET\.md$/);
});
