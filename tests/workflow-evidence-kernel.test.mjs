import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  derivePapernexusEvidenceStatus,
  inspectPapernexusBridgeArtifacts,
} from "../tools/workflow-evidence/papernexus-bridge.ts";
import { materializeBenchmarkRegistry } from "../tools/workflow-evidence/benchmark-registry.ts";
import { materializeStatisticalEvidence } from "../tools/workflow-evidence/statistics.ts";

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

test("top-tier evidence materializers own manifest evidence blocks", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-evidence-materializer-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );

  const benchmark = await materializeBenchmarkRegistry({
    projectRoot,
    patch: {
      status: "ready",
      benchmark_family: "CIFAR",
      locked: true,
      drift_status: "pass",
    },
  });
  const statistics = await materializeStatisticalEvidence({
    projectRoot,
    patch: {
      status: "ready",
      claim_strength_status: "strong",
      significant_result_count: 2,
    },
  });

  assert.equal(benchmark.locked, true);
  assert.equal(statistics.claimStrengthStatus, "strong");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.benchmark_protocol.benchmark_family, "CIFAR");
  assert.equal(manifest.statistical_evidence.significant_result_count, 2);
});
