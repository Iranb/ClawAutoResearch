import path from "node:path";
import { asRecord, asString, pickNumber, pickString, uniqueStrings } from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeIdeationContractState } from "../workflow-guard-state/ideation-contract";
import {
  serializeIdeationContractState,
  serializeIdeationGraphIndicesState,
} from "../workflow-guard-state/ideation-contract";
import {
  normalizePaperIngestionQueuedRequest,
  normalizePaperIngestionState,
  serializePaperIngestionQueuedRequest,
  serializePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import { buildIdeaCatalystCandidatePool } from "./candidate-pool";
import { buildIdeaCatalystDecompositionPacket } from "./decomposer";
import { buildIdeaCatalystGateDecision } from "./gatekeeper";
import { buildIdeaCatalystIdeaFragments } from "./integrator";
import { buildIdeaCatalystRankedFragments } from "./judge";
import type { PairwiseJudgment } from "./llm-judge";
import { parseGeneratedQuestions } from "./llm-question-generator";
import { parseSufficiencyJudgment } from "./llm-sufficiency";
import {
  assessIdeaCatalystProgress,
  buildCatalystIterationRecord,
  deriveRefinedChallengeClusters,
} from "./metacognition";
import {
  DEFAULT_IDEA_CATALYST_PATHS,
  getIdeaCatalystValidationErrors,
  normalizeIdeaCatalystState,
  serializeIdeaCatalystState,
} from "./state";
import { deriveIdeaCatalystScoutReport } from "./scout-adapter";
import { buildIdeaCatalystTournament } from "./tournament";
import { buildIdeaCatalystAbstractionPacket } from "./translator";

const PAPER_NEXUS_IDEA_CATALYST_BUNDLE_PATH =
  "researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json";
const PAPER_SOURCE_INDEX_PATH = "researcher/PAPER_SOURCE_INDEX.json";
const CANDIDATE_POOL_PATH = "researcher/idea-catalyst/CANDIDATE_POOL.json";
const LIVE_DISCOVERY_READ_MODEL_PATH =
  "researcher/idea-catalyst/LIVE_DISCOVERY_READ_MODEL.json";
const LIVE_PACKET_BUNDLE_PATH =
  "researcher/idea-catalyst/live_packet_bundle.json";
const LIVE_DISCOVERY_EVIDENCE_CARDS_PATH =
  "researcher/idea-catalyst/LIVE_DISCOVERY_EVIDENCE_CARDS.json";
const LIVE_DISCOVERY_RUN_MANIFEST_PATH =
  "researcher/idea-catalyst/LIVE_DISCOVERY_RUN_MANIFEST.json";
const CANDIDATE_SCORECARD_PATH =
  "researcher/idea-catalyst/CANDIDATE_SCORECARD.json";
const CANDIDATE_TOURNAMENT_PATH =
  "researcher/idea-catalyst/CANDIDATE_TOURNAMENT.json";
const SELECTED_IDEAS_PATH = "researcher/idea-catalyst/SELECTED_IDEAS.json";
const REJECTED_IDEAS_PATH = "researcher/idea-catalyst/REJECTED_IDEAS.json";
const REQUISITION_RETIREMENT_REPORT_PATH =
  "researcher/idea-catalyst/REQUISITION_RETIREMENT_REPORT.json";

type LegacyIdeaCatalystCandidate = {
  direction_id?: string | null;
  track_id?: string | null;
  title?: string | null;
  summary?: string | null;
  novelty?: number | null;
  feasibility?: number | null;
  relevance?: number | null;
  clarity?: number | null;
  composite_score?: number | null;
};

type IdeaCatalystRecoveryProfile = {
  kind: "eml_operator";
  selectedDirectionTitle: string;
  sourceDomains: string[];
  noveltyCandidateClusters: string[];
  challengeClusters: string[];
  insightClusters: string[];
  transferBridges: string[];
  occupiedSolutionZones: string[];
};

const EML_IDEA_CATALYST_PROFILE: IdeaCatalystRecoveryProfile = {
  kind: "eml_operator",
  selectedDirectionTitle:
    "EML residual and mixer blocks for small basemodel validation",
  sourceDomains: [
    "EML operator semantics and neural-cell mapping",
    "Numerical stability controls for exp/log primitives",
    "Same-parameter ResNet-like and CNN baselines",
    "Transformer and MLP-Mixer token-mixing baselines",
    "MNIST/Fashion-MNIST and toy text validation protocol",
  ],
  noveltyCandidateClusters: [
    "Safe EML residual block for compact basemodels",
    "EML channel or token mixer under matched parameter budgets",
  ],
  challengeClusters: [
    "The EML operator uses exp and log, so the neural block needs explicit overflow clipping and positive-y constraints.",
    "Same-parameter comparison must isolate the EML operator from width, depth, normalization, residual scaling, and training-budget confounds.",
    "MNIST-like image tasks can saturate, so finite-loss rate, calibration, activation statistics, and branch contribution must be tracked.",
    "Toy text or sequence validation should stay compact enough that the comparison is about the operator rather than model scale.",
  ],
  insightClusters: [
    "A residual EML branch can be tested as a guarded nonlinear interaction primitive.",
    "An EML mixer can replace part of an MLP/FFN interaction when y-domain and exp-range controls are part of the model contract.",
    "A useful basemodel claim requires source-backed operator definition, stability guardrails, and same-parameter baselines before scaling.",
  ],
  transferBridges: [
    "EML operator semantics and neural-cell mapping: translate eml(x,y)=exp(x)-ln(y) into a bounded neural interaction cell.",
    "Numerical stability controls for exp/log primitives: enforce softplus-positive y, exp-input clipping, finite-loss checks, and residual scaling.",
    "Same-parameter ResNet-like and CNN baselines: compare safe EML residual blocks against residual MLP/CNN blocks with matched trainable parameters.",
    "Transformer and MLP-Mixer token-mixing baselines: test EML channel/token mixers against compact FFN or mixer blocks of the same size.",
    "MNIST/Fashion-MNIST and toy text validation protocol: start with small image and sequence tasks, then report accuracy plus stability metrics.",
  ],
  occupiedSolutionZones: [
    "uncontrolled exp/log operator without finite-value guardrails",
    "larger EML model compared against smaller baseline",
    "MNIST-only accuracy claim without stability or branch-contribution ablations",
  ],
};

const EML_PAPER_DOMAIN_HINTS: Array<{
  domain: string;
  patterns: RegExp[];
  mechanism: string;
}> = [
  {
    domain: "EML operator semantics and neural-cell mapping",
    patterns: [/2603\.21852/i, /all elementary functions/i, /\beml\b/i],
    mechanism: "bounded EML interaction cell",
  },
  {
    domain: "Numerical stability controls for exp/log primitives",
    patterns: [/2603\.21852/i, /all elementary functions/i, /\beml\b/i],
    mechanism: "softplus-positive y and clipped exp input",
  },
  {
    domain: "Same-parameter ResNet-like and CNN baselines",
    patterns: [/1512\.03385/i, /deep residual learning/i, /\bresnet\b/i],
    mechanism: "residual baseline matching",
  },
  {
    domain: "Transformer and MLP-Mixer token-mixing baselines",
    patterns: [
      /1706\.03762/i,
      /attention is all you need/i,
      /2105\.01601/i,
      /mlp-mixer/i,
      /\btransformer\b/i,
    ],
    mechanism: "token and channel mixing baseline matching",
  },
  {
    domain: "MNIST/Fashion-MNIST and toy text validation protocol",
    patterns: [/1708\.07747/i, /fashion-mnist/i, /\bmnist\b/i],
    mechanism: "small-dataset validation protocol",
  },
];

function stableSearchText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasEmlSignal(value: unknown): boolean {
  return /\beml\b|2603\.21852|elementary functions from a single binary operator|eml\(x\s*,\s*y\)|exp\(x\).*ln\(y\)|ln\(y\).*exp\(x\)/i.test(
    stableSearchText(value)
  );
}

function hasFixMatchGcdDrift(value: unknown): boolean {
  return /fixmatch|generalized category discovery|\bgcd\b|pseudo-?label|known\/novel|novel-class|simgcd/i.test(
    stableSearchText(value)
  );
}

function inferIdeaCatalystRecoveryProfile(params: {
  manifest: Record<string, unknown>;
  topicSummary: Record<string, unknown> | null;
  paperSourceIndex: Record<string, unknown> | null;
}): IdeaCatalystRecoveryProfile | null {
  const profileMarker =
    pickString(params.topicSummary ?? {}, ["recovery_profile", "recoveryProfile"]) ??
    pickString(params.paperSourceIndex ?? {}, ["recovery_profile", "recoveryProfile"]);
  if (profileMarker === "eml_operator") {
    return EML_IDEA_CATALYST_PROFILE;
  }
  const topicText = [
    params.manifest.title,
    params.manifest.project_id,
    params.manifest.research_program,
    params.manifest.brainstorm_cycle,
    params.topicSummary,
    params.paperSourceIndex?.topic,
    params.paperSourceIndex?.papers,
  ]
    .map(stableSearchText)
    .join("\n");
  return hasEmlSignal(topicText) ? EML_IDEA_CATALYST_PROFILE : null;
}

function sourceBackedPapersFromIndex(
  paperSourceIndex: Record<string, unknown> | null
): Record<string, unknown>[] {
  const papers = Array.isArray(paperSourceIndex?.papers)
    ? paperSourceIndex?.papers
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  return papers.filter((paper) => {
    const status = pickString(paper, ["source_status", "sourceStatus", "status"])
      ?.trim()
      .toLowerCase();
    if (
      paper.metadata_only === true ||
      paper.metadataOnly === true ||
      paper.source_backed === false ||
      paper.sourceBacked === false ||
      status === "metadata_only" ||
      status === "metadata-only" ||
      status === "metadata"
    ) {
      return false;
    }
    const sourcePath = pickString(paper, [
      "source_path",
      "sourcePath",
      "pdf_path",
      "pdfPath",
      "local_path",
      "localPath",
      "staged_path",
      "stagedPath",
    ]);
    return Boolean(
      sourcePath || paper.source_backed === true || paper.sourceBacked === true
    );
  });
}

function hasSourceBackedEmlProfileEvidence(
  paperSourceIndex: Record<string, unknown> | null
): boolean {
  const papers = sourceBackedPapersFromIndex(paperSourceIndex);
  if (papers.length < 3) {
    return false;
  }
  const coveredHintCount = EML_PAPER_DOMAIN_HINTS.filter((hint) =>
    Boolean(findSourceBackedPaper(papers, hint.patterns))
  ).length;
  return hasEmlSignal(papers) && coveredHintCount >= 3;
}

function hasCanonicalEmlSourceDomainCoverage(value: unknown): boolean {
  const haystack = stableSearchText(value).toLowerCase();
  return (
    EML_IDEA_CATALYST_PROFILE.sourceDomains.filter((domain) =>
      haystack.includes(domain.toLowerCase())
    ).length >= 3
  );
}

function isActionableInvestigationRequisition(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  if (record.actionable === false) {
    return false;
  }
  const status = pickString(record, ["status"])?.trim().toLowerCase();
  return (
    record.actionable === true ||
    ["pending", "queued", "running", "requisition"].includes(status ?? "") ||
    (Array.isArray(record.missing_domains) && record.missing_domains.length > 0)
  );
}

function findSourceBackedPaper(
  papers: Record<string, unknown>[],
  patterns: RegExp[]
): Record<string, unknown> | null {
  return (
    papers.find((paper) => patterns.some((pattern) => pattern.test(stableSearchText(paper)))) ??
    null
  );
}

function sourceBackedPaperLabel(paper: Record<string, unknown> | null): string {
  return (
    pickString(paper ?? {}, ["canonical_id", "canonicalId"]) ??
    pickString(paper ?? {}, ["title"]) ??
    "source-backed-paper"
  );
}

function sourceBackedPaperPath(paper: Record<string, unknown> | null): string | null {
  return (
    pickString(paper ?? {}, ["source_path", "sourcePath"]) ??
    pickString(paper ?? {}, ["pdf_path", "pdfPath"]) ??
    pickString(paper ?? {}, ["local_path", "localPath"]) ??
    pickString(paper ?? {}, ["staged_path", "stagedPath"]) ??
    null
  );
}

function buildEmlIdeaCatalystGraphPacket(params: {
  profile: IdeaCatalystRecoveryProfile;
  paperSourceIndex: Record<string, unknown> | null;
  selectedTrackId: string | null;
}): Record<string, unknown> {
  const sourceBackedPapers = sourceBackedPapersFromIndex(params.paperSourceIndex);
  const sourceDomainAnalyses = EML_PAPER_DOMAIN_HINTS.map((hint, index) => {
    const paper = findSourceBackedPaper(sourceBackedPapers, hint.patterns);
    const paperLabel = sourceBackedPaperLabel(paper);
    const paperPath = sourceBackedPaperPath(paper);
    const hasSource = Boolean(paper);
    const bridgeId = `eml-bridge-${index + 1}`;
    const sourceSpans = hasSource
      ? [
          {
            span_id: `${bridgeId}-source`,
            paper_id: paperLabel,
            source_path: paperPath,
            source_type: paperPath ? "source_pdf" : "source_backed_index_entry",
            source_span_available: false,
            explicit_or_inferred: "source_backed_paper_index",
          },
        ]
      : [];
    const evidenceRefs = hasSource
      ? [
          {
            ref_id: `${bridgeId}-evidence`,
            paper_id: paperLabel,
            source_path: paperPath,
          },
        ]
      : [];
    return {
      source_domain: hint.domain,
      domain_rationale: `${hint.domain} is required to keep the EML basemodel idea grounded in source-backed operator, baseline, and validation evidence.`,
      shared_mechanisms: [hint.mechanism],
      supporting_papers: hasSource ? [paperLabel] : [],
      takeaways: [
        {
          concept: hint.mechanism,
          mechanism: hint.mechanism,
          kg_node_id: bridgeId,
          source_domain_formulation: `${hint.domain} constrains the EML small-basemodel design.`,
          mechanism_explanation: `${hint.mechanism} connects the source-backed EML literature set to the compact image/text validation plan.`,
          relevance_to_challenge:
            params.profile.challengeClusters[index % params.profile.challengeClusters.length],
          selection_rationale:
            hasSource
              ? `Selected because ${paperLabel} is present as source-backed project evidence.`
              : "Selected as an EML-specific evidence gap because no source-backed paper was indexed for this domain yet.",
          supporting_papers: hasSource ? [paperLabel] : [],
          source_spans: sourceSpans,
          evidence_chain_refs: evidenceRefs,
          bridge_path_ids: hasSource ? [bridgeId] : [],
          path_trace: hasSource
            ? [{ from: hint.domain, to: "Computer Science", via: paperLabel }]
            : [],
          path_completeness: hasSource ? 0.82 : 0.2,
          evidence_density: hasSource ? 0.72 : 0,
          mechanism_support_density: hasSource ? 0.7 : 0.35,
          evidence_tier: hasSource ? "strong" : "weak",
        },
      ],
      domain_distance: Number((0.62 + index * 0.04).toFixed(2)),
      path_completeness: hasSource ? 0.82 : 0.2,
      evidence_density: hasSource ? 0.72 : 0,
      mechanism_support_density: hasSource ? 0.7 : 0.35,
      evidence_tier: hasSource ? "strong" : "weak",
      selection_rationale:
        hasSource
          ? `Source-backed EML profile evidence is present for ${hint.domain}.`
          : `EML profile still needs source-backed evidence for ${hint.domain}.`,
    };
  });
  const bridgePaths = sourceDomainAnalyses.map((analysis, index) => {
    const takeaway = asRecord(Array.isArray(analysis.takeaways) ? analysis.takeaways[0] : null) ?? {};
    return {
      path_id: `eml-bridge-${index + 1}`,
      source_domain: analysis.source_domain,
      candidate_node_name: pickString(takeaway, ["concept"]) ?? "EML evidence bridge",
      mechanism: pickString(takeaway, ["mechanism"]) ?? "EML evidence bridge",
      matched_challenges: [
        params.profile.challengeClusters[index % params.profile.challengeClusters.length],
      ],
      bridge_path_ids: Array.isArray(takeaway.bridge_path_ids)
        ? takeaway.bridge_path_ids
        : [],
      evidence_refs: takeaway.evidence_chain_refs ?? [],
      source_spans: takeaway.source_spans ?? [],
      path_trace: takeaway.path_trace ?? [],
      path_completeness: takeaway.path_completeness,
      evidence_density: takeaway.evidence_density,
      mechanism_support_density: takeaway.mechanism_support_density,
      combined_score: analysis.evidence_density ? 0.82 : 0.42,
    };
  });
  return {
    status: "ready",
    recovery_profile: params.profile.kind,
    selected_track_id: params.selectedTrackId,
    target_domain: "Computer Science",
    selected_direction_title: params.profile.selectedDirectionTitle,
    challenge_clusters: params.profile.challengeClusters,
    insight_clusters: params.profile.insightClusters,
    occupied_solution_zones: params.profile.occupiedSolutionZones,
    candidate_domains: params.profile.sourceDomains,
    selected_domains: sourceDomainAnalyses
      .filter((entry) => Number(entry.evidence_density ?? 0) > 0)
      .map((entry) => entry.source_domain),
    transfer_bridges: params.profile.transferBridges,
    bridge_retrieval: {
      candidate_bridge_paths: bridgePaths,
    },
    source_domain_analyses: sourceDomainAnalyses,
    idea_fragments: [
      {
        candidate_id: "eml-safe-residual-block",
        source_domain: "EML operator semantics and neural-cell mapping",
        frontier_type: "operator_transfer",
        transferred_mechanism: "bounded EML residual interaction",
        title: "Safe EML residual block",
        idea_fragment: {
          title: "Safe EML residual block",
          core_insight:
            "Wrap eml(x,y)=exp(x)-ln(y) in positive-y, clipping, normalization, and residual scaling before comparing against same-parameter residual baselines.",
          integration_mechanism: "bounded EML residual interaction",
          challenge_resolution:
            "Turns the EML operator into a falsifiable small-basemodel component with explicit numerical guardrails.",
          concrete_realization:
            "Train compact EML residual blocks beside same-parameter CNN/MLP residual blocks on MNIST-like data.",
        },
        bridge_path_ids: ["eml-bridge-1", "eml-bridge-2", "eml-bridge-3"],
        evidence_refs: bridgePaths.flatMap((entry) => objectList(entry.evidence_refs)),
        source_spans: bridgePaths.flatMap((entry) => objectList(entry.source_spans)),
        path_completeness: 0.82,
        evidence_density: 0.72,
        mechanism_support_density: 0.7,
        evidence_tier: "strong",
      },
      {
        candidate_id: "eml-token-mixer-block",
        source_domain: "Transformer and MLP-Mixer token-mixing baselines",
        frontier_type: "composition",
        transferred_mechanism: "EML channel or token mixer",
        title: "EML mixer block",
        idea_fragment: {
          title: "EML mixer block",
          core_insight:
            "Use a guarded EML interaction as a compact channel/token mixer and compare it against same-size FFN, Transformer, or MLP-Mixer blocks.",
          integration_mechanism: "EML channel or token mixer",
          challenge_resolution:
            "Tests whether EML contributes beyond standard token/channel mixing under matched parameter counts.",
          concrete_realization:
            "Run small image and toy sequence tasks with finite-value checks and branch-contribution ablations.",
        },
        bridge_path_ids: ["eml-bridge-4", "eml-bridge-5"],
        evidence_refs: bridgePaths.flatMap((entry) => objectList(entry.evidence_refs)),
        source_spans: bridgePaths.flatMap((entry) => objectList(entry.source_spans)),
        path_completeness: 0.8,
        evidence_density: 0.7,
        mechanism_support_density: 0.68,
        evidence_tier: "strong",
      },
    ],
  };
}

function buildProfileGraphIndices(
  profile: IdeaCatalystRecoveryProfile,
  current: ReturnType<typeof normalizeIdeationContractState>["graphIdeationIndices"]
) {
  return {
    ...current,
    status: "ready",
    noveltyCandidateClusters: profile.noveltyCandidateClusters,
    challengeClusters: profile.challengeClusters,
    insightClusters: profile.insightClusters,
    occupiedSolutionZones: profile.occupiedSolutionZones,
    transferBridges: profile.transferBridges,
    candidateSourceDomains: profile.sourceDomains,
    selectedSourceDomains: [],
    prunedSourceDomains: [],
  };
}

function buildSupersededProfileRequisition(params: {
  profile: IdeaCatalystRecoveryProfile;
  targetDomain: string;
  trigger: string | null | undefined;
}) {
  return {
    schema_version: 1,
    status: "not_required",
    actionable: false,
    requisition_id: `${params.profile.kind}-profile-requisition-not-required`,
    target_domain: params.targetDomain,
    missing_domains: [],
    missing_evidence_types: [],
    search_queries: [],
    coverage_gap_questions: [],
    required_stage_reentry: [],
    non_actionable_reason:
      "Source-backed EML profile evidence is available; the prior IDEA-CATALYST requisition was retired.",
    trigger: params.trigger ?? "idea_catalyst",
    retired_at: nowIso(),
  };
}

function sanitizeRequisitionIdFragment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function buildIdeaCatalystRequisitionRequestId(
  requisitionId: string | null | undefined
): string | null {
  if (!requisitionId) {
    return null;
  }
  return `idea-catalyst-${sanitizeRequisitionIdFragment(requisitionId)}`;
}

function isTerminalIdeaCatalystRequisitionSatisfactionStatus(value: unknown): boolean {
  const status = String(value ?? "").trim().toLowerCase();
  return status === "valid" || status === "warning";
}

function isSatisfiedIdeaCatalystRequisitionStatus(value: unknown): boolean {
  const status = String(value ?? "").trim().toLowerCase();
  return (
    status === "satisfied" ||
    status === "completed" ||
    status === "not_required" ||
    status === "not-required" ||
    status === "degraded_satisfied_current_graph" ||
    status === "degraded-satisfied-current-graph" ||
    status.startsWith("satisfied_") ||
    status.startsWith("satisfied-")
  );
}

function isCurrentGraphSatisfactionStatus(value: unknown): boolean {
  const status = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return (
    status === "degraded_satisfied_current_graph" ||
    status === "satisfied_bounded_with_import_blocker" ||
    status === "workflow_state_satisfied" ||
    status === "satisfied_by_verified_graph_import"
  );
}

function hasExplicitCurrentGraphSatisfactionEvidence(
  report: Record<string, unknown>
): boolean {
  const selectedPaperCount =
    pickNumber(report, ["selected_paper_count", "selectedPaperCount"]) ?? 0;
  const candidatePaperCount =
    pickNumber(report, ["candidate_paper_count", "candidatePaperCount"]) ?? 0;
  const remediation = asRecord(report.remediation_pass ?? report.remediationPass);
  const remediationAcceptsCurrentGraph =
    remediation?.graph_ready === true &&
    remediation?.can_proceed_with_existing_graph === true;
  return (
    report.evidence_gap_closed === true ||
    report.evidenceGapClosed === true ||
    selectedPaperCount > 0 ||
    candidatePaperCount > 0 ||
    remediationAcceptsCurrentGraph
  );
}

function isAcceptedIdeaCatalystSatisfactionReport(value: unknown): boolean {
  const report = asRecord(value);
  if (!report) {
    return false;
  }
  const status = pickString(report, ["status"])?.trim().toLowerCase();
  const decision = pickString(report, ["decision", "satisfaction_decision", "satisfactionDecision"])
    ?.trim()
    .toLowerCase();
  if (
    (isCurrentGraphSatisfactionStatus(status) ||
      isCurrentGraphSatisfactionStatus(decision)) &&
    !hasExplicitCurrentGraphSatisfactionEvidence(report)
  ) {
    return false;
  }
  if (
    status === "valid" ||
    status === "warning" ||
    isSatisfiedIdeaCatalystRequisitionStatus(status)
  ) {
    return true;
  }
  return (
    decision === "degraded_satisfied_current_graph" ||
    decision === "degraded-satisfied-current-graph" ||
    isSatisfiedIdeaCatalystRequisitionStatus(decision)
  );
}

function buildIdeaCatalystSatisfactionReportPath(
  requisitionId: string | null | undefined
): string | null {
  if (!requisitionId) {
    return null;
  }
  return path.join(
    "researcher",
    "idea-catalyst",
    "requisition",
    sanitizeRequisitionIdFragment(requisitionId),
    "REQUISITION_SATISFACTION_REPORT.json"
  );
}

function collectIdeaCatalystSatisfactionReportCandidates(params: {
  manifest: Record<string, unknown>;
  requisitionId: string | null;
  existingInvestigationRequisition: Record<string, unknown> | null;
  existingReportPath: string | null;
}): string[] {
  const ideaCatalyst = asRecord(params.manifest.idea_catalyst);
  const manifestReportPath = pickString(ideaCatalyst ?? {}, [
    "validation_report_path",
    "validationReportPath",
    "satisfaction_report_path",
    "satisfactionReportPath",
  ]);
  const manifestRequisitionCycle = pickString(ideaCatalyst ?? {}, [
    "last_requisition_cycle",
    "lastRequisitionCycle",
  ]);
  const currentRequisitionId = pickString(
    params.existingInvestigationRequisition ?? {},
    ["requisition_id", "requisitionId", "id"]
  );
  const requisitionIds = uniqueStrings(
    [
      params.requisitionId,
      currentRequisitionId,
      manifestRequisitionCycle,
    ].filter((entry): entry is string => Boolean(entry))
  );
  return uniqueStrings(
    [
      params.existingReportPath,
      manifestReportPath,
      ...requisitionIds.map((entry) =>
        buildIdeaCatalystSatisfactionReportPath(entry)
      ),
    ].filter((entry): entry is string => Boolean(entry))
  );
}

async function readAcceptedIdeaCatalystSatisfactionReport(params: {
  projectRoot: string;
  reportPath: string;
}): Promise<Record<string, unknown> | null> {
  const resolved = resolveProjectArtifactPath(params.projectRoot, params.reportPath);
  const report = await readJsonIfExists<Record<string, unknown>>(resolved ?? "");
  return isAcceptedIdeaCatalystSatisfactionReport(report) ? report : null;
}

async function readIdeaCatalystRequisitionSatisfaction(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  requisitionId: string | null;
  existingInvestigationRequisition: Record<string, unknown> | null;
}): Promise<{
  satisfied: boolean;
  reportBacked: boolean;
  requestId: string | null;
  validationReportPath: string | null;
  validationStatus: string | null;
  validationSummary: string | null;
}> {
  const existingStatus = pickString(params.existingInvestigationRequisition ?? {}, [
    "status",
    "requisition_status",
    "requisitionStatus",
  ])?.trim().toLowerCase();
  const existingReportPath = pickString(params.existingInvestigationRequisition ?? {}, [
    "validation_report_path",
    "validationReportPath",
    "satisfaction_report_path",
    "satisfactionReportPath",
  ]);
  if (isSatisfiedIdeaCatalystRequisitionStatus(existingStatus)) {
    if (existingReportPath) {
      const report = await readAcceptedIdeaCatalystSatisfactionReport({
        projectRoot: params.projectRoot,
        reportPath: existingReportPath,
      });
      if (!report) {
        return {
          satisfied: false,
          reportBacked: false,
          requestId: buildIdeaCatalystRequisitionRequestId(params.requisitionId),
          validationReportPath: existingReportPath,
          validationStatus: existingStatus ?? null,
          validationSummary:
            "IDEA-CATALYST requisition satisfaction report does not contain request-specific source-backed coverage evidence.",
        };
      }
      return {
        satisfied: true,
        reportBacked: true,
        requestId:
          pickString(report, ["request_id", "requestId"]) ??
          buildIdeaCatalystRequisitionRequestId(params.requisitionId),
        validationReportPath: existingReportPath,
        validationStatus:
          pickString(report, ["status"]) ??
          pickString(report, ["decision", "satisfaction_decision", "satisfactionDecision"]) ??
          existingStatus ??
          null,
        validationSummary:
          pickString(report, ["reason", "summary"]) ??
          pickString(report, ["validation_summary", "validationSummary"]) ??
          null,
      };
    }
    if (isCurrentGraphSatisfactionStatus(existingStatus)) {
      return {
        satisfied: false,
        reportBacked: false,
        requestId: buildIdeaCatalystRequisitionRequestId(params.requisitionId),
        validationReportPath: null,
        validationStatus: existingStatus ?? null,
        validationSummary:
          "IDEA-CATALYST current-graph satisfaction requires an explicit validation report.",
      };
    }
    return {
      satisfied: true,
      reportBacked: false,
      requestId: buildIdeaCatalystRequisitionRequestId(params.requisitionId),
      validationReportPath: existingReportPath ?? null,
      validationStatus: existingStatus ?? null,
      validationSummary:
        pickString(params.existingInvestigationRequisition ?? {}, [
          "validation_summary",
          "validationSummary",
          "satisfaction_summary",
          "satisfactionSummary",
      ]) ?? null,
    };
  }

  const reportCandidates = collectIdeaCatalystSatisfactionReportCandidates({
    manifest: params.manifest,
    requisitionId: params.requisitionId,
    existingInvestigationRequisition: params.existingInvestigationRequisition,
    existingReportPath: existingReportPath ?? null,
  });
  for (const reportCandidate of reportCandidates) {
    const report = await readAcceptedIdeaCatalystSatisfactionReport({
      projectRoot: params.projectRoot,
      reportPath: reportCandidate,
    });
    if (!report) {
      continue;
    }
    return {
      satisfied: true,
      reportBacked: true,
      requestId:
        pickString(report, ["request_id", "requestId"]) ??
        buildIdeaCatalystRequisitionRequestId(params.requisitionId),
      validationReportPath: reportCandidate,
      validationStatus:
        pickString(report, ["status"]) ??
        pickString(report, ["decision", "satisfaction_decision", "satisfactionDecision"]) ??
        null,
      validationSummary:
        pickString(report, ["reason", "summary"]) ??
        pickString(report, ["validation_summary", "validationSummary"]) ??
        null,
    };
  }

  const expectedRequestId = buildIdeaCatalystRequisitionRequestId(params.requisitionId);
  const expectedFragment = params.requisitionId
    ? sanitizeRequisitionIdFragment(params.requisitionId)
    : null;
  const paperIngestion = normalizePaperIngestionState(params.manifest.paper_ingestion);
  for (const request of paperIngestion.queuedRequests) {
    if (request.triggerKind !== "idea_catalyst_requisition") {
      continue;
    }
    if (String(request.status ?? "").trim().toLowerCase() !== "completed") {
      continue;
    }
    if (!isTerminalIdeaCatalystRequisitionSatisfactionStatus(request.validationStatus)) {
      continue;
    }
    const requestMatches =
      !expectedRequestId ||
      request.requestId === expectedRequestId ||
      (expectedFragment ? request.requestId.includes(expectedFragment) : false);
    if (!requestMatches) {
      continue;
    }
    if (!request.validationReportPath) {
      continue;
    }
    const reportPath = resolveProjectArtifactPath(
      params.projectRoot,
      request.validationReportPath
    );
    const report = await readJsonIfExists<Record<string, unknown>>(reportPath ?? "");
    if (!isAcceptedIdeaCatalystSatisfactionReport(report)) {
      continue;
    }
    return {
      satisfied: true,
      reportBacked: true,
      requestId: request.requestId,
      validationReportPath: request.validationReportPath,
      validationStatus: request.validationStatus ?? null,
      validationSummary: request.validationSummary ?? null,
    };
  }

  return {
    satisfied: false,
    reportBacked: false,
    requestId: expectedRequestId,
    validationReportPath: null,
    validationStatus: null,
    validationSummary: null,
  };
}

function buildDegradedSatisfiedRequisition(params: {
  requisition: Record<string, unknown>;
  trigger: string | null | undefined;
  requestId: string | null;
  validationReportPath: string | null;
  validationStatus: string | null;
  validationSummary: string | null;
  materializedAt: string;
}) {
  return {
    ...params.requisition,
    status: "completed",
    actionable: false,
    satisfaction_decision: "degraded_satisfied_current_graph",
    request_id: params.requestId,
    validation_status: params.validationStatus,
    validation_summary:
      params.validationSummary ??
      "IDEA-CATALYST requisition was degradably satisfied by the current ready graph.",
    validation_report_path: params.validationReportPath,
    trigger: params.trigger ?? "idea_catalyst",
    completed_at: params.materializedAt,
    updated_at: params.materializedAt,
  };
}

function markdownBulletsToList(rawText: unknown): string[] {
  return String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function isActiveIdeaCatalystQueuedRequestStatus(value: unknown): boolean {
  return ["queued", "launching", "running", "needs_repair"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function retireActiveIdeaCatalystRequisitionQueuedRequests(params: {
  paperIngestion: unknown;
  updatedAt: string;
  detail: string;
  validationReportPath: string;
  validationSummary: string;
}) {
  const paperIngestion = normalizePaperIngestionState(params.paperIngestion);
  let retiredCount = 0;
  const retiredRequestIds: string[] = [];
  const queuedRequests = paperIngestion.queuedRequests.map((entry) => {
    if (
      entry.triggerKind !== "idea_catalyst_requisition" ||
      !isActiveIdeaCatalystQueuedRequestStatus(entry.status)
    ) {
      return entry;
    }
    retiredCount += 1;
    retiredRequestIds.push(entry.requestId);
    return (
      normalizePaperIngestionQueuedRequest({
        ...serializePaperIngestionQueuedRequest(entry),
        status: "completed",
        updated_at: params.updatedAt,
        finished_at: params.updatedAt,
        last_error: null,
        detail: params.detail,
        validation_status: "valid",
        validation_summary: params.validationSummary,
        validation_report_path: params.validationReportPath,
      }) ?? entry
    );
  });
  if (retiredCount === 0) {
    return { retiredCount, retiredRequestIds, paperIngestion };
  }
  return {
    retiredCount,
    retiredRequestIds,
    paperIngestion: {
      ...paperIngestion,
      queuedRequests,
      lastUpdatedAt: params.updatedAt,
    },
  };
}

function normalizePairwiseVote(value: unknown): "a" | "b" | "tie" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "a") return "a";
  if (normalized === "b") return "b";
  return "tie";
}

function normalizePairwiseJudgments(value: unknown): PairwiseJudgment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const dimensions = asRecord(entry.dimensions) ?? {};
      return {
        fragment_a:
          pickString(entry, ["fragment_a", "fragmentA"]) ?? "fragment-a",
        fragment_b:
          pickString(entry, ["fragment_b", "fragmentB"]) ?? "fragment-b",
        preferred: normalizePairwiseVote(entry.preferred),
        reasoning:
          pickString(entry, ["reasoning"]) ?? "No explicit LLM reasoning provided.",
        dimensions: {
          depth_of_integration: normalizePairwiseVote(
            dimensions.depth_of_integration ?? dimensions.depthOfIntegration
          ),
          multi_stage_disciplinary_engagement: normalizePairwiseVote(
            dimensions.multi_stage_disciplinary_engagement ??
              dimensions.multiStageDisciplinaryEngagement
          ),
          innovation_payoff: normalizePairwiseVote(
            dimensions.innovation_payoff ?? dimensions.innovationPayoff
          ),
          novelty_feasibility: normalizePairwiseVote(
            dimensions.novelty_feasibility ?? dimensions.noveltyFeasibility
          ),
        },
      };
    });
}

function unwrapPacketBundle(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return asRecord(record.packet_bundle) ?? asRecord(record.packetBundle) ?? record;
}

function objectList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return objectList(value)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function isLiveIdeaCatalystPacketBundle(value: Record<string, unknown> | null): boolean {
  if (!value) {
    return false;
  }
  const mode = pickString(value, ["mode"]);
  return (
    mode === "live_discovery" ||
    mode === "hybrid" ||
    Boolean(asRecord(value.live_retrieval ?? value.liveRetrieval)) ||
    booleanValue(
      asRecord(value.faithfulness_report ?? value.faithfulnessReport)
        ?.live_target_source_retrieval_loop
    ) === true
  );
}

function buildLiveDiscoveryEvidenceCards(packetBundle: Record<string, unknown>) {
  const sourceAnalyses = recordList(
    packetBundle.source_domain_analyses ?? packetBundle.sourceDomainAnalyses
  );
  return sourceAnalyses.map((analysis, index) => {
    const supportingPapers = recordList(
      analysis.supporting_papers ?? analysis.supportingPapers
    );
    const takeaways = recordList(analysis.takeaways);
    const snippetIds = supportingPapers.flatMap((paper) =>
      recordList(paper.snippets).map((snippet) =>
        pickString(snippet, ["snippet_id", "snippetId"])
      )
    );
    return {
      card_id: `live-source-domain-${index + 1}`,
      source_domain:
        pickString(analysis, ["source_domain", "sourceDomain"]) ??
        `source-domain-${index + 1}`,
      target_challenge_id: pickString(analysis, [
        "target_challenge_id",
        "targetChallengeId",
      ]),
      target_challenge: pickString(analysis, [
        "target_challenge",
        "targetChallenge",
      ]),
      accepted: booleanValue(analysis.accepted) === true,
      pruning_decision: pickString(analysis, [
        "pruning_decision",
        "pruningDecision",
      ]),
      retrieved_paper_count:
        pickNumber(analysis, ["retrieved_paper_count", "retrievedPaperCount"]) ?? 0,
      retrieved_snippet_count:
        pickNumber(analysis, [
          "retrieved_snippet_count",
          "retrievedSnippetCount",
        ]) ?? 0,
      relevant_paper_count:
        pickNumber(analysis, ["relevant_paper_count", "relevantPaperCount"]) ?? 0,
      relevance_ratio:
        pickNumber(analysis, ["relevance_ratio", "relevanceRatio"]) ?? null,
      evidence_ids: uniqueStrings([
        ...supportingPapers
          .map((paper) => pickString(paper, ["paper_key", "paperKey"]))
          .filter((entry): entry is string => Boolean(entry)),
        ...snippetIds.filter((entry): entry is string => Boolean(entry)),
        ...takeaways
          .map((takeaway) => pickString(takeaway, ["id"]))
          .filter((entry): entry is string => Boolean(entry)),
      ]),
      supporting_papers: supportingPapers.map((paper) => ({
        paper_key: pickString(paper, ["paper_key", "paperKey"]),
        title: pickString(paper, ["title"]),
        snippet_ids: recordList(paper.snippets)
          .map((snippet) => pickString(snippet, ["snippet_id", "snippetId"]))
          .filter((entry): entry is string => Boolean(entry)),
      })),
      takeaway_ids: takeaways
        .map((takeaway) => pickString(takeaway, ["id"]))
        .filter((entry): entry is string => Boolean(entry)),
    };
  });
}

function buildLiveIdeaCatalystReadModel(params: {
  packetBundle: Record<string, unknown> | null;
  materializedAt: string;
}) {
  const packetBundle = params.packetBundle;
  if (!isLiveIdeaCatalystPacketBundle(packetBundle)) {
    return null;
  }
  const liveRetrieval = asRecord(
    packetBundle?.live_retrieval ?? packetBundle?.liveRetrieval
  ) ?? {};
  const faithfulnessReport = asRecord(
    packetBundle?.faithfulness_report ?? packetBundle?.faithfulnessReport
  ) ?? {};
  const sourceAnalyses = recordList(
    packetBundle?.source_domain_analyses ?? packetBundle?.sourceDomainAnalyses
  );
  const evidenceCards = buildLiveDiscoveryEvidenceCards(packetBundle ?? {});
  const targetRetrievals = recordList(
    liveRetrieval.target_retrievals ?? liveRetrieval.targetRetrievals
  );
  const acceptedSourceDomainCount =
    pickNumber(liveRetrieval, [
      "accepted_source_domain_count",
      "acceptedSourceDomainCount",
    ]) ??
    sourceAnalyses.filter((entry) => booleanValue(entry.accepted) === true).length;
  const prunedSourceDomainCount =
    pickNumber(liveRetrieval, [
      "pruned_source_domain_count",
      "prunedSourceDomainCount",
    ]) ??
    sourceAnalyses.filter((entry) => booleanValue(entry.accepted) === false).length;
  const pairwiseRankingBackend =
    pickString(faithfulnessReport, [
      "pairwise_ranking_backend",
      "pairwiseRankingBackend",
    ]) ??
    pickString(liveRetrieval, ["pairwise_ranking_backend", "pairwiseRankingBackend"]);
  const degradedReasons: string[] = [];
  if (pairwiseRankingBackend && pairwiseRankingBackend !== "llm-pairwise-v1") {
    degradedReasons.push(
      `pairwise_ranking_backend=${pairwiseRankingBackend}`
    );
  }
  if (sourceAnalyses.length === 0) {
    degradedReasons.push("source_domain_analyses_empty");
  } else if (acceptedSourceDomainCount <= 0) {
    degradedReasons.push("all_source_domains_pruned");
  }
  if (targetRetrievals.length === 0) {
    degradedReasons.push("target_retrievals_empty");
  }
  const status = degradedReasons.length > 0 ? "degraded" : "ready";
  const targetPaperCount = targetRetrievals.reduce((sum, entry) => {
    return (
      sum +
      (pickNumber(entry, ["paperCount", "paper_count"]) ??
        pickNumber(entry, ["resultCount", "result_count"]) ??
        0)
    );
  }, 0);
  const sourceRetrievedPaperCount = evidenceCards.reduce(
    (sum, card) => sum + card.retrieved_paper_count,
    0
  );
  const sourceRetrievedSnippetCount = evidenceCards.reduce(
    (sum, card) => sum + card.retrieved_snippet_count,
    0
  );
  const evidenceIds = uniqueStrings(
    evidenceCards.flatMap((card) => card.evidence_ids)
  );
  const temporalCutoff = {
    year: pickString(liveRetrieval, ["year"]),
    publication_date_or_year: pickString(liveRetrieval, [
      "publication_date_or_year",
      "publicationDateOrYear",
    ]),
    inserted_before: pickString(liveRetrieval, [
      "inserted_before",
      "insertedBefore",
    ]),
    recorded: Boolean(
      pickString(liveRetrieval, ["year"]) ??
        pickString(liveRetrieval, [
          "publication_date_or_year",
          "publicationDateOrYear",
        ]) ??
        pickString(liveRetrieval, ["inserted_before", "insertedBefore"])
    ),
  };
  const leakagePolicy =
    "Live discovery snippets are ideation evidence only; source-backed graph proof is still required for claim-ready downstream writing.";
  const runManifest = {
    contract_version: "papernexus-live-idea-catalyst-run-manifest-v1",
    status,
    materialized_at: params.materializedAt,
    source_path: PAPER_NEXUS_IDEA_CATALYST_BUNDLE_PATH,
    mode: pickString(packetBundle ?? {}, ["mode"]) ?? "live_discovery",
    target_domain: pickString(packetBundle ?? {}, [
      "target_domain",
      "targetDomain",
    ]),
    target_field_of_study: pickString(packetBundle ?? {}, [
      "target_field_of_study",
      "targetFieldOfStudy",
    ]),
    retrieval_backend: pickString(liveRetrieval, [
      "retrieval_backend",
      "retrievalBackend",
    ]),
    target_retrieval_count: targetRetrievals.length,
    target_paper_count: targetPaperCount,
    accepted_source_domain_count: acceptedSourceDomainCount,
    pruned_source_domain_count: prunedSourceDomainCount,
    pairwise_ranking_backend: pairwiseRankingBackend ?? null,
    degraded_reasons: degradedReasons,
    temporal_cutoff: temporalCutoff,
    leakage_policy: leakagePolicy,
  };
  const evidenceCardArtifact = {
    contract_version: "papernexus-live-idea-catalyst-evidence-cards-v1",
    status,
    materialized_at: params.materializedAt,
    card_count: evidenceCards.length,
    cards: evidenceCards,
  };
  const readModel = {
    contract_version: "papernexus-live-idea-catalyst-read-model-v1",
    status,
    materialized_at: params.materializedAt,
    source_path: PAPER_NEXUS_IDEA_CATALYST_BUNDLE_PATH,
    live_packet_bundle_path: LIVE_PACKET_BUNDLE_PATH,
    run_manifest_path: LIVE_DISCOVERY_RUN_MANIFEST_PATH,
    evidence_cards_path: LIVE_DISCOVERY_EVIDENCE_CARDS_PATH,
    pairwise_ranking_backend: pairwiseRankingBackend ?? null,
    accepted_source_domain_count: acceptedSourceDomainCount,
    pruned_source_domain_count: prunedSourceDomainCount,
    source_domain_count: sourceAnalyses.length,
    source_retrieved_paper_count: sourceRetrievedPaperCount,
    source_retrieved_snippet_count: sourceRetrievedSnippetCount,
    target_retrieval_count: targetRetrievals.length,
    target_paper_count: targetPaperCount,
    target_retrievals: targetRetrievals.map((entry) => ({
      query: pickString(entry, ["query"]),
      paper_count:
        pickNumber(entry, ["paperCount", "paper_count"]) ??
        pickNumber(entry, ["resultCount", "result_count"]) ??
        0,
    })),
    source_domains: evidenceCards.map((card) => ({
      card_id: card.card_id,
      source_domain: card.source_domain,
      accepted: card.accepted,
      pruning_decision: card.pruning_decision,
      retrieved_paper_count: card.retrieved_paper_count,
      retrieved_snippet_count: card.retrieved_snippet_count,
      relevant_paper_count: card.relevant_paper_count,
      evidence_ids: card.evidence_ids,
    })),
    evidence_ids: evidenceIds,
    temporal_cutoff: temporalCutoff,
    leakage_policy: leakagePolicy,
    degraded_reasons: degradedReasons,
  };
  return {
    status,
    packetBundle,
    runManifest,
    evidenceCardArtifact,
    readModel,
    sessionProjection: {
      status,
      read_model_path: LIVE_DISCOVERY_READ_MODEL_PATH,
      live_packet_bundle_path: LIVE_PACKET_BUNDLE_PATH,
      run_manifest_path: LIVE_DISCOVERY_RUN_MANIFEST_PATH,
      evidence_cards_path: LIVE_DISCOVERY_EVIDENCE_CARDS_PATH,
      pairwise_ranking_backend: pairwiseRankingBackend ?? null,
      accepted_source_domain_count: acceptedSourceDomainCount,
      pruned_source_domain_count: prunedSourceDomainCount,
      target_retrieval_count: targetRetrievals.length,
      target_paper_count: targetPaperCount,
      degraded_reasons: degradedReasons,
    },
  };
}

function traceIdFromRecord(record: Record<string, unknown>, fallback: string) {
  return (
    pickString(record, [
      "ref_id",
      "refId",
      "span_id",
      "spanId",
      "node_id",
      "nodeId",
      "snippet_node_id",
      "snippetNodeId",
      "paper_id",
      "paperId",
    ]) ?? fallback
  );
}

function buildSelectedIdeaGraphEvidence(selectedIdea: Record<string, unknown>) {
  const candidateId =
    pickString(selectedIdea, ["candidate_id", "candidateId"]) ?? "selected-idea";
  const sourceDomain =
    pickString(selectedIdea, ["source_domain", "sourceDomain"]) ?? "source-domain";
  const mechanism =
    pickString(selectedIdea, [
      "transferred_mechanism",
      "transferredMechanism",
    ]) ?? "transferred-mechanism";
  const bridgePathIds = uniqueStrings(
    (Array.isArray(selectedIdea.bridge_path_ids)
      ? selectedIdea.bridge_path_ids
      : []
    ).map((entry) => String(entry ?? ""))
  );
  const evidenceRefs = objectList(
    selectedIdea.evidence_chain_refs ?? selectedIdea.evidenceChainRefs
  )
    .map((entry, index) => {
      const record = asRecord(entry) ?? {};
      return traceIdFromRecord(record, `evidence-ref-${index + 1}`);
    })
    .filter(Boolean);
  const sourceSpans = objectList(selectedIdea.source_spans ?? selectedIdea.sourceSpans)
    .map((entry, index) => {
      const record = asRecord(entry) ?? {};
      return traceIdFromRecord(record, `source-span-${index + 1}`);
    })
    .filter(Boolean);
  const linkedGraphNodes = uniqueStrings(
    objectList(selectedIdea.evidence_chain_refs ?? selectedIdea.evidenceChainRefs)
      .map((entry) => {
        const record = asRecord(entry) ?? {};
        return pickString(record, ["node_id", "nodeId", "snippet_node_id", "snippetNodeId"]);
      })
      .filter((entry): entry is string => Boolean(entry))
  );
  return {
    idea_id: candidateId,
    source_domain: sourceDomain,
    transferred_mechanism: mechanism,
    evidence_pointers: uniqueStrings([
      ...bridgePathIds.map((entry) => `paper_nexus:bridge_path:${entry}`),
      ...evidenceRefs.map((entry) => `paper_nexus:evidence_ref:${entry}`),
      ...sourceSpans.map((entry) => `paper_nexus:source_span:${entry}`),
    ]),
    linked_graph_nodes: linkedGraphNodes,
    relation_patterns: uniqueStrings([
      `paper_nexus_bridge:${sourceDomain}->${mechanism}`,
      ...bridgePathIds.map((entry) => `bridge_path:${entry}`),
    ]),
    bridge_path_ids: bridgePathIds,
    source_spans: selectedIdea.source_spans ?? [],
    evidence_chain_refs: selectedIdea.evidence_chain_refs ?? [],
    claim_cap: pickString(selectedIdea, ["claim_cap", "claimCap"]) ?? "hypothesis",
    baseline_reference:
      pickString(selectedIdea, ["baseline_to_compare", "baselineToCompare"]) ??
      null,
    primary_metric:
      pickString(selectedIdea, ["primary_metric", "primaryMetric"]) ?? null,
    falsifier_pilot:
      pickString(selectedIdea, ["falsifier_pilot", "falsifierPilot"]) ?? null,
  };
}

async function syncSelectedIdeaTraceToTrackRegistry(params: {
  projectRoot: string;
  selectedIdeasPacket: Record<string, unknown> | null;
  selectedTrackId: string | null;
}) {
  const selectedIdeas = Array.isArray(params.selectedIdeasPacket?.selected_ideas)
    ? params.selectedIdeasPacket?.selected_ideas
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const primaryIdea = selectedIdeas[0];
  if (!primaryIdea || !params.selectedTrackId) {
    return false;
  }
  const registryPath = path.join(params.projectRoot, "TRACK_REGISTRY.json");
  const registry = (await readJsonIfExists<Record<string, unknown>>(registryPath)) ?? null;
  const tracks = Array.isArray(registry?.tracks) ? registry?.tracks : [];
  let changed = false;
  const nextTracks = tracks.map((entry) => {
    const track = asRecord(entry) ?? {};
    const trackId = pickString(track, ["track_id", "trackId"]);
    if (trackId !== params.selectedTrackId) {
      return entry;
    }
    changed = true;
    const graphEvidence = buildSelectedIdeaGraphEvidence(primaryIdea);
    return {
      ...track,
      idea_id: graphEvidence.idea_id,
      source_domain: graphEvidence.source_domain,
      transferred_mechanism: graphEvidence.transferred_mechanism,
      baseline_reference: graphEvidence.baseline_reference,
      primary_metric: graphEvidence.primary_metric,
      falsifier_pilot: graphEvidence.falsifier_pilot,
      claim_cap: graphEvidence.claim_cap,
      graph_backed_innovation_evidence: graphEvidence,
      evidence_pointers: uniqueStrings([
        ...((Array.isArray(track.evidence_pointers)
          ? track.evidence_pointers
          : []
        ).map((value) => String(value ?? ""))),
        ...graphEvidence.evidence_pointers,
      ]),
      linked_graph_nodes: uniqueStrings([
        ...((Array.isArray(track.linked_graph_nodes)
          ? track.linked_graph_nodes
          : []
        ).map((value) => String(value ?? ""))),
        ...graphEvidence.linked_graph_nodes,
      ]),
      relation_patterns: uniqueStrings([
        ...((Array.isArray(track.relation_patterns)
          ? track.relation_patterns
          : []
        ).map((value) => String(value ?? ""))),
        ...graphEvidence.relation_patterns,
      ]),
    };
  });
  if (!changed || !registry) {
    return false;
  }
  await writeJsonEnsured(registryPath, {
    ...registry,
    tracks: nextTracks,
  });
  return true;
}

function resolveRequiredProjectArtifactPath(
  projectRoot: string,
  relativePath: string | null
): string {
  const resolvedPath = resolveProjectArtifactPath(projectRoot, relativePath);
  if (!resolvedPath) {
    throw new Error(`Could not resolve project artifact path: ${relativePath ?? "null"}`);
  }
  return resolvedPath;
}

export async function materializeIdeaCatalystState(params: {
  projectRoot: string;
  ideaCatalystMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const patch = asRecord(params.ideaCatalystMaterialization) ?? {};
  const ideationContract = normalizeIdeationContractState(manifest.ideation_contract);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);

  if (ideationContract.status !== "ready") {
    const next = {
      ...current,
      status: "missing",
      pendingReason: "ideation_contract is not ready yet.",
      lastUpdatedAt: nowIso(),
    };
    manifest.idea_catalyst = serializeIdeaCatalystState(next);
    await writeJsonEnsured(manifestPath, manifest);
    return {
      state: next,
      ready: false,
      validationErrors: getIdeaCatalystValidationErrors(next),
      generatedFiles: [],
    };
  }

  const graphPacketPath = resolveProjectArtifactPath(
    projectRoot,
    ideationContract.graphIdeationPacketPath
  );
  const mechanismBridgePacketPath = resolveProjectArtifactPath(
    projectRoot,
    "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json"
  );
  const ideaCatalystPacketBundlePath = resolveProjectArtifactPath(
    projectRoot,
    PAPER_NEXUS_IDEA_CATALYST_BUNDLE_PATH
  );
  const challengeInsightPacketPath = resolveProjectArtifactPath(
    projectRoot,
    "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json"
  );
  const topicSummaryPath = resolveProjectArtifactPath(
    projectRoot,
    ideationContract.graphBasisPaths.topicSummaryPath
  );
  const paperSourceIndexPath = resolveProjectArtifactPath(
    projectRoot,
    PAPER_SOURCE_INDEX_PATH
  );
  const currentRequisitionPath = resolveProjectArtifactPath(
    projectRoot,
    current.investigationRequisitionPath
  );
  const candidatePoolPath = resolveProjectArtifactPath(
    projectRoot,
    ideationContract.candidatePoolPath
  );
  const problemDecompositionPath = resolveProjectArtifactPath(
    projectRoot,
    ideationContract.problemDecompositionPath
  );

  const [
    graphPacket,
    rawIdeaCatalystPacketBundle,
    mechanismBridgePacket,
    challengeInsightPacket,
    topicSummary,
    candidatePool,
    problemDecompositionText,
    paperSourceIndex,
    existingInvestigationRequisition,
  ] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(graphPacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(ideaCatalystPacketBundlePath ?? ""),
      readJsonIfExists<Record<string, unknown>>(mechanismBridgePacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(challengeInsightPacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(topicSummaryPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(candidatePoolPath ?? ""),
      readTextIfExists(problemDecompositionPath),
      readJsonIfExists<Record<string, unknown>>(paperSourceIndexPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(currentRequisitionPath ?? ""),
    ]);
  const ideaCatalystPacketBundle = unwrapPacketBundle(rawIdeaCatalystPacketBundle);
  const recoveryProfile = inferIdeaCatalystRecoveryProfile({
    manifest,
    topicSummary,
    paperSourceIndex,
  });
  const profileDriftDetected =
    recoveryProfile?.kind === "eml_operator" &&
    [
      ideationContract.graphIdeationIndices,
      graphPacket,
      rawIdeaCatalystPacketBundle,
      mechanismBridgePacket,
      challengeInsightPacket,
      candidatePool,
      current,
      existingInvestigationRequisition,
    ].some(hasFixMatchGcdDrift);
  const sparseEmlGraphPacket =
    recoveryProfile?.kind === "eml_operator" &&
    sourceBackedPapersFromIndex(paperSourceIndex).length > 0 &&
    !hasEmlSignal(graphPacket) &&
    !hasEmlSignal(ideaCatalystPacketBundle);
  const sourceBackedEmlProfileReady =
    recoveryProfile?.kind === "eml_operator" &&
    hasSourceBackedEmlProfileEvidence(paperSourceIndex);
  const shouldRecoverSourceBackedEmlProfile =
    sourceBackedEmlProfileReady &&
    (current.status === "requisition" ||
      current.requisitionRequired ||
      isActionableInvestigationRequisition(existingInvestigationRequisition) ||
      !hasCanonicalEmlSourceDomainCoverage(ideationContract.graphIdeationIndices));
  const shouldUseSourceBackedEmlProfile =
    recoveryProfile?.kind === "eml_operator" && sourceBackedEmlProfileReady;
  const useProfileRecovery = Boolean(
    recoveryProfile &&
      (shouldUseSourceBackedEmlProfile ||
        profileDriftDetected ||
        sparseEmlGraphPacket ||
        shouldRecoverSourceBackedEmlProfile)
  );
  const profileGraphPacket =
    useProfileRecovery && recoveryProfile
      ? buildEmlIdeaCatalystGraphPacket({
          profile: recoveryProfile,
          paperSourceIndex,
          selectedTrackId: ideationContract.selectedTrackId,
        })
      : null;
  const graphPacketForMerge = profileGraphPacket ?? graphPacket;
  const ideaCatalystPacketBundleForMerge =
    useProfileRecovery && hasFixMatchGcdDrift(ideaCatalystPacketBundle)
      ? null
      : ideaCatalystPacketBundle;
  const mechanismBridgePacketForMerge =
    useProfileRecovery && hasFixMatchGcdDrift(mechanismBridgePacket)
      ? null
      : mechanismBridgePacket;
  const challengeInsightPacketForMerge =
    useProfileRecovery && hasFixMatchGcdDrift(challengeInsightPacket)
      ? null
      : challengeInsightPacket;
  const candidatePoolForMaterialization =
    useProfileRecovery && hasFixMatchGcdDrift(candidatePool)
      ? null
      : candidatePool;
  const graphIndices =
    useProfileRecovery && recoveryProfile
      ? buildProfileGraphIndices(
          recoveryProfile,
          ideationContract.graphIdeationIndices
        )
      : ideationContract.graphIdeationIndices;

  const mergedGraphPacket: Record<string, unknown> = {
    ...(graphPacketForMerge ?? {}),
    ...(ideaCatalystPacketBundleForMerge ?? {}),
    ...(challengeInsightPacketForMerge ?? {}),
    ...(mechanismBridgePacketForMerge ?? {}),
    challenge_clusters:
      challengeInsightPacketForMerge?.challenge_clusters ??
      challengeInsightPacketForMerge?.challengeClusters ??
      graphPacketForMerge?.challenge_clusters ??
      graphPacketForMerge?.challengeClusters,
    candidate_domains:
      mechanismBridgePacketForMerge?.candidate_domains ??
      mechanismBridgePacketForMerge?.candidateDomains ??
      graphPacketForMerge?.candidate_domains ??
      graphPacketForMerge?.candidateDomains,
    selected_domains:
      mechanismBridgePacketForMerge?.selected_domains ??
      mechanismBridgePacketForMerge?.selectedDomains,
    pruned_domains:
      mechanismBridgePacketForMerge?.pruned_domains ??
      mechanismBridgePacketForMerge?.prunedDomains,
    transfer_bridges:
      mechanismBridgePacketForMerge?.transfer_bridges ??
      mechanismBridgePacketForMerge?.transferBridges ??
      graphPacketForMerge?.transfer_bridges ??
      graphPacketForMerge?.transferBridges,
    bridge_nodes:
      mechanismBridgePacketForMerge?.bridge_nodes ??
      mechanismBridgePacketForMerge?.bridgeNodes ??
      graphPacketForMerge?.bridge_nodes ??
      graphPacketForMerge?.bridgeNodes,
    domain_distance_matrix:
      mechanismBridgePacketForMerge?.domain_distance_matrix ??
      mechanismBridgePacketForMerge?.domainDistanceMatrix ??
      graphPacketForMerge?.domain_distance_matrix ??
      graphPacketForMerge?.domainDistanceMatrix,
    bridge_evidence_tier:
      mechanismBridgePacketForMerge?.bridge_evidence_tier ??
      mechanismBridgePacketForMerge?.bridgeEvidenceTier ??
      ideaCatalystPacketBundleForMerge?.bridge_evidence_tier ??
      ideaCatalystPacketBundleForMerge?.bridgeEvidenceTier ??
      graphPacketForMerge?.bridge_evidence_tier ??
      graphPacketForMerge?.bridgeEvidenceTier,
    bridge_retrieval:
      ideaCatalystPacketBundleForMerge?.bridge_retrieval ??
      ideaCatalystPacketBundleForMerge?.bridgeRetrieval ??
      mechanismBridgePacketForMerge?.bridge_retrieval ??
      mechanismBridgePacketForMerge?.bridgeRetrieval ??
      graphPacketForMerge?.bridge_retrieval ??
      graphPacketForMerge?.bridgeRetrieval,
    structural_analogy:
      ideaCatalystPacketBundleForMerge?.structural_analogy ??
      ideaCatalystPacketBundleForMerge?.structuralAnalogy ??
      mechanismBridgePacketForMerge?.structural_analogy ??
      mechanismBridgePacketForMerge?.structuralAnalogy ??
      graphPacketForMerge?.structural_analogy ??
      graphPacketForMerge?.structuralAnalogy,
    interdisciplinary_potential_ranking:
      ideaCatalystPacketBundleForMerge?.interdisciplinary_potential_ranking ??
      ideaCatalystPacketBundleForMerge?.interdisciplinaryPotentialRanking ??
      mechanismBridgePacketForMerge?.interdisciplinary_potential_ranking ??
      mechanismBridgePacketForMerge?.interdisciplinaryPotentialRanking ??
      graphPacketForMerge?.interdisciplinary_potential_ranking ??
      graphPacketForMerge?.interdisciplinaryPotentialRanking,
    domain_distance_policy:
      ideaCatalystPacketBundleForMerge?.domain_distance_policy ??
      ideaCatalystPacketBundleForMerge?.domainDistancePolicy ??
      mechanismBridgePacketForMerge?.domain_distance_policy ??
      mechanismBridgePacketForMerge?.domainDistancePolicy ??
      graphPacketForMerge?.domain_distance_policy ??
      graphPacketForMerge?.domainDistancePolicy,
    source_domain_analyses:
      ideaCatalystPacketBundleForMerge?.source_domain_analyses ??
      ideaCatalystPacketBundleForMerge?.sourceDomainAnalyses ??
      mechanismBridgePacketForMerge?.source_domain_analyses ??
      mechanismBridgePacketForMerge?.sourceDomainAnalyses ??
      graphPacketForMerge?.source_domain_analyses ??
      graphPacketForMerge?.sourceDomainAnalyses,
    cross_domain_analysis:
      ideaCatalystPacketBundleForMerge?.cross_domain_analysis ??
      ideaCatalystPacketBundleForMerge?.crossDomainAnalysis ??
      mechanismBridgePacketForMerge?.cross_domain_analysis ??
      mechanismBridgePacketForMerge?.crossDomainAnalysis ??
      graphPacketForMerge?.cross_domain_analysis ??
      graphPacketForMerge?.crossDomainAnalysis,
    idea_fragments:
      ideaCatalystPacketBundleForMerge?.idea_fragments ??
      ideaCatalystPacketBundleForMerge?.ideaFragments ??
      mechanismBridgePacketForMerge?.idea_fragments ??
      mechanismBridgePacketForMerge?.ideaFragments ??
      graphPacketForMerge?.idea_fragments ??
      graphPacketForMerge?.ideaFragments,
    requisition_report:
      ideaCatalystPacketBundleForMerge?.requisition_report ??
      ideaCatalystPacketBundleForMerge?.requisitionReport ??
      mechanismBridgePacketForMerge?.requisition_report ??
      mechanismBridgePacketForMerge?.requisitionReport,
  };

  const targetDomain =
    pickString(patch, ["target_domain", "targetDomain"]) ??
    pickString(mergedGraphPacket, ["target_domain", "targetDomain"]) ??
    pickString(topicSummary ?? {}, ["target_domain", "targetDomain"]) ??
    "Computer Science";
  const topicContext = uniqueStrings([
    asString(manifest.title),
    researchProgram.problemStatement,
    researchProgram.goal,
    researchProgram.baselineReference
      ? `baseline ${researchProgram.baselineReference}`
      : null,
    researchProgram.primaryMetric
      ? `metric ${researchProgram.primaryMetric}`
      : null,
    ...researchProgram.datasets.map((dataset) => `dataset ${dataset}`),
    pickString(topicSummary ?? {}, [
      "topic",
      "research_topic",
      "researchTopic",
      "title",
      "summary",
    ]),
  ].filter((entry): entry is string => Boolean(entry))).slice(0, 6);
  const challengeClusters = uniqueStrings([
    ...graphIndices.challengeClusters,
    ...markdownBulletsToList(problemDecompositionText).slice(0, 4),
  ]).slice(0, 6);
  const graphPacketTransferBridges = Array.isArray(
    graphPacketForMerge?.transfer_bridges ?? graphPacketForMerge?.transferBridges
  )
    ? ((graphPacketForMerge?.transfer_bridges ?? graphPacketForMerge?.transferBridges) as unknown[])
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const transferBridges = uniqueStrings([
    ...graphIndices.transferBridges,
    ...graphPacketTransferBridges,
  ]).slice(0, 6);
  const llmJudgments = normalizePairwiseJudgments(
    patch.llm_judgments ?? patch.llmJudgments
  );
  const llmGeneratedQuestions = Array.isArray(
    patch.llm_generated_questions ?? patch.llmGeneratedQuestions
  )
    ? parseGeneratedQuestions(
        JSON.stringify({
          questions:
            patch.llm_generated_questions ?? patch.llmGeneratedQuestions,
        })
      )
    : [];
  const llmSufficiencyJudgment =
    patch.llm_sufficiency_judgment ?? patch.llmSufficiencyJudgment
      ? parseSufficiencyJudgment(
          JSON.stringify(
            patch.llm_sufficiency_judgment ?? patch.llmSufficiencyJudgment
          )
        )
      : null;
  let workingChallengeClusters = challengeClusters;
  let decompositionPacket: Record<string, unknown> | null = null;
  let abstractionPacket: Record<string, unknown> | null = null;
  let scoutingReport: Record<string, unknown> | null = null;
  let gateDecision: Record<string, unknown> | null = null;
  const iterations: Array<Record<string, unknown>> = [];
  let strategy: "initial_scan" | "refine_questions" | "expand_domains" | "requisition" =
    "initial_scan";

  for (let iteration = 0; iteration < 3; iteration += 1) {
    decompositionPacket = buildIdeaCatalystDecompositionPacket({
      targetDomain,
      longTermGoal: researchProgram.goal,
      problemStatement: researchProgram.problemStatement,
      selectedTrackId: ideationContract.selectedTrackId,
      challengeClusters: workingChallengeClusters,
      graphChallengeClusters: Array.isArray(
        mergedGraphPacket?.challenge_clusters ?? mergedGraphPacket?.challengeClusters
      )
        ? ((mergedGraphPacket?.challenge_clusters ?? mergedGraphPacket?.challengeClusters) as unknown[])
            .map((entry) => asString(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [],
      occupiedSolutionZones: graphIndices.occupiedSolutionZones,
      transferBridges,
    }, {
      llmGeneratedQuestions,
    });
    abstractionPacket = buildIdeaCatalystAbstractionPacket(
      decompositionPacket,
      targetDomain
    );
    scoutingReport = deriveIdeaCatalystScoutReport({
      graphIdeationPacket: mergedGraphPacket,
      topicSummary,
      challengeClusters: workingChallengeClusters,
      transferBridges,
      targetDomain,
    });
    gateDecision = buildIdeaCatalystGateDecision(
      scoutingReport,
      decompositionPacket,
      {
        llmJudgment: llmSufficiencyJudgment,
        topicContext,
      }
    );
    iterations.push(
      buildCatalystIterationRecord({
        iteration,
        strategy,
        decompositionPacket,
        scoutingReport,
        gateDecision,
      })
    );
    const progress = assessIdeaCatalystProgress({
      iteration,
      gateDecision,
    });
    if (!progress.shouldContinue || progress.nextStrategy === "brainstorm") {
      break;
    }
    if (progress.nextStrategy === "refine_questions") {
      workingChallengeClusters = deriveRefinedChallengeClusters({
        challengeClusters: workingChallengeClusters,
        decompositionPacket,
      });
    }
    strategy = progress.nextStrategy;
  }
  if (!decompositionPacket || !abstractionPacket || !scoutingReport || !gateDecision) {
    throw new Error("IDEA-CATALYST materialization did not produce required packets.");
  }
  const candidateDomainRecords = Array.isArray(scoutingReport.candidate_domains)
    ? scoutingReport.candidate_domains
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const selectedSourceDomains = Array.isArray(scoutingReport.selected_source_domains)
    ? scoutingReport.selected_source_domains
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const prunedSourceDomains = Array.isArray(scoutingReport.pruned_domains)
    ? scoutingReport.pruned_domains
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const scoutingReportRecord = asRecord(scoutingReport) ?? {};
  const candidateSourceDomains = candidateDomainRecords
    .map((entry) => pickString(entry, ["domain"]))
    .filter((entry): entry is string => Boolean(entry));
  const bridgeEvidenceTier =
    pickString(scoutingReportRecord, ["bridge_evidence_tier", "bridgeEvidenceTier"]) ??
    null;
  const bridgeNodeRecords = Array.isArray(scoutingReport.bridge_nodes)
    ? scoutingReport.bridge_nodes
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const bridgeNodeLabels = bridgeNodeRecords
    .map((record) => {
      const domain = pickString(record, ["domain"]);
      const mechanism =
        pickString(record, ["mechanism"]) ?? pickString(record, ["node_name"]);
      if (!mechanism) {
        return null;
      }
      return domain ? `${domain}:${mechanism}` : mechanism;
    })
    .filter((entry): entry is string => Boolean(entry));

  const candidatePoolPacket = buildIdeaCatalystCandidatePool({
    graphPacket: mergedGraphPacket,
    candidatePool: candidatePoolForMaterialization,
    scoutingReport,
    targetDomain,
    selectedTrackId: ideationContract.selectedTrackId,
    baselineReference: researchProgram.baselineReference,
    primaryMetric: researchProgram.primaryMetric,
  });
  const candidateTournament = buildIdeaCatalystTournament({
    candidatePool: candidatePoolPacket,
    topK: 3,
  });
  const candidateScorecardPacket = candidateTournament.scorecard;
  const candidateTournamentPacket = candidateTournament.tournament;
  const selectedIdeasPacket = candidateTournament.selectedIdeas;
  const rejectedIdeasPacket = candidateTournament.rejectedIdeas;
  const selectedIdeaCandidates: LegacyIdeaCatalystCandidate[] = Array.isArray(
    selectedIdeasPacket.selected_ideas
  )
    ? (selectedIdeasPacket.selected_ideas as LegacyIdeaCatalystCandidate[])
    : [];
  const sourceDomains = uniqueStrings(
    selectedSourceDomains.length > 0
      ? selectedSourceDomains
      : candidateDomainRecords
          .filter((entry) => entry?.pruned !== true)
          .map((entry) => asString(entry.domain))
          .filter((entry): entry is string => Boolean(entry))
  );
  const requisitionRecord = (asRecord(gateDecision.requisition) ?? {}) as Record<
    string,
    unknown
  >;
  const requisitionActionable = requisitionRecord.actionable !== false;
  const requisitionId = pickString(requisitionRecord, [
    "requisition_id",
    "requisitionId",
  ]);
  const requisitionSatisfaction = await readIdeaCatalystRequisitionSatisfaction({
    projectRoot,
    manifest,
    requisitionId: requisitionId ?? current.lastRequisitionCycle,
    existingInvestigationRequisition,
  });
  const requisitionSatisfiedByAcceptedReport =
    requisitionSatisfaction.satisfied && requisitionSatisfaction.reportBacked;
  const requisitionSatisfiedByCurrentGraph =
    gateDecision.decision !== "brainstorm" &&
    requisitionSatisfaction.satisfied &&
    (requisitionActionable || requisitionSatisfaction.reportBacked);
  const effectiveGateDecision = requisitionSatisfiedByCurrentGraph
    ? "brainstorm"
    : gateDecision.decision;
  const shouldIntegrateFragments =
    effectiveGateDecision === "brainstorm" && selectedIdeaCandidates.length > 0;
  const ideaFragmentsPacket = shouldIntegrateFragments
    ? buildIdeaCatalystIdeaFragments({
        candidates: selectedIdeaCandidates,
        sourceDomains,
        targetDomain,
        selectedTrackId: ideationContract.selectedTrackId,
        problemStatement: researchProgram.problemStatement,
        baselineReference: researchProgram.baselineReference,
        primaryMetric: researchProgram.primaryMetric,
        decompositionPacket,
        scoutingReport,
      })
    : null;
  const rankedFragmentsPacket =
    shouldIntegrateFragments && ideaFragmentsPacket
      ? buildIdeaCatalystRankedFragments(ideaFragmentsPacket, { llmJudgments })
      : null;
  const materializedAt = nowIso();
  const liveDiscoveryReadModel = buildLiveIdeaCatalystReadModel({
    packetBundle: ideaCatalystPacketBundleForMerge,
    materializedAt,
  });

  const next = normalizeIdeaCatalystState({
    ...serializeIdeaCatalystState(current),
    ...patch,
    status:
      effectiveGateDecision === "brainstorm"
        ? "ready"
        : requisitionActionable
          ? "requisition"
          : "pending",
    mode: "graph-first",
    micro_stage:
      effectiveGateDecision === "brainstorm" ? "judging" : "gatekeeping",
    target_domain: targetDomain,
    source_domains: sourceDomains,
    bridge_count: bridgeNodeRecords.length,
    top_fragment_id: rankedFragmentsPacket?.ranking?.[0]?.fragment_id ?? null,
    requisition_required:
      effectiveGateDecision !== "brainstorm" && requisitionActionable,
    last_requisition_cycle:
      effectiveGateDecision === "brainstorm" || !requisitionActionable
        ? current.lastRequisitionCycle
        : requisitionId,
    requisition_retry_budget:
      effectiveGateDecision === "brainstorm" || !requisitionActionable
        ? current.requisitionRetryBudget
        : pickNumber(requisitionRecord, [
            "retry_budget",
            "retryBudget",
          ]),
    requisition_saturated: false,
    pending_reason:
      requisitionSatisfiedByAcceptedReport
        ? "IDEA-CATALYST requisition was satisfied with a durable warning against the current ready graph; downstream claims remain capped by the recorded evidence tier."
        : effectiveGateDecision === "brainstorm"
        ? null
        : pickString(requisitionRecord, [
            "non_actionable_reason",
            "nonActionableReason",
          ]) ?? gateDecision.rationale,
    last_updated_at: materializedAt,
  });

  const ideationContractState = normalizeIdeationContractState(manifest.ideation_contract);
  const manifestGraphIndicesBase =
    useProfileRecovery && recoveryProfile
      ? buildProfileGraphIndices(
          recoveryProfile,
          ideationContractState.graphIdeationIndices
        )
      : ideationContractState.graphIdeationIndices;
  manifest.ideation_contract = serializeIdeationContractState({
    ...ideationContractState,
    graphIdeationIndices: {
      ...manifestGraphIndicesBase,
      transferBridges: uniqueStrings([
        ...manifestGraphIndicesBase.transferBridges,
        ...bridgeNodeLabels,
      ]),
      candidateSourceDomains: uniqueStrings([
        ...manifestGraphIndicesBase.candidateSourceDomains,
        ...candidateSourceDomains,
      ]),
      selectedSourceDomains: selectedSourceDomains,
      prunedSourceDomains: prunedSourceDomains,
      bridgeEvidenceTier,
      lastRefreshAt: next.lastUpdatedAt,
    },
  });

  const shouldRetireProfileRequisition =
    effectiveGateDecision === "brainstorm" &&
    Boolean(recoveryProfile) &&
    (hasFixMatchGcdDrift(existingInvestigationRequisition) ||
      (useProfileRecovery &&
        isActionableInvestigationRequisition(existingInvestigationRequisition)));
  const resolvedPaths: Array<[string, Record<string, unknown> | null]> = [
    [next.decompositionPacketPath, decompositionPacket],
    [next.abstractionPacketPath, abstractionPacket],
    [next.scoutingReportPath, scoutingReport],
    [next.gateDecisionPath, gateDecision],
    [CANDIDATE_POOL_PATH, candidatePoolPacket],
    [CANDIDATE_SCORECARD_PATH, candidateScorecardPacket],
    [CANDIDATE_TOURNAMENT_PATH, candidateTournamentPacket],
    [SELECTED_IDEAS_PATH, selectedIdeasPacket],
    [REJECTED_IDEAS_PATH, rejectedIdeasPacket],
    [
      LIVE_PACKET_BUNDLE_PATH,
      liveDiscoveryReadModel?.packetBundle ?? null,
    ],
    [
      LIVE_DISCOVERY_RUN_MANIFEST_PATH,
      liveDiscoveryReadModel?.runManifest ?? null,
    ],
    [
      LIVE_DISCOVERY_EVIDENCE_CARDS_PATH,
      liveDiscoveryReadModel?.evidenceCardArtifact ?? null,
    ],
    [
      LIVE_DISCOVERY_READ_MODEL_PATH,
      liveDiscoveryReadModel?.readModel ?? null,
    ],
    [next.ideaFragmentsPath, ideaFragmentsPacket],
    [next.rankedFragmentsPath, rankedFragmentsPacket],
    [
      next.investigationRequisitionPath,
      effectiveGateDecision === "brainstorm"
        ? requisitionSatisfiedByAcceptedReport
          ? buildDegradedSatisfiedRequisition({
              requisition: requisitionRecord,
              trigger: params.trigger,
              requestId: requisitionSatisfaction.requestId,
              validationReportPath: requisitionSatisfaction.validationReportPath,
              validationStatus: requisitionSatisfaction.validationStatus,
              validationSummary: requisitionSatisfaction.validationSummary,
              materializedAt,
            })
          : shouldRetireProfileRequisition && recoveryProfile
          ? buildSupersededProfileRequisition({
              profile: recoveryProfile,
              targetDomain,
              trigger: params.trigger,
            })
          : null
        : {
            ...(requisitionRecord ?? {}),
            trigger: params.trigger ?? "idea_catalyst",
          },
    ],
    [
      next.sessionStatePath,
      {
        status: next.status,
        micro_stage: next.microStage,
        trigger: params.trigger ?? null,
        agent_id: params.agentId ?? null,
        iteration_count: iterations.length,
        iterations,
        final_strategy: iterations[iterations.length - 1]?.strategy ?? strategy,
        bridge_evidence_tier: bridgeEvidenceTier,
        selected_source_domains: selectedSourceDomains,
        pruned_source_domains: prunedSourceDomains,
        top_fragment_id: rankedFragmentsPacket?.ranking?.[0]?.fragment_id ?? null,
        candidate_pool_size: candidatePoolPacket.candidate_pool_size,
        selected_idea_count: selectedIdeasPacket.selected_count,
        rejected_idea_count: rejectedIdeasPacket.rejected_count,
        live_discovery: liveDiscoveryReadModel?.sessionProjection ?? null,
        updated_at: next.lastUpdatedAt,
      },
    ],
  ];

  const generatedFiles: string[] = [];
  for (const [relativePath, value] of resolvedPaths) {
    if (value === null) continue;
    const resolvedPath = resolveRequiredProjectArtifactPath(projectRoot, relativePath);
    await writeJsonEnsured(resolvedPath, value);
    generatedFiles.push(resolvedPath);
  }
  const trackRegistryUpdated = await syncSelectedIdeaTraceToTrackRegistry({
    projectRoot,
    selectedIdeasPacket,
    selectedTrackId: ideationContract.selectedTrackId,
  });
  if (trackRegistryUpdated) {
    generatedFiles.push(path.join(projectRoot, "TRACK_REGISTRY.json"));
  }

  if (!next.requisitionRequired) {
    const retirementSummary =
      next.status === "ready"
        ? "IDEA-CATALYST is source-backed and no longer requires this requisition."
        : "IDEA-CATALYST requisition is no longer actionable.";
    const queueRetirement = retireActiveIdeaCatalystRequisitionQueuedRequests({
      paperIngestion: manifest.paper_ingestion,
      updatedAt: materializedAt,
      validationReportPath: REQUISITION_RETIREMENT_REPORT_PATH,
      validationSummary: retirementSummary,
      detail:
        next.status === "ready"
          ? "IDEA-CATALYST is source-backed and no longer requires this requisition; retired the stale graph-build queue request with a durable satisfaction report."
          : "IDEA-CATALYST requisition is no longer actionable; retired the stale graph-build queue request with a durable satisfaction report.",
    });
    if (queueRetirement.retiredCount > 0) {
      manifest.paper_ingestion = serializePaperIngestionState(
        queueRetirement.paperIngestion
      );
      const retirementReportPath = resolveRequiredProjectArtifactPath(
        projectRoot,
        REQUISITION_RETIREMENT_REPORT_PATH
      );
      await writeJsonEnsured(retirementReportPath, {
        status: "valid",
        trigger: params.trigger ?? "idea_catalyst",
        retired_at: materializedAt,
        retired_request_ids: queueRetirement.retiredRequestIds,
        retirement_summary: retirementSummary,
        idea_catalyst_status: next.status,
        requisition_required: next.requisitionRequired,
        investigation_requisition_path: next.investigationRequisitionPath,
        paper_source_index_path: PAPER_SOURCE_INDEX_PATH,
        source_domains: next.sourceDomains,
      });
      generatedFiles.push(retirementReportPath);
    }
  }

  manifest.idea_catalyst = serializeIdeaCatalystState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state: next,
    ready: next.status === "ready",
    validationErrors: getIdeaCatalystValidationErrors(next),
    generatedFiles,
  };
}
