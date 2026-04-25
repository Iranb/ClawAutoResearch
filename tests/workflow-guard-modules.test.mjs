import test from "node:test";
import assert from "node:assert/strict";

import { materializeIdeationContractImpl } from "../tools/workflow-guard-materializers/ideation-contract-materializer.ts";
import { materializePaperStoryStateImpl } from "../tools/workflow-guard-materializers/paper-story-materializer.ts";
import { materializeReviewPressurePacketImpl } from "../tools/workflow-guard-materializers/review-pressure-materializer.ts";
import { buildDynamicTasksImpl } from "../tools/workflow-guard-guidance/dynamic-tasks.ts";
import { buildPapernexusGuidance } from "../tools/workflow-guard-guidance/papernexus-guidance.ts";
import { buildWritingGuidance } from "../tools/workflow-guard-guidance/writing-guidance.ts";
import {
  getExperimentMemorySummaryImpl,
  recordCitationVerificationImpl,
  recordIdleResearchRunImpl,
  recordInnovationReflectionImpl,
  upsertExperimentLedgerEntryImpl,
} from "../tools/workflow-guard-recorders/state-recorders.ts";
import { runWorkflowAutoIteratorImpl } from "../tools/workflow-guard-runtime/auto-iterator.ts";

test("workflow guard materializer and guidance modules expose dedicated entrypoints", () => {
  assert.equal(typeof materializeIdeationContractImpl, "function");
  assert.equal(typeof materializePaperStoryStateImpl, "function");
  assert.equal(typeof materializeReviewPressurePacketImpl, "function");
  assert.equal(typeof buildDynamicTasksImpl, "function");
  assert.equal(typeof buildPapernexusGuidance, "function");
  assert.equal(typeof buildWritingGuidance, "function");
  assert.equal(typeof recordCitationVerificationImpl, "function");
  assert.equal(typeof recordIdleResearchRunImpl, "function");
  assert.equal(typeof recordInnovationReflectionImpl, "function");
  assert.equal(typeof getExperimentMemorySummaryImpl, "function");
  assert.equal(typeof upsertExperimentLedgerEntryImpl, "function");
  assert.equal(typeof runWorkflowAutoIteratorImpl, "function");
});

test("buildWritingGuidance surfaces story-first and adversarial review reminders for writer/reviewer roles", () => {
  const writerGuidance = buildWritingGuidance(
    {
      role: "academic_writer",
      currentStage: "write",
      manifest: {
        paper_story_state: {
          status: "ready",
          story_spine_path: "academic_writer/story/STORY_SPINE.md",
          claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
          fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
        },
        review_pressure_packet: {
          status: "ready",
          reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
          reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
          unsupported_claim_audit_path:
            "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
        },
      },
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: "conference",
        bodyPageBudget: 9,
        referencePageBudget: 2,
        bodyWordTargetMin: 4500,
        bodyWordTargetMax: 6000,
        kgStorylineRequired: true,
        kgStorylinePacketPath: "academic_writer/KG_STORYLINE_PACKET.json",
        kgStorylineStatus: "ready",
        templateMappingPath: "academic_writer/TEMPLATE_MAPPING.md",
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "red",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP", "CrossRef"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusApiTokenEnv: null,
      papernexusApiTokenSource: null,
      papernexusApiTokenService: null,
      papernexusApiTokenAccount: null,
      papernexusMineruHttpUrl: null,
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(
    writerGuidance.prepend.some((entry) => /story spine|claim-to-experiment|fallback/i.test(entry))
  );
  assert.ok(
    writerGuidance.prepend.some((entry) => /Writing flow map:/i.test(entry))
  );
  assert.ok(
    writerGuidance.append.some((entry) => /reject-first|reverse-outline|unsupported/i.test(entry))
  );
  assert.ok(
    writerGuidance.append.some((entry) => /Revision loop rule:/i.test(entry))
  );

  const reviewerGuidance = buildWritingGuidance(
    {
      role: "reviewer",
      currentStage: "write",
      manifest: {
        review_pressure_packet: {
          status: "ready",
          reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
          novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
        },
      },
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: null,
        bodyPageBudget: null,
        referencePageBudget: null,
        bodyWordTargetMin: null,
        bodyWordTargetMax: null,
        kgStorylineRequired: false,
        kgStorylinePacketPath: null,
        kgStorylineStatus: null,
        templateMappingPath: null,
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "green",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusApiTokenEnv: null,
      papernexusApiTokenSource: null,
      papernexusApiTokenService: null,
      papernexusApiTokenAccount: null,
      papernexusMineruHttpUrl: null,
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(
    reviewerGuidance.prepend.some((entry) => /citation integrity gate/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.prepend.some((entry) => /Writing flow map:/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.append.some((entry) => /reject-first|novelty attack/i.test(entry))
  );
  assert.ok(
    reviewerGuidance.append.some((entry) => /Review routing rule:/i.test(entry))
  );
});

test("buildPapernexusGuidance teaches researcher to use remote MCP when remote_mcp is configured", () => {
  const guidance = buildPapernexusGuidance(
    {
      role: "researcher",
      currentStage: "graph_build",
      manifest: null,
      missingStageSignals: [],
      idleResearch: { enabled: false, topic: null, maxPapersPerCycle: 0 },
      innovationReflection: { lastReflectionPath: null },
      innovationReflectionDue: false,
      writingContract: {
        templateRequired: false,
        paperMode: null,
        bodyPageBudget: null,
        referencePageBudget: null,
        bodyWordTargetMin: null,
        bodyWordTargetMax: null,
        kgStorylineRequired: false,
        kgStorylinePacketPath: null,
        kgStorylineStatus: null,
        templateMappingPath: null,
      },
      writingTemplatePath: null,
      writingTemplateStatus: "ready",
      paragraphLogicStatus: "green",
      writingContractPendingReason: null,
      citationIntegrity: {
        enabled: true,
        verificationRequired: true,
        verificationStatus: "pending",
        sourceOfTruth: ["DBLP"],
        allowedPlaceholderCount: 0,
      },
      citationReportPath: "reviewer/CITATION_VERIFICATION.md",
      recentExperiments: [],
      unreadMailbox: [],
      papernexusApiBaseUrl: null,
      papernexusMcpUrl: "https://papernexus.example/mcp",
      papernexusMcpTransport: "streamable-http",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenSource: "auto",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
      papernexusMineruHttpUrl: null,
      papernexusAccessMode: "remote_mcp",
    },
    {
      rolePolicies: {},
      asRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : null,
      asString: (value) => (typeof value === "string" ? value : null),
      normalizePaperIngestionState: () => ({
        runtimeStatus: null,
        waitingReason: null,
        repairRequired: false,
        repairReason: null,
        repairTargetCorpus: null,
      }),
      normalizeIdeaCatalystState: () => ({}),
      normalizeGraphPresenceStatus: () => null,
      summarizeGraphPresenceMissing: () => null,
      buildGraphImportRepairGuidance: () => "repair",
      isIdleResearchDue: () => false,
      computeIdleResearchNextDueAt: () => null,
      uniqueStrings: (items) => [...new Set(items)],
      DEFAULT_KG_STORYLINE_PACKET_PATH: "academic_writer/KG_STORYLINE_PACKET.json",
      DEFAULT_CITATION_REPORT_PATH: "reviewer/CITATION_VERIFICATION.md",
    }
  );

  assert.ok(guidance.prepend.some((entry) => /remote_mcp/i.test(entry)));
  assert.ok(
    guidance.prepend.some(
      (entry) => /PaperNexus MCP|research_lookup|research_briefing|idea_catalyst|import_workflow/i.test(entry)
    )
  );
  assert.ok(
    guidance.prepend.some(
      (entry) =>
        /MCP tool names, not shell commands/i.test(entry) &&
        /pn_graph_query\.py.*pn_research_chains\.py/i.test(entry)
    )
  );
});
