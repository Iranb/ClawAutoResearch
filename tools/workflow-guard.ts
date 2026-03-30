import { randomUUID } from "node:crypto";
import os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { appendWorkflowTraceEvent } from "./workflow-trace";
import {
  clearChannelProjectBinding,
  getChannelProjectBinding,
  listChannelProjectBindings,
  resolveProjectContext,
  setChannelProjectBinding,
  type ChannelProjectBindingPolicy,
  type ChannelProjectBindingRecord,
} from "./channel-project-bindings";
import {
  checkGraphPresenceForWorkflow,
  type GraphPresenceCheckResult,
  type GraphPresenceStatus,
} from "./graph-presence";
import {
  evaluateWorkflowAutoModeRisk,
  normalizeWorkflowAutoGateConfig,
  normalizeWorkflowAutoMode,
  resolveEffectiveWorkflowAutoMode,
  type WorkflowAutoGateConfig,
  type WorkflowEffectiveAutoMode,
  type WorkflowAutoMode,
} from "./workflow-auto-mode";
import { evaluateSubmitAutoGate } from "./workflow-auto-gate";
import { readAutoModeDiscussionStore } from "./workflow-auto-discussion";
import {
  normalizeWorkflowLobsterHandoffConfig,
  type WorkflowLobsterHandoffConfig,
} from "./lobster-handoff";
import {
  isWorkflowSubagentSessionKey,
  looksLikePapernexusHeavyCommand,
  looksLikePapernexusLiveGraphCliReadCommand,
} from "./workflow-subagent-sessions";
import {
  normalizePapernexusApiTokenSource,
  summarizePapernexusRemoteAccessConfig,
} from "./papernexus-secret";

export { checkGraphPresenceForWorkflow, type GraphPresenceCheckResult } from "./graph-presence";

export interface WorkflowGuardPolicy extends ChannelProjectBindingPolicy {
  allowWorkspaceFallback?: boolean;
  injectWorkflowContext?: boolean;
  enforceWorkflowBoundaries?: boolean;
  blockDiscordAgentMentions?: boolean;
  enableWorkflowMailbox?: boolean;
  heartbeatBackgroundChecks?: boolean;
  maxWorkflowInboxMessages?: number;
  agentContactCooldownSeconds?: number;
  defaultConferenceTemplatePath?: string;
  defaultJournalTemplatePath?: string;
  papernexusApiBaseUrl?: string;
  papernexusApiTokenEnv?: string;
  papernexusApiTokenSource?: string;
  papernexusApiTokenService?: string;
  papernexusApiTokenAccount?: string;
  papernexusApiTokenLookupTimeoutMs?: number;
  papernexusMineruHttpUrl?: string;
  autoMode?: WorkflowAutoMode;
  autoGate?: WorkflowAutoGateConfig;
  lobsterHandoff?: WorkflowLobsterHandoffConfig;
}

export interface WorkflowToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageChannel?: string;
  sandboxed?: boolean;
}

export interface WorkflowMailboxItem {
  id: string;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  kind: "handoff" | "blocker" | "request" | "note";
  priority: "low" | "normal" | "high";
  status: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt?: string;
}

type WorkflowMailboxStore = {
  schemaVersion: 1;
  updatedAt: string;
  messages: WorkflowMailboxItem[];
};

type WorkflowContactEvent = {
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
  createdAt: string;
};

type WorkflowContactStore = {
  schemaVersion: 1;
  updatedAt: string;
  events: WorkflowContactEvent[];
};

type WorkflowRole =
  | "researcher"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

type ManifestLike = Record<string, unknown>;
type TrackRegistryLike = Record<string, unknown>;

type RolePolicy = {
  allowedContacts: WorkflowRole[];
  allowedSpawns: WorkflowRole[];
  allowedProjectDirs: string[];
  allowedProjectFiles: string[];
  allowProjectsStateWrite?: boolean;
  writeScopeLabels: string[];
  backgroundTasks: string[];
};

type StageRequirement = {
  owner: WorkflowRole;
  nextStage: string;
};

type ProjectState = {
  projectRoot: string | null;
  projectId: string | null;
  projectResolutionSource: "channel_binding" | "env" | "none";
  channelBindingKey: string | null;
  channelBindingStorePath: string;
  channelBinding: ChannelProjectBindingRecord | null;
  manifest: ManifestLike | null;
  trackRegistry: TrackRegistryLike | null;
  mailbox: WorkflowMailboxStore | null;
  experimentLedger: ExperimentLedger | null;
};

type ExperimentPapernexusSync = {
  status: string | null;
  corpus: string | null;
  lastSyncedAt: string | null;
  nodeRefs: string[];
  notes: string | null;
};

type ExperimentLedgerEntry = {
  experimentId: string;
  trackId: string | null;
  name: string | null;
  kind: string | null;
  status: string | null;
  stage: string | null;
  hypothesis: string | null;
  configRef: string | null;
  summary: string | null;
  server: string | null;
  gpuId: string | null;
  screenName: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  lastUpdatedBy: string | null;
  decision: string | null;
  keyMetric: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  resultPaths: string[];
  evidencePointers: string[];
  failureSignature: string | null;
  notes: string[];
  metadata: Record<string, unknown> | null;
  papernexusSync: ExperimentPapernexusSync;
};

type ExperimentLedgerSummary = {
  activeExperimentIds: string[];
  lastCompletedExperimentId: string | null;
  lastFailedExperimentId: string | null;
  bestKnownConfigRef: string | null;
  lastDecisionSummary: string | null;
  papernexusSyncRequired: boolean;
  papernexusLastSyncAt: string | null;
};

type ExperimentLedger = {
  schemaVersion: number;
  projectId: string | null;
  updatedAt: string;
  summary: ExperimentLedgerSummary;
  experiments: ExperimentLedgerEntry[];
};

type ExperimentMemoryDigest = {
  experimentId: string;
  name: string | null;
  trackId: string | null;
  status: string | null;
  stage: string | null;
  decision: string | null;
  updatedAt: string | null;
  keyMetric: string | null;
  papernexusSyncStatus: string | null;
  failureSignature: string | null;
};

type IdleResearchState = {
  enabled: boolean;
  topic: string | null;
  objective: string | null;
  querySeeds: string[];
  preferredVenues: string[];
  maxPapersPerCycle: number;
  cooldownMinutes: number;
  lastRunAt: string | null;
  lastDigestPath: string | null;
  lastSourceUpdateAt: string | null;
  status: string;
  pendingReason: string | null;
  nextQueryHint: string | null;
  refreshGraphOnNewCorePapers: boolean;
  lastRoundNewCanonicalPapers: number;
  lastRoundNewCorePapers: number;
};

type InnovationReflectionState = {
  requiredAfterExperiments: boolean;
  status: string;
  lastReflectionAt: string | null;
  lastReflectionPath: string | null;
  reflectedThroughExperimentUpdateAt: string | null;
  reflectedExperimentIds: string[];
  pendingReason: string | null;
};

type BrainstormCycleOptionState = {
  optionId: string;
  title: string | null;
  summary: string | null;
  score: number | null;
  status: string | null;
  verdict: string | null;
};

type BrainstormCycleRoundState = {
  roundId: string;
  label: string | null;
  status: string | null;
  focus: string | null;
  options: BrainstormCycleOptionState[];
};

type BrainstormCycleState = {
  status: string;
  mode: string | null;
  topic: string | null;
  basisStage: string | null;
  trackId: string | null;
  rounds: BrainstormCycleRoundState[];
  selectedRoundId: string | null;
  selectedOptionId: string | null;
  selectedOptionTitle: string | null;
  selectedOptionScore: number | null;
  selectionMode: string | null;
  topicSummaryPath: string | null;
  researchBriefPath: string | null;
  brainstormBriefPath: string | null;
  logicChainPath: string | null;
  evidenceChainPath: string | null;
  reasoningTracePath: string | null;
  questionPacketPath: string | null;
  workingMemoryPath: string | null;
  synthesisPacketPath: string | null;
  reflectionChainPath: string | null;
  theoryBriefPath: string | null;
  storylineBriefPath: string | null;
  graphVersionSeen: string | null;
  importTaskIdsSeen: string[];
  latestRunAt: string | null;
  pendingReason: string | null;
};

type WritingMode = "conference" | "journal";

type TheorySupportState = {
  status: string;
  overallSignal: string | null;
  theoryStatePath: string | null;
  sourceTheoryNotePath: string | null;
  proofPacketDir: string | null;
  appendixPacketPath: string | null;
  mainTextProofStyle: string | null;
  bodyReady: boolean;
  theoremCount: number;
  lemmaCount: number;
  proofPacketCount: number;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type TheoryStateFile = {
  schema_version: number;
  status: string;
  overall_signal: string | null;
  source_theory_note_path: string | null;
  thesis: string | null;
  body_guidance: string | null;
  main_text_proof_style: string | null;
  theorem_candidates: TheoryObjectPacket[];
  lemma_packets: TheoryObjectPacket[];
  appendix_sections: TheoryAppendixSection[];
  pending_reason: string | null;
  updated_at: string | null;
};

type TheoryAppendixSection = {
  section_id: string;
  title: string;
  purpose: string | null;
  packet_ids: string[];
};

type TheoryObjectPacket = {
  packet_id: string;
  role: string;
  title: string | null;
  statement: string;
  short_result: string | null;
  body_safe: boolean;
  confidence: string | null;
  appendix_required: boolean;
  appendix_path: string | null;
  evidence_pointers: string[];
  assumptions: string[];
  derivation_outline: string[];
  caveats: string[];
  notes: string | null;
  source_claim_ids: string[];
  updated_at: string | null;
};

type WritingContractState = {
  paperMode: WritingMode | null;
  templateRequired: boolean;
  templatePath: string | null;
  projectTemplatePath: string | null;
  templateName: string | null;
  templateStatus: string;
  templateCopyStatus: string;
  bodyPageBudget: number | null;
  referencePageBudget: number | null;
  bodyWordTargetMin: number | null;
  bodyWordTargetMax: number | null;
  maxCoreIdeas: number;
  maxHeadlineClaims: number;
  mainTextProofStyle: string | null;
  proofAppendixRequired: boolean;
  proofAppendixPath: string | null;
  proofAppendixStatus: string;
  theoryNotePath: string | null;
  proofChecklist: string[];
  storylineSource: string | null;
  kgStorylineRequired: boolean;
  kgStorylineStatus: string;
  kgStorylinePacketPath: string | null;
  storylineChecklist: string[];
  requiredSections: string[];
  sectionOrder: string[];
  paragraphLogicChecklist: string[];
  paragraphLogicStatus: string;
  lastTemplateAppliedAt: string | null;
  lastParagraphLogicAuditAt: string | null;
  templateMappingPath: string | null;
  pendingReason: string | null;
};

type CitationIntegrityState = {
  enabled: boolean;
  verificationRequired: boolean;
  sourceOfTruth: string[];
  bibliographyPath: string | null;
  verificationReportPath: string | null;
  verificationStatus: string;
  allowedPlaceholderCount: number;
  unresolvedPlaceholderCount: number;
  verifiedCitationCount: number;
  suspiciousCitationCount: number;
  hallucinatedCitationCount: number;
  lastVerifiedAt: string | null;
  pendingReason: string | null;
};

type WritingSectionPacketState = {
  section: string;
  sectionClass: string | null;
  goal: string | null;
  allowedClaims: string[];
  requiredGraphEvidencePointers: string[];
  forbiddenUnsupportedClaims: string[];
  missingCitationPlaceholders: string[];
  requiredCitationCount: number;
  requiredFigureIds: string[];
  dependentSections: string[];
  stale: boolean;
  packetPath: string | null;
  draftPath: string | null;
  reviewPath: string | null;
  reviewVerdict: string | null;
  status: string;
  updatedAt: string | null;
};

type WritingSessionState = {
  status: string;
  currentSection: string | null;
  draftOrder: string[];
  finalizedSections: string[];
  compileSafeSections: string[];
  sectionPackets: Record<string, WritingSectionPacketState>;
  headlineClaimEvidenceStatus: string;
  graphEvidenceCoverageStatus: string;
  graphEvidenceCoverageSummary: string | null;
  citationPlanMode: string;
  externalScholarQueryMode: string;
  futureScholarVerificationSkill: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type ReviewSessionRubric = {
  originality: number | null;
  quality: number | null;
  clarity: number | null;
  significance: number | null;
  soundness: number | null;
  citationIntegrity: number | null;
  graphGroundedEvidenceSufficiency: number | null;
};

type ReviewSessionState = {
  status: string;
  stageScope: string | null;
  round: number;
  reviewPacketPath: string | null;
  graphEvidenceSummaryPath: string | null;
  latestReviewPath: string | null;
  verdict: string | null;
  rubric: ReviewSessionRubric;
  reviewerSummary: string | null;
  actionItems: string[];
  blockingArtifacts: string[];
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type GraphGuidedWritingState = {
  enabled: boolean;
  status: string;
  anchorIndexPath: string | null;
  frontierFiles: string[];
  literaturePath: string | null;
  claimEvidencePacketPaths: string[];
  requiredEvidencePointerCount: number;
  coveredHeadlineClaimCount: number;
  totalHeadlineClaimCount: number;
  evidenceCoverageStatus: string;
  missingEvidenceClaims: string[];
  citationSourceMode: string;
  scholarQueryReserved: boolean;
  scholarQuerySkillSlot: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type ExternalReviewState = {
  status: string;
  provider: string | null;
  reviewSkill: string | null;
  sourceLabel: string | null;
  submissionId: string | null;
  submittedPdfPath: string | null;
  externalReviewPath: string | null;
  reviewResponsePath: string | null;
  overallRecommendation: string | null;
  requiredAction: string | null;
  lastPolledAt: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type ExperimentSearchState = {
  status: string;
  currentMainStage: string | null;
  currentSubstage: string | null;
  frontierNodeIds: string[];
  bestNodeId: string | null;
  completedNodeIds: string[];
  failedNodeIds: string[];
  triedHyperparams: string[];
  completedAblations: string[];
  multiSeedStatus: string;
  evaluationSummaryPath: string | null;
  plotPackStatus: string;
  plotPackPath: string | null;
  stageProgressPath: string | null;
  checkpointPath: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type ResearchProgramTrackBudget = {
  gpuHours: number | null;
  maxRuns: number | null;
  maxDebugIterations: number | null;
};

type ResearchProgramTrackWriteScope = {
  allowedClaimIds: string[];
  allowedFigureIds: string[];
};

type ResearchProgramTrack = {
  trackId: string;
  priority: number | null;
  status: string;
  hypothesis: string | null;
  noveltyBasis: string | null;
  mainMetric: string | null;
  successThreshold: string | null;
  requiredBaselines: string[];
  requiredAblations: string[];
  requiredControls: string[];
  experimentStageMatrix: string[];
  budget: ResearchProgramTrackBudget;
  stopRules: string[];
  rollbackTriggers: string[];
  writeScope: ResearchProgramTrackWriteScope;
};

type ResearchProgramTask = {
  taskId: string;
  stage: string | null;
  trackId: string | null;
  owner: string | null;
  dependencies: string[];
  entryCriteria: string[];
  expectedOutputs: string[];
  retryBudget: number | null;
  exitCriteria: string[];
};

type ResearchProgramGlobalConstraints = {
  maxActiveTracks: number | null;
  mustRunMultiSeedBeforeAnalysis: boolean;
  mustRunPlotAggregationBeforeWrite: boolean;
};

type ResearchProgramState = {
  programVersion: number;
  status: string;
  goal: string | null;
  tracks: ResearchProgramTrack[];
  globalConstraints: ResearchProgramGlobalConstraints;
  taskGraph: ResearchProgramTask[];
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type OrchestrationState = {
  status: string;
  activeTicketId: string | null;
  stageRunId: string | null;
  currentOwner: string | null;
  nextOwner: string | null;
  nextTransitionCandidate: string | null;
  blockingCategory: string | null;
  blockingReason: string | null;
  retryBudgetRemaining: number | null;
  lastContractEvalAt: string | null;
  lastContractEvalResult: string | null;
  rollbackTargetStage: string | null;
  resumeCursor: string | null;
  lastUpdatedAt: string | null;
};

type WritePackageState = {
  status: string;
  assemblyStatus: string | null;
  assemblyMode: string | null;
  winningTrackIds: string[];
  claimEvidenceMatrixPath: string | null;
  narrativeReportPath: string | null;
  trackVerdictsPath: string | null;
  unsupportedClaimsPath: string | null;
  baselineSummaryPath: string | null;
  researchSummaryPath: string | null;
  ablationSummaryPath: string | null;
  evaluationSummaryPath: string | null;
  figurePackPath: string | null;
  tablePackPath: string | null;
  proofPacketDir: string | null;
  citationCandidatesPath: string | null;
  packageManifestPath: string | null;
  assemblyReportPath: string | null;
  sectionAssemblyQueuePath: string | null;
  sourceArtifactCount: number;
  derivedArtifactCount: number;
  assembledAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type PaperIngestionState = {
  runtimeStatus: string;
  waitingReason: string | null;
  importTaskIds: string[];
  lastImportTaskId: string | null;
  lastImportStatus: string | null;
  completedPapers: PaperIngestionCompletedPaper[];
  paperOperations: PaperIngestionPaperOperation[];
  graphVersionSeen: string | null;
  reconcileRequired: boolean;
  lastUpdatedAt: string | null;
};

type PaperIngestionCompletedPaper = {
  canonicalId: string | null;
  title: string | null;
  importTaskId: string | null;
};

type PaperIngestionPaperOperation = {
  canonicalId: string | null;
  title: string | null;
  importTaskId: string | null;
  phase: "import" | "graph";
  status: "queued" | "running" | "completed" | "timed_out" | "failed";
  timeoutSeconds: number | null;
  startedAt: string | null;
  deadlineAt: string | null;
  finishedAt: string | null;
  detail: string | null;
};

type PaperQcState = {
  status: string;
  compileStatus: string;
  compileRoundCount: number;
  chktexStatus: string;
  pageBudgetStatus: string;
  referenceStartPage: number | null;
  bodyPageCount: number | null;
  unusedFigureStatus: string;
  invalidFigureRefStatus: string;
  reflectionRoundCount: number;
  latestReportPath: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type CitationCollectionState = {
  status: string;
  progressPath: string | null;
  cacheBibPath: string | null;
  candidateCount: number;
  verifiedCount: number;
  suspiciousCount: number;
  hallucinatedCount: number;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type FigureQcState = {
  status: string;
  figureReviewPath: string | null;
  figureSelectionPath: string | null;
  duplicateFigureStatus: string;
  captionAlignmentStatus: string;
  textAlignmentStatus: string;
  selectionStatus: string;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type ReviewIssueCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

type ReviewIssueState = {
  issueId: string;
  lane: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  targetStage: string | null;
  targetArtifact: string | null;
  openedBy: string | null;
  owner: string | null;
  status: string | null;
  fixArtifactPaths: string[];
  verifiedAt: string | null;
  waiverReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReviewIssueTrackerState = {
  status: string;
  openCounts: ReviewIssueCounts;
  issueManifestPath: string | null;
  issues: ReviewIssueState[];
  lastReviewRound: number;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

export type WorkflowSnapshot = {
  projectRoot: string | null;
  projectId: string | null;
  projectResolutionSource: "channel_binding" | "env" | "none";
  channelProjectBindingsEnabled: boolean;
  channelProjectBindingKey: string | null;
  channelProjectBindingStorePath: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  currentMicroStage: string | null;
  ownerAgent: string | null;
  recommendedOwner: WorkflowRole | null;
  nextAction: string | null;
  resumeAction: string | null;
  blockingReason: string | null;
  allowedWriteScopes: string[];
  allowedContacts: WorkflowRole[];
  allowedSpawns: WorkflowRole[];
  missingStageSignals: string[];
  graphRefreshRequired: boolean;
  graphRefreshReason: string | null;
  graphLastBuiltAt: string | null;
  graphPresenceCheckedAt: string | null;
  graphPresenceStatus: string | null;
  graphPresenceReportPath: string | null;
  graphPresenceExpectedPapers: number | null;
  graphPresencePresentPapers: number | null;
  graphPresenceMissingPapers: number | null;
  paperIngestionRuntimeStatus: string | null;
  paperIngestionWaitingReason: string | null;
  paperIngestionImportTaskCount: number | null;
  paperIngestionLastImportStatus: string | null;
  paperIngestionGraphVersionSeen: string | null;
  paperIngestionReconcileRequired: boolean;
  paperSourceDir: string | null;
  graphSourceDir: string | null;
  defaultPapernexusSourceDir: string | null;
  defaultPapernexusIndexRoot: string | null;
  papernexusApiBaseUrl: string | null;
  papernexusApiTokenEnv: string | null;
  papernexusApiTokenSource: string | null;
  papernexusApiTokenService: string | null;
  papernexusApiTokenAccount: string | null;
  papernexusMineruHttpUrl: string | null;
  idleResearchEnabled: boolean;
  idleResearchTopic: string | null;
  idleResearchStatus: string | null;
  idleResearchDue: boolean;
  idleResearchCooldownMinutes: number | null;
  idleResearchLastRunAt: string | null;
  idleResearchNextDueAt: string | null;
  idleResearchDigestPath: string | null;
  experimentLedgerPath: string | null;
  experimentLedgerUpdatedAt: string | null;
  experimentSyncRequired: boolean;
  experimentPapernexusSyncStatus: string | null;
  innovationReflectionStatus: string | null;
  innovationReflectionDue: boolean;
  innovationReflectionLastAt: string | null;
  innovationReflectionPath: string | null;
  innovationReflectionPendingReason: string | null;
  brainstormCycleStatus: string | null;
  brainstormCycleTopic: string | null;
  brainstormCycleBasisStage: string | null;
  brainstormCycleTrackId: string | null;
  brainstormCycleGraphVersionSeen: string | null;
  brainstormCycleImportTaskCount: number | null;
  brainstormCycleChainBundleReady: boolean;
  brainstormCyclePendingReason: string | null;
  researchProgramStatus: string | null;
  researchProgramTrackCount: number | null;
  researchProgramActiveTrackCount: number | null;
  researchProgramPrimaryGoal: string | null;
  orchestrationStatus: string | null;
  orchestrationBlockingCategory: string | null;
  orchestrationNextTransitionCandidate: string | null;
  orchestrationRetryBudgetRemaining: number | null;
  orchestrationRollbackTargetStage: string | null;
  experimentSearchStatus: string | null;
  experimentSearchCurrentMainStage: string | null;
  experimentSearchCurrentSubstage: string | null;
  experimentSearchBestNodeId: string | null;
  experimentSearchMultiSeedStatus: string | null;
  experimentSearchPlotPackStatus: string | null;
  writePackageStatus: string | null;
  writePackageAssemblyStatus: string | null;
  writePackageAssemblyMode: string | null;
  writePackageWinningTrackCount: number | null;
  writePackageDerivedArtifactCount: number | null;
  writePackagePendingReason: string | null;
  theorySupportStatus: string | null;
  theorySupportSignal: string | null;
  theoryStatePath: string | null;
  theoryProofPacketDir: string | null;
  theoryAppendixPacketPath: string | null;
  theoryPacketCount: number | null;
  theoryBodyReady: boolean;
  theoryPendingReason: string | null;
  writingTemplateRequired: boolean;
  writingPaperMode: string | null;
  writingBodyPageBudget: number | null;
  writingReferencePageBudget: number | null;
  writingBodyWordTargetMin: number | null;
  writingBodyWordTargetMax: number | null;
    writingMaxCoreIdeas: number | null;
    writingMaxHeadlineClaims: number | null;
    writingTemplatePath: string | null;
    writingProjectTemplatePath: string | null;
    writingTemplateStatus: string | null;
    writingTemplateCopyStatus: string | null;
  writingTemplateMappingPath: string | null;
  mainTextProofStyle: string | null;
  proofAppendixRequired: boolean;
  proofAppendixPath: string | null;
  proofAppendixStatus: string | null;
  theoryNotePath: string | null;
  proofChecklist: string[];
  kgStorylineRequired: boolean;
  kgStorylineStatus: string | null;
  kgStorylinePacketPath: string | null;
  storylineSource: string | null;
  storylineChecklist: string[];
  writingRequiredSections: string[];
  writingSectionOrder: string[];
  paragraphLogicStatus: string | null;
  paragraphLogicChecklist: string[];
  writingContractPendingReason: string | null;
  citationVerificationRequired: boolean;
  citationVerificationStatus: string | null;
  citationVerificationReportPath: string | null;
  citationBibliographyPath: string | null;
  citationSourceOfTruth: string[];
  citationUnresolvedPlaceholderCount: number | null;
  citationAllowedPlaceholderCount: number | null;
  citationVerifiedCount: number | null;
  citationSuspiciousCount: number | null;
  citationHallucinatedCount: number | null;
  citationPendingReason: string | null;
  citationCollectionStatus: string | null;
  citationCollectionCandidateCount: number | null;
  citationCollectionVerifiedCount: number | null;
  citationCollectionSuspiciousCount: number | null;
  citationCollectionHallucinatedCount: number | null;
  writingSessionStatus: string | null;
  writingCurrentSection: string | null;
  writingDraftOrder: string[];
  writingFinalizedSections: string[];
  writingCompileSafeSections: string[];
  writingSectionPacketsReady: boolean;
  writingCurrentSectionReviewVerdict: string | null;
  writingGraphEvidenceCoverageStatus: string | null;
  writingGraphEvidenceCoverageSummary: string | null;
  reviewSessionStatus: string | null;
  reviewSessionStageScope: string | null;
  reviewSessionRound: number | null;
  reviewSessionVerdict: string | null;
  reviewSessionSummary: string | null;
  reviewRubricSummary: Record<string, number | null>;
  graphGuidedWritingStatus: string | null;
  graphGuidedWritingEvidenceCoverageStatus: string | null;
  graphGuidedWritingMissingEvidenceClaims: string[];
  graphGuidedWritingScholarReserved: boolean;
  graphGuidedWritingScholarSkillSlot: string | null;
  paperQcStatus: string | null;
  paperQcCompileStatus: string | null;
  paperQcChktexStatus: string | null;
  paperQcPageBudgetStatus: string | null;
  figureQcStatus: string | null;
  figureQcDuplicateFigureStatus: string | null;
  figureQcCaptionAlignmentStatus: string | null;
  figureQcTextAlignmentStatus: string | null;
  figureQcSelectionStatus: string | null;
  reviewIssueTrackerStatus: string | null;
  reviewIssueCriticalCount: number | null;
  reviewIssueHighCount: number | null;
  reviewIssueMediumCount: number | null;
  reviewIssueLowCount: number | null;
  reviewIssueSurfaceCount: number | null;
  reviewIssueSubmissionCount: number | null;
  externalReviewStatus: string | null;
  externalReviewRecommendation: string | null;
  externalReviewRequiredAction: string | null;
  recentExperiments: ExperimentMemoryDigest[];
  unreadMailbox: WorkflowMailboxItem[];
  backgroundTasks: string[];
};

export type FocusedPromptAssembly = {
  text: string;
  metadata: {
    sectionContextId: string | null;
    reviewLane: string | null;
    roundId: string | null;
    promptLayerProfile: {
      stable_policy: boolean;
      stage_local_state: boolean;
      primary_payload: boolean;
      supporting_evidence: boolean;
      reflection_delta: boolean;
    };
    promptPayloadSizes: Record<string, number>;
  };
};

type GateState = {
  currentStage: string | null;
  lastGate: string | null;
  gateStatus: string | null;
  gateType: string | null;
  gateTimestamp: string | null;
  autoProceed: boolean | null;
  confirmationRequestedAt: string | null;
  confirmationDeadlineAt: string | null;
  defaultAction: string | null;
  defaultActionReason: string | null;
  defaultActionExecutedAt: string | null;
  userOverrideReceivedAt: string | null;
  userOverrideValue: string | null;
  revisionCount: number | null;
  notes: string | null;
};

export type AutoIteratorAction = {
  kind: "drive_stage" | "background" | "wait_human" | "switch_project";
  stage: string | null;
  owner: WorkflowRole | null;
  summary: string;
  command: string | null;
  mailboxQueued: boolean;
  mailboxMessageId: string | null;
  cooldownRemainingSeconds: number | null;
  blocking: boolean;
};

export type AutoIteratorResult = {
  projectRoot: string | null;
  projectId: string | null;
  mode: string;
  configuredAutoMode: WorkflowAutoMode;
  effectiveAutoMode: WorkflowAutoMode;
  autoModeRiskLevel: WorkflowEffectiveAutoMode["riskLevel"];
  autoModeReasons: string[];
  autoModeRiskFingerprint: string | null;
  autoModeMitigationStatus: WorkflowEffectiveAutoMode["mitigationStatus"];
  autoModeMitigationRoundsStarted: number;
  autoModeMitigationRoundsRemaining: number;
  stageBefore: string | null;
  stageEffective: string | null;
  stageAfter: string | null;
  stageChanged: boolean;
  regressed: boolean;
  gateBlocking: boolean;
  gateReason: string | null;
  timedDefaultTriggered: boolean;
  missingStageSignals: string[];
  ownerBefore: string | null;
  ownerAfter: WorkflowRole | null;
  nextAction: string | null;
  resumeAction: string | null;
  blockingReason: string | null;
  graphPresenceCheck: GraphPresenceCheckResult | null;
  projectsStateUpdated: boolean;
  auditPath: string | null;
  recommendedActions: AutoIteratorAction[];
};

export type EnsuredWorkflowProject = {
  projectRoot: string;
  projectId: string;
  projectsRoot: string;
  title: string;
  created: boolean;
  manifestCreated: boolean;
  trackRegistryCreated: boolean;
  claimPolicyCreated: boolean;
  experimentLedgerCreated: boolean;
};

const DEFAULT_POLICY: Required<WorkflowGuardPolicy> = {
  allowWorkspaceFallback: false,
  injectWorkflowContext: true,
  enforceWorkflowBoundaries: true,
  blockDiscordAgentMentions: true,
  enableWorkflowMailbox: true,
  heartbeatBackgroundChecks: true,
  maxWorkflowInboxMessages: 6,
  agentContactCooldownSeconds: 300,
  projectsRoot: "",
  enableChannelProjectBindings: false,
  channelProjectBindingsPath: "",
  defaultConferenceTemplatePath: "",
  defaultJournalTemplatePath: "",
  papernexusApiBaseUrl: "",
  papernexusApiTokenEnv: "",
  papernexusApiTokenSource: "auto",
  papernexusApiTokenService: "papernexus-api-token",
  papernexusApiTokenAccount: "default",
  papernexusApiTokenLookupTimeoutMs: 2000,
  papernexusMineruHttpUrl: "",
  autoMode: normalizeWorkflowAutoMode(undefined),
  autoGate: normalizeWorkflowAutoGateConfig(undefined),
  lobsterHandoff: normalizeWorkflowLobsterHandoffConfig(undefined),
};

const WORKFLOW_ROLE_ORDER: WorkflowRole[] = [
  "researcher",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
  "cross-reviewer",
];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_WRITING_SECTION_ORDER = [
  "abstract",
  "introduction",
  "related_work",
  "method",
  "experiments",
  "conclusion",
];

const DEFAULT_PARAGRAPH_LOGIC_CHECKLIST = [
  "one_message_per_paragraph",
  "first_sentence_states_paragraph_role",
  "sentences_connect_by_cause_contrast_consequence_or_refinement",
  "closing_sentence_bridges_to_next_paragraph_or_section",
  "reverse_outline_each_section_before_finalize",
];

const DEFAULT_STORYLINE_CHECKLIST = [
  "one_clean_problem_gap_method_arc",
  "thesis_is_grounded_in_papernexus_kg",
  "every_headline_claim_maps_to_evidence_spine",
  "related_work_supports_gap_not_catalog_only",
  "limitations_boundary_is_explicit",
];

const DEFAULT_PROOF_CHECKLIST = [
  "derive_a_small_set_of_named_lemmas_from_supported_results",
  "keep_main_text_to_lemma_statements_and_consequences_only",
  "move_full_derivations_and_case_splits_to_appendix",
  "tie_every_formulaic_step_to_evidence_or_explicit_assumption",
  "mark_speculative_theory_as_conservative_mechanistic_interpretation",
];

const DEFAULT_CITATION_SOURCE_OF_TRUTH = [
  "dblp",
  "crossref",
  "datacite",
  "semantic_scholar",
];

const DEFAULT_EXPERIMENT_SEARCH_PATH = "researcher/EXPERIMENT_SEARCH.json";
const DEFAULT_CITATION_BIB_PATH = "academic_writer/paper/refs.bib";
const DEFAULT_CITATION_REPORT_PATH = "reviewer/CITATION_VERIFICATION.md";
const DEFAULT_CITATION_COLLECTION_PROGRESS_PATH =
  "academic_writer/citations_progress.json";
const DEFAULT_CACHED_CITATIONS_BIB_PATH = "academic_writer/cached_citations.bib";
const DEFAULT_KG_STORYLINE_PACKET_PATH = "academic_writer/KG_STORYLINE_PACKET.md";
const DEFAULT_WRITING_SECTION_PACKET_DIR = "academic_writer/section-packets";
const DEFAULT_REVIEW_PACKET_PATH = "reviewer/REVIEW_PACKET.json";
const DEFAULT_REVIEW_ISSUES_PATH = "reviewer/REVIEW_ISSUES.json";
const DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH = "reviewer/GRAPH_EVIDENCE_SUMMARY.md";
const DEFAULT_THEORY_STATE_PATH = "analyzer/THEORY_STATE.json";
const DEFAULT_THEORY_NOTE_PATH = "analyzer/THEORY_SUPPORT_NOTE.md";
const DEFAULT_PROOF_PACKET_DIR = "analyzer/proof-packets";
const DEFAULT_THEORY_APPENDIX_PLAN_PATH = "academic_writer/THEORY_APPENDIX_PLAN.md";
const DEFAULT_THEORY_APPENDIX_SECTION_PATH =
  "academic_writer/paper/sections/appendix_theory.tex";
const DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL = "future/literature-dehallucination";
const DEFAULT_PAPER_QC_REPORT_PATH = "academic_writer/PAPER_QC.md";
const DEFAULT_FIGURE_REVIEW_PATH = "reviewer/SURFACE_REVIEW.json";
const DEFAULT_FIGURE_SELECTION_PATH = "academic_writer/FIGURE_SELECTION.json";
const DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH =
  "reviewer/SUBMISSION_SIMULATION_REVIEW.json";
const DEFAULT_WRITE_PACKAGE_MANIFEST_PATH = "academic_writer/WRITE_PACKAGE.json";
const DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH =
  "academic_writer/WRITE_PACKAGE_ASSEMBLY_REPORT.json";
const DEFAULT_SECTION_ASSEMBLY_QUEUE_PATH =
  "academic_writer/SECTION_ASSEMBLY_QUEUE.json";
const DEFAULT_FIGURE_PACK_PATH = "academic_writer/FIGURE_PACK.json";
const DEFAULT_TABLE_PACK_PATH = "academic_writer/TABLE_PACK.json";
const DEFAULT_CITATION_CANDIDATES_PATH =
  "academic_writer/CITATION_CANDIDATES.json";
const DEFAULT_BRAINSTORM_CYCLE_DIR = "researcher/brainstorm-cycle";
const DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/TOPIC_SUMMARY.json`;
const DEFAULT_BRAINSTORM_RESEARCH_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/RESEARCH_BRIEF.json`;
const DEFAULT_BRAINSTORM_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/BRAINSTORM_BRIEF.json`;
const DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/LOGIC_CHAIN.md`;
const DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/EVIDENCE_CHAIN.md`;
const DEFAULT_BRAINSTORM_REASONING_TRACE_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REASONING_TRACE.jsonl`;
const DEFAULT_BRAINSTORM_QUESTION_PACKET_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/QUESTION_PACKET.md`;
const DEFAULT_BRAINSTORM_WORKING_MEMORY_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/WORKING_MEMORY.json`;
const DEFAULT_BRAINSTORM_SYNTHESIS_PACKET_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/SYNTHESIS_PACKET.md`;
const DEFAULT_BRAINSTORM_REFLECTION_CHAIN_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REFLECTION_CHAIN.json`;
const DEFAULT_BRAINSTORM_THEORY_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/THEORY_BRIEF.json`;
const DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH =
  `${DEFAULT_BRAINSTORM_CYCLE_DIR}/STORYLINE_BRIEF.json`;

type WritingModePreset = {
  mode: WritingMode;
  templateFile: string;
  templateName: string;
  bodyPageBudget: number;
  referencePageBudget: number;
  bodyWordTargetMin: number;
  bodyWordTargetMax: number;
  maxCoreIdeas: number;
  maxHeadlineClaims: number;
  requiredSections: string[];
  sectionOrder: string[];
};

const WRITING_MODE_PRESETS: Record<WritingMode, WritingModePreset> = {
  conference: {
    mode: "conference",
    templateFile: "conference-9p-body-2p-refs.md",
    templateName: "conference-9p-body-2p-refs",
    bodyPageBudget: 9,
    referencePageBudget: 2,
    bodyWordTargetMin: 5000,
    bodyWordTargetMax: 6500,
    maxCoreIdeas: 2,
    maxHeadlineClaims: 3,
    requiredSections: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    sectionOrder: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
  },
  journal: {
    mode: "journal",
    templateFile: "journal-12p-body-2p-refs.md",
    templateName: "journal-12p-body-2p-refs",
    bodyPageBudget: 12,
    referencePageBudget: 2,
    bodyWordTargetMin: 7000,
    bodyWordTargetMax: 9500,
    maxCoreIdeas: 2,
    maxHeadlineClaims: 4,
    requiredSections: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    sectionOrder: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
  },
};

const ROLE_POLICIES: Record<WorkflowRole, RolePolicy> = {
  researcher: {
    allowedContacts: [
      "orchestrator",
      "coder",
      "analyzer",
      "academic_writer",
      "reviewer",
      "cross-reviewer",
    ],
    allowedSpawns: [
      "orchestrator",
      "coder",
      "analyzer",
      "academic_writer",
      "reviewer",
      "cross-reviewer",
    ],
    allowedProjectDirs: ["researcher", "graph", "memory", "reviewer", "cross-reviewer"],
    allowedProjectFiles: ["PROJECT_MANIFEST.json", "TRACK_REGISTRY.json", "CLAIM_POLICY.md", "README.md"],
    allowProjectsStateWrite: true,
    writeScopeLabels: [
      "{PROJ}/PROJECT_MANIFEST.json",
      "{PROJ}/TRACK_REGISTRY.json",
      "{PROJ}/CLAIM_POLICY.md",
      "{PROJ}/README.md",
      "{PROJ}/researcher/",
      "{PROJ}/graph/",
      "{PROJ}/memory/",
      "{PROJ}/reviewer/",
      "{PROJ}/cross-reviewer/",
      "{PROJECTS_ROOT}/PROJECTS_STATE.json",
    ],
    backgroundTasks: [
      "Continue literature survey and venue sweeps with /research-lit or /papers-cool; if PASA is responsive, use /pasa-paper-search as a second retrieval source and merge by canonical identity.",
      "Acquire full text for key papers: once a paper identity is confirmed, call hugging-face-paper-pages first, then arxiv2md-api for arXiv papers, then arxiv2md as the legacy webpage fallback, and use papers-cool PDF fallback only if all Markdown sources are unavailable. Record source_provider and retrieval_providers in PAPER_SOURCE_INDEX.json.",
      "Refresh PaperNexus when newly ingested papers may change novelty, baselines, or closest prior work.",
      "Keep reasoning packets and manifest next_action/resume_action current.",
    ],
  },
  orchestrator: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["orchestrator"],
    allowedProjectFiles: [],
    writeScopeLabels: ["{PROJ}/orchestrator/"],
    backgroundTasks: [
      "Tighten compute estimates, ablation coverage, and rollback rules under {PROJ}/orchestrator/.",
      "Refine risk registers and blocked-task notes without changing active tracks.",
    ],
  },
  coder: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["coder"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    writeScopeLabels: [
      "{PROJ}/coder/",
      "{PROJ}/orchestrator/TODOS.md (append-only)",
      "Datasets are read-only inputs for Coder. Never mutate /data/datasets/ or project dataset roots.",
    ],
    backgroundTasks: [
      "Strengthen smoke tests, reproducibility notes, and launch scripts inside {PROJ}/coder/.",
      "Keep experiment bundles legible: one folder per experiment, one manifest per bundle, and a top-level coder/EXPERIMENT_INDEX.md mapping folders to tracks and questions.",
      "Treat dataset roots as read-only. Put derived caches, converted shards, and temporary files under {PROJ}/coder/ or remote scratch/results, not back into datasets/.",
      "Do not launch unassigned experiments or broaden scope on your own.",
    ],
  },
  analyzer: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["analyzer"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    writeScopeLabels: ["{PROJ}/analyzer/", "{PROJ}/orchestrator/TODOS.md (append-only)"],
    backgroundTasks: [
      "Prepare figure/table skeletons and claim-evidence extraction stubs in {PROJ}/analyzer/.",
      "Compare partial results against the latest synthesis packet before promoting claims.",
    ],
  },
  academic_writer: {
    allowedContacts: ["researcher", "cross-reviewer"],
    allowedSpawns: [],
    allowedProjectDirs: ["academic_writer"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    writeScopeLabels: [
      "{PROJ}/academic_writer/",
      "{PROJ}/orchestrator/TODOS.md (append-only)",
    ],
    backgroundTasks: [
      "Tighten KG-grounded outline structure, citation queues, and conservative wording in {PROJ}/academic_writer/.",
      "Keep WRITING_SIGNALS.md current and do not invent unsupported claims.",
      "Respect the configured writing template and run paragraph-logic checks before finalizing prose.",
    ],
  },
  reviewer: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["reviewer"],
    allowedProjectFiles: [],
    writeScopeLabels: ["{PROJ}/reviewer/"],
    backgroundTasks: [
      "Maintain isolated review rubrics and general review heuristics.",
      "Do not browse hidden project context without an explicit review packet.",
    ],
  },
  "cross-reviewer": {
    allowedContacts: [],
    allowedSpawns: [],
    allowedProjectDirs: [],
    allowedProjectFiles: [],
    writeScopeLabels: ["No project writes; respond with review text only."],
    backgroundTasks: ["No proactive background duties. Stay stateless until explicitly invoked."],
  },
};

const STAGE_REQUIREMENTS: Record<string, StageRequirement> = {
  setup: { owner: "researcher", nextStage: "graph_build" },
  graph_build: { owner: "researcher", nextStage: "frontier_mapping" },
  frontier_mapping: { owner: "researcher", nextStage: "idea" },
  idea: { owner: "researcher", nextStage: "plan" },
  plan: { owner: "orchestrator", nextStage: "code" },
  code: { owner: "coder", nextStage: "experiment" },
  experiment: { owner: "researcher", nextStage: "analyze" },
  analyze: { owner: "analyzer", nextStage: "review" },
  review: { owner: "reviewer", nextStage: "write" },
  write: { owner: "academic_writer", nextStage: "submit" },
  submit: { owner: "reviewer", nextStage: "done" },
  revise: { owner: "researcher", nextStage: "write" },
  done: { owner: "researcher", nextStage: "done" },
};

const STAGE_ENTRY_MICRO_STAGES: Record<string, string> = {
  setup: "state_reconciled",
  graph_build: "graph_refresh_requested",
  frontier_mapping: "frontier_mapping_requested",
  idea: "idea_refresh_requested",
  plan: "planning_requested",
  code: "implementation_requested",
  experiment: "experiment_launch_requested",
  analyze: "analysis_requested",
  review: "review_requested",
  write: "writing_requested",
  submit: "submission_packet_requested",
  revise: "revision_requested",
  done: "complete",
};

const STAGE_EXECUTION_HINTS: Record<
  string,
  {
    owner: WorkflowRole;
    summary: string;
    command: string;
  }
> = {
  setup: {
    owner: "researcher",
    summary: "Reconcile durable project state before doing fresh work.",
    command:
      "Run /resume-pipeline and ensure PROJECT_MANIFEST.json, TRACK_REGISTRY.json, CLAIM_POLICY.md, idle_research, and the experiment ledger are in sync.",
  },
  graph_build: {
    owner: "researcher",
    summary: "Refresh PaperNexus grounding before downstream reasoning.",
    command:
      "Run /graph-build to reconcile PAPER_SOURCE_INDEX.json against the shared global graph and update graph readiness metadata before frontier mapping.",
  },
  frontier_mapping: {
    owner: "researcher",
    summary: "Package graph-grounded frontiers for ideation.",
    command:
      "Run /frontier-mapping and refresh FRONTIER_REPORT.md plus the frontier files under {PROJ}/graph before moving into idea selection.",
  },
  idea: {
    owner: "researcher",
    summary: "Refresh ideation using the latest graph and experiment reflection.",
    command:
      "If innovation reflection is due, run /innovation-reflection first; then run /idea-phase and keep 1-2 active tracks with current reasoning packets.",
  },
  plan: {
    owner: "orchestrator",
    summary: "Produce the executable research plan for the active tracks.",
    command:
      "Run /plan-research using IDEA_REPORT.md and TRACK_REGISTRY.json, then write PLAN.md, TODOS.md, and PLAN_AUDIT.md.",
  },
  code: {
    owner: "coder",
    summary: "Turn the approved plan into runnable experiment bundles.",
    command:
      "Implement the approved experiments as structured bundles under coder/experiments/<track-id>/<experiment-id>__<slug>/, write EXPERIMENT_MANIFEST.json + README.md for each bundle, and keep coder/EXPERIMENT_INDEX.md current before launches.",
  },
  experiment: {
    owner: "researcher",
    summary: "Launch, monitor, and reconcile the approved experiments.",
    command:
      "Run /experiment-phase or wake Coder /run-experiment for approved launches, then reconcile EXPERIMENT_REGISTRY.md and EXPERIMENT_LEDGER.json before analysis.",
  },
  analyze: {
    owner: "analyzer",
    summary: "Convert experiment outputs into claim-evidence artifacts.",
    command:
      "Run the analysis pipeline and produce narrative, evidence-matrix, verdict, unsupported-claims, and quality-audit artifacts.",
  },
  review: {
    owner: "reviewer",
    summary: "Stress-test the paper package before writing or submission.",
    command:
      "Run /review-phase or reviewer /resume-pipeline to generate the review report and synchronize REVIEW_STATE.json.",
  },
  write: {
    owner: "academic_writer",
    summary: "Draft the paper under the active writing contract.",
    command:
      "Run /paper-phase with the active writing mode, KG storyline packet, template mapping, paragraph-logic checks, and source-of-truth citations before finalizing prose.",
  },
  submit: {
    owner: "reviewer",
    summary: "Prepare the external review packet and wait for the revision decision.",
    command:
      "Complete external review packaging and rebuttal materials, then stop for the mandatory GATE-5 human decision.",
  },
  revise: {
    owner: "researcher",
    summary: "Route the project back into the requested revision loop.",
    command:
      "Run /resume-pipeline, classify the revision request, and route the project back to WRITE or EXPERIMENT with updated next_action.",
  },
  done: {
    owner: "researcher",
    summary: "Archive the completed project and select the next queued project if applicable.",
    command:
      "Archive the completed project, update PROJECTS_STATE.json, and if queue mode is active, identify the next active project to resume.",
  },
};

const PREVIOUS_STAGE: Record<string, string> = Object.entries(STAGE_REQUIREMENTS).reduce(
  (acc, [stage, requirement]) => {
    if (requirement.nextStage && requirement.nextStage !== stage && !(requirement.nextStage in acc)) {
      acc[requirement.nextStage] = stage;
    }
    return acc;
  },
  {} as Record<string, string>
);

const PROJECT_ROOT_FILE_SET = new Set([
  "PROJECT_MANIFEST.json",
  "TRACK_REGISTRY.json",
  "CLAIM_POLICY.md",
  "README.md",
]);

const PROJECT_DIR_HINTS = [
  "researcher/",
  "orchestrator/",
  "coder/",
  "analyzer/",
  "academic_writer/",
  "reviewer/",
  "cross-reviewer/",
  "graph/",
  "memory/",
  ".openclaw-research/",
];

const AGENT_MENTION_REGEX =
  /(^|[\s([{"'`|])@(researcher|orchestrator|coder|analyzer|academic[_-]?writer|writer|reviewer|cross[_-]?reviewer|openclaw)\b/gi;

function normalizePolicy(
  config: Record<string, unknown> | undefined
): Required<WorkflowGuardPolicy> {
  return {
    allowWorkspaceFallback:
      config?.allowWorkspaceFallback === true
        ? true
        : DEFAULT_POLICY.allowWorkspaceFallback,
    injectWorkflowContext:
      config?.injectWorkflowContext === false
        ? false
        : DEFAULT_POLICY.injectWorkflowContext,
    enforceWorkflowBoundaries:
      config?.enforceWorkflowBoundaries === false
        ? false
        : DEFAULT_POLICY.enforceWorkflowBoundaries,
    blockDiscordAgentMentions:
      config?.blockDiscordAgentMentions === false
        ? false
        : DEFAULT_POLICY.blockDiscordAgentMentions,
    enableWorkflowMailbox:
      config?.enableWorkflowMailbox === false
        ? false
        : DEFAULT_POLICY.enableWorkflowMailbox,
    heartbeatBackgroundChecks:
      config?.heartbeatBackgroundChecks === false
        ? false
        : DEFAULT_POLICY.heartbeatBackgroundChecks,
    maxWorkflowInboxMessages:
      typeof config?.maxWorkflowInboxMessages === "number" &&
      Number.isFinite(config.maxWorkflowInboxMessages)
        ? Math.max(1, Math.floor(config.maxWorkflowInboxMessages))
        : DEFAULT_POLICY.maxWorkflowInboxMessages,
    agentContactCooldownSeconds:
      typeof config?.agentContactCooldownSeconds === "number" &&
      Number.isFinite(config.agentContactCooldownSeconds)
        ? Math.max(0, Math.floor(config.agentContactCooldownSeconds))
        : DEFAULT_POLICY.agentContactCooldownSeconds,
    projectsRoot:
      asString(config?.projectsRoot) ??
      DEFAULT_POLICY.projectsRoot,
    enableChannelProjectBindings:
      config?.enableChannelProjectBindings === true
        ? true
        : DEFAULT_POLICY.enableChannelProjectBindings,
    channelProjectBindingsPath:
      asString(config?.channelProjectBindingsPath) ??
      DEFAULT_POLICY.channelProjectBindingsPath,
    defaultConferenceTemplatePath:
      asString(config?.defaultConferenceTemplatePath) ??
      DEFAULT_POLICY.defaultConferenceTemplatePath,
    defaultJournalTemplatePath:
      asString(config?.defaultJournalTemplatePath) ??
      DEFAULT_POLICY.defaultJournalTemplatePath,
    papernexusApiBaseUrl:
      asString(config?.papernexusApiBaseUrl) ??
      DEFAULT_POLICY.papernexusApiBaseUrl,
    papernexusApiTokenEnv:
      asString(config?.papernexusApiTokenEnv) ??
      DEFAULT_POLICY.papernexusApiTokenEnv,
    papernexusApiTokenSource:
      normalizePapernexusApiTokenSource(config?.papernexusApiTokenSource) ??
      DEFAULT_POLICY.papernexusApiTokenSource,
    papernexusApiTokenService:
      asString(config?.papernexusApiTokenService) ??
      DEFAULT_POLICY.papernexusApiTokenService,
    papernexusApiTokenAccount:
      asString(config?.papernexusApiTokenAccount) ??
      DEFAULT_POLICY.papernexusApiTokenAccount,
    papernexusApiTokenLookupTimeoutMs:
      typeof config?.papernexusApiTokenLookupTimeoutMs === "number" &&
      Number.isFinite(config.papernexusApiTokenLookupTimeoutMs)
        ? Math.max(250, Math.floor(config.papernexusApiTokenLookupTimeoutMs))
        : DEFAULT_POLICY.papernexusApiTokenLookupTimeoutMs,
    papernexusMineruHttpUrl:
      asString(config?.papernexusMineruHttpUrl) ??
      DEFAULT_POLICY.papernexusMineruHttpUrl,
    autoMode:
      config && typeof config === "object"
        ? normalizeWorkflowAutoMode((config as Record<string, unknown>).autoMode)
        : DEFAULT_POLICY.autoMode,
    autoGate:
      config && typeof config === "object"
        ? normalizeWorkflowAutoGateConfig((config as Record<string, unknown>).autoGate)
        : DEFAULT_POLICY.autoGate,
    lobsterHandoff:
      config && typeof config === "object"
        ? normalizeWorkflowLobsterHandoffConfig(
            (config as Record<string, unknown>).lobsterHandoff
          )
        : DEFAULT_POLICY.lobsterHandoff,
  };
}

function normalizeRole(value: string | null | undefined): WorkflowRole | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("cross-reviewer") || normalized.includes("cross_reviewer")) {
    return "cross-reviewer";
  }
  if (
    normalized.includes("academic_writer") ||
    normalized.includes("academic-writer") ||
    normalized === "writer"
  ) {
    return "academic_writer";
  }
  return WORKFLOW_ROLE_ORDER.find((role) => normalized.includes(role)) ?? null;
}

function normalizeStage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function normalizeWritingMode(value: unknown): WritingMode | null {
  const normalized = normalizeStage(value);
  if (!normalized) {
    return null;
  }
  if (
    ["conference", "conf", "conference_9p_2refs", "conference_9_body_2_refs"].includes(
      normalized
    )
  ) {
    return "conference";
  }
  if (
    ["journal", "journal_12p_2refs", "journal_12_body_2_refs"].includes(normalized)
  ) {
    return "journal";
  }
  return null;
}

function normalizeGraphPresenceStatus(value: unknown): GraphPresenceStatus | null {
  const normalized = normalizeStage(value);
  if (
    normalized === "ready" ||
    normalized === "missing_papers" ||
    normalized === "missing_corpus" ||
    normalized === "missing_sources"
  ) {
    return normalized;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
  );
}

function getDefaultPapernexusSourceDir(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return path.join(os.homedir(), ".papernexus", "papers", projectId);
}

function getDefaultPapernexusIndexRoot(): string {
  return path.join(os.homedir(), ".papernexus", "index-store");
}

function getTemplatesRoot(): string {
  return path.resolve(MODULE_DIR, "..", "templates");
}

function sanitizeProjectIdFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveProjectIdForBootstrap(params: {
  projectId?: string | null;
  title?: string | null;
  topic?: string | null;
  channelKey?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
}): string {
  const candidates = [
    params.projectId,
    params.title,
    params.topic,
    params.channelKey,
    params.sessionKey,
    params.sessionId,
  ];
  for (const candidate of candidates) {
    const raw = asString(candidate);
    if (!raw) {
      continue;
    }
    const derived = sanitizeProjectIdFragment(raw);
    if (derived) {
      return derived;
    }
  }
  return `research-${new Date().toISOString().slice(0, 10)}`;
}

function deriveProjectTitleForBootstrap(params: {
  title?: string | null;
  topic?: string | null;
  projectId: string;
}): string {
  return (
    asString(params.title) ??
    asString(params.topic) ??
    params.projectId.replace(/-/g, " ")
  );
}

function buildIdleResearchTemplateForBootstrap(params: {
  title: string;
  topic?: string | null;
}): Record<string, unknown> {
  const seedTopic = asString(params.topic) ?? params.title;
  return {
    enabled: false,
    topic: seedTopic,
    objective: `Track new literature, adjacent mechanisms, and transferable ideas for ${seedTopic}.`,
    query_seeds: [
      seedTopic,
      `${seedTopic} literature review`,
      `${seedTopic} strong baseline`,
      `${seedTopic} failure analysis`,
      `${seedTopic} transfer learning`,
    ],
    preferred_venues: ["arXiv", "ICLR", "NeurIPS", "ICML", "ACL"],
    max_papers_per_cycle: 5,
    cooldown_minutes: 30,
    last_run_at: null,
    last_digest_path: null,
    last_source_update_at: null,
    status: "disabled",
    pending_reason:
      "Review this template, then sync the approved config into PROJECT_MANIFEST.json.idle_research.",
    next_query_hint: `Start from core papers on ${seedTopic}, then widen to neighboring mechanisms and recent counterexamples.`,
    refresh_graph_on_new_core_papers: true,
    last_round_new_canonical_papers: 0,
    last_round_new_core_papers: 0,
  };
}

function getConfiguredProjectsRoot(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
}): string | null {
  const explicit = asString(params.policy?.projectsRoot);
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }
  const envProjectsRoot = asString(process.env.OPENCLAW_PROJECTS_ROOT);
  if (envProjectsRoot) {
    return path.resolve(expandHome(envProjectsRoot));
  }
  if (params.policy?.allowWorkspaceFallback !== true) {
    return null;
  }
  const workspaceDir =
    asString(params.workspaceDir) ??
    asString(process.env.OPENCLAW_WORKSPACE) ??
    path.join(os.homedir(), ".openclaw", "workspace-researcher");
  return path.join(path.resolve(expandHome(workspaceDir)), "projects");
}

async function ensureTextFile(targetPath: string, content: string): Promise<boolean> {
  if (await pathExists(targetPath)) {
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return true;
}

async function ensureJsonTemplateFile(params: {
  targetPath: string;
  templateRelativePath: string;
  transform: (template: Record<string, unknown>) => Record<string, unknown>;
}): Promise<boolean> {
  const templatePath = path.join(getTemplatesRoot(), params.templateRelativePath);
  const template =
    (await readJsonIfExists<Record<string, unknown>>(templatePath)) ?? {};
  const desired = params.transform(template);
  const existing = await readJsonIfExists<Record<string, unknown>>(params.targetPath);
  if (!existing) {
    await writeJsonEnsured(params.targetPath, desired);
    return true;
  }
  const merged = mergeMissingTemplateDefaults(existing, desired);
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    await writeJsonEnsured(params.targetPath, merged);
  }
  return false;
}

function mergeMissingTemplateDefaults(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, desiredValue] of Object.entries(desired)) {
    const existingValue = merged[key];
    if (existingValue === undefined) {
      merged[key] = cloneTemplateValue(desiredValue);
      continue;
    }
    if (isPlainObject(existingValue) && isPlainObject(desiredValue)) {
      merged[key] = mergeMissingTemplateDefaults(existingValue, desiredValue);
    }
  }
  return merged;
}

function cloneTemplateValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneTemplateValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneTemplateValue(entry)])
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function ensureWorkflowProjectRoot(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  title?: string | null;
  topic?: string | null;
}): Promise<EnsuredWorkflowProject> {
  const projectId = deriveProjectIdForBootstrap({
    projectId: params.projectId,
    title: params.title,
    topic: params.topic,
    channelKey: params.channelKey,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
  });
  const title = deriveProjectTitleForBootstrap({
    title: params.title,
    topic: params.topic,
    projectId,
  });
  const projectsRoot = getConfiguredProjectsRoot({
    policy: params.policy,
    workspaceDir: params.workspaceDir,
  });
  if (!projectsRoot) {
    throw new Error(
      "projectsRoot is not configured for ClawAutoResearch. Set plugins.entries.ClawAutoResearch.config.projectsRoot (or OPENCLAW_PROJECTS_ROOT), or explicitly enable allowWorkspaceFallback if you want project scaffolds under the agent workspace."
    );
  }
  const projectRoot = path.resolve(
    expandHome(params.projectRoot ?? path.join(projectsRoot, projectId))
  );
  const created = !(await pathExists(projectRoot));
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });

  const projectDirs = [
    "graph",
    "memory",
    "researcher",
    "researcher/idle-research",
    "researcher/workflow_snapshots",
    "researcher/paper_source",
    "orchestrator",
    "coder",
    "analyzer",
    "academic_writer",
    "reviewer",
    "cross-reviewer",
  ];
  for (const relativeDir of projectDirs) {
    await fs.mkdir(path.join(projectRoot, relativeDir), { recursive: true });
  }

  const now = new Date().toISOString();
  const manifestCreated = await ensureJsonTemplateFile({
    targetPath: path.join(projectRoot, "PROJECT_MANIFEST.json"),
    templateRelativePath: "PROJECT_MANIFEST.json",
    transform: (template) => ({
      ...template,
      project_id: projectId,
      title,
      status: "active",
      owner_agent: "researcher",
      current_stage: "setup",
      current_micro_stage: "project_init",
      next_action: '/research-pipeline "topic"',
      resume_action: '/resume-pipeline "<project_id>"',
      blocking_reason: "Project scaffold created; continue with literature collection and graph build.",
      memory_scope: {
        ...(asRecord(template.memory_scope) ?? {}),
        project_isolated: true,
      },
      created_at: now,
      updated_at: now,
    }),
  });
  const trackRegistryCreated = await ensureJsonTemplateFile({
    targetPath: path.join(projectRoot, "TRACK_REGISTRY.json"),
    templateRelativePath: "TRACK_REGISTRY.json",
    transform: (template) => ({
      ...template,
      project_id: projectId,
      updated_at: now,
    }),
  });
  const experimentLedgerCreated = await ensureJsonTemplateFile({
    targetPath: getExperimentLedgerPath(projectRoot),
    templateRelativePath: "EXPERIMENT_LEDGER.json",
    transform: (template) => ({
      ...template,
      project_id: projectId,
      updated_at: now,
    }),
  });
  await ensureJsonTemplateFile({
    targetPath: path.join(projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
    templateRelativePath: "IDLE_RESEARCH.example.json",
    transform: () => buildIdleResearchTemplateForBootstrap({ title, topic: params.topic }),
  });

  const claimPolicyCreated = await ensureTextFile(
    path.join(projectRoot, "CLAIM_POLICY.md"),
    (await fs.readFile(path.join(getTemplatesRoot(), "CLAIM_POLICY.md"), "utf8")).toString()
  );

  const memoryTemplatesRoot = path.join(getTemplatesRoot(), "memory");
  await ensureTextFile(
    path.join(projectRoot, "memory", "ideation-memory.md"),
    (await fs.readFile(path.join(memoryTemplatesRoot, "ideation-memory.md"), "utf8")).toString()
  );
  await ensureTextFile(
    path.join(projectRoot, "memory", "experiment-memory.md"),
    (await fs.readFile(path.join(memoryTemplatesRoot, "experiment-memory.md"), "utf8")).toString()
  );

  return {
    projectRoot,
    projectId,
    projectsRoot,
    title,
    created,
    manifestCreated,
    trackRegistryCreated,
    claimPolicyCreated,
    experimentLedgerCreated,
  };
}

function isBundledWritingModeTemplatePath(templatePath: string | null): boolean {
  if (!templatePath) {
    return false;
  }
  const normalized = path.normalize(templatePath);
  return Object.values(WRITING_MODE_PRESETS).some((preset) =>
    normalized.endsWith(path.normalize(path.join("templates", "writing", preset.templateFile)))
  );
}

function pickString(
  source: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function pickBoolean(
  source: Record<string, unknown>,
  keys: string[]
): boolean | null {
  for (const key of keys) {
    if (typeof source[key] === "boolean") {
      return source[key] as boolean;
    }
  }
  return null;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function getGraphPresenceMissingEntries(
  paperIngestion: Record<string, unknown> | null
): Array<Record<string, unknown>> {
  if (!paperIngestion || !Array.isArray(paperIngestion.graph_presence_missing_papers)) {
    return [];
  }
  return paperIngestion.graph_presence_missing_papers
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function summarizeGraphPresenceMissing(
  paperIngestion: Record<string, unknown> | null
): string | null {
  const entries = getGraphPresenceMissingEntries(paperIngestion);
  if (entries.length === 0) {
    return null;
  }
  const preview = entries
    .slice(0, 3)
    .map((entry) =>
      pickString(entry, ["arxiv_id", "arxivId", "title", "canonical_id", "canonicalId"]) ??
      "unknown-paper"
    )
    .join("; ");
  return `${preview}${entries.length > 3 ? "; ..." : ""}`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyDirectory(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(targetPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readTextIfExists(targetPath: string): Promise<string | null> {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch {
    return null;
  }
}

async function writeJsonEnsured(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextEnsured(targetPath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

function getProjectRoot(options?: {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  policy?: WorkflowGuardPolicy;
}): string | null {
  return resolveProjectContext({
    policy: options?.policy,
    context: options,
  }).projectRoot;
}

function inferProjectId(projectRoot: string | null, manifest: ManifestLike | null): string | null {
  const manifestId = asString(manifest?.project_id);
  if (manifestId) {
    return manifestId;
  }
  return projectRoot ? path.basename(projectRoot) : null;
}

function getMailboxPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json");
}

async function readMailbox(projectRoot: string): Promise<WorkflowMailboxStore> {
  const mailboxPath = getMailboxPath(projectRoot);
  const existing = await readJsonIfExists<WorkflowMailboxStore>(mailboxPath);
  if (existing && Array.isArray(existing.messages)) {
    return existing;
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    messages: [],
  };
}

async function saveMailbox(projectRoot: string, mailbox: WorkflowMailboxStore): Promise<void> {
  mailbox.updatedAt = new Date().toISOString();
  await writeJsonEnsured(getMailboxPath(projectRoot), mailbox);
}

function getContactStatePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "workflow-contact-log.json");
}

async function readContactStore(projectRoot: string): Promise<WorkflowContactStore> {
  const contactPath = getContactStatePath(projectRoot);
  const existing = await readJsonIfExists<WorkflowContactStore>(contactPath);
  if (existing && Array.isArray(existing.events)) {
    return existing;
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    events: [],
  };
}

async function saveContactStore(
  projectRoot: string,
  store: WorkflowContactStore
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  store.events = store.events.slice(-500);
  await writeJsonEnsured(getContactStatePath(projectRoot), store);
}

function getExperimentLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json");
}

function getExperimentSearchPath(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_EXPERIMENT_SEARCH_PATH);
}

function createEmptyExperimentLedger(projectId: string | null): ExperimentLedger {
  return {
    schemaVersion: 1,
    projectId,
    updatedAt: new Date(0).toISOString(),
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      bestKnownConfigRef: null,
      lastDecisionSummary: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: null,
    },
    experiments: [],
  };
}

function isTerminalExperimentStatus(status: string | null): boolean {
  return Boolean(
    status &&
      [
        "done",
        "failed",
        "timeout",
        "stalled",
        "killed",
        "merged",
        "parked",
        "cancelled",
        "completed",
      ].includes(status)
  );
}

function normalizePapernexusSync(value: unknown): ExperimentPapernexusSync {
  const record = asRecord(value);
  return {
    status: normalizeStage(record?.status) ?? null,
    corpus: asString(record?.corpus),
    lastSyncedAt: asString(record?.lastSyncedAt) ?? asString(record?.last_synced_at),
    nodeRefs: asStringArray(record?.nodeRefs ?? record?.node_refs),
    notes: asString(record?.notes),
  };
}

function normalizeMetricRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const normalized: Record<string, unknown> = {};
  const name = asString(record.name);
  if (name) {
    normalized.name = name;
  }
  if ("value" in record) {
    normalized.value = record.value;
  }
  if ("baseline" in record) {
    normalized.baseline = record.baseline;
  }
  if ("higherIsBetter" in record) {
    normalized.higherIsBetter = record.higherIsBetter;
  }
  if ("unit" in record && asString(record.unit)) {
    normalized.unit = asString(record.unit);
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function metricToText(metric: Record<string, unknown> | null): string | null {
  if (!metric) {
    return null;
  }
  const name = asString(metric.name) ?? "metric";
  const value = "value" in metric ? String(metric.value) : null;
  const baseline = "baseline" in metric ? String(metric.baseline) : null;
  if (value && baseline) {
    return `${name}=${value} (baseline ${baseline})`;
  }
  if (value) {
    return `${name}=${value}`;
  }
  return null;
}

function normalizeExperimentEntry(
  entry: Record<string, unknown>,
  defaults?: { experimentId?: string | null; updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntry | null {
  const experimentId =
    pickString(entry, ["experimentId", "experiment_id", "id"]) ?? defaults?.experimentId ?? null;
  if (!experimentId) {
    return null;
  }

  return {
    experimentId,
    trackId: pickString(entry, ["trackId", "track_id"]),
    name: pickString(entry, ["name", "experimentName", "experiment_name"]),
    kind:
      normalizeStage(
        pickString(entry, ["kind", "experimentType", "experiment_type"])
      ) ?? null,
    status: normalizeStage(pickString(entry, ["status"])) ?? null,
    stage: normalizeStage(pickString(entry, ["stage", "checkpoint", "phase"])) ?? null,
    hypothesis: pickString(entry, ["hypothesis"]),
    configRef: pickString(entry, ["configRef", "config_ref", "configPath", "config_path"]),
    summary: pickString(entry, ["summary"]),
    server: pickString(entry, ["server"]),
    gpuId: pickString(entry, ["gpuId", "gpu_id"]),
    screenName: pickString(entry, ["screenName", "screen_name"]),
    launchedAt: pickString(entry, ["launchedAt", "launched_at", "startedAt", "started_at"]),
    completedAt: pickString(entry, ["completedAt", "completed_at", "finishedAt", "finished_at"]),
    updatedAt:
      pickString(entry, ["updatedAt", "updated_at"]) ??
      defaults?.updatedAt ??
      new Date().toISOString(),
    lastUpdatedBy:
      pickString(entry, ["lastUpdatedBy", "last_updated_by", "sourceAgent", "source_agent"]) ??
      defaults?.lastUpdatedBy ??
      null,
    decision: normalizeStage(pickString(entry, ["decision"])) ?? null,
    keyMetric:
      normalizeMetricRecord(entry.keyMetric) ??
      normalizeMetricRecord(entry.key_metric) ??
      normalizeMetricRecord(entry.metric) ??
      null,
    metrics: asRecord(entry.metrics),
    resultPaths: asStringArray(entry.resultPaths ?? entry.result_paths),
    evidencePointers: asStringArray(entry.evidencePointers ?? entry.evidence_pointers),
    failureSignature: pickString(entry, ["failureSignature", "failure_signature"]),
    notes: uniqueStrings([
      ...asStringArray(entry.notes),
      ...(asString(entry.note) ? [asString(entry.note)!] : []),
    ]),
    metadata: asRecord(entry.metadata),
    papernexusSync:
      normalizePapernexusSync(entry.papernexusSync ?? entry.papernexus_sync),
  };
}

function mergeExperimentEntries(
  existing: ExperimentLedgerEntry | null,
  incoming: Record<string, unknown>,
  defaults?: { updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntry {
  const now = defaults?.updatedAt ?? new Date().toISOString();
  const base =
    existing ??
    normalizeExperimentEntry(incoming, {
      updatedAt: now,
      lastUpdatedBy: defaults?.lastUpdatedBy ?? null,
    });
  if (!base) {
    throw new Error("experimentId is required for experiment ledger updates.");
  }
  const next = normalizeExperimentEntry(incoming, {
    experimentId: base.experimentId,
    updatedAt: now,
    lastUpdatedBy: defaults?.lastUpdatedBy ?? null,
  });
  if (!next) {
    return base;
  }

  const merged: ExperimentLedgerEntry = {
    experimentId: base.experimentId,
    trackId: next.trackId ?? base.trackId,
    name: next.name ?? base.name,
    kind: next.kind ?? base.kind,
    status: next.status ?? base.status,
    stage: next.stage ?? base.stage,
    hypothesis: next.hypothesis ?? base.hypothesis,
    configRef: next.configRef ?? base.configRef,
    summary: next.summary ?? base.summary,
    server: next.server ?? base.server,
    gpuId: next.gpuId ?? base.gpuId,
    screenName: next.screenName ?? base.screenName,
    launchedAt: next.launchedAt ?? base.launchedAt,
    completedAt: next.completedAt ?? base.completedAt,
    updatedAt: now,
    lastUpdatedBy: next.lastUpdatedBy ?? base.lastUpdatedBy ?? defaults?.lastUpdatedBy ?? null,
    decision: next.decision ?? base.decision,
    keyMetric: next.keyMetric ?? base.keyMetric,
    metrics: next.metrics ?? base.metrics,
    resultPaths: uniqueStrings([...(base.resultPaths || []), ...(next.resultPaths || [])]),
    evidencePointers: uniqueStrings([
      ...(base.evidencePointers || []),
      ...(next.evidencePointers || []),
    ]),
    failureSignature: next.failureSignature ?? base.failureSignature,
    notes: uniqueStrings([...(base.notes || []), ...(next.notes || [])]),
    metadata: next.metadata ?? base.metadata,
    papernexusSync: {
      status: next.papernexusSync.status ?? base.papernexusSync.status,
      corpus: next.papernexusSync.corpus ?? base.papernexusSync.corpus,
      lastSyncedAt:
        next.papernexusSync.lastSyncedAt ?? base.papernexusSync.lastSyncedAt,
      nodeRefs: uniqueStrings([
        ...(base.papernexusSync.nodeRefs || []),
        ...(next.papernexusSync.nodeRefs || []),
      ]),
      notes: next.papernexusSync.notes ?? base.papernexusSync.notes,
    },
  };

  if (isTerminalExperimentStatus(merged.status) && !merged.completedAt) {
    merged.completedAt = now;
  }
  if (
    isTerminalExperimentStatus(merged.status) &&
    !merged.papernexusSync.status
  ) {
    merged.papernexusSync.status = "pending";
  }
  if (merged.papernexusSync.status === "synced" && !merged.papernexusSync.lastSyncedAt) {
    merged.papernexusSync.lastSyncedAt = now;
  }

  return merged;
}

function getExperimentSortTimestamp(entry: ExperimentLedgerEntry): string {
  return (
    entry.updatedAt ||
    entry.completedAt ||
    entry.launchedAt ||
    new Date(0).toISOString()
  );
}

function buildExperimentLedgerSummary(
  experiments: ExperimentLedgerEntry[]
): ExperimentLedgerSummary {
  const ordered = [...experiments].sort((left, right) =>
    getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left))
  );

  const activeExperimentIds = ordered
    .filter((entry) => !isTerminalExperimentStatus(entry.status))
    .map((entry) => entry.experimentId);
  const lastCompleted = ordered.find((entry) =>
    ["done", "completed"].includes(entry.status ?? "")
  );
  const lastFailed = ordered.find((entry) =>
    ["failed", "timeout", "stalled", "killed", "cancelled"].includes(entry.status ?? "")
  );
  const bestKnown = ordered.find(
    (entry) =>
      entry.configRef &&
      (entry.decision === "advance" || ["done", "completed"].includes(entry.status ?? ""))
  );
  const lastDecision = ordered.find((entry) => entry.decision);
  const papernexusSyncRequired = ordered.some(
    (entry) =>
      isTerminalExperimentStatus(entry.status) &&
      ["pending", "failed", "missing"].includes(entry.papernexusSync.status ?? "")
  );
  const papernexusLastSyncAt =
    ordered
      .map((entry) => entry.papernexusSync.lastSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    activeExperimentIds,
    lastCompletedExperimentId: lastCompleted?.experimentId ?? null,
    lastFailedExperimentId: lastFailed?.experimentId ?? null,
    bestKnownConfigRef: bestKnown?.configRef ?? null,
    lastDecisionSummary: lastDecision
      ? `${lastDecision.name ?? lastDecision.experimentId}: ${lastDecision.decision}`
      : null,
    papernexusSyncRequired,
    papernexusLastSyncAt,
  };
}

function normalizeExperimentLedger(
  raw: Record<string, unknown>,
  projectId: string | null
): ExperimentLedger {
  const experiments = Array.isArray(raw.experiments)
    ? raw.experiments
        .map((item) =>
          normalizeExperimentEntry(asRecord(item) ?? {}, {
            updatedAt: new Date(0).toISOString(),
            lastUpdatedBy: null,
          })
        )
        .filter((item): item is ExperimentLedgerEntry => Boolean(item))
    : [];

  return {
    schemaVersion:
      typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
        ? Math.floor(raw.schemaVersion)
        : typeof raw.schema_version === "number" && Number.isFinite(raw.schema_version)
          ? Math.floor(raw.schema_version)
          : 1,
    projectId: asString(raw.projectId) ?? asString(raw.project_id) ?? projectId,
    updatedAt:
      asString(raw.updatedAt) ?? asString(raw.updated_at) ?? new Date(0).toISOString(),
    summary: buildExperimentLedgerSummary(experiments),
    experiments,
  };
}

async function loadExperimentLedgerIfExists(
  projectRoot: string
): Promise<ExperimentLedger | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getExperimentLedgerPath(projectRoot)
  );
  return raw ? normalizeExperimentLedger(raw, path.basename(projectRoot)) : null;
}

async function readExperimentLedgerEnsured(projectRoot: string): Promise<ExperimentLedger> {
  return (
    (await loadExperimentLedgerIfExists(projectRoot)) ??
    createEmptyExperimentLedger(path.basename(projectRoot))
  );
}

async function saveExperimentLedger(
  projectRoot: string,
  ledger: ExperimentLedger
): Promise<void> {
  await writeJsonEnsured(getExperimentLedgerPath(projectRoot), {
    schema_version: ledger.schemaVersion,
    project_id: ledger.projectId,
    updated_at: ledger.updatedAt,
    summary: {
      active_experiment_ids: ledger.summary.activeExperimentIds,
      last_completed_experiment_id: ledger.summary.lastCompletedExperimentId,
      last_failed_experiment_id: ledger.summary.lastFailedExperimentId,
      best_known_config_ref: ledger.summary.bestKnownConfigRef,
      last_decision_summary: ledger.summary.lastDecisionSummary,
      papernexus_sync_required: ledger.summary.papernexusSyncRequired,
      papernexus_last_sync_at: ledger.summary.papernexusLastSyncAt,
    },
    experiments: ledger.experiments.map((entry) => ({
      experiment_id: entry.experimentId,
      track_id: entry.trackId,
      name: entry.name,
      kind: entry.kind,
      status: entry.status,
      stage: entry.stage,
      hypothesis: entry.hypothesis,
      config_ref: entry.configRef,
      summary: entry.summary,
      server: entry.server,
      gpu_id: entry.gpuId,
      screen_name: entry.screenName,
      launched_at: entry.launchedAt,
      completed_at: entry.completedAt,
      updated_at: entry.updatedAt,
      last_updated_by: entry.lastUpdatedBy,
      decision: entry.decision,
      key_metric: entry.keyMetric,
      metrics: entry.metrics,
      result_paths: entry.resultPaths,
      evidence_pointers: entry.evidencePointers,
      failure_signature: entry.failureSignature,
      notes: entry.notes,
      metadata: entry.metadata,
      papernexus_sync: {
        status: entry.papernexusSync.status,
        corpus: entry.papernexusSync.corpus,
        last_synced_at: entry.papernexusSync.lastSyncedAt,
        node_refs: entry.papernexusSync.nodeRefs,
        notes: entry.papernexusSync.notes,
      },
    })),
  });
}

async function loadExperimentSearchState(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
}): Promise<ExperimentSearchState> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getExperimentSearchPath(params.projectRoot)
  );
  if (raw) {
    return normalizeExperimentSearchState(raw);
  }
  return normalizeExperimentSearchState(params.manifest?.experiment_search);
}

async function saveExperimentSearchStateFile(
  projectRoot: string,
  state: ExperimentSearchState
): Promise<void> {
  await writeJsonEnsured(
    getExperimentSearchPath(projectRoot),
    serializeExperimentSearchState(state)
  );
}

async function syncManifestExperimentMemory(params: {
  projectRoot: string;
  ledger: ExperimentLedger;
}): Promise<Record<string, unknown> | null> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = asRecord(manifest.experiment_memory) ?? {};
  manifest.experiment_memory = {
    ...current,
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: params.ledger.updatedAt,
    last_completed_experiment_id: params.ledger.summary.lastCompletedExperimentId,
    last_failed_experiment_id: params.ledger.summary.lastFailedExperimentId,
    best_known_config_ref: params.ledger.summary.bestKnownConfigRef,
    last_decision_summary: params.ledger.summary.lastDecisionSummary,
    papernexus_sync_status: params.ledger.summary.papernexusSyncRequired
      ? "pending"
      : params.ledger.summary.papernexusLastSyncAt
        ? "synced"
        : asString(current.papernexus_sync_status) ?? "unknown",
    papernexus_sync_required: params.ledger.summary.papernexusSyncRequired,
    papernexus_last_sync_at: params.ledger.summary.papernexusLastSyncAt,
  };
  const currentReflection = normalizeInnovationReflectionState(
    manifest.innovation_reflection
  );
  const reflectionDue = isInnovationReflectionDue({
    state: currentReflection,
    ledger: params.ledger,
  });
  manifest.innovation_reflection = serializeInnovationReflectionState({
    ...currentReflection,
    requiredAfterExperiments: true,
    status: reflectionDue
      ? currentReflection.status === "running"
        ? "running"
        : "pending"
      : currentReflection.lastReflectionPath
        ? "fresh"
        : currentReflection.status,
    pendingReason: reflectionDue
      ? "new experiment evidence requires a PaperNexus-backed innovation reflection before the next idea proposal"
      : null,
  });
  if (typeof manifest.updated_at === "string" || !("updated_at" in manifest)) {
    manifest.updated_at = new Date().toISOString();
  }
  await writeJsonEnsured(manifestPath, manifest);
  return manifest;
}

function normalizeIdleResearchState(value: unknown): IdleResearchState {
  const record = asRecord(value) ?? {};
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? false,
    topic: pickString(record, ["topic"]),
    objective: pickString(record, ["objective"]),
    querySeeds: asStringArray(record.querySeeds ?? record.query_seeds),
    preferredVenues: asStringArray(
      record.preferredVenues ?? record.preferred_venues
    ),
    maxPapersPerCycle:
      Math.max(
        1,
        Math.floor(
          pickNumber(record, ["maxPapersPerCycle", "max_papers_per_cycle"]) ?? 5
        )
      ),
    cooldownMinutes:
      Math.max(
        0,
        Math.floor(
          pickNumber(record, ["cooldownMinutes", "cooldown_minutes"]) ?? 30
        )
      ),
    lastRunAt: pickString(record, ["lastRunAt", "last_run_at"]),
    lastDigestPath: pickString(record, ["lastDigestPath", "last_digest_path"]),
    lastSourceUpdateAt: pickString(record, [
      "lastSourceUpdateAt",
      "last_source_update_at",
    ]),
    status: normalizeStage(record.status) ?? "disabled",
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    nextQueryHint: pickString(record, ["nextQueryHint", "next_query_hint"]),
    refreshGraphOnNewCorePapers:
      pickBoolean(record, [
        "refreshGraphOnNewCorePapers",
        "refresh_graph_on_new_core_papers",
      ]) ?? true,
    lastRoundNewCanonicalPapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(record, [
            "lastRoundNewCanonicalPapers",
            "last_round_new_canonical_papers",
          ]) ?? 0
        )
      ),
    lastRoundNewCorePapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(record, [
            "lastRoundNewCorePapers",
            "last_round_new_core_papers",
          ]) ?? 0
        )
      ),
  };
}

function computeIdleResearchNextDueAt(state: IdleResearchState): string | null {
  if (state.cooldownMinutes <= 0 || !state.lastRunAt) {
    return state.lastRunAt;
  }
  const lastRunMs = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    return null;
  }
  return new Date(lastRunMs + state.cooldownMinutes * 60 * 1000).toISOString();
}

function isIdleResearchDue(state: IdleResearchState): boolean {
  if (!state.enabled || !state.topic) {
    return false;
  }
  if (state.status === "running") {
    return false;
  }
  if (!state.lastRunAt || state.cooldownMinutes <= 0) {
    return true;
  }
  const nextDueAt = computeIdleResearchNextDueAt(state);
  if (!nextDueAt) {
    return true;
  }
  return Date.now() >= Date.parse(nextDueAt);
}

async function getManifestPath(projectRoot: string): Promise<string> {
  return path.join(projectRoot, "PROJECT_MANIFEST.json");
}

async function readManifestEnsured(projectRoot: string): Promise<Record<string, unknown>> {
  const manifestPath = await getManifestPath(projectRoot);
  return (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
}

async function saveManifest(projectRoot: string, manifest: Record<string, unknown>): Promise<void> {
  const manifestPath = await getManifestPath(projectRoot);
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(manifestPath, manifest);
}

function getGateStatePath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "GATE_STATE.json");
}

function normalizeGateState(value: unknown): GateState {
  const record = asRecord(value) ?? {};
  return {
    currentStage: normalizeStage(record.current_stage ?? record.currentStage),
    lastGate: pickString(record, ["last_gate", "lastGate"]),
    gateStatus: normalizeStage(record.gate_status ?? record.gateStatus),
    gateType: normalizeStage(record.gate_type ?? record.gateType),
    gateTimestamp: pickString(record, ["gate_timestamp", "gateTimestamp"]),
    autoProceed:
      typeof record.auto_proceed === "boolean"
        ? record.auto_proceed
        : typeof record.autoProceed === "boolean"
          ? record.autoProceed
          : null,
    confirmationRequestedAt: pickString(record, [
      "confirmation_requested_at",
      "confirmationRequestedAt",
    ]),
    confirmationDeadlineAt: pickString(record, [
      "confirmation_deadline_at",
      "confirmationDeadlineAt",
    ]),
    defaultAction: pickString(record, ["default_action", "defaultAction"]),
    defaultActionReason: pickString(record, [
      "default_action_reason",
      "defaultActionReason",
    ]),
    defaultActionExecutedAt: pickString(record, [
      "default_action_executed_at",
      "defaultActionExecutedAt",
    ]),
    userOverrideReceivedAt: pickString(record, [
      "user_override_received_at",
      "userOverrideReceivedAt",
    ]),
    userOverrideValue: pickString(record, [
      "user_override_value",
      "userOverrideValue",
    ]),
    revisionCount:
      typeof record.revision_count === "number" && Number.isFinite(record.revision_count)
        ? Math.max(0, Math.floor(record.revision_count))
        : typeof record.revisionCount === "number" && Number.isFinite(record.revisionCount)
          ? Math.max(0, Math.floor(record.revisionCount))
          : null,
    notes: pickString(record, ["notes"]),
  };
}

function serializeGateState(state: GateState): Record<string, unknown> {
  return {
    current_stage: state.currentStage,
    last_gate: state.lastGate,
    gate_status: state.gateStatus,
    gate_type: state.gateType,
    gate_timestamp: state.gateTimestamp,
    auto_proceed: state.autoProceed,
    confirmation_requested_at: state.confirmationRequestedAt,
    confirmation_deadline_at: state.confirmationDeadlineAt,
    default_action: state.defaultAction,
    default_action_reason: state.defaultActionReason,
    default_action_executed_at: state.defaultActionExecutedAt,
    user_override_received_at: state.userOverrideReceivedAt,
    user_override_value: state.userOverrideValue,
    revision_count: state.revisionCount,
    notes: state.notes,
  };
}

async function readGateState(projectRoot: string): Promise<GateState> {
  return normalizeGateState(
    await readJsonIfExists<Record<string, unknown>>(getGateStatePath(projectRoot))
  );
}

async function saveGateState(projectRoot: string, gateState: GateState): Promise<void> {
  await writeJsonEnsured(getGateStatePath(projectRoot), serializeGateState(gateState));
}

function computeGateConfirmationDeadline(state: GateState): string | null {
  if (state.confirmationDeadlineAt) {
    return state.confirmationDeadlineAt;
  }
  if (!state.confirmationRequestedAt) {
    return null;
  }
  const requestedMs = Date.parse(state.confirmationRequestedAt);
  if (!Number.isFinite(requestedMs)) {
    return null;
  }
  return new Date(requestedMs + 60 * 60 * 1000).toISOString();
}

function isTimedDefaultGate(state: GateState): boolean {
  return normalizeStage(state.gateType) === "timed_default";
}

function hasTimedDefaultGateExpired(state: GateState, now: string): boolean {
  if (!isTimedDefaultGate(state)) {
    return false;
  }
  const deadline = computeGateConfirmationDeadline(state);
  if (!deadline) {
    return false;
  }
  return Date.parse(now) >= Date.parse(deadline);
}

export async function getGateStateSummary(params: {
  projectRoot: string;
  now?: string;
}): Promise<{
  state: GateState;
  timedDefaultEligible: boolean;
  timedDefaultExpired: boolean;
  confirmationDeadlineAt: string | null;
}> {
  const state = await readGateState(params.projectRoot);
  const confirmationDeadlineAt = computeGateConfirmationDeadline(state);
  const now = params.now ?? new Date().toISOString();
  return {
    state: {
      ...state,
      confirmationDeadlineAt,
    },
    timedDefaultEligible: isTimedDefaultGate(state),
    timedDefaultExpired: hasTimedDefaultGateExpired(state, now),
    confirmationDeadlineAt,
  };
}

export async function setGateStateForWorkflow(params: {
  projectRoot: string;
  gateState: Record<string, unknown>;
}): Promise<{
  state: GateState;
  timedDefaultEligible: boolean;
  timedDefaultExpired: boolean;
  confirmationDeadlineAt: string | null;
}> {
  const current = await readGateState(params.projectRoot);
  const next = normalizeGateState({
    ...serializeGateState(current),
    ...params.gateState,
  });
  next.confirmationDeadlineAt = computeGateConfirmationDeadline(next);
  await saveGateState(params.projectRoot, next);
  return {
    state: next,
    timedDefaultEligible: isTimedDefaultGate(next),
    timedDefaultExpired: hasTimedDefaultGateExpired(next, new Date().toISOString()),
    confirmationDeadlineAt: next.confirmationDeadlineAt,
  };
}

function getProjectsStatePath(projectRoot: string): string {
  return path.join(path.dirname(projectRoot), "PROJECTS_STATE.json");
}

async function readProjectsStateRaw(projectRoot: string): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(getProjectsStatePath(projectRoot))) ?? {
      updated_at: null,
      gpu_allocation: {},
      total_gpu_hours_used: 0,
      projects: [],
    }
  );
}

function formatProjectDirEntry(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return `${projectId}/`;
}

function dateOnly(isoTs: string): string {
  return isoTs.slice(0, 10);
}

function formatStageCommand(stage: string | null): string | null {
  if (!stage) {
    return null;
  }
  return STAGE_EXECUTION_HINTS[stage]?.command ?? null;
}

function formatStageSummary(stage: string | null): string | null {
  if (!stage) {
    return null;
  }
  return STAGE_EXECUTION_HINTS[stage]?.summary ?? null;
}

function stageOwner(stage: string | null): WorkflowRole | null {
  if (!stage) {
    return null;
  }
  return STAGE_REQUIREMENTS[stage]?.owner ?? null;
}

function getAutoIteratorAuditPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json");
}

async function evaluateGateBlocking(params: {
  projectRoot: string;
  gateState: GateState;
  stage: string | null;
  hasStageWorkRemaining?: boolean;
  effectiveAutoMode: WorkflowAutoMode;
  autoGate: WorkflowAutoGateConfig;
  now: string;
}): Promise<{
  blocking: boolean;
  reason: string | null;
  timedDefaultTriggered: boolean;
}> {
  const stage = params.stage;
  const gateStatus = params.gateState.gateStatus;
  const lastGate = params.gateState.lastGate?.trim().toUpperCase() ?? null;
  if (stage === "submit" && params.hasStageWorkRemaining !== true) {
    const submitResult = await evaluateSubmitAutoGate({
      projectRoot: params.projectRoot,
      autoMode: params.effectiveAutoMode,
      autoGate: params.autoGate,
      hasStageWorkRemaining: false,
    });
    return {
      ...submitResult,
      timedDefaultTriggered: false,
    };
  }
  if (gateStatus !== "waiting") {
    return { blocking: false, reason: null, timedDefaultTriggered: false };
  }
  if (hasTimedDefaultGateExpired(params.gateState, params.now)) {
    return {
      blocking: false,
      reason: `Timed-default ${lastGate ?? "workflow gate"} expired after the confirmation deadline; continuing via the default workflow-safe branch.`,
      timedDefaultTriggered: true,
    };
  }
  if (lastGate === "GATE-5") {
    return {
      blocking: true,
      reason: "GATE-5 revision decision is waiting on human input.",
      timedDefaultTriggered: false,
    };
  }
  if (params.gateState.autoProceed === false) {
    return {
      blocking: true,
      reason: `${lastGate ?? "workflow gate"} is waiting and AUTO_PROCEED=false.`,
      timedDefaultTriggered: false,
    };
  }
  return { blocking: false, reason: null, timedDefaultTriggered: false };
}

async function syncProjectsStateEntry(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: ManifestLike;
  trackRegistry: TrackRegistryLike | null;
  stage: string | null;
  nextAction: string | null;
  blockingReason: string | null;
}): Promise<boolean> {
  if (!params.projectId) {
    return false;
  }
  const projectsState = await readProjectsStateRaw(params.projectRoot);
  const projects = Array.isArray(projectsState.projects)
    ? projectsState.projects.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
  const now = new Date().toISOString();
  const existing =
    projects.find((entry) => pickString(entry, ["id"]) === params.projectId) ?? null;
  const nextEntry: Record<string, unknown> = {
    ...(existing ?? {}),
    id: params.projectId,
    title:
      pickString(params.manifest, ["title", "project_title"]) ??
      pickString(existing ?? {}, ["title"]) ??
      params.projectId,
    stage: params.stage,
    active_tracks: getActiveTracks(params.trackRegistry).length,
    dir: pickString(existing ?? {}, ["dir"]) ?? formatProjectDirEntry(params.projectId),
    created:
      pickString(existing ?? {}, ["created"]) ??
      pickString(params.manifest, ["created_at"])?.slice(0, 10) ??
      dateOnly(now),
    updated: now,
    status: params.stage === "done" ? "completed" : "active",
    next_action: params.nextAction,
    blocked_by: params.blockingReason,
    estimated_gpu_h_remaining:
      pickNumber(asRecord(params.manifest.budget) ?? {}, [
        "remaining_gpu_hours",
        "remaining_gpu_h",
      ]) ??
      pickNumber(existing ?? {}, ["estimated_gpu_h_remaining"]),
  };

  const nextProjects = projects.filter(
    (entry) => pickString(entry, ["id"]) !== params.projectId
  );
  nextProjects.push(nextEntry);
  nextProjects.sort((left, right) => {
    const leftPriority = pickNumber(left, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = pickNumber(right, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftUpdated = pickString(left, ["updated"]) ?? "";
    const rightUpdated = pickString(right, ["updated"]) ?? "";
    return rightUpdated.localeCompare(leftUpdated);
  });

  projectsState.projects = nextProjects;
  projectsState.updated_at = now;
  await writeJsonEnsured(getProjectsStatePath(params.projectRoot), projectsState);
  return true;
}

async function writeAutoIteratorAudit(
  projectRoot: string,
  result: AutoIteratorResult
): Promise<string> {
  const auditPath = getAutoIteratorAuditPath(projectRoot);
  await writeJsonEnsured(auditPath, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    result,
  });
  return auditPath;
}

async function maybeQueueAutoIteratorMailbox(params: {
  projectRoot: string;
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  stage: string | null;
  nextAction: string | null;
  missingStageSignals: string[];
  cooldownSeconds: number;
}): Promise<{
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
}> {
  if (!params.fromRole || !params.toRole || params.fromRole === params.toRole) {
    return {
      queued: false,
      messageId: null,
      cooldownRemainingSeconds: null,
    };
  }
  if (!canRoleContact(params.fromRole, params.toRole)) {
    return {
      queued: false,
      messageId: null,
      cooldownRemainingSeconds: null,
    };
  }
  const cooldown = await getWorkflowContactCooldown({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    cooldownSeconds: params.cooldownSeconds,
  });
  if (cooldown.blocked) {
    return {
      queued: false,
      messageId: null,
      cooldownRemainingSeconds: cooldown.remainingSeconds,
    };
  }

  const item = await queueWorkflowMailboxMessage({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    subject: `auto-iterator: ${params.stage ?? "workflow"} owner handoff`,
    body: [
      `Please resume ${params.stage ?? "the workflow"} stage.`,
      params.nextAction ? `Next action: ${params.nextAction}` : null,
      params.missingStageSignals.length > 0
        ? `Missing stage signals: ${params.missingStageSignals.join("; ")}`
        : "Stage completion signals are satisfied; advance the stage work and update durable state.",
    ]
      .filter(Boolean)
      .join("\n"),
    kind: "handoff",
    priority: "high",
  });
  await recordWorkflowContactEvent({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    channel: "mailbox",
  });
  return {
    queued: true,
    messageId: item.id,
    cooldownRemainingSeconds: null,
  };
}

function serializeIdleResearchState(state: IdleResearchState): Record<string, unknown> {
  return {
    enabled: state.enabled,
    topic: state.topic,
    objective: state.objective,
    query_seeds: state.querySeeds,
    preferred_venues: state.preferredVenues,
    max_papers_per_cycle: state.maxPapersPerCycle,
    cooldown_minutes: state.cooldownMinutes,
    last_run_at: state.lastRunAt,
    last_digest_path: state.lastDigestPath,
    last_source_update_at: state.lastSourceUpdateAt,
    status: state.status,
    pending_reason: state.pendingReason,
    next_query_hint: state.nextQueryHint,
    refresh_graph_on_new_core_papers: state.refreshGraphOnNewCorePapers,
    last_round_new_canonical_papers: state.lastRoundNewCanonicalPapers,
    last_round_new_core_papers: state.lastRoundNewCorePapers,
  };
}

function normalizeInnovationReflectionState(
  value: unknown
): InnovationReflectionState {
  const record = asRecord(value) ?? {};
  return {
    requiredAfterExperiments:
      pickBoolean(record, [
        "requiredAfterExperiments",
        "required_after_experiments",
      ]) ?? true,
    status: normalizeStage(record.status) ?? "missing",
    lastReflectionAt: pickString(record, [
      "lastReflectionAt",
      "last_reflection_at",
    ]),
    lastReflectionPath: pickString(record, [
      "lastReflectionPath",
      "last_reflection_path",
    ]),
    reflectedThroughExperimentUpdateAt: pickString(record, [
      "reflectedThroughExperimentUpdateAt",
      "reflected_through_experiment_update_at",
    ]),
    reflectedExperimentIds: asStringArray(
      record.reflectedExperimentIds ?? record.reflected_experiment_ids
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeInnovationReflectionState(
  state: InnovationReflectionState
): Record<string, unknown> {
  return {
    required_after_experiments: state.requiredAfterExperiments,
    status: state.status,
    last_reflection_at: state.lastReflectionAt,
    last_reflection_path: state.lastReflectionPath,
    reflected_through_experiment_update_at:
      state.reflectedThroughExperimentUpdateAt,
    reflected_experiment_ids: state.reflectedExperimentIds,
    pending_reason: state.pendingReason,
  };
}

function normalizeBrainstormCycleOptionState(
  value: unknown
): BrainstormCycleOptionState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const optionId =
    pickString(record, ["optionId", "option_id"]) ??
    pickString(record, ["id"]);
  if (!optionId) {
    return null;
  }
  return {
    optionId,
    title: pickString(record, ["title", "name"]),
    summary: pickString(record, ["summary", "description"]),
    score: pickNumber(record, ["score", "ranking_score", "rank_score"]),
    status: normalizeStage(record.status),
    verdict: pickString(record, ["verdict", "decision"]),
  };
}

function serializeBrainstormCycleOptionState(
  state: BrainstormCycleOptionState
): Record<string, unknown> {
  return {
    option_id: state.optionId,
    title: state.title,
    summary: state.summary,
    score: state.score,
    status: state.status,
    verdict: state.verdict,
  };
}

function normalizeBrainstormCycleRoundState(
  value: unknown
): BrainstormCycleRoundState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const roundId =
    pickString(record, ["roundId", "round_id"]) ??
    pickString(record, ["id"]);
  if (!roundId) {
    return null;
  }
  const rawOptions = Array.isArray(record.options) ? record.options : [];
  return {
    roundId,
    label: pickString(record, ["label", "name"]),
    status: normalizeStage(record.status),
    focus: pickString(record, ["focus"]),
    options: rawOptions
      .map((option) => normalizeBrainstormCycleOptionState(option))
      .filter((option): option is BrainstormCycleOptionState => Boolean(option)),
  };
}

function serializeBrainstormCycleRoundState(
  state: BrainstormCycleRoundState
): Record<string, unknown> {
  return {
    round_id: state.roundId,
    label: state.label,
    status: state.status,
    focus: state.focus,
    options: state.options.map((option) =>
      serializeBrainstormCycleOptionState(option)
    ),
  };
}

function normalizeBrainstormCycleState(value: unknown): BrainstormCycleState {
  const record = asRecord(value) ?? {};
  const rounds = Array.isArray(record.rounds)
    ? record.rounds
        .map((round) => normalizeBrainstormCycleRoundState(round))
        .filter((round): round is BrainstormCycleRoundState => Boolean(round))
    : [];
  return {
    status: normalizeStage(record.status) ?? "missing",
    mode: pickString(record, ["mode"]),
    topic: pickString(record, ["topic"]),
    basisStage: normalizeStage(record.basisStage ?? record.basis_stage),
    trackId: pickString(record, ["trackId", "track_id"]),
    rounds,
    selectedRoundId: pickString(record, ["selectedRoundId", "selected_round_id"]),
    selectedOptionId: pickString(record, [
      "selectedOptionId",
      "selected_option_id",
    ]),
    selectedOptionTitle: pickString(record, [
      "selectedOptionTitle",
      "selected_option_title",
    ]),
    selectedOptionScore: pickNumber(record, [
      "selectedOptionScore",
      "selected_option_score",
    ]),
    selectionMode: pickString(record, ["selectionMode", "selection_mode"]),
    topicSummaryPath:
      pickString(record, ["topicSummaryPath", "topic_summary_path"]) ??
      DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH,
    researchBriefPath:
      pickString(record, ["researchBriefPath", "research_brief_path"]) ??
      DEFAULT_BRAINSTORM_RESEARCH_BRIEF_PATH,
    brainstormBriefPath:
      pickString(record, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
      DEFAULT_BRAINSTORM_BRIEF_PATH,
    logicChainPath:
      pickString(record, ["logicChainPath", "logic_chain_path"]) ??
      DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH,
    evidenceChainPath:
      pickString(record, ["evidenceChainPath", "evidence_chain_path"]) ??
      DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH,
    reasoningTracePath:
      pickString(record, ["reasoningTracePath", "reasoning_trace_path"]) ??
      DEFAULT_BRAINSTORM_REASONING_TRACE_PATH,
    questionPacketPath:
      pickString(record, ["questionPacketPath", "question_packet_path"]) ??
      DEFAULT_BRAINSTORM_QUESTION_PACKET_PATH,
    workingMemoryPath:
      pickString(record, ["workingMemoryPath", "working_memory_path"]) ??
      DEFAULT_BRAINSTORM_WORKING_MEMORY_PATH,
    synthesisPacketPath:
      pickString(record, ["synthesisPacketPath", "synthesis_packet_path"]) ??
      DEFAULT_BRAINSTORM_SYNTHESIS_PACKET_PATH,
    reflectionChainPath:
      pickString(record, ["reflectionChainPath", "reflection_chain_path"]) ??
      DEFAULT_BRAINSTORM_REFLECTION_CHAIN_PATH,
    theoryBriefPath:
      pickString(record, ["theoryBriefPath", "theory_brief_path"]) ??
      DEFAULT_BRAINSTORM_THEORY_BRIEF_PATH,
    storylineBriefPath:
      pickString(record, ["storylineBriefPath", "storyline_brief_path"]) ??
      DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH,
    graphVersionSeen: pickString(record, ["graphVersionSeen", "graph_version_seen"]),
    importTaskIdsSeen: asStringArray(
      record.importTaskIdsSeen ?? record.import_task_ids_seen
    ),
    latestRunAt: pickString(record, ["latestRunAt", "latest_run_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeBrainstormCycleState(
  state: BrainstormCycleState
): Record<string, unknown> {
  return {
    status: state.status,
    mode: state.mode,
    topic: state.topic,
    basis_stage: state.basisStage,
    track_id: state.trackId,
    rounds: state.rounds.map((round) => serializeBrainstormCycleRoundState(round)),
    selected_round_id: state.selectedRoundId,
    selected_option_id: state.selectedOptionId,
    selected_option_title: state.selectedOptionTitle,
    selected_option_score: state.selectedOptionScore,
    selection_mode: state.selectionMode,
    topic_summary_path: state.topicSummaryPath,
    research_brief_path: state.researchBriefPath,
    brainstorm_brief_path: state.brainstormBriefPath,
    logic_chain_path: state.logicChainPath,
    evidence_chain_path: state.evidenceChainPath,
    reasoning_trace_path: state.reasoningTracePath,
    question_packet_path: state.questionPacketPath,
    working_memory_path: state.workingMemoryPath,
    synthesis_packet_path: state.synthesisPacketPath,
    reflection_chain_path: state.reflectionChainPath,
    theory_brief_path: state.theoryBriefPath,
    storyline_brief_path: state.storylineBriefPath,
    graph_version_seen: state.graphVersionSeen,
    import_task_ids_seen: state.importTaskIdsSeen,
    latest_run_at: state.latestRunAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeTheoryObjectPacket(value: unknown): TheoryObjectPacket | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const statement = pickString(record, ["statement"]);
  const packetId =
    pickString(record, ["packetId", "packet_id"]) ??
    pickString(record, ["lemmaId", "lemma_id"]) ??
    pickString(record, ["theoremId", "theorem_id"]);
  if (!packetId || !statement) {
    return null;
  }
  return {
    packet_id: packetId,
    role:
      pickString(record, ["role", "kind", "type"]) ??
      (packetId.startsWith("thm_") ? "theorem" : "lemma"),
    title: pickString(record, ["title", "name"]),
    statement,
    short_result: pickString(record, ["shortResult", "short_result", "result"]),
    body_safe: pickBoolean(record, ["bodySafe", "body_safe"]) ?? false,
    confidence: pickString(record, ["confidence", "signal"]),
    appendix_required:
      pickBoolean(record, ["appendixRequired", "appendix_required"]) ?? true,
    appendix_path: pickString(record, ["appendixPath", "appendix_path"]),
    evidence_pointers: asStringArray(
      record.evidencePointers ?? record.evidence_pointers
    ),
    assumptions: asStringArray(record.assumptions),
    derivation_outline: asStringArray(
      record.derivationOutline ?? record.derivation_outline
    ),
    caveats: asStringArray(record.caveats),
    notes: pickString(record, ["notes", "note"]),
    source_claim_ids: asStringArray(
      record.sourceClaimIds ?? record.source_claim_ids
    ),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function serializeTheoryObjectPacket(packet: TheoryObjectPacket): Record<string, unknown> {
  return {
    packet_id: packet.packet_id,
    role: packet.role,
    title: packet.title,
    statement: packet.statement,
    short_result: packet.short_result,
    body_safe: packet.body_safe,
    confidence: packet.confidence,
    appendix_required: packet.appendix_required,
    appendix_path: packet.appendix_path,
    evidence_pointers: packet.evidence_pointers,
    assumptions: packet.assumptions,
    derivation_outline: packet.derivation_outline,
    caveats: packet.caveats,
    notes: packet.notes,
    source_claim_ids: packet.source_claim_ids,
    updated_at: packet.updated_at,
  };
}

function normalizeTheoryStateFile(value: unknown): TheoryStateFile {
  const record = asRecord(value) ?? {};
  const theoremCandidates = Array.isArray(record.theorem_candidates)
    ? record.theorem_candidates.map(normalizeTheoryObjectPacket).filter(Boolean)
    : [];
  const lemmaPackets = Array.isArray(record.lemma_packets)
    ? record.lemma_packets.map(normalizeTheoryObjectPacket).filter(Boolean)
    : [];
  const appendixSections = Array.isArray(record.appendix_sections)
    ? record.appendix_sections
        .map((item) => {
          const section = asRecord(item);
          if (!section) {
            return null;
          }
          const sectionId = pickString(section, ["sectionId", "section_id"]);
          const title = pickString(section, ["title"]);
          if (!sectionId || !title) {
            return null;
          }
          return {
            section_id: sectionId,
            title,
            purpose: pickString(section, ["purpose"]),
            packet_ids: asStringArray(section.packetIds ?? section.packet_ids),
          } satisfies TheoryAppendixSection;
        })
        .filter(Boolean)
    : [];
  return {
    schema_version:
      Math.max(1, Math.floor(pickNumber(record, ["schemaVersion", "schema_version"]) ?? 1)),
    status: normalizeStage(record.status) ?? "missing",
    overall_signal: pickString(record, ["overallSignal", "overall_signal"]),
    source_theory_note_path:
      pickString(record, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
      DEFAULT_THEORY_NOTE_PATH,
    thesis: pickString(record, ["thesis"]),
    body_guidance: pickString(record, ["bodyGuidance", "body_guidance"]),
    main_text_proof_style:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    theorem_candidates: theoremCandidates as TheoryObjectPacket[],
    lemma_packets: lemmaPackets as TheoryObjectPacket[],
    appendix_sections: appendixSections as TheoryAppendixSection[],
    pending_reason: pickString(record, ["pendingReason", "pending_reason"]),
    updated_at: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function serializeTheoryStateFile(state: TheoryStateFile): Record<string, unknown> {
  return {
    schema_version: state.schema_version,
    status: state.status,
    overall_signal: state.overall_signal,
    source_theory_note_path: state.source_theory_note_path,
    thesis: state.thesis,
    body_guidance: state.body_guidance,
    main_text_proof_style: state.main_text_proof_style,
    theorem_candidates: state.theorem_candidates.map(serializeTheoryObjectPacket),
    lemma_packets: state.lemma_packets.map(serializeTheoryObjectPacket),
    appendix_sections: state.appendix_sections.map((section) => ({
      section_id: section.section_id,
      title: section.title,
      purpose: section.purpose,
      packet_ids: section.packet_ids,
    })),
    pending_reason: state.pending_reason,
    updated_at: state.updated_at,
  };
}

function normalizeTheorySupportState(value: unknown): TheorySupportState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    overallSignal: pickString(record, ["overallSignal", "overall_signal"]),
    theoryStatePath:
      pickString(record, ["theoryStatePath", "theory_state_path"]) ??
      DEFAULT_THEORY_STATE_PATH,
    sourceTheoryNotePath:
      pickString(record, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
      DEFAULT_THEORY_NOTE_PATH,
    proofPacketDir:
      pickString(record, ["proofPacketDir", "proof_packet_dir"]) ??
      DEFAULT_PROOF_PACKET_DIR,
    appendixPacketPath:
      pickString(record, ["appendixPacketPath", "appendix_packet_path"]) ??
      DEFAULT_THEORY_APPENDIX_PLAN_PATH,
    mainTextProofStyle:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    bodyReady: pickBoolean(record, ["bodyReady", "body_ready"]) ?? false,
    theoremCount: Math.max(0, Math.floor(pickNumber(record, ["theoremCount", "theorem_count"]) ?? 0)),
    lemmaCount: Math.max(0, Math.floor(pickNumber(record, ["lemmaCount", "lemma_count"]) ?? 0)),
    proofPacketCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["proofPacketCount", "proof_packet_count"]) ?? 0)
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeTheorySupportState(state: TheorySupportState): Record<string, unknown> {
  return {
    status: state.status,
    overall_signal: state.overallSignal,
    theory_state_path: state.theoryStatePath,
    source_theory_note_path: state.sourceTheoryNotePath,
    proof_packet_dir: state.proofPacketDir,
    appendix_packet_path: state.appendixPacketPath,
    main_text_proof_style: state.mainTextProofStyle,
    body_ready: state.bodyReady,
    theorem_count: state.theoremCount,
    lemma_count: state.lemmaCount,
    proof_packet_count: state.proofPacketCount,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function humanizeTheoryPacketLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) {
    return "Untitled theory packet";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function dedupeTheoryPackets(packets: TheoryObjectPacket[]): TheoryObjectPacket[] {
  const unique = new Map<string, TheoryObjectPacket>();
  for (const packet of packets) {
    if (!packet?.packet_id) {
      continue;
    }
    if (!unique.has(packet.packet_id)) {
      unique.set(packet.packet_id, packet);
    }
  }
  return Array.from(unique.values()).sort((left, right) => {
    const rank = (role: string) =>
      role === "theorem" || role === "proposition" || role === "corollary" ? 0 : 1;
    const roleDelta = rank(left.role) - rank(right.role);
    if (roleDelta !== 0) {
      return roleDelta;
    }
    return (left.title ?? left.packet_id).localeCompare(right.title ?? right.packet_id);
  });
}

function inferTheoryAppendixSections(params: {
  packets: TheoryObjectPacket[];
  existingSections: TheoryAppendixSection[];
}): TheoryAppendixSection[] {
  const appendixPackets = params.packets.filter(
    (packet) =>
      packet.appendix_required ||
      packet.derivation_outline.length > 0 ||
      packet.assumptions.length > 0 ||
      packet.caveats.length > 0
  );
  const appendixPacketIds = new Set(appendixPackets.map((packet) => packet.packet_id));
  const sections: TheoryAppendixSection[] = [];
  const seenSectionIds = new Set<string>();
  const coveredPacketIds = new Set<string>();

  for (const section of params.existingSections) {
    const packetIds = section.packet_ids.filter((packetId) => appendixPacketIds.has(packetId));
    if (packetIds.length === 0 || seenSectionIds.has(section.section_id)) {
      continue;
    }
    sections.push({
      section_id: section.section_id,
      title: section.title,
      purpose: section.purpose,
      packet_ids: packetIds,
    });
    seenSectionIds.add(section.section_id);
    for (const packetId of packetIds) {
      coveredPacketIds.add(packetId);
    }
  }

  for (const packet of appendixPackets) {
    if (coveredPacketIds.has(packet.packet_id)) {
      continue;
    }
    const title = packet.title ?? humanizeTheoryPacketLabel(packet.packet_id);
    const sectionId = `appendix_${packet.packet_id}`;
    if (seenSectionIds.has(sectionId)) {
      continue;
    }
    sections.push({
      section_id: sectionId,
      title,
      purpose: `Detailed ${packet.role} derivation and boundary conditions for ${title}.`,
      packet_ids: [packet.packet_id],
    });
    seenSectionIds.add(sectionId);
  }

  return sections;
}

function escapeLatexText(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function sanitizeLatexLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9:-]+/g, "-");
}

function renderMarkdownList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function renderLatexItemList(items: string[]): string {
  if (items.length === 0) {
    return "\\begin{itemize}\n\\item None.\n\\end{itemize}";
  }
  return [
    "\\begin{itemize}",
    ...items.map((item) => `\\item ${escapeLatexText(item)}`),
    "\\end{itemize}",
  ].join("\n");
}

function buildTheoryAppendixPlanMarkdown(params: {
  theoryFile: TheoryStateFile;
  packets: TheoryObjectPacket[];
  appendixSections: TheoryAppendixSection[];
  appendixSectionPath: string;
}): string {
  const bodySafePackets = params.packets.filter((packet) => packet.body_safe);
  const appendixOnlyPackets = params.packets.filter((packet) => !packet.body_safe);
  const lines: string[] = [
    "# Theory Appendix Plan",
    "",
    "## Synthesis Summary",
    `- Overall signal: ${(params.theoryFile.overall_signal ?? "unknown").toUpperCase()}`,
    `- Thesis: ${params.theoryFile.thesis ?? "Not yet stated"}`,
    `- Main-text proof style: ${params.theoryFile.main_text_proof_style ?? "lemma_result_only"}`,
    `- Body-safe packets: ${bodySafePackets.length}`,
    `- Appendix sections: ${params.appendixSections.length}`,
    `- Appendix draft path: ${params.appendixSectionPath}`,
    "",
    "## Main-Text Safe Statements",
  ];

  if (bodySafePackets.length === 0) {
    lines.push(
      "- No packet is currently body-safe. Keep theory discussion in mechanism / appendix language until stronger support exists."
    );
  } else {
    for (const packet of bodySafePackets) {
      lines.push(`### ${packet.title ?? humanizeTheoryPacketLabel(packet.packet_id)}`);
      lines.push(`- Packet ID: ${packet.packet_id}`);
      lines.push(`- Role: ${packet.role}`);
      lines.push(`- Statement: ${packet.statement}`);
      if (packet.short_result) {
        lines.push(`- Main-text result: ${packet.short_result}`);
      }
      lines.push(
        `- Evidence basis:\n${renderMarkdownList(packet.evidence_pointers, "Use the paired empirical evidence from the analyzer report.")}`
      );
      lines.push(
        `- Assumptions:\n${renderMarkdownList(packet.assumptions, "State assumptions conservatively in prose.")}`
      );
      lines.push(
        `- Caveats:\n${renderMarkdownList(packet.caveats, "No extra caveat recorded yet.")}`
      );
      lines.push("");
    }
  }

  lines.push("## Appendix Sections");
  if (params.appendixSections.length === 0) {
    lines.push("- No appendix section is required yet.");
  } else {
    for (const section of params.appendixSections) {
      const packets = section.packet_ids
        .map((packetId) => params.packets.find((packet) => packet.packet_id === packetId))
        .filter(Boolean) as TheoryObjectPacket[];
      lines.push(`### ${section.title}`);
      if (section.purpose) {
        lines.push(`- Purpose: ${section.purpose}`);
      }
      lines.push(`- Packet IDs: ${section.packet_ids.join(", ")}`);
      for (const packet of packets) {
        lines.push(`- ${packet.role}: ${packet.statement}`);
        if (packet.derivation_outline.length > 0) {
          lines.push(
            `  - Derivation outline:\n${packet.derivation_outline
              .map((item) => `    - ${item}`)
              .join("\n")}`
          );
        }
      }
      lines.push("");
    }
  }

  lines.push("## Non-Body-Safe / Exploratory Packets");
  if (appendixOnlyPackets.length === 0) {
    lines.push("- None.");
  } else {
    for (const packet of appendixOnlyPackets) {
      lines.push(`- ${packet.packet_id}: ${packet.statement}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildTheoryAppendixSectionDraft(params: {
  theoryFile: TheoryStateFile;
  packets: TheoryObjectPacket[];
  appendixSections: TheoryAppendixSection[];
}): string {
  const sections: string[] = [
    "% Auto-generated theory appendix draft from THEORY_STATE.json and proof packets.",
    "\\section{Additional Theory and Derivation Details}",
    "\\label{app:theory}",
    "",
    "This appendix expands the theorem and lemma sketches referenced in the main text.",
    "",
  ];

  for (const section of params.appendixSections) {
    sections.push(`\\subsection{${escapeLatexText(section.title)}}`);
    sections.push(`\\label{sec:${sanitizeLatexLabel(section.section_id)}}`);
    if (section.purpose) {
      sections.push(escapeLatexText(section.purpose));
      sections.push("");
    }
    const packets = section.packet_ids
      .map((packetId) => params.packets.find((packet) => packet.packet_id === packetId))
      .filter(Boolean) as TheoryObjectPacket[];
    for (const packet of packets) {
      sections.push(
        `\\paragraph{${escapeLatexText(humanizeTheoryPacketLabel(packet.role))}: ${escapeLatexText(packet.title ?? humanizeTheoryPacketLabel(packet.packet_id))}}`
      );
      sections.push(escapeLatexText(packet.statement));
      sections.push("");
      if (packet.short_result) {
        sections.push(`\\textbf{Result connection.} ${escapeLatexText(packet.short_result)}`);
        sections.push("");
      }
      sections.push("\\textbf{Assumptions.}");
      sections.push(renderLatexItemList(packet.assumptions));
      sections.push("");
      sections.push("\\textbf{Derivation sketch.}");
      if (packet.derivation_outline.length === 0) {
        sections.push(
          "\\begin{enumerate}\n\\item Expand this derivation from the structured packet before submission.\n\\end{enumerate}"
        );
      } else {
        sections.push(
          [
            "\\begin{enumerate}",
            ...packet.derivation_outline.map(
              (item) => `\\item ${escapeLatexText(item)}`
            ),
            "\\end{enumerate}",
          ].join("\n")
        );
      }
      sections.push("");
      sections.push("\\textbf{Evidence links.}");
      sections.push(renderLatexItemList(packet.evidence_pointers));
      sections.push("");
      sections.push("\\textbf{Caveats.}");
      sections.push(renderLatexItemList(packet.caveats));
      sections.push("");
    }
  }

  if (params.appendixSections.length === 0) {
    sections.push(
      "No appendix-only theorem or lemma packet is currently available. Keep theoretical discussion conservative."
    );
    sections.push("");
  }

  return `${sections.join("\n").trim()}\n`;
}

function resolveWritingTemplatePath(
  projectRoot: string | null,
  templatePath: string | null
): string | null {
  if (!templatePath) {
    return null;
  }
  if (path.isAbsolute(templatePath)) {
    return path.normalize(templatePath);
  }
  if (!projectRoot) {
    return templatePath;
  }
  return path.normalize(path.join(projectRoot, templatePath));
}

function sanitizeTemplateCopyName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "template";
}

function getConfiguredWritingModeTemplatePath(
  policy: WorkflowGuardPolicy | undefined,
  mode: WritingMode
): string | null {
  const normalized = normalizePolicy(policy as Record<string, unknown> | undefined);
  const configured =
    mode === "conference"
      ? normalized.defaultConferenceTemplatePath
      : normalized.defaultJournalTemplatePath;
  return configured || null;
}

async function copyWritingTemplateIntoProject(params: {
  projectRoot: string;
  sourcePath: string;
  paperMode: WritingMode | null;
}): Promise<{
  projectTemplatePath: string;
  projectTemplateResolvedPath: string;
}> {
  const resolvedSourcePath = path.normalize(params.sourcePath);
  const projectRoot = path.normalize(params.projectRoot);

  if (isInside(projectRoot, resolvedSourcePath)) {
    return {
      projectTemplatePath: path.relative(projectRoot, resolvedSourcePath),
      projectTemplateResolvedPath: resolvedSourcePath,
    };
  }

  const sourceStat = await fs.stat(resolvedSourcePath);
  const templateBundleRoot = path.join(projectRoot, "academic_writer", "template_bundle");
  await fs.mkdir(templateBundleRoot, { recursive: true });

  const modePrefix = params.paperMode ? `${params.paperMode}-` : "";
  if (sourceStat.isDirectory()) {
    const destinationDir = path.join(
      templateBundleRoot,
      `${modePrefix}${sanitizeTemplateCopyName(path.basename(resolvedSourcePath))}`
    );
    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.cp(resolvedSourcePath, destinationDir, { recursive: true, force: true });
    return {
      projectTemplatePath: path.relative(projectRoot, destinationDir),
      projectTemplateResolvedPath: destinationDir,
    };
  }

  const sourceDir = path.dirname(resolvedSourcePath);
  const destinationDir = path.join(
    templateBundleRoot,
    `${modePrefix}${sanitizeTemplateCopyName(path.basename(sourceDir))}`
  );
  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.cp(sourceDir, destinationDir, { recursive: true, force: true });
  const destinationFile = path.join(destinationDir, path.basename(resolvedSourcePath));
  return {
    projectTemplatePath: path.relative(projectRoot, destinationFile),
    projectTemplateResolvedPath: destinationFile,
  };
}

async function resolveBundledWritingModeTemplatePath(
  mode: WritingMode
): Promise<string | null> {
  const preset = WRITING_MODE_PRESETS[mode];
  const relativePath = path.join("templates", "writing", preset.templateFile);
  const candidates = [
    path.join(MODULE_DIR, "..", relativePath),
    path.join(MODULE_DIR, "..", "..", relativePath),
  ];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (await pathExists(normalized)) {
      return normalized;
    }
  }
  return path.normalize(candidates[0]);
}

function normalizeWritingContractState(value: unknown): WritingContractState {
  const record = asRecord(value) ?? {};
  return {
    paperMode: normalizeWritingMode(record.paperMode ?? record.paper_mode),
    templateRequired:
      pickBoolean(record, ["templateRequired", "template_required"]) ?? false,
    templatePath: pickString(record, ["templatePath", "template_path"]),
    projectTemplatePath: pickString(record, [
      "projectTemplatePath",
      "project_template_path",
    ]),
    templateName: pickString(record, ["templateName", "template_name"]),
    templateStatus: normalizeStage(record.templateStatus ?? record.template_status) ?? "optional",
    templateCopyStatus:
      normalizeStage(record.templateCopyStatus ?? record.template_copy_status) ?? "pending",
    bodyPageBudget: pickNumber(record, ["bodyPageBudget", "body_page_budget"]),
    referencePageBudget: pickNumber(record, [
      "referencePageBudget",
      "reference_page_budget",
    ]),
    bodyWordTargetMin: pickNumber(record, [
      "bodyWordTargetMin",
      "body_word_target_min",
    ]),
    bodyWordTargetMax: pickNumber(record, [
      "bodyWordTargetMax",
      "body_word_target_max",
    ]),
    maxCoreIdeas:
      Math.max(1, Math.floor(pickNumber(record, ["maxCoreIdeas", "max_core_ideas"]) ?? 2)),
    maxHeadlineClaims:
      Math.max(
        1,
        Math.floor(pickNumber(record, ["maxHeadlineClaims", "max_headline_claims"]) ?? 3)
      ),
    mainTextProofStyle:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    proofAppendixRequired:
      pickBoolean(record, ["proofAppendixRequired", "proof_appendix_required"]) ?? true,
    proofAppendixPath:
      pickString(record, ["proofAppendixPath", "proof_appendix_path"]) ??
      "academic_writer/paper/sections/appendix_theory.tex",
    proofAppendixStatus:
      normalizeStage(record.proofAppendixStatus ?? record.proof_appendix_status) ?? "pending",
    theoryNotePath:
      pickString(record, ["theoryNotePath", "theory_note_path"]) ??
      "analyzer/THEORY_SUPPORT_NOTE.md",
    proofChecklist:
      asStringArray(record.proofChecklist ?? record.proof_checklist).length > 0
        ? asStringArray(record.proofChecklist ?? record.proof_checklist)
        : [...DEFAULT_PROOF_CHECKLIST],
    storylineSource: pickString(record, ["storylineSource", "storyline_source"]),
    kgStorylineRequired:
      pickBoolean(record, ["kgStorylineRequired", "kg_storyline_required"]) ?? false,
    kgStorylineStatus:
      normalizeStage(record.kgStorylineStatus ?? record.kg_storyline_status) ?? "missing",
    kgStorylinePacketPath: pickString(record, [
      "kgStorylinePacketPath",
      "kg_storyline_packet_path",
    ]),
    storylineChecklist:
      asStringArray(record.storylineChecklist ?? record.storyline_checklist).length > 0
        ? asStringArray(record.storylineChecklist ?? record.storyline_checklist)
        : [...DEFAULT_STORYLINE_CHECKLIST],
    requiredSections:
      asStringArray(record.requiredSections ?? record.required_sections).length > 0
        ? asStringArray(record.requiredSections ?? record.required_sections)
        : [...DEFAULT_WRITING_SECTION_ORDER],
    sectionOrder:
      asStringArray(record.sectionOrder ?? record.section_order).length > 0
        ? asStringArray(record.sectionOrder ?? record.section_order)
        : [...DEFAULT_WRITING_SECTION_ORDER],
    paragraphLogicChecklist:
      asStringArray(
        record.paragraphLogicChecklist ?? record.paragraph_logic_checklist
      ).length > 0
        ? asStringArray(
            record.paragraphLogicChecklist ?? record.paragraph_logic_checklist
          )
        : [...DEFAULT_PARAGRAPH_LOGIC_CHECKLIST],
    paragraphLogicStatus:
      normalizeStage(
        record.paragraphLogicStatus ?? record.paragraph_logic_status
      ) ?? "pending",
    lastTemplateAppliedAt: pickString(record, [
      "lastTemplateAppliedAt",
      "last_template_applied_at",
    ]),
    lastParagraphLogicAuditAt: pickString(record, [
      "lastParagraphLogicAuditAt",
      "last_paragraph_logic_audit_at",
    ]),
    templateMappingPath: pickString(record, [
      "templateMappingPath",
      "template_mapping_path",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeWritingContractState(
  state: WritingContractState
): Record<string, unknown> {
  return {
    paper_mode: state.paperMode,
    template_required: state.templateRequired,
    template_path: state.templatePath,
    project_template_path: state.projectTemplatePath,
    template_name: state.templateName,
    template_status: state.templateStatus,
    template_copy_status: state.templateCopyStatus,
    body_page_budget: state.bodyPageBudget,
    reference_page_budget: state.referencePageBudget,
    body_word_target_min: state.bodyWordTargetMin,
    body_word_target_max: state.bodyWordTargetMax,
    max_core_ideas: state.maxCoreIdeas,
    max_headline_claims: state.maxHeadlineClaims,
    main_text_proof_style: state.mainTextProofStyle,
    proof_appendix_required: state.proofAppendixRequired,
    proof_appendix_path: state.proofAppendixPath,
    proof_appendix_status: state.proofAppendixStatus,
    theory_note_path: state.theoryNotePath,
    proof_checklist: state.proofChecklist,
    storyline_source: state.storylineSource,
    kg_storyline_required: state.kgStorylineRequired,
    kg_storyline_status: state.kgStorylineStatus,
    kg_storyline_packet_path: state.kgStorylinePacketPath,
    storyline_checklist: state.storylineChecklist,
    required_sections: state.requiredSections,
    section_order: state.sectionOrder,
    paragraph_logic_checklist: state.paragraphLogicChecklist,
    paragraph_logic_status: state.paragraphLogicStatus,
    last_template_applied_at: state.lastTemplateAppliedAt,
    last_paragraph_logic_audit_at: state.lastParagraphLogicAuditAt,
    template_mapping_path: state.templateMappingPath,
    pending_reason: state.pendingReason,
  };
}

async function evaluateWritingContractState(params: {
  projectRoot: string | null;
  state: WritingContractState;
}): Promise<{
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  pendingReason: string | null;
}> {
  const sourceTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    params.state.templatePath
  );
  const projectTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    params.state.projectTemplatePath
  );
  const projectTemplateExists = projectTemplateResolvedPath
    ? await pathExists(projectTemplateResolvedPath)
    : false;
  const sourceTemplateExists = sourceTemplateResolvedPath
    ? await pathExists(sourceTemplateResolvedPath)
    : false;
  const templateResolvedPath = projectTemplateExists
    ? projectTemplateResolvedPath
    : sourceTemplateResolvedPath;
  const templateExists = projectTemplateExists || sourceTemplateExists;

  let templateStatus = params.state.templateStatus;
  let templateCopyStatus = params.state.templateCopyStatus;
  let pendingReason = params.state.pendingReason;

  if (!params.state.templateRequired && !params.state.templatePath) {
    templateStatus = "optional";
    templateCopyStatus = params.state.projectTemplatePath ? "ready" : "pending";
    pendingReason = null;
  } else if (params.state.templateRequired && !params.state.templatePath) {
    templateStatus = "missing";
    templateCopyStatus = "missing";
    pendingReason =
      pendingReason ??
      "Writer is required to follow a user-provided template, but writing_contract.template_path is not configured.";
  } else if (params.state.templatePath && !templateExists) {
    templateStatus = "missing";
    templateCopyStatus = "missing";
    pendingReason =
      pendingReason ??
      "The configured writing template path cannot be read. Restore the template file or update writing_contract.template_path.";
  } else if (params.state.lastTemplateAppliedAt) {
    templateStatus =
      params.state.templateStatus === "configured" ? "applied" : params.state.templateStatus;
    templateCopyStatus = projectTemplateExists ? "ready" : "source_only";
    pendingReason = null;
  } else if (params.state.templatePath) {
    templateStatus =
      params.state.templateStatus === "optional" ? "configured" : params.state.templateStatus;
    templateCopyStatus = projectTemplateExists ? "ready" : "source_only";
    pendingReason = null;
  }

  return {
    templateResolvedPath,
    projectTemplateResolvedPath,
    sourceTemplateResolvedPath,
    templateExists,
    templateStatus,
    templateCopyStatus,
    pendingReason,
  };
}

function resolveProjectArtifactPath(
  projectRoot: string | null,
  artifactPath: string | null
): string | null {
  if (!artifactPath) {
    return null;
  }
  if (path.isAbsolute(artifactPath)) {
    return path.normalize(artifactPath);
  }
  if (!projectRoot) {
    return artifactPath;
  }
  return path.normalize(path.join(projectRoot, artifactPath));
}

function normalizeCitationIntegrityState(value: unknown): CitationIntegrityState {
  const record = asRecord(value) ?? {};
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? true,
    verificationRequired:
      pickBoolean(record, ["verificationRequired", "verification_required"]) ?? true,
    sourceOfTruth:
      asStringArray(record.sourceOfTruth ?? record.source_of_truth).length > 0
        ? asStringArray(record.sourceOfTruth ?? record.source_of_truth)
        : [...DEFAULT_CITATION_SOURCE_OF_TRUTH],
    bibliographyPath:
      pickString(record, ["bibliographyPath", "bibliography_path"]) ??
      DEFAULT_CITATION_BIB_PATH,
    verificationReportPath:
      pickString(record, ["verificationReportPath", "verification_report_path"]) ??
      DEFAULT_CITATION_REPORT_PATH,
    verificationStatus:
      normalizeStage(record.verificationStatus ?? record.verification_status) ?? "pending",
    allowedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "allowedPlaceholderCount",
          "allowed_placeholder_count",
        ]) ?? 0
      )
    ),
    unresolvedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "unresolvedPlaceholderCount",
          "unresolved_placeholder_count",
        ]) ?? 0
      )
    ),
    verifiedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["verifiedCitationCount", "verified_citation_count"]) ?? 0
      )
    ),
    suspiciousCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "suspiciousCitationCount",
          "suspicious_citation_count",
        ]) ?? 0
      )
    ),
    hallucinatedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "hallucinatedCitationCount",
          "hallucinated_citation_count",
        ]) ?? 0
      )
    ),
    lastVerifiedAt: pickString(record, ["lastVerifiedAt", "last_verified_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeCitationIntegrityState(
  state: CitationIntegrityState
): Record<string, unknown> {
  return {
    enabled: state.enabled,
    verification_required: state.verificationRequired,
    source_of_truth: state.sourceOfTruth,
    bibliography_path: state.bibliographyPath,
    verification_report_path: state.verificationReportPath,
    verification_status: state.verificationStatus,
    allowed_placeholder_count: state.allowedPlaceholderCount,
    unresolved_placeholder_count: state.unresolvedPlaceholderCount,
    verified_citation_count: state.verifiedCitationCount,
    suspicious_citation_count: state.suspiciousCitationCount,
    hallucinated_citation_count: state.hallucinatedCitationCount,
    last_verified_at: state.lastVerifiedAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeWritingSectionPacketState(
  key: string,
  value: unknown
): WritingSectionPacketState {
  const record = asRecord(value) ?? {};
  return {
    section: normalizeStage(record.section) ?? normalizeStage(key) ?? key,
    sectionClass:
      normalizeStage(record.sectionClass ?? record.section_class) ?? null,
    goal: pickString(record, ["goal"]),
    allowedClaims: asStringArray(record.allowedClaims ?? record.allowed_claims),
    requiredGraphEvidencePointers: asStringArray(
      record.requiredGraphEvidencePointers ?? record.required_graph_evidence_pointers
    ),
    forbiddenUnsupportedClaims: asStringArray(
      record.forbiddenUnsupportedClaims ?? record.forbidden_unsupported_claims
    ),
    missingCitationPlaceholders: asStringArray(
      record.missingCitationPlaceholders ?? record.missing_citation_placeholders
    ),
    requiredCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "requiredCitationCount",
          "required_citation_count",
        ]) ?? 0
      )
    ),
    requiredFigureIds: asStringArray(
      record.requiredFigureIds ?? record.required_figure_ids
    ),
    dependentSections: asStringArray(
      record.dependentSections ?? record.dependent_sections
    ).map((entry) => normalizeStage(entry) ?? entry),
    stale:
      pickBoolean(record, ["stale"]) ??
      normalizeStage(record.status) === "stale",
    packetPath: pickString(record, ["packetPath", "packet_path"]),
    draftPath: pickString(record, ["draftPath", "draft_path"]),
    reviewPath: pickString(record, ["reviewPath", "review_path"]),
    reviewVerdict:
      pickString(record, ["reviewVerdict", "review_verdict"]) ?? null,
    status: normalizeStage(record.status) ?? "pending",
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function serializeWritingSectionPacketState(
  state: WritingSectionPacketState
): Record<string, unknown> {
  return {
    section: state.section,
    section_class: state.sectionClass,
    goal: state.goal,
    allowed_claims: state.allowedClaims,
    required_graph_evidence_pointers: state.requiredGraphEvidencePointers,
    forbidden_unsupported_claims: state.forbiddenUnsupportedClaims,
    missing_citation_placeholders: state.missingCitationPlaceholders,
    required_citation_count: state.requiredCitationCount,
    required_figure_ids: state.requiredFigureIds,
    dependent_sections: state.dependentSections,
    stale: state.stale,
    packet_path: state.packetPath,
    draft_path: state.draftPath,
    review_path: state.reviewPath,
    review_verdict: state.reviewVerdict,
    status: state.status,
    updated_at: state.updatedAt,
  };
}

function normalizeExternalReviewState(value: unknown): ExternalReviewState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    provider: pickString(record, ["provider"]),
    reviewSkill:
      pickString(record, ["reviewSkill", "review_skill"]) ??
      "paperreview-submit",
    sourceLabel:
      pickString(record, ["sourceLabel", "source_label"]) ??
      "Stanford Agentic Reviewer",
    submissionId: pickString(record, ["submissionId", "submission_id"]),
    submittedPdfPath: pickString(record, [
      "submittedPdfPath",
      "submitted_pdf_path",
    ]),
    externalReviewPath: pickString(record, [
      "externalReviewPath",
      "external_review_path",
    ]),
    reviewResponsePath: pickString(record, [
      "reviewResponsePath",
      "review_response_path",
    ]),
    overallRecommendation: pickString(record, [
      "overallRecommendation",
      "overall_recommendation",
    ]),
    requiredAction: pickString(record, ["requiredAction", "required_action"]),
    lastPolledAt: pickString(record, ["lastPolledAt", "last_polled_at"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeExternalReviewState(
  state: ExternalReviewState
): Record<string, unknown> {
  return {
    status: state.status,
    provider: state.provider,
    review_skill: state.reviewSkill,
    source_label: state.sourceLabel,
    submission_id: state.submissionId,
    submitted_pdf_path: state.submittedPdfPath,
    external_review_path: state.externalReviewPath,
    review_response_path: state.reviewResponsePath,
    overall_recommendation: state.overallRecommendation,
    required_action: state.requiredAction,
    last_polled_at: state.lastPolledAt,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeExperimentSearchState(value: unknown): ExperimentSearchState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "not_started",
    currentMainStage:
      normalizeStage(record.currentMainStage ?? record.current_main_stage) ?? null,
    currentSubstage:
      normalizeStage(record.currentSubstage ?? record.current_substage) ?? null,
    frontierNodeIds: asStringArray(
      record.frontierNodeIds ?? record.frontier_node_ids
    ),
    bestNodeId: pickString(record, ["bestNodeId", "best_node_id"]),
    completedNodeIds: asStringArray(
      record.completedNodeIds ?? record.completed_node_ids
    ),
    failedNodeIds: asStringArray(record.failedNodeIds ?? record.failed_node_ids),
    triedHyperparams: asStringArray(
      record.triedHyperparams ?? record.tried_hyperparams
    ),
    completedAblations: asStringArray(
      record.completedAblations ?? record.completed_ablations
    ),
    multiSeedStatus:
      normalizeStage(record.multiSeedStatus ?? record.multi_seed_status) ??
      "pending",
    evaluationSummaryPath: pickString(record, [
      "evaluationSummaryPath",
      "evaluation_summary_path",
    ]),
    plotPackStatus:
      normalizeStage(record.plotPackStatus ?? record.plot_pack_status) ??
      "pending",
    plotPackPath: pickString(record, ["plotPackPath", "plot_pack_path"]),
    stageProgressPath: pickString(record, [
      "stageProgressPath",
      "stage_progress_path",
    ]),
    checkpointPath: pickString(record, ["checkpointPath", "checkpoint_path"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializeExperimentSearchState(
  state: ExperimentSearchState
): Record<string, unknown> {
  return {
    status: state.status,
    current_main_stage: state.currentMainStage,
    current_substage: state.currentSubstage,
    frontier_node_ids: state.frontierNodeIds,
    best_node_id: state.bestNodeId,
    completed_node_ids: state.completedNodeIds,
    failed_node_ids: state.failedNodeIds,
    tried_hyperparams: state.triedHyperparams,
    completed_ablations: state.completedAblations,
    multi_seed_status: state.multiSeedStatus,
    evaluation_summary_path: state.evaluationSummaryPath,
    plot_pack_status: state.plotPackStatus,
    plot_pack_path: state.plotPackPath,
    stage_progress_path: state.stageProgressPath,
    checkpoint_path: state.checkpointPath,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

function normalizeResearchProgramTrackBudget(
  value: unknown
): ResearchProgramTrackBudget {
  const record = asRecord(value) ?? {};
  return {
    gpuHours: pickNumber(record, ["gpuHours", "gpu_hours"]),
    maxRuns: pickNumber(record, ["maxRuns", "max_runs"]),
    maxDebugIterations: pickNumber(record, [
      "maxDebugIterations",
      "max_debug_iterations",
    ]),
  };
}

function serializeResearchProgramTrackBudget(
  value: ResearchProgramTrackBudget
): Record<string, unknown> {
  return {
    gpu_hours: value.gpuHours,
    max_runs: value.maxRuns,
    max_debug_iterations: value.maxDebugIterations,
  };
}

function normalizeResearchProgramTrackWriteScope(
  value: unknown
): ResearchProgramTrackWriteScope {
  const record = asRecord(value) ?? {};
  return {
    allowedClaimIds: asStringArray(
      record.allowedClaimIds ?? record.allowed_claim_ids
    ),
    allowedFigureIds: asStringArray(
      record.allowedFigureIds ?? record.allowed_figure_ids
    ),
  };
}

function serializeResearchProgramTrackWriteScope(
  value: ResearchProgramTrackWriteScope
): Record<string, unknown> {
  return {
    allowed_claim_ids: value.allowedClaimIds,
    allowed_figure_ids: value.allowedFigureIds,
  };
}

function normalizeResearchProgramTrack(value: unknown): ResearchProgramTrack {
  const record = asRecord(value) ?? {};
  return {
    trackId:
      pickString(record, ["trackId", "track_id"]) ??
      `track-${Math.random().toString(36).slice(2, 8)}`,
    priority: pickNumber(record, ["priority"]),
    status: normalizeStage(record.status) ?? "draft",
    hypothesis: pickString(record, ["hypothesis"]),
    noveltyBasis: pickString(record, ["noveltyBasis", "novelty_basis"]),
    mainMetric: pickString(record, ["mainMetric", "main_metric"]),
    successThreshold: pickString(record, [
      "successThreshold",
      "success_threshold",
    ]),
    requiredBaselines: asStringArray(
      record.requiredBaselines ?? record.required_baselines
    ),
    requiredAblations: asStringArray(
      record.requiredAblations ?? record.required_ablations
    ),
    requiredControls: asStringArray(
      record.requiredControls ?? record.required_controls
    ),
    experimentStageMatrix: asStringArray(
      record.experimentStageMatrix ?? record.experiment_stage_matrix
    ).map((entry) => normalizeStage(entry) ?? entry),
    budget: normalizeResearchProgramTrackBudget(record.budget),
    stopRules: asStringArray(record.stopRules ?? record.stop_rules),
    rollbackTriggers: asStringArray(
      record.rollbackTriggers ?? record.rollback_triggers
    ),
    writeScope: normalizeResearchProgramTrackWriteScope(record.writeScope ?? record.write_scope),
  };
}

function serializeResearchProgramTrack(
  value: ResearchProgramTrack
): Record<string, unknown> {
  return {
    track_id: value.trackId,
    priority: value.priority,
    status: value.status,
    hypothesis: value.hypothesis,
    novelty_basis: value.noveltyBasis,
    main_metric: value.mainMetric,
    success_threshold: value.successThreshold,
    required_baselines: value.requiredBaselines,
    required_ablations: value.requiredAblations,
    required_controls: value.requiredControls,
    experiment_stage_matrix: value.experimentStageMatrix,
    budget: serializeResearchProgramTrackBudget(value.budget),
    stop_rules: value.stopRules,
    rollback_triggers: value.rollbackTriggers,
    write_scope: serializeResearchProgramTrackWriteScope(value.writeScope),
  };
}

function normalizeResearchProgramTask(value: unknown): ResearchProgramTask {
  const record = asRecord(value) ?? {};
  return {
    taskId:
      pickString(record, ["taskId", "task_id"]) ??
      `task-${Math.random().toString(36).slice(2, 8)}`,
    stage: normalizeStage(record.stage),
    trackId: pickString(record, ["trackId", "track_id"]),
    owner: pickString(record, ["owner"]),
    dependencies: asStringArray(record.dependencies),
    entryCriteria: asStringArray(record.entryCriteria ?? record.entry_criteria),
    expectedOutputs: asStringArray(record.expectedOutputs ?? record.expected_outputs),
    retryBudget: pickNumber(record, ["retryBudget", "retry_budget"]),
    exitCriteria: asStringArray(record.exitCriteria ?? record.exit_criteria),
  };
}

function serializeResearchProgramTask(
  value: ResearchProgramTask
): Record<string, unknown> {
  return {
    task_id: value.taskId,
    stage: value.stage,
    track_id: value.trackId,
    owner: value.owner,
    dependencies: value.dependencies,
    entry_criteria: value.entryCriteria,
    expected_outputs: value.expectedOutputs,
    retry_budget: value.retryBudget,
    exit_criteria: value.exitCriteria,
  };
}

function normalizeResearchProgramGlobalConstraints(
  value: unknown
): ResearchProgramGlobalConstraints {
  const record = asRecord(value) ?? {};
  return {
    maxActiveTracks: pickNumber(record, [
      "maxActiveTracks",
      "max_active_tracks",
    ]),
    mustRunMultiSeedBeforeAnalysis:
      pickBoolean(record, [
        "mustRunMultiSeedBeforeAnalysis",
        "must_run_multi_seed_before_analysis",
      ]) ?? true,
    mustRunPlotAggregationBeforeWrite:
      pickBoolean(record, [
        "mustRunPlotAggregationBeforeWrite",
        "must_run_plot_aggregation_before_write",
      ]) ?? true,
  };
}

function serializeResearchProgramGlobalConstraints(
  value: ResearchProgramGlobalConstraints
): Record<string, unknown> {
  return {
    max_active_tracks: value.maxActiveTracks,
    must_run_multi_seed_before_analysis: value.mustRunMultiSeedBeforeAnalysis,
    must_run_plot_aggregation_before_write: value.mustRunPlotAggregationBeforeWrite,
  };
}

function normalizeResearchProgramState(value: unknown): ResearchProgramState {
  const record = asRecord(value) ?? {};
  const taskGraphEntries = Array.isArray(record.taskGraph ?? record.task_graph)
    ? ((record.taskGraph ?? record.task_graph) as unknown[])
    : [];
  return {
    programVersion: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["programVersion", "program_version"]) ?? 1
      )
    ),
    status: normalizeStage(record.status) ?? "missing",
    goal: pickString(record, ["goal"]),
    tracks: Array.isArray(record.tracks)
      ? record.tracks.map((entry) => normalizeResearchProgramTrack(entry))
      : [],
    globalConstraints: normalizeResearchProgramGlobalConstraints(
      record.globalConstraints ?? record.global_constraints
    ),
    taskGraph: taskGraphEntries.map((entry: unknown) =>
      normalizeResearchProgramTask(entry)
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeResearchProgramState(
  value: ResearchProgramState
): Record<string, unknown> {
  return {
    program_version: value.programVersion,
    status: value.status,
    goal: value.goal,
    tracks: value.tracks.map((entry) => serializeResearchProgramTrack(entry)),
    global_constraints: serializeResearchProgramGlobalConstraints(
      value.globalConstraints
    ),
    task_graph: value.taskGraph.map((entry) => serializeResearchProgramTask(entry)),
    last_updated_at: value.lastUpdatedAt,
    pending_reason: value.pendingReason,
  };
}

function normalizeOrchestrationState(value: unknown): OrchestrationState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    activeTicketId: pickString(record, ["activeTicketId", "active_ticket_id"]),
    stageRunId: pickString(record, ["stageRunId", "stage_run_id"]),
    currentOwner: pickString(record, ["currentOwner", "current_owner"]),
    nextOwner: pickString(record, ["nextOwner", "next_owner"]),
    nextTransitionCandidate: pickString(record, [
      "nextTransitionCandidate",
      "next_transition_candidate",
    ]),
    blockingCategory: pickString(record, [
      "blockingCategory",
      "blocking_category",
    ]),
    blockingReason: pickString(record, ["blockingReason", "blocking_reason"]),
    retryBudgetRemaining: pickNumber(record, [
      "retryBudgetRemaining",
      "retry_budget_remaining",
    ]),
    lastContractEvalAt: pickString(record, [
      "lastContractEvalAt",
      "last_contract_eval_at",
    ]),
    lastContractEvalResult: pickString(record, [
      "lastContractEvalResult",
      "last_contract_eval_result",
    ]),
    rollbackTargetStage: pickString(record, [
      "rollbackTargetStage",
      "rollback_target_stage",
    ]),
    resumeCursor: pickString(record, ["resumeCursor", "resume_cursor"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializeOrchestrationState(
  value: OrchestrationState
): Record<string, unknown> {
  return {
    status: value.status,
    active_ticket_id: value.activeTicketId,
    stage_run_id: value.stageRunId,
    current_owner: value.currentOwner,
    next_owner: value.nextOwner,
    next_transition_candidate: value.nextTransitionCandidate,
    blocking_category: value.blockingCategory,
    blocking_reason: value.blockingReason,
    retry_budget_remaining: value.retryBudgetRemaining,
    last_contract_eval_at: value.lastContractEvalAt,
    last_contract_eval_result: value.lastContractEvalResult,
    rollback_target_stage: value.rollbackTargetStage,
    resume_cursor: value.resumeCursor,
    last_updated_at: value.lastUpdatedAt,
  };
}

function normalizeWritePackageState(value: unknown): WritePackageState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    assemblyStatus:
      normalizeStage(record.assemblyStatus ?? record.assembly_status) ?? null,
    assemblyMode:
      pickString(record, ["assemblyMode", "assembly_mode"]) ?? null,
    winningTrackIds: asStringArray(
      record.winningTrackIds ?? record.winning_track_ids
    ),
    claimEvidenceMatrixPath: pickString(record, [
      "claimEvidenceMatrixPath",
      "claim_evidence_matrix_path",
    ]),
    narrativeReportPath: pickString(record, [
      "narrativeReportPath",
      "narrative_report_path",
    ]),
    trackVerdictsPath: pickString(record, [
      "trackVerdictsPath",
      "track_verdicts_path",
    ]),
    unsupportedClaimsPath: pickString(record, [
      "unsupportedClaimsPath",
      "unsupported_claims_path",
    ]),
    baselineSummaryPath: pickString(record, [
      "baselineSummaryPath",
      "baseline_summary_path",
    ]),
    researchSummaryPath: pickString(record, [
      "researchSummaryPath",
      "research_summary_path",
    ]),
    ablationSummaryPath: pickString(record, [
      "ablationSummaryPath",
      "ablation_summary_path",
    ]),
    evaluationSummaryPath: pickString(record, [
      "evaluationSummaryPath",
      "evaluation_summary_path",
    ]),
    figurePackPath: pickString(record, ["figurePackPath", "figure_pack_path"]),
    tablePackPath: pickString(record, ["tablePackPath", "table_pack_path"]),
    proofPacketDir: pickString(record, ["proofPacketDir", "proof_packet_dir"]),
    citationCandidatesPath: pickString(record, [
      "citationCandidatesPath",
      "citation_candidates_path",
    ]),
    packageManifestPath: pickString(record, [
      "packageManifestPath",
      "package_manifest_path",
    ]),
    assemblyReportPath: pickString(record, [
      "assemblyReportPath",
      "assembly_report_path",
    ]),
    sectionAssemblyQueuePath: pickString(record, [
      "sectionAssemblyQueuePath",
      "section_assembly_queue_path",
    ]),
    sourceArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["sourceArtifactCount", "source_artifact_count"]) ?? 0
      )
    ),
    derivedArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["derivedArtifactCount", "derived_artifact_count"]) ?? 0
      )
    ),
    assembledAt: pickString(record, ["assembledAt", "assembled_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializeWritePackageState(
  value: WritePackageState
): Record<string, unknown> {
  return {
    status: value.status,
    assembly_status: value.assemblyStatus,
    assembly_mode: value.assemblyMode,
    winning_track_ids: value.winningTrackIds,
    claim_evidence_matrix_path: value.claimEvidenceMatrixPath,
    narrative_report_path: value.narrativeReportPath,
    track_verdicts_path: value.trackVerdictsPath,
    unsupported_claims_path: value.unsupportedClaimsPath,
    baseline_summary_path: value.baselineSummaryPath,
    research_summary_path: value.researchSummaryPath,
    ablation_summary_path: value.ablationSummaryPath,
    evaluation_summary_path: value.evaluationSummaryPath,
    figure_pack_path: value.figurePackPath,
    table_pack_path: value.tablePackPath,
    proof_packet_dir: value.proofPacketDir,
    citation_candidates_path: value.citationCandidatesPath,
    package_manifest_path: value.packageManifestPath,
    assembly_report_path: value.assemblyReportPath,
    section_assembly_queue_path: value.sectionAssemblyQueuePath,
    source_artifact_count: value.sourceArtifactCount,
    derived_artifact_count: value.derivedArtifactCount,
    assembled_at: value.assembledAt,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}

function normalizePaperIngestionRuntimeStatus(value: unknown): string {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "waiting_import":
    case "waiting_graph":
    case "reconciling":
    case "ready":
    case "blocked":
    case "idle":
      return normalized;
    default:
      return "idle";
  }
}

function normalizePaperIngestionOperationPhase(
  value: unknown
): PaperIngestionPaperOperation["phase"] {
  return normalizeStage(value) === "graph" ? "graph" : "import";
}

function normalizePaperIngestionOperationStatus(
  value: unknown
): PaperIngestionPaperOperation["status"] {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "queued":
    case "running":
    case "completed":
    case "timed_out":
    case "failed":
      return normalized;
    default:
      return "queued";
  }
}

function normalizePaperIngestionState(value: unknown): PaperIngestionState {
  const record = asRecord(value) ?? {};
  const importTaskIdsRaw = record.import_task_ids ?? record.importTaskIds;
  const completedPapersRaw = record.completed_papers ?? record.completedPapers;
  const paperOperationsRaw = record.paper_operations ?? record.paperOperations;
  return {
    runtimeStatus: normalizePaperIngestionRuntimeStatus(
      record.runtimeStatus ?? record.runtime_status
    ),
    waitingReason: pickString(record, ["waitingReason", "waiting_reason"]),
    importTaskIds: Array.isArray(importTaskIdsRaw)
      ? importTaskIdsRaw
          .map((entry: unknown) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    lastImportTaskId: pickString(record, ["lastImportTaskId", "last_import_task_id"]),
    lastImportStatus:
      normalizeStage(record.lastImportStatus ?? record.last_import_status) ?? null,
    completedPapers: normalizeCompletedPaperEntries(completedPapersRaw),
    paperOperations: normalizePaperIngestionPaperOperations(paperOperationsRaw),
    graphVersionSeen: pickString(record, ["graphVersionSeen", "graph_version_seen"]),
    reconcileRequired:
      record.reconcileRequired === true || record.reconcile_required === true,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializePaperIngestionState(
  value: PaperIngestionState
): Record<string, unknown> {
  return {
    runtime_status: value.runtimeStatus,
    waiting_reason: value.waitingReason,
    import_task_ids: value.importTaskIds,
    last_import_task_id: value.lastImportTaskId,
    last_import_status: value.lastImportStatus,
    completed_papers: value.completedPapers.map(serializeCompletedPaperEntry),
    paper_operations: value.paperOperations.map(serializePaperIngestionPaperOperation),
    graph_version_seen: value.graphVersionSeen,
    reconcile_required: value.reconcileRequired,
    last_updated_at: value.lastUpdatedAt,
  };
}

function normalizeCompletedPaperEntry(
  value: unknown
): PaperIngestionCompletedPaper | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const canonicalId = pickString(record, ["canonicalId", "canonical_id"]);
  const title = pickString(record, ["title"]);
  const importTaskId = pickString(record, ["importTaskId", "import_task_id"]);
  if (!canonicalId && !title && !importTaskId) {
    return null;
  }
  return {
    canonicalId,
    title,
    importTaskId,
  };
}

function normalizeCompletedPaperEntries(
  value: unknown
): PaperIngestionCompletedPaper[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionCompletedPaper[] = [];
  for (const item of value) {
    const normalized = normalizeCompletedPaperEntry(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      areCompletedPaperEntriesEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergeCompletedPaperEntryValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializeCompletedPaperEntry(
  value: PaperIngestionCompletedPaper
): Record<string, unknown> {
  return {
    canonical_id: value.canonicalId,
    title: value.title,
    import_task_id: value.importTaskId,
  };
}

function normalizePaperIngestionPaperOperation(
  value: unknown
): PaperIngestionPaperOperation | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const canonicalId = pickString(record, ["canonicalId", "canonical_id"]);
  const title = pickString(record, ["title"]);
  const importTaskId = pickString(record, ["importTaskId", "import_task_id"]);
  if (!canonicalId && !title && !importTaskId) {
    return null;
  }
  const timeoutSecondsRaw = pickNumber(record, [
    "timeoutSeconds",
    "timeout_seconds",
  ]);
  return {
    canonicalId,
    title,
    importTaskId,
    phase: normalizePaperIngestionOperationPhase(record.phase),
    status: normalizePaperIngestionOperationStatus(record.status),
    timeoutSeconds:
      typeof timeoutSecondsRaw === "number" && Number.isFinite(timeoutSecondsRaw)
        ? Math.max(1, Math.floor(timeoutSecondsRaw))
        : null,
    startedAt: pickString(record, ["startedAt", "started_at"]),
    deadlineAt: pickString(record, ["deadlineAt", "deadline_at"]),
    finishedAt: pickString(record, ["finishedAt", "finished_at"]),
    detail: pickString(record, ["detail", "reason", "message"]),
  };
}

function normalizePaperIngestionPaperOperations(
  value: unknown
): PaperIngestionPaperOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionPaperOperation[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionPaperOperation(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      arePaperIngestionPaperOperationsEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergePaperIngestionOperationValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializePaperIngestionPaperOperation(
  value: PaperIngestionPaperOperation
): Record<string, unknown> {
  return {
    canonical_id: value.canonicalId,
    title: value.title,
    import_task_id: value.importTaskId,
    phase: value.phase,
    status: value.status,
    timeout_seconds: value.timeoutSeconds,
    started_at: value.startedAt,
    deadline_at: value.deadlineAt,
    finished_at: value.finishedAt,
    detail: value.detail,
  };
}

function areCompletedPaperEntriesEquivalent(
  left: PaperIngestionCompletedPaper,
  right: PaperIngestionCompletedPaper
): boolean {
  if (left.canonicalId && right.canonicalId && left.canonicalId === right.canonicalId) {
    return true;
  }
  if (left.importTaskId && right.importTaskId && left.importTaskId === right.importTaskId) {
    return true;
  }
  if (left.title && right.title && left.title === right.title) {
    return true;
  }
  return false;
}

function mergeCompletedPaperEntryValues(
  current: PaperIngestionCompletedPaper,
  patch: PaperIngestionCompletedPaper
): PaperIngestionCompletedPaper {
  return {
    canonicalId: current.canonicalId ?? patch.canonicalId,
    title: current.title ?? patch.title,
    importTaskId: current.importTaskId ?? patch.importTaskId,
  };
}

function arePaperIngestionPaperOperationsEquivalent(
  left: PaperIngestionPaperOperation,
  right: PaperIngestionPaperOperation
): boolean {
  if (left.phase !== right.phase) {
    return false;
  }
  if (left.canonicalId && right.canonicalId && left.canonicalId === right.canonicalId) {
    return true;
  }
  if (left.importTaskId && right.importTaskId && left.importTaskId === right.importTaskId) {
    return true;
  }
  if (left.title && right.title && left.title === right.title) {
    return true;
  }
  return false;
}

function mergePaperIngestionOperationValues(
  current: PaperIngestionPaperOperation,
  patch: PaperIngestionPaperOperation
): PaperIngestionPaperOperation {
  return {
    canonicalId: current.canonicalId ?? patch.canonicalId,
    title: current.title ?? patch.title,
    importTaskId: current.importTaskId ?? patch.importTaskId,
    phase: patch.phase,
    status: patch.status,
    timeoutSeconds: patch.timeoutSeconds ?? current.timeoutSeconds,
    startedAt: current.startedAt ?? patch.startedAt,
    deadlineAt: current.deadlineAt ?? patch.deadlineAt,
    finishedAt: patch.finishedAt ?? current.finishedAt,
    detail: patch.detail ?? current.detail,
  };
}

function isPaperIngestionOperationTerminal(
  value: PaperIngestionPaperOperation["status"]
): boolean {
  return value === "completed" || value === "timed_out" || value === "failed";
}

function mergePaperIngestionOperations(params: {
  current: PaperIngestionPaperOperation[];
  patch: unknown;
}): {
  paperOperations: PaperIngestionPaperOperation[];
  newlyTerminalPaperOperations: PaperIngestionPaperOperation[];
} {
  const currentEntries = normalizePaperIngestionPaperOperations(params.current);
  const patchEntries = normalizePaperIngestionPaperOperations(params.patch);
  if (patchEntries.length === 0) {
    return {
      paperOperations: currentEntries,
      newlyTerminalPaperOperations: [],
    };
  }
  const merged = [...currentEntries];
  const newlyTerminalPaperOperations: PaperIngestionPaperOperation[] = [];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      arePaperIngestionPaperOperationsEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      const previous = merged[existingIndex];
      const next = mergePaperIngestionOperationValues(previous, entry);
      merged[existingIndex] = next;
      if (
        isPaperIngestionOperationTerminal(next.status) &&
        previous.status !== next.status
      ) {
        newlyTerminalPaperOperations.push(next);
      }
      continue;
    }
    merged.push(entry);
    if (isPaperIngestionOperationTerminal(entry.status)) {
      newlyTerminalPaperOperations.push(entry);
    }
  }
  return {
    paperOperations: merged,
    newlyTerminalPaperOperations,
  };
}

function mergeCompletedPaperEntries(params: {
  current: PaperIngestionCompletedPaper[];
  patch: unknown;
}): {
  completedPapers: PaperIngestionCompletedPaper[];
  newlyCompletedPapers: PaperIngestionCompletedPaper[];
} {
  const currentEntries = normalizeCompletedPaperEntries(params.current);
  const patchEntries = normalizeCompletedPaperEntries(params.patch);
  if (patchEntries.length === 0) {
    return {
      completedPapers: currentEntries,
      newlyCompletedPapers: [],
    };
  }
  const merged = [...currentEntries];
  const newlyCompletedPapers: PaperIngestionCompletedPaper[] = [];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      areCompletedPaperEntriesEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeCompletedPaperEntryValues(merged[existingIndex], entry);
      continue;
    }
    merged.push(entry);
    newlyCompletedPapers.push(entry);
  }
  return {
    completedPapers: merged,
    newlyCompletedPapers,
  };
}

function normalizePaperQcState(value: unknown): PaperQcState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    compileStatus:
      normalizeStage(record.compileStatus ?? record.compile_status) ?? "pending",
    compileRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["compileRoundCount", "compile_round_count"]) ?? 0
      )
    ),
    chktexStatus:
      normalizeStage(record.chktexStatus ?? record.chktex_status) ?? "pending",
    pageBudgetStatus:
      normalizeStage(record.pageBudgetStatus ?? record.page_budget_status) ??
      "pending",
    referenceStartPage:
      pickNumber(record, ["referenceStartPage", "reference_start_page"]) ?? null,
    bodyPageCount:
      pickNumber(record, ["bodyPageCount", "body_page_count"]) ?? null,
    unusedFigureStatus:
      normalizeStage(record.unusedFigureStatus ?? record.unused_figure_status) ??
      "pending",
    invalidFigureRefStatus:
      normalizeStage(
        record.invalidFigureRefStatus ?? record.invalid_figure_ref_status
      ) ?? "pending",
    reflectionRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "reflectionRoundCount",
          "reflection_round_count",
        ]) ?? 0
      )
    ),
    latestReportPath: pickString(record, [
      "latestReportPath",
      "latest_report_path",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializePaperQcState(state: PaperQcState): Record<string, unknown> {
  return {
    status: state.status,
    compile_status: state.compileStatus,
    compile_round_count: state.compileRoundCount,
    chktex_status: state.chktexStatus,
    page_budget_status: state.pageBudgetStatus,
    reference_start_page: state.referenceStartPage,
    body_page_count: state.bodyPageCount,
    unused_figure_status: state.unusedFigureStatus,
    invalid_figure_ref_status: state.invalidFigureRefStatus,
    reflection_round_count: state.reflectionRoundCount,
    latest_report_path: state.latestReportPath,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

function normalizeCitationCollectionState(value: unknown): CitationCollectionState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    progressPath: pickString(record, ["progressPath", "progress_path"]),
    cacheBibPath: pickString(record, ["cacheBibPath", "cache_bib_path"]),
    candidateCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["candidateCount", "candidate_count"]) ?? 0)
    ),
    verifiedCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["verifiedCount", "verified_count"]) ?? 0)
    ),
    suspiciousCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["suspiciousCount", "suspicious_count"]) ?? 0
      )
    ),
    hallucinatedCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["hallucinatedCount", "hallucinated_count"]) ?? 0
      )
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializeCitationCollectionState(
  state: CitationCollectionState
): Record<string, unknown> {
  return {
    status: state.status,
    progress_path: state.progressPath,
    cache_bib_path: state.cacheBibPath,
    candidate_count: state.candidateCount,
    verified_count: state.verifiedCount,
    suspicious_count: state.suspiciousCount,
    hallucinated_count: state.hallucinatedCount,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

function normalizeFigureQcState(value: unknown): FigureQcState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    figureReviewPath: pickString(record, [
      "figureReviewPath",
      "figure_review_path",
    ]),
    figureSelectionPath: pickString(record, [
      "figureSelectionPath",
      "figure_selection_path",
    ]),
    duplicateFigureStatus:
      normalizeStage(
        record.duplicateFigureStatus ?? record.duplicate_figure_status
      ) ?? "pending",
    captionAlignmentStatus:
      normalizeStage(
        record.captionAlignmentStatus ?? record.caption_alignment_status
      ) ?? "pending",
    textAlignmentStatus:
      normalizeStage(
        record.textAlignmentStatus ?? record.text_alignment_status
      ) ?? "pending",
    selectionStatus:
      normalizeStage(record.selectionStatus ?? record.selection_status) ??
      "pending",
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

function serializeFigureQcState(state: FigureQcState): Record<string, unknown> {
  return {
    status: state.status,
    figure_review_path: state.figureReviewPath,
    figure_selection_path: state.figureSelectionPath,
    duplicate_figure_status: state.duplicateFigureStatus,
    caption_alignment_status: state.captionAlignmentStatus,
    text_alignment_status: state.textAlignmentStatus,
    selection_status: state.selectionStatus,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

function normalizeReviewIssueCounts(value: unknown): ReviewIssueCounts {
  const record = asRecord(value) ?? {};
  return {
    critical: Math.max(
      0,
      Math.floor(pickNumber(record, ["critical"]) ?? 0)
    ),
    high: Math.max(0, Math.floor(pickNumber(record, ["high"]) ?? 0)),
    medium: Math.max(0, Math.floor(pickNumber(record, ["medium"]) ?? 0)),
    low: Math.max(0, Math.floor(pickNumber(record, ["low"]) ?? 0)),
  };
}

function serializeReviewIssueCounts(
  counts: ReviewIssueCounts
): Record<string, unknown> {
  return {
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
  };
}

function normalizeReviewIssueState(value: unknown): ReviewIssueState {
  const record = asRecord(value) ?? {};
  return {
    issueId:
      pickString(record, ["issueId", "issue_id", "id"]) ??
      `issue-${Math.random().toString(36).slice(2, 8)}`,
    lane: normalizeStage(record.lane) ?? null,
    severity: normalizeStage(record.severity) ?? "low",
    title: pickString(record, ["title"]),
    description: pickString(record, ["description"]),
    targetStage: normalizeStage(record.targetStage ?? record.target_stage),
    targetArtifact: pickString(record, ["targetArtifact", "target_artifact"]),
    openedBy: pickString(record, ["openedBy", "opened_by"]),
    owner: pickString(record, ["owner"]),
    status: normalizeStage(record.status) ?? "open",
    fixArtifactPaths: asStringArray(
      record.fixArtifactPaths ?? record.fix_artifact_paths
    ),
    verifiedAt: pickString(record, ["verifiedAt", "verified_at"]),
    waiverReason: pickString(record, ["waiverReason", "waiver_reason"]),
    createdAt: pickString(record, ["createdAt", "created_at"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function serializeReviewIssueState(
  issue: ReviewIssueState
): Record<string, unknown> {
  return {
    issue_id: issue.issueId,
    lane: issue.lane,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    target_stage: issue.targetStage,
    target_artifact: issue.targetArtifact,
    opened_by: issue.openedBy,
    owner: issue.owner,
    status: issue.status,
    fix_artifact_paths: issue.fixArtifactPaths,
    verified_at: issue.verifiedAt,
    waiver_reason: issue.waiverReason,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
  };
}

function normalizeReviewIssueTrackerState(
  value: unknown
): ReviewIssueTrackerState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    openCounts: normalizeReviewIssueCounts(
      record.openCounts ?? record.open_counts
    ),
    issueManifestPath:
      pickString(record, ["issueManifestPath", "issue_manifest_path"]) ??
      DEFAULT_REVIEW_ISSUES_PATH,
    issues: Array.isArray(record.issues)
      ? record.issues.map((issue) => normalizeReviewIssueState(issue))
      : [],
    lastReviewRound: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["lastReviewRound", "last_review_round"]) ?? 0
      )
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeReviewIssueTrackerState(
  state: ReviewIssueTrackerState
): Record<string, unknown> {
  return {
    status: state.status,
    open_counts: serializeReviewIssueCounts(state.openCounts),
    issue_manifest_path: state.issueManifestPath,
    issues: state.issues.map((issue) => serializeReviewIssueState(issue)),
    last_review_round: state.lastReviewRound,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeWritingSessionState(value: unknown): WritingSessionState {
  const record = asRecord(value) ?? {};
  const sectionPacketsRecord =
    asRecord(record.sectionPackets ?? record.section_packets) ?? {};
  const sectionPackets = Object.fromEntries(
    Object.entries(sectionPacketsRecord).map(([key, packet]) => [
      normalizeStage(key) ?? key,
      normalizeWritingSectionPacketState(key, packet),
    ])
  );
  return {
    status: normalizeStage(record.status) ?? "missing",
    currentSection: normalizeStage(record.currentSection ?? record.current_section),
    draftOrder:
      asStringArray(record.draftOrder ?? record.draft_order)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    finalizedSections:
      asStringArray(record.finalizedSections ?? record.finalized_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    compileSafeSections:
      asStringArray(record.compileSafeSections ?? record.compile_safe_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    sectionPackets,
    headlineClaimEvidenceStatus:
      normalizeStage(
        record.headlineClaimEvidenceStatus ?? record.headline_claim_evidence_status
      ) ?? "pending",
    graphEvidenceCoverageStatus:
      normalizeStage(
        record.graphEvidenceCoverageStatus ?? record.graph_evidence_coverage_status
      ) ?? "pending",
    graphEvidenceCoverageSummary:
      pickString(record, [
        "graphEvidenceCoverageSummary",
        "graph_evidence_coverage_summary",
      ]) ?? null,
    citationPlanMode:
      normalizeStage(record.citationPlanMode ?? record.citation_plan_mode) ??
      "graph_only",
    externalScholarQueryMode:
      normalizeStage(
        record.externalScholarQueryMode ?? record.external_scholar_query_mode
      ) ?? "reserved",
    futureScholarVerificationSkill:
      pickString(record, [
        "futureScholarVerificationSkill",
        "future_scholar_verification_skill",
      ]) ?? DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeWritingSessionState(
  state: WritingSessionState
): Record<string, unknown> {
  return {
    status: state.status,
    current_section: state.currentSection,
    draft_order: state.draftOrder,
    finalized_sections: state.finalizedSections,
    compile_safe_sections: state.compileSafeSections,
    section_packets: Object.fromEntries(
      Object.entries(state.sectionPackets).map(([key, packet]) => [
        key,
        serializeWritingSectionPacketState(packet),
      ])
    ),
    headline_claim_evidence_status: state.headlineClaimEvidenceStatus,
    graph_evidence_coverage_status: state.graphEvidenceCoverageStatus,
    graph_evidence_coverage_summary: state.graphEvidenceCoverageSummary,
    citation_plan_mode: state.citationPlanMode,
    external_scholar_query_mode: state.externalScholarQueryMode,
    future_scholar_verification_skill: state.futureScholarVerificationSkill,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeReviewSessionRubric(value: unknown): ReviewSessionRubric {
  const record = asRecord(value) ?? {};
  return {
    originality: pickNumber(record, ["originality"]),
    quality: pickNumber(record, ["quality"]),
    clarity: pickNumber(record, ["clarity"]),
    significance: pickNumber(record, ["significance"]),
    soundness: pickNumber(record, ["soundness"]),
    citationIntegrity: pickNumber(record, [
      "citationIntegrity",
      "citation_integrity",
    ]),
    graphGroundedEvidenceSufficiency: pickNumber(record, [
      "graphGroundedEvidenceSufficiency",
      "graph_grounded_evidence_sufficiency",
    ]),
  };
}

function serializeReviewSessionRubric(
  rubric: ReviewSessionRubric
): Record<string, unknown> {
  return {
    originality: rubric.originality,
    quality: rubric.quality,
    clarity: rubric.clarity,
    significance: rubric.significance,
    soundness: rubric.soundness,
    citation_integrity: rubric.citationIntegrity,
    graph_grounded_evidence_sufficiency:
      rubric.graphGroundedEvidenceSufficiency,
  };
}

function normalizeReviewSessionState(value: unknown): ReviewSessionState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    stageScope: normalizeStage(record.stageScope ?? record.stage_scope),
    round: Math.max(0, Math.floor(pickNumber(record, ["round"]) ?? 0)),
    reviewPacketPath:
      pickString(record, ["reviewPacketPath", "review_packet_path"]) ??
      DEFAULT_REVIEW_PACKET_PATH,
    graphEvidenceSummaryPath:
      pickString(record, [
        "graphEvidenceSummaryPath",
        "graph_evidence_summary_path",
      ]) ?? DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH,
    latestReviewPath:
      pickString(record, ["latestReviewPath", "latest_review_path"]) ??
      "reviewer/REVIEW_REPORT.md",
    verdict: pickString(record, ["verdict"]) ?? null,
    rubric: normalizeReviewSessionRubric(record.rubric),
    reviewerSummary:
      pickString(record, ["reviewerSummary", "reviewer_summary"]) ?? null,
    actionItems: asStringArray(record.actionItems ?? record.action_items),
    blockingArtifacts: asStringArray(
      record.blockingArtifacts ?? record.blocking_artifacts
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeReviewSessionState(
  state: ReviewSessionState
): Record<string, unknown> {
  return {
    status: state.status,
    stage_scope: state.stageScope,
    round: state.round,
    review_packet_path: state.reviewPacketPath,
    graph_evidence_summary_path: state.graphEvidenceSummaryPath,
    latest_review_path: state.latestReviewPath,
    verdict: state.verdict,
    rubric: serializeReviewSessionRubric(state.rubric),
    reviewer_summary: state.reviewerSummary,
    action_items: state.actionItems,
    blocking_artifacts: state.blockingArtifacts,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function normalizeGraphGuidedWritingState(value: unknown): GraphGuidedWritingState {
  const record = asRecord(value) ?? {};
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? true,
    status: normalizeStage(record.status) ?? "missing",
    anchorIndexPath:
      pickString(record, ["anchorIndexPath", "anchor_index_path"]) ??
      "graph/ANCHOR_INDEX.md",
    frontierFiles: asStringArray(record.frontierFiles ?? record.frontier_files),
    literaturePath:
      pickString(record, ["literaturePath", "literature_path"]) ??
      "researcher/LITERATURE.md",
    claimEvidencePacketPaths: asStringArray(
      record.claimEvidencePacketPaths ?? record.claim_evidence_packet_paths
    ),
    requiredEvidencePointerCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "requiredEvidencePointerCount",
          "required_evidence_pointer_count",
        ]) ?? 0
      )
    ),
    coveredHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "coveredHeadlineClaimCount",
          "covered_headline_claim_count",
        ]) ?? 0
      )
    ),
    totalHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "totalHeadlineClaimCount",
          "total_headline_claim_count",
        ]) ?? 0
      )
    ),
    evidenceCoverageStatus:
      normalizeStage(
        record.evidenceCoverageStatus ?? record.evidence_coverage_status
      ) ?? "pending",
    missingEvidenceClaims: asStringArray(
      record.missingEvidenceClaims ?? record.missing_evidence_claims
    ),
    citationSourceMode:
      normalizeStage(record.citationSourceMode ?? record.citation_source_mode) ??
      "graph_only",
    scholarQueryReserved:
      pickBoolean(record, ["scholarQueryReserved", "scholar_query_reserved"]) ??
      true,
    scholarQuerySkillSlot:
      pickString(record, ["scholarQuerySkillSlot", "scholar_query_skill_slot"]) ??
      DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

function serializeGraphGuidedWritingState(
  state: GraphGuidedWritingState
): Record<string, unknown> {
  return {
    enabled: state.enabled,
    status: state.status,
    anchor_index_path: state.anchorIndexPath,
    frontier_files: state.frontierFiles,
    literature_path: state.literaturePath,
    claim_evidence_packet_paths: state.claimEvidencePacketPaths,
    required_evidence_pointer_count: state.requiredEvidencePointerCount,
    covered_headline_claim_count: state.coveredHeadlineClaimCount,
    total_headline_claim_count: state.totalHeadlineClaimCount,
    evidence_coverage_status: state.evidenceCoverageStatus,
    missing_evidence_claims: state.missingEvidenceClaims,
    citation_source_mode: state.citationSourceMode,
    scholar_query_reserved: state.scholarQueryReserved,
    scholar_query_skill_slot: state.scholarQuerySkillSlot,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

function isRuntimeReadyStatus(
  value: unknown,
  readyStates: readonly string[]
): boolean {
  const normalized = normalizeStage(value);
  return normalized ? readyStates.includes(normalized) : false;
}

function areWritingSectionPacketsReady(state: WritingSessionState): boolean {
  const packets = Object.values(state.sectionPackets);
  return (
    packets.length > 0 &&
    packets.every((packet) => {
      const packetStatus = normalizeStage(packet.status);
      const reviewVerdict = normalizeStage(packet.reviewVerdict);
      return (
        !packet.stale &&
        packet.forbiddenUnsupportedClaims.length === 0 &&
        packet.missingCitationPlaceholders.length === 0 &&
        (packetStatus === "finalized" ||
          packetStatus === "locked" ||
          packetStatus === "compile_safe" ||
          reviewVerdict === "publication_ready")
      );
    })
  );
}

function isWritingSessionReadyForSubmit(state: WritingSessionState): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "ready_for_submit",
      "ready",
      "finalized",
      "complete",
      "completed",
    ]) &&
    areWritingSectionPacketsReady(state) &&
    isRuntimeReadyStatus(state.graphEvidenceCoverageStatus, [
      "covered",
      "ready",
      "complete",
      "completed",
    ])
  );
}

function isGraphGuidedWritingReadyForSubmit(
  state: GraphGuidedWritingState
): boolean {
  if (!state.enabled) {
    return true;
  }
  return (
    isRuntimeReadyStatus(state.status, [
      "ready",
      "covered",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.evidenceCoverageStatus, [
      "covered",
      "ready",
      "complete",
      "completed",
    ]) &&
    state.missingEvidenceClaims.length === 0
  );
}

function isExternalReviewConclusionReady(state: ExternalReviewState): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "received",
      "ready",
      "complete",
      "completed",
      "accepted_for_handoff",
    ]) &&
    Boolean(state.overallRecommendation)
  );
}

function isExperimentSearchReadyForAnalysis(
  state: ExperimentSearchState
): boolean {
  return (
    isRuntimeReadyStatus(state.status, [
      "ready_for_analysis",
      "ready",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.multiSeedStatus, [
      "ready",
      "complete",
      "completed",
    ]) &&
    isRuntimeReadyStatus(state.plotPackStatus, [
      "ready",
      "complete",
      "completed",
    ]) &&
    Boolean(state.evaluationSummaryPath) &&
    Boolean(state.plotPackPath)
  );
}

function isPaperQcHardFailure(state: PaperQcState): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return [state.compileStatus, state.pageBudgetStatus, state.invalidFigureRefStatus].some(
    (value) => normalizeStage(value) === "fail"
  );
}

function isFigureQcHardFailure(state: FigureQcState): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return [
    state.duplicateFigureStatus,
    state.captionAlignmentStatus,
    state.textAlignmentStatus,
    state.selectionStatus,
  ].some((value) => normalizeStage(value) === "fail");
}

function isCitationCollectionHardFailure(
  state: CitationCollectionState
): boolean {
  if (normalizeStage(state.status) === "missing") {
    return false;
  }
  return normalizeStage(state.status) === "blocked" || state.hallucinatedCount > 0;
}

const REQUIRED_RESEARCH_PROGRAM_EXPERIMENT_STAGES = [
  "baseline_implementation",
  "baseline_tuning",
  "creative_research",
  "ablation_studies",
];

function isResolvedReviewIssueStatus(status: string | null): boolean {
  return ["fixed", "verified", "waived", "closed", "resolved"].includes(
    normalizeStage(status) ?? ""
  );
}

function countReviewIssueLanes(issues: ReviewIssueState[]): {
  surface: number;
  submission: number;
} {
  let surface = 0;
  let submission = 0;
  for (const issue of issues) {
    if (isResolvedReviewIssueStatus(issue.status)) {
      continue;
    }
    const lane = normalizeStage(issue.lane);
    if (lane === "surface") {
      surface += 1;
    } else if (lane === "submission") {
      submission += 1;
    }
  }
  return { surface, submission };
}

function hasUnwaivedMediumOrHigherReviewIssues(
  state: ReviewIssueTrackerState
): boolean {
  if (state.status === "waived") {
    return false;
  }
  if (state.issues.length === 0) {
    return (
      state.openCounts.critical > 0 ||
      state.openCounts.high > 0 ||
      state.openCounts.medium > 0
    );
  }
  return state.issues.some((issue) => {
    if (isResolvedReviewIssueStatus(issue.status)) {
      return false;
    }
    const severity = normalizeStage(issue.severity);
    if (!["critical", "high", "medium"].includes(severity ?? "")) {
      return false;
    }
    return !(severity === "medium" && issue.waiverReason);
  });
}

function hasBlockingReviewIssues(state: ReviewIssueTrackerState): boolean {
  if (state.status === "waived") {
    return false;
  }
  if (state.issues.length > 0) {
    return state.issues.some((issue) => {
      if (isResolvedReviewIssueStatus(issue.status)) {
        return false;
      }
      const severity = normalizeStage(issue.severity);
      return severity === "critical" || severity === "high";
    });
  }
  return state.openCounts.critical > 0 || state.openCounts.high > 0;
}

function extractReviewIssues(value: unknown): ReviewIssueState[] {
  const record = asRecord(value);
  const issues = Array.isArray(record?.issues)
    ? record.issues
    : Array.isArray(value)
      ? value
      : [];
  return issues.map((issue) => normalizeReviewIssueState(issue));
}

function summarizeReviewIssuesFromManifest(value: unknown): {
  issues: ReviewIssueState[];
  counts: ReviewIssueCounts;
} {
  const issues = extractReviewIssues(value);
  const counts: ReviewIssueCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const issue of issues) {
    if (isResolvedReviewIssueStatus(issue.status)) {
      continue;
    }
    const severity = normalizeStage(issue.severity);
    if (severity === "critical") {
      counts.critical += 1;
    } else if (severity === "high") {
      counts.high += 1;
    } else if (severity === "medium") {
      counts.medium += 1;
    } else {
      counts.low += 1;
    }
  }
  return { issues, counts };
}

async function hydrateReviewIssueTrackerState(params: {
  projectRoot: string;
  value: unknown;
}): Promise<ReviewIssueTrackerState> {
  const state = normalizeReviewIssueTrackerState(params.value);
  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.issueManifestPath
  );
  if (!issueManifestResolvedPath || !(await pathExists(issueManifestResolvedPath))) {
    return state;
  }
  const issueManifest = await readJsonIfExists<Record<string, unknown> | unknown[]>(
    issueManifestResolvedPath
  );
  if (!issueManifest) {
    return state;
  }
  const hydrated = summarizeReviewIssuesFromManifest(issueManifest);
  return {
    ...state,
    issues: hydrated.issues,
    openCounts: hydrated.counts,
  };
}

function getResearchProgramValidationErrors(
  state: ResearchProgramState
): string[] {
  const errors: string[] = [];
  const activeTracks = state.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
  if (!["approved", "ready", "running"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.research_program.status must be approved/ready/running (current: ${state.status})`
    );
  }
  if (!state.goal) {
    errors.push("PROJECT_MANIFEST.json.research_program.goal is required");
  }
  if (activeTracks.length === 0) {
    errors.push(
      "PROJECT_MANIFEST.json.research_program must define at least one active track"
    );
  }
  if (state.globalConstraints.maxActiveTracks != null) {
    if (activeTracks.length > state.globalConstraints.maxActiveTracks) {
      errors.push(
        `active track count ${activeTracks.length} exceeds research_program.global_constraints.max_active_tracks=${state.globalConstraints.maxActiveTracks}`
      );
    }
  }
  for (const track of activeTracks) {
    if (!track.hypothesis) {
      errors.push(`research_program track ${track.trackId} missing hypothesis`);
    }
    if (!track.noveltyBasis) {
      errors.push(`research_program track ${track.trackId} missing novelty_basis`);
    }
    if (!track.mainMetric) {
      errors.push(`research_program track ${track.trackId} missing main_metric`);
    }
    if (!track.successThreshold) {
      errors.push(`research_program track ${track.trackId} missing success_threshold`);
    }
    if (track.requiredBaselines.length === 0) {
      errors.push(`research_program track ${track.trackId} requires at least one baseline`);
    }
    if (track.requiredAblations.length === 0) {
      errors.push(`research_program track ${track.trackId} requires at least one ablation`);
    }
    if (track.stopRules.length === 0) {
      errors.push(`research_program track ${track.trackId} requires stop_rules`);
    }
    if (track.rollbackTriggers.length === 0) {
      errors.push(
        `research_program track ${track.trackId} requires rollback_triggers`
      );
    }
    const stageMatrix = new Set(
      track.experimentStageMatrix.map((entry) => normalizeStage(entry) ?? entry)
    );
    for (const requiredStage of REQUIRED_RESEARCH_PROGRAM_EXPERIMENT_STAGES) {
      if (!stageMatrix.has(requiredStage)) {
        errors.push(
          `research_program track ${track.trackId} is missing experiment_stage_matrix entry ${requiredStage}`
        );
      }
    }
    if (
      track.writeScope.allowedClaimIds.length === 0 &&
      track.writeScope.allowedFigureIds.length === 0
    ) {
      errors.push(
        `research_program track ${track.trackId} must declare write_scope allowed claims or figures`
      );
    }
    if (
      track.budget.gpuHours == null &&
      track.budget.maxRuns == null &&
      track.budget.maxDebugIterations == null
    ) {
      errors.push(`research_program track ${track.trackId} must declare a budget`);
    }
  }
  for (const track of activeTracks) {
    const hasTask = state.taskGraph.some(
      (task) =>
        task.trackId === track.trackId &&
        task.entryCriteria.length > 0 &&
        task.expectedOutputs.length > 0 &&
        task.exitCriteria.length > 0
    );
    if (!hasTask) {
      errors.push(
        `research_program track ${track.trackId} requires task_graph coverage with entry/output/exit criteria`
      );
    }
  }
  return errors;
}

function getOrchestrationStateValidationErrors(
  state: OrchestrationState,
  currentStage: string | null
): string[] {
  const errors: string[] = [];
  if (!["running", "ready", "waiting", "blocked"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.orchestration_state.status must be ready/running/waiting/blocked (current: ${state.status})`
    );
  }
  if (!state.currentOwner) {
    errors.push("PROJECT_MANIFEST.json.orchestration_state.current_owner is required");
  }
  if (!state.nextTransitionCandidate) {
    errors.push(
      "PROJECT_MANIFEST.json.orchestration_state.next_transition_candidate is required"
    );
  }
  if (currentStage && state.nextTransitionCandidate) {
    const expectedNext = STAGE_REQUIREMENTS[currentStage]?.nextStage ?? null;
    if (
      expectedNext &&
      normalizeStage(state.nextTransitionCandidate) !== normalizeStage(expectedNext)
    ) {
      errors.push(
        `orchestration_state.next_transition_candidate should be ${expectedNext} while current_stage=${currentStage} (current: ${state.nextTransitionCandidate})`
      );
    }
  }
  if (state.retryBudgetRemaining != null && state.retryBudgetRemaining < 0) {
    errors.push(
      "PROJECT_MANIFEST.json.orchestration_state.retry_budget_remaining must be >= 0"
    );
  }
  return errors;
}

function getWritePackageValidationErrors(state: WritePackageState): string[] {
  const errors: string[] = [];
  if (!["ready", "assembled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.write_package.status must be ready/assembled/approved (current: ${state.status})`
    );
  }
  if (state.winningTrackIds.length === 0) {
    errors.push("PROJECT_MANIFEST.json.write_package.winning_track_ids is required");
  }
  for (const field of [
    ["claim_evidence_matrix_path", state.claimEvidenceMatrixPath],
    ["narrative_report_path", state.narrativeReportPath],
    ["track_verdicts_path", state.trackVerdictsPath],
    ["unsupported_claims_path", state.unsupportedClaimsPath],
    ["baseline_summary_path", state.baselineSummaryPath],
    ["research_summary_path", state.researchSummaryPath],
    ["ablation_summary_path", state.ablationSummaryPath],
    ["evaluation_summary_path", state.evaluationSummaryPath],
    ["figure_pack_path", state.figurePackPath],
    ["table_pack_path", state.tablePackPath],
    ["proof_packet_dir", state.proofPacketDir],
    ["citation_candidates_path", state.citationCandidatesPath],
  ] as Array<[string, string | null]>) {
    if (!field[1]) {
      errors.push(`PROJECT_MANIFEST.json.write_package.${field[0]} is required`);
    }
  }
  return errors;
}

function toProjectRelativeArtifactPath(
  projectRoot: string,
  targetPath: string | null
): string | null {
  if (!targetPath) {
    return null;
  }
  if (!path.isAbsolute(targetPath)) {
    return targetPath.replace(/\\/g, "/");
  }
  const relative = path.relative(projectRoot, targetPath);
  if (!relative || relative.startsWith("..")) {
    return path.normalize(targetPath).replace(/\\/g, "/");
  }
  return relative.replace(/\\/g, "/");
}

function getBrainstormCycleRootRelativeDir(trackId: string | null): string {
  const normalizedTrackId = trackId?.trim().replace(/[\\/]/g, "_") ?? null;
  if (normalizedTrackId) {
    return `researcher/reasoning/${normalizedTrackId}`;
  }
  return DEFAULT_BRAINSTORM_CYCLE_DIR;
}

function getBrainstormCycleDefaultPaths(trackId: string | null): {
  topicSummaryPath: string;
  researchBriefPath: string;
  brainstormBriefPath: string;
  logicChainPath: string;
  evidenceChainPath: string;
  reasoningTracePath: string;
  questionPacketPath: string;
  workingMemoryPath: string;
  synthesisPacketPath: string;
  reflectionChainPath: string;
  theoryBriefPath: string;
  storylineBriefPath: string;
} {
  const root = getBrainstormCycleRootRelativeDir(trackId);
  return {
    topicSummaryPath: `${root}/TOPIC_SUMMARY.json`,
    researchBriefPath: `${root}/RESEARCH_BRIEF.json`,
    brainstormBriefPath: `${root}/BRAINSTORM_BRIEF.json`,
    logicChainPath: `${root}/LOGIC_CHAIN.md`,
    evidenceChainPath: `${root}/EVIDENCE_CHAIN.md`,
    reasoningTracePath: `${root}/REASONING_TRACE.jsonl`,
    questionPacketPath: `${root}/QUESTION_PACKET.md`,
    workingMemoryPath: `${root}/WORKING_MEMORY.json`,
    synthesisPacketPath: `${root}/SYNTHESIS_PACKET.md`,
    reflectionChainPath: `${root}/REFLECTION_CHAIN.json`,
    theoryBriefPath: `${root}/THEORY_BRIEF.json`,
    storylineBriefPath: `${root}/STORYLINE_BRIEF.json`,
  };
}

function isBrainstormCycleReady(state: BrainstormCycleState): boolean {
  return ["ready", "reconciled"].includes(normalizeStage(state.status) ?? "");
}

function getBrainstormCycleValidationErrors(
  state: BrainstormCycleState
): string[] {
  const errors: string[] = [];
  if (!state.topic) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.topic is required");
  }
  if (!state.basisStage) {
    errors.push("PROJECT_MANIFEST.json.brainstorm_cycle.basis_stage is required");
  }
  for (const [field, value] of [
    ["topic_summary_path", state.topicSummaryPath],
    ["research_brief_path", state.researchBriefPath],
    ["brainstorm_brief_path", state.brainstormBriefPath],
    ["logic_chain_path", state.logicChainPath],
    ["evidence_chain_path", state.evidenceChainPath],
    ["reasoning_trace_path", state.reasoningTracePath],
    ["question_packet_path", state.questionPacketPath],
    ["working_memory_path", state.workingMemoryPath],
    ["synthesis_packet_path", state.synthesisPacketPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.brainstorm_cycle.${field} is required`);
    }
  }
  if (isBrainstormCycleReady(state)) {
    if (state.rounds.length === 0) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.rounds must contain at least one completed brainstorm round"
      );
    }
    if (!state.selectedRoundId) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.selected_round_id is required when the brainstorm cycle is ready"
      );
    }
    if (!state.selectedOptionId) {
      errors.push(
        "PROJECT_MANIFEST.json.brainstorm_cycle.selected_option_id is required when the brainstorm cycle is ready"
      );
    }
  }
  return errors;
}

async function fileHasMeaningfulJsonContent(targetPath: string | null): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed == null) {
      return false;
    }
    if (Array.isArray(parsed)) {
      return parsed.length > 0;
    }
    if (typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>).length > 0;
    }
    if (typeof parsed === "string") {
      return parsed.trim().length > 0;
    }
    return true;
  } catch {
    return false;
  }
}

function renderMarkdownishPayload(value: unknown): string {
  if (typeof value === "string") {
    return value.endsWith("\n") ? value : `${value}\n`;
  }
  if (value == null) {
    return "";
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderReasoningTracePayload(value: unknown): string {
  if (typeof value === "string") {
    return value.endsWith("\n") ? value : `${value}\n`;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => JSON.stringify(entry))
      .join("\n")
      .concat(value.length > 0 ? "\n" : "");
  }
  if (value == null) {
    return "";
  }
  return `${JSON.stringify(value)}\n`;
}

function hasMeaningfulPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return value != null;
}

function pickBrainstormPayload(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function extractBrainstormCandidateRecords(
  value: unknown
): Array<{
  round: BrainstormCycleRoundState;
  roundRecord: Record<string, unknown>;
  option: BrainstormCycleOptionState;
  optionRecord: Record<string, unknown>;
}> {
  const rounds = Array.isArray(asRecord(value)?.rounds) ? (asRecord(value)?.rounds as unknown[]) : [];
  const candidates: Array<{
    round: BrainstormCycleRoundState;
    roundRecord: Record<string, unknown>;
    option: BrainstormCycleOptionState;
    optionRecord: Record<string, unknown>;
  }> = [];
  for (const rawRound of rounds) {
    const roundRecord = asRecord(rawRound);
    const round = normalizeBrainstormCycleRoundState(rawRound);
    if (!round || !roundRecord) {
      continue;
    }
    const rawOptions = Array.isArray(roundRecord.options) ? roundRecord.options : [];
    for (const rawOption of rawOptions) {
      const optionRecord = asRecord(rawOption);
      const option = normalizeBrainstormCycleOptionState(rawOption);
      if (!option || !optionRecord) {
        continue;
      }
      candidates.push({
        round,
        roundRecord,
        option,
        optionRecord,
      });
    }
  }
  return candidates;
}

function selectBrainstormCandidate(params: {
  brainstormCycle: Record<string, unknown>;
  current: BrainstormCycleState;
}):
  | {
      round: BrainstormCycleRoundState;
      roundRecord: Record<string, unknown>;
      option: BrainstormCycleOptionState;
      optionRecord: Record<string, unknown>;
      mode: string | null;
    }
  | null {
  const candidates = extractBrainstormCandidateRecords(params.brainstormCycle);
  const selectedOptionId =
    pickString(params.brainstormCycle, ["selectedOptionId", "selected_option_id"]) ??
    params.current.selectedOptionId;
  const selectionMode =
    pickString(params.brainstormCycle, ["selectionMode", "selection_mode"]) ??
    pickString(params.brainstormCycle, ["mode"]) ??
    params.current.selectionMode ??
    params.current.mode;
  if (selectedOptionId) {
    const explicit = candidates.find(
      (candidate) => candidate.option.optionId === selectedOptionId
    );
    if (explicit) {
      return { ...explicit, mode: selectionMode };
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  if ((normalizeStage(selectionMode) ?? selectionMode) === "aggressive") {
    const ranked = [...candidates].sort(
      (left, right) => (right.option.score ?? -Infinity) - (left.option.score ?? -Infinity)
    );
    return { ...ranked[0], mode: selectionMode };
  }
  return { ...candidates[0], mode: selectionMode };
}

async function getBrainstormCycleMissingSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
}): Promise<string[]> {
  const state = normalizeBrainstormCycleState(params.manifest?.brainstorm_cycle);
  const missing: string[] = [];
  if (!isBrainstormCycleReady(state)) {
    missing.push(
      `PROJECT_MANIFEST.json.brainstorm_cycle.status = ready|reconciled (current: ${state.status})`
    );
  }
  missing.push(...getBrainstormCycleValidationErrors(state));

  const jsonArtifacts: Array<[string, string | null]> = [
    ["topic_summary_path", state.topicSummaryPath],
    ["research_brief_path", state.researchBriefPath],
    ["brainstorm_brief_path", state.brainstormBriefPath],
    ["working_memory_path", state.workingMemoryPath],
  ];
  for (const [field, artifactPath] of jsonArtifacts) {
    const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
    if (!(await fileHasMeaningfulJsonContent(resolved))) {
      missing.push(
        `PROJECT_MANIFEST.json.brainstorm_cycle.${field} must point to a non-empty JSON artifact (${artifactPath ?? "unset"})`
      );
    }
  }
  const textArtifacts: Array<[string, string | null]> = [
    ["logic_chain_path", state.logicChainPath],
    ["evidence_chain_path", state.evidenceChainPath],
    ["reasoning_trace_path", state.reasoningTracePath],
    ["question_packet_path", state.questionPacketPath],
    ["synthesis_packet_path", state.synthesisPacketPath],
  ];
  for (const [field, artifactPath] of textArtifacts) {
    const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
    if (!(await fileHasNonWhitespaceContent(resolved))) {
      missing.push(
        `PROJECT_MANIFEST.json.brainstorm_cycle.${field} must point to a non-empty artifact (${artifactPath ?? "unset"})`
      );
    }
  }
  return uniqueStrings(missing);
}

function uniqueStringList(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(asString(value))))];
}

async function selectExistingArtifactPath(params: {
  projectRoot: string;
  candidates: Array<string | null | undefined>;
}): Promise<string | null> {
  for (const candidate of params.candidates) {
    const value = asString(candidate);
    if (!value) {
      continue;
    }
    const resolved = resolveProjectArtifactPath(params.projectRoot, value);
    if (resolved && (await pathExists(resolved))) {
      return toProjectRelativeArtifactPath(params.projectRoot, resolved);
    }
  }
  return null;
}

async function selectExistingNonEmptyDirectory(params: {
  projectRoot: string;
  candidates: Array<string | null | undefined>;
}): Promise<string | null> {
  for (const candidate of params.candidates) {
    const value = asString(candidate);
    if (!value) {
      continue;
    }
    const resolved = resolveProjectArtifactPath(params.projectRoot, value);
    if (resolved && (await isNonEmptyDirectory(resolved))) {
      return toProjectRelativeArtifactPath(params.projectRoot, resolved);
    }
  }
  return null;
}

function inferWritePackageWinningTrackIds(params: {
  current: WritePackageState;
  researchProgram: ResearchProgramState;
  trackRegistry: TrackRegistryLike | null;
}): string[] {
  if (params.current.winningTrackIds.length > 0) {
    return [...params.current.winningTrackIds];
  }
  const programTracks = params.researchProgram.tracks
    .filter((track) => normalizeStage(track.status) === "active")
    .map((track) => track.trackId);
  if (programTracks.length > 0) {
    return uniqueStringList(programTracks);
  }
  return uniqueStringList(
    getActiveTracks(params.trackRegistry).map((track) =>
      pickString(track, ["track_id", "trackId"])
    )
  );
}

function buildSectionAssemblyQueuePayload(params: {
  manifest: Record<string, unknown>;
  now: string;
  winningTrackIds: string[];
}): {
  status: string;
  sections: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
} {
  const writingContract = normalizeWritingContractState(params.manifest.writing_contract);
  const writingSession = normalizeWritingSessionState(params.manifest.writing_session);
  const sectionIds = uniqueStringList([
    ...writingContract.sectionOrder,
    ...writingContract.requiredSections,
    ...writingSession.draftOrder,
    ...Object.keys(writingSession.sectionPackets),
  ]).map((entry) => normalizeStage(entry) ?? entry);
  const sections = sectionIds.map((sectionId) => {
    const packet = writingSession.sectionPackets[sectionId];
    return {
      section: sectionId,
      section_class: packet?.sectionClass ?? null,
      status: packet?.status ?? "planned",
      stale: packet?.stale ?? false,
      goal: packet?.goal ?? null,
      packet_path: packet?.packetPath ?? null,
      draft_path: packet?.draftPath ?? null,
      review_path: packet?.reviewPath ?? null,
      review_verdict: packet?.reviewVerdict ?? null,
      required_figure_ids: packet?.requiredFigureIds ?? [],
      required_citation_count: packet?.requiredCitationCount ?? 0,
      dependent_sections: packet?.dependentSections ?? [],
      track_scope: params.winningTrackIds,
    };
  });
  return {
    status: sections.length > 0 ? "assembled" : "missing",
    sections,
    summary: {
      generated_at: params.now,
      winning_track_ids: params.winningTrackIds,
      active_section: writingSession.currentSection,
      finalized_sections: writingSession.finalizedSections,
      compile_safe_sections: writingSession.compileSafeSections,
    },
  };
}

function buildWritePackageAssemblyIssues(params: {
  blockingInputs: Array<{
    code: string;
    label: string;
    description: string;
    targetArtifact: string | null;
  }>;
  existingIssues: ReviewIssueState[];
  now: string;
}): ReviewIssueState[] {
  const nextById = new Map<string, ReviewIssueState>();
  for (const issue of params.existingIssues) {
    nextById.set(issue.issueId, issue);
  }

  const activeIds = new Set<string>();
  for (const blocker of params.blockingInputs) {
    const issueId = `write-package-${blocker.code}`;
    activeIds.add(issueId);
    const current = nextById.get(issueId);
    nextById.set(issueId, {
      issueId,
      lane: "evidence",
      severity: "medium",
      title: `write_package missing: ${blocker.label}`,
      description: blocker.description,
      targetStage: "write",
      targetArtifact: blocker.targetArtifact,
      openedBy: "write_package_assembler",
      owner: "academic_writer",
      status: "open",
      fixArtifactPaths: blocker.targetArtifact ? [blocker.targetArtifact] : [],
      verifiedAt: null,
      waiverReason: current?.waiverReason ?? null,
      createdAt: current?.createdAt ?? params.now,
      updatedAt: params.now,
    });
  }

  for (const [issueId, issue] of nextById.entries()) {
    if (!issueId.startsWith("write-package-")) {
      continue;
    }
    if (activeIds.has(issueId)) {
      continue;
    }
    if (isResolvedReviewIssueStatus(issue.status)) {
      continue;
    }
    nextById.set(issueId, {
      ...issue,
      status: "closed",
      verifiedAt: params.now,
      updatedAt: params.now,
    });
  }

  return [...nextById.values()].sort((left, right) =>
    (left.issueId ?? "").localeCompare(right.issueId ?? "")
  );
}

async function syncWritePackageAssemblyIssues(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  blockingInputs: Array<{
    code: string;
    label: string;
    description: string;
    targetArtifact: string | null;
  }>;
  now: string;
}): Promise<ReviewIssueTrackerState> {
  const currentTracker = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: params.manifest.review_issue_tracker,
  });
  const issues = buildWritePackageAssemblyIssues({
    blockingInputs: params.blockingInputs,
    existingIssues: currentTracker.issues,
    now: params.now,
  });
  const unresolvedCount = issues.filter(
    (issue) => !isResolvedReviewIssueStatus(issue.status)
  ).length;
  const result = await setReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    reviewIssueTracker: {
      status: unresolvedCount > 0 ? "open" : "ready",
      issue_manifest_path:
        currentTracker.issueManifestPath ?? DEFAULT_REVIEW_ISSUES_PATH,
      issues: issues.map((issue) => serializeReviewIssueState(issue)),
      last_review_round: currentTracker.lastReviewRound,
      pending_reason:
        unresolvedCount > 0
          ? "write_package assembly still has unresolved upstream evidence gaps."
          : null,
      last_updated_at: params.now,
    },
  });
  return result.state;
}

export async function assembleWritePackage(params: {
  projectRoot: string;
  mode?: string | null;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: WritePackageState;
  validationErrors: string[];
  derivedArtifacts: string[];
  blockingInputs: string[];
  packageManifestResolvedPath: string | null;
  assemblyReportResolvedPath: string | null;
  sectionAssemblyQueueResolvedPath: string | null;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifestEnsured(projectRoot);
  const trackRegistry =
    await readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json"));
  const current = normalizeWritePackageState(manifest.write_package);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const experimentSearch = normalizeExperimentSearchState(manifest.experiment_search);
  const figureQc = normalizeFigureQcState(manifest.figure_qc);
  const graphGuidedWriting = normalizeGraphGuidedWritingState(
    manifest.graph_guided_writing
  );
  const now = new Date().toISOString();
  const winningTrackIds = inferWritePackageWinningTrackIds({
    current,
    researchProgram,
    trackRegistry,
  });

  const claimEvidenceMatrixPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.claimEvidenceMatrixPath,
      "analyzer/CLAIM_EVIDENCE_MATRIX.md",
    ],
  });
  const narrativeReportPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.narrativeReportPath,
      "analyzer/NARRATIVE_REPORT.md",
    ],
  });
  const trackVerdictsPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.trackVerdictsPath,
      "analyzer/TRACK_VERDICTS.md",
    ],
  });
  const unsupportedClaimsPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.unsupportedClaimsPath,
      "analyzer/UNSUPPORTED_CLAIMS.md",
    ],
  });
  const baselineSummaryPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.baselineSummaryPath,
      "researcher/baseline_summary.json",
    ],
  });
  const researchSummaryPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.researchSummaryPath,
      "researcher/research_summary.json",
    ],
  });
  const ablationSummaryPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.ablationSummaryPath,
      "researcher/ablation_summary.json",
    ],
  });
  const evaluationSummaryPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.evaluationSummaryPath,
      experimentSearch.evaluationSummaryPath,
      "researcher/evaluation_summary.json",
    ],
  });
  const proofPacketDir = await selectExistingNonEmptyDirectory({
    projectRoot,
    candidates: [
      current.proofPacketDir,
      pickString(manifest.theory_state as Record<string, unknown>, [
        "proof_packet_dir",
        "proofPacketDir",
      ]),
      "analyzer/proof-packets",
    ],
  });

  const derivedArtifacts: string[] = [];
  const blockingInputs: Array<{
    code: string;
    label: string;
    description: string;
    targetArtifact: string | null;
  }> = [];

  const sourceArtifactPaths = uniqueStringList([
    claimEvidenceMatrixPath,
    narrativeReportPath,
    trackVerdictsPath,
    unsupportedClaimsPath,
    baselineSummaryPath,
    researchSummaryPath,
    ablationSummaryPath,
    evaluationSummaryPath,
    proofPacketDir,
  ]);

  const packageManifestPath =
    current.packageManifestPath ?? DEFAULT_WRITE_PACKAGE_MANIFEST_PATH;
  const assemblyReportPath =
    current.assemblyReportPath ?? DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH;
  const sectionAssemblyQueuePath =
    current.sectionAssemblyQueuePath ?? DEFAULT_SECTION_ASSEMBLY_QUEUE_PATH;

  for (const [code, label, artifactPath] of [
    ["winning_tracks", "winning track ids", winningTrackIds.length > 0 ? "TRACK_REGISTRY.json / research_program" : null],
    ["claim_evidence_matrix", "claim evidence matrix", claimEvidenceMatrixPath],
    ["narrative_report", "narrative report", narrativeReportPath],
    ["track_verdicts", "track verdicts", trackVerdictsPath],
    ["unsupported_claims", "unsupported claims", unsupportedClaimsPath],
    ["baseline_summary", "baseline summary", baselineSummaryPath],
    ["research_summary", "research summary", researchSummaryPath],
    ["ablation_summary", "ablation summary", ablationSummaryPath],
    ["evaluation_summary", "evaluation summary", evaluationSummaryPath],
    ["proof_packet_dir", "proof packet directory", proofPacketDir],
  ] as Array<[string, string, string | null]>) {
    if (!artifactPath) {
      blockingInputs.push({
        code,
        label,
        description: `write_package assembly could not find a usable ${label} artifact.`,
        targetArtifact: artifactPath,
      });
    }
  }

  const sectionQueuePayload = buildSectionAssemblyQueuePayload({
    manifest,
    now,
    winningTrackIds,
  });
  let sectionQueueArtifactPath: string | null = null;
  if (sectionQueuePayload.sections.length > 0) {
    const resolved = resolveProjectArtifactPath(projectRoot, sectionAssemblyQueuePath);
    if (resolved) {
      await writeJsonEnsured(resolved, {
        schema_version: 1,
        status: sectionQueuePayload.status,
        ...sectionQueuePayload.summary,
        section_queue: sectionQueuePayload.sections,
      });
      sectionQueueArtifactPath = toProjectRelativeArtifactPath(projectRoot, resolved);
      derivedArtifacts.push(sectionQueueArtifactPath ?? sectionAssemblyQueuePath);
    }
  } else {
    blockingInputs.push({
      code: "section_assembly_queue",
      label: "section assembly queue",
      description:
        "write_package assembly could not derive any active section packet or ordered section queue.",
      targetArtifact: sectionAssemblyQueuePath,
    });
  }

  let figurePackPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [current.figurePackPath, DEFAULT_FIGURE_PACK_PATH],
  });
  if (!figurePackPath) {
    const requiredFigureIds = uniqueStringList([
      ...researchProgram.tracks.flatMap((track) => track.writeScope.allowedFigureIds),
      ...Object.values(normalizeWritingSessionState(manifest.writing_session).sectionPackets).flatMap(
        (packet) => packet.requiredFigureIds
      ),
    ]);
    const figureSourceArtifacts = uniqueStringList([
      experimentSearch.plotPackPath,
      figureQc.figureReviewPath,
      figureQc.figureSelectionPath,
      graphGuidedWriting.anchorIndexPath,
      ...graphGuidedWriting.frontierFiles,
    ]);
    if (requiredFigureIds.length > 0 || figureSourceArtifacts.length > 0) {
      const resolved = resolveProjectArtifactPath(projectRoot, DEFAULT_FIGURE_PACK_PATH);
      if (resolved) {
        const plotPackResolved = resolveProjectArtifactPath(
          projectRoot,
          experimentSearch.plotPackPath
        );
        const plotPack =
          plotPackResolved && (await pathExists(plotPackResolved))
            ? await readJsonIfExists<Record<string, unknown>>(plotPackResolved)
            : null;
        await writeJsonEnsured(resolved, {
          schema_version: 1,
          generated_at: now,
          winning_track_ids: winningTrackIds,
          figure_ids: requiredFigureIds,
          source_artifacts: figureSourceArtifacts,
          plot_pack: plotPack,
          surface_review_path: figureQc.figureReviewPath ?? DEFAULT_FIGURE_REVIEW_PATH,
          selection_path:
            figureQc.figureSelectionPath ?? DEFAULT_FIGURE_SELECTION_PATH,
        });
        figurePackPath = toProjectRelativeArtifactPath(projectRoot, resolved);
        derivedArtifacts.push(figurePackPath ?? DEFAULT_FIGURE_PACK_PATH);
      }
    }
  }
  if (!figurePackPath) {
    blockingInputs.push({
      code: "figure_pack",
      label: "figure pack",
      description:
        "write_package assembly could not derive a figure pack from plot outputs, allowed figures, or figure review inputs.",
      targetArtifact: DEFAULT_FIGURE_PACK_PATH,
    });
  }

  let tablePackPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [current.tablePackPath, DEFAULT_TABLE_PACK_PATH],
  });
  if (!tablePackPath) {
    const tableSources = uniqueStringList([
      baselineSummaryPath,
      researchSummaryPath,
      ablationSummaryPath,
      evaluationSummaryPath,
    ]);
    if (tableSources.length > 0) {
      const resolved = resolveProjectArtifactPath(projectRoot, DEFAULT_TABLE_PACK_PATH);
      if (resolved) {
        await writeJsonEnsured(resolved, {
          schema_version: 1,
          generated_at: now,
          winning_track_ids: winningTrackIds,
          source_summaries: tableSources,
          suggested_tables: tableSources.map((sourcePath) => ({
            table_id: path.basename(sourcePath, path.extname(sourcePath)),
            source_path: sourcePath,
          })),
        });
        tablePackPath = toProjectRelativeArtifactPath(projectRoot, resolved);
        derivedArtifacts.push(tablePackPath ?? DEFAULT_TABLE_PACK_PATH);
      }
    }
  }
  if (!tablePackPath) {
    blockingInputs.push({
      code: "table_pack",
      label: "table pack",
      description:
        "write_package assembly could not derive a table pack because no usable summary artifacts were found.",
      targetArtifact: DEFAULT_TABLE_PACK_PATH,
    });
  }

  let citationCandidatesPath = await selectExistingArtifactPath({
    projectRoot,
    candidates: [
      current.citationCandidatesPath,
      DEFAULT_CITATION_CANDIDATES_PATH,
    ],
  });
  if (!citationCandidatesPath) {
    const bibliographyPath = await selectExistingArtifactPath({
      projectRoot,
      candidates: [
        pickString(manifest.citation_integrity as Record<string, unknown>, [
          "bibliography_path",
          "bibliographyPath",
        ]),
        DEFAULT_CITATION_BIB_PATH,
      ],
    });
    const citationSourceArtifacts = uniqueStringList([
      bibliographyPath,
      claimEvidenceMatrixPath,
      graphGuidedWriting.anchorIndexPath,
      ...graphGuidedWriting.frontierFiles,
    ]);
    if (citationSourceArtifacts.length > 0) {
      const resolved = resolveProjectArtifactPath(
        projectRoot,
        DEFAULT_CITATION_CANDIDATES_PATH
      );
      if (resolved) {
        const bibliographyResolved = resolveProjectArtifactPath(
          projectRoot,
          bibliographyPath
        );
        const bibliographyText =
          bibliographyResolved && (await pathExists(bibliographyResolved))
            ? await readTextIfExists(bibliographyResolved)
            : null;
        const bibliographyEntryCount =
          bibliographyText?.match(/@\w+\s*\{/g)?.length ?? 0;
        await writeJsonEnsured(resolved, {
          schema_version: 1,
          generated_at: now,
          winning_track_ids: winningTrackIds,
          bibliography_path: bibliographyPath,
          bibliography_entry_count: bibliographyEntryCount,
          source_artifacts: citationSourceArtifacts,
        });
        citationCandidatesPath = toProjectRelativeArtifactPath(projectRoot, resolved);
        derivedArtifacts.push(
          citationCandidatesPath ?? DEFAULT_CITATION_CANDIDATES_PATH
        );
      }
    }
  }
  if (!citationCandidatesPath) {
    blockingInputs.push({
      code: "citation_candidates",
      label: "citation candidates",
      description:
        "write_package assembly could not derive citation candidates from bibliography or graph/evidence artifacts.",
      targetArtifact: DEFAULT_CITATION_CANDIDATES_PATH,
    });
  }

  const next: WritePackageState = {
    ...current,
    status: blockingInputs.length === 0 ? "ready" : "partial",
    assemblyStatus: blockingInputs.length === 0 ? "ready" : "partial",
    assemblyMode: asString(params.mode) ?? "deterministic",
    winningTrackIds,
    claimEvidenceMatrixPath,
    narrativeReportPath,
    trackVerdictsPath,
    unsupportedClaimsPath,
    baselineSummaryPath,
    researchSummaryPath,
    ablationSummaryPath,
    evaluationSummaryPath,
    figurePackPath,
    tablePackPath,
    proofPacketDir,
    citationCandidatesPath,
    packageManifestPath,
    assemblyReportPath,
    sectionAssemblyQueuePath: sectionQueueArtifactPath ?? sectionAssemblyQueuePath,
    sourceArtifactCount: sourceArtifactPaths.length,
    derivedArtifactCount: uniqueStringList(derivedArtifacts).length,
    assembledAt: now,
    pendingReason:
      blockingInputs.length === 0
        ? null
        : `write_package assembly is still missing ${blockingInputs
            .map((item) => item.label)
            .join(", ")}`,
    lastUpdatedAt: now,
  };

  const packageManifestResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    packageManifestPath
  );
  if (packageManifestResolvedPath) {
    await writeJsonEnsured(packageManifestResolvedPath, {
      schema_version: 1,
      generated_at: now,
      status: next.status,
      assembly_status: next.assemblyStatus,
      assembly_mode: next.assemblyMode,
      winning_track_ids: next.winningTrackIds,
      claim_evidence_matrix_path: next.claimEvidenceMatrixPath,
      narrative_report_path: next.narrativeReportPath,
      track_verdicts_path: next.trackVerdictsPath,
      unsupported_claims_path: next.unsupportedClaimsPath,
      baseline_summary_path: next.baselineSummaryPath,
      research_summary_path: next.researchSummaryPath,
      ablation_summary_path: next.ablationSummaryPath,
      evaluation_summary_path: next.evaluationSummaryPath,
      figure_pack_path: next.figurePackPath,
      table_pack_path: next.tablePackPath,
      proof_packet_dir: next.proofPacketDir,
      citation_candidates_path: next.citationCandidatesPath,
      section_assembly_queue_path: next.sectionAssemblyQueuePath,
      source_artifact_count: next.sourceArtifactCount,
      derived_artifact_count: next.derivedArtifactCount,
      pending_reason: next.pendingReason,
      blocking_inputs: blockingInputs.map((item) => ({
        code: item.code,
        label: item.label,
        description: item.description,
        target_artifact: item.targetArtifact,
      })),
      section_queue: sectionQueuePayload.sections,
    });
  }

  const assemblyReportResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    assemblyReportPath
  );
  if (assemblyReportResolvedPath) {
    await writeJsonEnsured(assemblyReportResolvedPath, {
      schema_version: 1,
      generated_at: now,
      trigger: asString(params.trigger) ?? "manual",
      mode: asString(params.mode) ?? "deterministic",
      source_artifacts: sourceArtifactPaths,
      derived_artifacts: uniqueStringList(derivedArtifacts),
      blocking_inputs: blockingInputs.map((item) => ({
        code: item.code,
        label: item.label,
        description: item.description,
        target_artifact: item.targetArtifact,
      })),
    });
  }

  manifest.write_package = serializeWritePackageState(next);
  await saveManifest(projectRoot, manifest);
  const issueTracker = await syncWritePackageAssemblyIssues({
    projectRoot,
    manifest,
    blockingInputs,
    now,
  });

  const validationErrors = getWritePackageValidationErrors(next);
  await appendWorkflowTraceEvent({
    projectRoot,
    projectId: inferProjectId(projectRoot, manifest),
    kind: "write_package_assembly",
    action: "assemble_write_package",
    functionName: "assembleWritePackage",
    stage: normalizeStage(manifest.current_stage),
    owner: asString(manifest.owner_agent),
    agentId: params.agentId ?? null,
    sessionKey: null,
    summary: `write_package assembly ${blockingInputs.length === 0 ? "ready" : "partial"}`,
    details: {
      mode: asString(params.mode) ?? "deterministic",
      trigger: asString(params.trigger) ?? "manual",
      stateStatus: next.status,
      assemblyStatus: next.assemblyStatus,
      derivedArtifacts: uniqueStringList(derivedArtifacts),
      blockingInputs: blockingInputs.map((item) => item.label),
      reviewIssueCounts: issueTracker.openCounts,
    },
  });

  return {
    state: next,
    validationErrors,
    derivedArtifacts: uniqueStringList(derivedArtifacts),
    blockingInputs: blockingInputs.map((item) => item.description),
    packageManifestResolvedPath,
    assemblyReportResolvedPath,
    sectionAssemblyQueueResolvedPath: resolveProjectArtifactPath(
      projectRoot,
      next.sectionAssemblyQueuePath
    ),
  };
}

function getWritingSectionContractViolations(params: {
  writingSession: WritingSessionState;
  writingContract: WritingContractState;
}): string[] {
  const violations: string[] = [];
  const finalLikeStatuses = new Set(["finalized", "frozen"]);
  for (const section of params.writingContract.requiredSections) {
    const normalized = normalizeStage(section) ?? section;
    const packet = params.writingSession.sectionPackets[normalized];
    if (!packet) {
      violations.push(`writing_session missing section packet for required section ${section}`);
      continue;
    }
    if (packet.status === "stale" || packet.stale) {
      violations.push(`section packet ${section} is stale`);
    }
    if (
      params.writingSession.finalizedSections.includes(normalized) &&
      !finalLikeStatuses.has(packet.status)
    ) {
      violations.push(
        `finalized section ${section} must have packet status finalized/frozen (current: ${packet.status})`
      );
    }
    if (
      params.writingSession.compileSafeSections.includes(normalized) &&
      !params.writingSession.finalizedSections.includes(normalized)
    ) {
      violations.push(`compile_safe section ${section} must also be finalized`);
    }
  }
  const currentSection = params.writingSession.currentSection;
  if (currentSection) {
    const packet = params.writingSession.sectionPackets[currentSection];
    if (packet && packet.status === "frozen") {
      violations.push(`current_section ${currentSection} cannot be frozen`);
    }
  }
  return violations;
}

function isReflectableExperiment(entry: ExperimentLedgerEntry): boolean {
  return Boolean(
    isTerminalExperimentStatus(entry.status) ||
      entry.completedAt ||
      entry.decision ||
      entry.keyMetric ||
      entry.failureSignature ||
      entry.resultPaths.length > 0 ||
      entry.evidencePointers.length > 0
  );
}

function getInnovationReflectionBasis(ledger: ExperimentLedger | null): {
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
} {
  if (!ledger) {
    return {
      latestExperimentUpdateAt: null,
      experimentIds: [],
    };
  }

  const reflectable = ledger.experiments
    .filter(isReflectableExperiment)
    .sort((left, right) =>
      getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left))
    );

  return {
    latestExperimentUpdateAt:
      reflectable.length > 0 ? getExperimentSortTimestamp(reflectable[0]) : null,
    experimentIds: reflectable.map((entry) => entry.experimentId),
  };
}

function isInnovationReflectionDue(params: {
  state: InnovationReflectionState;
  ledger: ExperimentLedger | null;
}): boolean {
  const basis = getInnovationReflectionBasis(params.ledger);
  if (!params.state.requiredAfterExperiments || basis.experimentIds.length === 0) {
    return false;
  }
  if (params.state.status === "running") {
    return false;
  }
  if (!params.state.lastReflectionAt || !params.state.lastReflectionPath) {
    return true;
  }
  if (!params.state.reflectedThroughExperimentUpdateAt) {
    return true;
  }
  if (
    basis.latestExperimentUpdateAt &&
    Date.parse(params.state.reflectedThroughExperimentUpdateAt) <
      Date.parse(basis.latestExperimentUpdateAt)
  ) {
    return true;
  }
  if (params.state.status === "pending" || params.state.status === "stale") {
    return true;
  }
  const reflectedIds = new Set(params.state.reflectedExperimentIds);
  return basis.experimentIds.some((experimentId) => !reflectedIds.has(experimentId));
}

function buildExperimentMemoryDigest(
  ledger: ExperimentLedger | null,
  limit = 5
): ExperimentMemoryDigest[] {
  if (!ledger) {
    return [];
  }
  return [...ledger.experiments]
    .sort((left, right) =>
      getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left))
    )
    .slice(0, limit)
    .map((entry) => ({
      experimentId: entry.experimentId,
      name: entry.name,
      trackId: entry.trackId,
      status: entry.status,
      stage: entry.stage,
      decision: entry.decision,
      updatedAt: entry.updatedAt,
      keyMetric: metricToText(entry.keyMetric),
      papernexusSyncStatus: entry.papernexusSync.status,
      failureSignature: entry.failureSignature,
    }));
}

async function loadProjectState(options?: {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  policy?: WorkflowGuardPolicy;
}): Promise<ProjectState> {
  const resolvedProject = resolveProjectContext({
    policy: options?.policy,
    context: options,
  });
  const projectRoot = resolvedProject.projectRoot;
  if (!projectRoot) {
    return {
      projectRoot: null,
      projectId: null,
      projectResolutionSource: resolvedProject.source,
      channelBindingKey: resolvedProject.channelKey,
      channelBindingStorePath: resolvedProject.storePath,
      channelBinding: resolvedProject.binding,
      manifest: null,
      trackRegistry: null,
      mailbox: null,
      experimentLedger: null,
    };
  }

  const [manifest, trackRegistry, mailbox, experimentLedger] = await Promise.all([
    readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    readMailbox(projectRoot),
    loadExperimentLedgerIfExists(projectRoot),
  ]);

  return {
    projectRoot,
    projectId: inferProjectId(projectRoot, manifest),
    projectResolutionSource: resolvedProject.source,
    channelBindingKey: resolvedProject.channelKey,
    channelBindingStorePath: resolvedProject.storePath,
    channelBinding: resolvedProject.binding,
    manifest,
    trackRegistry,
    mailbox,
    experimentLedger,
  };
}

function getTracks(trackRegistry: TrackRegistryLike | null): Array<Record<string, unknown>> {
  const tracks = trackRegistry?.tracks;
  return Array.isArray(tracks)
    ? tracks.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function getActiveTracks(trackRegistry: TrackRegistryLike | null): Array<Record<string, unknown>> {
  return getTracks(trackRegistry).filter(
    (track) => normalizeStage(track.status) === "active"
  );
}

async function hasExperimentBundle(projectRoot: string): Promise<boolean> {
  const coderRoot = path.join(projectRoot, "coder");
  try {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: coderRoot, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      const entries = await fs.readdir(current.dir, { withFileTypes: true });
      const trainPy = path.join(current.dir, "train.py");
      const readme = path.join(current.dir, "README.md");
      const manifest = path.join(current.dir, "EXPERIMENT_MANIFEST.json");
      if (
        (await pathExists(trainPy)) &&
        (await pathExists(readme)) &&
        (await pathExists(manifest))
      ) {
        return true;
      }
      if (current.depth >= 3) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name.startsWith(".") || entry.name === "__pycache__") {
          continue;
        }
        queue.push({
          dir: path.join(current.dir, entry.name),
          depth: current.depth + 1,
        });
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function hasPrefixedFile(dir: string, prefix: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((entry) => entry.startsWith(prefix));
  } catch {
    return false;
  }
}

function manifestFieldExists(manifest: ManifestLike | null, pathSpec: string[]): boolean {
  let current: unknown = manifest;
  for (const segment of pathSpec) {
    const record = asRecord(current);
    if (!record || !(segment in record)) {
      return false;
    }
    current = record[segment];
  }
  if (typeof current === "string") {
    return current.trim().length > 0;
  }
  return current !== null && current !== undefined;
}

function resolveTrackArtifactPath(projectRoot: string, artifactPath: string | null): string | null {
  if (!artifactPath) {
    return null;
  }
  return (
    resolveProjectArtifactPath(projectRoot, artifactPath) ??
    path.join(projectRoot, artifactPath)
  );
}

async function fileHasNonWhitespaceContent(targetPath: string | null): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  const raw = await readTextIfExists(targetPath);
  return Boolean(raw && raw.trim().length > 0);
}

function trackHasGraphBackedInnovationEvidence(track: Record<string, unknown>): boolean {
  return (
    asStringArray(track.evidencePointers ?? track.evidence_pointers).length > 0 ||
    asStringArray(track.linkedGraphNodes ?? track.linked_graph_nodes).length > 0 ||
    asStringArray(track.relationPatterns ?? track.relation_patterns).length > 0
  );
}

function normalizeWritingScopeLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized || null;
}

function collectSelectedWritingScope(manifest: ManifestLike | null): string[] {
  const writingContract = normalizeWritingContractState(manifest?.writing_contract);
  const writingSession = normalizeWritingSessionState(manifest?.writing_session);
  return uniqueStrings(
    [
      ...writingContract.requiredSections,
      ...writingContract.sectionOrder,
      ...writingSession.draftOrder,
      ...writingSession.finalizedSections,
      ...writingSession.compileSafeSections,
      ...(writingSession.currentSection ? [writingSession.currentSection] : []),
    ]
      .map((entry) => normalizeWritingScopeLabel(entry))
      .filter((entry): entry is string => Boolean(entry))
  );
}

function getStructuredUnsupportedScopeHits(
  manifest: ManifestLike | null,
  selectedScope: string[]
): string[] {
  const writingSession = normalizeWritingSessionState(manifest?.writing_session);
  return Object.values(writingSession.sectionPackets)
    .filter((packet) => {
      if (packet.forbiddenUnsupportedClaims.length === 0) {
        return false;
      }
      if (selectedScope.length === 0) {
        return true;
      }
      const sectionLabel = normalizeWritingScopeLabel(packet.section);
      return Boolean(sectionLabel && selectedScope.includes(sectionLabel));
    })
    .map(
      (packet) =>
        `${packet.section}: ${packet.forbiddenUnsupportedClaims.join(", ")}`
    );
}

function findUnsupportedPrimaryClaimLines(
  rawText: string,
  selectedScope: string[]
): string[] {
  const matches: string[] = [];
  let currentHeading: string | null = null;
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const headingMatch = line.match(/^#+\s*(.+)$/);
    if (headingMatch) {
      currentHeading = headingMatch[1];
      continue;
    }
    if (!/\bunsupported\b/i.test(line)) {
      continue;
    }
    if (!/\bprimary\b/i.test(line) && !/\bheadline\b/i.test(line) && !/\bmain claim\b/i.test(line)) {
      continue;
    }
    if (selectedScope.length > 0) {
      const normalizedLine = normalizeWritingScopeLabel(line);
      const normalizedHeading = normalizeWritingScopeLabel(currentHeading);
      const inScope = selectedScope.some(
        (scope) =>
          (normalizedLine && normalizedLine.includes(scope)) ||
          (normalizedHeading && normalizedHeading.includes(scope))
      );
      if (!inScope) {
        continue;
      }
    }
    matches.push(line);
  }
  return matches;
}

async function findUnsupportedPrimaryClaimsInSelectedWritingScope(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
}): Promise<{ blocked: boolean; reason: string | null }> {
  const selectedScope = collectSelectedWritingScope(params.manifest);
  const scopeLabel =
    selectedScope.length > 0 ? selectedScope.join(", ") : "all planned sections";
  const structuredHits = getStructuredUnsupportedScopeHits(
    params.manifest,
    selectedScope
  );
  if (structuredHits.length > 0) {
    return {
      blocked: true,
      reason: `unsupported primary claims remain in the selected writing scope (${scopeLabel}): ${structuredHits
        .slice(0, 3)
        .join("; ")}${structuredHits.length > 3 ? "; ..." : ""}`,
    };
  }

  const unsupportedClaimsPath = path.join(
    params.projectRoot,
    "analyzer",
    "UNSUPPORTED_CLAIMS.md"
  );
  const unsupportedClaimsRaw = await readTextIfExists(unsupportedClaimsPath);
  if (!unsupportedClaimsRaw) {
    return { blocked: false, reason: null };
  }
  const textHits = findUnsupportedPrimaryClaimLines(
    unsupportedClaimsRaw,
    selectedScope
  );
  if (textHits.length === 0) {
    return { blocked: false, reason: null };
  }
  return {
    blocked: true,
    reason: `unsupported primary claims remain in the selected writing scope (${scopeLabel}): ${textHits
      .slice(0, 3)
      .join("; ")}${textHits.length > 3 ? "; ..." : ""}`,
  };
}

async function getMissingStageSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
  trackRegistry: TrackRegistryLike | null;
  experimentLedger: ExperimentLedger | null;
  currentStage: string | null;
}): Promise<string[]> {
  const { projectRoot, manifest, trackRegistry, experimentLedger, currentStage } = params;
  if (!currentStage) {
    return ["PROJECT_MANIFEST.json.current_stage is missing"];
  }

  const missing: string[] = [];

  switch (currentStage) {
    case "setup":
      if (!(await pathExists(path.join(projectRoot, "PROJECT_MANIFEST.json")))) {
        missing.push("{PROJ}/PROJECT_MANIFEST.json");
      }
      if (!(await pathExists(path.join(projectRoot, "TRACK_REGISTRY.json")))) {
        missing.push("{PROJ}/TRACK_REGISTRY.json");
      }
      if (!(await pathExists(path.join(projectRoot, "CLAIM_POLICY.md")))) {
        missing.push("{PROJ}/CLAIM_POLICY.md");
      }
      if (!(await pathExists(getExperimentLedgerPath(projectRoot)))) {
        missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json");
      }
      if (!manifestFieldExists(manifest, ["idle_research"])) {
        missing.push("PROJECT_MANIFEST.json.idle_research");
      }
      if (!(await pathExists(path.join(projectRoot, "graph")))) {
        missing.push("{PROJ}/graph/");
      }
      break;
    case "graph_build":
      if (!(await pathExists(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json")))) {
        missing.push("{PROJ}/graph/PAPERNEXUS_STATUS.json");
      }
      if (!(await pathExists(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md")))) {
        missing.push("{PROJ}/graph/GRAPH_BUILD_REPORT.md");
      }
      if (!(await pathExists(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json")))) {
        missing.push("{PROJ}/graph/GRAPH_PRESENCE_CHECK.json");
      }
      if (!manifestFieldExists(manifest, ["paper_ingestion", "graph_presence_checked_at"])) {
        missing.push("PROJECT_MANIFEST.json.paper_ingestion.graph_presence_checked_at");
      }
      {
        const paperIngestion = asRecord(manifest?.paper_ingestion);
        const graphPresenceStatus = normalizeGraphPresenceStatus(
          paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
        );
        if (graphPresenceStatus !== "ready") {
          missing.push(
            `PROJECT_MANIFEST.json.paper_ingestion.graph_presence_status = ready (current: ${graphPresenceStatus ?? "unset"})`
          );
          const missingSummary = summarizeGraphPresenceMissing(paperIngestion);
          if (missingSummary) {
            missing.push(`PaperNexus corpus still misses canonical papers: ${missingSummary}`);
          }
        }
      }
      break;
    case "frontier_mapping":
      if (!(await pathExists(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md")))) {
        missing.push("{PROJ}/researcher/FRONTIER_REPORT.md");
      }
      {
        const directFrontierFiles = [
          "LIMITATION_FRONTIER.md",
          "CONTRADICTION_FRONTIER.md",
          "TRANSFER_FRONTIER.md",
          "COMPOSITION_FRONTIER.md",
          "ANCHOR_INDEX.md",
        ];
        const directFrontiersReady = (
          await Promise.all(
            directFrontierFiles.map((fileName) =>
              pathExists(path.join(projectRoot, "graph", fileName))
            )
          )
        ).every(Boolean);
        const legacySubgraphsReady = await isNonEmptyDirectory(
          path.join(projectRoot, "graph", "subgraphs")
        );
        if (!directFrontiersReady && !legacySubgraphsReady) {
          missing.push(
            "{PROJ}/graph/LIMITATION_FRONTIER.md, CONTRADICTION_FRONTIER.md, TRANSFER_FRONTIER.md, COMPOSITION_FRONTIER.md, ANCHOR_INDEX.md (or legacy {PROJ}/graph/subgraphs/)"
          );
        }
      }
      if (
        normalizeStage(manifest?.current_stage) === "frontier_mapping" &&
        normalizeStage(manifest?.current_micro_stage) !== "frontiers_packaged"
      ) {
        missing.push("PROJECT_MANIFEST.json.current_micro_stage = frontiers_packaged");
      }
      missing.push(
        ...(await getBrainstormCycleMissingSignals({
          projectRoot,
          manifest,
        }))
      );
      break;
    case "idea": {
      if (!(await pathExists(path.join(projectRoot, "researcher", "IDEA_REPORT.md")))) {
        missing.push("{PROJ}/researcher/IDEA_REPORT.md");
      }
      if (!(await pathExists(path.join(projectRoot, "researcher", "IDEA_AUDIT.md")))) {
        missing.push("{PROJ}/researcher/IDEA_AUDIT.md");
      }
      const innovationReflection = normalizeInnovationReflectionState(
        manifest?.innovation_reflection
      );
      if (
        isInnovationReflectionDue({
          state: innovationReflection,
          ledger: experimentLedger,
        })
      ) {
        missing.push(
          "{PROJ}/researcher/INNOVATION_REFLECTION.md refreshed after the latest experiment results"
        );
      }
      const activeTracks = getActiveTracks(trackRegistry);
      if (activeTracks.length < 1 || activeTracks.length > 2) {
        missing.push("TRACK_REGISTRY.json with 1-2 active tracks");
      }
      for (const track of activeTracks) {
        const trackId = asString(track.track_id) ?? "unknown-track";
        const reasoningPacketDir = asString(track.reasoning_packet_dir);
        const workingMemoryPath = asString(track.working_memory_path);
        const synthesisPacketPath = asString(track.synthesis_packet_path);
        if (!trackHasGraphBackedInnovationEvidence(track)) {
          missing.push(`active track ${trackId} missing graph-backed innovation evidence`);
        }
        if (!reasoningPacketDir) {
          missing.push(`active track ${trackId} missing reasoning_packet_dir`);
        } else {
          const resolvedReasoningPacketDir = resolveTrackArtifactPath(
            projectRoot,
            reasoningPacketDir
          );
          if (
            !resolvedReasoningPacketDir ||
            !(await isNonEmptyDirectory(resolvedReasoningPacketDir))
          ) {
            missing.push(
              `active track ${trackId} requires a non-empty reasoning packet under ${reasoningPacketDir}`
            );
          }
        }
        if (!workingMemoryPath) {
          missing.push(`active track ${trackId} missing working_memory_path`);
        } else if (
          !(await fileHasNonWhitespaceContent(
            resolveTrackArtifactPath(projectRoot, workingMemoryPath)
          ))
        ) {
          missing.push(
            `active track ${trackId} working_memory_path must point to a non-empty artifact (${workingMemoryPath})`
          );
        }
        if (!synthesisPacketPath) {
          missing.push(`active track ${trackId} missing synthesis_packet_path`);
        } else if (
          !(await fileHasNonWhitespaceContent(
            resolveTrackArtifactPath(projectRoot, synthesisPacketPath)
          ))
        ) {
          missing.push(
            `active track ${trackId} synthesis_packet_path must point to a non-empty artifact (${synthesisPacketPath})`
          );
        }
      }
      missing.push(
        ...(await getBrainstormCycleMissingSignals({
          projectRoot,
          manifest,
        }))
      );
      break;
    }
    case "plan":
      if (!(await pathExists(path.join(projectRoot, "orchestrator", "PLAN.md")))) {
        missing.push("{PROJ}/orchestrator/PLAN.md");
      }
      if (!(await pathExists(path.join(projectRoot, "orchestrator", "TODOS.md")))) {
        missing.push("{PROJ}/orchestrator/TODOS.md");
      }
      if (!(await pathExists(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md")))) {
        missing.push("{PROJ}/orchestrator/PLAN_AUDIT.md");
      }
      {
        const researchProgram = normalizeResearchProgramState(
          manifest?.research_program
        );
        missing.push(...getResearchProgramValidationErrors(researchProgram));
      }
      {
        const orchestrationState = normalizeOrchestrationState(
          manifest?.orchestration_state
        );
        missing.push(
          ...getOrchestrationStateValidationErrors(orchestrationState, currentStage)
        );
      }
      break;
    case "code":
      if (!(await hasExperimentBundle(projectRoot))) {
        missing.push(
          "{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/train.py + README.md + EXPERIMENT_MANIFEST.json"
        );
      }
      if (!(await pathExists(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md")))) {
        missing.push("{PROJ}/coder/EXPERIMENT_INDEX.md");
      }
      break;
    case "experiment":
      if (!(await isNonEmptyDirectory(path.join(projectRoot, "researcher", "artifacts", "results")))) {
        missing.push("{PROJ}/researcher/artifacts/results/");
      }
      if (!(await pathExists(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md")))) {
        missing.push("{PROJ}/researcher/EXPERIMENT_REGISTRY.md");
      }
      if (!(await pathExists(getExperimentLedgerPath(projectRoot)))) {
        missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json");
      }
      if (!experimentLedger || experimentLedger.experiments.length === 0) {
        missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json with recorded experiments");
      }
      if (!manifestFieldExists(manifest, ["experiment_memory", "last_ledger_update_at"])) {
        missing.push("PROJECT_MANIFEST.json.experiment_memory.last_ledger_update_at");
      }
      {
        const experimentSearch = await loadExperimentSearchState({
          projectRoot,
          manifest,
        });
        if (!isExperimentSearchReadyForAnalysis(experimentSearch)) {
          missing.push(
            `PROJECT_MANIFEST.json.experiment_search must be ready_for_analysis with multi_seed + plot pack complete before ANALYZE (current: status=${experimentSearch.status}, multi_seed=${experimentSearch.multiSeedStatus}, plot_pack=${experimentSearch.plotPackStatus})`
          );
        }
      }
      break;
    case "analyze":
      for (const file of [
        "NARRATIVE_REPORT.md",
        "CLAIM_EVIDENCE_MATRIX.md",
        "TRACK_VERDICTS.md",
        "UNSUPPORTED_CLAIMS.md",
        "QUALITY_AUDIT.md",
        "THEORY_SUPPORT_NOTE.md",
        "THEORY_STATE.json",
      ]) {
        if (!(await pathExists(path.join(projectRoot, "analyzer", file)))) {
          missing.push(`{PROJ}/analyzer/${file}`);
        }
      }
      if (!(await isNonEmptyDirectory(path.join(projectRoot, "analyzer", "proof-packets")))) {
        missing.push("{PROJ}/analyzer/proof-packets/");
      }
      break;
    case "review": {
      const reviewReport = await pathExists(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"));
      const reviewState = await readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, "researcher", "REVIEW_STATE.json")
      );
      const reviewCompleted = normalizeStage(reviewState?.status) === "completed";
      if (!reviewReport && !reviewCompleted) {
        missing.push("{PROJ}/reviewer/REVIEW_REPORT.md or completed REVIEW_STATE.json");
      }
      {
        const figureQc = normalizeFigureQcState(manifest?.figure_qc);
        const surfaceReviewPath = resolveProjectArtifactPath(
          projectRoot,
          figureQc.figureReviewPath ?? DEFAULT_FIGURE_REVIEW_PATH
        );
        if (!surfaceReviewPath || !(await pathExists(surfaceReviewPath))) {
          missing.push(
            `{PROJ}/${figureQc.figureReviewPath ?? DEFAULT_FIGURE_REVIEW_PATH}`
          );
        }
      }
      {
        const submissionSimulationPath = path.join(
          projectRoot,
          DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH
        );
        if (!(await pathExists(submissionSimulationPath))) {
          missing.push(`{PROJ}/${DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH}`);
        }
      }
      const unsupportedPrimaryClaims =
        await findUnsupportedPrimaryClaimsInSelectedWritingScope({
          projectRoot,
          manifest,
        });
      if (unsupportedPrimaryClaims.blocked && unsupportedPrimaryClaims.reason) {
        missing.push(unsupportedPrimaryClaims.reason);
      }
      break;
    }
    case "write":
      {
        const writingContract = normalizeWritingContractState(
          manifest?.writing_contract
        );
        const writePackage = normalizeWritePackageState(manifest?.write_package);
        const writingContractEval = await evaluateWritingContractState({
          projectRoot,
          state: writingContract,
        });
        if (
          writingContract.templateRequired &&
          (!writingContractEval.templateResolvedPath ||
            !writingContractEval.templateExists)
        ) {
          missing.push(
            "PROJECT_MANIFEST.json.writing_contract.template_path with an existing user template before Writer drafts prose"
          );
        }
        if (writingContract.kgStorylineRequired) {
          const kgPacketPath =
            resolveProjectArtifactPath(
              projectRoot,
              writingContract.kgStorylinePacketPath ?? DEFAULT_KG_STORYLINE_PACKET_PATH
            ) ??
            path.join(projectRoot, DEFAULT_KG_STORYLINE_PACKET_PATH);
          if (!(await pathExists(kgPacketPath))) {
            missing.push(
              "{PROJ}/academic_writer/KG_STORYLINE_PACKET.md (or writing_contract.kg_storyline_packet_path)"
            );
          }
          if (writingContract.kgStorylineStatus !== "ready") {
            missing.push(
              `PROJECT_MANIFEST.json.writing_contract.kg_storyline_status = ready (current: ${writingContract.kgStorylineStatus})`
            );
          }
        }
        if (!(await pathExists(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md")))) {
          missing.push("{PROJ}/academic_writer/PAPER_PLAN.md");
        }
        if (
          !(await pathExists(path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md")))
        ) {
          missing.push("{PROJ}/academic_writer/STORYLINE_SKETCH.md");
        }
        {
          const writingSession = normalizeWritingSessionState(
            manifest?.writing_session
          );
          const sectionViolations = getWritingSectionContractViolations({
            writingSession,
            writingContract,
          });
          missing.push(...sectionViolations);
          if (!isWritingSessionReadyForSubmit(writingSession)) {
            missing.push(
              `PROJECT_MANIFEST.json.writing_session must be ready_for_submit with publication-ready section packets and covered graph evidence (current: status=${writingSession.status}, coverage=${writingSession.graphEvidenceCoverageStatus})`
            );
          }
        }
        missing.push(...getWritePackageValidationErrors(writePackage));
        {
          const graphGuidedWriting = normalizeGraphGuidedWritingState(
            manifest?.graph_guided_writing
          );
          if (!isGraphGuidedWritingReadyForSubmit(graphGuidedWriting)) {
            missing.push(
              `PROJECT_MANIFEST.json.graph_guided_writing must report ready/covered evidence with no missing claims (current: status=${graphGuidedWriting.status}, evidence_coverage=${graphGuidedWriting.evidenceCoverageStatus}, missing_claims=${graphGuidedWriting.missingEvidenceClaims.join(",") || "none"})`
            );
          }
        }
        {
          const reviewIssueTracker = await hydrateReviewIssueTrackerState({
            projectRoot,
            value: manifest?.review_issue_tracker,
          });
          if (hasBlockingReviewIssues(reviewIssueTracker)) {
            missing.push(
              `PROJECT_MANIFEST.json.review_issue_tracker must have 0 open critical/high issues before submit handoff (current: critical=${reviewIssueTracker.openCounts.critical}, high=${reviewIssueTracker.openCounts.high}, status=${reviewIssueTracker.status})`
            );
          }
          if (hasUnwaivedMediumOrHigherReviewIssues(reviewIssueTracker)) {
            missing.push(
              "PROJECT_MANIFEST.json.review_issue_tracker must resolve or waive all medium+ issues before submit handoff"
            );
          }
        }
        {
          const paperQc = normalizePaperQcState(manifest?.paper_qc);
          if (normalizeStage(paperQc.compileStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.paper_qc.compile_status = pass (current: ${paperQc.compileStatus})`
            );
          }
          if (normalizeStage(paperQc.pageBudgetStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.paper_qc.page_budget_status = pass (current: ${paperQc.pageBudgetStatus})`
            );
          }
          if (normalizeStage(paperQc.invalidFigureRefStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.paper_qc.invalid_figure_ref_status = pass (current: ${paperQc.invalidFigureRefStatus})`
            );
          }
        }
        {
          const figureQc = normalizeFigureQcState(manifest?.figure_qc);
          if (normalizeStage(figureQc.duplicateFigureStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.figure_qc.duplicate_figure_status = pass (current: ${figureQc.duplicateFigureStatus})`
            );
          }
          if (normalizeStage(figureQc.captionAlignmentStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.figure_qc.caption_alignment_status = pass (current: ${figureQc.captionAlignmentStatus})`
            );
          }
          if (normalizeStage(figureQc.textAlignmentStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.figure_qc.text_alignment_status = pass (current: ${figureQc.textAlignmentStatus})`
            );
          }
          if (normalizeStage(figureQc.selectionStatus) === "fail") {
            missing.push(
              `PROJECT_MANIFEST.json.figure_qc.selection_status = pass (current: ${figureQc.selectionStatus})`
            );
          }
        }
        {
          const citationCollection = normalizeCitationCollectionState(
            manifest?.citation_collection
          );
          if (normalizeStage(citationCollection.status) === "blocked") {
            missing.push(
              `PROJECT_MANIFEST.json.citation_collection.status must not be blocked (current: ${citationCollection.status})`
            );
          }
          if (citationCollection.hallucinatedCount > 0) {
            missing.push(
              `PROJECT_MANIFEST.json.citation_collection.hallucinated_count = 0 (current: ${citationCollection.hallucinatedCount})`
            );
          }
        }
        {
          const theorySupport = normalizeTheorySupportState(manifest?.theory_state);
          if (writingContract.proofAppendixRequired) {
            const theoryStatePath = resolveProjectArtifactPath(
              projectRoot,
              theorySupport.theoryStatePath
            );
            if (!theoryStatePath || !(await pathExists(theoryStatePath))) {
              missing.push("{PROJ}/analyzer/THEORY_STATE.json");
            }
            const proofPacketDir = resolveProjectArtifactPath(
              projectRoot,
              theorySupport.proofPacketDir
            );
            if (!proofPacketDir || !(await isNonEmptyDirectory(proofPacketDir))) {
              missing.push("{PROJ}/analyzer/proof-packets/");
            }
            const appendixPlanPath = resolveProjectArtifactPath(
              projectRoot,
              theorySupport.appendixPacketPath ?? DEFAULT_THEORY_APPENDIX_PLAN_PATH
            );
            if (!appendixPlanPath || !(await pathExists(appendixPlanPath))) {
              missing.push(
                "{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md (or theory_state.appendix_packet_path)"
              );
            }
            const appendixDraftPath = resolveProjectArtifactPath(
              projectRoot,
              writingContract.proofAppendixPath ?? DEFAULT_THEORY_APPENDIX_SECTION_PATH
            );
            if (!appendixDraftPath || !(await pathExists(appendixDraftPath))) {
              missing.push(
                "{PROJ}/academic_writer/paper/sections/appendix_theory.tex (or writing_contract.proof_appendix_path)"
              );
            }
          }
        }
      }
      {
        const citationIntegrity = normalizeCitationIntegrityState(
          manifest?.citation_integrity
        );
        const bibliographyPath = resolveProjectArtifactPath(
          projectRoot,
          citationIntegrity.bibliographyPath
        );
        if (
          citationIntegrity.enabled &&
          citationIntegrity.verificationRequired &&
          citationIntegrity.verificationStatus !== "verified"
        ) {
          missing.push(
            `PROJECT_MANIFEST.json.citation_integrity.verification_status = verified (current: ${citationIntegrity.verificationStatus})`
          );
        }
        if (citationIntegrity.enabled && bibliographyPath && !(await pathExists(bibliographyPath))) {
          missing.push(
            `citation bibliography at ${citationIntegrity.bibliographyPath ?? DEFAULT_CITATION_BIB_PATH}`
          );
        }
      }
      if (!(await pathExists(path.join(projectRoot, "academic_writer", "paper", "main.pdf")))) {
        missing.push("{PROJ}/academic_writer/paper/main.pdf");
      }
      if (!(await pathExists(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md")))) {
        missing.push("{PROJ}/academic_writer/WRITING_SIGNALS.md");
      }
      if (!(await isNonEmptyDirectory(path.join(projectRoot, "cross-reviewer")))) {
        missing.push("{PROJ}/cross-reviewer/");
      }
      break;
    case "submit":
      {
        const citationIntegrity = normalizeCitationIntegrityState(
          manifest?.citation_integrity
        );
        const externalReview = normalizeExternalReviewState(
          manifest?.external_review_state
        );
        const verificationReportPath = resolveProjectArtifactPath(
          projectRoot,
          citationIntegrity.verificationReportPath
        );
        const bibliographyPath = resolveProjectArtifactPath(
          projectRoot,
          citationIntegrity.bibliographyPath
        );
        const externalReviewPath = resolveProjectArtifactPath(
          projectRoot,
          externalReview.externalReviewPath
        );
        const reviewResponsePath = resolveProjectArtifactPath(
          projectRoot,
          externalReview.reviewResponsePath
        );
        if (citationIntegrity.enabled && citationIntegrity.verificationRequired) {
          if (citationIntegrity.verificationStatus !== "verified") {
            missing.push(
              `PROJECT_MANIFEST.json.citation_integrity.verification_status = verified (current: ${citationIntegrity.verificationStatus})`
            );
          }
          if (
            citationIntegrity.unresolvedPlaceholderCount >
            citationIntegrity.allowedPlaceholderCount
          ) {
            missing.push(
              `citation placeholders <= ${citationIntegrity.allowedPlaceholderCount} (current: ${citationIntegrity.unresolvedPlaceholderCount})`
            );
          }
          if (citationIntegrity.hallucinatedCitationCount > 0) {
            missing.push(
              `citation hallucinations = 0 (current: ${citationIntegrity.hallucinatedCitationCount})`
            );
          }
          if (!verificationReportPath || !(await pathExists(verificationReportPath))) {
            missing.push(
              `{PROJ}/${citationIntegrity.verificationReportPath ?? DEFAULT_CITATION_REPORT_PATH}`
            );
          }
          if (!bibliographyPath || !(await pathExists(bibliographyPath))) {
            missing.push(
              `{PROJ}/${citationIntegrity.bibliographyPath ?? DEFAULT_CITATION_BIB_PATH}`
            );
          }
        }
        if (!isExternalReviewConclusionReady(externalReview)) {
          missing.push(
            `PROJECT_MANIFEST.json.external_review_state must record a received Stanford review conclusion (current: status=${externalReview.status}, recommendation=${externalReview.overallRecommendation ?? "unset"})`
          );
        }
        if (!externalReviewPath || !(await pathExists(externalReviewPath))) {
          missing.push(
            `{PROJ}/${externalReview.externalReviewPath ?? "reviewer/external_review_{date}.md"}`
          );
        }
        if (!reviewResponsePath || !(await pathExists(reviewResponsePath))) {
          missing.push(
            `{PROJ}/${externalReview.reviewResponsePath ?? "reviewer/rebuttal_{date}.md"}`
          );
        }
      }
      if (!(await hasPrefixedFile(path.join(projectRoot, "reviewer"), "external_review_"))) {
        missing.push("{PROJ}/reviewer/external_review_{date}.md");
      }
      if (!(await hasPrefixedFile(path.join(projectRoot, "reviewer"), "rebuttal_"))) {
        missing.push("{PROJ}/reviewer/rebuttal_{date}.md");
      }
      break;
    default:
      break;
  }

  return missing;
}

function inboxForRole(params: {
  mailbox: WorkflowMailboxStore | null;
  role: WorkflowRole | null;
  limit: number;
}): WorkflowMailboxItem[] {
  if (!params.mailbox || !params.role) {
    return [];
  }
  return params.mailbox.messages
    .filter(
      (item) =>
        item.status === "pending" && (item.toAgent === params.role || item.toAgent === "*")
    )
    .sort((left, right) => {
      const leftPriority = left.priority === "high" ? 0 : left.priority === "normal" ? 1 : 2;
      const rightPriority = right.priority === "high" ? 0 : right.priority === "normal" ? 1 : 2;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.createdAt.localeCompare(right.createdAt);
    })
    .slice(0, params.limit);
}

function buildDynamicTasks(params: {
  role: WorkflowRole | null;
  currentStage: string | null;
  manifest: ManifestLike | null;
  missingStageSignals: string[];
  idleResearch: IdleResearchState;
  innovationReflection: InnovationReflectionState;
  innovationReflectionDue: boolean;
  writingContract: WritingContractState;
  writingTemplatePath: string | null;
  writingTemplateStatus: string;
  paragraphLogicStatus: string;
  writingContractPendingReason: string | null;
  citationIntegrity: CitationIntegrityState;
  citationReportPath: string | null;
  recentExperiments: ExperimentMemoryDigest[];
  unreadMailbox: WorkflowMailboxItem[];
  papernexusApiBaseUrl: string | null;
  papernexusApiTokenEnv: string | null;
  papernexusApiTokenSource: string | null;
  papernexusApiTokenService: string | null;
  papernexusApiTokenAccount: string | null;
  papernexusMineruHttpUrl: string | null;
}): string[] {
  if (!params.role) {
    return [];
  }

  const policy = ROLE_POLICIES[params.role];
  const tasks = [...policy.backgroundTasks];
  const paperIngestion = asRecord(params.manifest?.paper_ingestion);
  const paperIngestionState = normalizePaperIngestionState(paperIngestion);
  const experimentMemory = asRecord(params.manifest?.experiment_memory);
  const graphWatch = asRecord(params.manifest?.graph_watch);
  const nextAction = asString(params.manifest?.next_action);

  if (params.unreadMailbox.length > 0) {
    tasks.unshift("Read workflow mailbox first and acknowledge blocker/handoff items before new work.");
  }

  if (
    params.role === "researcher" &&
    (paperIngestion?.refresh_required === true ||
      (typeof paperIngestion?.new_files_since_graph === "number" &&
        paperIngestion.new_files_since_graph > 0))
  ) {
    tasks.unshift(
      "Shared PaperNexus graph reconciliation is pending; run /graph-build or /papernexus before the next novelty or planning decision."
    );
  }

  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "waiting_import") {
    tasks.unshift(
      `Paper ingestion is waiting on remote import completion${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Continue only bounded non-novelty work until the import tasks finish.`
    );
  }
  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "waiting_graph") {
    tasks.unshift(
      `Paper ingestion is waiting on shared-graph refresh${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Do not finalize novelty-sensitive reasoning until graph refresh completes.`
    );
  }
  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "reconciling") {
    tasks.unshift(
      `Paper ingestion is reconciling against a newer shared graph version${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Refresh the affected topic packets before advancing novelty-sensitive work.`
    );
  }

  const graphPresenceStatus = normalizeGraphPresenceStatus(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  if (
    params.role === "researcher" &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "") &&
    graphPresenceStatus !== null &&
    graphPresenceStatus !== "ready"
  ) {
    const missingSummary = summarizeGraphPresenceMissing(paperIngestion);
    tasks.unshift(
      `Graph presence is not ready (${graphPresenceStatus}); run research_workflow.check_graph_presence and reconcile the shared global graph via /graph-build before novelty-sensitive work${missingSummary ? ` (${missingSummary})` : ""}.`
    );
  }

  if (
    params.role === "researcher" &&
    (["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "") ||
      paperIngestion?.refresh_required === true) &&
    (params.papernexusApiBaseUrl ||
      params.papernexusApiTokenEnv ||
      params.papernexusMineruHttpUrl)
  ) {
    tasks.unshift(
      `Use the configured PaperNexus remote access for shared-graph work: api=${params.papernexusApiBaseUrl ?? "unset"}, token_source=${params.papernexusApiTokenSource ?? "unset"}, token_env=${params.papernexusApiTokenEnv ?? "unset"}, keychain_service=${params.papernexusApiTokenService ?? "unset"}, keychain_account=${params.papernexusApiTokenAccount ?? "unset"}, mineru_http=${params.papernexusMineruHttpUrl ?? "unset"}. Resolve the token at runtime only; do not paste secrets into chat, prompts, or project files.`
    );
    tasks.unshift(
      "Do not read the live shared graph through local `papernexus query/context/impact/ideas/brainstorm/...` CLI commands. In workflow mode, live-graph reads must use authenticated `/api/*` endpoints."
    );
  }

  if (
    params.role === "researcher" &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")
  ) {
    tasks.unshift(
      "For each novelty-sensitive topic, summarize the topic, call PaperNexus typed endpoints such as `research-brief`, `brainstorm-brief`, `ideas`, `path-trace`, `evidence-chain`, `reflection-chain`, `theory-brief`, and `storyline-brief`, and persist a reconciled chain bundle with research_workflow.run_brainstorm_cycle so logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet stay durable."
    );
    tasks.unshift(
      "Brainstorm cycle rule: you may run multiple brainstorm rounds with competing options, but in aggressive auto mode you must persist every candidate and let the highest-scoring option become the selected durable bundle."
    );
    tasks.unshift(
      "If new PDFs or Markdown arrive through a UI/API upload, use the queued PaperNexus import-task path (`/api/imports`) instead of manually copying files into the shared paper source tree."
    );
    tasks.unshift(
      "For ideation and frontier work, prefer the brainstorm-quality PaperNexus node view and typed API briefs/chains over raw full-graph inspection. Use `research-brief`, `brainstorm-brief`, `ideas`, `brainstorm`, and `path-trace` before trusting raw prominence."
    );
  }

  if (
    params.role === "researcher" &&
    params.currentStage === "plan" &&
    params.missingStageSignals.some((signal) => signal.includes("orchestrator"))
  ) {
    tasks.unshift(
      "PLAN handoff is incomplete; wake Orchestrator instead of jumping to CODE."
    );
  }

  if (
    params.role === "researcher" &&
    params.currentStage &&
    ["plan", "code", "experiment", "analyze", "review", "write"].includes(params.currentStage)
  ) {
    tasks.push(
      "While others work, continue coarse paper search, full-text acquisition, and graph-grounded novelty tracking."
    );
  }

  if (params.role === "researcher" && params.idleResearch.enabled && params.idleResearch.topic) {
    if (isIdleResearchDue(params.idleResearch)) {
      tasks.unshift(
        `Idle research topic is due: run /idle-research for "${params.idleResearch.topic}" and stay within ${params.idleResearch.maxPapersPerCycle} papers this round.`
      );
    } else {
      const nextDueAt = computeIdleResearchNextDueAt(params.idleResearch);
      tasks.unshift(
        `Idle research topic is configured for "${params.idleResearch.topic}". Respect cooldown until ${nextDueAt ?? "the next allowed round"} unless a new durable blocker changes the request.`
      );
    }
  }

  if (
    params.role === "researcher" &&
    params.innovationReflectionDue
  ) {
    tasks.unshift(
      "Experiment-informed innovation reflection is due; run /innovation-reflection before proposing new tracks or locking IDEA_REPORT.md."
    );
  } else if (
    params.role === "researcher" &&
    params.innovationReflection.lastReflectionPath
  ) {
    tasks.push(
      `Reuse the latest experiment-informed reflection at ${params.innovationReflection.lastReflectionPath} when brainstorming the next innovation angle.`
    );
  }

  if (
    params.role === "researcher" &&
    (params.currentStage === "experiment" ||
      experimentMemory?.papernexus_sync_required === true ||
      params.recentExperiments.length > 0)
  ) {
    tasks.unshift(
      "Keep EXPERIMENT_LEDGER.json current after every queue/launch/result/decision milestone, and sync high-value runs into PaperNexus when idle."
    );
  }

  if (params.role === "researcher" && params.currentStage === "experiment") {
    tasks.unshift(
      "Resource-aware experiment rule: inspect server GPU memory/utilization, host RAM, and active screens first; then launch independent bundles in parallel up to safe capacity and queue the remainder."
    );
    tasks.unshift(
      "Scheduling rule: treat same method across multiple datasets, baseline vs proposed, and independent seeds as parallel candidates unless a dependency or memory limit forces serialization."
    );
  }

  if (
    params.currentStage === "experiment" &&
    params.recentExperiments.length === 0
  ) {
    tasks.unshift(
      "Before planning reruns or fixes, inspect research_workflow.get_experiment_memory so you do not repeat an already tried configuration."
    );
  }

  if (
    params.role === "researcher" &&
    asString(graphWatch?.status) === "unknown" &&
    asString(params.manifest?.paper_source_dir)
  ) {
    tasks.push("If graph watch/status is stale, inspect corpus freshness before the next gate.");
  }

  if (params.role !== "researcher" && nextAction) {
    tasks.push(`Stay aligned with manifest next_action: ${nextAction}`);
  }

  if (
    params.role === "researcher" &&
    params.currentStage === "write" &&
    params.writingContract.templateRequired &&
    params.writingTemplateStatus === "missing"
  ) {
    tasks.unshift(
      "Writer cannot start safely because the required writing template is missing; restore it with research_workflow.set_writing_contract before waking Academic Writer."
    );
  }

  if (params.role === "academic_writer") {
    if (params.writingContract.paperMode) {
      tasks.unshift(
        `Honor writing mode ${params.writingContract.paperMode}: body=${params.writingContract.bodyPageBudget ?? "unset"} pages, refs=${params.writingContract.referencePageBudget ?? "unset"} pages, body_words=${params.writingContract.bodyWordTargetMin ?? "unset"}-${params.writingContract.bodyWordTargetMax ?? "unset"}.`
      );
    }
    if (
      params.writingContract.templateRequired &&
      params.writingTemplateStatus === "missing"
    ) {
      tasks.unshift(
        "Writing template is required but missing; restore it through research_workflow.set_writing_contract before editing PAPER_PLAN.md or paper sections."
      );
    } else if (params.writingTemplatePath) {
      tasks.unshift(
        `Read the writing template at ${params.writingTemplatePath} before changing PAPER_PLAN.md or drafting a new section.`
      );
    }
    if (params.writingContract.kgStorylineRequired) {
      tasks.unshift(
        `Use the KG storyline packet at ${params.writingContract.kgStorylinePacketPath ?? DEFAULT_KG_STORYLINE_PACKET_PATH} to keep a single thesis, gap, method, and evidence spine.`
      );
      if (params.writingContract.kgStorylineStatus !== "ready") {
        tasks.push(
          "KG storyline packet is not ready yet; finish the knowledge-graph storyline contract before broadening the prose."
        );
      }
    }
    if (params.writingContract.templateMappingPath) {
      tasks.push(
        `Keep template adaptation notes aligned with ${params.writingContract.templateMappingPath}.`
      );
    }
    if (params.paragraphLogicStatus !== "green") {
      tasks.push(
        "Run a reverse-outline and paragraph-bridge audit before finalizing the current section; keep WRITING_SIGNALS.md visible."
      );
    }
    if (params.writingContractPendingReason) {
      tasks.push(`Writing contract pending: ${params.writingContractPendingReason}`);
    }
    if (params.citationIntegrity.enabled) {
      tasks.push(
        `Citations must come from real sources of truth (${params.citationIntegrity.sourceOfTruth.join(", ")}). Keep placeholders <= ${params.citationIntegrity.allowedPlaceholderCount}.`
      );
    }
  }

  if (params.role === "coder" && params.currentStage === "experiment") {
    tasks.unshift(
      "If the assigned packet includes multiple independent experiment bundles, use the current resource check to launch several in parallel, typically one GPU per bundle unless the packet specifies a different packing policy."
    );
    tasks.unshift(
      "When a launch fails from resource pressure, prefer bounded runtime fixes such as lower batch size, higher grad accumulation, or fewer workers, and record the adjustment instead of silently changing experiment meaning."
    );
  }

  if (
    params.role === "reviewer" &&
    (params.currentStage === "submit" || params.currentStage === "write") &&
    params.citationIntegrity.enabled &&
    params.citationIntegrity.verificationRequired
  ) {
    tasks.unshift(
      `Run the citation integrity gate before submission and update ${params.citationReportPath ?? DEFAULT_CITATION_REPORT_PATH}.`
    );
    if (params.citationIntegrity.verificationStatus !== "verified") {
      tasks.push(
        `Citation verification is ${params.citationIntegrity.verificationStatus}; do not finalize submission until it becomes verified.`
      );
    }
  }

  return uniqueStrings(tasks);
}

export function getWorkflowGuardPolicy(
  config: Record<string, unknown> | undefined
): Required<WorkflowGuardPolicy> {
  return normalizePolicy(config);
}

export async function buildWorkflowSnapshot(params: {
  policy: WorkflowGuardPolicy;
  agentId?: string;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
}): Promise<WorkflowSnapshot> {
  const policy = normalizePolicy(params.policy as Record<string, unknown>);
  const projectState = await loadProjectState({
    policy,
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    messageChannel: params.messageChannel,
    channelKey: params.channelKey,
  });
  const role = normalizeRole(params.agentId);
  const currentStage = normalizeStage(projectState.manifest?.current_stage);
  const missingStageSignals =
    projectState.projectRoot && currentStage
      ? await getMissingStageSignals({
          projectRoot: projectState.projectRoot,
          manifest: projectState.manifest,
          trackRegistry: projectState.trackRegistry,
          experimentLedger: projectState.experimentLedger,
          currentStage,
        })
      : [];
  const unreadMailbox = inboxForRole({
    mailbox: projectState.mailbox,
    role,
    limit: policy.maxWorkflowInboxMessages,
  });
  const paperIngestion = asRecord(projectState.manifest?.paper_ingestion);
  const paperIngestionState = normalizePaperIngestionState(paperIngestion);
  const experimentMemory = asRecord(projectState.manifest?.experiment_memory);
  const idleResearch = normalizeIdleResearchState(
    asRecord(projectState.manifest?.idle_research)
  );
  const innovationReflection = normalizeInnovationReflectionState(
    asRecord(projectState.manifest?.innovation_reflection)
  );
  const brainstormCycle = normalizeBrainstormCycleState(
    asRecord(projectState.manifest?.brainstorm_cycle)
  );
  const experimentSearch = projectState.projectRoot
    ? await loadExperimentSearchState({
        projectRoot: projectState.projectRoot,
        manifest: projectState.manifest,
      })
    : normalizeExperimentSearchState(asRecord(projectState.manifest?.experiment_search));
  const researchProgram = normalizeResearchProgramState(
    asRecord(projectState.manifest?.research_program)
  );
  const orchestrationState = normalizeOrchestrationState(
    asRecord(projectState.manifest?.orchestration_state)
  );
  const writePackage = normalizeWritePackageState(
    asRecord(projectState.manifest?.write_package)
  );
  const theorySupport = normalizeTheorySupportState(
    asRecord(projectState.manifest?.theory_state)
  );
  const writingContract = normalizeWritingContractState(
    asRecord(projectState.manifest?.writing_contract)
  );
  const citationIntegrity = normalizeCitationIntegrityState(
    asRecord(projectState.manifest?.citation_integrity)
  );
  const writingSession = normalizeWritingSessionState(
    asRecord(projectState.manifest?.writing_session)
  );
  const reviewSession = normalizeReviewSessionState(
    asRecord(projectState.manifest?.review_session)
  );
  const graphGuidedWriting = normalizeGraphGuidedWritingState(
    asRecord(projectState.manifest?.graph_guided_writing)
  );
  const paperQc = normalizePaperQcState(asRecord(projectState.manifest?.paper_qc));
  const figureQc = normalizeFigureQcState(asRecord(projectState.manifest?.figure_qc));
  const citationCollection = normalizeCitationCollectionState(
    asRecord(projectState.manifest?.citation_collection)
  );
  const reviewIssueTracker = projectState.projectRoot
    ? await hydrateReviewIssueTrackerState({
        projectRoot: projectState.projectRoot,
        value: asRecord(projectState.manifest?.review_issue_tracker),
      })
    : normalizeReviewIssueTrackerState(
        asRecord(projectState.manifest?.review_issue_tracker)
      );
  const externalReview = normalizeExternalReviewState(
    asRecord(projectState.manifest?.external_review_state)
  );
  const reviewIssueLaneCounts = countReviewIssueLanes(reviewIssueTracker.issues);
  const recommendedOwner = currentStage ? STAGE_REQUIREMENTS[currentStage]?.owner ?? null : null;
  const recentExperiments = buildExperimentMemoryDigest(projectState.experimentLedger, 5);
  const experimentSyncRequired =
    projectState.experimentLedger?.summary.papernexusSyncRequired === true ||
    experimentMemory?.papernexus_sync_required === true;
  const experimentPapernexusSyncStatus =
    asString(experimentMemory?.papernexus_sync_status) ??
    (projectState.experimentLedger?.summary.papernexusSyncRequired
      ? "pending"
      : projectState.experimentLedger?.summary.papernexusLastSyncAt
        ? "synced"
        : null);
  const innovationReflectionDue = isInnovationReflectionDue({
    state: innovationReflection,
    ledger: projectState.experimentLedger,
  });
  const writingContractEval = await evaluateWritingContractState({
    projectRoot: projectState.projectRoot,
    state: writingContract,
  });
  const resolvedCitationBibliographyPath = resolveProjectArtifactPath(
    projectState.projectRoot,
    citationIntegrity.bibliographyPath
  );
  const resolvedCitationReportPath = resolveProjectArtifactPath(
    projectState.projectRoot,
    citationIntegrity.verificationReportPath
  );
  const defaultPapernexusSourceDir = getDefaultPapernexusSourceDir(projectState.projectId);
  const resolvedPaperSourceDir = asString(projectState.manifest?.paper_source_dir) ?? null;
  const resolvedGraphSourceDir = asString(projectState.manifest?.graph_source_dir) ?? null;
  const papernexusAccessConfigured =
    (policy.papernexusApiBaseUrl ?? "").trim().length > 0 ||
    (policy.papernexusApiTokenEnv ?? "").trim().length > 0 ||
    (policy.papernexusMineruHttpUrl ?? "").trim().length > 0 ||
    normalizePapernexusApiTokenSource(policy.papernexusApiTokenSource) !==
      DEFAULT_POLICY.papernexusApiTokenSource ||
    ((policy.papernexusApiTokenService ?? "").trim().length > 0 &&
      (policy.papernexusApiTokenService ?? "").trim() !==
        DEFAULT_POLICY.papernexusApiTokenService) ||
    ((policy.papernexusApiTokenAccount ?? "").trim().length > 0 &&
      (policy.papernexusApiTokenAccount ?? "").trim() !==
        DEFAULT_POLICY.papernexusApiTokenAccount);
  const papernexusAccess = papernexusAccessConfigured
    ? summarizePapernexusRemoteAccessConfig({
        apiBaseUrl: policy.papernexusApiBaseUrl,
        tokenEnv: policy.papernexusApiTokenEnv,
        tokenSource: policy.papernexusApiTokenSource,
        tokenService: policy.papernexusApiTokenService,
        tokenAccount: policy.papernexusApiTokenAccount,
        mineruHttpUrl: policy.papernexusMineruHttpUrl,
        tokenLookupTimeoutMs: policy.papernexusApiTokenLookupTimeoutMs,
      })
    : null;

  return {
    projectRoot: projectState.projectRoot,
    projectId: projectState.projectId,
    projectResolutionSource: projectState.projectResolutionSource,
    channelProjectBindingsEnabled: policy.enableChannelProjectBindings,
    channelProjectBindingKey: projectState.channelBindingKey,
    channelProjectBindingStorePath: projectState.channelBindingStorePath,
    role,
    currentStage,
    currentMicroStage: normalizeStage(projectState.manifest?.current_micro_stage),
    ownerAgent: asString(projectState.manifest?.owner_agent),
    recommendedOwner,
    nextAction: asString(projectState.manifest?.next_action),
    resumeAction: asString(projectState.manifest?.resume_action),
    blockingReason: asString(projectState.manifest?.blocking_reason),
    allowedWriteScopes: role ? ROLE_POLICIES[role].writeScopeLabels : [],
    allowedContacts: role ? ROLE_POLICIES[role].allowedContacts : [],
    allowedSpawns: role ? ROLE_POLICIES[role].allowedSpawns : [],
    missingStageSignals,
    graphRefreshRequired: paperIngestion?.refresh_required === true,
    graphRefreshReason: asString(paperIngestion?.refresh_reason),
    graphLastBuiltAt: asString(projectState.manifest?.graph_last_built_at),
    graphPresenceCheckedAt: asString(paperIngestion?.graph_presence_checked_at),
    graphPresenceStatus: normalizeGraphPresenceStatus(
      paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
    ),
    graphPresenceReportPath: asString(
      paperIngestion?.graph_presence_report_path ?? paperIngestion?.graphPresenceReportPath
    ),
    graphPresenceExpectedPapers: pickNumber(paperIngestion ?? {}, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
    ]),
    graphPresencePresentPapers: pickNumber(paperIngestion ?? {}, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
    ]),
    graphPresenceMissingPapers:
      getGraphPresenceMissingEntries(paperIngestion).length ||
      pickNumber(paperIngestion ?? {}, [
        "graph_presence_missing_count",
        "graphPresenceMissingCount",
      ]),
    paperIngestionRuntimeStatus: paperIngestionState.runtimeStatus,
    paperIngestionWaitingReason: paperIngestionState.waitingReason,
    paperIngestionImportTaskCount: paperIngestionState.importTaskIds.length,
    paperIngestionLastImportStatus: paperIngestionState.lastImportStatus,
    paperIngestionGraphVersionSeen: paperIngestionState.graphVersionSeen,
    paperIngestionReconcileRequired: paperIngestionState.reconcileRequired,
    paperSourceDir: resolvedPaperSourceDir,
    graphSourceDir: resolvedGraphSourceDir,
    defaultPapernexusSourceDir,
    defaultPapernexusIndexRoot: getDefaultPapernexusIndexRoot(),
    papernexusApiBaseUrl: papernexusAccess?.apiBaseUrl ?? null,
    papernexusApiTokenEnv: papernexusAccess?.tokenEnv ?? null,
    papernexusApiTokenSource: papernexusAccess?.tokenSourceConfigured ?? null,
    papernexusApiTokenService: papernexusAccess?.tokenService ?? null,
    papernexusApiTokenAccount: papernexusAccess?.tokenAccount ?? null,
    papernexusMineruHttpUrl: papernexusAccess?.mineruHttpUrl ?? null,
    idleResearchEnabled: idleResearch.enabled,
    idleResearchTopic: idleResearch.topic,
    idleResearchStatus: idleResearch.status,
    idleResearchDue: isIdleResearchDue(idleResearch),
    idleResearchCooldownMinutes: idleResearch.cooldownMinutes,
    idleResearchLastRunAt: idleResearch.lastRunAt,
    idleResearchNextDueAt: computeIdleResearchNextDueAt(idleResearch),
    idleResearchDigestPath: idleResearch.lastDigestPath,
    experimentLedgerPath: projectState.projectRoot
      ? "researcher/EXPERIMENT_LEDGER.json"
      : null,
    experimentLedgerUpdatedAt:
      projectState.experimentLedger?.updatedAt ??
      asString(experimentMemory?.last_ledger_update_at),
    experimentSyncRequired,
    experimentPapernexusSyncStatus,
    innovationReflectionStatus: innovationReflection.status,
    innovationReflectionDue,
    innovationReflectionLastAt: innovationReflection.lastReflectionAt,
    innovationReflectionPath: innovationReflection.lastReflectionPath,
    innovationReflectionPendingReason: innovationReflection.pendingReason,
    brainstormCycleStatus: brainstormCycle.status,
    brainstormCycleTopic: brainstormCycle.topic,
    brainstormCycleBasisStage: brainstormCycle.basisStage,
    brainstormCycleTrackId: brainstormCycle.trackId,
    brainstormCycleGraphVersionSeen: brainstormCycle.graphVersionSeen,
    brainstormCycleImportTaskCount: brainstormCycle.importTaskIdsSeen.length,
    brainstormCycleChainBundleReady:
      isBrainstormCycleReady(brainstormCycle) &&
      getBrainstormCycleValidationErrors(brainstormCycle).length === 0,
    brainstormCyclePendingReason: brainstormCycle.pendingReason,
    researchProgramStatus: researchProgram.status,
    researchProgramTrackCount: researchProgram.tracks.length,
    researchProgramActiveTrackCount: researchProgram.tracks.filter(
      (track) => normalizeStage(track.status) === "active"
    ).length,
    researchProgramPrimaryGoal: researchProgram.goal,
    orchestrationStatus: orchestrationState.status,
    orchestrationBlockingCategory: orchestrationState.blockingCategory,
    orchestrationNextTransitionCandidate:
      orchestrationState.nextTransitionCandidate,
    orchestrationRetryBudgetRemaining:
      orchestrationState.retryBudgetRemaining,
    orchestrationRollbackTargetStage: orchestrationState.rollbackTargetStage,
    experimentSearchStatus: experimentSearch.status,
    experimentSearchCurrentMainStage: experimentSearch.currentMainStage,
    experimentSearchCurrentSubstage: experimentSearch.currentSubstage,
    experimentSearchBestNodeId: experimentSearch.bestNodeId,
    experimentSearchMultiSeedStatus: experimentSearch.multiSeedStatus,
    experimentSearchPlotPackStatus: experimentSearch.plotPackStatus,
    writePackageStatus: writePackage.status,
    writePackageAssemblyStatus: writePackage.assemblyStatus,
    writePackageAssemblyMode: writePackage.assemblyMode,
    writePackageWinningTrackCount: writePackage.winningTrackIds.length,
    writePackageDerivedArtifactCount: writePackage.derivedArtifactCount,
    writePackagePendingReason: writePackage.pendingReason,
    theorySupportStatus: theorySupport.status,
    theorySupportSignal: theorySupport.overallSignal,
    theoryStatePath: theorySupport.theoryStatePath,
    theoryProofPacketDir: theorySupport.proofPacketDir,
    theoryAppendixPacketPath: theorySupport.appendixPacketPath,
    theoryPacketCount: theorySupport.proofPacketCount,
    theoryBodyReady: theorySupport.bodyReady,
    theoryPendingReason: theorySupport.pendingReason,
    writingTemplateRequired: writingContract.templateRequired,
    writingPaperMode: writingContract.paperMode,
    writingBodyPageBudget: writingContract.bodyPageBudget,
    writingReferencePageBudget: writingContract.referencePageBudget,
    writingBodyWordTargetMin: writingContract.bodyWordTargetMin,
    writingBodyWordTargetMax: writingContract.bodyWordTargetMax,
    writingMaxCoreIdeas: writingContract.maxCoreIdeas,
    writingMaxHeadlineClaims: writingContract.maxHeadlineClaims,
    writingTemplatePath: writingContractEval.templateResolvedPath,
    writingProjectTemplatePath: writingContractEval.projectTemplateResolvedPath,
    writingTemplateStatus: writingContractEval.templateStatus,
    writingTemplateCopyStatus: writingContractEval.templateCopyStatus,
    writingTemplateMappingPath: writingContract.templateMappingPath,
    mainTextProofStyle: writingContract.mainTextProofStyle,
    proofAppendixRequired: writingContract.proofAppendixRequired,
    proofAppendixPath: writingContract.proofAppendixPath,
    proofAppendixStatus: writingContract.proofAppendixStatus,
    theoryNotePath: writingContract.theoryNotePath,
    proofChecklist: writingContract.proofChecklist,
    kgStorylineRequired: writingContract.kgStorylineRequired,
    kgStorylineStatus: writingContract.kgStorylineStatus,
    kgStorylinePacketPath: writingContract.kgStorylinePacketPath,
    storylineSource: writingContract.storylineSource,
    storylineChecklist: writingContract.storylineChecklist,
    writingRequiredSections: writingContract.requiredSections,
    writingSectionOrder: writingContract.sectionOrder,
    paragraphLogicStatus: writingContract.paragraphLogicStatus,
    paragraphLogicChecklist: writingContract.paragraphLogicChecklist,
    writingContractPendingReason:
      writingContractEval.pendingReason ?? writingContract.pendingReason,
    citationVerificationRequired:
      citationIntegrity.enabled && citationIntegrity.verificationRequired,
    citationVerificationStatus: citationIntegrity.verificationStatus,
    citationVerificationReportPath: resolvedCitationReportPath,
    citationBibliographyPath: resolvedCitationBibliographyPath,
    citationSourceOfTruth: citationIntegrity.sourceOfTruth,
    citationUnresolvedPlaceholderCount: citationIntegrity.unresolvedPlaceholderCount,
    citationAllowedPlaceholderCount: citationIntegrity.allowedPlaceholderCount,
    citationVerifiedCount: citationIntegrity.verifiedCitationCount,
    citationSuspiciousCount: citationIntegrity.suspiciousCitationCount,
    citationHallucinatedCount: citationIntegrity.hallucinatedCitationCount,
    citationPendingReason: citationIntegrity.pendingReason,
    citationCollectionStatus: citationCollection.status,
    citationCollectionCandidateCount: citationCollection.candidateCount,
    citationCollectionVerifiedCount: citationCollection.verifiedCount,
    citationCollectionSuspiciousCount: citationCollection.suspiciousCount,
    citationCollectionHallucinatedCount: citationCollection.hallucinatedCount,
    writingSessionStatus: writingSession.status,
    writingCurrentSection: writingSession.currentSection,
    writingDraftOrder: writingSession.draftOrder,
    writingFinalizedSections: writingSession.finalizedSections,
    writingCompileSafeSections: writingSession.compileSafeSections,
    writingSectionPacketsReady: areWritingSectionPacketsReady(writingSession),
    writingCurrentSectionReviewVerdict: writingSession.currentSection
      ? writingSession.sectionPackets[writingSession.currentSection]?.reviewVerdict ?? null
      : null,
    writingGraphEvidenceCoverageStatus: writingSession.graphEvidenceCoverageStatus,
    writingGraphEvidenceCoverageSummary: writingSession.graphEvidenceCoverageSummary,
    reviewSessionStatus: reviewSession.status,
    reviewSessionStageScope: reviewSession.stageScope,
    reviewSessionRound: reviewSession.round,
    reviewSessionVerdict: reviewSession.verdict,
    reviewSessionSummary: reviewSession.reviewerSummary,
    reviewRubricSummary: {
      originality: reviewSession.rubric.originality,
      quality: reviewSession.rubric.quality,
      clarity: reviewSession.rubric.clarity,
      significance: reviewSession.rubric.significance,
      soundness: reviewSession.rubric.soundness,
      citationIntegrity: reviewSession.rubric.citationIntegrity,
      graphGroundedEvidenceSufficiency:
        reviewSession.rubric.graphGroundedEvidenceSufficiency,
    },
    graphGuidedWritingStatus: graphGuidedWriting.status,
    graphGuidedWritingEvidenceCoverageStatus:
      graphGuidedWriting.evidenceCoverageStatus,
    graphGuidedWritingMissingEvidenceClaims:
      graphGuidedWriting.missingEvidenceClaims,
    graphGuidedWritingScholarReserved:
      graphGuidedWriting.scholarQueryReserved,
    graphGuidedWritingScholarSkillSlot:
      graphGuidedWriting.scholarQuerySkillSlot,
    paperQcStatus: paperQc.status,
    paperQcCompileStatus: paperQc.compileStatus,
    paperQcChktexStatus: paperQc.chktexStatus,
    paperQcPageBudgetStatus: paperQc.pageBudgetStatus,
    figureQcStatus: figureQc.status,
    figureQcDuplicateFigureStatus: figureQc.duplicateFigureStatus,
    figureQcCaptionAlignmentStatus: figureQc.captionAlignmentStatus,
    figureQcTextAlignmentStatus: figureQc.textAlignmentStatus,
    figureQcSelectionStatus: figureQc.selectionStatus,
    reviewIssueTrackerStatus: reviewIssueTracker.status,
    reviewIssueCriticalCount: reviewIssueTracker.openCounts.critical,
    reviewIssueHighCount: reviewIssueTracker.openCounts.high,
    reviewIssueMediumCount: reviewIssueTracker.openCounts.medium,
    reviewIssueLowCount: reviewIssueTracker.openCounts.low,
    reviewIssueSurfaceCount: reviewIssueLaneCounts.surface,
    reviewIssueSubmissionCount: reviewIssueLaneCounts.submission,
    externalReviewStatus: externalReview.status,
    externalReviewRecommendation: externalReview.overallRecommendation,
    externalReviewRequiredAction: externalReview.requiredAction,
    recentExperiments,
    unreadMailbox,
    backgroundTasks: buildDynamicTasks({
      role,
      currentStage,
      manifest: projectState.manifest,
      missingStageSignals,
      idleResearch,
      innovationReflection,
      innovationReflectionDue,
      writingContract,
      writingTemplatePath: writingContractEval.templateResolvedPath,
      writingTemplateStatus: writingContractEval.templateStatus,
      paragraphLogicStatus: writingContract.paragraphLogicStatus,
      writingContractPendingReason:
        writingContractEval.pendingReason ?? writingContract.pendingReason,
      citationIntegrity,
      citationReportPath: resolvedCitationReportPath,
      recentExperiments,
      unreadMailbox,
      papernexusApiBaseUrl: papernexusAccess?.apiBaseUrl ?? null,
      papernexusApiTokenEnv: papernexusAccess?.tokenEnv ?? null,
      papernexusApiTokenSource: papernexusAccess?.tokenSourceConfigured ?? null,
      papernexusApiTokenService: papernexusAccess?.tokenService ?? null,
      papernexusApiTokenAccount: papernexusAccess?.tokenAccount ?? null,
      papernexusMineruHttpUrl: papernexusAccess?.mineruHttpUrl ?? null,
    }),
  };
}

export function buildFocusedPromptAssembly(params: {
  snapshot: Partial<WorkflowSnapshot>;
}): FocusedPromptAssembly {
  const snapshot = params.snapshot;
  const sectionContextId =
    normalizeStage(snapshot.writingCurrentSection ?? null) ??
    normalizeStage(snapshot.currentStage ?? null);
  const reviewLane =
    (snapshot.reviewIssueSurfaceCount ?? 0) > 0
      ? "surface"
      : (snapshot.reviewIssueSubmissionCount ?? 0) > 0
        ? "submission"
        : snapshot.role === "reviewer" || snapshot.role === "cross-reviewer"
          ? "evidence"
          : null;
  const roundId =
    typeof snapshot.reviewSessionRound === "number" && snapshot.reviewSessionRound > 0
      ? `review-round-${snapshot.reviewSessionRound}`
      : null;
  const layer1Lines = [
    "Layer 1: Stable Policy",
    `Role=${snapshot.role ?? "unknown"}`,
    `Owner=${snapshot.recommendedOwner ?? snapshot.ownerAgent ?? "unset"}`,
    "Do only the owner-scoped task for this round.",
    "Do not widen scope or replay the entire workflow history.",
  ];
  if (shouldApplySharedWritingConstitution(snapshot)) {
    layer1Lines.push(...getSharedWritingConstitutionLines(snapshot.role ?? null));
  }
  const layer1 = layer1Lines.join("\n");
  const layer2 = [
    "Layer 2: Stage-Local Control State",
    `Stage=${snapshot.currentStage ?? "unknown"}/${snapshot.currentMicroStage ?? "unknown"}`,
    `next_action=${snapshot.nextAction ?? "unset"}`,
    `blocking_reason=${snapshot.blockingReason ?? "none"}`,
    `missing_signals=${(snapshot.missingStageSignals ?? []).slice(0, 4).join("; ") || "none"}`,
    `orchestration=${snapshot.orchestrationStatus ?? "unknown"} -> ${snapshot.orchestrationNextTransitionCandidate ?? "unset"}`,
  ].join("\n");
  const layer3 = [
    "Layer 3: Primary Payload",
    `section_context=${sectionContextId ?? "unset"}`,
    `writing_status=${snapshot.writingSessionStatus ?? "unknown"}`,
    `brainstorm_cycle=${snapshot.brainstormCycleStatus ?? "unknown"} topic=${snapshot.brainstormCycleTopic ?? "unset"} chain_bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`,
    `paper_ingestion=${snapshot.paperIngestionRuntimeStatus ?? "unknown"} import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0} reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`,
    `section_review=${snapshot.writingCurrentSectionReviewVerdict ?? "unknown"}`,
    `write_package=${snapshot.writePackageStatus ?? "unknown"}/${snapshot.writePackageAssemblyStatus ?? "unknown"} mode=${snapshot.writePackageAssemblyMode ?? "unset"} derived=${snapshot.writePackageDerivedArtifactCount ?? 0}`,
    `review_lane=${reviewLane ?? "unset"}`,
  ].join("\n");
  const layer4 = [
    "Layer 4: Supporting Evidence",
    `graph_coverage=${snapshot.writingGraphEvidenceCoverageStatus ?? snapshot.graphGuidedWritingEvidenceCoverageStatus ?? "unknown"}`,
    `review_issues=critical:${snapshot.reviewIssueCriticalCount ?? 0}, high:${snapshot.reviewIssueHighCount ?? 0}, medium:${snapshot.reviewIssueMediumCount ?? 0}`,
    `paper_qc=${snapshot.paperQcStatus ?? "unknown"} compile:${snapshot.paperQcCompileStatus ?? "unknown"} page:${snapshot.paperQcPageBudgetStatus ?? "unknown"}`,
    `figure_qc=caption:${snapshot.figureQcCaptionAlignmentStatus ?? "unknown"} text:${snapshot.figureQcTextAlignmentStatus ?? "unknown"}`,
  ].join("\n");
  const layer5 = [
    "Layer 5: Reflection Delta",
    `round_id=${roundId ?? "none"}`,
    `review_verdict=${snapshot.reviewSessionVerdict ?? "unknown"}`,
    `review_summary=${snapshot.reviewSessionSummary ?? "none"}`,
  ].join("\n");
  const text = [
    "[Workflow Guard]",
    layer1,
    layer2,
    layer3,
    layer4,
    layer5,
    "[/Workflow Guard]",
  ].join("\n");
  return {
    text,
    metadata: {
      sectionContextId,
      reviewLane,
      roundId,
      promptLayerProfile: {
        stable_policy: true,
        stage_local_state: true,
        primary_payload: true,
        supporting_evidence: true,
        reflection_delta: true,
      },
      promptPayloadSizes: {
        stable_policy: layer1.length,
        stage_local_state: layer2.length,
        primary_payload: layer3.length,
        supporting_evidence: layer4.length,
        reflection_delta: layer5.length,
      },
    },
  };
}

function shouldApplySharedWritingConstitution(snapshot: Partial<WorkflowSnapshot>): boolean {
  const role = snapshot.role ?? null;
  const stage = normalizeStage(snapshot.currentStage ?? null);
  return (
    role === "academic_writer" ||
    role === "reviewer" ||
    role === "cross-reviewer" ||
    stage === "write" ||
    stage === "review"
  );
}

function getSharedWritingConstitutionLines(role: string | null): string[] {
  const lines = [
    "Shared writing constitution: final paper prose must read as a cohesive academic narrative, not as a pile of isolated facts or bullet dumps.",
    "Shared writing constitution: maintain formal academic tone, precise terminology, and consistent terminology across the manuscript.",
    "Shared writing constitution: use proper paragraphs in manuscript prose unless the task explicitly asks for an outline or checklist.",
    "Shared writing constitution: one paragraph = one message; the first sentence should state the paragraph role or topic sentence.",
    "Shared writing constitution: each paragraph should build on the previous one with smooth transitions and explicit sentence relations such as cause, contrast, consequence, refinement, or example.",
    "Shared writing constitution: define terms before reuse, preserve meaning and hedging during revision, and integrate evidence into the narrative instead of listing disconnected facts.",
  ];
  if (role === "reviewer" || role === "cross-reviewer") {
    lines.push(
      "Shared writing constitution review rule: review against the shared writing constitution. Flag broken topic sentences, weak paragraph-to-paragraph flow, terminology drift, unsupported transitions, and bullet-dump prose."
    );
  } else {
    lines.push(
      "Shared writing constitution execution rule: draft and revise until the prose satisfies the shared writing constitution, and bridge to the next paragraph or section whenever possible."
    );
  }
  return lines;
}

export function formatWorkflowSnapshotForPrompt(params: {
  snapshot: WorkflowSnapshot;
  trigger?: string;
  detailLevel?: "full" | "focused";
}): string {
  const { snapshot, trigger } = params;
  if ((params.detailLevel ?? "full") === "focused") {
    return buildFocusedPromptAssembly({ snapshot }).text;
  }
  const lines: string[] = [];
  lines.push("[Workflow Guard]");
  lines.push(`Agent role: ${snapshot.role ?? "unknown"}`);
  lines.push(`Project: ${snapshot.projectId ?? "unset"}`);
  lines.push(
    `Project resolution: ${snapshot.projectResolutionSource}${snapshot.channelProjectBindingsEnabled ? `, channel_binding_key=${snapshot.channelProjectBindingKey ?? "unset"}` : ""}`
  );
  lines.push(`Stage: ${snapshot.currentStage ?? "unknown"} / ${snapshot.currentMicroStage ?? "unknown"}`);
  lines.push(`Manifest owner: ${snapshot.ownerAgent ?? "unset"}`);
  if (snapshot.recommendedOwner) {
    lines.push(`Expected owner for this stage: ${snapshot.recommendedOwner}`);
  }
  if (snapshot.role && snapshot.recommendedOwner && snapshot.role !== snapshot.recommendedOwner) {
    lines.push(
      `Owner gate: you are not the stage owner. ${snapshot.recommendedOwner} must lead substantive ${snapshot.currentStage ?? "current-stage"} work.`
    );
    lines.push(
      `Non-owner rule: if the user asks you to continue this stage, do not perform the stage work yourself. Give a brief status update, then route or hand off the task to ${snapshot.recommendedOwner} via research_workflow.dispatch_task, sessions_send, or workflow mailbox.`
    );
    lines.push(
      "Non-owner response rule: you may summarize completed work, report current status, or handle bounded background tasks explicitly listed below, but you must not claim that you are now executing the owner-only phase."
    );
  } else if (snapshot.role && snapshot.recommendedOwner && snapshot.role === snapshot.recommendedOwner) {
    lines.push(
      `Owner gate: you are the responsible owner for ${snapshot.currentStage ?? "this stage"}. Produce the stage artifacts, keep durable state current, and hand off only after your outputs exist.`
    );
  }
  if (snapshot.nextAction) {
    lines.push(`next_action: ${snapshot.nextAction}`);
  }
  if (snapshot.resumeAction) {
    lines.push(`resume_action: ${snapshot.resumeAction}`);
  }
  if (snapshot.blockingReason) {
    lines.push(`blocking_reason: ${snapshot.blockingReason}`);
  }

  if (snapshot.allowedWriteScopes.length > 0) {
    lines.push("Allowed writes:");
    for (const scope of snapshot.allowedWriteScopes) {
      lines.push(`- ${scope}`);
    }
  }
  if (snapshot.role === "coder") {
    lines.push(
      "Coder dataset rule: dataset paths are read-only inputs. Read dataset_path values from the plan or manifest, but do not modify /data/datasets or any project dataset root through write/edit/bash. Put generated artifacts under {PROJ}/coder/, logs/, results/, or remote scratch."
    );
    lines.push(
      "Coder folder rule: organize bundles as coder/experiments/<track-id>/<experiment-id>__<slug>/, keep EXPERIMENT_MANIFEST.json inside each bundle, and keep coder/EXPERIMENT_INDEX.md updated so later runs stay attributable to the right project and track."
    );
    lines.push(
      "Coder execution rule: if Researcher assigns multiple independent bundles, inspect GPU/CPU/RAM usage first and launch as many in parallel as safe capacity allows instead of serializing everything onto one device."
    );
    lines.push(
      "Coder runtime-tuning rule: you may only make bounded execution fixes such as batch size, grad accumulation, num_workers, or eval frequency. Do not change the scientific question, dataset choice, metric, or model semantics without Researcher approval."
    );
  }

  if (snapshot.allowedContacts.length > 0 || snapshot.allowedSpawns.length > 0) {
    lines.push(
      `Allowed contacts: ${snapshot.allowedContacts.length > 0 ? snapshot.allowedContacts.join(", ") : "none"}`
    );
    lines.push(
      `Allowed spawns: ${snapshot.allowedSpawns.length > 0 ? snapshot.allowedSpawns.join(", ") : "none"}`
    );
  }

  lines.push(
    "Communication rule: do not use raw @agent mentions in Discord/chat. Status reports must use plain labels like [coder] / [researcher] / [writer]. Use sessions_send or research_workflow mailbox for real routing."
  );
  lines.push(
    "Contact cooldown rule: after routing work to another agent, do not ping the same target again immediately; wait for the workflow cooldown unless new durable state changes the request."
  );
  lines.push(
    "Stage completion rule: when your stage outputs are ready, call research_workflow.auto_iterator_tick before narrating or starting the next stage yourself, so owner routing and handoff happen deterministically."
  );
  if (snapshot.role === "researcher") {
    lines.push(
      'Auto iterator rule: before fresh stage work on heartbeat/recovery turns, call research_workflow with action "auto_iterator_tick" so stage reconciliation, owner routing, and PROJECTS_STATE sync happen deterministically.'
    );
    if (trigger === "heartbeat") {
      lines.push(
        'Heartbeat first step: call research_workflow {"action":"auto_iterator_tick","iterator":{"mode":"heartbeat"}} before any manual planning or ad hoc spawning.'
      );
    }
  }

  if (snapshot.missingStageSignals.length > 0) {
    lines.push("Missing stage signals:");
    for (const signal of snapshot.missingStageSignals.slice(0, 8)) {
      lines.push(`- ${signal}`);
    }
  }

  if (snapshot.graphRefreshRequired || snapshot.paperSourceDir || snapshot.graphSourceDir) {
    lines.push(
      `PaperNexus: paper_source=${snapshot.paperSourceDir ?? "unset"}, graph_source=${snapshot.graphSourceDir ?? "unset"}, refresh_required=${snapshot.graphRefreshRequired ? "true" : "false"}`
    );
    lines.push(
      `Graph presence: status=${snapshot.graphPresenceStatus ?? "unknown"}, checked_at=${snapshot.graphPresenceCheckedAt ?? "never"}, expected=${snapshot.graphPresenceExpectedPapers ?? "unknown"}, present=${snapshot.graphPresencePresentPapers ?? "unknown"}, missing=${snapshot.graphPresenceMissingPapers ?? "unknown"}`
    );
    if (snapshot.graphRefreshReason) {
      lines.push(`Graph refresh reason: ${snapshot.graphRefreshReason}`);
    }
    if (
      snapshot.paperIngestionRuntimeStatus &&
      snapshot.paperIngestionRuntimeStatus !== "idle"
    ) {
      lines.push(
        `Paper ingestion runtime: status=${snapshot.paperIngestionRuntimeStatus}, import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0}, last_import_status=${snapshot.paperIngestionLastImportStatus ?? "unknown"}, graph_version_seen=${snapshot.paperIngestionGraphVersionSeen ?? "unknown"}, reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`
      );
      if (snapshot.paperIngestionWaitingReason) {
        lines.push(`Paper ingestion waiting reason: ${snapshot.paperIngestionWaitingReason}`);
      }
    }
    if (snapshot.graphPresenceReportPath) {
      lines.push(`Graph presence report: ${snapshot.graphPresenceReportPath}`);
    }
    lines.push(
      `PaperNexus local defaults: papers=${snapshot.defaultPapernexusSourceDir ?? "unset"}, index=${snapshot.defaultPapernexusIndexRoot ?? "unset"}`
    );
    if (
      snapshot.papernexusApiBaseUrl ||
      snapshot.papernexusApiTokenEnv ||
      snapshot.papernexusApiTokenSource ||
      snapshot.papernexusApiTokenService ||
      snapshot.papernexusApiTokenAccount ||
      snapshot.papernexusMineruHttpUrl
    ) {
      lines.push(
        `PaperNexus remote access: api=${snapshot.papernexusApiBaseUrl ?? "unset"}, token_source=${snapshot.papernexusApiTokenSource ?? "unset"}, token_env=${snapshot.papernexusApiTokenEnv ?? "unset"}, keychain_service=${snapshot.papernexusApiTokenService ?? "unset"}, keychain_account=${snapshot.papernexusApiTokenAccount ?? "unset"}, mineru_http=${snapshot.papernexusMineruHttpUrl ?? "unset"}`
      );
      if (
        snapshot.papernexusApiBaseUrl &&
        snapshot.papernexusApiTokenSource === "env" &&
        snapshot.papernexusApiTokenEnv
      ) {
        lines.push(
          `Remote API rule: Use Authorization: Bearer from env ${snapshot.papernexusApiTokenEnv} for PaperNexus Web/API access at ${snapshot.papernexusApiBaseUrl}. Never print the raw token in chat, prompts, logs, or project files.`
        );
      } else if (
        snapshot.papernexusApiBaseUrl &&
        snapshot.papernexusApiTokenSource === "os_keychain"
      ) {
        lines.push(
          `Remote API rule: Resolve the PaperNexus bearer token from the native OS keychain entry service=${snapshot.papernexusApiTokenService ?? "unset"} account=${snapshot.papernexusApiTokenAccount ?? "unset"} before calling ${snapshot.papernexusApiBaseUrl}. Never print or persist the raw token.`
        );
      } else if (
        snapshot.papernexusApiBaseUrl &&
        snapshot.papernexusApiTokenSource === "auto"
      ) {
      lines.push(
          `Remote API rule: Resolve the PaperNexus bearer token in auto mode for ${snapshot.papernexusApiBaseUrl}: prefer env ${snapshot.papernexusApiTokenEnv ?? "unset"}, then fall back to native keychain service=${snapshot.papernexusApiTokenService ?? "unset"} account=${snapshot.papernexusApiTokenAccount ?? "unset"}. Never print or persist the raw token.`
      );
      lines.push(
        "Live graph rule: never use local `papernexus query/context/impact/ideas/brainstorm/...` CLI reads against the running shared graph; use authenticated `/api/*` endpoints instead."
      );
      } else if (snapshot.papernexusApiBaseUrl) {
        lines.push(
          `Remote API rule: prefer the configured PaperNexus Web/API endpoint at ${snapshot.papernexusApiBaseUrl} instead of assuming anonymous local access.`
        );
      }
      if (snapshot.papernexusMineruHttpUrl) {
        lines.push(
          `PDF parser rule: Prefer remote MinerU at ${snapshot.papernexusMineruHttpUrl} for PDF materialization. Do not switch to local Docling or Marker unless the remote endpoint is unavailable or the task explicitly requires a local parser.`
        );
      }
    }
  }

  lines.push(
    `Idle research: enabled=${snapshot.idleResearchEnabled ? "true" : "false"}, topic=${snapshot.idleResearchTopic ?? "unset"}, status=${snapshot.idleResearchStatus ?? "unknown"}, due=${snapshot.idleResearchDue ? "true" : "false"}`
  );
  if (snapshot.idleResearchCooldownMinutes !== null) {
    lines.push(
      `Idle research cooldown: ${snapshot.idleResearchCooldownMinutes}m, last_run=${snapshot.idleResearchLastRunAt ?? "never"}, next_due=${snapshot.idleResearchNextDueAt ?? "now"}`
    );
  }
  if (snapshot.idleResearchDigestPath) {
    lines.push(`Idle research last digest: ${snapshot.idleResearchDigestPath}`);
  }

  lines.push(
    `Experiment memory: ledger=${snapshot.experimentLedgerPath ?? "unset"}, updated=${snapshot.experimentLedgerUpdatedAt ?? "missing"}, papernexus_sync=${snapshot.experimentPapernexusSyncStatus ?? "unknown"}, sync_required=${snapshot.experimentSyncRequired ? "true" : "false"}`
  );
  lines.push(
    `Innovation reflection: status=${snapshot.innovationReflectionStatus ?? "unknown"}, due=${snapshot.innovationReflectionDue ? "true" : "false"}, last_reflection=${snapshot.innovationReflectionLastAt ?? "never"}`
  );
  if (snapshot.innovationReflectionPath) {
    lines.push(`Innovation reflection path: ${snapshot.innovationReflectionPath}`);
  }
  if (snapshot.innovationReflectionPendingReason) {
    lines.push(`Innovation reflection pending_reason: ${snapshot.innovationReflectionPendingReason}`);
  }
  if (snapshot.brainstormCycleStatus) {
    lines.push(
      `Brainstorm cycle: status=${snapshot.brainstormCycleStatus}, topic=${snapshot.brainstormCycleTopic ?? "unset"}, basis_stage=${snapshot.brainstormCycleBasisStage ?? "unset"}, track=${snapshot.brainstormCycleTrackId ?? "unset"}, graph_version=${snapshot.brainstormCycleGraphVersionSeen ?? "unset"}, import_tasks=${snapshot.brainstormCycleImportTaskCount ?? 0}, chain_bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`
    );
    if (snapshot.brainstormCyclePendingReason) {
      lines.push(`Brainstorm cycle pending_reason: ${snapshot.brainstormCyclePendingReason}`);
    }
    lines.push(
      "Brainstorm rule: for novelty-sensitive reasoning, summarize the topic, call PaperNexus typed endpoints such as `research-brief`, `brainstorm-brief`, `ideas`, `path-trace`, `evidence-chain`, `reflection-chain`, `theory-brief`, and `storyline-brief`, and persist logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet through research_workflow.run_brainstorm_cycle."
    );
    lines.push(
      "Brainstorm selection rule: multiple brainstorm rounds may coexist, but aggressive auto mode should keep all candidates and promote the highest-scoring option to the selected durable bundle."
    );
  }
  if (snapshot.researchProgramStatus) {
    lines.push(
      `Research program: status=${snapshot.researchProgramStatus}, goal=${snapshot.researchProgramPrimaryGoal ?? "unset"}, active_tracks=${snapshot.researchProgramActiveTrackCount ?? 0}/${snapshot.researchProgramTrackCount ?? 0}`
    );
  }
  if (snapshot.orchestrationStatus) {
    lines.push(
      `Orchestration: status=${snapshot.orchestrationStatus}, next_transition=${snapshot.orchestrationNextTransitionCandidate ?? "unset"}, blocking_category=${snapshot.orchestrationBlockingCategory ?? "none"}, retry_budget_remaining=${snapshot.orchestrationRetryBudgetRemaining ?? "unset"}, rollback_target=${snapshot.orchestrationRollbackTargetStage ?? "unset"}`
    );
  }
  if (snapshot.experimentSearchStatus) {
    lines.push(
      `Experiment search: status=${snapshot.experimentSearchStatus}, main_stage=${snapshot.experimentSearchCurrentMainStage ?? "unset"}, substage=${snapshot.experimentSearchCurrentSubstage ?? "unset"}, best_node=${snapshot.experimentSearchBestNodeId ?? "unset"}, multi_seed=${snapshot.experimentSearchMultiSeedStatus ?? "unset"}, plot_pack=${snapshot.experimentSearchPlotPackStatus ?? "unset"}`
    );
  }
  lines.push(
    `Writing contract: mode=${snapshot.writingPaperMode ?? "legacy"}, template_required=${snapshot.writingTemplateRequired ? "true" : "false"}, template_status=${snapshot.writingTemplateStatus ?? "unknown"}, paragraph_logic=${snapshot.paragraphLogicStatus ?? "unknown"}, kg_storyline=${snapshot.kgStorylineStatus ?? "unknown"}`
  );
  if (snapshot.writingBodyPageBudget || snapshot.writingReferencePageBudget) {
    lines.push(
      `Writing budget: body_pages=${snapshot.writingBodyPageBudget ?? "unset"}, ref_pages=${snapshot.writingReferencePageBudget ?? "unset"}, body_words=${snapshot.writingBodyWordTargetMin ?? "unset"}-${snapshot.writingBodyWordTargetMax ?? "unset"}, core_ideas<=${snapshot.writingMaxCoreIdeas ?? "unset"}, headline_claims<=${snapshot.writingMaxHeadlineClaims ?? "unset"}`
    );
  }
  if (snapshot.writingTemplatePath) {
    lines.push(`Writing template path: ${snapshot.writingTemplatePath}`);
  }
  if (snapshot.writingTemplateMappingPath) {
    lines.push(`Writing template mapping: ${snapshot.writingTemplateMappingPath}`);
  }
  if (snapshot.kgStorylinePacketPath) {
    lines.push(`KG storyline packet: ${snapshot.kgStorylinePacketPath}`);
  }
  if (snapshot.storylineSource) {
    lines.push(`Storyline source: ${snapshot.storylineSource}`);
  }
  if (snapshot.writingSectionOrder.length > 0) {
    lines.push(`Writing section order: ${snapshot.writingSectionOrder.join(" -> ")}`);
  }
  if (snapshot.writingContractPendingReason) {
    lines.push(`Writing contract pending_reason: ${snapshot.writingContractPendingReason}`);
  }
  if (snapshot.citationVerificationRequired) {
    lines.push(
      `Citation integrity: status=${snapshot.citationVerificationStatus ?? "unknown"}, placeholders=${snapshot.citationUnresolvedPlaceholderCount ?? "unknown"}/${snapshot.citationAllowedPlaceholderCount ?? "unknown"}, verified=${snapshot.citationVerifiedCount ?? 0}, suspicious=${snapshot.citationSuspiciousCount ?? 0}, hallucinated=${snapshot.citationHallucinatedCount ?? 0}`
    );
    if (snapshot.citationBibliographyPath) {
      lines.push(`Citation bibliography: ${snapshot.citationBibliographyPath}`);
    }
    if (snapshot.citationVerificationReportPath) {
      lines.push(`Citation verification report: ${snapshot.citationVerificationReportPath}`);
    }
    if (snapshot.citationSourceOfTruth.length > 0) {
      lines.push(`Citation sources of truth: ${snapshot.citationSourceOfTruth.join(", ")}`);
    }
    if (snapshot.citationPendingReason) {
      lines.push(`Citation pending_reason: ${snapshot.citationPendingReason}`);
    }
  }
  if (snapshot.writingSessionStatus && snapshot.writingSessionStatus !== "missing") {
    lines.push(
      `Writing session: status=${snapshot.writingSessionStatus}, current_section=${snapshot.writingCurrentSection ?? "unset"}, section_review=${snapshot.writingCurrentSectionReviewVerdict ?? "unknown"}`
    );
    lines.push(
      `Writing evidence coverage: status=${snapshot.writingGraphEvidenceCoverageStatus ?? "unknown"}, packets_ready=${snapshot.writingSectionPacketsReady ? "true" : "false"}`
    );
    if (snapshot.writingGraphEvidenceCoverageSummary) {
      lines.push(
        `Writing evidence summary: ${snapshot.writingGraphEvidenceCoverageSummary}`
      );
    }
  }
  if (snapshot.writePackageStatus) {
    lines.push(
      `Write package: status=${snapshot.writePackageStatus}, assembly=${snapshot.writePackageAssemblyStatus ?? "unknown"}, mode=${snapshot.writePackageAssemblyMode ?? "unset"}, winning_tracks=${snapshot.writePackageWinningTrackCount ?? 0}, derived_artifacts=${snapshot.writePackageDerivedArtifactCount ?? 0}, pending_reason=${snapshot.writePackagePendingReason ?? "none"}`
    );
  }
  if (snapshot.reviewSessionStatus && snapshot.reviewSessionStatus !== "missing") {
    lines.push(
      `Review session: status=${snapshot.reviewSessionStatus}, scope=${snapshot.reviewSessionStageScope ?? "unset"}, round=${snapshot.reviewSessionRound ?? 0}, verdict=${snapshot.reviewSessionVerdict ?? "unknown"}`
    );
    const reviewRubric = snapshot.reviewRubricSummary ?? {};
    const rubricPairs = [
      ["originality", reviewRubric.originality],
      ["quality", reviewRubric.quality],
      ["clarity", reviewRubric.clarity],
      ["significance", reviewRubric.significance],
      ["soundness", reviewRubric.soundness],
      ["citation_integrity", reviewRubric.citationIntegrity],
      ["graph_evidence", reviewRubric.graphGroundedEvidenceSufficiency],
    ].filter(([, value]) => typeof value === "number");
    if (rubricPairs.length > 0) {
      lines.push(
        `Reviewer rubric: ${rubricPairs
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`
      );
    }
    if (snapshot.reviewSessionSummary) {
      lines.push(`Review summary: ${snapshot.reviewSessionSummary}`);
    }
  }
  if (snapshot.reviewIssueTrackerStatus && snapshot.reviewIssueTrackerStatus !== "missing") {
    lines.push(
      `Review issue tracker: status=${snapshot.reviewIssueTrackerStatus}, critical=${snapshot.reviewIssueCriticalCount ?? 0}, high=${snapshot.reviewIssueHighCount ?? 0}, medium=${snapshot.reviewIssueMediumCount ?? 0}, low=${snapshot.reviewIssueLowCount ?? 0}, surface=${snapshot.reviewIssueSurfaceCount ?? 0}, submission=${snapshot.reviewIssueSubmissionCount ?? 0}`
    );
  }
  if (
    snapshot.graphGuidedWritingStatus &&
    snapshot.graphGuidedWritingStatus !== "missing"
  ) {
    lines.push(
      `Graph-guided writing: status=${snapshot.graphGuidedWritingStatus}, evidence_coverage=${snapshot.graphGuidedWritingEvidenceCoverageStatus ?? "unknown"}, missing_claims=${snapshot.graphGuidedWritingMissingEvidenceClaims.join(",") || "none"}`
    );
    if (snapshot.graphGuidedWritingScholarReserved) {
      lines.push(
        `Scholar fallback slot: reserved=${snapshot.graphGuidedWritingScholarSkillSlot ?? "true"}`
      );
    } else {
      lines.push("Scholar fallback slot: reserved=false");
    }
  }
  if (snapshot.recentExperiments.length > 0) {
    lines.push("Recent experiments:");
    for (const experiment of snapshot.recentExperiments) {
      const details = [
        experiment.status ?? "unknown",
        experiment.decision ?? experiment.stage ?? "no-decision",
      ].filter(Boolean);
      const suffix = [
        experiment.keyMetric ? `metric=${experiment.keyMetric}` : null,
        experiment.papernexusSyncStatus
          ? `papernexus=${experiment.papernexusSyncStatus}`
          : null,
        experiment.failureSignature
          ? `failure=${experiment.failureSignature}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- ${experiment.experimentId} ${experiment.name ?? ""} [${details.join(" / ")}]${suffix ? ` ${suffix}` : ""}`.trim()
      );
    }
  } else if (snapshot.currentStage === "experiment") {
    lines.push(
      "Recent experiments: none recorded yet; initialize the ledger before launching or rerunning experiments."
    );
  }

  if (snapshot.unreadMailbox.length > 0) {
    lines.push("Unread mailbox:");
    for (const message of snapshot.unreadMailbox) {
      lines.push(
        `- [${message.priority}] ${message.fromAgent} -> ${message.toAgent}: ${message.subject}`
      );
    }
  }

  if (snapshot.backgroundTasks.length > 0) {
    lines.push(
      trigger === "heartbeat"
        ? "Heartbeat/background task candidates:"
        : "If you are waiting or idle, do one bounded task:"
    );
    for (const task of snapshot.backgroundTasks.slice(0, 6)) {
      lines.push(`- ${task}`);
    }
  }

  lines.push(
    "Preferred paper-ingestion order: /papers-cool search (optionally merge /pasa-paper-search when it succeeds) -> once paper identity is confirmed, call /hugging-face-paper-pages -> if needed call /arxiv2md-api -> if needed call /arxiv2md -> only if all Markdown sources are unavailable, call /papers-cool PDF fallback -> update PAPER_SOURCE_INDEX.json source_provider/retrieval_providers -> use queued PaperNexus import tasks when material enters through UI/API upload -> /graph-build shared-graph reconciliation."
  );
  lines.push(
    "PaperNexus import rule: if new PDFs or Markdown enter through a UI/API upload, prefer the queued import-task path (`POST /api/imports`) and `.papernexus/imports/` task logs instead of manually copying files into the shared paper source tree."
  );
  lines.push(
    "PaperNexus bounded-ingestion rule: use one paper per `/api/imports` call, bound each paper to 60s total wait, record timeout state through research_workflow.set_paper_ingestion if it does not finish in time, and move on to the next paper instead of long-polling indefinitely."
  );
  lines.push(
    "PaperNexus brainstorm rule: during frontier mapping, innovation reflection, and idea divergence, prefer the brainstorm-quality node view (`brainstormEligible`, `brainstormScore`, `brainstormTier`) and typed endpoints like `research-brief`, `brainstorm-brief`, `ideas`, `brainstorm`, `path-trace`, `evidence-chain`, `reflection-chain`, `theory-brief`, and `storyline-brief` before trusting raw full-graph prominence."
  );
  lines.push(
    "PaperNexus safety rule: agents may add or update understanding in the shared graph, but must not delete corpus data, wipe shared storage, or run `backup-export`, `backup-unpack`, or `backup-load` unless the user explicitly asks."
  );
  lines.push(
    "Idle research rule: if idle_research is enabled and due, prefer /idle-research on that topic over ad hoc literature drift. Record each round through research_workflow.record_idle_research_run."
  );
  lines.push(
    "Experiment memory rule: before launching, resuming, or interpreting runs, inspect the ledger. Do not hand-edit researcher/EXPERIMENT_LEDGER.json; use research_workflow.get_experiment_memory / upsert_experiment."
  );
  lines.push(
    "Innovation reflection rule: if experiments have produced new evidence since the last reflection, run /innovation-reflection and refresh researcher/INNOVATION_REFLECTION.md before proposing or locking a new innovation direction."
  );
  if (shouldApplySharedWritingConstitution(snapshot)) {
    lines.push(...getSharedWritingConstitutionLines(snapshot.role ?? null));
  }
  if (snapshot.role === "analyzer" || snapshot.currentStage === "analyze") {
    lines.push(
      "Theory packet rule: Analyzer should not stop at THEORY_SUPPORT_NOTE.md. Write analyzer/THEORY_STATE.json plus analyzer/proof-packets/*.json so theorem / lemma candidates, assumptions, derivation outlines, and caveats become structured objects for Writer."
    );
    lines.push(
      "Theory-phase rule: after the packet set is current, run /theory-phase or research_workflow.materialize_theory_appendix so Writer receives a generated THEORY_APPENDIX_PLAN.md and appendix_theory.tex draft."
    );
  }
  if (snapshot.role === "academic_writer" || snapshot.currentStage === "write") {
    lines.push(
      "Writing template rule: if writing_contract.template_required is true or a writing template path is configured, read the project-local template copy before /paper-plan or /paper-write. Never edit the external source template in place; keep PAPER_PLAN.md, TEMPLATE_MAPPING.md, and section drafts aligned with the copied template."
    );
    lines.push(
      "Writing mode rule: conference mode targets 9 body pages + 2 reference pages; journal mode targets 12 body pages + 2 reference pages. Keep the paper to 1-2 core ideas and do not let side tracks re-enter the headline narrative."
    );
    lines.push(
      "Proof-writing rule: when the writing contract enables proof-aware writing, keep the main text to theorem/lemma statements, intuition, and final consequences; move full derivations, algebra, and case-by-case proofs into the appendix."
    );
    lines.push(
      "Theory support rule: use analyzer/THEORY_SUPPORT_NOTE.md or the configured theory note path as the ceiling for formal claims. Where proof confidence is weak, write conservative mechanism language in the body and spell out caveats in the appendix or limitations."
    );
    lines.push(
      "Structured proof-object rule: read analyzer/THEORY_STATE.json and analyzer/proof-packets/*.json before drafting. Use those packets to decide which statements are body-safe and which derivations belong in the appendix."
    );
    lines.push(
      "Appendix draft rule: start from academic_writer/THEORY_APPENDIX_PLAN.md and the configured proof_appendix_path instead of reconstructing derivations from scratch."
    );
    lines.push(
      "KG storyline rule: when writing_contract.kg_storyline_required is true, build and use a KG storyline packet that maps problem -> gap -> method -> evidence -> limitations before broadening prose."
    );
    lines.push(
      "Paragraph audit rule: reverse-outline each section, keep WRITING_SIGNALS.md current, and update paragraph_logic_status after every local coherence pass."
    );
    lines.push(
      "Citation integrity rule: citations must come from real sources of truth (DBLP/CrossRef/DataCite/Semantic Scholar or equivalent). Do not invent BibTeX, and do not finalize submission until the citation integrity gate is verified."
    );
  }
  lines.push("[/Workflow Guard]");
  return lines.join("\n");
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathContainsDatasetSegment(targetPath: string): boolean {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/").toLowerCase();
  return normalized === "datasets" || normalized.includes("/datasets/");
}

function getToolCommandText(toolParams: Record<string, unknown>): string | null {
  return (
    asString(toolParams.command) ??
    asString(toolParams.cmd) ??
    asString(toolParams.script) ??
    asString(toolParams.shellCommand)
  );
}

function getToolPayloadText(toolParams: Record<string, unknown>): string | null {
  const values = uniqueStringList(
    [
      getToolCommandText(toolParams),
      asString(toolParams.message),
      asString(toolParams.text),
      asString(toolParams.content),
      asString(toolParams.body),
      asString(toolParams.prompt),
    ].filter((value): value is string => Boolean(value))
  );
  if (values.length === 0) {
    return null;
  }
  return values.join("\n");
}

function commandLikelyMutatesDataset(command: string): boolean {
  const datasetPathAtEnd =
    /(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?(?:["'])?\s*$/i;
  const inPlaceMutation =
    /\b(?:rm|mkdir|touch|chmod|chown)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const inPlacePatch =
    /\b(?:sed\s+-i|perl\s+-pi)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const redirectIntoDataset =
    /(?:^|[\s])>>?\s*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const extractIntoDataset =
    /\b(?:tar|unzip|zip)\b[\s\S]*(?:-C|-d)\s*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const copyLikeIntoDataset =
    /\b(?:cp|mv|rsync|scp|ln|install)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?(?:["'])?\s*$/i;

  return (
    inPlaceMutation.test(command) ||
    inPlacePatch.test(command) ||
    redirectIntoDataset.test(command) ||
    extractIntoDataset.test(command) ||
    (copyLikeIntoDataset.test(command) && datasetPathAtEnd.test(command))
  );
}

function normalizeProjectScopedPath(
  rawPath: string,
  projectRoot: string
): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "PROJECTS_STATE.json") {
    return path.join(path.dirname(projectRoot), "PROJECTS_STATE.json");
  }
  if (
    PROJECT_ROOT_FILE_SET.has(normalized) ||
    PROJECT_DIR_HINTS.some((prefix) => normalized.startsWith(prefix))
  ) {
    return path.normalize(path.join(projectRoot, normalized));
  }
  return null;
}

function getAllowedAbsolutePaths(params: {
  projectRoot: string;
  role: WorkflowRole;
}): { dirs: string[]; files: string[] } {
  const policy = ROLE_POLICIES[params.role];
  const dirs = policy.allowedProjectDirs.map((dir) => path.join(params.projectRoot, dir));
  const files = policy.allowedProjectFiles.map((file) => path.join(params.projectRoot, file));
  if (policy.allowProjectsStateWrite) {
    files.push(path.join(path.dirname(params.projectRoot), "PROJECTS_STATE.json"));
  }
  return { dirs, files };
}

export function canRoleContact(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedContacts.includes(toRole);
}

export function canRoleSpawn(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedSpawns.includes(toRole);
}

export function inferTargetRoleFromToolParams(
  params: Record<string, unknown>
): WorkflowRole | null {
  return (
    normalizeRole(asString(params.agentId)) ??
    normalizeRole(asString(params.label)) ??
    normalizeRole(asString(params.sessionKey))
  );
}

export function shouldBlockProjectWrite(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (!params.role || !params.projectRoot) {
    return { block: false };
  }
  if (!["write", "edit"].includes(params.toolName)) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const workflowSystemRoot = path.join(params.projectRoot, ".openclaw-research");
  if (isInside(workflowSystemRoot, absolutePath)) {
    return {
      block: true,
      reason:
        "Do not edit workflow mailbox/state files directly. Use the research_workflow plugin tool instead.",
    };
  }

  if (path.normalize(getExperimentLedgerPath(params.projectRoot)) === absolutePath) {
    return {
      block: true,
      reason:
        "Do not hand-edit researcher/EXPERIMENT_LEDGER.json. Use research_workflow.upsert_experiment instead.",
    };
  }

  if (params.role === "cross-reviewer") {
    return {
      block: true,
      reason: "Cross-reviewer is read-only. Return review text instead of writing project files.",
    };
  }

  const allowed = getAllowedAbsolutePaths({
    projectRoot: params.projectRoot,
    role: params.role,
  });
  const allowedByDir = allowed.dirs.some((dir) => isInside(dir, absolutePath));
  const allowedByFile = allowed.files.some(
    (filePath) => path.normalize(filePath) === absolutePath
  );
  if (allowedByDir || allowedByFile) {
    return { block: false };
  }

  return {
    block: true,
    reason: `${params.role} cannot write ${absolutePath}. Stay inside your owned project scope.`,
  };
}

export function shouldBlockCoderDatasetMutation(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (params.role !== "coder") {
    return { block: false };
  }

  if (["write", "edit"].includes(params.toolName) && params.projectRoot) {
    const rawPath =
      asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
    if (rawPath) {
      const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
      const coderRoot = path.join(params.projectRoot, "coder");
      if (
        absolutePath &&
        pathContainsDatasetSegment(absolutePath) &&
        !isInside(coderRoot, absolutePath)
      ) {
        return {
          block: true,
          reason:
            "Coder must treat dataset directories as read-only. Do not edit files under datasets/; write derived artifacts under {PROJ}/coder/ or remote scratch/results instead.",
        };
      }
    }
  }

  if (params.toolName !== "bash") {
    return { block: false };
  }

  const command = getToolCommandText(params.toolParams);
  if (!command || !pathContainsDatasetSegment(command)) {
    return { block: false };
  }

  if (!commandLikelyMutatesDataset(command)) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Coder must treat dataset directories as read-only. Do not create, delete, patch, chmod, extract, or sync files into datasets/ from bash; use {PROJ}/coder/, logs/, results/, or remote scratch instead.",
  };
}

export function shouldBlockResearchGraphForce(params: {
  role: WorkflowRole | null;
  currentStage: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (params.role !== "researcher") {
    return { block: false };
  }
  if (!["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }

  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }

  const usesGraphBuildForce = /\/graph-build\b[\s\S]*--force\b/i.test(payloadText);
  const usesPapernexusForce =
    /\bpapernexus\b[\s\S]*\b(?:analyze|materialize|build-graph|optimize|watch|stage1|stage2|stage3|stage4)\b[\s\S]*--force\b/i.test(
      payloadText
    ) ||
    /src\/cli\/index\.js\b[\s\S]*\b(?:analyze|materialize|build-graph|optimize|watch|stage1|stage2|stage3|stage4)\b[\s\S]*--force\b/i.test(
      payloadText
    ) ||
    /--rebuild-pdf-markdown\b/i.test(payloadText);

  if (!usesGraphBuildForce && !usesPapernexusForce) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "During literature graph refresh, do not use --force or --rebuild-pdf-markdown. Keep PaperNexus cache-first and run /graph-build or papernexus analyze without --force; if the graph build still fails, hand the exact cache-first command to the user instead of forcing a rebuild.",
  };
}

export function shouldBlockPapernexusInlineExecution(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  sessionKey: string | null | undefined;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (isWorkflowSubagentSessionKey(params.sessionKey)) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!looksLikePapernexusHeavyCommand(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "PaperNexus-heavy live-graph work must run in a dedicated subagent session to avoid stalling the foreground agent. Start a background run first, then let that subagent execute remote typed PaperNexus calls, /graph-build, /frontier-mapping, /papernexus, or related PaperNexus commands.",
  };
}

export function shouldBlockPapernexusLiveGraphCliRead(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!looksLikePapernexusLiveGraphCliReadCommand(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "Local papernexus CLI reads against the live shared graph are not allowed in workflow mode. Use authenticated HTTP API endpoints instead (`/api/query`, `/api/context`, `/api/impact`, `/api/ideas`, `/api/brainstorm`, `/api/research-brief`, `/api/brainstorm-brief`, `/api/path-trace`, `/api/evidence-chain`, `/api/reflection-chain`, `/api/theory-brief`, `/api/storyline-brief`, or related typed endpoints).",
  };
}

export function shouldBlockPapernexusLocalGraphProcessing(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  remoteApiBaseUrl?: string | null;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!params.remoteApiBaseUrl) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }
  const usesLocalGraphProcessing =
    /\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:analyze|materialize|build-graph|merge-graph|write-index|llm-optimize|optimize|watch|stage1|stage2|stage3|stage4)\b/i.test(
      payloadText
    );
  if (!usesLocalGraphProcessing) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      `Local PaperNexus graph processing is disabled when remote PaperNexus access is configured (${params.remoteApiBaseUrl}). ` +
      "Use the configured authenticated remote API and remote graph workflow instead of local `papernexus` / `src/cli/index.js` graph-processing commands.",
  };
}

export function shouldBlockPapernexusMultiPaperImport(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText || !/\/api\/imports(?:[/?\s"'`]|$)/i.test(payloadText)) {
    return { block: false };
  }
  const uploadsMultipleFiles =
    /"files"\s*:\s*\[[\s\S]*?\}\s*,\s*\{/i.test(payloadText) ||
    /'files'\s*:\s*\[[\s\S]*?\}\s*,\s*\{/i.test(payloadText);
  if (!uploadsMultipleFiles) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "Queued PaperNexus imports must be single-paper only. Submit one paper per `/api/imports` call so each paper can time out independently, continue to the next item, and emit its own progress update.",
  };
}

export function shouldBlockPapernexusLongWaitImportCommand(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText || !/\/api\/imports(?:[/?\s"'`]|$)/i.test(payloadText)) {
    return { block: false };
  }
  const usesLoopWithSleep =
    (/\bwhile\b/i.test(payloadText) ||
      /\buntil\b/i.test(payloadText) ||
      /\bfor\b[\s\S]*\bdo\b/i.test(payloadText)) &&
    /\bsleep\b/i.test(payloadText);
  if (usesLoopWithSleep) {
    return {
      block: true,
      reason:
        "Do not long-poll PaperNexus import tasks in a shell loop. Bound each paper to at most 60s total wait, record timeout state, report it, and move on to the next paper instead of waiting indefinitely.",
    };
  }
  if (/\bcurl\b/i.test(payloadText)) {
    const maxTimeMatch = payloadText.match(/--max-time(?:=|\s+)(\d+)/i);
    const maxTimeSeconds = maxTimeMatch
      ? Number.parseInt(maxTimeMatch[1] ?? "", 10)
      : Number.NaN;
    if (!Number.isFinite(maxTimeSeconds)) {
      return {
        block: true,
        reason:
          "PaperNexus import and import-status requests must set `curl --max-time` and keep each paper within a 60s budget.",
      };
    }
    if (maxTimeSeconds > 60) {
      return {
        block: true,
        reason:
          "PaperNexus import and import-status requests must cap each paper at 60s or less. Record timeout state and continue with the next paper instead of waiting longer.",
      };
    }
  }
  return { block: false };
}

export function shouldBlockPapernexusDestructiveOperation(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }

  const usesBackupCommand =
    /\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:backup-export|backup-unpack|backup-load)\b/i.test(
      payloadText
    );
  const deletesSharedStorage =
    /\brm\b[\s\S]*-(?:[A-Za-z]*r[A-Za-z]*f|[A-Za-z]*f[A-Za-z]*r|[A-Za-z]*r|[A-Za-z]*f)\b[\s\S]*(?:~\/|\/)[^\n]*\.papernexus(?:\/[^\s"'`|;&]*)?/i.test(
      payloadText
    ) ||
    /\bfind\b[\s\S]*\.papernexus[\s\S]*\b-delete\b/i.test(payloadText);

  if (!usesBackupCommand && !deletesSharedStorage) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Do not delete shared PaperNexus graph storage or run backup-export, backup-unpack, or backup-load during normal agent operation. Report the need and wait for an explicit human request before destructive or whole-database archive actions.",
  };
}

export function shouldBlockInnovationWrite(params: {
  projectRoot: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  innovationReflectionDue: boolean;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (
    !params.projectRoot ||
    params.role !== "researcher" ||
    params.currentStage !== "idea" ||
    !params.innovationReflectionDue ||
    !["write", "edit"].includes(params.toolName)
  ) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const blockedTargets = new Set([
    path.join(params.projectRoot, "researcher", "IDEA_REPORT.md"),
    path.join(params.projectRoot, "researcher", "IDEA_AUDIT.md"),
    path.join(params.projectRoot, "TRACK_REGISTRY.json"),
  ]);

  if (!blockedTargets.has(path.normalize(absolutePath))) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "New experiment evidence has not yet been reflected into PaperNexus-backed innovation reflection. Run /innovation-reflection and refresh researcher/INNOVATION_REFLECTION.md before writing idea outputs.",
  };
}

export function shouldBlockWriterTemplateWrite(params: {
  projectRoot: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  writingTemplateRequired: boolean;
  writingTemplateStatus: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  if (
    !params.projectRoot ||
    params.role !== "academic_writer" ||
    params.currentStage !== "write" ||
    !params.writingTemplateRequired ||
    params.writingTemplateStatus !== "missing" ||
    !["write", "edit"].includes(params.toolName)
  ) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const academicWriterRoot = path.join(params.projectRoot, "academic_writer");
  if (!isInside(academicWriterRoot, path.normalize(absolutePath))) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Writer is required to follow a user-provided template, but the configured template is missing. Restore it with research_workflow.set_writing_contract before editing PAPER_PLAN.md or paper sections.",
  };
}

export function sanitizeAgentMentions(text: string): string {
  return text.replace(
    AGENT_MENTION_REGEX,
    (_match, prefix: string, roleName: string) => {
      const raw = String(roleName || "").trim().toLowerCase().replace(/_/g, "-");
      const label =
        raw === "academic-writer" || raw === "writer"
          ? "writer"
          : raw === "cross-reviewer"
            ? "cross-reviewer"
            : raw;
      return `${prefix}[${label}]`;
    }
  );
}

export function hasAgentMention(text: string): boolean {
  AGENT_MENTION_REGEX.lastIndex = 0;
  return AGENT_MENTION_REGEX.test(text);
}

export function sanitizeMessageToolParams(
  params: Record<string, unknown>
): Record<string, unknown> | null {
  const nextParams: Record<string, unknown> = { ...params };
  let changed = false;
  for (const key of ["text", "content", "message", "caption"]) {
    if (typeof params[key] !== "string") {
      continue;
    }
    const rawText = params[key] as string;
    if (!hasAgentMention(rawText)) {
      continue;
    }
    nextParams[key] = sanitizeAgentMentions(rawText);
    changed = true;
  }
  return changed ? nextParams : null;
}

export async function queueWorkflowMailboxMessage(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  kind?: string;
  priority?: string;
}): Promise<WorkflowMailboxItem> {
  const mailbox = await readMailbox(params.projectRoot);
  const item: WorkflowMailboxItem = {
    id: randomUUID(),
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    subject: params.subject.trim(),
    body: params.body.trim(),
    kind:
      params.kind === "handoff" ||
      params.kind === "blocker" ||
      params.kind === "request" ||
      params.kind === "note"
        ? params.kind
        : "note",
    priority:
      params.priority === "high" || params.priority === "low" || params.priority === "normal"
        ? params.priority
        : "normal",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  mailbox.messages.push(item);
  mailbox.messages = mailbox.messages.slice(-500);
  await saveMailbox(params.projectRoot, mailbox);
  return item;
}

export async function getWorkflowContactCooldown(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  cooldownSeconds: number;
}): Promise<{
  blocked: boolean;
  remainingSeconds: number;
  lastEvent: WorkflowContactEvent | null;
}> {
  if (params.cooldownSeconds <= 0) {
    return {
      blocked: false,
      remainingSeconds: 0,
      lastEvent: null,
    };
  }

  const store = await readContactStore(params.projectRoot);
  const lastEvent =
    [...store.events]
      .reverse()
      .find(
        (event) =>
          event.fromAgent === params.fromAgent && event.toAgent === params.toAgent
      ) ?? null;

  if (!lastEvent) {
    return {
      blocked: false,
      remainingSeconds: 0,
      lastEvent: null,
    };
  }

  const elapsedMs = Date.now() - (Date.parse(lastEvent.createdAt) || 0);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((params.cooldownSeconds * 1000 - elapsedMs) / 1000)
  );

  return {
    blocked: remainingSeconds > 0,
    remainingSeconds,
    lastEvent,
  };
}

export async function recordWorkflowContactEvent(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
}): Promise<void> {
  const store = await readContactStore(params.projectRoot);
  store.events.push({
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    channel: params.channel,
    createdAt: new Date().toISOString(),
  });
  await saveContactStore(params.projectRoot, store);
}

export async function acknowledgeWorkflowMailboxMessage(params: {
  projectRoot: string;
  messageId: string;
  agentId?: string;
}): Promise<WorkflowMailboxItem | null> {
  const mailbox = await readMailbox(params.projectRoot);
  const item = mailbox.messages.find((message) => message.id === params.messageId);
  if (!item) {
    return null;
  }
  const role = normalizeRole(params.agentId);
  if (role && item.toAgent !== role && item.toAgent !== "*") {
    throw new Error("Mailbox message is not addressed to this agent.");
  }
  item.status = "acknowledged";
  item.acknowledgedAt = new Date().toISOString();
  await saveMailbox(params.projectRoot, mailbox);
  return item;
}

export async function readWorkflowMailboxForAgent(params: {
  projectRoot: string;
  agentId?: string;
  limit?: number;
  includeAcknowledged?: boolean;
}): Promise<WorkflowMailboxItem[]> {
  const mailbox = await readMailbox(params.projectRoot);
  const role = normalizeRole(params.agentId);
  if (!role) {
    return [];
  }
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 20;
  return mailbox.messages
    .filter((item) => item.toAgent === role || item.toAgent === "*")
    .filter((item) => params.includeAcknowledged === true || item.status === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function getIdleResearchStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: IdleResearchState;
  due: boolean;
  nextDueAt: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeIdleResearchState(manifest.idle_research);
  return {
    state,
    due: isIdleResearchDue(state),
    nextDueAt: computeIdleResearchNextDueAt(state),
  };
}

export async function getInnovationReflectionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: InnovationReflectionState;
  due: boolean;
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeInnovationReflectionState(manifest.innovation_reflection);
  const ledger = await readExperimentLedgerEnsured(params.projectRoot);
  const basis = getInnovationReflectionBasis(ledger);
  return {
    state,
    due: isInnovationReflectionDue({ state, ledger }),
    latestExperimentUpdateAt: basis.latestExperimentUpdateAt,
    experimentIds: basis.experimentIds,
  };
}

export async function getBrainstormCycleStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
  topicSummaryResolvedPath: string | null;
  topicSummaryExists: boolean;
  researchBriefResolvedPath: string | null;
  researchBriefExists: boolean;
  brainstormBriefResolvedPath: string | null;
  brainstormBriefExists: boolean;
  logicChainResolvedPath: string | null;
  logicChainExists: boolean;
  evidenceChainResolvedPath: string | null;
  evidenceChainExists: boolean;
  reasoningTraceResolvedPath: string | null;
  reasoningTraceExists: boolean;
  questionPacketResolvedPath: string | null;
  questionPacketExists: boolean;
  workingMemoryResolvedPath: string | null;
  workingMemoryExists: boolean;
  synthesisPacketResolvedPath: string | null;
  synthesisPacketExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const validationErrors = getBrainstormCycleValidationErrors(state);
  const topicSummaryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.topicSummaryPath
  );
  const researchBriefResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.researchBriefPath
  );
  const brainstormBriefResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.brainstormBriefPath
  );
  const logicChainResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.logicChainPath
  );
  const evidenceChainResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.evidenceChainPath
  );
  const reasoningTraceResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.reasoningTracePath
  );
  const questionPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.questionPacketPath
  );
  const workingMemoryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.workingMemoryPath
  );
  const synthesisPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.synthesisPacketPath
  );
  const contentChecks = await Promise.all([
    fileHasMeaningfulJsonContent(topicSummaryResolvedPath),
    fileHasMeaningfulJsonContent(researchBriefResolvedPath),
    fileHasMeaningfulJsonContent(brainstormBriefResolvedPath),
    fileHasNonWhitespaceContent(logicChainResolvedPath),
    fileHasNonWhitespaceContent(evidenceChainResolvedPath),
    fileHasNonWhitespaceContent(reasoningTraceResolvedPath),
    fileHasNonWhitespaceContent(questionPacketResolvedPath),
    fileHasMeaningfulJsonContent(workingMemoryResolvedPath),
    fileHasNonWhitespaceContent(synthesisPacketResolvedPath),
  ]);
  const chainBundleReady =
    isBrainstormCycleReady(state) &&
    validationErrors.length === 0 &&
    contentChecks.every(Boolean);
  return {
    state,
    validationErrors,
    chainBundleReady,
    topicSummaryResolvedPath,
    topicSummaryExists: contentChecks[0],
    researchBriefResolvedPath,
    researchBriefExists: contentChecks[1],
    brainstormBriefResolvedPath,
    brainstormBriefExists: contentChecks[2],
    logicChainResolvedPath,
    logicChainExists: contentChecks[3],
    evidenceChainResolvedPath,
    evidenceChainExists: contentChecks[4],
    reasoningTraceResolvedPath,
    reasoningTraceExists: contentChecks[5],
    questionPacketResolvedPath,
    questionPacketExists: contentChecks[6],
    workingMemoryResolvedPath,
    workingMemoryExists: contentChecks[7],
    synthesisPacketResolvedPath,
    synthesisPacketExists: contentChecks[8],
  };
}

export async function getResearchProgramStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ResearchProgramState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeResearchProgramState(manifest.research_program);
  return {
    state,
    validationErrors: getResearchProgramValidationErrors(state),
  };
}

export async function getOrchestrationStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: OrchestrationState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeOrchestrationState(manifest.orchestration_state);
  return {
    state,
    validationErrors: getOrchestrationStateValidationErrors(
      state,
      normalizeStage(manifest.current_stage)
    ),
  };
}

export async function getWritePackageStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: WritePackageState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeWritePackageState(manifest.write_package);
  return {
    state,
    validationErrors: getWritePackageValidationErrors(state),
  };
}

export async function getTheoryStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: TheorySupportState;
  theoryStateResolvedPath: string | null;
  theoryStateExists: boolean;
  sourceTheoryNoteResolvedPath: string | null;
  sourceTheoryNoteExists: boolean;
  proofPacketDirResolvedPath: string | null;
  proofPacketCount: number;
  theoryFile: TheoryStateFile | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeTheorySupportState(manifest.theory_state);
  const theoryStateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.theoryStatePath
  );
  const sourceTheoryNoteResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.sourceTheoryNotePath
  );
  const proofPacketDirResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.proofPacketDir
  );
  const theoryStateExists = theoryStateResolvedPath
    ? await pathExists(theoryStateResolvedPath)
    : false;
  const sourceTheoryNoteExists = sourceTheoryNoteResolvedPath
    ? await pathExists(sourceTheoryNoteResolvedPath)
    : false;
  const theoryFile = theoryStateExists
    ? normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath!))
    : null;
  let proofPacketCount = 0;
  if (proofPacketDirResolvedPath && (await pathExists(proofPacketDirResolvedPath))) {
    try {
      const entries = await fs.readdir(proofPacketDirResolvedPath);
      proofPacketCount = entries.filter((entry) => entry.endsWith(".json")).length;
    } catch {
      proofPacketCount = 0;
    }
  }
  return {
    state,
    theoryStateResolvedPath,
    theoryStateExists,
    sourceTheoryNoteResolvedPath,
    sourceTheoryNoteExists,
    proofPacketDirResolvedPath,
    proofPacketCount,
    theoryFile,
  };
}

export async function getWritingContractStateSummary(params: {
  projectRoot: string;
  policy?: WorkflowGuardPolicy;
}): Promise<{
  state: WritingContractState;
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateReady: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  paragraphLogicStatus: string;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeWritingContractState(manifest.writing_contract);
  const evaluation = await evaluateWritingContractState({
    projectRoot: params.projectRoot,
    state,
  });
  return {
    state,
    templateResolvedPath: evaluation.templateResolvedPath,
    projectTemplateResolvedPath: evaluation.projectTemplateResolvedPath,
    sourceTemplateResolvedPath: evaluation.sourceTemplateResolvedPath,
    templateExists: evaluation.templateExists,
    templateReady:
      !state.templateRequired ||
      Boolean(evaluation.templateResolvedPath && evaluation.templateExists),
    templateStatus: evaluation.templateStatus,
    templateCopyStatus: evaluation.templateCopyStatus,
    paragraphLogicStatus: state.paragraphLogicStatus,
  };
}

export async function recordTheoryState(params: {
  projectRoot: string;
  theoryState: Record<string, unknown>;
}): Promise<{
  state: TheorySupportState;
  theoryStateResolvedPath: string | null;
  proofPacketDirResolvedPath: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeTheorySupportState(manifest.theory_state);
  const patch = asRecord(params.theoryState) ?? {};
  const next: TheorySupportState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    overallSignal:
      pickString(patch, ["overallSignal", "overall_signal"]) ?? current.overallSignal,
    theoryStatePath:
      pickString(patch, ["theoryStatePath", "theory_state_path"]) ?? current.theoryStatePath,
    sourceTheoryNotePath:
      pickString(patch, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
      current.sourceTheoryNotePath,
    proofPacketDir:
      pickString(patch, ["proofPacketDir", "proof_packet_dir"]) ?? current.proofPacketDir,
    appendixPacketPath:
      pickString(patch, ["appendixPacketPath", "appendix_packet_path"]) ??
      current.appendixPacketPath,
    mainTextProofStyle:
      pickString(patch, ["mainTextProofStyle", "main_text_proof_style"]) ??
      current.mainTextProofStyle,
    bodyReady: pickBoolean(patch, ["bodyReady", "body_ready"]) ?? current.bodyReady,
    theoremCount: Math.max(
      0,
      Math.floor(pickNumber(patch, ["theoremCount", "theorem_count"]) ?? current.theoremCount)
    ),
    lemmaCount: Math.max(
      0,
      Math.floor(pickNumber(patch, ["lemmaCount", "lemma_count"]) ?? current.lemmaCount)
    ),
    proofPacketCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["proofPacketCount", "proof_packet_count"]) ?? current.proofPacketCount
      )
    ),
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ?? new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  const theoryStatePayload = asRecord(patch.theoryStateFile ?? patch.theory_state_file);
  const theoryStateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.theoryStatePath
  );
  if (theoryStatePayload && theoryStateResolvedPath) {
    const normalized = normalizeTheoryStateFile({
      ...theoryStatePayload,
      updated_at: next.lastUpdatedAt,
      overall_signal:
        pickString(theoryStatePayload, ["overallSignal", "overall_signal"]) ?? next.overallSignal,
      main_text_proof_style:
        pickString(theoryStatePayload, ["mainTextProofStyle", "main_text_proof_style"]) ??
        next.mainTextProofStyle,
      source_theory_note_path:
        pickString(theoryStatePayload, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
        next.sourceTheoryNotePath,
    });
    next.theoremCount = normalized.theorem_candidates.length;
    next.lemmaCount = normalized.lemma_packets.length;
    next.proofPacketCount = next.theoremCount + next.lemmaCount;
    await writeJsonEnsured(theoryStateResolvedPath, serializeTheoryStateFile(normalized));
  }

  manifest.theory_state = serializeTheorySupportState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    theoryStateResolvedPath,
    proofPacketDirResolvedPath: resolveProjectArtifactPath(params.projectRoot, next.proofPacketDir),
  };
}

export async function upsertTheoryProofPacket(params: {
  projectRoot: string;
  proofPacket: Record<string, unknown>;
}): Promise<{
  packet: TheoryObjectPacket;
  packetResolvedPath: string;
  state: TheorySupportState;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeTheorySupportState(manifest.theory_state);
  const packet = normalizeTheoryObjectPacket(params.proofPacket);
  if (!packet) {
    throw new Error("proofPacket.packet_id and proofPacket.statement are required.");
  }

  const proofPacketDir = resolveProjectArtifactPath(
    params.projectRoot,
    current.proofPacketDir
  );
  if (!proofPacketDir) {
    throw new Error("No proof packet directory is configured for this project.");
  }
  const packetResolvedPath = path.join(proofPacketDir, `${packet.packet_id}.json`);
  const now = new Date().toISOString();
  const normalizedPacket: TheoryObjectPacket = {
    ...packet,
    updated_at: packet.updated_at ?? now,
  };
  await writeJsonEnsured(packetResolvedPath, serializeTheoryObjectPacket(normalizedPacket));

  const theoryStateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    current.theoryStatePath
  );
  let theoryFile = normalizeTheoryStateFile({
    status: "draft",
    overall_signal: current.overallSignal,
    source_theory_note_path: current.sourceTheoryNotePath,
    main_text_proof_style: current.mainTextProofStyle,
  });
  if (theoryStateResolvedPath && (await pathExists(theoryStateResolvedPath))) {
    theoryFile = normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath));
  }

  const collection =
    normalizedPacket.role === "theorem" ||
    normalizedPacket.role === "proposition" ||
    normalizedPacket.role === "corollary"
      ? theoryFile.theorem_candidates
      : theoryFile.lemma_packets;
  const existingIndex = collection.findIndex((item) => item.packet_id === normalizedPacket.packet_id);
  if (existingIndex >= 0) {
    collection[existingIndex] = normalizedPacket;
  } else {
    collection.push(normalizedPacket);
  }
  theoryFile.updated_at = now;
  theoryFile.status = theoryFile.status === "missing" ? "draft" : theoryFile.status;
  if (theoryStateResolvedPath) {
    await writeJsonEnsured(theoryStateResolvedPath, serializeTheoryStateFile(theoryFile));
  }

  const next: TheorySupportState = {
    ...current,
    status: current.status === "missing" ? "draft" : current.status,
    theoremCount: theoryFile.theorem_candidates.length,
    lemmaCount: theoryFile.lemma_packets.length,
    proofPacketCount: theoryFile.theorem_candidates.length + theoryFile.lemma_packets.length,
    lastUpdatedAt: now,
    pendingReason: null,
  };
  manifest.theory_state = serializeTheorySupportState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    packet: normalizedPacket,
    packetResolvedPath,
    state: next,
  };
}

export async function materializeTheoryAppendix(params: {
  projectRoot: string;
  theoryMaterialization?: Record<string, unknown> | null;
}): Promise<{
  state: TheorySupportState;
  writingContract: WritingContractState;
  theoryStateResolvedPath: string | null;
  proofPacketDirResolvedPath: string | null;
  appendixPlanResolvedPath: string;
  appendixSectionResolvedPath: string;
  theoremCount: number;
  lemmaCount: number;
  bodySafeCount: number;
  appendixSectionCount: number;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeTheorySupportState(manifest.theory_state);
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const materializationPatch = asRecord(params.theoryMaterialization) ?? {};
  const now = new Date().toISOString();

  const theoryStateArtifactPath =
    pickString(materializationPatch, ["theoryStatePath", "theory_state_path"]) ??
    current.theoryStatePath ??
    DEFAULT_THEORY_STATE_PATH;
  const proofPacketDirArtifactPath =
    pickString(materializationPatch, ["proofPacketDir", "proof_packet_dir"]) ??
    current.proofPacketDir ??
    DEFAULT_PROOF_PACKET_DIR;
  const appendixPlanArtifactPath =
    pickString(materializationPatch, ["planPath", "plan_path"]) ??
    pickString(materializationPatch, ["appendixPacketPath", "appendix_packet_path"]) ??
    current.appendixPacketPath ??
    DEFAULT_THEORY_APPENDIX_PLAN_PATH;
  const appendixSectionArtifactPath =
    pickString(materializationPatch, ["appendixSectionPath", "appendix_section_path"]) ??
    pickString(materializationPatch, ["proofAppendixPath", "proof_appendix_path"]) ??
    writingContract.proofAppendixPath ??
    DEFAULT_THEORY_APPENDIX_SECTION_PATH;

  const theoryStateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    theoryStateArtifactPath
  );
  const proofPacketDirResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    proofPacketDirArtifactPath
  );
  const appendixPlanResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    appendixPlanArtifactPath
  );
  const appendixSectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    appendixSectionArtifactPath
  );

  if (!theoryStateResolvedPath || !proofPacketDirResolvedPath) {
    throw new Error("Theory state paths are not configured for this project.");
  }
  if (!appendixPlanResolvedPath || !appendixSectionResolvedPath) {
    throw new Error("Theory appendix output paths are not configured for this project.");
  }

  let theoryFile = normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath));
  const diskPackets: TheoryObjectPacket[] = [];
  if (await pathExists(proofPacketDirResolvedPath)) {
    const entries = await fs.readdir(proofPacketDirResolvedPath);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const packet = normalizeTheoryObjectPacket(
        await readJsonIfExists(path.join(proofPacketDirResolvedPath, entry))
      );
      if (packet) {
        diskPackets.push(packet);
      }
    }
  }

  const packets = dedupeTheoryPackets([
    ...diskPackets,
    ...theoryFile.theorem_candidates,
    ...theoryFile.lemma_packets,
  ]);
  if (packets.length === 0) {
    throw new Error(
      "No theorem or lemma proof packets are available. Run theorem/lemma synthesis before materializing appendix artifacts."
    );
  }

  const theoremCandidates = packets.filter((packet) =>
    ["theorem", "proposition", "corollary"].includes(packet.role)
  );
  const lemmaPackets = packets.filter(
    (packet) => !["theorem", "proposition", "corollary"].includes(packet.role)
  );
  const appendixSections = inferTheoryAppendixSections({
    packets,
    existingSections: theoryFile.appendix_sections,
  });
  const bodySafeCount = packets.filter((packet) => packet.body_safe).length;

  theoryFile = normalizeTheoryStateFile({
    ...serializeTheoryStateFile(theoryFile),
    status: bodySafeCount > 0 ? "ready" : "draft",
    theorem_candidates: theoremCandidates.map(serializeTheoryObjectPacket),
    lemma_packets: lemmaPackets.map(serializeTheoryObjectPacket),
    appendix_sections: appendixSections.map((section) => ({
      section_id: section.section_id,
      title: section.title,
      purpose: section.purpose,
      packet_ids: section.packet_ids,
    })),
    updated_at: now,
    pending_reason: null,
    main_text_proof_style:
      writingContract.mainTextProofStyle ??
      current.mainTextProofStyle ??
      theoryFile.main_text_proof_style,
  });
  await writeJsonEnsured(theoryStateResolvedPath, serializeTheoryStateFile(theoryFile));

  const appendixPlanMarkdown = buildTheoryAppendixPlanMarkdown({
    theoryFile,
    packets,
    appendixSections,
    appendixSectionPath: appendixSectionArtifactPath,
  });
  await fs.mkdir(path.dirname(appendixPlanResolvedPath), { recursive: true });
  await fs.writeFile(appendixPlanResolvedPath, appendixPlanMarkdown, "utf8");

  const appendixSectionDraft = buildTheoryAppendixSectionDraft({
    theoryFile,
    packets,
    appendixSections,
  });
  await fs.mkdir(path.dirname(appendixSectionResolvedPath), { recursive: true });
  await fs.writeFile(appendixSectionResolvedPath, appendixSectionDraft, "utf8");

  const nextTheoryState: TheorySupportState = {
    ...current,
    status: bodySafeCount > 0 ? "ready" : "draft",
    overallSignal: theoryFile.overall_signal ?? current.overallSignal,
    theoryStatePath: theoryStateArtifactPath,
    proofPacketDir: proofPacketDirArtifactPath,
    appendixPacketPath: appendixPlanArtifactPath,
    mainTextProofStyle:
      theoryFile.main_text_proof_style ?? current.mainTextProofStyle,
    bodyReady: bodySafeCount > 0,
    theoremCount: theoremCandidates.length,
    lemmaCount: lemmaPackets.length,
    proofPacketCount: packets.length,
    lastUpdatedAt: now,
    pendingReason: null,
  };
  const nextWritingContract: WritingContractState = {
    ...writingContract,
    proofAppendixRequired: true,
    proofAppendixPath: appendixSectionArtifactPath,
    proofAppendixStatus: "ready",
    theoryNotePath:
      writingContract.theoryNotePath ??
      current.sourceTheoryNotePath ??
      DEFAULT_THEORY_NOTE_PATH,
  };

  manifest.theory_state = serializeTheorySupportState(nextTheoryState);
  manifest.writing_contract = serializeWritingContractState(nextWritingContract);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: nextTheoryState,
    writingContract: nextWritingContract,
    theoryStateResolvedPath,
    proofPacketDirResolvedPath,
    appendixPlanResolvedPath,
    appendixSectionResolvedPath,
    theoremCount: theoremCandidates.length,
    lemmaCount: lemmaPackets.length,
    bodySafeCount,
    appendixSectionCount: appendixSections.length,
  };
}

export async function getCitationIntegrityStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: CitationIntegrityState;
  bibliographyResolvedPath: string | null;
  bibliographyExists: boolean;
  verificationReportResolvedPath: string | null;
  verificationReportExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeCitationIntegrityState(manifest.citation_integrity);
  const bibliographyResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.bibliographyPath
  );
  const verificationReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.verificationReportPath
  );
  return {
    state,
    bibliographyResolvedPath,
    bibliographyExists: bibliographyResolvedPath
      ? await pathExists(bibliographyResolvedPath)
      : false,
    verificationReportResolvedPath,
    verificationReportExists: verificationReportResolvedPath
      ? await pathExists(verificationReportResolvedPath)
      : false,
  };
}

export async function getWritingSessionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: WritingSessionState;
  sectionPacketDirResolvedPath: string | null;
  currentSectionPacketResolvedPath: string | null;
  currentSectionPacketExists: boolean;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeWritingSessionState(manifest.writing_session);
  const sectionPacketDirResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_WRITING_SECTION_PACKET_DIR
  );
  const currentSectionPacket = state.currentSection
    ? state.sectionPackets[state.currentSection] ?? null
    : null;
  const currentSectionPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    currentSectionPacket?.packetPath ?? null
  );
  return {
    state,
    sectionPacketDirResolvedPath,
    currentSectionPacketResolvedPath,
    currentSectionPacketExists: currentSectionPacketResolvedPath
      ? await pathExists(currentSectionPacketResolvedPath)
      : false,
    readyForSubmit: isWritingSessionReadyForSubmit(state),
  };
}

export async function getReviewSessionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ReviewSessionState;
  reviewPacketResolvedPath: string | null;
  reviewPacketExists: boolean;
  graphEvidenceSummaryResolvedPath: string | null;
  graphEvidenceSummaryExists: boolean;
  latestReviewResolvedPath: string | null;
  latestReviewExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeReviewSessionState(manifest.review_session);
  const reviewPacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.reviewPacketPath
  );
  const graphEvidenceSummaryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.graphEvidenceSummaryPath
  );
  const latestReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.latestReviewPath
  );
  return {
    state,
    reviewPacketResolvedPath,
    reviewPacketExists: reviewPacketResolvedPath
      ? await pathExists(reviewPacketResolvedPath)
      : false,
    graphEvidenceSummaryResolvedPath,
    graphEvidenceSummaryExists: graphEvidenceSummaryResolvedPath
      ? await pathExists(graphEvidenceSummaryResolvedPath)
      : false,
    latestReviewResolvedPath,
    latestReviewExists: latestReviewResolvedPath
      ? await pathExists(latestReviewResolvedPath)
      : false,
  };
}

export async function getGraphGuidedWritingStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: GraphGuidedWritingState;
  anchorIndexResolvedPath: string | null;
  anchorIndexExists: boolean;
  literatureResolvedPath: string | null;
  literatureExists: boolean;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeGraphGuidedWritingState(manifest.graph_guided_writing);
  const anchorIndexResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.anchorIndexPath
  );
  const literatureResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.literaturePath
  );
  return {
    state,
    anchorIndexResolvedPath,
    anchorIndexExists: anchorIndexResolvedPath
      ? await pathExists(anchorIndexResolvedPath)
      : false,
    literatureResolvedPath,
    literatureExists: literatureResolvedPath
      ? await pathExists(literatureResolvedPath)
      : false,
    readyForSubmit: isGraphGuidedWritingReadyForSubmit(state),
  };
}

export async function getExternalReviewStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ExternalReviewState;
  submittedPdfResolvedPath: string | null;
  submittedPdfExists: boolean;
  externalReviewResolvedPath: string | null;
  externalReviewExists: boolean;
  reviewResponseResolvedPath: string | null;
  reviewResponseExists: boolean;
  conclusionReady: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeExternalReviewState(manifest.external_review_state);
  const submittedPdfResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.submittedPdfPath
  );
  const externalReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.externalReviewPath
  );
  const reviewResponseResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.reviewResponsePath
  );
  return {
    state,
    submittedPdfResolvedPath,
    submittedPdfExists: submittedPdfResolvedPath
      ? await pathExists(submittedPdfResolvedPath)
      : false,
    externalReviewResolvedPath,
    externalReviewExists: externalReviewResolvedPath
      ? await pathExists(externalReviewResolvedPath)
      : false,
    reviewResponseResolvedPath,
    reviewResponseExists: reviewResponseResolvedPath
      ? await pathExists(reviewResponseResolvedPath)
      : false,
    conclusionReady: isExternalReviewConclusionReady(state),
  };
}

export async function getExperimentSearchStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ExperimentSearchState;
  stateFilePath: string;
  stateFileExists: boolean;
  evaluationSummaryResolvedPath: string | null;
  evaluationSummaryExists: boolean;
  plotPackResolvedPath: string | null;
  plotPackExists: boolean;
  readyForAnalysis: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
  });
  const stateFilePath = getExperimentSearchPath(params.projectRoot);
  const evaluationSummaryResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.evaluationSummaryPath
  );
  const plotPackResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.plotPackPath
  );
  return {
    state,
    stateFilePath,
    stateFileExists: await pathExists(stateFilePath),
    evaluationSummaryResolvedPath,
    evaluationSummaryExists: evaluationSummaryResolvedPath
      ? await pathExists(evaluationSummaryResolvedPath)
      : false,
    plotPackResolvedPath,
    plotPackExists: plotPackResolvedPath
      ? await pathExists(plotPackResolvedPath)
      : false,
    readyForAnalysis: isExperimentSearchReadyForAnalysis(state),
  };
}

export async function getPaperQcStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: PaperQcState;
  latestReportResolvedPath: string | null;
  latestReportExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizePaperQcState(manifest.paper_qc);
  const latestReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.latestReportPath
  );
  return {
    state,
    latestReportResolvedPath,
    latestReportExists: latestReportResolvedPath
      ? await pathExists(latestReportResolvedPath)
      : false,
    hardFailure: isPaperQcHardFailure(state),
  };
}

export async function getPaperIngestionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: PaperIngestionState;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return {
    state: normalizePaperIngestionState(manifest.paper_ingestion),
  };
}

export async function getCitationCollectionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: CitationCollectionState;
  progressResolvedPath: string | null;
  progressExists: boolean;
  cacheBibResolvedPath: string | null;
  cacheBibExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeCitationCollectionState(manifest.citation_collection);
  const progressResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.progressPath
  );
  const cacheBibResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.cacheBibPath
  );
  return {
    state,
    progressResolvedPath,
    progressExists: progressResolvedPath ? await pathExists(progressResolvedPath) : false,
    cacheBibResolvedPath,
    cacheBibExists: cacheBibResolvedPath ? await pathExists(cacheBibResolvedPath) : false,
    hardFailure: isCitationCollectionHardFailure(state),
  };
}

export async function getFigureQcStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: FigureQcState;
  figureReviewResolvedPath: string | null;
  figureReviewExists: boolean;
  figureSelectionResolvedPath: string | null;
  figureSelectionExists: boolean;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeFigureQcState(manifest.figure_qc);
  const figureReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.figureReviewPath
  );
  const figureSelectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.figureSelectionPath
  );
  return {
    state,
    figureReviewResolvedPath,
    figureReviewExists: figureReviewResolvedPath
      ? await pathExists(figureReviewResolvedPath)
      : false,
    figureSelectionResolvedPath,
    figureSelectionExists: figureSelectionResolvedPath
      ? await pathExists(figureSelectionResolvedPath)
      : false,
    hardFailure: isFigureQcHardFailure(state),
  };
}

export async function getReviewIssueTrackerStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ReviewIssueTrackerState;
  issueManifestResolvedPath: string | null;
  issueManifestExists: boolean;
  hardBlockersOpen: boolean;
  mediumOrHigherIssuesNeedDisposition: boolean;
  surfaceIssueCount: number;
  submissionIssueCount: number;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: manifest.review_issue_tracker,
  });
  const laneCounts = countReviewIssueLanes(state.issues);
  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.issueManifestPath
  );
  return {
    state,
    issueManifestResolvedPath,
    issueManifestExists: issueManifestResolvedPath
      ? await pathExists(issueManifestResolvedPath)
      : false,
    hardBlockersOpen: hasBlockingReviewIssues(state),
    mediumOrHigherIssuesNeedDisposition:
      hasUnwaivedMediumOrHigherReviewIssues(state),
    surfaceIssueCount: laneCounts.surface,
    submissionIssueCount: laneCounts.submission,
  };
}

export async function setIdleResearchState(params: {
  projectRoot: string;
  idleResearch: Record<string, unknown>;
}): Promise<{
  state: IdleResearchState;
  due: boolean;
  nextDueAt: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeIdleResearchState(manifest.idle_research);
  const patch = asRecord(params.idleResearch) ?? {};
  const next: IdleResearchState = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    topic: pickString(patch, ["topic"]) ?? current.topic,
    objective: pickString(patch, ["objective"]) ?? current.objective,
    querySeeds:
      patch.querySeeds || patch.query_seeds
        ? asStringArray(patch.querySeeds ?? patch.query_seeds)
        : current.querySeeds,
    preferredVenues:
      patch.preferredVenues || patch.preferred_venues
        ? asStringArray(patch.preferredVenues ?? patch.preferred_venues)
        : current.preferredVenues,
    maxPapersPerCycle:
      Math.max(
        1,
        Math.floor(
          pickNumber(patch, ["maxPapersPerCycle", "max_papers_per_cycle"]) ??
            current.maxPapersPerCycle
        )
      ),
    cooldownMinutes:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, ["cooldownMinutes", "cooldown_minutes"]) ??
            current.cooldownMinutes
        )
      ),
    status: normalizeStage(patch.status) ?? current.status,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    nextQueryHint:
      pickString(patch, ["nextQueryHint", "next_query_hint"]) ??
      current.nextQueryHint,
    refreshGraphOnNewCorePapers:
      pickBoolean(patch, [
        "refreshGraphOnNewCorePapers",
        "refresh_graph_on_new_core_papers",
      ]) ?? current.refreshGraphOnNewCorePapers,
    lastRunAt:
      pickString(patch, ["lastRunAt", "last_run_at"]) ?? current.lastRunAt,
    lastDigestPath:
      pickString(patch, ["lastDigestPath", "last_digest_path"]) ??
      current.lastDigestPath,
    lastSourceUpdateAt:
      pickString(patch, ["lastSourceUpdateAt", "last_source_update_at"]) ??
      current.lastSourceUpdateAt,
    lastRoundNewCanonicalPapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, [
            "lastRoundNewCanonicalPapers",
            "last_round_new_canonical_papers",
          ]) ?? current.lastRoundNewCanonicalPapers
        )
      ),
    lastRoundNewCorePapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(patch, [
            "lastRoundNewCorePapers",
            "last_round_new_core_papers",
          ]) ?? current.lastRoundNewCorePapers
        )
      ),
  };

  if (!next.enabled) {
    next.status = "disabled";
  } else if (next.topic && next.status === "disabled") {
    next.status = "pending";
  }

  manifest.idle_research = serializeIdleResearchState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: isIdleResearchDue(next),
    nextDueAt: computeIdleResearchNextDueAt(next),
  };
}

export async function setWritingContractState(params: {
  projectRoot: string;
  writingContract: Record<string, unknown>;
  policy?: WorkflowGuardPolicy;
}): Promise<{
  state: WritingContractState;
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateReady: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  paragraphLogicStatus: string;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritingContractState(manifest.writing_contract);
  const patch = asRecord(params.writingContract) ?? {};
  const requestedMode =
    normalizeWritingMode(patch.paperMode ?? patch.paper_mode) ?? current.paperMode;
  const hasKgStorylineRequiredPatch =
    Object.prototype.hasOwnProperty.call(patch, "kgStorylineRequired") ||
    Object.prototype.hasOwnProperty.call(patch, "kg_storyline_required");
  const requestedTemplatePath =
    patch.templatePath || patch.template_path
      ? pickString(patch, ["templatePath", "template_path"])
      : null;
  let templatePath = requestedTemplatePath ?? current.templatePath;
  let templateName =
    pickString(patch, ["templateName", "template_name"]) ?? current.templateName;
  let requiredSections =
    patch.requiredSections || patch.required_sections
      ? asStringArray(patch.requiredSections ?? patch.required_sections)
      : current.requiredSections;
  let sectionOrder =
    patch.sectionOrder || patch.section_order
      ? asStringArray(patch.sectionOrder ?? patch.section_order)
      : current.sectionOrder;
  let bodyPageBudget =
    pickNumber(patch, ["bodyPageBudget", "body_page_budget"]) ?? current.bodyPageBudget;
  let referencePageBudget =
    pickNumber(patch, ["referencePageBudget", "reference_page_budget"]) ??
    current.referencePageBudget;
  let bodyWordTargetMin =
    pickNumber(patch, ["bodyWordTargetMin", "body_word_target_min"]) ??
    current.bodyWordTargetMin;
  let bodyWordTargetMax =
    pickNumber(patch, ["bodyWordTargetMax", "body_word_target_max"]) ??
    current.bodyWordTargetMax;
  let maxCoreIdeas =
    pickNumber(patch, ["maxCoreIdeas", "max_core_ideas"]) ?? current.maxCoreIdeas;
  let maxHeadlineClaims =
    pickNumber(patch, ["maxHeadlineClaims", "max_headline_claims"]) ??
    current.maxHeadlineClaims;
  let storylineSource =
    pickString(patch, ["storylineSource", "storyline_source"]) ??
    current.storylineSource;
  let mainTextProofStyle =
    pickString(patch, ["mainTextProofStyle", "main_text_proof_style"]) ??
    current.mainTextProofStyle;
  let proofAppendixRequired =
    pickBoolean(patch, ["proofAppendixRequired", "proof_appendix_required"]) ??
    current.proofAppendixRequired;
  let proofAppendixPath =
    pickString(patch, ["proofAppendixPath", "proof_appendix_path"]) ??
    current.proofAppendixPath;
  let proofAppendixStatus =
    normalizeStage(patch.proofAppendixStatus ?? patch.proof_appendix_status) ??
    current.proofAppendixStatus;
  let theoryNotePath =
    pickString(patch, ["theoryNotePath", "theory_note_path"]) ??
    current.theoryNotePath;
  let proofChecklist =
    patch.proofChecklist || patch.proof_checklist
      ? asStringArray(patch.proofChecklist ?? patch.proof_checklist)
      : current.proofChecklist;
  let kgStorylineRequired =
    pickBoolean(patch, ["kgStorylineRequired", "kg_storyline_required"]) ??
    current.kgStorylineRequired;
  let kgStorylinePacketPath =
    pickString(patch, ["kgStorylinePacketPath", "kg_storyline_packet_path"]) ??
    current.kgStorylinePacketPath;
  let storylineChecklist =
    patch.storylineChecklist || patch.storyline_checklist
      ? asStringArray(patch.storylineChecklist ?? patch.storyline_checklist)
      : current.storylineChecklist;

  if (requestedMode) {
    const preset = WRITING_MODE_PRESETS[requestedMode];
    if (!requestedTemplatePath && (!templatePath || isBundledWritingModeTemplatePath(templatePath))) {
      templatePath =
        getConfiguredWritingModeTemplatePath(params.policy, requestedMode) ??
        (await resolveBundledWritingModeTemplatePath(requestedMode));
    }
    if (!templateName || templateName === current.templateName) {
      templateName = preset.templateName;
    }
    if (requiredSections.length === 0 || requestedMode !== current.paperMode) {
      requiredSections = [...preset.requiredSections];
    }
    if (sectionOrder.length === 0 || requestedMode !== current.paperMode) {
      sectionOrder = [...preset.sectionOrder];
    }
    bodyPageBudget = bodyPageBudget ?? preset.bodyPageBudget;
    referencePageBudget = referencePageBudget ?? preset.referencePageBudget;
    bodyWordTargetMin = bodyWordTargetMin ?? preset.bodyWordTargetMin;
    bodyWordTargetMax = bodyWordTargetMax ?? preset.bodyWordTargetMax;
    maxCoreIdeas = maxCoreIdeas ?? preset.maxCoreIdeas;
    maxHeadlineClaims = maxHeadlineClaims ?? preset.maxHeadlineClaims;
    storylineSource = storylineSource ?? "papernexus_kg";
    if (!hasKgStorylineRequiredPatch && requestedMode !== current.paperMode) {
      kgStorylineRequired = true;
    }
    kgStorylinePacketPath =
      kgStorylinePacketPath ?? DEFAULT_KG_STORYLINE_PACKET_PATH;
    if (storylineChecklist.length === 0) {
      storylineChecklist = [...DEFAULT_STORYLINE_CHECKLIST];
    }
    if (proofChecklist.length === 0) {
      proofChecklist = [...DEFAULT_PROOF_CHECKLIST];
    }
    mainTextProofStyle = mainTextProofStyle ?? "lemma_result_only";
    proofAppendixRequired = proofAppendixRequired ?? true;
    proofAppendixPath =
      proofAppendixPath ?? "academic_writer/paper/sections/appendix_theory.tex";
    theoryNotePath = theoryNotePath ?? "analyzer/THEORY_SUPPORT_NOTE.md";
  }

  let projectTemplatePath =
    pickString(patch, ["projectTemplatePath", "project_template_path"]) ??
    current.projectTemplatePath;
  let templateCopyStatus =
    normalizeStage(patch.templateCopyStatus ?? patch.template_copy_status) ??
    current.templateCopyStatus;

  const sourceTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    templatePath
  );
  if (sourceTemplateResolvedPath && (await pathExists(sourceTemplateResolvedPath))) {
    const copiedTemplate = await copyWritingTemplateIntoProject({
      projectRoot: params.projectRoot,
      sourcePath: sourceTemplateResolvedPath,
      paperMode: requestedMode,
    });
    projectTemplatePath = copiedTemplate.projectTemplatePath;
    templateCopyStatus = "ready";
  } else if (templatePath) {
    projectTemplatePath = current.projectTemplatePath;
    templateCopyStatus = "missing";
  }

  const next: WritingContractState = {
    ...current,
    paperMode: requestedMode,
    templateRequired:
      pickBoolean(patch, ["templateRequired", "template_required"]) ??
      current.templateRequired,
    templatePath,
    projectTemplatePath,
    templateName,
    templateStatus:
      normalizeStage(patch.templateStatus ?? patch.template_status) ??
      current.templateStatus,
    templateCopyStatus,
    bodyPageBudget:
      bodyPageBudget == null ? null : Math.max(1, Math.floor(bodyPageBudget)),
    referencePageBudget:
      referencePageBudget == null ? null : Math.max(1, Math.floor(referencePageBudget)),
    bodyWordTargetMin:
      bodyWordTargetMin == null ? null : Math.max(500, Math.floor(bodyWordTargetMin)),
    bodyWordTargetMax:
      bodyWordTargetMax == null ? null : Math.max(500, Math.floor(bodyWordTargetMax)),
    maxCoreIdeas: Math.max(1, Math.floor(maxCoreIdeas ?? current.maxCoreIdeas)),
    maxHeadlineClaims: Math.max(
      1,
      Math.floor(maxHeadlineClaims ?? current.maxHeadlineClaims)
    ),
    mainTextProofStyle,
    proofAppendixRequired,
    proofAppendixPath,
    proofAppendixStatus,
    theoryNotePath,
    proofChecklist,
    storylineSource,
    kgStorylineRequired,
    kgStorylineStatus:
      normalizeStage(patch.kgStorylineStatus ?? patch.kg_storyline_status) ??
      current.kgStorylineStatus,
    kgStorylinePacketPath,
    storylineChecklist,
    requiredSections,
    sectionOrder,
    paragraphLogicChecklist:
      patch.paragraphLogicChecklist || patch.paragraph_logic_checklist
        ? asStringArray(
            patch.paragraphLogicChecklist ?? patch.paragraph_logic_checklist
          )
        : current.paragraphLogicChecklist,
    paragraphLogicStatus:
      normalizeStage(
        patch.paragraphLogicStatus ?? patch.paragraph_logic_status
      ) ?? current.paragraphLogicStatus,
    lastTemplateAppliedAt:
      pickString(patch, ["lastTemplateAppliedAt", "last_template_applied_at"]) ??
      current.lastTemplateAppliedAt,
    lastParagraphLogicAuditAt:
      pickString(patch, [
        "lastParagraphLogicAuditAt",
        "last_paragraph_logic_audit_at",
      ]) ?? current.lastParagraphLogicAuditAt,
    templateMappingPath:
      pickString(patch, ["templateMappingPath", "template_mapping_path"]) ??
      current.templateMappingPath,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (next.requiredSections.length === 0) {
    next.requiredSections = [...DEFAULT_WRITING_SECTION_ORDER];
  }
  if (next.sectionOrder.length === 0) {
    next.sectionOrder = [...DEFAULT_WRITING_SECTION_ORDER];
  }
  if (next.storylineChecklist.length === 0) {
    next.storylineChecklist = [...DEFAULT_STORYLINE_CHECKLIST];
  }
  if (next.proofChecklist.length === 0) {
    next.proofChecklist = [...DEFAULT_PROOF_CHECKLIST];
  }
  if (next.paragraphLogicChecklist.length === 0) {
    next.paragraphLogicChecklist = [...DEFAULT_PARAGRAPH_LOGIC_CHECKLIST];
  }

  const evaluation = await evaluateWritingContractState({
    projectRoot: params.projectRoot,
    state: next,
  });
  next.templateStatus = evaluation.templateStatus;
  next.templateCopyStatus = evaluation.templateCopyStatus;
  next.pendingReason = evaluation.pendingReason;

  manifest.writing_contract = serializeWritingContractState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    templateResolvedPath: evaluation.templateResolvedPath,
    projectTemplateResolvedPath: evaluation.projectTemplateResolvedPath,
    sourceTemplateResolvedPath: evaluation.sourceTemplateResolvedPath,
    templateExists: evaluation.templateExists,
    templateReady:
      !next.templateRequired ||
      Boolean(evaluation.templateResolvedPath && evaluation.templateExists),
    templateStatus: evaluation.templateStatus,
    templateCopyStatus: evaluation.templateCopyStatus,
    paragraphLogicStatus: next.paragraphLogicStatus,
  };
}

export async function setWritingSessionState(params: {
  projectRoot: string;
  writingSession: Record<string, unknown>;
}): Promise<{
  state: WritingSessionState;
  currentSectionPacketResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritingSessionState(manifest.writing_session);
  const patch = asRecord(params.writingSession) ?? {};
  const sectionPacketsPatch = asRecord(
    patch.sectionPackets ?? patch.section_packets
  );
  const next: WritingSessionState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    currentSection:
      normalizeStage(patch.currentSection ?? patch.current_section) ??
      current.currentSection,
    draftOrder:
      patch.draftOrder || patch.draft_order
        ? asStringArray(patch.draftOrder ?? patch.draft_order)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.draftOrder,
    finalizedSections:
      patch.finalizedSections || patch.finalized_sections
        ? asStringArray(patch.finalizedSections ?? patch.finalized_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.finalizedSections,
    compileSafeSections:
      patch.compileSafeSections || patch.compile_safe_sections
        ? asStringArray(patch.compileSafeSections ?? patch.compile_safe_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.compileSafeSections,
    sectionPackets: sectionPacketsPatch
      ? Object.fromEntries(
          Object.entries(sectionPacketsPatch).map(([key, value]) => [
            normalizeStage(key) ?? key,
            normalizeWritingSectionPacketState(key, value),
          ])
        )
      : current.sectionPackets,
    headlineClaimEvidenceStatus:
      normalizeStage(
        patch.headlineClaimEvidenceStatus ?? patch.headline_claim_evidence_status
      ) ?? current.headlineClaimEvidenceStatus,
    graphEvidenceCoverageStatus:
      normalizeStage(
        patch.graphEvidenceCoverageStatus ?? patch.graph_evidence_coverage_status
      ) ?? current.graphEvidenceCoverageStatus,
    graphEvidenceCoverageSummary:
      pickString(patch, [
        "graphEvidenceCoverageSummary",
        "graph_evidence_coverage_summary",
      ]) ?? current.graphEvidenceCoverageSummary,
    citationPlanMode:
      normalizeStage(patch.citationPlanMode ?? patch.citation_plan_mode) ??
      current.citationPlanMode,
    externalScholarQueryMode:
      normalizeStage(
        patch.externalScholarQueryMode ?? patch.external_scholar_query_mode
      ) ?? current.externalScholarQueryMode,
    futureScholarVerificationSkill:
      pickString(patch, [
        "futureScholarVerificationSkill",
        "future_scholar_verification_skill",
      ]) ?? current.futureScholarVerificationSkill,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  manifest.writing_session = serializeWritingSessionState(next);
  await saveManifest(params.projectRoot, manifest);

  const currentSectionPacket = next.currentSection
    ? next.sectionPackets[next.currentSection] ?? null
    : null;
  return {
    state: next,
    currentSectionPacketResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      currentSectionPacket?.packetPath ?? null
    ),
    readyForSubmit: isWritingSessionReadyForSubmit(next),
  };
}

export async function setReviewSessionState(params: {
  projectRoot: string;
  reviewSession: Record<string, unknown>;
}): Promise<{
  state: ReviewSessionState;
  reviewPacketResolvedPath: string | null;
  latestReviewResolvedPath: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeReviewSessionState(manifest.review_session);
  const patch = asRecord(params.reviewSession) ?? {};
  const next: ReviewSessionState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    stageScope:
      normalizeStage(patch.stageScope ?? patch.stage_scope) ?? current.stageScope,
    round: Math.max(
      0,
      Math.floor(pickNumber(patch, ["round"]) ?? current.round)
    ),
    reviewPacketPath:
      pickString(patch, ["reviewPacketPath", "review_packet_path"]) ??
      current.reviewPacketPath,
    graphEvidenceSummaryPath:
      pickString(patch, [
        "graphEvidenceSummaryPath",
        "graph_evidence_summary_path",
      ]) ?? current.graphEvidenceSummaryPath,
    latestReviewPath:
      pickString(patch, ["latestReviewPath", "latest_review_path"]) ??
      current.latestReviewPath,
    verdict: pickString(patch, ["verdict"]) ?? current.verdict,
    rubric:
      patch.rubric != null
        ? normalizeReviewSessionRubric(patch.rubric)
        : current.rubric,
    reviewerSummary:
      pickString(patch, ["reviewerSummary", "reviewer_summary"]) ??
      current.reviewerSummary,
    actionItems:
      patch.actionItems || patch.action_items
        ? asStringArray(patch.actionItems ?? patch.action_items)
        : current.actionItems,
    blockingArtifacts:
      patch.blockingArtifacts || patch.blocking_artifacts
        ? asStringArray(patch.blockingArtifacts ?? patch.blocking_artifacts)
        : current.blockingArtifacts,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  manifest.review_session = serializeReviewSessionState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    reviewPacketResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.reviewPacketPath
    ),
    latestReviewResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.latestReviewPath
    ),
  };
}

export async function setGraphGuidedWritingState(params: {
  projectRoot: string;
  graphGuidedWriting: Record<string, unknown>;
}): Promise<{
  state: GraphGuidedWritingState;
  anchorIndexResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeGraphGuidedWritingState(manifest.graph_guided_writing);
  const patch = asRecord(params.graphGuidedWriting) ?? {};
  const next: GraphGuidedWritingState = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    status: normalizeStage(patch.status) ?? current.status,
    anchorIndexPath:
      pickString(patch, ["anchorIndexPath", "anchor_index_path"]) ??
      current.anchorIndexPath,
    frontierFiles:
      patch.frontierFiles || patch.frontier_files
        ? asStringArray(patch.frontierFiles ?? patch.frontier_files)
        : current.frontierFiles,
    literaturePath:
      pickString(patch, ["literaturePath", "literature_path"]) ??
      current.literaturePath,
    claimEvidencePacketPaths:
      patch.claimEvidencePacketPaths || patch.claim_evidence_packet_paths
        ? asStringArray(
            patch.claimEvidencePacketPaths ?? patch.claim_evidence_packet_paths
          )
        : current.claimEvidencePacketPaths,
    requiredEvidencePointerCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "requiredEvidencePointerCount",
          "required_evidence_pointer_count",
        ]) ?? current.requiredEvidencePointerCount
      )
    ),
    coveredHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "coveredHeadlineClaimCount",
          "covered_headline_claim_count",
        ]) ?? current.coveredHeadlineClaimCount
      )
    ),
    totalHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "totalHeadlineClaimCount",
          "total_headline_claim_count",
        ]) ?? current.totalHeadlineClaimCount
      )
    ),
    evidenceCoverageStatus:
      normalizeStage(
        patch.evidenceCoverageStatus ?? patch.evidence_coverage_status
      ) ?? current.evidenceCoverageStatus,
    missingEvidenceClaims:
      patch.missingEvidenceClaims || patch.missing_evidence_claims
        ? asStringArray(
            patch.missingEvidenceClaims ?? patch.missing_evidence_claims
          )
        : current.missingEvidenceClaims,
    citationSourceMode:
      normalizeStage(patch.citationSourceMode ?? patch.citation_source_mode) ??
      current.citationSourceMode,
    scholarQueryReserved:
      pickBoolean(patch, ["scholarQueryReserved", "scholar_query_reserved"]) ??
      current.scholarQueryReserved,
    scholarQuerySkillSlot:
      pickString(patch, ["scholarQuerySkillSlot", "scholar_query_skill_slot"]) ??
      current.scholarQuerySkillSlot,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  manifest.graph_guided_writing = serializeGraphGuidedWritingState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    anchorIndexResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.anchorIndexPath
    ),
    readyForSubmit: isGraphGuidedWritingReadyForSubmit(next),
  };
}

export async function setExternalReviewState(params: {
  projectRoot: string;
  externalReview: Record<string, unknown>;
}): Promise<{
  state: ExternalReviewState;
  submittedPdfResolvedPath: string | null;
  externalReviewResolvedPath: string | null;
  reviewResponseResolvedPath: string | null;
  conclusionReady: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeExternalReviewState(manifest.external_review_state);
  const patch = asRecord(params.externalReview) ?? {};
  const next: ExternalReviewState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    provider: pickString(patch, ["provider"]) ?? current.provider,
    reviewSkill:
      pickString(patch, ["reviewSkill", "review_skill"]) ?? current.reviewSkill,
    sourceLabel:
      pickString(patch, ["sourceLabel", "source_label"]) ?? current.sourceLabel,
    submissionId:
      pickString(patch, ["submissionId", "submission_id"]) ?? current.submissionId,
    submittedPdfPath:
      pickString(patch, ["submittedPdfPath", "submitted_pdf_path"]) ??
      current.submittedPdfPath,
    externalReviewPath:
      pickString(patch, ["externalReviewPath", "external_review_path"]) ??
      current.externalReviewPath,
    reviewResponsePath:
      pickString(patch, ["reviewResponsePath", "review_response_path"]) ??
      current.reviewResponsePath,
    overallRecommendation:
      pickString(patch, [
        "overallRecommendation",
        "overall_recommendation",
      ]) ?? current.overallRecommendation,
    requiredAction:
      pickString(patch, ["requiredAction", "required_action"]) ??
      current.requiredAction,
    lastPolledAt:
      pickString(patch, ["lastPolledAt", "last_polled_at"]) ?? current.lastPolledAt,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (isExternalReviewConclusionReady(next)) {
    next.pendingReason = null;
  } else if (!next.pendingReason) {
    next.pendingReason =
      "Mandatory external Stanford review is not yet concluded. Submit the compiled PDF and persist the review outcome before completion.";
  }

  manifest.external_review_state = serializeExternalReviewState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    submittedPdfResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.submittedPdfPath
    ),
    externalReviewResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.externalReviewPath
    ),
    reviewResponseResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.reviewResponsePath
    ),
    conclusionReady: isExternalReviewConclusionReady(next),
  };
}

export async function setBrainstormCycleState(params: {
  projectRoot: string;
  brainstormCycle: Record<string, unknown>;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const patch = asRecord(params.brainstormCycle) ?? {};
  const trackId =
    pickString(patch, ["trackId", "track_id"]) ?? current.trackId;
  const defaultPaths = getBrainstormCycleDefaultPaths(trackId);
  const preferScopedDefaults = Boolean(trackId && trackId !== current.trackId);
  const next = normalizeBrainstormCycleState({
    ...serializeBrainstormCycleState(current),
    ...patch,
    track_id: trackId,
    topic_summary_path:
      pickString(patch, ["topicSummaryPath", "topic_summary_path"]) ??
      (preferScopedDefaults ? defaultPaths.topicSummaryPath : current.topicSummaryPath) ??
      defaultPaths.topicSummaryPath,
    research_brief_path:
      pickString(patch, ["researchBriefPath", "research_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.researchBriefPath : current.researchBriefPath) ??
      defaultPaths.researchBriefPath,
    brainstorm_brief_path:
      pickString(patch, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.brainstormBriefPath : current.brainstormBriefPath) ??
      defaultPaths.brainstormBriefPath,
    logic_chain_path:
      pickString(patch, ["logicChainPath", "logic_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.logicChainPath : current.logicChainPath) ??
      defaultPaths.logicChainPath,
    evidence_chain_path:
      pickString(patch, ["evidenceChainPath", "evidence_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.evidenceChainPath : current.evidenceChainPath) ??
      defaultPaths.evidenceChainPath,
    reasoning_trace_path:
      pickString(patch, ["reasoningTracePath", "reasoning_trace_path"]) ??
      (preferScopedDefaults ? defaultPaths.reasoningTracePath : current.reasoningTracePath) ??
      defaultPaths.reasoningTracePath,
    question_packet_path:
      pickString(patch, ["questionPacketPath", "question_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.questionPacketPath : current.questionPacketPath) ??
      defaultPaths.questionPacketPath,
    working_memory_path:
      pickString(patch, ["workingMemoryPath", "working_memory_path"]) ??
      (preferScopedDefaults ? defaultPaths.workingMemoryPath : current.workingMemoryPath) ??
      defaultPaths.workingMemoryPath,
    synthesis_packet_path:
      pickString(patch, ["synthesisPacketPath", "synthesis_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.synthesisPacketPath : current.synthesisPacketPath) ??
      defaultPaths.synthesisPacketPath,
    reflection_chain_path:
      pickString(patch, ["reflectionChainPath", "reflection_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.reflectionChainPath : current.reflectionChainPath) ??
      defaultPaths.reflectionChainPath,
    theory_brief_path:
      pickString(patch, ["theoryBriefPath", "theory_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.theoryBriefPath : current.theoryBriefPath) ??
      defaultPaths.theoryBriefPath,
    storyline_brief_path:
      pickString(patch, ["storylineBriefPath", "storyline_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.storylineBriefPath : current.storylineBriefPath) ??
      defaultPaths.storylineBriefPath,
  });
  manifest.brainstorm_cycle = serializeBrainstormCycleState(next);
  await saveManifest(params.projectRoot, manifest);
  const summary = await getBrainstormCycleStateSummary({
    projectRoot: params.projectRoot,
  });
  return {
    state: next,
    validationErrors: summary.validationErrors,
    chainBundleReady: summary.chainBundleReady,
  };
}

export async function runBrainstormCycle(params: {
  projectRoot: string;
  brainstormCycle: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
  selectedRoundId: string | null;
  selectedOptionId: string | null;
  topicSummaryResolvedPath: string | null;
  researchBriefResolvedPath: string | null;
  brainstormBriefResolvedPath: string | null;
  logicChainResolvedPath: string | null;
  evidenceChainResolvedPath: string | null;
  reasoningTraceResolvedPath: string | null;
  questionPacketResolvedPath: string | null;
  workingMemoryResolvedPath: string | null;
  synthesisPacketResolvedPath: string | null;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifestEnsured(projectRoot);
  const current = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const patch = asRecord(params.brainstormCycle) ?? {};
  const trackId =
    pickString(patch, ["trackId", "track_id"]) ?? current.trackId;
  const defaultPaths = getBrainstormCycleDefaultPaths(trackId);
  const preferScopedDefaults = Boolean(trackId && trackId !== current.trackId);
  const selection = selectBrainstormCandidate({
    brainstormCycle: patch,
    current,
  });
  const next = normalizeBrainstormCycleState({
    ...serializeBrainstormCycleState(current),
    ...patch,
    mode: pickString(patch, ["mode"]) ?? current.mode,
    track_id: trackId,
    selection_mode: selection?.mode ?? current.selectionMode,
    selected_round_id:
      selection?.round.roundId ??
      pickString(patch, ["selectedRoundId", "selected_round_id"]) ??
      current.selectedRoundId,
    selected_option_id:
      selection?.option.optionId ??
      pickString(patch, ["selectedOptionId", "selected_option_id"]) ??
      current.selectedOptionId,
    selected_option_title:
      selection?.option.title ??
      pickString(patch, ["selectedOptionTitle", "selected_option_title"]) ??
      current.selectedOptionTitle,
    selected_option_score:
      selection?.option.score ??
      pickNumber(patch, ["selectedOptionScore", "selected_option_score"]) ??
      current.selectedOptionScore,
    status:
      normalizeStage(patch.status) ??
      (selection ? "reconciled" : current.status),
    topic_summary_path:
      pickString(patch, ["topicSummaryPath", "topic_summary_path"]) ??
      (preferScopedDefaults ? defaultPaths.topicSummaryPath : current.topicSummaryPath) ??
      defaultPaths.topicSummaryPath,
    research_brief_path:
      pickString(patch, ["researchBriefPath", "research_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.researchBriefPath : current.researchBriefPath) ??
      defaultPaths.researchBriefPath,
    brainstorm_brief_path:
      pickString(patch, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.brainstormBriefPath : current.brainstormBriefPath) ??
      defaultPaths.brainstormBriefPath,
    logic_chain_path:
      pickString(patch, ["logicChainPath", "logic_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.logicChainPath : current.logicChainPath) ??
      defaultPaths.logicChainPath,
    evidence_chain_path:
      pickString(patch, ["evidenceChainPath", "evidence_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.evidenceChainPath : current.evidenceChainPath) ??
      defaultPaths.evidenceChainPath,
    reasoning_trace_path:
      pickString(patch, ["reasoningTracePath", "reasoning_trace_path"]) ??
      (preferScopedDefaults ? defaultPaths.reasoningTracePath : current.reasoningTracePath) ??
      defaultPaths.reasoningTracePath,
    question_packet_path:
      pickString(patch, ["questionPacketPath", "question_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.questionPacketPath : current.questionPacketPath) ??
      defaultPaths.questionPacketPath,
    working_memory_path:
      pickString(patch, ["workingMemoryPath", "working_memory_path"]) ??
      (preferScopedDefaults ? defaultPaths.workingMemoryPath : current.workingMemoryPath) ??
      defaultPaths.workingMemoryPath,
    synthesis_packet_path:
      pickString(patch, ["synthesisPacketPath", "synthesis_packet_path"]) ??
      (preferScopedDefaults ? defaultPaths.synthesisPacketPath : current.synthesisPacketPath) ??
      defaultPaths.synthesisPacketPath,
    reflection_chain_path:
      pickString(patch, ["reflectionChainPath", "reflection_chain_path"]) ??
      (preferScopedDefaults ? defaultPaths.reflectionChainPath : current.reflectionChainPath) ??
      defaultPaths.reflectionChainPath,
    theory_brief_path:
      pickString(patch, ["theoryBriefPath", "theory_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.theoryBriefPath : current.theoryBriefPath) ??
      defaultPaths.theoryBriefPath,
    storyline_brief_path:
      pickString(patch, ["storylineBriefPath", "storyline_brief_path"]) ??
      (preferScopedDefaults ? defaultPaths.storylineBriefPath : current.storylineBriefPath) ??
      defaultPaths.storylineBriefPath,
    latest_run_at:
      pickString(patch, ["latestRunAt", "latest_run_at"]) ??
      new Date().toISOString(),
  });

  const artifactSpecs: Array<{
    payload: unknown;
    targetPath: string | null;
    writer: "json" | "text" | "trace";
  }> = [
    {
      payload: pickBrainstormPayload(patch, ["topic_summary", "topicSummary"]),
      targetPath: next.topicSummaryPath,
      writer: "json",
    },
    {
      payload: pickBrainstormPayload(patch, ["research_brief", "researchBrief"]),
      targetPath: next.researchBriefPath,
      writer: "json",
    },
    {
      payload: pickBrainstormPayload(patch, ["brainstorm_brief", "brainstormBrief"]),
      targetPath: next.brainstormBriefPath,
      writer: "json",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "logic_chain",
          "logicChain",
        ]) ?? pickBrainstormPayload(patch, ["logic_chain", "logicChain"]),
      targetPath: next.logicChainPath,
      writer: "text",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "evidence_chain",
          "evidenceChain",
        ]) ?? pickBrainstormPayload(patch, ["evidence_chain", "evidenceChain"]),
      targetPath: next.evidenceChainPath,
      writer: "text",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "reasoning_trace",
          "reasoningTrace",
        ]) ?? pickBrainstormPayload(patch, ["reasoning_trace", "reasoningTrace"]),
      targetPath: next.reasoningTracePath,
      writer: "trace",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "question_packet",
          "questionPacket",
        ]) ?? pickBrainstormPayload(patch, ["question_packet", "questionPacket"]),
      targetPath: next.questionPacketPath,
      writer: "text",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "working_memory",
          "workingMemory",
        ]) ?? pickBrainstormPayload(patch, ["working_memory", "workingMemory"]),
      targetPath: next.workingMemoryPath,
      writer: "json",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "synthesis_packet",
          "synthesisPacket",
        ]) ?? pickBrainstormPayload(patch, ["synthesis_packet", "synthesisPacket"]),
      targetPath: next.synthesisPacketPath,
      writer: "text",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "reflection_chain",
          "reflectionChain",
        ]) ?? pickBrainstormPayload(patch, ["reflection_chain", "reflectionChain"]),
      targetPath: next.reflectionChainPath,
      writer: "json",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "theory_brief",
          "theoryBrief",
        ]) ?? pickBrainstormPayload(patch, ["theory_brief", "theoryBrief"]),
      targetPath: next.theoryBriefPath,
      writer: "json",
    },
    {
      payload:
        pickBrainstormPayload(selection?.optionRecord ?? {}, [
          "storyline_brief",
          "storylineBrief",
        ]) ?? pickBrainstormPayload(patch, ["storyline_brief", "storylineBrief"]),
      targetPath: next.storylineBriefPath,
      writer: "json",
    },
  ];

  for (const spec of artifactSpecs) {
    const resolved = resolveProjectArtifactPath(projectRoot, spec.targetPath);
    if (!resolved || !hasMeaningfulPayload(spec.payload)) {
      continue;
    }
    if (spec.writer === "json") {
      await writeJsonEnsured(resolved, spec.payload);
    } else if (spec.writer === "trace") {
      await writeTextEnsured(resolved, renderReasoningTracePayload(spec.payload));
    } else {
      await writeTextEnsured(resolved, renderMarkdownishPayload(spec.payload));
    }
  }

  if (trackId) {
    const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
    const trackRegistry = await readJsonIfExists<TrackRegistryLike>(trackRegistryPath);
    const tracks = Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [];
    let changed = false;
    for (const entry of tracks) {
      const track = asRecord(entry);
      if (!track) {
        continue;
      }
      const candidateTrackId = pickString(track, ["track_id", "trackId"]);
      if (candidateTrackId !== trackId) {
        continue;
      }
      track.reasoning_packet_dir = getBrainstormCycleRootRelativeDir(trackId);
      track.working_memory_path = next.workingMemoryPath;
      track.synthesis_packet_path = next.synthesisPacketPath;
      changed = true;
    }
    if (changed && trackRegistry) {
      await writeJsonEnsured(trackRegistryPath, trackRegistry);
    }
  }

  manifest.brainstorm_cycle = serializeBrainstormCycleState(next);
  await saveManifest(projectRoot, manifest);
  const summary = await getBrainstormCycleStateSummary({ projectRoot });
  return {
    state: next,
    validationErrors: summary.validationErrors,
    chainBundleReady: summary.chainBundleReady,
    selectedRoundId: next.selectedRoundId,
    selectedOptionId: next.selectedOptionId,
    topicSummaryResolvedPath: summary.topicSummaryResolvedPath,
    researchBriefResolvedPath: summary.researchBriefResolvedPath,
    brainstormBriefResolvedPath: summary.brainstormBriefResolvedPath,
    logicChainResolvedPath: summary.logicChainResolvedPath,
    evidenceChainResolvedPath: summary.evidenceChainResolvedPath,
    reasoningTraceResolvedPath: summary.reasoningTraceResolvedPath,
    questionPacketResolvedPath: summary.questionPacketResolvedPath,
    workingMemoryResolvedPath: summary.workingMemoryResolvedPath,
    synthesisPacketResolvedPath: summary.synthesisPacketResolvedPath,
  };
}

export async function setResearchProgramState(params: {
  projectRoot: string;
  researchProgram: Record<string, unknown>;
}): Promise<{
  state: ResearchProgramState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeResearchProgramState(manifest.research_program);
  const patch = asRecord(params.researchProgram) ?? {};
  const patchedTaskGraph = Array.isArray(patch.taskGraph ?? patch.task_graph)
    ? ((patch.taskGraph ?? patch.task_graph) as unknown[])
    : [];
  const merged = normalizeResearchProgramState({
    ...serializeResearchProgramState(current),
    ...patch,
    tracks:
      Array.isArray(patch.tracks) && patch.tracks.length > 0
        ? patch.tracks
        : current.tracks.map((track) => serializeResearchProgramTrack(track)),
    task_graph:
      patchedTaskGraph.length > 0
        ? patchedTaskGraph
        : current.taskGraph.map((task) => serializeResearchProgramTask(task)),
    global_constraints:
      asRecord(patch.globalConstraints ?? patch.global_constraints) ?? current.globalConstraints,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  });
  manifest.research_program = serializeResearchProgramState(merged);
  await saveManifest(params.projectRoot, manifest);
  return {
    state: merged,
    validationErrors: getResearchProgramValidationErrors(merged),
  };
}

export async function setOrchestrationState(params: {
  projectRoot: string;
  orchestrationState: Record<string, unknown>;
}): Promise<{
  state: OrchestrationState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeOrchestrationState(manifest.orchestration_state);
  const patch = asRecord(params.orchestrationState) ?? {};
  const next: OrchestrationState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    activeTicketId:
      pickString(patch, ["activeTicketId", "active_ticket_id"]) ??
      current.activeTicketId,
    stageRunId:
      pickString(patch, ["stageRunId", "stage_run_id"]) ?? current.stageRunId,
    currentOwner:
      pickString(patch, ["currentOwner", "current_owner"]) ?? current.currentOwner,
    nextOwner:
      pickString(patch, ["nextOwner", "next_owner"]) ?? current.nextOwner,
    nextTransitionCandidate:
      pickString(patch, [
        "nextTransitionCandidate",
        "next_transition_candidate",
      ]) ?? current.nextTransitionCandidate,
    blockingCategory:
      pickString(patch, ["blockingCategory", "blocking_category"]) ??
      current.blockingCategory,
    blockingReason:
      pickString(patch, ["blockingReason", "blocking_reason"]) ??
      current.blockingReason,
    retryBudgetRemaining:
      pickNumber(patch, ["retryBudgetRemaining", "retry_budget_remaining"]) ??
      current.retryBudgetRemaining,
    lastContractEvalAt:
      pickString(patch, ["lastContractEvalAt", "last_contract_eval_at"]) ??
      current.lastContractEvalAt,
    lastContractEvalResult:
      pickString(patch, [
        "lastContractEvalResult",
        "last_contract_eval_result",
      ]) ?? current.lastContractEvalResult,
    rollbackTargetStage:
      pickString(patch, ["rollbackTargetStage", "rollback_target_stage"]) ??
      current.rollbackTargetStage,
    resumeCursor:
      pickString(patch, ["resumeCursor", "resume_cursor"]) ?? current.resumeCursor,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };
  manifest.orchestration_state = serializeOrchestrationState(next);
  await saveManifest(params.projectRoot, manifest);
  return {
    state: next,
    validationErrors: getOrchestrationStateValidationErrors(
      next,
      normalizeStage(manifest.current_stage)
    ),
  };
}

export async function setWritePackageState(params: {
  projectRoot: string;
  writePackage: Record<string, unknown>;
}): Promise<{
  state: WritePackageState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritePackageState(manifest.write_package);
  const patch = asRecord(params.writePackage) ?? {};
  const next: WritePackageState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    assemblyStatus:
      normalizeStage(patch.assemblyStatus ?? patch.assembly_status) ??
      current.assemblyStatus,
    assemblyMode:
      pickString(patch, ["assemblyMode", "assembly_mode"]) ??
      current.assemblyMode,
    winningTrackIds:
      patch.winningTrackIds || patch.winning_track_ids
        ? asStringArray(patch.winningTrackIds ?? patch.winning_track_ids)
        : current.winningTrackIds,
    claimEvidenceMatrixPath:
      pickString(patch, [
        "claimEvidenceMatrixPath",
        "claim_evidence_matrix_path",
      ]) ?? current.claimEvidenceMatrixPath,
    narrativeReportPath:
      pickString(patch, ["narrativeReportPath", "narrative_report_path"]) ??
      current.narrativeReportPath,
    trackVerdictsPath:
      pickString(patch, ["trackVerdictsPath", "track_verdicts_path"]) ??
      current.trackVerdictsPath,
    unsupportedClaimsPath:
      pickString(patch, ["unsupportedClaimsPath", "unsupported_claims_path"]) ??
      current.unsupportedClaimsPath,
    baselineSummaryPath:
      pickString(patch, ["baselineSummaryPath", "baseline_summary_path"]) ??
      current.baselineSummaryPath,
    researchSummaryPath:
      pickString(patch, ["researchSummaryPath", "research_summary_path"]) ??
      current.researchSummaryPath,
    ablationSummaryPath:
      pickString(patch, ["ablationSummaryPath", "ablation_summary_path"]) ??
      current.ablationSummaryPath,
    evaluationSummaryPath:
      pickString(patch, ["evaluationSummaryPath", "evaluation_summary_path"]) ??
      current.evaluationSummaryPath,
    figurePackPath:
      pickString(patch, ["figurePackPath", "figure_pack_path"]) ??
      current.figurePackPath,
    tablePackPath:
      pickString(patch, ["tablePackPath", "table_pack_path"]) ??
      current.tablePackPath,
    proofPacketDir:
      pickString(patch, ["proofPacketDir", "proof_packet_dir"]) ??
      current.proofPacketDir,
    citationCandidatesPath:
      pickString(patch, [
        "citationCandidatesPath",
        "citation_candidates_path",
      ]) ?? current.citationCandidatesPath,
    packageManifestPath:
      pickString(patch, ["packageManifestPath", "package_manifest_path"]) ??
      current.packageManifestPath,
    assemblyReportPath:
      pickString(patch, ["assemblyReportPath", "assembly_report_path"]) ??
      current.assemblyReportPath,
    sectionAssemblyQueuePath:
      pickString(patch, [
        "sectionAssemblyQueuePath",
        "section_assembly_queue_path",
      ]) ?? current.sectionAssemblyQueuePath,
    sourceArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["sourceArtifactCount", "source_artifact_count"]) ??
          current.sourceArtifactCount
      )
    ),
    derivedArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["derivedArtifactCount", "derived_artifact_count"]) ??
          current.derivedArtifactCount
      )
    ),
    assembledAt:
      pickString(patch, ["assembledAt", "assembled_at"]) ?? current.assembledAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };
  manifest.write_package = serializeWritePackageState(next);
  await saveManifest(params.projectRoot, manifest);
  return {
    state: next,
    validationErrors: getWritePackageValidationErrors(next),
  };
}

export async function setExperimentSearchState(params: {
  projectRoot: string;
  experimentSearch: Record<string, unknown>;
}): Promise<{
  state: ExperimentSearchState;
  stateFilePath: string;
  stateFileExists: boolean;
  readyForAnalysis: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
  });
  const patch = asRecord(params.experimentSearch) ?? {};
  const next: ExperimentSearchState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    currentMainStage:
      normalizeStage(patch.currentMainStage ?? patch.current_main_stage) ??
      current.currentMainStage,
    currentSubstage:
      normalizeStage(patch.currentSubstage ?? patch.current_substage) ??
      current.currentSubstage,
    frontierNodeIds:
      patch.frontierNodeIds || patch.frontier_node_ids
        ? asStringArray(patch.frontierNodeIds ?? patch.frontier_node_ids)
        : current.frontierNodeIds,
    bestNodeId:
      pickString(patch, ["bestNodeId", "best_node_id"]) ?? current.bestNodeId,
    completedNodeIds:
      patch.completedNodeIds || patch.completed_node_ids
        ? asStringArray(patch.completedNodeIds ?? patch.completed_node_ids)
        : current.completedNodeIds,
    failedNodeIds:
      patch.failedNodeIds || patch.failed_node_ids
        ? asStringArray(patch.failedNodeIds ?? patch.failed_node_ids)
        : current.failedNodeIds,
    triedHyperparams:
      patch.triedHyperparams || patch.tried_hyperparams
        ? asStringArray(patch.triedHyperparams ?? patch.tried_hyperparams)
        : current.triedHyperparams,
    completedAblations:
      patch.completedAblations || patch.completed_ablations
        ? asStringArray(patch.completedAblations ?? patch.completed_ablations)
        : current.completedAblations,
    multiSeedStatus:
      normalizeStage(patch.multiSeedStatus ?? patch.multi_seed_status) ??
      current.multiSeedStatus,
    evaluationSummaryPath:
      pickString(patch, [
        "evaluationSummaryPath",
        "evaluation_summary_path",
      ]) ?? current.evaluationSummaryPath,
    plotPackStatus:
      normalizeStage(patch.plotPackStatus ?? patch.plot_pack_status) ??
      current.plotPackStatus,
    plotPackPath:
      pickString(patch, ["plotPackPath", "plot_pack_path"]) ??
      current.plotPackPath,
    stageProgressPath:
      pickString(patch, ["stageProgressPath", "stage_progress_path"]) ??
      current.stageProgressPath,
    checkpointPath:
      pickString(patch, ["checkpointPath", "checkpoint_path"]) ??
      current.checkpointPath,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.experiment_search = serializeExperimentSearchState(next);
  await saveExperimentSearchStateFile(params.projectRoot, next);
  await saveManifest(params.projectRoot, manifest);

  const stateFilePath = getExperimentSearchPath(params.projectRoot);
  return {
    state: next,
    stateFilePath,
    stateFileExists: await pathExists(stateFilePath),
    readyForAnalysis: isExperimentSearchReadyForAnalysis(next),
  };
}

export async function setPaperQcState(params: {
  projectRoot: string;
  paperQc: Record<string, unknown>;
}): Promise<{
  state: PaperQcState;
  latestReportResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizePaperQcState(manifest.paper_qc);
  const patch = asRecord(params.paperQc) ?? {};
  const next: PaperQcState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    compileStatus:
      normalizeStage(patch.compileStatus ?? patch.compile_status) ??
      current.compileStatus,
    compileRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["compileRoundCount", "compile_round_count"]) ??
          current.compileRoundCount
      )
    ),
    chktexStatus:
      normalizeStage(patch.chktexStatus ?? patch.chktex_status) ??
      current.chktexStatus,
    pageBudgetStatus:
      normalizeStage(patch.pageBudgetStatus ?? patch.page_budget_status) ??
      current.pageBudgetStatus,
    referenceStartPage:
      pickNumber(patch, ["referenceStartPage", "reference_start_page"]) ??
      current.referenceStartPage,
    bodyPageCount:
      pickNumber(patch, ["bodyPageCount", "body_page_count"]) ??
      current.bodyPageCount,
    unusedFigureStatus:
      normalizeStage(patch.unusedFigureStatus ?? patch.unused_figure_status) ??
      current.unusedFigureStatus,
    invalidFigureRefStatus:
      normalizeStage(
        patch.invalidFigureRefStatus ?? patch.invalid_figure_ref_status
      ) ?? current.invalidFigureRefStatus,
    reflectionRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "reflectionRoundCount",
          "reflection_round_count",
        ]) ?? current.reflectionRoundCount
      )
    ),
    latestReportPath:
      pickString(patch, ["latestReportPath", "latest_report_path"]) ??
      current.latestReportPath,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.paper_qc = serializePaperQcState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    latestReportResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.latestReportPath
    ),
    hardFailure: isPaperQcHardFailure(next),
  };
}

export async function setPaperIngestionState(params: {
  projectRoot: string;
  paperIngestion: Record<string, unknown>;
}): Promise<{
  state: PaperIngestionState;
  newlyCompletedPapers: PaperIngestionCompletedPaper[];
  newlyTerminalPaperOperations: PaperIngestionPaperOperation[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizePaperIngestionState(manifest.paper_ingestion);
  const patch = asRecord(params.paperIngestion) ?? {};
  const importTaskIdsRaw = patch.import_task_ids ?? patch.importTaskIds;
  const completedPapersRaw = patch.completed_papers ?? patch.completedPapers;
  const paperOperationsRaw = patch.paper_operations ?? patch.paperOperations;
  const completedPaperUpdate = mergeCompletedPaperEntries({
    current: current.completedPapers,
    patch: completedPapersRaw,
  });
  const paperOperationUpdate = mergePaperIngestionOperations({
    current: current.paperOperations,
    patch: paperOperationsRaw,
  });
  const next: PaperIngestionState = {
    ...current,
    runtimeStatus: normalizePaperIngestionRuntimeStatus(
      patch.runtimeStatus ?? patch.runtime_status ?? current.runtimeStatus
    ),
    waitingReason:
      pickString(patch, ["waitingReason", "waiting_reason"]) ?? current.waitingReason,
    importTaskIds: Array.isArray(importTaskIdsRaw)
      ? importTaskIdsRaw
          .map((entry: unknown) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : current.importTaskIds,
    lastImportTaskId:
      pickString(patch, ["lastImportTaskId", "last_import_task_id"]) ??
      current.lastImportTaskId,
    lastImportStatus:
      normalizeStage(patch.lastImportStatus ?? patch.last_import_status) ??
      current.lastImportStatus,
    completedPapers: completedPaperUpdate.completedPapers,
    paperOperations: paperOperationUpdate.paperOperations,
    graphVersionSeen:
      pickString(patch, ["graphVersionSeen", "graph_version_seen"]) ??
      current.graphVersionSeen,
    reconcileRequired:
      patch.reconcileRequired === true ||
      patch.reconcile_required === true ||
      (patch.reconcileRequired === false || patch.reconcile_required === false
        ? false
        : current.reconcileRequired),
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.paper_ingestion = {
    ...(asRecord(manifest.paper_ingestion) ?? {}),
    ...serializePaperIngestionState(next),
  };
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    newlyCompletedPapers: completedPaperUpdate.newlyCompletedPapers,
    newlyTerminalPaperOperations: paperOperationUpdate.newlyTerminalPaperOperations,
  };
}

export async function setCitationCollectionState(params: {
  projectRoot: string;
  citationCollection: Record<string, unknown>;
}): Promise<{
  state: CitationCollectionState;
  progressResolvedPath: string | null;
  cacheBibResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeCitationCollectionState(manifest.citation_collection);
  const patch = asRecord(params.citationCollection) ?? {};
  const next: CitationCollectionState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    progressPath:
      pickString(patch, ["progressPath", "progress_path"]) ??
      current.progressPath,
    cacheBibPath:
      pickString(patch, ["cacheBibPath", "cache_bib_path"]) ??
      current.cacheBibPath,
    candidateCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["candidateCount", "candidate_count"]) ??
          current.candidateCount
      )
    ),
    verifiedCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["verifiedCount", "verified_count"]) ??
          current.verifiedCount
      )
    ),
    suspiciousCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["suspiciousCount", "suspicious_count"]) ??
          current.suspiciousCount
      )
    ),
    hallucinatedCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["hallucinatedCount", "hallucinated_count"]) ??
          current.hallucinatedCount
      )
    ),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.citation_collection = serializeCitationCollectionState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    progressResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.progressPath
    ),
    cacheBibResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.cacheBibPath
    ),
    hardFailure: isCitationCollectionHardFailure(next),
  };
}

export async function setFigureQcState(params: {
  projectRoot: string;
  figureQc: Record<string, unknown>;
}): Promise<{
  state: FigureQcState;
  figureReviewResolvedPath: string | null;
  figureSelectionResolvedPath: string | null;
  hardFailure: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeFigureQcState(manifest.figure_qc);
  const patch = asRecord(params.figureQc) ?? {};
  const next: FigureQcState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    figureReviewPath:
      pickString(patch, ["figureReviewPath", "figure_review_path"]) ??
      current.figureReviewPath,
    figureSelectionPath:
      pickString(patch, ["figureSelectionPath", "figure_selection_path"]) ??
      current.figureSelectionPath,
    duplicateFigureStatus:
      normalizeStage(
        patch.duplicateFigureStatus ?? patch.duplicate_figure_status
      ) ?? current.duplicateFigureStatus,
    captionAlignmentStatus:
      normalizeStage(
        patch.captionAlignmentStatus ?? patch.caption_alignment_status
      ) ?? current.captionAlignmentStatus,
    textAlignmentStatus:
      normalizeStage(
        patch.textAlignmentStatus ?? patch.text_alignment_status
      ) ?? current.textAlignmentStatus,
    selectionStatus:
      normalizeStage(patch.selectionStatus ?? patch.selection_status) ??
      current.selectionStatus,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
  };

  manifest.figure_qc = serializeFigureQcState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    figureReviewResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.figureReviewPath
    ),
    figureSelectionResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.figureSelectionPath
    ),
    hardFailure: isFigureQcHardFailure(next),
  };
}

export async function setReviewIssueTrackerState(params: {
  projectRoot: string;
  reviewIssueTracker: Record<string, unknown>;
}): Promise<{
  state: ReviewIssueTrackerState;
  issueManifestResolvedPath: string | null;
  hardBlockersOpen: boolean;
  mediumOrHigherIssuesNeedDisposition: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: manifest.review_issue_tracker,
  });
  const patch = asRecord(params.reviewIssueTracker) ?? {};
  let next: ReviewIssueTrackerState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    issues: Array.isArray(patch.issues)
      ? patch.issues.map((issue) => normalizeReviewIssueState(issue))
      : current.issues,
    openCounts:
      patch.openCounts || patch.open_counts
        ? normalizeReviewIssueCounts(patch.openCounts ?? patch.open_counts)
        : current.openCounts,
    issueManifestPath:
      pickString(patch, ["issueManifestPath", "issue_manifest_path"]) ??
      current.issueManifestPath,
    lastReviewRound: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["lastReviewRound", "last_review_round"]) ??
          current.lastReviewRound
      )
    ),
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (Array.isArray(patch.issues) && !(patch.openCounts || patch.open_counts)) {
    next.openCounts = summarizeReviewIssuesFromManifest(next.issues).counts;
  }

  const issueManifestResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.issueManifestPath
  );
  if (Array.isArray(patch.issues) && issueManifestResolvedPath) {
    await writeJsonEnsured(issueManifestResolvedPath, {
      issues: next.issues.map((issue) => serializeReviewIssueState(issue)),
    });
  }

  next = await hydrateReviewIssueTrackerState({
    projectRoot: params.projectRoot,
    value: serializeReviewIssueTrackerState(next),
  });

  manifest.review_issue_tracker = serializeReviewIssueTrackerState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    issueManifestResolvedPath,
    hardBlockersOpen: hasBlockingReviewIssues(next),
    mediumOrHigherIssuesNeedDisposition:
      hasUnwaivedMediumOrHigherReviewIssues(next),
  };
}

export async function recordCitationVerification(params: {
  projectRoot: string;
  citationVerification: Record<string, unknown>;
}): Promise<{
  state: CitationIntegrityState;
  bibliographyResolvedPath: string | null;
  verificationReportResolvedPath: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeCitationIntegrityState(manifest.citation_integrity);
  const patch = asRecord(params.citationVerification) ?? {};
  const next: CitationIntegrityState = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    verificationRequired:
      pickBoolean(patch, ["verificationRequired", "verification_required"]) ??
      current.verificationRequired,
    sourceOfTruth:
      patch.sourceOfTruth || patch.source_of_truth
        ? asStringArray(patch.sourceOfTruth ?? patch.source_of_truth)
        : current.sourceOfTruth,
    bibliographyPath:
      pickString(patch, ["bibliographyPath", "bibliography_path"]) ??
      current.bibliographyPath,
    verificationReportPath:
      pickString(patch, ["verificationReportPath", "verification_report_path"]) ??
      current.verificationReportPath,
    verificationStatus:
      normalizeStage(patch.verificationStatus ?? patch.verification_status) ??
      current.verificationStatus,
    allowedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "allowedPlaceholderCount",
          "allowed_placeholder_count",
        ]) ?? current.allowedPlaceholderCount
      )
    ),
    unresolvedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "unresolvedPlaceholderCount",
          "unresolved_placeholder_count",
        ]) ?? current.unresolvedPlaceholderCount
      )
    ),
    verifiedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["verifiedCitationCount", "verified_citation_count"]) ??
          current.verifiedCitationCount
      )
    ),
    suspiciousCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "suspiciousCitationCount",
          "suspicious_citation_count",
        ]) ?? current.suspiciousCitationCount
      )
    ),
    hallucinatedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "hallucinatedCitationCount",
          "hallucinated_citation_count",
        ]) ?? current.hallucinatedCitationCount
      )
    ),
    lastVerifiedAt:
      pickString(patch, ["lastVerifiedAt", "last_verified_at"]) ??
      current.lastVerifiedAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (!next.enabled) {
    next.pendingReason = null;
  } else if (next.verificationRequired && next.verificationStatus !== "verified") {
    next.pendingReason =
      next.pendingReason ??
      "Citation verification is still pending. Run the citation integrity gate before submission.";
  } else if (
    next.verificationStatus === "verified" &&
    next.unresolvedPlaceholderCount <= next.allowedPlaceholderCount &&
    next.hallucinatedCitationCount === 0
  ) {
    next.pendingReason = null;
  }

  manifest.citation_integrity = serializeCitationIntegrityState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    bibliographyResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.bibliographyPath
    ),
    verificationReportResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.verificationReportPath
    ),
  };
}

export async function recordIdleResearchRun(params: {
  projectRoot: string;
  idleResearchRun: Record<string, unknown>;
}): Promise<{
  state: IdleResearchState;
  due: boolean;
  nextDueAt: string | null;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeIdleResearchState(manifest.idle_research);
  const run = asRecord(params.idleResearchRun) ?? {};
  const now = new Date().toISOString();
  const refreshRequired = pickBoolean(run, ["refreshRequired", "refresh_required"]);
  const refreshReason = pickString(run, ["refreshReason", "refresh_reason"]);
  const next: IdleResearchState = {
    ...current,
    status: normalizeStage(run.status) ?? "completed",
    pendingReason:
      pickString(run, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    nextQueryHint:
      pickString(run, ["nextQueryHint", "next_query_hint"]) ??
      current.nextQueryHint,
    lastRunAt: pickString(run, ["lastRunAt", "last_run_at"]) ?? now,
    lastDigestPath:
      pickString(run, ["lastDigestPath", "last_digest_path"]) ??
      current.lastDigestPath,
    lastSourceUpdateAt:
      pickString(run, ["lastSourceUpdateAt", "last_source_update_at"]) ?? now,
    lastRoundNewCanonicalPapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(run, [
            "newCanonicalPapers",
            "new_canonical_papers",
            "lastRoundNewCanonicalPapers",
            "last_round_new_canonical_papers",
          ]) ?? current.lastRoundNewCanonicalPapers
        )
      ),
    lastRoundNewCorePapers:
      Math.max(
        0,
        Math.floor(
          pickNumber(run, [
            "newCorePapers",
            "new_core_papers",
            "lastRoundNewCorePapers",
            "last_round_new_core_papers",
          ]) ?? current.lastRoundNewCorePapers
        )
      ),
  };

  manifest.idle_research = serializeIdleResearchState(next);

  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  const invalidateGraphPresence =
    refreshRequired === true ||
    next.lastRoundNewCanonicalPapers > 0 ||
    next.lastRoundNewCorePapers > 0;
  manifest.paper_ingestion = {
    ...paperIngestion,
    last_ingested_at:
      next.lastSourceUpdateAt ??
      asString(paperIngestion.last_ingested_at) ??
      asString(paperIngestion.lastIngestedAt),
    refresh_required:
      refreshRequired ??
      (next.refreshGraphOnNewCorePapers && next.lastRoundNewCorePapers > 0),
    refresh_reason:
      refreshReason ??
      ((next.refreshGraphOnNewCorePapers && next.lastRoundNewCorePapers > 0)
        ? `idle_research found ${next.lastRoundNewCorePapers} core paper(s) for ${next.topic ?? "the configured topic"}`
        : asString(paperIngestion.refresh_reason) ?? null),
    graph_presence_checked_at: invalidateGraphPresence
      ? null
      : asString(paperIngestion.graph_presence_checked_at) ??
        asString(paperIngestion.graphPresenceCheckedAt),
    graph_presence_status: invalidateGraphPresence
      ? null
      : normalizeGraphPresenceStatus(
          paperIngestion.graph_presence_status ?? paperIngestion.graphPresenceStatus
        ),
    graph_presence_report_path: invalidateGraphPresence
      ? null
      : asString(
          paperIngestion.graph_presence_report_path ?? paperIngestion.graphPresenceReportPath
        ),
    graph_presence_expected_papers: invalidateGraphPresence
      ? null
      : pickNumber(paperIngestion, [
          "graph_presence_expected_papers",
          "graphPresenceExpectedPapers",
        ]),
    graph_presence_present_papers: invalidateGraphPresence
      ? null
      : pickNumber(paperIngestion, [
          "graph_presence_present_papers",
          "graphPresencePresentPapers",
        ]),
    graph_presence_missing_papers: invalidateGraphPresence
      ? []
      : Array.isArray(paperIngestion.graph_presence_missing_papers)
        ? paperIngestion.graph_presence_missing_papers
        : [],
  };

  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: isIdleResearchDue(next),
    nextDueAt: computeIdleResearchNextDueAt(next),
  };
}

export async function recordInnovationReflection(params: {
  projectRoot: string;
  innovationReflection: Record<string, unknown>;
}): Promise<{
  state: InnovationReflectionState;
  due: boolean;
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeInnovationReflectionState(manifest.innovation_reflection);
  const ledger = await readExperimentLedgerEnsured(params.projectRoot);
  const basis = getInnovationReflectionBasis(ledger);
  const input = params.innovationReflection;
  const now = new Date().toISOString();

  const next: InnovationReflectionState = {
    ...current,
    requiredAfterExperiments:
      pickBoolean(input, ["requiredAfterExperiments", "required_after_experiments"]) ??
      current.requiredAfterExperiments,
    status: normalizeStage(input.status) ?? "fresh",
    lastReflectionAt:
      pickString(input, ["lastReflectionAt", "last_reflection_at"]) ?? now,
    lastReflectionPath:
      pickString(input, [
        "lastReflectionPath",
        "last_reflection_path",
        "reflectionPath",
        "reflection_path",
        "path",
      ]) ?? current.lastReflectionPath,
    reflectedThroughExperimentUpdateAt:
      pickString(input, [
        "reflectedThroughExperimentUpdateAt",
        "reflected_through_experiment_update_at",
      ]) ?? basis.latestExperimentUpdateAt,
    reflectedExperimentIds:
      asStringArray(
        input.reflectedExperimentIds ?? input.reflected_experiment_ids
      ).length > 0
        ? asStringArray(
            input.reflectedExperimentIds ?? input.reflected_experiment_ids
          )
        : basis.experimentIds,
    pendingReason: pickString(input, ["pendingReason", "pending_reason"]) ?? null,
  };

  manifest.innovation_reflection = serializeInnovationReflectionState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: isInnovationReflectionDue({ state: next, ledger }),
    latestExperimentUpdateAt: basis.latestExperimentUpdateAt,
    experimentIds: basis.experimentIds,
  };
}

export async function getExperimentMemorySummary(params: {
  projectRoot: string;
  limit?: number;
}): Promise<{
  ledgerPath: string;
  updatedAt: string;
  summary: {
    activeExperimentIds: string[];
    lastCompletedExperimentId: string | null;
    lastFailedExperimentId: string | null;
    bestKnownConfigRef: string | null;
    lastDecisionSummary: string | null;
    papernexusSyncRequired: boolean;
    papernexusLastSyncAt: string | null;
  };
  recentExperiments: ExperimentMemoryDigest[];
}> {
  const ledger = await readExperimentLedgerEnsured(params.projectRoot);
  const recentExperiments = buildExperimentMemoryDigest(
    ledger,
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 6
  );
  return {
    ledgerPath: getExperimentLedgerPath(params.projectRoot),
    updatedAt: ledger.updatedAt,
    summary: ledger.summary,
    recentExperiments,
  };
}

export async function upsertExperimentLedgerEntry(params: {
  projectRoot: string;
  projectId?: string | null;
  agentId?: string;
  experiment: Record<string, unknown>;
}): Promise<{
  entry: ExperimentLedgerEntry;
  summary: ExperimentLedgerSummary;
  recentExperiments: ExperimentMemoryDigest[];
}> {
  const ledger = await readExperimentLedgerEnsured(params.projectRoot);
  const experimentId =
    pickString(params.experiment, ["experimentId", "experiment_id", "id"]) ?? null;
  if (!experimentId) {
    throw new Error("experiment.experimentId is required for upsert_experiment.");
  }
  const now = new Date().toISOString();
  const existingIndex = ledger.experiments.findIndex(
    (entry) => entry.experimentId === experimentId
  );
  const existing = existingIndex >= 0 ? ledger.experiments[existingIndex] : null;
  const next = mergeExperimentEntries(existing, params.experiment, {
    updatedAt: now,
    lastUpdatedBy: normalizeRole(params.agentId) ?? asString(params.agentId) ?? null,
  });

  if (existingIndex >= 0) {
    ledger.experiments[existingIndex] = next;
  } else {
    ledger.experiments.push(next);
  }

  ledger.projectId = params.projectId ?? ledger.projectId ?? path.basename(params.projectRoot);
  ledger.updatedAt = now;
  ledger.summary = buildExperimentLedgerSummary(ledger.experiments);

  await saveExperimentLedger(params.projectRoot, ledger);
  await syncManifestExperimentMemory({
    projectRoot: params.projectRoot,
    ledger,
  });

  return {
    entry: next,
    summary: ledger.summary,
    recentExperiments: buildExperimentMemoryDigest(ledger, 6),
  };
}

export async function runWorkflowAutoIterator(params: {
  projectRoot: string;
  agentId?: string;
  mode?: string;
  queueMailbox?: boolean;
  cooldownSeconds?: number;
  policy?: WorkflowGuardPolicy;
  now?: string;
}): Promise<AutoIteratorResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const workflowPolicy = normalizePolicy(params.policy as Record<string, unknown> | undefined);
  const [manifestRaw, trackRegistry, experimentLedger] = await Promise.all([
    readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    loadExperimentLedgerIfExists(projectRoot),
  ]);
  let manifest = { ...(manifestRaw ?? {}) };
  const gateState = await readGateState(projectRoot);
  const actorRole = normalizeRole(params.agentId);
  const now = params.now ?? new Date().toISOString();
  const projectId = inferProjectId(projectRoot, manifest);
  const mode = asString(params.mode) ?? "manual";
  const stageBefore =
    normalizeStage(manifest.current_stage) ?? gateState.currentStage ?? "setup";
  const writePackageBefore = normalizeWritePackageState(manifest.write_package);
  if (
    workflowPolicy.autoMode === "aggressive" &&
    (stageBefore === "write" || stageBefore === "submit") &&
    !["ready", "assembled", "approved"].includes(
      normalizeStage(writePackageBefore.status) ?? ""
    )
  ) {
    await assembleWritePackage({
      projectRoot,
      mode: "aggressive",
      trigger: "auto_iterator",
      agentId: actorRole,
    });
    manifest =
      (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
      manifest;
  }
  let graphPresenceCheck: GraphPresenceCheckResult | null = null;
  if (["graph_build", "frontier_mapping", "idea"].includes(stageBefore)) {
    graphPresenceCheck = await checkGraphPresenceForWorkflow({
      projectRoot,
      updateManifest: true,
      remoteAccess: {
        apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
        tokenSource: workflowPolicy.papernexusApiTokenSource,
        tokenEnv: workflowPolicy.papernexusApiTokenEnv,
        tokenService: workflowPolicy.papernexusApiTokenService,
        tokenAccount: workflowPolicy.papernexusApiTokenAccount,
        mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
        tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
      },
    });
    manifest =
      (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ??
      manifest;
  }
  let stageEffective = stageBefore;
  let regressed = false;

  const visited = new Set<string>();
  while (stageEffective) {
    const previousStage = PREVIOUS_STAGE[stageEffective];
    if (!previousStage || visited.has(previousStage)) {
      break;
    }
    visited.add(previousStage);
    const previousMissing = await getMissingStageSignals({
      projectRoot,
      manifest,
      trackRegistry,
      experimentLedger,
      currentStage: previousStage,
    });
    if (previousMissing.length === 0) {
      break;
    }
    stageEffective = previousStage;
    regressed = true;
  }

  const effectiveMissingSignals = await getMissingStageSignals({
    projectRoot,
    manifest,
    trackRegistry,
    experimentLedger,
    currentStage: stageEffective,
  });
  const autoModeRiskEvaluation = evaluateWorkflowAutoModeRisk({
    configuredMode: workflowPolicy.autoMode,
    stage: stageEffective,
    regressed,
    revisionCount: gateState.revisionCount,
    missingStageSignals: effectiveMissingSignals,
    manifest,
  });
  const autoModeDiscussionStore =
    autoModeRiskEvaluation.riskFingerprint && autoModeRiskEvaluation.riskLevel !== "stable"
      ? await readAutoModeDiscussionStore(projectRoot)
      : null;
  const autoModeDiscussionRound =
    autoModeDiscussionStore?.currentRound?.packetFingerprint ===
    autoModeRiskEvaluation.riskFingerprint
      ? autoModeDiscussionStore.currentRound
      : null;
  const autoModeMitigationRoundsStarted = autoModeRiskEvaluation.riskFingerprint
    ? autoModeDiscussionStore?.roundsStartedByFingerprint[
        autoModeRiskEvaluation.riskFingerprint
      ] ?? 0
    : 0;
  const autoModeEvaluation = resolveEffectiveWorkflowAutoMode({
    configuredMode: workflowPolicy.autoMode,
    riskEvaluation: autoModeRiskEvaluation,
    mitigationStatus: autoModeDiscussionRound?.status ?? null,
    mitigationRoundsStarted: autoModeMitigationRoundsStarted,
    mitigationMaxRounds: workflowPolicy.autoGate.maxMitigationRounds,
  });
  const gateEvaluation = await evaluateGateBlocking({
    projectRoot,
    gateState,
    stage: stageEffective,
    hasStageWorkRemaining: effectiveMissingSignals.length > 0,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    autoGate: workflowPolicy.autoGate,
    now,
  });

  let stageAfter = stageEffective;
  if (
    !gateEvaluation.blocking &&
    stageEffective &&
    effectiveMissingSignals.length === 0 &&
    stageEffective !== "done"
  ) {
    const nextStage = STAGE_REQUIREMENTS[stageEffective]?.nextStage;
    if (nextStage) {
      stageAfter = nextStage;
    }
  }

  const activeStageSignals =
    stageAfter !== stageEffective
      ? await getMissingStageSignals({
          projectRoot,
          manifest,
          trackRegistry,
          experimentLedger,
          currentStage: stageAfter,
        })
      : effectiveMissingSignals;

  const ownerBefore = asString(manifest.owner_agent);
  const ownerAfter = stageOwner(stageAfter);
  const nextAction = gateEvaluation.blocking
    ? gateEvaluation.reason
    : formatStageCommand(stageAfter);
  const resumeAction = gateEvaluation.blocking
    ? "Wait for the blocking gate to resolve, then run /resume-pipeline."
    : formatStageCommand(stageAfter);
  const blockingReason = gateEvaluation.blocking
    ? gateEvaluation.reason
    : activeStageSignals.length > 0
      ? `Waiting for ${ownerAfter ?? "workflow owner"} to satisfy: ${activeStageSignals.join("; ")}`
      : null;

  manifest.project_id = projectId;
  manifest.current_stage = stageAfter;
  manifest.owner_agent = ownerAfter;
  manifest.next_action = nextAction;
  manifest.resume_action = resumeAction;
  manifest.blocking_reason = blockingReason;
  manifest.last_heartbeat_at = now;
  if (stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed) {
    manifest.last_handoff_at = now;
    manifest.current_micro_stage =
      STAGE_ENTRY_MICRO_STAGES[stageAfter] ??
      normalizeStage(manifest.current_micro_stage) ??
      null;
  }
  await saveManifest(projectRoot, manifest);

  const nextGateState: GateState = {
    ...gateState,
    currentStage: stageAfter,
    gateTimestamp:
      gateEvaluation.blocking && stageAfter === "submit"
        ? gateState.gateTimestamp ?? now
        : gateState.gateTimestamp,
    lastGate:
      gateEvaluation.blocking && stageAfter === "submit"
        ? gateState.lastGate ?? "GATE-5"
        : gateState.lastGate,
    gateStatus:
      gateEvaluation.timedDefaultTriggered
        ? "approved"
        : gateEvaluation.blocking
        ? "waiting"
        : gateState.gateStatus === "waiting"
          ? "approved"
          : gateState.gateStatus,
    defaultActionExecutedAt: gateEvaluation.timedDefaultTriggered
      ? gateState.defaultActionExecutedAt ?? now
      : gateState.defaultActionExecutedAt,
  };
  await saveGateState(projectRoot, nextGateState);

  const recommendedActions: AutoIteratorAction[] = [];
  if (gateEvaluation.blocking) {
    recommendedActions.push({
      kind: "wait_human",
      stage: stageAfter,
      owner: ownerAfter,
      summary: gateEvaluation.reason ?? "Wait for the required human gate.",
      command: null,
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: true,
    });
  } else {
    const mailbox =
      params.queueMailbox === false
        ? {
            queued: false,
            messageId: null,
            cooldownRemainingSeconds: null,
          }
        : await maybeQueueAutoIteratorMailbox({
            projectRoot,
            fromRole: actorRole,
            toRole: ownerAfter,
            stage: stageAfter,
            nextAction,
            missingStageSignals: activeStageSignals,
            cooldownSeconds:
              typeof params.cooldownSeconds === "number" &&
              Number.isFinite(params.cooldownSeconds)
                ? Math.max(0, Math.floor(params.cooldownSeconds))
                : workflowPolicy.agentContactCooldownSeconds,
          });
    recommendedActions.push({
      kind: "drive_stage",
      stage: stageAfter,
      owner: ownerAfter,
      summary:
        formatStageSummary(stageAfter) ??
        "Drive the current workflow stage and refresh durable state.",
      command: nextAction,
      mailboxQueued: mailbox.queued,
      mailboxMessageId: mailbox.messageId,
      cooldownRemainingSeconds: mailbox.cooldownRemainingSeconds,
      blocking: false,
    });
  }

  const idleResearch = normalizeIdleResearchState(manifest.idle_research);
  if (isIdleResearchDue(idleResearch) && (gateEvaluation.blocking || ownerAfter !== "researcher")) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary: `Idle research topic "${idleResearch.topic ?? "unset"}" is due and can run in the background.`,
      command:
        idleResearch.topic
          ? `Run /idle-research for "${idleResearch.topic}" and record the round through research_workflow.record_idle_research_run.`
          : "Configure idle research with research_workflow.set_idle_research before using background rounds.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const paperIngestion = asRecord(manifest.paper_ingestion);
  if (
    paperIngestion?.refresh_required === true &&
    (stageAfter === "graph_build" || stageAfter === "frontier_mapping" || stageAfter === "idea")
  ) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary: "PaperNexus graph refresh is pending and should run before novelty-sensitive work.",
      command:
        "Run /graph-build to reconcile PAPER_SOURCE_INDEX.json against the shared global graph (cache-first, without --force) before continuing frontier mapping or ideation. If shared-graph tooling is unavailable or reconciliation still fails, hand the exact non-force command to the user to run manually.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const experimentMemory = asRecord(manifest.experiment_memory);
  if (
    experimentLedger?.summary.papernexusSyncRequired === true ||
    experimentMemory?.papernexus_sync_required === true
  ) {
    recommendedActions.push({
      kind: "background",
      stage: stageAfter,
      owner: "researcher",
      summary: "Experiment evidence still needs to be synchronized back into PaperNexus.",
      command:
        "Refresh PaperNexus nodes or graph overlays for the latest experiments before the next ideation or writing round.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  let projectsStateUpdated = false;
  if (projectId) {
    projectsStateUpdated = await syncProjectsStateEntry({
      projectRoot,
      projectId,
      manifest,
      trackRegistry,
      stage: stageAfter,
      nextAction,
      blockingReason,
    });
  }

  if (stageAfter === "done") {
    const projectsState = await readProjectsStateRaw(projectRoot);
    const nextProject =
      (Array.isArray(projectsState.projects)
        ? projectsState.projects
            .filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
            .filter((entry) => pickString(entry, ["id"]) !== projectId)
            .filter((entry) => normalizeStage(entry.status) === "active")
            .sort((left, right) => {
              const leftPriority = pickNumber(left, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
              const rightPriority = pickNumber(right, ["priority"]) ?? Number.MAX_SAFE_INTEGER;
              if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
              }
              const leftUpdated = pickString(left, ["updated"]) ?? "";
              const rightUpdated = pickString(right, ["updated"]) ?? "";
              return rightUpdated.localeCompare(leftUpdated);
            })[0]
        : null) ?? null;
    if (nextProject) {
      const nextProjectId = pickString(nextProject, ["id"]);
      recommendedActions.push({
        kind: "switch_project",
        stage: "done",
        owner: "researcher",
        summary: `Queue candidate ready: ${nextProjectId ?? "another active project"}.`,
        command:
          nextProjectId
            ? `Switch OPENCLAW_PROJECT to ${nextProjectId} and run /resume-pipeline there.`
            : "Switch to the next active queued project and run /resume-pipeline.",
        mailboxQueued: false,
        mailboxMessageId: null,
        cooldownRemainingSeconds: null,
        blocking: false,
      });
    }
  }

  const result: AutoIteratorResult = {
    projectRoot,
    projectId,
    mode,
    configuredAutoMode: autoModeEvaluation.configuredMode,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    autoModeRiskLevel: autoModeEvaluation.riskLevel,
    autoModeReasons: autoModeEvaluation.reasons,
    autoModeRiskFingerprint: autoModeEvaluation.riskFingerprint,
    autoModeMitigationStatus: autoModeEvaluation.mitigationStatus,
    autoModeMitigationRoundsStarted: autoModeEvaluation.mitigationRoundsStarted,
    autoModeMitigationRoundsRemaining: autoModeEvaluation.mitigationRoundsRemaining,
    stageBefore,
    stageEffective,
    stageAfter,
    stageChanged: stageAfter !== stageBefore,
    regressed,
    gateBlocking: gateEvaluation.blocking,
    gateReason: gateEvaluation.reason,
    timedDefaultTriggered: gateEvaluation.timedDefaultTriggered,
    missingStageSignals: activeStageSignals,
    ownerBefore,
    ownerAfter,
    nextAction,
    resumeAction,
    blockingReason,
    graphPresenceCheck,
    projectsStateUpdated,
    auditPath: null,
    recommendedActions,
  };

  result.auditPath = await writeAutoIteratorAudit(projectRoot, result);
  await appendWorkflowTraceEvent({
    projectRoot,
    projectId,
    kind: "auto_iterator",
    action: "auto_iterator_tick",
    functionName: "runWorkflowAutoIterator",
    stage: stageAfter,
    owner: ownerAfter,
    agentId: actorRole,
    sessionKey: null,
    summary: `Auto iterator evaluated ${stageBefore} -> ${stageAfter}`,
    details: {
      mode,
      stageBefore,
      stageEffective,
      stageAfter,
      regressed,
      gateBlocking: gateEvaluation.blocking,
      blockingReason,
      missingStageSignals: activeStageSignals,
      configuredAutoMode: autoModeEvaluation.configuredMode,
      effectiveAutoMode: autoModeEvaluation.effectiveMode,
      ownerBefore,
      ownerAfter,
      nextAction,
    },
  });
  return result;
}

export function getProjectRootForWorkflow(options?: {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  policy?: WorkflowGuardPolicy;
}): string | null {
  return getProjectRoot(options);
}

export function getChannelProjectBindingForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
}) {
  return getChannelProjectBinding({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
    },
  });
}

export function listChannelProjectBindingsForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
}) {
  return listChannelProjectBindings({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
    },
  });
}

export async function bindChannelProjectForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  title?: string | null;
  topic?: string | null;
  boundByAgent?: string | null;
  notes?: string | null;
  createIfMissing?: boolean;
}) {
  const ensuredProject = await ensureWorkflowProjectRoot({
    policy: params.policy,
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    messageChannel: params.messageChannel,
    channelKey: params.channelKey,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    title: params.title,
    topic: params.topic,
  });
  return setChannelProjectBinding({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
    },
    projectRoot: ensuredProject.projectRoot,
    projectId: params.projectId ?? ensuredProject.projectId,
    messageChannel: params.messageChannel,
    boundByAgent: params.boundByAgent,
    notes: params.notes,
  });
}

export async function ensureChannelProjectBindingForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  boundByAgent?: string | null;
  notes?: string | null;
}) {
  const existing = getChannelProjectBinding({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      projectRoot: params.projectRoot ?? undefined,
    },
  });
  if (existing.binding) {
    return {
      autoBound: false,
      reason: "existing_binding",
      storePath: existing.storePath,
      binding: existing.binding,
    };
  }

  const projectRoot =
    params.projectRoot ??
    getProjectRoot({
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      policy: params.policy,
    });
  if (!projectRoot) {
    return {
      autoBound: false,
      reason: "no_project_root",
      storePath: existing.storePath,
      binding: null,
    };
  }

  const bound = await setChannelProjectBinding({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      projectRoot,
    },
    projectRoot,
    projectId: params.projectId,
    messageChannel: params.messageChannel,
    boundByAgent: params.boundByAgent,
    notes: params.notes,
  });
  return {
    autoBound: true,
    reason: "created",
    storePath: bound.storePath,
    binding: bound.binding,
  };
}

export async function unbindChannelProjectForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
}) {
  return clearChannelProjectBinding({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
    },
  });
}
