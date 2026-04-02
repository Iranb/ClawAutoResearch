/**
 * Workflow commands module - re-exports all public APIs.
 *
 * This module organizes the workflow command code into smaller, focused files:
 * - types.ts: Type definitions and constants
 * - parsers.ts: Discord/Telegram peer parsing utilities
 * - formatters.ts: Status output formatters
 *
 * The main handlers remain in the parent workflow-commands.ts for now
 * to minimize refactoring risk. They import from these submodules.
 */

// Type exports
export type {
  WorkflowBackgroundCommandKind,
  WorkflowCommandKind,
  WorkflowCommandDependencies,
  WorkflowCommandApi,
  RoutePeer,
  ResolvedWorkflowCommandTarget,
  WorkflowSnapshot,
  WorkflowAutoIteratorResult,
  WorkflowGateReviewStore,
  WorkflowCodeReviewStore,
  WorkflowAutoDiscussionStore,
  ExistingWorkflowProjectSelection,
} from "./types.js";

export { COMMAND_LABELS } from "./types.js";

// Parser exports
export {
  readString,
  stripDiscordPrefix,
  parseDiscordPeer,
  stripTelegramInternalPrefixes,
  parseTelegramTarget,
  resolveBindingConversationFromCommandContext,
  resolveRoutePeerFromCommandContext,
  extractAgentIdFromSessionKey,
  extractQuotedSegment,
  formatWorkflowCommandArgument,
} from "./parsers.js";

// Formatter exports
export {
  compactStatusText,
  joinStatusList,
  formatAutoModeSection,
  formatAutoDiscussionSection,
  formatGateReviewSection,
  formatCodeReviewSection,
  formatWorkflowStatusText,
  formatResearchProgramOnboardingGapLabels,
} from "./formatters.js";
