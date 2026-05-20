import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildHandoffDashboard } from "../../../tools/workflow-handoff/dashboard.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("handoff dashboard current owner fallback prefers canonical workflow control", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-handoff-dashboard-"));

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "handoff-dashboard-drift",
    owner_agent: "researcher",
    workflow_control: {
      owner: "analyzer",
    },
    orchestration_state: {
      currentOwner: "researcher",
      pending_handoff_id: null,
    },
  });

  const dashboard = await buildHandoffDashboard({ projectRoot });

  assert.equal(dashboard.currentOwner, "analyzer");
});
