/**
 * Type definitions for workflow commands.
 */

import type {
  OpenClawPluginApi,
} from "../../runtime-api.js";
import type { PluginCommandContext } from "../../runtime-api.js";
import type {
  ConversationRef,
  SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import type {
  buildWorkflowSnapshot,
  bindChannelProjectForWorkflow,
  runWorkflowAutoIterator,
  setGraphGuidedWritingState,
  setResearchProgramState,
  setWritingContractState,
  unbindChannelProjectForWorkflow,
} from "../workflow-guard.js";
import type {
  startBackgroundWorkflowRun,
} from "../workflow-fast-paths.js";
import type { runIdeaCatalystResearch30 } from "../research30/bridge.ts";
import type { runCitationCalibration } from "../research-writing/citation-calibration.ts";
import type { stagePapernexusRemoteSources } from "../papernexus-remote-stage.ts";
import type { reconcileAuthoringCloseout } from "../authoring-closeout-reconcile.ts";
import type { captureWorkflowDiagnosticBundle } from "../workflow-diagnostic-bundle.ts";
import type { buildHandoffDashboard } from "../workflow-handoff/dashboard.ts";
import type {
  readGateReviewStore,
} from "../workflow-auto-gate.js";
import type {
  readCodeReviewStore,
} from "../workflow-code-review.js";
import type {
  readAutoModeDiscussionStore,
} from "../workflow-auto-discussion.js";

export type WorkflowBackgroundCommandKind =
  | "research_pipeline"
  | "research_queue"
  | "resume_pipeline"
  | "graph_build"
  | "zotero_sync"
  | "literature_review"
  | "survey_review";

export type WorkflowCommandKind =
  | WorkflowBackgroundCommandKind
  | "project_init"
  | "auto_research"
  | "auto_review"
  | "clear_project_binding"
  | "workflow_status"
  | "handoff_status"
  | "show_commands"
  | "survey_graph_build"
  | "idea_catalyst_search"
  | "citation_calibrate"
  | "papernexus_stage_remote"
  | "authoring_closeout"
  | "capture_diagnostics";

export type WorkflowCommandDependencies = {
  resolveConversationBindingRecord: (
    conversation: ConversationRef
  ) => SessionBindingRecord | null;
  buildWorkflowSnapshot: typeof buildWorkflowSnapshot;
  runWorkflowAutoIterator: typeof runWorkflowAutoIterator;
  startBackgroundWorkflowRun: typeof startBackgroundWorkflowRun;
  bindChannelProjectForWorkflow: typeof bindChannelProjectForWorkflow;
  setResearchProgramState: typeof setResearchProgramState;
  setWritingContractState: typeof setWritingContractState;
  setGraphGuidedWritingState: typeof setGraphGuidedWritingState;
  unbindChannelProjectForWorkflow: typeof unbindChannelProjectForWorkflow;
  runIdeaCatalystResearch30: typeof runIdeaCatalystResearch30;
  runCitationCalibration: typeof runCitationCalibration;
  stagePapernexusRemoteSources: typeof stagePapernexusRemoteSources;
  reconcileAuthoringCloseout: typeof reconcileAuthoringCloseout;
  captureWorkflowDiagnosticBundle: typeof captureWorkflowDiagnosticBundle;
  buildHandoffDashboard: typeof buildHandoffDashboard;
};

export type WorkflowCommandApi = Pick<
  OpenClawPluginApi,
  "config" | "pluginConfig" | "runtime" | "logger" | "registerCommand"
>;

export type WorkflowCommandContext = Pick<
  PluginCommandContext,
  "channel" | "from" | "to" | "accountId" | "messageThreadId" | "config"
> & {
  sessionKey?: string | null;
  commandTargetSessionKey?: string | null;
  commandAuthorized?: boolean | null;
  commandSource?: string | null;
  originatingChannel?: string | null;
  originatingTo?: string | null;
  conversationId?: string | null;
  channelKey?: string | null;
  threadId?: string | number | null;
};

export type RoutePeer = {
  kind: "direct" | "group" | "channel";
  id: string;
};

export type ResolvedWorkflowCommandTarget = {
  sessionKey: string | null;
  agentId: string | null;
  workspaceDir: string | null;
  bindingConversation: ConversationRef | null;
  bindingChannelKey: string | null;
};

export type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;
export type WorkflowAutoIteratorResult = Awaited<ReturnType<typeof runWorkflowAutoIterator>>;
export type WorkflowGateReviewStore = Awaited<ReturnType<typeof readGateReviewStore>>;
export type WorkflowCodeReviewStore = Awaited<ReturnType<typeof readCodeReviewStore>>;
export type WorkflowAutoDiscussionStore = Awaited<ReturnType<typeof readAutoModeDiscussionStore>>;

export type ExistingWorkflowProjectSelection = {
  projectId: string;
  projectRoot: string;
};

export const COMMAND_LABELS: Record<WorkflowCommandKind, string> = {
  research_pipeline: "/research-pipeline",
  research_queue: "/research-queue",
  resume_pipeline: "/resume-pipeline",
  graph_build: "/graph-build",
  zotero_sync: "/zotero-sync",
  literature_review: "/literature-review",
  survey_review: "/survey-pipeline",
  project_init: "/project-init",
  auto_research: "/auto-research",
  auto_review: "/auto-review",
  clear_project_binding: "/clear-project-binding",
  workflow_status: "/workflow-status",
  handoff_status: "/handoff-status",
  show_commands: "/show-commands",
  survey_graph_build: "/survey-graph-build",
  idea_catalyst_search: "/idea-catalyst-search",
  citation_calibrate: "/citation-calibrate",
  papernexus_stage_remote: "/papernexus-stage-remote",
  authoring_closeout: "/authoring-closeout",
  capture_diagnostics: "/capture-diagnostics",
};
