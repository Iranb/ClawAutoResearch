import { randomUUID } from "node:crypto";
import { asRecord, pickString, uniqueStrings } from "../workflow-guard-core/coercion";
import {
  normalizeIdeationContractState,
} from "../workflow-guard-state/ideation-contract";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import { readJsonIfExists, readTextIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeWorkflowControlContract } from "../workflow-control-contract.js";
import { loadTrackInnovationEvidence } from "../workflow-guard-track-evidence.js";

export const DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH =
  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json";

type ManifestLike = Record<string, unknown>;
type TrackEvidenceGap = {
  trackId: string;
  title: string | null;
  question: string | null;
  hypothesis: string | null;
  noveltyBasis: string | null;
  graphEvidencePath: string | null;
};

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

function normalizeGapKind(value: unknown): string | null {
  return normalizeStage(typeof value === "string" ? value : null);
}

function isExplicitLiteratureGapKind(value: string | null): boolean {
  return [
    "literature",
    "related_work",
    "citation",
    "bibliography",
    "source",
    "source_span",
    "graph_evidence",
    "paper_evidence",
    "mixed_literature",
  ].includes(value ?? "");
}

function isExplicitNonLiteratureGapKind(value: string | null): boolean {
  return [
    "experiment",
    "empirical",
    "benchmark",
    "metric",
    "measurement",
    "negative_result",
    "writing_scope",
    "claim_scope",
    "scope",
  ].includes(value ?? "");
}

function looksLikeExperimentEvidenceGap(value: string | null | undefined): boolean {
  const text = String(value ?? "").toLowerCase();
  if (!text) {
    return false;
  }
  const hasEmpiricalSignal =
    /\b(empirical|experiment|benchmark|ablation|metric|measurement|measured|run artifact|local run)\b/.test(
      text
    ) || /\bh[-\s]?score\b/.test(text);
  const hasUnsupportedResultSignal =
    /\b(no positive|no improvement|negative result|delta|benchmark claim|improvement claim|sota claim|unsupported)\b/.test(
      text
    );
  return hasEmpiricalSignal && hasUnsupportedResultSignal;
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
  const paperStoryRecord = asRecord(manifest.paper_story_state) ?? {};
  const explicitGapKind = normalizeGapKind(
    paperStoryRecord.claim_support_gap_kind ??
      paperStoryRecord.claimSupportGapKind ??
      paperStoryRecord.support_gap_kind ??
      paperStoryRecord.supportGapKind
  );
  if (isExplicitLiteratureGapKind(explicitGapKind)) {
    return true;
  }
  if (isExplicitNonLiteratureGapKind(explicitGapKind)) {
    return false;
  }
  if (looksLikeExperimentEvidenceGap(paperStory.pendingReason)) {
    return false;
  }
  const claimSupportStatus = normalizeStage(paperStory.claimSupportStatus) ?? "";
  if (claimSupportStatus === "unsupported") {
    return true;
  }
  if (paperStory.unsupportedClaimCount > 0) {
    return true;
  }
  return false;
}

function collectActiveTrackRecords(trackRegistry: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const tracks = Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [];
  return tracks
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => normalizeStage(pickString(entry, ["status"])) === "active");
}

function findProgramTrack(
  manifest: ManifestLike,
  trackId: string
): Record<string, unknown> | null {
  const researchProgram = asRecord(manifest.research_program);
  const tracks = Array.isArray(researchProgram?.tracks) ? researchProgram.tracks : [];
  return (
    tracks
      .map((entry) => asRecord(entry))
      .find(
        (entry) =>
          entry &&
          pickString(entry, ["track_id", "trackId"]) === trackId &&
          normalizeStage(pickString(entry, ["status"])) === "active"
      ) ?? null
  );
}

async function collectIdeaTrackEvidenceGaps(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<TrackEvidenceGap[]> {
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, "TRACK_REGISTRY.json") ?? ""
    )) ?? null;
  const activeTracks = collectActiveTrackRecords(trackRegistry);
  const gaps: TrackEvidenceGap[] = [];

  for (const track of activeTracks) {
    const trackId = pickString(track, ["track_id", "trackId"]);
    if (!trackId) {
      continue;
    }
    const evidence = await loadTrackInnovationEvidence({
      projectRoot: params.projectRoot,
      track,
    });
    if (evidence.presence !== "missing") {
      continue;
    }
    const programTrack = findProgramTrack(params.manifest, trackId);
    gaps.push({
      trackId,
      title:
        pickString(track, ["name", "title"]) ??
        pickString(programTrack ?? {}, ["name", "title"]),
      question:
        pickString(track, ["question"]) ??
        pickString(programTrack ?? {}, ["question"]),
      hypothesis:
        pickString(track, ["hypothesis"]) ??
        pickString(programTrack ?? {}, ["hypothesis"]),
      noveltyBasis:
        pickString(track, ["novelty_basis", "noveltyBasis"]) ??
        pickString(programTrack ?? {}, ["novelty_basis", "noveltyBasis"]),
      graphEvidencePath: evidence.graphEvidencePath,
    });
  }

  return gaps;
}

function buildIdeaTrackEvidenceQueries(params: {
  gaps: TrackEvidenceGap[];
  targetDomains: string[];
  baseline: string;
  primaryMetric: string;
}) {
  const domains = params.targetDomains.length > 0 ? params.targetDomains : ["current-domain"];
  return params.gaps
    .flatMap((gap) => {
      const lead =
        compactText(
          gap.question ?? gap.hypothesis ?? gap.title ?? gap.noveltyBasis,
          gap.trackId
        );
      const noveltyLead = compactText(gap.noveltyBasis ?? gap.hypothesis, lead);
      return [
        {
          domain: domains[0],
          rationale:
            `Acquire papers and graph nodes that let ${gap.trackId} close its story-facing innovation loop.`,
          query: `${lead} ${params.baseline} ${params.primaryMetric} related work graph evidence`,
        },
        {
          domain: domains[0],
          rationale:
            `Find bridge papers, node candidates, and relation patterns for ${gap.trackId}.`,
          query: `${noveltyLead} mechanism bridge node relation pattern paper`,
        },
      ];
    })
    .slice(0, 6);
}

export async function getWorkflowLiteratureDiscoveryNeed(params: {
  projectRoot: string;
  manifest: ManifestLike | null | undefined;
  stage: string | null;
}): Promise<{
  required: boolean;
  reason: "story_gap" | "idea_track_graph_evidence_gap" | null;
  trackEvidenceGaps: TrackEvidenceGap[];
}> {
  const manifest = params.manifest ?? {};
  const stage = normalizeStage(params.stage);
  if (!stage) {
    return {
      required: false,
      reason: null,
      trackEvidenceGaps: [],
    };
  }
  if (needsStoryGapLiteratureDiscovery({ manifest, stage })) {
    return {
      required: true,
      reason: "story_gap",
      trackEvidenceGaps: [],
    };
  }
  if (stage !== "idea") {
    return {
      required: false,
      reason: null,
      trackEvidenceGaps: [],
    };
  }
  const trackEvidenceGaps = await collectIdeaTrackEvidenceGaps({
    projectRoot: params.projectRoot,
    manifest,
  });
  return {
    required: trackEvidenceGaps.length > 0,
    reason: trackEvidenceGaps.length > 0 ? "idea_track_graph_evidence_gap" : null,
    trackEvidenceGaps,
  };
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
  const workflowControl = normalizeWorkflowControlContract(manifest.workflow_control);
  const originStage =
    normalizeStage(
      String(
        params.literatureDiscoveryMaterialization?.origin_stage ??
          params.literatureDiscoveryMaterialization?.originStage ??
          workflowControl?.stage ??
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

  const discoveryNeed = await getWorkflowLiteratureDiscoveryNeed({
    projectRoot,
    manifest,
    stage: originStage,
  });

  if (!discoveryNeed.required) {
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

  const packet: Record<string, unknown> =
    discoveryNeed.reason === "idea_track_graph_evidence_gap"
      ? {
          schema_version: 1,
          discovery_id: "idea-track-graph-evidence-gap",
          discovery_reason: "idea_track_graph_evidence_gap",
          trigger_kind: "idea_literature_discovery",
          target_question_ids: discoveryNeed.trackEvidenceGaps.map(
            (gap) => `track:${gap.trackId}`
          ),
          target_track_ids: discoveryNeed.trackEvidenceGaps.map((gap) => gap.trackId),
          target_domains: targetDomains,
          candidate_queries: buildIdeaTrackEvidenceQueries({
            gaps: discoveryNeed.trackEvidenceGaps,
            targetDomains,
            baseline,
            primaryMetric,
          }),
          candidate_papers: [],
          selected_papers: [],
          rejected_papers: [],
          selection_rationale:
            `Active ideation tracks still lack structural graph support; missing tracks=${discoveryNeed.trackEvidenceGaps
              .map((gap) => gap.trackId)
              .join(", ")}. ` +
            "Run a workflow-owned literature discovery pass so researcher can search broadly, stage PDFs/Markdown, and import the missing papers into the shared graph before continuing idea work.",
          evidence_gap_closed: false,
          next_action_suggestion:
            "Queue a workflow-owned literature discovery pass, let researcher collect and upload the missing papers, import them into the shared graph, rerun graph_build, then return to idea.",
          required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
          source_contracts: {
            track_registry: {
              missing_track_ids: discoveryNeed.trackEvidenceGaps.map((gap) => gap.trackId),
              graph_evidence_paths: uniqueStrings(
                discoveryNeed.trackEvidenceGaps
                  .map((gap) => gap.graphEvidencePath)
                  .filter((entry): entry is string => Boolean(entry))
              ),
            },
            research_program: {
              baseline_reference: researchProgram.baselineReference,
              primary_metric: researchProgram.primaryMetric,
            },
          },
          trigger: params.trigger ?? null,
          agent_id: params.agentId ?? null,
          last_updated_at: new Date().toISOString(),
          packet_id: randomUUID(),
        }
      : {
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
