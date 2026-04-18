import os from "node:os";
import { normalizeStage } from "./workflow-guard-core/coercion";

type SnapshotLike = Record<string, any>;

type FocusedPromptAssemblyLike = {
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

export function shouldUseFocusedWorkflowPromptImpl(snapshot: SnapshotLike): boolean {
  return (
    snapshot.role === "orchestrator" ||
    snapshot.role === "coder" ||
    snapshot.role === "analyzer" ||
    snapshot.role === "academic_writer" ||
    snapshot.role === "reviewer" ||
    snapshot.role === "cross-reviewer"
  );
}

export function shouldApplySharedWritingConstitutionImpl(snapshot: SnapshotLike): boolean {
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

function formatPromptPath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "unset";
  }
  const raw = value.trim();
  const normalized = raw.replace(/\\/g, "/");
  const home = os.homedir().replace(/\\/g, "/");
  if (normalized === home) {
    return "~";
  }
  if (normalized.startsWith(`${home}/`)) {
    return `~/${normalized.slice(home.length + 1)}`;
  }
  return raw;
}

function formatDerivedEvidenceLine(snapshot: SnapshotLike): string | null {
  const status =
    typeof snapshot.workflowEvidenceStatus === "string" && snapshot.workflowEvidenceStatus.trim()
      ? snapshot.workflowEvidenceStatus.trim()
      : typeof snapshot.derivedEvidenceStatus === "string" &&
          snapshot.derivedEvidenceStatus.trim()
        ? snapshot.derivedEvidenceStatus.trim()
        : null;
  const summary =
    typeof snapshot.workflowEvidenceSummary === "string" && snapshot.workflowEvidenceSummary.trim()
      ? snapshot.workflowEvidenceSummary.trim()
      : typeof snapshot.derivedEvidenceSummary === "string" &&
          snapshot.derivedEvidenceSummary.trim()
        ? snapshot.derivedEvidenceSummary.trim()
        : null;
  if (!status && !summary) {
    return null;
  }
  return `Derived evidence: ${status ?? "unknown"}${summary ? ` - ${summary}` : ""}`;
}

function formatRuntimeAuditLine(snapshot: SnapshotLike): string | null {
  const freshness =
    typeof snapshot.autoIteratorAuditFreshness === "string" &&
    snapshot.autoIteratorAuditFreshness.trim()
      ? snapshot.autoIteratorAuditFreshness.trim()
      : null;
  const status =
    typeof snapshot.autoIteratorAuditStatus === "string" &&
    snapshot.autoIteratorAuditStatus.trim()
      ? snapshot.autoIteratorAuditStatus.trim()
      : null;
  const summary =
    typeof snapshot.autoIteratorAuditSummary === "string" &&
    snapshot.autoIteratorAuditSummary.trim()
      ? snapshot.autoIteratorAuditSummary.trim()
      : null;
  if (!freshness && !status && !summary) {
    return null;
  }
  return `Runtime audit: ${freshness ?? "unknown"}${status ? `/${status}` : ""}${summary ? ` - ${summary}` : ""}`;
}

export function buildFocusedPromptAssemblyImpl(
  params: {
    snapshot: SnapshotLike;
    trigger?: string;
  },
  deps: {
    buildNonOwnerRoutingAdvice: (snapshot: SnapshotLike) => string[];
    getSharedWritingConstitutionLines: (role: string | null) => string[];
  }
): FocusedPromptAssemblyLike {
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
  if (shouldApplySharedWritingConstitutionImpl(snapshot)) {
    layer1Lines.push(...deps.getSharedWritingConstitutionLines(snapshot.role ?? null));
  }
  const layer1 = layer1Lines.join("\n");

  const layer2Lines = [
    "Layer 2: Stage-Local Control State",
    `Stage=${snapshot.currentStage ?? "unknown"}/${snapshot.currentMicroStage ?? "unknown"}`,
  ];
  layer2Lines.push(...deps.buildNonOwnerRoutingAdvice(snapshot));
  if (snapshot.role && snapshot.recommendedOwner && snapshot.role === snapshot.recommendedOwner) {
    layer2Lines.push(
      `Owner gate: you are the responsible owner for ${snapshot.currentStage ?? "this stage"}. Produce the stage artifacts, keep durable state current, and hand off only after your outputs exist.`
    );
    layer2Lines.push(
      "Handoff correctness rule: do not emit a [HANDOFF] block, raw @next-owner, or a stage-transition claim unless the latest research_workflow.auto_iterator_tick actually changes the live Workflow Guard stage or owner. If the stage stays the same or any required signals are still missing, report the blocker and keep ownership unchanged."
    );
  }
  if (snapshot.channelProjectBindingWorkflowSessionKey) {
    layer2Lines.push(
      `Runtime binding: role=${snapshot.channelProjectBindingWorkflowRole ?? "unset"}, session=${snapshot.channelProjectBindingWorkflowSessionKey ?? "unset"}, parent=${snapshot.channelProjectBindingParentSessionKey ?? "unset"}, thread=${snapshot.channelProjectBindingThreadBindingKey ?? "unset"}, depth=${snapshot.channelProjectBindingDepth ?? "unset"}, mode=${snapshot.channelProjectBindingMode}.`
    );
  }
  if (snapshot.nextAction) {
    layer2Lines.push(`next_action=${snapshot.nextAction}`);
  }
  if (snapshot.resumeAction) {
    layer2Lines.push(`resume_action=${snapshot.resumeAction}`);
  }
  if (snapshot.blockingReason) {
    layer2Lines.push(`blocking_reason=${snapshot.blockingReason}`);
  }
  const runtimeAuditLine = formatRuntimeAuditLine(snapshot);
  if (runtimeAuditLine) {
    layer2Lines.push(runtimeAuditLine);
  }
  const derivedEvidenceLine = formatDerivedEvidenceLine(snapshot);
  if (derivedEvidenceLine) {
    layer2Lines.push(derivedEvidenceLine);
  } else if ((snapshot.missingStageSignals ?? []).length > 0) {
    layer2Lines.push(
      `missing_signals=${(snapshot.missingStageSignals ?? []).slice(0, 4).join("; ")}`
    );
  }
  if (
    snapshot.orchestrationStatus ||
    snapshot.orchestrationNextTransitionCandidate ||
    snapshot.role === "orchestrator" ||
    snapshot.currentStage === "plan"
  ) {
    layer2Lines.push(
      `orchestration=${snapshot.orchestrationStatus ?? "unknown"} -> ${snapshot.orchestrationNextTransitionCandidate ?? "unset"}`
    );
  }
  if (snapshot.revisionControlStatus && snapshot.revisionControlStatus !== "idle") {
    layer2Lines.push(
      `revision_control=${snapshot.revisionControlStatus} owner=${snapshot.revisionControlCurrentOwner ?? "unset"} next_reviewer=${snapshot.revisionControlNextReviewerRole ?? "unset"} open_sources=${snapshot.revisionControlOpenSourceCount ?? 0}`
    );
    if (snapshot.revisionControlPendingReason) {
      layer2Lines.push(`revision_pending_reason=${snapshot.revisionControlPendingReason}`);
    }
    if (snapshot.revisionControlPacketPath) {
      layer2Lines.push(`revision_packet=${snapshot.revisionControlPacketPath}`);
    }
  }
  if (snapshot.autoDispatchDiagnosticsStatus) {
    layer2Lines.push(
      `auto_dispatch=${snapshot.autoDispatchDiagnosticsStatus}${snapshot.autoDispatchBlockingLayer ? ` layer=${snapshot.autoDispatchBlockingLayer}` : ""}${snapshot.autoDispatchBlockingReason ? ` reason=${snapshot.autoDispatchBlockingReason}` : ""}`
    );
    if (snapshot.autoDispatchNextRepairAction) {
      layer2Lines.push(`auto_dispatch_repair=${snapshot.autoDispatchNextRepairAction}`);
    }
  }
  if (snapshot.surveyVisualCompilerStatus && snapshot.writingPaperMode === "survey") {
    layer2Lines.push(
      `survey_visual_compiler=${snapshot.surveyVisualCompilerStatus} rows=${snapshot.surveyVisualCompilerRowCount ?? 0} insertion_map=${snapshot.surveyVisualCompilerInsertionMapPath ?? "unset"}`
    );
  }
  if (snapshot.surveyMethodologyConsistencyStatus && snapshot.writingPaperMode === "survey") {
    layer2Lines.push(
      `survey_methodology_consistency=${snapshot.surveyMethodologyConsistencyStatus} blocking_issues=${snapshot.surveyMethodologyConsistencyBlockingIssueCount ?? 0} path=${snapshot.surveyMethodologyConsistencyPath ?? "unset"}`
    );
  }
  if (snapshot.currentStage === "plan" || snapshot.role === "orchestrator") {
    layer2Lines.push(
      "Plan contract rule: PLAN.md, TODOS.md, and PLAN_AUDIT.md are human-readable derivatives. The durable source of truth is PROJECT_MANIFEST.json.research_program, and plan stage is not complete until it records graph-grounded multi-option comparison plus a locked selection."
    );
    layer2Lines.push(
      "Canonical plan-state rule: after writing PLAN.md, TODOS.md, and PLAN_AUDIT.md, call research_workflow.materialize_plan_state or set_research_program instead of hand-editing PROJECT_MANIFEST.json. The workflow tool will canonicalize active tracks, experiment_stage_matrix, task_graph coverage, plan_alternatives, and plan_selection."
    );
    layer2Lines.push(
      "Planner rigor rule: research_program.plan_alternatives must compare at least two options, and research_program.plan_selection must record the selected option/track, compared option ids, decisive graph evidence, and rationale before handing work to Coder."
    );
    layer2Lines.push(
      "Evo-style planning rule: after choosing the winning option, express the selected track as staged tasks with success signals, baseline/ablation coverage, expected artifacts, retry budget, and fallback path."
    );
    layer2Lines.push(
      "Plan schema rule: each active track must carry experiment_stage_matrix as a string array containing baseline_implementation, baseline_tuning, creative_research, and ablation_studies. task_graph must be an array of per-track tasks with non-empty entry_criteria, expected_outputs, and exit_criteria."
    );
  }
  layer2Lines.push(
    "Communication rule: normal Discord/chat status reports must use plain labels like [coder] / [researcher] / [writer]. Only a stage-completion handoff message may include one raw @next-owner, and it must use the [STATUS]/[HANDOFF]/[ARTIFACTS]/[NEXT] block."
  );
  layer2Lines.push(
    "Workflow truth rule: chat-level handoff text never overrides Workflow Guard ownership. Only the live snapshot or a successful auto_iterator_tick may move the stage owner."
  );
  layer2Lines.push(
    "Reply style rule: acknowledge handoffs with plain text or role labels, not repeated raw @mentions. Do not echo the same raw mention across follow-up replies."
  );
  layer2Lines.push(
    "Contact cooldown rule: after routing work to another agent, do not ping the same target again immediately; wait for the workflow cooldown unless new durable state changes the request."
  );
  layer2Lines.push(
    "Interruptibility rule: keep the main session interruptible. If a task needs more than a quick turn to scope or execute safely, split it into a bounded packet, delegated branch, or workflow-owned background action instead of monopolizing the thread."
  );
  layer2Lines.push(
    'Exec approval safety rule: do not paste long heredocs, inline Python writers, or bulk LaTeX/Markdown/JSON payloads into the exec tool. For long text artifacts, use research_workflow with action "write_text_artifact". Reserve file-backed exec packets for long shell commands that truly need shell execution.'
  );
  if (
    snapshot.role === "researcher" &&
    ((snapshot.paperIngestionQueuedRequestCount ?? 0) > 0 ||
      (snapshot.paperIngestionRunningRequestCount ?? 0) > 0)
  ) {
    layer2Lines.push(
      "Foreground queue rule: if workflow-owned literature discovery or other long queue work is pending, keep the main chat session responsive. Start or monitor that work through research_workflow.start_background_run or the queued wrapper flow, and answer direct user questions in the foreground instead of consuming the whole reply with queue execution."
    );
  }
  layer2Lines.push(
    "Stage completion rule: when your stage outputs are ready, call research_workflow.auto_iterator_tick before narrating or starting the next stage yourself, so owner routing and handoff happen deterministically."
  );
  if (snapshot.autoIteratorAuditFreshness === "stale") {
    layer2Lines.push(
      "Runtime truth rule: the live Workflow Guard snapshot is the source of truth. Treat stale auto-iterator audit records as historical diagnostics only, not as the current blocker."
    );
  }
  if (snapshot.role === "researcher") {
    layer2Lines.push(
      "Bootstrap-vs-guard rule: AGENTS.md only carries stable role policy. Stage-local checklists, queue state, and the next bounded action in this Workflow Guard override memory or stale templates."
    );
    layer2Lines.push(
      "Auto-iterator reply rule: when the user says the workflow changed or was updated, do not repeatedly narrate that you will call auto_iterator_tick. Call it once, then report the concrete delta or the exact blocker."
    );
    layer2Lines.push(
      'Auto iterator rule: before fresh stage work on heartbeat/recovery turns, call research_workflow with action "auto_iterator_tick" so stage reconciliation, owner routing, and PROJECTS_STATE sync happen deterministically.'
    );
    if (snapshot.autoIteratorAuditFreshness === "stale") {
      layer2Lines.push(
        "Stale audit rule: if the last auto-iterator audit is stale, do not restate its blocker. Report the current snapshot, rerun auto_iterator_tick once, and then describe only the new delta."
      );
    }
    if (params.trigger === "heartbeat") {
      layer2Lines.push(
        'Heartbeat first step: call research_workflow {"action":"auto_iterator_tick","iterator":{"mode":"heartbeat"}} before any manual planning or ad hoc spawning.'
      );
    }
  }
  if (snapshot.role === "reviewer") {
    layer2Lines.push(
      "Review independence rule: operate only on the explicit review packet or cited paths for this request; do not widen into hidden project context or implementation help."
    );
  }
  if (snapshot.role === "cross-reviewer") {
    layer2Lines.push(
      "Cross-review rule: stay stateless and finish standard novelty/outline/prose packets inline; if the request turns into multi-step evidence gathering, stop and hand it back to the caller."
    );
  }
  if (snapshot.role === "academic_writer") {
    layer2Lines.push(
      "Writing helper rule: use citation-management and venue-templates when bibliography or template constraints become the blocker, and keep TEMPLATE_MAPPING.md aligned with the active template."
    );
  }
  if (snapshot.role === "coder") {
    layer2Lines.push(
      "Visualization helper rule: use scientific-visualization for bounded implementation-stage figures when they clarify baseline fidelity, ablations, or sanity checks."
    );
    layer2Lines.push(
      "Coder git-ratchet rule: when an approved experiment search envelope exists, treat git as the acceptance gate. Work on disposable candidate branches or worktrees, keep only promoted metric wins on the incumbent branch, and do not let unpromoted changes pollute the retained history."
    );
  }
  const layer2 = layer2Lines.join("\n");

  const layer3Lines = ["Layer 3: Primary Payload", `section_context=${sectionContextId ?? "unset"}`];
  const writingContextActive =
    snapshot.role === "academic_writer" ||
    snapshot.currentStage === "write" ||
    snapshot.currentStage === "review" ||
    snapshot.currentStage === "submit";
  const brainstormContextActive =
    snapshot.role === "researcher" ||
    snapshot.currentStage === "frontier_mapping" ||
    snapshot.currentStage === "idea" ||
    snapshot.currentStage === "revise";
  const paperIngestionContextActive =
    snapshot.role === "researcher" ||
    snapshot.currentStage === "setup" ||
    snapshot.currentStage === "graph_build" ||
    snapshot.currentStage === "frontier_mapping";
  if (
    writingContextActive ||
    (snapshot.writingSessionStatus && snapshot.writingSessionStatus !== "missing")
  ) {
    layer3Lines.push(
      `writing_status=${snapshot.writingSessionStatus ?? "unknown"} process=${snapshot.writingProcessStatus ?? "unknown"}`
    );
  }
  if (
    brainstormContextActive &&
    (snapshot.brainstormCycleStatus ||
      snapshot.brainstormCycleTopic ||
      snapshot.brainstormCycleChainBundleReady)
  ) {
    layer3Lines.push(
      `brainstorm_cycle=${snapshot.brainstormCycleStatus ?? "unknown"} provider=${snapshot.brainstormCycleProvider ?? "unset"} mode=${snapshot.brainstormCycleProviderMode ?? "unset"} topic=${snapshot.brainstormCycleTopic ?? "unset"} chain_bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`
    );
  }
  if (
    paperIngestionContextActive &&
    (snapshot.paperIngestionRuntimeStatus ||
      (snapshot.paperIngestionImportTaskCount ?? 0) > 0 ||
      (snapshot.paperIngestionBatchCount ?? 0) > 0 ||
      (snapshot.paperIngestionPendingBatchItemCount ?? 0) > 0 ||
      snapshot.paperIngestionReconcileRequired)
  ) {
    layer3Lines.push(
      `paper_ingestion=${snapshot.paperIngestionRuntimeStatus ?? "unknown"} import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0} batches=${snapshot.paperIngestionBatchCount ?? 0} active_batches=${snapshot.paperIngestionActiveBatchCount ?? 0} reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`
    );
  }
  if (typeof snapshot.papernexusProgressSummary === "string") {
    layer3Lines.push(`PaperNexus progress: ${snapshot.papernexusProgressSummary}`);
  }
  if (snapshot.writingCurrentSectionReviewVerdict) {
    layer3Lines.push(`section_review=${snapshot.writingCurrentSectionReviewVerdict}`);
  }
  if (
    snapshot.writePackageStatus ||
    snapshot.writePackageAssemblyStatus ||
    snapshot.writePackageDerivedArtifactCount
  ) {
    layer3Lines.push(
      `write_package=${snapshot.writePackageStatus ?? "unknown"}/${snapshot.writePackageAssemblyStatus ?? "unknown"} mode=${snapshot.writePackageAssemblyMode ?? "unset"} derived=${snapshot.writePackageDerivedArtifactCount ?? 0}`
    );
  }
  if (reviewLane) {
    layer3Lines.push(`review_lane=${reviewLane}`);
  }
  const layer3 = layer3Lines.join("\n");

  const layer4Lines = ["Layer 4: Supporting Evidence"];
  const graphCoverage =
    snapshot.writingGraphEvidenceCoverageStatus ??
    snapshot.graphGuidedWritingEvidenceCoverageStatus;
  if (graphCoverage) {
    layer4Lines.push(`graph_coverage=${graphCoverage}`);
  }
  if (
    (snapshot.reviewIssueCriticalCount ?? 0) > 0 ||
    (snapshot.reviewIssueHighCount ?? 0) > 0 ||
    (snapshot.reviewIssueMediumCount ?? 0) > 0
  ) {
    layer4Lines.push(
      `review_issues=critical:${snapshot.reviewIssueCriticalCount ?? 0}, high:${snapshot.reviewIssueHighCount ?? 0}, medium:${snapshot.reviewIssueMediumCount ?? 0}`
    );
  }
  if (
    snapshot.paperQcStatus ||
    snapshot.paperQcCompileStatus ||
    snapshot.paperQcPageBudgetStatus
  ) {
    layer4Lines.push(
      `paper_qc=${snapshot.paperQcStatus ?? "unknown"} compile:${snapshot.paperQcCompileStatus ?? "unknown"} page:${snapshot.paperQcPageBudgetStatus ?? "unknown"}`
    );
  }
  if (snapshot.figureQcCaptionAlignmentStatus || snapshot.figureQcTextAlignmentStatus) {
    layer4Lines.push(
      `figure_qc=caption:${snapshot.figureQcCaptionAlignmentStatus ?? "unknown"} text:${snapshot.figureQcTextAlignmentStatus ?? "unknown"}`
    );
  }
  const layer4 = layer4Lines.length > 1 ? layer4Lines.join("\n") : null;

  const layer5Lines = ["Layer 5: Reflection Delta"];
  if (roundId) {
    layer5Lines.push(`round_id=${roundId}`);
  }
  if (snapshot.reviewSessionVerdict) {
    layer5Lines.push(`review_verdict=${snapshot.reviewSessionVerdict}`);
  }
  if (snapshot.reviewSessionSummary) {
    layer5Lines.push(`review_summary=${snapshot.reviewSessionSummary}`);
  }
  const layer5 = layer5Lines.length > 1 ? layer5Lines.join("\n") : null;
  const text = [
    "[Workflow Guard]",
    layer1,
    layer2,
    layer3,
    layer4,
    layer5,
    "[/Workflow Guard]",
  ]
    .filter(Boolean)
    .join("\n");
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
        supporting_evidence: Boolean(layer4),
        reflection_delta: Boolean(layer5),
      },
      promptPayloadSizes: {
        stable_policy: layer1.length,
        stage_local_state: layer2.length,
        primary_payload: layer3.length,
        supporting_evidence: layer4?.length ?? 0,
        reflection_delta: layer5?.length ?? 0,
      },
    },
  };
}

export function formatWorkflowSnapshotForPromptImpl(
  params: {
    snapshot: SnapshotLike;
    trigger?: string;
    detailLevel?: "full" | "focused";
  },
  deps: {
    buildNonOwnerRoutingAdvice: (snapshot: SnapshotLike) => string[];
    getSharedWritingConstitutionLines: (role: string | null) => string[];
  }
): string {
  const { snapshot, trigger } = params;
  if ((params.detailLevel ?? "full") === "focused") {
    return buildFocusedPromptAssemblyImpl({ snapshot, trigger }, deps).text;
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
  lines.push(...deps.buildNonOwnerRoutingAdvice(snapshot));
  if (snapshot.role && snapshot.recommendedOwner && snapshot.role === snapshot.recommendedOwner) {
    lines.push(
      `Owner gate: you are the responsible owner for ${snapshot.currentStage ?? "this stage"}. Produce the stage artifacts, keep durable state current, and hand off only after your outputs exist.`
    );
    lines.push(
      "Handoff correctness rule: do not emit a [HANDOFF] block, raw @next-owner, or a stage-transition claim unless the latest research_workflow.auto_iterator_tick actually changes the live Workflow Guard stage or owner. If the stage stays the same or any required signals are still missing, report the blocker and keep ownership unchanged."
    );
  }
  if (snapshot.channelProjectBindingWorkflowSessionKey) {
    lines.push(
      `Runtime binding: role=${snapshot.channelProjectBindingWorkflowRole ?? "unset"}, session=${snapshot.channelProjectBindingWorkflowSessionKey ?? "unset"}, parent=${snapshot.channelProjectBindingParentSessionKey ?? "unset"}, thread=${snapshot.channelProjectBindingThreadBindingKey ?? "unset"}, depth=${snapshot.channelProjectBindingDepth ?? "unset"}, mode=${snapshot.channelProjectBindingMode}.`
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
  const derivedEvidenceLine = formatDerivedEvidenceLine(snapshot);
  if (derivedEvidenceLine) {
    lines.push(derivedEvidenceLine);
  } else if ((snapshot.missingStageSignals ?? []).length > 0) {
    lines.push("Missing stage signals:");
    for (const signal of snapshot.missingStageSignals.slice(0, 8)) {
      lines.push(`- ${signal}`);
    }
  }
  if ((snapshot.allowedWriteScopes ?? []).length > 0) {
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
    lines.push(
      "Coder git-ratchet rule: if planner/EXPERIMENT_SEARCH_SPEC.json or a bundle-local SEARCH_STATE.json exists, prefer /search-experiment over ad hoc repeated /run-experiment calls. Only promoted primary-metric wins may advance the incumbent branch; gap reduction, smoother curves, or nicer runtime alone are diagnostic signals, not promotion reasons."
    );
    lines.push(
      "Workflow-owned git review rule: candidate worktree creation plus promote/discard branch operations must pass multi-agent review first. Do not run git worktree add/remove or branch promotion directly; request the operation through research_workflow and wait for approval."
    );
    lines.push(
      "Coder lineage rule: record incumbent_branch/incumbent_commit plus the latest candidate branch and commit in durable state so later monitoring, reflection, and graph memory can distinguish retained knowledge from discarded attempts."
    );
  }
  if ((snapshot.allowedContacts ?? []).length > 0 || (snapshot.allowedSpawns ?? []).length > 0) {
    lines.push(
      `Allowed contacts: ${(snapshot.allowedContacts ?? []).length > 0 ? snapshot.allowedContacts.join(", ") : "none"}`
    );
    lines.push(
      `Allowed spawns: ${(snapshot.allowedSpawns ?? []).length > 0 ? snapshot.allowedSpawns.join(", ") : "none"}`
    );
  }
  lines.push(
    "Communication rule: normal Discord/chat status reports must use plain labels like [coder] / [researcher] / [writer]. Only a stage-completion handoff message may include one raw @next-owner, and it must use the [STATUS]/[HANDOFF]/[ARTIFACTS]/[NEXT] block."
  );
  lines.push(
    "Workflow truth rule: chat-level handoff text never overrides Workflow Guard ownership. Only the live snapshot or a successful auto_iterator_tick may move the stage owner."
  );
  lines.push(
    "Reply style rule: acknowledge handoffs with plain text or role labels, not repeated raw @mentions. Do not echo the same raw mention across follow-up replies."
  );
  lines.push(
    "Contact cooldown rule: after routing work to another agent, do not ping the same target again immediately; wait for the workflow cooldown unless new durable state changes the request."
  );
  lines.push(
    'Exec approval safety rule: do not paste long heredocs, inline Python writers, or bulk LaTeX/Markdown/JSON payloads into the exec tool. For long text artifacts, use research_workflow with action "write_text_artifact". Reserve file-backed exec packets for long shell commands that truly need shell execution.'
  );
  lines.push(
    "Stage completion rule: when your stage outputs are ready, call research_workflow.auto_iterator_tick before narrating or starting the next stage yourself, so owner routing and handoff happen deterministically."
  );
  if (snapshot.role === "researcher") {
    lines.push(
      "Auto-iterator reply rule: when the user says the workflow changed or was updated, do not repeatedly narrate that you will call auto_iterator_tick. Call it once, then report the concrete delta or the exact blocker."
    );
    lines.push(
      'Auto iterator rule: before fresh stage work on heartbeat/recovery turns, call research_workflow with action "auto_iterator_tick" so stage reconciliation, owner routing, and PROJECTS_STATE sync happen deterministically.'
    );
    if (trigger === "heartbeat") {
      lines.push(
        'Heartbeat first step: call research_workflow {"action":"auto_iterator_tick","iterator":{"mode":"heartbeat"}} before any manual planning or ad hoc spawning.'
      );
    }
  }
  const resolvedPapernexusAccessMode =
    typeof snapshot.papernexusAccessMode === "string" &&
    ["remote_api", "remote_mcp", "local_mcp"].includes(snapshot.papernexusAccessMode)
      ? snapshot.papernexusAccessMode
      : snapshot.papernexusMcpUrl
        ? "remote_mcp"
        : snapshot.papernexusApiBaseUrl
          ? "remote_api"
          : null;
  if (
    snapshot.graphRefreshRequired ||
    snapshot.paperSourceDir ||
    snapshot.graphSourceDir ||
    snapshot.papernexusProgressSummary ||
    snapshot.papernexusApiBaseUrl ||
    snapshot.papernexusMcpUrl ||
    snapshot.papernexusApiTokenEnv ||
    snapshot.papernexusApiTokenSource ||
    snapshot.papernexusApiTokenService ||
    snapshot.papernexusApiTokenAccount ||
    snapshot.papernexusMineruHttpUrl
  ) {
    lines.push(
      `PaperNexus: paper_source=${formatPromptPath(snapshot.paperSourceDir)}, graph_source=${formatPromptPath(snapshot.graphSourceDir)}, refresh_required=${snapshot.graphRefreshRequired ? "true" : "false"}`
    );
    if (snapshot.papernexusProgressSummary) {
      lines.push(`PaperNexus progress: ${snapshot.papernexusProgressSummary}`);
    }
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
        `Paper ingestion runtime: status=${snapshot.paperIngestionRuntimeStatus}, import_tasks=${snapshot.paperIngestionImportTaskCount ?? 0}, batches=${snapshot.paperIngestionBatchCount ?? 0}, active_batches=${snapshot.paperIngestionActiveBatchCount ?? 0}, batch_pending_items=${snapshot.paperIngestionPendingBatchItemCount ?? 0}, batch_synced_items=${snapshot.paperIngestionSyncedBatchItemCount ?? 0}, last_import_status=${snapshot.paperIngestionLastImportStatus ?? "unknown"}, graph_version_seen=${snapshot.paperIngestionGraphVersionSeen ?? "unknown"}, reconcile_required=${snapshot.paperIngestionReconcileRequired ? "true" : "false"}`
      );
      if (snapshot.paperIngestionWaitingReason) {
        lines.push(`Paper ingestion waiting reason: ${snapshot.paperIngestionWaitingReason}`);
      }
      if (snapshot.paperIngestionLastBatchManifestPath) {
        lines.push(
          `Paper ingestion last batch manifest: ${snapshot.paperIngestionLastBatchManifestPath}`
        );
      }
    }
    if (snapshot.graphPresenceReportPath) {
      lines.push(`Graph presence report: ${snapshot.graphPresenceReportPath}`);
    }
    if (
      snapshot.papernexusApiBaseUrl ||
      snapshot.papernexusMcpUrl ||
      snapshot.papernexusApiTokenEnv ||
      snapshot.papernexusApiTokenSource ||
      snapshot.papernexusApiTokenService ||
      snapshot.papernexusApiTokenAccount ||
      snapshot.papernexusMineruHttpUrl
    ) {
      lines.push(
        `PaperNexus remote access: api=${snapshot.papernexusApiBaseUrl ?? "unset"}, mcp=${snapshot.papernexusMcpUrl ?? "unset"}, mcp_transport=${snapshot.papernexusMcpTransport ?? "unset"}, mcp_timeout_ms=${snapshot.papernexusMcpTimeoutMs ?? "unset"}, token_source=${snapshot.papernexusApiTokenSource ?? "unset"}, token_env=${snapshot.papernexusApiTokenEnv ?? "unset"}, keychain_service=${snapshot.papernexusApiTokenService ?? "unset"}, keychain_account=${snapshot.papernexusApiTokenAccount ?? "unset"}, mineru_http=${snapshot.papernexusMineruHttpUrl ?? "unset"}`
      );
      if (resolvedPapernexusAccessMode === "remote_mcp") {
        lines.push(
          "Remote-only storage rule: never use or inspect local PaperNexus storage under ~/.papernexus/papers or ~/.papernexus/index-store. Use project-local staging files plus the configured remote MCP endpoint instead."
        );
        if (snapshot.papernexusApiTokenSource === "env" && snapshot.papernexusApiTokenEnv) {
          lines.push(
            `Remote MCP rule: Use Authorization: Bearer from env ${snapshot.papernexusApiTokenEnv} for the PaperNexus MCP endpoint at ${snapshot.papernexusMcpUrl ?? "unset"}. Never print the raw token in chat, prompts, logs, or project files.`
          );
        } else if (snapshot.papernexusApiTokenSource === "os_keychain") {
          lines.push(
            `Remote MCP rule: Resolve the PaperNexus bearer token from the native OS keychain entry service=${snapshot.papernexusApiTokenService ?? "unset"} account=${snapshot.papernexusApiTokenAccount ?? "unset"} before calling ${snapshot.papernexusMcpUrl ?? "unset"}. Never print or persist the raw token.`
          );
        } else {
          lines.push(
            `Remote MCP rule: Resolve the PaperNexus bearer token in auto mode for ${snapshot.papernexusMcpUrl ?? "unset"}: prefer env ${snapshot.papernexusApiTokenEnv ?? "unset"}, then fall back to native keychain service=${snapshot.papernexusApiTokenService ?? "unset"} account=${snapshot.papernexusApiTokenAccount ?? "unset"}. Never print or persist the raw token.`
          );
        }
        lines.push(
          "Remote MCP rule: use the PaperNexus MCP tools through the MCP-first mapping for graph reads and writes: `research_lookup` for query/context/impact/ideas/brainstorm, `research_briefing` for brief and chain outputs, `idea_catalyst` for cross-domain ideation packets, and `import_workflow` for queued import/status/wait flows. Do not use `pn_graph_query.py` / `pn_research_chains.py` as a separate non-MCP control plane in this mode."
        );
      } else {
        lines.push(
          "Remote-only storage rule: never use or inspect local PaperNexus storage under ~/.papernexus/papers or ~/.papernexus/index-store. Use project-local staging files plus the Python wrappers (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, `pn_batch_import.py`, `pn_graph_query.py`, `pn_research_chains.py`) instead, and prefer `research_workflow.run_papernexus_wrapper` for workflow-owned background graph work."
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
            "Live graph rule: never use local PaperNexus live-graph CLI reads or hand-written curl calls against the running shared graph; use `pn_graph_query.py` / `pn_research_chains.py` instead."
          );
        } else if (snapshot.papernexusApiBaseUrl) {
          lines.push(
            `Remote API rule: prefer the configured PaperNexus Web/API endpoint at ${snapshot.papernexusApiBaseUrl} instead of assuming anonymous local access.`
          );
        }
      }
      if (snapshot.papernexusMineruHttpUrl) {
        lines.push(
          `PDF parser rule: Prefer remote MinerU at ${snapshot.papernexusMineruHttpUrl} for PDF materialization. Do not switch to local Docling or Marker unless the remote endpoint is unavailable or the task explicitly requires a local parser.`
        );
      }
    } else {
      lines.push(
        `PaperNexus local defaults: papers=${formatPromptPath(snapshot.defaultPapernexusSourceDir)}, index=${formatPromptPath(snapshot.defaultPapernexusIndexRoot)}`
      );
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
      `Brainstorm cycle: status=${snapshot.brainstormCycleStatus}, provider=${snapshot.brainstormCycleProvider ?? "unset"}, provider_mode=${snapshot.brainstormCycleProviderMode ?? "unset"}, provider_status=${snapshot.brainstormCycleProviderStatus ?? "unset"}, contract_version=${snapshot.brainstormCycleContractVersion ?? "unset"}, topic=${snapshot.brainstormCycleTopic ?? "unset"}, basis_stage=${snapshot.brainstormCycleBasisStage ?? "unset"}, track=${snapshot.brainstormCycleTrackId ?? "unset"}, graph_version=${snapshot.brainstormCycleGraphVersionSeen ?? "unset"}, import_tasks=${snapshot.brainstormCycleImportTaskCount ?? 0}, chain_bundle_ready=${snapshot.brainstormCycleChainBundleReady ? "true" : "false"}`
    );
    if (snapshot.brainstormCyclePendingReason) {
      lines.push(`Brainstorm cycle pending_reason: ${snapshot.brainstormCyclePendingReason}`);
    }
    if (resolvedPapernexusAccessMode === "remote_mcp") {
      lines.push(
        "Brainstorm rule: for novelty-sensitive reasoning, summarize the topic, use the configured remote PaperNexus MCP tools (`query`, `context`, `impact`, `ideas`, `brainstorm`, `domain_distance`, `extract_takeaways`, `interdisciplinary_potential`) for graph grounding, and persist logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet through research_workflow.run_brainstorm_cycle."
      );
    } else {
      lines.push(
        "Brainstorm rule: for novelty-sensitive reasoning, summarize the topic, call PaperNexus typed wrapper commands through `research_workflow.run_papernexus_wrapper` (`pn_graph_query.py` / `pn_research_chains.py`), and persist logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet through research_workflow.run_brainstorm_cycle."
      );
    }
    lines.push(
      "Brainstorm selection rule: multiple brainstorm rounds may coexist, but aggressive auto mode should keep all candidates and promote the highest-scoring option to the selected durable bundle."
    );
  }
  if (snapshot.surveyReviewStatus) {
    lines.push(
      `Survey review: status=${snapshot.surveyReviewStatus}, phase=${snapshot.surveyReviewCurrentPhase ?? "unset"}, topic=${snapshot.surveyReviewTopic ?? "unset"}, mode=${snapshot.surveyReviewMode ?? "unset"}, candidates=${snapshot.surveyReviewCandidatePaperCount ?? 0}, included=${snapshot.surveyReviewIncludedPaperCount ?? 0}, excluded=${snapshot.surveyReviewExcludedPaperCount ?? 0}, query_rounds=${snapshot.surveyReviewQueryRoundCount ?? 0}, graph_brief_ready=${snapshot.surveyReviewGraphGroundedBriefReady ? "true" : "false"}, gates_ready=${snapshot.surveyReviewGateReady ? "true" : "false"}`
    );
    lines.push(
      `Survey gates: coverage=${snapshot.surveyReviewCoverageStatus ?? "missing"}, taxonomy=${snapshot.surveyReviewTaxonomyStabilityStatus ?? "missing"}, representative_methods=${snapshot.surveyReviewRepresentativeMethodsStatus ?? "missing"}, benchmark_alignment=${snapshot.surveyReviewBenchmarkAlignmentStatus ?? "missing"}, gap_closure=${snapshot.surveyReviewGapClosureStatus ?? "missing"}, blockers=${snapshot.surveyReviewGateBlockingIssueCount ?? 0}`
    );
    if (snapshot.surveyReviewDiagnosticsPath) {
      lines.push(`Survey diagnostics: ${snapshot.surveyReviewDiagnosticsPath}`);
    }
    if (snapshot.surveyReviewPendingReason) {
      lines.push(`Survey review pending_reason: ${snapshot.surveyReviewPendingReason}`);
    }
  }
  if (snapshot.ideationContractStatus) {
    lines.push(
      `Ideation contract: status=${snapshot.ideationContractStatus}, track=${snapshot.ideationContractSelectedTrackId ?? "unset"}, direction=${snapshot.ideationContractSelectedDirectionId ?? "unset"}, idea_tree=${snapshot.ideationContractIdeaTreePath ?? "unset"}, proposal=${snapshot.ideationContractResearchProposalPath ?? "unset"}, ranking=${snapshot.ideationContractRankingHistoryPath ?? "unset"}, scoreboard=${snapshot.ideationContractTournamentScoreboardPath ?? "unset"}, top3=${snapshot.ideationContractTop3SummaryPath ?? "unset"}, graph_packet=${snapshot.ideationContractGraphPacketPath ?? "unset"}`
    );
    if (snapshot.ideationContractPendingReason) {
      lines.push(`Ideation contract pending_reason: ${snapshot.ideationContractPendingReason}`);
    }
  }
  if (snapshot.researchProgramStatus) {
    lines.push(
      `Research program: status=${snapshot.researchProgramStatus}, onboarding=${snapshot.researchProgramOnboardingStatus ?? "unknown"}, goal=${snapshot.researchProgramPrimaryGoal ?? "unset"}, baseline=${snapshot.researchProgramBaselineReference ?? "unset"}, primary_metric=${snapshot.researchProgramPrimaryMetricName ?? "unset"}, datasets=${snapshot.researchProgramDatasetCount ?? 0}, success_criteria=${snapshot.researchProgramSuccessCriteriaCount ?? 0}, active_tracks=${snapshot.researchProgramActiveTrackCount ?? 0}/${snapshot.researchProgramTrackCount ?? 0}`
    );
    if (snapshot.currentStage === "plan" || snapshot.role === "orchestrator") {
      lines.push(
        `Plan selection: alternatives=${snapshot.researchProgramPlanAlternativeCount ?? 0}, compared=${snapshot.researchProgramPlanComparedOptionCount ?? 0}, selected_option=${snapshot.researchProgramPlanSelectedOptionId ?? "unset"}, selected_track=${snapshot.researchProgramPlanSelectedTrackId ?? "unset"}, selection_ready=${snapshot.researchProgramPlanSelectionReady ? "true" : "false"}`
      );
    }
    if (snapshot.researchProgramZoteroProjectPath) {
      lines.push(`Research program Zotero path: ${snapshot.researchProgramZoteroProjectPath}`);
      lines.push(
        "Zotero local rule: use the local Zotero MCP server through /zotero-project-library for best-effort project collection sync. Any required Zotero credentials must come from the MCP server environment (for example ZOTERO_API_KEY / ZOTERO_USER_ID), not plugin config."
      );
    }
    if (
      snapshot.zoteroSyncStatus ||
      snapshot.zoteroSyncPendingAutoTrigger ||
      snapshot.researchProgramZoteroProjectPath
    ) {
      lines.push(
        `Zotero sync: status=${snapshot.zoteroSyncStatus ?? "missing"}, trigger=${snapshot.zoteroSyncTrigger ?? "unset"}, last_requested=${snapshot.zoteroSyncLastRequestedAt ?? "never"}, pending_auto=${snapshot.zoteroSyncPendingAutoTrigger ?? "none"}, path=${snapshot.researchProgramZoteroProjectPath ?? "unset"}`
      );
      if (snapshot.zoteroSyncTriggerReason || snapshot.zoteroSyncPendingAutoReason) {
        lines.push(
          `Zotero sync detail: last_reason=${snapshot.zoteroSyncTriggerReason ?? "none"}, pending_reason=${snapshot.zoteroSyncPendingAutoReason ?? "none"}`
        );
      }
    }
    if ((snapshot.researchProgramOnboardingMissing ?? []).length > 0) {
      lines.push(
        `Research program checklist: missing=${snapshot.researchProgramOnboardingMissing.join(", ")}`
      );
    }
  }
  if (snapshot.bootstrapRequestRawRequest) {
    lines.push(
      `Bootstrap request: source=${snapshot.bootstrapRequestSourceCommand ?? "unset"}, clean_topic=${snapshot.bootstrapRequestCleanTopic ?? "unset"}`
    );
    if (
      snapshot.bootstrapRequestRawRequest !== snapshot.bootstrapRequestCleanTopic
    ) {
      lines.push(`Bootstrap full request: ${snapshot.bootstrapRequestRawRequest}`);
    }
    if ((snapshot.bootstrapRequestReferenceHints ?? []).length > 0) {
      lines.push(
        `Bootstrap references: ${(snapshot.bootstrapRequestReferenceHints ?? []).join("; ")}`
      );
    }
    if ((snapshot.bootstrapRequestExplicitRequirements ?? []).length > 0) {
      lines.push(
        `Bootstrap requirements: ${(snapshot.bootstrapRequestExplicitRequirements ?? []).join("; ")}`
      );
    }
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
    lines.push(
      `Experiment inner loop: mode=${snapshot.experimentSearchInnerLoopMode ?? "unset"}, trial_budget_min=${snapshot.experimentSearchTrialTimeBudgetMinutes ?? "unset"}, one_change_signature=${snapshot.experimentSearchOneChangeSignature ?? "unset"}, one_change=${snapshot.experimentSearchOneChangeValidationStatus ?? "unset"}, comparable_budget=${snapshot.experimentSearchComparableTrialBudgetStatus ?? "unset"}, last_trial=${snapshot.experimentSearchLastTrialOutcome ?? "unset"}`
    );
    lines.push(
      `Experiment outer loop: dataset_coverage=${snapshot.experimentSearchBaselineDatasetCoverageStatus ?? "unset"}, innovation_deviation=${snapshot.experimentSearchInnovationDeviationStatus ?? "unset"}, deviation_score=${snapshot.experimentSearchInnovationDeviationScore ?? "unset"}`
    );
  }
  if (snapshot.paperStoryStatus) {
    lines.push(
      `Paper story: status=${snapshot.paperStoryStatus}, track=${snapshot.paperStoryTrackId ?? "unset"}, story_spine=${snapshot.paperStoryStorySpinePath ?? "unset"}, claim_map=${snapshot.paperStoryClaimToExperimentMapPath ?? "unset"}, fallback=${snapshot.paperStoryFallbackNarrativePath ?? "unset"}`
    );
    lines.push(
      `Paper story support: status=${snapshot.paperStoryClaimSupportStatus ?? "unknown"}, supported=${snapshot.paperStorySupportedClaimCount ?? 0}, partial=${snapshot.paperStoryPartialClaimCount ?? 0}, unsupported=${snapshot.paperStoryUnsupportedClaimCount ?? 0}`
    );
    if (snapshot.paperStoryPendingReason) {
      lines.push(`Paper story pending_reason: ${snapshot.paperStoryPendingReason}`);
    }
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
  if ((snapshot.writingSectionOrder ?? []).length > 0) {
    lines.push(`Writing section order: ${snapshot.writingSectionOrder.join(" -> ")}`);
  }
  if (snapshot.writingContractPendingReason) {
    lines.push(`Writing contract pending_reason: ${snapshot.writingContractPendingReason}`);
  }
  if (snapshot.citationVerificationRequired) {
    lines.push(
      `Citation integrity: status=${snapshot.citationVerificationStatus ?? "unknown"}, count=${snapshot.citationBibliographyEntryCount ?? 0}/${snapshot.citationMinimumCount ?? 0}, placeholders=${snapshot.citationUnresolvedPlaceholderCount ?? "unknown"}/${snapshot.citationAllowedPlaceholderCount ?? "unknown"}, verified=${snapshot.citationVerifiedCount ?? 0}, suspicious=${snapshot.citationSuspiciousCount ?? 0}, hallucinated=${snapshot.citationHallucinatedCount ?? 0}, topic_relevance=${snapshot.citationTopicRelevanceStatus ?? "unknown"}`
    );
    if (snapshot.citationBibliographyPath) {
      lines.push(`Citation bibliography: ${snapshot.citationBibliographyPath}`);
    }
    if (snapshot.citationVerificationReportPath) {
      lines.push(`Citation verification report: ${snapshot.citationVerificationReportPath}`);
    }
    if ((snapshot.citationSourceOfTruth ?? []).length > 0) {
      lines.push(`Citation sources of truth: ${snapshot.citationSourceOfTruth.join(", ")}`);
    }
    if (snapshot.citationPendingReason) {
      lines.push(`Citation pending_reason: ${snapshot.citationPendingReason}`);
    }
    if (snapshot.citationTopicRelevanceSummary) {
      lines.push(`Citation topicality: ${snapshot.citationTopicRelevanceSummary}`);
    }
  }
  if (snapshot.writingSessionStatus && snapshot.writingSessionStatus !== "missing") {
    lines.push(
      `Writing session: status=${snapshot.writingSessionStatus}, current_section=${snapshot.writingCurrentSection ?? "unset"}, section_review=${snapshot.writingCurrentSectionReviewVerdict ?? "unknown"}`
    );
    lines.push(
      `Writing progress: process=${snapshot.writingProcessStatus ?? "unknown"}, next_section=${snapshot.writingNextSuggestedSection ?? "unset"}, missing_sections=${(snapshot.writingMissingSections ?? []).join(", ") || "none"}, stale_sections=${(snapshot.writingStaleSections ?? []).join(", ") || "none"}`
    );
    lines.push(
      `Writing rebuild: needed=${snapshot.writingRebuildNeeded ? "true" : "false"}, reason=${snapshot.writingRebuildReason ?? "none"}`
    );
    lines.push(
      snapshot.writingRebuildNeeded
        ? "Writing recovery rule: rebuild only the missing durable writing scaffold, then resume from the first required section."
        : "Writing recovery rule: do not describe the paper as wiped; resume from the current section packets and only draft or refresh the missing/stale sections."
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
  if (snapshot.reviewPressureStatus) {
    lines.push(
      `Review pressure: status=${snapshot.reviewPressureStatus}, reject_first=${snapshot.reviewPressureRejectFirstReviewPath ?? "unset"}, unsupported_claim_audit=${snapshot.reviewPressureUnsupportedClaimAuditPath ?? "unset"}`
    );
    if (snapshot.reviewPressurePendingReason) {
      lines.push(`Review pressure pending_reason: ${snapshot.reviewPressurePendingReason}`);
    }
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
  if ((snapshot.recentExperiments ?? []).length > 0) {
    const experimentMonitorActiveRuns = snapshot.experimentActiveRunCount ?? 0;
    const experimentMonitorTerminalRuns = snapshot.experimentTerminalRunCount ?? 0;
    const experimentMonitorFinishedUnreconciled =
      snapshot.experimentFinishedUnreconciledCount ?? 0;
    if (
      snapshot.currentStage === "experiment" ||
      experimentMonitorActiveRuns > 0 ||
      experimentMonitorTerminalRuns > 0 ||
      experimentMonitorFinishedUnreconciled > 0
    ) {
      lines.push(
        `Experiment monitor: active_runs=${experimentMonitorActiveRuns}, terminal_runs=${experimentMonitorTerminalRuns}, finished_unreconciled=${experimentMonitorFinishedUnreconciled}, needs_monitor_pass=${snapshot.experimentNeedsMonitorPass ? "true" : "false"}, next=${snapshot.experimentMonitorRecommendedCommand ?? "none"}`
      );
      if (
        snapshot.experimentGpuMonitorStatus &&
        snapshot.experimentGpuMonitorStatus !== "missing"
      ) {
        lines.push(
          `GPU monitor: status=${snapshot.experimentGpuMonitorStatus}, checked_at=${snapshot.experimentGpuMonitorCheckedAt ?? "never"}, servers=${snapshot.experimentGpuMonitorServerCount ?? 0}, busy_assigned=${snapshot.experimentGpuMonitorBusyAssignedGpuCount ?? 0}, idle_assigned=${snapshot.experimentGpuMonitorIdleAssignedGpuCount ?? 0}, likely_finished=${snapshot.experimentGpuMonitorLikelyFinishedRunCount ?? 0}, recommendation=${snapshot.experimentGpuMonitorRecommendation ?? "none"}, path=${snapshot.experimentGpuMonitorPath ?? "unset"}`
        );
      }
      if (
        (snapshot.role === "coder" || snapshot.role === "researcher") &&
        snapshot.experimentNeedsMonitorPass
      ) {
        lines.push(
          "Experiment completion cue: if active_runs falls to 0 while finished_unreconciled stays above 0, remote execution is effectively done for now. Stop treating the branch as a fresh launch problem and switch to /monitor-experiment style reconciliation, ledger updates, and result promotion."
        );
        if ((snapshot.experimentGpuMonitorLikelyFinishedRunCount ?? 0) > 0) {
          lines.push(
            "GPU completion cue: one or more tracked runs now sit on idle assigned GPUs with missing screens. Treat them as likely finished and prioritize /monitor-experiment reconciliation over fresh launch work."
          );
        }
      }
    }
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
      `Experiment monitor: active_runs=${snapshot.experimentActiveRunCount ?? 0}, terminal_runs=${snapshot.experimentTerminalRunCount ?? 0}, finished_unreconciled=${snapshot.experimentFinishedUnreconciledCount ?? 0}, needs_monitor_pass=${snapshot.experimentNeedsMonitorPass ? "true" : "false"}, next=${snapshot.experimentMonitorRecommendedCommand ?? "none"}`
    );
    if (
      snapshot.experimentGpuMonitorStatus &&
      snapshot.experimentGpuMonitorStatus !== "missing"
    ) {
      lines.push(
        `GPU monitor: status=${snapshot.experimentGpuMonitorStatus}, checked_at=${snapshot.experimentGpuMonitorCheckedAt ?? "never"}, servers=${snapshot.experimentGpuMonitorServerCount ?? 0}, busy_assigned=${snapshot.experimentGpuMonitorBusyAssignedGpuCount ?? 0}, idle_assigned=${snapshot.experimentGpuMonitorIdleAssignedGpuCount ?? 0}, likely_finished=${snapshot.experimentGpuMonitorLikelyFinishedRunCount ?? 0}, recommendation=${snapshot.experimentGpuMonitorRecommendation ?? "none"}, path=${snapshot.experimentGpuMonitorPath ?? "unset"}`
      );
    }
    lines.push(
      "Recent experiments: none recorded yet; initialize the ledger before launching or rerunning experiments."
    );
  }
  if ((snapshot.unreadMailbox ?? []).length > 0) {
    lines.push("Unread mailbox:");
    for (const message of snapshot.unreadMailbox) {
      lines.push(
        `- [${message.priority}] ${message.fromAgent} -> ${message.toAgent}: ${message.subject}`
      );
    }
  }
  if ((snapshot.backgroundTasks ?? []).length > 0) {
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
    "Preferred paper-ingestion order: run the workflow-owned broad retrieval backbone first when breadth matters, keep /papers-cool search as the guaranteed baseline (optionally merge /pasa-paper-search when it succeeds), then once paper identity is confirmed call /hugging-face-paper-pages for arXiv papers -> if needed call /arxiv2md-api -> if needed call /markxiv -> if needed call /arxiv2md -> only if all Markdown sources are unavailable, use PDF fallback -> preserve metadata-only canonical entries for important unresolved papers -> update PAPER_SOURCE_INDEX.json source_provider/retrieval_providers -> queue one PaperNexus upload request through `research_workflow.queue_paper_ingestion` (`pn_stage_sync.py` + `pn_import_submit.py` + `pn_import_queue.py` for one paper, `pn_batch_import.py` with one manifest for 2+ staged papers, or the dedicated /papernexus-batch-import skill) -> /graph-build readiness + brainstorm bundle refresh."
  );
  lines.push(
    "PaperNexus import rule: if new PDFs or Markdown enter through a UI/API upload, prefer the queued wrapper path (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, and for 2+ papers `pn_batch_import.py`) by recording it through `research_workflow.queue_paper_ingestion`. The workflow PaperNexus upload worker owns launching, retrying, and reporting queued requests; agents should not run upload wrappers inline or clear `queued_requests` by hand. Use project-local staging files as temporary upload inputs; do not treat `~/.papernexus/papers` as workflow-owned storage."
  );
  lines.push(
    "PaperNexus bounded-ingestion rule: use one paper per `pn_import_submit.py` call, but use `pn_batch_import.py` with one manifest for 2+ papers. Prefer /papernexus-batch-import when the task is mainly manifest-driven multi-paper sync. Keep each workflow wait pass at 60s or less, persist batch summary/items through research_workflow.set_paper_ingestion, and continue with the next status pass instead of long-polling indefinitely."
  );
  if (
    snapshot.role === "researcher" &&
    ((snapshot.paperIngestionQueuedRequestCount ?? 0) > 0 ||
      (snapshot.paperIngestionRunningRequestCount ?? 0) > 0)
  ) {
    lines.push(
      "Foreground queue rule: if workflow-owned literature discovery or other long queue work is pending, keep the main chat session responsive. Start or monitor that work through research_workflow.start_background_run or the queued wrapper flow, and answer direct user questions in the foreground instead of consuming the whole reply with queue execution."
    );
  }
  if (resolvedPapernexusAccessMode === "remote_mcp") {
    lines.push(
      "PaperNexus brainstorm rule: during frontier mapping, innovation reflection, and idea divergence, prefer the remote HTTP MCP control plane (`research_lookup`, `research_briefing`, `idea_catalyst`) before trusting raw full-graph prominence. Keep `import_workflow` and the queued wrappers for staged import/status work."
    );
  } else {
    lines.push(
      "PaperNexus brainstorm rule: during frontier mapping, innovation reflection, and idea divergence, prefer the brainstorm-quality node view (`brainstormEligible`, `brainstormScore`, `brainstormTier`) and typed wrapper calls through `research_workflow.run_papernexus_wrapper` (`pn_graph_query.py` / `pn_research_chains.py`) or the dedicated /papernexus-research-chains skill before trusting raw full-graph prominence."
    );
  }
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
    "Graph-backed experiment memory rule: treat researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json as distilled guidance for planning, coder search, and reflection. It complements the ledger but does not replace the local runtime source of truth."
  );
  lines.push(
    "Innovation reflection rule: if experiments have produced new evidence since the last reflection, run /innovation-reflection and refresh researcher/INNOVATION_REFLECTION.md before proposing or locking a new innovation direction."
  );
  if (shouldApplySharedWritingConstitutionImpl(snapshot)) {
    lines.push(...deps.getSharedWritingConstitutionLines(snapshot.role ?? null));
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
