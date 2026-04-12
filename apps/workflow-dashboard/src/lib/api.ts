export type ProjectOverview = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  currentStageIndex: number | null;
  workflowLine: "experiment" | "survey";
  paperMode: string | null;
  surveyStatus: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  blockerLabel: string | null;
  blockerReason: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  source: "projects_state" | "manifest_fallback";
};

export type ProjectDetailSummary = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  workflowLine: "experiment" | "survey";
  paperMode: string | null;
  owner: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  updatedAt: string | null;
  blockingReason: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  surveyStatus: string | null;
  surveyTopic: string | null;
  surveyProgressSummary: string | null;
  papernexusPhase: string | null;
  papernexusProgressSummary: string | null;
  topTierVerdict: string | null;
  teamRoundLead: string | null;
  teamRoundActiveSessions: number | null;
  teamRoundLastClaimedTaskId: string | null;
  teamRoundLastCompletedTaskId: string | null;
  teamTaskGraphTaskCount: number | null;
  teamTaskGraphClaimableCount: number | null;
  teamTaskGraphBlockedCount: number | null;
  teamTaskGraphClaimedCount: number | null;
  teamTaskGraphVerifyingCount: number | null;
  teamTaskGraphNeedsRepairCount: number | null;
  teamTaskGraphSatisfiedCount: number | null;
  pendingHandoffCount: number;
  failedHandoffCount: number;
  unackedHandoffCount: number;
  repairQueueCount: number;
  staleClaimCount: number;
  capabilityWarnings: number;
  activeWriteScopeCount: number;
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
  evidenceBoard: {
    benchmarkProtocolStatus: string | null;
    benchmarkProtocolLocked: boolean;
    statisticalEvidenceStatus: string | null;
    statisticalEvidenceClaimStrength: string | null;
    venueCompetitionStatus: string | null;
    venueCompetitionGraphContextStatus: string | null;
    ablationEvidenceStatus: string | null;
    ablationEvidenceSufficiency: string | null;
    mechanismEvidenceStatus: string | null;
    mechanismEvidenceGraphContextStatus: string | null;
    reproducibilityPackStatus: string | null;
    reproducibilityEnvironmentStatus: string | null;
    cameraReadyEvidenceStatus: string | null;
    cameraReadyFiguresStatus: string | null;
    cameraReadyTablesStatus: string | null;
    cameraReadyCaptionsStatus: string | null;
    topTierVerdict: string | null;
    evidenceCloseoutStatus: string | null;
  };
  source: Array<"manifest" | "papernexus_progress" | "fallback">;
};

export type ArtifactDescriptor = {
  key:
    | "manifest"
    | "graph_progress"
    | "graph_presence"
    | "graph_status"
    | "runtime_mailbox"
    | "runtime_queue"
    | "runtime_sessions"
    | "runtime_events"
    | "runtime_trace"
    | "handoff_intents"
    | "handoff_events"
    | "handoff_receipts"
    | "repair_queue"
    | "agent_capabilities"
    | "write_scopes"
    | "inbound_turns"
    | "e2e_report"
    | "e2e_artifact_checklist"
    | "e2e_state_timeline";
  label: string;
  path: string;
  kind: "json" | "jsonl" | "markdown" | "text";
  exists: boolean;
};

export type RawArtifact = {
  path: string;
  kind: "json" | "jsonl" | "markdown" | "text";
  status: "ok" | "missing" | "invalid";
  content: string;
  metadata: {
    presentation: "pretty-json" | "rendered-source" | "recent-lines" | "plain-text";
    totalLines?: number;
    shownLines?: number;
    truncated?: boolean;
    truncationNote?: string | null;
    note?: string;
  };
};

export async function fetchProjectsOverview(): Promise<ProjectOverview[]> {
  return fetchJson<ProjectOverview[]>("/api/projects", "project overview");
}

export async function fetchProjectSummary(
  projectId: string,
): Promise<ProjectDetailSummary> {
  return fetchJson<ProjectDetailSummary>(
    `/api/projects/${projectId}/summary`,
    "project summary",
  );
}

export async function fetchProjectArtifacts(
  projectId: string,
): Promise<ArtifactDescriptor[]> {
  return fetchJson<ArtifactDescriptor[]>(
    `/api/projects/${projectId}/artifacts`,
    "project artifacts",
  );
}

export async function fetchProjectRawArtifact(
  projectId: string,
  artifactKey: ArtifactDescriptor["key"],
): Promise<RawArtifact> {
  return fetchJson<RawArtifact>(
    `/api/projects/${projectId}/raw/${artifactKey}`,
    "raw artifact",
  );
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load ${label} (${response.status})`);
  }

  return response.json() as Promise<T>;
}
