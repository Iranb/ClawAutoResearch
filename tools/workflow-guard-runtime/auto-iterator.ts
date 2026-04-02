import * as path from "node:path";
import {
  asRecord,
  asString,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  deriveGraphBuildMicroStage,
  normalizePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import type { GraphPresenceCheckResult } from "../graph-presence";
import type {
  AutoIteratorAction,
  AutoIteratorResult,
  WorkflowGuardPolicy,
} from "../workflow-guard.js";

type ManifestLike = Record<string, unknown>;
type TrackRegistryLike = Record<string, unknown>;
type ExperimentLedgerLike = Record<string, unknown> & {
  summary?: Record<string, unknown> | null;
};
type GateStateLike = {
  currentStage: string | null;
  lastGate: string | null;
  gateStatus: string | null;
  gateTimestamp: string | null;
  defaultActionExecutedAt: string | null;
  revisionCount: number | null;
  [key: string]: unknown;
};

type AutoModeRiskEvaluationLike = {
  riskLevel: string;
  reasons: string[];
  riskFingerprint: string | null;
};

type AutoModeDiscussionStoreLike = {
  currentRound?: {
    packetFingerprint?: string | null;
    status?: string | null;
  } | null;
  roundsStartedByFingerprint?: Record<string, number>;
} | null;

type EffectiveAutoModeLike = {
  configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
  effectiveMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
  riskLevel: string;
  reasons: string[];
  riskFingerprint: string | null;
  mitigationStatus: string | null;
  mitigationRoundsStarted: number;
  mitigationRoundsRemaining: number;
};

type GateEvaluationLike = {
  blocking: boolean;
  reason: string | null;
  timedDefaultTriggered: boolean;
};

type MailboxQueueResultLike = {
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
};

type ProjectsStateLike = {
  projects?: unknown[];
};

type AutoIteratorDeps = {
  normalizePolicy: (value: Record<string, unknown> | undefined) => WorkflowGuardPolicy;
  loadExperimentLedgerIfExists: (
    projectRoot: string
  ) => Promise<ExperimentLedgerLike | null>;
  readGateState: (projectRoot: string) => Promise<GateStateLike>;
  normalizeRole: (value: unknown) => AutoIteratorAction["owner"];
  inferProjectId: (
    projectRoot: string | null,
    manifest: Record<string, unknown> | null
  ) => string | null;
  normalizeWritePackageState: (value: unknown) => Record<string, unknown>;
  assembleWritePackage: (params: {
    projectRoot: string;
    mode: string;
    trigger: string;
    agentId?: string | null;
  }) => Promise<unknown>;
  checkGraphPresenceForWorkflow: (params: {
    projectRoot: string;
    updateManifest: boolean;
    remoteAccess: {
      apiBaseUrl?: string;
      tokenSource?: string;
      tokenEnv?: string;
      tokenService?: string;
      tokenAccount?: string;
      mineruHttpUrl?: string;
      tokenLookupTimeoutMs?: number;
    };
  }) => Promise<GraphPresenceCheckResult>;
  PREVIOUS_STAGE: Record<string, string>;
  getMissingStageSignals: (params: {
    projectRoot: string;
    manifest: ManifestLike;
    trackRegistry: TrackRegistryLike | null;
    experimentLedger: ExperimentLedgerLike | null;
    currentStage: string | null;
  }) => Promise<string[]>;
  evaluateWorkflowAutoModeRisk: (params: {
    configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    stage: string | null;
    regressed: boolean;
    revisionCount: number | null;
    missingStageSignals: string[];
    manifest: ManifestLike;
  }) => AutoModeRiskEvaluationLike;
  readAutoModeDiscussionStore: (
    projectRoot: string
  ) => Promise<AutoModeDiscussionStoreLike>;
  resolveEffectiveWorkflowAutoMode: (params: {
    configuredMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    riskEvaluation: AutoModeRiskEvaluationLike;
    mitigationStatus: string | null;
    mitigationRoundsStarted: number;
    mitigationMaxRounds: number;
  }) => EffectiveAutoModeLike;
  evaluateGateBlocking: (params: {
    projectRoot: string;
    gateState: GateStateLike;
    stage: string | null;
    hasStageWorkRemaining: boolean;
    effectiveAutoMode: NonNullable<WorkflowGuardPolicy["autoMode"]>;
    autoGate: NonNullable<WorkflowGuardPolicy["autoGate"]>;
    now: string;
  }) => Promise<GateEvaluationLike>;
  STAGE_REQUIREMENTS: Record<string, { nextStage?: string | null }>;
  stageOwner: (stage: string | null) => AutoIteratorAction["owner"];
  normalizeExperimentSearchState: (value: unknown) => Record<string, unknown>;
  hasActiveExperimentRuns: (ledger: ExperimentLedgerLike | null) => boolean;
  hasFinishedExperimentWorkAwaitingReconciliation: (params: {
    ledger: ExperimentLedgerLike | null;
    experimentSearch: Record<string, unknown>;
  }) => boolean;
  buildExperimentMonitorCommand: () => string;
  buildGraphImportRepairGuidance: (
    sharedCorpus: string | null | undefined
  ) => string;
  formatStageCommand: (stage: string | null) => string | null;
  STAGE_ENTRY_MICRO_STAGES: Record<string, string>;
  saveManifest: (projectRoot: string, manifest: Record<string, unknown>) => Promise<void>;
  saveGateState: (projectRoot: string, gateState: GateStateLike) => Promise<void>;
  maybeQueueAutoIteratorMailbox: (params: {
    projectRoot: string;
    fromRole: AutoIteratorAction["owner"];
    toRole: AutoIteratorAction["owner"];
    stage: string | null;
    nextAction: string | null;
    missingStageSignals: string[];
    cooldownSeconds: number;
  }) => Promise<MailboxQueueResultLike>;
  formatStageSummary: (stage: string | null) => string | null;
  normalizeIdleResearchState: (value: unknown) => { topic: string | null };
  isIdleResearchDue: (value: unknown) => boolean;
  syncProjectsStateEntry: (params: {
    projectRoot: string;
    projectId: string;
    manifest: ManifestLike;
    trackRegistry: TrackRegistryLike | null;
    stage: string | null;
    nextAction: string | null;
    blockingReason: string | null;
  }) => Promise<boolean>;
  readProjectsStateRaw: (projectRoot: string) => Promise<ProjectsStateLike>;
  writeAutoIteratorAudit: (
    projectRoot: string,
    result: AutoIteratorResult
  ) => Promise<string | null>;
  appendWorkflowTraceEvent: (params: {
    projectRoot: string;
    projectId: string | null;
    kind: string;
    action: string;
    functionName: string;
    stage: string | null;
    owner: AutoIteratorAction["owner"];
    agentId: AutoIteratorAction["owner"];
    sessionKey: string | null;
    summary: string;
    details: Record<string, unknown>;
  }) => Promise<void>;
};

export async function runWorkflowAutoIteratorImpl(
  params: {
    projectRoot: string;
    agentId?: string;
    mode?: string;
    queueMailbox?: boolean;
    cooldownSeconds?: number;
    policy?: WorkflowGuardPolicy;
    now?: string;
  },
  deps: AutoIteratorDeps
): Promise<AutoIteratorResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const workflowPolicy = deps.normalizePolicy(
    params.policy as Record<string, unknown> | undefined
  );
  const configuredAutoMode =
    workflowPolicy.autoMode ?? ("off" as NonNullable<WorkflowGuardPolicy["autoMode"]>);
  const autoGate =
    workflowPolicy.autoGate ??
    ({
      maxMitigationRounds: 0,
    } as NonNullable<WorkflowGuardPolicy["autoGate"]>);
  const agentContactCooldownSeconds =
    typeof workflowPolicy.agentContactCooldownSeconds === "number" &&
    Number.isFinite(workflowPolicy.agentContactCooldownSeconds)
      ? Math.max(0, Math.floor(workflowPolicy.agentContactCooldownSeconds))
      : 300;
  const [manifestRaw, trackRegistry, experimentLedger] = await Promise.all([
    readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<TrackRegistryLike>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    deps.loadExperimentLedgerIfExists(projectRoot),
  ]);
  let manifest = { ...(manifestRaw ?? {}) };
  const gateState = await deps.readGateState(projectRoot);
  const actorRole = deps.normalizeRole(params.agentId);
  const now = params.now ?? new Date().toISOString();
  const projectId = deps.inferProjectId(projectRoot, manifest);
  const mode = asString(params.mode) ?? "manual";
  const stageBefore =
    normalizeStage(manifest.current_stage) ?? gateState.currentStage ?? "setup";
  const writePackageBefore = deps.normalizeWritePackageState(manifest.write_package);
  if (
    workflowPolicy.autoMode === "aggressive" &&
    (stageBefore === "write" || stageBefore === "submit") &&
    !["ready", "assembled", "approved"].includes(
      normalizeStage(writePackageBefore.status) ?? ""
    )
  ) {
    await deps.assembleWritePackage({
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
    graphPresenceCheck = await deps.checkGraphPresenceForWorkflow({
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
    const previousStage = deps.PREVIOUS_STAGE[stageEffective];
    if (!previousStage || visited.has(previousStage)) {
      break;
    }
    visited.add(previousStage);
    const previousMissing = await deps.getMissingStageSignals({
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

  const effectiveMissingSignals = await deps.getMissingStageSignals({
    projectRoot,
    manifest,
    trackRegistry,
    experimentLedger,
    currentStage: stageEffective,
  });
  const autoModeRiskEvaluation = deps.evaluateWorkflowAutoModeRisk({
    configuredMode: configuredAutoMode,
    stage: stageEffective,
    regressed,
    revisionCount: gateState.revisionCount,
    missingStageSignals: effectiveMissingSignals,
    manifest,
  });
  const autoModeDiscussionStore =
    autoModeRiskEvaluation.riskFingerprint && autoModeRiskEvaluation.riskLevel !== "stable"
      ? await deps.readAutoModeDiscussionStore(projectRoot)
      : null;
  const autoModeDiscussionRound =
    autoModeDiscussionStore?.currentRound?.packetFingerprint ===
    autoModeRiskEvaluation.riskFingerprint
      ? autoModeDiscussionStore.currentRound
      : null;
  const autoModeMitigationRoundsStarted = autoModeRiskEvaluation.riskFingerprint
    ? autoModeDiscussionStore?.roundsStartedByFingerprint?.[
        autoModeRiskEvaluation.riskFingerprint
      ] ?? 0
    : 0;
  const autoModeEvaluation = deps.resolveEffectiveWorkflowAutoMode({
    configuredMode: configuredAutoMode,
    riskEvaluation: autoModeRiskEvaluation,
    mitigationStatus: autoModeDiscussionRound?.status ?? null,
    mitigationRoundsStarted: autoModeMitigationRoundsStarted,
    mitigationMaxRounds: autoGate.maxMitigationRounds,
  });
  const gateEvaluation = await deps.evaluateGateBlocking({
    projectRoot,
    gateState,
    stage: stageEffective,
    hasStageWorkRemaining: effectiveMissingSignals.length > 0,
    effectiveAutoMode: autoModeEvaluation.effectiveMode,
    autoGate,
    now,
  });

  let stageAfter = stageEffective;
  if (
    !gateEvaluation.blocking &&
    stageEffective &&
    effectiveMissingSignals.length === 0 &&
    stageEffective !== "done"
  ) {
    const nextStage = deps.STAGE_REQUIREMENTS[stageEffective]?.nextStage;
    if (nextStage) {
      stageAfter = nextStage;
    }
  }

  const activeStageSignals =
    stageAfter !== stageEffective
      ? await deps.getMissingStageSignals({
          projectRoot,
          manifest,
          trackRegistry,
          experimentLedger,
          currentStage: stageAfter,
        })
      : effectiveMissingSignals;

  const ownerBefore = asString(manifest.owner_agent);
  const ownerAfter = deps.stageOwner(stageAfter);
  const paperIngestionStateForActions = normalizePaperIngestionState(
    manifest.paper_ingestion
  );
  const experimentSearchState = deps.normalizeExperimentSearchState(
    manifest.experiment_search
  );
  const shouldMonitorExperiments =
    stageAfter === "experiment" &&
    (deps.hasActiveExperimentRuns(experimentLedger) ||
      deps.hasFinishedExperimentWorkAwaitingReconciliation({
        ledger: experimentLedger,
        experimentSearch: experimentSearchState,
      }));
  const experimentMonitorCommand = shouldMonitorExperiments
    ? deps.buildExperimentMonitorCommand()
    : null;
  const setupOnboardingCommand =
    stageAfter === "setup" &&
    activeStageSignals.some((signal) =>
      signal.includes("PROJECT_MANIFEST.json.research_program")
    )
      ? "Run /project-init to complete the onboarding contract and lock the baseline, primary metric, datasets, success criteria, and Zotero bot/<project-id> path before graph grounding."
      : null;
  const graphImportRepairCommand =
    stageAfter === "graph_build" && paperIngestionStateForActions.repairRequired
      ? deps.buildGraphImportRepairGuidance(
          paperIngestionStateForActions.repairTargetCorpus
        )
      : null;
  const nextAction = gateEvaluation.blocking
    ? gateEvaluation.reason
    : experimentMonitorCommand ??
      graphImportRepairCommand ??
      setupOnboardingCommand ??
      deps.formatStageCommand(stageAfter);
  const resumeAction = gateEvaluation.blocking
    ? "Wait for the blocking gate to resolve, then run /resume-pipeline."
    : experimentMonitorCommand ??
      graphImportRepairCommand ??
      setupOnboardingCommand ??
      deps.formatStageCommand(stageAfter);
  const blockingReason = gateEvaluation.blocking
    ? gateEvaluation.reason
    : activeStageSignals.length > 0
      ? `Waiting for ${ownerAfter ?? "workflow owner"} to satisfy: ${activeStageSignals.join("; ")}`
      : null;
  const previousMicroStage = normalizeStage(manifest.current_micro_stage) ?? null;
  const nextMicroStage =
    stageAfter === "graph_build"
      ? deriveGraphBuildMicroStage({
          paperIngestionState: paperIngestionStateForActions,
          graphPresenceStatus:
            normalizeGraphPresenceStatus(
              asRecord(manifest.paper_ingestion)?.graph_presence_status ??
                asRecord(manifest.paper_ingestion)?.graphPresenceStatus
            ) ?? graphPresenceCheck?.status ?? null,
        })
      : stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed
        ? deps.STAGE_ENTRY_MICRO_STAGES[stageAfter] ?? previousMicroStage
        : previousMicroStage;

  manifest.project_id = projectId;
  manifest.current_stage = stageAfter;
  manifest.owner_agent = ownerAfter;
  manifest.next_action = nextAction;
  manifest.resume_action = resumeAction;
  manifest.blocking_reason = blockingReason;
  manifest.last_heartbeat_at = now;
  manifest.current_micro_stage = nextMicroStage;
  if (stageAfter !== stageBefore || ownerBefore !== ownerAfter || regressed) {
    manifest.last_handoff_at = now;
  }
  await deps.saveManifest(projectRoot, manifest);

  const nextGateState: GateStateLike = {
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
  await deps.saveGateState(projectRoot, nextGateState);

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
        : await deps.maybeQueueAutoIteratorMailbox({
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
                : agentContactCooldownSeconds,
          });
    recommendedActions.push({
      kind: "drive_stage",
      stage: stageAfter,
      owner: ownerAfter,
      summary:
        deps.formatStageSummary(stageAfter) ??
        "Drive the current workflow stage and refresh durable state.",
      command: nextAction,
      mailboxQueued: mailbox.queued,
      mailboxMessageId: mailbox.messageId,
      cooldownRemainingSeconds: mailbox.cooldownRemainingSeconds,
      blocking: false,
    });
  }

  const idleResearch = deps.normalizeIdleResearchState(manifest.idle_research);
  if (deps.isIdleResearchDue(idleResearch) && (gateEvaluation.blocking || ownerAfter !== "researcher")) {
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
      summary:
        "PaperNexus graph catch-up is pending and should refresh brainstorm grounding before novelty-sensitive work.",
      command:
        graphImportRepairCommand ??
        "Run /graph-build to verify PAPER_SOURCE_INDEX.json is reflected in the shared global graph, refresh graph readiness metadata, and update the brainstorm bundle (cache-first, without --force) before continuing frontier mapping or ideation. If wrapper-driven graph catch-up still fails, hand the exact non-force command to the user to run manually.",
      mailboxQueued: false,
      mailboxMessageId: null,
      cooldownRemainingSeconds: null,
      blocking: false,
    });
  }

  const experimentMemory = asRecord(manifest.experiment_memory);
  if (
    experimentLedger?.summary?.papernexusSyncRequired === true ||
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
    projectsStateUpdated = await deps.syncProjectsStateEntry({
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
    const projectsState = await deps.readProjectsStateRaw(projectRoot);
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
    configuredAutoMode:
      autoModeEvaluation.configuredMode as AutoIteratorResult["configuredAutoMode"],
    effectiveAutoMode:
      autoModeEvaluation.effectiveMode as AutoIteratorResult["effectiveAutoMode"],
    autoModeRiskLevel:
      autoModeEvaluation.riskLevel as AutoIteratorResult["autoModeRiskLevel"],
    autoModeReasons: autoModeEvaluation.reasons,
    autoModeRiskFingerprint: autoModeEvaluation.riskFingerprint,
    autoModeMitigationStatus:
      autoModeEvaluation.mitigationStatus as AutoIteratorResult["autoModeMitigationStatus"],
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

  result.auditPath = await deps.writeAutoIteratorAudit(projectRoot, result);
  await deps.appendWorkflowTraceEvent({
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
