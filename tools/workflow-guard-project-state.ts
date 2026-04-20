import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  asString,
  normalizeStage,
  pickNumber,
  pickString,
} from "./workflow-guard-core/coercion";
import { pathExists } from "./workflow-guard-core/fs";
import { expandHome } from "./workflow-guard-core/paths";
import {
  normalizeSurveyReviewState,
  serializeSurveyReviewState,
} from "./workflow-guard-state/survey-review";
import {
  normalizeWritingContractState,
  serializeWritingContractState,
} from "./workflow-guard-state/writing-contract";
import {
  getProjectsStatePath as getProjectsStatePathFromRegistry,
  readProjectsStateRaw as readProjectsStateRawFromRegistry,
  syncProjectsStateEntry as syncProjectsStateEntryFromRegistry,
} from "./workflow-project-registry";

type WorkflowGuardPolicyLike = {
  projectsRoot?: string | null;
  allowWorkspaceFallback?: boolean;
  zoteroProjectRoot?: string | null;
};

const SURVEY_BOOTSTRAP_PENDING_REASON =
  "Start the survey retrieval rounds and update SURVEY_QUERY_REGISTRY.json before synthesis.";

const SURVEY_BOOTSTRAP_WRITING_CONTRACT_RESET_KEYS = [
  "templateRequired",
  "template_required",
  "templatePath",
  "template_path",
  "projectTemplatePath",
  "project_template_path",
  "templateName",
  "template_name",
  "templateStatus",
  "template_status",
  "templateCopyStatus",
  "template_copy_status",
  "bodyPageBudget",
  "body_page_budget",
  "referencePageBudget",
  "reference_page_budget",
  "bodyWordTargetMin",
  "body_word_target_min",
  "bodyWordTargetMax",
  "body_word_target_max",
  "mainTextProofStyle",
  "main_text_proof_style",
  "proofAppendixRequired",
  "proof_appendix_required",
  "proofAppendixPath",
  "proof_appendix_path",
  "proofAppendixStatus",
  "proof_appendix_status",
  "proofChecklist",
  "proof_checklist",
  "storylineSource",
  "storyline_source",
  "kgStorylineRequired",
  "kg_storyline_required",
  "kgStorylineStatus",
  "kg_storyline_status",
  "kgStorylinePacketPath",
  "kg_storyline_packet_path",
  "requiredSections",
  "required_sections",
  "sectionOrder",
  "section_order",
  "pendingReason",
  "pending_reason",
] as const;

const SURVEY_BOOTSTRAP_RESETTABLE_STAGES = new Set([
  "setup",
  "graph_build",
  "frontier_mapping",
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "survey_review",
]);

function formatSurveyPipelineCommand(topic: string): string {
  return `/survey-pipeline ${JSON.stringify(topic)}`;
}

function shouldResetToSurveyReviewStage(stage: string | null): boolean {
  return !stage || SURVEY_BOOTSTRAP_RESETTABLE_STAGES.has(stage);
}

function stripSurveyBootstrapWritingContractPresetFields(
  contract: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...contract };
  for (const key of SURVEY_BOOTSTRAP_WRITING_CONTRACT_RESET_KEYS) {
    delete next[key];
  }
  return next;
}

function applySurveyWorkflowBootstrapToManifest(params: {
  manifest: Record<string, unknown>;
  topic: string;
  now: string;
}): Record<string, unknown> {
  const currentStage = normalizeStage(params.manifest.current_stage);
  const currentSurveyReview = normalizeSurveyReviewState(params.manifest.survey_review);
  const currentWritingContractRecord =
    asRecord(params.manifest.writing_contract) ?? {};
  const currentWritingContract = normalizeWritingContractState(
    currentWritingContractRecord
  );
  const nextWritingContractSeed =
    currentWritingContract.paperMode === "survey"
      ? currentWritingContractRecord
      : stripSurveyBootstrapWritingContractPresetFields(currentWritingContractRecord);
  const nextSurveyReview = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(currentSurveyReview),
    topic: currentSurveyReview.topic ?? params.topic,
    mode: currentSurveyReview.mode ?? "survey",
    status: currentSurveyReview.status === "missing" ? "searching" : currentSurveyReview.status,
    current_phase: currentSurveyReview.currentPhase ?? "retrieval",
    pending_reason: currentSurveyReview.pendingReason ?? SURVEY_BOOTSTRAP_PENDING_REASON,
    last_updated_at: params.now,
  });
  const nextManifest = {
    ...params.manifest,
    workflow_line: "survey",
    paper_type: "survey",
    survey_review: serializeSurveyReviewState(nextSurveyReview),
    writing_contract: serializeWritingContractState(
      normalizeWritingContractState({
        ...nextWritingContractSeed,
        paper_mode: "survey",
      })
    ),
    updated_at: params.now,
  };

  if (!shouldResetToSurveyReviewStage(currentStage)) {
    return nextManifest;
  }

  return {
    ...nextManifest,
    owner_agent: "researcher",
    current_stage: "survey_review",
    current_micro_stage: nextSurveyReview.currentPhase ?? "survey_requested",
    next_action: formatSurveyPipelineCommand(params.topic),
    resume_action: '/resume-pipeline "<project_id>"',
    blocking_reason: nextSurveyReview.pendingReason ?? SURVEY_BOOTSTRAP_PENDING_REASON,
  };
}

type EnsuredWorkflowProjectLike = {
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

type GateStateLike = {
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

export function sanitizeProjectIdFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function deriveProjectIdForBootstrap(params: {
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

export function deriveProjectTitleForBootstrap(params: {
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

export function buildIdleResearchTemplateForBootstrap(params: {
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

export function defaultResearchProgramZoteroProjectPath(
  projectId: string | null | undefined,
  zoteroProjectRoot?: string | null | undefined
): string | null {
  const normalizedProjectId = asString(projectId);
  if (!normalizedProjectId) {
    return null;
  }
  const normalizedRoot = asString(zoteroProjectRoot) ?? "bot";
  const trimmedRoot = normalizedRoot.replace(/[\\/]+$/g, "");
  return `${trimmedRoot}/${normalizedProjectId}`;
}

export function getConfiguredProjectsRoot(params: {
  policy?: WorkflowGuardPolicyLike;
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
  return null;
}

export function isProjectRootWithinProjectsRoot(params: {
  projectRoot: string;
  projectsRoot: string;
}): boolean {
  const normalizedProjectRoot = path.resolve(expandHome(params.projectRoot));
  const normalizedProjectsRoot = path.resolve(expandHome(params.projectsRoot));
  const relative = path.relative(normalizedProjectsRoot, normalizedProjectRoot);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function assertProjectRootWithinProjectsRoot(params: {
  projectRoot: string;
  projectsRoot: string;
  sourceLabel?: string | null;
}): string {
  const normalizedProjectRoot = path.resolve(expandHome(params.projectRoot));
  const normalizedProjectsRoot = path.resolve(expandHome(params.projectsRoot));
  if (
    !isProjectRootWithinProjectsRoot({
      projectRoot: normalizedProjectRoot,
      projectsRoot: normalizedProjectsRoot,
    })
  ) {
    const sourcePrefix = asString(params.sourceLabel)
      ? `${params.sourceLabel} `
      : "";
    throw new Error(
      `${sourcePrefix}projectRoot must live under the configured projectsRoot. projectRoot=${normalizedProjectRoot} projectsRoot=${normalizedProjectsRoot}`
    );
  }
  return normalizedProjectRoot;
}

export async function ensureTextFile(targetPath: string, content: string): Promise<boolean> {
  if (await pathExists(targetPath)) {
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return true;
}

export function mergeMissingTemplateDefaults(
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

export function cloneTemplateValue(value: unknown): unknown {
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function ensureJsonTemplateFile(params: {
  targetPath: string;
  templateRelativePath: string;
  transform: (template: Record<string, unknown>) => Record<string, unknown>;
  templatesRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<boolean> {
  const templatePath = path.join(params.templatesRoot, params.templateRelativePath);
  const template =
    (await params.readJsonIfExists<Record<string, unknown>>(templatePath)) ?? {};
  const desired = params.transform(template);
  const existing = await params.readJsonIfExists<Record<string, unknown>>(params.targetPath);
  if (!existing) {
    await params.writeJsonEnsured(params.targetPath, desired);
    return true;
  }
  const merged = mergeMissingTemplateDefaults(existing, desired);
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    await params.writeJsonEnsured(params.targetPath, merged);
  }
  return false;
}

export async function ensureWorkflowProjectRootImpl(params: {
  policy?: WorkflowGuardPolicyLike;
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
}, deps: {
  templatesRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
  getExperimentLedgerPath: (projectRoot: string) => string;
}): Promise<EnsuredWorkflowProjectLike> {
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
      "projectsRoot is not configured for ClawAutoResearch. Set plugins.entries.ClawAutoResearch.config.projectsRoot (or OPENCLAW_PROJECTS_ROOT)."
    );
  }
  const projectRoot = assertProjectRootWithinProjectsRoot({
    projectRoot: params.projectRoot ?? path.join(projectsRoot, projectId),
    projectsRoot,
    sourceLabel: "Workflow",
  });
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
    templatesRoot: deps.templatesRoot,
    readJsonIfExists: deps.readJsonIfExists,
    writeJsonEnsured: deps.writeJsonEnsured,
    transform: (template) => ({
      ...template,
      project_id: projectId,
      title,
      status: "active",
      owner_agent: "researcher",
      current_stage: "setup",
      current_micro_stage: "project_init",
      next_action: '/project-init "research goal"',
      resume_action: '/resume-pipeline "<project_id>"',
      blocking_reason:
        "Project scaffold created; complete the onboarding contract before literature collection and graph grounding.",
      research_program: {
        ...(asRecord(template.research_program) ?? {}),
        status: "draft",
        goal: params.topic ?? title,
        problem_statement: params.topic ?? title,
        baseline_reference: null,
        primary_metric: null,
        datasets: [],
        constraints: [],
        success_criteria: [],
        zotero_project_path: defaultResearchProgramZoteroProjectPath(
          projectId,
          params.policy?.zoteroProjectRoot
        ),
        last_updated_at: now,
        pending_reason:
          "Complete the onboarding contract (baseline, metric, datasets, success criteria, Zotero path) before graph grounding.",
      },
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
    templatesRoot: deps.templatesRoot,
    readJsonIfExists: deps.readJsonIfExists,
    writeJsonEnsured: deps.writeJsonEnsured,
    transform: (template) => ({
      ...template,
      project_id: projectId,
      updated_at: now,
    }),
  });
  const experimentLedgerCreated = await ensureJsonTemplateFile({
    targetPath: deps.getExperimentLedgerPath(projectRoot),
    templateRelativePath: "EXPERIMENT_LEDGER.json",
    templatesRoot: deps.templatesRoot,
    readJsonIfExists: deps.readJsonIfExists,
    writeJsonEnsured: deps.writeJsonEnsured,
    transform: (template) => ({
      ...template,
      project_id: projectId,
      updated_at: now,
    }),
  });
  await ensureJsonTemplateFile({
    targetPath: path.join(projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
    templateRelativePath: "IDLE_RESEARCH.example.json",
    templatesRoot: deps.templatesRoot,
    readJsonIfExists: deps.readJsonIfExists,
    writeJsonEnsured: deps.writeJsonEnsured,
    transform: () => buildIdleResearchTemplateForBootstrap({ title, topic: params.topic }),
  });

  const claimPolicyCreated = await ensureTextFile(
    path.join(projectRoot, "CLAIM_POLICY.md"),
    (await fs.readFile(path.join(deps.templatesRoot, "CLAIM_POLICY.md"), "utf8")).toString()
  );

  const memoryTemplatesRoot = path.join(deps.templatesRoot, "memory");
  await ensureTextFile(
    path.join(projectRoot, "memory", "ideation-memory.md"),
    (await fs.readFile(path.join(memoryTemplatesRoot, "ideation-memory.md"), "utf8")).toString()
  );
  await ensureTextFile(
    path.join(projectRoot, "memory", "experiment-memory.md"),
    (await fs.readFile(path.join(memoryTemplatesRoot, "experiment-memory.md"), "utf8")).toString()
  );

  if (params.workflowLine === "survey") {
    const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
    const manifest = (await deps.readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
    const surveyTopic = asString(params.topic) ?? title;
    const nextManifest = applySurveyWorkflowBootstrapToManifest({
      manifest,
      topic: surveyTopic,
      now,
    });
    await deps.writeJsonEnsured(manifestPath, nextManifest);
  }

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

export function getGateStatePath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "GATE_STATE.json");
}

export function normalizeGateState(value: unknown): GateStateLike {
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

export function serializeGateState(state: GateStateLike): Record<string, unknown> {
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

export async function readGateState(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<GateStateLike> {
  return normalizeGateState(
    await params.readJsonIfExists<Record<string, unknown>>(getGateStatePath(params.projectRoot))
  );
}

export async function saveGateState(params: {
  projectRoot: string;
  gateState: GateStateLike;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  await params.writeJsonEnsured(
    getGateStatePath(params.projectRoot),
    serializeGateState(params.gateState)
  );
}

export function computeGateConfirmationDeadline(state: GateStateLike): string | null {
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

export function isTimedDefaultGate(state: GateStateLike): boolean {
  return normalizeStage(state.gateType) === "timed_default";
}

export function hasTimedDefaultGateExpired(
  state: GateStateLike,
  now: string
): boolean {
  if (!isTimedDefaultGate(state)) {
    return false;
  }
  const deadline = computeGateConfirmationDeadline(state);
  if (!deadline) {
    return false;
  }
  return Date.parse(now) >= Date.parse(deadline);
}

export async function getGateStateSummaryImpl(params: {
  projectRoot: string;
  now?: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<{
  state: GateStateLike;
  timedDefaultEligible: boolean;
  timedDefaultExpired: boolean;
  confirmationDeadlineAt: string | null;
}> {
  const state = await readGateState({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
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

export async function setGateStateForWorkflowImpl(params: {
  projectRoot: string;
  gateState: Record<string, unknown>;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<{
  state: GateStateLike;
  timedDefaultEligible: boolean;
  timedDefaultExpired: boolean;
  confirmationDeadlineAt: string | null;
}> {
  const current = await readGateState({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  const next = normalizeGateState({
    ...serializeGateState(current),
    ...params.gateState,
  });
  next.confirmationDeadlineAt = computeGateConfirmationDeadline(next);
  await saveGateState({
    projectRoot: params.projectRoot,
    gateState: next,
    writeJsonEnsured: params.writeJsonEnsured,
  });
  return {
    state: next,
    timedDefaultEligible: isTimedDefaultGate(next),
    timedDefaultExpired: hasTimedDefaultGateExpired(next, new Date().toISOString()),
    confirmationDeadlineAt: next.confirmationDeadlineAt,
  };
}

export function getProjectsStatePath(projectRoot: string): string {
  return getProjectsStatePathFromRegistry(projectRoot);
}

export async function readProjectsStateRaw(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<Record<string, unknown>> {
  void params.readJsonIfExists;
  return readProjectsStateRawFromRegistry(params.projectRoot);
}

export function formatProjectDirEntry(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return `${projectId}/`;
}

export function dateOnly(isoTs: string): string {
  return isoTs.slice(0, 10);
}

export async function syncProjectsStateEntryImpl(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  trackRegistry: Record<string, unknown> | null;
  stage: string | null;
  nextAction: string | null;
  blockingReason: string | null;
}, deps: {
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
  getActiveTracks: (trackRegistry: Record<string, unknown> | null) => unknown[];
}): Promise<boolean> {
  void deps.readJsonIfExists;
  void deps.writeJsonEnsured;
  return syncProjectsStateEntryFromRegistry({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    manifest: params.manifest,
    trackRegistry: params.trackRegistry,
    stage: params.stage,
    nextAction: params.nextAction,
    blockingReason: params.blockingReason,
    getActiveTracks: deps.getActiveTracks,
  });
}
