import test from "node:test";
import assert from "node:assert/strict";

import { materializeIdeationContractImpl } from "../tools/workflow-guard-materializers/ideation-contract-materializer.ts";
import { materializePaperStoryStateImpl } from "../tools/workflow-guard-materializers/paper-story-materializer.ts";
import { materializeReviewPressurePacketImpl } from "../tools/workflow-guard-materializers/review-pressure-materializer.ts";
import { buildDynamicTasksImpl } from "../tools/workflow-guard-guidance/dynamic-tasks.ts";
import { buildPapernexusGuidance } from "../tools/workflow-guard-guidance/papernexus-guidance.ts";
import { buildWritingGuidance } from "../tools/workflow-guard-guidance/writing-guidance.ts";
import { collectGraphBuildStageMissingSignals } from "../tools/workflow-guard-stages/foundation-stage-signals.ts";
import {
  derivePaperIngestionWorkflowDecision,
  hasActiveWorkflowOwnedPaperUpload,
  normalizePaperIngestionState,
} from "../tools/workflow-guard-state/paper-ingestion.ts";
import {
  asRecord,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickString,
} from "../tools/workflow-guard-core/coercion.ts";
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

test("graph_build stage accepts partial graph coverage when missing papers are repair-only", async () => {
  const manifest = {
    project_id: "partial-graph-demo",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "blocked",
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_papers",
      graph_presence_expected_papers: 2,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [
        { canonical_id: "arxiv:1803.02999", title: "On First-Order Meta-Learning Algorithms" },
      ],
      queued_requests: [
        {
          request_id: "req-partial",
          status: "needs_repair",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-partial/batch-import.json",
          last_error: "backend rejected one source",
        },
      ],
      batch_items: [
        {
          canonical_id: "arxiv:2410.11206",
          status: "completed",
          synced: true,
          import_task_id: "task-fixmatch",
        },
        {
          canonical_id: "arxiv:1803.02999",
          status: "submit_failed",
          error: "backend rejected one source",
        },
      ],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/partial-graph-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/partial-graph-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:1803.02999",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
});

test("graph_build stage accepts local source fallback after terminal PaperNexus failure", async () => {
  const manifest = {
    project_id: "local-source-graph-fallback-demo",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "waiting_import",
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_papers",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 0,
      graph_presence_missing_papers: [
        {
          canonical_id: "arxiv:2410.11206",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
          source_kind: "markdown",
          source_provider: "arxiv2md-api",
        },
      ],
      queued_requests: [
        {
          request_id: "req-dead-letter",
          request_kind: "upload_manifest",
          status: "queued",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-dead-letter/batch-import.json",
          last_error: "HTTP 502 for MCP tools/call:",
          finished_at: "2026-04-26T00:01:00.000Z",
          attempt_count: 3,
          max_attempts: 3,
          dead_letter_at: "2026-04-26T00:01:00.000Z",
          dead_letter_reason: "HTTP 502 for MCP tools/call:",
        },
      ],
      active_batches: [
        {
          manifest_path: "researcher/paper-staging/queued-imports/req-dead-letter/batch-import.json",
          status: "running",
          total: 1,
          detail: "HTTP 502 for MCP tools/call:",
        },
      ],
      batch_items: [],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/local-source-graph-fallback-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/local-source-graph-fallback-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:2410.11206",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
});

test("graph_build prerequisite stays satisfied downstream after local source fallback", async () => {
  const manifest = {
    project_id: "downstream-local-source-fallback-demo",
    current_stage: "frontier_mapping",
    paper_ingestion: {
      runtime_status: "waiting_graph",
      repair_required: true,
      graph_presence_checked_at: "2026-04-26T00:00:00.000Z",
      graph_presence_status: "missing_corpus",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 0,
      graph_presence_missing_papers: [
        {
          canonical_id: "arxiv:2410.11206",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
          source_kind: "markdown",
          source_provider: "arxiv2md-api",
        },
      ],
      queued_requests: [
        {
          request_id: "req-dormant",
          request_kind: "upload_manifest",
          status: "failed",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/paper-staging/queued-imports/req-dormant/batch-import.json",
          attempt_count: 3,
          max_attempts: 3,
          dead_letter_at: "2026-04-26T00:05:00.000Z",
        },
      ],
      active_batches: [],
      batch_items: [],
    },
  };

  const missing = await collectGraphBuildStageMissingSignals(
    {
      projectRoot: "/tmp/downstream-local-source-fallback-demo",
      manifest,
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists: async () => true,
      isNonEmptyDirectory: async () => true,
      fileHasMeaningfulJsonContent: async () => true,
      manifestFieldExists: (source, pathSpec) => {
        let cursor = source;
        for (const segment of pathSpec) {
          cursor = cursor && typeof cursor === "object" ? cursor[segment] : undefined;
        }
        return cursor !== undefined && cursor !== null;
      },
      getExperimentLedgerPath: () => "/tmp/downstream-local-source-fallback-demo/researcher/EXPERIMENT_LEDGER.json",
      pickString,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord,
      normalizeGraphPresenceStatus,
      normalizePaperIngestionState,
      hasActiveWorkflowOwnedPaperUpload,
      derivePaperIngestionWorkflowDecision,
      summarizeGraphPresenceMissing: () => "arxiv:2410.11206",
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage,
    }
  );

  assert.deepEqual(missing, []);
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
