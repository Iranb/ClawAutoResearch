import {
  appendDailyLog,
  checkReviewResumability,
  getResolvedResearchMemoryPaths,
  getReviewState,
  recordExperimentEntry,
  recordFailedExperimentEntry,
  recordIdeaEntry,
  setReviewState,
} from "./research-memory";
import {
  requireObject,
  textResponse,
  type PluginRegistrationContext,
} from "./plugin-registration-shared";

export function registerMemoryTools(plugin: PluginRegistrationContext) {
  plugin.api.registerTool(
    (ctx) => ({
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
        const policy = plugin.getMemoryPolicy();
        const action = String(params.action ?? "");
        const toolCtx = {
          workspaceDir: ctx.workspaceDir,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          messageChannel: ctx.messageChannel,
        };

        switch (action) {
          case "get_paths": {
            const paths = getResolvedResearchMemoryPaths(policy, toolCtx);
            return textResponse(JSON.stringify(paths, null, 2));
          }
          case "record_idea_entry": {
            const result = await recordIdeaEntry(
              requireObject(params.ideaEntry, "ideaEntry"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "record_experiment_entry": {
            const result = await recordExperimentEntry(
              requireObject(params.experimentEntry, "experimentEntry"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "record_failed_experiment_entry": {
            const result = await recordFailedExperimentEntry(
              requireObject(
                params.failedExperimentEntry,
                "failedExperimentEntry"
              ),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "append_daily_log": {
            const result = await appendDailyLog(
              requireObject(params.dailyLog, "dailyLog"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "get_review_state": {
            const state = await getReviewState(policy, toolCtx);
            return textResponse(JSON.stringify(state, null, 2));
          }
          case "set_review_state": {
            const result = await setReviewState(
              requireObject(params.reviewState, "reviewState"),
              policy,
              toolCtx
            );
            return textResponse(result);
          }
          case "check_review_resumability": {
            const result = await checkReviewResumability(policy, toolCtx);
            return textResponse(JSON.stringify(result, null, 2));
          }
          default:
            throw new Error(`Unsupported research_memory action: ${action}`);
        }
      },
    }),
    { optional: true }
  );
}
