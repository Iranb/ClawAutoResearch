import test from "node:test";
import assert from "node:assert/strict";

import { asRecord, asString } from "../../../tools/workflow-guard-core/coercion.ts";
import { buildWritingGuidance } from "../../../tools/workflow-guard-guidance/writing-guidance.ts";

function makeParams(overrides = {}) {
  return {
    role: "academic_writer",
    currentStage: "write",
    manifest: {},
    writingContract: {
      templateRequired: false,
      paperMode: "conference",
      bodyPageBudget: null,
      referencePageBudget: null,
      bodyWordTargetMin: null,
      bodyWordTargetMax: null,
      kgStorylineRequired: false,
      kgStorylinePacketPath: null,
      kgStorylineStatus: null,
      templateMappingPath: null,
    },
    writingTemplateStatus: "optional",
    writingTemplatePath: null,
    paragraphLogicStatus: "green",
    paragraphLogicAuditStatus: null,
    paragraphLogicAuditBlockingIssueCount: null,
    paragraphLogicAuditNextRepairAction: null,
    paragraphLogicAuditReportPath: null,
    writingContractPendingReason: null,
    citationIntegrity: {
      enabled: false,
      verificationRequired: false,
      verificationStatus: null,
      sourceOfTruth: [],
      allowedPlaceholderCount: 0,
    },
    citationReportPath: null,
    ...overrides,
  };
}

function makeDeps() {
  return {
    asRecord,
    asString,
    DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.md",
    DEFAULT_CITATION_REPORT_PATH: "academic_writer/CITATION_REPORT.json",
  };
}

test("PaperGuru guidance injects compact survey writing rules from intake", () => {
  const guidance = buildWritingGuidance(
    makeParams({
      manifest: {
        paper_design_intake: {
          field: "computer science",
          paper_type: "survey",
          target_venue: "TPAMI",
          experiment_data_status: "metadata_supported",
          figure_policy: { mode: "prompt_only" },
        },
        papernexus_evidence_packet: {
          markdown_path: "researcher/papernexus/PAPERNEXUS_EVIDENCE_PACKET.md",
        },
      },
    }),
    makeDeps()
  );
  const text = [...guidance.prepend, ...guidance.append].join("\n");

  assert.match(text, /Paper design intake: ready/i);
  assert.match(text, /PaperGuru prompt pack/i);
  assert.match(text, /PaperGuru survey guidance/i);
  assert.match(text, /PaperNexus evidence boundary/i);
  assert.match(text, /unsupported claims become TODO\/search requests/i);
  assert.match(text, /metadataGraph boundary/i);
  assert.match(text, /metadata-only candidates may guide coverage/i);
  assert.match(text, /concept, architecture, taxonomy, and workflow figures may use prompt_only/i);
  assert.match(text, /no fabricated citations/i);
});

test("PaperGuru guidance differentiates method and benchmark manuscripts", () => {
  const method = buildWritingGuidance(
    makeParams({
      manifest: {
        paper_design_intake: {
          field: "machine learning",
          paper_type: "method_paper",
        },
      },
    }),
    makeDeps()
  );
  const benchmark = buildWritingGuidance(
    makeParams({
      manifest: {
        paper_design_intake: {
          field: "medicine",
          paper_type: "benchmark",
        },
      },
    }),
    makeDeps()
  );

  assert.match([...method.prepend, ...method.append].join("\n"), /method guidance/i);
  assert.match(
    [...benchmark.prepend, ...benchmark.append].join("\n"),
    /benchmark\/empirical guidance/i
  );
});

test("PaperGuru reviewer guidance preserves citation and compile gate boundaries", () => {
  const guidance = buildWritingGuidance(
    makeParams({
      role: "reviewer",
      currentStage: "submit",
      manifest: {
        paper_design_intake: {
          field: "economics",
          paper_type: "empirical_study",
        },
      },
      citationIntegrity: {
        enabled: false,
        verificationRequired: false,
        verificationStatus: null,
        sourceOfTruth: [],
        allowedPlaceholderCount: 0,
      },
    }),
    makeDeps()
  );
  const text = [...guidance.prepend, ...guidance.append].join("\n");

  assert.match(text, /PaperGuru review rule/i);
  assert.match(text, /do not modify citation or compile gates/i);
  assert.match(text, /Evidence review rule/i);
  assert.match(text, /placeholder-as-final figures/i);
});
