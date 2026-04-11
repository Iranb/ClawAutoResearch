import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  derivePapernexusEvidenceStatus,
  inspectPapernexusBridgeArtifacts,
} from "../tools/workflow-evidence/papernexus-bridge.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("inspectPapernexusBridgeArtifacts detects workflow-owned PaperNexus packets and bundle", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-papernexus-bridge-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
    { status: "ready" }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"),
    { status: "ready" }
  );

  const inspection = await inspectPapernexusBridgeArtifacts({ projectRoot });

  assert.equal(inspection.mechanismBridgePacket.exists, true);
  assert.equal(inspection.challengeInsightPacket.exists, false);
  assert.equal(inspection.graphStorylinePacket.exists, false);
  assert.equal(inspection.ideaCatalystBundle.exists, true);
  assert.equal(inspection.anyArtifactsPresent, true);
});

test("derivePapernexusEvidenceStatus distinguishes graph unavailability from missing artifacts", () => {
  assert.equal(
    derivePapernexusEvidenceStatus({
      artifacts: { anyArtifactsPresent: false },
      requireGraphContext: true,
      graphContextStatus: "unavailable",
    }),
    "graph_unavailable"
  );

  assert.equal(
    derivePapernexusEvidenceStatus({
      artifacts: { anyArtifactsPresent: false },
      requireGraphContext: true,
      graphContextStatus: "ready",
    }),
    "missing_artifacts"
  );

  assert.equal(
    derivePapernexusEvidenceStatus({
      artifacts: { anyArtifactsPresent: true },
      requireGraphContext: true,
      graphContextStatus: "missing",
    }),
    "unverified_graph_context"
  );

  assert.equal(
    derivePapernexusEvidenceStatus({
      artifacts: { anyArtifactsPresent: true },
      requireGraphContext: false,
      graphContextStatus: "missing",
    }),
    "ready"
  );
});
