import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setChannelProjectBinding } from "../tools/channel-project-bindings.ts";
import {
  loadWorkflowProjectState,
  resolveWorkflowProjectContext,
} from "../tools/workflow-guard-project/project-context.ts";

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-project-context-"));
}

async function makeProject(workspaceRoot, projectId = "demo-project") {
  const projectRoot = path.join(workspaceRoot, "projects", projectId);
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "setup",
        title: "Demo Project",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify({ tracks: [] }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("project context resolves a channel binding and loads project state", async (t) => {
  const workspaceRoot = await makeWorkspace();
  const projectRoot = await makeProject(workspaceRoot, "nlp-track");
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await setChannelProjectBinding({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
    projectRoot,
    projectId: "nlp-track",
    messageChannel: "discord",
    boundByAgent: "researcher",
  });

  const resolved = resolveWorkflowProjectContext({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    context: {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
      role: "researcher",
    },
  });

  assert.equal(resolved.projectRoot, projectRoot);
  assert.equal(resolved.projectId, "nlp-track");
  assert.equal(resolved.source, "channel_binding");
  assert.equal(resolved.channelKey, "discord:group:paper-lab");

  const state = await loadWorkflowProjectState({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    role: "researcher",
  });

  assert.equal(state.projectRoot, projectRoot);
  assert.equal(state.projectId, "nlp-track");
  assert.equal(state.projectResolutionSource, "channel_binding");
  assert.equal(state.channelBindingKey, "discord:group:paper-lab");
  assert.equal(state.mailbox.messages.length, 0);
});

