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
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
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
import { buildIdeaCatalystAbstractionPacket } from "./translator";

type IdeaCatalystCandidate = {
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
          interdisciplinary_novelty: normalizePairwiseVote(
            dimensions.interdisciplinary_novelty ??
              dimensions.interdisciplinaryNovelty
          ),
          interdisciplinary_usefulness: normalizePairwiseVote(
            dimensions.interdisciplinary_usefulness ??
              dimensions.interdisciplinaryUsefulness
          ),
          depth_of_integration: normalizePairwiseVote(
            dimensions.depth_of_integration ?? dimensions.depthOfIntegration
          ),
        },
      };
    });
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
  const challengeInsightPacketPath = resolveProjectArtifactPath(
    projectRoot,
    "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json"
  );
  const topicSummaryPath = resolveProjectArtifactPath(
    projectRoot,
    ideationContract.graphBasisPaths.topicSummaryPath
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
    mechanismBridgePacket,
    challengeInsightPacket,
    topicSummary,
    candidatePool,
    problemDecompositionText,
  ] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(graphPacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(mechanismBridgePacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(challengeInsightPacketPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(topicSummaryPath ?? ""),
      readJsonIfExists<Record<string, unknown>>(candidatePoolPath ?? ""),
      readTextIfExists(problemDecompositionPath),
    ]);

  const mergedGraphPacket: Record<string, unknown> = {
    ...(graphPacket ?? {}),
    ...(challengeInsightPacket ?? {}),
    ...(mechanismBridgePacket ?? {}),
    challenge_clusters:
      challengeInsightPacket?.challenge_clusters ??
      challengeInsightPacket?.challengeClusters ??
      graphPacket?.challenge_clusters ??
      graphPacket?.challengeClusters,
    candidate_domains:
      mechanismBridgePacket?.candidate_domains ??
      mechanismBridgePacket?.candidateDomains ??
      graphPacket?.candidate_domains ??
      graphPacket?.candidateDomains,
    selected_domains:
      mechanismBridgePacket?.selected_domains ??
      mechanismBridgePacket?.selectedDomains,
    pruned_domains:
      mechanismBridgePacket?.pruned_domains ??
      mechanismBridgePacket?.prunedDomains,
    transfer_bridges:
      mechanismBridgePacket?.transfer_bridges ??
      mechanismBridgePacket?.transferBridges ??
      graphPacket?.transfer_bridges ??
      graphPacket?.transferBridges,
    bridge_nodes:
      mechanismBridgePacket?.bridge_nodes ??
      mechanismBridgePacket?.bridgeNodes ??
      graphPacket?.bridge_nodes ??
      graphPacket?.bridgeNodes,
    domain_distance_matrix:
      mechanismBridgePacket?.domain_distance_matrix ??
      mechanismBridgePacket?.domainDistanceMatrix ??
      graphPacket?.domain_distance_matrix ??
      graphPacket?.domainDistanceMatrix,
    bridge_evidence_tier:
      mechanismBridgePacket?.bridge_evidence_tier ??
      mechanismBridgePacket?.bridgeEvidenceTier ??
      graphPacket?.bridge_evidence_tier ??
      graphPacket?.bridgeEvidenceTier,
  };

  const targetDomain =
    pickString(patch, ["target_domain", "targetDomain"]) ??
    pickString(mergedGraphPacket, ["target_domain", "targetDomain"]) ??
    pickString(topicSummary ?? {}, ["target_domain", "targetDomain"]) ??
    "Computer Science";
  const graphIndices = ideationContract.graphIdeationIndices;
  const challengeClusters = uniqueStrings([
    ...graphIndices.challengeClusters,
    ...markdownBulletsToList(problemDecompositionText).slice(0, 4),
  ]).slice(0, 6);
  const graphPacketTransferBridges = Array.isArray(
    graphPacket?.transfer_bridges ?? graphPacket?.transferBridges
  )
    ? ((graphPacket?.transfer_bridges ?? graphPacket?.transferBridges) as unknown[])
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

  const candidates: IdeaCatalystCandidate[] = Array.isArray(candidatePool?.candidates)
    ? (candidatePool.candidates as IdeaCatalystCandidate[])
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
  const shouldIntegrateFragments = gateDecision.decision === "brainstorm";
  const ideaFragmentsPacket = shouldIntegrateFragments
    ? buildIdeaCatalystIdeaFragments({
        candidates,
        sourceDomains,
        targetDomain,
        selectedTrackId: ideationContract.selectedTrackId,
        problemStatement: researchProgram.problemStatement,
        decompositionPacket,
        scoutingReport,
      })
    : null;
  const rankedFragmentsPacket =
    shouldIntegrateFragments && ideaFragmentsPacket
      ? buildIdeaCatalystRankedFragments(ideaFragmentsPacket, { llmJudgments })
      : null;

  const next = normalizeIdeaCatalystState({
    ...serializeIdeaCatalystState(current),
    ...patch,
    status: gateDecision.decision === "brainstorm" ? "ready" : "requisition",
    mode: "graph-first",
    micro_stage: gateDecision.decision === "brainstorm" ? "judging" : "gatekeeping",
    target_domain: targetDomain,
    source_domains: sourceDomains,
    bridge_count: bridgeNodeRecords.length,
    top_fragment_id: rankedFragmentsPacket?.ranking?.[0]?.fragment_id ?? null,
    requisition_required: gateDecision.decision !== "brainstorm",
    last_requisition_cycle:
      gateDecision.decision === "brainstorm"
        ? current.lastRequisitionCycle
        : pickString(requisitionRecord, [
            "requisition_id",
            "requisitionId",
          ]),
    requisition_retry_budget:
      gateDecision.decision === "brainstorm"
        ? current.requisitionRetryBudget
        : pickNumber(requisitionRecord, [
            "retry_budget",
            "retryBudget",
          ]),
    requisition_saturated: false,
    pending_reason: gateDecision.decision === "brainstorm" ? null : gateDecision.rationale,
    last_updated_at: nowIso(),
  });

  const ideationContractState = normalizeIdeationContractState(manifest.ideation_contract);
  manifest.ideation_contract = serializeIdeationContractState({
    ...ideationContractState,
    graphIdeationIndices: {
      ...ideationContractState.graphIdeationIndices,
      transferBridges: uniqueStrings([
        ...ideationContractState.graphIdeationIndices.transferBridges,
        ...bridgeNodeLabels,
      ]),
      candidateSourceDomains: uniqueStrings([
        ...ideationContractState.graphIdeationIndices.candidateSourceDomains,
        ...candidateSourceDomains,
      ]),
      selectedSourceDomains: selectedSourceDomains,
      prunedSourceDomains: prunedSourceDomains,
      bridgeEvidenceTier,
      lastRefreshAt: next.lastUpdatedAt,
    },
  });

  const resolvedPaths: Array<[string, Record<string, unknown> | null]> = [
    [next.decompositionPacketPath, decompositionPacket],
    [next.abstractionPacketPath, abstractionPacket],
    [next.scoutingReportPath, scoutingReport],
    [next.gateDecisionPath, gateDecision],
    [next.ideaFragmentsPath, ideaFragmentsPacket],
    [next.rankedFragmentsPath, rankedFragmentsPacket],
    [
      next.investigationRequisitionPath,
      gateDecision.decision === "brainstorm"
        ? null
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

  manifest.idea_catalyst = serializeIdeaCatalystState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state: next,
    ready: next.status === "ready",
    validationErrors: getIdeaCatalystValidationErrors(next),
    generatedFiles,
  };
}
