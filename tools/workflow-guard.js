/**
 * 工作流守卫（Workflow Guard）——系统中枢。
 *
 * 这是整个系统的入口——统一处理命令、状态、阶段切换、手递手、
 * 实验搜索、论文摄入、写作、审查等所有工作流相关操作。
 *
 * 为什么这个文件有 9000+ 行？因为它是一个"Facade"——
 * 将 50+ 个子模块的能力统一暴露为 MCP 工具调用。
 * 子模块负责具体逻辑，workflow-guard.ts 负责协调。
 *
 * 核心设计模式：
 * 1. load/normalize → evaluate → materialize → save
 *    （加载状态 → 评估 → 物化制品 → 保存）
 * 2. coerce → normalize → serialize
 *    （宽容输入 → 标准化 → 序列化输出）
 * 3. 策略与代码分离（role-policy.ts 定义权限，stage-registry.ts 定义阶段）
 *
 * 这个文件不直接实现业务逻辑——它调用各子模块：
 * - workflow-guard-core/: 类型转换、文件系统、路径解析
 * - workflow-guard-state/: 状态类型定义和 normalize/serialize
 * - workflow-guard-policies/: 角色策略和阶段路由
 * - workflow-guard-stages/: 各阶段的缺失信号检查
 * - workflow-guard-materializers/: 制品物化
 * - workflow-guard-summaries/: 状态摘要
 * - idea-catalyst/: 创意系统
 * - workflow-handoff/: 手递手系统
 * - research-writing/: 写作系统
 * - workflow-experiment-* family: 实验搜索和审查
 * - paper-ingestion-validation/: 论文摄入验证
 * - workflow-guard-collaboration/: 角色协作（邮箱、联系人）
 * - workflow-guard-experiment-history/: 实验历史
 * - workflow-kernel/: 阶段注册表
 * - workflow-hooks/: 钩子系统
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// Workflow-owned PaperNexus stays MCP-first via research_lookup, research_briefing,
// idea_catalyst, and import_workflow. Ingestion stays hugging-face-paper-pages ->
// arxiv2md-api -> markxiv -> arxiv2md -> PDF fallback only.
import { appendWorkflowTraceEvent } from "./workflow-trace";
import { clearChannelProjectBinding, getChannelProjectBinding, listChannelProjectBindings, setChannelProjectBinding, } from "./channel-project-bindings";
import { checkGraphPresenceForWorkflow, } from "./graph-presence";
import { auditLiteratureCoverage, planCitationExpansion, } from "./paper-discovery-diagnostics";
import { runBroadPaperSearch } from "./research30/workflow-bridge";
import { applyPaperIngestionValidationToRequest, defaultPaperIngestionMaxAttempts, validateQueuedPaperIngestionRequest, } from "./paper-ingestion-validation";
import { evaluateWorkflowAutoModeRisk, normalizeWorkflowAutoGateConfig, normalizeWorkflowAutoMode, resolveEffectiveWorkflowAutoMode, } from "./workflow-auto-mode";
import { evaluateSubmitAutoGate } from "./workflow-auto-gate";
import { evaluateCodeAutoReview } from "./workflow-code-review.js";
import { readAutoModeDiscussionStore } from "./workflow-auto-discussion";
import { normalizeWorkflowLobsterHandoffConfig, } from "./lobster-handoff";
import { normalizePapernexusAccessMode, normalizePapernexusApiTokenSource, normalizePapernexusMcpTransport, } from "./papernexus-secret";
import { formatWorkflowShellArgument as formatWorkflowShellArgumentFromKernel, getBrainstormCycleValidationErrors as getBrainstormCycleValidationErrorsFromKernel, getResearchProgramOnboardingGaps as getResearchProgramOnboardingGapsFromKernel, getResearchProgramOnboardingStatus as getResearchProgramOnboardingStatusFromKernel, getResearchProgramPlanValidationErrors as getResearchProgramPlanValidationErrorsFromKernel, getResearchProgramValidationErrors as getResearchProgramValidationErrorsFromKernel, isBrainstormCycleReady as isBrainstormCycleReadyFromKernel, isInnovationReflectionDue as isInnovationReflectionDueFromKernel, } from "./workflow-kernel/readiness";
import { resolveWorkflowStageLeadRole, } from "./workflow-kernel/stage-registry";
import { loadPapernexusProgress, summarizePapernexusProgress, } from "./papernexus-progress";
import { normalizeCameraReadyEvidenceState, normalizeReproducibilityPackState, normalizeMechanismEvidenceState, normalizeOpportunityScorecardState, normalizeAblationEvidenceState, normalizeBenchmarkProtocolState, normalizeStatisticalEvidenceState, normalizeVenueCompetitionState, } from "./workflow-evidence/contracts";
import { collectFrontierMappingStageMissingSignals, collectGraphBuildStageMissingSignals, collectSetupStageMissingSignals, } from "./workflow-guard-stages/foundation-stage-signals";
import { collectCodeStageMissingSignals, collectIdeaStageMissingSignals, collectPlanStageMissingSignals, } from "./workflow-guard-stages/ideation-stage-signals";
import { collectAnalyzeStageMissingSignals, collectExperimentStageMissingSignals, collectReviewStageMissingSignals, } from "./workflow-guard-stages/execution-stage-signals";
import { collectSubmitStageMissingSignals, collectWriteStageMissingSignals, } from "./workflow-guard-stages/writing-stage-signals";
import { collectSurveyReviewStageMissingSignals as collectSurveyReviewStageMissingSignalsFromModule, } from "./workflow-guard-stages/survey-stage-signals";
import { asRecord, asString, asStringArray, normalizeGraphPresenceStatus, normalizeStage, pickBoolean, pickNumber, pickString, uniqueStrings, } from "./workflow-guard-core/coercion";
import { isNonEmptyDirectory, pathExists, readJsonIfExists, readTextIfExists, writeJsonEnsured, writeTextEnsured, } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath, resolveTrackArtifactPath, } from "./workflow-guard-core/paths";
import { loadTrackInnovationEvidence as loadTrackInnovationEvidenceFromHelper, trackHasGraphBackedInnovationEvidence as trackHasGraphBackedInnovationEvidenceFromHelper, } from "./workflow-guard-track-evidence.js";
import { normalizeResearchProgramState, serializeResearchProgramTrack, } from "./workflow-guard-state/research-program";
import { normalizeIdeationContractState, } from "./workflow-guard-state/ideation-contract";
import { normalizePaperStoryState, } from "./workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState, } from "./workflow-guard-state/review-pressure";
import { normalizeInnovationSynthesisState, normalizeStoryGapSearchRequisitionState, } from "./workflow-guard-state/innovation-synthesis";
import { normalizeResultsStorylineState, } from "./workflow-guard-state/results-storyline";
import { normalizeTitleAbstractIntroWorkbenchState, } from "./workflow-guard-state/title-abstract-intro-workbench";
import { getSurveyReviewStateSummary as getSurveyReviewStateSummaryFromModule, } from "./workflow-guard-state/survey-review";
import { ensureSurveyWorkflowIdentity, isSurveyWorkflow, resolveNextStageForWorkflow, resolveStageForWorkflowLine, } from "./workflow-line-routing.js";
import { normalizeCitationIntegrityState, normalizeExternalReviewState, normalizeGraphGuidedWritingState, normalizeReviewSessionState, normalizeWritingSessionState, serializeCitationIntegrityState, serializeWritingSessionState, } from "./workflow-guard-state/authoring-review-state";
import { normalizeCitationCollectionState, normalizeExperimentSearchState, normalizeFigureQcState, normalizeOrchestrationState, normalizePaperQcState, normalizeReviewIssueTrackerState, normalizeWritePackageState, serializeReviewIssueState, serializeWritePackageState, } from "./workflow-guard-state/execution-state";
import { getExperimentSearchReviewStatePath, } from "./workflow-auto-experiment-search-review.js";
import { evaluateWritingProcessReadiness as evaluateWritingProcessReadinessFromModule, } from "./workflow-guard-writing/write-package-eval";
import { restoreAuthoringArtifactsFromRecovery, syncAuthoringArtifactRecovery, writingSessionLooksRecoverableEmpty, } from "./research-writing/authoring-artifact-recovery";
import { normalizeAutonomousExecutionState, } from "./workflow-guard-state/experiment-review";
import { normalizeExperimentSearchReviewState } from "./workflow-guard-state/experiment-search-review.js";
import { derivePaperIngestionWorkflowDecision, hasActiveWorkflowOwnedPaperUpload, normalizePaperIngestionQueuedRequest, normalizePaperIngestionState, serializePaperIngestionQueuedRequest, } from "./workflow-guard-state/paper-ingestion";
import { computeIdleResearchNextDueAt, isIdleResearchDue, normalizeBrainstormCycleState, normalizeIdleResearchState, normalizeInnovationReflectionState, serializeBrainstormCycleState, serializeIdleResearchState, serializeInnovationReflectionState, } from "./workflow-guard-state/research-loop-state";
import { buildTheoryAppendixPlanMarkdown, buildTheoryAppendixSectionDraft, dedupeTheoryPackets, inferTheoryAppendixSections, normalizeTheoryObjectPacket, normalizeTheoryStateFile, normalizeTheorySupportState, serializeTheoryObjectPacket, serializeTheoryStateFile, serializeTheorySupportState, } from "./workflow-guard-state/theory-state";
import { DEFAULT_KG_STORYLINE_PACKET_PATH, evaluateWritingContractState, normalizeWritingContractState, serializeWritingContractState, } from "./workflow-guard-state/writing-contract";
import { summarizeIdeationContractState as summarizeIdeationContractStateFromModule } from "./workflow-guard-summaries/ideation-contract-summary";
import { summarizePaperIngestionState as summarizePaperIngestionStateFromModule } from "./workflow-guard-summaries/paper-ingestion-summary";
import { summarizePaperStoryState as summarizePaperStoryStateFromModule } from "./workflow-guard-summaries/paper-story-summary";
import { summarizeReviewPressurePacketState as summarizeReviewPressurePacketStateFromModule } from "./workflow-guard-summaries/review-pressure-summary";
import { summarizeWritingContractState as summarizeWritingContractStateFromModule } from "./workflow-guard-summaries/writing-contract-summary";
import { buildDynamicTasksImpl } from "./workflow-guard-guidance/dynamic-tasks";
import { materializeIdeaCatalystState } from "./idea-catalyst/materializers";
import { getIdeaCatalystValidationErrors, normalizeIdeaCatalystState, } from "./idea-catalyst/state";
import { queueIdeaCatalystRequisition } from "./idea-catalyst/workflow-bridge";
import { materializeLiteratureDiscoveryPacketImpl } from "./literature-discovery/materializer";
import { queueLiteratureDiscoveryRequisition } from "./literature-discovery/workflow-bridge";
import { materializePapernexusPacketContracts } from "./papernexus-packets/materializer";
import { materializeIdeationContractImpl } from "./workflow-guard-materializers/ideation-contract-materializer";
import { materializeExperimentMemoryPacketImpl } from "./workflow-guard-materializers/experiment-memory-materializer.js";
import { materializeExperimentReviewStateImpl } from "./workflow-guard-materializers/experiment-review-materializer";
import { applyExperimentGitOpImpl, getExperimentGitReviewSummaryImpl, requestExperimentGitOpImpl, setExperimentGitReviewStateImpl, } from "./workflow-experiment-git-review.js";
import { materializePaperStoryStateImpl } from "./workflow-guard-materializers/paper-story-materializer";
import { materializePlanStateImpl } from "./workflow-guard-materializers/plan-state-materializer";
import { materializeReviewPressurePacketImpl } from "./workflow-guard-materializers/review-pressure-materializer";
import { materializeSurveyReviewStateImpl } from "./workflow-guard-materializers/survey-review-materializer";
import { materializeInnovationSynthesis } from "./research-writing/innovation-synthesis";
import { materializeResultsStoryline } from "./research-writing/results-storyline";
import { materializeTitleAbstractIntroWorkbench } from "./research-writing/title-abstract-intro-workbench";
import { buildNonOwnerRoutingAdvice as buildNonOwnerRoutingAdviceImpl, acknowledgeWorkflowMailboxMessageImpl, getWorkflowContactCooldownImpl, getContactStatePath as getContactStatePathImpl, getMailboxPath as getMailboxPathImpl, getSharedWritingConstitutionLines as getSharedWritingConstitutionLinesImpl, inboxForRole as inboxForRoleImpl, maybeQueueAutoIteratorMailboxImpl, queueWorkflowMailboxMessageImpl, readWorkflowMailboxForAgentImpl, readContactStore as readContactStoreImpl, readMailbox as readMailboxImpl, recordWorkflowContactEventImpl, saveContactStore as saveContactStoreImpl, saveMailbox as saveMailboxImpl, } from "./workflow-guard-collaboration";
import { AUTO_ITERATOR_STARTED_TIMEOUT_MS, deriveEffectiveWorkflowAutoIteratorAudit, normalizeWorkflowAutoIteratorAudit, } from "./workflow-runtime-health.js";
import { buildExperimentLedgerSummary as buildExperimentLedgerSummaryImpl, buildExperimentMemoryDigest as buildExperimentMemoryDigestImpl, createEmptyExperimentLedger as createEmptyExperimentLedgerImpl, getExperimentLedgerPath as getExperimentLedgerPathImpl, getExperimentSearchPath as getExperimentSearchPathImpl, getExperimentSortTimestamp as getExperimentSortTimestampImpl, isTerminalExperimentStatus as isTerminalExperimentStatusImpl, loadExperimentLedgerIfExists as loadExperimentLedgerIfExistsImpl, loadExperimentSearchState as loadExperimentSearchStateImpl, mergeExperimentEntries as mergeExperimentEntriesImpl, metricToText as metricToTextImpl, normalizeExperimentEntry as normalizeExperimentEntryImpl, normalizeExperimentLedger as normalizeExperimentLedgerImpl, normalizeMetricRecord as normalizeMetricRecordImpl, normalizePapernexusSync as normalizePapernexusSyncImpl, readExperimentLedgerEnsured as readExperimentLedgerEnsuredImpl, saveExperimentLedger as saveExperimentLedgerImpl, saveExperimentSearchStateFile as saveExperimentSearchStateFileImpl, syncManifestExperimentMemoryImpl, } from "./workflow-guard-experiment-history";
import { getExperimentGpuMonitorStateSummary as getExperimentGpuMonitorStateSummaryImpl, refreshExperimentGpuMonitor as refreshExperimentGpuMonitorImpl, } from "./workflow-gpu-monitor.js";
import { defaultResearchProgramZoteroProjectPath as defaultResearchProgramZoteroProjectPathImpl, } from "./workflow-guard-project-state";
import { extractBrainstormCandidateRecords as extractBrainstormCandidateRecordsImpl, extractReviewIssues as extractReviewIssuesImpl, hasMeaningfulPayload as hasMeaningfulPayloadImpl, pickBrainstormPayload as pickBrainstormPayloadImpl, renderMarkdownishPayload as renderMarkdownishPayloadImpl, renderReasoningTracePayload as renderReasoningTracePayloadImpl, selectBrainstormCandidate as selectBrainstormCandidateImpl, summarizeReviewIssuesFromManifest as summarizeReviewIssuesFromManifestImpl, } from "./workflow-guard-prompt-support";
import { buildFocusedPromptAssemblyImpl, formatWorkflowSnapshotForPromptImpl, shouldUseFocusedWorkflowPromptImpl, } from "./workflow-guard-prompt-assembly";
// Facade-decomposition families:
// - workflow-guard-project/* owns project resolution, gate state, and snapshot assembly
// - workflow-guard-policies/* owns role policy, tool guards, and handoff normalization
// - workflow-guard-writing/* owns quality/readiness evaluation helpers
// - workflow-guard-setters/* owns manifest/runtime state mutation helpers
import { buildIdleResearchTemplateForBootstrap as buildIdleResearchTemplateForBootstrapFromModule, ensureWorkflowProjectRoot as ensureWorkflowProjectRootFromModule, getWorkflowProjectRoot as getProjectRootFromModule, inferWorkflowProjectId as inferProjectIdFromModule, loadWorkflowProjectState as loadProjectStateFromModule, } from "./workflow-guard-project/project-context";
import { computeWorkflowGateConfirmationDeadline as computeGateConfirmationDeadlineFromModule, getWorkflowGateStatePath as getGateStatePathFromModule, getWorkflowGateStateSummary as getGateStateSummaryFromModule, hasWorkflowTimedDefaultGateExpired as hasTimedDefaultGateExpiredFromModule, normalizeWorkflowGateState as normalizeGateStateFromModule, readWorkflowGateState as readGateStateFromModule, saveWorkflowGateState as saveGateStateFromModule, serializeWorkflowGateState as serializeGateStateFromModule, setWorkflowGateStateForWorkflow as setGateStateForWorkflowFromModule, } from "./workflow-guard-project/gate-state";
import { buildGraphImportRepairGuidance, buildWorkflowSnapshotFromProjectState, summarizeGraphPresenceMissing, } from "./workflow-guard-project/snapshot-builder";
import { formatWorkflowProjectDirEntry as formatProjectDirEntryFromModule, getWorkflowProjectsStatePath as getProjectsStatePathFromModule, readWorkflowProjectsStateRaw as readProjectsStateRawFromModule, syncWorkflowProjectsStateEntry as syncProjectsStateEntryFromModule, workflowDateOnly as dateOnlyFromModule, } from "./workflow-guard-project/projects-state";
import { canRoleContact as canRoleContactFromModule, canRoleContactInWorkflow as canRoleContactInWorkflowFromModule, canRoleSpawn as canRoleSpawnFromModule, canRoleSpawnInWorkflow as canRoleSpawnInWorkflowFromModule, inferTargetRoleFromToolParams as inferTargetRoleFromToolParamsFromModule, normalizeWorkflowRole as normalizeWorkflowRoleFromModule, ROLE_POLICIES as WORKFLOW_ROLE_POLICIES, STAGE_REQUIREMENTS as WORKFLOW_STAGE_REQUIREMENTS, } from "./workflow-guard-policies/role-policy";
import { hasAgentMention as hasAgentMentionFromModule, isWorkflowChannelHandoffMessage as isWorkflowChannelHandoffMessageFromModule, normalizeWorkflowChannelMentions as normalizeWorkflowChannelMentionsFromModule, sanitizeAgentMentions as sanitizeAgentMentionsFromModule, sanitizeMessageToolParams as sanitizeMessageToolParamsFromModule, } from "./workflow-guard-policies/handoff-rules";
import { shouldBlockCoderDatasetMutation as shouldBlockCoderDatasetMutationFromModule, shouldBlockInnovationWrite as shouldBlockInnovationWriteFromModule, shouldBlockPapernexusDestructiveOperation as shouldBlockPapernexusDestructiveOperationFromModule, shouldBlockPapernexusInlineExecution as shouldBlockPapernexusInlineExecutionFromModule, shouldBlockPapernexusLiveGraphCliRead as shouldBlockPapernexusLiveGraphCliReadFromModule, shouldBlockPapernexusLocalGraphProcessing as shouldBlockPapernexusLocalGraphProcessingFromModule, shouldBlockPapernexusLocalStorageUsage as shouldBlockPapernexusLocalStorageUsageFromModule, shouldBlockPapernexusLongWaitImportCommand as shouldBlockPapernexusLongWaitImportCommandFromModule, shouldBlockPapernexusMultiPaperImport as shouldBlockPapernexusMultiPaperImportFromModule, shouldBlockPapernexusRawHttpUsage as shouldBlockPapernexusRawHttpUsageFromModule, shouldBlockProjectWrite as shouldBlockProjectWriteFromModule, shouldBlockResearchGraphForce as shouldBlockResearchGraphForceFromModule, shouldBlockWriterTemplateWrite as shouldBlockWriterTemplateWriteFromModule, } from "./workflow-guard-policies/tool-guards";
import { getCitationCollectionStateSummary as getCitationCollectionStateSummaryFromModule, getCitationIntegrityStateSummary as getCitationIntegrityStateSummaryFromModule, getTheoryStateSummary as getTheoryStateSummaryFromModule, } from "./workflow-guard-writing/citation-theory-eval";
import { getFigureQcStateSummary as getFigureQcStateSummaryFromModule, getPaperQcStateSummary as getPaperQcStateSummaryFromModule, getReviewIssueTrackerStateSummary as getReviewIssueTrackerStateSummaryFromModule, } from "./workflow-guard-writing/paper-quality-eval";
import { setBrainstormCycleState as setBrainstormCycleStateFromModule, setExperimentReviewState as setExperimentReviewStateFromModule, setIdeationContractState as setIdeationContractStateFromModule, setIdleResearchState as setIdleResearchStateFromModule, setOrchestrationState as setOrchestrationStateFromModule, setPaperStoryState as setPaperStoryStateFromModule, setResearchProgramState as setResearchProgramStateFromModule, setReviewPressurePacketState as setReviewPressurePacketStateFromModule, setSurveyReviewState as setSurveyReviewStateFromModule, setWritePackageState as setWritePackageStateFromModule, } from "./workflow-guard-setters/research-state-setters";
import { setCitationCollectionState as setCitationCollectionStateFromModule, setExperimentSearchState as setExperimentSearchStateFromModule, setFigureQcState as setFigureQcStateFromModule, setPaperIngestionState as setPaperIngestionStateFromModule, setPaperQcState as setPaperQcStateFromModule, } from "./workflow-guard-setters/ingestion-state-setters";
import { setReviewIssueTrackerState as setReviewIssueTrackerStateFromModule } from "./workflow-guard-setters/review-state-setters";
import { setExternalReviewState as setExternalReviewStateFromModule, setGraphGuidedWritingState as setGraphGuidedWritingStateFromModule, setReviewSessionState as setReviewSessionStateFromModule, setWritingContractState as setWritingContractStateFromModule, setWritingSessionState as setWritingSessionStateFromModule, } from "./workflow-guard-setters/writing-state-setters";
import { buildExperimentReviewCommand, buildExperimentReviewSummary, deriveExperimentReviewMicroStage, getExperimentReviewStatePath, isReviewedAutoExperimentLaunchEnabled, loadExperimentReviewState, resolveExperimentReviewNextOwner, } from "./workflow-auto-experiment-review";
import { getExperimentMemorySummaryImpl, recordCitationVerificationImpl, recordIdleResearchRunImpl, recordInnovationReflectionImpl, upsertExperimentLedgerEntryImpl, } from "./workflow-guard-recorders/state-recorders";
import { runWorkflowAutoIteratorImpl } from "./workflow-guard-runtime/auto-iterator";
import { evaluateExperimentSearchDecision } from "./workflow-experiment-decision";
export { checkGraphPresenceForWorkflow } from "./graph-presence";
const DEFAULT_POLICY = {
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
    zoteroProjectRoot: "bot",
    papernexusApiBaseUrl: "",
    papernexusSharedCorpus: "",
    papernexusMcpUrl: "",
    papernexusMcpTransport: "streamable-http",
    papernexusMcpTimeoutMs: 30000,
    papernexusApiTokenEnv: "",
    papernexusApiTokenSource: "auto",
    papernexusApiTokenService: "papernexus-api-token",
    papernexusApiTokenAccount: "default",
    papernexusApiTokenLookupTimeoutMs: 2000,
    papernexusMineruHttpUrl: "",
    papernexusAccessMode: "auto",
    autoMode: normalizeWorkflowAutoMode(undefined),
    autoGate: normalizeWorkflowAutoGateConfig(undefined),
    lobsterHandoff: normalizeWorkflowLobsterHandoffConfig(undefined),
    teamRuntime: { enabled: true },
};
const WORKFLOW_ROLE_ORDER = [
    "researcher",
    "orchestrator",
    "coder",
    "analyzer",
    "academic_writer",
    "reviewer",
    "cross-reviewer",
];
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CITATION_SOURCE_OF_TRUTH = [
    "dblp",
    "crossref",
    "datacite",
    "semantic_scholar",
];
const DEFAULT_EXPERIMENT_SEARCH_PATH = "researcher/EXPERIMENT_SEARCH.json";
const DEFAULT_CITATION_BIB_PATH = "academic_writer/paper/refs.bib";
const DEFAULT_CITATION_REPORT_PATH = "reviewer/CITATION_VERIFICATION.md";
const DEFAULT_CITATION_COLLECTION_PROGRESS_PATH = "academic_writer/citations_progress.json";
const DEFAULT_CACHED_CITATIONS_BIB_PATH = "academic_writer/cached_citations.bib";
const DEFAULT_WRITING_SECTION_PACKET_DIR = "academic_writer/section-packets";
const DEFAULT_REVIEW_PACKET_PATH = "reviewer/REVIEW_PACKET.json";
const DEFAULT_REVIEW_ISSUES_PATH = "reviewer/REVIEW_ISSUES.json";
const DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH = "reviewer/GRAPH_EVIDENCE_SUMMARY.md";
const DEFAULT_RESEARCH_REVIEW_STATE_PATH = "researcher/REVIEW_STATE.json";
const DEFAULT_THEORY_STATE_PATH = "analyzer/THEORY_STATE.json";
const DEFAULT_THEORY_NOTE_PATH = "analyzer/THEORY_SUPPORT_NOTE.md";
const DEFAULT_PROOF_PACKET_DIR = "analyzer/proof-packets";
const DEFAULT_THEORY_APPENDIX_PLAN_PATH = "academic_writer/THEORY_APPENDIX_PLAN.md";
const DEFAULT_THEORY_APPENDIX_SECTION_PATH = "academic_writer/paper/sections/appendix_theory.tex";
const DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL = "future/literature-dehallucination";
const DEFAULT_PAPER_QC_REPORT_PATH = "academic_writer/PAPER_QC.md";
const DEFAULT_FIGURE_REVIEW_PATH = "reviewer/SURFACE_REVIEW.json";
const DEFAULT_FIGURE_SELECTION_PATH = "academic_writer/FIGURE_SELECTION.json";
const DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH = "reviewer/SUBMISSION_SIMULATION_REVIEW.json";
const DEFAULT_WRITE_PACKAGE_MANIFEST_PATH = "academic_writer/WRITE_PACKAGE.json";
const DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH = "academic_writer/WRITE_PACKAGE_ASSEMBLY_REPORT.json";
const DEFAULT_SECTION_ASSEMBLY_QUEUE_PATH = "academic_writer/SECTION_ASSEMBLY_QUEUE.json";
const DEFAULT_FIGURE_PACK_PATH = "academic_writer/FIGURE_PACK.json";
const DEFAULT_TABLE_PACK_PATH = "academic_writer/TABLE_PACK.json";
const DEFAULT_CITATION_CANDIDATES_PATH = "academic_writer/CITATION_CANDIDATES.json";
const DEFAULT_BRAINSTORM_CYCLE_DIR = "researcher/brainstorm-cycle";
const DEFAULT_BRAINSTORM_TOPIC_SUMMARY_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/TOPIC_SUMMARY.json`;
const DEFAULT_BRAINSTORM_RESEARCH_BRIEF_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/RESEARCH_BRIEF.json`;
const DEFAULT_BRAINSTORM_BRIEF_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/BRAINSTORM_BRIEF.json`;
const DEFAULT_BRAINSTORM_LOGIC_CHAIN_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/LOGIC_CHAIN.md`;
const DEFAULT_BRAINSTORM_EVIDENCE_CHAIN_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/EVIDENCE_CHAIN.md`;
const DEFAULT_BRAINSTORM_REASONING_TRACE_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REASONING_TRACE.jsonl`;
const DEFAULT_BRAINSTORM_QUESTION_PACKET_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/QUESTION_PACKET.md`;
const DEFAULT_BRAINSTORM_WORKING_MEMORY_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/WORKING_MEMORY.json`;
const DEFAULT_BRAINSTORM_SYNTHESIS_PACKET_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/SYNTHESIS_PACKET.md`;
const DEFAULT_BRAINSTORM_REFLECTION_CHAIN_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/REFLECTION_CHAIN.json`;
const DEFAULT_BRAINSTORM_THEORY_BRIEF_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/THEORY_BRIEF.json`;
const DEFAULT_BRAINSTORM_STORYLINE_BRIEF_PATH = `${DEFAULT_BRAINSTORM_CYCLE_DIR}/STORYLINE_BRIEF.json`;
const DEFAULT_IDEATION_DIR = "researcher/ideation";
const DEFAULT_IDEATION_PACKET_PATH = `${DEFAULT_IDEATION_DIR}/GRAPH_IDEATION_PACKET.json`;
const DEFAULT_IDEATION_IDEA_TREE_PATH = `${DEFAULT_IDEATION_DIR}/IDEA_TREE.md`;
const DEFAULT_IDEATION_NOVELTY_TREE_PATH = `${DEFAULT_IDEATION_DIR}/NOVELTY_TREE.md`;
const DEFAULT_IDEATION_CHALLENGE_INSIGHT_TREE_PATH = `${DEFAULT_IDEATION_DIR}/CHALLENGE_INSIGHT_TREE.md`;
const DEFAULT_IDEATION_SOLUTION_CHECK_PATH = `${DEFAULT_IDEATION_DIR}/WELL_ESTABLISHED_SOLUTION_CHECK.md`;
const DEFAULT_IDEATION_CROSS_DOMAIN_TRANSFER_PATH = `${DEFAULT_IDEATION_DIR}/CROSS_DOMAIN_TRANSFER.md`;
const DEFAULT_IDEATION_PROBLEM_DECOMPOSITION_PATH = `${DEFAULT_IDEATION_DIR}/PROBLEM_DECOMPOSITION.md`;
const DEFAULT_IDEATION_CANDIDATE_POOL_PATH = `${DEFAULT_IDEATION_DIR}/CANDIDATE_POOL.json`;
const DEFAULT_IDEATION_RANKING_HISTORY_PATH = `${DEFAULT_IDEATION_DIR}/RANKING_HISTORY.json`;
const DEFAULT_IDEATION_TOURNAMENT_SCOREBOARD_PATH = `${DEFAULT_IDEATION_DIR}/TOURNAMENT_SCOREBOARD.json`;
const DEFAULT_IDEATION_TOP3_SUMMARY_PATH = `${DEFAULT_IDEATION_DIR}/TOP3_DIRECTION_SUMMARY.md`;
const DEFAULT_IDEATION_RESEARCH_PROPOSAL_PATH = `${DEFAULT_IDEATION_DIR}/RESEARCH_PROPOSAL.md`;
const DEFAULT_PAPER_STORY_DIR = "academic_writer/story";
const DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH = `${DEFAULT_PAPER_STORY_DIR}/TASK_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH = `${DEFAULT_PAPER_STORY_DIR}/CHALLENGE_STATEMENT.md`;
const DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH = `${DEFAULT_PAPER_STORY_DIR}/INSIGHT_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/CONTRIBUTION_MAP.md`;
const DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/ADVANTAGE_MAP.md`;
const DEFAULT_PAPER_STORY_SPINE_PATH = `${DEFAULT_PAPER_STORY_DIR}/STORY_SPINE.md`;
const DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH = `${DEFAULT_PAPER_STORY_DIR}/PIPELINE_FIGURE_SKETCH.md`;
const DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/MODULE_MOTIVATION_MAP.md`;
const DEFAULT_PAPER_STORY_CLAIM_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/CLAIM_TO_EXPERIMENT_MAP.md`;
const DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH = `${DEFAULT_PAPER_STORY_DIR}/FALLBACK_NARRATIVE.md`;
const DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH = `${DEFAULT_PAPER_STORY_DIR}/REJECTION_RISK_TABLE.md`;
const DEFAULT_REVIEW_PRESSURE_DIR = "reviewer/story-pressure";
const DEFAULT_REJECT_FIRST_REVIEW_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/REJECT_FIRST_REVIEW.md`;
const DEFAULT_NOVELTY_ATTACK_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/NOVELTY_ATTACK.md`;
const DEFAULT_UNSUPPORTED_CLAIM_AUDIT_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/UNSUPPORTED_CLAIM_AUDIT.md`;
const DEFAULT_REVERSE_OUTLINE_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/REVERSE_OUTLINE.md`;
const DEFAULT_FIGURE_TABLE_QC_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/FIGURE_TABLE_QC.md`;
const DEFAULT_LIMITATION_AUDIT_PATH = `${DEFAULT_REVIEW_PRESSURE_DIR}/LIMITATION_AUDIT.md`;
const WRITING_MODE_PRESETS = {
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
        kgStorylineRequired: true,
        proofAppendixRequired: true,
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
        kgStorylineRequired: true,
        proofAppendixRequired: true,
    },
    survey: {
        mode: "survey",
        templateFile: "survey-review.md",
        templateName: "survey-review",
        bodyPageBudget: 12,
        referencePageBudget: 4,
        bodyWordTargetMin: 7000,
        bodyWordTargetMax: 10000,
        maxCoreIdeas: 4,
        maxHeadlineClaims: 6,
        requiredSections: [
            "abstract",
            "introduction",
            "scope_and_protocol",
            "taxonomy",
            "evidence_synthesis",
            "benchmark_landscape",
            "open_problems",
            "conclusion",
        ],
        sectionOrder: [
            "abstract",
            "introduction",
            "scope_and_protocol",
            "taxonomy",
            "evidence_synthesis",
            "benchmark_landscape",
            "open_problems",
            "conclusion",
        ],
        kgStorylineRequired: false,
        proofAppendixRequired: false,
    },
};
const ROLE_POLICIES = WORKFLOW_ROLE_POLICIES;
const STAGE_REQUIREMENTS = WORKFLOW_STAGE_REQUIREMENTS;
const STAGE_ENTRY_MICRO_STAGES = {
    setup: "state_reconciled",
    survey_review: "survey_requested",
    graph_build: "uploading",
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
const STAGE_EXECUTION_HINTS = {
    setup: {
        owner: "researcher",
        summary: "Lock the onboarding contract before doing fresh work.",
        command: "Run /project-init to lock the research goal, baseline, primary metric, datasets, success criteria, and configured Zotero project path; then run /resume-pipeline to reconcile PROJECT_MANIFEST.json, TRACK_REGISTRY.json, CLAIM_POLICY.md, idle_research, and the experiment ledger.",
    },
    survey_review: {
        owner: "researcher",
        summary: "Run the survey loop until the review packet is saturated, then hand off into survey-mode writing.",
        command: 'Run /survey-pipeline "topic" to expand retrieval coverage, stabilize taxonomy, complete representative-method + benchmark alignment coverage, and synthesize SURVEY_BRIEF.md plus the survey review artifacts before WRITE handoff.',
    },
    graph_build: {
        owner: "researcher",
        summary: "Drive workflow-owned upload, graph verification, and core brainstorm refresh before downstream reasoning.",
        command: "Run /graph-build to let workflow-owned upload requests finish, verify PAPER_SOURCE_INDEX.json is reflected in the shared global graph, and refresh the core brainstorm bundle before frontier mapping.",
    },
    frontier_mapping: {
        owner: "researcher",
        summary: "Package graph-grounded frontiers for ideation.",
        command: "Run /frontier-mapping and refresh FRONTIER_REPORT.md plus the frontier files under {PROJ}/graph before moving into idea selection.",
    },
    idea: {
        owner: "researcher",
        summary: "Refresh ideation using the latest graph and experiment reflection.",
        command: "If innovation reflection is due, run /innovation-reflection first; then run /idea-phase and keep 1-2 active tracks with current reasoning packets.",
    },
    plan: {
        owner: "orchestrator",
        summary: "Produce the executable research plan for the active tracks.",
        command: "Run /plan-research using IDEA_REPORT.md and TRACK_REGISTRY.json, then write PLAN.md, TODOS.md, and PLAN_AUDIT.md.",
    },
    code: {
        owner: "coder",
        summary: "Turn the approved plan into runnable experiment bundles.",
        command: "Implement the approved experiments as structured bundles under coder/experiments/<track-id>/<experiment-id>__<slug>/, write EXPERIMENT_MANIFEST.json + README.md for each bundle, and keep coder/EXPERIMENT_INDEX.md current before launches.",
    },
    experiment: {
        owner: "researcher",
        summary: "Launch, monitor, and reconcile the approved experiments.",
        command: "If launches are still pending, run /experiment-phase or wake Coder /run-experiment; if an approved search envelope exists, prefer waking Coder /search-experiment for the bounded inner loop. Once remote runs exist, switch to /monitor-experiment, reconcile EXPERIMENT_REGISTRY.md and EXPERIMENT_LEDGER.json, and mark experiment_search ready_for_analysis only when evaluation and plot-pack artifacts are complete.",
    },
    analyze: {
        owner: "analyzer",
        summary: "Convert experiment outputs into claim-evidence artifacts.",
        command: "Run the analysis pipeline and produce narrative, evidence-matrix, verdict, unsupported-claims, and quality-audit artifacts.",
    },
    review: {
        owner: "reviewer",
        summary: "Stress-test the paper package before writing or submission.",
        command: "Run /review-phase or reviewer /resume-pipeline to generate the review report and synchronize REVIEW_STATE.json.",
    },
    write: {
        owner: "academic_writer",
        summary: "Draft the paper under the active writing contract.",
        command: "Run /paper-phase with the active writing mode, KG storyline packet, template mapping, paragraph-logic checks, and source-of-truth citations before finalizing prose.",
    },
    submit: {
        owner: "reviewer",
        summary: "Prepare the external review packet and wait for the revision decision.",
        command: "Complete external review packaging and rebuttal materials, then stop for the mandatory GATE-5 human decision; the OpenReview-facing final submission path must be explicitly confirmed by a human and is never auto-completed.",
    },
    revise: {
        owner: "researcher",
        summary: "Route the project back into the requested revision loop.",
        command: "Run /resume-pipeline, classify the revision request, and route the project back to WRITE or EXPERIMENT with updated next_action.",
    },
    done: {
        owner: "researcher",
        summary: "Archive the completed project and select the next queued project if applicable.",
        command: "Archive the completed project, update PROJECTS_STATE.json, and if queue mode is active, identify the next active project to resume.",
    },
};
function getPreviousStagesForRegression(params) {
    const normalizedStage = normalizeStage(params.currentStage);
    if (!normalizedStage) {
        return [];
    }
    const candidates = Object.entries(STAGE_REQUIREMENTS)
        .filter(([stage, requirement]) => requirement.nextStage === normalizedStage && stage !== normalizedStage)
        .map(([stage]) => stage);
    if (normalizedStage !== "write") {
        return candidates;
    }
    const preferredOrder = isSurveyWorkflow(params.manifest)
        ? ["survey_review", "review", "revise"]
        : ["review", "revise", "survey_review"];
    return preferredOrder.filter((stage) => candidates.includes(stage));
}
function normalizePolicy(config) {
    return {
        allowWorkspaceFallback: config?.allowWorkspaceFallback === true
            ? true
            : DEFAULT_POLICY.allowWorkspaceFallback,
        injectWorkflowContext: config?.injectWorkflowContext === false
            ? false
            : DEFAULT_POLICY.injectWorkflowContext,
        enforceWorkflowBoundaries: config?.enforceWorkflowBoundaries === false
            ? false
            : DEFAULT_POLICY.enforceWorkflowBoundaries,
        blockDiscordAgentMentions: config?.blockDiscordAgentMentions === false
            ? false
            : DEFAULT_POLICY.blockDiscordAgentMentions,
        enableWorkflowMailbox: config?.enableWorkflowMailbox === false
            ? false
            : DEFAULT_POLICY.enableWorkflowMailbox,
        heartbeatBackgroundChecks: config?.heartbeatBackgroundChecks === false
            ? false
            : DEFAULT_POLICY.heartbeatBackgroundChecks,
        maxWorkflowInboxMessages: typeof config?.maxWorkflowInboxMessages === "number" &&
            Number.isFinite(config.maxWorkflowInboxMessages)
            ? Math.max(1, Math.floor(config.maxWorkflowInboxMessages))
            : DEFAULT_POLICY.maxWorkflowInboxMessages,
        agentContactCooldownSeconds: typeof config?.agentContactCooldownSeconds === "number" &&
            Number.isFinite(config.agentContactCooldownSeconds)
            ? Math.max(0, Math.floor(config.agentContactCooldownSeconds))
            : DEFAULT_POLICY.agentContactCooldownSeconds,
        projectsRoot: asString(config?.projectsRoot) ??
            DEFAULT_POLICY.projectsRoot,
        enableChannelProjectBindings: config?.enableChannelProjectBindings === true
            ? true
            : DEFAULT_POLICY.enableChannelProjectBindings,
        channelProjectBindingsPath: asString(config?.channelProjectBindingsPath) ??
            DEFAULT_POLICY.channelProjectBindingsPath,
        defaultConferenceTemplatePath: asString(config?.defaultConferenceTemplatePath) ??
            DEFAULT_POLICY.defaultConferenceTemplatePath,
        defaultJournalTemplatePath: asString(config?.defaultJournalTemplatePath) ??
            DEFAULT_POLICY.defaultJournalTemplatePath,
        zoteroProjectRoot: asString(config?.zoteroProjectRoot) ??
            DEFAULT_POLICY.zoteroProjectRoot,
        papernexusApiBaseUrl: asString(config?.papernexusApiBaseUrl) ??
            DEFAULT_POLICY.papernexusApiBaseUrl,
        papernexusSharedCorpus: asString(config?.papernexusSharedCorpus) ??
            DEFAULT_POLICY.papernexusSharedCorpus,
        papernexusMcpUrl: asString(config?.papernexusMcpUrl) ??
            DEFAULT_POLICY.papernexusMcpUrl,
        papernexusMcpTransport: normalizePapernexusMcpTransport(config?.papernexusMcpTransport) ?? DEFAULT_POLICY.papernexusMcpTransport,
        papernexusMcpTimeoutMs: typeof config?.papernexusMcpTimeoutMs === "number" &&
            Number.isFinite(config?.papernexusMcpTimeoutMs)
            ? Math.max(1000, Math.floor((config?.papernexusMcpTimeoutMs ??
                DEFAULT_POLICY.papernexusMcpTimeoutMs)))
            : DEFAULT_POLICY.papernexusMcpTimeoutMs,
        papernexusApiTokenEnv: asString(config?.papernexusApiTokenEnv) ??
            DEFAULT_POLICY.papernexusApiTokenEnv,
        papernexusApiTokenSource: normalizePapernexusApiTokenSource(config?.papernexusApiTokenSource) ??
            DEFAULT_POLICY.papernexusApiTokenSource,
        papernexusApiTokenService: asString(config?.papernexusApiTokenService) ??
            DEFAULT_POLICY.papernexusApiTokenService,
        papernexusApiTokenAccount: asString(config?.papernexusApiTokenAccount) ??
            DEFAULT_POLICY.papernexusApiTokenAccount,
        papernexusApiTokenLookupTimeoutMs: typeof config?.papernexusApiTokenLookupTimeoutMs === "number" &&
            Number.isFinite(config.papernexusApiTokenLookupTimeoutMs)
            ? Math.max(250, Math.floor(config.papernexusApiTokenLookupTimeoutMs))
            : DEFAULT_POLICY.papernexusApiTokenLookupTimeoutMs,
        papernexusMineruHttpUrl: asString(config?.papernexusMineruHttpUrl) ??
            DEFAULT_POLICY.papernexusMineruHttpUrl,
        papernexusAccessMode: normalizePapernexusAccessMode(config?.papernexusAccessMode) ??
            DEFAULT_POLICY.papernexusAccessMode,
        autoMode: config && typeof config === "object"
            ? normalizeWorkflowAutoMode(config.autoMode)
            : DEFAULT_POLICY.autoMode,
        autoGate: config && typeof config === "object"
            ? normalizeWorkflowAutoGateConfig(config.autoGate)
            : DEFAULT_POLICY.autoGate,
        lobsterHandoff: config && typeof config === "object"
            ? normalizeWorkflowLobsterHandoffConfig(config.lobsterHandoff)
            : DEFAULT_POLICY.lobsterHandoff,
        teamRuntime: config && typeof config === "object" &&
            config.teamRuntime &&
            typeof config.teamRuntime === "object"
            ? {
                enabled: config.teamRuntime
                    .enabled === false
                    ? false
                    : true,
            }
            : DEFAULT_POLICY.teamRuntime,
    };
}
function normalizeRole(value) {
    return normalizeWorkflowRoleFromModule(value);
}
function getDefaultPapernexusSourceDir(projectId) {
    if (!projectId) {
        return null;
    }
    return path.join(os.homedir(), ".papernexus", "papers");
}
function getDefaultPapernexusIndexRoot() {
    return path.join(os.homedir(), ".papernexus", "index-store");
}
function isLocalPapernexusStoragePath(value) {
    const raw = value?.trim();
    if (!raw) {
        return false;
    }
    if (/\bPAPERNEXUS_ROOT\b/i.test(raw)) {
        return true;
    }
    const normalized = raw.replace(/\\/g, "/");
    return /(?:^|[=\s"'`])(?:~|\$HOME|\$\{HOME\}|\/[^\s"'`|;&]*)\/\.papernexus\/(?:papers|index-store)(?:\/|$)/i.test(normalized);
}
function isRemoteOnlyPapernexusWorkflow(params) {
    return Boolean((params.apiBaseUrl && params.apiBaseUrl.trim()) ||
        (params.mcpUrl && params.mcpUrl.trim()));
}
function getTemplatesRoot() {
    return path.resolve(MODULE_DIR, "..", "templates");
}
function buildIdleResearchTemplateForBootstrap(params) {
    return buildIdleResearchTemplateForBootstrapFromModule(params);
}
export async function ensureWorkflowProjectRoot(params) {
    return (await ensureWorkflowProjectRootFromModule(params));
}
function isBundledWritingModeTemplatePath(templatePath) {
    if (!templatePath) {
        return false;
    }
    const normalized = path.normalize(templatePath);
    return Object.values(WRITING_MODE_PRESETS).some((preset) => normalized.endsWith(path.normalize(path.join("templates", "writing", preset.templateFile))));
}
function getGraphPresenceMissingEntries(paperIngestion) {
    if (!paperIngestion || !Array.isArray(paperIngestion.graph_presence_missing_papers)) {
        return [];
    }
    return paperIngestion.graph_presence_missing_papers
        .map((item) => asRecord(item))
        .filter((item) => Boolean(item));
}
function getProjectRoot(options) {
    return getProjectRootFromModule(options);
}
function inferProjectId(projectRoot, manifest) {
    return inferProjectIdFromModule(projectRoot, manifest);
}
function getMailboxPath(projectRoot) {
    return getMailboxPathImpl(projectRoot);
}
async function readMailbox(projectRoot) {
    return readMailboxImpl({ projectRoot, readJsonIfExists });
}
async function saveMailbox(projectRoot, mailbox) {
    await saveMailboxImpl({ projectRoot, mailbox, writeJsonEnsured });
}
function getContactStatePath(projectRoot) {
    return getContactStatePathImpl(projectRoot);
}
async function readContactStore(projectRoot) {
    return readContactStoreImpl({ projectRoot, readJsonIfExists });
}
async function saveContactStore(projectRoot, store) {
    await saveContactStoreImpl({ projectRoot, store, writeJsonEnsured });
}
function getExperimentLedgerPath(projectRoot) {
    return getExperimentLedgerPathImpl(projectRoot);
}
function getExperimentSearchPath(projectRoot) {
    return getExperimentSearchPathImpl(projectRoot);
}
function createEmptyExperimentLedger(projectId) {
    return createEmptyExperimentLedgerImpl(projectId);
}
function isTerminalExperimentStatus(status) {
    return isTerminalExperimentStatusImpl(status);
}
function normalizePapernexusSync(value) {
    return normalizePapernexusSyncImpl(value);
}
function normalizeMetricRecord(value) {
    return normalizeMetricRecordImpl(value);
}
function metricToText(metric) {
    return metricToTextImpl(metric);
}
function normalizeExperimentEntry(entry, defaults) {
    return normalizeExperimentEntryImpl(entry, defaults);
}
function mergeExperimentEntries(existing, incoming, defaults) {
    return mergeExperimentEntriesImpl(existing, incoming, defaults);
}
function getExperimentSortTimestamp(entry) {
    return getExperimentSortTimestampImpl(entry);
}
function buildExperimentLedgerSummary(experiments) {
    return buildExperimentLedgerSummaryImpl(experiments);
}
function normalizeExperimentLedger(raw, projectId) {
    return normalizeExperimentLedgerImpl(raw, projectId);
}
async function loadExperimentLedgerIfExists(projectRoot) {
    return (await loadExperimentLedgerIfExistsImpl({
        projectRoot,
        readJsonIfExists,
    }));
}
async function readExperimentLedgerEnsured(projectRoot) {
    return (await readExperimentLedgerEnsuredImpl({
        projectRoot,
        readJsonIfExists,
    }));
}
async function saveExperimentLedger(projectRoot, ledger) {
    await saveExperimentLedgerImpl({
        projectRoot,
        ledger,
        writeJsonEnsured,
    });
}
async function loadExperimentSearchState(params) {
    return (await loadExperimentSearchStateImpl({
        ...params,
        readJsonIfExists,
    }));
}
async function saveExperimentSearchStateFile(projectRoot, state) {
    await saveExperimentSearchStateFileImpl({
        projectRoot,
        state,
        writeJsonEnsured,
    });
}
async function syncManifestExperimentMemory(params) {
    return await syncManifestExperimentMemoryImpl(params, {
        readJsonIfExists,
        writeJsonEnsured,
        normalizeInnovationReflectionState: (value) => normalizeInnovationReflectionState(value),
        serializeInnovationReflectionState: (value) => serializeInnovationReflectionState(value),
        isInnovationReflectionDue: ({ state, ledger }) => isInnovationReflectionDue({
            state: state,
            ledger: ledger,
        }),
    });
}
async function getManifestPath(projectRoot) {
    return path.join(projectRoot, "PROJECT_MANIFEST.json");
}
async function readManifestEnsured(projectRoot) {
    const manifestPath = await getManifestPath(projectRoot);
    return (await readJsonIfExists(manifestPath)) ?? {};
}
async function saveManifest(projectRoot, manifest) {
    const manifestPath = await getManifestPath(projectRoot);
    manifest.updated_at = new Date().toISOString();
    await writeJsonEnsured(manifestPath, manifest);
}
async function upsertJsonArtifact(targetPath, patch) {
    if (!targetPath) {
        return;
    }
    const current = (await readJsonIfExists(targetPath)) ?? {};
    await writeJsonEnsured(targetPath, {
        ...current,
        ...patch,
    });
}
async function scaffoldMarkdownArtifactIfMissing(targetPath, content) {
    if (!targetPath) {
        return;
    }
    if (await pathExists(targetPath)) {
        return;
    }
    await writeTextEnsured(targetPath, content);
}
function getGateStatePath(projectRoot) {
    return getGateStatePathFromModule(projectRoot);
}
function normalizeGateState(value) {
    return normalizeGateStateFromModule(value);
}
function serializeGateState(state) {
    return serializeGateStateFromModule(state);
}
async function readGateState(projectRoot) {
    return (await readGateStateFromModule({
        projectRoot,
        readJsonIfExists,
    }));
}
async function saveGateState(projectRoot, gateState) {
    await saveGateStateFromModule({
        projectRoot,
        gateState,
        writeJsonEnsured,
    });
}
function computeGateConfirmationDeadline(state) {
    return computeGateConfirmationDeadlineFromModule(state);
}
function isTimedDefaultGate(state) {
    return normalizeStage(state.gateType) === "timed_default";
}
function hasTimedDefaultGateExpired(state, now) {
    return hasTimedDefaultGateExpiredFromModule(state, now);
}
export async function getGateStateSummary(params) {
    return (await getGateStateSummaryFromModule({
        ...params,
        readJsonIfExists,
    }));
}
export async function setGateStateForWorkflow(params) {
    return (await setGateStateForWorkflowFromModule({
        ...params,
        readJsonIfExists,
        writeJsonEnsured,
    }));
}
function getProjectsStatePath(projectRoot) {
    return getProjectsStatePathFromModule(projectRoot);
}
async function readProjectsStateRaw(projectRoot) {
    return await readProjectsStateRawFromModule({
        projectRoot,
        readJsonIfExists,
    });
}
function formatProjectDirEntry(projectId) {
    return formatProjectDirEntryFromModule(projectId);
}
function dateOnly(isoTs) {
    return dateOnlyFromModule(isoTs);
}
function formatStageCommand(stage) {
    if (!stage) {
        return null;
    }
    return STAGE_EXECUTION_HINTS[stage]?.command ?? null;
}
function formatWorkflowShellArgument(value) {
    return formatWorkflowShellArgumentFromKernel(value);
}
function buildGraphImportRepairSlashCommand(targetCorpus) {
    const normalizedCorpus = asString(targetCorpus);
    return (`/graph-build --repair-import true` +
        (normalizedCorpus
            ? ` --shared-corpus ${formatWorkflowShellArgument(normalizedCorpus)}`
            : ""));
}
function formatStageSummary(stage) {
    if (!stage) {
        return null;
    }
    return STAGE_EXECUTION_HINTS[stage]?.summary ?? null;
}
function stageOwner(stage) {
    return resolveWorkflowStageLeadRole({ stage });
}
function getAutoIteratorAuditPath(projectRoot) {
    return path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json");
}
async function writeAutoIteratorAuditLifecycle(params) {
    const auditPath = getAutoIteratorAuditPath(params.projectRoot);
    const existing = normalizeWorkflowAutoIteratorAudit(await readJsonIfExists(auditPath));
    const startedAt = params.startedAt ??
        existing?.startedAt ??
        (params.status === "started" ? params.updatedAt : null);
    const errorRecord = params.error instanceof Error
        ? {
            name: params.error.name,
            message: params.error.message,
        }
        : params.error && typeof params.error === "object"
            ? params.error
            : params.error == null
                ? null
                : {
                    message: String(params.error),
                };
    await writeJsonEnsured(auditPath, {
        schemaVersion: 2,
        runId: params.runId,
        status: params.status,
        startedAt,
        completedAt: params.status === "completed" ? params.completedAt ?? params.updatedAt : null,
        failedAt: params.status === "failed" ? params.failedAt ?? params.updatedAt : null,
        updatedAt: params.updatedAt,
        summary: params.summary ??
            (params.status === "started"
                ? "Auto iterator started."
                : params.status === "completed"
                    ? "Auto iterator completed."
                    : params.status === "failed"
                        ? "Auto iterator failed."
                        : params.status === "timed_out"
                            ? `Auto iterator timed out after ${Math.round(AUTO_ITERATOR_STARTED_TIMEOUT_MS / 60000)} minutes without a terminal audit.`
                            : params.status === "superseded"
                                ? "Auto iterator was superseded by a newer run."
                                : "Auto iterator aborted before completion."),
        result: params.result ?? (params.status === "completed" ? existing?.result ?? null : null),
        error: params.status === "failed" || params.status === "aborted" ? errorRecord : null,
    });
    return auditPath;
}
async function evaluateGateBlocking(params) {
    const stage = params.stage;
    const gateStatus = params.gateState.gateStatus;
    const lastGate = params.gateState.lastGate?.trim().toUpperCase() ?? null;
    if (stage === "code" && params.hasStageWorkRemaining !== true) {
        const codeResult = await evaluateCodeAutoReview({
            projectRoot: params.projectRoot,
            autoMode: params.effectiveAutoMode,
            autoGate: params.autoGate,
            hasStageWorkRemaining: false,
        });
        return {
            ...codeResult,
            timedDefaultTriggered: false,
        };
    }
    if (stage === "submit" && params.hasStageWorkRemaining !== true) {
        if (lastGate === "GATE-5" && gateStatus === "approved") {
            return {
                blocking: false,
                reason: null,
                timedDefaultTriggered: false,
            };
        }
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
async function syncProjectsStateEntry(params) {
    return await syncProjectsStateEntryFromModule(params, {
        readJsonIfExists,
        writeJsonEnsured,
        getActiveTracks,
    });
}
async function writeAutoIteratorAudit(projectRoot, result) {
    const updatedAt = new Date().toISOString();
    const existing = normalizeWorkflowAutoIteratorAudit(await readJsonIfExists(getAutoIteratorAuditPath(projectRoot)));
    const auditPath = await writeAutoIteratorAuditLifecycle({
        projectRoot,
        runId: existing?.runId ?? randomUUID(),
        status: "completed",
        startedAt: existing?.startedAt ?? updatedAt,
        updatedAt,
        completedAt: updatedAt,
        summary: `Auto iterator evaluated ${result.stageBefore ?? "unknown"} -> ${result.stageAfter ?? "unknown"}.`,
        result,
    });
    return auditPath;
}
async function maybeQueueAutoIteratorMailbox(params) {
    return maybeQueueAutoIteratorMailboxImpl(params, {
        canRoleContact,
        getWorkflowContactCooldown,
        queueWorkflowMailboxMessage,
        recordWorkflowContactEvent,
    });
}
function sanitizeTemplateCopyName(value) {
    const cleaned = value
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return cleaned || "template";
}
function getConfiguredWritingModeTemplatePath(policy, mode) {
    const normalized = normalizePolicy(policy);
    const configured = mode === "conference"
        ? normalized.defaultConferenceTemplatePath
        : mode === "journal"
            ? normalized.defaultJournalTemplatePath
            : null;
    return configured || null;
}
async function copyWritingTemplateIntoProject(params) {
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
        const destinationDir = path.join(templateBundleRoot, `${modePrefix}${sanitizeTemplateCopyName(path.basename(resolvedSourcePath))}`);
        await fs.rm(destinationDir, { recursive: true, force: true });
        await fs.cp(resolvedSourcePath, destinationDir, { recursive: true, force: true });
        return {
            projectTemplatePath: path.relative(projectRoot, destinationDir),
            projectTemplateResolvedPath: destinationDir,
        };
    }
    const sourceDir = path.dirname(resolvedSourcePath);
    const destinationDir = path.join(templateBundleRoot, `${modePrefix}${sanitizeTemplateCopyName(path.basename(sourceDir))}`);
    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.cp(sourceDir, destinationDir, { recursive: true, force: true });
    const destinationFile = path.join(destinationDir, path.basename(resolvedSourcePath));
    return {
        projectTemplatePath: path.relative(projectRoot, destinationFile),
        projectTemplateResolvedPath: destinationFile,
    };
}
async function resolveBundledWritingModeTemplatePath(mode) {
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
function isRuntimeReadyStatus(value, readyStates) {
    const normalized = normalizeStage(value);
    return normalized ? readyStates.includes(normalized) : false;
}
function areWritingSectionPacketsReady(state) {
    const packets = Object.values(state.sectionPackets);
    return (packets.length > 0 &&
        packets.every((packet) => {
            const packetStatus = normalizeStage(packet.status);
            const reviewVerdict = normalizeStage(packet.reviewVerdict);
            return (!packet.stale &&
                packet.forbiddenUnsupportedClaims.length === 0 &&
                packet.missingCitationPlaceholders.length === 0 &&
                (packetStatus === "finalized" ||
                    packetStatus === "locked" ||
                    packetStatus === "compile_safe" ||
                    reviewVerdict === "publication_ready"));
        }));
}
function isWritingSessionReadyForSubmit(state) {
    return (isRuntimeReadyStatus(state.status, [
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
        ]));
}
function isGraphGuidedWritingReadyForSubmit(state) {
    if (!state.enabled) {
        return true;
    }
    return (isRuntimeReadyStatus(state.status, [
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
        state.missingEvidenceClaims.length === 0);
}
function isExternalReviewConclusionReady(state) {
    return (isRuntimeReadyStatus(state.status, [
        "received",
        "ready",
        "complete",
        "completed",
        "accepted_for_handoff",
    ]) &&
        Boolean(state.overallRecommendation));
}
function isExperimentSearchReadyForAnalysis(state) {
    return (isRuntimeReadyStatus(state.status, [
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
        Boolean(state.plotPackPath));
}
function hasActiveExperimentRuns(ledger) {
    if (!ledger) {
        return false;
    }
    if (ledger.summary.activeExperimentIds.length > 0) {
        return true;
    }
    return ledger.experiments.some((entry) => !isTerminalExperimentStatus(entry.status));
}
function hasFinishedExperimentWorkAwaitingReconciliation(params) {
    if (!params.ledger || isExperimentSearchReadyForAnalysis(params.experimentSearch)) {
        return false;
    }
    return params.ledger.experiments.some((entry) => isTerminalExperimentStatus(entry.status) &&
        Boolean(entry.completedAt ||
            entry.resultPaths.length > 0 ||
            entry.evidencePointers.length > 0 ||
            entry.keyMetric ||
            entry.metrics));
}
function buildExperimentMonitorCommand() {
    return "Run /monitor-experiment to reconcile remote experiments from durable runtime artifacts first (REMOTE_RUN.json, RUN_HEARTBEAT.json, RUN_TERMINAL.json, RESULT_SUMMARY.json, FAILURE_SIGNATURE.json), persist missing watcher signals through research_workflow.record_experiment_runtime_signal when needed, and promote completed runs into artifacts/results/, EXPERIMENT_REGISTRY.md, EXPERIMENT_LEDGER.json, and experiment_search until ready_for_analysis. If coder-side search is active, keep retained incumbent history and discarded candidate history distinct.";
}
function isPaperQcHardFailure(state) {
    if (normalizeStage(state.status) === "missing") {
        return false;
    }
    return [state.compileStatus, state.pageBudgetStatus, state.invalidFigureRefStatus].some((value) => normalizeStage(value) === "fail");
}
function isFigureQcHardFailure(state) {
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
function isCitationCollectionHardFailure(state) {
    if (normalizeStage(state.status) === "missing") {
        return false;
    }
    return normalizeStage(state.status) === "blocked" || state.hallucinatedCount > 0;
}
function isResolvedReviewIssueStatus(status) {
    return ["fixed", "verified", "waived", "closed", "resolved"].includes(normalizeStage(status) ?? "");
}
function countReviewIssueLanes(issues) {
    let surface = 0;
    let submission = 0;
    for (const issue of issues) {
        if (isResolvedReviewIssueStatus(issue.status)) {
            continue;
        }
        const lane = normalizeStage(issue.lane);
        if (lane === "surface") {
            surface += 1;
        }
        else if (lane === "submission") {
            submission += 1;
        }
    }
    return { surface, submission };
}
function hasUnwaivedMediumOrHigherReviewIssues(state) {
    if (state.status === "waived") {
        return false;
    }
    if (state.issues.length === 0) {
        return (state.openCounts.critical > 0 ||
            state.openCounts.high > 0 ||
            state.openCounts.medium > 0);
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
function hasBlockingReviewIssues(state) {
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
function extractReviewIssues(value) {
    return extractReviewIssuesImpl(value);
}
function summarizeReviewIssuesFromManifest(value) {
    return summarizeReviewIssuesFromManifestImpl(value);
}
async function hydrateReviewIssueTrackerState(params) {
    const state = normalizeReviewIssueTrackerState(params.value);
    const issueManifestResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.issueManifestPath);
    if (!issueManifestResolvedPath || !(await pathExists(issueManifestResolvedPath))) {
        return state;
    }
    const issueManifest = await readJsonIfExists(issueManifestResolvedPath);
    if (!issueManifest) {
        return state;
    }
    const issueManifestRecord = asRecord(issueManifest);
    if (issueManifestRecord) {
        const hydratedState = normalizeReviewIssueTrackerState(issueManifestRecord);
        const hasExplicitCounts = Object.prototype.hasOwnProperty.call(issueManifestRecord, "open_counts") ||
            Object.prototype.hasOwnProperty.call(issueManifestRecord, "openCounts");
        return {
            ...state,
            status: hydratedState.status ?? state.status,
            issues: hydratedState.issues.length > 0 ? hydratedState.issues : state.issues,
            openCounts: hasExplicitCounts ? hydratedState.openCounts : state.openCounts,
            scoreRecords: hydratedState.scoreRecords.length > 0 ? hydratedState.scoreRecords : state.scoreRecords,
            lastReviewRound: hydratedState.lastReviewRound > 0 ? hydratedState.lastReviewRound : state.lastReviewRound,
            lastUpdatedAt: hydratedState.lastUpdatedAt ?? state.lastUpdatedAt,
            pendingReason: hydratedState.pendingReason ?? state.pendingReason,
        };
    }
    const hydrated = summarizeReviewIssuesFromManifest(issueManifest);
    return {
        ...state,
        issues: hydrated.issues,
        openCounts: hydrated.counts,
    };
}
function getResearchProgramValidationErrors(state) {
    return getResearchProgramValidationErrorsFromKernel(state);
}
function getResearchProgramPlanValidationErrors(params) {
    return getResearchProgramPlanValidationErrorsFromKernel(params);
}
function defaultResearchProgramZoteroProjectPath(projectId) {
    return defaultResearchProgramZoteroProjectPathImpl(projectId);
}
function getResearchProgramOnboardingGaps(params) {
    return getResearchProgramOnboardingGapsFromKernel(params);
}
function getResearchProgramOnboardingStatus(params) {
    return getResearchProgramOnboardingStatusFromKernel(params);
}
function isIdeationContractReady(state) {
    return ["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "");
}
function getIdeationContractValidationErrors(state) {
    const errors = [];
    if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
        errors.push(`PROJECT_MANIFEST.json.ideation_contract.status = ready|reconciled|approved (current: ${state.status})`);
    }
    if (!Number.isFinite(state.contractVersion ?? NaN)) {
        errors.push("PROJECT_MANIFEST.json.ideation_contract.contract_version is required");
    }
    for (const [field, value] of [
        ["long_term_goal", state.longTermGoal],
        ["basis_stage", state.basisStage],
        ["idea_tree_path", state.ideaTreePath],
        ["novelty_tree_path", state.noveltyTreePath],
        ["challenge_insight_tree_path", state.challengeInsightTreePath],
        ["solution_check_path", state.solutionCheckPath],
        ["cross_domain_transfer_path", state.crossDomainTransferPath],
        ["problem_decomposition_path", state.problemDecompositionPath],
        ["candidate_pool_path", state.candidatePoolPath],
        ["ranking_history_path", state.rankingHistoryPath],
        ["tournament_scoreboard_path", state.tournamentScoreboardPath],
        ["top3_summary_path", state.top3SummaryPath],
        ["research_proposal_path", state.researchProposalPath],
        ["graph_ideation_packet_path", state.graphIdeationPacketPath],
    ]) {
        if (!value) {
            errors.push(`PROJECT_MANIFEST.json.ideation_contract.${field} is required`);
        }
    }
    if (state.graphIdeationIndices.status === "missing") {
        errors.push("PROJECT_MANIFEST.json.ideation_contract.graph_ideation_indices.status must not be missing");
    }
    return errors;
}
function isPaperStoryStateReady(state) {
    return ["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "");
}
function getPaperStoryStateValidationErrors(state) {
    const errors = [];
    if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
        errors.push(`PROJECT_MANIFEST.json.paper_story_state.status = ready|reconciled|approved (current: ${state.status})`);
    }
    for (const [field, value] of [
        ["task_summary_path", state.taskSummaryPath],
        ["challenge_statement_path", state.challengeStatementPath],
        ["insight_summary_path", state.insightSummaryPath],
        ["contribution_map_path", state.contributionMapPath],
        ["advantage_map_path", state.advantageMapPath],
        ["story_spine_path", state.storySpinePath],
        ["pipeline_figure_sketch_path", state.pipelineFigureSketchPath],
        ["module_motivation_map_path", state.moduleMotivationMapPath],
        ["claim_to_experiment_map_path", state.claimToExperimentMapPath],
        ["idea_to_claim_map_path", state.ideaToClaimMapPath],
        ["fallback_narrative_path", state.fallbackNarrativePath],
        ["rejection_risk_table_path", state.rejectionRiskTablePath],
    ]) {
        if (!value) {
            errors.push(`PROJECT_MANIFEST.json.paper_story_state.${field} is required`);
        }
    }
    if (normalizeStage(state.claimSupportStatus) === "unsupported") {
        errors.push(`PROJECT_MANIFEST.json.paper_story_state.claim_support_status must not be unsupported before WRITE (current: ${state.claimSupportStatus})`);
    }
    return errors;
}
function isReviewPressurePacketReady(state) {
    return ["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "");
}
function getReviewPressurePacketValidationErrors(state) {
    const errors = [];
    if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
        errors.push(`PROJECT_MANIFEST.json.review_pressure_packet.status = ready|reconciled|approved (current: ${state.status})`);
    }
    for (const [field, value] of [
        ["reject_first_review_path", state.rejectFirstReviewPath],
        ["novelty_attack_path", state.noveltyAttackPath],
        ["unsupported_claim_audit_path", state.unsupportedClaimAuditPath],
        ["reverse_outline_path", state.reverseOutlinePath],
        ["figure_table_qc_path", state.figureTableQcPath],
        ["limitation_audit_path", state.limitationAuditPath],
    ]) {
        if (!value) {
            errors.push(`PROJECT_MANIFEST.json.review_pressure_packet.${field} is required`);
        }
    }
    return errors;
}
function getOrchestrationStateValidationErrors(state, currentStage) {
    const errors = [];
    if (!["running", "ready", "waiting", "blocked"].includes(normalizeStage(state.status) ?? "")) {
        errors.push(`PROJECT_MANIFEST.json.orchestration_state.status must be ready/running/waiting/blocked (current: ${state.status})`);
    }
    if (!state.currentOwner) {
        errors.push("PROJECT_MANIFEST.json.orchestration_state.current_owner is required");
    }
    if (!state.nextTransitionCandidate) {
        errors.push("PROJECT_MANIFEST.json.orchestration_state.next_transition_candidate is required");
    }
    if (currentStage && state.nextTransitionCandidate) {
        const expectedNext = STAGE_REQUIREMENTS[currentStage]?.nextStage ?? null;
        if (expectedNext &&
            normalizeStage(state.nextTransitionCandidate) !== normalizeStage(expectedNext)) {
            errors.push(`orchestration_state.next_transition_candidate should be ${expectedNext} while current_stage=${currentStage} (current: ${state.nextTransitionCandidate})`);
        }
    }
    if (state.retryBudgetRemaining != null && state.retryBudgetRemaining < 0) {
        errors.push("PROJECT_MANIFEST.json.orchestration_state.retry_budget_remaining must be >= 0");
    }
    return errors;
}
function getWritePackageValidationErrors(state) {
    const errors = [];
    if (!["ready", "assembled", "approved"].includes(normalizeStage(state.status) ?? "")) {
        errors.push(`PROJECT_MANIFEST.json.write_package.status must be ready/assembled/approved (current: ${state.status})`);
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
    ]) {
        if (!field[1]) {
            errors.push(`PROJECT_MANIFEST.json.write_package.${field[0]} is required`);
        }
    }
    return errors;
}
function toProjectRelativeArtifactPath(projectRoot, targetPath) {
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
function getBrainstormCycleRootRelativeDir(trackId) {
    const normalizedTrackId = trackId?.trim().replace(/[\\/]/g, "_") ?? null;
    if (normalizedTrackId) {
        return `researcher/reasoning/${normalizedTrackId}`;
    }
    return DEFAULT_BRAINSTORM_CYCLE_DIR;
}
function getBrainstormCycleDefaultPaths(trackId) {
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
function isBrainstormCycleReady(state) {
    return isBrainstormCycleReadyFromKernel(state);
}
function getBrainstormCycleValidationErrors(state) {
    return getBrainstormCycleValidationErrorsFromKernel(state);
}
async function fileHasMeaningfulJsonContent(targetPath) {
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
            return Object.keys(parsed).length > 0;
        }
        if (typeof parsed === "string") {
            return parsed.trim().length > 0;
        }
        return true;
    }
    catch {
        return false;
    }
}
function renderMarkdownishPayload(value) {
    return renderMarkdownishPayloadImpl(value);
}
function renderReasoningTracePayload(value) {
    return renderReasoningTracePayloadImpl(value);
}
function hasMeaningfulPayload(value) {
    return hasMeaningfulPayloadImpl(value);
}
function pickBrainstormPayload(record, keys) {
    return pickBrainstormPayloadImpl(record, keys);
}
function extractBrainstormCandidateRecords(value) {
    return extractBrainstormCandidateRecordsImpl(value);
}
function selectBrainstormCandidate(params) {
    return selectBrainstormCandidateImpl(params);
}
async function getBrainstormCycleMissingSignals(params) {
    const state = normalizeBrainstormCycleState(params.manifest?.brainstorm_cycle);
    const missing = [];
    if (!isBrainstormCycleReady(state)) {
        missing.push(`PROJECT_MANIFEST.json.brainstorm_cycle.status = ready|reconciled (current: ${state.status})`);
    }
    missing.push(...getBrainstormCycleValidationErrors(state));
    const jsonArtifacts = [
        ["topic_summary_path", state.topicSummaryPath],
        ["research_brief_path", state.researchBriefPath],
        ["brainstorm_brief_path", state.brainstormBriefPath],
        ["working_memory_path", state.workingMemoryPath],
    ];
    for (const [field, artifactPath] of jsonArtifacts) {
        const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
        if (!(await fileHasMeaningfulJsonContent(resolved))) {
            missing.push(`PROJECT_MANIFEST.json.brainstorm_cycle.${field} must point to a non-empty JSON artifact (${artifactPath ?? "unset"})`);
        }
    }
    const textArtifacts = [
        ["logic_chain_path", state.logicChainPath],
        ["evidence_chain_path", state.evidenceChainPath],
        ["reasoning_trace_path", state.reasoningTracePath],
        ["question_packet_path", state.questionPacketPath],
        ["synthesis_packet_path", state.synthesisPacketPath],
    ];
    for (const [field, artifactPath] of textArtifacts) {
        const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
        if (!(await fileHasNonWhitespaceContent(resolved))) {
            missing.push(`PROJECT_MANIFEST.json.brainstorm_cycle.${field} must point to a non-empty artifact (${artifactPath ?? "unset"})`);
        }
    }
    return uniqueStrings(missing);
}
function uniqueStringList(values) {
    return [...new Set(values.filter((value) => Boolean(asString(value))))];
}
async function selectExistingArtifactPath(params) {
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
async function selectExistingNonEmptyDirectory(params) {
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
function inferWritePackageWinningTrackIds(params) {
    if (params.current.winningTrackIds.length > 0) {
        return [...params.current.winningTrackIds];
    }
    const programTracks = params.researchProgram.tracks
        .filter((track) => normalizeStage(track.status) === "active")
        .map((track) => track.trackId);
    if (programTracks.length > 0) {
        return uniqueStringList(programTracks);
    }
    return uniqueStringList(getActiveTracks(params.trackRegistry).map((track) => pickString(track, ["track_id", "trackId"])));
}
function buildSectionAssemblyQueuePayload(params) {
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
function buildWritePackageAssemblyIssues(params) {
    const nextById = new Map();
    for (const issue of params.existingIssues) {
        nextById.set(issue.issueId, issue);
    }
    const activeIds = new Set();
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
    return [...nextById.values()].sort((left, right) => (left.issueId ?? "").localeCompare(right.issueId ?? ""));
}
async function syncWritePackageAssemblyIssues(params) {
    const currentTracker = await hydrateReviewIssueTrackerState({
        projectRoot: params.projectRoot,
        value: params.manifest.review_issue_tracker,
    });
    const issues = buildWritePackageAssemblyIssues({
        blockingInputs: params.blockingInputs,
        existingIssues: currentTracker.issues,
        now: params.now,
    });
    const unresolvedCount = issues.filter((issue) => !isResolvedReviewIssueStatus(issue.status)).length;
    const result = await setReviewIssueTrackerState({
        projectRoot: params.projectRoot,
        reviewIssueTracker: {
            status: unresolvedCount > 0 ? "open" : "ready",
            issue_manifest_path: currentTracker.issueManifestPath ?? DEFAULT_REVIEW_ISSUES_PATH,
            issues: issues.map((issue) => serializeReviewIssueState(issue)),
            last_review_round: currentTracker.lastReviewRound,
            pending_reason: unresolvedCount > 0
                ? "write_package assembly still has unresolved upstream evidence gaps."
                : null,
            last_updated_at: params.now,
        },
    });
    return result.state;
}
export async function assembleWritePackage(params) {
    const projectRoot = path.resolve(params.projectRoot);
    const manifest = await readManifestEnsured(projectRoot);
    const trackRegistry = await readJsonIfExists(path.join(projectRoot, "TRACK_REGISTRY.json"));
    const current = normalizeWritePackageState(manifest.write_package);
    const researchProgram = normalizeResearchProgramState(manifest.research_program);
    const experimentSearch = normalizeExperimentSearchState(manifest.experiment_search);
    const figureQc = normalizeFigureQcState(manifest.figure_qc);
    const graphGuidedWriting = normalizeGraphGuidedWritingState(manifest.graph_guided_writing);
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
            pickString(manifest.theory_state, [
                "proof_packet_dir",
                "proofPacketDir",
            ]),
            "analyzer/proof-packets",
        ],
    });
    const derivedArtifacts = [];
    const blockingInputs = [];
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
    const packageManifestPath = current.packageManifestPath ?? DEFAULT_WRITE_PACKAGE_MANIFEST_PATH;
    const assemblyReportPath = current.assemblyReportPath ?? DEFAULT_WRITE_PACKAGE_ASSEMBLY_REPORT_PATH;
    const sectionAssemblyQueuePath = current.sectionAssemblyQueuePath ?? DEFAULT_SECTION_ASSEMBLY_QUEUE_PATH;
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
    ]) {
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
    let sectionQueueArtifactPath = null;
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
    }
    else {
        blockingInputs.push({
            code: "section_assembly_queue",
            label: "section assembly queue",
            description: "write_package assembly could not derive any active section packet or ordered section queue.",
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
            ...Object.values(normalizeWritingSessionState(manifest.writing_session).sectionPackets).flatMap((packet) => packet.requiredFigureIds),
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
                const plotPackResolved = resolveProjectArtifactPath(projectRoot, experimentSearch.plotPackPath);
                const plotPack = plotPackResolved && (await pathExists(plotPackResolved))
                    ? await readJsonIfExists(plotPackResolved)
                    : null;
                await writeJsonEnsured(resolved, {
                    schema_version: 1,
                    generated_at: now,
                    winning_track_ids: winningTrackIds,
                    figure_ids: requiredFigureIds,
                    source_artifacts: figureSourceArtifacts,
                    plot_pack: plotPack,
                    surface_review_path: figureQc.figureReviewPath ?? DEFAULT_FIGURE_REVIEW_PATH,
                    selection_path: figureQc.figureSelectionPath ?? DEFAULT_FIGURE_SELECTION_PATH,
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
            description: "write_package assembly could not derive a figure pack from plot outputs, allowed figures, or figure review inputs.",
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
            description: "write_package assembly could not derive a table pack because no usable summary artifacts were found.",
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
                pickString(manifest.citation_integrity, [
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
            const resolved = resolveProjectArtifactPath(projectRoot, DEFAULT_CITATION_CANDIDATES_PATH);
            if (resolved) {
                const bibliographyResolved = resolveProjectArtifactPath(projectRoot, bibliographyPath);
                const bibliographyText = bibliographyResolved && (await pathExists(bibliographyResolved))
                    ? await readTextIfExists(bibliographyResolved)
                    : null;
                const bibliographyEntryCount = bibliographyText?.match(/@\w+\s*\{/g)?.length ?? 0;
                await writeJsonEnsured(resolved, {
                    schema_version: 1,
                    generated_at: now,
                    winning_track_ids: winningTrackIds,
                    bibliography_path: bibliographyPath,
                    bibliography_entry_count: bibliographyEntryCount,
                    source_artifacts: citationSourceArtifacts,
                });
                citationCandidatesPath = toProjectRelativeArtifactPath(projectRoot, resolved);
                derivedArtifacts.push(citationCandidatesPath ?? DEFAULT_CITATION_CANDIDATES_PATH);
            }
        }
    }
    if (!citationCandidatesPath) {
        blockingInputs.push({
            code: "citation_candidates",
            label: "citation candidates",
            description: "write_package assembly could not derive citation candidates from bibliography or graph/evidence artifacts.",
            targetArtifact: DEFAULT_CITATION_CANDIDATES_PATH,
        });
    }
    const next = {
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
        pendingReason: blockingInputs.length === 0
            ? null
            : `write_package assembly is still missing ${blockingInputs
                .map((item) => item.label)
                .join(", ")}`,
        lastUpdatedAt: now,
    };
    const packageManifestResolvedPath = resolveProjectArtifactPath(projectRoot, packageManifestPath);
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
    const assemblyReportResolvedPath = resolveProjectArtifactPath(projectRoot, assemblyReportPath);
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
        sectionAssemblyQueueResolvedPath: resolveProjectArtifactPath(projectRoot, next.sectionAssemblyQueuePath),
    };
}
function getWritingSectionContractViolations(params) {
    const violations = [];
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
        if (params.writingSession.finalizedSections.includes(normalized) &&
            !finalLikeStatuses.has(packet.status)) {
            violations.push(`finalized section ${section} must have packet status finalized/frozen (current: ${packet.status})`);
        }
        if (params.writingSession.compileSafeSections.includes(normalized) &&
            !params.writingSession.finalizedSections.includes(normalized)) {
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
function isReflectableExperiment(entry) {
    return Boolean(isTerminalExperimentStatus(entry.status) ||
        entry.completedAt ||
        entry.decision ||
        entry.keyMetric ||
        entry.failureSignature ||
        entry.resultPaths.length > 0 ||
        entry.evidencePointers.length > 0);
}
function getInnovationReflectionBasis(ledger) {
    if (!ledger) {
        return {
            latestExperimentUpdateAt: null,
            experimentIds: [],
        };
    }
    const reflectable = ledger.experiments
        .filter(isReflectableExperiment)
        .sort((left, right) => getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left)));
    return {
        latestExperimentUpdateAt: reflectable.length > 0 ? getExperimentSortTimestamp(reflectable[0]) : null,
        experimentIds: reflectable.map((entry) => entry.experimentId),
    };
}
function isInnovationReflectionDue(params) {
    return isInnovationReflectionDueFromKernel({
        state: params.state,
        ledger: params.ledger,
    });
}
function buildExperimentMemoryDigest(ledger, limit = 5) {
    return buildExperimentMemoryDigestImpl(ledger, limit);
}
async function loadProjectState(options) {
    return (await loadProjectStateFromModule(options));
}
function getTracks(trackRegistry) {
    const tracks = trackRegistry?.tracks;
    return Array.isArray(tracks)
        ? tracks.filter((item) => Boolean(asRecord(item)))
        : [];
}
function getActiveTracks(trackRegistry) {
    return getTracks(trackRegistry).filter((track) => normalizeStage(track.status) === "active");
}
async function hasExperimentBundle(projectRoot) {
    const coderRoot = path.join(projectRoot, "coder");
    try {
        const queue = [{ dir: coderRoot, depth: 0 }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                continue;
            }
            const entries = await fs.readdir(current.dir, { withFileTypes: true });
            const trainPy = path.join(current.dir, "train.py");
            const readme = path.join(current.dir, "README.md");
            const manifest = path.join(current.dir, "EXPERIMENT_MANIFEST.json");
            if ((await pathExists(trainPy)) &&
                (await pathExists(readme)) &&
                (await pathExists(manifest))) {
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
    }
    catch {
        return false;
    }
    return false;
}
async function findExperimentBundleManifest(params) {
    if (!params.experimentId) {
        return null;
    }
    const bundles = await listExperimentBundles(params.projectRoot);
    for (const bundle of bundles) {
        const record = bundle.manifest;
        if (!record) {
            continue;
        }
        const manifestExperimentId = pickString(record, ["experiment_id", "experimentId"]);
        const manifestTrackId = pickString(record, ["track_id", "trackId"]);
        if (manifestExperimentId === params.experimentId &&
            (!params.trackId || manifestTrackId === params.trackId)) {
            return record;
        }
    }
    return null;
}
function buildExperimentMetadataFromBundleManifest(record) {
    if (!record) {
        return null;
    }
    const datasetPath = pickString(record, ["dataset_path", "datasetPath"]);
    const baselineReference = pickString(record, [
        "baseline_reference",
        "baselineReference",
    ]);
    const normalizedDatasetPath = datasetPath?.replace(/[\\/]+$/, "") ?? null;
    const datasetName = normalizedDatasetPath != null ? path.basename(normalizedDatasetPath) : null;
    const innovationPoints = listStructuredAlignmentStrings(record.innovation_points ?? record.innovationPoints);
    const metadata = {};
    if (normalizedDatasetPath) {
        metadata.datasets = [normalizedDatasetPath];
    }
    if (datasetName) {
        metadata.dataset_names = [datasetName];
        metadata.validation_datasets = [datasetName];
    }
    if (baselineReference) {
        metadata.baseline_reference = baselineReference;
    }
    if (innovationPoints.length > 0) {
        metadata.innovation_points = innovationPoints;
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
}
async function listExperimentBundles(projectRoot) {
    const coderRoot = path.join(projectRoot, "coder");
    const bundles = [];
    try {
        const queue = [{ dir: coderRoot, depth: 0 }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                continue;
            }
            const entries = await fs.readdir(current.dir, { withFileTypes: true });
            const trainPy = path.join(current.dir, "train.py");
            const readme = path.join(current.dir, "README.md");
            const manifestPath = path.join(current.dir, "EXPERIMENT_MANIFEST.json");
            if ((await pathExists(trainPy)) &&
                (await pathExists(readme)) &&
                (await pathExists(manifestPath))) {
                bundles.push({
                    dir: current.dir,
                    manifestPath,
                    manifest: await readJsonIfExists(manifestPath),
                });
                continue;
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
    }
    catch {
        return [];
    }
    return bundles;
}
function normalizeAlignmentText(value) {
    if (!value) {
        return null;
    }
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    return normalized.length > 0 ? normalized : null;
}
function listStructuredAlignmentStrings(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (typeof entry === "string" && entry.trim()) {
            return [entry.trim()];
        }
        const record = asRecord(entry);
        if (!record) {
            return [];
        }
        const primary = pickString(record, [
            "id",
            "step_id",
            "ablation_id",
            "title",
            "label",
            "objective",
            "summary",
        ]) ?? null;
        const coversSource = record.covers ??
            record.cover ??
            record.innovation_point ??
            record.innovationPoint ??
            record.innovation_point_id ??
            record.innovationPointId ??
            record.targets;
        const covers = Array.isArray(coversSource)
            ? coversSource.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
            : typeof coversSource === "string" && coversSource.trim()
                ? [coversSource.trim()]
                : [];
        return [primary, ...covers].filter((item) => Boolean(item));
    });
}
async function getCodeStageBundleMissingSignals(params) {
    const missing = [];
    const bundles = await listExperimentBundles(params.projectRoot);
    if (bundles.length === 0) {
        missing.push("{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/train.py + README.md + EXPERIMENT_MANIFEST.json");
        return missing;
    }
    const researchProgram = normalizeResearchProgramState(params.manifest?.research_program);
    const activeTracks = researchProgram.tracks.filter((track) => normalizeStage(track.status) === "active");
    const activeTracksById = new Map(activeTracks.map((track) => [track.trackId, track]));
    let hasAlignedBundle = activeTracks.length === 0;
    for (const bundle of bundles) {
        const relativeDir = path.relative(params.projectRoot, bundle.dir) || bundle.dir;
        const record = bundle.manifest;
        if (!record) {
            missing.push(`${relativeDir} has an unreadable EXPERIMENT_MANIFEST.json`);
            continue;
        }
        const trackId = pickString(record, ["track_id", "trackId"]);
        if (!trackId) {
            missing.push(`${relativeDir} missing track_id in EXPERIMENT_MANIFEST.json`);
            continue;
        }
        const parentTrackId = path.basename(path.dirname(bundle.dir));
        if (parentTrackId !== trackId) {
            missing.push(`${relativeDir} must live under coder/experiments/${trackId}/ so bundle path and EXPERIMENT_MANIFEST.json track_id stay aligned`);
        }
        const question = pickString(record, ["question", "experiment_question", "objective"]) ?? null;
        if (!question) {
            missing.push(`${relativeDir} missing question in EXPERIMENT_MANIFEST.json`);
        }
        const baselineReference = pickString(record, ["baseline_reference", "baselineReference", "baseline"]) ?? null;
        if (!baselineReference) {
            missing.push(`${relativeDir} missing baseline_reference in EXPERIMENT_MANIFEST.json`);
        }
        const primaryBaselineMetric = pickString(record, [
            "primary_baseline_metric",
            "primaryBaselineMetric",
            "main_metric",
        ]) ?? null;
        if (!primaryBaselineMetric) {
            missing.push(`${relativeDir} missing primary_baseline_metric in EXPERIMENT_MANIFEST.json`);
        }
        const targetImprovement = pickString(record, [
            "target_improvement",
            "targetImprovement",
            "success_threshold",
        ]) ?? null;
        if (!targetImprovement) {
            missing.push(`${relativeDir} missing target_improvement in EXPERIMENT_MANIFEST.json`);
        }
        const baselineTrainingProtocol = pickString(record, [
            "baseline_training_protocol",
            "baselineTrainingProtocol",
            "baseline_training_setup",
            "baselineTrainingSetup",
        ]) ?? null;
        if (!baselineTrainingProtocol) {
            missing.push(`${relativeDir} missing baseline_training_protocol in EXPERIMENT_MANIFEST.json`);
        }
        const baselineEvalProtocol = pickString(record, [
            "baseline_eval_protocol",
            "baselineEvalProtocol",
            "eval_protocol",
            "evalProtocol",
        ]) ?? null;
        if (!baselineEvalProtocol) {
            missing.push(`${relativeDir} missing baseline_eval_protocol in EXPERIMENT_MANIFEST.json`);
        }
        const innovationPoints = listStructuredAlignmentStrings(record.innovation_points ?? record.innovationPoints);
        if (innovationPoints.length === 0) {
            missing.push(`${relativeDir} missing innovation_points in EXPERIMENT_MANIFEST.json`);
        }
        const validationSteps = listStructuredAlignmentStrings(record.validation_steps ?? record.validationSteps);
        if (validationSteps.length === 0) {
            missing.push(`${relativeDir} missing validation_steps in EXPERIMENT_MANIFEST.json`);
        }
        const ablationPlan = listStructuredAlignmentStrings(record.ablation_plan ?? record.ablationPlan);
        if (ablationPlan.length === 0) {
            missing.push(`${relativeDir} missing ablation_plan in EXPERIMENT_MANIFEST.json`);
        }
        const validationCoverageText = normalizeAlignmentText([...validationSteps, ...ablationPlan].join(" "));
        for (const innovationPoint of innovationPoints) {
            const normalizedPoint = normalizeAlignmentText(innovationPoint);
            if (!normalizedPoint) {
                continue;
            }
            if (!validationCoverageText?.includes(normalizedPoint)) {
                missing.push(`${relativeDir} must cover innovation point "${innovationPoint}" inside validation_steps or ablation_plan`);
            }
        }
        const activeTrack = activeTracksById.get(trackId);
        if (!activeTrack) {
            if (activeTracks.length > 0) {
                missing.push(`${relativeDir} targets inactive or unknown track ${trackId}; code-stage bundles must map to an active innovation track`);
            }
            continue;
        }
        const bundleHypothesis = pickString(record, [
            "hypothesis",
            "track_hypothesis",
            "trackHypothesis",
        ]) ?? null;
        const bundleNoveltyBasis = pickString(record, ["novelty_basis", "noveltyBasis"]) ?? null;
        const expectedHypothesis = normalizeAlignmentText(activeTrack.hypothesis);
        const expectedNoveltyBasis = normalizeAlignmentText(activeTrack.noveltyBasis);
        if (!bundleHypothesis) {
            missing.push(`${relativeDir} missing hypothesis in EXPERIMENT_MANIFEST.json`);
            continue;
        }
        if (!bundleNoveltyBasis) {
            missing.push(`${relativeDir} missing novelty_basis in EXPERIMENT_MANIFEST.json`);
            continue;
        }
        if (expectedHypothesis &&
            normalizeAlignmentText(bundleHypothesis) !== expectedHypothesis) {
            missing.push(`${relativeDir} must align its hypothesis to active track ${trackId}`);
            continue;
        }
        if (expectedNoveltyBasis &&
            normalizeAlignmentText(bundleNoveltyBasis) !== expectedNoveltyBasis) {
            missing.push(`${relativeDir} must align its novelty_basis to active track ${trackId}`);
            continue;
        }
        hasAlignedBundle = true;
    }
    if (!hasAlignedBundle && activeTracks.length > 0) {
        missing.push("At least one coder experiment bundle must align to an active innovation track contract (track_id + question + hypothesis + novelty_basis).");
    }
    return missing;
}
async function hasPrefixedFile(dir, prefix) {
    try {
        const entries = await fs.readdir(dir);
        return entries.some((entry) => entry.startsWith(prefix));
    }
    catch {
        return false;
    }
}
async function findAnyPdfInDir(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const candidates = entries
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
            .map((entry) => path.join(dir, entry.name))
            .sort((left, right) => left.localeCompare(right));
        return candidates[0] ?? null;
    }
    catch {
        return null;
    }
}
function manifestFieldExists(manifest, pathSpec) {
    let current = manifest;
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
async function fileHasNonWhitespaceContent(targetPath) {
    if (!targetPath) {
        return false;
    }
    const raw = await readTextIfExists(targetPath);
    return Boolean(raw && raw.trim().length > 0);
}
function trackHasGraphBackedInnovationEvidence(track) {
    return trackHasGraphBackedInnovationEvidenceFromHelper(track);
}
function normalizeWritingScopeLabel(value) {
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
function collectSelectedWritingScope(manifest) {
    const writingContract = normalizeWritingContractState(manifest?.writing_contract);
    const writingSession = normalizeWritingSessionState(manifest?.writing_session);
    return uniqueStrings([
        ...writingContract.requiredSections,
        ...writingContract.sectionOrder,
        ...writingSession.draftOrder,
        ...writingSession.finalizedSections,
        ...writingSession.compileSafeSections,
        ...(writingSession.currentSection ? [writingSession.currentSection] : []),
    ]
        .map((entry) => normalizeWritingScopeLabel(entry))
        .filter((entry) => Boolean(entry)));
}
function getStructuredUnsupportedScopeHits(manifest, selectedScope) {
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
        .map((packet) => `${packet.section}: ${packet.forbiddenUnsupportedClaims.join(", ")}`);
}
function findUnsupportedPrimaryClaimLines(rawText, selectedScope) {
    const matches = [];
    let currentHeading = null;
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
            const inScope = selectedScope.some((scope) => (normalizedLine && normalizedLine.includes(scope)) ||
                (normalizedHeading && normalizedHeading.includes(scope)));
            if (!inScope) {
                continue;
            }
        }
        matches.push(line);
    }
    return matches;
}
function summarizeClaimSupport(params) {
    const supportedIds = new Set();
    const partialIds = new Set();
    const unsupportedIds = new Set();
    let supportedFallbackCount = 0;
    let partialFallbackCount = 0;
    let unsupportedFallbackCount = 0;
    for (const rawLine of (params.claimEvidenceMatrixRaw ?? "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^#/.test(line) || /^\|?\s*-{3,}/.test(line)) {
            continue;
        }
        const claimId = extractClaimIdentifiers(line)[0] ?? null;
        if (/\bUNSUPPORTED\b/i.test(line)) {
            if (claimId) {
                unsupportedIds.add(claimId);
            }
            else {
                unsupportedFallbackCount += 1;
            }
            continue;
        }
        if (/\bPARTIAL\b/i.test(line)) {
            if (claimId) {
                partialIds.add(claimId);
            }
            else {
                partialFallbackCount += 1;
            }
            continue;
        }
        if (/\bSUPPORTED\b/i.test(line)) {
            if (claimId) {
                supportedIds.add(claimId);
            }
            else {
                supportedFallbackCount += 1;
            }
        }
    }
    const unsupportedIdsFromAudit = uniqueStrings(extractClaimIdentifiers(params.unsupportedClaimsRaw ?? ""));
    if (unsupportedIdsFromAudit.length > 0) {
        for (const claimId of unsupportedIdsFromAudit) {
            unsupportedIds.add(claimId.toLowerCase());
        }
    }
    else {
        const unsupportedLines = (params.unsupportedClaimsRaw ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 &&
            !/^#/.test(line) &&
            !/^[-*]\s*-{2,}/.test(line) &&
            (/^[-*]\s+/.test(line) || /^\|/.test(line) || /\bunsupported\b/i.test(line)));
        unsupportedFallbackCount = Math.max(unsupportedFallbackCount, unsupportedLines.length);
    }
    const supportedCount = supportedIds.size + supportedFallbackCount;
    const partialCount = partialIds.size + partialFallbackCount;
    const unsupportedCount = unsupportedIds.size + unsupportedFallbackCount;
    const status = unsupportedCount > 0
        ? "unsupported"
        : partialCount > 0
            ? "partial"
            : supportedCount > 0
                ? "supported"
                : "missing";
    return {
        status,
        supportedCount,
        partialCount,
        unsupportedCount,
    };
}
function collectTrackVerdictSignals(rawText) {
    const signals = [];
    for (const rawLine of (rawText ?? "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^#/.test(line) || /^\|?\s*-{3,}/.test(line)) {
            continue;
        }
        if (/\b(?:advance|park|kill|foreground|background|merge|hold)\b/i.test(line) &&
            (/\btrack[-_a-z0-9.]+\b/i.test(line) || /^[|*-]/.test(line))) {
            signals.push(line);
        }
    }
    return uniqueStrings(signals);
}
function collectUnsupportedClaimSignals(rawText) {
    const signals = [];
    for (const rawLine of (rawText ?? "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^#/.test(line) || /^\|?\s*-{3,}/.test(line)) {
            continue;
        }
        if (/^[-*]\s+/.test(line) || /\bclaim[-_a-z0-9.]+\b/i.test(line)) {
            signals.push(line);
        }
    }
    return uniqueStrings(signals);
}
function extractClaimIdentifiers(rawText) {
    return uniqueStrings(Array.from(rawText.matchAll(/\b(?:claim[-_][a-z0-9.]+|claim\d+|c\d+)\b/gi)).map((match) => match[0].toLowerCase()));
}
async function findUnsupportedPrimaryClaimsInSelectedWritingScope(params) {
    const selectedScope = collectSelectedWritingScope(params.manifest);
    const scopeLabel = selectedScope.length > 0 ? selectedScope.join(", ") : "all planned sections";
    const structuredHits = getStructuredUnsupportedScopeHits(params.manifest, selectedScope);
    if (structuredHits.length > 0) {
        return {
            blocked: true,
            reason: `unsupported primary claims remain in the selected writing scope (${scopeLabel}): ${structuredHits
                .slice(0, 3)
                .join("; ")}${structuredHits.length > 3 ? "; ..." : ""}`,
        };
    }
    const unsupportedClaimsPath = path.join(params.projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md");
    const unsupportedClaimsRaw = await readTextIfExists(unsupportedClaimsPath);
    if (!unsupportedClaimsRaw) {
        return { blocked: false, reason: null };
    }
    const textHits = findUnsupportedPrimaryClaimLines(unsupportedClaimsRaw, selectedScope);
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
async function collectSurveyReviewStageMissingSignals(params) {
    return collectSurveyReviewStageMissingSignalsFromModule({
        projectRoot: params.projectRoot,
        manifest: params.manifest,
        deps: {
            resolveProjectArtifactPath,
            fileHasMeaningfulJsonContent,
            fileHasNonWhitespaceContent,
        },
    });
}
async function getMissingStageSignals(params) {
    const { projectRoot, manifest, trackRegistry, experimentLedger, currentStage } = params;
    if (!currentStage) {
        return ["PROJECT_MANIFEST.json.current_stage is missing"];
    }
    switch (currentStage) {
        case "setup":
            return collectSetupStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                isNonEmptyDirectory,
                fileHasMeaningfulJsonContent,
                manifestFieldExists,
                getExperimentLedgerPath,
                pickString,
                normalizeResearchProgramState,
                getResearchProgramOnboardingGaps,
                asRecord,
                normalizeGraphPresenceStatus,
                normalizePaperIngestionState,
                hasActiveWorkflowOwnedPaperUpload,
                derivePaperIngestionWorkflowDecision,
                summarizeGraphPresenceMissing,
                getBrainstormCycleMissingSignals,
                normalizeStage,
            });
        case "survey_review":
            return collectSurveyReviewStageMissingSignals({
                projectRoot,
                manifest,
            });
        case "graph_build":
            return collectGraphBuildStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                isNonEmptyDirectory,
                fileHasMeaningfulJsonContent,
                manifestFieldExists,
                getExperimentLedgerPath,
                pickString,
                normalizeResearchProgramState,
                getResearchProgramOnboardingGaps,
                asRecord,
                normalizeGraphPresenceStatus,
                normalizePaperIngestionState,
                hasActiveWorkflowOwnedPaperUpload,
                derivePaperIngestionWorkflowDecision,
                summarizeGraphPresenceMissing,
                getBrainstormCycleMissingSignals,
                normalizeStage,
            });
        case "frontier_mapping":
            return collectFrontierMappingStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                isNonEmptyDirectory,
                fileHasMeaningfulJsonContent,
                manifestFieldExists,
                getExperimentLedgerPath,
                pickString,
                normalizeResearchProgramState,
                getResearchProgramOnboardingGaps,
                asRecord,
                normalizeGraphPresenceStatus,
                normalizePaperIngestionState,
                hasActiveWorkflowOwnedPaperUpload,
                derivePaperIngestionWorkflowDecision,
                summarizeGraphPresenceMissing,
                getBrainstormCycleMissingSignals,
                normalizeStage,
            });
        case "idea": {
            return collectIdeaStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                fileHasNonWhitespaceContent,
                fileHasMeaningfulJsonContent,
                isNonEmptyDirectory,
                resolveProjectArtifactPath,
                resolveTrackArtifactPath,
                normalizeIdeaCatalystState,
                getIdeaCatalystValidationErrors,
                normalizeIdeationContractState,
                getIdeationContractValidationErrors,
                normalizeInnovationReflectionState,
                isInnovationReflectionDue,
                getActiveTracks,
                asString,
                trackHasGraphBackedInnovationEvidence,
                getBrainstormCycleMissingSignals,
                normalizeResearchProgramState,
                getResearchProgramValidationErrors,
                getResearchProgramPlanValidationErrors,
                normalizeOrchestrationState,
                getOrchestrationStateValidationErrors,
                loadTrackInnovationEvidence: loadTrackInnovationEvidenceFromHelper,
                getCodeStageBundleMissingSignals,
            });
        }
        case "plan":
            return collectPlanStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                fileHasNonWhitespaceContent,
                fileHasMeaningfulJsonContent,
                isNonEmptyDirectory,
                resolveProjectArtifactPath,
                resolveTrackArtifactPath,
                normalizeIdeaCatalystState,
                getIdeaCatalystValidationErrors,
                normalizeIdeationContractState,
                getIdeationContractValidationErrors,
                normalizeInnovationReflectionState,
                isInnovationReflectionDue,
                getActiveTracks,
                asString,
                trackHasGraphBackedInnovationEvidence,
                getBrainstormCycleMissingSignals,
                normalizeResearchProgramState,
                getResearchProgramValidationErrors,
                getResearchProgramPlanValidationErrors,
                normalizeOrchestrationState,
                getOrchestrationStateValidationErrors,
                loadTrackInnovationEvidence: loadTrackInnovationEvidenceFromHelper,
                getCodeStageBundleMissingSignals,
            });
        case "code":
            return collectCodeStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                pathExists,
                fileHasNonWhitespaceContent,
                fileHasMeaningfulJsonContent,
                isNonEmptyDirectory,
                resolveProjectArtifactPath,
                resolveTrackArtifactPath,
                normalizeIdeaCatalystState,
                getIdeaCatalystValidationErrors,
                normalizeIdeationContractState,
                getIdeationContractValidationErrors,
                normalizeInnovationReflectionState,
                isInnovationReflectionDue,
                getActiveTracks,
                asString,
                trackHasGraphBackedInnovationEvidence,
                getBrainstormCycleMissingSignals,
                normalizeResearchProgramState,
                getResearchProgramValidationErrors,
                getResearchProgramPlanValidationErrors,
                normalizeOrchestrationState,
                getOrchestrationStateValidationErrors,
                loadTrackInnovationEvidence: loadTrackInnovationEvidenceFromHelper,
                getCodeStageBundleMissingSignals,
            });
        case "experiment":
            return collectExperimentStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                isNonEmptyDirectory,
                pathExists,
                manifestFieldExists,
                getExperimentLedgerPath,
                loadExperimentSearchState,
                loadExperimentReviewState,
                isExperimentSearchReadyForAnalysis,
                hasActiveExperimentRuns: (ledger) => hasActiveExperimentRuns(ledger),
                normalizeAutonomousExecutionState,
                normalizeBenchmarkProtocolState,
                normalizeStatisticalEvidenceState,
                normalizeAblationEvidenceState,
                normalizeMechanismEvidenceState,
                normalizeVenueCompetitionState,
                normalizeOpportunityScorecardState,
                readJsonIfExists,
                normalizeStage,
                normalizeFigureQcState,
                resolveProjectArtifactPath,
                findUnsupportedPrimaryClaimsInSelectedWritingScope,
                normalizeReviewPressurePacketState,
                getReviewPressurePacketValidationErrors,
                normalizeWritingContractState,
                normalizeResultsStorylineState,
                normalizeTitleAbstractIntroWorkbenchState,
                fileHasNonWhitespaceContent,
                DEFAULT_FIGURE_REVIEW_PATH,
                DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH,
            });
        case "analyze":
            return collectAnalyzeStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                isNonEmptyDirectory,
                pathExists,
                manifestFieldExists,
                getExperimentLedgerPath,
                loadExperimentSearchState,
                loadExperimentReviewState,
                isExperimentSearchReadyForAnalysis,
                hasActiveExperimentRuns: (ledger) => hasActiveExperimentRuns(ledger),
                normalizeAutonomousExecutionState,
                normalizeBenchmarkProtocolState,
                normalizeStatisticalEvidenceState,
                normalizeAblationEvidenceState,
                normalizeMechanismEvidenceState,
                normalizeVenueCompetitionState,
                normalizeOpportunityScorecardState,
                readJsonIfExists,
                normalizeStage,
                normalizeFigureQcState,
                resolveProjectArtifactPath,
                findUnsupportedPrimaryClaimsInSelectedWritingScope,
                normalizeReviewPressurePacketState,
                getReviewPressurePacketValidationErrors,
                normalizeWritingContractState,
                normalizeResultsStorylineState,
                normalizeTitleAbstractIntroWorkbenchState,
                fileHasNonWhitespaceContent,
                DEFAULT_FIGURE_REVIEW_PATH,
                DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH,
            });
        case "review": {
            return collectReviewStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                isNonEmptyDirectory,
                pathExists,
                manifestFieldExists,
                getExperimentLedgerPath,
                loadExperimentSearchState,
                loadExperimentReviewState,
                isExperimentSearchReadyForAnalysis,
                hasActiveExperimentRuns: (ledger) => hasActiveExperimentRuns(ledger),
                normalizeAutonomousExecutionState,
                normalizeBenchmarkProtocolState,
                normalizeStatisticalEvidenceState,
                normalizeAblationEvidenceState,
                normalizeMechanismEvidenceState,
                normalizeVenueCompetitionState,
                normalizeOpportunityScorecardState,
                readJsonIfExists,
                normalizeStage,
                normalizeFigureQcState,
                resolveProjectArtifactPath,
                findUnsupportedPrimaryClaimsInSelectedWritingScope,
                normalizeReviewPressurePacketState,
                getReviewPressurePacketValidationErrors,
                normalizeWritingContractState,
                normalizeResultsStorylineState,
                normalizeTitleAbstractIntroWorkbenchState,
                fileHasNonWhitespaceContent,
                DEFAULT_FIGURE_REVIEW_PATH,
                DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH,
            });
        }
        case "write":
            return collectWriteStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                resolveProjectArtifactPath,
                fileHasNonWhitespaceContent,
                pathExists,
                isNonEmptyDirectory,
                normalizePaperStoryState,
                getPaperStoryStateValidationErrors,
                normalizeReviewPressurePacketState,
                getReviewPressurePacketValidationErrors,
                normalizeWritingContractState,
                normalizeWritePackageState,
                evaluateWritingContractState,
                normalizeWritingSessionState,
                evaluateWritingProcessReadiness: evaluateWritingProcessReadinessFromModule,
                getWritingSectionContractViolations,
                isWritingSessionReadyForSubmit,
                getWritePackageValidationErrors,
                normalizeGraphGuidedWritingState,
                isGraphGuidedWritingReadyForSubmit,
                normalizeVenueCompetitionState,
                normalizeOpportunityScorecardState,
                normalizeReproducibilityPackState,
                normalizeCameraReadyEvidenceState,
                hydrateReviewIssueTrackerState,
                hasBlockingReviewIssues,
                hasUnwaivedMediumOrHigherReviewIssues,
                normalizePaperQcState,
                normalizeFigureQcState,
                normalizeCitationCollectionState,
                normalizeTheorySupportState,
                normalizeStage,
                normalizeCitationIntegrityState,
                normalizeInnovationSynthesisState,
                normalizeResultsStorylineState,
                normalizeStoryGapSearchRequisitionState,
                normalizeTitleAbstractIntroWorkbenchState,
                normalizeExternalReviewState,
                isExternalReviewConclusionReady,
                hasPrefixedFile,
                findAnyPdfInDir,
                DEFAULT_KG_STORYLINE_PACKET_PATH,
                DEFAULT_THEORY_APPENDIX_PLAN_PATH,
                DEFAULT_THEORY_APPENDIX_SECTION_PATH,
                DEFAULT_CITATION_BIB_PATH,
                DEFAULT_CITATION_REPORT_PATH,
            });
        case "submit":
            return collectSubmitStageMissingSignals({ projectRoot, manifest, trackRegistry, experimentLedger }, {
                resolveProjectArtifactPath,
                fileHasNonWhitespaceContent,
                pathExists,
                isNonEmptyDirectory,
                normalizePaperStoryState,
                getPaperStoryStateValidationErrors,
                normalizeReviewPressurePacketState,
                getReviewPressurePacketValidationErrors,
                normalizeWritingContractState,
                normalizeWritePackageState,
                evaluateWritingContractState,
                normalizeWritingSessionState,
                evaluateWritingProcessReadiness: evaluateWritingProcessReadinessFromModule,
                getWritingSectionContractViolations,
                isWritingSessionReadyForSubmit,
                getWritePackageValidationErrors,
                normalizeGraphGuidedWritingState,
                isGraphGuidedWritingReadyForSubmit,
                normalizeVenueCompetitionState,
                normalizeOpportunityScorecardState,
                normalizeReproducibilityPackState,
                normalizeCameraReadyEvidenceState,
                hydrateReviewIssueTrackerState,
                hasBlockingReviewIssues,
                hasUnwaivedMediumOrHigherReviewIssues,
                normalizePaperQcState,
                normalizeFigureQcState,
                normalizeCitationCollectionState,
                normalizeTheorySupportState,
                normalizeStage,
                normalizeCitationIntegrityState,
                normalizeInnovationSynthesisState,
                normalizeResultsStorylineState,
                normalizeStoryGapSearchRequisitionState,
                normalizeTitleAbstractIntroWorkbenchState,
                normalizeExternalReviewState,
                isExternalReviewConclusionReady,
                hasPrefixedFile,
                findAnyPdfInDir,
                DEFAULT_KG_STORYLINE_PACKET_PATH,
                DEFAULT_THEORY_APPENDIX_PLAN_PATH,
                DEFAULT_THEORY_APPENDIX_SECTION_PATH,
                DEFAULT_CITATION_BIB_PATH,
                DEFAULT_CITATION_REPORT_PATH,
            });
        default:
            return [];
    }
}
function inboxForRole(params) {
    return inboxForRoleImpl(params);
}
function buildDynamicTasks(params) {
    return buildDynamicTasksImpl(params, {
        rolePolicies: ROLE_POLICIES,
        asRecord,
        asString,
        normalizePaperIngestionState,
        normalizeIdeaCatalystState,
        normalizeGraphPresenceStatus,
        summarizeGraphPresenceMissing,
        buildGraphImportRepairGuidance,
        isIdleResearchDue: (state) => isIdleResearchDue(state),
        computeIdleResearchNextDueAt: (state) => computeIdleResearchNextDueAt(state),
        uniqueStrings,
        DEFAULT_KG_STORYLINE_PACKET_PATH,
        DEFAULT_CITATION_REPORT_PATH,
    });
}
export function getWorkflowGuardPolicy(config) {
    return normalizePolicy(config);
}
export async function buildWorkflowSnapshot(params) {
    const policy = normalizePolicy(params.policy);
    const projectState = await loadProjectState({
        policy,
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        messageChannel: params.messageChannel,
        channelKey: params.channelKey,
        role: params.agentId,
        invalidEnvProjectRootMode: "ignore",
    });
    return await buildWorkflowSnapshotFromProjectState({
        policy,
        agentId: params.agentId,
        projectState,
    }, {
        getMissingStageSignals: getMissingStageSignals,
    });
}
export function buildFocusedPromptAssembly(params) {
    return buildFocusedPromptAssemblyImpl(params, {
        buildNonOwnerRoutingAdvice: (snapshot) => buildNonOwnerRoutingAdvice(snapshot),
        getSharedWritingConstitutionLines,
    });
}
export function shouldUseFocusedWorkflowPrompt(snapshot) {
    return shouldUseFocusedWorkflowPromptImpl(snapshot);
}
function buildNonOwnerRoutingAdvice(snapshot) {
    return buildNonOwnerRoutingAdviceImpl(snapshot);
}
function getSharedWritingConstitutionLines(role) {
    return getSharedWritingConstitutionLinesImpl(role);
}
export function formatWorkflowSnapshotForPrompt(params) {
    return formatWorkflowSnapshotForPromptImpl(params, {
        buildNonOwnerRoutingAdvice: (snapshot) => buildNonOwnerRoutingAdvice(snapshot),
        getSharedWritingConstitutionLines,
    });
}
function isInside(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function canRoleContact(fromRole, toRole) {
    return canRoleContactFromModule(fromRole, toRole);
}
export function canRoleSpawn(fromRole, toRole) {
    return canRoleSpawnFromModule(fromRole, toRole);
}
export function canRoleContactInWorkflow(params) {
    return canRoleContactInWorkflowFromModule(params);
}
export function canRoleSpawnInWorkflow(params) {
    return canRoleSpawnInWorkflowFromModule(params);
}
export function inferTargetRoleFromToolParams(params) {
    return inferTargetRoleFromToolParamsFromModule(params);
}
export function shouldBlockProjectWrite(params) {
    return shouldBlockProjectWriteFromModule(params);
}
export function shouldBlockCoderDatasetMutation(params) {
    return shouldBlockCoderDatasetMutationFromModule(params);
}
export function shouldBlockResearchGraphForce(params) {
    return shouldBlockResearchGraphForceFromModule(params);
}
export function shouldBlockPapernexusInlineExecution(params) {
    return shouldBlockPapernexusInlineExecutionFromModule(params);
}
export function shouldBlockPapernexusRawHttpUsage(params) {
    return shouldBlockPapernexusRawHttpUsageFromModule(params);
}
export function shouldBlockPapernexusLiveGraphCliRead(params) {
    return shouldBlockPapernexusLiveGraphCliReadFromModule(params);
}
export function shouldBlockPapernexusLocalGraphProcessing(params) {
    return shouldBlockPapernexusLocalGraphProcessingFromModule(params);
}
export function shouldBlockPapernexusLocalStorageUsage(params) {
    return shouldBlockPapernexusLocalStorageUsageFromModule(params);
}
export function shouldBlockPapernexusMultiPaperImport(params) {
    return shouldBlockPapernexusMultiPaperImportFromModule(params);
}
export function shouldBlockPapernexusLongWaitImportCommand(params) {
    return shouldBlockPapernexusLongWaitImportCommandFromModule(params);
}
export function shouldBlockPapernexusDestructiveOperation(params) {
    return shouldBlockPapernexusDestructiveOperationFromModule(params);
}
export function shouldBlockInnovationWrite(params) {
    return shouldBlockInnovationWriteFromModule(params);
}
export function shouldBlockWriterTemplateWrite(params) {
    return shouldBlockWriterTemplateWriteFromModule(params);
}
export function sanitizeAgentMentions(text) {
    return sanitizeAgentMentionsFromModule(text);
}
export function hasAgentMention(text) {
    return hasAgentMentionFromModule(text);
}
export function isWorkflowChannelHandoffMessage(text) {
    return isWorkflowChannelHandoffMessageFromModule(text);
}
export function normalizeWorkflowChannelMentions(text) {
    return normalizeWorkflowChannelMentionsFromModule(text);
}
export function sanitizeMessageToolParams(params) {
    return sanitizeMessageToolParamsFromModule(params);
}
export async function queueWorkflowMailboxMessage(params) {
    return (await queueWorkflowMailboxMessageImpl({
        ...params,
        readJsonIfExists,
        writeJsonEnsured,
    }));
}
export async function getWorkflowContactCooldown(params) {
    return (await getWorkflowContactCooldownImpl({
        ...params,
        readJsonIfExists,
    }));
}
export async function recordWorkflowContactEvent(params) {
    await recordWorkflowContactEventImpl({
        ...params,
        readJsonIfExists,
        writeJsonEnsured,
    });
}
export async function acknowledgeWorkflowMailboxMessage(params) {
    return (await acknowledgeWorkflowMailboxMessageImpl({
        ...params,
        readJsonIfExists,
        writeJsonEnsured,
        normalizeRole: (value) => normalizeRole(asString(value)),
    }));
}
export async function readWorkflowMailboxForAgent(params) {
    return (await readWorkflowMailboxForAgentImpl({
        ...params,
        readJsonIfExists,
        normalizeRole: (value) => normalizeRole(asString(value)),
    }));
}
export async function getIdleResearchStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeIdleResearchState(manifest.idle_research);
    return {
        state,
        due: isIdleResearchDue(state),
        nextDueAt: computeIdleResearchNextDueAt(state),
    };
}
export async function getInnovationReflectionStateSummary(params) {
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
export async function getBrainstormCycleStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
    const validationErrors = getBrainstormCycleValidationErrors(state);
    const topicSummaryResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.topicSummaryPath);
    const researchBriefResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.researchBriefPath);
    const brainstormBriefResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.brainstormBriefPath);
    const logicChainResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.logicChainPath);
    const evidenceChainResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.evidenceChainPath);
    const reasoningTraceResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.reasoningTracePath);
    const questionPacketResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.questionPacketPath);
    const workingMemoryResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.workingMemoryPath);
    const synthesisPacketResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.synthesisPacketPath);
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
    const chainBundleReady = isBrainstormCycleReady(state) &&
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
export async function getIdeationContractStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return summarizeIdeationContractStateFromModule({
        projectRoot: params.projectRoot,
        manifest,
        getIdeationContractValidationErrors,
        fileHasMeaningfulJsonContent,
        fileHasNonWhitespaceContent,
    });
}
export async function getSurveyReviewStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return getSurveyReviewStateSummaryFromModule(manifest);
}
export async function getResearchProgramStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeResearchProgramState(manifest.research_program);
    const projectId = pickString(manifest, ["project_id", "projectId"]);
    return {
        state,
        validationErrors: getResearchProgramValidationErrors(state),
        onboardingStatus: getResearchProgramOnboardingStatus({ state, projectId }),
        onboardingGaps: getResearchProgramOnboardingGaps({ state, projectId }),
    };
}
export async function getPaperStoryStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return summarizePaperStoryStateFromModule({
        projectRoot: params.projectRoot,
        manifest,
        getPaperStoryStateValidationErrors,
        fileHasNonWhitespaceContent,
    });
}
export async function getOrchestrationStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeOrchestrationState(manifest.orchestration_state);
    return {
        state,
        validationErrors: getOrchestrationStateValidationErrors(state, normalizeStage(manifest.current_stage)),
    };
}
export async function getReviewPressurePacketStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return summarizeReviewPressurePacketStateFromModule({
        projectRoot: params.projectRoot,
        manifest,
        getReviewPressurePacketValidationErrors,
        fileHasNonWhitespaceContent,
    });
}
export async function getInnovationSynthesisStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeInnovationSynthesisState(manifest.innovation_synthesis_state);
    const synthesisMemoResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.synthesisMemoPath);
    const graphResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.storyDependencyGraphPath);
    const statementResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.integratedContributionStatementPath);
    return {
        state,
        synthesisMemoResolvedPath,
        synthesisMemoExists: synthesisMemoResolvedPath
            ? await pathExists(synthesisMemoResolvedPath)
            : false,
        graphResolvedPath,
        graphExists: graphResolvedPath ? await pathExists(graphResolvedPath) : false,
        statementResolvedPath,
        statementExists: statementResolvedPath
            ? await pathExists(statementResolvedPath)
            : false,
    };
}
export async function getStoryGapSearchRequisitionStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeStoryGapSearchRequisitionState(manifest.story_gap_search_requisition);
    const packetResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.packetPath);
    return {
        state,
        packetResolvedPath,
        packetExists: packetResolvedPath ? await pathExists(packetResolvedPath) : false,
    };
}
export async function getResultsStorylineStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeResultsStorylineState(manifest.results_storyline);
    const questionOrderResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.resultsQuestionOrderPath);
    const evidenceSequenceResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.experimentEvidenceSequencePath);
    return {
        state,
        questionOrderResolvedPath,
        questionOrderExists: questionOrderResolvedPath
            ? await pathExists(questionOrderResolvedPath)
            : false,
        evidenceSequenceResolvedPath,
        evidenceSequenceExists: evidenceSequenceResolvedPath
            ? await pathExists(evidenceSequenceResolvedPath)
            : false,
    };
}
export async function getTitleAbstractIntroWorkbenchStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeTitleAbstractIntroWorkbenchState(manifest.title_abstract_intro_workbench);
    const titleCandidatesResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.titleCandidatesPath);
    const abstractWorkbenchResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.abstractWorkbenchPath);
    const introWorkbenchResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.introWorkbenchPath);
    return {
        state,
        titleCandidatesResolvedPath,
        titleCandidatesExists: titleCandidatesResolvedPath
            ? await pathExists(titleCandidatesResolvedPath)
            : false,
        abstractWorkbenchResolvedPath,
        abstractWorkbenchExists: abstractWorkbenchResolvedPath
            ? await pathExists(abstractWorkbenchResolvedPath)
            : false,
        introWorkbenchResolvedPath,
        introWorkbenchExists: introWorkbenchResolvedPath
            ? await pathExists(introWorkbenchResolvedPath)
            : false,
    };
}
export async function getWritePackageStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeWritePackageState(manifest.write_package);
    return {
        state,
        validationErrors: getWritePackageValidationErrors(state),
    };
}
export async function getTheoryStateSummary(params) {
    return (await getTheoryStateSummaryFromModule(params));
}
export async function getWritingContractStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return summarizeWritingContractStateFromModule({
        projectRoot: params.projectRoot,
        manifest,
        policy: params.policy,
    });
}
export async function recordTheoryState(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const current = normalizeTheorySupportState(manifest.theory_state);
    const patch = asRecord(params.theoryState) ?? {};
    const next = {
        ...current,
        status: normalizeStage(patch.status) ?? current.status,
        overallSignal: pickString(patch, ["overallSignal", "overall_signal"]) ?? current.overallSignal,
        theoryStatePath: pickString(patch, ["theoryStatePath", "theory_state_path"]) ?? current.theoryStatePath,
        sourceTheoryNotePath: pickString(patch, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
            current.sourceTheoryNotePath,
        proofPacketDir: pickString(patch, ["proofPacketDir", "proof_packet_dir"]) ?? current.proofPacketDir,
        appendixPacketPath: pickString(patch, ["appendixPacketPath", "appendix_packet_path"]) ??
            current.appendixPacketPath,
        mainTextProofStyle: pickString(patch, ["mainTextProofStyle", "main_text_proof_style"]) ??
            current.mainTextProofStyle,
        bodyReady: pickBoolean(patch, ["bodyReady", "body_ready"]) ?? current.bodyReady,
        theoremCount: Math.max(0, Math.floor(pickNumber(patch, ["theoremCount", "theorem_count"]) ?? current.theoremCount)),
        lemmaCount: Math.max(0, Math.floor(pickNumber(patch, ["lemmaCount", "lemma_count"]) ?? current.lemmaCount)),
        proofPacketCount: Math.max(0, Math.floor(pickNumber(patch, ["proofPacketCount", "proof_packet_count"]) ?? current.proofPacketCount)),
        lastUpdatedAt: pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ?? new Date().toISOString(),
        pendingReason: pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    };
    const theoryStatePayload = asRecord(patch.theoryStateFile ?? patch.theory_state_file);
    const theoryStateResolvedPath = resolveProjectArtifactPath(params.projectRoot, next.theoryStatePath);
    if (theoryStatePayload && theoryStateResolvedPath) {
        const normalized = normalizeTheoryStateFile({
            ...theoryStatePayload,
            updated_at: next.lastUpdatedAt,
            overall_signal: pickString(theoryStatePayload, ["overallSignal", "overall_signal"]) ?? next.overallSignal,
            main_text_proof_style: pickString(theoryStatePayload, ["mainTextProofStyle", "main_text_proof_style"]) ??
                next.mainTextProofStyle,
            source_theory_note_path: pickString(theoryStatePayload, ["sourceTheoryNotePath", "source_theory_note_path"]) ??
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
export async function upsertTheoryProofPacket(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const current = normalizeTheorySupportState(manifest.theory_state);
    const packet = normalizeTheoryObjectPacket(params.proofPacket);
    if (!packet) {
        throw new Error("proofPacket.packet_id and proofPacket.statement are required.");
    }
    const proofPacketDir = resolveProjectArtifactPath(params.projectRoot, current.proofPacketDir);
    if (!proofPacketDir) {
        throw new Error("No proof packet directory is configured for this project.");
    }
    const packetResolvedPath = path.join(proofPacketDir, `${packet.packet_id}.json`);
    const now = new Date().toISOString();
    const normalizedPacket = {
        ...packet,
        updated_at: packet.updated_at ?? now,
    };
    await writeJsonEnsured(packetResolvedPath, serializeTheoryObjectPacket(normalizedPacket));
    const theoryStateResolvedPath = resolveProjectArtifactPath(params.projectRoot, current.theoryStatePath);
    let theoryFile = normalizeTheoryStateFile({
        status: "draft",
        overall_signal: current.overallSignal,
        source_theory_note_path: current.sourceTheoryNotePath,
        main_text_proof_style: current.mainTextProofStyle,
    });
    if (theoryStateResolvedPath && (await pathExists(theoryStateResolvedPath))) {
        theoryFile = normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath));
    }
    const collection = normalizedPacket.role === "theorem" ||
        normalizedPacket.role === "proposition" ||
        normalizedPacket.role === "corollary"
        ? theoryFile.theorem_candidates
        : theoryFile.lemma_packets;
    const existingIndex = collection.findIndex((item) => item.packet_id === normalizedPacket.packet_id);
    if (existingIndex >= 0) {
        collection[existingIndex] = normalizedPacket;
    }
    else {
        collection.push(normalizedPacket);
    }
    theoryFile.updated_at = now;
    theoryFile.status = theoryFile.status === "missing" ? "draft" : theoryFile.status;
    if (theoryStateResolvedPath) {
        await writeJsonEnsured(theoryStateResolvedPath, serializeTheoryStateFile(theoryFile));
    }
    const next = {
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
export async function materializeTheoryAppendix(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const current = normalizeTheorySupportState(manifest.theory_state);
    const writingContract = normalizeWritingContractState(manifest.writing_contract);
    const materializationPatch = asRecord(params.theoryMaterialization) ?? {};
    const now = new Date().toISOString();
    const theoryStateArtifactPath = pickString(materializationPatch, ["theoryStatePath", "theory_state_path"]) ??
        current.theoryStatePath ??
        DEFAULT_THEORY_STATE_PATH;
    const proofPacketDirArtifactPath = pickString(materializationPatch, ["proofPacketDir", "proof_packet_dir"]) ??
        current.proofPacketDir ??
        DEFAULT_PROOF_PACKET_DIR;
    const appendixPlanArtifactPath = pickString(materializationPatch, ["planPath", "plan_path"]) ??
        pickString(materializationPatch, ["appendixPacketPath", "appendix_packet_path"]) ??
        current.appendixPacketPath ??
        DEFAULT_THEORY_APPENDIX_PLAN_PATH;
    const appendixSectionArtifactPath = pickString(materializationPatch, ["appendixSectionPath", "appendix_section_path"]) ??
        pickString(materializationPatch, ["proofAppendixPath", "proof_appendix_path"]) ??
        writingContract.proofAppendixPath ??
        DEFAULT_THEORY_APPENDIX_SECTION_PATH;
    const theoryStateResolvedPath = resolveProjectArtifactPath(params.projectRoot, theoryStateArtifactPath);
    const proofPacketDirResolvedPath = resolveProjectArtifactPath(params.projectRoot, proofPacketDirArtifactPath);
    const appendixPlanResolvedPath = resolveProjectArtifactPath(params.projectRoot, appendixPlanArtifactPath);
    const appendixSectionResolvedPath = resolveProjectArtifactPath(params.projectRoot, appendixSectionArtifactPath);
    if (!theoryStateResolvedPath || !proofPacketDirResolvedPath) {
        throw new Error("Theory state paths are not configured for this project.");
    }
    if (!appendixPlanResolvedPath || !appendixSectionResolvedPath) {
        throw new Error("Theory appendix output paths are not configured for this project.");
    }
    let theoryFile = normalizeTheoryStateFile(await readJsonIfExists(theoryStateResolvedPath));
    const diskPackets = [];
    if (await pathExists(proofPacketDirResolvedPath)) {
        const entries = await fs.readdir(proofPacketDirResolvedPath);
        for (const entry of entries) {
            if (!entry.endsWith(".json")) {
                continue;
            }
            const packet = normalizeTheoryObjectPacket(await readJsonIfExists(path.join(proofPacketDirResolvedPath, entry)));
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
        throw new Error("No theorem or lemma proof packets are available. Run theorem/lemma synthesis before materializing appendix artifacts.");
    }
    const theoremCandidates = packets.filter((packet) => ["theorem", "proposition", "corollary"].includes(packet.role));
    const lemmaPackets = packets.filter((packet) => !["theorem", "proposition", "corollary"].includes(packet.role));
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
        main_text_proof_style: writingContract.mainTextProofStyle ??
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
    const nextTheoryState = {
        ...current,
        status: bodySafeCount > 0 ? "ready" : "draft",
        overallSignal: theoryFile.overall_signal ?? current.overallSignal,
        theoryStatePath: theoryStateArtifactPath,
        proofPacketDir: proofPacketDirArtifactPath,
        appendixPacketPath: appendixPlanArtifactPath,
        mainTextProofStyle: theoryFile.main_text_proof_style ?? current.mainTextProofStyle,
        bodyReady: bodySafeCount > 0,
        theoremCount: theoremCandidates.length,
        lemmaCount: lemmaPackets.length,
        proofPacketCount: packets.length,
        lastUpdatedAt: now,
        pendingReason: null,
    };
    const nextWritingContract = {
        ...writingContract,
        proofAppendixRequired: true,
        proofAppendixPath: appendixSectionArtifactPath,
        proofAppendixStatus: "ready",
        theoryNotePath: writingContract.theoryNotePath ??
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
export async function getCitationIntegrityStateSummary(params) {
    return (await getCitationIntegrityStateSummaryFromModule(params));
}
export async function getWritingSessionStateSummary(params) {
    const recovery = await restoreAuthoringArtifactsFromRecovery({
        projectRoot: params.projectRoot,
    }).catch(() => null);
    const manifest = await readManifestEnsured(params.projectRoot);
    if (writingSessionLooksRecoverableEmpty(manifest.writing_session) &&
        recovery?.store?.writingSession &&
        typeof recovery.store.writingSession === "object" &&
        !Array.isArray(recovery.store.writingSession)) {
        manifest.writing_session = recovery.store.writingSession;
        await saveManifest(params.projectRoot, manifest);
    }
    const state = normalizeWritingSessionState(manifest.writing_session);
    const writingContract = normalizeWritingContractState(manifest.writing_contract);
    const process = evaluateWritingProcessReadinessFromModule({
        writingSession: state,
        writingContract,
    });
    await syncAuthoringArtifactRecovery({
        projectRoot: params.projectRoot,
        writingSession: {
            ...serializeWritingSessionState(state),
            process_status: process.processStatus,
            drafted_sections: process.draftedSections,
            reviewed_sections: process.reviewedSections,
            manuscript_complete: ["manuscript_complete", "compile_ready", "ready_for_submit"].includes(process.processStatus),
            compile_ready: ["compile_ready", "ready_for_submit"].includes(process.processStatus),
            next_suggested_section: process.nextSuggestedSection,
            rebuild_needed: process.rebuildNeeded,
            rebuild_reason: process.rebuildReason,
            outline_ready: !["missing", "bootstrapping"].includes(process.processStatus),
        },
    }).catch(() => null);
    const sectionPacketDirResolvedPath = resolveProjectArtifactPath(params.projectRoot, DEFAULT_WRITING_SECTION_PACKET_DIR);
    const currentSectionPacket = state.currentSection
        ? state.sectionPackets[state.currentSection] ?? null
        : null;
    const currentSectionPacketResolvedPath = resolveProjectArtifactPath(params.projectRoot, currentSectionPacket?.packetPath ?? null);
    return {
        state,
        sectionPacketDirResolvedPath,
        currentSectionPacketResolvedPath,
        currentSectionPacketExists: currentSectionPacketResolvedPath
            ? await pathExists(currentSectionPacketResolvedPath)
            : false,
        readyForSubmit: isWritingSessionReadyForSubmit(state),
        processStatus: process.processStatus,
        missingSections: process.missingSections,
        staleSections: process.staleSections,
        nextSuggestedSection: process.nextSuggestedSection,
        rebuildNeeded: process.rebuildNeeded,
        rebuildReason: process.rebuildReason,
        progressSummary: process.summary,
    };
}
export async function getReviewSessionStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeReviewSessionState(manifest.review_session);
    const reviewPacketResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.reviewPacketPath);
    const graphEvidenceSummaryResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.graphEvidenceSummaryPath);
    const latestReviewResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.latestReviewPath);
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
export async function getGraphGuidedWritingStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeGraphGuidedWritingState(manifest.graph_guided_writing);
    const anchorIndexResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.anchorIndexPath);
    const literatureResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.literaturePath);
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
export async function getExternalReviewStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = normalizeExternalReviewState(manifest.external_review_state);
    const submittedPdfResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.submittedPdfPath);
    const discoveredPdfPath = submittedPdfResolvedPath && (await pathExists(submittedPdfResolvedPath))
        ? submittedPdfResolvedPath
        : await findAnyPdfInDir(path.join(params.projectRoot, "academic_writer", "paper"));
    const externalReviewResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.externalReviewPath);
    const reviewResponseResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.reviewResponsePath);
    return {
        state,
        submittedPdfResolvedPath: discoveredPdfPath,
        submittedPdfExists: Boolean(discoveredPdfPath),
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
export async function getExperimentSearchStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = await loadExperimentSearchState({
        projectRoot: params.projectRoot,
        manifest,
    });
    const stateFilePath = state.searchStatePath
        ? path.isAbsolute(state.searchStatePath)
            ? state.searchStatePath
            : path.join(params.projectRoot, state.searchStatePath)
        : getExperimentSearchPath(params.projectRoot);
    const evaluationSummaryResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.evaluationSummaryPath);
    const plotPackResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.plotPackPath);
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
export async function getExperimentGitReviewSummary(params) {
    const result = await getExperimentGitReviewSummaryImpl(params, {
        readManifestEnsured,
        saveManifest,
    });
    const reviewStatePath = getExperimentSearchReviewStatePath(params.projectRoot, result.reviewState.stateFilePath);
    return {
        reviewState: normalizeExperimentSearchReviewState(result.reviewState),
        reviewSummary: result.reviewSummary,
        reviewStatePath,
        reviewStateExists: await pathExists(reviewStatePath),
        searchState: result.searchState,
    };
}
export async function requestExperimentGitOp(params) {
    const result = await requestExperimentGitOpImpl(params, {
        readManifestEnsured,
        saveManifest,
    });
    return {
        reviewState: normalizeExperimentSearchReviewState(result.reviewState),
        reviewSummary: result.reviewSummary,
        searchState: result.searchState,
    };
}
export async function setExperimentGitReviewState(params) {
    const result = await setExperimentGitReviewStateImpl(params, {
        readManifestEnsured,
        saveManifest,
    });
    return {
        reviewState: normalizeExperimentSearchReviewState(result.reviewState),
        reviewSummary: result.reviewSummary,
        searchState: result.searchState,
    };
}
export async function applyExperimentGitOp(params) {
    const result = await applyExperimentGitOpImpl(params, {
        readManifestEnsured,
        saveManifest,
    });
    let ledgerEntry = null;
    const experimentId = result.reviewState.experimentId ??
        result.searchState.lastCandidateExperimentId ??
        result.searchState.incumbentExperimentId ??
        result.searchState.completedExperimentIds.at(-1) ??
        result.searchState.discardedExperimentIds.at(-1) ??
        result.gitResult.candidateBranch?.split("/").filter(Boolean).at(-1) ??
        null;
    if (experimentId &&
        (result.gitResult.actionType === "promote_candidate" ||
            result.gitResult.actionType === "discard_candidate")) {
        const searchFailureClass = result.gitResult.actionType === "discard_candidate"
            ? normalizeStage(result.reviewState.failureClass) ??
                (() => {
                    const reviewText = `${result.reviewState.pendingReason ?? ""} ${result.reviewState.discardReason ?? ""}`.toLowerCase();
                    if (/\boom\b|timeout|ssh|disk full|killed|connection/i.test(reviewText)) {
                        return "runtime";
                    }
                    if (/baseline fairness|implementation|protocol drift|shape mismatch|nan|traceback/i.test(reviewText)) {
                        return "implementation";
                    }
                    return "scientific";
                })()
            : null;
        const ledgerResult = await upsertExperimentLedgerEntry({
            projectRoot: params.projectRoot,
            agentId: params.agentId ?? undefined,
            experiment: {
                experimentId,
                trackId: result.reviewState.trackId ?? result.searchState.trackId ?? null,
                status: result.gitResult.actionType === "promote_candidate"
                    ? "merged"
                    : "completed",
                decision: result.gitResult.actionType === "promote_candidate"
                    ? "advance"
                    : "discard",
                summary: result.gitResult.summary,
                note: result.reviewState.promotionEvidenceSummary ??
                    result.reviewState.discardReason ??
                    result.reviewState.pendingReason,
                metadata: {
                    searchGit: {
                        actionType: result.gitResult.actionType,
                        searchSessionId: result.reviewState.searchSessionId ??
                            result.searchState.searchSessionId,
                        promotionBasisSignals: result.reviewState.promotionBasisSignals,
                        promotionEvidenceSummary: result.reviewState.promotionEvidenceSummary,
                        discardReason: result.reviewState.discardReason,
                        failureClass: searchFailureClass,
                        incumbentBranch: result.gitResult.incumbentBranch,
                        incumbentCommit: result.gitResult.incumbentCommit,
                        candidateBranch: result.gitResult.candidateBranch,
                        candidateCommit: result.gitResult.candidateHeadCommit,
                        candidateBaseCommit: result.gitResult.candidateBaseCommit,
                        retained: result.gitResult.actionType === "promote_candidate",
                        worktreePath: result.gitResult.candidateWorktreePath,
                    },
                },
            },
        });
        ledgerEntry = ledgerResult.entry;
    }
    const refreshedSearch = await getExperimentSearchStateSummary({
        projectRoot: params.projectRoot,
    });
    return {
        gitResult: result.gitResult,
        reviewState: normalizeExperimentSearchReviewState(result.reviewState),
        searchState: refreshedSearch.state,
        ledgerEntry,
    };
}
export async function getExperimentReviewStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const state = (await loadExperimentReviewState({
        projectRoot: params.projectRoot,
        manifest,
    }));
    const autonomousExecution = normalizeAutonomousExecutionState(manifest.autonomous_execution);
    const stateFilePath = getExperimentReviewStatePath(params.projectRoot);
    const packetResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.packetPath);
    const plannerPlanResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.plannerPlanPath);
    const analyzerReportResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.analyzerReportPath);
    const crossReviewerReportResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.crossReviewerReportPath);
    const launchDecisionResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.launchDecisionPath);
    return {
        state,
        autonomousExecution,
        stateFilePath,
        stateFileExists: await pathExists(stateFilePath),
        packetResolvedPath,
        packetExists: packetResolvedPath ? await pathExists(packetResolvedPath) : false,
        plannerPlanResolvedPath,
        plannerPlanExists: plannerPlanResolvedPath
            ? await pathExists(plannerPlanResolvedPath)
            : false,
        analyzerReportResolvedPath,
        analyzerReportExists: analyzerReportResolvedPath
            ? await pathExists(analyzerReportResolvedPath)
            : false,
        crossReviewerReportResolvedPath,
        crossReviewerReportExists: crossReviewerReportResolvedPath
            ? await pathExists(crossReviewerReportResolvedPath)
            : false,
        launchDecisionResolvedPath,
        launchDecisionExists: launchDecisionResolvedPath
            ? await pathExists(launchDecisionResolvedPath)
            : false,
        reviewedAutoLaunchEnabled: isReviewedAutoExperimentLaunchEnabled(manifest.autonomous_execution),
        summary: buildExperimentReviewSummary(state),
    };
}
export async function getPaperQcStateSummary(params) {
    return (await getPaperQcStateSummaryFromModule(params));
}
export async function getPaperIngestionStateSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    return summarizePaperIngestionStateFromModule({
        manifest,
    });
}
export async function getPapernexusProgressSummary(params) {
    const manifest = await readManifestEnsured(params.projectRoot);
    const progress = await loadPapernexusProgress({
        projectRoot: params.projectRoot,
        manifest,
        writeIfMissing: true,
    });
    return {
        progress,
        summary: summarizePapernexusProgress(progress),
    };
}
export async function queuePaperIngestionRequest(params) {
    const patch = asRecord(params.paperIngestionRequest) ?? {};
    const normalized = normalizePaperIngestionQueuedRequest({
        ...patch,
        request_id: pickString(patch, ["requestId", "request_id"]) ?? randomUUID(),
        status: pickString(patch, ["status"]) ??
            "queued",
        created_at: pickString(patch, ["createdAt", "created_at"]) ?? new Date().toISOString(),
        updated_at: pickString(patch, ["updatedAt", "updated_at"]) ?? new Date().toISOString(),
    });
    if (!normalized) {
        throw new Error("paperIngestionRequest must include at least a wrapper/command_text/manifest_path/summary.");
    }
    normalized.status = "queued";
    normalized.startedAt = null;
    normalized.finishedAt = null;
    normalized.lastRunId = null;
    normalized.lastSessionKey = null;
    normalized.lastError = null;
    normalized.triggerKind = null;
    normalized.validationStatus = normalized.validationStatus ?? "unknown";
    normalized.validationSummary = normalized.validationSummary ?? null;
    normalized.validationReportPath = normalized.validationReportPath ?? null;
    normalized.attemptCount = 0;
    normalized.maxAttempts =
        normalized.maxAttempts ?? defaultPaperIngestionMaxAttempts();
    normalized.lastAttemptAt = null;
    normalized.nextRetryAt = null;
    normalized.deadLetterAt = null;
    normalized.deadLetterReason = null;
    const validationReport = await validateQueuedPaperIngestionRequest({
        projectRoot: params.projectRoot,
        request: normalized,
    }).catch(() => null);
    const prepared = validationReport
        ? applyPaperIngestionValidationToRequest({
            request: normalized,
            report: validationReport,
        })
        : normalized;
    const result = await setPaperIngestionState({
        projectRoot: params.projectRoot,
        paperIngestion: {
            queued_requests: [serializePaperIngestionQueuedRequest(prepared)],
            last_updated_at: prepared.updatedAt,
        },
    });
    const request = result.state.queuedRequests.find((entry) => entry.requestId === prepared.requestId) ??
        prepared;
    return {
        state: result.state,
        request,
    };
}
export async function validatePaperIngestionRequest(params) {
    let request = null;
    if (params.paperIngestionRequest) {
        request = normalizePaperIngestionQueuedRequest({
            ...params.paperIngestionRequest,
            request_id: pickString(params.paperIngestionRequest, ["requestId", "request_id"]) ??
                randomUUID(),
            status: pickString(params.paperIngestionRequest, ["status"]) ?? "queued",
            created_at: pickString(params.paperIngestionRequest, ["createdAt", "created_at"]) ??
                new Date().toISOString(),
            updated_at: pickString(params.paperIngestionRequest, ["updatedAt", "updated_at"]) ??
                new Date().toISOString(),
        });
    }
    else {
        const current = await getPaperIngestionStateSummary({
            projectRoot: params.projectRoot,
        });
        request =
            (params.requestId
                ? current.state.queuedRequests.find((entry) => entry.requestId === params.requestId)
                : current.state.queuedRequests.find((entry) => ["queued", "needs_repair", "launching", "running"].includes(entry.status))) ?? null;
    }
    if (!request) {
        throw new Error("No queued paper ingestion request was available for validation.");
    }
    const report = await validateQueuedPaperIngestionRequest({
        projectRoot: params.projectRoot,
        request,
    });
    const patchedRequest = applyPaperIngestionValidationToRequest({
        request,
        report,
    });
    if (params.persist === false && !params.requestId) {
        return {
            report,
            request: patchedRequest,
            state: null,
        };
    }
    const result = await setPaperIngestionState({
        projectRoot: params.projectRoot,
        paperIngestion: {
            queued_requests: [serializePaperIngestionQueuedRequest(patchedRequest)],
            last_updated_at: patchedRequest.updatedAt,
        },
    });
    return {
        report,
        request: result.state.queuedRequests.find((entry) => entry.requestId === patchedRequest.requestId) ??
            patchedRequest,
        state: result.state,
    };
}
export async function auditLiteratureCoverageForWorkflow(params) {
    return {
        audit: await auditLiteratureCoverage({
            projectRoot: params.projectRoot,
        }),
    };
}
export async function planCitationExpansionForWorkflow(params) {
    return {
        packet: await planCitationExpansion({
            projectRoot: params.projectRoot,
            maxSeeds: params.maxSeeds,
        }),
    };
}
export async function runBroadPaperSearchForWorkflow(params) {
    return runBroadPaperSearch({
        projectRoot: params.projectRoot,
        topic: params.topic,
        depth: params.depth,
        maxQueries: typeof params.maxQueries === "number" && Number.isFinite(params.maxQueries)
            ? Math.floor(params.maxQueries)
            : undefined,
        maxResultsPerQuery: typeof params.maxResultsPerQuery === "number" &&
            Number.isFinite(params.maxResultsPerQuery)
            ? Math.floor(params.maxResultsPerQuery)
            : undefined,
        maxIndexEntries: typeof params.maxIndexEntries === "number" && Number.isFinite(params.maxIndexEntries)
            ? Math.floor(params.maxIndexEntries)
            : undefined,
        maxResolutionAttempts: typeof params.maxResolutionAttempts === "number" &&
            Number.isFinite(params.maxResolutionAttempts)
            ? Math.floor(params.maxResolutionAttempts)
            : undefined,
    });
}
export async function getCitationCollectionStateSummary(params) {
    return (await getCitationCollectionStateSummaryFromModule(params));
}
export async function getFigureQcStateSummary(params) {
    return (await getFigureQcStateSummaryFromModule(params));
}
export async function getReviewIssueTrackerStateSummary(params) {
    return (await getReviewIssueTrackerStateSummaryFromModule(params));
}
export async function setIdleResearchState(params) {
    return await setIdleResearchStateFromModule(params);
}
export async function setWritingContractState(params) {
    return await setWritingContractStateFromModule(params);
}
export async function setWritingSessionState(params) {
    return await setWritingSessionStateFromModule(params);
}
export async function setReviewSessionState(params) {
    return await setReviewSessionStateFromModule(params);
}
function deriveResearchMemoryReviewVerdict(value) {
    const normalized = normalizeStage(value);
    if (normalized && ["ready", "publication_ready", "accept", "accepted"].includes(normalized)) {
        return "ready";
    }
    if (normalized &&
        ["almost", "almost_ready", "minor_revision", "needs_revision", "revise"].includes(normalized)) {
        return "almost";
    }
    return "not ready";
}
function deriveResearchMemoryReviewScore(reviewSession) {
    const rubricValues = Object.values(reviewSession.rubric).filter((value) => typeof value === "number" && Number.isFinite(value));
    if (rubricValues.length > 0) {
        const average = rubricValues.reduce((sum, value) => sum + value, 0) / rubricValues.length;
        return Math.round(average * 100) / 100;
    }
    const verdict = deriveResearchMemoryReviewVerdict(reviewSession.verdict);
    switch (verdict) {
        case "ready":
            return 8;
        case "almost":
            return 6.5;
        default:
            return 4;
    }
}
export async function setGraphGuidedWritingState(params) {
    return await setGraphGuidedWritingStateFromModule(params);
}
export async function setExternalReviewState(params) {
    return await setExternalReviewStateFromModule(params);
}
export async function setBrainstormCycleState(params) {
    return await setBrainstormCycleStateFromModule(params);
}
export async function runBrainstormCycle(params) {
    const projectRoot = path.resolve(params.projectRoot);
    const manifest = await readManifestEnsured(projectRoot);
    const current = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
    const patch = asRecord(params.brainstormCycle) ?? {};
    const trackId = pickString(patch, ["trackId", "track_id"]) ?? current.trackId;
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
        provider: pickString(patch, ["provider"]) ?? current.provider ?? "workflow_core_brainstorm",
        provider_mode: pickString(patch, ["providerMode", "provider_mode"]) ??
            current.providerMode ??
            "core",
        provider_status: normalizeStage(patch.providerStatus ?? patch.provider_status) ??
            (selection ? "ready" : current.providerStatus) ??
            (isBrainstormCycleReady(current) ? "ready" : "pending"),
        provider_last_run_at: pickString(patch, ["providerLastRunAt", "provider_last_run_at"]) ??
            new Date().toISOString(),
        provider_last_error: pickString(patch, ["providerLastError", "provider_last_error"]) ??
            (selection ? null : current.providerLastError),
        contract_version: pickNumber(patch, ["contractVersion", "contract_version"]) ??
            current.contractVersion ??
            1,
        selection_mode: selection?.mode ?? current.selectionMode,
        selected_round_id: selection?.round.roundId ??
            pickString(patch, ["selectedRoundId", "selected_round_id"]) ??
            current.selectedRoundId,
        selected_option_id: selection?.option.optionId ??
            pickString(patch, ["selectedOptionId", "selected_option_id"]) ??
            current.selectedOptionId,
        selected_option_title: selection?.option.title ??
            pickString(patch, ["selectedOptionTitle", "selected_option_title"]) ??
            current.selectedOptionTitle,
        selected_option_score: selection?.option.score ??
            pickNumber(patch, ["selectedOptionScore", "selected_option_score"]) ??
            current.selectedOptionScore,
        status: normalizeStage(patch.status) ??
            (selection ? "reconciled" : current.status),
        topic_summary_path: pickString(patch, ["topicSummaryPath", "topic_summary_path"]) ??
            (preferScopedDefaults ? defaultPaths.topicSummaryPath : current.topicSummaryPath) ??
            defaultPaths.topicSummaryPath,
        research_brief_path: pickString(patch, ["researchBriefPath", "research_brief_path"]) ??
            (preferScopedDefaults ? defaultPaths.researchBriefPath : current.researchBriefPath) ??
            defaultPaths.researchBriefPath,
        brainstorm_brief_path: pickString(patch, ["brainstormBriefPath", "brainstorm_brief_path"]) ??
            (preferScopedDefaults ? defaultPaths.brainstormBriefPath : current.brainstormBriefPath) ??
            defaultPaths.brainstormBriefPath,
        logic_chain_path: pickString(patch, ["logicChainPath", "logic_chain_path"]) ??
            (preferScopedDefaults ? defaultPaths.logicChainPath : current.logicChainPath) ??
            defaultPaths.logicChainPath,
        evidence_chain_path: pickString(patch, ["evidenceChainPath", "evidence_chain_path"]) ??
            (preferScopedDefaults ? defaultPaths.evidenceChainPath : current.evidenceChainPath) ??
            defaultPaths.evidenceChainPath,
        reasoning_trace_path: pickString(patch, ["reasoningTracePath", "reasoning_trace_path"]) ??
            (preferScopedDefaults ? defaultPaths.reasoningTracePath : current.reasoningTracePath) ??
            defaultPaths.reasoningTracePath,
        question_packet_path: pickString(patch, ["questionPacketPath", "question_packet_path"]) ??
            (preferScopedDefaults ? defaultPaths.questionPacketPath : current.questionPacketPath) ??
            defaultPaths.questionPacketPath,
        working_memory_path: pickString(patch, ["workingMemoryPath", "working_memory_path"]) ??
            (preferScopedDefaults ? defaultPaths.workingMemoryPath : current.workingMemoryPath) ??
            defaultPaths.workingMemoryPath,
        synthesis_packet_path: pickString(patch, ["synthesisPacketPath", "synthesis_packet_path"]) ??
            (preferScopedDefaults ? defaultPaths.synthesisPacketPath : current.synthesisPacketPath) ??
            defaultPaths.synthesisPacketPath,
        reflection_chain_path: pickString(patch, ["reflectionChainPath", "reflection_chain_path"]) ??
            (preferScopedDefaults ? defaultPaths.reflectionChainPath : current.reflectionChainPath) ??
            defaultPaths.reflectionChainPath,
        theory_brief_path: pickString(patch, ["theoryBriefPath", "theory_brief_path"]) ??
            (preferScopedDefaults ? defaultPaths.theoryBriefPath : current.theoryBriefPath) ??
            defaultPaths.theoryBriefPath,
        storyline_brief_path: pickString(patch, ["storylineBriefPath", "storyline_brief_path"]) ??
            (preferScopedDefaults ? defaultPaths.storylineBriefPath : current.storylineBriefPath) ??
            defaultPaths.storylineBriefPath,
        latest_run_at: pickString(patch, ["latestRunAt", "latest_run_at"]) ??
            new Date().toISOString(),
    });
    const artifactSpecs = [
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
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "logic_chain",
                "logicChain",
            ]) ?? pickBrainstormPayload(patch, ["logic_chain", "logicChain"]),
            targetPath: next.logicChainPath,
            writer: "text",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "evidence_chain",
                "evidenceChain",
            ]) ?? pickBrainstormPayload(patch, ["evidence_chain", "evidenceChain"]),
            targetPath: next.evidenceChainPath,
            writer: "text",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "reasoning_trace",
                "reasoningTrace",
            ]) ?? pickBrainstormPayload(patch, ["reasoning_trace", "reasoningTrace"]),
            targetPath: next.reasoningTracePath,
            writer: "trace",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "question_packet",
                "questionPacket",
            ]) ?? pickBrainstormPayload(patch, ["question_packet", "questionPacket"]),
            targetPath: next.questionPacketPath,
            writer: "text",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "working_memory",
                "workingMemory",
            ]) ?? pickBrainstormPayload(patch, ["working_memory", "workingMemory"]),
            targetPath: next.workingMemoryPath,
            writer: "json",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "synthesis_packet",
                "synthesisPacket",
            ]) ?? pickBrainstormPayload(patch, ["synthesis_packet", "synthesisPacket"]),
            targetPath: next.synthesisPacketPath,
            writer: "text",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "reflection_chain",
                "reflectionChain",
            ]) ?? pickBrainstormPayload(patch, ["reflection_chain", "reflectionChain"]),
            targetPath: next.reflectionChainPath,
            writer: "json",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
                "theory_brief",
                "theoryBrief",
            ]) ?? pickBrainstormPayload(patch, ["theory_brief", "theoryBrief"]),
            targetPath: next.theoryBriefPath,
            writer: "json",
        },
        {
            payload: pickBrainstormPayload(selection?.optionRecord ?? {}, [
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
        }
        else if (spec.writer === "trace") {
            await writeTextEnsured(resolved, renderReasoningTracePayload(spec.payload));
        }
        else {
            await writeTextEnsured(resolved, renderMarkdownishPayload(spec.payload));
        }
    }
    if (trackId) {
        const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
        const trackRegistry = await readJsonIfExists(trackRegistryPath);
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
export async function setResearchProgramState(params) {
    return await setResearchProgramStateFromModule(params);
}
export async function materializeExperimentReviewState(params) {
    return materializeExperimentReviewStateImpl(params, {
        readManifestEnsured,
        saveManifest,
    });
}
export async function materializePlanState(params) {
    const result = await materializePlanStateImpl(params);
    const manifest = await readManifestEnsured(params.projectRoot);
    const projectId = inferProjectId(params.projectRoot, manifest);
    const ideationContract = normalizeIdeationContractState(manifest.ideation_contract);
    return {
        state: result.state,
        validationErrors: [
            ...getResearchProgramValidationErrors(result.state),
            ...getResearchProgramPlanValidationErrors({
                state: result.state,
                ideationContract,
            }),
        ],
        onboardingStatus: getResearchProgramOnboardingStatus({
            state: result.state,
            projectId,
        }),
        onboardingGaps: getResearchProgramOnboardingGaps({
            state: result.state,
            projectId,
        }),
        generatedDefaults: result.generatedDefaults,
    };
}
export async function setExperimentReviewState(params) {
    return await setExperimentReviewStateFromModule(params);
}
function normalizeMarkdownSignalLine(rawLine) {
    const normalized = rawLine
        .trim()
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^#+\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
    return normalized.length > 0 ? normalized : null;
}
function collectMarkdownSignalLines(rawText, options) {
    if (!rawText) {
        return [];
    }
    const filters = (options?.includeSectionsContaining ?? []).map((value) => value.trim().toLowerCase());
    const matches = [];
    let currentHeading = null;
    for (const rawLine of rawText.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            continue;
        }
        if (trimmed.startsWith("#")) {
            currentHeading = normalizeMarkdownSignalLine(trimmed)?.toLowerCase() ?? null;
            continue;
        }
        if (filters.length > 0) {
            const headingMatches = currentHeading
                ? filters.some((value) => currentHeading?.includes(value))
                : false;
            if (!headingMatches) {
                continue;
            }
        }
        if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
            const normalized = normalizeMarkdownSignalLine(trimmed);
            if (normalized) {
                matches.push(normalized);
            }
        }
    }
    return uniqueStrings(matches);
}
function slugifyIdeationLabel(value) {
    const normalized = (value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "direction";
}
function quoteMarkdownText(value) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : "N/A";
}
function renderMarkdownBulletList(items) {
    if (items.length === 0) {
        return "- N/A\n";
    }
    return `${items.map((item) => `- ${item}`).join("\n")}\n`;
}
function clampUnitScore(value, fallback) {
    const candidate = Number.isFinite(value ?? NaN) ? Number(value) : fallback;
    return Math.max(0, Math.min(1, candidate));
}
function averageScores(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function resolveResearchProgramTrack(manifest, trackId) {
    if (!trackId) {
        return null;
    }
    const researchProgram = normalizeResearchProgramState(manifest?.research_program);
    return (researchProgram.tracks.find((track) => track.trackId === trackId)
        ? serializeResearchProgramTrack(researchProgram.tracks.find((track) => track.trackId === trackId))
        : null);
}
async function mergeJsonArtifact(resolvedPath, merge) {
    if (!resolvedPath) {
        return;
    }
    const current = (await readJsonIfExists(resolvedPath)) ?? {};
    await writeJsonEnsured(resolvedPath, merge(current));
}
export async function materializeIdeationContract(params) {
    return materializeIdeationContractImpl(params, {
        readManifestEnsured,
        saveManifest,
        inferProjectId,
        getBrainstormCycleStateSummary,
        getIdeationContractStateSummary,
        getActiveTracks,
        resolveResearchProgramTrack,
        collectMarkdownSignalLines,
        quoteMarkdownText,
        renderMarkdownBulletList,
        slugifyIdeationLabel,
        averageScores,
        trackHasGraphBackedInnovationEvidence,
        mergeJsonArtifact,
        normalizeInnovationReflectionState: (value) => normalizeInnovationReflectionState(value),
        serializeInnovationReflectionState: (value) => serializeInnovationReflectionState(value),
    });
}
export async function setIdeationContractState(params) {
    return await setIdeationContractStateFromModule(params);
}
export async function materializePaperStoryState(params) {
    return materializePaperStoryStateImpl(params, {
        readManifestEnsured,
        saveManifest,
        getIdeationContractStateSummary,
        getBrainstormCycleStateSummary,
        getPaperStoryStateSummary,
        getActiveTracks,
        resolveResearchProgramTrack,
        summarizeClaimSupport,
        collectTrackVerdictSignals,
        collectUnsupportedClaimSignals,
        collectMarkdownSignalLines,
        quoteMarkdownText,
        renderMarkdownBulletList,
        isIdeationContractReady: (state) => isIdeationContractReady(state),
    });
}
export async function materializeReviewPressurePacket(params) {
    return materializeReviewPressurePacketImpl(params, {
        readManifestEnsured,
        saveManifest,
        getPaperStoryStateSummary,
        getIdeationContractStateSummary,
        getReviewPressurePacketStateSummary,
        quoteMarkdownText,
        renderMarkdownBulletList,
        collectMarkdownSignalLines,
        isPaperStoryStateReady: (state) => isPaperStoryStateReady(state),
    });
}
export async function materializeInnovationSynthesisState(params) {
    return materializeInnovationSynthesis(params);
}
export async function materializeResultsStorylineState(params) {
    return materializeResultsStoryline(params);
}
export async function materializeTitleAbstractIntroWorkbenchState(params) {
    return materializeTitleAbstractIntroWorkbench(params);
}
export async function materializeLiteratureDiscoveryPacket(params) {
    return materializeLiteratureDiscoveryPacketImpl(params);
}
export async function materializeSurveyReviewState(params) {
    return materializeSurveyReviewStateImpl(params);
}
export async function setPaperStoryState(params) {
    return await setPaperStoryStateFromModule(params);
}
export async function setSurveyReviewState(params) {
    return await setSurveyReviewStateFromModule(params);
}
export async function setReviewPressurePacketState(params) {
    return await setReviewPressurePacketStateFromModule(params);
}
export async function setOrchestrationState(params) {
    return await setOrchestrationStateFromModule(params);
}
export async function setWritePackageState(params) {
    return await setWritePackageStateFromModule(params);
}
export async function setExperimentSearchState(params) {
    return await setExperimentSearchStateFromModule(params);
}
export async function setPaperQcState(params) {
    return await setPaperQcStateFromModule(params);
}
export async function setPaperIngestionState(params) {
    return await setPaperIngestionStateFromModule(params);
}
export async function setCitationCollectionState(params) {
    return await setCitationCollectionStateFromModule(params);
}
export async function setFigureQcState(params) {
    return await setFigureQcStateFromModule(params);
}
export async function setReviewIssueTrackerState(params) {
    return await setReviewIssueTrackerStateFromModule(params);
}
export async function recordCitationVerification(params) {
    const result = await recordCitationVerificationImpl(params, {
        readManifestEnsured,
        saveManifest,
        normalizeCitationIntegrityState,
        serializeCitationIntegrityState,
        normalizeIdleResearchState,
        serializeIdleResearchState,
        normalizeGraphPresenceStatus,
        isIdleResearchDue,
        computeIdleResearchNextDueAt,
        normalizeInnovationReflectionState,
        serializeInnovationReflectionState,
        readExperimentLedgerEnsured,
        getInnovationReflectionBasis,
        isInnovationReflectionDue,
        buildExperimentMemoryDigest,
        getExperimentLedgerPath,
        mergeExperimentEntries,
        buildExperimentLedgerSummary,
        saveExperimentLedger,
        syncManifestExperimentMemory,
        normalizeRole,
    });
    await scaffoldMarkdownArtifactIfMissing(result.verificationReportResolvedPath, [
        "# Citation Verification",
        "",
        `Verification Status: ${result.state.verificationStatus ?? "unknown"}`,
        `Bibliography Pages: ${result.state.bibliographyPageCount ?? 0}`,
        `All Citations Real: ${result.state.allCitationsReal ? "yes" : "no"}`,
        `Verified Citations: ${result.state.verifiedCitationCount}`,
        `Suspicious Citations: ${result.state.suspiciousCitationCount}`,
        `Hallucinated Citations: ${result.state.hallucinatedCitationCount}`,
        `Unresolved Placeholders: ${result.state.unresolvedPlaceholderCount}/${result.state.allowedPlaceholderCount}`,
        `Last Verified At: ${result.state.lastVerifiedAt ?? "unset"}`,
        `Pending Reason: ${result.state.pendingReason ?? "none"}`,
    ].join("\n"));
    return {
        ...result,
        state: result.state,
    };
}
export async function recordIdleResearchRun(params) {
    const result = await recordIdleResearchRunImpl(params, {
        readManifestEnsured,
        saveManifest,
        normalizeCitationIntegrityState,
        serializeCitationIntegrityState,
        normalizeIdleResearchState,
        serializeIdleResearchState,
        normalizeGraphPresenceStatus,
        isIdleResearchDue,
        computeIdleResearchNextDueAt,
        normalizeInnovationReflectionState,
        serializeInnovationReflectionState,
        readExperimentLedgerEnsured,
        getInnovationReflectionBasis,
        isInnovationReflectionDue,
        buildExperimentMemoryDigest,
        getExperimentLedgerPath,
        mergeExperimentEntries,
        buildExperimentLedgerSummary,
        saveExperimentLedger,
        syncManifestExperimentMemory,
        normalizeRole,
    });
    return {
        ...result,
        state: result.state,
    };
}
export async function recordInnovationReflection(params) {
    const result = await recordInnovationReflectionImpl(params, {
        readManifestEnsured,
        saveManifest,
        normalizeCitationIntegrityState,
        serializeCitationIntegrityState,
        normalizeIdleResearchState,
        serializeIdleResearchState,
        normalizeGraphPresenceStatus,
        isIdleResearchDue,
        computeIdleResearchNextDueAt,
        normalizeInnovationReflectionState,
        serializeInnovationReflectionState,
        readExperimentLedgerEnsured,
        getInnovationReflectionBasis,
        isInnovationReflectionDue,
        buildExperimentMemoryDigest,
        getExperimentLedgerPath,
        mergeExperimentEntries,
        buildExperimentLedgerSummary,
        saveExperimentLedger,
        syncManifestExperimentMemory,
        normalizeRole,
    });
    return {
        ...result,
        state: result.state,
    };
}
export async function getExperimentMemorySummary(params) {
    const result = await getExperimentMemorySummaryImpl(params, {
        readManifestEnsured,
        saveManifest,
        normalizeCitationIntegrityState,
        serializeCitationIntegrityState,
        normalizeIdleResearchState,
        serializeIdleResearchState,
        normalizeGraphPresenceStatus,
        isIdleResearchDue,
        computeIdleResearchNextDueAt,
        normalizeInnovationReflectionState,
        serializeInnovationReflectionState,
        readExperimentLedgerEnsured,
        getInnovationReflectionBasis,
        isInnovationReflectionDue,
        buildExperimentMemoryDigest,
        getExperimentLedgerPath,
        mergeExperimentEntries,
        buildExperimentLedgerSummary,
        saveExperimentLedger,
        syncManifestExperimentMemory,
        normalizeRole,
    });
    return {
        ...result,
        summary: result.summary,
        recentExperiments: result.recentExperiments,
    };
}
export async function getExperimentGpuMonitorStateSummary(params) {
    return getExperimentGpuMonitorStateSummaryImpl(params);
}
export async function refreshExperimentGpuMonitor(params) {
    return refreshExperimentGpuMonitorImpl(params);
}
export async function upsertExperimentLedgerEntry(params) {
    const experimentId = pickString(params.experiment, ["experimentId", "experiment_id", "id"]) ?? null;
    const trackId = pickString(params.experiment, ["trackId", "track_id"]) ?? null;
    const currentMetadata = asRecord(params.experiment.metadata) ?? {};
    const hasDatasetMetadata = asStringArray(currentMetadata.datasets).length > 0 ||
        asStringArray(currentMetadata.dataset_names).length > 0 ||
        asStringArray(currentMetadata.validation_datasets).length > 0;
    let enrichedExperiment = params.experiment;
    if (!hasDatasetMetadata && experimentId) {
        const bundleManifest = await findExperimentBundleManifest({
            projectRoot: params.projectRoot,
            experimentId,
            trackId,
        });
        const derivedMetadata = buildExperimentMetadataFromBundleManifest(bundleManifest);
        if (derivedMetadata) {
            enrichedExperiment = {
                ...params.experiment,
                metadata: {
                    ...derivedMetadata,
                    ...currentMetadata,
                },
            };
        }
    }
    const result = await upsertExperimentLedgerEntryImpl({
        ...params,
        experiment: enrichedExperiment,
    }, {
        readManifestEnsured,
        saveManifest,
        normalizeCitationIntegrityState,
        serializeCitationIntegrityState,
        normalizeIdleResearchState,
        serializeIdleResearchState,
        normalizeGraphPresenceStatus,
        isIdleResearchDue,
        computeIdleResearchNextDueAt,
        normalizeInnovationReflectionState,
        serializeInnovationReflectionState,
        readExperimentLedgerEnsured,
        getInnovationReflectionBasis,
        isInnovationReflectionDue,
        buildExperimentMemoryDigest,
        getExperimentLedgerPath,
        mergeExperimentEntries,
        buildExperimentLedgerSummary,
        saveExperimentLedger,
        syncManifestExperimentMemory,
        normalizeRole,
    });
    await materializeExperimentMemoryPacket({
        projectRoot: params.projectRoot,
    });
    return {
        entry: result.entry,
        summary: result.summary,
        recentExperiments: result.recentExperiments,
    };
}
export async function materializeExperimentMemoryPacket(params) {
    return await materializeExperimentMemoryPacketImpl(params, {
        readManifestEnsured,
        saveManifest,
        readExperimentLedgerEnsured,
    });
}
export async function runWorkflowAutoIterator(params) {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const rawExistingAudit = normalizeWorkflowAutoIteratorAudit(await readJsonIfExists(getAutoIteratorAuditPath(params.projectRoot)));
    const existingAudit = deriveEffectiveWorkflowAutoIteratorAudit({
        audit: rawExistingAudit,
        now: startedAt,
    });
    if (rawExistingAudit?.status === "started" && existingAudit?.status === "started" && existingAudit.runId && existingAudit.runId !== runId) {
        await writeAutoIteratorAuditLifecycle({
            projectRoot: params.projectRoot,
            runId: existingAudit.runId,
            status: "superseded",
            startedAt: existingAudit.startedAt,
            updatedAt: startedAt,
            summary: `Auto iterator run ${existingAudit.runId} was superseded by newer run ${runId}.`,
            error: existingAudit.error,
        });
    }
    else if (rawExistingAudit?.status === "started" &&
        existingAudit?.status === "timed_out" &&
        existingAudit.runId &&
        existingAudit.runId !== runId) {
        await writeAutoIteratorAuditLifecycle({
            projectRoot: params.projectRoot,
            runId: existingAudit.runId,
            status: "timed_out",
            startedAt: existingAudit.startedAt,
            updatedAt: startedAt,
            summary: existingAudit.summary ??
                `Auto iterator run ${existingAudit.runId} timed out before newer run ${runId} started.`,
            error: existingAudit.error,
        });
    }
    await writeAutoIteratorAuditLifecycle({
        projectRoot: params.projectRoot,
        runId,
        status: "started",
        startedAt,
        updatedAt: startedAt,
        summary: `Auto iterator started for ${params.mode ?? "default"} mode.`,
    });
    try {
        return await runWorkflowAutoIteratorImpl(params, {
            normalizePolicy,
            loadExperimentLedgerIfExists,
            readGateState,
            normalizeRole,
            inferProjectId,
            normalizeWritePackageState,
            assembleWritePackage,
            checkGraphPresenceForWorkflow,
            getPreviousStagesForRegression,
            getMissingStageSignals,
            evaluateWorkflowAutoModeRisk,
            readAutoModeDiscussionStore,
            resolveEffectiveWorkflowAutoMode,
            evaluateGateBlocking,
            isSurveyWorkflow,
            ensureSurveyWorkflowIdentity,
            resolveStageForWorkflowLine,
            resolveNextStageForWorkflow,
            STAGE_REQUIREMENTS,
            stageOwner,
            loadExperimentSearchState,
            normalizeExperimentSearchState,
            normalizeAutonomousExecutionState,
            loadExperimentReviewState,
            isReviewedAutoExperimentLaunchEnabled,
            resolveExperimentReviewNextOwner,
            deriveExperimentReviewMicroStage,
            buildExperimentReviewCommand,
            hasActiveExperimentRuns,
            hasFinishedExperimentWorkAwaitingReconciliation,
            evaluateExperimentSearchDecision,
            buildExperimentMonitorCommand,
            buildGraphImportRepairGuidance,
            formatStageCommand,
            STAGE_ENTRY_MICRO_STAGES,
            saveManifest,
            saveGateState,
            maybeQueueAutoIteratorMailbox,
            formatStageSummary,
            normalizeIdleResearchState,
            isIdleResearchDue,
            syncProjectsStateEntry,
            readProjectsStateRaw,
            writeAutoIteratorAudit,
            appendWorkflowTraceEvent,
            materializeIdeaCatalystState,
            materializeLiteratureDiscoveryPacket,
            materializePapernexusPacketContracts,
            queueIdeaCatalystRequisition,
            queueLiteratureDiscoveryRequisition,
            materializeIdeationContract,
            materializePaperStoryState,
            materializeExperimentReviewState,
            materializeReviewPressurePacket,
            materializeSurveyReviewState,
            materializeInnovationSynthesisState,
            materializeResultsStoryline: materializeResultsStorylineState,
            materializeTitleAbstractIntroWorkbench: materializeTitleAbstractIntroWorkbenchState,
        });
    }
    catch (error) {
        const failedAt = new Date().toISOString();
        await writeAutoIteratorAuditLifecycle({
            projectRoot: params.projectRoot,
            runId,
            status: "failed",
            startedAt,
            updatedAt: failedAt,
            failedAt,
            summary: error instanceof Error
                ? error.message
                : "Auto iterator failed before a terminal result was recorded.",
            error,
        });
        throw error;
    }
}
export function getProjectRootForWorkflow(options) {
    return getProjectRoot(options);
}
export function getChannelProjectBindingForWorkflow(params) {
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
export function listChannelProjectBindingsForWorkflow(params) {
    return listChannelProjectBindings({
        policy: params.policy,
        context: {
            workspaceDir: params.workspaceDir,
        },
    });
}
export async function bindChannelProjectForWorkflow(params) {
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
        runtimeSession: params.runtimeSession ?? null,
    });
}
export async function ensureChannelProjectBindingForWorkflow(params) {
    const existing = getChannelProjectBinding({
        policy: params.policy,
        context: {
            workspaceDir: params.workspaceDir,
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            messageChannel: params.messageChannel,
            channelKey: params.channelKey,
            projectRoot: params.projectRoot ?? undefined,
            role: params.boundByAgent ?? undefined,
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
    const projectRoot = params.projectRoot ??
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
            role: params.boundByAgent ?? undefined,
        },
        projectRoot,
        projectId: params.projectId,
        messageChannel: params.messageChannel,
        boundByAgent: params.boundByAgent,
        notes: params.notes,
        runtimeSession: params.runtimeSession ?? null,
    });
    return {
        autoBound: true,
        reason: "created",
        storePath: bound.storePath,
        binding: bound.binding,
    };
}
export async function unbindChannelProjectForWorkflow(params) {
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
