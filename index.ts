/**
 * OpenClaw Research Plugin
 * 
 * Multi-agent research workflow plugin with:
 * - Structured research memory tool
 * - Project-isolated state management
 * - Graph-grounded ideation support
 * 
 * @see https://docs.openclaw.ai/tools
 */

import {
  appendDailyLog,
  checkReviewResumability,
  getBusinessConfig,
  getComputeBudgetConfig,
  getGraphConfig,
  getIdeaGenerationConfig,
  getProjectsRoot,
  getResolvedResearchMemoryPaths,
  getReviewLoopConfig,
  getReviewState,
  getServersConfig,
  getTrackPortfolioConfig,
  recordExperimentEntry,
  recordFailedExperimentEntry,
  recordIdeaEntry,
  setReviewState,
} from "./tools/research-memory";

// ============================================================================
// Plugin Metadata
// ============================================================================

/**
 * Plugin identifier - must match openclaw.plugin.json id
 */
export const pluginId = "openclaw-research";

/**
 * Plugin version - must match package.json version
 */
export const pluginVersion = "1.0.0";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Plugin API interface for registering tools
 * 
 * @see https://docs.openclaw.ai/tools#tools-skills-and-plugins
 */
export type PluginAPI = {
  /** Plugin configuration from openclaw.json */
  config?: Record<string, unknown>;
  
  /**
   * Register a new tool with the plugin system
   * 
   * @param spec - Tool specification
   * @param spec.name - Tool name (must match SKILL.md)
   * @param spec.description - Tool description for the model
   * @param spec.parameters - JSON Schema for tool parameters
   * @param spec.execute - Tool execution function
   */
  registerTool: (
    spec: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (_id: string, params: Record<string, unknown>) => Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>;
    }
  ) => void;
  
  /**
   * Register additional capabilities (optional)
   * - registerChannel: for notifications
   * - registerModelProvider: for custom model endpoints
   * - registerSkill: for additional skill definitions
   */
  registerChannel?: (spec: unknown) => void;
  registerModelProvider?: (spec: unknown) => void;
  registerSkill?: (spec: unknown) => void;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a text response for tool execution
 * 
 * @param text - Response text
 * @returns Formatted response object
 */
function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Extract policy configuration from plugin config
 * 
 * @param config - Plugin configuration
 * @returns Normalized policy object with all business parameters
 * 
 * @see openclaw.plugin.json for config schema
 */
function getPolicy(config: Record<string, unknown> | undefined) {
  const servers = (config?.servers ?? {}) as Record<string, unknown>;
  const ideaGeneration = (config?.ideaGeneration ?? {}) as Record<
    string,
    unknown
  >;
  const trackPortfolio = (config?.trackPortfolio ?? {}) as Record<
    string,
    unknown
  >;
  const computeBudget = (config?.computeBudget ?? {}) as Record<
    string,
    unknown
  >;
  const reviewLoop = (config?.reviewLoop ?? {}) as Record<string, unknown>;
  const graphConfig = (config?.graphConfig ?? {}) as Record<string, unknown>;

  return {
    // Data integrity policies
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    requireProjectIdInEntries: config?.requireProjectIdInEntries !== false,
    requireTrackId: config?.requireTrackId !== false,
    requireEvidencePointers: config?.requireEvidencePointers !== false,
    reviewStateMaxAgeHours:
      typeof config?.reviewStateMaxAgeHours === "number"
        ? config.reviewStateMaxAgeHours
        : 24,

    // Project and server configuration
    projectsRoot:
      typeof config?.projectsRoot === "string"
        ? config.projectsRoot
        : "~/.openclaw/projects",
    servers: {
      default: typeof servers.default === "string" ? servers.default : "gateway",
      list: Array.isArray(servers.list) ? (servers.list as string[]) : [],
    },

    // Idea generation configuration
    ideaGeneration: {
      divergeSize:
        typeof ideaGeneration.divergeSize === "number"
          ? ideaGeneration.divergeSize
          : 8,
      portfolioSize:
        typeof ideaGeneration.portfolioSize === "number"
          ? ideaGeneration.portfolioSize
          : 4,
      tournamentRounds:
        typeof ideaGeneration.tournamentRounds === "number"
          ? ideaGeneration.tournamentRounds
          : 2,
    },

    // Track portfolio configuration
    trackPortfolio: {
      maxActiveTracks:
        typeof trackPortfolio.maxActiveTracks === "number"
          ? trackPortfolio.maxActiveTracks
          : 2,
      maxParkedTracks:
        typeof trackPortfolio.maxParkedTracks === "number"
          ? trackPortfolio.maxParkedTracks
          : 1,
      parkedBudgetPolicy:
        typeof trackPortfolio.parkedBudgetPolicy === "string"
          ? (trackPortfolio.parkedBudgetPolicy as "zero" | "reduced" | "full")
          : "zero",
    },

    // Compute budget configuration
    computeBudget: {
      defaultGpuHoursPerTrack:
        typeof computeBudget.defaultGpuHoursPerTrack === "number"
          ? computeBudget.defaultGpuHoursPerTrack
          : 100,
      maxConcurrentExperiments:
        typeof computeBudget.maxConcurrentExperiments === "number"
          ? computeBudget.maxConcurrentExperiments
          : 4,
      gpuType:
        typeof computeBudget.gpuType === "string"
          ? (computeBudget.gpuType as
              | "V100"
              | "A100"
              | "H100"
              | "RTX6000"
              | "mixed")
          : "A100",
    },

    // Review loop configuration
    reviewLoop: {
      maxRounds:
        typeof reviewLoop.maxRounds === "number" ? reviewLoop.maxRounds : 3,
      scoreThreshold:
        typeof reviewLoop.scoreThreshold === "number"
          ? reviewLoop.scoreThreshold
          : 6.0,
      autoAdvanceScore:
        typeof reviewLoop.autoAdvanceScore === "number"
          ? reviewLoop.autoAdvanceScore
          : 7.5,
    },

    // Graph configuration
    graphConfig: {
      autoRefreshTrigger:
        typeof graphConfig.autoRefreshTrigger === "string"
          ? (graphConfig.autoRefreshTrigger as
              | "never"
              | "weekly"
              | "monthly"
              | "per-track")
          : "per-track",
      noveltyThreshold:
        typeof graphConfig.noveltyThreshold === "number"
          ? graphConfig.noveltyThreshold
          : 0.7,
      maxPapersToIngest:
        typeof graphConfig.maxPapersToIngest === "number"
          ? graphConfig.maxPapersToIngest
          : 5000,
    },
  };
}

/**
 * Type-safe object validation
 * 
 * @param value - Value to validate
 * @param label - Parameter name for error message
 * @returns Typed object
 * @throws Error if value is not an object
 */
function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required for this action.`);
  }
  return value as T;
}

// ============================================================================
// Plugin Registration
// ============================================================================

/**
 * Main plugin entry point
 * 
 * Registers the research_memory tool for structured, project-isolated
 * research memory management.
 * 
 * @param api - Plugin API for tool registration
 * 
 * @see https://docs.openclaw.ai/tools#plugin-provided-tools
 */
export default function registerOpenClawResearchPlugin(api: PluginAPI) {
  // Register the main research memory tool
  api.registerTool({
    name: "research_memory",
    description:
      "Structured, project-isolated research memory tool. Use it instead of editing ideation-memory.md, experiment-memory.md, daily logs, or REVIEW_STATE.json by hand. Supports idea tracking, experiment logging, daily summaries, and review state management.",
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        action: {
          type: "string",
          enum: [
            "get_paths",
            "record_idea_entry",
            "record_experiment_entry",
            "record_failed_experiment_entry",
            "append_daily_log",
            "get_review_state",
            "set_review_state",
            "check_review_resumability",
          ],
          description: "The memory operation to perform",
        },
        ideaEntry: {
          type: "object",
          additionalProperties: true,
          description: "Idea entry fields for record_idea_entry action",
        },
        experimentEntry: {
          type: "object",
          additionalProperties: true,
          description: "Experiment entry fields for record_experiment_entry action",
        },
        failedExperimentEntry: {
          type: "object",
          additionalProperties: true,
          description: "Failed experiment entry for record_failed_experiment_entry action",
        },
        reviewState: {
          type: "object",
          additionalProperties: true,
          description: "Review state object for set_review_state action",
        },
        dailyLog: {
          type: "object",
          additionalProperties: true,
          description: "Daily log fields for append_daily_log action",
        },
      },
      required: ["action"],
    },
    /**
     * Tool execution handler
     * 
     * @param _id - Tool call ID (unused)
     * @param params - Tool parameters
     * @returns Promise resolving to text response
     */
    async execute(_id, params) {
      const policy = getPolicy(api.config);
      const action = String(params.action ?? "");

      switch (action) {
        case "get_paths": {
          const paths = getResolvedResearchMemoryPaths(policy);
          return textResponse(JSON.stringify(paths, null, 2));
        }
        
        case "record_idea_entry": {
          const result = await recordIdeaEntry(
            requireObject(params.ideaEntry, "ideaEntry"),
            policy
          );
          return textResponse(result);
        }
        
        case "record_experiment_entry": {
          const result = await recordExperimentEntry(
            requireObject(params.experimentEntry, "experimentEntry"),
            policy
          );
          return textResponse(result);
        }
        
        case "record_failed_experiment_entry": {
          const result = await recordFailedExperimentEntry(
            requireObject(
              params.failedExperimentEntry,
              "failedExperimentEntry"
            ),
            policy
          );
          return textResponse(result);
        }
        
        case "append_daily_log": {
          const result = await appendDailyLog(
            requireObject(params.dailyLog, "dailyLog"),
            policy
          );
          return textResponse(result);
        }
        
        case "get_review_state": {
          const state = await getReviewState(policy);
          return textResponse(JSON.stringify(state, null, 2));
        }
        
        case "set_review_state": {
          const result = await setReviewState(
            requireObject(params.reviewState, "reviewState"),
            policy
          );
          return textResponse(result);
        }
        
        case "check_review_resumability": {
          const result = await checkReviewResumability(policy);
          return textResponse(JSON.stringify(result, null, 2));
        }
        
        default:
          throw new Error(`Unsupported research_memory action: ${action}. Available actions: get_paths, record_idea_entry, record_experiment_entry, record_failed_experiment_entry, append_daily_log, get_review_state, set_review_state, check_review_resumability`);
      }
    },
  });
  
  // Future extension points:
  // - Register custom channels for notifications (e.g., Discord, Slack)
  // - Register model providers for specialized research models
  // - Register additional tools for paper ingestion, graph operations, etc.
}
