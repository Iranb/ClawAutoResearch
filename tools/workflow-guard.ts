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
import { normalizeWorkflowControlContract } from "./workflow-control-contract.js";
import {
  clearChannelProjectBinding,
  getChannelProjectBinding,
  listChannelProjectBindings,
  resolveProjectContext,
  setChannelProjectBinding,
  type ChannelProjectBindingPolicy,
  type ChannelProjectBindingRecord,
} from "./channel-project-bindings";
import { shouldUseChannelProjectBindingForWorkflow } from "./workflow-message-channels.js";
import {
  getWorkflowNotificationChannelsPath,
  recordWorkflowNotificationChannelForProject,
} from "./workflow-notification-channels.js";
import {
  checkGraphPresenceForWorkflow,
  type GraphPresenceCheckResult,
  type GraphPresenceStatus,
} from "./graph-presence";
import { maybeMaterializeGraphBuildPaperSources } from "./graph-build-source-catchup";
import { advanceLiteratureDiscoveryRequisition } from "./literature-discovery/requisition-executor";
import {
  auditLiteratureCoverage,
  planCitationExpansion,
  type CitationExpansionPacket,
  type LiteratureCoverageAudit,
} from "./paper-discovery-diagnostics";
import {
  runBroadPaperSearch,
} from "./research30/workflow-bridge";
import type {
  BroadPaperProviderName,
  BroadPaperSearchQuery,
} from "./research30/provider-contract";
import {
  applyPaperIngestionValidationToRequest,
  defaultPaperIngestionMaxAttempts,
  type PaperIngestionValidationReport,
  type PaperIngestionValidationStatus,
  validateQueuedPaperIngestionRequest,
} from "./paper-ingestion-validation";
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
import { evaluateCodeAutoReview } from "./workflow-code-review.js";
import { readAutoModeDiscussionStore } from "./workflow-auto-discussion";
import {
  normalizeWorkflowLobsterHandoffConfig,
  type WorkflowLobsterHandoffConfig,
} from "./lobster-handoff";
import {
  isWorkflowSubagentSessionKey,
  looksLikePapernexusHeavyCommand,
  looksLikePapernexusLiveGraphCliReadCommand,
  buildWorkflowRuntimeSessionBinding,
  type WorkflowRuntimeSessionBinding,
} from "./workflow-subagent-sessions";
import {
  normalizePapernexusAccessMode,
  normalizePapernexusApiTokenSource,
  normalizePapernexusMcpTransport,
  summarizePapernexusRemoteAccessConfig,
} from "./papernexus-secret";
import {
  formatWorkflowShellArgument as formatWorkflowShellArgumentFromKernel,
  getBrainstormCycleValidationErrors as getBrainstormCycleValidationErrorsFromKernel,
  getResearchProgramOnboardingGaps as getResearchProgramOnboardingGapsFromKernel,
  getResearchProgramOnboardingStatus as getResearchProgramOnboardingStatusFromKernel,
  getResearchProgramPlanValidationErrors as getResearchProgramPlanValidationErrorsFromKernel,
  getResearchProgramValidationErrors as getResearchProgramValidationErrorsFromKernel,
  isBrainstormCycleReady as isBrainstormCycleReadyFromKernel,
  isInnovationReflectionDue as isInnovationReflectionDueFromKernel,
} from "./workflow-kernel/readiness";
import {
  resolveWorkflowStageLeadRole,
} from "./workflow-kernel/stage-registry";
import {
  reconcileWorkflowControl,
} from "./workflow-control-reconciler";
import {
  loadPapernexusProgress,
  summarizePapernexusProgress,
  type PapernexusProgressSnapshot,
  writePapernexusProgressFromManifest,
} from "./papernexus-progress";
import {
  normalizeCameraReadyEvidenceState,
  normalizeReproducibilityPackState,
  normalizeMechanismEvidenceState,
  normalizeOpportunityScorecardState,
  normalizeAblationEvidenceState,
  normalizeBenchmarkProtocolState,
  normalizeStatisticalEvidenceState,
  normalizeVenueCompetitionState,
} from "./workflow-evidence/contracts";
import {
  collectFrontierMappingStageMissingSignals,
  collectGraphBuildStageMissingSignals,
  collectSetupStageMissingSignals,
} from "./workflow-guard-stages/foundation-stage-signals";
import {
  collectCodeStageMissingSignals,
  collectIdeaStageMissingSignals,
  collectPlanStageMissingSignals,
} from "./workflow-guard-stages/ideation-stage-signals";
import {
  collectAnalyzeStageMissingSignals,
  collectExperimentStageMissingSignals,
  collectReviewStageMissingSignals,
} from "./workflow-guard-stages/execution-stage-signals";
import {
  collectSubmitStageMissingSignals,
  collectWriteStageMissingSignals,
} from "./workflow-guard-stages/writing-stage-signals";
import type {
  WorkflowHookEvent,
  WorkflowMaterializedArtifact,
} from "./workflow-hooks/contracts.js";
import {
  collectSurveyReviewStageMissingSignals as collectSurveyReviewStageMissingSignalsFromModule,
} from "./workflow-guard-stages/survey-stage-signals";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  isNonEmptyDirectory,
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import {
  expandHome,
  resolveProjectArtifactPath,
  resolveTrackArtifactPath,
} from "./workflow-guard-core/paths";
import {
  loadTrackInnovationEvidence as loadTrackInnovationEvidenceFromHelper,
  trackHasGraphBackedInnovationEvidence as trackHasGraphBackedInnovationEvidenceFromHelper,
} from "./workflow-guard-track-evidence.js";
import {
  normalizeResearchProgramState,
  normalizeResearchProgramTrack,
  normalizeResearchProgramTask,
  serializeResearchProgramState,
  serializeResearchProgramTrack,
  serializeResearchProgramTask,
} from "./workflow-guard-state/research-program";
import {
  normalizeIdeationGraphBasisPaths,
  normalizeIdeationGraphIndicesState,
  normalizeIdeationContractState,
  serializeIdeationGraphBasisPaths,
  serializeIdeationGraphIndicesState,
  serializeIdeationContractState,
} from "./workflow-guard-state/ideation-contract";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "./workflow-guard-state/paper-story";
import {
  normalizeReviewPressurePacketState,
  serializeReviewPressurePacketState,
} from "./workflow-guard-state/review-pressure";
import {
  normalizeInnovationSynthesisState,
  normalizeStoryGapSearchRequisitionState,
  serializeInnovationSynthesisState,
  serializeStoryGapSearchRequisitionState,
} from "./workflow-guard-state/innovation-synthesis";
import {
  normalizeResultsStorylineState,
} from "./workflow-guard-state/results-storyline";
import {
  normalizeStorylinePlannerState,
  serializeStorylinePlannerState,
} from "./workflow-guard-state/storyline-planner";
import {
  normalizeTitleAbstractIntroWorkbenchState,
} from "./workflow-guard-state/title-abstract-intro-workbench";
import {
  normalizeParagraphLogicAuditState,
} from "./workflow-guard-state/paragraph-logic-audit";
import {
  getSurveyReviewStateSummary as getSurveyReviewStateSummaryFromModule,
  normalizeSurveyReviewState,
} from "./workflow-guard-state/survey-review";
import {
  ensureSurveyWorkflowIdentity,
  isSurveyWorkflow,
  resolveNextStageForWorkflow,
  resolveStageForWorkflowLine,
} from "./workflow-line-routing.js";
import {
  normalizeCitationIntegrityState,
  normalizeExternalReviewState,
  normalizeGraphGuidedWritingState,
  normalizeReviewScoreRecords,
  type ReviewScoreRecord,
  normalizeReviewSessionRubric,
  normalizeReviewSessionState,
  normalizeWritingSectionPacketState,
  normalizeWritingSessionState,
  serializeCitationIntegrityState,
  serializeExternalReviewState,
  serializeGraphGuidedWritingState,
  serializeReviewSessionRubric,
  serializeReviewSessionState,
  serializeWritingSectionPacketState,
  serializeWritingSessionState,
} from "./workflow-guard-state/authoring-review-state";
import {
  normalizeCitationCollectionState,
  normalizeExperimentSearchState,
  normalizeFigureQcState,
  normalizeOrchestrationState,
  normalizePaperQcState,
  normalizeReviewIssueCounts,
  normalizeReviewIssueState,
  normalizeReviewIssueTrackerState,
  normalizeWritePackageState,
  serializeCitationCollectionState,
  serializeExperimentSearchState,
  serializeFigureQcState,
  serializeOrchestrationState,
  serializePaperQcState,
  serializeReviewIssueCounts,
  serializeReviewIssueState,
  serializeReviewIssueTrackerState,
  serializeWritePackageState,
} from "./workflow-guard-state/execution-state";
import {
  DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH,
  normalizeExperimentSearchSpec,
} from "./workflow-guard-state/experiment-search-spec";
import {
  getExperimentSearchReviewStatePath,
  loadExperimentSearchReviewState,
} from "./workflow-auto-experiment-search-review.js";
import {
  evaluateWritingProcessReadiness as evaluateWritingProcessReadinessFromModule,
} from "./workflow-guard-writing/write-package-eval";
import {
  restoreAuthoringArtifactsFromRecovery,
  syncAuthoringArtifactRecovery,
  writingSessionLooksRecoverableEmpty,
} from "./research-writing/authoring-artifact-recovery";
import {
  normalizeAutonomousExecutionState,
  normalizeExperimentReviewState,
  serializeAutonomousExecutionState,
  serializeExperimentReviewState,
} from "./workflow-guard-state/experiment-review";
import { normalizeExperimentSearchReviewState } from "./workflow-guard-state/experiment-search-review.js";
import {
  deriveGraphBuildMicroStage,
  derivePaperIngestionWorkflowDecision,
  hasActiveWorkflowOwnedPaperUpload,
  mergeCompletedPaperEntries,
  mergePaperIngestionBatchItems,
  mergePaperIngestionBatchRuns,
  mergePaperIngestionOperations,
  mergePaperIngestionQueuedRequests,
  normalizePaperIngestionQueuedRequest,
  normalizePaperIngestionRuntimeStatus,
  normalizePaperIngestionState,
  serializePaperIngestionQueuedRequest,
  serializePaperIngestionState,
} from "./workflow-guard-state/paper-ingestion";
import {
  computeIdleResearchNextDueAt,
  normalizeBrainstormCycleOptionState,
  normalizeBrainstormCycleRoundState,
  isIdleResearchDue,
  normalizeBrainstormCycleState,
  normalizeIdleResearchState,
  normalizeInnovationReflectionState,
  serializeBrainstormCycleOptionState,
  serializeBrainstormCycleRoundState,
  serializeBrainstormCycleState,
  serializeIdleResearchState,
  serializeInnovationReflectionState,
} from "./workflow-guard-state/research-loop-state";
import {
  buildTheoryAppendixPlanMarkdown,
  buildTheoryAppendixSectionDraft,
  dedupeTheoryPackets,
  humanizeTheoryPacketLabel,
  inferTheoryAppendixSections,
  normalizeTheoryObjectPacket,
  normalizeTheoryStateFile,
  normalizeTheorySupportState,
  serializeTheoryObjectPacket,
  serializeTheoryStateFile,
  serializeTheorySupportState,
} from "./workflow-guard-state/theory-state";
import {
  DEFAULT_KG_STORYLINE_PACKET_PATH,
  DEFAULT_PARAGRAPH_LOGIC_CHECKLIST,
  DEFAULT_PROOF_CHECKLIST,
  DEFAULT_STORYLINE_CHECKLIST,
  DEFAULT_WRITING_SECTION_ORDER,
  evaluateWritingContractState,
  normalizeWritingContractState,
  normalizeWritingMode,
  resolveWritingTemplatePath,
  serializeWritingContractState,
} from "./workflow-guard-state/writing-contract";
import { summarizeIdeationContractState as summarizeIdeationContractStateFromModule } from "./workflow-guard-summaries/ideation-contract-summary";
import { summarizePaperIngestionState as summarizePaperIngestionStateFromModule } from "./workflow-guard-summaries/paper-ingestion-summary";
import { summarizePaperStoryState as summarizePaperStoryStateFromModule } from "./workflow-guard-summaries/paper-story-summary";
import { summarizeReviewPressurePacketState as summarizeReviewPressurePacketStateFromModule } from "./workflow-guard-summaries/review-pressure-summary";
import { summarizeWritingContractState as summarizeWritingContractStateFromModule } from "./workflow-guard-summaries/writing-contract-summary";
import { buildDynamicTasksImpl } from "./workflow-guard-guidance/dynamic-tasks";
import { materializeIdeaCatalystState } from "./idea-catalyst/materializers";
import {
  getIdeaCatalystValidationErrors,
  normalizeIdeaCatalystState,
} from "./idea-catalyst/state";
import { queueIdeaCatalystRequisition } from "./idea-catalyst/workflow-bridge";
import { materializeLiteratureDiscoveryPacketImpl } from "./literature-discovery/materializer";
import { queueLiteratureDiscoveryRequisition } from "./literature-discovery/workflow-bridge";
import { materializePapernexusPacketContracts } from "./papernexus-packets/materializer";
import { materializeIdeationContractImpl } from "./workflow-guard-materializers/ideation-contract-materializer";
import { materializeExperimentMemoryPacketImpl } from "./workflow-guard-materializers/experiment-memory-materializer.js";
import { materializeExperimentReviewStateImpl } from "./workflow-guard-materializers/experiment-review-materializer";
import { materializeLocalExperimentExecutionImpl } from "./workflow-guard-materializers/experiment-execution-materializer";
import {
  resolveExperimentPrimaryMetricContract,
  serializeExperimentPrimaryMetricContract,
} from "./workflow-experiment-metric-contract";
import {
  applyExperimentGitOpImpl,
  getExperimentGitReviewSummaryImpl,
  requestExperimentGitOpImpl,
  setExperimentGitReviewStateImpl,
} from "./workflow-experiment-git-review.js";
import { materializePaperStoryStateImpl } from "./workflow-guard-materializers/paper-story-materializer";
import { materializePlanStateImpl } from "./workflow-guard-materializers/plan-state-materializer";
import { materializeCodeExperimentBundleImpl } from "./workflow-guard-materializers/code-experiment-bundle-materializer";
import { materializeReviewPressurePacketImpl } from "./workflow-guard-materializers/review-pressure-materializer";
import { materializeSurveyReviewStateImpl } from "./workflow-guard-materializers/survey-review-materializer";
import { materializeFigurePromptContract } from "./research-writing/figure-prompt-contract";
import { materializeInnovationSynthesis } from "./research-writing/innovation-synthesis";
import { materializeResultsStoryline } from "./research-writing/results-storyline";
import {
  materializeScientificEditingPassPlan,
  recordScientificEditingPassResult,
} from "./research-writing/scientific-editing-pass-plan";
import { materializeSurveyStorylinePlanner } from "./research-writing/survey-storyline-planner";
import { materializeTitleAbstractIntroWorkbench } from "./research-writing/title-abstract-intro-workbench";
import {
  buildNonOwnerRoutingAdvice as buildNonOwnerRoutingAdviceImpl,
  acknowledgeWorkflowMailboxMessageImpl,
  getWorkflowContactCooldownImpl,
  getContactStatePath as getContactStatePathImpl,
  getMailboxPath as getMailboxPathImpl,
  getSharedWritingConstitutionLines as getSharedWritingConstitutionLinesImpl,
  inboxForRole as inboxForRoleImpl,
  maybeQueueAutoIteratorMailboxImpl,
  queueWorkflowMailboxMessageImpl,
  readWorkflowMailboxForAgentImpl,
  readContactStore as readContactStoreImpl,
  readMailbox as readMailboxImpl,
  recordWorkflowContactEventImpl,
  saveContactStore as saveContactStoreImpl,
  saveMailbox as saveMailboxImpl,
} from "./workflow-guard-collaboration";
import {
  AUTO_ITERATOR_STARTED_TIMEOUT_MS,
  deriveEffectiveWorkflowAutoIteratorAudit,
  normalizeWorkflowAutoIteratorAudit,
} from "./workflow-runtime-health.js";
import type { WorkflowRuntimeQueueStore } from "./workflow-runtime-state.js";
import {
  buildExperimentLedgerSummary as buildExperimentLedgerSummaryImpl,
  buildExperimentMemoryDigest as buildExperimentMemoryDigestImpl,
  createEmptyExperimentLedger as createEmptyExperimentLedgerImpl,
  getExperimentLedgerPath as getExperimentLedgerPathImpl,
  getExperimentSearchPath as getExperimentSearchPathImpl,
  getExperimentSortTimestamp as getExperimentSortTimestampImpl,
  isTerminalExperimentStatus as isTerminalExperimentStatusImpl,
  loadExperimentLedgerIfExists as loadExperimentLedgerIfExistsImpl,
  loadExperimentSearchState as loadExperimentSearchStateImpl,
  mergeExperimentEntries as mergeExperimentEntriesImpl,
  metricToText as metricToTextImpl,
  normalizeExperimentEntry as normalizeExperimentEntryImpl,
  normalizeExperimentLedger as normalizeExperimentLedgerImpl,
  normalizeMetricRecord as normalizeMetricRecordImpl,
  normalizePapernexusSync as normalizePapernexusSyncImpl,
  readExperimentLedgerEnsured as readExperimentLedgerEnsuredImpl,
  saveExperimentLedger as saveExperimentLedgerImpl,
  saveExperimentSearchStateFile as saveExperimentSearchStateFileImpl,
  syncManifestExperimentMemoryImpl,
} from "./workflow-guard-experiment-history";
import {
  getExperimentGpuMonitorStateSummary as getExperimentGpuMonitorStateSummaryImpl,
  refreshExperimentGpuMonitor as refreshExperimentGpuMonitorImpl,
} from "./workflow-gpu-monitor.js";
import {
  buildIdleResearchTemplateForBootstrap as buildIdleResearchTemplateForBootstrapImpl,
  computeGateConfirmationDeadline as computeGateConfirmationDeadlineImpl,
  dateOnly as dateOnlyImpl,
  defaultResearchProgramZoteroProjectPath as defaultResearchProgramZoteroProjectPathImpl,
  ensureWorkflowProjectRootImpl,
  formatProjectDirEntry as formatProjectDirEntryImpl,
  getGateStatePath as getGateStatePathImpl,
  getConfiguredProjectsRoot,
  getGateStateSummaryImpl,
  getProjectsStatePath as getProjectsStatePathImpl,
  hasTimedDefaultGateExpired as hasTimedDefaultGateExpiredImpl,
  normalizeGateState as normalizeGateStateImpl,
  readGateState as readGateStateImpl,
  readProjectsStateRaw as readProjectsStateRawImpl,
  saveGateState as saveGateStateImpl,
  serializeGateState as serializeGateStateImpl,
  setGateStateForWorkflowImpl,
  syncProjectsStateEntryImpl,
} from "./workflow-guard-project-state";
import {
  extractBrainstormCandidateRecords as extractBrainstormCandidateRecordsImpl,
  extractReviewIssues as extractReviewIssuesImpl,
  hasMeaningfulPayload as hasMeaningfulPayloadImpl,
  pickBrainstormPayload as pickBrainstormPayloadImpl,
  renderMarkdownishPayload as renderMarkdownishPayloadImpl,
  renderReasoningTracePayload as renderReasoningTracePayloadImpl,
  selectBrainstormCandidate as selectBrainstormCandidateImpl,
  summarizeReviewIssuesFromManifest as summarizeReviewIssuesFromManifestImpl,
} from "./workflow-guard-prompt-support";
import {
  buildFocusedPromptAssemblyImpl,
  formatWorkflowSnapshotForPromptImpl,
  shouldUseFocusedWorkflowPromptImpl,
} from "./workflow-guard-prompt-assembly";
import {
  loadWorkflowPromptConfig,
  readWorkflowPromptConfigPath,
  type WorkflowPromptConfig,
} from "./workflow-prompt-config";

// Facade-decomposition families:
// - workflow-guard-project/* owns project resolution, gate state, and snapshot assembly
// - workflow-guard-policies/* owns role policy, tool guards, and handoff normalization
// - workflow-guard-writing/* owns quality/readiness evaluation helpers
// - workflow-guard-setters/* owns manifest/runtime state mutation helpers
import {
  buildIdleResearchTemplateForBootstrap as buildIdleResearchTemplateForBootstrapFromModule,
  defaultResearchProgramZoteroProjectPath as defaultResearchProgramZoteroProjectPathFromModule,
  ensureWorkflowProjectRoot as ensureWorkflowProjectRootFromModule,
  getWorkflowProjectRoot as getProjectRootFromModule,
  inferWorkflowProjectId as inferProjectIdFromModule,
  loadWorkflowProjectState as loadProjectStateFromModule,
} from "./workflow-guard-project/project-context";
import {
  computeWorkflowGateConfirmationDeadline as computeGateConfirmationDeadlineFromModule,
  getWorkflowGateStatePath as getGateStatePathFromModule,
  getWorkflowGateStateSummary as getGateStateSummaryFromModule,
  hasWorkflowTimedDefaultGateExpired as hasTimedDefaultGateExpiredFromModule,
  normalizeWorkflowGateState as normalizeGateStateFromModule,
  readWorkflowGateState as readGateStateFromModule,
  saveWorkflowGateState as saveGateStateFromModule,
  serializeWorkflowGateState as serializeGateStateFromModule,
  setWorkflowGateStateForWorkflow as setGateStateForWorkflowFromModule,
} from "./workflow-guard-project/gate-state";
import {
  buildGraphImportRepairGuidance,
  buildWorkflowSnapshotFromProjectState,
  summarizeGraphPresenceMissing,
} from "./workflow-guard-project/snapshot-builder";
import {
  formatWorkflowProjectDirEntry as formatProjectDirEntryFromModule,
  getWorkflowProjectsStatePath as getProjectsStatePathFromModule,
  readWorkflowProjectsStateRaw as readProjectsStateRawFromModule,
  syncWorkflowProjectsStateEntry as syncProjectsStateEntryFromModule,
  workflowDateOnly as dateOnlyFromModule,
} from "./workflow-guard-project/projects-state";
import {
  canRoleContact as canRoleContactFromModule,
  canRoleContactInWorkflow as canRoleContactInWorkflowFromModule,
  canRoleSpawn as canRoleSpawnFromModule,
  canRoleSpawnInWorkflow as canRoleSpawnInWorkflowFromModule,
  canRoleUseForwardStageHandoff as canRoleUseForwardStageHandoffFromModule,
  getForwardStageHandoffTargetRole as getForwardStageHandoffTargetRoleFromModule,
  inferTargetRoleFromToolParams as inferTargetRoleFromToolParamsFromModule,
  normalizeWorkflowRole as normalizeWorkflowRoleFromModule,
  ROLE_POLICIES as WORKFLOW_ROLE_POLICIES,
  STAGE_REQUIREMENTS as WORKFLOW_STAGE_REQUIREMENTS,
} from "./workflow-guard-policies/role-policy";
import {
  hasAgentMention as hasAgentMentionFromModule,
  isWorkflowChannelHandoffMessage as isWorkflowChannelHandoffMessageFromModule,
  normalizeWorkflowChannelMentions as normalizeWorkflowChannelMentionsFromModule,
  sanitizeAgentMentions as sanitizeAgentMentionsFromModule,
  sanitizeMessageToolParams as sanitizeMessageToolParamsFromModule,
} from "./workflow-guard-policies/handoff-rules";
import {
  shouldBlockCoderDatasetMutation as shouldBlockCoderDatasetMutationFromModule,
  shouldBlockInnovationWrite as shouldBlockInnovationWriteFromModule,
  shouldBlockPapernexusDestructiveOperation as shouldBlockPapernexusDestructiveOperationFromModule,
  shouldBlockPapernexusInlineExecution as shouldBlockPapernexusInlineExecutionFromModule,
  shouldBlockPapernexusLiveGraphCliRead as shouldBlockPapernexusLiveGraphCliReadFromModule,
  shouldBlockPapernexusLocalGraphProcessing as shouldBlockPapernexusLocalGraphProcessingFromModule,
  shouldBlockPapernexusLocalStorageUsage as shouldBlockPapernexusLocalStorageUsageFromModule,
  shouldBlockPapernexusLongWaitImportCommand as shouldBlockPapernexusLongWaitImportCommandFromModule,
  shouldBlockPapernexusMultiPaperImport as shouldBlockPapernexusMultiPaperImportFromModule,
  shouldBlockPapernexusRawHttpUsage as shouldBlockPapernexusRawHttpUsageFromModule,
  shouldBlockProjectWrite as shouldBlockProjectWriteFromModule,
  shouldBlockResearchGraphForce as shouldBlockResearchGraphForceFromModule,
  shouldBlockWriterTemplateWrite as shouldBlockWriterTemplateWriteFromModule,
} from "./workflow-guard-policies/tool-guards";
import {
  getCitationCollectionStateSummary as getCitationCollectionStateSummaryFromModule,
  getCitationIntegrityStateSummary as getCitationIntegrityStateSummaryFromModule,
  getTheoryStateSummary as getTheoryStateSummaryFromModule,
} from "./workflow-guard-writing/citation-theory-eval";
import {
  getFigureQcStateSummary as getFigureQcStateSummaryFromModule,
  getPaperQcStateSummary as getPaperQcStateSummaryFromModule,
  getReviewIssueTrackerStateSummary as getReviewIssueTrackerStateSummaryFromModule,
} from "./workflow-guard-writing/paper-quality-eval";
import {
  setBrainstormCycleState as setBrainstormCycleStateFromModule,
  setExperimentReviewState as setExperimentReviewStateFromModule,
  setIdeationContractState as setIdeationContractStateFromModule,
  setIdleResearchState as setIdleResearchStateFromModule,
  setOrchestrationState as setOrchestrationStateFromModule,
  setPaperStoryState as setPaperStoryStateFromModule,
  setResearchProgramState as setResearchProgramStateFromModule,
  setReviewPressurePacketState as setReviewPressurePacketStateFromModule,
  setSurveyReviewState as setSurveyReviewStateFromModule,
  setWritePackageState as setWritePackageStateFromModule,
} from "./workflow-guard-setters/research-state-setters";
import {
  setCitationCollectionState as setCitationCollectionStateFromModule,
  setExperimentSearchState as setExperimentSearchStateFromModule,
  setFigureQcState as setFigureQcStateFromModule,
  setPaperIngestionState as setPaperIngestionStateFromModule,
  setPaperQcState as setPaperQcStateFromModule,
} from "./workflow-guard-setters/ingestion-state-setters";
import { setReviewIssueTrackerState as setReviewIssueTrackerStateFromModule } from "./workflow-guard-setters/review-state-setters";
import {
  setExternalReviewState as setExternalReviewStateFromModule,
  setGraphGuidedWritingState as setGraphGuidedWritingStateFromModule,
  setReviewSessionState as setReviewSessionStateFromModule,
  setWritingContractState as setWritingContractStateFromModule,
  setWritingSessionState as setWritingSessionStateFromModule,
} from "./workflow-guard-setters/writing-state-setters";
import {
  buildExperimentReviewCommand,
  buildExperimentReviewSummary,
  deriveExperimentReviewMicroStage,
  getExperimentReviewStatePath,
  isReviewedAutoExperimentLaunchEnabled,
  loadExperimentReviewState,
  resolveExperimentReviewNextOwner,
  saveExperimentReviewStateFile,
} from "./workflow-auto-experiment-review";
import {
  getExperimentMemorySummaryImpl,
  recordCitationVerificationImpl,
  recordIdleResearchRunImpl,
  recordInnovationReflectionImpl,
  upsertExperimentLedgerEntryImpl,
} from "./workflow-guard-recorders/state-recorders";
import { runWorkflowAutoIteratorImpl } from "./workflow-guard-runtime/auto-iterator";
import { evaluateExperimentSearchDecision } from "./workflow-experiment-decision";

export { checkGraphPresenceForWorkflow, type GraphPresenceCheckResult } from "./graph-presence";
export {
  certifyPapernexusTaskForProject,
  getPapernexusTaskCertificationPath,
  type PapernexusTaskCertification,
} from "./papernexus-task-certification";

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
  zoteroProjectRoot?: string;
  papernexusApiBaseUrl?: string;
  papernexusSharedCorpus?: string;
  papernexusMcpUrl?: string;
  papernexusMcpTransport?: string;
  papernexusMcpTimeoutMs?: number;
  papernexusAllowLocalMcp?: boolean;
  papernexusApiTokenEnv?: string;
  papernexusApiTokenSource?: string;
  papernexusApiTokenService?: string;
  papernexusApiTokenAccount?: string;
  papernexusApiTokenLookupTimeoutMs?: number;
  papernexusMineruHttpUrl?: string;
  papernexusAccessMode?: string;
  papernexusSshTarget?: string;
  papernexusRemoteStagingRoot?: string;
  autoMode?: WorkflowAutoMode;
  autoGate?: WorkflowAutoGateConfig;
  lobsterHandoff?: WorkflowLobsterHandoffConfig;
  teamRuntime?: WorkflowTeamRuntimeConfig;
  promptConfigPath?: string;
}

export type WorkflowTeamRuntimeConfig = {
  enabled: boolean;
};

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
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

type ManifestLike = Record<string, unknown>;
type TrackRegistryLike = Record<string, unknown>;

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
  autoIteratorAudit: Record<string, unknown> | null;
  runtimeQueue: WorkflowRuntimeQueueStore | null;
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
  executionRunId: string | null;
  executionStageRunId: string | null;
  executionCandidateCommit: string | null;
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

type IdeationTop3Snapshot = {
  refreshedAt: string | null;
  selectedDirectionId: string | null;
  selectedTrackId: string | null;
  topDirectionTitles: string[];
  top3SummaryPath: string | null;
  rankingHistoryPath: string | null;
  researchProposalPath: string | null;
};

type InnovationReflectionState = {
  requiredAfterExperiments: boolean;
  status: string;
  lastReflectionAt: string | null;
  lastReflectionPath: string | null;
  reflectedThroughExperimentUpdateAt: string | null;
  reflectedExperimentIds: string[];
  pendingReason: string | null;
  latestIdeationTop3: IdeationTop3Snapshot | null;
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
  provider: string | null;
  providerMode: string | null;
  providerStatus: string | null;
  providerLastRunAt: string | null;
  providerLastError: string | null;
  contractVersion: number | null;
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

export type WritingMode = "conference" | "journal" | "survey";

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
  proofObligationLedgerPath: string | null;
  proofObligationStatus: string;
  blockingProofIssueCount: number;
  counterexampleRedTeamStatus: string;
  counterexampleRedTeamReportPath: string | null;
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
  theorem_issue_taxonomy: string[];
  proof_obligations: TheoryProofObligation[];
  proof_obligation_ledger_path: string | null;
  counterexample_red_team: TheoryCounterexampleRedTeamState;
  pending_reason: string | null;
  updated_at: string | null;
};

type TheoryProofObligation = {
  obligation_id: string;
  packet_id: string | null;
  issue_type: string;
  severity: string;
  status: string;
  finding: string | null;
  repair_owner_role: string | null;
  repair_hint: string | null;
  source_claim_ids: string[];
  updated_at: string | null;
};

type TheoryCounterexampleRedTeamAttempt = {
  attempt_id: string;
  packet_id: string | null;
  issue_type: string;
  status: string;
  candidate: string | null;
  expected_failure_mode: string | null;
  result: string | null;
  repaired_by: string | null;
  updated_at: string | null;
};

type TheoryCounterexampleRedTeamState = {
  status: string;
  attempts: TheoryCounterexampleRedTeamAttempt[];
  blocking_findings: TheoryProofObligation[];
  report_path: string | null;
  last_updated_at: string | null;
  pending_reason: string | null;
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

export type WritingContractState = {
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
  scientificEditingRequired: boolean;
  scientificEditingStatus: string;
  scientificEditingPasses: string[];
  scientificEditingLedgerPath: string | null;
  scientificEditingReportPath: string | null;
  lastScientificEditingAt: string | null;
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
  bibliographyEntryCount: number;
  bibliographyPageCount: number;
  minimumCitationCount: number;
  allCitationsReal: boolean;
  allowedPlaceholderCount: number;
  unresolvedPlaceholderCount: number;
  verifiedCitationCount: number;
  suspiciousCitationCount: number;
  hallucinatedCitationCount: number;
  topicRelevanceTopic: string | null;
  topicRelevanceStatus: string;
  referenceCoveragePolicy: string;
  minimumRelevantCitationCount: number;
  minimumCitationRelevanceScore: number | null;
  maxCitationCount: number | null;
  relevantCitationCount: number;
  peripheralCitationCount: number;
  unrelatedCitationCount: number;
  offTopicCitationCount: number;
  topicRelevanceSummary: string | null;
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
  processStatus: string;
  outlineReady: boolean;
  currentSection: string | null;
  draftOrder: string[];
  draftedSections: string[];
  reviewedSections: string[];
  finalizedSections: string[];
  manuscriptComplete: boolean;
  compileSafeSections: string[];
  compileReady: boolean;
  sectionPackets: Record<string, WritingSectionPacketState>;
  nextSuggestedSection: string | null;
  rebuildNeeded: boolean;
  rebuildReason: string | null;
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

type ExperimentNextCandidateGuidance = {
  authority: string | null;
  triggerDecision: string | null;
  sourceValidationStage: string | null;
  target: string | null;
  primaryMetricName: string | null;
  primaryMetricDirection: string | null;
  primaryMetricMinimumImprovement: number | null;
  paperContributionMetric: string | null;
  requiredProperties: string[];
  avoidExperimentIds: string[];
  avoidOneChangeSignatures: string[];
  avoidFailureClusterIds: string[];
  blockerBasis: string[];
  innovationAnchorPoints: string[];
  recommendedFocus: string[];
};

type ExperimentSearchState = {
  status: string;
  projectId: string | null;
  trackId: string | null;
  currentMainStage: string | null;
  currentSubstage: string | null;
  validationStage: string | null;
  innerLoopMode: string | null;
  trialTimeBudgetMinutes: number | null;
  strictComparableBudget: boolean;
  requireOneChangeSignature: boolean;
  oneChangeSignature: string | null;
  oneChangeValidationStatus: string;
  keepDiscardRule: string | null;
  lastTrialOutcome: string | null;
  comparableTrialBudgetStatus: string;
  searchSessionId: string | null;
  searchSpecPath: string | null;
  searchStatePath: string | null;
  baselineExperimentId: string | null;
  frontierNodeIds: string[];
  frontierExperimentIds: string[];
  bestNodeId: string | null;
  incumbentExperimentId: string | null;
  incumbentBranch: string | null;
  incumbentCommit: string | null;
  completedNodeIds: string[];
  completedExperimentIds: string[];
  failedNodeIds: string[];
  failedExperimentIds: string[];
  discardedExperimentIds: string[];
  triedHyperparams: string[];
  completedAblations: string[];
  lastCandidateExperimentId: string | null;
  lastCandidateBranch: string | null;
  lastCandidateCommit: string | null;
  requestedGitOp: string | null;
  gitOpStatus: string | null;
  gitReviewStorePath: string | null;
  gitReviewPacketPath: string | null;
  candidateWorktreePath: string | null;
  candidateBaseCommit: string | null;
  candidateHeadCommit: string | null;
  lastGitOpResult: string | null;
  lastDecision: string | null;
  multiSeedStatus: string;
  baselineFairnessStatus: string;
  implementationConfidence: string;
  searchExhaustionStatus: string;
  ablationStatus: string;
  innovationStatus: string;
  decisionConfidence: string;
  recommendedNextAction: string | null;
  failureClusterIds: string[];
  nextCandidateGuidance: ExperimentNextCandidateGuidance | null;
  evidenceCleanlinessStatus: string;
  baselineDatasetEnvelope: string[];
  validatedDatasetEnvelope: string[];
  baselineDatasetCoverageStatus: string;
  baselineDatasetCoverageMissing: string[];
  baselineDatasetCoverageSummary: string | null;
  innovationAnchorPoints: string[];
  innovationDeviationStatus: string;
  innovationDeviationScore: number | null;
  innovationDeviationSummary: string | null;
  evaluationSummaryPath: string | null;
  plotPackStatus: string;
  plotPackPath: string | null;
  stageProgressPath: string | null;
  checkpointPath: string | null;
  graphMemoryPacketPath: string | null;
  graphMemorySyncStatus: string;
  lastGraphMemoryRefreshAt: string | null;
  createdAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

async function loadExperimentPrimaryMetricContractRecord(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  searchState: ExperimentSearchState;
  fallbackMetricName?: string | null;
}): Promise<Record<string, unknown>> {
  const manifestSearch = asRecord(params.manifest.experiment_search) ?? {};
  const configuredPath =
    params.searchState.searchSpecPath ??
    pickString(manifestSearch, ["searchSpecPath", "search_spec_path"]) ??
    DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH;
  const specPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(params.projectRoot, configuredPath);
  const rawSpec =
    (await readJsonIfExists<Record<string, unknown>>(specPath)) ?? {};
  const contract = resolveExperimentPrimaryMetricContract({
    spec: normalizeExperimentSearchSpec(rawSpec),
    manifestRecord: params.manifest,
    fallbackMetricName: params.fallbackMetricName ?? null,
  });
  return serializeExperimentPrimaryMetricContract(contract);
}

type AutonomousExecutionState = {
  experimentLaunchMode: "manual" | "reviewed_auto";
  maxExperimentReviewRounds: number;
  requireAnalyzerReview: boolean;
  requireCrossReview: boolean;
};

type ExperimentReviewState = {
  status: string;
  launchMode: "manual" | "reviewed_auto";
  microStage: string | null;
  reviewRound: number;
  stateFilePath: string | null;
  packetPath: string | null;
  plannerPlanPath: string | null;
  analyzerReportPath: string | null;
  crossReviewerReportPath: string | null;
  launchDecisionPath: string | null;
  packetFingerprint: string | null;
  targetTrackIds: string[];
  claimIds: string[];
  graphPacketPaths: string[];
  plannerStatus: string;
  analyzerStatus: string;
  crossReviewerStatus: string;
  synthesisStatus: string;
  analyzerVerdict: string | null;
  crossReviewerVerdict: string | null;
  launchApproved: boolean;
  blockerCount: number;
  blockers: string[];
  pendingReason: string | null;
  lastLaunchApprovedAt: string | null;
  lastUpdatedAt: string | null;
};

export type ResearchProgramTrackBudget = {
  gpuHours: number | null;
  maxRuns: number | null;
  maxDebugIterations: number | null;
};

export type ResearchProgramTrackWriteScope = {
  allowedClaimIds: string[];
  allowedFigureIds: string[];
};

export type ResearchProgramPlanAlternative = {
  optionId: string;
  linkedTrackId: string | null;
  sourceDirectionId: string | null;
  title: string | null;
  status: string;
  summary: string | null;
  graphEvidencePaths: string[];
  keyRisks: string[];
};

export type ResearchProgramPlanSelection = {
  selectedOptionId: string | null;
  selectedTrackId: string | null;
  comparedOptionIds: string[];
  rationale: string | null;
  decisiveGraphEvidencePaths: string[];
  fallbackOptionIds: string[];
  lastComparedAt: string | null;
};

export type ResearchProgramTrack = {
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

export type ResearchProgramTask = {
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

export type ResearchProgramGlobalConstraints = {
  maxActiveTracks: number | null;
  mustRunMultiSeedBeforeAnalysis: boolean;
  mustRunPlotAggregationBeforeWrite: boolean;
};

export type ResearchProgramState = {
  programVersion: number;
  status: string;
  goal: string | null;
  problemStatement: string | null;
  baselineReference: string | null;
  primaryMetric: string | null;
  datasets: string[];
  constraints: string[];
  successCriteria: string[];
  zoteroProjectPath: string | null;
  tracks: ResearchProgramTrack[];
  planAlternatives: ResearchProgramPlanAlternative[];
  planSelection: ResearchProgramPlanSelection;
  globalConstraints: ResearchProgramGlobalConstraints;
  taskGraph: ResearchProgramTask[];
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

export type IdeationGraphBasisPaths = {
  papernexusStatusPath: string | null;
  frontierReportPath: string | null;
  anchorIndexPath: string | null;
  limitationFrontierPath: string | null;
  contradictionFrontierPath: string | null;
  transferFrontierPath: string | null;
  compositionFrontierPath: string | null;
  topicSummaryPath: string | null;
  logicChainPath: string | null;
  evidenceChainPath: string | null;
  storylineBriefPath: string | null;
};

export type IdeationGraphIndicesState = {
  status: string;
  noveltyCandidateClusters: string[];
  challengeClusters: string[];
  insightClusters: string[];
  occupiedSolutionZones: string[];
  transferBridges: string[];
  candidateSourceDomains: string[];
  selectedSourceDomains: string[];
  prunedSourceDomains: string[];
  bridgeEvidenceTier: string | null;
  lastRefreshAt: string | null;
};

export type IdeationContractState = {
  status: string;
  contractVersion: number;
  longTermGoal: string | null;
  problemScope: string | null;
  basisStage: string | null;
  graphBasisPaths: IdeationGraphBasisPaths;
  graphIdeationIndices: IdeationGraphIndicesState;
  ideaTreePath: string | null;
  noveltyTreePath: string | null;
  challengeInsightTreePath: string | null;
  solutionCheckPath: string | null;
  crossDomainTransferPath: string | null;
  problemDecompositionPath: string | null;
  candidatePoolPath: string | null;
  rankingHistoryPath: string | null;
  tournamentScoreboardPath: string | null;
  top3SummaryPath: string | null;
  researchProposalPath: string | null;
  graphIdeationPacketPath: string | null;
  selectedDirectionId: string | null;
  selectedTrackId: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export type PaperStoryState = {
  status: string;
  contractVersion: number;
  taskSummaryPath: string | null;
  challengeStatementPath: string | null;
  insightSummaryPath: string | null;
  contributionMapPath: string | null;
  advantageMapPath: string | null;
  storySpinePath: string | null;
  pipelineFigureSketchPath: string | null;
  moduleMotivationMapPath: string | null;
  claimToExperimentMapPath: string | null;
  ideaToClaimMapPath: string | null;
  fallbackNarrativePath: string | null;
  rejectionRiskTablePath: string | null;
  writingReferenceBundlePath: string | null;
  fallbackActivationPath: string | null;
  revisionCyclePath: string | null;
  prewriteRejectionSimulationPath: string | null;
  contributionToStoryBridgePath: string | null;
  figureAnchorPlanPath: string | null;
  surveyStorylinePacketPath: string | null;
  surveyStorylineMemoPath: string | null;
  claimEvidenceMatrixPath: string | null;
  trackVerdictsPath: string | null;
  unsupportedClaimsPath: string | null;
  claimSupportStatus: string;
  supportedClaimCount: number;
  partialClaimCount: number;
  unsupportedClaimCount: number;
  storylineSourceTrackId: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export type ReviewPressurePacketState = {
  status: string;
  rejectFirstReviewPath: string | null;
  noveltyAttackPath: string | null;
  unsupportedClaimAuditPath: string | null;
  reverseOutlinePath: string | null;
  figureTableQcPath: string | null;
  limitationAuditPath: string | null;
  statusReason: string | null;
  lastUpdatedAt: string | null;
};

export type SurveyReviewState = ReturnType<typeof normalizeSurveyReviewState>;
export type InnovationSynthesisState = ReturnType<
  typeof normalizeInnovationSynthesisState
>;
export type StoryGapSearchRequisitionState = ReturnType<
  typeof normalizeStoryGapSearchRequisitionState
>;
export type ResultsStorylineState = ReturnType<
  typeof normalizeResultsStorylineState
>;
export type StorylinePlannerState = ReturnType<
  typeof normalizeStorylinePlannerState
>;
export type TitleAbstractIntroWorkbenchState = ReturnType<
  typeof normalizeTitleAbstractIntroWorkbenchState
>;

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

export type PaperIngestionState = {
  runtimeStatus: string;
  waitingReason: string | null;
  importTaskIds: string[];
  lastImportTaskId: string | null;
  lastImportStatus: string | null;
  completedPapers: PaperIngestionCompletedPaper[];
  paperOperations: PaperIngestionPaperOperation[];
  activeBatches: PaperIngestionBatchRun[];
  batchItems: PaperIngestionBatchItem[];
  queuedRequests: PaperIngestionQueuedRequest[];
  failedPapers: PaperIngestionFailedPaper[];
  retryableFailedPapers: PaperIngestionFailedPaper[];
  nonRetryableFailedPapers: PaperIngestionFailedPaper[];
  lastFailureScanAt: string | null;
  lastRetryManifestPath: string | null;
  retryPolicy: PaperIngestionRetryPolicy | null;
  retryRunId: string | null;
  retryStatus: string | null;
  retryAttemptCount: number;
  sequentialRetryIntervalSeconds: number | null;
  lastBatchManifestPath: string | null;
  graphVersionSeen: string | null;
  reconcileRequired: boolean;
  repairRequired: boolean;
  repairReason: string | null;
  repairTargetCorpus: string | null;
  lastUpdatedAt: string | null;
};

export type PaperIngestionRetryPolicy = {
  mode: "sequential" | "batch";
  intervalSeconds: number;
  maxAttempts: number;
};

export type PaperIngestionFailedPaper = {
  paperId: string | null;
  title: string | null;
  sourceKey: string | null;
  inputPath: string | null;
  failureSignature: string | null;
  failureMessage: string | null;
  failedAt: string | null;
  retryable: boolean;
  retryReason: string | null;
  alreadyInGraph: boolean;
  lastRetryAt: string | null;
  retryCount: number;
};

export type PaperIngestionCompletedPaper = {
  canonicalId: string | null;
  title: string | null;
  importTaskId: string | null;
};

export type PaperIngestionPaperOperation = {
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

export type PaperIngestionBatchRun = {
  manifestPath: string | null;
  status: "queued" | "running" | "completed" | "timed_out" | "failed";
  total: number | null;
  submitted: number | null;
  completed: number | null;
  running: number | null;
  pending: number | null;
  failed: number | null;
  submitFailed: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
};

export type PaperIngestionRemoteTaskProgress = {
  percent: number | null;
  stagePercent: number | null;
  queuePosition: number | null;
  currentStep: string | null;
  processedUnits: number | null;
  totalUnits: number | null;
};

export type PaperIngestionQueueProgress = {
  sequence?: number | null;
  lastEventAt?: string | null;
  total: number | null;
  pending: number | null;
  running: number | null;
  completed: number | null;
  failed: number | null;
  remaining: number | null;
  overallPercent: number | null;
};

export type PaperIngestionBatchItem = {
  manifestPath: string | null;
  paperId: string | null;
  canonicalId: string | null;
  title: string | null;
  importTaskId: string | null;
  status: "pending" | "running" | "completed" | "failed" | "submit_failed" | null;
  stage: string | null;
  submitted: boolean;
  synced: boolean;
  matchedBy: string | null;
  error: string | null;
  updatedAt: string | null;
};

export type PaperIngestionQueuedRequestKind =
  | "upload_manifest"
  | "direct_source"
  | "requisition";

export type PaperIngestionQueuedRequest = {
  requestId: string;
  requestKind: PaperIngestionQueuedRequestKind | null;
  status: "queued" | "launching" | "running" | "completed" | "needs_repair" | "failed";
  wrapper: string | null;
  args: string[];
  commandText: string | null;
  manifestPath: string | null;
  sharedCorpus: string | null;
  paperCount: number | null;
  summary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastRunId: string | null;
  lastSessionKey: string | null;
  lastError: string | null;
  detail: string | null;
  triggerKind: string | null;
  progress: PaperIngestionRemoteTaskProgress | null;
  queueProgress: PaperIngestionQueueProgress | null;
  validationStatus: PaperIngestionValidationStatus;
  validationSummary: string | null;
  validationReportPath: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  deadLetterAt: string | null;
  deadLetterReason: string | null;
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
  scoreRecords: ReviewScoreRecord[];
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
  channelProjectBindingWorkflowRole: string | null;
  channelProjectBindingWorkflowSessionKey: string | null;
  channelProjectBindingWorkflowSessionId: string | null;
  channelProjectBindingParentSessionKey: string | null;
  channelProjectBindingThreadBindingKey: string | null;
  channelProjectBindingDepth: number | null;
  channelProjectBindingLineageKey: string | null;
  channelProjectBindingMode: "explicit_thread" | "derived_thread" | "channel_only";
  role: WorkflowRole | null;
  currentStage: string | null;
  currentMicroStage: string | null;
  ownerAgent: string | null;
  recommendedOwner: WorkflowRole | null;
  nextAction: string | null;
  resumeAction: string | null;
  blockingReason: string | null;
  workflowControlSchemaVersion: number | null;
  workflowControlContractId: string | null;
  workflowControlReconciledAt: string | null;
  workflowControlStatus: string | null;
  workflowControlCompletionStatus: string | null;
  workflowControlCompletionSource: string | null;
  workflowControlCompletionReason: string | null;
  workflowControlRuntimeState: string | null;
  workflowControlQueueKey: string | null;
  workflowControlSessionKey: string | null;
  stateRevision: string | null;
  stateUpdatedAt: string | null;
  autoIteratorAuditStatus: string | null;
  autoIteratorAuditFreshness: "missing" | "fresh" | "stale" | "unknown";
  autoIteratorAuditUpdatedAt: string | null;
  autoIteratorAuditRunId: string | null;
  autoIteratorAuditStageBefore: string | null;
  autoIteratorAuditStageAfter: string | null;
  autoIteratorAuditMatchesLiveState: boolean | null;
  autoIteratorAuditSummary: string | null;
  workflowEvidenceStatus: "ready" | "repairable" | "missing";
  workflowEvidenceSummary: string | null;
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
  paperIngestionCompletedPaperCount: number | null;
  paperIngestionActiveOperationCount: number | null;
  paperIngestionTimedOutOperationCount: number | null;
  paperIngestionFailedOperationCount: number | null;
  paperIngestionBatchCount: number | null;
  paperIngestionActiveBatchCount: number | null;
  paperIngestionPendingBatchItemCount: number | null;
  paperIngestionSyncedBatchItemCount: number | null;
  paperIngestionFailedBatchItemCount: number | null;
  paperIngestionQueuedRequestCount: number | null;
  paperIngestionRunningRequestCount: number | null;
  paperIngestionLastBatchManifestPath: string | null;
  paperIngestionLastImportStatus: string | null;
  paperIngestionGraphVersionSeen: string | null;
  paperIngestionReconcileRequired: boolean;
  paperIngestionRepairRequired: boolean;
  paperIngestionRepairReason: string | null;
  paperIngestionRepairTargetCorpus: string | null;
  papernexusProgress: PapernexusProgressSnapshot | null;
  papernexusProgressSummary: string | null;
  paperSourceDir: string | null;
  graphSourceDir: string | null;
  defaultPapernexusSourceDir: string | null;
  defaultPapernexusIndexRoot: string | null;
  papernexusApiBaseUrl: string | null;
  papernexusMcpUrl: string | null;
  papernexusMcpTransport: string | null;
  papernexusMcpTimeoutMs: number | null;
  papernexusApiTokenEnv: string | null;
  papernexusApiTokenSource: string | null;
  papernexusApiTokenService: string | null;
  papernexusApiTokenAccount: string | null;
  papernexusMineruHttpUrl: string | null;
  papernexusAccessMode: string | null;
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
  experimentActiveRunCount: number | null;
  experimentTerminalRunCount: number | null;
  experimentFinishedUnreconciledCount: number | null;
  experimentNeedsMonitorPass: boolean;
  experimentMonitorRecommendedCommand: string | null;
  backgroundQueueEntryCount: number | null;
  backgroundQueueDegradedCount: number | null;
  backgroundQueueTopKind: string | null;
  backgroundQueueTopStatus: string | null;
  backgroundQueueTopSummary: string | null;
  backgroundQueueTopError: string | null;
  experimentGpuMonitorStatus: string | null;
  experimentGpuMonitorCheckedAt: string | null;
  experimentGpuMonitorServerCount: number | null;
  experimentGpuMonitorBusyAssignedGpuCount: number | null;
  experimentGpuMonitorIdleAssignedGpuCount: number | null;
  experimentGpuMonitorLikelyFinishedRunCount: number | null;
  experimentGpuMonitorRecommendation: string | null;
  experimentGpuMonitorPath: string | null;
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
  brainstormCycleProvider: string | null;
  brainstormCycleProviderMode: string | null;
  brainstormCycleProviderStatus: string | null;
  brainstormCycleContractVersion: number | null;
  brainstormCycleGraphVersionSeen: string | null;
  brainstormCycleImportTaskCount: number | null;
  brainstormCycleChainBundleReady: boolean;
  brainstormCyclePendingReason: string | null;
  surveyReviewStatus: string | null;
  surveyReviewCurrentPhase: string | null;
  surveyReviewTopic: string | null;
  surveyReviewMode: string | null;
  surveyReviewCandidatePaperCount: number | null;
  surveyReviewIncludedPaperCount: number | null;
  surveyReviewExcludedPaperCount: number | null;
  surveyReviewQueryRoundCount: number | null;
  surveyReviewGraphGroundedBriefReady: boolean;
  surveyReviewDiagnosticsPath: string | null;
  surveyReviewGateReady: boolean;
  surveyReviewCoverageStatus: string | null;
  surveyReviewTaxonomyStabilityStatus: string | null;
  surveyReviewRepresentativeMethodsStatus: string | null;
  surveyReviewBenchmarkAlignmentStatus: string | null;
  surveyReviewTopicRelevanceStatus: string | null;
  surveyReviewGapClosureStatus: string | null;
  surveyReviewSurveyBriefPath: string | null;
  surveyReviewGateBlockingIssueCount: number | null;
  surveyReviewPendingReason: string | null;
  surveyBriefRefinementStatus: string | null;
  surveyBriefRefinementReviewCount: number | null;
  surveyBriefRefinementRoundId: string | null;
  surveyBriefRefinementPacketPath: string | null;
  surveyBriefRefinementSummary: string | null;
  ideationContractStatus: string | null;
  ideationContractSelectedDirectionId: string | null;
  ideationContractSelectedTrackId: string | null;
  ideationContractIdeaTreePath: string | null;
  ideationContractResearchProposalPath: string | null;
  ideationContractRankingHistoryPath: string | null;
  ideationContractTournamentScoreboardPath: string | null;
  ideationContractTop3SummaryPath: string | null;
  ideationContractGraphPacketPath: string | null;
  ideationContractBridgeEvidenceTier: string | null;
  ideationContractCandidateSourceDomainCount: number | null;
  ideationContractSelectedSourceDomainCount: number | null;
  ideationContractPendingReason: string | null;
  ideaCatalystStatus: string | null;
  ideaCatalystMode: string | null;
  ideaCatalystMicroStage: string | null;
  ideaCatalystTargetDomain: string | null;
  ideaCatalystSourceDomainCount: number | null;
  ideaCatalystBridgeCount: number | null;
  ideaCatalystTopFragmentId: string | null;
  ideaCatalystRequisitionRequired: boolean;
  ideaCatalystLastRequisitionCycle: string | null;
  ideaCatalystRequisitionRetryBudget: number | null;
  ideaCatalystRequisitionSaturated: boolean;
  ideaCatalystPendingReason: string | null;
  researchProgramStatus: string | null;
  researchProgramTrackCount: number | null;
  researchProgramActiveTrackCount: number | null;
  researchProgramPlanAlternativeCount: number | null;
  researchProgramPlanComparedOptionCount: number | null;
  researchProgramPlanSelectedOptionId: string | null;
  researchProgramPlanSelectedTrackId: string | null;
  researchProgramPlanSelectionReady: boolean;
  researchProgramPrimaryGoal: string | null;
  researchProgramOnboardingStatus: string | null;
  researchProgramOnboardingMissing: string[];
  researchProgramBaselineReference: string | null;
  researchProgramPrimaryMetricName: string | null;
  researchProgramDatasetCount: number | null;
  researchProgramSuccessCriteriaCount: number | null;
  researchProgramZoteroProjectPath: string | null;
  bootstrapRequestSourceCommand: string | null;
  bootstrapRequestCleanTopic: string | null;
  bootstrapRequestRawRequest: string | null;
  bootstrapRequestReferenceHints: string[];
  bootstrapRequestExplicitRequirements: string[];
  benchmarkProtocolStatus: string | null;
  benchmarkProtocolFamily: string | null;
  benchmarkProtocolLocked: boolean;
  benchmarkProtocolDriftStatus: string | null;
  benchmarkProtocolPrimaryMetric: string | null;
  benchmarkProtocolSplitDescriptor: string | null;
  benchmarkProtocolEvaluationHarness: string | null;
  benchmarkProtocolFairCompareStatus: string | null;
  benchmarkProtocolFairCompareSummary: string | null;
  benchmarkProtocolAllowedDeviationCount: number | null;
  benchmarkProtocolAllowedDeviationStatus: string | null;
  benchmarkProtocolFairnessReportPath: string | null;
  benchmarkProtocolPath: string | null;
  benchmarkProtocolPendingReason: string | null;
  statisticalEvidenceStatus: string | null;
  statisticalEvidenceAggregatePath: string | null;
  statisticalEvidenceClaimStrengthStatus: string | null;
  statisticalEvidenceSignificantResultCount: number | null;
  statisticalEvidenceInsufficientSeedCount: number | null;
  statisticalEvidencePendingReason: string | null;
  venueCompetitionStatus: string | null;
  venueCompetitionTargetVenues: string[];
  venueCompetitionCompetitorSlatePath: string | null;
  venueCompetitionAcceptanceRiskStatus: string | null;
  venueCompetitionGraphContextStatus: string | null;
  venueCompetitionPendingReason: string | null;
  ablationEvidenceStatus: string | null;
  ablationEvidenceSummaryPath: string | null;
  ablationEvidenceSufficiencyStatus: string | null;
  ablationEvidencePublicationCriticalCount: number | null;
  ablationEvidencePendingReason: string | null;
  mechanismEvidenceStatus: string | null;
  mechanismEvidencePacketPath: string | null;
  mechanismEvidenceTier: string | null;
  mechanismEvidenceGraphContextStatus: string | null;
  mechanismEvidencePendingReason: string | null;
  reproducibilityPackStatus: string | null;
  reproducibilityPackBundlePath: string | null;
  reproducibilityPackEnvironmentCaptureStatus: string | null;
  reproducibilityPackRegenerateTablesStatus: string | null;
  reproducibilityPackPendingReason: string | null;
  cameraReadyEvidenceStatus: string | null;
  cameraReadyEvidencePackagePath: string | null;
  cameraReadyEvidenceFiguresStatus: string | null;
  cameraReadyEvidenceTablesStatus: string | null;
  cameraReadyEvidenceCaptionsStatus: string | null;
  cameraReadyEvidencePendingReason: string | null;
  opportunityScorecardStatus: string | null;
  opportunityScorecardVerdict: string | null;
  opportunityScorecardPath: string | null;
  opportunityScorecardGraphContextStatus: string | null;
  opportunityScorecardPendingReason: string | null;
  evidenceCloseoutStatus: "not_applicable" | "blocked" | "ready";
  evidenceCloseoutTopTierVerdict: string | null;
  evidenceCloseoutBlockerCount: number | null;
  evidenceCloseoutGraphDependentBlockerCount: number | null;
  evidenceCloseoutLocalEvidenceBlockerCount: number | null;
  evidenceCloseoutExperimentAnalyzeReady: boolean;
  evidenceCloseoutAnalyzeReviewReady: boolean;
  evidenceCloseoutWriteReady: boolean;
  evidenceCloseoutSubmitReady: boolean;
  evidenceCloseoutTopBlockers: string[];
  teamTaskPreview: Array<{
    taskId: string;
    title: string;
    owner: string | null;
    status: "ready" | "blocked" | "optional";
    reason: string | null;
  }>;
  teamTaskGraphPath: string | null;
  teamTaskGraphTaskCount: number | null;
  teamTaskGraphClaimableCount: number | null;
  teamTaskGraphBlockedCount: number | null;
  teamTaskGraphClaimedCount: number | null;
  teamTaskGraphVerifyingCount: number | null;
  teamTaskGraphNeedsRepairCount: number | null;
  teamTaskGraphSatisfiedCount: number | null;
  teamTaskGraphOptionalCount: number | null;
  teamRoundPath: string | null;
  teamRoundStatus: "not_applicable" | "blocked" | "active" | "ready";
  teamRoundLeadRole: string | null;
  teamRoundActiveSessionCount: number | null;
  teamRoundLastClaimedTaskId: string | null;
  teamRoundLastCompletedTaskId: string | null;
  zoteroSyncStatus: string | null;
  zoteroSyncTrigger: string | null;
  zoteroSyncTriggerReason: string | null;
  zoteroSyncLastRequestedAt: string | null;
  zoteroSyncCollectionFingerprint: string | null;
  zoteroSyncPendingAutoTrigger: string | null;
  zoteroSyncPendingAutoReason: string | null;
  orchestrationStatus: string | null;
  orchestrationBlockingCategory: string | null;
  orchestrationNextTransitionCandidate: string | null;
  orchestrationRetryBudgetRemaining: number | null;
  orchestrationRollbackTargetStage: string | null;
  experimentReviewMode: "manual" | "reviewed_auto";
  experimentReviewStatus: string | null;
  experimentReviewMicroStage: string | null;
  experimentReviewRound: number | null;
  experimentReviewPlannerStatus: string | null;
  experimentReviewAnalyzerStatus: string | null;
  experimentReviewCrossReviewerStatus: string | null;
  experimentReviewSynthesisStatus: string | null;
  experimentReviewLaunchApproved: boolean;
  experimentReviewBlockerCount: number | null;
  experimentReviewPendingReason: string | null;
  experimentReviewPacketPath: string | null;
  experimentReviewPlannerPlanPath: string | null;
  experimentReviewAnalyzerReportPath: string | null;
  experimentReviewCrossReviewerReportPath: string | null;
  experimentReviewLaunchDecisionPath: string | null;
  experimentSearchStatus: string | null;
  experimentSearchCurrentMainStage: string | null;
  experimentSearchCurrentSubstage: string | null;
  experimentSearchValidationStage: string | null;
  experimentSearchInnerLoopMode: string | null;
  experimentSearchTrialTimeBudgetMinutes: number | null;
  experimentSearchOneChangeSignature: string | null;
  experimentSearchOneChangeValidationStatus: string | null;
  experimentSearchComparableTrialBudgetStatus: string | null;
  experimentSearchKeepDiscardRule: string | null;
  experimentSearchLastTrialOutcome: string | null;
  experimentSearchSessionId: string | null;
  experimentSearchSpecPath: string | null;
  experimentSearchStatePath: string | null;
  experimentSearchBestNodeId: string | null;
  experimentSearchIncumbentExperimentId: string | null;
  experimentSearchIncumbentBranch: string | null;
  experimentSearchIncumbentCommit: string | null;
  experimentSearchLastCandidateExperimentId: string | null;
  experimentSearchLastCandidateBranch: string | null;
  experimentSearchLastCandidateCommit: string | null;
  experimentSearchRequestedGitOp: string | null;
  experimentSearchGitOpStatus: string | null;
  experimentSearchGitReviewStorePath: string | null;
  experimentSearchGitReviewPacketPath: string | null;
  experimentSearchCandidateWorktreePath: string | null;
  experimentSearchCandidateBaseCommit: string | null;
  experimentSearchCandidateHeadCommit: string | null;
  experimentSearchLastGitOpResult: string | null;
  experimentSearchPromotionBasisSignals: string[];
  experimentSearchPromotionEvidenceSummary: string | null;
  experimentSearchMultiSeedStatus: string | null;
  experimentSearchBaselineFairnessStatus: string | null;
  experimentSearchImplementationConfidence: string | null;
  experimentSearchSearchExhaustionStatus: string | null;
  experimentSearchAblationStatus: string | null;
  experimentSearchInnovationStatus: string | null;
  experimentSearchDecisionConfidence: string | null;
  experimentSearchRecommendedNextAction: string | null;
  experimentSearchFailureClusterIds: string[];
  experimentSearchNextCandidateMetricName: string | null;
  experimentSearchNextCandidateMetricDirection: string | null;
  experimentSearchNextCandidateMinimumImprovement: number | null;
  experimentSearchNextCandidatePaperContributionMetric: string | null;
  experimentSearchNextCandidateRequiredProperties: string[];
  experimentSearchNextCandidateRecommendedFocus: string[];
  experimentSearchNextCandidateBlockerBasis: string[];
  experimentSearchNextCandidateInnovationAnchors: string[];
  experimentSearchNextCandidateAvoidExperimentIds: string[];
  experimentSearchNextCandidateAvoidOneChangeSignatures: string[];
  experimentSearchNextCandidateAvoidFailureClusterIds: string[];
  experimentSearchEvidenceCleanlinessStatus: string | null;
  experimentSearchBaselineDatasetCoverageStatus: string | null;
  experimentSearchBaselineDatasetCoverageMissing: string[];
  experimentSearchBaselineDatasetCoverageSummary: string | null;
  experimentSearchInnovationDeviationStatus: string | null;
  experimentSearchInnovationDeviationScore: number | null;
  experimentSearchInnovationDeviationSummary: string | null;
  experimentSearchDecision: string | null;
  experimentSearchPlotPackStatus: string | null;
  experimentSearchGraphMemoryPacketPath: string | null;
  experimentSearchGraphMemorySyncStatus: string | null;
  experimentMemoryGraphPacketPath: string | null;
  experimentMemoryGraphSyncStatusPath: string | null;
  experimentMemoryGraphLastMaterializedAt: string | null;
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
  citationBibliographyEntryCount: number | null;
  citationMinimumCount: number | null;
  citationUnresolvedPlaceholderCount: number | null;
  citationAllowedPlaceholderCount: number | null;
  citationVerifiedCount: number | null;
  citationSuspiciousCount: number | null;
  citationHallucinatedCount: number | null;
  citationTopicRelevanceTopic: string | null;
  citationTopicRelevanceStatus: string | null;
  citationRelevantCount: number | null;
  citationOffTopicCount: number | null;
  citationTopicRelevanceSummary: string | null;
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
  writingProcessStatus: string | null;
  writingMissingSections: string[];
  writingStaleSections: string[];
  writingNextSuggestedSection: string | null;
  writingRebuildNeeded: boolean;
  writingRebuildReason: string | null;
  writingCurrentSectionReviewVerdict: string | null;
  writingGraphEvidenceCoverageStatus: string | null;
  writingGraphEvidenceCoverageSummary: string | null;
  paperStoryStatus: string | null;
  paperStoryTrackId: string | null;
  paperStoryStorySpinePath: string | null;
  paperStoryClaimToExperimentMapPath: string | null;
  paperStoryIdeaToClaimMapPath: string | null;
  paperStoryFallbackNarrativePath: string | null;
  paperStoryClaimSupportStatus: string | null;
  paperStorySupportedClaimCount: number | null;
  paperStoryPartialClaimCount: number | null;
  paperStoryUnsupportedClaimCount: number | null;
  paperStoryPendingReason: string | null;
  reviewSessionStatus: string | null;
  reviewSessionStageScope: string | null;
  reviewSessionRound: number | null;
  reviewSessionVerdict: string | null;
  reviewSessionSummary: string | null;
  revisionControlStatus: string | null;
  revisionControlRound: number | null;
  revisionControlCurrentOwner: string | null;
  revisionControlNextReviewerRole: string | null;
  revisionControlOpenSourceCount: number | null;
  revisionControlPacketPath: string | null;
  revisionControlPendingReason: string | null;
  paragraphLogicAuditStatus: string | null;
  paragraphLogicAuditReportPath: string | null;
  paragraphLogicAuditReverseOutlinePath: string | null;
  paragraphLogicAuditBlockingIssueCount: number | null;
  paragraphLogicAuditSectionTransitionIssueCount: number | null;
  paragraphLogicAuditWeakestSections: string[];
  paragraphLogicAuditNextRepairAction: string | null;
  executionProofStatus: string | null;
  executionProofPath: string | null;
  executionProofReceiptCount: number | null;
  executionProofLineageMatchedReceiptCount: number | null;
  executionProofCandidateCommit: string | null;
  executionProofExpectedStageRunId: string | null;
  executionProofPrimaryReceiptExperimentId: string | null;
  executionProofPrimaryReceiptRunId: string | null;
  executionProofPrimaryReceiptStageRunId: string | null;
  executionProofPrimaryReceiptGitCommit: string | null;
  executionProofPrimaryReceiptPath: string | null;
  executionProofPendingReason: string | null;
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
  reviewPressureStatus: string | null;
  reviewPressureRejectFirstReviewPath: string | null;
  reviewPressureUnsupportedClaimAuditPath: string | null;
  reviewPressurePendingReason: string | null;
  externalReviewStatus: string | null;
  externalReviewRecommendation: string | null;
  externalReviewRequiredAction: string | null;
  autoDispatchDiagnosticsStatus: string | null;
  autoDispatchBlockingLayer: string | null;
  autoDispatchBlockingReason: string | null;
  autoDispatchBlockingSummary: string | null;
  autoDispatchNextRepairAction: string | null;
  autoGateReviewToWriteMode: string | null;
  autoGateWriteToSubmitMode: string | null;
  autoGateSubmitToDoneMode: string | null;
  autoGateCurrentStageMode: string | null;
  surveyVisualCompilerStatus: string | null;
  surveyVisualCompilerRowCount: number | null;
  surveyVisualCompilerInsertionMapPath: string | null;
  surveyMethodologyConsistencyStatus: string | null;
  surveyMethodologyConsistencyPath: string | null;
  surveyMethodologyConsistencyBlockingIssueCount: number | null;
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
  kind:
    | "drive_stage"
    | "background"
    | "wait_human"
    | "switch_project"
    | "audit_hook"
    | "revise_hook";
  stage: string | null;
  owner: WorkflowRole | null;
  summary: string;
  command: string | null;
  mailboxQueued: boolean;
  mailboxMessageId: string | null;
  cooldownRemainingSeconds: number | null;
  blocking: boolean;
  dispatchDespiteMissingSignals?: boolean;
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
  ownerActivated: boolean;
  pendingHandoff: boolean;
  pendingHandoffPhase: string | null;
  pendingHandoffExecutionId: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  blockingReason: string | null;
  experimentDecision: string | null;
  experimentDecisionRationale: string | null;
  experimentRollbackStage: string | null;
  graphPresenceCheck: GraphPresenceCheckResult | null;
  projectsStateUpdated: boolean;
  auditPath: string | null;
  materializedArtifacts: WorkflowMaterializedArtifact[];
  hookEvents: WorkflowHookEvent[];
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
  zoteroProjectRoot: "bot",
  papernexusApiBaseUrl: "",
  papernexusSharedCorpus: "",
  papernexusMcpUrl: "",
  papernexusMcpTransport: "streamable-http",
  papernexusMcpTimeoutMs: 30000,
  papernexusAllowLocalMcp: false,
  papernexusApiTokenEnv: "",
  papernexusApiTokenSource: "auto",
  papernexusApiTokenService: "papernexus-api-token",
  papernexusApiTokenAccount: "default",
  papernexusApiTokenLookupTimeoutMs: 2000,
  papernexusMineruHttpUrl: "",
  papernexusSshTarget: "",
  papernexusRemoteStagingRoot: "",
  papernexusAccessMode: "auto",
  autoMode: normalizeWorkflowAutoMode(undefined),
  autoGate: normalizeWorkflowAutoGateConfig(undefined),
  lobsterHandoff: normalizeWorkflowLobsterHandoffConfig(undefined),
  teamRuntime: { enabled: true },
  promptConfigPath: "",
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
const DEFAULT_WRITING_SECTION_PACKET_DIR = "academic_writer/section-packets";
const DEFAULT_REVIEW_PACKET_PATH = "reviewer/REVIEW_PACKET.json";
const DEFAULT_REVIEW_ISSUES_PATH = "reviewer/REVIEW_ISSUES.json";
const DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH = "reviewer/GRAPH_EVIDENCE_SUMMARY.md";
const DEFAULT_RESEARCH_REVIEW_STATE_PATH = "researcher/REVIEW_STATE.json";
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
const DEFAULT_IDEATION_DIR = "researcher/ideation";
const DEFAULT_IDEATION_PACKET_PATH =
  `${DEFAULT_IDEATION_DIR}/GRAPH_IDEATION_PACKET.json`;
const DEFAULT_IDEATION_IDEA_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/IDEA_TREE.md`;
const DEFAULT_IDEATION_NOVELTY_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/NOVELTY_TREE.md`;
const DEFAULT_IDEATION_CHALLENGE_INSIGHT_TREE_PATH =
  `${DEFAULT_IDEATION_DIR}/CHALLENGE_INSIGHT_TREE.md`;
const DEFAULT_IDEATION_SOLUTION_CHECK_PATH =
  `${DEFAULT_IDEATION_DIR}/WELL_ESTABLISHED_SOLUTION_CHECK.md`;
const DEFAULT_IDEATION_CROSS_DOMAIN_TRANSFER_PATH =
  `${DEFAULT_IDEATION_DIR}/CROSS_DOMAIN_TRANSFER.md`;
const DEFAULT_IDEATION_PROBLEM_DECOMPOSITION_PATH =
  `${DEFAULT_IDEATION_DIR}/PROBLEM_DECOMPOSITION.md`;
const DEFAULT_IDEATION_CANDIDATE_POOL_PATH =
  `${DEFAULT_IDEATION_DIR}/CANDIDATE_POOL.json`;
const DEFAULT_IDEATION_RANKING_HISTORY_PATH =
  `${DEFAULT_IDEATION_DIR}/RANKING_HISTORY.json`;
const DEFAULT_IDEATION_TOURNAMENT_SCOREBOARD_PATH =
  `${DEFAULT_IDEATION_DIR}/TOURNAMENT_SCOREBOARD.json`;
const DEFAULT_IDEATION_TOP3_SUMMARY_PATH =
  `${DEFAULT_IDEATION_DIR}/TOP3_DIRECTION_SUMMARY.md`;
const DEFAULT_IDEATION_RESEARCH_PROPOSAL_PATH =
  `${DEFAULT_IDEATION_DIR}/RESEARCH_PROPOSAL.md`;
const DEFAULT_PAPER_STORY_DIR = "academic_writer/story";
const DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/TASK_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CHALLENGE_STATEMENT.md`;
const DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/INSIGHT_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CONTRIBUTION_MAP.md`;
const DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/ADVANTAGE_MAP.md`;
const DEFAULT_PAPER_STORY_SPINE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/STORY_SPINE.md`;
const DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/PIPELINE_FIGURE_SKETCH.md`;
const DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/MODULE_MOTIVATION_MAP.md`;
const DEFAULT_PAPER_STORY_CLAIM_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CLAIM_TO_EXPERIMENT_MAP.md`;
const DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/FALLBACK_NARRATIVE.md`;
const DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/REJECTION_RISK_TABLE.md`;
const DEFAULT_REVIEW_PRESSURE_DIR = "reviewer/story-pressure";
const DEFAULT_REJECT_FIRST_REVIEW_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/REJECT_FIRST_REVIEW.md`;
const DEFAULT_NOVELTY_ATTACK_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/NOVELTY_ATTACK.md`;
const DEFAULT_UNSUPPORTED_CLAIM_AUDIT_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/UNSUPPORTED_CLAIM_AUDIT.md`;
const DEFAULT_REVERSE_OUTLINE_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/REVERSE_OUTLINE.md`;
const DEFAULT_FIGURE_TABLE_QC_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/FIGURE_TABLE_QC.md`;
const DEFAULT_LIMITATION_AUDIT_PATH =
  `${DEFAULT_REVIEW_PRESSURE_DIR}/LIMITATION_AUDIT.md`;

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
  kgStorylineRequired: boolean;
  proofAppendixRequired: boolean;
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

const STAGE_ENTRY_MICRO_STAGES: Record<string, string> = {
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
    summary: "Lock the onboarding contract before doing fresh work.",
    command:
      "Run /project-init to lock the research goal, baseline, primary metric, datasets, success criteria, and configured Zotero project path; then run /resume-pipeline to reconcile PROJECT_MANIFEST.json, TRACK_REGISTRY.json, CLAIM_POLICY.md, idle_research, and the experiment ledger.",
  },
  survey_review: {
    owner: "researcher",
    summary: "Run the survey loop until the review packet is saturated, then hand off into survey-mode writing.",
    command:
      'Run /survey-pipeline "topic" to expand retrieval coverage, stabilize taxonomy, complete representative-method + benchmark alignment coverage, and synthesize SURVEY_BRIEF.md plus the survey review artifacts before WRITE handoff.',
  },
  graph_build: {
    owner: "researcher",
    summary: "Drive workflow-owned upload, graph verification, and core brainstorm refresh before downstream reasoning.",
    command:
      "Run /graph-build to let workflow-owned upload requests finish, verify PAPER_SOURCE_INDEX.json is reflected in the shared global graph, and refresh the core brainstorm bundle before frontier mapping.",
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
      "If launches are still pending, run /experiment-phase or wake Coder /run-experiment; if an approved search envelope exists, prefer waking Coder /search-experiment for the bounded inner loop. Once remote runs exist, switch to /monitor-experiment, reconcile EXPERIMENT_REGISTRY.md and EXPERIMENT_LEDGER.json, and mark experiment_search ready_for_analysis only when evaluation and plot-pack artifacts are complete.",
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
      "Complete external review packaging and rebuttal materials, then stop for the mandatory GATE-5 human decision; the OpenReview-facing final submission path must be explicitly confirmed by a human and is never auto-completed.",
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

function getPreviousStagesForRegression(params: {
  currentStage: string | null;
  manifest: ManifestLike | null;
}): string[] {
  const normalizedStage = normalizeStage(params.currentStage);
  if (!normalizedStage) {
    return [];
  }

  const candidates = Object.entries(STAGE_REQUIREMENTS)
    .filter(
      ([stage, requirement]) =>
        requirement.nextStage === normalizedStage && stage !== normalizedStage
    )
    .map(([stage]) => stage);

  if (normalizedStage !== "write") {
    return candidates;
  }

  const preferredOrder = isSurveyWorkflow(params.manifest)
    ? ["survey_review", "review", "revise"]
    : ["review", "revise", "survey_review"];

  return preferredOrder.filter((stage) => candidates.includes(stage));
}

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
    zoteroProjectRoot:
      asString((config as Record<string, unknown> | null)?.zoteroProjectRoot) ??
      DEFAULT_POLICY.zoteroProjectRoot,
    papernexusApiBaseUrl:
      asString(config?.papernexusApiBaseUrl) ??
      DEFAULT_POLICY.papernexusApiBaseUrl,
    papernexusSharedCorpus:
      asString(config?.papernexusSharedCorpus) ??
      DEFAULT_POLICY.papernexusSharedCorpus,
    papernexusMcpUrl:
      asString((config as Record<string, unknown> | null)?.papernexusMcpUrl) ??
      DEFAULT_POLICY.papernexusMcpUrl,
    papernexusMcpTransport:
      normalizePapernexusMcpTransport(
        (config as Record<string, unknown> | null)?.papernexusMcpTransport
      ) ?? DEFAULT_POLICY.papernexusMcpTransport,
    papernexusMcpTimeoutMs:
      typeof (config as Record<string, unknown> | null)?.papernexusMcpTimeoutMs === "number" &&
      Number.isFinite(
        (config as Record<string, unknown> | null)?.papernexusMcpTimeoutMs
      )
        ? Math.max(
            1000,
            Math.floor(
              ((config as Record<string, unknown> | null)?.papernexusMcpTimeoutMs ??
                DEFAULT_POLICY.papernexusMcpTimeoutMs) as number
            )
          )
        : DEFAULT_POLICY.papernexusMcpTimeoutMs,
    papernexusAllowLocalMcp:
      (config as Record<string, unknown> | null)?.papernexusAllowLocalMcp === true
        ? true
        : DEFAULT_POLICY.papernexusAllowLocalMcp,
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
    papernexusSshTarget:
      asString((config as Record<string, unknown> | null)?.papernexusSshTarget) ??
      DEFAULT_POLICY.papernexusSshTarget,
    papernexusRemoteStagingRoot:
      asString((config as Record<string, unknown> | null)?.papernexusRemoteStagingRoot) ??
      DEFAULT_POLICY.papernexusRemoteStagingRoot,
    papernexusAccessMode:
      normalizePapernexusAccessMode(
        (config as Record<string, unknown> | null)?.papernexusAccessMode
      ) ??
      DEFAULT_POLICY.papernexusAccessMode,
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
    teamRuntime:
      config && typeof config === "object" &&
      (config as Record<string, unknown>).teamRuntime &&
      typeof (config as Record<string, unknown>).teamRuntime === "object"
        ? {
            enabled:
              ((config as Record<string, unknown>).teamRuntime as Record<string, unknown>)
                .enabled === false
                ? false
                : true,
            }
        : DEFAULT_POLICY.teamRuntime,
    promptConfigPath:
      readWorkflowPromptConfigPath(config) ??
      DEFAULT_POLICY.promptConfigPath,
  };
}

function normalizeRole(value: string | null | undefined): WorkflowRole | null {
  return normalizeWorkflowRoleFromModule(value) as WorkflowRole | null;
}

function getDefaultPapernexusSourceDir(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return path.join(os.homedir(), ".papernexus", "papers");
}

function getDefaultPapernexusIndexRoot(): string {
  return path.join(os.homedir(), ".papernexus", "index-store");
}

function isLocalPapernexusStoragePath(value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  if (/\bPAPERNEXUS_ROOT\b/i.test(raw)) {
    return true;
  }
  const normalized = raw.replace(/\\/g, "/");
  return /(?:^|[=\s"'`])(?:~|\$HOME|\$\{HOME\}|\/[^\s"'`|;&]*)\/\.papernexus\/(?:papers|index-store)(?:\/|$)/i.test(
    normalized
  );
}

function isRemoteOnlyPapernexusWorkflow(params: {
  apiBaseUrl: string | null | undefined;
  mcpUrl?: string | null | undefined;
}): boolean {
  return Boolean(
    (params.apiBaseUrl && params.apiBaseUrl.trim()) ||
      (params.mcpUrl && params.mcpUrl.trim())
  );
}

function getTemplatesRoot(): string {
  return path.resolve(MODULE_DIR, "..", "templates");
}

function buildIdleResearchTemplateForBootstrap(params: {
  title: string;
  topic?: string | null;
}): Record<string, unknown> {
  return buildIdleResearchTemplateForBootstrapFromModule(params);
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
  workflowLine?: "experiment" | "survey";
}): Promise<EnsuredWorkflowProject> {
  return (await ensureWorkflowProjectRootFromModule(params)) as EnsuredWorkflowProject;
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

function getProjectRoot(options?: {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  role?: string;
  policy?: WorkflowGuardPolicy;
}): string | null {
  return getProjectRootFromModule(options);
}

function inferProjectId(projectRoot: string | null, manifest: ManifestLike | null): string | null {
  return inferProjectIdFromModule(projectRoot, manifest);
}

function getMailboxPath(projectRoot: string): string {
  return getMailboxPathImpl(projectRoot);
}

async function readMailbox(projectRoot: string): Promise<WorkflowMailboxStore> {
  return readMailboxImpl({ projectRoot, readJsonIfExists });
}

async function saveMailbox(projectRoot: string, mailbox: WorkflowMailboxStore): Promise<void> {
  await saveMailboxImpl({ projectRoot, mailbox, writeJsonEnsured });
}

function getContactStatePath(projectRoot: string): string {
  return getContactStatePathImpl(projectRoot);
}

async function readContactStore(projectRoot: string): Promise<WorkflowContactStore> {
  return readContactStoreImpl({ projectRoot, readJsonIfExists });
}

async function saveContactStore(
  projectRoot: string,
  store: WorkflowContactStore
): Promise<void> {
  await saveContactStoreImpl({ projectRoot, store, writeJsonEnsured });
}

function getExperimentLedgerPath(projectRoot: string): string {
  return getExperimentLedgerPathImpl(projectRoot);
}

function getExperimentSearchPath(projectRoot: string): string {
  return getExperimentSearchPathImpl(projectRoot);
}

function createEmptyExperimentLedger(projectId: string | null): ExperimentLedger {
  return createEmptyExperimentLedgerImpl(projectId) as ExperimentLedger;
}

function isTerminalExperimentStatus(status: string | null): boolean {
  return isTerminalExperimentStatusImpl(status);
}

function normalizePapernexusSync(value: unknown): ExperimentPapernexusSync {
  return normalizePapernexusSyncImpl(value) as ExperimentPapernexusSync;
}

function normalizeMetricRecord(value: unknown): Record<string, unknown> | null {
  return normalizeMetricRecordImpl(value);
}

function metricToText(metric: Record<string, unknown> | null): string | null {
  return metricToTextImpl(metric);
}

function normalizeExperimentEntry(
  entry: Record<string, unknown>,
  defaults?: { experimentId?: string | null; updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntry | null {
  return normalizeExperimentEntryImpl(entry, defaults) as ExperimentLedgerEntry | null;
}

function mergeExperimentEntries(
  existing: ExperimentLedgerEntry | null,
  incoming: Record<string, unknown>,
  defaults?: { updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntry {
  return mergeExperimentEntriesImpl(existing, incoming, defaults) as ExperimentLedgerEntry;
}

function getExperimentSortTimestamp(entry: ExperimentLedgerEntry): string {
  return getExperimentSortTimestampImpl(entry);
}

function buildExperimentLedgerSummary(
  experiments: ExperimentLedgerEntry[]
): ExperimentLedgerSummary {
  return buildExperimentLedgerSummaryImpl(experiments) as ExperimentLedgerSummary;
}

function normalizeExperimentLedger(
  raw: Record<string, unknown>,
  projectId: string | null
): ExperimentLedger {
  return normalizeExperimentLedgerImpl(raw, projectId) as ExperimentLedger;
}

async function loadExperimentLedgerIfExists(
  projectRoot: string
): Promise<ExperimentLedger | null> {
  return (await loadExperimentLedgerIfExistsImpl({
    projectRoot,
    readJsonIfExists,
  })) as ExperimentLedger | null;
}

async function readExperimentLedgerEnsured(projectRoot: string): Promise<ExperimentLedger> {
  return (await readExperimentLedgerEnsuredImpl({
    projectRoot,
    readJsonIfExists,
  })) as ExperimentLedger;
}

async function saveExperimentLedger(
  projectRoot: string,
  ledger: ExperimentLedger
): Promise<void> {
  await saveExperimentLedgerImpl({
    projectRoot,
    ledger,
    writeJsonEnsured,
  });
}

async function loadExperimentSearchState(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
}): Promise<ExperimentSearchState> {
  return (await loadExperimentSearchStateImpl({
    ...params,
    readJsonIfExists,
  })) as ExperimentSearchState;
}

async function saveExperimentSearchStateFile(
  projectRoot: string,
  state: ExperimentSearchState
): Promise<void> {
  await saveExperimentSearchStateFileImpl({
    projectRoot,
    state,
    writeJsonEnsured,
  });
}

async function syncManifestExperimentMemory(params: {
  projectRoot: string;
  ledger: ExperimentLedger;
}): Promise<Record<string, unknown> | null> {
  return await syncManifestExperimentMemoryImpl(params, {
    readJsonIfExists,
    writeJsonEnsured,
    normalizeInnovationReflectionState: (value) =>
      normalizeInnovationReflectionState(value) as {
        requiredAfterExperiments: boolean;
        status: string;
        lastReflectionPath: string | null;
        pendingReason: string | null;
      },
    serializeInnovationReflectionState: (value) =>
      serializeInnovationReflectionState(value as InnovationReflectionState),
    isInnovationReflectionDue: ({ state, ledger }) =>
      isInnovationReflectionDue({
        state: state as InnovationReflectionState,
        ledger: ledger as ExperimentLedger | null,
      }),
  });
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

async function upsertJsonArtifact(
  targetPath: string | null,
  patch: Record<string, unknown>
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const current = (await readJsonIfExists<Record<string, unknown>>(targetPath)) ?? {};
  await writeJsonEnsured(targetPath, {
    ...current,
    ...patch,
  });
}

async function scaffoldMarkdownArtifactIfMissing(
  targetPath: string | null,
  content: string
): Promise<void> {
  if (!targetPath) {
    return;
  }
  if (await pathExists(targetPath)) {
    return;
  }
  await writeTextEnsured(targetPath, content);
}

function getGateStatePath(projectRoot: string): string {
  return getGateStatePathFromModule(projectRoot);
}

function normalizeGateState(value: unknown): GateState {
  return normalizeGateStateFromModule(value) as GateState;
}

function serializeGateState(state: GateState): Record<string, unknown> {
  return serializeGateStateFromModule(state);
}

async function readGateState(projectRoot: string): Promise<GateState> {
  return (await readGateStateFromModule({
    projectRoot,
    readJsonIfExists,
  })) as GateState;
}

async function saveGateState(projectRoot: string, gateState: GateState): Promise<void> {
  await saveGateStateFromModule({
    projectRoot,
    gateState,
    writeJsonEnsured,
  });
}

function computeGateConfirmationDeadline(state: GateState): string | null {
  return computeGateConfirmationDeadlineFromModule(state);
}

function isTimedDefaultGate(state: GateState): boolean {
  return normalizeStage(state.gateType) === "timed_default";
}

function hasTimedDefaultGateExpired(state: GateState, now: string): boolean {
  return hasTimedDefaultGateExpiredFromModule(state, now);
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
  return (await getGateStateSummaryFromModule({
    ...params,
    readJsonIfExists,
  })) as {
    state: GateState;
    timedDefaultEligible: boolean;
    timedDefaultExpired: boolean;
    confirmationDeadlineAt: string | null;
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
  return (await setGateStateForWorkflowFromModule({
    ...params,
    readJsonIfExists,
    writeJsonEnsured,
  })) as {
    state: GateState;
    timedDefaultEligible: boolean;
    timedDefaultExpired: boolean;
    confirmationDeadlineAt: string | null;
  };
}

function getProjectsStatePath(projectRoot: string): string {
  return getProjectsStatePathFromModule(projectRoot);
}

async function readProjectsStateRaw(projectRoot: string): Promise<Record<string, unknown>> {
  return await readProjectsStateRawFromModule({
    projectRoot,
    readJsonIfExists,
  });
}

function formatProjectDirEntry(projectId: string | null): string | null {
  return formatProjectDirEntryFromModule(projectId);
}

function dateOnly(isoTs: string): string {
  return dateOnlyFromModule(isoTs);
}

function formatStageCommand(stage: string | null): string | null {
  if (!stage) {
    return null;
  }
  return STAGE_EXECUTION_HINTS[stage]?.command ?? null;
}

function formatWorkflowShellArgument(value: string): string {
  return formatWorkflowShellArgumentFromKernel(value);
}

function buildGraphImportRepairSlashCommand(
  targetCorpus: string | null | undefined
): string {
  const normalizedCorpus = asString(targetCorpus);
  return (
    `/graph-build --repair-import true` +
    (normalizedCorpus
      ? ` --shared-corpus ${formatWorkflowShellArgument(normalizedCorpus)}`
      : "")
  );
}

function formatStageSummary(stage: string | null): string | null {
  if (!stage) {
    return null;
  }
  return STAGE_EXECUTION_HINTS[stage]?.summary ?? null;
}

function stageOwner(stage: string | null): WorkflowRole | null {
  return resolveWorkflowStageLeadRole({ stage });
}

function getAutoIteratorAuditPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json");
}

async function writeAutoIteratorAuditLifecycle(params: {
  projectRoot: string;
  runId: string;
  status:
    | "started"
    | "completed"
    | "failed"
    | "aborted"
    | "timed_out"
    | "superseded";
  startedAt: string | null;
  updatedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  summary?: string | null;
  result?: AutoIteratorResult | null;
  error?: unknown;
}): Promise<string> {
  const auditPath = getAutoIteratorAuditPath(params.projectRoot);
  const existing = normalizeWorkflowAutoIteratorAudit(
    await readJsonIfExists<Record<string, unknown>>(auditPath)
  );
  const startedAt =
    params.startedAt ??
    existing?.startedAt ??
    (params.status === "started" ? params.updatedAt : null);
  const errorRecord =
    params.error instanceof Error
      ? {
          name: params.error.name,
          message: params.error.message,
        }
      : params.error && typeof params.error === "object"
        ? (params.error as Record<string, unknown>)
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
    completedAt:
      params.status === "completed" ? params.completedAt ?? params.updatedAt : null,
    failedAt: params.status === "failed" ? params.failedAt ?? params.updatedAt : null,
    updatedAt: params.updatedAt,
    summary:
      params.summary ??
      (params.status === "started"
        ? "Auto iterator started."
        : params.status === "completed"
          ? "Auto iterator completed."
          : params.status === "failed"
            ? "Auto iterator failed."
            : params.status === "timed_out"
              ? `Auto iterator timed out after ${Math.round(
                  AUTO_ITERATOR_STARTED_TIMEOUT_MS / 60000
                )} minutes without a terminal audit.`
              : params.status === "superseded"
                ? "Auto iterator was superseded by a newer run."
                : "Auto iterator aborted before completion."),
    result: params.result ?? (params.status === "completed" ? existing?.result ?? null : null),
    error:
      params.status === "failed" || params.status === "aborted" ? errorRecord : null,
  });
  return auditPath;
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

async function syncProjectsStateEntry(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: ManifestLike;
  trackRegistry: TrackRegistryLike | null;
  stage: string | null;
  nextAction: string | null;
  blockingReason: string | null;
}): Promise<boolean> {
  return await syncProjectsStateEntryFromModule(params, {
    readJsonIfExists,
    writeJsonEnsured,
    getActiveTracks,
  });
}

async function writeAutoIteratorAudit(
  projectRoot: string,
  result: AutoIteratorResult
): Promise<string> {
  const updatedAt = new Date().toISOString();
  const existing = normalizeWorkflowAutoIteratorAudit(
    await readJsonIfExists<Record<string, unknown>>(getAutoIteratorAuditPath(projectRoot))
  );
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
  return maybeQueueAutoIteratorMailboxImpl(params, {
    canRoleContact,
    getWorkflowContactCooldown,
    queueWorkflowMailboxMessage,
    recordWorkflowContactEvent,
  });
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
      : mode === "journal"
        ? normalized.defaultJournalTemplatePath
        : null;
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

function hasActiveExperimentRuns(ledger: ExperimentLedger | null): boolean {
  if (!ledger) {
    return false;
  }
  if (ledger.summary.activeExperimentIds.length > 0) {
    return true;
  }
  return ledger.experiments.some((entry) => !isTerminalExperimentStatus(entry.status));
}

function hasFinishedExperimentWorkAwaitingReconciliation(params: {
  ledger: ExperimentLedger | null;
  experimentSearch: ExperimentSearchState;
}): boolean {
  if (!params.ledger || isExperimentSearchReadyForAnalysis(params.experimentSearch)) {
    return false;
  }
  return params.ledger.experiments.some(
    (entry) =>
      isTerminalExperimentStatus(entry.status) &&
      Boolean(
        entry.completedAt ||
          entry.resultPaths.length > 0 ||
          entry.evidencePointers.length > 0 ||
          entry.keyMetric ||
          entry.metrics
      )
  );
}

function buildExperimentMonitorCommand(): string {
  return "Run /monitor-experiment to reconcile remote experiments from durable runtime artifacts first (REMOTE_RUN.json, RUN_HEARTBEAT.json, RUN_TERMINAL.json, RESULT_SUMMARY.json, FAILURE_SIGNATURE.json), persist missing watcher signals through research_workflow.record_experiment_runtime_signal when needed, and promote completed runs into artifacts/results/, EXPERIMENT_REGISTRY.md, EXPERIMENT_LEDGER.json, and experiment_search until ready_for_analysis. If coder-side search is active, keep retained incumbent history and discarded candidate history distinct.";
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
  return extractReviewIssuesImpl(value) as ReviewIssueState[];
}

function summarizeReviewIssuesFromManifest(value: unknown): {
  issues: ReviewIssueState[];
  counts: ReviewIssueCounts;
} {
  return summarizeReviewIssuesFromManifestImpl(value) as {
    issues: ReviewIssueState[];
    counts: ReviewIssueCounts;
  };
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
  const issueManifestRecord = asRecord(issueManifest);
  if (issueManifestRecord) {
    const hydratedState = normalizeReviewIssueTrackerState(issueManifestRecord);
    const hasExplicitCounts =
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "open_counts") ||
      Object.prototype.hasOwnProperty.call(issueManifestRecord, "openCounts");
    return {
      ...state,
      status: hydratedState.status ?? state.status,
      issues: hydratedState.issues.length > 0 ? hydratedState.issues : state.issues,
      openCounts: hasExplicitCounts ? hydratedState.openCounts : state.openCounts,
      scoreRecords:
        hydratedState.scoreRecords.length > 0 ? hydratedState.scoreRecords : state.scoreRecords,
      lastReviewRound:
        hydratedState.lastReviewRound > 0 ? hydratedState.lastReviewRound : state.lastReviewRound,
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

function getResearchProgramValidationErrors(
  state: ResearchProgramState
): string[] {
  return getResearchProgramValidationErrorsFromKernel(state);
}

function getResearchProgramPlanValidationErrors(params: {
  state: ResearchProgramState;
  ideationContract?: IdeationContractState | null;
}): string[] {
  return getResearchProgramPlanValidationErrorsFromKernel(params);
}

function defaultResearchProgramZoteroProjectPath(
  projectId: string | null | undefined
): string | null {
  return defaultResearchProgramZoteroProjectPathImpl(projectId);
}

function getResearchProgramOnboardingGaps(params: {
  state: ResearchProgramState;
  projectId?: string | null;
}): string[] {
  return getResearchProgramOnboardingGapsFromKernel(params);
}

function getResearchProgramOnboardingStatus(params: {
  state: ResearchProgramState;
  projectId?: string | null;
}): string {
  return getResearchProgramOnboardingStatusFromKernel(params);
}

function isIdeationContractReady(state: IdeationContractState): boolean {
  return ["ready", "reconciled", "approved"].includes(
    normalizeStage(state.status) ?? ""
  );
}

function getIdeationContractValidationErrors(
  state: IdeationContractState
): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.ideation_contract.status = ready|reconciled|approved (current: ${state.status})`
    );
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
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.ideation_contract.${field} is required`);
    }
  }
  if (state.graphIdeationIndices.status === "missing") {
    errors.push(
      "PROJECT_MANIFEST.json.ideation_contract.graph_ideation_indices.status must not be missing"
    );
  }
  return errors;
}

function isPaperStoryStateReady(state: PaperStoryState): boolean {
  return ["ready", "reconciled", "approved"].includes(
    normalizeStage(state.status) ?? ""
  );
}

function getPaperStoryStateValidationErrors(state: PaperStoryState): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.paper_story_state.status = ready|reconciled|approved (current: ${state.status})`
    );
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
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(`PROJECT_MANIFEST.json.paper_story_state.${field} is required`);
    }
  }
  if (normalizeStage(state.claimSupportStatus) === "unsupported") {
    errors.push(
      `PROJECT_MANIFEST.json.paper_story_state.claim_support_status must not be unsupported before WRITE (current: ${state.claimSupportStatus})`
    );
  }
  return errors;
}

function isReviewPressurePacketReady(state: ReviewPressurePacketState): boolean {
  return ["ready", "reconciled", "approved"].includes(
    normalizeStage(state.status) ?? ""
  );
}

function getReviewPressurePacketValidationErrors(
  state: ReviewPressurePacketState
): string[] {
  const errors: string[] = [];
  if (!["ready", "reconciled", "approved"].includes(normalizeStage(state.status) ?? "")) {
    errors.push(
      `PROJECT_MANIFEST.json.review_pressure_packet.status = ready|reconciled|approved (current: ${state.status})`
    );
  }
  for (const [field, value] of [
    ["reject_first_review_path", state.rejectFirstReviewPath],
    ["novelty_attack_path", state.noveltyAttackPath],
    ["unsupported_claim_audit_path", state.unsupportedClaimAuditPath],
    ["reverse_outline_path", state.reverseOutlinePath],
    ["figure_table_qc_path", state.figureTableQcPath],
    ["limitation_audit_path", state.limitationAuditPath],
  ] as Array<[string, string | null]>) {
    if (!value) {
      errors.push(
        `PROJECT_MANIFEST.json.review_pressure_packet.${field} is required`
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
  return isBrainstormCycleReadyFromKernel(state);
}

function getBrainstormCycleValidationErrors(
  state: BrainstormCycleState
): string[] {
  return getBrainstormCycleValidationErrorsFromKernel(state);
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
  return renderMarkdownishPayloadImpl(value);
}

function renderReasoningTracePayload(value: unknown): string {
  return renderReasoningTracePayloadImpl(value);
}

function hasMeaningfulPayload(value: unknown): boolean {
  return hasMeaningfulPayloadImpl(value);
}

function pickBrainstormPayload(record: Record<string, unknown>, keys: string[]): unknown {
  return pickBrainstormPayloadImpl(record, keys);
}

function extractBrainstormCandidateRecords(
  value: unknown
): Array<{
  round: BrainstormCycleRoundState;
  roundRecord: Record<string, unknown>;
  option: BrainstormCycleOptionState;
  optionRecord: Record<string, unknown>;
}> {
  return extractBrainstormCandidateRecordsImpl(value) as Array<{
    round: BrainstormCycleRoundState;
    roundRecord: Record<string, unknown>;
    option: BrainstormCycleOptionState;
    optionRecord: Record<string, unknown>;
  }>;
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
  return selectBrainstormCandidateImpl(params) as
    | {
        round: BrainstormCycleRoundState;
        roundRecord: Record<string, unknown>;
        option: BrainstormCycleOptionState;
        optionRecord: Record<string, unknown>;
        mode: string | null;
      }
    | null;
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
  const theoryState = asRecord(manifest.theory_state ?? manifest.theoryState) ?? {};
  const proofPacketDir = await selectExistingNonEmptyDirectory({
    projectRoot,
    candidates: [
      current.proofPacketDir,
      pickString(theoryState, ["proof_packet_dir", "proofPacketDir"]),
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
    const citationIntegrity =
      asRecord(manifest.citation_integrity ?? manifest.citationIntegrity) ?? {};
    const bibliographyPath = await selectExistingArtifactPath({
      projectRoot,
      candidates: [
        pickString(citationIntegrity, [
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
  const workflowControl = normalizeWorkflowControlContract(manifest.workflow_control);
  await appendWorkflowTraceEvent({
    projectRoot,
    projectId: inferProjectId(projectRoot, manifest),
    kind: "write_package_assembly",
    action: "assemble_write_package",
    functionName: "assembleWritePackage",
    stage: workflowControl?.stage ?? normalizeStage(manifest.current_stage),
    owner: workflowControl?.owner ?? asString(manifest.owner_agent),
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
  return isInnovationReflectionDueFromKernel({
    state: params.state,
    ledger: params.ledger,
  });
}

function buildExperimentMemoryDigest(
  ledger: ExperimentLedger | null,
  limit = 5
): ExperimentMemoryDigest[] {
  return buildExperimentMemoryDigestImpl(ledger, limit) as ExperimentMemoryDigest[];
}

async function loadProjectState(options?: {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  role?: string;
  invalidEnvProjectRootMode?: "throw" | "ignore";
  policy?: WorkflowGuardPolicy;
}): Promise<ProjectState> {
  return (await loadProjectStateFromModule(options)) as ProjectState;
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

type ExperimentBundleSummary = {
  dir: string;
  manifestPath: string;
  manifest: Record<string, unknown> | null;
};

async function findExperimentBundle(params: {
  projectRoot: string;
  experimentId: string | null;
  trackId?: string | null;
}): Promise<{ record: Record<string, unknown>; dir: string } | null> {
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
    if (
      manifestExperimentId === params.experimentId &&
      (!params.trackId || manifestTrackId === params.trackId)
    ) {
      return {
        record,
        dir: bundle.dir,
      };
    }
  }
  return null;
}

async function buildExperimentMetadataFromBundleManifest(params: {
  projectRoot: string;
  record: Record<string, unknown> | null;
  bundleDir: string | null;
}): Promise<Record<string, unknown> | null> {
  const record = params.record;
  if (!record) {
    return null;
  }
  const datasetPath = pickString(record, ["dataset_path", "datasetPath"]);
  const baselineReference = pickString(record, [
    "baseline_reference",
    "baselineReference",
  ]);
  const normalizedDatasetPath = datasetPath?.replace(/[\\/]+$/, "") ?? null;
  const datasetName =
    normalizedDatasetPath != null ? path.basename(normalizedDatasetPath) : null;
  const innovationPoints = listStructuredAlignmentStrings(
    record.innovation_points ?? record.innovationPoints
  );
  const metadata: Record<string, unknown> = {};
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
  const gitRecord =
    asRecord(record.git) ??
    asRecord(record.search_git) ??
    asRecord(record.searchGit) ??
    {};
  const remoteRunPath = params.bundleDir
    ? path.join(params.bundleDir, "REMOTE_RUN.json")
    : null;
  const resultSummaryPath = params.bundleDir
    ? path.join(params.bundleDir, "RESULT_SUMMARY.json")
    : null;
  const terminalPath = params.bundleDir
    ? path.join(params.bundleDir, "RUN_TERMINAL.json")
    : null;
  const remoteRun =
    remoteRunPath && (await pathExists(remoteRunPath))
      ? await readJsonIfExists<Record<string, unknown>>(remoteRunPath)
      : null;
  const resultSummary =
    resultSummaryPath && (await pathExists(resultSummaryPath))
      ? await readJsonIfExists<Record<string, unknown>>(resultSummaryPath)
      : null;
  const terminalSummary =
    terminalPath && (await pathExists(terminalPath))
      ? await readJsonIfExists<Record<string, unknown>>(terminalPath)
      : null;
  const execution: Record<string, unknown> = {};
  const candidateBranch =
    pickString(gitRecord, ["last_candidate_branch", "lastCandidateBranch", "candidate_branch", "candidateBranch"]) ??
    null;
  const candidateCommit =
    pickString(gitRecord, ["last_candidate_commit", "lastCandidateCommit", "candidate_commit", "candidateCommit"]) ??
    null;
  const baseCommit =
    pickString(gitRecord, ["base_commit", "baseCommit"]) ?? null;
  const runId =
    pickString(remoteRun ?? {}, ["run_id", "runId"]) ??
    pickString(resultSummary ?? {}, ["run_id", "runId"]) ??
    null;
  const stageRunId =
    pickString(remoteRun ?? {}, ["stage_run_id", "stageRunId"]) ??
    pickString(resultSummary ?? {}, ["stage_run_id", "stageRunId"]) ??
    null;
  const gitCommit =
    pickString(remoteRun ?? {}, ["git_commit", "gitCommit"]) ??
    pickString(resultSummary ?? {}, ["git_commit", "gitCommit"]) ??
    candidateCommit ??
    null;
  if (candidateBranch) execution.candidate_branch = candidateBranch;
  if (candidateCommit) execution.candidate_commit = candidateCommit;
  if (baseCommit) execution.base_commit = baseCommit;
  if (runId) execution.run_id = runId;
  if (stageRunId) execution.stage_run_id = stageRunId;
  if (gitCommit) execution.git_commit = gitCommit;
  if (remoteRunPath && remoteRun) {
    execution.remote_run_path = path.relative(params.projectRoot, remoteRunPath);
  }
  if (resultSummaryPath && resultSummary) {
    execution.result_summary_path = path.relative(params.projectRoot, resultSummaryPath);
  }
  if (terminalPath && terminalSummary) {
    execution.terminal_path = path.relative(params.projectRoot, terminalPath);
  }
  if (Object.keys(execution).length > 0) {
    metadata.execution = execution;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function listExperimentBundles(
  projectRoot: string
): Promise<ExperimentBundleSummary[]> {
  const coderRoot = path.join(projectRoot, "coder");
  const bundles: ExperimentBundleSummary[] = [];
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
      const manifestPath = path.join(current.dir, "EXPERIMENT_MANIFEST.json");
      if (
        (await pathExists(trainPy)) &&
        (await pathExists(readme)) &&
        (await pathExists(manifestPath))
      ) {
        bundles.push({
          dir: current.dir,
          manifestPath,
          manifest: await readJsonIfExists<Record<string, unknown>>(manifestPath),
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
  } catch {
    return [];
  }
  return bundles;
}

function normalizeAlignmentText(value: string | null | undefined): string | null {
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

function listStructuredAlignmentStrings(value: unknown): string[] {
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
    const primary =
      pickString(record, [
        "id",
        "step_id",
        "ablation_id",
        "title",
        "label",
        "objective",
        "summary",
      ]) ?? null;
    const coversSource =
      record.covers ??
      record.cover ??
      record.innovation_point ??
      record.innovationPoint ??
      record.innovation_point_id ??
      record.innovationPointId ??
      record.targets;
    const covers = Array.isArray(coversSource)
      ? coversSource.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : []
        )
      : typeof coversSource === "string" && coversSource.trim()
        ? [coversSource.trim()]
        : [];
    return [primary, ...covers].filter((item): item is string => Boolean(item));
  });
}

function listImplementationProofStrings(value: unknown): string[] {
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
    const primary =
      pickString(record, [
        "id",
        "point_id",
        "step_id",
        "hook",
        "symbol",
        "path",
        "file",
        "entry_point",
        "objective",
        "summary",
      ]) ?? null;
    const coversSource =
      record.covers ??
      record.cover ??
      record.innovation_point ??
      record.innovationPoint ??
      record.innovation_point_id ??
      record.innovationPointId ??
      record.targets;
    const covers = Array.isArray(coversSource)
      ? coversSource.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : []
        )
      : typeof coversSource === "string" && coversSource.trim()
        ? [coversSource.trim()]
        : [];
    return [primary, ...covers].filter((item): item is string => Boolean(item));
  });
}

async function getCodeStageBundleMissingSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
}): Promise<string[]> {
  const missing: string[] = [];
  const bundles = await listExperimentBundles(params.projectRoot);
  if (bundles.length === 0) {
    missing.push(
      "{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/train.py + README.md + EXPERIMENT_MANIFEST.json"
    );
    return missing;
  }

  const researchProgram = normalizeResearchProgramState(
    params.manifest?.research_program
  );
  const activeTracks = researchProgram.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
  const activeTracksById = new Map(activeTracks.map((track) => [track.trackId, track]));
  let hasAlignedBundle = activeTracks.length === 0;

  for (const bundle of bundles) {
    const relativeDir = path.relative(params.projectRoot, bundle.dir) || bundle.dir;
    const record = bundle.manifest;
    if (!record) {
      missing.push(`${relativeDir} has an unreadable EXPERIMENT_MANIFEST.json`);
      continue;
    }

    const bundleStatus = normalizeStage(
      pickString(record, [
        "status",
        "stage",
        "lifecycle_status",
        "lifecycleStatus",
      ])
    );
    if (
      bundleStatus &&
      ["parked", "superseded", "archived", "cancelled", "canceled", "abandoned"].includes(
        bundleStatus
      )
    ) {
      continue;
    }

    const trackId = pickString(record, ["track_id", "trackId"]);
    if (!trackId) {
      missing.push(`${relativeDir} missing track_id in EXPERIMENT_MANIFEST.json`);
      continue;
    }

    const parentTrackId = path.basename(path.dirname(bundle.dir));
    if (parentTrackId !== trackId) {
      missing.push(
        `${relativeDir} must live under coder/experiments/${trackId}/ so bundle path and EXPERIMENT_MANIFEST.json track_id stay aligned`
      );
    }

    const question =
      pickString(record, ["question", "experiment_question", "objective"]) ?? null;
    if (!question) {
      missing.push(`${relativeDir} missing question in EXPERIMENT_MANIFEST.json`);
    }

    const baselineReference =
      pickString(record, ["baseline_reference", "baselineReference", "baseline"]) ?? null;
    if (!baselineReference) {
      missing.push(`${relativeDir} missing baseline_reference in EXPERIMENT_MANIFEST.json`);
    }

    const primaryBaselineMetric =
      pickString(record, [
        "primary_baseline_metric",
        "primaryBaselineMetric",
        "main_metric",
      ]) ?? null;
    if (!primaryBaselineMetric) {
      missing.push(
        `${relativeDir} missing primary_baseline_metric in EXPERIMENT_MANIFEST.json`
      );
    }

    const targetImprovement =
      pickString(record, [
        "target_improvement",
        "targetImprovement",
        "success_threshold",
      ]) ?? null;
    if (!targetImprovement) {
      missing.push(`${relativeDir} missing target_improvement in EXPERIMENT_MANIFEST.json`);
    }

    const baselineTrainingProtocol =
      pickString(record, [
        "baseline_training_protocol",
        "baselineTrainingProtocol",
        "baseline_training_setup",
        "baselineTrainingSetup",
      ]) ?? null;
    if (!baselineTrainingProtocol) {
      missing.push(
        `${relativeDir} missing baseline_training_protocol in EXPERIMENT_MANIFEST.json`
      );
    }

    const baselineEvalProtocol =
      pickString(record, [
        "baseline_eval_protocol",
        "baselineEvalProtocol",
        "eval_protocol",
        "evalProtocol",
      ]) ?? null;
    if (!baselineEvalProtocol) {
      missing.push(
        `${relativeDir} missing baseline_eval_protocol in EXPERIMENT_MANIFEST.json`
      );
    }

    const innovationPoints = listStructuredAlignmentStrings(
      record.innovation_points ?? record.innovationPoints
    );
    if (innovationPoints.length === 0) {
      missing.push(`${relativeDir} missing innovation_points in EXPERIMENT_MANIFEST.json`);
    }

    const validationSteps = listStructuredAlignmentStrings(
      record.validation_steps ?? record.validationSteps
    );
    if (validationSteps.length === 0) {
      missing.push(`${relativeDir} missing validation_steps in EXPERIMENT_MANIFEST.json`);
    }

    const ablationPlan = listStructuredAlignmentStrings(
      record.ablation_plan ?? record.ablationPlan
    );
    if (ablationPlan.length === 0) {
      missing.push(`${relativeDir} missing ablation_plan in EXPERIMENT_MANIFEST.json`);
    }

    const implementationProof =
      asRecord(record.implementation_proof ?? record.implementationProof) ?? {};
    const rawChangedFiles =
      implementationProof.changed_files ?? implementationProof.changedFiles;
    const implementationChangedFiles = Array.isArray(rawChangedFiles)
      ? rawChangedFiles.flatMap((item: unknown) =>
          typeof item === "string" && item.trim() ? [item.trim()] : []
        )
      : [];
    if (implementationChangedFiles.length === 0) {
      missing.push(
        `${relativeDir} missing implementation_proof.changed_files in EXPERIMENT_MANIFEST.json`
      );
    }
    const integrationPoints = listImplementationProofStrings(
      implementationProof?.integration_points ?? implementationProof?.integrationPoints
    );
    if (integrationPoints.length === 0) {
      missing.push(
        `${relativeDir} missing implementation_proof.integration_points in EXPERIMENT_MANIFEST.json`
      );
    }
    const activationSignals = listImplementationProofStrings(
      implementationProof?.activation_signals ?? implementationProof?.activationSignals
    );
    if (activationSignals.length === 0) {
      missing.push(
        `${relativeDir} missing implementation_proof.activation_signals in EXPERIMENT_MANIFEST.json`
      );
    }
    const executionCommand =
      pickString(implementationProof, [
        "execution_command",
        "executionCommand",
        "run_command",
        "runCommand",
      ]) ?? null;
    if (!executionCommand) {
      missing.push(
        `${relativeDir} missing implementation_proof.execution_command in EXPERIMENT_MANIFEST.json`
      );
    }

    const validationCoverageText = normalizeAlignmentText(
      [...validationSteps, ...ablationPlan].join(" ")
    );
    for (const innovationPoint of innovationPoints) {
      const normalizedPoint = normalizeAlignmentText(innovationPoint);
      if (!normalizedPoint) {
        continue;
      }
      if (!validationCoverageText?.includes(normalizedPoint)) {
        missing.push(
          `${relativeDir} must cover innovation point "${innovationPoint}" inside validation_steps or ablation_plan`
        );
      }
    }
    const implementationCoverageText = normalizeAlignmentText(
      [...integrationPoints, ...implementationChangedFiles, executionCommand ?? ""].join(" ")
    );
    for (const innovationPoint of innovationPoints) {
      const normalizedPoint = normalizeAlignmentText(innovationPoint);
      if (!normalizedPoint) {
        continue;
      }
      if (!implementationCoverageText?.includes(normalizedPoint)) {
        missing.push(
          `${relativeDir} must map innovation point "${innovationPoint}" into implementation_proof.integration_points or changed_files`
        );
      }
    }

    const activeTrack = activeTracksById.get(trackId);
    if (!activeTrack) {
      if (activeTracks.length > 0) {
        missing.push(
          `${relativeDir} targets inactive or unknown track ${trackId}; code-stage bundles must map to an active innovation track`
        );
      }
      continue;
    }

    const bundleHypothesis =
      pickString(record, [
        "hypothesis",
        "track_hypothesis",
        "trackHypothesis",
      ]) ?? null;
    const bundleNoveltyBasis =
      pickString(record, ["novelty_basis", "noveltyBasis"]) ?? null;
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
    if (
      expectedHypothesis &&
      normalizeAlignmentText(bundleHypothesis) !== expectedHypothesis
    ) {
      missing.push(
        `${relativeDir} must align its hypothesis to active track ${trackId}`
      );
      continue;
    }
    if (
      expectedNoveltyBasis &&
      normalizeAlignmentText(bundleNoveltyBasis) !== expectedNoveltyBasis
    ) {
      missing.push(
        `${relativeDir} must align its novelty_basis to active track ${trackId}`
      );
      continue;
    }

    hasAlignedBundle = true;
  }

  if (!hasAlignedBundle && activeTracks.length > 0) {
    missing.push(
      "At least one coder experiment bundle must align to an active innovation track contract (track_id + question + hypothesis + novelty_basis)."
    );
  }

  return missing;
}

async function hasPrefixedFile(dir: string, prefix: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((entry) => entry.startsWith(prefix));
  } catch {
    return false;
  }
}

async function findAnyPdfInDir(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
      .map((entry) => path.join(dir, entry.name))
      .sort((left, right) => left.localeCompare(right));
    return candidates[0] ?? null;
  } catch {
    return null;
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

async function fileHasNonWhitespaceContent(targetPath: string | null): Promise<boolean> {
  if (!targetPath) {
    return false;
  }
  const raw = await readTextIfExists(targetPath);
  return Boolean(raw && raw.trim().length > 0);
}

function trackHasGraphBackedInnovationEvidence(track: Record<string, unknown>): boolean {
  return trackHasGraphBackedInnovationEvidenceFromHelper(track);
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

function summarizeClaimSupport(params: {
  claimEvidenceMatrixRaw: string | null;
  unsupportedClaimsRaw: string | null;
}): {
  status: string;
  supportedCount: number;
  partialCount: number;
  unsupportedCount: number;
} {
  const supportedIds = new Set<string>();
  const partialIds = new Set<string>();
  const unsupportedIds = new Set<string>();
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
      } else {
        unsupportedFallbackCount += 1;
      }
      continue;
    }
    if (/\bPARTIAL\b/i.test(line)) {
      if (claimId) {
        partialIds.add(claimId);
      } else {
        partialFallbackCount += 1;
      }
      continue;
    }
    if (/\bSUPPORTED\b/i.test(line)) {
      if (claimId) {
        supportedIds.add(claimId);
      } else {
        supportedFallbackCount += 1;
      }
    }
  }

  const unsupportedAuditLines = (params.unsupportedClaimsRaw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^#/.test(line) &&
        !/^[-*]\s*-{2,}/.test(line)
    )
    .filter((line) => !isScopedUnsupportedClaimExclusion(line));

  const unsupportedIdsFromAudit = uniqueStrings(
    extractClaimIdentifiers(unsupportedAuditLines.join("\n"))
  );
  if (unsupportedIdsFromAudit.length > 0) {
    for (const claimId of unsupportedIdsFromAudit) {
      unsupportedIds.add(claimId.toLowerCase());
    }
  } else {
    const unsupportedLines = unsupportedAuditLines.filter(
      (line) => /^[-*]\s+/.test(line) || /^\|/.test(line) || /\bunsupported\b/i.test(line)
    );
    unsupportedFallbackCount = Math.max(
      unsupportedFallbackCount,
      unsupportedLines.length
    );
  }

  const supportedCount = supportedIds.size + supportedFallbackCount;
  const partialCount = partialIds.size + partialFallbackCount;
  const unsupportedCount = unsupportedIds.size + unsupportedFallbackCount;

  const status =
    unsupportedCount > 0
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

function isScopedUnsupportedClaimExclusion(line: string): boolean {
  const normalized = line
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /\bdo not claim\b/.test(normalized) ||
    /\bdon't claim\b/.test(normalized) ||
    /\bclaims?\s+to\s+exclude\b/.test(normalized) ||
    /\bprimary\s+claims?\s+to\s+exclude\b/.test(normalized) ||
    /\bkeep\s+out\s+of\s+the\s+manuscript\b/.test(normalized) ||
    /\bstay\s+out\s+of\s+the\s+manuscript\b/.test(normalized) ||
    /\bscope\s+limits?\b/.test(normalized)
  );
}

function collectTrackVerdictSignals(rawText: string | null): string[] {
  const signals: string[] = [];
  for (const rawLine of (rawText ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#/.test(line) || /^\|?\s*-{3,}/.test(line)) {
      continue;
    }
    if (
      /\b(?:advance|park|kill|foreground|background|merge|hold)\b/i.test(line) &&
      (/\btrack[-_a-z0-9.]+\b/i.test(line) || /^[|*-]/.test(line))
    ) {
      signals.push(line);
    }
  }
  return uniqueStrings(signals);
}

function collectUnsupportedClaimSignals(rawText: string | null): string[] {
  const signals: string[] = [];
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

function extractClaimIdentifiers(rawText: string): string[] {
  return uniqueStrings(
    Array.from(rawText.matchAll(/\b(?:claim[-_][a-z0-9.]+|claim\d+|c\d+)\b/gi)).map((match) =>
      match[0].toLowerCase()
    )
  );
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

async function collectSurveyReviewStageMissingSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
}): Promise<string[]> {
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

async function getMissingStageSignals(params: {
  projectRoot: string;
  manifest: ManifestLike | null;
  trackRegistry: TrackRegistryLike | null;
  experimentLedger: ExperimentLedger | null;
  currentStage: string | null;
  includeOrchestrationValidation?: boolean;
}): Promise<string[]> {
  const { projectRoot, manifest, trackRegistry, experimentLedger, currentStage } = params;
  if (!currentStage) {
    return ["PROJECT_MANIFEST.json.current_stage is missing"];
  }

  switch (currentStage) {
    case "setup":
      return collectSetupStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
        }
      );
    case "survey_review":
      return collectSurveyReviewStageMissingSignals({
        projectRoot,
        manifest,
      });
    case "graph_build":
      return collectGraphBuildStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
        }
      );
    case "frontier_mapping":
      return collectFrontierMappingStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
        }
      );
    case "idea": {
      return collectIdeaStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
          readJsonIfExists,
          getCodeStageBundleMissingSignals,
        }
      );
    }
    case "plan":
      return collectPlanStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
          readJsonIfExists,
          getCodeStageBundleMissingSignals,
        },
        {
          includeOrchestrationValidation:
            params.includeOrchestrationValidation !== false,
        }
      );
    case "code":
      return collectCodeStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
          readJsonIfExists,
          getCodeStageBundleMissingSignals,
        }
      );
    case "experiment":
      return collectExperimentStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
          isNonEmptyDirectory,
          pathExists,
          manifestFieldExists,
          getExperimentLedgerPath,
          loadExperimentSearchState,
          loadExperimentReviewState,
          isExperimentSearchReadyForAnalysis,
          hasActiveExperimentRuns: (ledger) =>
            hasActiveExperimentRuns(ledger as ExperimentLedger | null),
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
        }
      );
    case "analyze":
      return collectAnalyzeStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
          isNonEmptyDirectory,
          pathExists,
          manifestFieldExists,
          getExperimentLedgerPath,
          loadExperimentSearchState,
          loadExperimentReviewState,
          isExperimentSearchReadyForAnalysis,
          hasActiveExperimentRuns: (ledger) =>
            hasActiveExperimentRuns(ledger as ExperimentLedger | null),
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
        }
      );
    case "review": {
      return collectReviewStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
          isNonEmptyDirectory,
          pathExists,
          manifestFieldExists,
          getExperimentLedgerPath,
          loadExperimentSearchState,
          loadExperimentReviewState,
          isExperimentSearchReadyForAnalysis,
	          hasActiveExperimentRuns: (ledger) =>
	            hasActiveExperimentRuns(ledger as ExperimentLedger | null),
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
          normalizeCitationIntegrityState,
          normalizeResultsStorylineState,
          normalizeTitleAbstractIntroWorkbenchState,
          normalizeParagraphLogicAuditState,
	          fileHasNonWhitespaceContent,
	          DEFAULT_FIGURE_REVIEW_PATH,
	          DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH,
        }
      );
    }
    case "write":
      return collectWriteStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
          normalizeParagraphLogicAuditState,
          normalizeExternalReviewState,
          isExternalReviewConclusionReady,
          hasPrefixedFile,
          findAnyPdfInDir,
          DEFAULT_KG_STORYLINE_PACKET_PATH,
          DEFAULT_THEORY_APPENDIX_PLAN_PATH,
          DEFAULT_THEORY_APPENDIX_SECTION_PATH,
          DEFAULT_CITATION_BIB_PATH,
          DEFAULT_CITATION_REPORT_PATH,
        }
      );
    case "submit":
      return collectSubmitStageMissingSignals(
        { projectRoot, manifest, trackRegistry, experimentLedger },
        {
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
          normalizeParagraphLogicAuditState,
          normalizeExternalReviewState,
          isExternalReviewConclusionReady,
          hasPrefixedFile,
          findAnyPdfInDir,
          DEFAULT_KG_STORYLINE_PACKET_PATH,
          DEFAULT_THEORY_APPENDIX_PLAN_PATH,
          DEFAULT_THEORY_APPENDIX_SECTION_PATH,
          DEFAULT_CITATION_BIB_PATH,
          DEFAULT_CITATION_REPORT_PATH,
        }
      );
    default:
      return [];
  }
}

function inboxForRole(params: {
  mailbox: WorkflowMailboxStore | null;
  role: WorkflowRole | null;
  limit: number;
}): WorkflowMailboxItem[] {
  return inboxForRoleImpl(params) as WorkflowMailboxItem[];
}

function buildDynamicTasks(params: {
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
  paragraphLogicAuditStatus: string | null;
  paragraphLogicAuditBlockingIssueCount: number | null;
  paragraphLogicAuditNextRepairAction: string | null;
  paragraphLogicAuditReportPath: string | null;
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
}): string[] {
  return buildDynamicTasksImpl(params, {
    rolePolicies: ROLE_POLICIES,
    asRecord,
    asString,
    normalizePaperIngestionState,
    normalizeIdeaCatalystState,
    normalizeGraphPresenceStatus,
    summarizeGraphPresenceMissing,
    buildGraphImportRepairGuidance,
    isIdleResearchDue: (state) => isIdleResearchDue(state as IdleResearchState),
    computeIdleResearchNextDueAt: (state) =>
      computeIdleResearchNextDueAt(state as IdleResearchState),
    uniqueStrings,
    DEFAULT_KG_STORYLINE_PACKET_PATH,
    DEFAULT_CITATION_REPORT_PATH,
  });
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
    role: params.agentId,
    invalidEnvProjectRootMode: "ignore",
  });
  const reconciledProjectState =
    projectState.projectRoot
      ? {
          ...projectState,
          manifest: (
            await reconcileWorkflowControl({
              projectRoot: projectState.projectRoot,
              policy: { allowProjectionRepair: true },
            })
          ).manifest,
        }
      : projectState;
  return await buildWorkflowSnapshotFromProjectState(
    {
      policy,
      agentId: params.agentId,
      projectState: reconciledProjectState,
    },
    {
      getMissingStageSignals:
        getMissingStageSignals as Parameters<
          typeof buildWorkflowSnapshotFromProjectState
        >[1] extends infer T
          ? T extends { getMissingStageSignals?: infer U }
            ? U
            : never
          : never,
    }
  );
}

export function buildFocusedPromptAssembly(params: {
  snapshot: Partial<WorkflowSnapshot>;
  trigger?: string;
  promptConfigPath?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): FocusedPromptAssembly {
  const promptConfig =
    params.promptConfig ??
    loadWorkflowPromptConfig({ configPath: params.promptConfigPath ?? null });
  return buildFocusedPromptAssemblyImpl(
    {
      ...(params as {
        snapshot: Record<string, unknown>;
        trigger?: string;
      }),
      promptConfig,
    },
    {
      buildNonOwnerRoutingAdvice: (snapshot) =>
        buildNonOwnerRoutingAdvice(snapshot as Partial<WorkflowSnapshot>),
      getSharedWritingConstitutionLines,
    }
  ) as FocusedPromptAssembly;
}

export function shouldUseFocusedWorkflowPrompt(snapshot: Partial<WorkflowSnapshot>): boolean {
  return shouldUseFocusedWorkflowPromptImpl(snapshot as Record<string, unknown>);
}

function buildNonOwnerRoutingAdvice(snapshot: Partial<WorkflowSnapshot>): string[] {
  return buildNonOwnerRoutingAdviceImpl(snapshot);
}

function getSharedWritingConstitutionLines(role: string | null): string[] {
  return getSharedWritingConstitutionLinesImpl(role);
}

export function formatWorkflowSnapshotForPrompt(params: {
  snapshot: WorkflowSnapshot;
  trigger?: string;
  detailLevel?: "full" | "focused";
  promptConfigPath?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): string {
  const promptConfig =
    params.promptConfig ??
    loadWorkflowPromptConfig({ configPath: params.promptConfigPath ?? null });
  return formatWorkflowSnapshotForPromptImpl(
    {
      ...(params as {
        snapshot: Record<string, unknown>;
        trigger?: string;
        detailLevel?: "full" | "focused";
      }),
      promptConfig,
    },
    {
      buildNonOwnerRoutingAdvice: (snapshot) =>
        buildNonOwnerRoutingAdvice(snapshot as Partial<WorkflowSnapshot>),
      getSharedWritingConstitutionLines,
    }
  );
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function canRoleContact(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  return canRoleContactFromModule(fromRole, toRole);
}

export function canRoleSpawn(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  return canRoleSpawnFromModule(fromRole, toRole);
}

export function canRoleContactInWorkflow(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  return canRoleContactInWorkflowFromModule(params);
}

export function canRoleSpawnInWorkflow(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  return canRoleSpawnInWorkflowFromModule(params);
}

export function inferTargetRoleFromToolParams(
  params: Record<string, unknown>
): WorkflowRole | null {
  return inferTargetRoleFromToolParamsFromModule(params);
}

export function shouldBlockProjectWrite(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockProjectWriteFromModule(params);
}

export function shouldBlockCoderDatasetMutation(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockCoderDatasetMutationFromModule(params);
}

export function shouldBlockResearchGraphForce(params: {
  role: WorkflowRole | null;
  currentStage: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockResearchGraphForceFromModule(params);
}

export function shouldBlockPapernexusInlineExecution(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  sessionKey: string | null | undefined;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusInlineExecutionFromModule(params);
}

export function shouldBlockPapernexusRawHttpUsage(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusRawHttpUsageFromModule(params);
}

export function shouldBlockPapernexusLiveGraphCliRead(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusLiveGraphCliReadFromModule(params);
}

export function shouldBlockPapernexusLocalGraphProcessing(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  remoteApiBaseUrl?: string | null;
  remoteMcpUrl?: string | null;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusLocalGraphProcessingFromModule(params);
}

export function shouldBlockPapernexusLocalStorageUsage(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  remoteApiBaseUrl?: string | null;
  remoteMcpUrl?: string | null;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusLocalStorageUsageFromModule(params);
}

export function shouldBlockPapernexusMultiPaperImport(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusMultiPaperImportFromModule(params);
}

export function shouldBlockPapernexusLongWaitImportCommand(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusLongWaitImportCommandFromModule(params);
}

export function shouldBlockPapernexusDestructiveOperation(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockPapernexusDestructiveOperationFromModule(params);
}

export function shouldBlockInnovationWrite(params: {
  projectRoot: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  innovationReflectionDue: boolean;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { block: boolean; reason?: string } {
  return shouldBlockInnovationWriteFromModule(params);
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
  return shouldBlockWriterTemplateWriteFromModule(params);
}

export function sanitizeAgentMentions(text: string): string {
  return sanitizeAgentMentionsFromModule(text);
}

export function hasAgentMention(text: string): boolean {
  return hasAgentMentionFromModule(text);
}

export function isWorkflowChannelHandoffMessage(text: string | null | undefined): boolean {
  return isWorkflowChannelHandoffMessageFromModule(text);
}

export function normalizeWorkflowChannelMentions(text: string): string {
  return normalizeWorkflowChannelMentionsFromModule(text);
}

export function sanitizeMessageToolParams(
  params: Record<string, unknown>
): Record<string, unknown> | null {
  return sanitizeMessageToolParamsFromModule(params);
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
  return (await queueWorkflowMailboxMessageImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured,
  })) as WorkflowMailboxItem;
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
  return (await getWorkflowContactCooldownImpl({
    ...params,
    readJsonIfExists,
  })) as {
    blocked: boolean;
    remainingSeconds: number;
    lastEvent: WorkflowContactEvent | null;
  };
}

export async function recordWorkflowContactEvent(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
}): Promise<void> {
  await recordWorkflowContactEventImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured,
  });
}

export async function acknowledgeWorkflowMailboxMessage(params: {
  projectRoot: string;
  messageId: string;
  agentId?: string;
}): Promise<WorkflowMailboxItem | null> {
  return (await acknowledgeWorkflowMailboxMessageImpl({
    ...params,
    readJsonIfExists,
    writeJsonEnsured,
    normalizeRole: (value) => normalizeRole(asString(value)),
  })) as WorkflowMailboxItem | null;
}

export async function readWorkflowMailboxForAgent(params: {
  projectRoot: string;
  agentId?: string;
  limit?: number;
  includeAcknowledged?: boolean;
}): Promise<WorkflowMailboxItem[]> {
  return (await readWorkflowMailboxForAgentImpl({
    ...params,
    readJsonIfExists,
    normalizeRole: (value) => normalizeRole(asString(value)),
  })) as WorkflowMailboxItem[];
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

export async function getIdeationContractStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
  noveltyTreeResolvedPath: string | null;
  noveltyTreeExists: boolean;
  challengeInsightTreeResolvedPath: string | null;
  challengeInsightTreeExists: boolean;
  candidatePoolResolvedPath: string | null;
  candidatePoolExists: boolean;
  scoreboardResolvedPath: string | null;
  scoreboardExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return summarizeIdeationContractStateFromModule({
    projectRoot: params.projectRoot,
    manifest,
    getIdeationContractValidationErrors,
    fileHasMeaningfulJsonContent,
    fileHasNonWhitespaceContent,
  });
}

export async function getSurveyReviewStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: SurveyReviewState;
  ready: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return getSurveyReviewStateSummaryFromModule(manifest);
}

export async function getResearchProgramStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ResearchProgramState;
  validationErrors: string[];
  onboardingStatus: string;
  onboardingGaps: string[];
}> {
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

export async function getPaperStoryStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
  fallbackNarrativeResolvedPath: string | null;
  fallbackNarrativeExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return summarizePaperStoryStateFromModule({
    projectRoot: params.projectRoot,
    manifest,
    getPaperStoryStateValidationErrors,
    fileHasNonWhitespaceContent,
  });
}

export async function getOrchestrationStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: OrchestrationState;
  validationErrors: string[];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeOrchestrationState(manifest.orchestration_state);
  const workflowControl = asRecord(manifest.workflow_control);
  const currentStage = normalizeStage(
    asString(workflowControl?.stage) ?? manifest.current_stage
  );
  return {
    state,
    validationErrors: getOrchestrationStateValidationErrors(state, currentStage),
  };
}

export async function getReviewPressurePacketStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return summarizeReviewPressurePacketStateFromModule({
    projectRoot: params.projectRoot,
    manifest,
    getReviewPressurePacketValidationErrors,
    fileHasNonWhitespaceContent,
  });
}

export async function getInnovationSynthesisStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: InnovationSynthesisState;
  synthesisMemoResolvedPath: string | null;
  synthesisMemoExists: boolean;
  graphResolvedPath: string | null;
  graphExists: boolean;
  statementResolvedPath: string | null;
  statementExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeInnovationSynthesisState(
    manifest.innovation_synthesis_state
  );
  const synthesisMemoResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.synthesisMemoPath
  );
  const graphResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.storyDependencyGraphPath
  );
  const statementResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.integratedContributionStatementPath
  );
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

export async function getStoryGapSearchRequisitionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: StoryGapSearchRequisitionState;
  packetResolvedPath: string | null;
  packetExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeStoryGapSearchRequisitionState(
    manifest.story_gap_search_requisition
  );
  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.packetPath
  );
  return {
    state,
    packetResolvedPath,
    packetExists: packetResolvedPath ? await pathExists(packetResolvedPath) : false,
  };
}

export async function getResultsStorylineStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ResultsStorylineState;
  questionOrderResolvedPath: string | null;
  questionOrderExists: boolean;
  evidenceSequenceResolvedPath: string | null;
  evidenceSequenceExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeResultsStorylineState(manifest.results_storyline);
  const questionOrderResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.resultsQuestionOrderPath
  );
  const evidenceSequenceResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.experimentEvidenceSequencePath
  );
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

export async function getStorylinePlannerStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: StorylinePlannerState;
  candidateResolvedPath: string | null;
  candidateExists: boolean;
  judgePacketResolvedPath: string | null;
  judgePacketExists: boolean;
  selectionResolvedPath: string | null;
  selectionExists: boolean;
  shadowSelectionResolvedPath: string | null;
  shadowSelectionExists: boolean;
  learnedPrimaryEvidenceResolvedPath: string | null;
  learnedPrimaryEvidenceExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeStorylinePlannerState(manifest.storyline_planner);
  const candidateResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.candidatePath
  );
  const judgePacketResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.judgePacketPath
  );
  const selectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.selectionPath
  );
  const shadowSelectionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.shadowSelectionPath
  );
  const learnedPrimaryEvidenceResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.learnedPrimaryEvidencePath
  );
  return {
    state,
    candidateResolvedPath,
    candidateExists: candidateResolvedPath ? await pathExists(candidateResolvedPath) : false,
    judgePacketResolvedPath,
    judgePacketExists: judgePacketResolvedPath
      ? await pathExists(judgePacketResolvedPath)
      : false,
    selectionResolvedPath,
    selectionExists: selectionResolvedPath ? await pathExists(selectionResolvedPath) : false,
    shadowSelectionResolvedPath,
    shadowSelectionExists: shadowSelectionResolvedPath
      ? await pathExists(shadowSelectionResolvedPath)
      : false,
    learnedPrimaryEvidenceResolvedPath,
    learnedPrimaryEvidenceExists: learnedPrimaryEvidenceResolvedPath
      ? await pathExists(learnedPrimaryEvidenceResolvedPath)
      : false,
  };
}

export async function setStorylinePlannerState(params: {
  projectRoot: string;
  storylinePlanner: Record<string, unknown>;
}): Promise<{
  state: StorylinePlannerState;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeStorylinePlannerState(manifest.storyline_planner);
  const patch = asRecord(params.storylinePlanner) ?? {};
  const next = normalizeStorylinePlannerState({
    ...serializeStorylinePlannerState(current),
    ...patch,
    last_updated_at:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ?? new Date().toISOString(),
  });
  manifest.storyline_planner = serializeStorylinePlannerState(next);
  await saveManifest(params.projectRoot, manifest);
  return { state: next };
}

export async function getTitleAbstractIntroWorkbenchStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: TitleAbstractIntroWorkbenchState;
  titleCandidatesResolvedPath: string | null;
  titleCandidatesExists: boolean;
  abstractWorkbenchResolvedPath: string | null;
  abstractWorkbenchExists: boolean;
  introWorkbenchResolvedPath: string | null;
  introWorkbenchExists: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = normalizeTitleAbstractIntroWorkbenchState(
    manifest.title_abstract_intro_workbench
  );
  const titleCandidatesResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.titleCandidatesPath
  );
  const abstractWorkbenchResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.abstractWorkbenchPath
  );
  const introWorkbenchResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.introWorkbenchPath
  );
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
  return (await getTheoryStateSummaryFromModule(params)) as {
    state: TheorySupportState;
    theoryStateResolvedPath: string | null;
    theoryStateExists: boolean;
    sourceTheoryNoteResolvedPath: string | null;
    sourceTheoryNoteExists: boolean;
    proofPacketDirResolvedPath: string | null;
    proofPacketCount: number;
    theoryFile: TheoryStateFile | null;
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
  return summarizeWritingContractStateFromModule({
    projectRoot: params.projectRoot,
    manifest,
    policy: params.policy,
  });
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
    proofObligationLedgerPath:
      pickString(patch, [
        "proofObligationLedgerPath",
        "proof_obligation_ledger_path",
      ]) ?? current.proofObligationLedgerPath,
    proofObligationStatus:
      normalizeStage(
        patch.proofObligationStatus ?? patch.proof_obligation_status
      ) ?? current.proofObligationStatus,
    blockingProofIssueCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "blockingProofIssueCount",
          "blocking_proof_issue_count",
        ]) ?? current.blockingProofIssueCount
      )
    ),
    counterexampleRedTeamStatus:
      normalizeStage(
        patch.counterexampleRedTeamStatus ??
          patch.counterexample_red_team_status
      ) ?? current.counterexampleRedTeamStatus,
    counterexampleRedTeamReportPath:
      pickString(patch, [
        "counterexampleRedTeamReportPath",
        "counterexample_red_team_report_path",
      ]) ?? current.counterexampleRedTeamReportPath,
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
    next.proofObligationLedgerPath =
      normalized.proof_obligation_ledger_path ?? next.proofObligationLedgerPath;
    next.blockingProofIssueCount =
      normalized.proof_obligations.filter(
        (obligation) =>
          ["critical", "high"].includes(obligation.severity) &&
          !["resolved", "waived", "closed"].includes(obligation.status)
      ).length + normalized.counterexample_red_team.blocking_findings.length;
    next.proofObligationStatus =
      next.blockingProofIssueCount > 0 ? "needs_revision" : "ready";
    next.counterexampleRedTeamStatus =
      normalized.counterexample_red_team.status ?? next.counterexampleRedTeamStatus;
    next.counterexampleRedTeamReportPath =
      normalized.counterexample_red_team.report_path ??
      next.counterexampleRedTeamReportPath;
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
  const blockingProofIssueCount =
    theoryFile.proof_obligations.filter(
      (obligation) =>
        ["critical", "high"].includes(obligation.severity) &&
        !["resolved", "waived", "closed"].includes(obligation.status)
    ).length + theoryFile.counterexample_red_team.blocking_findings.length;

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
    proofObligationLedgerPath:
      theoryFile.proof_obligation_ledger_path ??
      current.proofObligationLedgerPath,
    proofObligationStatus:
      blockingProofIssueCount > 0 ? "needs_revision" : "ready",
    blockingProofIssueCount,
    counterexampleRedTeamStatus:
      theoryFile.counterexample_red_team.status ??
      current.counterexampleRedTeamStatus,
    counterexampleRedTeamReportPath:
      theoryFile.counterexample_red_team.report_path ??
      current.counterexampleRedTeamReportPath,
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
  return (await getCitationIntegrityStateSummaryFromModule(params)) as {
    state: CitationIntegrityState;
    bibliographyResolvedPath: string | null;
    bibliographyExists: boolean;
    verificationReportResolvedPath: string | null;
    verificationReportExists: boolean;
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
  processStatus: string;
  missingSections: string[];
  staleSections: string[];
  nextSuggestedSection: string | null;
  rebuildNeeded: boolean;
  rebuildReason: string | null;
  progressSummary: string;
}> {
  const recovery = await restoreAuthoringArtifactsFromRecovery({
    projectRoot: params.projectRoot,
  }).catch(() => null);
  const manifest = await readManifestEnsured(params.projectRoot);
  if (
    writingSessionLooksRecoverableEmpty(manifest.writing_session as Record<string, unknown> | null) &&
    recovery?.store?.writingSession &&
    typeof recovery.store.writingSession === "object" &&
    !Array.isArray(recovery.store.writingSession)
  ) {
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
      manuscript_complete: ["manuscript_complete", "compile_ready", "ready_for_submit"].includes(
        process.processStatus
      ),
      compile_ready: ["compile_ready", "ready_for_submit"].includes(
        process.processStatus
      ),
      next_suggested_section: process.nextSuggestedSection,
      rebuild_needed: process.rebuildNeeded,
      rebuild_reason: process.rebuildReason,
      outline_ready: !["missing", "bootstrapping"].includes(process.processStatus),
    },
  }).catch(() => null);
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
    processStatus: process.processStatus,
    missingSections: process.missingSections,
    staleSections: process.staleSections,
    nextSuggestedSection: process.nextSuggestedSection,
    rebuildNeeded: process.rebuildNeeded,
    rebuildReason: process.rebuildReason,
    progressSummary: process.summary,
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
  const discoveredPdfPath =
    submittedPdfResolvedPath && (await pathExists(submittedPdfResolvedPath))
      ? submittedPdfResolvedPath
      : await findAnyPdfInDir(path.join(params.projectRoot, "academic_writer", "paper"));
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
  const stateFilePath = state.searchStatePath
    ? path.isAbsolute(state.searchStatePath)
      ? state.searchStatePath
      : path.join(params.projectRoot, state.searchStatePath)
    : getExperimentSearchPath(params.projectRoot);
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

export async function getExperimentGitReviewSummary(params: {
  projectRoot: string;
}): Promise<{
  reviewState: ReturnType<typeof normalizeExperimentSearchReviewState>;
  reviewSummary: string;
  reviewStatePath: string;
  reviewStateExists: boolean;
  searchState: ExperimentSearchState;
}> {
  const result = await getExperimentGitReviewSummaryImpl(params, {
    readManifestEnsured,
    saveManifest,
  });
  const reviewStatePath = getExperimentSearchReviewStatePath(
    params.projectRoot,
    result.reviewState.stateFilePath
  );
  return {
    reviewState: normalizeExperimentSearchReviewState(result.reviewState),
    reviewSummary: result.reviewSummary,
    reviewStatePath,
    reviewStateExists: await pathExists(reviewStatePath),
    searchState: result.searchState as ExperimentSearchState,
  };
}

export async function requestExperimentGitOp(params: {
  projectRoot: string;
  agentId?: string | null;
  request: Record<string, unknown>;
}): Promise<{
  reviewState: ReturnType<typeof normalizeExperimentSearchReviewState>;
  reviewSummary: string;
  searchState: ExperimentSearchState;
}> {
  const result = await requestExperimentGitOpImpl(params, {
    readManifestEnsured,
    saveManifest,
  });
  return {
    reviewState: normalizeExperimentSearchReviewState(result.reviewState),
    reviewSummary: result.reviewSummary,
    searchState: result.searchState as ExperimentSearchState,
  };
}

export async function setExperimentGitReviewState(params: {
  projectRoot: string;
  experimentGitReview: Record<string, unknown>;
}): Promise<{
  reviewState: ReturnType<typeof normalizeExperimentSearchReviewState>;
  reviewSummary: string;
  searchState: ExperimentSearchState;
}> {
  const result = await setExperimentGitReviewStateImpl(params, {
    readManifestEnsured,
    saveManifest,
  });
  return {
    reviewState: normalizeExperimentSearchReviewState(result.reviewState),
    reviewSummary: result.reviewSummary,
    searchState: result.searchState as ExperimentSearchState,
  };
}

export async function applyExperimentGitOp(params: {
  projectRoot: string;
  agentId?: string | null;
}): Promise<{
  gitResult: Record<string, unknown>;
  reviewState: ReturnType<typeof normalizeExperimentSearchReviewState>;
  searchState: ExperimentSearchState;
  ledgerEntry: ExperimentLedgerEntry | null;
}> {
  const result = await applyExperimentGitOpImpl(params, {
    readManifestEnsured,
    saveManifest,
  });
  let ledgerEntry: ExperimentLedgerEntry | null = null;
  const experimentId =
    result.reviewState.experimentId ??
    result.searchState.lastCandidateExperimentId ??
    result.searchState.incumbentExperimentId ??
    result.searchState.completedExperimentIds.at(-1) ??
    result.searchState.discardedExperimentIds.at(-1) ??
    result.gitResult.candidateBranch?.split("/").filter(Boolean).at(-1) ??
    null;
  if (
    experimentId &&
    (result.gitResult.actionType === "promote_candidate" ||
      result.gitResult.actionType === "discard_candidate")
  ) {
    const searchFailureClass =
      result.gitResult.actionType === "discard_candidate"
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
    const fixedBudgetMinutes = result.searchState.trialTimeBudgetMinutes;
    const trialContractDecision =
      result.gitResult.actionType === "promote_candidate" ? "advance" : "discard";
    const trialContractStatus =
      result.gitResult.actionType === "promote_candidate" ? "merged" : "completed";
    const manifest = await readManifestEnsured(params.projectRoot);
    const primaryMetricContractRecord =
      await loadExperimentPrimaryMetricContractRecord({
        projectRoot: params.projectRoot,
        manifest,
        searchState: result.searchState as ExperimentSearchState,
      });
    const ledgerResult = await upsertExperimentLedgerEntry({
      projectRoot: params.projectRoot,
      agentId: params.agentId ?? undefined,
      experiment: {
        experimentId,
        trackId:
          result.reviewState.trackId ?? result.searchState.trackId ?? null,
        status:
          result.gitResult.actionType === "promote_candidate"
            ? "merged"
            : "completed",
        decision:
          result.gitResult.actionType === "promote_candidate"
            ? "advance"
            : "discard",
        summary: result.gitResult.summary,
        note:
          result.reviewState.promotionEvidenceSummary ??
          result.reviewState.discardReason ??
          result.reviewState.pendingReason,
        metadata: {
          trial_contract: {
            contract_version: 1,
            source: "experiment_git_op",
            action_type: result.gitResult.actionType,
            status: trialContractStatus,
            decision: trialContractDecision,
            search_session_id:
              result.reviewState.searchSessionId ??
              result.searchState.searchSessionId,
            experiment_id: experimentId,
            track_id: result.reviewState.trackId ?? result.searchState.trackId ?? null,
            git_branch: result.gitResult.candidateBranch,
            worktree_path: result.gitResult.candidateWorktreePath,
            commit_hash: result.gitResult.candidateHeadCommit,
            base_commit: result.gitResult.candidateBaseCommit,
            incumbent_branch: result.gitResult.incumbentBranch,
            incumbent_commit: result.gitResult.incumbentCommit,
            fixed_budget_minutes: fixedBudgetMinutes,
            fixed_budget:
              fixedBudgetMinutes == null ? null : `${fixedBudgetMinutes}m`,
            primary_metric_contract: primaryMetricContractRecord,
            review_packet_path: result.reviewState.packetPath,
            promotion_basis_signals: result.reviewState.promotionBasisSignals,
            promotion_evidence_summary:
              result.reviewState.promotionEvidenceSummary,
            discard_reason: result.reviewState.discardReason,
            failure_class: searchFailureClass,
            applied_at: result.reviewState.appliedAt,
          },
          searchGit: {
            actionType: result.gitResult.actionType,
            searchSessionId:
              result.reviewState.searchSessionId ??
              result.searchState.searchSessionId,
            promotionBasisSignals: result.reviewState.promotionBasisSignals,
            promotionEvidenceSummary:
              result.reviewState.promotionEvidenceSummary,
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
          primaryMetricContract: primaryMetricContractRecord,
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

export async function runRuntimeManagedExperimentTrial(params: {
  projectRoot: string;
  agentId?: string | null;
  trigger?: string | null;
}): Promise<{
  status: string;
  gitActionApplied: boolean;
  gitResult: Record<string, unknown> | null;
  gitReviewState: ReturnType<typeof normalizeExperimentSearchReviewState> | null;
  localExecution: {
    generatedFiles: string[];
    experimentId: string | null;
    bundleDir: string | null;
    executed: boolean;
    skippedReason: string | null;
  };
  promotionGate: {
    status: string | null;
    readyForAnalysis: boolean;
    lastDecision: string | null;
    lastTrialOutcome: string | null;
    multiSeedStatus: string | null;
    plotPackStatus: string | null;
  };
  searchState: ExperimentSearchState;
  ledgerEntry: ExperimentLedgerEntry | null;
}> {
  const beforeGitReview = await getExperimentGitReviewSummary({
    projectRoot: params.projectRoot,
  });
  const pendingReviewedAction =
    beforeGitReview.reviewState.actionType &&
    beforeGitReview.reviewState.actionStatus !== "applied" &&
    beforeGitReview.searchState.requestedGitOp !== null;
  let appliedGitOp: Awaited<ReturnType<typeof applyExperimentGitOp>> | null = null;
  if (pendingReviewedAction) {
    appliedGitOp = await applyExperimentGitOp({
      projectRoot: params.projectRoot,
      agentId: params.agentId,
    });
  }

  const appliedActionType =
    typeof appliedGitOp?.gitResult?.actionType === "string"
      ? appliedGitOp.gitResult.actionType
      : null;
  const shouldMaterializeLocalTrial =
    !appliedActionType || appliedActionType === "create_candidate_worktree";
  const localExecution = shouldMaterializeLocalTrial
    ? await materializeLocalExperimentExecutionImpl({
        projectRoot: params.projectRoot,
        trigger: params.trigger ?? "run_experiment_trial",
        agentId: params.agentId ?? null,
      })
    : {
        generatedFiles: [],
        experimentId: null,
        bundleDir: null,
        executed: false,
      };
  const afterSearch = await getExperimentSearchStateSummary({
    projectRoot: params.projectRoot,
  });
  const status =
    localExecution.executed || localExecution.generatedFiles.length > 0
      ? "trial_completed"
      : appliedGitOp
        ? "git_action_applied"
        : "waiting_for_trial_artifacts";
  return {
    status,
    gitActionApplied: Boolean(appliedGitOp),
    gitResult: appliedGitOp?.gitResult ?? null,
    gitReviewState: appliedGitOp?.reviewState ?? beforeGitReview.reviewState,
    localExecution: {
      ...localExecution,
      skippedReason: shouldMaterializeLocalTrial
        ? null
        : `git_action_${appliedActionType}_applied`,
    },
    promotionGate: {
      status: afterSearch.state.status,
      readyForAnalysis: afterSearch.readyForAnalysis,
      lastDecision: afterSearch.state.lastDecision,
      lastTrialOutcome: afterSearch.state.lastTrialOutcome,
      multiSeedStatus: afterSearch.state.multiSeedStatus,
      plotPackStatus: afterSearch.state.plotPackStatus,
    },
    searchState: afterSearch.state,
    ledgerEntry: appliedGitOp?.ledgerEntry ?? null,
  };
}

export async function getExperimentReviewStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: ExperimentReviewState;
  autonomousExecution: AutonomousExecutionState;
  stateFilePath: string;
  stateFileExists: boolean;
  packetResolvedPath: string | null;
  packetExists: boolean;
  plannerPlanResolvedPath: string | null;
  plannerPlanExists: boolean;
  analyzerReportResolvedPath: string | null;
  analyzerReportExists: boolean;
  crossReviewerReportResolvedPath: string | null;
  crossReviewerReportExists: boolean;
  launchDecisionResolvedPath: string | null;
  launchDecisionExists: boolean;
  reviewedAutoLaunchEnabled: boolean;
  summary: string;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const state = (await loadExperimentReviewState({
    projectRoot: params.projectRoot,
    manifest,
  })) as ExperimentReviewState;
  const autonomousExecution = normalizeAutonomousExecutionState(
    manifest.autonomous_execution
  ) as AutonomousExecutionState;
  const stateFilePath = getExperimentReviewStatePath(params.projectRoot);
  const packetResolvedPath = resolveProjectArtifactPath(params.projectRoot, state.packetPath);
  const plannerPlanResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.plannerPlanPath
  );
  const analyzerReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.analyzerReportPath
  );
  const crossReviewerReportResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.crossReviewerReportPath
  );
  const launchDecisionResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    state.launchDecisionPath
  );
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
    reviewedAutoLaunchEnabled: isReviewedAutoExperimentLaunchEnabled(
      manifest.autonomous_execution
    ),
    summary: buildExperimentReviewSummary(state),
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
  return (await getPaperQcStateSummaryFromModule(params)) as {
    state: PaperQcState;
    latestReportResolvedPath: string | null;
    latestReportExists: boolean;
    hardFailure: boolean;
  };
}

export async function getPaperIngestionStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: PaperIngestionState;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  return summarizePaperIngestionStateFromModule({
    manifest,
  });
}

export async function getPapernexusProgressSummary(params: {
  projectRoot: string;
}): Promise<{
  progress: PapernexusProgressSnapshot | null;
  summary: string | null;
}> {
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

export async function queuePaperIngestionRequest(params: {
  projectRoot: string;
  paperIngestionRequest: Record<string, unknown>;
}): Promise<{
  state: PaperIngestionState;
  request: PaperIngestionQueuedRequest;
}> {
  const patch = asRecord(params.paperIngestionRequest) ?? {};
  const normalized = normalizePaperIngestionQueuedRequest({
    ...patch,
    request_id:
      pickString(patch, ["requestId", "request_id"]) ?? randomUUID(),
    status:
      pickString(patch, ["status"]) ??
      "queued",
    created_at:
      pickString(patch, ["createdAt", "created_at"]) ?? new Date().toISOString(),
    updated_at:
      pickString(patch, ["updatedAt", "updated_at"]) ?? new Date().toISOString(),
  });
  if (!normalized) {
    throw new Error(
      "paperIngestionRequest must include at least a wrapper/command_text/manifest_path/summary."
    );
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
  }).catch((): PaperIngestionValidationReport | null => null);
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
  const request =
    result.state.queuedRequests.find((entry) => entry.requestId === prepared.requestId) ??
    prepared;
  return {
    state: result.state,
    request,
  };
}

export async function validatePaperIngestionRequest(params: {
  projectRoot: string;
  requestId?: string | null;
  paperIngestionRequest?: Record<string, unknown> | null;
  persist?: boolean;
}): Promise<{
  report: PaperIngestionValidationReport;
  request: PaperIngestionQueuedRequest;
  state: PaperIngestionState | null;
}> {
  let request: PaperIngestionQueuedRequest | null = null;
  if (params.paperIngestionRequest) {
    request = normalizePaperIngestionQueuedRequest({
      ...params.paperIngestionRequest,
      request_id:
        pickString(params.paperIngestionRequest, ["requestId", "request_id"]) ??
        randomUUID(),
      status:
        pickString(params.paperIngestionRequest, ["status"]) ?? "queued",
      created_at:
        pickString(params.paperIngestionRequest, ["createdAt", "created_at"]) ??
        new Date().toISOString(),
      updated_at:
        pickString(params.paperIngestionRequest, ["updatedAt", "updated_at"]) ??
        new Date().toISOString(),
    });
  } else {
    const current = await getPaperIngestionStateSummary({
      projectRoot: params.projectRoot,
    });
    request =
      (params.requestId
        ? current.state.queuedRequests.find((entry) => entry.requestId === params.requestId)
        : current.state.queuedRequests.find((entry) =>
            ["queued", "needs_repair", "launching", "running"].includes(entry.status)
          )) ?? null;
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
    request:
      result.state.queuedRequests.find((entry) => entry.requestId === patchedRequest.requestId) ??
      patchedRequest,
    state: result.state,
  };
}

export async function auditLiteratureCoverageForWorkflow(params: {
  projectRoot: string;
}): Promise<{
  audit: LiteratureCoverageAudit;
}> {
  return {
    audit: await auditLiteratureCoverage({
      projectRoot: params.projectRoot,
    }),
  };
}

export async function planCitationExpansionForWorkflow(params: {
  projectRoot: string;
  maxSeeds?: number | null;
}): Promise<{
  packet: CitationExpansionPacket;
}> {
  return {
    packet: await planCitationExpansion({
      projectRoot: params.projectRoot,
      maxSeeds: params.maxSeeds,
    }),
  };
}

export async function runBroadPaperSearchForWorkflow(params: {
  projectRoot: string;
  topic: string;
  depth?: "quick" | "default" | "deep";
  maxQueries?: number | null;
  maxResultsPerQuery?: number | null;
  maxIndexEntries?: number | null;
  maxResolutionAttempts?: number | null;
  providers?: BroadPaperProviderName[] | null;
  queryPlan?: BroadPaperSearchQuery[] | null;
  preferredVenuePacks?: string[] | null;
}): Promise<Awaited<ReturnType<typeof runBroadPaperSearch>>> {
  return runBroadPaperSearch({
    projectRoot: params.projectRoot,
    topic: params.topic,
    depth: params.depth,
    maxQueries:
      typeof params.maxQueries === "number" && Number.isFinite(params.maxQueries)
        ? Math.floor(params.maxQueries)
        : undefined,
    maxResultsPerQuery:
      typeof params.maxResultsPerQuery === "number" &&
      Number.isFinite(params.maxResultsPerQuery)
        ? Math.floor(params.maxResultsPerQuery)
        : undefined,
    maxIndexEntries:
      typeof params.maxIndexEntries === "number" && Number.isFinite(params.maxIndexEntries)
        ? Math.floor(params.maxIndexEntries)
        : undefined,
    maxResolutionAttempts:
      typeof params.maxResolutionAttempts === "number" &&
      Number.isFinite(params.maxResolutionAttempts)
        ? Math.floor(params.maxResolutionAttempts)
        : undefined,
    providers: params.providers?.length ? params.providers : undefined,
    queryPlan: params.queryPlan?.length ? params.queryPlan : undefined,
    preferredVenuePacks: params.preferredVenuePacks?.length
      ? params.preferredVenuePacks
      : undefined,
  });
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
  return (await getCitationCollectionStateSummaryFromModule(params)) as {
    state: CitationCollectionState;
    progressResolvedPath: string | null;
    progressExists: boolean;
    cacheBibResolvedPath: string | null;
    cacheBibExists: boolean;
    hardFailure: boolean;
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
  return (await getFigureQcStateSummaryFromModule(params)) as {
    state: FigureQcState;
    figureReviewResolvedPath: string | null;
    figureReviewExists: boolean;
    figureSelectionResolvedPath: string | null;
    figureSelectionExists: boolean;
    hardFailure: boolean;
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
  return (await getReviewIssueTrackerStateSummaryFromModule(params)) as {
    state: ReviewIssueTrackerState;
    issueManifestResolvedPath: string | null;
    issueManifestExists: boolean;
    hardBlockersOpen: boolean;
    mediumOrHigherIssuesNeedDisposition: boolean;
    surfaceIssueCount: number;
    submissionIssueCount: number;
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
  return await setIdleResearchStateFromModule(params);
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
  return await setWritingContractStateFromModule(params);
}

export async function setWritingSessionState(params: {
  projectRoot: string;
  writingSession: Record<string, unknown>;
}): Promise<{
  state: WritingSessionState;
  currentSectionPacketResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  return await setWritingSessionStateFromModule(params);
}

export async function setReviewSessionState(params: {
  projectRoot: string;
  reviewSession: Record<string, unknown>;
}): Promise<{
  state: ReviewSessionState;
  reviewPacketResolvedPath: string | null;
  latestReviewResolvedPath: string | null;
}> {
  return await setReviewSessionStateFromModule(params);
}

function deriveResearchMemoryReviewVerdict(
  value: string | null | undefined
): "ready" | "almost" | "not ready" {
  const normalized = normalizeStage(value);
  if (normalized && ["ready", "publication_ready", "accept", "accepted"].includes(normalized)) {
    return "ready";
  }
  if (
    normalized &&
    ["almost", "almost_ready", "minor_revision", "needs_revision", "revise"].includes(
      normalized
    )
  ) {
    return "almost";
  }
  return "not ready";
}

function deriveResearchMemoryReviewScore(reviewSession: ReviewSessionState): number {
  const rubricValues = Object.values(reviewSession.rubric).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (rubricValues.length > 0) {
    const average =
      rubricValues.reduce((sum, value) => sum + value, 0) / rubricValues.length;
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

export async function setGraphGuidedWritingState(params: {
  projectRoot: string;
  graphGuidedWriting: Record<string, unknown>;
}): Promise<{
  state: GraphGuidedWritingState;
  anchorIndexResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  return await setGraphGuidedWritingStateFromModule(params);
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
  return await setExternalReviewStateFromModule(params);
}

export async function setBrainstormCycleState(params: {
  projectRoot: string;
  brainstormCycle: Record<string, unknown>;
}): Promise<{
  state: BrainstormCycleState;
  validationErrors: string[];
  chainBundleReady: boolean;
}> {
  return await setBrainstormCycleStateFromModule(params);
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
  const requestedProviderStatus = normalizeStage(
    patch.providerStatus ?? patch.provider_status
  );
  const next = normalizeBrainstormCycleState({
    ...serializeBrainstormCycleState(current),
    ...patch,
    mode: pickString(patch, ["mode"]) ?? current.mode,
    track_id: trackId,
    provider:
      pickString(patch, ["provider"]) ?? current.provider ?? "workflow_core_brainstorm",
    provider_mode:
      pickString(patch, ["providerMode", "provider_mode"]) ??
      current.providerMode ??
      "core",
    provider_status:
      (requestedProviderStatus === "completed" ? "ready" : requestedProviderStatus) ??
      (selection ? "ready" : current.providerStatus) ??
      (isBrainstormCycleReady(current) ? "ready" : "pending"),
    provider_last_run_at:
      pickString(patch, ["providerLastRunAt", "provider_last_run_at"]) ??
      new Date().toISOString(),
    provider_last_error:
      pickString(patch, ["providerLastError", "provider_last_error"]) ??
      (selection ? null : current.providerLastError),
    contract_version:
      pickNumber(patch, ["contractVersion", "contract_version"]) ??
      current.contractVersion ??
      1,
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
  onboardingStatus: string;
  onboardingGaps: string[];
}> {
  return await setResearchProgramStateFromModule(params);
}

export async function materializeExperimentReviewState(params: {
  projectRoot: string;
  experimentReviewMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: ExperimentReviewState;
  stateFilePath: string;
  stateFileExists: boolean;
  packetResolvedPath: string | null;
  packetExists: boolean;
  generatedFiles: string[];
}> {
  return materializeExperimentReviewStateImpl(params, {
    readManifestEnsured,
    saveManifest,
  });
}

export async function materializePlanState(params: {
  projectRoot: string;
  planMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: ResearchProgramState;
  validationErrors: string[];
  onboardingStatus: string;
  onboardingGaps: string[];
  generatedDefaults: string[];
  generatedFiles: string[];
}> {
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
    generatedFiles: result.generatedFiles,
  };
}

export async function materializeCodeExperimentBundle(params: {
  projectRoot: string;
  codeMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  generatedFiles: string[];
  experimentId: string | null;
  trackId: string | null;
  bundleDir: string | null;
}> {
  return materializeCodeExperimentBundleImpl(params);
}

export async function setExperimentReviewState(params: {
  projectRoot: string;
  experimentReview: Record<string, unknown>;
}): Promise<{
  state: ExperimentReviewState;
  stateFilePath: string;
  stateFileExists: boolean;
}> {
  return await setExperimentReviewStateFromModule(params);
}

function normalizeMarkdownSignalLine(rawLine: string): string | null {
  const normalized = rawLine
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function collectMarkdownSignalLines(rawText: string | null, options?: {
  includeSectionsContaining?: string[];
}): string[] {
  if (!rawText) {
    return [];
  }
  const filters = (options?.includeSectionsContaining ?? []).map((value) =>
    value.trim().toLowerCase()
  );
  const matches: string[] = [];
  let currentHeading: string | null = null;
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

function slugifyIdeationLabel(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "direction";
}

function quoteMarkdownText(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "N/A";
}

function renderMarkdownBulletList(items: string[]): string {
  if (items.length === 0) {
    return "- N/A\n";
  }
  return `${items.map((item) => `- ${item}`).join("\n")}\n`;
}

function clampUnitScore(value: number | null | undefined, fallback: number): number {
  const candidate = Number.isFinite(value ?? NaN) ? Number(value) : fallback;
  return Math.max(0, Math.min(1, candidate));
}

function averageScores(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveResearchProgramTrack(
  manifest: ManifestLike | null,
  trackId: string | null
): Record<string, unknown> | null {
  if (!trackId) {
    return null;
  }
  const researchProgram = normalizeResearchProgramState(manifest?.research_program);
  return (
    researchProgram.tracks.find((track) => track.trackId === trackId)
      ? serializeResearchProgramTrack(
          researchProgram.tracks.find((track) => track.trackId === trackId)!
        )
      : null
  );
}

async function mergeJsonArtifact(
  resolvedPath: string | null,
  merge: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  if (!resolvedPath) {
    return;
  }
  const current = (await readJsonIfExists<Record<string, unknown>>(resolvedPath)) ?? {};
  await writeJsonEnsured(resolvedPath, merge(current));
}

export async function materializeIdeationContract(params: {
  projectRoot: string;
  ideationMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
  generatedFiles: string[];
}> {
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
    normalizeInnovationReflectionState: (value) =>
      normalizeInnovationReflectionState(value) as unknown as Record<string, unknown>,
    serializeInnovationReflectionState: (value) =>
      serializeInnovationReflectionState(
        value as unknown as InnovationReflectionState
      ) as Record<string, unknown>,
  });
}

export async function setIdeationContractState(params: {
  projectRoot: string;
  ideationContract: Record<string, unknown>;
}): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
}> {
  return await setIdeationContractStateFromModule(params);
}

export async function materializePaperStoryState(params: {
  projectRoot: string;
  paperStoryMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
  fallbackNarrativeResolvedPath: string | null;
  fallbackNarrativeExists: boolean;
  generatedFiles: string[];
}> {
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
    isIdeationContractReady: (state) =>
      isIdeationContractReady(state as IdeationContractState),
  });
}

export async function materializeReviewPressurePacket(params: {
  projectRoot: string;
  reviewPressureMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
  generatedFiles: string[];
}> {
  return materializeReviewPressurePacketImpl(params, {
    readManifestEnsured,
    saveManifest,
    getPaperStoryStateSummary,
    getIdeationContractStateSummary,
    getReviewPressurePacketStateSummary,
    quoteMarkdownText,
    renderMarkdownBulletList,
    collectMarkdownSignalLines,
    isPaperStoryStateReady: (state) => isPaperStoryStateReady(state as PaperStoryState),
  });
}

export async function materializeInnovationSynthesisState(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: InnovationSynthesisState;
  storyGapSearch: StoryGapSearchRequisitionState | null;
  generatedFiles: string[];
}> {
  return materializeInnovationSynthesis(params);
}

export async function materializeResultsStorylineState(params: {
  projectRoot: string;
  stage?: string | null;
  promptConfigPath?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): Promise<{
  state: ResultsStorylineState;
  generatedFiles: string[];
}> {
  return materializeResultsStoryline(params);
}

export async function materializeStorylinePlannerState(params: {
  projectRoot: string;
  topic?: string | null;
  configuredMode?: "heuristic" | "reviewer_judged" | "learned_shadow" | "learned_primary" | null;
  learnedModelPath?: string | null;
}): Promise<Awaited<ReturnType<typeof materializeSurveyStorylinePlanner>>> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const surveyReview = normalizeSurveyReviewState(manifest.survey_review);
  const storylinePlanner = normalizeStorylinePlannerState(manifest.storyline_planner);
  const result = await materializeSurveyStorylinePlanner({
    projectRoot: params.projectRoot,
    topic: params.topic ?? surveyReview.topic,
    configuredMode:
      params.configuredMode ??
      (storylinePlanner.configuredMode as
        | "heuristic"
        | "reviewer_judged"
        | "learned_shadow"
        | "learned_primary"
        | null) ??
      "reviewer_judged",
    learnedModelPath: params.learnedModelPath ?? storylinePlanner.learnedModelPath,
  });
  manifest.storyline_planner = serializeStorylinePlannerState(result.state);
  await saveManifest(params.projectRoot, manifest);
  return result;
}

export async function materializeTitleAbstractIntroWorkbenchState(params: {
  projectRoot: string;
  stage?: string | null;
  promptConfigPath?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): Promise<{
  state: TitleAbstractIntroWorkbenchState;
  generatedFiles: string[];
}> {
  return materializeTitleAbstractIntroWorkbench(params);
}

export async function materializeFigurePromptContractState(params: {
  projectRoot: string;
  figurePromptContractMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<Awaited<ReturnType<typeof materializeFigurePromptContract>>> {
  return materializeFigurePromptContract(params);
}

export async function materializeScientificEditingPassPlanState(params: {
  projectRoot: string;
  scientificEditingMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<Awaited<ReturnType<typeof materializeScientificEditingPassPlan>>> {
  return materializeScientificEditingPassPlan(params);
}

export async function recordScientificEditingPassResultState(params: {
  projectRoot: string;
  scientificEditingPassResult?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
  operationId?: string | null;
}): Promise<Awaited<ReturnType<typeof recordScientificEditingPassResult>>> {
  return recordScientificEditingPassResult(params);
}

export async function materializeLiteratureDiscoveryPacket(params: {
  projectRoot: string;
  literatureDiscoveryMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  required: boolean;
  packetPath: string;
  packet: Record<string, unknown> | null;
}> {
  return materializeLiteratureDiscoveryPacketImpl(params);
}

export async function materializeSurveyReviewState(params: {
  projectRoot: string;
  surveyReviewMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: SurveyReviewState;
  generatedFiles: string[];
}> {
  return materializeSurveyReviewStateImpl(params);
}

export async function setPaperStoryState(params: {
  projectRoot: string;
  paperStoryState: Record<string, unknown>;
}): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
}> {
  return await setPaperStoryStateFromModule(params);
}

export async function setSurveyReviewState(params: {
  projectRoot: string;
  surveyReview: Record<string, unknown>;
}): Promise<{
  state: SurveyReviewState;
  ready: boolean;
}> {
  return await setSurveyReviewStateFromModule(params);
}

export async function setReviewPressurePacketState(params: {
  projectRoot: string;
  reviewPressurePacket: Record<string, unknown>;
}): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
}> {
  return await setReviewPressurePacketStateFromModule(params);
}

export async function setOrchestrationState(params: {
  projectRoot: string;
  orchestrationState: Record<string, unknown>;
}): Promise<{
  state: OrchestrationState;
  validationErrors: string[];
}> {
  return await setOrchestrationStateFromModule(params);
}

export async function setWritePackageState(params: {
  projectRoot: string;
  writePackage: Record<string, unknown>;
}): Promise<{
  state: WritePackageState;
  validationErrors: string[];
}> {
  return await setWritePackageStateFromModule(params);
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
  return await setExperimentSearchStateFromModule(params);
}

export async function setPaperQcState(params: {
  projectRoot: string;
  paperQc: Record<string, unknown>;
}): Promise<{
  state: PaperQcState;
  latestReportResolvedPath: string | null;
  hardFailure: boolean;
}> {
  return await setPaperQcStateFromModule(params);
}

export async function setPaperIngestionState(params: {
  projectRoot: string;
  paperIngestion: Record<string, unknown>;
}): Promise<{
  state: PaperIngestionState;
  newlyCompletedPapers: PaperIngestionCompletedPaper[];
  newlyTerminalPaperOperations: PaperIngestionPaperOperation[];
  newlyTerminalBatches: PaperIngestionBatchRun[];
}> {
  return await setPaperIngestionStateFromModule(params);
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
  return await setCitationCollectionStateFromModule(params);
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
  return await setFigureQcStateFromModule(params);
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
  return await setReviewIssueTrackerStateFromModule(params);
}

export async function recordCitationVerification(params: {
  projectRoot: string;
  citationVerification: Record<string, unknown>;
}): Promise<{
  state: CitationIntegrityState;
  bibliographyResolvedPath: string | null;
  verificationReportResolvedPath: string | null;
}> {
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
  } as any);
  await scaffoldMarkdownArtifactIfMissing(
    result.verificationReportResolvedPath,
    [
      "# Citation Verification",
      "",
      `Verification Status: ${result.state.verificationStatus ?? "unknown"}`,
      `Bibliography Entries: ${result.state.bibliographyEntryCount ?? 0}`,
      `Minimum Citation Count: ${result.state.minimumCitationCount ?? 0}`,
      `Bibliography Pages: ${result.state.bibliographyPageCount ?? 0}`,
      `All Citations Real: ${result.state.allCitationsReal ? "yes" : "no"}`,
      `Verified Citations: ${result.state.verifiedCitationCount}`,
      `Suspicious Citations: ${result.state.suspiciousCitationCount}`,
      `Hallucinated Citations: ${result.state.hallucinatedCitationCount}`,
      `Topic Relevance Topic: ${result.state.topicRelevanceTopic ?? "unset"}`,
      `Topic Relevance Status: ${result.state.topicRelevanceStatus ?? "unknown"}`,
      `Relevant Citations: ${result.state.relevantCitationCount ?? 0}`,
      `Off-Topic Citations: ${result.state.offTopicCitationCount ?? 0}`,
      `Topic Relevance Summary: ${result.state.topicRelevanceSummary ?? "none"}`,
      `Unresolved Placeholders: ${result.state.unresolvedPlaceholderCount}/${result.state.allowedPlaceholderCount}`,
      `Last Verified At: ${result.state.lastVerifiedAt ?? "unset"}`,
      `Pending Reason: ${result.state.pendingReason ?? "none"}`,
    ].join("\n")
  );
  return {
    ...result,
    state: result.state as CitationIntegrityState,
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
  } as any);
  return {
    ...result,
    state: result.state as IdleResearchState,
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
  } as any);
  return {
    ...result,
    state: result.state as InnovationReflectionState,
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
  } as any);
  return {
    ...result,
    summary: result.summary as ExperimentLedgerSummary,
    recentExperiments: result.recentExperiments as ExperimentMemoryDigest[],
  };
}

export async function getExperimentGpuMonitorStateSummary(params: {
  projectRoot: string;
}): Promise<{
  state: Awaited<
    ReturnType<typeof getExperimentGpuMonitorStateSummaryImpl>
  >["state"];
  ready: boolean;
}> {
  return getExperimentGpuMonitorStateSummaryImpl(params);
}

export async function refreshExperimentGpuMonitor(params: {
  projectRoot: string;
  server?: string | null;
  servers?: string[] | null;
  sshTimeoutMs?: number;
}): Promise<{
  state: Awaited<ReturnType<typeof refreshExperimentGpuMonitorImpl>>["state"];
  monitorPath: string;
}> {
  return refreshExperimentGpuMonitorImpl(params);
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
  const experimentId =
    pickString(params.experiment, ["experimentId", "experiment_id", "id"]) ?? null;
  const trackId =
    pickString(params.experiment, ["trackId", "track_id"]) ?? null;
  const currentMetadata = asRecord(params.experiment.metadata) ?? {};
  const hasDatasetMetadata =
    asStringArray(currentMetadata.datasets).length > 0 ||
    asStringArray(currentMetadata.dataset_names).length > 0 ||
    asStringArray(currentMetadata.validation_datasets).length > 0;
  const hasExecutionMetadata =
    asRecord(currentMetadata.execution)?.run_id != null ||
    asRecord(currentMetadata.execution)?.git_commit != null ||
    asRecord(currentMetadata.execution)?.candidate_commit != null ||
    asRecord(currentMetadata.execution)?.remote_run_path != null;
  let enrichedExperiment = params.experiment;
  if ((!hasDatasetMetadata || !hasExecutionMetadata) && experimentId) {
    const bundle = await findExperimentBundle({
      projectRoot: params.projectRoot,
      experimentId,
      trackId,
    });
    const derivedMetadata = await buildExperimentMetadataFromBundleManifest({
      projectRoot: params.projectRoot,
      record: bundle?.record ?? null,
      bundleDir: bundle?.dir ?? null,
    });
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
  const result = await upsertExperimentLedgerEntryImpl(
    {
      ...params,
      experiment: enrichedExperiment,
    },
    {
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
  } as any);
  await materializeExperimentMemoryPacket({
    projectRoot: params.projectRoot,
  });
  return {
    entry: result.entry as ExperimentLedgerEntry,
    summary: result.summary as ExperimentLedgerSummary,
    recentExperiments: result.recentExperiments as ExperimentMemoryDigest[],
  };
}

export async function materializeExperimentMemoryPacket(params: {
  projectRoot: string;
  experimentMemoryMaterialization?: Record<string, unknown>;
}): Promise<{
  packetPath: string;
  syncStatusPath: string;
  packet: Record<string, unknown>;
  syncStatus: Record<string, unknown>;
  searchStatePath: string;
}> {
  return await materializeExperimentMemoryPacketImpl(params, {
    readManifestEnsured,
    saveManifest,
    readExperimentLedgerEnsured,
  });
}

async function canonicalizeExistingWorkflowProjectRoot(projectRoot: string): Promise<string> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  try {
    await fs.stat(path.join(resolvedProjectRoot, "PROJECT_MANIFEST.json"));
    const projectRootStat = await fs.lstat(resolvedProjectRoot);
    return projectRootStat.isSymbolicLink()
      ? await fs.realpath(resolvedProjectRoot)
      : resolvedProjectRoot;
  } catch {
    return resolvedProjectRoot;
  }
}

export async function runWorkflowAutoIterator(params: {
  projectRoot: string;
  agentId?: string;
  mode?: string;
  queueMailbox?: boolean;
  cooldownSeconds?: number;
  policy?: WorkflowGuardPolicy;
  now?: string;
  requesterSessionKey?: string | null;
  sessionBindingKey?: string | null;
}): Promise<AutoIteratorResult> {
  const projectRoot = await canonicalizeExistingWorkflowProjectRoot(params.projectRoot);
  const iteratorParams =
    projectRoot === params.projectRoot ? params : { ...params, projectRoot };
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const rawExistingAudit = normalizeWorkflowAutoIteratorAudit(
    await readJsonIfExists<Record<string, unknown>>(getAutoIteratorAuditPath(projectRoot))
  );
  const existingAudit = deriveEffectiveWorkflowAutoIteratorAudit({
    audit: rawExistingAudit,
    now: startedAt,
  });
  if (rawExistingAudit?.status === "started" && existingAudit?.status === "started" && existingAudit.runId && existingAudit.runId !== runId) {
    await writeAutoIteratorAuditLifecycle({
      projectRoot,
      runId: existingAudit.runId,
      status: "superseded",
      startedAt: existingAudit.startedAt,
      updatedAt: startedAt,
      summary: `Auto iterator run ${existingAudit.runId} was superseded by newer run ${runId}.`,
      error: existingAudit.error,
    });
  } else if (
    rawExistingAudit?.status === "started" &&
    existingAudit?.status === "timed_out" &&
    existingAudit.runId &&
    existingAudit.runId !== runId
  ) {
    await writeAutoIteratorAuditLifecycle({
      projectRoot,
      runId: existingAudit.runId,
      status: "timed_out",
      startedAt: existingAudit.startedAt,
      updatedAt: startedAt,
      summary:
        existingAudit.summary ??
        `Auto iterator run ${existingAudit.runId} timed out before newer run ${runId} started.`,
      error: existingAudit.error,
    });
  }
  await writeAutoIteratorAuditLifecycle({
    projectRoot,
    runId,
    status: "started",
    startedAt,
    updatedAt: startedAt,
    summary: `Auto iterator started for ${params.mode ?? "default"} mode.`,
  });
  try {
    return await runWorkflowAutoIteratorImpl(iteratorParams, {
      normalizePolicy,
      loadExperimentLedgerIfExists,
      readGateState,
      normalizeRole,
      inferProjectId,
      normalizeWritePackageState,
      assembleWritePackage,
      checkGraphPresenceForWorkflow,
      materializeGraphBuildPaperSources: maybeMaterializeGraphBuildPaperSources,
      advanceLiteratureDiscoveryRequisition,
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
      materializeStorylinePlannerState,
      materializePaperStoryState,
      materializeExperimentReviewState,
      materializeReviewPressurePacket,
      materializeSurveyReviewState,
      materializeInnovationSynthesisState,
      materializeResultsStoryline: materializeResultsStorylineState,
      materializeTitleAbstractIntroWorkbench:
        materializeTitleAbstractIntroWorkbenchState,
    } as any);
  } catch (error) {
    const failedAt = new Date().toISOString();
    await writeAutoIteratorAuditLifecycle({
      projectRoot,
      runId,
      status: "failed",
      startedAt,
      updatedAt: failedAt,
      failedAt,
      summary:
        error instanceof Error
          ? error.message
          : "Auto iterator failed before a terminal result was recorded.",
      error,
    });
    throw error;
  }
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

function assertWorkflowChannelBindingProjectsRootConfigured(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
}): void {
  const policy = normalizePolicy(params.policy as Record<string, unknown> | undefined);
  if (!policy.enableChannelProjectBindings) {
    return;
  }
  const projectsRoot = getConfiguredProjectsRoot({
    policy,
    workspaceDir: params.workspaceDir,
  });
  if (projectsRoot) {
    return;
  }
  throw new Error(
    "Channel-project bindings require ClawAutoResearch projectsRoot (or OPENCLAW_PROJECTS_ROOT); workspace fallback is disabled for workflow project resolution."
  );
}

export function getChannelProjectBindingForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
}) {
  assertWorkflowChannelBindingProjectsRootConfigured(params);
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
  assertWorkflowChannelBindingProjectsRootConfigured(params);
  return listChannelProjectBindings({
    policy: params.policy,
    context: {
      workspaceDir: params.workspaceDir,
    },
  });
}

async function recordNotificationOnlyChannelForWorkflow(params: {
  projectRoot: string;
  projectId?: string | null;
  messageChannel?: string | null;
  channelKey?: string | null;
  sessionKey?: string | null;
  source: string;
  notes?: string | null;
}) {
  const notificationChannel = await recordWorkflowNotificationChannelForProject({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    messageChannel: params.messageChannel,
    channelKey: params.channelKey,
    sessionKey: params.sessionKey,
    source: params.source,
    notes: params.notes,
  });
  return {
    notificationOnly: true,
    reason: "notification_only_channel",
    notificationStorePath: getWorkflowNotificationChannelsPath(params.projectRoot),
    notificationChannel,
  };
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
  runtimeSession?: WorkflowRuntimeSessionBinding | null;
}) {
  assertWorkflowChannelBindingProjectsRootConfigured(params);
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
  if (
    !shouldUseChannelProjectBindingForWorkflow({
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      sessionKey: params.sessionKey,
    })
  ) {
    const notificationOnly = await recordNotificationOnlyChannelForWorkflow({
      projectRoot: ensuredProject.projectRoot,
      projectId: params.projectId ?? ensuredProject.projectId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      sessionKey: params.sessionKey,
      source: "bind_channel_project",
      notes:
        params.notes ??
        "Channel is notification-only for workflow project binding.",
    });
    return {
      enabled: false,
      storePath: notificationOnly.notificationStorePath,
      binding: null,
      projectRoot: ensuredProject.projectRoot,
      projectId: params.projectId ?? ensuredProject.projectId,
      ...notificationOnly,
    };
  }
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
  runtimeSession?: WorkflowRuntimeSessionBinding | null;
}) {
  assertWorkflowChannelBindingProjectsRootConfigured(params);
  if (
    !shouldUseChannelProjectBindingForWorkflow({
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      sessionKey: params.sessionKey,
    })
  ) {
    const projectRoot =
      params.projectRoot ??
      getProjectRoot({
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        messageChannel: params.messageChannel,
        channelKey: undefined,
        policy: params.policy,
      });
    if (!projectRoot) {
      return {
        autoBound: false,
        reason: "notification_only_channel_without_project_root",
        storePath: "",
        binding: null,
        notificationOnly: true,
      };
    }
    const notificationOnly = await recordNotificationOnlyChannelForWorkflow({
      projectRoot,
      projectId: params.projectId,
      messageChannel: params.messageChannel,
      channelKey: params.channelKey,
      sessionKey: params.sessionKey,
      source: "ensure_channel_project_binding",
      notes:
        params.notes ??
        "Channel is notification-only for workflow project binding.",
    });
    return {
      autoBound: false,
      storePath: notificationOnly.notificationStorePath,
      binding: null,
      ...notificationOnly,
    };
  }
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

export async function unbindChannelProjectForWorkflow(params: {
  policy?: WorkflowGuardPolicy;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
}) {
  assertWorkflowChannelBindingProjectsRootConfigured(params);
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
