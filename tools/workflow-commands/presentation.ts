import type {
  OpenClawMessagePresentation,
  OpenClawPresentationButton,
  OpenClawPresentationSelectOption,
} from "../../runtime-api.js";
import type {
  WorkflowAutoIteratorResult,
  WorkflowSnapshot,
} from "./types.js";

function slashCommand(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized.startsWith("/") || normalized.length > 160) {
    return null;
  }
  return normalized;
}

function pushUniqueButton(
  buttons: OpenClawPresentationButton[],
  button: OpenClawPresentationButton
): void {
  if (buttons.some((entry) => entry.value === button.value || entry.label === button.label)) {
    return;
  }
  if (buttons.length < 5) {
    buttons.push(button);
  }
}

function workflowStatusButtons(params: {
  snapshot: WorkflowSnapshot;
  autoIteratorResult: WorkflowAutoIteratorResult | null;
}): OpenClawPresentationButton[] {
  const buttons: OpenClawPresentationButton[] = [];
  const resumeAction = slashCommand(params.snapshot.resumeAction);
  const nextAction = slashCommand(params.snapshot.nextAction);
  const graphRefreshRequired =
    params.snapshot.graphRefreshRequired === true ||
    params.snapshot.currentStage === "graph_build" ||
    params.autoIteratorResult?.stageAfter === "graph_build";

  pushUniqueButton(buttons, {
    label: "Refresh",
    value: "/workflow-status",
    style: "primary",
  });
  if (resumeAction) {
    pushUniqueButton(buttons, {
      label: "Resume",
      value: resumeAction,
      style: "primary",
    });
  }
  if (nextAction && nextAction !== resumeAction && nextAction !== "/workflow-status") {
    pushUniqueButton(buttons, {
      label: "Next",
      value: nextAction,
      style: "secondary",
    });
  }
  if (graphRefreshRequired) {
    pushUniqueButton(buttons, {
      label: "Graph build",
      value: "/graph-build",
      style: "secondary",
    });
  }
  pushUniqueButton(buttons, {
    label: "Handoff",
    value: "/handoff-status",
    style: "secondary",
  });
  pushUniqueButton(buttons, {
    label: "Diagnostics",
    value: "/capture-diagnostics --reason workflow_status_button",
    style: "secondary",
  });

  return buttons;
}

function pushUniqueOption(
  options: OpenClawPresentationSelectOption[],
  option: OpenClawPresentationSelectOption
): void {
  if (options.some((entry) => entry.value === option.value || entry.label === option.label)) {
    return;
  }
  options.push(option);
}

function workflowCommandOptions(params: {
  snapshot: WorkflowSnapshot;
}): OpenClawPresentationSelectOption[] {
  const options: OpenClawPresentationSelectOption[] = [];
  const resumeAction = slashCommand(params.snapshot.resumeAction);

  if (resumeAction) {
    pushUniqueOption(options, {
      label: resumeAction,
      value: resumeAction,
    });
  }
  for (const command of [
    "/graph-build",
    "/literature-review",
    "/zotero-sync",
    "/citation-calibrate",
    "/capture-diagnostics --reason workflow_status_select",
  ]) {
    pushUniqueOption(options, {
      label: command,
      value: command,
    });
  }

  return options.slice(0, 25);
}

export function buildWorkflowStatusPresentation(params: {
  channel: string;
  snapshot: WorkflowSnapshot;
  autoIteratorResult: WorkflowAutoIteratorResult | null;
}): OpenClawMessagePresentation | undefined {
  if (params.channel !== "discord") {
    return undefined;
  }

  const buttons = workflowStatusButtons({
    snapshot: params.snapshot,
    autoIteratorResult: params.autoIteratorResult,
  });
  const options = workflowCommandOptions({
    snapshot: params.snapshot,
  });
  const blocks: OpenClawMessagePresentation["blocks"] = [];

  if (buttons.length > 0) {
    blocks.push({
      type: "buttons",
      buttons,
    });
  }
  if (options.length > 0) {
    blocks.push({
      type: "select",
      placeholder: "Run workflow command...",
      options,
    });
  }

  return blocks.length > 0 ? { blocks } : undefined;
}
