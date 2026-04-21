import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeBenchmarkRegistry } from "../tools/workflow-evidence/benchmark-registry.ts";
import { materializeBenchmarkProtocolConvergence } from "../tools/research-evidence/protocol-convergence.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("protocol convergence becomes candidate_ready from survey bridge hints", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-protocol-convergence-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    benchmark_protocol: {
      status: "partial",
      benchmark_family: "SurveyBench",
      primary_metric: "Accuracy",
      split_descriptor: "shared split",
      fair_compare_status: "pass",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "SURVEY_TOP_TIER_BRIDGE.json"), {
    benchmarkHints: {
      selectedBenchmarkFamily: "SurveyBench",
      selectedPrimaryMetric: "Accuracy",
      protocolHints: ["shared split"],
    },
  });

  const result = await materializeBenchmarkProtocolConvergence({ projectRoot });

  assert.equal(result.convergenceStatus, "candidate_ready");
  await fs.access(path.join(projectRoot, "researcher", "EXPERIMENT_PROTOCOL_CANDIDATE.json"));
  await fs.access(path.join(projectRoot, "researcher", "PROTOCOL_CONVERGENCE_REPORT.json"));
});

test("protocol convergence becomes converged when experiment search spec matches survey candidate", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-protocol-converged-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    research_program: {
      baseline_reference: "SimGCD",
      primary_metric: "Accuracy",
      datasets: ["SurveyBench"],
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "SURVEY_TOP_TIER_BRIDGE.json"), {
    benchmarkHints: {
      selectedBenchmarkFamily: "SurveyBench",
      selectedPrimaryMetric: "Accuracy",
      protocolHints: ["shared split"],
    },
  });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_mode: "survey_bench",
    primary_metric_contract: {
      metric_name: "Accuracy",
      direction: "higher_is_better",
      primary_evidence: ["shared split"],
    },
    baseline_fairness_contract: {
      locked_dataset_protocol: true,
      locked_metric_protocol: true,
      locked_evaluation_harness: true,
    },
    protocol_lock_contract: {
      benchmark_family: "SurveyBench",
      split_descriptor: "shared split",
      evaluation_harness: "shared split",
      fair_compare_notes: ["same benchmark"],
      fairness_checks: {
        same_backbone: "pass",
        same_pretraining: "pass",
        same_split: "pass",
        same_evaluation_harness: "pass",
        baseline_reference_mode: "reproduced",
      },
    },
  });

  const benchmark = await materializeBenchmarkRegistry({ projectRoot });

  assert.equal(benchmark.convergenceStatus, "converged");
});
