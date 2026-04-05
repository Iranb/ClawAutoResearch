import { randomUUID } from "node:crypto";
import {
  normalizeIdeationContractState,
} from "../workflow-guard-state/ideation-contract";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import { readJsonIfExists, readTextIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

export const DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH =
  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json";

type ManifestLike = Record<string, unknown>;

function normalizeStage(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

function collectSignalLines(rawText: string | null | undefined): string[] {
  return String(rawText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => Boolean(line))
    .filter((line) => !/^#/.test(line))
    .filter((line) => !/^\|/.test(line))
    .slice(0, 6);
}

function collectClaimIds(rawText: string | null | undefined): string[] {
  return Array.from(
    new Set(String(rawText ?? "").match(/claim-[a-z0-9-]+/gi) ?? [])
  );
}

function compactText(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

export function needsStoryGapLiteratureDiscovery(params: {
  manifest: ManifestLike | null | undefined;
  stage: string | null;
}): boolean {
  const stage = normalizeStage(params.stage);
  if (!stage || !["review", "write", "submit"].includes(stage)) {
    return false;
  }
  const manifest = params.manifest ?? {};
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const reviewPressure = normalizeReviewPressurePacketState(manifest.review_pressure_packet);
  if (paperStory.status !== "ready" || reviewPressure.status !== "ready") {
    return false;
  }
  if (
    ["unsupported", "partial"].includes(
      normalizeStage(paperStory.claimSupportStatus) ?? ""
    )
  ) {
    return true;
  }
  return paperStory.unsupportedClaimCount > 0 || paperStory.partialClaimCount > 0;
}

export async function materializeLiteratureDiscoveryPacketImpl(params: {
  projectRoot: string;
  literatureDiscoveryMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  required: boolean;
  packetPath: string;
  packet: Record<string, unknown> | null;
}> {
  const projectRoot = params.projectRoot;
  const manifest =
    (await readJsonIfExists<ManifestLike>(
      resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ?? ""
    )) ?? {};
  const originStage =
    normalizeStage(
      String(
        params.literatureDiscoveryMaterialization?.origin_stage ??
          params.literatureDiscoveryMaterialization?.originStage ??
          manifest.current_stage ??
          ""
      )
    ) ?? "review";
  const packetPath =
    String(
      params.literatureDiscoveryMaterialization?.packet_path ??
        params.literatureDiscoveryMaterialization?.packetPath ??
        DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
    ) || DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH;

  if (!needsStoryGapLiteratureDiscovery({ manifest, stage: originStage })) {
    return {
      required: false,
      packetPath,
      packet: null,
    };
  }

  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const reviewPressure = normalizeReviewPressurePacketState(manifest.review_pressure_packet);
  const ideation = normalizeIdeationContractState(manifest.ideation_contract);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);

  const [
    challengeStatement,
    insightSummary,
    unsupportedClaims,
    limitationAudit,
    rejectionRiskTable,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.challengeStatementPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.insightSummaryPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.unsupportedClaimsPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, reviewPressure.limitationAuditPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.rejectionRiskTablePath)),
  ]);

  const targetDomains =
    ideation.graphIdeationIndices.selectedSourceDomains.length > 0
      ? ideation.graphIdeationIndices.selectedSourceDomains
      : ideation.graphIdeationIndices.candidateSourceDomains;
  const challengeLine =
    collectSignalLines(challengeStatement)[0] ??
    compactText(researchProgram.problemStatement, "story support gap");
  const insightLine =
    collectSignalLines(insightSummary)[0] ??
    "graph-grounded narrative support improvement";
  const limitationLine =
    collectSignalLines(limitationAudit)[0] ??
    collectSignalLines(unsupportedClaims)[0] ??
    "unsupported claim boundary remains open";
  const rejectionLine =
    collectSignalLines(rejectionRiskTable)[0] ??
    "review risk remains around unsupported story claims";
  const targetQuestionIds = collectClaimIds(unsupportedClaims);
  const primaryMetric = compactText(
    researchProgram.primaryMetric,
    "primary_metric"
  );
  const baseline = compactText(
    researchProgram.baselineReference,
    "baseline"
  );

  const packet: Record<string, unknown> = {
    schema_version: 1,
    discovery_id: `${originStage}-story-support-gap`,
    discovery_reason: `${originStage}_story_support_gap`,
    target_question_ids:
      targetQuestionIds.length > 0 ? targetQuestionIds : ["story-support-gap"],
    target_domains: targetDomains,
    candidate_queries: [
      {
        domain: targetDomains[0] ?? "current-domain",
        rationale: "Close the write/review-time challenge and limitation evidence gap.",
        query: `${challengeLine} ${baseline} ${primaryMetric} limitation evidence related work`,
      },
      {
        domain: targetDomains[0] ?? "current-domain",
        rationale: "Find contradiction, failure-case, or rebuttal evidence for unsupported claims.",
        query: `${insightLine} contradiction failure case unsupported claim ${primaryMetric}`,
      },
      {
        domain: targetDomains[0] ?? "current-domain",
        rationale: "Strengthen reviewer-facing rebuttal support and scope boundaries.",
        query: `${rejectionLine} rebuttal limitation boundary ${baseline}`,
      },
    ],
    candidate_papers: [],
    selected_papers: [],
    rejected_papers: [],
    selection_rationale:
      `Story support remains ${paperStory.claimSupportStatus}; unsupported=${paperStory.unsupportedClaimCount}, partial=${paperStory.partialClaimCount}. ` +
      "Run a structured literature discovery pass to close related-work, contradiction, and limitation evidence gaps before continuing write/review.",
    evidence_gap_closed: false,
    next_action_suggestion:
      `Queue a workflow-owned literature discovery pass, ingest the selected papers into the shared graph, rerun graph_build, then return to ${originStage}.`,
    required_stage_reentry: ["graph_build", originStage],
    source_contracts: {
      paper_story_state: {
        claim_support_status: paperStory.claimSupportStatus,
        challenge_statement_path: paperStory.challengeStatementPath,
        insight_summary_path: paperStory.insightSummaryPath,
        unsupported_claims_path: paperStory.unsupportedClaimsPath,
      },
      review_pressure_packet: {
        limitation_audit_path: reviewPressure.limitationAuditPath,
        reject_first_review_path: reviewPressure.rejectFirstReviewPath,
        novelty_attack_path: reviewPressure.noveltyAttackPath,
      },
    },
    trigger: params.trigger ?? null,
    agent_id: params.agentId ?? null,
    last_updated_at: new Date().toISOString(),
    packet_id: randomUUID(),
  };

  const resolvedPacketPath = resolveProjectArtifactPath(projectRoot, packetPath);
  if (!resolvedPacketPath) {
    throw new Error(`Could not resolve literature discovery packet path: ${packetPath}`);
  }
  await writeJsonEnsured(resolvedPacketPath, packet);
  return {
    required: true,
    packetPath,
    packet,
  };
}

export const materializeLiteratureDiscoveryPacket =
  materializeLiteratureDiscoveryPacketImpl;
