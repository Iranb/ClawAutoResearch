import { createHash } from "node:crypto";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

export type CrossDomainInspirationStatus =
  | "missing"
  | "configured"
  | "searching"
  | "evidence_ready"
  | "recontextualized"
  | "story_ready"
  | "partial"
  | "waived"
  | "blocked";

export type CrossDomainInspirationState = {
  status: CrossDomainInspirationStatus;
  enabled: boolean;
  targetDomain: string | null;
  targetProblem: string | null;
  preferredSourceDomains: string[];
  fallbackSourceDomains: string[];
  priorityConcepts: string[];
  minimumSourcesPerDomain: number;
  minimumBridgeNodes: number;
  minimumRecontextualizedFragments: number;
  maxRequisitionRounds: number;
  requisitionRound: number;
  paperNexusRetryBudget: number;
  allowPartialStoryUsage: boolean;
  allowSurveyTaxonomyEnrichmentWithEvidenceDebt: boolean;
  bridgeEvidencePath: string;
  conceptMapPath: string;
  recontextualizationPath: string;
  ideaFragmentPath: string;
  storylineBridgePath: string;
  evidenceDebtPath: string;
  missingDomains: string[];
  satisfiedDomains: string[];
  waivedBy: string | null;
  waiverReason: string | null;
  blockedReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_CROSS_DOMAIN_SOURCE_DOMAINS = [
  "Neuroscience",
  "Cognitive Science",
  "Psychology",
];

export const DEFAULT_CROSS_DOMAIN_FALLBACK_DOMAINS = [
  "Control Theory",
  "Sociology",
  "Behavioral Science",
  "Education",
  "Philosophy",
];

export const DEFAULT_CROSS_DOMAIN_PRIORITY_CONCEPTS = [
  "dual-process theory",
  "System 1 and System 2",
  "fast and slow thinking",
  "cognitive control",
  "metacognition",
  "predictive processing",
  "attention gating",
  "working memory",
  "confidence monitoring",
  "executive control",
];

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const stringValue = readString(entry);
    if (!stringValue || seen.has(stringValue)) {
      continue;
    }
    seen.add(stringValue);
    result.push(stringValue);
  }
  return result.length ? result : fallback;
}

function normalizeStatus(value: unknown): CrossDomainInspirationStatus {
  return value === "configured" ||
    value === "searching" ||
    value === "evidence_ready" ||
    value === "recontextualized" ||
    value === "story_ready" ||
    value === "partial" ||
    value === "waived" ||
    value === "blocked"
    ? value
    : "missing";
}

export function normalizeCrossDomainInspirationState(
  value: unknown
): CrossDomainInspirationState {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    status: normalizeStatus(record.status),
    enabled: readBoolean(record.enabled, true),
    targetDomain: readString(record.target_domain ?? record.targetDomain),
    targetProblem: readString(record.target_problem ?? record.targetProblem),
    preferredSourceDomains: readStringArray(
      record.preferred_source_domains ?? record.preferredSourceDomains,
      DEFAULT_CROSS_DOMAIN_SOURCE_DOMAINS
    ),
    fallbackSourceDomains: readStringArray(
      record.fallback_source_domains ?? record.fallbackSourceDomains,
      DEFAULT_CROSS_DOMAIN_FALLBACK_DOMAINS
    ),
    priorityConcepts: readStringArray(
      record.priority_concepts ?? record.priorityConcepts,
      DEFAULT_CROSS_DOMAIN_PRIORITY_CONCEPTS
    ),
    minimumSourcesPerDomain: readNumber(record.minimum_sources_per_domain, 2),
    minimumBridgeNodes: readNumber(record.minimum_bridge_nodes, 3),
    minimumRecontextualizedFragments: readNumber(
      record.minimum_recontextualized_fragments,
      2
    ),
    maxRequisitionRounds: readNumber(record.max_requisition_rounds, 2),
    requisitionRound: readNumber(record.requisition_round, 0),
    paperNexusRetryBudget: readNumber(record.paper_nexus_retry_budget, 2),
    allowPartialStoryUsage: readBoolean(record.allow_partial_story_usage, false),
    allowSurveyTaxonomyEnrichmentWithEvidenceDebt: readBoolean(
      record.allow_survey_taxonomy_enrichment_with_evidence_debt,
      true
    ),
    bridgeEvidencePath:
      readString(record.bridge_evidence_path) ??
      "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
    conceptMapPath:
      readString(record.concept_map_path) ??
      "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
    recontextualizationPath:
      readString(record.recontextualization_path) ??
      "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
    ideaFragmentPath:
      readString(record.idea_fragment_path) ??
      "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    storylineBridgePath:
      readString(record.storyline_bridge_path) ??
      "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    evidenceDebtPath:
      readString(record.evidence_debt_path) ??
      "researcher/ideation/CROSS_DOMAIN_EVIDENCE_DEBT.md",
    missingDomains: readStringArray(record.missing_domains, []),
    satisfiedDomains: readStringArray(record.satisfied_domains, []),
    waivedBy: readString(record.waived_by ?? record.waivedBy),
    waiverReason: readString(record.waiver_reason ?? record.waiverReason),
    blockedReason: readString(record.blocked_reason ?? record.blockedReason),
    lastUpdatedAt: readString(record.last_updated_at ?? record.lastUpdatedAt),
  };
}

export function serializeCrossDomainInspirationState(
  state: CrossDomainInspirationState
): Record<string, unknown> {
  return {
    status: state.status,
    enabled: state.enabled,
    target_domain: state.targetDomain,
    target_problem: state.targetProblem,
    preferred_source_domains: state.preferredSourceDomains,
    fallback_source_domains: state.fallbackSourceDomains,
    priority_concepts: state.priorityConcepts,
    minimum_sources_per_domain: state.minimumSourcesPerDomain,
    minimum_bridge_nodes: state.minimumBridgeNodes,
    minimum_recontextualized_fragments: state.minimumRecontextualizedFragments,
    max_requisition_rounds: state.maxRequisitionRounds,
    requisition_round: state.requisitionRound,
    paper_nexus_retry_budget: state.paperNexusRetryBudget,
    allow_partial_story_usage: state.allowPartialStoryUsage,
    allow_survey_taxonomy_enrichment_with_evidence_debt:
      state.allowSurveyTaxonomyEnrichmentWithEvidenceDebt,
    bridge_evidence_path: state.bridgeEvidencePath,
    concept_map_path: state.conceptMapPath,
    recontextualization_path: state.recontextualizationPath,
    idea_fragment_path: state.ideaFragmentPath,
    storyline_bridge_path: state.storylineBridgePath,
    evidence_debt_path: state.evidenceDebtPath,
    missing_domains: state.missingDomains,
    satisfied_domains: state.satisfiedDomains,
    waived_by: state.waivedBy,
    waiver_reason: state.waiverReason,
    blocked_reason: state.blockedReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function buildCrossDomainRequisitionIdempotencyKey(params: {
  projectId?: string | null;
  targetProblem?: string | null;
  missingDomains: string[];
  requisitionRound: number;
}): string {
  const targetProblemHash = createHash("sha256")
    .update(params.targetProblem ?? "unknown-problem")
    .digest("hex")
    .slice(0, 16);
  const missingDomainsHash = createHash("sha256")
    .update(params.missingDomains.join("|"))
    .digest("hex")
    .slice(0, 16);
  return [
    "cross_domain_evidence_missing",
    params.projectId ?? "unknown-project",
    targetProblemHash,
    missingDomainsHash,
    params.requisitionRound,
  ].join(":");
}

export function buildCrossDomainSearchQueries(
  state: CrossDomainInspirationState
): Array<{ domain: string; query: string; rationale: string }> {
  const targetChallenge = state.targetProblem ?? state.targetDomain ?? "target challenge";
  const domains = state.missingDomains.length
    ? state.missingDomains
    : state.preferredSourceDomains.filter(
        (domain) => !state.satisfiedDomains.includes(domain)
      );
  return domains.flatMap((domain) => [
    {
      domain,
      query: `${domain} cognitive control uncertainty decision making transferable principle ${targetChallenge}`,
      rationale: "Find source-domain control/uncertainty mechanisms that can transfer to the target problem.",
    },
    {
      domain,
      query: `dual-process theory fast slow thinking confidence monitoring ${targetChallenge}`,
      rationale: "Search for fast/slow decision mechanisms and confidence-aware correction.",
    },
    {
      domain,
      query: `metacognition error monitoring adaptive control ${targetChallenge}`,
      rationale: "Search for meta-control and error-monitoring mechanisms.",
    },
    {
      domain,
      query: `predictive processing attention gating uncertainty ${targetChallenge}`,
      rationale: "Search for predictive/attention gating mechanisms under uncertainty.",
    },
  ]);
}

export async function materializeCrossDomainInspirationRequisition(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  force?: boolean;
}) {
  const manifestPath =
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? "";
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const state = normalizeCrossDomainInspirationState(
    manifest.cross_domain_inspiration
  );
  const missingDomains = state.missingDomains.length
    ? state.missingDomains
    : state.preferredSourceDomains.filter(
        (domain) => !state.satisfiedDomains.includes(domain)
      );
  const nextRound = state.requisitionRound + 1;

  if (!params.force && state.requisitionRound >= state.maxRequisitionRounds) {
    const nextStatus =
      params.workflowLine === "survey" &&
      state.allowSurveyTaxonomyEnrichmentWithEvidenceDebt
        ? "partial"
        : "blocked";
    const debtPath = resolveProjectArtifactPath(params.projectRoot, state.evidenceDebtPath);
    if (debtPath) {
      await writeJsonEnsured(debtPath, {
        status: nextStatus,
        reason: "cross-domain requisition budget exhausted",
        missing_domains: missingDomains,
        satisfied_domains: state.satisfiedDomains,
        preferred_source_domains: state.preferredSourceDomains,
        priority_concepts: state.priorityConcepts,
        updated_at: new Date().toISOString(),
      });
    }
    const updated = normalizeCrossDomainInspirationState({
      ...serializeCrossDomainInspirationState(state),
      status: nextStatus,
      blocked_reason:
        nextStatus === "blocked"
          ? "Cross-domain evidence missing after max requisition rounds."
          : null,
      last_updated_at: new Date().toISOString(),
    });
    manifest.cross_domain_inspiration = serializeCrossDomainInspirationState(updated);
    await writeJsonEnsured(manifestPath, manifest);
    return {
      created: false,
      exhausted: true,
      state: updated,
      requisitionPath: null,
      evidenceDebtPath: state.evidenceDebtPath,
    };
  }

  const requisitionId = buildCrossDomainRequisitionIdempotencyKey({
    projectId: params.projectId,
    targetProblem: state.targetProblem,
    missingDomains,
    requisitionRound: nextRound,
  });
  const requisition = {
    requisition_id: requisitionId,
    discovery_id: requisitionId,
    target_domain: state.targetDomain,
    target_problem: state.targetProblem,
    discovery_reason:
      "Acquire workflow-owned cross-domain bridge evidence for idea/story formation.",
    missing_domains: missingDomains,
    preferred_source_domains: state.preferredSourceDomains,
    fallback_source_domains: state.fallbackSourceDomains,
    priority_concepts: state.priorityConcepts,
    minimum_sources_per_domain: state.minimumSourcesPerDomain,
    minimum_bridge_nodes: state.minimumBridgeNodes,
    minimum_recontextualized_fragments: state.minimumRecontextualizedFragments,
    target_question_ids: ["cross-domain-story-bridge"],
    target_domains: missingDomains,
    search_queries: buildCrossDomainSearchQueries({
      ...state,
      missingDomains,
    }),
    required_stage_reentry:
      params.workflowLine === "survey"
        ? ["survey_review", "write"]
        : ["graph_build", "frontier_mapping", "idea"],
    next_action_suggestion:
      "Run PaperNexus/literature discovery for missing source-domain evidence, then materialize bridge evidence and recontextualization.",
    trigger_kind: "cross_domain_literature_discovery",
    origin_stage: "idea",
    created_at: new Date().toISOString(),
  };
  const requisitionPath =
    resolveProjectArtifactPath(params.projectRoot, state.bridgeEvidencePath) ??
    "";
  const ideaRequisitionPath =
    resolveProjectArtifactPath(
      params.projectRoot,
      "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json"
    ) ?? requisitionPath;
  await writeJsonEnsured(ideaRequisitionPath, requisition);
  const updated = normalizeCrossDomainInspirationState({
    ...serializeCrossDomainInspirationState(state),
    status: "searching",
    requisition_round: nextRound,
    missing_domains: missingDomains,
    last_updated_at: new Date().toISOString(),
  });
  manifest.cross_domain_inspiration = serializeCrossDomainInspirationState(updated);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    created: true,
    exhausted: false,
    state: updated,
    requisition,
    requisitionPath: "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json",
    evidenceDebtPath: null,
  };
}

export async function materializeCrossDomainBridgeArtifacts(params: {
  projectRoot: string;
  evidenceItems?: Array<Record<string, unknown>>;
}) {
  const manifestPath =
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? "";
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const state = normalizeCrossDomainInspirationState(
    manifest.cross_domain_inspiration
  );
  const evidenceItems = params.evidenceItems ?? [];
  const bridgePath = resolveProjectArtifactPath(params.projectRoot, state.bridgeEvidencePath);
  const conceptMapPath = resolveProjectArtifactPath(params.projectRoot, state.conceptMapPath);
  const recontextualizationPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.recontextualizationPath
  );
  if (bridgePath) {
    await writeJsonEnsured(bridgePath, {
      status: evidenceItems.length > 0 ? "evidence_ready" : state.status,
      preferred_source_domains: state.preferredSourceDomains,
      priority_concepts: state.priorityConcepts,
      bridge_evidence: evidenceItems,
      updated_at: new Date().toISOString(),
    });
  }
  if (conceptMapPath) {
    await writeTextEnsured(
      conceptMapPath,
      `# Neuro-Cognitive Concept Map

## Preferred Source Domains
${state.preferredSourceDomains.map((domain) => `- ${domain}`).join("\n")}

## Priority Concepts
${state.priorityConcepts.map((concept) => `- ${concept}`).join("\n")}
`
    );
  }
  if (recontextualizationPath) {
    await writeTextEnsured(
      recontextualizationPath,
      `# Cross-Domain Recontextualization

- target domain: ${state.targetDomain ?? "unset"}
- target problem: ${state.targetProblem ?? "unset"}

${evidenceItems
  .map((item, index) => {
    const bridgeId = item.bridgeId ?? item.bridge_id ?? `bridge-${index + 1}`;
    return `## ${bridgeId}
- source domain: ${item.sourceDomain ?? item.source_domain ?? "unknown"}
- source concept: ${item.sourceConcept ?? item.source_concept ?? "unknown"}
- transferable mechanism: ${item.transferableMechanism ?? item.transferable_mechanism ?? "pending"}
- recontextualized mechanism: ${item.recontextualizedMechanism ?? item.recontextualized_mechanism ?? "pending"}`;
  })
  .join("\n\n")}
`
    );
  }
  const updated = normalizeCrossDomainInspirationState({
    ...serializeCrossDomainInspirationState(state),
    status: evidenceItems.length > 0 ? "recontextualized" : state.status,
    satisfied_domains:
      evidenceItems.length > 0
        ? state.preferredSourceDomains.filter((domain) =>
            evidenceItems.some(
              (item) =>
                item.sourceDomain === domain ||
                item.source_domain === domain
            )
          )
        : state.satisfiedDomains,
    last_updated_at: new Date().toISOString(),
  });
  manifest.cross_domain_inspiration = serializeCrossDomainInspirationState(updated);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state: updated,
    generatedFiles: [
      state.bridgeEvidencePath,
      state.conceptMapPath,
      state.recontextualizationPath,
    ],
  };
}

export function evaluateCrossDomainInspirationGate(params: {
  state: CrossDomainInspirationState;
  workflowLine?: "experiment" | "survey";
  headlineClaim?: boolean;
}): {
  ready: boolean;
  status: CrossDomainInspirationStatus;
  blockers: string[];
  canContinueWithEvidenceDebt: boolean;
} {
  const state = params.state;
  if (!state.enabled) {
    return {
      ready: true,
      status: "waived",
      blockers: [],
      canContinueWithEvidenceDebt: true,
    };
  }
  if (state.status === "story_ready" || state.status === "recontextualized" || state.status === "waived") {
    return {
      ready: true,
      status: state.status,
      blockers: [],
      canContinueWithEvidenceDebt: state.status === "waived",
    };
  }
  if (state.status === "partial") {
    const canContinue =
      params.workflowLine === "survey"
        ? state.allowSurveyTaxonomyEnrichmentWithEvidenceDebt
        : params.headlineClaim !== true && state.allowPartialStoryUsage;
    return {
      ready: canContinue,
      status: "partial",
      blockers: canContinue
        ? []
        : ["Cross-domain evidence is partial and cannot support a headline claim."],
      canContinueWithEvidenceDebt: canContinue,
    };
  }
  const missing = state.missingDomains.length
    ? state.missingDomains
    : state.preferredSourceDomains.filter(
        (domain) => !state.satisfiedDomains.includes(domain)
      );
  return {
    ready: false,
    status: state.status,
    blockers: [
      `Cross-domain source evidence is incomplete for: ${missing.join(", ") || "preferred domains"}.`,
    ],
    canContinueWithEvidenceDebt:
      params.workflowLine === "survey" &&
      state.allowSurveyTaxonomyEnrichmentWithEvidenceDebt &&
      state.requisitionRound >= state.maxRequisitionRounds,
  };
}

export async function getCrossDomainInspirationStateSummary(params: {
  projectRoot: string;
  workflowLine?: "experiment" | "survey";
  headlineClaim?: boolean;
}) {
  const manifestPath =
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? "";
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const state = normalizeCrossDomainInspirationState(
    manifest.cross_domain_inspiration
  );
  return {
    state,
    gate: evaluateCrossDomainInspirationGate({
      state,
      workflowLine: params.workflowLine,
      headlineClaim: params.headlineClaim,
    }),
  };
}

export async function setCrossDomainInspirationState(params: {
  projectRoot: string;
  patch: Record<string, unknown>;
}) {
  const manifestPath =
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ?? "";
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeCrossDomainInspirationState(
    manifest.cross_domain_inspiration
  );
  const next = normalizeCrossDomainInspirationState({
    ...serializeCrossDomainInspirationState(current),
    ...params.patch,
    last_updated_at: new Date().toISOString(),
  });
  manifest.cross_domain_inspiration = serializeCrossDomainInspirationState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state: next,
    gate: evaluateCrossDomainInspirationGate({ state: next }),
  };
}
