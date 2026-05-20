import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeLiteratureDiscoveryPacket } from "../../tools/literature-discovery/materializer.ts";
import { buildWorkflowControlContract } from "../../tools/workflow-control-contract.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("literature discovery packet uses canonical workflow_control stage before stale manifest mirror", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-literature-discovery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "literature-canonical-origin",
    current_stage: "experiment",
    workflow_control: buildWorkflowControlContract({
      contractId: "wcc-literature-canonical-origin",
      reconciledAt: "2026-05-19T18:24:00.000Z",
      stage: "idea",
      owner: "researcher",
      nextAction: "/idea-phase",
      status: "blocked",
      blockingReason: "idea_track_graph_evidence_gap",
      completionStatus: "incomplete",
      completionSource: "test",
      completionReason: "canonical literature discovery fixture",
    }),
    research_program: {
      baseline_reference: "baseline method",
      primary_metric: "accuracy",
      tracks: [
        {
          track_id: "track-canonical",
          status: "active",
          question: "Can graph evidence improve the candidate mechanism?",
          hypothesis: "Graph evidence can expose a better transfer mechanism.",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-canonical",
        status: "active",
        title: "Canonical graph-evidence track",
      },
    ],
  });

  const result = await materializeLiteratureDiscoveryPacket({ projectRoot });
  assert.equal(result.required, true);
  assert.equal(result.packet?.discovery_reason, "idea_track_graph_evidence_gap");
  assert.deepEqual(result.packet?.target_track_ids, ["track-canonical"]);

  const explicitResult = await materializeLiteratureDiscoveryPacket({
    projectRoot,
    literatureDiscoveryMaterialization: {
      origin_stage: "experiment",
      packet_path: "researcher/literature-discovery/EXPLICIT_PACKET.json",
    },
  });
  assert.equal(explicitResult.required, false);
  assert.equal(explicitResult.packet, null);
});
