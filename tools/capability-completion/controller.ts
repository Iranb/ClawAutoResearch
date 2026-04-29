import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_CAPABILITY_COMPLETION_DIR,
  type CapabilityClaimCapReportArtifact,
  type CapabilityCompletionArtifactPaths,
  type CapabilityCompletionArtifacts,
  type CapabilityCompletionMode,
  type CapabilityCompletionStatus,
  type CapabilityExecutionAction,
  type CapabilityExecutionPlanArtifact,
  type CapabilityGapInventoryArtifact,
  type CapabilityGapRecord,
  type CapabilityPriority,
  type CapabilityProviderCacheManifestArtifact,
  type CapabilityRerunGatePlanArtifact,
  type CapabilityRunReceiptArtifact,
  type CapabilitySeverity,
} from "./contracts";
import {
  asRecord,
  asString,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { materializeLiteratureResearchControllerArtifacts } from "../literature-discovery/controller-contract";
import { runLiteratureProviderEvidence } from "../literature-discovery/provider-evidence-runner";

type UnknownRecord = Record<string, unknown>;

type ControllerInputs = {
  manifest: UnknownRecord;
  scorecard: UnknownRecord | null;
  literatureCoverageReport: UnknownRecord | null;
  providerResultIndex: UnknownRecord | null;
  providerEvidenceRunManifest: UnknownRecord | null;
  papernexusImportBatchManifest: UnknownRecord | null;
  papernexusRefreshReport: UnknownRecord | null;
  citationExpansionReport: UnknownRecord | null;
  snippetEvidenceReport: UnknownRecord | null;
  papernexusTaskCertification: UnknownRecord | null;
  reviewIssues: UnknownRecord | null;
  domainEvaluator: UnknownRecord | null;
  benchmarkAdapter: UnknownRecord | null;
  reviewerCalibration: UnknownRecord | null;
  copyeditStyleAudit: UnknownRecord | null;
  storylineV2Artifacts: Record<string, boolean>;
  papernexusProofArtifacts: Record<string, boolean>;
};

const PRIORITY_ORDER: CapabilityPriority[] = [
  "literature",
  "evidence_chain",
  "storyline",
  "evaluator",
  "repair_console",
  "writeback",
];

const DEFAULT_RETRY_POLICY = {
  transient_retries: 3,
  provider_429_wait_seconds: 3600,
  papernexus_retries: 2,
};

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
}

function relativePath(projectRoot: string, artifactPath: string): string {
  return path.relative(projectRoot, artifactPath);
}

function relativePaths(
  projectRoot: string,
  paths: CapabilityCompletionArtifactPaths
): CapabilityCompletionArtifactPaths {
  return Object.fromEntries(
    Object.entries(paths).map(([key, value]) => [key, relativePath(projectRoot, value)])
  ) as CapabilityCompletionArtifactPaths;
}

export function buildCapabilityCompletionArtifactPaths(
  projectRoot: string
): CapabilityCompletionArtifactPaths {
  const root = path.join(projectRoot, DEFAULT_CAPABILITY_COMPLETION_DIR);
  return {
    status_markdown_path: path.join(root, "CAPABILITY_COMPLETION_STATUS.md"),
    gap_inventory_path: path.join(root, "capability_gap_inventory.json"),
    execution_plan_path: path.join(root, "capability_execution_plan.json"),
    run_receipt_path: path.join(root, "capability_run_receipt.json"),
    trace_path: path.join(root, "capability_trace.jsonl"),
    repair_queue_path: path.join(root, "capability_repair_queue.jsonl"),
    claim_cap_report_path: path.join(root, "capability_claim_cap_report.json"),
    provider_cache_manifest_path: path.join(root, "provider_cache_manifest.json"),
    rerun_gate_plan_path: path.join(root, "rerun_gate_plan.json"),
  };
}

function readNestedRecord(source: UnknownRecord | null, keys: string[]): UnknownRecord | null {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (!record) {
      return null;
    }
    cursor = record[key];
  }
  return asRecord(cursor);
}

function readNestedString(source: UnknownRecord | null, keys: string[]): string | null {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (!record) {
      return null;
    }
    cursor = record[key];
  }
  return asString(cursor);
}

function readNestedBoolean(source: UnknownRecord | null, keys: string[]): boolean | null {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (!record) {
      return null;
    }
    cursor = record[key];
  }
  return typeof cursor === "boolean" ? cursor : null;
}

function readNestedNumber(source: UnknownRecord | null, keys: string[]): number | null {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    if (!record) {
      return null;
    }
    cursor = record[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function statusIsPass(value: unknown): boolean {
  return typeof value === "string" && ["pass", "ready", "completed"].includes(value);
}

function statusIsMissing(value: unknown): boolean {
  return value == null || value === "missing" || value === "unavailable";
}

function providerErrorText(providerResultIndex: UnknownRecord | null): string[] {
  const results = arrayFrom(providerResultIndex?.provider_query_results);
  return results
    .map((entry) => {
      const record = asRecord(entry);
      return asString(record?.error) ?? asString(record?.status) ?? "";
    })
    .filter(Boolean);
}

function firstDeferredUntil(generatedAt: string): string {
  return new Date(Date.parse(generatedAt) + 3600 * 1000).toISOString();
}

function classifyProviderError(errors: string[]): {
  authError: boolean;
  rateLimit: boolean;
} {
  const joined = errors.join("\n").toLowerCase();
  return {
    authError: /401|403|unauthorized|forbidden|api key|apikey|auth|credential/.test(joined),
    rateLimit: /429|rate limit|too many requests|quota/.test(joined),
  };
}

function makeGap(params: {
  projectId: string | null;
  capability: CapabilityPriority;
  code: string;
  status: CapabilityGapRecord["status"];
  severity: CapabilitySeverity;
  summary: string;
  sourceArtifacts: string[];
  expectedArtifacts: string[];
  canAutoExecute: boolean;
  blockedByAuth?: boolean;
  blockedByMissingArtifact?: boolean;
  degradable?: boolean;
  deferredUntil?: string | null;
  nextAction: string;
  details?: Record<string, unknown>;
}): CapabilityGapRecord {
  return {
    id: `${params.capability}-${params.code}-${stableHash({
      projectId: params.projectId,
      sourceArtifacts: params.sourceArtifacts,
      expectedArtifacts: params.expectedArtifacts,
      summary: params.summary,
    })}`,
    capability: params.capability,
    code: params.code,
    status: params.status,
    severity: params.severity,
    summary: params.summary,
    source_artifacts: uniqueStrings(params.sourceArtifacts),
    expected_artifacts: uniqueStrings(params.expectedArtifacts),
    can_auto_execute: params.canAutoExecute,
    blocked_by_auth: params.blockedByAuth === true,
    blocked_by_missing_artifact: params.blockedByMissingArtifact === true,
    degradable: params.degradable !== false,
    deferred_until: params.deferredUntil ?? null,
    next_action: params.nextAction,
    details: params.details ?? {},
  };
}

function actionStatusForGap(gap: CapabilityGapRecord): CapabilityExecutionAction["status"] {
  if (gap.status === "runnable" && gap.can_auto_execute) {
    return "runnable";
  }
  if (gap.status === "deferred") {
    return "deferred";
  }
  if (gap.status === "blocked") {
    return "blocked";
  }
  if (gap.status === "planned" || gap.status === "degraded") {
    return "planned";
  }
  return "skipped";
}

function toolActionForGap(gap: CapabilityGapRecord): {
  toolAction: string;
  existingTool: boolean;
  owner: string;
} {
  if (gap.capability === "literature") {
    if (gap.code === "provider_snippet_citation_execution_missing") {
      return {
        toolAction: "run_literature_provider_evidence",
        existingTool: true,
        owner: "researcher",
      };
    }
    if (gap.code === "citation_snowballing_incomplete") {
      return {
        toolAction: "plan_citation_expansion",
        existingTool: true,
        owner: "researcher",
      };
    }
    return {
      toolAction: "run_literature_research_controller",
      existingTool: true,
      owner: "researcher",
    };
  }
  if (gap.capability === "evidence_chain") {
    return {
      toolAction: "run_papernexus_evidence_chain_probe",
      existingTool: false,
      owner: "researcher",
    };
  }
  if (gap.capability === "storyline") {
    return {
      toolAction: "materialize_storyline_v2_contract",
      existingTool: false,
      owner: "academic_writer",
    };
  }
  if (gap.capability === "evaluator") {
    return {
      toolAction: "run_domain_evaluator_pack",
      existingTool: false,
      owner: "coder",
    };
  }
  if (gap.capability === "repair_console") {
    return {
      toolAction: "run_repair_engine",
      existingTool: false,
      owner: "academic_writer",
    };
  }
  return {
    toolAction: "write_papernexus_research_writeback",
    existingTool: false,
    owner: "researcher",
  };
}

function buildAction(gap: CapabilityGapRecord): CapabilityExecutionAction | null {
  if (gap.status === "satisfied") {
    return null;
  }
  const tool = toolActionForGap(gap);
  return {
    id: `${tool.toolAction}-${stableHash(gap)}`,
    capability: gap.capability,
    gap_id: gap.id,
    status: actionStatusForGap(gap),
    tool_action: tool.toolAction,
    existing_tool: tool.existingTool,
    owner: tool.owner,
    inputs: {
      gap_id: gap.id,
      source_artifacts: gap.source_artifacts,
    },
    expected_artifacts: gap.expected_artifacts,
    retry_policy: DEFAULT_RETRY_POLICY,
    reason: gap.summary,
    result: null,
  };
}

function detectLiteratureGaps(params: {
  projectId: string | null;
  generatedAt: string;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  const gaps: CapabilityGapRecord[] = [];
  const literatureSummary = readNestedRecord(params.inputs.scorecard, [
    "literature_research_controller",
  ]);
  const controllerStatus =
    asString(literatureSummary?.status) ??
    asString(params.inputs.literatureCoverageReport?.status);
  const controllerDecision =
    asString(literatureSummary?.decision) ??
    asString(params.inputs.literatureCoverageReport?.decision);
  const coverageScore =
    readNestedNumber(params.inputs.scorecard, [
      "literature_research_controller",
      "coverage_score_100",
    ]) ?? readNestedNumber(params.inputs.literatureCoverageReport, ["coverage_score_100"]);
  const providerErrors = providerErrorText(params.inputs.providerResultIndex);
  const providerErrorClass = classifyProviderError(providerErrors);
  const providerStatus = asString(params.inputs.providerResultIndex?.status);
  const providerQueryCount =
    readNestedNumber(params.inputs.providerResultIndex, ["provider_query_count"]) ?? 0;
  const providerEvidenceStatus = asString(
    params.inputs.providerEvidenceRunManifest?.status
  );
  const providerEvidenceSnippetCount =
    readNestedNumber(params.inputs.providerEvidenceRunManifest, [
      "snippet_candidate_count",
    ]) ?? 0;
  const providerEvidenceCitationCount =
    readNestedNumber(params.inputs.providerEvidenceRunManifest, [
      "citation_candidate_count",
    ]) ?? 0;
  const providerEvidenceAuthErrorCount =
    readNestedNumber(params.inputs.providerEvidenceRunManifest, [
      "auth_error_count",
    ]) ?? 0;
  const providerEvidenceRateLimitCount =
    readNestedNumber(params.inputs.providerEvidenceRunManifest, [
      "rate_limit_count",
    ]) ?? 0;
  const providerEvidenceDeferredUntil =
    readNestedString(params.inputs.providerEvidenceRunManifest, ["deferred_until"]);
  const providerEvidenceCount =
    providerEvidenceSnippetCount + providerEvidenceCitationCount;
  const snippetStatus = asString(params.inputs.snippetEvidenceReport?.status);
  const snippetGroundedCount =
    readNestedNumber(params.inputs.snippetEvidenceReport, [
      "snippet_grounded_count",
    ]) ?? 0;
  const claimProofEligibleCount =
    readNestedNumber(params.inputs.snippetEvidenceReport, [
      "claim_proof_eligible_count",
    ]) ?? 0;
  const citationStatus = asString(params.inputs.citationExpansionReport?.status);
  const snowballingStatus = readNestedString(params.inputs.citationExpansionReport, [
    "snowballing",
    "status",
  ]);

  if (
    ["blocked", "needs_research", "error", "unavailable"].includes(
      controllerStatus ?? ""
    ) ||
    controllerDecision === "continue_research" ||
    (coverageScore !== null && coverageScore < 80)
  ) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "literature_controller_needs_research",
        status: providerErrorClass.authError
          ? "blocked"
          : providerErrorClass.rateLimit
            ? "deferred"
            : "runnable",
        severity: providerErrorClass.authError ? "critical" : "high",
        summary:
          "Literature coverage is not strong enough for publication-grade claims.",
        sourceArtifacts: [
          ".openclaw-research/E2E_RUN_SCORECARD.json",
          "researcher/literature-research-controller/literature_coverage_report.json",
        ],
        expectedArtifacts: [
          "researcher/literature-research-controller/provider_result_index.json",
          "researcher/literature-research-controller/papernexus_import_batch_manifest.json",
          "researcher/literature-research-controller/literature_controller_run_receipt.json",
        ],
        canAutoExecute: !providerErrorClass.authError && !providerErrorClass.rateLimit,
        blockedByAuth: providerErrorClass.authError,
        deferredUntil: providerErrorClass.rateLimit
          ? firstDeferredUntil(params.generatedAt)
          : null,
        nextAction: "research_workflow.run_literature_research_controller",
        details: {
          controller_status: controllerStatus,
          controller_decision: controllerDecision,
          coverage_score_100: coverageScore,
          provider_errors: providerErrors,
        },
      })
    );
  }

  if (!params.inputs.providerResultIndex || providerStatus === "skipped" || providerQueryCount === 0) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "provider_execution_missing",
        status: "runnable",
        severity: "high",
        summary:
          "Provider execution receipt is missing or skipped; query planning has not become a runnable retrieval pass.",
        sourceArtifacts: [
          "researcher/literature-research-controller/literature_query_plan.json",
        ],
        expectedArtifacts: [
          "researcher/literature-research-controller/provider_result_index.json",
        ],
        canAutoExecute: true,
        nextAction: "research_workflow.run_literature_research_controller",
        details: {
          provider_status: providerStatus,
          provider_query_count: providerQueryCount,
        },
      })
    );
  }

  if (
    !params.inputs.providerEvidenceRunManifest ||
    providerEvidenceStatus === "empty" ||
    providerEvidenceStatus === "error" ||
    providerEvidenceStatus === "blocked_auth" ||
    providerEvidenceStatus === "deferred" ||
    providerEvidenceCount === 0
  ) {
    const authBlocked =
      providerEvidenceStatus === "blocked_auth" ||
      providerEvidenceAuthErrorCount > 0 ||
      providerErrorClass.authError;
    const rateLimited =
      providerEvidenceStatus === "deferred" ||
      providerEvidenceRateLimitCount > 0 ||
      providerErrorClass.rateLimit;
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "provider_snippet_citation_execution_missing",
        status: authBlocked ? "blocked" : rateLimited ? "deferred" : "runnable",
        severity: authBlocked ? "high" : "medium",
        summary:
          "Provider raw metadata has not been converted into snippet and citation evidence candidates.",
        sourceArtifacts: [
          "researcher/PAPER_SOURCE_INDEX.json",
          "researcher/literature-research-controller/provider_result_index.json",
          "researcher/search_raw/*_provider_results.json",
        ],
        expectedArtifacts: [
          "researcher/literature-research-controller/provider_evidence_run_manifest.json",
          "researcher/literature-research-controller/provider_evidence_candidates.json",
          "researcher/literature-research-controller/provider_evidence_error_report.json",
        ],
        canAutoExecute: !authBlocked && !rateLimited,
        blockedByAuth: authBlocked,
        deferredUntil: rateLimited
          ? providerEvidenceDeferredUntil ?? firstDeferredUntil(params.generatedAt)
          : null,
        nextAction: "research_workflow.run_literature_provider_evidence",
        details: {
          provider_evidence_status: providerEvidenceStatus,
          provider_evidence_snippet_candidate_count: providerEvidenceSnippetCount,
          provider_evidence_citation_candidate_count: providerEvidenceCitationCount,
          provider_query_count: providerQueryCount,
        },
      })
    );
  }

  if (
    !params.inputs.snippetEvidenceReport ||
    ["empty", "fallback_only"].includes(snippetStatus ?? "") ||
    snippetGroundedCount === 0 ||
    claimProofEligibleCount === 0
  ) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "snippet_evidence_not_claim_proof",
        status:
          providerEvidenceCount > 0 || snippetGroundedCount > 0
            ? "degraded"
            : "planned",
        severity: "medium",
        summary:
          providerEvidenceCount > 0
            ? "Provider discovery evidence is available, but claim-level proof still lacks source-backed spans."
            : "Snippet evidence is not strong enough to support claim-level proof; provider/source-span execution is still required.",
        sourceArtifacts: [
          "researcher/PAPER_SOURCE_INDEX.json",
          "researcher/literature-research-controller/snippet_evidence_report.json",
          "researcher/literature-research-controller/provider_evidence_candidates.json",
        ],
        expectedArtifacts: [
          "researcher/literature-research-controller/snippet_evidence_report.json",
          "graph/papernexus_evidence_chain_index.json",
        ],
        canAutoExecute: false,
        nextAction: "implement and run snippet/source-span provider jobs",
        details: {
          snippet_status: snippetStatus,
          snippet_grounded_count: snippetGroundedCount,
          claim_proof_eligible_count: claimProofEligibleCount,
          provider_evidence_status: providerEvidenceStatus,
          provider_evidence_snippet_candidate_count: providerEvidenceSnippetCount,
          provider_evidence_citation_candidate_count: providerEvidenceCitationCount,
        },
      })
    );
  }

  if (
    !params.inputs.citationExpansionReport ||
    citationStatus === "skipped" ||
    ["missing_seed_metadata", "empty"].includes(snowballingStatus ?? "")
  ) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "citation_snowballing_incomplete",
        status: "runnable",
        severity: "medium",
        summary:
          "Citation snowballing is incomplete; bounded citation expansion should be planned before treating coverage as closed.",
        sourceArtifacts: [
          "researcher/PAPER_SOURCE_INDEX.json",
          "researcher/literature-research-controller/citation_expansion_report.json",
        ],
        expectedArtifacts: [
          "researcher/literature-research-controller/citation_expansion_report.json",
        ],
        canAutoExecute: true,
        nextAction: "research_workflow.plan_citation_expansion",
        details: {
          citation_status: citationStatus,
          snowballing_status: snowballingStatus,
        },
      })
    );
  }

  if (gaps.length === 0) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "literature",
        code: "literature_closed_loop_ready",
        status: "satisfied",
        severity: "low",
        summary: "Literature controller, provider receipt, snippets, and citation report are present.",
        sourceArtifacts: [
          "researcher/literature-research-controller/literature_coverage_report.json",
          "researcher/literature-research-controller/provider_result_index.json",
        ],
        expectedArtifacts: [],
        canAutoExecute: false,
        nextAction: "none",
      })
    );
  }
  return gaps;
}

function detectEvidenceChainGaps(params: {
  projectId: string | null;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  const cert = params.inputs.papernexusTaskCertification;
  const status =
    asString(cert?.status) ??
    readNestedString(params.inputs.scorecard, ["papernexus_certification", "status"]);
  const claimLevel =
    asString(cert?.claim_level) ??
    readNestedString(params.inputs.scorecard, [
      "papernexus_certification",
      "claim_level",
    ]);
  const sourceBacked =
    readNestedBoolean(params.inputs.scorecard, [
      "papernexus_certification",
      "source_backed_graph_claim",
    ]) ?? (cert?.source_backed_graph_claim === true);
  const hasEvidenceIndex =
    params.inputs.papernexusProofArtifacts["graph/papernexus_evidence_chain_index.json"] ===
    true;
  const hasComponentProof =
    params.inputs.papernexusProofArtifacts[
      "graph/papernexus_component_graph_proof.json"
    ] === true;

  if (
    statusIsMissing(status) ||
    status !== "ready" ||
    !sourceBacked ||
    !hasEvidenceIndex ||
    !hasComponentProof
  ) {
    return [
      makeGap({
        projectId: params.projectId,
        capability: "evidence_chain",
        code: "papernexus_evidence_chain_missing",
        status: statusIsMissing(status) ? "blocked" : "planned",
        severity: statusIsMissing(status) ? "critical" : "high",
        summary:
          "PaperNexus task certification is not yet a per-claim evidence-chain proof.",
        sourceArtifacts: [
          "graph/PAPERNEXUS_TASK_CERTIFICATION.json",
          "researcher/literature-research-controller/papernexus_import_batch_manifest.json",
          "researcher/literature-research-controller/papernexus_refresh_report.json",
        ],
        expectedArtifacts: [
          "graph/papernexus_run_manifest.json",
          "graph/papernexus_tool_contract_report.json",
          "graph/papernexus_graph_snapshot.json",
          "graph/papernexus_component_graph_proof.json",
          "graph/papernexus_evidence_chain_index.json",
          "graph/corpus_delta_report.json",
        ],
        canAutoExecute: false,
        blockedByMissingArtifact: statusIsMissing(status),
        nextAction: "implement and run PaperNexus evidence-chain proof materializer",
        details: {
          certification_status: status,
          claim_level: claimLevel,
          source_backed_graph_claim: sourceBacked,
          has_evidence_index: hasEvidenceIndex,
          has_component_proof: hasComponentProof,
        },
      }),
    ];
  }
  return [
    makeGap({
      projectId: params.projectId,
      capability: "evidence_chain",
      code: "papernexus_evidence_chain_ready",
      status: "satisfied",
      severity: "low",
      summary: "PaperNexus evidence-chain proof artifacts are present.",
      sourceArtifacts: ["graph/papernexus_evidence_chain_index.json"],
      expectedArtifacts: [],
      canAutoExecute: false,
      nextAction: "none",
    }),
  ];
}

function detectStorylineGaps(params: {
  projectId: string | null;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  const required = [
    "researcher/storyline/CONCEPTUAL_CHALLENGE_GRAPH.json",
    "researcher/storyline/STORY_SPINE_V2.json",
    "researcher/storyline/NARRATIVE_EVIDENCE_GRAPH.json",
    "researcher/storyline/STORY_DRIVEN_EXPERIMENT_PLAN.json",
    "researcher/storyline/STORYLINE_GATE_REPORT.json",
  ];
  const missing = required.filter(
    (relative) => params.inputs.storylineV2Artifacts[relative] !== true
  );
  if (missing.length > 0) {
    return [
      makeGap({
        projectId: params.projectId,
        capability: "storyline",
        code: "storyline_v2_contract_missing",
        status: "planned",
        severity: "medium",
        summary:
          "Storyline v2 is not a fail-closed upstream contract yet; current story artifacts remain advisory.",
        sourceArtifacts: [
          "academic_writer/story/STORY_SPINE.md",
          "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
          "researcher/GAP_SYNTHESIS.md",
        ],
        expectedArtifacts: missing,
        canAutoExecute: false,
        nextAction: "implement Storyline v2 contract materializer and gate",
        details: { missing_artifacts: missing },
      }),
    ];
  }
  return [
    makeGap({
      projectId: params.projectId,
      capability: "storyline",
      code: "storyline_v2_ready",
      status: "satisfied",
      severity: "low",
      summary: "Storyline v2 contract artifacts are present.",
      sourceArtifacts: required,
      expectedArtifacts: [],
      canAutoExecute: false,
      nextAction: "none",
    }),
  ];
}

function detectEvaluatorGaps(params: {
  projectId: string | null;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  const domainStatus =
    asString(params.inputs.domainEvaluator?.status) ??
    readNestedString(params.inputs.scorecard, ["domain_evaluator", "status"]);
  const benchmarkStatus =
    asString(params.inputs.benchmarkAdapter?.status) ??
    readNestedString(params.inputs.scorecard, ["benchmark_adapter", "status"]);
  const reviewerStatus =
    asString(params.inputs.reviewerCalibration?.status) ??
    readNestedString(params.inputs.scorecard, ["reviewer_calibration", "status"]);
  const gaps: CapabilityGapRecord[] = [];
  if (!statusIsPass(domainStatus) || !statusIsPass(benchmarkStatus)) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "evaluator",
        code: "dataset_backed_evaluator_missing",
        status: "planned",
        severity: "high",
        summary:
          "Dataset-backed evaluator is not complete; benchmark fixtures cannot prove top-conference experimental claims.",
        sourceArtifacts: [
          ".openclaw-research/E2E_DOMAIN_EVALUATOR_CONTRACT.json",
          ".openclaw-research/E2E_BENCHMARK_ADAPTER_SCORECARD.json",
        ],
        expectedArtifacts: [
          ".openclaw-research/E2E_DATASET_BACKED_PROOF.json",
          ".openclaw-research/E2E_EVALUATOR_RUN_MANIFEST.json",
          ".openclaw-research/E2E_EVALUATOR_RESULT_INDEX.json",
        ],
        canAutoExecute: false,
        nextAction: "implement and run domain evaluator adapter pack",
        details: {
          domain_evaluator_status: domainStatus,
          benchmark_adapter_status: benchmarkStatus,
        },
      })
    );
  }
  if (!statusIsPass(reviewerStatus)) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "evaluator",
        code: "venue_reviewer_calibration_missing",
        status: "planned",
        severity: "medium",
        summary:
          "Reviewer calibration is not backed by a venue corpus or accepted/rejected examples.",
        sourceArtifacts: [".openclaw-research/E2E_REVIEWER_CALIBRATION.json"],
        expectedArtifacts: [
          ".openclaw-research/E2E_VENUE_CALIBRATION_REPORT.json",
          ".openclaw-research/E2E_REVIEWER_CORPUS_REPORT.json",
        ],
        canAutoExecute: false,
        nextAction: "implement venue/reviewer calibration corpus provider",
        details: { reviewer_calibration_status: reviewerStatus },
      })
    );
  }
  if (gaps.length === 0) {
    gaps.push(
      makeGap({
        projectId: params.projectId,
        capability: "evaluator",
        code: "evaluator_contract_ready",
        status: "satisfied",
        severity: "low",
        summary: "Current evaluator, benchmark, and reviewer calibration contracts pass.",
        sourceArtifacts: [".openclaw-research/E2E_DOMAIN_EVALUATOR_CONTRACT.json"],
        expectedArtifacts: [],
        canAutoExecute: false,
        nextAction: "none",
      })
    );
  }
  return gaps;
}

function openReviewIssueCount(reviewIssues: UnknownRecord | null): number {
  const issues = arrayFrom(reviewIssues?.issues);
  if (issues.length > 0) {
    return issues.filter((entry) => {
      const record = asRecord(entry);
      const status = asString(record?.status) ?? "open";
      return !["closed", "resolved", "done"].includes(status);
    }).length;
  }
  const openCounts = asRecord(reviewIssues?.open_counts);
  if (!openCounts) {
    return 0;
  }
  return Object.values(openCounts).reduce<number>((sum, value) => {
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function detectRepairGaps(params: {
  projectId: string | null;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  const failedRequiredCount = arrayFrom(params.inputs.scorecard?.failed_required_checks).length;
  const diagnosticFailedCount = arrayFrom(
    params.inputs.scorecard?.diagnostic_failed_checks
  ).length;
  const openIssues = openReviewIssueCount(params.inputs.reviewIssues);
  const copyeditStatus =
    asString(params.inputs.copyeditStyleAudit?.status) ??
    readNestedString(params.inputs.scorecard, ["copyedit_style_audit", "status"]);

  if (
    failedRequiredCount > 0 ||
    diagnosticFailedCount > 0 ||
    openIssues > 0 ||
    !statusIsPass(copyeditStatus)
  ) {
    return [
      makeGap({
        projectId: params.projectId,
        capability: "repair_console",
        code: "rewrite_repair_engine_missing",
        status: "planned",
        severity: failedRequiredCount > 0 ? "high" : "medium",
        summary:
          "Review, content, or style gaps exist, but there is no unified deterministic rewrite/repair engine yet.",
        sourceArtifacts: [
          ".openclaw-research/E2E_RUN_SCORECARD.json",
          "reviewer/REVIEW_ISSUES.json",
          ".openclaw-research/E2E_COPYEDIT_STYLE_AUDIT.json",
        ],
        expectedArtifacts: [
          ".openclaw-research/E2E_REPAIR_PLAN.json",
          ".openclaw-research/E2E_REPAIR_DIFF_SUMMARY.json",
          ".openclaw-research/E2E_POST_REPAIR_GATE_REPORT.json",
          ".openclaw-research/E2E_CONTROL_CONSOLE.json",
          ".openclaw-research/E2E_CONTROL_CONSOLE.html",
        ],
        canAutoExecute: false,
        nextAction: "implement repair engine and local control console launcher",
        details: {
          failed_required_check_count: failedRequiredCount,
          diagnostic_failed_check_count: diagnosticFailedCount,
          open_review_issue_count: openIssues,
          copyedit_status: copyeditStatus,
        },
      }),
    ];
  }
  return [
    makeGap({
      projectId: params.projectId,
      capability: "repair_console",
      code: "repair_inputs_clean",
      status: "satisfied",
      severity: "low",
      summary: "No failed scorecard, review, or copyedit repair inputs are currently open.",
      sourceArtifacts: [".openclaw-research/E2E_RUN_SCORECARD.json"],
      expectedArtifacts: [],
      canAutoExecute: false,
      nextAction: "none",
    }),
  ];
}

function detectWritebackGaps(params: {
  projectId: string | null;
  projectRoot: string;
}): CapabilityGapRecord[] {
  const writebackPath = path.join(params.projectRoot, "graph", "papernexus_writeback_log.json");
  return [
    makeGap({
      projectId: params.projectId,
      capability: "writeback",
      code: "papernexus_research_writeback_missing",
      status: "planned",
      severity: "medium",
      summary:
        "Closeout-stage hypothesis/result/claim/limitation writeback to PaperNexus is not implemented yet.",
      sourceArtifacts: ["academic_writer/paper/main.tex", "researcher/EXPERIMENT_LEDGER.json"],
      expectedArtifacts: ["graph/papernexus_writeback_log.json"],
      canAutoExecute: false,
      nextAction: "implement namespaced PaperNexus mutate_graph writeback",
      details: { writeback_log_path: relativePath(params.projectRoot, writebackPath) },
    }),
  ];
}

function detectGaps(params: {
  projectRoot: string;
  projectId: string | null;
  generatedAt: string;
  inputs: ControllerInputs;
}): CapabilityGapRecord[] {
  return [
    ...detectLiteratureGaps(params),
    ...detectEvidenceChainGaps(params),
    ...detectStorylineGaps(params),
    ...detectEvaluatorGaps(params),
    ...detectRepairGaps(params),
    ...detectWritebackGaps({
      projectId: params.projectId,
      projectRoot: params.projectRoot,
    }),
  ];
}

function completionStatusFromGaps(gaps: CapabilityGapRecord[]): CapabilityCompletionStatus {
  const open = gaps.filter((gap) => gap.status !== "satisfied");
  if (open.length === 0) {
    return "completed";
  }
  if (open.some((gap) => gap.status === "blocked" && gap.severity === "critical")) {
    return "blocked";
  }
  if (open.some((gap) => gap.status === "runnable")) {
    return "planned";
  }
  if (open.some((gap) => gap.status === "deferred" || gap.status === "degraded")) {
    return "degraded";
  }
  return "degraded";
}

function recommendedClaimCap(params: {
  current: string | null;
  gaps: CapabilityGapRecord[];
}): { cap: string; reasons: string[] } {
  const reasons: string[] = [];
  const hasEvidenceGap = params.gaps.some(
    (gap) => gap.capability === "evidence_chain" && gap.status !== "satisfied"
  );
  const hasEvaluatorGap = params.gaps.some(
    (gap) => gap.capability === "evaluator" && gap.status !== "satisfied"
  );
  const hasLiteratureProofGap = params.gaps.some(
    (gap) =>
      gap.capability === "literature" &&
      gap.status !== "satisfied" &&
      [
        "snippet_evidence_not_claim_proof",
        "provider_execution_missing",
        "provider_snippet_citation_execution_missing",
      ].includes(gap.code)
  );
  if (params.gaps.some((gap) => gap.status === "blocked")) {
    reasons.push("At least one critical capability is blocked.");
    return { cap: "blocked", reasons };
  }
  if (hasEvidenceGap) {
    reasons.push("PaperNexus evidence-chain proof is incomplete.");
  }
  if (hasEvaluatorGap) {
    reasons.push("Dataset-backed evaluator or venue calibration is incomplete.");
  }
  if (hasLiteratureProofGap) {
    reasons.push("Snippet/source-span proof is incomplete for strong claims.");
  }
  if (hasEvidenceGap || hasLiteratureProofGap) {
    return { cap: "guarded_related_work_only", reasons };
  }
  if (hasEvaluatorGap) {
    return { cap: "evidence_backed_no_dataset_sota", reasons };
  }
  return { cap: params.current ?? "evidence_backed", reasons: ["No capability cap downgrade required."] };
}

async function readArtifactPresence(
  projectRoot: string,
  relativePaths: string[]
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    relativePaths.map(async (relative) => [
      relative,
      await pathExists(path.join(projectRoot, relative)),
    ])
  );
  return Object.fromEntries(entries);
}

async function loadInputs(params: {
  projectRoot: string;
  scorecard?: unknown;
}): Promise<ControllerInputs> {
  const projectRoot = params.projectRoot;
  const openclawDir = path.join(projectRoot, ".openclaw-research");
  const controllerDir = path.join(
    projectRoot,
    "researcher",
    "literature-research-controller"
  );
  const scorecardOverride = asRecord(params.scorecard);
  const [
    manifest,
    scorecard,
    literatureCoverageReport,
    providerResultIndex,
    providerEvidenceRunManifest,
    papernexusImportBatchManifest,
    papernexusRefreshReport,
    citationExpansionReport,
    snippetEvidenceReport,
    papernexusTaskCertification,
    reviewIssues,
    domainEvaluator,
    benchmarkAdapter,
    reviewerCalibration,
    copyeditStyleAudit,
    storylineV2Artifacts,
    papernexusProofArtifacts,
  ] = await Promise.all([
    readJsonIfExists<UnknownRecord>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    scorecardOverride
      ? Promise.resolve(scorecardOverride)
      : readJsonIfExists<UnknownRecord>(
          path.join(openclawDir, "E2E_RUN_SCORECARD.json")
        ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "literature_coverage_report.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "provider_result_index.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "provider_evidence_run_manifest.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "papernexus_import_batch_manifest.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "papernexus_refresh_report.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "citation_expansion_report.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(controllerDir, "snippet_evidence_report.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json")
    ),
    readJsonIfExists<UnknownRecord>(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json")),
    readJsonIfExists<UnknownRecord>(
      path.join(openclawDir, "E2E_DOMAIN_EVALUATOR_CONTRACT.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(openclawDir, "E2E_BENCHMARK_ADAPTER_SCORECARD.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(openclawDir, "E2E_REVIEWER_CALIBRATION.json")
    ),
    readJsonIfExists<UnknownRecord>(
      path.join(openclawDir, "E2E_COPYEDIT_STYLE_AUDIT.json")
    ),
    readArtifactPresence(projectRoot, [
      "researcher/storyline/CONCEPTUAL_CHALLENGE_GRAPH.json",
      "researcher/storyline/STORY_SPINE_V2.json",
      "researcher/storyline/NARRATIVE_EVIDENCE_GRAPH.json",
      "researcher/storyline/STORY_DRIVEN_EXPERIMENT_PLAN.json",
      "researcher/storyline/STORYLINE_GATE_REPORT.json",
    ]),
    readArtifactPresence(projectRoot, [
      "graph/papernexus_run_manifest.json",
      "graph/papernexus_tool_contract_report.json",
      "graph/papernexus_graph_snapshot.json",
      "graph/papernexus_component_graph_proof.json",
      "graph/papernexus_evidence_chain_index.json",
      "graph/corpus_delta_report.json",
    ]),
  ]);
  return {
    manifest: manifest ?? {},
    scorecard,
    literatureCoverageReport,
    providerResultIndex,
    providerEvidenceRunManifest,
    papernexusImportBatchManifest,
    papernexusRefreshReport,
    citationExpansionReport,
    snippetEvidenceReport,
    papernexusTaskCertification,
    reviewIssues,
    domainEvaluator,
    benchmarkAdapter,
    reviewerCalibration,
    copyeditStyleAudit,
    storylineV2Artifacts,
    papernexusProofArtifacts,
  };
}

function buildProviderCacheManifest(params: {
  generatedAt: string;
  projectId: string | null;
  projectRoot: string;
  inputs: ControllerInputs;
  gaps: CapabilityGapRecord[];
}): CapabilityProviderCacheManifestArtifact {
  const providerPath = path.join(
    params.projectRoot,
    "researcher",
    "literature-research-controller",
    "provider_result_index.json"
  );
  const providerErrors = providerErrorText(params.inputs.providerResultIndex);
  const errorClass = classifyProviderError(providerErrors);
  const providerNames = arrayFrom(params.inputs.providerResultIndex?.provider_names);
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    provider_result_index_path: params.inputs.providerResultIndex
      ? relativePath(params.projectRoot, providerPath)
      : null,
    provider_query_count:
      readNestedNumber(params.inputs.providerResultIndex, ["provider_query_count"]) ?? 0,
    cached_provider_count: providerNames.length,
    error_count: providerErrors.length,
    auth_error_count: errorClass.authError ? 1 : 0,
    rate_limit_count: errorClass.rateLimit ? 1 : 0,
    deferred_until:
      params.gaps.find((gap) => gap.deferred_until)?.deferred_until ?? null,
    provider_evidence_status:
      asString(params.inputs.providerEvidenceRunManifest?.status) ?? null,
    provider_evidence_snippet_candidate_count:
      readNestedNumber(params.inputs.providerEvidenceRunManifest, [
        "snippet_candidate_count",
      ]) ?? 0,
    provider_evidence_citation_candidate_count:
      readNestedNumber(params.inputs.providerEvidenceRunManifest, [
        "citation_candidate_count",
      ]) ?? 0,
  };
}

function buildRerunGatePlan(params: {
  generatedAt: string;
  projectId: string | null;
  status: CapabilityCompletionStatus;
  actions: CapabilityExecutionAction[];
}): CapabilityRerunGatePlanArtifact {
  const gates = params.actions
    .filter((action) => ["executed", "runnable"].includes(action.status))
    .map((action) => ({
      id: `rerun-${action.id}`,
      reason: action.reason,
      command: "node scripts/run-e2e-paper-generation.mjs --project-root <projectRoot> --lane <lane>",
      expected_artifacts: action.expected_artifacts,
    }));
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    status: params.status,
    gates,
  };
}

function buildStatusMarkdown(params: {
  artifacts: CapabilityCompletionArtifacts;
  gaps: CapabilityGapRecord[];
  actions: CapabilityExecutionAction[];
}): string {
  const openGaps = params.gaps.filter((gap) => gap.status !== "satisfied");
  const actionLines = params.actions.length
    ? params.actions.map((action) => {
        return `- ${action.status}: ${action.tool_action} (${action.reason})`;
      })
    : ["- none"];
  const gapLines = openGaps.length
    ? openGaps.map((gap) => {
        const suffix = gap.deferred_until ? `; deferred_until=${gap.deferred_until}` : "";
        return `- ${gap.status}/${gap.severity}: ${gap.capability}.${gap.code} - ${gap.summary}${suffix}`;
      })
    : ["- none"];
  return `# Capability Completion Status

- generated_at: ${params.artifacts.generated_at}
- project_id: ${params.artifacts.project_id ?? "unknown"}
- mode: ${params.artifacts.mode}
- trigger: ${params.artifacts.trigger}
- status: ${params.artifacts.status}
- open_gap_count: ${openGaps.length}
- runnable_action_count: ${params.artifacts.execution_plan.runnable_action_count}
- blocked_action_count: ${params.artifacts.execution_plan.blocked_action_count}
- deferred_action_count: ${params.artifacts.execution_plan.deferred_action_count}
- recommended_claim_strength_cap: ${params.artifacts.claim_cap_report.recommended_claim_strength_cap}

## Open Gaps

${gapLines.join("\n")}

## Execution Plan

${actionLines.join("\n")}

## Next Actions

${params.artifacts.run_receipt.next_actions.map((entry) => `- ${entry}`).join("\n")}
`;
}

async function executeSafeLocalActions(params: {
  projectRoot: string;
  generatedAt: string;
  actions: CapabilityExecutionAction[];
  execute: boolean;
}): Promise<CapabilityExecutionAction[]> {
  const executed: CapabilityExecutionAction[] = [];
  for (const action of params.actions) {
    if (!params.execute || action.status !== "runnable" || !action.existing_tool) {
      executed.push(action);
      continue;
    }
    if (action.tool_action === "run_literature_research_controller") {
      try {
        const controller = await materializeLiteratureResearchControllerArtifacts({
          projectRoot: params.projectRoot,
          generatedAt: params.generatedAt,
          trigger: "capability_completion_controller",
        });
        executed.push({
          ...action,
          status: "executed",
          result: {
            executed_local_materializer: true,
            controller_status: controller.status,
            controller_decision: controller.decision,
            coverage_score_100: controller.coverage_report.coverage_score_100,
          },
        });
      } catch (error) {
        executed.push({
          ...action,
          status: "failed",
          result: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      continue;
    }
    if (action.tool_action === "plan_citation_expansion") {
      executed.push({
        ...action,
        status: "executed",
        result: {
          executed_local_materializer: true,
          note: "Citation expansion is materialized by the literature controller artifact pass.",
        },
      });
      continue;
    }
    if (action.tool_action === "run_literature_provider_evidence") {
      try {
        const result = await runLiteratureProviderEvidence({
          projectRoot: params.projectRoot,
          generatedAt: params.generatedAt,
          trigger: "capability_completion_controller",
        });
        const status =
          result.manifest.status === "blocked_auth"
            ? "blocked"
            : result.manifest.status === "deferred"
              ? "deferred"
              : "executed";
        executed.push({
          ...action,
          status,
          result: {
            executed_local_materializer: true,
            provider_evidence_status: result.manifest.status,
            snippet_candidate_count: result.manifest.snippet_candidate_count,
            citation_candidate_count: result.manifest.citation_candidate_count,
            error_count: result.manifest.error_count,
            deferred_until: result.manifest.deferred_until,
          },
        });
      } catch (error) {
        executed.push({
          ...action,
          status: "failed",
          result: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      continue;
    }
    executed.push(action);
  }
  return executed;
}

function nextActionsFromGaps(gaps: CapabilityGapRecord[]): string[] {
  const actions = gaps
    .filter((gap) => gap.status !== "satisfied")
    .map((gap) => gap.next_action)
    .filter((entry) => entry !== "none");
  return uniqueStrings(actions.length > 0 ? actions : ["none"]);
}

async function writeRepairQueue(params: {
  path: string;
  generatedAt: string;
  projectId: string | null;
  gaps: CapabilityGapRecord[];
}): Promise<void> {
  const active = params.gaps.filter((gap) => gap.status !== "satisfied");
  const lines = active.map((gap) =>
    JSON.stringify({
      schema_version: 1,
      generated_at: params.generatedAt,
      project_id: params.projectId,
      gap_id: gap.id,
      capability: gap.capability,
      code: gap.code,
      status: gap.status,
      severity: gap.severity,
      summary: gap.summary,
      next_action: gap.next_action,
      source_artifacts: gap.source_artifacts,
      expected_artifacts: gap.expected_artifacts,
    })
  );
  await fs.mkdir(path.dirname(params.path), { recursive: true });
  await fs.writeFile(params.path, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
}

export async function materializeCapabilityCompletionControllerArtifacts(params: {
  projectRoot: string;
  generatedAt?: string | null;
  trigger?: string | null;
  mode?: CapabilityCompletionMode | string | null;
  scorecard?: unknown;
  executeRunnableActions?: boolean | null;
}): Promise<CapabilityCompletionArtifacts> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const trigger = params.trigger ?? "capability_completion_controller";
  const mode = (asString(params.mode) ?? "unknown") as CapabilityCompletionMode;
  const paths = buildCapabilityCompletionArtifactPaths(projectRoot);
  let inputs = await loadInputs({ projectRoot, scorecard: params.scorecard });
  const projectId =
    pickString(inputs.manifest, ["project_id", "projectId"]) ??
    readNestedString(inputs.scorecard, ["project", "project_id"]) ??
    path.basename(projectRoot);
  let gaps = detectGaps({
    projectRoot,
    projectId,
    generatedAt,
    inputs,
  });
  const plannedActions = gaps
    .map((gap) => buildAction(gap))
    .filter((action): action is CapabilityExecutionAction => Boolean(action));
  const actions = await executeSafeLocalActions({
    projectRoot,
    generatedAt,
    actions: plannedActions,
    execute: params.executeRunnableActions !== false,
  });
  if (
    actions.some(
      (action) =>
        action.result?.executed_local_materializer === true ||
        action.status === "blocked" ||
        action.status === "deferred"
    )
  ) {
    inputs = await loadInputs({ projectRoot, scorecard: params.scorecard });
    gaps = detectGaps({
      projectRoot,
      projectId,
      generatedAt,
      inputs,
    });
  }
  const status = completionStatusFromGaps(gaps);
  const effectiveStatus = actions.some((action) => action.status === "failed")
    ? "failed"
    : status;
  const openGaps = gaps.filter((gap) => gap.status !== "satisfied");
  const nextActions = nextActionsFromGaps(gaps);
  const currentClaimCap =
    readNestedString(inputs.scorecard, ["verdict", "claim_strength_cap"]) ?? null;
  const claimCap = recommendedClaimCap({
    current: currentClaimCap,
    gaps,
  });
  const claimCapReport: CapabilityClaimCapReportArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    status: effectiveStatus,
    current_claim_strength_cap: currentClaimCap,
    recommended_claim_strength_cap: claimCap.cap,
    reasons: claimCap.reasons,
    evidence_chain_eligible: !gaps.some(
      (gap) => gap.capability === "evidence_chain" && gap.status !== "satisfied"
    ),
    dataset_backed_claim_eligible: !gaps.some(
      (gap) =>
        gap.capability === "evaluator" &&
        gap.status !== "satisfied" &&
        gap.code === "dataset_backed_evaluator_missing"
    ),
    venue_competitive_claim_eligible: !gaps.some(
      (gap) =>
        gap.capability === "evaluator" &&
        gap.status !== "satisfied" &&
        gap.code === "venue_reviewer_calibration_missing"
    ),
  };
  const gapInventory: CapabilityGapInventoryArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    mode,
    trigger,
    priority_order: PRIORITY_ORDER,
    status: effectiveStatus,
    open_gap_count: openGaps.length,
    runnable_gap_count: gaps.filter((gap) => gap.status === "runnable").length,
    blocked_gap_count: gaps.filter((gap) => gap.status === "blocked").length,
    deferred_gap_count: gaps.filter((gap) => gap.status === "deferred").length,
    degraded_gap_count: gaps.filter((gap) => gap.status === "degraded").length,
    gaps,
  };
  const executionPlan: CapabilityExecutionPlanArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    status: effectiveStatus,
    runnable_action_count: actions.filter((action) => action.status === "runnable").length,
    planned_action_count: actions.filter((action) => action.status === "planned").length,
    blocked_action_count: actions.filter((action) => action.status === "blocked").length,
    deferred_action_count: actions.filter((action) => action.status === "deferred").length,
    actions,
  };
  const providerCacheManifest = buildProviderCacheManifest({
    generatedAt,
    projectId,
    projectRoot,
    inputs,
    gaps,
  });
  const rerunGatePlan = buildRerunGatePlan({
    generatedAt,
    projectId,
    status: effectiveStatus,
    actions,
  });
  const runReceipt: CapabilityRunReceiptArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    mode,
    trigger,
    status: effectiveStatus,
    executed: actions.some((action) => action.status === "executed"),
    executed_action_count: actions.filter((action) => action.status === "executed").length,
    failed_action_count: actions.filter((action) => action.status === "failed").length,
    skipped_action_count: actions.filter((action) => action.status === "skipped").length,
    terminal_reason:
      effectiveStatus === "completed"
        ? "all_capabilities_satisfied"
        : effectiveStatus === "blocked"
          ? "critical_capability_blocked"
          : effectiveStatus === "failed"
            ? "local_capability_action_failed"
            : "open_capability_gaps_require_follow_up",
    next_actions: nextActions,
    artifact_paths: paths,
  };
  const artifacts: CapabilityCompletionArtifacts = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    mode,
    trigger,
    status: effectiveStatus,
    gap_inventory: gapInventory,
    execution_plan: executionPlan,
    run_receipt: runReceipt,
    claim_cap_report: claimCapReport,
    provider_cache_manifest: providerCacheManifest,
    rerun_gate_plan: rerunGatePlan,
    artifact_paths: paths,
    relative_artifact_paths: relativePaths(projectRoot, paths),
  };

  await Promise.all([
    writeJsonEnsured(paths.gap_inventory_path, gapInventory),
    writeJsonEnsured(paths.execution_plan_path, executionPlan),
    writeJsonEnsured(paths.run_receipt_path, runReceipt),
    writeJsonEnsured(paths.claim_cap_report_path, claimCapReport),
    writeJsonEnsured(paths.provider_cache_manifest_path, providerCacheManifest),
    writeJsonEnsured(paths.rerun_gate_plan_path, rerunGatePlan),
    writeRepairQueue({
      path: paths.repair_queue_path,
      generatedAt,
      projectId,
      gaps,
    }),
  ]);
  await writeTextEnsured(
    paths.status_markdown_path,
    buildStatusMarkdown({ artifacts, gaps, actions })
  );
  await fs.mkdir(path.dirname(paths.trace_path), { recursive: true });
  await fs.appendFile(
    paths.trace_path,
    `${JSON.stringify({
      schema_version: 1,
      generated_at: generatedAt,
      project_id: projectId,
      trigger,
      mode,
      status: effectiveStatus,
      open_gap_count: openGaps.length,
      action_count: actions.length,
      executed_action_count: runReceipt.executed_action_count,
      blocked_action_count: executionPlan.blocked_action_count,
      deferred_action_count: executionPlan.deferred_action_count,
      recommended_claim_strength_cap: claimCapReport.recommended_claim_strength_cap,
    })}\n`,
    "utf8"
  );
  return artifacts;
}
