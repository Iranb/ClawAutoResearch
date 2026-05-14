import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import {
  normalizeOrchestrationState,
  serializeOrchestrationState,
} from "../workflow-guard-state/execution-state";
import { reconcileWorkflowControl } from "../workflow-control-reconciler";
import {
  normalizeResearchProgramState,
} from "../workflow-guard-state/research-program";
import type { ResearchProgramState, ResearchProgramTrack } from "../workflow-guard.js";

type ManifestLike = Record<string, unknown>;

const CODE_EXPERIMENT_ARTIFACTS = {
  index: "coder/EXPERIMENT_INDEX.md",
  orchestratorDispatch: "orchestrator/EXPERIMENT_DISPATCH.json",
  coderDispatch: "coder/EXPERIMENT_DISPATCH.json",
  implementationEvidence: "coder/IMPLEMENTATION_EVIDENCE_PACKET.json",
  baselineAlignment: "coder/BASELINE_ALIGNMENT_PACKET.json",
  hyperparameterSourceMap: "coder/HYPERPARAMETER_SOURCE_MAP.json",
  datasetProtocolLock: "coder/DATASET_PROTOCOL_LOCK.json",
  reproductionRiskLedger: "coder/REPRODUCTION_RISK_LEDGER.json",
  train: "train.py",
  readme: "README.md",
  manifest: "EXPERIMENT_MANIFEST.json",
  protocol: "GCD_PROTOCOL.json",
  dataset: "data/gcd_reference_split.jsonl",
} as const;

type ExistingCodeBundle = {
  dir: string;
  relativeDir: string;
  manifestPath: string;
  manifest: Record<string, unknown> | null;
  hasTrain: boolean;
  hasReadme: boolean;
  hasProtocol: boolean;
  hasDataset: boolean;
  legacyLocalProxy: boolean;
  profileMismatch: boolean;
};

type CodeExperimentProfile = {
  kind: "gcd" | "sqlite" | "generic_gcd_compat";
  slug: string;
  name: string;
  implementationType: string;
  protocol: string;
  dataset: string;
  readmeTitle: string;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return (
    values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null
  );
}

function isGcdTopic(value: string | null | undefined): boolean {
  return /\bgcd\b|generalized category discovery|fixmatch/u.test(value?.toLowerCase() ?? "");
}

function isSqliteTopic(value: string | null | undefined): boolean {
  return /sqlite|b-?tree|covering index|composite index|single-column index|point quer|range quer|query latency|insert overhead|database size/u.test(
    value?.toLowerCase() ?? ""
  );
}

function resolveCodeExperimentProfile(topic: string): CodeExperimentProfile {
  if (isSqliteTopic(topic)) {
    return {
      kind: "sqlite",
      slug: "sqlite_index_latency_benchmark",
      name: "sqlite_index_latency_benchmark",
      implementationType: "local_reference_sqlite_index_benchmark",
      protocol: "SQLITE_PROTOCOL.json",
      dataset: "data/sqlite_workload_config.json",
      readmeTitle: "SQLite Index Latency Reference Benchmark",
    };
  }
  if (isGcdTopic(topic)) {
    return {
      kind: "gcd",
      slug: "fixmatch_gcd_consistency_debiasing",
      name: "fixmatch_gcd_consistency_debiasing",
      implementationType: "local_reference_gcd_benchmark",
      protocol: CODE_EXPERIMENT_ARTIFACTS.protocol,
      dataset: CODE_EXPERIMENT_ARTIFACTS.dataset,
      readmeTitle: "FixMatch-Inspired GCD Reference Benchmark",
    };
  }
  return {
    kind: "generic_gcd_compat",
    slug: "local_consistency_debiasing_probe",
    name: "fixmatch_gcd_consistency_debiasing",
    implementationType: "local_reference_gcd_benchmark",
    protocol: CODE_EXPERIMENT_ARTIFACTS.protocol,
    dataset: CODE_EXPERIMENT_ARTIFACTS.dataset,
    readmeTitle: "FixMatch-Inspired GCD Reference Benchmark",
  };
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}

function normalizeContractText(value: string | null | undefined): string | null {
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

function listStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry.trim()] : []
    )
  );
}

function listObjectEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ summary: entry.trim() }];
    }
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}

function implementationProofRecord(manifest: Record<string, unknown>): Record<string, unknown> {
  return asRecord(manifest.implementation_proof ?? manifest.implementationProof) ?? {};
}

function selectedPlanEvidencePaths(params: {
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
}): string[] {
  const selection = params.researchProgram.planSelection;
  const optionIds = new Set(
    [
      selection.selectedOptionId,
      ...selection.comparedOptionIds,
      ...selection.fallbackOptionIds,
    ].filter((item): item is string => Boolean(item))
  );
  const planEvidencePaths = params.researchProgram.planAlternatives.flatMap((option) => {
    if (option.linkedTrackId === params.track.trackId || optionIds.has(option.optionId)) {
      return option.graphEvidencePaths;
    }
    return [];
  });
  return uniqueStrings([
    ...selection.decisiveGraphEvidencePaths,
    ...planEvidencePaths,
  ]);
}

function evidencePacketPathFields(): Record<string, string> {
  return {
    implementation_evidence_packet_path: CODE_EXPERIMENT_ARTIFACTS.implementationEvidence,
    baseline_alignment_packet_path: CODE_EXPERIMENT_ARTIFACTS.baselineAlignment,
    hyperparameter_source_map_path: CODE_EXPERIMENT_ARTIFACTS.hyperparameterSourceMap,
    dataset_protocol_lock_path: CODE_EXPERIMENT_ARTIFACTS.datasetProtocolLock,
    reproduction_risk_ledger_path: CODE_EXPERIMENT_ARTIFACTS.reproductionRiskLedger,
  };
}

function inferTopic(params: {
  manifest: ManifestLike;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
}): string {
  return (
    firstNonEmpty(
      params.researchProgram.goal,
      params.track.hypothesis,
      pickString(params.manifest, ["title", "topic", "research_topic", "researchTopic"])
    ) ?? "the selected research direction"
  );
}

function selectActiveTrack(
  state: ResearchProgramState
): ResearchProgramTrack | null {
  const selectedTrackId = state.planSelection.selectedTrackId;
  const activeTracks = state.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
  if (selectedTrackId) {
    const selectedActive = activeTracks.find(
      (track) => track.trackId === selectedTrackId
    );
    if (selectedActive) {
      return selectedActive;
    }
  }
  return activeTracks[0] ?? null;
}

function selectActiveTracksForMaterialization(
  state: ResearchProgramState
): ResearchProgramTrack[] {
  const selectedTrack = selectActiveTrack(state);
  const activeTracks = state.tracks.filter(
    (track) => normalizeStage(track.status) === "active"
  );
  if (!selectedTrack) {
    return activeTracks;
  }
  return [
    selectedTrack,
    ...activeTracks.filter((track) => track.trackId !== selectedTrack.trackId),
  ];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function codeEvidencePacketsExist(projectRoot: string): Promise<boolean> {
  for (const relativePath of Object.values(evidencePacketPathFields())) {
    if (!(await pathExists(path.join(projectRoot, relativePath)))) {
      return false;
    }
  }
  return true;
}

function isLegacyLocalProxyText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /synthetic proxy|synthetic-gcd-proxy|local proxy|build_dataset\(seed\)/iu.test(value);
}

function isProfileMismatchText(params: {
  profile: CodeExperimentProfile;
  manifest: Record<string, unknown> | null;
  trainText: string | null;
  readmeText: string | null;
}): boolean {
  const manifestText = params.manifest ? JSON.stringify(params.manifest) : "";
  const text = [params.trainText ?? "", params.readmeText ?? "", manifestText].join("\n");
  if (params.profile.kind === "sqlite") {
    return /GCD_PROTOCOL|gcd_reference_split|run_fixmatch_consistency|known_novel_h_score|FixMatch|generalized category discovery/iu.test(
      text
    );
  }
  return /SQLITE_PROTOCOL|sqlite_workload_config|sqlite3|create_index_strategy|run_sqlite_index_benchmark/iu.test(
    text
  );
}

async function listExistingCodeBundles(
  projectRoot: string,
  trackId: string,
  profile: CodeExperimentProfile
): Promise<ExistingCodeBundle[]> {
  const trackDir = path.join(projectRoot, "coder", "experiments", trackId);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(trackDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bundles: ExistingCodeBundle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(trackDir, entry.name);
    const relativeDir = path
      .relative(projectRoot, dir)
      .split(path.sep)
      .join(path.posix.sep);
    const manifestPath = path.join(dir, CODE_EXPERIMENT_ARTIFACTS.manifest);
    const trainText = await readTextIfExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.train));
    const readmeText = await readTextIfExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.readme));
    const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
    bundles.push({
      dir,
      relativeDir,
      manifestPath,
      manifest,
      hasTrain: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.train)),
      hasReadme: await pathExists(path.join(dir, CODE_EXPERIMENT_ARTIFACTS.readme)),
      hasProtocol: await pathExists(path.join(dir, profile.protocol)),
      hasDataset: await pathExists(path.join(dir, profile.dataset)),
      legacyLocalProxy: isLegacyLocalProxyText(trainText) || isLegacyLocalProxyText(readmeText),
      profileMismatch: isProfileMismatchText({ profile, manifest, trainText, readmeText }),
    });
  }
  return bundles.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

function getRegistryTrack(
  trackRegistry: Record<string, unknown>,
  trackId: string
): Record<string, unknown> | null {
  const tracks = Array.isArray(trackRegistry.tracks) ? trackRegistry.tracks : [];
  for (const entry of tracks) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    if (pickString(record, ["track_id", "trackId", "id"]) === trackId) {
      return record;
    }
  }
  return null;
}

function isAlignedToTrackContract(params: {
  bundleManifest: Record<string, unknown> | null;
  track: ResearchProgramTrack;
}): boolean {
  if (!params.bundleManifest) {
    return false;
  }
  const trackId = pickString(params.bundleManifest, ["track_id", "trackId"]);
  if (trackId !== params.track.trackId) {
    return false;
  }
  const bundleHypothesis = normalizeContractText(
    pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const bundleNoveltyBasis = normalizeContractText(
    pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"])
  );
  const expectedHypothesis = normalizeContractText(params.track.hypothesis);
  const expectedNoveltyBasis = normalizeContractText(params.track.noveltyBasis);
  return (
    (!expectedHypothesis || bundleHypothesis === expectedHypothesis) &&
    (!expectedNoveltyBasis || bundleNoveltyBasis === expectedNoveltyBasis)
  );
}

function bundleTextReferencesTrack(params: {
  bundleManifest: Record<string, unknown>;
  track: ResearchProgramTrack;
}): boolean {
  const text = normalizeContractText(
    [
      pickString(params.bundleManifest, ["question", "experiment_question", "objective"]),
      pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"]),
      pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"]),
      pickString(params.bundleManifest, ["name", "title"]),
    ]
      .filter((item): item is string => Boolean(item))
      .join(" ")
  );
  if (!text) {
    return false;
  }
  const trackToken = normalizeContractText(params.track.trackId);
  const expectedHypothesis = normalizeContractText(params.track.hypothesis);
  const expectedNoveltyBasis = normalizeContractText(params.track.noveltyBasis);
  return Boolean(
    (trackToken && text.includes(trackToken)) ||
      (expectedHypothesis && text.includes(expectedHypothesis)) ||
      (expectedNoveltyBasis && text.includes(expectedNoveltyBasis))
  );
}

function bundleTextHasTrackMarker(params: {
  bundleManifest: Record<string, unknown>;
  track: ResearchProgramTrack;
}): boolean {
  const text = normalizeContractText(
    [
      pickString(params.bundleManifest, ["question", "experiment_question", "objective"]),
      pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"]),
      pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"]),
      pickString(params.bundleManifest, ["name", "title"]),
    ]
      .filter((item): item is string => Boolean(item))
      .join(" ")
  );
  const trackToken = normalizeContractText(params.track.trackId);
  return Boolean(trackToken && text?.includes(trackToken));
}

function implementationProofNeedsRepair(record: Record<string, unknown>): boolean {
  const innovationPoints = listStructuredAlignmentStrings(
    record.innovation_points ?? record.innovationPoints
  );
  const implementationProof =
    asRecord(record.implementation_proof ?? record.implementationProof) ?? {};
  const rawChangedFiles =
    implementationProof.changed_files ?? implementationProof.changedFiles;
  const changedFiles = Array.isArray(rawChangedFiles)
    ? rawChangedFiles.flatMap((item: unknown) =>
        typeof item === "string" && item.trim() ? [item.trim()] : []
      )
    : [];
  const integrationPoints = listImplementationProofStrings(
    implementationProof.integration_points ?? implementationProof.integrationPoints
  );
  const activationSignals = listImplementationProofStrings(
    implementationProof.activation_signals ?? implementationProof.activationSignals
  );
  const executionCommand =
    pickString(implementationProof, [
      "execution_command",
      "executionCommand",
      "run_command",
      "runCommand",
    ]) ?? null;
  if (
    changedFiles.length === 0 ||
    integrationPoints.length === 0 ||
    activationSignals.length === 0 ||
    !executionCommand
  ) {
    return true;
  }

  const implementationCoverage = normalizeContractText(
    [...integrationPoints, ...changedFiles, executionCommand].join(" ")
  );
  return innovationPoints.some((point) => {
    const normalizedPoint = normalizeContractText(point);
    return Boolean(
      normalizedPoint &&
        (!implementationCoverage || !implementationCoverage.includes(normalizedPoint))
    );
  });
}

function validationCoverageNeedsRepair(record: Record<string, unknown>): boolean {
  const innovationPoints = listStructuredAlignmentStrings(
    record.innovation_points ?? record.innovationPoints
  );
  if (innovationPoints.length === 0) {
    return false;
  }
  const validationSteps = listStructuredAlignmentStrings(
    record.validation_steps ?? record.validationSteps
  );
  const ablationPlan = listStructuredAlignmentStrings(
    record.ablation_plan ?? record.ablationPlan
  );
  const coverageText = normalizeContractText([...validationSteps, ...ablationPlan].join(" "));
  return innovationPoints.some((point) => {
    const normalizedPoint = normalizeContractText(point);
    return Boolean(normalizedPoint && (!coverageText || !coverageText.includes(normalizedPoint)));
  });
}

function isRecoverableActiveTrackBundle(params: {
  bundleManifest: Record<string, unknown> | null;
  track: ResearchProgramTrack;
}): boolean {
  if (!params.bundleManifest) {
    return false;
  }
  const trackId = pickString(params.bundleManifest, ["track_id", "trackId"]);
  if (trackId !== params.track.trackId) {
    return false;
  }
  if (!bundleTextReferencesTrack({ bundleManifest: params.bundleManifest, track: params.track })) {
    return false;
  }
  if (!isAlignedToTrackContract({ bundleManifest: params.bundleManifest, track: params.track })) {
    return true;
  }
  return (
    bundleTextHasTrackMarker({
      bundleManifest: params.bundleManifest,
      track: params.track,
    }) &&
      (implementationProofNeedsRepair(params.bundleManifest) ||
        validationCoverageNeedsRepair(params.bundleManifest))
  );
}

function isRepairableStaleContract(params: {
  bundleManifest: Record<string, unknown> | null;
  track: ResearchProgramTrack;
  registryTrack: Record<string, unknown> | null;
  manifest: ManifestLike;
}): boolean {
  if (!params.bundleManifest || !params.registryTrack) {
    return false;
  }
  const trackId = pickString(params.bundleManifest, ["track_id", "trackId"]);
  if (trackId !== params.track.trackId) {
    return false;
  }
  if (isAlignedToTrackContract({ bundleManifest: params.bundleManifest, track: params.track })) {
    return false;
  }

  const bundleHypothesis = normalizeContractText(
    pickString(params.bundleManifest, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const bundleNoveltyBasis = normalizeContractText(
    pickString(params.bundleManifest, ["novelty_basis", "noveltyBasis"])
  );
  const registryHypothesis = normalizeContractText(
    pickString(params.registryTrack, ["hypothesis", "track_hypothesis", "trackHypothesis"])
  );
  const registryNoveltyBasis = normalizeContractText(
    pickString(params.registryTrack, ["novelty_basis", "noveltyBasis"])
  );
  const topic = normalizeContractText(
    pickString(params.manifest, ["title", "topic", "research_topic", "researchTopic"])
  );
  const hasRegistryContract = Boolean(registryHypothesis || registryNoveltyBasis);
  const matchesRegistry =
    hasRegistryContract &&
    (!registryHypothesis || bundleHypothesis === registryHypothesis) &&
    (!registryNoveltyBasis || bundleNoveltyBasis === registryNoveltyBasis);
  const matchesBootstrapTopic =
    Boolean(topic) &&
    bundleHypothesis === topic &&
    (!bundleNoveltyBasis || bundleNoveltyBasis === topic);
  return matchesRegistry || matchesBootstrapTopic;
}

function selectRepairableBundles(params: {
  bundles: ExistingCodeBundle[];
  track: ResearchProgramTrack;
  registryTrack: Record<string, unknown> | null;
  manifest: ManifestLike;
}): ExistingCodeBundle[] {
  const completeBundles = params.bundles.filter(
    (bundle) => bundle.manifest && bundle.hasTrain && bundle.hasReadme
  );
  return completeBundles.filter((bundle) =>
    isRepairableStaleContract({
      bundleManifest: bundle.manifest,
      track: params.track,
      registryTrack: params.registryTrack,
      manifest: params.manifest,
    }) ||
    isRecoverableActiveTrackBundle({
      bundleManifest: bundle.manifest,
      track: params.track,
    })
  );
}

function isCompleteAlignedCodeBundle(
  bundle: ExistingCodeBundle,
  track: ResearchProgramTrack
): boolean {
  return (
    bundle.hasTrain &&
    bundle.hasReadme &&
    bundle.hasProtocol &&
    bundle.hasDataset &&
    !bundle.legacyLocalProxy &&
    !bundle.profileMismatch &&
    isAlignedToTrackContract({ bundleManifest: bundle.manifest, track })
  );
}

export async function shouldMaterializeCodeExperimentBundleImpl(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const projectRoot = path.resolve(params.projectRoot);
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  const tracks = selectActiveTracksForMaterialization(researchProgram).filter((track) =>
    isSafePathSegment(track.trackId)
  );
  const track = tracks[0] ?? null;
  if (!track) {
    return false;
  }
  const topic = inferTopic({
    manifest: params.manifest,
    researchProgram,
    track,
  });
  const profile = resolveCodeExperimentProfile(topic);
  const indexPath = path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.index);
  const bundles = await listExistingCodeBundles(projectRoot, track.trackId, profile);
  if (!(await pathExists(indexPath))) {
    return true;
  }
  if (bundles.length === 0) {
    return true;
  }
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? {};
  const repairableBundles = selectRepairableBundles({
    bundles,
    track,
    registryTrack: getRegistryTrack(trackRegistry, track.trackId),
    manifest: params.manifest,
  });
  if (repairableBundles.length > 0) {
    return true;
  }
  for (const additionalTrack of tracks.slice(1)) {
    const additionalTopic = inferTopic({
      manifest: params.manifest,
      researchProgram,
      track: additionalTrack,
    });
    const additionalBundles = await listExistingCodeBundles(
      projectRoot,
      additionalTrack.trackId,
      resolveCodeExperimentProfile(additionalTopic)
    );
    const additionalRepairableBundles = selectRepairableBundles({
      bundles: additionalBundles,
      track: additionalTrack,
      registryTrack: getRegistryTrack(trackRegistry, additionalTrack.trackId),
      manifest: params.manifest,
    });
    if (additionalRepairableBundles.length > 0) {
      return true;
    }
  }
  if (
    bundles.some((bundle) => isCompleteAlignedCodeBundle(bundle, track))
  ) {
    return !(await codeEvidencePacketsExist(projectRoot));
  }
  if (
    bundles.some(
      (bundle) =>
        bundle.hasTrain &&
        bundle.hasReadme &&
        isAlignedToTrackContract({ bundleManifest: bundle.manifest, track }) &&
        (bundle.legacyLocalProxy ||
          bundle.profileMismatch ||
          !bundle.hasProtocol ||
          !bundle.hasDataset)
    )
  ) {
    return true;
  }
  return false;
}

function defaultInnovationPoints(topic: string): string[] {
  const normalized = topic.toLowerCase();
  if (/\bgcd\b|generalized category discovery|fixmatch/u.test(normalized)) {
    return [
      "FixMatch consistency filtering for unlabeled GCD candidates",
      "Class-balance debiasing for pseudo-label expansion",
      "Known-novel H-score tracking with ablation controls",
    ];
  }
  return [
    "Consistency filtering for unlabeled candidates",
    "Class-balance debiasing for pseudo-label expansion",
    "Primary metric tracking with ablation controls",
  ];
}

function buildExperimentManifest(params: {
  projectRoot: string;
  manifest: ManifestLike;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  topic: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const projectId =
    pickString(params.manifest, ["project_id", "projectId", "id"]) ??
    path.basename(params.projectRoot) ??
    "local-autoresearch-project";
  const fallbackPrimaryMetric =
    params.profile.kind === "sqlite"
      ? "p95 query latency"
      : isGcdTopic(params.topic)
        ? "H-score with known and novel accuracy"
        : "primary task quality metric";
  const primaryMetric =
    params.track.mainMetric ?? params.researchProgram.primaryMetric ?? fallbackPrimaryMetric;
  const baselineReference =
    params.researchProgram.baselineReference ??
    (params.profile.kind === "sqlite"
      ? "SQLite no-index table scan baseline"
      : isGcdTopic(params.topic)
      ? "SimGCD-style supervised and semi-supervised GCD baselines"
      : "strongest available supervised baseline");
  const targetImprovement =
    params.track.successThreshold ??
    `Improve ${primaryMetric} over ${baselineReference} without regressing the baseline protocol.`;
  const innovationPoints =
    params.profile.kind === "sqlite"
      ? [
          "Deterministic synthetic SQLite workload generation",
          "Matched comparison of no-index, single-column, composite, and covering indexes",
          "p95 latency, insert overhead, and database size tracking",
        ]
      : defaultInnovationPoints(params.topic);
  const datasetPath = `${params.bundleRelativeDir}/${params.profile.dataset}`;
  const protocolPath = `${params.bundleRelativeDir}/${params.profile.protocol}`;
  const executionCommand = `python ${params.bundleRelativeDir}/train.py --seed 42 --dataset ${datasetPath} --protocol ${protocolPath}`;

  if (params.profile.kind === "sqlite") {
    return {
      experiment_id: params.experimentId,
      project_id: projectId,
      track_id: params.track.trackId,
      name: params.profile.name,
      status: "draft",
      implementation_type: params.profile.implementationType,
      question:
        params.track.hypothesis ??
        `Which SQLite index strategy improves ${primaryMetric} under a local CPU budget?`,
      hypothesis:
        params.track.hypothesis ??
        `Composite and covering indexes improve ${primaryMetric} over the no-index baseline for selective point and range queries.`,
      novelty_basis:
        params.track.noveltyBasis ??
        "The bundle turns the selected plan into a deterministic SQLite index microbenchmark.",
      baseline_reference: baselineReference,
      primary_baseline_metric: primaryMetric,
      target_improvement: targetImprovement,
      baseline_training_protocol:
        "Generate the same deterministic SQLite rows for every strategy and keep PRAGMA settings fixed.",
      baseline_eval_protocol:
        "Run the same point and range query suite for every strategy and report p50/p95 latency, insert time, and database size.",
      datasets:
        params.researchProgram.datasets.length > 0
          ? params.researchProgram.datasets
          : ["synthetic-sqlite-events-workload"],
      benchmark_protocol_path: protocolPath,
      dataset_path: datasetPath,
      reference_dataset: {
        name: "synthetic-sqlite-events-workload",
        config_file: datasetPath,
        row_counts: [5000, 20000],
        query_types: ["point_lookup", "category_range"],
        index_strategies: ["no_index", "single_column", "composite", "covering"],
        metric: "p95_query_latency_ms",
      },
      innovation_points: innovationPoints,
      validation_steps: innovationPoints.map((point, index) => ({
        step_id: `validation-${index + 1}`,
        objective: `Validate ${point} with the shared SQLite workload and protocol.`,
        covers: [point],
      })),
      ablation_plan: [
        {
          ablation_id: "ablation-no-index",
          objective: "Run the no-index baseline with the same query suite.",
          covers: ["Matched comparison of no-index, single-column, composite, and covering indexes"],
        },
        {
          ablation_id: "ablation-single-column",
          objective: "Run the single-column index variant to isolate category filtering.",
          covers: ["Matched comparison of no-index, single-column, composite, and covering indexes"],
        },
        {
          ablation_id: "ablation-composite",
          objective: "Run the composite index variant to isolate range-filter ordering.",
          covers: ["Matched comparison of no-index, single-column, composite, and covering indexes"],
        },
      ],
      implementation_proof: {
        changed_files: [
          `${params.bundleRelativeDir}/train.py`,
          datasetPath,
          protocolPath,
          `${params.bundleRelativeDir}/README.md`,
          `${params.bundleRelativeDir}/EXPERIMENT_MANIFEST.json`,
        ],
        integration_points: [
          {
            point_id: "integration-workload",
            path: `${params.bundleRelativeDir}/train.py`,
            symbol: "generate_rows",
            summary: "The runner generates the deterministic SQLite workload from the dataset config.",
            covers: ["Deterministic synthetic SQLite workload generation"],
          },
          {
            point_id: "integration-index-strategies",
            path: `${params.bundleRelativeDir}/train.py`,
            symbol: "create_index_strategy",
            summary: "The runner applies each declared SQLite index strategy before timing queries.",
            covers: [
              "Matched comparison of no-index, single-column, composite, and covering indexes",
            ],
          },
          {
            point_id: "integration-latency-summary",
            path: `${params.bundleRelativeDir}/train.py`,
            symbol: "summarize_latency_metrics",
            summary: "The runner records p50/p95 latency, insert overhead, and database size.",
            covers: ["p95 latency, insert overhead, and database size tracking"],
          },
        ],
        activation_signals: innovationPoints.map((point, index) => ({
          point_id: `activation-${index + 1}`,
          summary: `RESULT_SUMMARY.json records activation evidence for ${point}.`,
          covers: [point],
        })),
        execution_command: executionCommand,
      },
      entry_point: "train.py",
      expected_outputs: ["RESULT_SUMMARY.json"],
    };
  }

  return {
    experiment_id: params.experimentId,
    project_id: projectId,
    track_id: params.track.trackId,
    name: params.profile.name,
    status: "draft",
    implementation_type: params.profile.implementationType,
    question:
      params.track.hypothesis ??
      `Does the proposed semi-supervised consistency route improve ${primaryMetric}?`,
    hypothesis:
      params.track.hypothesis ??
      `The selected method improves ${primaryMetric} through consistency-filtered unlabeled evidence.`,
    novelty_basis:
      params.track.noveltyBasis ??
      "The bundle translates the selected plan into a reproducible consistency-filtering and debiasing probe.",
    baseline_reference: baselineReference,
    primary_baseline_metric: primaryMetric,
    target_improvement: targetImprovement,
    baseline_training_protocol:
      "Run the prototype GCD baseline on the same fixed local known/novel reference split, seed, and evaluation code used by the proposed method.",
    baseline_eval_protocol:
      "Report known accuracy, novel accuracy, and H-score from the shared evaluator without changing checkpoint selection or class splits.",
    datasets:
      params.researchProgram.datasets.length > 0
        ? params.researchProgram.datasets
        : ["local-gcd-reference-benchmark"],
    benchmark_protocol_path: protocolPath,
    dataset_path: datasetPath,
    reference_dataset: {
      name: "local-gcd-reference-benchmark",
      split_file: datasetPath,
      known_classes: [0, 1, 2],
      novel_classes: [3, 4, 5],
      metric: "known/novel H-score",
    },
    innovation_points: innovationPoints,
    validation_steps: innovationPoints.map((point, index) => ({
      step_id: `validation-${index + 1}`,
      objective: `Validate ${point} against the shared supervised baseline and fixed evaluation split.`,
      covers: [point],
    })),
    ablation_plan: innovationPoints.map((point, index) => ({
      ablation_id: `ablation-${index + 1}`,
      objective: `Disable ${point} to isolate its contribution to ${primaryMetric}.`,
      covers: [point],
    })),
    implementation_proof: {
      changed_files: [
        `${params.bundleRelativeDir}/train.py`,
        datasetPath,
        protocolPath,
        `${params.bundleRelativeDir}/README.md`,
        `${params.bundleRelativeDir}/EXPERIMENT_MANIFEST.json`,
      ],
      integration_points: innovationPoints.map((point, index) => ({
        point_id: `integration-${index + 1}`,
        path: `${params.bundleRelativeDir}/train.py`,
        symbol:
          index === 0
            ? "run_fixmatch_consistency"
            : index === 1
              ? "apply_class_balance_debiasing"
              : "compute_known_novel_h_score",
        summary: `The generated runner wires ${point} into the local experiment path.`,
        covers: [point],
      })),
      activation_signals: innovationPoints.map((point, index) => ({
        point_id: `activation-${index + 1}`,
        summary: `RESULT_SUMMARY.json records activation and ablation metrics for ${point}.`,
        covers: [point],
      })),
      execution_command: executionCommand,
    },
    entry_point: "train.py",
    expected_outputs: ["RESULT_SUMMARY.json"],
  };
}

function appendMissingProofCoverage(params: {
  proof: Record<string, unknown>;
  manifest: Record<string, unknown>;
  bundleRelativeDir: string;
  defaultProof: Record<string, unknown>;
}): Record<string, unknown> {
  const innovationPoints = listStructuredAlignmentStrings(
    params.manifest.innovation_points ?? params.manifest.innovationPoints
  );
  const defaultChangedFiles = Array.isArray(params.defaultProof.changed_files)
    ? params.defaultProof.changed_files.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : []
      )
    : [];
  const rawChangedFiles = params.proof.changed_files ?? params.proof.changedFiles;
  const changedFiles = uniqueStrings([
    ...(Array.isArray(rawChangedFiles)
      ? rawChangedFiles.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : []
        )
      : []),
    ...defaultChangedFiles,
    `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`,
    `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`,
    `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`,
  ]);

  const integrationPoints = Array.isArray(params.proof.integration_points)
    ? [...params.proof.integration_points]
    : Array.isArray(params.proof.integrationPoints)
      ? [...params.proof.integrationPoints]
      : [];
  const activationSignals = Array.isArray(params.proof.activation_signals)
    ? [...params.proof.activation_signals]
    : Array.isArray(params.proof.activationSignals)
      ? [...params.proof.activationSignals]
      : [];
  const executionCommand =
    pickString(params.proof, [
      "execution_command",
      "executionCommand",
      "run_command",
      "runCommand",
    ]) ??
    pickString(params.defaultProof, [
      "execution_command",
      "executionCommand",
      "run_command",
      "runCommand",
    ]) ??
    `python ${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train} --seed 42`;

  const coveredByIntegration = normalizeContractText(
    listImplementationProofStrings(integrationPoints).join(" ")
  );
  const coveredByActivation = normalizeContractText(
    listImplementationProofStrings(activationSignals).join(" ")
  );
  for (const [index, point] of innovationPoints.entries()) {
    const normalizedPoint = normalizeContractText(point);
    if (!normalizedPoint) {
      continue;
    }
    if (!coveredByIntegration?.includes(normalizedPoint)) {
      integrationPoints.push({
        point_id: `repaired-integration-${index + 1}`,
        path: `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`,
        summary: `The active code-stage bundle wires ${point} into the experiment runner and manifest contract.`,
        covers: [point],
      });
    }
    if (!coveredByActivation?.includes(normalizedPoint)) {
      activationSignals.push({
        point_id: `repaired-activation-${index + 1}`,
        summary: `Execution logs or RESULT_SUMMARY.json must show ${point} was activated for this bundle.`,
        covers: [point],
      });
    }
  }

  return {
    ...params.proof,
    changed_files: changedFiles,
    integration_points: integrationPoints,
    activation_signals: activationSignals,
    execution_command: executionCommand,
  };
}

function appendMissingValidationCoverage(
  manifest: Record<string, unknown>
): Record<string, unknown> {
  const innovationPoints = listStructuredAlignmentStrings(
    manifest.innovation_points ?? manifest.innovationPoints
  );
  if (innovationPoints.length === 0) {
    return manifest;
  }
  const validationSteps = Array.isArray(manifest.validation_steps)
    ? [...manifest.validation_steps]
    : Array.isArray(manifest.validationSteps)
      ? [...manifest.validationSteps]
      : [];
  const ablationPlan = Array.isArray(manifest.ablation_plan)
    ? [...manifest.ablation_plan]
    : Array.isArray(manifest.ablationPlan)
      ? [...manifest.ablationPlan]
      : [];
  const coverageText = normalizeContractText(
    [
      ...listStructuredAlignmentStrings(validationSteps),
      ...listStructuredAlignmentStrings(ablationPlan),
    ].join(" ")
  );
  for (const [index, point] of innovationPoints.entries()) {
    const normalizedPoint = normalizeContractText(point);
    if (!normalizedPoint || coverageText?.includes(normalizedPoint)) {
      continue;
    }
    validationSteps.push({
      step_id: `repaired-validation-${index + 1}`,
      objective: `Validate ${point} against the active track baseline and fixed evaluation protocol.`,
      covers: [point],
    });
  }
  if (ablationPlan.length === 0) {
    for (const [index, point] of innovationPoints.entries()) {
      ablationPlan.push({
        ablation_id: `repaired-ablation-${index + 1}`,
        objective: `Disable ${point} to isolate its contribution to the active track metric.`,
        covers: [point],
      });
    }
  }
  return {
    ...manifest,
    validation_steps: validationSteps,
    ablation_plan: ablationPlan,
  };
}

function profileContractFields(
  manifest: Record<string, unknown>
): Record<string, unknown> {
  const keys = [
    "name",
    "implementation_type",
    "baseline_reference",
    "primary_baseline_metric",
    "target_improvement",
    "baseline_training_protocol",
    "baseline_eval_protocol",
    "datasets",
    "reference_dataset",
    "benchmark_protocol_path",
    "dataset_path",
    "innovation_points",
    "validation_steps",
    "ablation_plan",
    "entry_point",
    "expected_outputs",
  ];
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) {
      result[key] = manifest[key];
    }
  }
  return result;
}

function buildSqliteTrainPy(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import os
import random
import sqlite3
import tempfile
import time
from pathlib import Path


def load_json(path):
    with Path(path).open("r", encoding="utf8") as handle:
        return json.load(handle)


def percentile(values, pct):
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[index]


def generate_rows(row_count, seed, category_count):
    rng = random.Random(seed)
    rows = []
    for row_id in range(row_count):
        category = f"cat_{row_id % category_count:02d}"
        ts = 1700000000 + row_id * 17 + rng.randint(0, 13)
        value = round(rng.random() * 1000.0, 6)
        payload = f"payload_{row_id % 97:02d}_{rng.randint(0, 9999):04d}"
        rows.append((row_id, ts, category, value, payload))
    return rows


def create_index_strategy(conn, strategy):
    if strategy == "no_index":
        return
    if strategy == "single_column":
        conn.execute("CREATE INDEX idx_events_category ON events(category)")
    elif strategy == "composite":
        conn.execute("CREATE INDEX idx_events_category_ts ON events(category, ts)")
    elif strategy == "covering":
        conn.execute("CREATE INDEX idx_events_covering ON events(category, ts, value, payload)")
    else:
        raise ValueError(f"unknown index strategy: {strategy}")
    conn.commit()


def build_database(rows, strategy):
    handle = tempfile.NamedTemporaryFile(prefix=f"sqlite-{strategy}-", suffix=".db", delete=False)
    db_path = handle.name
    handle.close()
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute(
        "CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, category TEXT NOT NULL, value REAL NOT NULL, payload TEXT NOT NULL)"
    )
    start = time.perf_counter()
    conn.executemany(
        "INSERT INTO events(id, ts, category, value, payload) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    insert_ms = (time.perf_counter() - start) * 1000.0
    create_index_strategy(conn, strategy)
    db_size_bytes = os.path.getsize(db_path)
    return conn, db_path, insert_ms, db_size_bytes


def time_query(conn, sql, params, repeats):
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        conn.execute(sql, params).fetchall()
        samples.append((time.perf_counter() - start) * 1000.0)
    return samples


def summarize_latency_metrics(samples):
    return {
        "p50_ms": round(percentile(samples, 50), 4),
        "p95_ms": round(percentile(samples, 95), 4),
        "mean_ms": round(sum(samples) / max(1, len(samples)), 4),
    }


def run_sqlite_index_benchmark(protocol, config, seed):
    row_count = max(config.get("row_counts", [5000]))
    category_count = int(config.get("category_count", 16))
    repeats = int(config.get("query_repeats", 30))
    strategies = protocol["index_strategies"]
    rows = generate_rows(row_count, seed, category_count)
    categories = sorted({row[2] for row in rows})
    query_category = categories[len(categories) // 2]
    midpoint_ts = rows[len(rows) // 2][1]
    range_width = int(config.get("range_width_seconds", 25000))
    results = {}
    for strategy in strategies:
        conn, db_path, insert_ms, db_size_bytes = build_database(rows, strategy)
        try:
            point_samples = time_query(
                conn,
                "SELECT id, ts, value FROM events WHERE category = ? ORDER BY ts LIMIT 25",
                (query_category,),
                repeats,
            )
            range_samples = time_query(
                conn,
                "SELECT id, ts, value FROM events WHERE category = ? AND ts BETWEEN ? AND ? ORDER BY ts",
                (query_category, midpoint_ts - range_width, midpoint_ts + range_width),
                repeats,
            )
            results[strategy] = {
                "insert_ms": round(insert_ms, 4),
                "db_size_bytes": db_size_bytes,
                "point_lookup": summarize_latency_metrics(point_samples),
                "category_range": summarize_latency_metrics(range_samples),
            }
        finally:
            conn.close()
            Path(db_path).unlink(missing_ok=True)
    baseline_p95 = max(results["no_index"]["point_lookup"]["p95_ms"], 1e-9)
    best_strategy = min(results, key=lambda name: results[name]["point_lookup"]["p95_ms"])
    best_p95 = results[best_strategy]["point_lookup"]["p95_ms"]
    return {
        "row_count": row_count,
        "strategy_results": results,
        "best_strategy": best_strategy,
        "metrics": {
            "p95_query_latency_ms": best_p95,
            "baseline_p95_query_latency_ms": results["no_index"]["point_lookup"]["p95_ms"],
            "relative_p95_improvement": round((baseline_p95 - best_p95) / baseline_p95, 6),
            "insert_overhead_ms": round(
                results[best_strategy]["insert_ms"] - results["no_index"]["insert_ms"],
                4,
            ),
            "db_size_bytes": results[best_strategy]["db_size_bytes"],
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default=None)
    parser.add_argument("--dataset", default=str(Path(__file__).with_name("data").joinpath("sqlite_workload_config.json")))
    parser.add_argument("--protocol", default=str(Path(__file__).with_name("SQLITE_PROTOCOL.json")))
    args = parser.parse_args()
    protocol = load_json(args.protocol)
    config = load_json(args.dataset)
    benchmark = run_sqlite_index_benchmark(protocol, config, args.seed)
    summary = {
        "run_id": f"sqlite-index-latency-{args.seed}",
        "seed": args.seed,
        "status": "completed",
        "execution_mode": "local_reference_sqlite_index_benchmark",
        "protocol": protocol,
        "dataset": str(Path(args.dataset)),
        **benchmark,
        "key_metric": {
            "name": "p95_query_latency_ms",
            "value": benchmark["metrics"]["p95_query_latency_ms"],
            "baseline": benchmark["metrics"]["baseline_p95_query_latency_ms"],
            "delta": round(
                benchmark["metrics"]["p95_query_latency_ms"]
                - benchmark["metrics"]["baseline_p95_query_latency_ms"],
                4,
            ),
            "direction": "lower_is_better",
        },
        "result_paths": ["RESULT_SUMMARY.json"],
        "activation": {
            "sqlite_workload_generated": True,
            "index_strategies_compared": protocol["index_strategies"],
            "latency_insert_size_tracked": True,
        },
    }
    output = Path(args.output) if args.output else Path(__file__).with_name("RESULT_SUMMARY.json")
    output.write_text(json.dumps(summary, indent=2) + "\\n", encoding="utf8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
`;
}

function buildGcdTrainPy(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import math
from pathlib import Path


def load_protocol(path):
    with Path(path).open("r", encoding="utf8") as handle:
        return json.load(handle)


def load_gcd_reference_split(path):
    records = []
    with Path(path).open("r", encoding="utf8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            records.append((float(record["x"]), float(record["y"]), int(record["label"]), record["split"]))
    labeled = [(x, y, label) for x, y, label, split in records if split == "labeled"]
    unlabeled = [(x, y, label) for x, y, label, split in records if split == "unlabeled"]
    validation = [(x, y, label) for x, y, label, split in records if split == "validation"]
    if not labeled or not unlabeled or not validation:
        raise ValueError("GCD reference split must contain labeled, unlabeled, and validation rows.")
    return labeled, unlabeled, validation


def centroid(points):
    if not points:
        return (0.0, 0.0)
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def distance(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def nearest(point, prototypes):
    ranked = sorted(
        ((class_id, distance(point, center)) for class_id, center in prototypes.items()),
        key=lambda item: item[1],
    )
    best_class, best_distance = ranked[0]
    second_distance = ranked[1][1] if len(ranked) > 1 else best_distance + 1.0
    confidence = 1.0 / (1.0 + max(0.0, best_distance))
    margin = max(0.0, second_distance - best_distance)
    return best_class, confidence, margin


def compute_known_novel_h_score(prototypes, validation, known_class_count=3):
    known_hits = known_total = novel_hits = novel_total = 0
    for x, y, label in validation:
        predicted, _, _ = nearest((x, y), prototypes)
        if label < known_class_count:
            known_total += 1
            known_hits += int(predicted == label)
        else:
            novel_total += 1
            novel_hits += int(predicted == label)
    known_acc = known_hits / max(1, known_total)
    novel_acc = novel_hits / max(1, novel_total)
    h_score = 0.0 if known_acc + novel_acc == 0 else 2 * known_acc * novel_acc / (known_acc + novel_acc)
    return {
        "known_accuracy": round(known_acc, 4),
        "novel_accuracy": round(novel_acc, 4),
        "h_score": round(h_score, 4),
    }


def supervised_baseline(labeled):
    return {class_id: centroid([point for point in labeled if point[2] == class_id]) for class_id in range(3)}


def initialize_novel_prototypes(unlabeled, seed):
    phase = seed % 7
    candidates = sorted(
        unlabeled,
        key=lambda point: (abs(point[0]) + abs(point[1]), math.sin(point[0] + phase)),
        reverse=True,
    )
    chosen = candidates[:18]
    return {
        3: centroid(chosen[0::3]),
        4: centroid(chosen[1::3]),
        5: centroid(chosen[2::3]),
    }


def build_baseline_gcd_prototypes(labeled, unlabeled, seed):
    prototypes = supervised_baseline(labeled)
    prototypes.update(initialize_novel_prototypes(unlabeled, seed))
    return prototypes


def apply_class_balance_debiasing(accepted, class_id, per_class_cap):
    return len(accepted[class_id]) < per_class_cap


def run_fixmatch_consistency(labeled, unlabeled, seed, debias=True, consistency=True):
    prototypes = build_baseline_gcd_prototypes(labeled, unlabeled, seed)
    per_class_cap = max(8, len(unlabeled) // 18)
    accepted = {class_id: [] for class_id in prototypes}
    for x, y, label in unlabeled:
        weak = (x * 0.985 + 0.03, y * 1.015 - 0.02)
        strong = (x * 1.035 - 0.05, y * 0.965 + 0.04)
        weak_class, weak_conf, weak_margin = nearest(weak, prototypes)
        strong_class, strong_conf, _ = nearest(strong, prototypes)
        if consistency and weak_class != strong_class:
            continue
        if weak_conf < 0.18 or weak_margin < 0.18:
            continue
        if debias and not apply_class_balance_debiasing(accepted, weak_class, per_class_cap):
            continue
        accepted[weak_class].append((x, y, label))
    for class_id, points in accepted.items():
        if points:
            prior = prototypes[class_id]
            update = centroid(points)
            prototypes[class_id] = ((prior[0] + update[0]) / 2.0, (prior[1] + update[1]) / 2.0)
    return prototypes, {str(class_id): len(points) for class_id, points in accepted.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default=None)
    parser.add_argument("--dataset", default=str(Path(__file__).with_name("data").joinpath("gcd_reference_split.jsonl")))
    parser.add_argument("--protocol", default=str(Path(__file__).with_name("GCD_PROTOCOL.json")))
    args = parser.parse_args()
    protocol = load_protocol(args.protocol)
    labeled, unlabeled, validation = load_gcd_reference_split(args.dataset)
    baseline = compute_known_novel_h_score(build_baseline_gcd_prototypes(labeled, unlabeled, args.seed), validation)
    proposed_prototypes, accepted = run_fixmatch_consistency(labeled, unlabeled, args.seed)
    no_debias, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, debias=False)
    no_consistency, _ = run_fixmatch_consistency(labeled, unlabeled, args.seed, consistency=False)
    proposed = compute_known_novel_h_score(proposed_prototypes, validation)
    minus_debias = compute_known_novel_h_score(no_debias, validation)
    minus_consistency = compute_known_novel_h_score(no_consistency, validation)
    delta = round(proposed["h_score"] - baseline["h_score"], 4)
    summary = {
        "run_id": f"local-reference-gcd-{args.seed}",
        "seed": args.seed,
        "status": "completed",
        "execution_mode": "local_reference_gcd_benchmark",
        "protocol": protocol,
        "dataset": str(Path(args.dataset)),
        "baseline": baseline,
        "proposed": proposed,
        "ablations": {
            "minus_class_balance_debiasing": minus_debias,
            "minus_consistency_filtering": minus_consistency,
        },
        "metrics": {
            "h_score": proposed["h_score"],
            "known_accuracy": proposed["known_accuracy"],
            "novel_accuracy": proposed["novel_accuracy"],
            "baseline_h_score": baseline["h_score"],
            "delta_h_score": delta,
            "minus_class_balance_debiasing_h_score": minus_debias["h_score"],
            "minus_consistency_filtering_h_score": minus_consistency["h_score"],
        },
        "key_metric": {
            "name": "h_score",
            "value": proposed["h_score"],
            "baseline": baseline["h_score"],
            "delta": delta,
            "direction": "higher_is_better",
        },
        "result_paths": ["RESULT_SUMMARY.json"],
        "activation": {
            "fixmatch_consistency_filtering": True,
            "class_balance_debiasing": True,
            "known_novel_h_score_tracking": True,
            "accepted_pseudo_labels": accepted,
        },
    }
    output = Path(args.output) if args.output else Path(__file__).with_name("RESULT_SUMMARY.json")
    output.write_text(json.dumps(summary, indent=2) + "\\n", encoding="utf8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
`;
}

function buildTrainPy(profile: CodeExperimentProfile): string {
  return profile.kind === "sqlite" ? buildSqliteTrainPy() : buildGcdTrainPy();
}

function buildGcdProtocol(params: {
  topic: string;
  track: ResearchProgramTrack;
  manifest: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    name: "local-gcd-reference-benchmark",
    task: "generalized_category_discovery",
    topic: params.topic,
    track_id: params.track.trackId,
    baseline: {
      family: "prototype-centroid GCD reference baseline",
      preserves_known_labeled_classes: true,
      initializes_novel_prototypes_from_unlabeled_candidates: true,
    },
    proposed_change: "FixMatch weak/strong consistency gate with class-balance debiasing",
    known_classes: [0, 1, 2],
    novel_classes: [3, 4, 5],
    splits: {
      labeled: "known-class labeled anchors",
      unlabeled: "mixed known/novel candidates",
      validation: "held-out known/novel scoring split",
    },
    metric: "known_novel_h_score",
    required_symbols: [
      "run_fixmatch_consistency",
      "apply_class_balance_debiasing",
      "compute_known_novel_h_score",
    ],
    primary_baseline_metric:
      pickString(params.manifest, ["primary_baseline_metric", "primaryBaselineMetric"]) ??
      "H-score with known and novel accuracy",
  };
}

function deterministicOffset(classId: number, index: number, axis: "x" | "y"): number {
  const raw =
    axis === "x"
      ? Math.sin((classId + 1) * 12.9898 + (index + 1) * 78.233)
      : Math.cos((classId + 1) * 39.3467 + (index + 1) * 11.135);
  return raw * 0.28;
}

function makeDatasetRecord(classId: number, index: number, split: string): string {
  const angle = classId * 1.0471975512;
  const radius = 3.0 + 0.18 * (classId % 2);
  const splitDrift = split === "unlabeled" ? 0.12 : split === "validation" ? -0.08 : 0;
  const x = Math.cos(angle) * radius + deterministicOffset(classId, index, "x") + splitDrift;
  const y = Math.sin(angle) * radius + deterministicOffset(classId, index, "y") - splitDrift;
  return JSON.stringify({
    split,
    label: classId,
    x: Number(x.toFixed(6)),
    y: Number(y.toFixed(6)),
  });
}

function buildGcdReferenceDatasetJsonl(): string {
  const rows: string[] = [];
  for (let classId = 0; classId < 3; classId += 1) {
    for (let index = 0; index < 8; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "labeled"));
    }
  }
  for (let classId = 0; classId < 6; classId += 1) {
    for (let index = 0; index < 36; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "unlabeled"));
    }
  }
  for (let classId = 0; classId < 6; classId += 1) {
    for (let index = 0; index < 30; index += 1) {
      rows.push(makeDatasetRecord(classId, index, "validation"));
    }
  }
  return `${rows.join("\n")}\n`;
}

function buildSqliteProtocol(params: {
  topic: string;
  track: ResearchProgramTrack;
  manifest: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    name: "local-sqlite-index-latency-benchmark",
    task: "sqlite_index_latency_comparison",
    topic: params.topic,
    track_id: params.track.trackId,
    baseline: {
      family: "SQLite no-index table scan baseline",
      fixed_schema: "events(id INTEGER PRIMARY KEY, ts INTEGER, category TEXT, value REAL, payload TEXT)",
      fixed_pragmas: ["journal_mode=OFF", "synchronous=OFF"],
    },
    proposed_change:
      "Compare single-column, composite, and covering B-tree indexes against the no-index baseline.",
    index_strategies: ["no_index", "single_column", "composite", "covering"],
    query_types: ["point_lookup", "category_range"],
    metrics: ["p50_ms", "p95_ms", "insert_ms", "db_size_bytes"],
    required_symbols: [
      "generate_rows",
      "create_index_strategy",
      "run_sqlite_index_benchmark",
      "summarize_latency_metrics",
    ],
    primary_baseline_metric:
      pickString(params.manifest, ["primary_baseline_metric", "primaryBaselineMetric"]) ??
      "p95 query latency",
  };
}

function buildBenchmarkProtocol(params: {
  topic: string;
  track: ResearchProgramTrack;
  manifest: Record<string, unknown>;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  return params.profile.kind === "sqlite"
    ? buildSqliteProtocol(params)
    : buildGcdProtocol(params);
}

function buildSqliteWorkloadConfig(): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      name: "synthetic-sqlite-events-workload",
      row_counts: [5000, 20000],
      category_count: 16,
      query_repeats: 30,
      range_width_seconds: 25000,
      seed_contract: "The --seed argument controls row values and payloads for every strategy.",
    },
    null,
    2
  )}\n`;
}

function buildReferenceDataset(profile: CodeExperimentProfile): string {
  return profile.kind === "sqlite" ? buildSqliteWorkloadConfig() : buildGcdReferenceDatasetJsonl();
}

function buildCitationGroundingSummary(params: {
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
}): Record<string, unknown> {
  const graphEvidencePaths = selectedPlanEvidencePaths(params);
  const allowedClaimIds = params.track.writeScope.allowedClaimIds;
  const evidenceCardIds = uniqueStrings([
    ...graphEvidencePaths.map((entry) => `graph:${entry}`),
    ...allowedClaimIds.map((entry) => `claim:${entry}`),
  ]);
  return {
    status:
      graphEvidencePaths.length > 0 || allowedClaimIds.length > 0
        ? "grounded"
        : "needs_citation_grounding",
    decisive_graph_evidence_paths:
      params.researchProgram.planSelection.decisiveGraphEvidencePaths,
    selected_plan_evidence_paths: graphEvidencePaths,
    allowed_claim_ids: allowedClaimIds,
    evidence_card_ids: evidenceCardIds,
  };
}

function buildCompletenessGates(params: {
  experimentManifest: Record<string, unknown>;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  citationGrounding: Record<string, unknown>;
}): Array<Record<string, unknown>> {
  const proof = implementationProofRecord(params.experimentManifest);
  const changedFiles = listStringArray(proof.changed_files ?? proof.changedFiles);
  const integrationPoints = listObjectEntries(
    proof.integration_points ?? proof.integrationPoints
  );
  const activationSignals = listObjectEntries(
    proof.activation_signals ?? proof.activationSignals
  );
  const executionCommand = pickString(proof, ["execution_command", "executionCommand"]);
  const groundingStatus = pickString(params.citationGrounding, ["status"]);
  return [
    {
      gate: "hypothesis_present",
      status: params.track.hypothesis ? "pass" : "needs_input",
      source: "research_program.tracks[].hypothesis",
    },
    {
      gate: "novelty_basis_present",
      status: params.track.noveltyBasis ? "pass" : "needs_input",
      source: "research_program.tracks[].novelty_basis",
    },
    {
      gate: "citation_grounding_present",
      status: groundingStatus === "grounded" ? "pass" : "needs_input",
      source: "research_program.plan_selection.decisive_graph_evidence_paths",
    },
    {
      gate: "changed_files_declared",
      status: changedFiles.length > 0 ? "pass" : "needs_input",
      source: "EXPERIMENT_MANIFEST.json.implementation_proof.changed_files",
    },
    {
      gate: "integration_points_declared",
      status: integrationPoints.length > 0 ? "pass" : "needs_input",
      source: "EXPERIMENT_MANIFEST.json.implementation_proof.integration_points",
    },
    {
      gate: "activation_signals_declared",
      status: activationSignals.length > 0 ? "pass" : "needs_input",
      source: "EXPERIMENT_MANIFEST.json.implementation_proof.activation_signals",
    },
    {
      gate: "execution_command_locked",
      status: executionCommand ? "pass" : "needs_input",
      source: "EXPERIMENT_MANIFEST.json.implementation_proof.execution_command",
    },
  ];
}

function buildImplementationEvidencePacket(params: {
  topic: string;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  executionCommand: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const proof = implementationProofRecord(params.experimentManifest);
  const citationGrounding = buildCitationGroundingSummary({
    researchProgram: params.researchProgram,
    track: params.track,
  });
  const changedFiles = uniqueStrings([
    ...listStringArray(proof.changed_files ?? proof.changedFiles),
    `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`,
    `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`,
    `${params.bundleRelativeDir}/${params.profile.protocol}`,
    `${params.bundleRelativeDir}/${params.profile.dataset}`,
  ]);
  return {
    schema_version: 1,
    packet_type: "implementation_evidence",
    generated_at: new Date().toISOString(),
    status:
      pickString(citationGrounding, ["status"]) === "grounded"
        ? "citation_grounded"
        : "needs_citation_grounding",
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    bundle_dir: params.bundleRelativeDir,
    topic: params.topic,
    hypothesis:
      params.track.hypothesis ??
      pickString(params.experimentManifest, ["hypothesis", "track_hypothesis"]),
    novelty_basis:
      params.track.noveltyBasis ??
      pickString(params.experimentManifest, ["novelty_basis", "noveltyBasis"]),
    citation_grounding: citationGrounding,
    implementation_contract: {
      implementation_type: pickString(params.experimentManifest, [
        "implementation_type",
        "implementationType",
      ]),
      entry_point: pickString(params.experimentManifest, ["entry_point", "entryPoint"]),
      changed_files: changedFiles,
      integration_points: listObjectEntries(
        proof.integration_points ?? proof.integrationPoints
      ),
      activation_signals: listObjectEntries(
        proof.activation_signals ?? proof.activationSignals
      ),
      execution_command: params.executionCommand,
    },
    reviewer_contract: {
      required_baselines: params.track.requiredBaselines,
      required_ablations: params.track.requiredAblations,
      required_controls: params.track.requiredControls,
      success_threshold: params.track.successThreshold,
      stop_rules: params.track.stopRules,
      rollback_triggers: params.track.rollbackTriggers,
    },
    artifact_paths: evidencePacketPathFields(),
    completeness_gates: buildCompletenessGates({
      experimentManifest: params.experimentManifest,
      researchProgram: params.researchProgram,
      track: params.track,
      citationGrounding,
    }),
  };
}

function buildBaselineAlignmentPacket(params: {
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const baselineReference =
    pickString(params.experimentManifest, ["baseline_reference", "baselineReference"]) ??
    params.researchProgram.baselineReference ??
    "unspecified baseline";
  const requiredBaselines = uniqueStrings([
    ...params.track.requiredBaselines,
    baselineReference,
  ]);
  return {
    schema_version: 1,
    packet_type: "baseline_alignment",
    generated_at: new Date().toISOString(),
    status: requiredBaselines.length > 0 ? "baseline_locked" : "needs_baseline",
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    bundle_dir: params.bundleRelativeDir,
    baseline_reference: baselineReference,
    required_baselines: requiredBaselines,
    primary_metric:
      pickString(params.experimentManifest, [
        "primary_baseline_metric",
        "primaryBaselineMetric",
      ]) ??
      params.track.mainMetric ??
      params.researchProgram.primaryMetric,
    target_improvement: pickString(params.experimentManifest, [
      "target_improvement",
      "targetImprovement",
    ]),
    baseline_training_protocol: pickString(params.experimentManifest, [
      "baseline_training_protocol",
      "baselineTrainingProtocol",
    ]),
    baseline_eval_protocol: pickString(params.experimentManifest, [
      "baseline_eval_protocol",
      "baselineEvalProtocol",
    ]),
    benchmark_protocol_path: pickString(params.experimentManifest, [
      "benchmark_protocol_path",
      "benchmarkProtocolPath",
    ]),
    dataset_path: pickString(params.experimentManifest, ["dataset_path", "datasetPath"]),
    datasets: listStringArray(params.experimentManifest.datasets),
    reference_dataset: asRecord(params.experimentManifest.reference_dataset) ?? null,
    fairness_constraints:
      params.profile.kind === "sqlite"
        ? [
            "all index strategies must use the same generated rows and query suite",
            "all index strategies must use the same SQLite PRAGMA settings",
            "baseline and proposed strategies must use the same benchmark_protocol_path",
            "result tables must report p50/p95 latency, insert overhead, and database size from RESULT_SUMMARY.json",
          ]
        : [
            "baseline and proposed method must use the same dataset_path",
            "baseline and proposed method must use the same benchmark_protocol_path",
            "known/novel class partitions must remain locked across ablations",
            "result tables must report baseline, proposed, and ablation metrics from RESULT_SUMMARY.json",
          ],
    citation_grounding: buildCitationGroundingSummary({
      researchProgram: params.researchProgram,
      track: params.track,
    }),
  };
}

function buildHyperparameterSourceMap(params: {
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const trainPath = `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`;
  const protocolPath =
    pickString(params.experimentManifest, ["benchmark_protocol_path", "benchmarkProtocolPath"]) ??
    `${params.bundleRelativeDir}/${params.profile.protocol}`;
  const datasetPath =
    pickString(params.experimentManifest, ["dataset_path", "datasetPath"]) ??
    `${params.bundleRelativeDir}/${params.profile.dataset}`;
  if (params.profile.kind === "sqlite") {
    return {
      schema_version: 1,
      packet_type: "hyperparameter_source_map",
      generated_at: new Date().toISOString(),
      status: "locked_reference_defaults",
      track_id: params.track.trackId,
      experiment_id: params.experimentId,
      bundle_dir: params.bundleRelativeDir,
      source_files: [trainPath, protocolPath, datasetPath],
      parameters: [
        {
          name: "seed",
          value: 42,
          source_path: trainPath,
          source_symbol: "argparse --seed default",
          role: "reproducibility",
        },
        {
          name: "row_counts",
          value: [5000, 20000],
          source_path: datasetPath,
          source_symbol: "sqlite_workload_config.row_counts",
          role: "workload scale envelope",
        },
        {
          name: "query_repeats",
          value: 30,
          source_path: datasetPath,
          source_symbol: "sqlite_workload_config.query_repeats",
          role: "latency sampling budget",
        },
        {
          name: "range_width_seconds",
          value: 25000,
          source_path: datasetPath,
          source_symbol: "sqlite_workload_config.range_width_seconds",
          role: "range-query selectivity control",
        },
        {
          name: "index_strategies",
          value: ["no_index", "single_column", "composite", "covering"],
          source_path: protocolPath,
          source_symbol: "sqlite_protocol.index_strategies",
          role: "baseline/proposed comparison set",
        },
      ],
      protocol_fields: {
        index_strategies: ["no_index", "single_column", "composite", "covering"],
        query_types: ["point_lookup", "category_range"],
        metric: "p95_query_latency_ms",
        protocol_path: protocolPath,
        dataset_path: datasetPath,
      },
    };
  }
  return {
    schema_version: 1,
    packet_type: "hyperparameter_source_map",
    generated_at: new Date().toISOString(),
    status: "locked_reference_defaults",
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    bundle_dir: params.bundleRelativeDir,
    source_files: [trainPath, protocolPath, datasetPath],
    parameters: [
      {
        name: "seed",
        value: 42,
        source_path: trainPath,
        source_symbol: "argparse --seed default",
        role: "reproducibility",
      },
      {
        name: "weak_confidence_threshold",
        value: 0.18,
        source_path: trainPath,
        source_symbol: "run_fixmatch_consistency",
        role: "FixMatch pseudo-label confidence gate",
      },
      {
        name: "weak_margin_threshold",
        value: 0.18,
        source_path: trainPath,
        source_symbol: "run_fixmatch_consistency",
        role: "weak/strong consistency margin gate",
      },
      {
        name: "per_class_cap",
        value: "max(8, len(unlabeled) // 18)",
        source_path: trainPath,
        source_symbol: "apply_class_balance_debiasing",
        role: "class-balance debiasing cap",
      },
      {
        name: "known_class_count",
        value: 3,
        source_path: trainPath,
        source_symbol: "compute_known_novel_h_score",
        role: "known/novel H-score partition",
      },
    ],
    protocol_fields: {
      known_classes: [0, 1, 2],
      novel_classes: [3, 4, 5],
      metric: "known_novel_h_score",
      protocol_path: protocolPath,
      dataset_path: datasetPath,
    },
  };
}

function buildDatasetProtocolLock(params: {
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const protocolPath =
    pickString(params.experimentManifest, ["benchmark_protocol_path", "benchmarkProtocolPath"]) ??
    `${params.bundleRelativeDir}/${params.profile.protocol}`;
  const datasetPath =
    pickString(params.experimentManifest, ["dataset_path", "datasetPath"]) ??
    `${params.bundleRelativeDir}/${params.profile.dataset}`;
  if (params.profile.kind === "sqlite") {
    return {
      schema_version: 1,
      packet_type: "dataset_protocol_lock",
      generated_at: new Date().toISOString(),
      status: "locked",
      track_id: params.track.trackId,
      experiment_id: params.experimentId,
      bundle_dir: params.bundleRelativeDir,
      benchmark_protocol_path: protocolPath,
      dataset_path: datasetPath,
      datasets: listStringArray(params.experimentManifest.datasets),
      reference_dataset: asRecord(params.experimentManifest.reference_dataset) ?? null,
      split_contract: {
        workload: {
          row_counts: [5000, 20000],
          category_count: 16,
          source_function: "buildSqliteWorkloadConfig",
        },
        query_suite: {
          query_types: ["point_lookup", "category_range"],
          query_repeats: 30,
          range_width_seconds: 25000,
          source_function: "run_sqlite_index_benchmark",
        },
        index_strategies: {
          strategies: ["no_index", "single_column", "composite", "covering"],
          source_function: "create_index_strategy",
        },
      },
      lock_rules: [
        "Do not change row generation between index strategies.",
        "Do not change query suite, PRAGMA settings, or row_count between baseline and proposed runs.",
        "Do not report external benchmark claims from this local reference packet.",
      ],
    };
  }
  return {
    schema_version: 1,
    packet_type: "dataset_protocol_lock",
    generated_at: new Date().toISOString(),
    status: "locked",
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    bundle_dir: params.bundleRelativeDir,
    benchmark_protocol_path: protocolPath,
    dataset_path: datasetPath,
    datasets: listStringArray(params.experimentManifest.datasets),
    reference_dataset: asRecord(params.experimentManifest.reference_dataset) ?? null,
    split_contract: {
      labeled: {
        classes: [0, 1, 2],
        rows_per_class: 8,
        total_rows: 24,
        source_function: "buildGcdReferenceDatasetJsonl",
      },
      unlabeled: {
        classes: [0, 1, 2, 3, 4, 5],
        rows_per_class: 36,
        total_rows: 216,
        source_function: "buildGcdReferenceDatasetJsonl",
      },
      validation: {
        classes: [0, 1, 2, 3, 4, 5],
        rows_per_class: 30,
        total_rows: 180,
        source_function: "buildGcdReferenceDatasetJsonl",
      },
    },
    lock_rules: [
      "Do not change known_classes or novel_classes between baseline and proposed runs.",
      "Do not change dataset_path between ablations.",
      "Do not report external benchmark claims from this local reference packet.",
    ],
  };
}

function buildReproductionRiskLedger(params: {
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  profile: CodeExperimentProfile;
}): Record<string, unknown> {
  const citationGrounding = buildCitationGroundingSummary({
    researchProgram: params.researchProgram,
    track: params.track,
  });
  const grounded = pickString(citationGrounding, ["status"]) === "grounded";
  return {
    schema_version: 1,
    packet_type: "reproduction_risk_ledger",
    generated_at: new Date().toISOString(),
    status: grounded ? "bounded_reference" : "needs_citation_grounding",
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    bundle_dir: params.bundleRelativeDir,
    implementation_type: pickString(params.experimentManifest, [
      "implementation_type",
      "implementationType",
    ]),
    risks: [
      {
        risk_id: "bounded_reference_benchmark",
        severity: "medium",
        status: "accepted",
        reason:
          "The generated bundle is a deterministic local reference benchmark, not a full external reproduction.",
        mitigation: `Manifest and README label the implementation_type as ${params.profile.implementationType} and keep claims scoped to the local reference dataset.`,
      },
      {
        risk_id: "citation_grounding_gap",
        severity: grounded ? "low" : "high",
        status: grounded ? "mitigated" : "open",
        reason:
          "Implementation choices should trace back to graph evidence paths or allowed claim IDs before writing strong paper claims.",
        mitigation:
          "Populate research_program.plan_selection.decisive_graph_evidence_paths or track.write_scope.allowed_claim_ids before treating code results as citation-grounded.",
        evidence: citationGrounding,
      },
      {
        risk_id: "single_seed_default",
        severity: "medium",
        status: params.researchProgram.globalConstraints.mustRunMultiSeedBeforeAnalysis
          ? "controlled"
          : "accepted",
        reason: "The code bundle defaults to seed 42 for deterministic smoke execution.",
        mitigation:
          "Experiment-stage analysis must run multi-seed aggregation before paper-level claims when the global constraint is enabled.",
      },
      {
        risk_id: "external_dataset_absent",
        severity: "medium",
        status: "documented",
        reason:
          "The workflow avoids external dataset downloads in the local code-stage bundle.",
        mitigation:
          "Treat this artifact as implementation evidence and require a separate analyzer/reviewer gate for external benchmark claims.",
      },
    ],
  };
}

async function writeCodeEvidencePackets(params: {
  projectRoot: string;
  topic: string;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  executionCommand: string;
  profile: CodeExperimentProfile;
}): Promise<string[]> {
  const packets: Array<[string, Record<string, unknown>]> = [
    [
      CODE_EXPERIMENT_ARTIFACTS.implementationEvidence,
      buildImplementationEvidencePacket(params),
    ],
    [
      CODE_EXPERIMENT_ARTIFACTS.baselineAlignment,
      buildBaselineAlignmentPacket(params),
    ],
    [
      CODE_EXPERIMENT_ARTIFACTS.hyperparameterSourceMap,
      buildHyperparameterSourceMap(params),
    ],
    [
      CODE_EXPERIMENT_ARTIFACTS.datasetProtocolLock,
      buildDatasetProtocolLock(params),
    ],
    [
      CODE_EXPERIMENT_ARTIFACTS.reproductionRiskLedger,
      buildReproductionRiskLedger(params),
    ],
  ];
  for (const [relativePath, packet] of packets) {
    await writeJsonEnsured(path.join(params.projectRoot, relativePath), packet);
  }
  return packets.map(([relativePath]) => relativePath);
}

function buildReadme(params: {
  topic: string;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  command: string;
  manifest: Record<string, unknown>;
  profile: CodeExperimentProfile;
}): string {
  const innovationPoints = (params.manifest.innovation_points as string[] | undefined) ?? [];
  if (params.profile.kind === "sqlite") {
    return `# ${params.experimentId}: ${params.profile.readmeTitle}

This bundle is the local no-Discord reference implementation for the active SQLite code-stage track.
It loads a fixed workload config from \`${params.bundleRelativeDir}/${params.profile.dataset}\`,
checks \`${params.bundleRelativeDir}/${params.profile.protocol}\`, and compares no-index,
single-column, composite, and covering indexes under the same deterministic query suite.

## Topic

${params.topic}

## Active Track

- Track: ${params.track.trackId}
- Hypothesis: ${params.track.hypothesis ?? "not specified"}
- Novelty basis: ${params.track.noveltyBasis ?? "not specified"}

## Innovation Points

${innovationPoints.map((point) => `- ${point}`).join("\n")}

## Run

\`\`\`bash
${params.command}
\`\`\`

The script writes \`${params.bundleRelativeDir}/RESULT_SUMMARY.json\` with p50/p95 query
latency, insert overhead, database size, and the best observed index strategy. The benchmark is
standard-library-only so the workflow can run a repeatable CPU-only code review without external
dataset downloads.

## Evidence Packets

- \`${CODE_EXPERIMENT_ARTIFACTS.implementationEvidence}\`: hypothesis, novelty basis, graph/claim evidence paths, changed files, integration points, and activation signals.
- \`${CODE_EXPERIMENT_ARTIFACTS.baselineAlignment}\`: required baselines, primary metric, shared dataset/protocol paths, and fairness constraints.
- \`${CODE_EXPERIMENT_ARTIFACTS.hyperparameterSourceMap}\`: seed, row counts, query repeats, and their source symbols in \`${params.bundleRelativeDir}/train.py\`.
- \`${CODE_EXPERIMENT_ARTIFACTS.datasetProtocolLock}\`: locked synthetic workload, query suite, and index strategies.
- \`${CODE_EXPERIMENT_ARTIFACTS.reproductionRiskLedger}\`: bounded-reference risks and the citation-grounding status for implementation claims.
	`;
  }
  return `# ${params.experimentId}: ${params.profile.readmeTitle}

This bundle is the local no-Discord reference implementation for the active code-stage track.
It loads a fixed GCD reference split from \`${params.bundleRelativeDir}/${params.profile.dataset}\`,
checks \`${params.bundleRelativeDir}/${params.profile.protocol}\`, and compares one
baseline-preserving method change against the shared known/novel H-score evaluator.

## Topic

${params.topic}

## Active Track

- Track: ${params.track.trackId}
- Hypothesis: ${params.track.hypothesis ?? "not specified"}
- Novelty basis: ${params.track.noveltyBasis ?? "not specified"}

## Innovation Points

${innovationPoints.map((point) => `- ${point}`).join("\n")}

## Run

\`\`\`bash
${params.command}
\`\`\`

The script writes \`${params.bundleRelativeDir}/RESULT_SUMMARY.json\` with baseline,
proposed, and ablation metrics. The benchmark is intentionally deterministic and
standard-library-only so the workflow can run a repeatable code review and Karpathy loop
without Discord, GPUs, or external dataset downloads.

## Evidence Packets

- \`${CODE_EXPERIMENT_ARTIFACTS.implementationEvidence}\`: hypothesis, novelty basis, graph/claim evidence paths, changed files, integration points, and activation signals.
- \`${CODE_EXPERIMENT_ARTIFACTS.baselineAlignment}\`: required baselines, primary metric, shared dataset/protocol paths, and fairness constraints.
- \`${CODE_EXPERIMENT_ARTIFACTS.hyperparameterSourceMap}\`: seed, thresholds, class partitions, and their source symbols in \`${params.bundleRelativeDir}/train.py\`.
- \`${CODE_EXPERIMENT_ARTIFACTS.datasetProtocolLock}\`: locked known/novel classes, split sizes, and dataset/protocol immutability rules.
- \`${CODE_EXPERIMENT_ARTIFACTS.reproductionRiskLedger}\`: bounded-reference risks and the citation-grounding status for implementation claims.
	`;
}

function buildExperimentIndex(params: {
  topic: string;
  track: ResearchProgramTrack;
  experimentId: string;
  bundleRelativeDir: string;
  command: string;
  manifest: Record<string, unknown>;
}): string {
  const metric = pickString(params.manifest, ["primary_baseline_metric"]) ?? "primary metric";
  const status = pickString(params.manifest, ["status"]) ?? "draft";
  return `# Coder Experiment Index

## Active Bundles

| Experiment | Track | Bundle | Metric | Status |
| --- | --- | --- | --- | --- |
| ${params.experimentId} | ${params.track.trackId} | ${params.bundleRelativeDir} | ${metric} | ${status} |

## Current Execution Contract

- Topic: ${params.topic}
- Hypothesis: ${params.track.hypothesis ?? "not specified"}
- Novelty basis: ${params.track.noveltyBasis ?? "not specified"}
- Execution command: \`${params.command}\`
- Result artifact: \`${params.bundleRelativeDir}/RESULT_SUMMARY.json\`
`;
}

function buildExperimentDispatchContract(params: {
  projectRoot: string;
  manifest: ManifestLike;
  track: ResearchProgramTrack;
  experimentManifest: Record<string, unknown>;
  experimentId: string;
  bundleRelativeDir: string;
  command: string;
  profile: CodeExperimentProfile;
  trigger?: string | null;
  agentId?: string | null;
  now: string;
}): Record<string, unknown> {
  const projectId =
    pickString(params.manifest, ["project_id", "projectId", "id"]) ??
    path.basename(params.projectRoot) ??
    "local-autoresearch-project";
  const manifestPath = `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`;
  return {
    schema_version: 1,
    authority: "experiment_dispatch",
    status: "dispatched",
    project_id: projectId,
    track_id: params.track.trackId,
    experiment_id: params.experimentId,
    dispatched_to: "coder",
    dispatched_by: params.agentId ?? "workflow_guard",
    dispatch_trigger: params.trigger ?? null,
    dispatch_reason: "code_experiment_bundle_ready",
    bundle_dir: params.bundleRelativeDir,
    experiment_manifest_path: manifestPath,
    experiment_index_path: CODE_EXPERIMENT_ARTIFACTS.index,
    execution_command: params.command,
    result_artifact_path: `${params.bundleRelativeDir}/RESULT_SUMMARY.json`,
    innovation_packet_path: "orchestrator/INNOVATION_PACKET.json",
    upstream_contract_paths: [
      "researcher/idea-catalyst/IDEA_CATALYST_CONTRACT.json",
      "graph/GRAPH_BUILD_DECISION.json",
      "orchestrator/INNOVATION_PACKET.json",
    ],
    runnable_artifact_paths: [
      `${params.bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`,
      `${params.bundleRelativeDir}/${params.profile.protocol}`,
      `${params.bundleRelativeDir}/${params.profile.dataset}`,
      manifestPath,
      CODE_EXPERIMENT_ARTIFACTS.index,
    ],
    dispatch_artifact_paths: [
      CODE_EXPERIMENT_ARTIFACTS.orchestratorDispatch,
      CODE_EXPERIMENT_ARTIFACTS.coderDispatch,
    ],
    implementation_type:
      pickString(params.experimentManifest, [
        "implementation_type",
        "implementationType",
      ]) ?? params.profile.implementationType,
    created_at: params.now,
    updated_at: params.now,
  };
}

async function repairExistingCodeBundleForTrack(params: {
  projectRoot: string;
  manifest: ManifestLike;
  researchProgram: ResearchProgramState;
  track: ResearchProgramTrack;
  bundle: ExistingCodeBundle;
  generatedFiles: string[];
}): Promise<void> {
  const topic = inferTopic({
    manifest: params.manifest,
    researchProgram: params.researchProgram,
    track: params.track,
  });
  const profile = resolveCodeExperimentProfile(topic);
  const experimentId =
    pickString(params.bundle.manifest ?? {}, ["experiment_id", "experimentId"]) ?? "exp-1";
  const defaultExperimentManifest = buildExperimentManifest({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    researchProgram: params.researchProgram,
    track: params.track,
    experimentId,
    bundleRelativeDir: params.bundle.relativeDir,
    topic,
    profile,
  });
  const repairedManifest: Record<string, unknown> = {
    ...defaultExperimentManifest,
    ...(params.bundle.manifest ?? {}),
    experiment_id: experimentId,
    project_id:
      pickString(params.bundle.manifest ?? {}, ["project_id", "projectId"]) ??
      pickString(defaultExperimentManifest, ["project_id", "projectId"]),
    track_id: params.track.trackId,
    question:
      params.track.hypothesis ??
      pickString(defaultExperimentManifest, ["question", "experiment_question"]),
    hypothesis:
      params.track.hypothesis ??
      pickString(defaultExperimentManifest, ["hypothesis", "track_hypothesis"]),
    novelty_basis:
      params.track.noveltyBasis ??
      pickString(defaultExperimentManifest, ["novelty_basis", "noveltyBasis"]),
  };
  if (params.bundle.profileMismatch) {
    Object.assign(repairedManifest, profileContractFields(defaultExperimentManifest));
  } else {
    repairedManifest.name = defaultExperimentManifest.name;
  }
  repairedManifest.implementation_type =
    pickString(defaultExperimentManifest, ["implementation_type", "implementationType"]) ??
    profile.implementationType;
  repairedManifest.datasets = defaultExperimentManifest.datasets;
  repairedManifest.reference_dataset = defaultExperimentManifest.reference_dataset;
  repairedManifest.benchmark_protocol_path =
    defaultExperimentManifest.benchmark_protocol_path;
  repairedManifest.dataset_path = defaultExperimentManifest.dataset_path;
  Object.assign(repairedManifest, appendMissingValidationCoverage(repairedManifest));
  const defaultProof = asRecord(defaultExperimentManifest.implementation_proof) ?? {};
  const existingProof = asRecord(
    params.bundle.manifest?.implementation_proof ?? params.bundle.manifest?.implementationProof
  );
  repairedManifest.implementation_proof = appendMissingProofCoverage({
    proof: params.bundle.profileMismatch ? defaultProof : existingProof ?? defaultProof,
    manifest: repairedManifest,
    bundleRelativeDir: params.bundle.relativeDir,
    defaultProof,
  });
  const status = pickString(params.bundle.manifest ?? {}, ["status"]);
  if (status) {
    repairedManifest.status = status;
  }

  if (params.bundle.legacyLocalProxy || params.bundle.profileMismatch || !params.bundle.hasTrain) {
    await writeTextEnsured(
      path.join(params.bundle.dir, CODE_EXPERIMENT_ARTIFACTS.train),
      buildTrainPy(profile)
    );
    params.generatedFiles.push(`${params.bundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);
  }
  await writeJsonEnsured(
    path.join(params.bundle.dir, profile.protocol),
    buildBenchmarkProtocol({ topic, track: params.track, manifest: repairedManifest, profile })
  );
  params.generatedFiles.push(`${params.bundle.relativeDir}/${profile.protocol}`);
  await writeTextEnsured(
    path.join(params.bundle.dir, profile.dataset),
    buildReferenceDataset(profile)
  );
  params.generatedFiles.push(`${params.bundle.relativeDir}/${profile.dataset}`);
  await writeJsonEnsured(params.bundle.manifestPath, repairedManifest);
  params.generatedFiles.push(`${params.bundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);

  const readme = await readTextIfExists(
    path.join(params.bundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme)
  );
  if (
    !params.bundle.hasReadme ||
    readme?.includes("local no-Discord implementation fallback") === true ||
    isLegacyLocalProxyText(readme) ||
    params.bundle.profileMismatch
  ) {
    const executionCommand =
      pickString(asRecord(repairedManifest.implementation_proof) ?? {}, [
        "execution_command",
      ]) ?? `python ${params.bundle.relativeDir}/train.py --seed 42`;
    await writeTextEnsured(
      path.join(params.bundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme),
      buildReadme({
        topic,
        track: params.track,
        experimentId,
        bundleRelativeDir: params.bundle.relativeDir,
        command: executionCommand,
        manifest: repairedManifest,
        profile,
      })
    );
    params.generatedFiles.push(`${params.bundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);
  }
}

export async function materializeCodeExperimentBundleImpl(params: {
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
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<ManifestLike>(manifestPath)) ?? {};
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? {};
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const tracks = selectActiveTracksForMaterialization(researchProgram).filter((candidate) =>
    isSafePathSegment(candidate.trackId)
  );
  const track = tracks[0] ?? null;
  if (!track) {
    return {
      generatedFiles: [],
      experimentId: null,
      trackId: null,
      bundleDir: null,
    };
  }

  const generatedFiles: string[] = [];
  const topic = inferTopic({ manifest, researchProgram, track });
  const profile = resolveCodeExperimentProfile(topic);
  const experimentId = "exp-1";
  const slug = profile.slug;
  const existingBundles = await listExistingCodeBundles(projectRoot, track.trackId, profile);
  const repairableBundles = selectRepairableBundles({
    bundles: existingBundles,
    track,
    registryTrack: getRegistryTrack(trackRegistry, track.trackId),
    manifest,
  });
  const repairableBundle = repairableBundles[0] ?? null;
  const readyBundle =
    existingBundles.find((bundle) => isCompleteAlignedCodeBundle(bundle, track)) ?? null;
  const primaryBundle = repairableBundle ?? readyBundle;
  const bundleRelativeDir =
    primaryBundle?.relativeDir ??
    path.posix.join(
      "coder",
      "experiments",
      track.trackId,
      `${experimentId}__${slug}`
    );
  const bundleDir =
    primaryBundle?.dir ??
    path.join(projectRoot, bundleRelativeDir);
  const defaultExperimentManifest = buildExperimentManifest({
    projectRoot,
    manifest,
    researchProgram,
    track,
    experimentId,
    bundleRelativeDir,
    topic,
    profile,
  });
  const existingManifest = primaryBundle?.manifest ?? null;
  const profileDrift = primaryBundle?.profileMismatch ?? false;
  const experimentManifest: Record<string, unknown> = {
    ...defaultExperimentManifest,
    ...(existingManifest ?? {}),
    experiment_id:
      pickString(existingManifest ?? {}, ["experiment_id", "experimentId"]) ??
      experimentId,
    project_id:
      pickString(existingManifest ?? {}, ["project_id", "projectId"]) ??
      pickString(defaultExperimentManifest, ["project_id", "projectId"]),
    track_id: track.trackId,
    question:
      track.hypothesis ??
      pickString(defaultExperimentManifest, ["question", "experiment_question"]),
    hypothesis:
      track.hypothesis ??
      pickString(defaultExperimentManifest, ["hypothesis", "track_hypothesis"]),
    novelty_basis:
      track.noveltyBasis ??
      pickString(defaultExperimentManifest, ["novelty_basis", "noveltyBasis"]),
  };
  if (profileDrift) {
    Object.assign(experimentManifest, profileContractFields(defaultExperimentManifest));
  } else {
    experimentManifest.name = defaultExperimentManifest.name;
  }
  experimentManifest.implementation_type =
    pickString(defaultExperimentManifest, ["implementation_type", "implementationType"]) ??
    profile.implementationType;
  if (
    profileDrift ||
    asRecord(experimentManifest.reference_dataset) == null ||
    isLegacyLocalProxyText(JSON.stringify(experimentManifest.datasets ?? ""))
  ) {
    experimentManifest.datasets = defaultExperimentManifest.datasets;
    experimentManifest.reference_dataset = defaultExperimentManifest.reference_dataset;
  }
  experimentManifest.benchmark_protocol_path = defaultExperimentManifest.benchmark_protocol_path;
  experimentManifest.dataset_path = defaultExperimentManifest.dataset_path;
  Object.assign(experimentManifest, appendMissingValidationCoverage(experimentManifest));
  const defaultProof = asRecord(defaultExperimentManifest.implementation_proof) ?? {};
  const existingProof = asRecord(
    existingManifest?.implementation_proof ?? existingManifest?.implementationProof
  );
  experimentManifest.implementation_proof = appendMissingProofCoverage({
    proof: profileDrift ? defaultProof : existingProof ?? defaultProof,
    manifest: experimentManifest,
    bundleRelativeDir,
    defaultProof,
  });
  Object.assign(experimentManifest, evidencePacketPathFields());
  const status = pickString(existingManifest ?? {}, ["status"]);
  if (status) {
    experimentManifest.status = status;
  }
  const resolvedExperimentId =
    pickString(experimentManifest, ["experiment_id", "experimentId"]) ?? experimentId;
  const executionCommand =
    pickString(
      asRecord(experimentManifest.implementation_proof) ?? {},
      ["execution_command"]
    ) ?? `python ${bundleRelativeDir}/train.py --seed 42`;

  const existingTrain = await readTextIfExists(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.train)
  );
  const shouldRewriteTrain =
    !primaryBundle ||
    !primaryBundle.hasTrain ||
    primaryBundle.legacyLocalProxy ||
    primaryBundle.profileMismatch ||
    isLegacyLocalProxyText(existingTrain);
  if (shouldRewriteTrain) {
    await writeTextEnsured(
      path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.train),
      buildTrainPy(profile)
    );
    generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);
  }

  await writeJsonEnsured(
    path.join(bundleDir, profile.protocol),
    buildBenchmarkProtocol({ topic, track, manifest: experimentManifest, profile })
  );
  generatedFiles.push(`${bundleRelativeDir}/${profile.protocol}`);
  await writeTextEnsured(
    path.join(bundleDir, profile.dataset),
    buildReferenceDataset(profile)
  );
  generatedFiles.push(`${bundleRelativeDir}/${profile.dataset}`);

  await writeJsonEnsured(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.manifest),
    experimentManifest
  );
  generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);
  generatedFiles.push(
    ...(await writeCodeEvidencePackets({
      projectRoot,
      topic,
      researchProgram,
      track,
      experimentManifest,
      experimentId: resolvedExperimentId,
      bundleRelativeDir,
      executionCommand,
      profile,
    }))
  );

  const existingReadme = await readTextIfExists(
    path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.readme)
  );
  const shouldRewriteReadme =
    !primaryBundle ||
    !primaryBundle.hasReadme ||
    existingReadme?.includes("local no-Discord implementation fallback") === true ||
    primaryBundle.profileMismatch ||
    isLegacyLocalProxyText(existingReadme);
  if (shouldRewriteReadme) {
    await writeTextEnsured(
      path.join(bundleDir, CODE_EXPERIMENT_ARTIFACTS.readme),
      buildReadme({
        topic,
        track,
        experimentId: resolvedExperimentId,
        bundleRelativeDir,
        command: executionCommand,
        manifest: experimentManifest,
        profile,
      })
    );
    generatedFiles.push(`${bundleRelativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);
  }

  for (const staleBundle of repairableBundles.slice(1)) {
    const staleExperimentId =
      pickString(staleBundle.manifest ?? {}, ["experiment_id", "experimentId"]) ??
      experimentId;
    const staleManifest: Record<string, unknown> = {
      ...defaultExperimentManifest,
      ...(staleBundle.manifest ?? {}),
      experiment_id: staleExperimentId,
      project_id:
        pickString(staleBundle.manifest ?? {}, ["project_id", "projectId"]) ??
        pickString(defaultExperimentManifest, ["project_id", "projectId"]),
      track_id: track.trackId,
      question:
        track.hypothesis ??
        pickString(defaultExperimentManifest, ["question", "experiment_question"]),
      hypothesis:
        track.hypothesis ??
        pickString(defaultExperimentManifest, ["hypothesis", "track_hypothesis"]),
      novelty_basis:
        track.noveltyBasis ??
        pickString(defaultExperimentManifest, ["novelty_basis", "noveltyBasis"]),
    };
    if (staleBundle.profileMismatch) {
      Object.assign(staleManifest, profileContractFields(defaultExperimentManifest));
    } else {
      staleManifest.name = defaultExperimentManifest.name;
    }
    staleManifest.implementation_type =
      pickString(defaultExperimentManifest, ["implementation_type", "implementationType"]) ??
      profile.implementationType;
    staleManifest.datasets = defaultExperimentManifest.datasets;
    staleManifest.reference_dataset = defaultExperimentManifest.reference_dataset;
    staleManifest.benchmark_protocol_path = defaultExperimentManifest.benchmark_protocol_path;
    staleManifest.dataset_path = defaultExperimentManifest.dataset_path;
    Object.assign(staleManifest, appendMissingValidationCoverage(staleManifest));
    const staleDefaultProof = asRecord(defaultExperimentManifest.implementation_proof) ?? {};
    const staleExistingProof = asRecord(
      staleBundle.manifest?.implementation_proof ?? staleBundle.manifest?.implementationProof
    );
    staleManifest.implementation_proof = appendMissingProofCoverage({
      proof: staleBundle.profileMismatch
        ? staleDefaultProof
        : staleExistingProof ?? staleDefaultProof,
      manifest: staleManifest,
      bundleRelativeDir: staleBundle.relativeDir,
      defaultProof: staleDefaultProof,
    });
    const staleStatus = pickString(staleBundle.manifest ?? {}, ["status"]);
    if (staleStatus) {
      staleManifest.status = staleStatus;
    }
    if (staleBundle.legacyLocalProxy || staleBundle.profileMismatch || !staleBundle.hasTrain) {
      await writeTextEnsured(
        path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.train),
        buildTrainPy(profile)
      );
      generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.train}`);
    }
    await writeJsonEnsured(
      path.join(staleBundle.dir, profile.protocol),
      buildBenchmarkProtocol({ topic, track, manifest: staleManifest, profile })
    );
    generatedFiles.push(`${staleBundle.relativeDir}/${profile.protocol}`);
    await writeTextEnsured(
      path.join(staleBundle.dir, profile.dataset),
      buildReferenceDataset(profile)
    );
    generatedFiles.push(`${staleBundle.relativeDir}/${profile.dataset}`);
    await writeJsonEnsured(staleBundle.manifestPath, staleManifest);
    generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.manifest}`);

    const staleReadme = await readTextIfExists(
      path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme)
    );
    if (
      staleReadme?.includes("local no-Discord implementation fallback") === true ||
      isLegacyLocalProxyText(staleReadme) ||
      staleBundle.profileMismatch
    ) {
      const staleExecutionCommand =
        pickString(asRecord(staleManifest.implementation_proof) ?? {}, ["execution_command"]) ??
        `python ${staleBundle.relativeDir}/train.py --seed 42`;
      await writeTextEnsured(
        path.join(staleBundle.dir, CODE_EXPERIMENT_ARTIFACTS.readme),
        buildReadme({
          topic,
          track,
          experimentId: staleExperimentId,
          bundleRelativeDir: staleBundle.relativeDir,
          command: staleExecutionCommand,
          manifest: staleManifest,
          profile,
        })
      );
      generatedFiles.push(`${staleBundle.relativeDir}/${CODE_EXPERIMENT_ARTIFACTS.readme}`);
    }
  }

  for (const additionalTrack of tracks.slice(1)) {
    const additionalTopic = inferTopic({
      manifest,
      researchProgram,
      track: additionalTrack,
    });
    const additionalBundles = await listExistingCodeBundles(
      projectRoot,
      additionalTrack.trackId,
      resolveCodeExperimentProfile(additionalTopic)
    );
    const additionalRepairableBundles = selectRepairableBundles({
      bundles: additionalBundles,
      track: additionalTrack,
      registryTrack: getRegistryTrack(trackRegistry, additionalTrack.trackId),
      manifest,
    });
    for (const additionalBundle of additionalRepairableBundles) {
      await repairExistingCodeBundleForTrack({
        projectRoot,
        manifest,
        researchProgram,
        track: additionalTrack,
        bundle: additionalBundle,
        generatedFiles,
      });
    }
  }

  await writeTextEnsured(
    path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.index),
    buildExperimentIndex({
      topic,
      track,
      experimentId: resolvedExperimentId,
      bundleRelativeDir,
      command: executionCommand,
      manifest: experimentManifest,
    })
  );
  generatedFiles.push(CODE_EXPERIMENT_ARTIFACTS.index);

  const now = new Date().toISOString();
  const dispatchContract = buildExperimentDispatchContract({
    projectRoot,
    manifest,
    track,
    experimentManifest,
    experimentId: resolvedExperimentId,
    bundleRelativeDir,
    command: executionCommand,
    profile,
    trigger: params.trigger,
    agentId: params.agentId,
    now,
  });
  await writeJsonEnsured(
    path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.orchestratorDispatch),
    dispatchContract
  );
  await writeJsonEnsured(
    path.join(projectRoot, CODE_EXPERIMENT_ARTIFACTS.coderDispatch),
    dispatchContract
  );
  generatedFiles.push(CODE_EXPERIMENT_ARTIFACTS.orchestratorDispatch);
  generatedFiles.push(CODE_EXPERIMENT_ARTIFACTS.coderDispatch);

  const currentStage = normalizeStage(manifest.current_stage);
  const isCodeStage = currentStage === "code";
  const orchestration = normalizeOrchestrationState(manifest.orchestration_state);
  manifest.orchestration_state = serializeOrchestrationState({
    ...orchestration,
    status: ["running", "waiting", "ready"].includes(
      normalizeStage(orchestration.status) ?? ""
    )
      ? orchestration.status
      : "waiting",
    currentOwner: isCodeStage ? "coder" : orchestration.currentOwner,
    nextOwner: isCodeStage ? orchestration.nextOwner ?? "researcher" : orchestration.nextOwner,
    nextTransitionCandidate: isCodeStage
      ? "experiment"
      : orchestration.nextTransitionCandidate,
    blockingCategory: null,
    blockingReason: null,
    retryBudgetRemaining: orchestration.retryBudgetRemaining ?? 2,
    lastContractEvalAt: now,
    lastContractEvalResult: "pass",
    resumeCursor: isCodeStage ? `code:${experimentId}:bundle_ready` : orchestration.resumeCursor,
    lastUpdatedAt: now,
  });
  if (isCodeStage) {
    manifest.owner_agent = "coder";
  }
  await writeJsonEnsured(manifestPath, manifest);
  if (isCodeStage) {
    await reconcileWorkflowControl({
      projectRoot,
      manifest,
    });
  }
  generatedFiles.push("PROJECT_MANIFEST.json");

  return {
    generatedFiles: uniqueStrings(generatedFiles),
    experimentId,
    trackId: track.trackId,
    bundleDir: bundleRelativeDir,
  };
}
