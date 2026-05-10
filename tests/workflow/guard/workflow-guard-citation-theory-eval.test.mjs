import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getCitationCollectionStateSummary,
  getCitationIntegrityStateSummary,
  getTheoryStateSummary,
  isCitationCollectionHardFailure,
} from "../../../tools/workflow-guard-writing/citation-theory-eval.ts";
import { evaluateReferenceCoveragePolicy } from "../../../tools/research-writing/reference-coverage-policy.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-workflow-citation-theory-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value = "# artifact\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

test("citation integrity and theory summaries resolve configured artifacts", async () => {
  const projectRoot = await makeProjectRoot();
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    citation_integrity: {
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      source_of_truth: ["paper_main_tex"],
    },
    citation_collection: {
      status: "ready",
      progress_path: "researcher/CITATION_PROGRESS.json",
      cache_bib_path: "academic_writer/cached_citations.bib",
      candidate_count: 2,
      verified_count: 2,
      suspicious_count: 0,
      hallucinated_count: 0,
    },
    theory_state: {
      status: "ready",
      theory_state_path: "analyzer/THEORY_STATE.json",
      source_theory_note_path: "analyzer/THEORY_SUPPORT_NOTE.md",
      proof_packet_dir: "analyzer/proof-packets",
      appendix_packet_path: "academic_writer/THEORY_APPENDIX_PLAN.md",
      main_text_proof_style: "lemma_result_only",
      body_ready: true,
      theorem_count: 1,
      lemma_count: 1,
      proof_packet_count: 2,
    },
  });
  await writeText(path.join(projectRoot, "academic_writer", "paper", "refs.bib"));
  await writeText(path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"));
  await writeText(path.join(projectRoot, "researcher", "CITATION_PROGRESS.json"));
  await writeText(path.join(projectRoot, "academic_writer", "cached_citations.bib"));
  await writeJson(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
    schema_version: 1,
    status: "ready",
    theorem_candidates: [],
    lemma_packets: [],
    appendix_sections: [],
  });
  await writeText(path.join(projectRoot, "analyzer", "THEORY_SUPPORT_NOTE.md"));
  await writeText(path.join(projectRoot, "analyzer", "proof-packets", "packet-1.json"));
  await writeText(path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"));

  const citationIntegritySummary = await getCitationIntegrityStateSummary({
    projectRoot,
  });
  assert.equal(citationIntegritySummary.bibliographyExists, true);
  assert.equal(citationIntegritySummary.verificationReportExists, true);

  const citationCollectionSummary = await getCitationCollectionStateSummary({
    projectRoot,
  });
  assert.equal(citationCollectionSummary.hardFailure, false);

  const theorySummary = await getTheoryStateSummary({
    projectRoot,
  });
  assert.equal(theorySummary.theoryStateExists, true);
  assert.equal(theorySummary.sourceTheoryNoteExists, true);
  assert.equal(theorySummary.proofPacketCount, 1);
  assert.equal(theorySummary.theoryFile?.status, "ready");
});

test("citation collection hard-failure only triggers on blocked or hallucinated states", () => {
  assert.equal(
    isCitationCollectionHardFailure({
      status: "missing",
      progressPath: null,
      cacheBibPath: null,
      candidateCount: 0,
      verifiedCount: 0,
      suspiciousCount: 0,
      hallucinatedCount: 0,
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    false
  );
  assert.equal(
    isCitationCollectionHardFailure({
      status: "blocked",
      progressPath: null,
      cacheBibPath: null,
      candidateCount: 0,
      verifiedCount: 0,
      suspiciousCount: 0,
      hallucinatedCount: 0,
      pendingReason: null,
      lastUpdatedAt: null,
    }),
    true
  );
});

test("reference coverage policy allows peripheral mixed citations but blocks unrelated citations", () => {
  const mixed = evaluateReferenceCoveragePolicy({
    minimumCitationCount: 50,
    citationIntegrity: {
      reference_coverage_policy: "minimum_relevance_no_upper_limit",
      topic_relevance_status: "mixed",
      relevant_citation_count: 67,
      peripheral_citation_count: 17,
      unrelated_citation_count: 0,
      bibliography_entry_count: 67,
    },
  });
  assert.equal(mixed.ready, true);
  assert.equal(mixed.policy, "minimum_relevance_no_upper_limit");
  assert.deepEqual(mixed.acceptedTopicRelevanceStatuses, ["ready", "mixed"]);

  const unrelated = evaluateReferenceCoveragePolicy({
    minimumCitationCount: 50,
    citationIntegrity: {
      topic_relevance_status: "mixed",
      relevant_citation_count: 67,
      peripheral_citation_count: 16,
      unrelated_citation_count: 1,
      bibliography_entry_count: 68,
    },
  });
  assert.equal(unrelated.ready, false);
  assert.match(unrelated.reason ?? "", /unrelated count must be 0/);

  const belowRelevantFloor = evaluateReferenceCoveragePolicy({
    minimumCitationCount: 30,
    citationIntegrity: {
      topic_relevance_status: "mixed",
      relevant_citation_count: 12,
      minimum_relevant_citation_count: 20,
      unrelated_citation_count: 0,
    },
  });
  assert.equal(belowRelevantFloor.ready, false);
  assert.match(belowRelevantFloor.reason ?? "", /relevant citation count >= 20/);
});
