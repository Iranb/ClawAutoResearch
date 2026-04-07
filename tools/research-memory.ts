/**
 * research-memory tool backend
 *
 * Centralizes project-isolated research memory writes so agents do not edit
 * memory markdown or review state files by hand.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  resolveProjectContext,
  type ChannelProjectBindingContext,
  type ChannelProjectBindingPolicy,
} from "./channel-project-bindings";

export interface ResearchMemoryPolicy extends ChannelProjectBindingPolicy {
  // Data integrity policies
  allowWorkspaceFallback?: boolean;
  requireProjectIsolation?: boolean;
  requireProjectIdInEntries?: boolean;
  requireTrackId?: boolean;
  requireEvidencePointers?: boolean;
  reviewStateMaxAgeHours?: number;
  
  // Project and server configuration
  projectsRoot?: string;
  servers?: {
    default?: string;
    list?: string[];
  };
  
  // Idea generation configuration
  ideaGeneration?: {
    divergeSize?: number;
    portfolioSize?: number;
    tournamentRounds?: number;
  };
  
  // Track portfolio configuration
  trackPortfolio?: {
    maxActiveTracks?: number;
    maxParkedTracks?: number;
    parkedBudgetPolicy?: "zero" | "reduced" | "full";
  };
  
  // Compute budget configuration
  computeBudget?: {
    defaultGpuHoursPerTrack?: number;
    maxConcurrentExperiments?: number;
    gpuType?: "V100" | "A100" | "H100" | "RTX6000" | "mixed";
  };
  
  // Review loop configuration
  reviewLoop?: {
    maxRounds?: number;
    scoreThreshold?: number;
    autoAdvanceScore?: number;
  };
  
  // Graph configuration
  graphConfig?: {
    autoRefreshTrigger?: "never" | "weekly" | "monthly" | "per-track";
    noveltyThreshold?: number;
    maxPapersToIngest?: number;
  };
}

interface CommonEntryFields {
  projectId?: string;
  trackId?: string;
  sourceStage?: string;
  signature?: string;
  evidencePointers?: string[];
  confidence?: number;
  tags?: string[];
}

interface IdeaEntry extends CommonEntryFields {
  title: string;
  domain: string;
  hypothesis: string;
  outcome: "success" | "abandoned";
  whyNovel?: string;
  pilotResult?: string;
  generalizablePattern?: string;
  closestPriorWork?: string;
  failureMode?: string;
  failureBucket?: string;
  retryCondition?: string;
}

interface ExperimentEntry extends CommonEntryFields {
  name: string;
  taskType: string;
  dataset: string;
  model?: string;
  hyperparams: Record<string, string | number>;
  result: string;
  trainingTimeHours: number;
  gpuType: string;
  reuseCondition: string;
}

interface FailedExperimentEntry extends CommonEntryFields {
  name: string;
  taskType: string;
  dataset: string;
  model?: string;
  hyperparams?: Record<string, string | number>;
  resultSummary?: string;
  failureMode: string;
  failureBucket?: string;
  retryCondition?: string;
  trainingTimeHours?: number;
  gpuType?: string;
}

interface ReviewState {
  round: number;
  status: "in_progress" | "completed";
  lastScore: number;
  lastVerdict: "ready" | "almost" | "not ready";
  pendingActions: string[];
  timestamp: string;
}

const DEFAULT_POLICY: Required<ResearchMemoryPolicy> = {
  // Data integrity policies
  allowWorkspaceFallback: false,
  requireProjectIsolation: true,
  requireProjectIdInEntries: true,
  requireTrackId: true,
  requireEvidencePointers: true,
  reviewStateMaxAgeHours: 24,
  
  // Project and server configuration
  projectsRoot: "~/.openclaw/projects",
  servers: {
    default: "gateway",
    list: [],
  },
  
  // Idea generation configuration
  ideaGeneration: {
    divergeSize: 8,
    portfolioSize: 4,
    tournamentRounds: 2,
  },
  
  // Track portfolio configuration
  trackPortfolio: {
    maxActiveTracks: 2,
    maxParkedTracks: 1,
    parkedBudgetPolicy: "zero",
  },
  
  // Compute budget configuration
  computeBudget: {
    defaultGpuHoursPerTrack: 100,
    maxConcurrentExperiments: 4,
    gpuType: "A100",
  },
  
  // Review loop configuration
  reviewLoop: {
    maxRounds: 3,
    scoreThreshold: 6.0,
    autoAdvanceScore: 7.5,
  },
  
  // Graph configuration
  graphConfig: {
    autoRefreshTrigger: "per-track",
    noveltyThreshold: 0.7,
    maxPapersToIngest: 5000,
  },
  enableChannelProjectBindings: false,
  channelProjectBindingsPath: "",
};

function normalizePolicy(
  policy: ResearchMemoryPolicy = {}
): Required<ResearchMemoryPolicy> {
  return {
    // Data integrity policies
    allowWorkspaceFallback: false,
    requireProjectIsolation:
      policy.requireProjectIsolation ?? DEFAULT_POLICY.requireProjectIsolation,
    requireProjectIdInEntries:
      policy.requireProjectIdInEntries ??
      DEFAULT_POLICY.requireProjectIdInEntries,
    requireTrackId: policy.requireTrackId ?? DEFAULT_POLICY.requireTrackId,
    requireEvidencePointers:
      policy.requireEvidencePointers ?? DEFAULT_POLICY.requireEvidencePointers,
    reviewStateMaxAgeHours:
      policy.reviewStateMaxAgeHours ?? DEFAULT_POLICY.reviewStateMaxAgeHours,
    
    // Project and server configuration
    projectsRoot: policy.projectsRoot ?? DEFAULT_POLICY.projectsRoot,
    servers: {
      default: policy.servers?.default ?? DEFAULT_POLICY.servers.default,
      list: policy.servers?.list ?? DEFAULT_POLICY.servers.list,
    },
    
    // Idea generation configuration
    ideaGeneration: {
      divergeSize:
        policy.ideaGeneration?.divergeSize ??
        DEFAULT_POLICY.ideaGeneration.divergeSize,
      portfolioSize:
        policy.ideaGeneration?.portfolioSize ??
        DEFAULT_POLICY.ideaGeneration.portfolioSize,
      tournamentRounds:
        policy.ideaGeneration?.tournamentRounds ??
        DEFAULT_POLICY.ideaGeneration.tournamentRounds,
    },
    
    // Track portfolio configuration
    trackPortfolio: {
      maxActiveTracks:
        policy.trackPortfolio?.maxActiveTracks ??
        DEFAULT_POLICY.trackPortfolio.maxActiveTracks,
      maxParkedTracks:
        policy.trackPortfolio?.maxParkedTracks ??
        DEFAULT_POLICY.trackPortfolio.maxParkedTracks,
      parkedBudgetPolicy:
        policy.trackPortfolio?.parkedBudgetPolicy ??
        DEFAULT_POLICY.trackPortfolio.parkedBudgetPolicy,
    },
    
    // Compute budget configuration
    computeBudget: {
      defaultGpuHoursPerTrack:
        policy.computeBudget?.defaultGpuHoursPerTrack ??
        DEFAULT_POLICY.computeBudget.defaultGpuHoursPerTrack,
      maxConcurrentExperiments:
        policy.computeBudget?.maxConcurrentExperiments ??
        DEFAULT_POLICY.computeBudget.maxConcurrentExperiments,
      gpuType:
        policy.computeBudget?.gpuType ?? DEFAULT_POLICY.computeBudget.gpuType,
    },
    
    // Review loop configuration
    reviewLoop: {
      maxRounds:
        policy.reviewLoop?.maxRounds ?? DEFAULT_POLICY.reviewLoop.maxRounds,
      scoreThreshold:
        policy.reviewLoop?.scoreThreshold ??
        DEFAULT_POLICY.reviewLoop.scoreThreshold,
      autoAdvanceScore:
        policy.reviewLoop?.autoAdvanceScore ??
        DEFAULT_POLICY.reviewLoop.autoAdvanceScore,
    },
    
    // Graph configuration
    graphConfig: {
      autoRefreshTrigger:
        policy.graphConfig?.autoRefreshTrigger ??
        DEFAULT_POLICY.graphConfig.autoRefreshTrigger,
      noveltyThreshold:
        policy.graphConfig?.noveltyThreshold ??
        DEFAULT_POLICY.graphConfig.noveltyThreshold,
      maxPapersToIngest:
        policy.graphConfig?.maxPapersToIngest ??
        DEFAULT_POLICY.graphConfig.maxPapersToIngest,
    },
    enableChannelProjectBindings:
      policy.enableChannelProjectBindings ??
      DEFAULT_POLICY.enableChannelProjectBindings,
    channelProjectBindingsPath:
      policy.channelProjectBindingsPath ??
      DEFAULT_POLICY.channelProjectBindingsPath,
  };
}

function getWorkspaceRoot(): string {
  return process.env.OPENCLAW_WORKSPACE ?? process.cwd();
}

function getProjectRoot(
  context?: ChannelProjectBindingContext,
  policy?: ResearchMemoryPolicy
): string | null {
  return resolveProjectContext({
    policy,
    context,
  }).projectRoot;
}

function inferProjectId(projectRoot: string | null): string | undefined {
  if (!projectRoot) return undefined;
  return path.basename(projectRoot);
}

function ensureProjectScope(
  policy: Required<ResearchMemoryPolicy>,
  context?: ChannelProjectBindingContext
): void {
  if (policy.requireProjectIsolation && !getProjectRoot(context, policy)) {
    throw new Error(
      "A resolved project is required for project-isolated research memory writes. Bind the current channel to a project or set OPENCLAW_PROJECT."
    );
  }
}

function resolveBaseDir(
  policy: Required<ResearchMemoryPolicy>,
  kind: "memory" | "researcher",
  context?: ChannelProjectBindingContext
): string {
  const projectRoot = getProjectRoot(context, policy);
  if (projectRoot) {
    return path.join(projectRoot, kind === "memory" ? "memory" : "researcher");
  }

  if (!policy.allowWorkspaceFallback) {
    throw new Error(
      "Workspace fallback is disabled for research memory. Bind the current channel to a project or set OPENCLAW_PROJECT to a project inside projectsRoot."
    );
  }

  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, kind === "memory" ? "memory" : "research");
}

function memoryPath(
  filename: string,
  policy: Required<ResearchMemoryPolicy>,
  context?: ChannelProjectBindingContext
): string {
  return path.join(resolveBaseDir(policy, "memory", context), filename);
}

function researchPath(
  filename: string,
  policy: Required<ResearchMemoryPolicy>,
  context?: ChannelProjectBindingContext
): string {
  return path.join(resolveBaseDir(policy, "researcher", context), filename);
}

export function getResolvedResearchMemoryPaths(
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
) {
  const normalized = normalizePolicy(policy);
  const resolvedProject = resolveProjectContext({
    policy: normalized,
    context,
  });
  const projectRoot = resolvedProject.projectRoot;
  const workspaceRoot = getWorkspaceRoot();
  const projectIsolationSatisfied = !normalized.requireProjectIsolation
    ? true
    : Boolean(projectRoot);
  const usingWorkspaceFallback = !projectRoot && normalized.allowWorkspaceFallback;
  const memoryDir = projectRoot
    ? path.join(projectRoot, "memory")
    : usingWorkspaceFallback
      ? path.join(workspaceRoot, "memory")
      : null;
  const researcherDir = projectRoot
    ? path.join(projectRoot, "researcher")
    : usingWorkspaceFallback
      ? path.join(workspaceRoot, "research")
      : null;

  return {
    policy: normalized,
    mode: projectRoot ? "project" : usingWorkspaceFallback ? "workspace" : "unresolved",
    projectIsolationSatisfied,
    usingWorkspaceFallback,
    workspaceRoot,
    projectRoot,
    projectResolutionSource: resolvedProject.source,
    channelProjectBindingsEnabled: normalized.enableChannelProjectBindings,
    channelProjectBindingKey: resolvedProject.channelKey,
    channelProjectBindingsPath: resolvedProject.storePath,
    inferredProjectId: inferProjectId(projectRoot),
    ideationMemoryPath: memoryDir
      ? path.join(memoryDir, "ideation-memory.md")
      : null,
    experimentMemoryPath: memoryDir
      ? path.join(memoryDir, "experiment-memory.md")
      : null,
    reviewStatePath: researcherDir
      ? path.join(researcherDir, "REVIEW_STATE.json")
      : null,
  };
}

async function readFileSafe(filepath: string): Promise<string> {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch {
    return "";
  }
}

async function writeFileEnsured(filepath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, content, "utf-8");
}

async function appendToFile(filepath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.appendFile(filepath, content, "utf-8");
}

function uniqueStrings(items: string[] | undefined): string[] {
  if (!items || items.length === 0) return [];
  return Array.from(
    new Set(
      items
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatBulletList(items: string[] | undefined, indent = "  "): string {
  const normalized = uniqueStrings(items);
  if (normalized.length === 0) return `${indent}- —`;
  return normalized.map((item) => `${indent}- ${item}`).join("\n");
}

function formatKeyValueList(
  values: Record<string, string | number> | undefined
): string {
  if (!values || Object.keys(values).length === 0) return "  - —";
  return Object.entries(values)
    .map(([key, value]) => `  - ${key}: ${value}`)
    .join("\n");
}

function formatCommonFields(entry: CommonEntryFields): string {
  const lines: string[] = [];
  if (entry.projectId) lines.push(`- **Project ID**: ${entry.projectId}`);
  if (entry.trackId) lines.push(`- **Track ID**: ${entry.trackId}`);
  if (entry.sourceStage) lines.push(`- **Source stage**: ${entry.sourceStage}`);
  if (entry.signature) lines.push(`- **Signature**: ${entry.signature}`);
  if (entry.confidence !== undefined) {
    lines.push(`- **Confidence**: ${entry.confidence}`);
  }
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`- **Tags**: ${entry.tags.join(", ")}`);
  }
  if (entry.evidencePointers && entry.evidencePointers.length > 0) {
    lines.push(`- **Evidence pointers**:\n${formatBulletList(entry.evidencePointers)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function buildSignature(defaultParts: string[], explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  return defaultParts.map((part) => part.trim()).filter(Boolean).join("::");
}

function validateConfidence(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
}

function finalizeCommonFields<T extends CommonEntryFields>(
  entry: T,
  policy: Required<ResearchMemoryPolicy>,
  signatureParts: string[],
  context?: ChannelProjectBindingContext
): T {
  const projectRoot = getProjectRoot(context, policy);
  const projectId = entry.projectId ?? inferProjectId(projectRoot);
  const evidencePointers = uniqueStrings(entry.evidencePointers);
  const tags = uniqueStrings(entry.tags);
  const finalized = {
    ...entry,
    projectId,
    evidencePointers,
    tags,
    signature: buildSignature(signatureParts, entry.signature),
  };

  validateConfidence(finalized.confidence, "confidence");

  if (policy.requireProjectIdInEntries && !finalized.projectId) {
    throw new Error("projectId is required for research memory entries.");
  }

  if (policy.requireTrackId && !finalized.trackId) {
    throw new Error("trackId is required for research memory entries.");
  }

  if (policy.requireEvidencePointers && finalized.evidencePointers.length === 0) {
    throw new Error(
      "evidencePointers are required for research memory entries."
    );
  }

  return finalized;
}

function ensureNoDuplicateSignature(existing: string, signature: string): void {
  if (!signature) return;
  if (existing.includes(`**Signature**: ${signature}`)) {
    throw new Error(`A memory entry with signature "${signature}" already exists.`);
  }
}

function insertAfterSection(
  existing: string,
  section: string,
  block: string
): string {
  if (existing.includes(section)) {
    return existing.replace(section, `${section}\n${block}`);
  }
  const prefix = existing.trimEnd();
  return `${prefix}\n\n${section}\n${block}`;
}

function updateComputeBudgetLog(content: string, row: string): string {
  const placeholder = "| *(add entries)* | | | | |\n";
  if (content.includes(placeholder)) {
    return content.replace(placeholder, `${row}${placeholder}`);
  }

  const header =
    "| Project | Experiment | GPU Type | Hours | Date |\n|---------|-----------|----------|-------|------|\n";
  if (content.includes(header)) {
    return content.replace(header, `${header}${row}`);
  }

  return `${content.trimEnd()}\n\n## Compute Budget Log\n\n| Project | Experiment | GPU Type | Hours | Date |\n|---------|-----------|----------|-------|------|\n${row}`;
}

export async function recordIdeaEntry(
  entry: IdeaEntry,
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<string> {
  const normalized = normalizePolicy(policy);
  ensureProjectScope(normalized, context);

  const finalized = finalizeCommonFields(entry, normalized, [
    entry.projectId ?? inferProjectId(getProjectRoot(context, normalized)) ?? "",
    entry.trackId ?? "",
    entry.title,
    entry.outcome,
  ], context);

  const date = new Date().toISOString().split("T")[0];
  const statusLabel = finalized.outcome === "abandoned" ? " (ABANDONED)" : "";
  const common = formatCommonFields(finalized);

  const block =
    finalized.outcome === "success"
      ? `### ${finalized.title} — ${date}
${common}- **Domain**: ${finalized.domain}
- **Core hypothesis**: ${finalized.hypothesis}
- **Closest prior work**: ${finalized.closestPriorWork ?? "—"}
- **Why novel**: ${finalized.whyNovel ?? "—"}
- **Pilot result**: ${finalized.pilotResult ?? "—"}
- **Generalizable pattern**: ${finalized.generalizablePattern ?? "—"}
`
      : `### ${finalized.title} — ${date}${statusLabel}
${common}- **Domain**: ${finalized.domain}
- **Hypothesis**: ${finalized.hypothesis}
- **Failure bucket**: ${finalized.failureBucket ?? "—"}
- **Failure mode**: ${finalized.failureMode ?? "—"}
- **Do not retry unless**: ${finalized.retryCondition ?? "—"}
`;

  const section =
    finalized.outcome === "success"
      ? "## Successful Idea Patterns"
      : "## Failed Idea Catalog";

  const filepath = memoryPath("ideation-memory.md", normalized, context);
  const existing = await readFileSafe(filepath);
  ensureNoDuplicateSignature(existing, finalized.signature ?? "");
  await writeFileEnsured(filepath, insertAfterSection(existing, section, block));

  return `Ideation memory updated: ${finalized.title} (${finalized.outcome})`;
}

export async function recordExperimentEntry(
  entry: ExperimentEntry,
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<string> {
  const normalized = normalizePolicy(policy);
  ensureProjectScope(normalized, context);

  const finalized = finalizeCommonFields(entry, normalized, [
    entry.projectId ?? inferProjectId(getProjectRoot(context, normalized)) ?? "",
    entry.trackId ?? "",
    entry.name,
    "success",
  ], context);

  const date = new Date().toISOString().split("T")[0];
  const common = formatCommonFields(finalized);
  const block = `### ${finalized.name} — ${date}
${common}- **Task**: ${finalized.taskType}
- **Dataset**: ${finalized.dataset}
- **Model**: ${finalized.model ?? "—"}
- **Key hyperparameters**:
${formatKeyValueList(finalized.hyperparams)}
- **Result**: ${finalized.result}
- **Training time**: ~${finalized.trainingTimeHours}h on ${finalized.gpuType}
- **Reuse condition**: ${finalized.reuseCondition}
`;

  const filepath = memoryPath("experiment-memory.md", normalized, context);
  const existing = await readFileSafe(filepath);
  ensureNoDuplicateSignature(existing, finalized.signature ?? "");

  const withStrategy = insertAfterSection(
    existing,
    "## Proven Experiment Strategies",
    block
  );

  const budgetRow = `| ${finalized.projectId ?? "—"} | ${finalized.name} | ${finalized.gpuType} | ${finalized.trainingTimeHours} | ${date} |\n`;
  await writeFileEnsured(filepath, updateComputeBudgetLog(withStrategy, budgetRow));

  return `Experiment memory updated: ${finalized.name}`;
}

export async function recordFailedExperimentEntry(
  entry: FailedExperimentEntry,
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<string> {
  const normalized = normalizePolicy(policy);
  ensureProjectScope(normalized, context);

  const finalized = finalizeCommonFields(entry, normalized, [
    entry.projectId ?? inferProjectId(getProjectRoot(context, normalized)) ?? "",
    entry.trackId ?? "",
    entry.name,
    "failure",
  ], context);

  const date = new Date().toISOString().split("T")[0];
  const common = formatCommonFields(finalized);
  const block = `### ${finalized.name} — ${date} (FAILED)
${common}- **Task**: ${finalized.taskType}
- **Dataset**: ${finalized.dataset}
- **Model**: ${finalized.model ?? "—"}
- **Key hyperparameters**:
${formatKeyValueList(finalized.hyperparams)}
- **Result summary**: ${finalized.resultSummary ?? "—"}
- **Failure bucket**: ${finalized.failureBucket ?? "—"}
- **Failure mode**: ${finalized.failureMode}
- **Do not retry unless**: ${finalized.retryCondition ?? "—"}
- **Training time**: ${
    finalized.trainingTimeHours !== undefined && finalized.gpuType
      ? `~${finalized.trainingTimeHours}h on ${finalized.gpuType}`
      : "—"
  }
`;

  const filepath = memoryPath("experiment-memory.md", normalized, context);
  const existing = await readFileSafe(filepath);
  ensureNoDuplicateSignature(existing, finalized.signature ?? "");

  let updated = insertAfterSection(
    existing,
    "## Failed Experiment Catalog",
    block
  );

  if (finalized.trainingTimeHours !== undefined && finalized.gpuType) {
    const budgetRow = `| ${finalized.projectId ?? "—"} | ${finalized.name} | ${finalized.gpuType} | ${finalized.trainingTimeHours} | ${date} |\n`;
    updated = updateComputeBudgetLog(updated, budgetRow);
  }

  await writeFileEnsured(filepath, updated);
  return `Failed experiment memory updated: ${finalized.name}`;
}

export async function getReviewState(
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<ReviewState | null> {
  const normalized = normalizePolicy(policy);
  const filepath = researchPath("REVIEW_STATE.json", normalized, context);
  const content = await readFileSafe(filepath);
  if (!content) return null;
  try {
    return JSON.parse(content) as ReviewState;
  } catch {
    return null;
  }
}

export async function setReviewState(
  state: ReviewState,
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<string> {
  const normalized = normalizePolicy(policy);
  ensureProjectScope(normalized, context);

  const filepath = researchPath("REVIEW_STATE.json", normalized, context);
  await writeFileEnsured(filepath, `${JSON.stringify(state, null, 2)}\n`);
  return `Review state saved: round=${state.round}, status=${state.status}, score=${state.lastScore}`;
}

export async function checkReviewResumability(
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<{
  action: "resume" | "restart" | "none";
  state: ReviewState | null;
  reason: string;
}> {
  const normalized = normalizePolicy(policy);
  const state = await getReviewState(normalized, context);

  if (!state) {
    return { action: "none", state: null, reason: "No review state found." };
  }

  if (state.status === "completed") {
    return {
      action: "none",
      state,
      reason: `Review completed at round ${state.round} (score: ${state.lastScore}).`,
    };
  }

  const stateAgeMs = Date.now() - new Date(state.timestamp).getTime();
  const maxAgeMs = normalized.reviewStateMaxAgeHours * 60 * 60 * 1000;

  if (stateAgeMs > maxAgeMs) {
    return {
      action: "restart",
      state,
      reason: `Review state expired (last updated ${Math.floor(
        stateAgeMs / 3600000
      )}h ago). Restarting.`,
    };
  }

  return {
    action: "resume",
    state,
    reason: `Resuming review loop from round ${state.round + 1} (last score: ${state.lastScore}/10, verdict: ${state.lastVerdict}).`,
  };
}

export async function appendDailyLog(
  params: {
    phase: string;
    whatWasDone: string[];
    keyDecisions: string[];
    results?: string[];
    nextSteps: string[];
  },
  policy: ResearchMemoryPolicy = {},
  context?: ChannelProjectBindingContext
): Promise<string> {
  const normalized = normalizePolicy(policy);
  ensureProjectScope(normalized, context);

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().slice(0, 5);

  const formatList = (items: string[]) =>
    uniqueStrings(items)
      .map((item) => `- ${item}`)
      .join("\n");

  const block = `
## ${timeStr} — Session Summary
**Phase**: ${params.phase}
**What was done**:
${formatList(params.whatWasDone)}
**Key decisions**:
${formatList(params.keyDecisions)}
${
  params.results && params.results.length > 0
    ? `**Results**:\n${formatList(params.results)}\n`
    : ""
}**Next steps**:
${formatList(params.nextSteps)}
`;

  const filepath = memoryPath(`${dateStr}.md`, normalized, context);
  const existing = await readFileSafe(filepath);
  if (!existing) {
    await writeFileEnsured(filepath, `# Research Log — ${dateStr}\n${block}`);
  } else {
    await appendToFile(filepath, block);
  }

  return `Daily log appended: ${filepath}`;
}

// ============================================================================
// Business Configuration Export Functions
// ============================================================================

/**
 * Get the complete business configuration from the policy
 * 
 * @param policy - Research memory policy
 * @returns Complete normalized business configuration
 */
export function getBusinessConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return {
    projectsRoot: normalized.projectsRoot,
    servers: normalized.servers,
    ideaGeneration: normalized.ideaGeneration,
    trackPortfolio: normalized.trackPortfolio,
    computeBudget: normalized.computeBudget,
    reviewLoop: normalized.reviewLoop,
    graphConfig: normalized.graphConfig,
  };
}

/**
 * Get idea generation configuration
 * 
 * @param policy - Research memory policy
 * @returns Idea generation parameters
 */
export function getIdeaGenerationConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.ideaGeneration;
}

/**
 * Get track portfolio configuration
 * 
 * @param policy - Research memory policy
 * @returns Track portfolio parameters
 */
export function getTrackPortfolioConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.trackPortfolio;
}

/**
 * Get compute budget configuration
 * 
 * @param policy - Research memory policy
 * @returns Compute budget parameters
 */
export function getComputeBudgetConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.computeBudget;
}

/**
 * Get review loop configuration
 * 
 * @param policy - Research memory policy
 * @returns Review loop parameters
 */
export function getReviewLoopConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.reviewLoop;
}

/**
 * Get graph configuration
 * 
 * @param policy - Research memory policy
 * @returns Graph configuration parameters
 */
export function getGraphConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.graphConfig;
}

/**
 * Get server configuration
 * 
 * @param policy - Research memory policy
 * @returns Server configuration
 */
export function getServersConfig(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.servers;
}

/**
 * Get projects root directory
 * 
 * @param policy - Research memory policy
 * @returns Projects root path
 */
export function getProjectsRoot(policy: ResearchMemoryPolicy = {}) {
  const normalized = normalizePolicy(policy);
  return normalized.projectsRoot;
}
