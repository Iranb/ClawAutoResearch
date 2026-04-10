import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { asString } from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
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

export async function ensureWorkflowProjectRoot(
  params: WorkflowProjectBootstrapParams
): Promise<Awaited<ReturnType<typeof ensureWorkflowProjectRootImpl>>> {
  return await ensureWorkflowProjectRootImpl(params, {
    templatesRoot: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "templates"
    ),
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
    };
  }

  const [manifest, trackRegistry, mailbox, experimentLedger, autoIteratorAudit] = await Promise.all([
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
  };
}
