export type WorkflowRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

export type ManifestLike = Record<string, unknown>;

export type WorkflowMailboxItem = {
  id: string;
  toAgent: string;
  status: string;
  priority: string;
  createdAt: string;
};

export type IdleResearchState = {
  enabled: boolean;
  topic: string | null;
  maxPapersPerCycle: number;
};

export type InnovationReflectionState = {
  lastReflectionPath: string | null;
};

export type CitationIntegrityState = {
  enabled: boolean;
  verificationRequired: boolean;
  verificationStatus: string | null;
  sourceOfTruth: string[];
  allowedPlaceholderCount: number;
};

export type ExperimentMemoryDigest = Record<string, unknown>;

export type WritingContractState = {
  templateRequired: boolean;
  paperMode: string | null;
  bodyPageBudget: number | null;
  referencePageBudget: number | null;
  bodyWordTargetMin: number | null;
  bodyWordTargetMax: number | null;
  kgStorylineRequired: boolean;
  kgStorylinePacketPath: string | null;
  kgStorylineStatus: string | null;
  templateMappingPath: string | null;
};

export type PaperIngestionState = {
  runtimeStatus: string | null;
  waitingReason: string | null;
  repairRequired: boolean;
  repairReason: string | null;
  repairTargetCorpus: string | null;
};

export type BuildDynamicTasksParams = {
  role: WorkflowRole | null;
  currentStage: string | null;
  manifest: ManifestLike | null;
  missingStageSignals: string[];
  experimentReviewMode: "manual" | "reviewed_auto";
  experimentReviewStatus: string | null;
  experimentReviewMicroStage: string | null;
  experimentReviewPendingReason: string | null;
  experimentReviewPacketPath: string | null;
  experimentReviewPlannerPlanPath: string | null;
  experimentReviewAnalyzerReportPath: string | null;
  experimentReviewCrossReviewerReportPath: string | null;
  experimentReviewLaunchDecisionPath: string | null;
  experimentReviewLaunchApproved: boolean;
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
  papernexusMcpUrl: string | null;
  papernexusMcpTransport: string | null;
  papernexusApiTokenEnv: string | null;
  papernexusApiTokenSource: string | null;
  papernexusApiTokenService: string | null;
  papernexusApiTokenAccount: string | null;
  papernexusMineruHttpUrl: string | null;
  papernexusAccessMode: string | null;
};

export type BuildDynamicTasksDeps = {
  rolePolicies: Record<string, { backgroundTasks: string[] }>;
  asRecord: (value: unknown) => Record<string, unknown> | null;
  asString: (value: unknown) => string | null | undefined;
  normalizePaperIngestionState: (value: unknown) => PaperIngestionState;
  normalizeIdeaCatalystState: (value: unknown) => Record<string, unknown>;
  normalizeGraphPresenceStatus: (value: unknown) => string | null;
  summarizeGraphPresenceMissing: (value: Record<string, unknown> | null) => string | null;
  buildGraphImportRepairGuidance: (sharedCorpus: string | null | undefined) => string;
  isIdleResearchDue: (state: unknown) => boolean;
  computeIdleResearchNextDueAt: (state: unknown) => string | null;
  uniqueStrings: (items: string[]) => string[];
  DEFAULT_KG_STORYLINE_PACKET_PATH: string;
  DEFAULT_CITATION_REPORT_PATH: string;
};

export type GuidanceContribution = {
  prepend: string[];
  append: string[];
};
