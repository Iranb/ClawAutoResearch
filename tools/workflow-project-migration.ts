import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ensureWorkflowProjectRoot } from "./workflow-guard";
import { migrateWorkflowRuntimeState } from "./workflow-runtime-state";
import { evaluateExperimentSearchDecisionForProject } from "./workflow-experiment-decision";
import { ensureSurveyWorkflowIdentity, isSurveyWorkflow } from "./workflow-line-routing.js";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { asRecord, asString } from "./workflow-guard-core/coercion";

type WorkflowMigrationPolicyLike = {
  projectsRoot?: string | null;
  zoteroProjectRoot?: string | null;
  enableChannelProjectBindings?: boolean;
};

export type WorkflowProjectMigrationResult = {
  projectId: string;
  projectRoot: string;
  ensured: boolean;
  surveyIdentityUpdated: boolean;
  runtimeMigrated: boolean;
  createdRuntimeFiles: string[];
  experimentDecisionPersisted: boolean;
  experimentDecision: string | null;
};

export async function discoverWorkflowProjects(params: {
  projectsRoot: string;
}): Promise<string[]> {
  const projectsRoot = path.resolve(params.projectsRoot);
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const roots: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectRoot = path.join(projectsRoot, entry.name);
    try {
      await fs.access(path.join(projectRoot, "PROJECT_MANIFEST.json"));
      roots.push(projectRoot);
    } catch {
      // ignore
    }
  }
  return roots.sort();
}

export async function migrateWorkflowProjectToLatest(params: {
  projectRoot: string;
  policy: WorkflowMigrationPolicyLike;
}): Promise<WorkflowProjectMigrationResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const projectId = asString(manifest.project_id) ?? path.basename(projectRoot);
  const title =
    asString(manifest.title) ??
    asString(asRecord(manifest.research_program)?.goal) ??
    projectId;
  const topic =
    asString(asRecord(manifest.survey_review)?.topic) ??
    asString(asRecord(manifest.research_program)?.goal) ??
    title;
  const surveyWorkflow = isSurveyWorkflow(manifest);

  const workflowPolicy = {
    ...(params.policy.projectsRoot
      ? { projectsRoot: params.policy.projectsRoot }
      : {}),
    enableChannelProjectBindings: params.policy.enableChannelProjectBindings === true,
    ...(params.policy.zoteroProjectRoot
      ? { zoteroProjectRoot: params.policy.zoteroProjectRoot }
      : {}),
  };
  await ensureWorkflowProjectRoot({
    policy: workflowPolicy,
    projectRoot,
    projectId,
    title,
    topic,
    workflowLine: surveyWorkflow ? "survey" : undefined,
  });

  let surveyIdentityUpdated = false;
  if (surveyWorkflow) {
    const ensured = ensureSurveyWorkflowIdentity(manifest);
    if (ensured.updated) {
      surveyIdentityUpdated = true;
      await writeJsonEnsured(manifestPath, ensured.manifest);
    }
  }

  const runtimeMigration = await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "migrate_latest_workflow_projects",
    notes: ["bulk latest workflow migration"],
  });

  let experimentDecisionPersisted = false;
  let experimentDecision: string | null = null;
  const refreshedManifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? manifest;
  if (
    asRecord(refreshedManifest.experiment_search) ||
    asString(refreshedManifest.current_stage) === "experiment"
  ) {
    const evaluated = await evaluateExperimentSearchDecisionForProject({
      projectRoot,
      persist: true,
    });
    experimentDecisionPersisted = true;
    experimentDecision = evaluated.summary.decision;
  }

  return {
    projectId,
    projectRoot,
    ensured: true,
    surveyIdentityUpdated,
    runtimeMigrated: runtimeMigration.migrated,
    createdRuntimeFiles: runtimeMigration.createdFiles,
    experimentDecisionPersisted,
    experimentDecision,
  };
}

export async function migrateWorkflowProjectsBatch(params: {
  projectsRoot: string;
  projectIds?: string[] | null;
  policy: WorkflowMigrationPolicyLike;
}): Promise<WorkflowProjectMigrationResult[]> {
  const discovered = await discoverWorkflowProjects({
    projectsRoot: params.projectsRoot,
  });
  const requested = new Set((params.projectIds ?? []).map((entry) => entry.trim()).filter(Boolean));
  const roots =
    requested.size === 0
      ? discovered
      : discovered.filter((projectRoot) => requested.has(path.basename(projectRoot)));

  const results: WorkflowProjectMigrationResult[] = [];
  for (const projectRoot of roots) {
    results.push(
      await migrateWorkflowProjectToLatest({
        projectRoot,
        policy: params.policy,
      })
    );
  }
  return results;
}
