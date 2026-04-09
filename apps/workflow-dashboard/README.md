# Workflow Dashboard

Read-only local dashboard package for viewing workflow state without mutating the main plugin runtime.

## Local startup

From the repository root:

```bash
OPENCLAW_PROJECTS_ROOT=/absolute/path/to/projects npm run dashboard:dev
```

This starts two local processes:

- the read-only API server from `apps/workflow-dashboard/server/index.ts`
- the Vite frontend, which proxies `/api/*` requests to the local API server during development

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

Read-only means:

- the UI never writes workflow files
- the local API only exposes `GET` endpoints
- all data shown in the dashboard is derived from existing runtime artifacts on disk

## Data sources

Homepage matrix:

- prefers `PROJECTS_STATE.json`
- falls back to `{project}/PROJECT_MANIFEST.json`
- supplements stage context from `{project}/graph/PAPERNEXUS_PROGRESS.json`

Project detail page:

- summary cards come from `{project}/PROJECT_MANIFEST.json`
- PaperNexus phase/progress comes from `{project}/graph/PAPERNEXUS_PROGRESS.json`
- artifact tabs enumerate files from:
  - `{project}/PROJECT_MANIFEST.json`
  - `{project}/graph/*.json`
  - `{project}/.openclaw-research/*`

Artifact drill-down:

- `Manifest`, `Graph`, `Runtime`, and `Raw JSON` tabs lazily fetch artifact metadata and raw formatted content from the local API
- JSON artifacts are pretty-rendered
- JSONL artifacts show recent lines with truncation metadata when applicable
- missing or invalid artifacts are shown explicitly instead of being hidden

## Operator workflow

Typical usage from the repo root:

```bash
OPENCLAW_PROJECTS_ROOT="$PWD" npm run dashboard:dev
```

Then:

1. open the Vite URL shown in the terminal
2. scan the homepage matrix for blocked or active projects
3. click a project name to open the detail view
4. review `Current stage`, `Owner`, `Status`, `Updated`, `Blocking reason`, and `Next action`
5. open `Manifest`, `Graph`, `Runtime`, or `Raw JSON` only when you need source evidence

## Not in v1

- no write actions such as refresh, resume, or graph rebuild
- no websocket/live auto-refresh
- no auth or multi-user deployment model
- no attempt to reconstruct workflow logic beyond the stored state files
