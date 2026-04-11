import path from "node:path";

import { readJsonIfExists } from "../workflow-guard-core/fs";
import { summarizeEvidenceCloseoutState } from "../workflow-evidence/closeout-summary";
import {
  normalizeAblationEvidenceState,
  normalizeBenchmarkProtocolState,
  normalizeCameraReadyEvidenceState,
  normalizeMechanismEvidenceState,
  normalizeOpportunityScorecardState,
  normalizeReproducibilityPackState,
  normalizeStatisticalEvidenceState,
  normalizeVenueCompetitionState,
} from "../workflow-evidence/contracts";
import {
  readWorkflowTaskGraphStore,
  summarizeWorkflowTaskGraphStore,
} from "../workflow-team/task-graph";
import {
  readWorkflowTeamRoundStore,
  summarizeWorkflowTeamRoundStore,
} from "../workflow-team/team-round";

type ManifestLike = Record<string, unknown>;

export async function readWorkflowDashboardSummary(projectRoot: string): Promise<{
  evidenceCloseout: ReturnType<typeof summarizeEvidenceCloseoutState>;
  evidenceBoard: {
    benchmarkProtocol: ReturnType<typeof normalizeBenchmarkProtocolState>;
    statisticalEvidence: ReturnType<typeof normalizeStatisticalEvidenceState>;
    venueCompetition: ReturnType<typeof normalizeVenueCompetitionState>;
    ablationEvidence: ReturnType<typeof normalizeAblationEvidenceState>;
    mechanismEvidence: ReturnType<typeof normalizeMechanismEvidenceState>;
    reproducibilityPack: ReturnType<typeof normalizeReproducibilityPackState>;
    cameraReadyEvidence: ReturnType<typeof normalizeCameraReadyEvidenceState>;
    opportunityScorecard: ReturnType<typeof normalizeOpportunityScorecardState>;
  };
  teamTaskGraph: ReturnType<typeof summarizeWorkflowTaskGraphStore>;
  taskBoard: Array<{
    taskId: string;
    title: string;
    owner: string | null;
    status: string;
    claimant: string | null;
    dependsOn: string[];
    verificationStatus: string;
    latestEvent: string | null;
    latestEventAt: string | null;
  }>;
  teamRound: ReturnType<typeof summarizeWorkflowTeamRoundStore> & {
    leadRole: string | null;
    lastClaimedTaskId: string | null;
    lastCompletedTaskId: string | null;
  };
}> {
  const manifest = await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"));
  const evidenceBoard = {
    benchmarkProtocol: normalizeBenchmarkProtocolState(
      manifest?.benchmark_protocol ?? manifest?.benchmarkProtocol
    ),
    statisticalEvidence: normalizeStatisticalEvidenceState(
      manifest?.statistical_evidence ?? manifest?.statisticalEvidence
    ),
    venueCompetition: normalizeVenueCompetitionState(
      manifest?.venue_competition ?? manifest?.venueCompetition
    ),
    ablationEvidence: normalizeAblationEvidenceState(
      manifest?.ablation_evidence ?? manifest?.ablationEvidence
    ),
    mechanismEvidence: normalizeMechanismEvidenceState(
      manifest?.mechanism_evidence ?? manifest?.mechanismEvidence
    ),
    reproducibilityPack: normalizeReproducibilityPackState(
      manifest?.reproducibility_pack ?? manifest?.reproducibilityPack
    ),
    cameraReadyEvidence: normalizeCameraReadyEvidenceState(
      manifest?.camera_ready_evidence ?? manifest?.cameraReadyEvidence
    ),
    opportunityScorecard: normalizeOpportunityScorecardState(
      manifest?.opportunity_scorecard ?? manifest?.opportunityScorecard
    ),
  };
  const evidenceCloseout = summarizeEvidenceCloseoutState(manifest);
  const taskGraphStore = await readWorkflowTaskGraphStore(projectRoot);
  const teamRoundStore = await readWorkflowTeamRoundStore(projectRoot);
  return {
    evidenceCloseout,
    evidenceBoard,
    teamTaskGraph: summarizeWorkflowTaskGraphStore(taskGraphStore),
    taskBoard: (taskGraphStore?.tasks ?? []).map((task) => ({
      taskId: task.taskId,
      title: task.title,
      owner: task.owner,
      status: task.status,
      claimant: task.lease?.role ?? task.lease?.sessionKey ?? null,
      dependsOn: task.dependsOn,
      verificationStatus: task.verificationStatus,
      latestEvent: task.latestEventSummary,
      latestEventAt: task.latestEventAt,
    })),
    teamRound: {
      ...summarizeWorkflowTeamRoundStore(teamRoundStore),
      leadRole: teamRoundStore?.leadRole ?? null,
      lastClaimedTaskId: teamRoundStore?.lastClaimedTaskId ?? null,
      lastCompletedTaskId: teamRoundStore?.lastCompletedTaskId ?? null,
    },
  };
}
