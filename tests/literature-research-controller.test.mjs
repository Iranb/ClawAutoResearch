import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeLiteratureResearchControllerArtifacts } from "../tools/literature-discovery/controller-contract.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("literature research controller materializes closed-loop artifacts", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-literature-controller-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "controller-demo",
    current_stage: "review",
    owner_agent: "researcher",
    research_program: {
      goal: "Generalized category discovery with robust consistency regularization",
      baseline_reference: "FixMatch",
      primary_metric: "H-score",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: Array.from({ length: 15 }, (_, index) => ({
      canonical_id: `arxiv:2601.${String(index + 1).padStart(5, "0")}`,
      arxiv_id: `2601.${String(index + 1).padStart(5, "0")}`,
      title:
        index === 0
          ? "FixMatch for Generalized Category Discovery"
          : `Generalized Category Discovery Evidence Paper ${index}`,
      year: 2026,
      venue: index % 2 === 0 ? "ICLR" : "NeurIPS",
      source_provider: index % 2 === 0 ? "openalex" : "semanticscholar",
      retrieval_providers: ["openalex", "semanticscholar"],
      source_path: `researcher/paper-staging/2601.${String(index + 1).padStart(5, "0")}.md`,
      resolution_status: "resolved_markdown",
    })),
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"), {
    status: "ready",
    claim_level: "per_paper_source_backed",
    source_backed_graph_claim: true,
    upload: {
      import_tasks: {
        task_count: 15,
        completed_task_count: 15,
      },
    },
  });

  const controller = await materializeLiteratureResearchControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-28T00:00:00.000Z",
    trigger: "unit_test",
  });

  assert.equal(controller.project_id, "controller-demo");
  assert.equal(controller.need_assessment.current_state.source_backed_graph_claim, true);
  assert.equal(controller.coverage_report.closed_loop_contract.paper_ingestion_required, false);
  assert.ok(
    ["ready", "guardrailed"].includes(controller.status),
    `unexpected status: ${controller.status}`
  );
  assert.ok(Array.isArray(controller.query_plan.queries));
  assert.ok(controller.query_plan.queries.length >= 4);
  assert.ok(
    controller.keyword_bank.buckets.some(
      (bucket) => bucket.name === "method" && bucket.terms.includes("generalized")
    )
  );
  assert.equal(
    controller.candidate_screening_report.summary.source_backed_count,
    15
  );
  assert.match(
    await fs.readFile(controller.artifact_paths.status_markdown_path, "utf8"),
    /Literature Research Controller Status/
  );
  assert.equal(
    await fs
      .access(controller.artifact_paths.coverage_report_path)
      .then(() => true)
      .catch(() => false),
    true
  );
});
