import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  derivePapernexusEvidenceStatus,
  inspectPapernexusBridgeArtifacts,
} from "../../../tools/workflow-evidence/papernexus-bridge.ts";
import { materializeBenchmarkRegistry } from "../../../tools/workflow-evidence/benchmark-registry.ts";
import { materializeStatisticalEvidence } from "../../../tools/workflow-evidence/statistics.ts";

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

test("benchmark registry materializer records split lock, fairness labels, and drift beyond metric name", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-benchmark-protocol-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    research_program: {
      baseline_reference: "SimGCD",
      primary_metric: "h_score",
      datasets: ["CIFAR-100"],
    },
  });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_mode: "gcd_fine_grained",
    primary_metric_contract: {
      metric_name: "h_score",
      direction: "higher_is_better",
      primary_evidence: [
        "Use the baseline-a validation split, checkpoint selection, and H-score evaluation unchanged.",
      ],
    },
    baseline_fairness_contract: {
      locked_dataset_protocol: true,
      locked_metric_protocol: true,
      locked_evaluation_harness: true,
    },
    protocol_lock_contract: {
      benchmark_family: "ProtoGCD-CIFAR100",
      canonical_dataset: "CIFAR-100",
      split_descriptor: "baseline-a validation split",
      split_source: "researcher/splits/baseline-a.json",
      split_checksum: "sha256:baseline-a",
      evaluation_harness: "protogcd-hscore-v1",
      official_eval_recipe:
        "Use the baseline-a validation split, checkpoint selection, and H-score evaluation unchanged.",
      fair_compare_notes: [
        "Main table keeps the same ViT-B/16 backbone and evaluation harness as the reproduced baseline.",
      ],
      fairness_checks: {
        same_backbone: "pass",
        same_pretraining: "pass",
        same_split: "pass",
        same_evaluation_harness: "pass",
        baseline_reference_mode: "reproduced",
      },
      allowed_deviations: [
        {
          deviation_id: "diag-metric",
          scope: "appendix diagnostics",
          rationale: "Track an extra diagnostic metric without changing the headline protocol.",
          allowed_in_main_results: true,
          label: "appendix_only",
        },
      ],
    },
  });

  const first = await materializeBenchmarkRegistry({ projectRoot });
  assert.equal(first.locked, true);
  assert.equal(first.splitDescriptor, "baseline-a validation split");
  assert.equal(first.fairCompareStatus, "pass");
  assert.equal(first.allowedDeviationCount, 1);
  assert.equal(first.allowedDeviationStatus, "ready");

  const protocolLockPath = path.join(projectRoot, "researcher", "PROTOCOL_LOCK.json");
  const fairnessReportPath = path.join(
    projectRoot,
    "researcher",
    "BASELINE_FAIRNESS_REPORT.json"
  );
  const firstLock = JSON.parse(await fs.readFile(protocolLockPath, "utf8"));
  const firstFairness = JSON.parse(await fs.readFile(fairnessReportPath, "utf8"));
  assert.equal(firstLock.splitDescriptor, "baseline-a validation split");
  assert.equal(firstFairness.fairCompareLabel, "fair_compare");

  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_mode: "gcd_fine_grained",
    primary_metric_contract: {
      metric_name: "h_score",
      direction: "higher_is_better",
      primary_evidence: [
        "Use the baseline-b validation split, checkpoint selection, and H-score evaluation unchanged.",
      ],
    },
    baseline_fairness_contract: {
      locked_dataset_protocol: true,
      locked_metric_protocol: true,
      locked_evaluation_harness: true,
    },
    protocol_lock_contract: {
      benchmark_family: "ProtoGCD-CIFAR100",
      canonical_dataset: "CIFAR-100",
      split_descriptor: "baseline-b validation split",
      split_source: "researcher/splits/baseline-b.json",
      split_checksum: "sha256:baseline-b",
      evaluation_harness: "protogcd-hscore-v1",
      official_eval_recipe:
        "Use the baseline-b validation split, checkpoint selection, and H-score evaluation unchanged.",
      fair_compare_notes: [
        "Current compare still keeps the same backbone, but the split changed.",
      ],
      fairness_checks: {
        same_backbone: "pass",
        same_pretraining: "pass",
        same_split: "fail",
        same_evaluation_harness: "pass",
        baseline_reference_mode: "reproduced",
      },
    },
  });

  const drifted = await materializeBenchmarkRegistry({ projectRoot });
  assert.equal(drifted.driftStatus, "fail");
  assert.equal(drifted.fairCompareStatus, "fail");
  assert.match(drifted.pendingReason ?? "", /Protocol drift detected/i);
});
