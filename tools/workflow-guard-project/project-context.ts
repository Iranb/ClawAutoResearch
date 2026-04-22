import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { asString } from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import {
  ensureWorkflowProjectRootImpl,
  sanitizeProjectIdFragment,
  deriveProjectIdForBootstrap,
  deriveProjectTitleForBootstrap,
  buildIdleResearchTemplateForBootstrap,
  defaultResearchProgramZoteroProjectPath,
} from "../workflow-guard-project-state";
import { readMailbox } from "../workflow-guard-collaboration";
import { loadExperimentLedgerIfExists } from "../workflow-guard-experiment-history";
import { readWorkflowRuntimeQueueStore } from "../workflow-runtime-state.js";
import {
  resolveProjectContext as resolveChannelProjectContext,
  type ChannelProjectBindingContext,
  type ChannelProjectBindingPolicy,
  type InvalidEnvProjectRootMode,
  type ResolvedProjectContext,
} from "../channel-project-bindings";

export type WorkflowProjectState = {
  projectRoot: string | null;
  projectId: string | null;
  projectResolutionSource: "channel_binding" | "env" | "none";
  channelBindingKey: string | null;
  channelBindingStorePath: string;
  channelBinding: ResolvedProjectContext["binding"];
  manifest: Record<string, unknown> | null;
  trackRegistry: Record<string, unknown> | null;
  mailbox: Awaited<ReturnType<typeof readMailbox>> | null;
  experimentLedger: Awaited<ReturnType<typeof loadExperimentLedgerIfExists>> | null;
  autoIteratorAudit: Record<string, unknown> | null;
  runtimeQueue: Awaited<ReturnType<typeof readWorkflowRuntimeQueueStore>> | null;
};

export type WorkflowProjectContextOptions = ChannelProjectBindingContext & {
  policy?: ChannelProjectBindingPolicy;
  invalidEnvProjectRootMode?: InvalidEnvProjectRootMode;
};

export type WorkflowProjectBootstrapParams = {
  policy?: ChannelProjectBindingPolicy;
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
};

const REQUIRED_WORKFLOW_TEMPLATE_FILES = [
  "PROJECT_MANIFEST.json",
  "TRACK_REGISTRY.json",
  "EXPERIMENT_LEDGER.json",
  "IDLE_RESEARCH.example.json",
  "CLAIM_POLICY.md",
] as const;

async function hasRequiredWorkflowTemplates(templatesRoot: string): Promise<boolean> {
  const checks = await Promise.all(
    REQUIRED_WORKFLOW_TEMPLATE_FILES.map((relativePath) =>
      pathExists(path.join(templatesRoot, relativePath))
    )
  );
  return checks.every(Boolean);
}

async function resolveWorkflowTemplatesRoot(moduleUrl: string): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "templates"),
    path.resolve(moduleDir, "..", "..", "..", "templates"),
  ];
  for (const candidate of candidates) {
    if (await hasRequiredWorkflowTemplates(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Workflow templates are missing or incomplete. Checked: ${candidates.join(", ")}`
  );
}

export async function ensureWorkflowProjectRoot(
  params: WorkflowProjectBootstrapParams
): Promise<Awaited<ReturnType<typeof ensureWorkflowProjectRootImpl>>> {
  const templatesRoot = await resolveWorkflowTemplatesRoot(import.meta.url);
  return await ensureWorkflowProjectRootImpl(params, {
    templatesRoot,
    readJsonIfExists,
    writeJsonEnsured,
    getExperimentLedgerPath: (projectRoot: string) =>
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
  });
}

export {
  sanitizeProjectIdFragment,
  deriveProjectIdForBootstrap,
  deriveProjectTitleForBootstrap,
  buildIdleResearchTemplateForBootstrap,
  defaultResearchProgramZoteroProjectPath,
};

export function resolveWorkflowProjectContext(
  params: {
    policy?: ChannelProjectBindingPolicy;
    context?: ChannelProjectBindingContext;
    invalidEnvProjectRootMode?: InvalidEnvProjectRootMode;
  }
): ResolvedProjectContext {
  return resolveChannelProjectContext(params);
}

export function getWorkflowProjectRoot(
  options?: WorkflowProjectContextOptions
): string | null {
  return resolveWorkflowProjectContext({
    policy: options?.policy,
    context: options,
    invalidEnvProjectRootMode: options?.invalidEnvProjectRootMode,
  }).projectRoot;
}

export function inferWorkflowProjectId(
  projectRoot: string | null,
  manifest: Record<string, unknown> | null
): string | null {
  const manifestId = asString(manifest?.project_id);
  if (manifestId) {
    return manifestId;
  }
  return projectRoot ? path.basename(projectRoot) : null;
}

export async function loadWorkflowProjectState(
  options?: WorkflowProjectContextOptions
): Promise<WorkflowProjectState> {
  const resolvedProject = resolveWorkflowProjectContext({
    policy: options?.policy,
    context: options,
    invalidEnvProjectRootMode: options?.invalidEnvProjectRootMode,
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
      autoIteratorAudit: null,
      runtimeQueue: null,
    };
  }

  const [manifest, trackRegistry, mailbox, experimentLedger, autoIteratorAudit, runtimeQueue] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<Record<string, unknown>>(path.join(projectRoot, "TRACK_REGISTRY.json")),
    readMailbox({
      projectRoot,
      readJsonIfExists,
    }),
    loadExperimentLedgerIfExists({
      projectRoot,
      readJsonIfExists,
    }),
    readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json")
    ),
    readWorkflowRuntimeQueueStore(projectRoot).catch(() => null),
  ]);

  return {
    projectRoot,
    projectId: inferWorkflowProjectId(projectRoot, manifest),
    projectResolutionSource: resolvedProject.source,
    channelBindingKey: resolvedProject.channelKey,
    channelBindingStorePath: resolvedProject.storePath,
    channelBinding: resolvedProject.binding,
    manifest,
    trackRegistry,
    mailbox,
    experimentLedger,
    autoIteratorAudit,
    runtimeQueue,
  };
}
