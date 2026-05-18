import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeIdeationContractState,
  serializeIdeationContractState,
  serializeIdeationGraphIndicesState,
} from "../workflow-guard-state/ideation-contract";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "../workflow-guard-state/paper-story";
import {
  normalizeReviewPressurePacketState,
  serializeReviewPressurePacketState,
} from "../workflow-guard-state/review-pressure";
import {
  DEFAULT_KG_STORYLINE_PACKET_PATH,
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import {
  normalizeGraphGuidedWritingState,
  serializeGraphGuidedWritingState,
} from "../workflow-guard-state/authoring-review-state";
import {
  normalizeIdeaCatalystState,
  serializeIdeaCatalystState,
} from "../idea-catalyst/state";
import {
  collectIdeaContractEvidenceFromBundle,
  readIdeaCatalystContract,
  writeIdeaCatalystContract,
  type IdeaCatalystContract,
} from "../idea-catalyst/contract";
import { readGraphBuildDecision } from "../graph-build-decision";
import {
  DEFAULT_GRAPH_BUILD_DECISION_PATH,
  DEFAULT_IDEA_CATALYST_CONTRACT_PATH,
  LITERATURE_REQUISITION_SATISFACTION_AUTHORITY,
} from "../workflow-authority-registry";

export const DEFAULT_MECHANISM_BRIDGE_PACKET_PATH =
  "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json";
export const DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH =
  "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json";
export const DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH =
  "researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json";
export const DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH =
  "researcher/papernexus/GRAPH_STORYLINE_PACKET.json";
export const DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH =
  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json";
const DEFAULT_IDEA_CATALYST_FRAGMENTS_PATH =
  "researcher/idea-catalyst/IDEA_FRAGMENTS.json";
export const DEFAULT_INNOVATION_PACKET_PATH =
  "orchestrator/INNOVATION_PACKET.json";

function nowIso() {
  return new Date().toISOString();
}

function normalizeStringList(value: unknown): string[] {
  return uniqueStrings(asStringArray(value));
}

function readPacketList(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = record[key];
    const values = normalizeStringList(raw);
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

function readStringListFromObjects(
  values: unknown,
  candidateKeys: string[]
): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return uniqueStrings(
    values
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        for (const key of candidateKeys) {
          const value = asString(entry[key]);
          if (value) {
            return value;
          }
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry))
  );
}

function readRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function paperEvidenceId(paper: Record<string, unknown>): string | null {
  return (
    pickString(paper, ["canonical_id", "canonicalId", "paper_id", "paperId"]) ??
    pickString(paper, ["arxiv_id", "arxivId", "doi", "title"])
  );
}

function isSourceBackedLiteraturePaper(paper: Record<string, unknown>): boolean {
  const sourceKind = normalizeStage(
    pickString(paper, ["source_kind", "sourceKind", "kind"])
  );
  const importStatus = normalizeStage(
    pickString(paper, ["import_status", "importStatus", "status"])
  );
  return Boolean(
    pickString(paper, ["source_path", "sourcePath", "md_path", "mdPath", "pdf_path", "pdfPath"]) ||
      sourceKind === "markdown" ||
      sourceKind === "pdf" ||
      sourceKind === "source_backed" ||
      importStatus === "completed" ||
      importStatus === "source_backed"
  );
}

function collectIdeaContractEvidenceFromLiteraturePacket(value: unknown): {
  supportingPapers: string[];
  sourceSpans: Record<string, unknown>[];
  evidenceChainRefs: Record<string, unknown>[];
} {
  const packet = asRecord(value);
  if (!packet) {
    return { supportingPapers: [], sourceSpans: [], evidenceChainRefs: [] };
  }
  const seen = new Set<string>();
  const papers = [
    ...readRecordList(packet.selected_papers ?? packet.selectedPapers),
    ...readRecordList(packet.candidate_papers ?? packet.candidatePapers),
  ].filter((paper) => {
    if (!isSourceBackedLiteraturePaper(paper)) {
      return false;
    }
    const id = paperEvidenceId(paper);
    if (!id) {
      return false;
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  const supportingPapers = uniqueStrings(
    papers
      .map((paper) => paperEvidenceId(paper))
      .filter((entry): entry is string => Boolean(entry))
  );
  const sourceSpans = papers.map((paper) => ({
    paper_id: paperEvidenceId(paper),
    title: pickString(paper, ["title"]),
    source_path:
      pickString(paper, ["source_path", "sourcePath", "md_path", "mdPath", "pdf_path", "pdfPath"]) ??
      null,
    source_kind: pickString(paper, ["source_kind", "sourceKind", "kind"]) ?? null,
    evidence_origin: DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
  }));
  const evidenceChainRefs = papers.map((paper) => ({
    ref_id: paperEvidenceId(paper),
    evidence_type: "literature_discovery_source",
    path: DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
  }));
  return { supportingPapers, sourceSpans, evidenceChainRefs };
}

function collectLegacyIdeaFragments(value: unknown): Record<string, unknown>[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return [
    ...readRecordList(record.idea_fragments ?? record.ideaFragments),
    ...readRecordList(record.fragments),
  ];
}

function readFirstRecord(value: unknown): Record<string, unknown> | null {
  return readRecordList(value)[0] ?? null;
}

function unwrapPacketBundle(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    asRecord(record.packet_bundle) ??
    asRecord(record.packetBundle) ??
    record
  );
}

function slugify(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "idea";
}

function pickFirstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function readIdeaFragmentString(
  fragment: Record<string, unknown>,
  keys: string[]
): string | null {
  const direct = pickString(fragment, keys);
  if (direct) {
    return direct;
  }
  const nested = asRecord(fragment.idea_fragment ?? fragment.ideaFragment);
  return nested ? pickString(nested, keys) : null;
}

function readIdeaFragmentId(
  fragment: Record<string, unknown>,
  index: number
): string {
  return (
    pickString(fragment, [
      "idea_fragment_id",
      "ideaFragmentId",
      "fragment_id",
      "fragmentId",
      "id",
      "candidate_id",
      "candidateId",
    ]) ??
    `${slugify(readIdeaFragmentString(fragment, ["source_domain", "sourceDomain"]))}-${index + 1}`
  );
}

function collectEvidenceRefNodeIds(value: unknown): string[] {
  return readRecordList(value)
    .map((entry) => pickString(entry, ["node_id", "nodeId", "ref_id", "refId"]))
    .filter((entry): entry is string => Boolean(entry));
}

function collectSourceSpanIds(value: unknown): string[] {
  return readRecordList(value)
    .map((entry) =>
      pickString(entry, [
        "span_id",
        "spanId",
        "snippet_node_id",
        "snippetNodeId",
        "node_id",
        "nodeId",
      ])
    )
    .filter((entry): entry is string => Boolean(entry));
}

function inferExplicitBudgetText(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/gu, " ");
  const match = normalized.match(
    /\b(?<amount>\d+(?:\.\d+)?)\s*(?:-| )?(?<unit>minutes?|mins?|m|hours?|hrs?|h)\s*(?<qualifier>per(?:-| )?run|cpu trial|trial|run|budget)?(?:\s+budget)?\b/iu
  );
  if (!match?.groups) {
    return null;
  }
  const matchedText = match[0];
  if (!/\b(per(?:-| )?run|trial|run|budget)\b/iu.test(matchedText)) {
    return null;
  }
  const amount = match.groups.amount;
  const unit = /^h(?:ours?|rs?)?$/iu.test(match.groups.unit)
    ? "hour"
    : "minute";
  const parts = [amount, unit];
  if (/\bper(?:-| )?run\b/iu.test(matchedText)) {
    parts.push("per-run");
  }
  if (/\bcpu\b/iu.test(normalized)) {
    parts.push("CPU");
  }
  parts.push("budget");
  return parts.join(" ");
}

function inferResearchProgramTextBudget(
  researchProgram: Record<string, unknown>
): string | null {
  const textCandidates = [
    pickString(researchProgram, ["goal"]),
    pickString(researchProgram, ["problem_statement", "problemStatement"]),
    pickString(researchProgram, ["description", "topic"]),
    ...asStringArray(researchProgram.success_criteria ?? researchProgram.successCriteria),
    ...asStringArray(researchProgram.constraints),
  ];
  for (const candidate of textCandidates) {
    const budget = inferExplicitBudgetText(candidate);
    if (budget) {
      return budget;
    }
  }
  return null;
}

function inferResearchProgramBudgetText(
  researchProgram: Record<string, unknown>
): string | null {
  const explicit = pickString(researchProgram, [
    "fixed_budget",
    "fixedBudget",
    "compute_budget",
    "computeBudget",
    "trial_time_budget",
    "trialTimeBudget",
  ]);
  if (explicit) {
    return explicit;
  }
  const textBudget = inferResearchProgramTextBudget(researchProgram);
  if (textBudget) {
    return textBudget;
  }
  const budgetCriterion = asStringArray(
    researchProgram.success_criteria ?? researchProgram.successCriteria
  ).find((entry) => /\b(budget|minute|min|hour|cpu|gpu)\b/iu.test(entry));
  if (budgetCriterion) {
    return budgetCriterion;
  }
  const track = readFirstRecord(researchProgram.tracks);
  const trackBudget = asRecord(track?.budget) ?? {};
  const parts: string[] = [];
  const maxRuns = pickNumber(trackBudget, ["maxRuns", "max_runs"]);
  const gpuHours = pickNumber(trackBudget, ["gpuHours", "gpu_hours"]);
  const maxDebugIterations = pickNumber(trackBudget, [
    "maxDebugIterations",
    "max_debug_iterations",
  ]);
  if (maxRuns != null) {
    parts.push(`max_runs=${maxRuns}`);
  }
  if (gpuHours != null) {
    parts.push(`gpu_hours=${gpuHours}`);
  }
  if (maxDebugIterations != null) {
    parts.push(`max_debug_iterations=${maxDebugIterations}`);
  }
  if (parts.length > 0) {
    return parts.join("; ");
  }
  return asStringArray(track?.stop_rules ?? track?.stopRules).find((entry) =>
    /\b(budget|minute|min|hour|cpu|gpu)\b/iu.test(entry)
  ) ?? null;
}

function deriveInnovationPacketFromBundle(params: {
  manifest: Record<string, unknown>;
  existingPacket: Record<string, unknown> | null;
  bundle: Record<string, unknown> | null;
  ideaCatalystContract: IdeaCatalystContract | null;
  ideaCatalystContractPath: string;
  mechanismBridgePacket: Record<string, unknown> | null;
  challengeInsightPacket: Record<string, unknown> | null;
  ideaCatalystPacketBundlePath: string;
  mechanismBridgePacketPath: string;
  challengeInsightPacketPath: string;
  projectRoot: string;
}): Record<string, unknown> | null {
  const bundle = params.bundle ?? {};
  if (params.ideaCatalystContract?.status !== "ready") {
    return null;
  }
  const ideaFragments = [
    ...readRecordList(bundle.idea_fragments ?? bundle.ideaFragments),
    ...(params.bundle ? [] : params.ideaCatalystContract.idea_fragments),
  ];
  const selectedIdeaFragment = ideaFragments[0] ?? null;
  if (!selectedIdeaFragment) {
    return null;
  }

  const researchProgram = asRecord(params.manifest.research_program) ?? {};
  const decomposition = asRecord(bundle.decomposition) ?? {};
  const targetAnalysis = readFirstRecord(
    bundle.target_domain_analysis ?? bundle.targetDomainAnalysis
  );
  const challenge = readFirstRecord(
    targetAnalysis?.remaining_challenges ?? targetAnalysis?.remainingChallenges
  );
  const question =
    readFirstRecord(decomposition.research_questions) ??
    readFirstRecord(decomposition.questions);
  const sourceAnalyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.sourceDomainAnalyses ?? bundle.cross_domain_analysis
  );

  const selectedIdeaFragmentId = readIdeaFragmentId(selectedIdeaFragment, 0);
  const sourceDomains = uniqueStrings([
    ...asStringArray(params.existingPacket?.source_domains),
    ...asStringArray(params.existingPacket?.sourceDomains),
    ...readPacketList(params.mechanismBridgePacket ?? {}, [
      "selected_domains",
      "selectedDomains",
      "source_domains",
      "sourceDomains",
    ]),
    ...sourceAnalyses
      .map((entry) => pickString(entry, ["source_domain", "sourceDomain", "domain"]))
      .filter((entry): entry is string => Boolean(entry)),
    readIdeaFragmentString(selectedIdeaFragment, ["source_domain", "sourceDomain"]),
  ].filter((entry): entry is string => Boolean(entry)));
  const supportingPapers = uniqueStrings([
    ...asStringArray(params.existingPacket?.supporting_papers),
    ...asStringArray(params.existingPacket?.supportingPapers),
    ...params.ideaCatalystContract.supporting_papers,
    ...readPacketList(selectedIdeaFragment, ["supporting_papers", "supportingPapers"]),
    ...sourceAnalyses.flatMap((entry) =>
      readPacketList(entry, ["supporting_papers", "supportingPapers"])
    ),
  ]);
  const supportingKgNodes = uniqueStrings([
    ...asStringArray(params.existingPacket?.supporting_kg_nodes),
    ...asStringArray(params.existingPacket?.supportingKgNodes),
    ...asStringArray(selectedIdeaFragment.bridge_path_ids),
    ...asStringArray(selectedIdeaFragment.bridgePathIds),
    ...collectEvidenceRefNodeIds(
      selectedIdeaFragment.evidence_chain_refs ?? selectedIdeaFragment.evidenceChainRefs
    ),
    ...collectEvidenceRefNodeIds(params.ideaCatalystContract.evidence_chain_refs),
    ...collectSourceSpanIds(
      selectedIdeaFragment.source_spans ?? selectedIdeaFragment.sourceSpans
    ),
    ...collectSourceSpanIds(params.ideaCatalystContract.source_spans),
    ...params.ideaCatalystContract.source_spans
      .map((entry) => pickString(entry, ["paper_id", "paperId", "canonical_id", "canonicalId"]))
      .filter((entry): entry is string => Boolean(entry)),
    ...readRecordList(params.mechanismBridgePacket?.bridge_nodes)
      .map((entry) => pickString(entry, ["node_id", "nodeId"]))
      .filter((entry): entry is string => Boolean(entry)),
  ]);
  const evidencePaths = uniqueStrings([
    path.relative(params.projectRoot, params.ideaCatalystContractPath),
    ...(params.bundle
      ? [path.relative(params.projectRoot, params.ideaCatalystPacketBundlePath)]
      : []),
    ...(params.mechanismBridgePacket
      ? [path.relative(params.projectRoot, params.mechanismBridgePacketPath)]
      : []),
    ...(params.challengeInsightPacket
      ? [path.relative(params.projectRoot, params.challengeInsightPacketPath)]
      : []),
    ...params.ideaCatalystContract.payload_paths,
    ...(params.ideaCatalystContract.graph_decision_path
      ? [params.ideaCatalystContract.graph_decision_path]
      : []),
    ...(params.ideaCatalystContract.source_requisition_report_path
      ? [params.ideaCatalystContract.source_requisition_report_path]
      : []),
    ...asStringArray(params.existingPacket?.evidence_paths),
    ...asStringArray(params.existingPacket?.evidencePaths),
  ]);
  const activeTrack = readFirstRecord(researchProgram.tracks);

  const baseline = pickFirstString(
    asString(params.existingPacket?.baseline),
    pickString(researchProgram, ["baseline_reference", "baselineReference", "baseline"]),
    asStringArray(activeTrack?.required_baselines ?? activeTrack?.requiredBaselines)[0]
  );
  const primaryMetric = pickFirstString(
    asString(params.existingPacket?.primary_metric),
    asString(params.existingPacket?.primaryMetric),
    pickString(researchProgram, ["primary_metric", "primaryMetric", "metric"]),
    pickString(activeTrack ?? {}, ["main_metric", "mainMetric"])
  );
  const fixedBudget = pickFirstString(
    asString(params.existingPacket?.fixed_budget),
    asString(params.existingPacket?.fixedBudget),
    inferResearchProgramBudgetText(researchProgram)
  );
  const integrationMechanism = readIdeaFragmentString(selectedIdeaFragment, [
    "integration_mechanism",
    "integrationMechanism",
  ]);
  const ablationPlan = uniqueStrings([
    ...asStringArray(params.existingPacket?.ablation_plan),
    ...asStringArray(params.existingPacket?.ablationPlan),
    ...asStringArray(researchProgram.ablation_plan),
    ...asStringArray(researchProgram.ablationPlan),
    baseline && integrationMechanism
      ? `Compare ${baseline} against ${integrationMechanism} under the fixed budget.`
      : null,
  ].filter((entry): entry is string => Boolean(entry)));
  const riskFlags = uniqueStrings([
    ...asStringArray(params.existingPacket?.risk_flags),
    ...asStringArray(params.existingPacket?.riskFlags),
    baseline ? null : "baseline_missing",
    primaryMetric ? null : "primary_metric_missing",
    fixedBudget ? null : "fixed_budget_missing",
    supportingKgNodes.length > 0 ? null : "kg_node_trace_missing",
  ].filter((entry): entry is string => Boolean(entry)));
  const ready =
    Boolean(baseline && primaryMetric && fixedBudget) &&
    supportingPapers.length > 0 &&
    supportingKgNodes.length > 0;

  return {
    ...(params.existingPacket ?? {}),
    contract_version: "innovation-packet-v1",
    status: ready ? "ready" : "incomplete",
    generated_from: "idea_catalyst_contract",
    selected_idea_fragment_id: selectedIdeaFragmentId,
    supporting_idea_fragment_ids: uniqueStrings([
      selectedIdeaFragmentId,
      ...asStringArray(params.existingPacket?.supporting_idea_fragment_ids),
      ...asStringArray(params.existingPacket?.supportingIdeaFragmentIds),
    ]),
    research_problem:
      pickString(researchProgram, ["problem_statement", "problemStatement", "goal"]) ??
      pickString(decomposition, ["core_challenge", "coreChallenge"]) ??
      readIdeaFragmentString(selectedIdeaFragment, ["target_challenge", "targetChallenge"]),
    target_domain:
      pickString(decomposition, ["fine_grained_domain", "fineGrainedDomain"]) ??
      pickString(bundle, ["target_domain", "targetDomain"]) ??
      pickString(params.mechanismBridgePacket ?? {}, ["target_domain", "targetDomain"]),
    target_challenge:
      readIdeaFragmentString(selectedIdeaFragment, ["target_challenge", "targetChallenge"]) ??
      pickString(challenge ?? {}, [
        "domain_specific_challenge_question",
        "domainSpecificChallengeQuestion",
      ]) ??
      pickString(decomposition, ["core_challenge", "coreChallenge"]),
    domain_agnostic_challenge:
      pickString(challenge ?? {}, [
        "domain_agnostic_challenge_question",
        "domainAgnosticChallengeQuestion",
      ]) ??
      pickString(question ?? {}, [
        "domain_agnostic_question",
        "domainAgnosticQuestion",
      ]),
    source_domains: sourceDomains,
    supporting_papers: supportingPapers,
    supporting_kg_nodes: supportingKgNodes,
    evidence_paths: evidencePaths,
    integration_rationale:
      readIdeaFragmentString(selectedIdeaFragment, [
        "selection_rationale",
        "integration_rationale",
        "integrationRationale",
      ]) ??
      pickString(sourceAnalyses[0] ?? {}, ["selection_rationale", "selectionRationale"]),
    hypothesis:
      readIdeaFragmentString(selectedIdeaFragment, [
        "challenge_resolution",
        "challengeResolution",
        "core_insight",
        "coreInsight",
      ]) ?? pickString(researchProgram, ["hypothesis"]),
    baseline,
    primary_metric: primaryMetric,
    fixed_budget: fixedBudget,
    ablation_plan: ablationPlan,
    risk_flags: riskFlags,
    trace: {
      idea_catalyst_packet_bundle_path: path.relative(
        params.projectRoot,
        params.ideaCatalystPacketBundlePath
      ),
      mechanism_bridge_packet_path: path.relative(
        params.projectRoot,
        params.mechanismBridgePacketPath
      ),
      challenge_insight_packet_path: path.relative(
        params.projectRoot,
        params.challengeInsightPacketPath
      ),
    },
    last_updated_at: nowIso(),
  };
}

function deriveBlockedInnovationPacket(params: {
  existingPacket: Record<string, unknown>;
  ideaCatalystContract: IdeaCatalystContract | null;
  ideaCatalystContractPath: string;
  projectRoot: string;
}): Record<string, unknown> {
  return {
    contract_version: "innovation-packet-v1",
    status: "blocked",
    generated_from: "idea_catalyst_contract",
    previous_status:
      normalizeStage(params.existingPacket.status) ??
      asString(params.existingPacket.status) ??
      null,
    previous_selected_idea_fragment_id:
      pickString(params.existingPacket, [
        "selected_idea_fragment_id",
        "selectedIdeaFragmentId",
      ]) ?? null,
    blocking_contract_path: path.relative(
      params.projectRoot,
      params.ideaCatalystContractPath
    ),
    graph_decision_path:
      params.ideaCatalystContract?.graph_decision_path ??
      DEFAULT_GRAPH_BUILD_DECISION_PATH,
    superseded_reason:
      params.ideaCatalystContract?.reason ??
      "Idea-Catalyst contract is not ready.",
    stale_packet_terminalized_at: nowIso(),
  };
}

function deriveBridgeEvidenceTierFromBundle(bundle: Record<string, unknown>) {
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const analyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const supportingPaperCount = analyses.reduce((sum, analysis) => {
    const direct = readPacketList(analysis, ["supporting_papers", "supportingPapers"]).length;
    const takeawayPapers = readRecordList(analysis.takeaways).reduce((inner, takeaway) => {
      return inner + readPacketList(takeaway, ["supporting_papers", "supportingPapers"]).length;
    }, 0);
    return sum + direct + takeawayPapers;
  }, 0);
  if (ideaFragments.length >= 2 || supportingPaperCount >= 6) {
    return "strong";
  }
  if (ideaFragments.length >= 1 || supportingPaperCount >= 2 || analyses.length >= 1) {
    return "moderate";
  }
  return "weak";
}

function deriveMechanismBridgePacketFromBundle(bundle: Record<string, unknown>) {
  const decomposition = asRecord(bundle.decomposition) ?? {};
  const crossDomainQueries = readRecordList(
    bundle.cross_domain_searches ?? bundle.cross_domain_queries
  );
  const sourceDomainAnalyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const candidateDomains = uniqueStrings([
    ...crossDomainQueries
      .map((entry) => pickString(entry, ["domain", "source_domain", "sourceDomain"]))
      .filter((entry): entry is string => Boolean(entry)),
    ...sourceDomainAnalyses
      .map((entry) => pickString(entry, ["source_domain", "sourceDomain", "domain"]))
      .filter((entry): entry is string => Boolean(entry)),
  ]);
  const selectedDomains = uniqueStrings(
    sourceDomainAnalyses
      .filter((entry) => {
        const takeaways = readRecordList(entry.takeaways);
        const supportingPapers = readPacketList(entry, ["supporting_papers", "supportingPapers"]);
        return takeaways.length > 0 || supportingPapers.length > 0;
      })
      .map((entry) => pickString(entry, ["source_domain", "sourceDomain", "domain"]))
      .filter((entry): entry is string => Boolean(entry))
  );
  const prunedDomains = uniqueStrings(
    candidateDomains.filter((domain) => !selectedDomains.includes(domain))
  );
  const transferBridges = uniqueStrings([
    ...sourceDomainAnalyses.flatMap((entry) => {
      const domain =
        pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
      const sharedMechanisms = readPacketList(entry, [
        "shared_mechanisms",
        "sharedMechanisms",
      ]).map((mechanism) => `${domain}:${mechanism}`);
      const takeawayConcepts = readRecordList(entry.takeaways)
        .map(
          (takeaway) =>
            pickString(takeaway, [
              "concept",
              "mechanism",
              "mechanism_explanation",
              "source_domain_formulation",
            ]) ?? null
        )
        .filter((value): value is string => Boolean(value))
        .map((value) => `${domain}:${value}`);
      return [...sharedMechanisms, ...takeawayConcepts];
    }),
    ...ideaFragments
      .map((entry) => {
        const domain =
          pickString(entry, ["source_domain", "sourceDomain"]) ?? "external";
        const ideaFragmentRecord = asRecord(entry.idea_fragment);
        const mechanism =
          pickString(entry, ["integration_mechanism", "integrationMechanism"]) ??
          pickString(ideaFragmentRecord ?? {}, [
            "integration_mechanism",
            "integrationMechanism",
          ]);
        return mechanism ? `${domain}:${mechanism}` : null;
      })
      .filter((value): value is string => Boolean(value)),
  ]);
  const bridgeNodes = sourceDomainAnalyses.flatMap((entry, analysisIndex) => {
    const domain =
      pickString(entry, ["source_domain", "sourceDomain", "domain"]) ?? "external";
    return readRecordList(entry.takeaways).map((takeaway, takeawayIndex) => ({
      node_id:
        pickString(takeaway, ["kg_node_id", "kgNodeId", "node_id", "nodeId"]) ??
        `bundle-${analysisIndex + 1}-${takeawayIndex + 1}`,
      node_name:
        pickString(takeaway, [
          "concept",
          "source_domain_formulation",
          "mechanism",
          "mechanism_explanation",
        ]) ?? `${domain} bridge takeaway`,
      domain,
      mechanism:
        pickString(takeaway, ["mechanism", "mechanism_explanation"]) ??
        readPacketList(entry, ["shared_mechanisms", "sharedMechanisms"])[0] ??
        null,
      properties: {
        abstract:
          pickString(takeaway, [
            "source_domain_formulation",
            "mechanism_explanation",
            "selection_rationale",
          ]) ?? null,
        evidenceText:
          pickString(takeaway, ["selection_rationale"]) ??
          pickString(entry, ["selection_rationale", "selectionRationale"]) ??
          pickString(entry, ["domain_rationale", "domainRationale"]) ??
          null,
        supporting_papers: readPacketList(takeaway, [
          "supporting_papers",
          "supportingPapers",
        ]),
        source_spans: readRecordList(takeaway.source_spans ?? takeaway.sourceSpans),
        evidence_chain_refs: readRecordList(
          takeaway.evidence_chain_refs ?? takeaway.evidenceChainRefs
        ),
      },
    }));
  });

  return {
    target_domain:
      pickString(decomposition, ["fine_grained_domain", "fineGrainedDomain"]) ??
      pickString(bundle, ["target_domain", "targetDomain"]) ??
      null,
    candidate_domains: candidateDomains,
    selected_domains: selectedDomains,
    pruned_domains: prunedDomains,
    bridge_evidence_tier: deriveBridgeEvidenceTierFromBundle(bundle),
    transfer_bridges: transferBridges,
    bridge_nodes: bridgeNodes,
    bridge_retrieval:
      asRecord(bundle.bridge_retrieval ?? bundle.bridgeRetrieval) ?? null,
    structural_analogy:
      asRecord(bundle.structural_analogy ?? bundle.structuralAnalogy) ?? null,
    interdisciplinary_potential_ranking:
      asRecord(
        bundle.interdisciplinary_potential_ranking ??
          bundle.interdisciplinaryPotentialRanking
      ) ?? null,
    interdisciplinary_ranking:
      asRecord(bundle.interdisciplinary_ranking ?? bundle.interdisciplinaryRanking) ??
      null,
    domain_distance_matrix:
      asRecord(bundle.domain_distance_matrix ?? bundle.domainDistanceMatrix) ?? null,
    domain_distance_policy:
      asRecord(bundle.domain_distance_policy ?? bundle.domainDistancePolicy) ?? null,
    source_domain_analyses: sourceDomainAnalyses,
    cross_domain_analysis: sourceDomainAnalyses,
    idea_fragments: ideaFragments,
    requisition_report:
      asRecord(bundle.requisition_report ?? bundle.requisitionReport) ?? null,
  };
}

function deriveChallengeInsightPacketFromBundle(bundle: Record<string, unknown>) {
  const decomposition = asRecord(bundle.decomposition) ?? {};
  const targetDomainAnalyses = readRecordList(bundle.target_domain_analysis);
  const sourceDomainAnalyses = readRecordList(
    bundle.source_domain_analyses ?? bundle.cross_domain_analysis
  );
  const ideaFragments = readRecordList(bundle.idea_fragments);
  const challengeClusters = uniqueStrings([
    ...readRecordList(decomposition.questions ?? decomposition.research_questions)
      .map((entry) =>
        pickString(entry, [
          "domain_specific_question",
          "domainSpecificQuestion",
          "question",
        ])
      )
      .filter((entry): entry is string => Boolean(entry)),
    ...targetDomainAnalyses.flatMap((entry) =>
      readRecordList(entry.remaining_challenges).map(
        (challenge) =>
          pickString(challenge, [
            "domain_specific_challenge_question",
            "domainSpecificChallengeQuestion",
            "name",
          ]) ?? null
      )
    ).filter((entry): entry is string => Boolean(entry)),
  ]);
  const insightClusters = uniqueStrings([
    ...ideaFragments
      .map((entry) => {
        const ideaFragmentRecord = asRecord(entry.idea_fragment);
        return (
          pickString(entry, ["core_insight", "coreInsight"]) ??
          pickString(ideaFragmentRecord ?? {}, ["core_insight", "coreInsight"])
        );
      })
      .filter((entry): entry is string => Boolean(entry)),
    ...sourceDomainAnalyses.flatMap((entry) =>
      readRecordList(entry.takeaways).map(
        (takeaway) =>
          pickString(takeaway, [
            "source_domain_formulation",
            "sourceDomainFormulation",
            "mechanism_explanation",
            "mechanismExplanation",
          ]) ?? null
      )
    ).filter((entry): entry is string => Boolean(entry)),
  ]);

  return {
    target_domain:
      pickString(decomposition, ["fine_grained_domain", "fineGrainedDomain"]) ??
      pickString(bundle, ["target_domain", "targetDomain"]) ??
      null,
    challenge_clusters: challengeClusters,
    insight_clusters: insightClusters,
    occupied_solution_zones: [],
  };
}

function mergeMechanismBridgePackets(
  base: Record<string, unknown> | null,
  derived: Record<string, unknown> | null
) {
  if (!base) return derived;
  if (!derived) return base;
  return {
    ...base,
    ...derived,
    target_domain:
      pickString(derived, ["target_domain", "targetDomain"]) ??
      pickString(base, ["target_domain", "targetDomain"]) ??
      null,
    candidate_domains: uniqueStrings([
      ...readPacketList(base, ["candidate_domains", "candidateDomains"]),
      ...readPacketList(derived, ["candidate_domains", "candidateDomains"]),
    ]),
    selected_domains: uniqueStrings([
      ...readPacketList(base, ["selected_domains", "selectedDomains"]),
      ...readPacketList(derived, ["selected_domains", "selectedDomains"]),
    ]),
    pruned_domains: uniqueStrings([
      ...readPacketList(base, ["pruned_domains", "prunedDomains"]),
      ...readPacketList(derived, ["pruned_domains", "prunedDomains"]),
    ]),
    transfer_bridges: uniqueStrings([
      ...readPacketList(base, ["transfer_bridges", "transferBridges"]),
      ...readPacketList(derived, ["transfer_bridges", "transferBridges"]),
    ]),
    bridge_evidence_tier:
      pickString(derived, ["bridge_evidence_tier", "bridgeEvidenceTier"]) ??
      pickString(base, ["bridge_evidence_tier", "bridgeEvidenceTier"]) ??
      null,
    bridge_nodes: [
      ...readRecordList(base.bridge_nodes),
      ...readRecordList(derived.bridge_nodes),
    ],
    bridge_retrieval:
      asRecord(derived.bridge_retrieval ?? derived.bridgeRetrieval) ??
      asRecord(base.bridge_retrieval ?? base.bridgeRetrieval) ??
      null,
    structural_analogy:
      asRecord(derived.structural_analogy ?? derived.structuralAnalogy) ??
      asRecord(base.structural_analogy ?? base.structuralAnalogy) ??
      null,
    interdisciplinary_potential_ranking:
      asRecord(
        derived.interdisciplinary_potential_ranking ??
          derived.interdisciplinaryPotentialRanking
      ) ??
      asRecord(
        base.interdisciplinary_potential_ranking ??
          base.interdisciplinaryPotentialRanking
      ) ??
      null,
    interdisciplinary_ranking:
      asRecord(derived.interdisciplinary_ranking ?? derived.interdisciplinaryRanking) ??
      asRecord(base.interdisciplinary_ranking ?? base.interdisciplinaryRanking) ??
      null,
    domain_distance_matrix:
      asRecord(derived.domain_distance_matrix ?? derived.domainDistanceMatrix) ??
      asRecord(base.domain_distance_matrix ?? base.domainDistanceMatrix) ??
      null,
    domain_distance_policy:
      asRecord(derived.domain_distance_policy ?? derived.domainDistancePolicy) ??
      asRecord(base.domain_distance_policy ?? base.domainDistancePolicy) ??
      null,
    source_domain_analyses: [
      ...readRecordList(base.source_domain_analyses ?? base.sourceDomainAnalyses),
      ...readRecordList(
        derived.source_domain_analyses ?? derived.sourceDomainAnalyses
      ),
    ],
    cross_domain_analysis: [
      ...readRecordList(base.cross_domain_analysis ?? base.crossDomainAnalysis),
      ...readRecordList(
        derived.cross_domain_analysis ?? derived.crossDomainAnalysis
      ),
    ],
    idea_fragments: [
      ...readRecordList(base.idea_fragments ?? base.ideaFragments),
      ...readRecordList(derived.idea_fragments ?? derived.ideaFragments),
    ],
    requisition_report:
      asRecord(derived.requisition_report ?? derived.requisitionReport) ??
      asRecord(base.requisition_report ?? base.requisitionReport) ??
      null,
  };
}

function mergeChallengeInsightPackets(
  base: Record<string, unknown> | null,
  derived: Record<string, unknown> | null
) {
  if (!base) return derived;
  if (!derived) return base;
  return {
    ...base,
    ...derived,
    target_domain:
      pickString(derived, ["target_domain", "targetDomain"]) ??
      pickString(base, ["target_domain", "targetDomain"]) ??
      null,
    challenge_clusters: uniqueStrings([
      ...readPacketList(base, ["challenge_clusters", "challengeClusters"]),
      ...readPacketList(derived, ["challenge_clusters", "challengeClusters"]),
    ]),
    insight_clusters: uniqueStrings([
      ...readPacketList(base, ["insight_clusters", "insightClusters"]),
      ...readPacketList(derived, ["insight_clusters", "insightClusters"]),
    ]),
    occupied_solution_zones: uniqueStrings([
      ...readPacketList(base, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ]),
      ...readPacketList(derived, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ]),
    ]),
  };
}

function deriveTransferBridges(packet: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...readPacketList(packet, ["transfer_bridges", "transferBridges"]),
    ...readStringListFromObjects(packet.bridge_nodes, [
      "bridge_label",
      "bridgeLabel",
      "label",
      "transfer_bridge",
      "transferBridge",
    ]),
    ...readStringListFromObjects(packet.bridge_nodes, ["node_name", "nodeName"]).map(
      (entry) => {
        const domain = readStringListFromObjects(packet.bridge_nodes, ["domain"]).find(
          () => true
        );
        return domain ? `${domain}:${entry}` : entry;
      }
    ),
  ]);
}

function buildKgStorylineMarkdown(packet: Record<string, unknown>) {
  const taskSummary =
    pickString(packet, ["task_summary", "taskSummary"]) ?? "unset";
  const challengeStatement =
    pickString(packet, ["challenge_statement", "challengeStatement"]) ?? "unset";
  const insightSummary =
    pickString(packet, ["insight_summary", "insightSummary"]) ?? "unset";
  const contributionBullets = readPacketList(packet, [
    "contribution_bullets",
    "contributionBullets",
  ]);
  const advantageBullets = readPacketList(packet, [
    "advantage_bullets",
    "advantageBullets",
  ]);
  const limitationBoundaries = readPacketList(packet, [
    "limitation_boundaries",
    "limitationBoundaries",
  ]);
  const relatedWorkTension = readPacketList(packet, [
    "related_work_tension",
    "relatedWorkTension",
  ]);
  const missingClaims = readPacketList(packet, ["missing_claims", "missingClaims"]);
  const renderBullets = (values: string[]) =>
    values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none";

  return `# KG Storyline Packet

## Task
${taskSummary}

## Challenge
${challengeStatement}

## Insight
${insightSummary}

## Contribution
${renderBullets(contributionBullets)}

## Advantage
${renderBullets(advantageBullets)}

## Related Work Tension
${renderBullets(relatedWorkTension)}

## Limitation Boundaries
${renderBullets(limitationBoundaries)}

## Missing Claims
${renderBullets(missingClaims)}
`;
}

function isAcceptedRequisitionSatisfactionReport(value: unknown): boolean {
  const report = asRecord(value);
  if (!report) {
    return false;
  }
  if (report.authority !== LITERATURE_REQUISITION_SATISFACTION_AUTHORITY) {
    return false;
  }
  const status = normalizeStage(report.status);
  const decision = normalizeStage(
    report.decision ?? report.satisfaction_decision ?? report.satisfactionDecision
  );
  const sourceBackedCount = Math.max(
    0,
    Math.floor(
      pickNumber(report, ["source_backed_count", "sourceBackedCount"]) ?? 0
    )
  );
  const evidenceGapClosed =
    report.evidence_gap_closed === true || report.evidenceGapClosed === true;
  return (
    (status === "valid" || status === "warning") &&
    (decision === "satisfied_remote_import_evidence" ||
      decision === "satisfied" ||
      decision === "complete" ||
      decision === "completed") &&
    sourceBackedCount > 0 &&
    evidenceGapClosed
  );
}

function collectRequisitionReportCandidates(params: {
  manifest: Record<string, unknown>;
  graphDecisionReportPath?: string | null;
}): string[] {
  const paperIngestion = asRecord(params.manifest.paper_ingestion) ?? {};
  const queuedRequests = readRecordList(
    paperIngestion.queued_requests ?? paperIngestion.queuedRequests
  );
  return uniqueStrings(
    [
      params.graphDecisionReportPath,
      ...queuedRequests
        .filter((request) => {
          const kind = normalizeStage(request.request_kind ?? request.requestKind);
          return kind === "requisition";
        })
        .map((request) =>
          pickString(request, [
            "validation_report_path",
            "validationReportPath",
            "satisfaction_report_path",
            "satisfactionReportPath",
          ])
        ),
    ].filter((entry): entry is string => Boolean(entry))
  );
}

async function readAcceptedRequisitionSatisfactionReport(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  graphDecisionReportPath?: string | null;
}): Promise<{ path: string; report: Record<string, unknown> } | null> {
  for (const relativePath of collectRequisitionReportCandidates(params)) {
    const resolved = resolveProjectArtifactPath(params.projectRoot, relativePath);
    const report = await readJsonIfExists<Record<string, unknown>>(resolved ?? "");
    if (isAcceptedRequisitionSatisfactionReport(report)) {
      return { path: relativePath, report: report as Record<string, unknown> };
    }
  }
  return null;
}

export async function materializePapernexusPacketContracts(params: {
  projectRoot: string;
  packetPaths?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath =
    resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ??
    path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const packetPaths = asRecord(params.packetPaths) ?? {};
  const generatedFiles: string[] = [];

  const mechanismBridgePacketPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["mechanismBridgePacketPath", "mechanism_bridge_packet_path"]) ??
        DEFAULT_MECHANISM_BRIDGE_PACKET_PATH
    ) ?? path.join(projectRoot, DEFAULT_MECHANISM_BRIDGE_PACKET_PATH);
  const challengeInsightPacketPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["challengeInsightPacketPath", "challenge_insight_packet_path"]) ??
        DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH
    ) ?? path.join(projectRoot, DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH);
  const graphStorylinePacketSourcePath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, ["graphStorylinePacketPath", "graph_storyline_packet_path"]) ??
        DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH
    ) ?? path.join(projectRoot, DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH);
  const ideaCatalystPacketBundlePath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, [
        "ideaCatalystPacketBundlePath",
        "idea_catalyst_packet_bundle_path",
      ]) ?? DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH
    ) ?? path.join(projectRoot, DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH);
  const innovationPacketPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, [
        "innovationPacketPath",
        "innovation_packet_path",
      ]) ?? DEFAULT_INNOVATION_PACKET_PATH
    ) ?? path.join(projectRoot, DEFAULT_INNOVATION_PACKET_PATH);
  const ideaCatalystContractPath =
    resolveProjectArtifactPath(
      projectRoot,
      pickString(packetPaths, [
        "ideaCatalystContractPath",
        "idea_catalyst_contract_path",
      ]) ?? DEFAULT_IDEA_CATALYST_CONTRACT_PATH
    ) ?? path.join(projectRoot, DEFAULT_IDEA_CATALYST_CONTRACT_PATH);

  const [rawMechanismBridgePacket, rawChallengeInsightPacket, graphStorylinePacket, rawIdeaCatalystPacketBundle, rawInnovationPacket, rawLiteraturePacket, rawLegacyIdeaFragments] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(mechanismBridgePacketPath),
      readJsonIfExists<Record<string, unknown>>(challengeInsightPacketPath),
      readJsonIfExists<Record<string, unknown>>(graphStorylinePacketSourcePath),
      readJsonIfExists<Record<string, unknown>>(ideaCatalystPacketBundlePath),
      readJsonIfExists<Record<string, unknown>>(innovationPacketPath),
      readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH)
      ),
      readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, DEFAULT_IDEA_CATALYST_FRAGMENTS_PATH)
      ),
    ]);
  const graphDecision = await readGraphBuildDecision(projectRoot);
  const acceptedRequisitionReport = await readAcceptedRequisitionSatisfactionReport({
    projectRoot,
    manifest,
    graphDecisionReportPath:
      graphDecision?.requisition_satisfaction_report_path ?? null,
  });
  const ideaCatalystPacketBundle = unwrapPacketBundle(rawIdeaCatalystPacketBundle);
  const ideaContractEvidence =
    collectIdeaContractEvidenceFromBundle(rawIdeaCatalystPacketBundle);
  const literatureContractEvidence =
    collectIdeaContractEvidenceFromLiteraturePacket(rawLiteraturePacket);
  const ideaFragments = [
    ...ideaContractEvidence.ideaFragments,
    ...collectLegacyIdeaFragments(rawLegacyIdeaFragments),
  ];
  const supportingPapers = uniqueStrings([
    ...ideaContractEvidence.supportingPapers,
    ...literatureContractEvidence.supportingPapers,
  ]);
  const sourceSpans = [
    ...ideaContractEvidence.sourceSpans,
    ...literatureContractEvidence.sourceSpans,
  ];
  const evidenceChainRefs = [
    ...ideaContractEvidence.evidenceChainRefs,
    ...literatureContractEvidence.evidenceChainRefs,
  ];
  const ideaPayloadReady =
    ideaFragments.length > 0 &&
    (supportingPapers.length > 0 ||
      sourceSpans.length > 0 ||
      evidenceChainRefs.length > 0);
  const ideaContractStatus =
    graphDecision?.decision !== "complete" || !graphDecision.source_backed_graph_claim
      ? "blocked"
      : !acceptedRequisitionReport
        ? "requisition"
        : !ideaPayloadReady
          ? "blocked"
          : "ready";
  await writeIdeaCatalystContract({
    projectRoot,
    status: ideaContractStatus,
    sourceRequisitionReportPath: acceptedRequisitionReport?.path ?? null,
    graphDecisionPath: graphDecision ? DEFAULT_GRAPH_BUILD_DECISION_PATH : null,
    literaturePacketPath: rawLiteraturePacket
      ? DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
      : null,
    payloadPaths: [
      rawIdeaCatalystPacketBundle
        ? path.relative(projectRoot, ideaCatalystPacketBundlePath)
        : null,
      rawLegacyIdeaFragments ? DEFAULT_IDEA_CATALYST_FRAGMENTS_PATH : null,
    ].filter((entry): entry is string => Boolean(entry)),
    ideaFragments,
    supportingPapers,
    sourceSpans,
    evidenceChainRefs,
    claimCap:
      sourceSpans.length > 0 ||
      evidenceChainRefs.length > 0
        ? "supported"
        : "hypothesis",
    reason:
      ideaContractStatus === "ready"
        ? "Graph decision, request-level literature satisfaction, and Idea-Catalyst payload evidence are linked."
        : !graphDecision
          ? "Graph build decision authority is missing."
          : graphDecision.decision !== "complete" ||
              !graphDecision.source_backed_graph_claim
            ? "Graph build decision is not complete with a source-backed graph claim."
            : !acceptedRequisitionReport
              ? "Accepted request-scoped requisition satisfaction report is missing."
              : "Idea-Catalyst payload evidence is missing or incomplete.",
    limitations:
      ideaContractStatus === "ready"
        ? []
        : [
            "Idea completion must wait for the contract cascade instead of reading raw literature or packet evidence directly.",
          ],
    now: nowIso(),
  });
  generatedFiles.push(path.relative(projectRoot, ideaCatalystContractPath));
  const ideaCatalystContract = await readIdeaCatalystContract(projectRoot);
  const derivedMechanismBridgePacket = ideaCatalystPacketBundle
    ? deriveMechanismBridgePacketFromBundle(ideaCatalystPacketBundle)
    : null;
  const derivedChallengeInsightPacket = ideaCatalystPacketBundle
    ? deriveChallengeInsightPacketFromBundle(ideaCatalystPacketBundle)
    : null;
  const mechanismBridgePacket = mergeMechanismBridgePackets(
    rawMechanismBridgePacket,
    derivedMechanismBridgePacket
  );
  const challengeInsightPacket = mergeChallengeInsightPackets(
    rawChallengeInsightPacket,
    derivedChallengeInsightPacket
  );

  if (ideaCatalystPacketBundle && mechanismBridgePacket) {
    await writeJsonEnsured(mechanismBridgePacketPath, mechanismBridgePacket);
    generatedFiles.push(path.relative(projectRoot, mechanismBridgePacketPath));
  }
  if (ideaCatalystPacketBundle && challengeInsightPacket) {
    await writeJsonEnsured(challengeInsightPacketPath, challengeInsightPacket);
    generatedFiles.push(path.relative(projectRoot, challengeInsightPacketPath));
  }
  const innovationPacket = deriveInnovationPacketFromBundle({
    manifest,
    existingPacket: rawInnovationPacket,
    bundle: ideaCatalystPacketBundle,
    ideaCatalystContract,
    ideaCatalystContractPath,
    mechanismBridgePacket,
    challengeInsightPacket,
    ideaCatalystPacketBundlePath,
    mechanismBridgePacketPath,
    challengeInsightPacketPath,
    projectRoot,
  });
  if (innovationPacket) {
    await writeJsonEnsured(innovationPacketPath, innovationPacket);
    generatedFiles.push(path.relative(projectRoot, innovationPacketPath));
  } else if (rawInnovationPacket && ideaCatalystContract?.status !== "ready") {
    await writeJsonEnsured(
      innovationPacketPath,
      deriveBlockedInnovationPacket({
        existingPacket: rawInnovationPacket,
        ideaCatalystContract,
        ideaCatalystContractPath,
        projectRoot,
      })
    );
    generatedFiles.push(path.relative(projectRoot, innovationPacketPath));
  }

  const currentIdeation = normalizeIdeationContractState(manifest.ideation_contract);
  const currentWriting = normalizeWritingContractState(manifest.writing_contract);
  const currentGraphGuidedWriting = normalizeGraphGuidedWritingState(
    manifest.graph_guided_writing
  );
  const currentIdeaCatalyst = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const currentPaperStory = normalizePaperStoryState(manifest.paper_story_state);
  const currentReviewPressure = normalizeReviewPressurePacketState(
    manifest.review_pressure_packet
  );

  const transferBridges = mechanismBridgePacket
    ? deriveTransferBridges(mechanismBridgePacket)
    : [];
  const candidateSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, [
        "candidate_domains",
        "candidateDomains",
        "source_domains",
        "sourceDomains",
      ])
    : [];
  const selectedSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, [
        "selected_domains",
        "selectedDomains",
      ])
    : [];
  const prunedSourceDomains = mechanismBridgePacket
    ? readPacketList(mechanismBridgePacket, ["pruned_domains", "prunedDomains"])
    : [];
  const bridgeEvidenceTier = mechanismBridgePacket
    ? pickString(mechanismBridgePacket, [
        "bridge_evidence_tier",
        "bridgeEvidenceTier",
      ])
    : null;
  const challengeClusters = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, [
        "challenge_clusters",
        "challengeClusters",
      ])
    : [];
  const insightClusters = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, ["insight_clusters", "insightClusters"])
    : [];
  const occupiedSolutionZones = challengeInsightPacket
    ? readPacketList(challengeInsightPacket, [
        "occupied_solution_zones",
        "occupiedSolutionZones",
      ])
    : [];

  const nextIdeation = normalizeIdeationContractState({
    ...serializeIdeationContractState(currentIdeation),
    graph_ideation_indices: {
      ...serializeIdeationGraphIndicesState(currentIdeation.graphIdeationIndices),
      challenge_clusters: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.challengeClusters,
        ...challengeClusters,
      ]),
      insight_clusters: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.insightClusters,
        ...insightClusters,
      ]),
      occupied_solution_zones: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.occupiedSolutionZones,
        ...occupiedSolutionZones,
      ]),
      transfer_bridges: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.transferBridges,
        ...transferBridges,
      ]),
      candidate_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.candidateSourceDomains,
        ...candidateSourceDomains,
      ]),
      selected_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.selectedSourceDomains,
        ...selectedSourceDomains,
      ]),
      pruned_source_domains: uniqueStrings([
        ...currentIdeation.graphIdeationIndices.prunedSourceDomains,
        ...prunedSourceDomains,
      ]),
      bridge_evidence_tier:
        bridgeEvidenceTier ??
        currentIdeation.graphIdeationIndices.bridgeEvidenceTier,
      last_refresh_at: nowIso(),
      status:
        currentIdeation.status === "ready" ||
        challengeClusters.length > 0 ||
        insightClusters.length > 0 ||
        transferBridges.length > 0
          ? "ready"
          : currentIdeation.graphIdeationIndices.status,
    },
    last_updated_at: nowIso(),
  });
  manifest.ideation_contract = serializeIdeationContractState(nextIdeation);

  const nextIdeaCatalyst = normalizeIdeaCatalystState({
    ...serializeIdeaCatalystState(currentIdeaCatalyst),
    target_domain:
      pickString(mechanismBridgePacket ?? {}, ["target_domain", "targetDomain"]) ??
      pickString(graphStorylinePacket ?? {}, ["target_domain", "targetDomain"]) ??
      currentIdeaCatalyst.targetDomain,
    source_domains: uniqueStrings([
      ...currentIdeaCatalyst.sourceDomains,
      ...selectedSourceDomains,
    ]),
    bridge_count:
      transferBridges.length > 0
        ? transferBridges.length
        : currentIdeaCatalyst.bridgeCount,
    last_updated_at: nowIso(),
  });
  manifest.idea_catalyst = serializeIdeaCatalystState(nextIdeaCatalyst);

  if (graphStorylinePacket) {
    const kgStorylinePacketPath =
      resolveProjectArtifactPath(
        projectRoot,
        pickString(packetPaths, [
          "kgStorylinePacketPath",
          "kg_storyline_packet_path",
        ]) ?? DEFAULT_KG_STORYLINE_PACKET_PATH
      ) ?? path.join(projectRoot, DEFAULT_KG_STORYLINE_PACKET_PATH);
    await writeTextEnsured(
      kgStorylinePacketPath,
      buildKgStorylineMarkdown(graphStorylinePacket)
    );
    generatedFiles.push(path.relative(projectRoot, kgStorylinePacketPath));

    const totalHeadlineClaimCount = Math.max(
      0,
      Math.floor(
        pickNumber(graphStorylinePacket, [
          "total_headline_claim_count",
          "totalHeadlineClaimCount",
        ]) ?? 0
      )
    );
    const coveredHeadlineClaimCount = Math.max(
      0,
      Math.floor(
        pickNumber(graphStorylinePacket, [
          "covered_headline_claim_count",
          "coveredHeadlineClaimCount",
        ]) ?? totalHeadlineClaimCount
      )
    );
    const missingEvidenceClaims = readPacketList(graphStorylinePacket, [
      "missing_claims",
      "missingClaims",
    ]);
    const claimEvidencePacketPaths = readPacketList(graphStorylinePacket, [
      "claim_evidence_packet_paths",
      "claimEvidencePacketPaths",
    ]);
    const kgStatus =
      normalizeStage(
        graphStorylinePacket.kg_storyline_status ??
          graphStorylinePacket.kgStorylineStatus ??
          graphStorylinePacket.status
      ) ??
      (missingEvidenceClaims.length === 0 ? "ready" : "pending");

    const nextWriting = normalizeWritingContractState({
      ...serializeWritingContractState(currentWriting),
      kg_storyline_required:
        pickBoolean(graphStorylinePacket, [
          "kg_storyline_required",
          "kgStorylineRequired",
        ]) ?? true,
      kg_storyline_status: kgStatus,
      kg_storyline_packet_path: path.relative(projectRoot, kgStorylinePacketPath),
    });
    manifest.writing_contract = serializeWritingContractState(nextWriting);

    const nextGraphGuidedWriting = normalizeGraphGuidedWritingState({
      ...serializeGraphGuidedWritingState(currentGraphGuidedWriting),
      status: kgStatus,
      claim_evidence_packet_paths: uniqueStrings([
        ...currentGraphGuidedWriting.claimEvidencePacketPaths,
        ...claimEvidencePacketPaths,
      ]),
      covered_headline_claim_count:
        coveredHeadlineClaimCount || currentGraphGuidedWriting.coveredHeadlineClaimCount,
      total_headline_claim_count:
        totalHeadlineClaimCount || currentGraphGuidedWriting.totalHeadlineClaimCount,
      evidence_coverage_status:
        normalizeStage(
          graphStorylinePacket.evidence_coverage_status ??
            graphStorylinePacket.evidenceCoverageStatus
        ) ??
        (missingEvidenceClaims.length === 0 ? "covered" : "pending"),
      missing_evidence_claims: missingEvidenceClaims,
      last_updated_at: nowIso(),
      pending_reason:
        missingEvidenceClaims.length > 0
          ? "PaperNexus storyline packet still reports missing claim evidence."
          : null,
    });
    manifest.graph_guided_writing =
      serializeGraphGuidedWritingState(nextGraphGuidedWriting);

    const nextPaperStory = normalizePaperStoryState({
      ...serializePaperStoryState(currentPaperStory),
      last_updated_at: currentPaperStory.lastUpdatedAt ?? null,
    });
    manifest.paper_story_state = serializePaperStoryState(nextPaperStory);

    const nextReviewPressure = normalizeReviewPressurePacketState({
      ...serializeReviewPressurePacketState(currentReviewPressure),
      last_updated_at: currentReviewPressure.lastUpdatedAt ?? null,
    });
    manifest.review_pressure_packet =
      serializeReviewPressurePacketState(nextReviewPressure);
  }

  await writeJsonEnsured(manifestPath, manifest);

  return {
    state: {
      mechanismBridgePacketReady: Boolean(mechanismBridgePacket),
      challengeInsightPacketReady: Boolean(challengeInsightPacket),
      graphStorylinePacketReady: Boolean(graphStorylinePacket),
      ideaCatalystPacketBundleReady: Boolean(ideaCatalystPacketBundle),
      ideaCatalystContractReady: ideaCatalystContract?.status === "ready",
      innovationPacketReady:
        normalizeStage(innovationPacket?.status) === "ready",
      transferBridgeCount: transferBridges.length,
      selectedSourceDomainCount: selectedSourceDomains.length,
      bridgeEvidenceTier,
    },
    generatedFiles,
  };
}
