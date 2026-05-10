import test from "node:test";
import assert from "node:assert/strict";

import { buildPaperGuruQueryProfile } from "../../tools/literature-discovery/paperguru-query-profile.ts";

test("PaperGuru query profile emits six-round PaperNexus-native query metadata", () => {
  const profile = buildPaperGuruQueryProfile({
    topic: "open vocabulary object detection with graph evidence",
    field: "computer vision",
    subfield: "open vocabulary detection",
    venue: "CVPR",
    paperType: "method_paper",
    methodParadigm: "DETR",
    noveltyModule: "evidence-aware classifier",
    baselineFamilies: ["DETR", "YOLO"],
    sourceArtifacts: ["PROJECT_MANIFEST.json"],
  });

  assert.equal(profile.schema_version, 1);
  assert.equal(profile.field_family, "computer_vision");
  assert.ok(profile.source_broad_plan_query_count >= 4);
  assert.ok(profile.queries.some((entry) => entry.intent === "broad_landscape"));
  assert.ok(profile.queries.some((entry) => entry.intent === "must_cite_anchor"));
  assert.ok(profile.queries.some((entry) => entry.intent === "venue_targeted"));
  assert.ok(profile.queries.some((entry) => entry.intent === "subfield_scan"));
  assert.ok(profile.queries.some((entry) => entry.intent === "method_axis"));
  assert.ok(profile.queries.some((entry) => entry.intent === "gap_citation_chasing"));
  assert.ok(
    profile.queries.every(
      (entry) => entry.provider_route === "papernexus.literature_discovery"
    )
  );
  assert.ok(profile.queries.every((entry) => entry.requires_papernexus_import));
  assert.ok(profile.queries.some((entry) => /CVPR/.test(entry.query_text)));
});

test("PaperGuru query profile adapts stable seed examples across domains", () => {
  const medicine = buildPaperGuruQueryProfile({
    topic: "sepsis risk calibration",
    field: "medicine",
    subfield: "clinical prediction",
    methodParadigm: "risk model",
    noveltyModule: "calibration audit",
  });
  const social = buildPaperGuruQueryProfile({
    topic: "education policy intervention effects",
    field: "economics",
    subfield: "education policy",
    noveltyModule: "heterogeneous treatment effect",
  });
  const nlp = buildPaperGuruQueryProfile({
    topic: "retrieval augmented generation faithfulness",
    field: "NLP",
    subfield: "retrieval augmented generation",
    venue: "ACL",
  });

  assert.equal(medicine.field_family, "medicine");
  assert.ok(medicine.queries.some((entry) => /systematic review/i.test(entry.query_text)));
  assert.ok(medicine.queries.some((entry) => /cohort study/i.test(entry.query_text)));

  assert.equal(social.field_family, "social_science");
  assert.ok(social.queries.some((entry) => /causal inference/i.test(entry.query_text)));
  assert.ok(social.queries.some((entry) => /robustness check/i.test(entry.query_text)));

  assert.equal(nlp.field_family, "nlp");
  assert.ok(nlp.queries.some((entry) => /natural language processing/i.test(entry.query_text)));
  assert.ok(nlp.queries.some((entry) => /ACL/.test(entry.query_text)));
});

test("PaperGuru query profile deduplicates query text within each intent", () => {
  const profile = buildPaperGuruQueryProfile({
    topic: "graph retrieval",
    field: "machine learning",
    subfield: "graph retrieval",
    methodParadigm: "graph retrieval",
    noveltyModule: "graph retrieval",
    baselineFamilies: ["graph retrieval"],
  });
  const keys = profile.queries.map(
    (entry) => `${entry.intent}:${entry.query_text.toLowerCase()}`
  );

  assert.equal(new Set(keys).size, keys.length);
});
