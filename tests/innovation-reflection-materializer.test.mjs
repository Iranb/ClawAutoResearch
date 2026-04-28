import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeInnovationReflection,
  shouldMaterializeInnovationReflection,
} from "../tools/workflow-guard-materializers/innovation-reflection-materializer.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("innovation reflection materializer refreshes stale experiment evidence", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-innovation-reflection-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "research-demo",
    current_stage: "idea",
    owner_agent: "researcher",
    research_program: {
      goal: "Improve GCD with FixMatch consistency",
    },
    innovation_reflection: {
      required_after_experiments: true,
      status: "pending",
      pending_reason: "new experiment evidence requires reflection",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "exp-1",
        status: "completed",
        updated_at: "2026-04-28T03:16:03.000Z",
        decision: "innovation_supported",
        one_change_signature: "FixMatch consistency filtering for GCD",
        metrics: {
          h_score: 0.7055,
          baseline_h_score: 0.575,
          delta_h_score: 0.1305,
        },
        evidence_pointers: ["researcher/evaluation_summary.json"],
      },
    ],
  });

  assert.equal(
    await shouldMaterializeInnovationReflection({
      projectRoot,
      manifest: JSON.parse(
        await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
      ),
      stage: "idea",
    }),
    true
  );

  const result = await materializeInnovationReflection({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });

  assert.equal(result.materialized, true);
  assert.deepEqual(result.generatedFiles, ["researcher/INNOVATION_REFLECTION.md"]);
  const reflection = await fs.readFile(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "utf8"
  );
  assert.match(reflection, /FixMatch consistency filtering for GCD/);
  assert.match(reflection, /delta_h_score=0\.1305/);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.innovation_reflection.status, "fresh");
  assert.equal(
    manifest.innovation_reflection.last_reflection_path,
    "researcher/INNOVATION_REFLECTION.md"
  );
  assert.equal(
    manifest.innovation_reflection.reflected_through_experiment_update_at,
    "2026-04-28T03:16:03.000Z"
  );
  assert.deepEqual(manifest.innovation_reflection.reflected_experiment_ids, ["exp-1"]);
});
