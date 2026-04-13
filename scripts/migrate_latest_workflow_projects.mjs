#!/usr/bin/env node
import path from "node:path";

import { migrateWorkflowProjectsBatch } from "../tools/workflow-project-migration.ts";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

const projectsRoot =
  argValue("--projects-root") ??
  process.env.OPENCLAW_PROJECTS_ROOT ??
  "/Users/iranb/Downloads/AutoResearchProjects";

const projectIds = argValues("--project-id");

const results = await migrateWorkflowProjectsBatch({
  projectsRoot: path.resolve(projectsRoot),
  projectIds,
  policy: {
    projectsRoot: path.resolve(projectsRoot),
    enableChannelProjectBindings: true,
  },
});

console.log(
  JSON.stringify(
    {
      projectsRoot: path.resolve(projectsRoot),
      migratedCount: results.length,
      results,
    },
    null,
    2
  )
);
