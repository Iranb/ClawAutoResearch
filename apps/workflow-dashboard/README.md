# Workflow Dashboard

Read-only local dashboard package for viewing workflow state without mutating the main plugin runtime.

## Local startup

From the repository root:

```bash
OPENCLAW_PROJECTS_ROOT=/absolute/path/to/projects npm run dashboard:dev
```

You can also pass the projects root directly to the server process:

```bash
npm --prefix apps/workflow-dashboard run dev:server -- --projectsRoot /absolute/path/to/projects
```

## Required configuration

The dashboard needs a `projectsRoot` value to know which local project tree to inspect.

- CLI input wins: `--projectsRoot /path/to/projects`
- Environment fallback: `OPENCLAW_PROJECTS_ROOT=/path/to/projects`

If neither is provided, the server exits with a readable configuration error.

## Read-only note

This package is intentionally read-only. It is meant to inspect local workflow state and should not change project files.
