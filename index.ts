import { definePluginEntry } from "./runtime-api.js";
import {
  createPluginRegistrationContext,
  type ApiLike,
} from "./tools/plugin-registration-shared";
import { registerMemoryTools } from "./tools/register-memory-tools";
import { registerWorkflowTools } from "./tools/register-workflow-tools";
import { registerWorkflowHooks } from "./tools/register-workflow-hooks";
import { registerResearchCommands } from "./tools/register-research-commands";
import { registerWorkflowService } from "./tools/register-workflow-service";

export default definePluginEntry({
  id: "ClawAutoResearch",
  name: "ClawAutoResearch",
  description: "Multi-agent automated research plugin with workflow guardrails.",
  register: registerOpenClawResearchPlugin,
});

export function registerOpenClawResearchPlugin(api: ApiLike) {
  const plugin = createPluginRegistrationContext(api);

  registerMemoryTools(plugin);
  registerWorkflowTools(plugin);
  registerWorkflowHooks(plugin);
  registerResearchCommands(plugin);
  registerWorkflowService(plugin);
}
