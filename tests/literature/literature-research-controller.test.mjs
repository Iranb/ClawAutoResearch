import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeLiteratureResearchControllerArtifacts,
  writeLiteratureResearchControllerRunReceipt,
} from "../../tools/literature-discovery/controller-contract.ts";
import { buildWorkflowControlContract } from "../../tools/workflow-control-contract.ts";

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
    workflow_control: buildWorkflowControlContract({
      contractId: "controller-demo-canonical",
      reconciledAt: "2026-04-28T00:00:00.000Z",
      stage: "graph_build",
      owner: "orchestrator",
      nextAction: "/graph-build",
      status: "ready",
      completionStatus: "incomplete",
      completionSource: "unit_test",
      completionReason: "canonical controller fixture",
      runtimeState: "idle",
    }),
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
  assert.equal(controller.need_assessment.current_state.stage, "graph_build");
  assert.equal(controller.need_assessment.current_state.owner_agent, "orchestrator");
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
  const persistedNeedAssessment = JSON.parse(
    await fs.readFile(controller.artifact_paths.need_assessment_path, "utf8")
  );
  assert.equal(persistedNeedAssessment.current_state.stage, "graph_build");
  assert.equal(persistedNeedAssessment.current_state.owner_agent, "orchestrator");
});

test("literature controller citation report extracts bounded snowballing candidates from source index metadata", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-literature-snowball-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "citation-snowball-demo",
    current_stage: "review",
    owner_agent: "researcher",
    research_program: {
      goal: "Generalized category discovery with consistency regularization",
      baseline_reference: "FixMatch",
      primary_metric: "H-score",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "doi:10.0000/seed",
        doi: "10.0000/seed",
        title: "FixMatch for Generalized Category Discovery",
        year: 2024,
        citation_count: 120,
        source_path: "researcher/paper-staging/seed.md",
        resolution_status: "resolved_markdown",
        references: [
          {
            canonical_id: "doi:10.0000/classic",
            title: "Classic Consistency Regularization",
            doi: "10.0000/classic",
            year: 2020,
            venue: "NeurIPS",
          },
        ],
        citing_papers: [
          {
            canonical_id: "doi:10.0000/followup",
            title: "Recent Follow-up on GCD Consistency",
            doi: "10.0000/followup",
            year: 2026,
            venue: "ICLR",
          },
        ],
        related_papers: ["Semi-Supervised Discovery Survey"],
        shared_references: [
          {
            canonical_id: "doi:10.0000/coupled",
            title: "Coupled Open-World Recognition",
            doi: "10.0000/coupled",
            year: 2023,
          },
        ],
      },
    ],
  });

  const controller = await materializeLiteratureResearchControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-29T00:00:00.000Z",
    trigger: "citation_snowball_unit_test",
    minCorePapers: 3,
    minRecentPapers: 1,
  });
  assert.ok(controller.citation_expansion_packet);

  const receipt = await writeLiteratureResearchControllerRunReceipt({
    projectRoot,
    generatedAt: "2026-04-29T00:00:01.000Z",
    trigger: "citation_snowball_unit_test",
    controllerBefore: controller,
    controllerAfter: controller,
    executed: false,
    skipReason: "unit_test_receipt_only",
    citationExpansionPacket: controller.citation_expansion_packet,
    nextRoute: "none",
  });
  assert.equal(receipt.citation_expansion_report?.snowballing_status, "extracted");
  assert.equal(receipt.citation_expansion_report?.snowballing_candidate_count, 4);

  const report = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "literature-research-controller",
        "citation_expansion_report.json"
      ),
      "utf8"
    )
  );
  assert.equal(report.snowballing.status, "extracted");
  assert.equal(report.snowballing.mode_counts.backward_references, 1);
  assert.equal(report.snowballing.mode_counts.forward_citations, 1);
  assert.equal(report.snowballing.mode_counts.co_citation, 1);
  assert.equal(report.snowballing.mode_counts.bibliographic_coupling, 1);
  assert.match(report.snowballing.evidence_policy, /discovery candidates only/i);
});

test("literature controller writes snippet evidence report from source index and local sources", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-literature-snippets-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const sourceMarkdownPath = path.join(projectRoot, "researcher", "paper-staging", "quote.md");
  await fs.mkdir(path.dirname(sourceMarkdownPath), { recursive: true });
  await fs.writeFile(
    sourceMarkdownPath,
    [
      "# Source Paper",
      "",
      "The method combines pseudo-label filtering with consistency regularization across weak and strong augmentations, which directly supports the generalized category discovery bridge being tested in this project.",
    ].join("\n"),
    "utf8"
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "snippet-evidence-demo",
    current_stage: "review",
    owner_agent: "researcher",
    research_program: {
      goal: "Use FixMatch-style consistency regularization to improve generalized category discovery",
      baseline_reference: "FixMatch",
      primary_metric: "H-score",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "doi:10.0000/snippet",
        title: "Snippet Evidence Paper",
        doi: "10.0000/snippet",
        year: 2025,
        snippet_status: "snippet",
        snippet: "Weak and strong augmentation agreement improves pseudo-label reliability for discovery.",
      },
      {
        canonical_id: "doi:10.0000/quote",
        title: "Local Source Quote Paper",
        doi: "10.0000/quote",
        year: 2024,
        source_path: "researcher/paper-staging/quote.md",
        resolution_status: "resolved_markdown",
      },
      {
        canonical_id: "doi:10.0000/abstract",
        title: "Abstract Fallback Paper",
        doi: "10.0000/abstract",
        year: 2023,
        abstract:
          "This abstract describes semi-supervised consistency regularization but is not a source-backed quote.",
      },
      {
        canonical_id: "doi:10.0000/missing",
        title: "Missing Evidence Paper",
        doi: "10.0000/missing",
        year: 2022,
      },
    ],
  });

  const controller = await materializeLiteratureResearchControllerArtifacts({
    projectRoot,
    generatedAt: "2026-04-29T01:00:00.000Z",
    trigger: "snippet_evidence_unit_test",
    minCorePapers: 4,
    minRecentPapers: 1,
  });
  const receipt = await writeLiteratureResearchControllerRunReceipt({
    projectRoot,
    generatedAt: "2026-04-29T01:00:01.000Z",
    trigger: "snippet_evidence_unit_test",
    controllerBefore: controller,
    controllerAfter: controller,
    executed: false,
    skipReason: "unit_test_receipt_only",
    nextRoute: "none",
  });

  assert.equal(receipt.snippet_evidence_report?.status, "grounded");
  assert.equal(receipt.snippet_evidence_report?.snippet_grounded_count, 2);
  assert.equal(receipt.snippet_evidence_report?.claim_proof_eligible_count, 1);

  const report = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "literature-research-controller",
        "snippet_evidence_report.json"
      ),
      "utf8"
    )
  );
  assert.equal(report.source_backed_quote_count, 1);
  assert.equal(report.explicit_snippet_count, 1);
  assert.equal(report.abstract_fallback_count, 1);
  assert.equal(report.unavailable_count, 1);
  assert.match(report.evidence_policy, /only source-backed quotes/i);
  assert.ok(
    report.records
      .find((record) => record.canonical_id === "doi:10.0000/abstract")
      .risk_flags.includes("abstract_fallback_not_source_backed")
  );
});
