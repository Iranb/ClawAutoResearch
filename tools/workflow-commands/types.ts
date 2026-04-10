/**
 * Type definitions for workflow commands.
 */

import type {
  OpenClawPluginApi,
} from "../../runtime-api.js";
import type {
  ConversationRef,
  SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import type {
  buildWorkflowSnapshot,
  runWorkflowAutoIterator,
} from "../workflow-guard.js";
import type {
  startBackgroundWorkflowRun,
} from "../workflow-fast-paths.js";
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
  | "workflow_status"
  | "show_commands";

export type WorkflowCommandDependencies = {
  resolveConversationBindingRecord: (
    conversation: ConversationRef
  ) => SessionBindingRecord | null;
  buildWorkflowSnapshot: typeof buildWorkflowSnapshot;
  runWorkflowAutoIterator: typeof runWorkflowAutoIterator;
  startBackgroundWorkflowRun: typeof startBackgroundWorkflowRun;
};

export type WorkflowCommandApi = Pick<
  OpenClawPluginApi,
  "config" | "pluginConfig" | "runtime" | "logger" | "registerCommand"
>;

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
  workflow_status: "/workflow-status",
  show_commands: "/show-commands",
};
