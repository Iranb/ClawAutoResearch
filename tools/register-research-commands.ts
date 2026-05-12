import { registerResearchWorkflowCommands } from "./workflow-commands";
import { registerAutoresearchDiscordPanel } from "./discord-panel-manager";
import type { PluginRegistrationContext } from "./plugin-registration-shared";

export function registerResearchCommands(plugin: PluginRegistrationContext) {
  if (typeof plugin.api.registerCommand !== "function") {
    return;
  }
  registerResearchWorkflowCommands(
    plugin.api as unknown as Parameters<typeof registerResearchWorkflowCommands>[0]
  );
  registerAutoresearchDiscordPanel(plugin);
}
