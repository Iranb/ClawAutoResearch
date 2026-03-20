import {
  appendDailyLog,
  checkReviewResumability,
  getResolvedResearchMemoryPaths,
  getReviewState,
  recordExperimentEntry,
  recordFailedExperimentEntry,
  recordIdeaEntry,
  setReviewState,
} from "./tools/research-memory.ts";

type ApiLike = {
  config?: Record<string, unknown>;
  registerTool: (
    spec: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (_id: string, params: Record<string, unknown>) => Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>;
    },
    options?: { optional?: boolean }
  ) => void;
};

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function getPolicy(config: Record<string, unknown> | undefined) {
  return {
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    requireProjectIdInEntries: config?.requireProjectIdInEntries !== false,
    requireTrackId: config?.requireTrackId !== false,
    requireEvidencePointers: config?.requireEvidencePointers !== false,
    reviewStateMaxAgeHours:
      typeof config?.reviewStateMaxAgeHours === "number"
        ? config.reviewStateMaxAgeHours
        : 24,
  };
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required for this action.`);
  }
  return value as T;
}

export default function registerOpenClawResearchPlugin(api: ApiLike) {
  api.registerTool(
    {
      name: "research_memory",
      description:
        "Structured, project-isolated research memory tool. Use it instead of editing ideation-memory.md, experiment-memory.md, daily logs, or REVIEW_STATE.json by hand.",
      parameters: {
        type: "object",
        additionalProperties: false,
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
          },
          ideaEntry: {
            type: "object",
            additionalProperties: true,
          },
          experimentEntry: {
            type: "object",
            additionalProperties: true,
          },
          failedExperimentEntry: {
            type: "object",
            additionalProperties: true,
          },
          reviewState: {
            type: "object",
            additionalProperties: true,
          },
          dailyLog: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
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
            throw new Error(`Unsupported research_memory action: ${action}`);
        }
      },
    },
    { optional: true }
  );
}
