import { buildExperimentReviewGuidance } from "./experiment-review-guidance";
import { buildIdeaCatalystGuidance } from "./idea-catalyst-guidance";
import { buildPapernexusGuidance } from "./papernexus-guidance";
import { buildWritingGuidance } from "./writing-guidance";
import { normalizeWorkflowControlContract } from "../workflow-control-contract.js";
import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
} from "./types";

export function buildDynamicTasksImpl(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): string[] {
  if (!params.role) {
    return [];
  }

  const policy = deps.rolePolicies[params.role];
  const tasks = [...policy.backgroundTasks];
  const experimentMemory = deps.asRecord(params.manifest?.experiment_memory);
  const graphWatch = deps.asRecord(params.manifest?.graph_watch);
  const workflowControl = normalizeWorkflowControlContract(
    params.manifest?.workflow_control
  );
  const nextAction =
    workflowControl?.next_action ?? deps.asString(params.manifest?.next_action);

  if (params.unreadMailbox.length > 0) {
    tasks.unshift("Read workflow mailbox first and acknowledge blocker/handoff items before new work.");
  }
  const papernexusGuidance = buildPapernexusGuidance(params, deps);
  for (const task of papernexusGuidance.prepend) {
    tasks.unshift(task);
  }
  for (const task of papernexusGuidance.append) {
    tasks.push(task);
  }
  const ideaCatalystGuidance = buildIdeaCatalystGuidance(params, deps);
  for (const task of ideaCatalystGuidance.prepend) {
    tasks.unshift(task);
  }
  for (const task of ideaCatalystGuidance.append) {
    tasks.push(task);
  }
  const experimentReviewGuidance = buildExperimentReviewGuidance(params, deps);
  for (const task of experimentReviewGuidance.prepend) {
    tasks.unshift(task);
  }
  for (const task of experimentReviewGuidance.append) {
    tasks.push(task);
  }

  if (
    params.role === "researcher" &&
    params.currentStage === "plan" &&
    params.missingStageSignals.some((signal) => signal.includes("orchestrator"))
  ) {
    tasks.unshift(
      "PLAN handoff is incomplete; wake Orchestrator instead of jumping to CODE."
    );
  }

  if (
    (params.role === "researcher" || params.role === "orchestrator") &&
    params.currentStage === "plan"
  ) {
    tasks.unshift(
      "Treat research_program as the plan-stage source of truth: compare at least two graph-grounded options in research_program.plan_alternatives, then lock the selected option/track plus rationale and decisive graph evidence in research_program.plan_selection."
    );
    tasks.unshift(
      "Mirror the winning option into a runnable task graph: every selected track should carry success signals, baseline/ablation coverage, expected artifacts, and retry/rollback rules before CODE begins."
    );
  }

  if (
    params.role === "researcher" &&
    params.currentStage &&
    ["plan", "code", "experiment", "analyze", "review", "write"].includes(params.currentStage)
  ) {
    tasks.push(
      "While others work, continue coarse paper search, full-text acquisition, and graph-grounded novelty tracking."
    );
  }

  if (params.role === "researcher" && params.idleResearch.enabled && params.idleResearch.topic) {
    if (deps.isIdleResearchDue(params.idleResearch)) {
      tasks.unshift(
        `Idle research topic is due: run /idle-research for "${params.idleResearch.topic}" and stay within ${params.idleResearch.maxPapersPerCycle} papers this round.`
      );
    } else {
      const nextDueAt = deps.computeIdleResearchNextDueAt(params.idleResearch);
      tasks.unshift(
        `Idle research topic is configured for "${params.idleResearch.topic}". Respect cooldown until ${nextDueAt ?? "the next allowed round"} unless a new durable blocker changes the request.`
      );
    }
  }

  if (params.role === "researcher" && params.innovationReflectionDue) {
    tasks.unshift(
      "Experiment-informed innovation reflection is due; run /innovation-reflection before proposing new tracks or locking IDEA_REPORT.md."
    );
  } else if (
    params.role === "researcher" &&
    params.innovationReflection.lastReflectionPath
  ) {
    tasks.push(
      `Reuse the latest experiment-informed reflection at ${params.innovationReflection.lastReflectionPath} when brainstorming the next innovation angle.`
    );
  }

  if (
    params.role === "researcher" &&
    (params.currentStage === "experiment" ||
      experimentMemory?.papernexus_sync_required === true ||
      params.recentExperiments.length > 0)
  ) {
    tasks.unshift(
      "Keep EXPERIMENT_LEDGER.json current after every queue/launch/result/decision milestone, and sync high-value runs into PaperNexus when idle."
    );
  }

  if (params.role === "researcher" && params.currentStage === "experiment") {
    tasks.unshift(
      "Resource-aware experiment rule: inspect server GPU memory/utilization, host RAM, and active screens first; then launch independent bundles in parallel up to safe capacity and queue the remainder."
    );
    tasks.unshift(
      "Scheduling rule: treat same method across multiple datasets, baseline vs proposed, and independent seeds as parallel candidates unless a dependency or memory limit forces serialization."
    );
  }

  if (params.currentStage === "experiment" && params.recentExperiments.length === 0) {
    tasks.unshift(
      "Before planning reruns or fixes, inspect research_workflow.get_experiment_memory so you do not repeat an already tried configuration."
    );
  }

  if (
    params.role === "researcher" &&
    deps.asString(graphWatch?.status) === "unknown" &&
    deps.asString(params.manifest?.paper_source_dir)
  ) {
    tasks.push("If graph watch/status is stale, inspect corpus freshness before the next gate.");
  }

  if (params.role !== "researcher" && nextAction) {
    tasks.push(`Stay aligned with manifest next_action: ${nextAction}`);
  }

  if (params.role === "coder" && params.currentStage === "experiment") {
    tasks.unshift(
      "If the assigned packet includes multiple independent experiment bundles, use the current resource check to launch several in parallel, typically one GPU per bundle unless the packet specifies a different packing policy."
    );
    tasks.unshift(
      "When a launch fails from resource pressure, prefer bounded runtime fixes such as lower batch size, higher grad accumulation, or fewer workers, and record the adjustment instead of silently changing experiment meaning."
    );
  }

  const writingGuidance = buildWritingGuidance(params, deps);
  for (const task of writingGuidance.prepend) {
    tasks.unshift(task);
  }
  for (const task of writingGuidance.append) {
    tasks.push(task);
  }

  return deps.uniqueStrings(tasks);
}
