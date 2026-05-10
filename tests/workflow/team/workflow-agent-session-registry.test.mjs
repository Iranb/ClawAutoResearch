import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readWorkflowAgentSessionRegistry,
  upsertWorkflowAgentSessionRegistryEntry,
} from "../../../tools/workflow-agent-session-registry.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("workflow agent session registry preserves concurrent upserts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-agent-session-registry-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
  });

  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      upsertWorkflowAgentSessionRegistryEntry({
        projectRoot,
        projectId: "demo-project",
        role: "researcher",
        sessionKey: `agent:researcher:test:${index}`,
        sessionId: `session-${index}`,
        currentStage: "idea",
        status: "active",
      })
    )
  );

  const store = await readWorkflowAgentSessionRegistry(projectRoot);
  assert.equal(store.entries.length, 10);
  assert.deepEqual(
    store.entries.map((entry) => entry.sessionKey).sort(),
    Array.from({ length: 10 }, (_, index) => `agent:researcher:test:${index}`)
  );
});
