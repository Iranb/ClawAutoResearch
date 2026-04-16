import * as path from "node:path";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { asRecord, asStringArray, pickString } from "../workflow-guard-core/coercion";
import {
  buildExperimentReviewPacketFingerprint,
  loadExperimentReviewState,
  saveExperimentReviewStateFile,
} from "../workflow-auto-experiment-review";
import {
  DEFAULT_EXPERIMENT_LAUNCH_DECISION_PATH,
  DEFAULT_EXPERIMENT_PLAN_PATH,
  DEFAULT_EXPERIMENT_REVIEW_PACKET_PATH,
  coerceCompletedReviewStatus,
  normalizeExperimentReviewVerdict,
  normalizeAutonomousExecutionState,
  normalizeExperimentReviewState,
  serializeExperimentReviewState,
  type ExperimentReviewStateLike,
} from "../workflow-guard-state/experiment-review";
import {
  normalizeExperimentSearchSpec,
  resolveExperimentSearchSpecPath,
} from "../workflow-guard-state/experiment-search-spec";
import {
  buildOneChangeSignature,
  collectBaselineDatasetEnvelope,
  collectInnovationAnchorPoints,
  normalizeExperimentInnerLoopContract,
  normalizeExperimentOuterLoopPolicy,
} from "../workflow-experiment-loop";

type MaterializerDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function getActiveTrackIds(manifest: Record<string, unknown>, trackRegistry: Record<string, unknown> | null) {
  const registryTracks = Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [];
  const activeRegistryIds = registryTracks
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((track) => String(track.status ?? "").trim().toLowerCase() === "active")
    .map((track) => pickString(track, ["track_id", "trackId"]))
    .filter((entry): entry is string => Boolean(entry));
  const manifestIds = Array.isArray(manifest.active_track_ids)
    ? asStringArray(manifest.active_track_ids)
    : [];
  const programTracks = Array.isArray(
    manifest.research_program &&
      typeof manifest.research_program === "object" &&
      (manifest.research_program as Record<string, unknown>).tracks
  )
    ? ((manifest.research_program as Record<string, unknown>).tracks as unknown[])
    : [];
  const programIds = programTracks
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((track) => String(track.status ?? "").trim().toLowerCase() === "active")
    .map((track) => pickString(track, ["track_id", "trackId"]))
    .filter((entry): entry is string => Boolean(entry));
  return uniqueStrings([...activeRegistryIds, ...manifestIds, ...programIds]).slice(0, 2);
}

function getResearchProgramTrackRecords(
  manifest: Record<string, unknown>,
  trackIds: string[]
): Record<string, unknown>[] {
  const programTracks =
    manifest.research_program &&
    typeof manifest.research_program === "object" &&
    Array.isArray((manifest.research_program as Record<string, unknown>).tracks)
      ? ((manifest.research_program as Record<string, unknown>).tracks as unknown[])
      : [];
  return programTracks
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => {
      const trackId = pickString(entry, ["track_id", "trackId"]);
      return Boolean(trackId && trackIds.includes(trackId));
    });
}

function summarizePriorExperimentVerdicts(
  ledger: Record<string, unknown> | null
): Array<Record<string, unknown>> {
  const experiments = Array.isArray(ledger?.experiments) ? ledger.experiments : [];
  return experiments
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-6)
    .map((entry) => ({
      experiment_id:
        pickString(entry, ["experimentId", "experiment_id"]) ?? "unknown-experiment",
      track_id: pickString(entry, ["trackId", "track_id"]),
      status: pickString(entry, ["status"]),
      decision: pickString(entry, ["decision"]),
      key_metric: entry.keyMetric ?? entry.key_metric ?? null,
      failure_signature:
        pickString(entry, ["failureSignature", "failure_signature"]) ?? null,
    }));
}

function collectClaimIds(rawText: string | null): string[] {
  if (!rawText) {
    return [];
  }
  const matches = rawText.match(/\b(?:claim-\d+|C\d+)\b/gi) ?? [];
  return uniqueStrings(matches.map((entry) => entry.toLowerCase()));
}

function deriveStatus(state: ExperimentReviewStateLike): string {
  if (state.launchApproved) {
    return "ready_for_launch";
  }
  if (state.crossReviewerVerdict === "block" || state.analyzerVerdict === "block") {
    return "blocked";
  }
  if (state.crossReviewerVerdict === "revise" || state.analyzerVerdict === "revise") {
    return "revise";
  }
  if (state.plannerStatus !== "ready") {
    return "planning";
  }
  if (state.analyzerStatus !== "ready" || state.crossReviewerStatus !== "ready") {
    return "reviewing";
  }
  return "synthesis";
}

function buildPlannerPlanMarkdown(params: {
  trackIds: string[];
  claimIds: string[];
  graphPacketPaths: string[];
  basisStage: string | null;
}) {
  const trackBullets =
    params.trackIds.length > 0
      ? params.trackIds.map((trackId) => `- ${trackId}`).join("\n")
      : "- unresolved";
  const claimBullets =
    params.claimIds.length > 0
      ? params.claimIds.map((claimId) => `- ${claimId}`).join("\n")
      : "- claim ids unresolved";
  const graphBullets =
    params.graphPacketPaths.length > 0
      ? params.graphPacketPaths.map((entry) => `- ${entry}`).join("\n")
      : "- no graph packet available yet";
  return `# Experiment Plan\n\n## Basis Stage\n- ${params.basisStage ?? "experiment"}\n\n## Target Tracks\n${trackBullets}\n\n## Claims Under Test\n${claimBullets}\n\n## Graph Grounding\n${graphBullets}\n\n## Required Checks\n- one variable per experiment\n- baseline fairness is explicit\n- metric + seed plan is explicit\n- at least one falsifier / failure mode is named\n- stop rules are explicit before launch\n`;
}

function extractReviewVerdict(text: string | null): "pass" | "revise" | "block" | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\bverdict\b\s*[:=-]\s*(pass|revise|block|blocked)\b/i);
  return normalizeExperimentReviewVerdict(match?.[1] ?? null);
}

function extractCriticalBlockers(text: string | null): string[] {
  if (!text) {
    return [];
  }
  const explicit = [...text.matchAll(/^\s*[-*]\s*(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  const criticalSection = text.match(
    /(?:critical(?:\s+blockers?|\s+issues?)|blockers?)\s*[:\n]([\s\S]{0,1200})/i
  )?.[1];
  const sectionBullets = criticalSection
    ? [...criticalSection.matchAll(/^\s*[-*]\s*(.+)$/gm)].map(
        (match) => match[1]?.trim() ?? ""
      )
    : [];
  return uniqueStrings([...sectionBullets, ...explicit].filter(Boolean)).slice(0, 8);
}

function readDecisionJson(value: Record<string, unknown> | null): {
  launchApproved: boolean;
  status: string | null;
  blockers: string[];
  reviewRound: number | null;
  lastApprovedAt: string | null;
} {
  const record = value ?? {};
  return {
    launchApproved: record.launch_approved === true || record.launchApproved === true,
    status:
      pickString(record, ["status"]) ??
      (record.launch_approved === true || record.launchApproved === true
        ? "approved"
        : null),
    blockers: asStringArray(record.blockers ?? record.blocker_reasons),
    reviewRound:
      typeof record.review_round === "number"
        ? Math.max(0, Math.floor(record.review_round))
        : typeof record.reviewRound === "number"
          ? Math.max(0, Math.floor(record.reviewRound))
          : null,
    lastApprovedAt:
      pickString(record, ["approved_at", "approvedAt"]) ??
      pickString(record, ["last_launch_approved_at", "lastLaunchApprovedAt"]),
  };
}

async function writeJsonIfChanged(
  targetPath: string,
  value: Record<string, unknown>
): Promise<boolean> {
  const current = await readJsonIfExists<Record<string, unknown>>(targetPath);
  if (current && JSON.stringify(current) === JSON.stringify(value)) {
    return false;
  }
  await writeJsonEnsured(targetPath, value);
  return true;
}

async function writeTextIfChanged(targetPath: string, value: string): Promise<boolean> {
  const current = await readTextIfExists(targetPath);
  if (current === value) {
    return false;
  }
  await writeTextEnsured(targetPath, value);
  return true;
}

export async function materializeExperimentReviewStateImpl(
  params: {
    projectRoot: string;
    experimentReviewMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  },
  deps: MaterializerDeps
): Promise<{
  state: ExperimentReviewStateLike;
  stateFilePath: string;
  stateFileExists: boolean;
  packetResolvedPath: string | null;
  packetExists: boolean;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await deps.readManifestEnsured(projectRoot);
  const current = await loadExperimentReviewState({
    projectRoot,
    manifest,
  });
  const autonomousExecution = normalizeAutonomousExecutionState(
    manifest.autonomous_execution
  );
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? null;
  const trackIds = getActiveTrackIds(manifest, trackRegistry);
  const claimMapPath =
    pickString(params.experimentReviewMaterialization ?? {}, [
      "claimMapPath",
      "claim_map_path",
    ]) ?? "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md";
  const graphPacketCandidates = [
    "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json",
    "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json",
    "researcher/papernexus/GRAPH_STORYLINE_PACKET.json",
  ];
  const graphPacketPaths: string[] = [];
  for (const relativePath of graphPacketCandidates) {
    const resolved = resolveProjectArtifactPath(projectRoot, relativePath);
    if (resolved && (await pathExists(resolved))) {
      graphPacketPaths.push(relativePath);
    }
  }
  const claimMapText = await readTextIfExists(
    resolveProjectArtifactPath(projectRoot, claimMapPath)
  );
  const claimIds = collectClaimIds(claimMapText);
  const activeTrackRecords = getResearchProgramTrackRecords(manifest, trackIds);
  const searchSpecPath = resolveExperimentSearchSpecPath({
    projectRoot,
    manifest,
    searchSpecPath:
      pickString(asRecord(manifest.experiment_search) ?? {}, [
        "searchSpecPath",
        "search_spec_path",
      ]) ?? null,
  });
  const searchSpec = normalizeExperimentSearchSpec(
    await readJsonIfExists<Record<string, unknown>>(searchSpecPath)
  );
  const innerLoop = normalizeExperimentInnerLoopContract(searchSpec);
  const outerLoop = normalizeExperimentOuterLoopPolicy(searchSpec);
  const experimentLedger =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    )) ?? null;
  const baselines = uniqueStrings(
    activeTrackRecords.flatMap((track) =>
      asStringArray(track.required_baselines ?? track.baselines ?? track.baseline_reference)
    )
  );
  const ablations = uniqueStrings(
    activeTrackRecords.flatMap((track) =>
      asStringArray(track.required_ablations ?? track.ablation_plan)
    )
  );
  const falsifiers = uniqueStrings(
    activeTrackRecords.flatMap((track) =>
      asStringArray(track.required_controls ?? track.falsifiers ?? track.validation_steps)
    )
  );
  const stopRules = uniqueStrings(
    activeTrackRecords.flatMap((track) => asStringArray(track.stop_rules ?? track.stopRules))
  );
  const metrics = uniqueStrings([
    pickString(
      manifest.research_program && typeof manifest.research_program === "object"
        ? (manifest.research_program as Record<string, unknown>)
        : {},
      ["primary_metric", "primaryMetric"]
    ),
  ]);
  const datasets = uniqueStrings(
    manifest.research_program && typeof manifest.research_program === "object"
      ? asStringArray((manifest.research_program as Record<string, unknown>).datasets)
      : []
  );
  const baselineDatasetEnvelope = collectBaselineDatasetEnvelope({
    manifest,
    trackRecords: activeTrackRecords,
  });
  const innovationAnchorPoints = collectInnovationAnchorPoints({
    manifest,
    trackRecords: activeTrackRecords,
  });
  const oneChangeSignature = buildOneChangeSignature({
    trackRecords: activeTrackRecords,
  });
  const packet = {
    schema_version: 1,
    trigger: params.trigger ?? "materialize_experiment_review_state",
    basis_stage:
      pickString(params.experimentReviewMaterialization ?? {}, [
        "basisStage",
        "basis_stage",
      ]) ?? String(manifest.current_stage ?? "experiment"),
    target_track_ids: trackIds,
    primary_track_id:
      pickString(params.experimentReviewMaterialization ?? {}, [
        "primaryTrackId",
        "primary_track_id",
      ]) ??
      pickString(manifest, ["primary_track_id", "primaryTrackId"]) ??
      trackIds[0] ??
      null,
    claim_ids: claimIds,
    claim_map_path: claimMapPath,
    one_variable_change: oneChangeSignature,
    one_change_signature: oneChangeSignature,
    baselines,
    datasets,
    baseline_dataset_envelope: baselineDatasetEnvelope,
    metrics,
    ablations,
    falsifiers,
    stop_rules: stopRules,
    compute_budget:
      activeTrackRecords.length === 1 ? activeTrackRecords[0].budget ?? null : null,
    inner_loop: {
      mode: innerLoop.mode,
      trial_time_budget_minutes: innerLoop.trialTimeBudgetMinutes,
      strict_comparable_budget: innerLoop.strictComparableBudget,
      require_one_change_signature: innerLoop.requireOneChangeSignature,
      keep_discard_rule: innerLoop.keepDiscardRule,
      one_change_signature: oneChangeSignature,
    },
    outer_loop: {
      require_baseline_dataset_coverage_for_effective_candidates:
        outerLoop.requireBaselineDatasetCoverageForEffectiveCandidates,
      innovation_deviation_tolerance: outerLoop.innovationDeviationTolerance,
      baseline_dataset_envelope: baselineDatasetEnvelope,
      innovation_anchor_points: innovationAnchorPoints,
    },
    expected_artifacts: [
      "researcher/artifacts/results/",
      "researcher/EXPERIMENT_LEDGER.json",
      "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      "analyzer/QUALITY_AUDIT.md",
    ],
    graph_packet_paths: graphPacketPaths,
    graph_grounding: {
      packet_paths: graphPacketPaths,
      baseline_norms: baselines,
      evaluation_norms: metrics,
      mechanism_bridges: graphPacketPaths,
    },
    track_summaries: activeTrackRecords.map((track) => ({
      track_id: pickString(track, ["track_id", "trackId"]),
      hypothesis: pickString(track, ["hypothesis"]),
      innovation_points: asStringArray(track.innovation_points),
      required_baselines: asStringArray(track.required_baselines),
      required_ablations: asStringArray(track.required_ablations),
      required_controls: asStringArray(track.required_controls),
      stop_rules: asStringArray(track.stop_rules ?? track.stopRules),
      budget: track.budget ?? null,
      datasets: asStringArray(track.datasets ?? track.dataset_scope ?? track.datasetScope),
    })),
    prior_experiment_verdicts: summarizePriorExperimentVerdicts(experimentLedger),
    review_principles: [
      "one variable per experiment",
      "baseline fairness",
      "metric sufficiency",
      "seed / variance adequacy",
      "explicit falsifier coverage",
      "clear stop rules",
      "fixed trial-time budget for comparable inner-loop trials",
      "baseline dataset envelope should be covered before declaring an effective candidate stable",
      "innovation drift should stay broad and reviewable rather than silently rewriting the thesis",
    ],
  } as Record<string, unknown>;
  const packetFingerprint = buildExperimentReviewPacketFingerprint({
    trackIds,
    claimIds,
    graphPacketPaths,
    packet,
  });
  const fingerprintChanged =
    current.packetFingerprint && current.packetFingerprint !== packetFingerprint;
  const next: ExperimentReviewStateLike = normalizeExperimentReviewState({
    ...serializeExperimentReviewState(current),
    launch_mode: autonomousExecution.experimentLaunchMode,
    packet_fingerprint: packetFingerprint,
    target_track_ids: trackIds,
    claim_ids: claimIds,
    graph_packet_paths: graphPacketPaths,
    status: current.status,
    micro_stage: current.microStage,
    pending_reason:
      trackIds.length === 0
        ? "No active tracks are registered for experiment review."
        : current.pendingReason,
  });

  if (fingerprintChanged || current.status === "missing") {
    next.reviewRound = 0;
    next.plannerStatus = "pending";
    next.analyzerStatus = autonomousExecution.requireAnalyzerReview ? "pending" : "skipped";
    next.crossReviewerStatus = autonomousExecution.requireCrossReview
      ? "pending"
      : "skipped";
    next.synthesisStatus = "pending";
    next.analyzerVerdict = null;
    next.crossReviewerVerdict = null;
    next.launchApproved = false;
    next.lastLaunchApprovedAt = null;
    next.blockers = [];
    next.blockerCount = 0;
  }

  next.status = deriveStatus(next);
  const packetResolvedPath = resolveProjectArtifactPath(projectRoot, next.packetPath);
  const plannerPlanResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    next.plannerPlanPath
  );
  const launchDecisionResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    next.launchDecisionPath
  );
  const analyzerReportResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    next.analyzerReportPath
  );
  const crossReviewerReportResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    next.crossReviewerReportPath
  );

  const generatedFiles: string[] = [];
  const plannerPlanMarkdown = buildPlannerPlanMarkdown({
    trackIds,
    claimIds,
    graphPacketPaths,
    basisStage:
      typeof packet.basis_stage === "string" ? packet.basis_stage : "experiment",
  });
  if (packetResolvedPath) {
    const wrotePacket = await writeJsonIfChanged(packetResolvedPath, {
      ...packet,
      packet_fingerprint: packetFingerprint,
    });
    if (wrotePacket) {
      generatedFiles.push(next.packetPath ?? DEFAULT_EXPERIMENT_REVIEW_PACKET_PATH);
    }
  }
  if (plannerPlanResolvedPath) {
    const wrotePlan = await writeTextIfChanged(plannerPlanResolvedPath, plannerPlanMarkdown);
    if (wrotePlan) {
      generatedFiles.push(next.plannerPlanPath ?? DEFAULT_EXPERIMENT_PLAN_PATH);
    }
  }
  if (launchDecisionResolvedPath && !(await pathExists(launchDecisionResolvedPath))) {
    await writeJsonEnsured(launchDecisionResolvedPath, {
      status: "pending_review",
      launch_approved: false,
      trigger: params.trigger ?? "materialize_experiment_review_state",
      packet_fingerprint: packetFingerprint,
      track_ids: trackIds,
      claim_ids: claimIds,
    });
    generatedFiles.push(
      next.launchDecisionPath ?? DEFAULT_EXPERIMENT_LAUNCH_DECISION_PATH
    );
  }

  const analyzerReportText = await readTextIfExists(analyzerReportResolvedPath);
  const analyzerVerdict =
    extractReviewVerdict(analyzerReportText) ??
    normalizeExperimentReviewVerdict(next.analyzerVerdict);
  if (analyzerReportText) {
    next.analyzerStatus = coerceCompletedReviewStatus(
      next.analyzerStatus,
      analyzerVerdict,
      next.analyzerStatus
    );
    next.analyzerVerdict = analyzerVerdict;
  }

  const crossReviewerReportText = await readTextIfExists(crossReviewerReportResolvedPath);
  const crossReviewerVerdict =
    extractReviewVerdict(crossReviewerReportText) ??
    normalizeExperimentReviewVerdict(next.crossReviewerVerdict);
  if (crossReviewerReportText) {
    next.crossReviewerStatus = coerceCompletedReviewStatus(
      next.crossReviewerStatus,
      crossReviewerVerdict,
      next.crossReviewerStatus
    );
    next.crossReviewerVerdict = crossReviewerVerdict;
  }

  const decisionRecord = readDecisionJson(
    launchDecisionResolvedPath
      ? await readJsonIfExists<Record<string, unknown>>(launchDecisionResolvedPath)
      : null
  );
  if (decisionRecord.reviewRound !== null) {
    next.reviewRound = Math.max(next.reviewRound, decisionRecord.reviewRound);
  }
  if (decisionRecord.launchApproved) {
    next.launchApproved = true;
    next.synthesisStatus = "ready";
    next.lastLaunchApprovedAt =
      decisionRecord.lastApprovedAt ?? next.lastLaunchApprovedAt ?? new Date().toISOString();
  } else if (decisionRecord.status) {
    next.synthesisStatus =
      decisionRecord.status === "approved"
        ? "ready"
        : decisionRecord.status === "blocked"
          ? "blocked"
          : decisionRecord.status === "revise"
            ? "revise"
            : next.synthesisStatus;
  }

  const analyzerBlockers =
    analyzerVerdict === "block" || analyzerVerdict === "revise"
      ? extractCriticalBlockers(analyzerReportText)
      : [];
  const crossBlockers =
    crossReviewerVerdict === "block" || crossReviewerVerdict === "revise"
      ? extractCriticalBlockers(crossReviewerReportText)
      : [];
  next.blockers = uniqueStrings([
    ...decisionRecord.blockers,
    ...analyzerBlockers,
    ...crossBlockers,
  ]);
  next.blockerCount = next.blockers.length;
  next.pendingReason =
    trackIds.length === 0
      ? "No active tracks are registered for experiment review."
      : next.blockerCount > 0
        ? next.blockers[0] ?? current.pendingReason
        : next.launchApproved
          ? null
          : next.analyzerStatus !== "ready"
            ? "Analyzer review is still pending."
            : next.crossReviewerStatus !== "ready"
              ? "Cross-reviewer attack pass is still pending."
              : "Researcher synthesis has not yet approved launch.";
  next.status = deriveStatus(next);
  next.microStage =
    next.status === "planning"
      ? "planning"
      : next.status === "reviewing"
        ? next.analyzerStatus !== "ready"
          ? "analyzer_review"
          : next.crossReviewerStatus !== "ready"
            ? "cross_review"
            : "synthesis"
        : next.status === "ready_for_launch"
          ? "launch_ready"
          : next.status === "blocked" || next.status === "revise"
            ? "synthesis"
            : next.status;
  next.lastUpdatedAt = new Date().toISOString();

  manifest.autonomous_execution = {
    ...(manifest.autonomous_execution &&
    typeof manifest.autonomous_execution === "object" &&
    !Array.isArray(manifest.autonomous_execution)
      ? manifest.autonomous_execution
      : {}),
    ...normalizeAutonomousExecutionState(manifest.autonomous_execution),
    experiment_launch_mode: autonomousExecution.experimentLaunchMode,
  };
  manifest.experiment_review_state = serializeExperimentReviewState(next);
  await saveExperimentReviewStateFile({ projectRoot, state: next });
  await deps.saveManifest(projectRoot, manifest);

  return {
    state: next,
    stateFilePath: next.stateFilePath ?? "researcher/EXPERIMENT_REVIEW_STATE.json",
    stateFileExists: await pathExists(path.join(projectRoot, next.stateFilePath ?? "researcher/EXPERIMENT_REVIEW_STATE.json")),
    packetResolvedPath,
    packetExists: Boolean(packetResolvedPath && (await pathExists(packetResolvedPath))),
    generatedFiles,
  };
}
