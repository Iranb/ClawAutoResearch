# CONFIG.md — OpenClaw Research Configuration

> This file is a path and configuration cheat sheet.
> For the full narrative configuration guide, see [DOC/reference/configuration.md](./DOC/reference/configuration.md).

## Path Variables

### Core Paths

- **`{PROJECTS_ROOT}`**: `/Users/iranb/Downloads/AutoResearchProjects`
  - Root directory for all research projects
  - Each project is isolated under `{PROJECTS_ROOT}/{proj-id}/`
  - Configure it in `openclaw.json` as `plugins.entries.openclaw-research.config.projectsRoot`

- **`{PAPERNEXUS_PAPERS_ROOT}`**: `~/.papernexus/papers`
  - Local default PaperNexus paper source root
  - New projects should default `paper_source_dir` and `graph_source_dir` to `{PAPERNEXUS_PAPERS_ROOT}/{proj-id}`

- **`{PAPERNEXUS_INDEX_ROOT}`**: `~/.papernexus/index-store`
  - Local default PaperNexus index root
  - Authoritative graph files are written under this index root when `storage.indexDir` is set in PaperNexus

- **`{WS}`**: `~/.openclaw/workspace-researcher`
  - Researcher agent workspace
  - Contains skills, memory templates, and shared resources

- **`{PMEM}`**: `{PROJ}/memory`
  - Project-specific memory directory
  - Contains ideation-memory.md, experiment-memory.md, daily logs

### Per-Project Structure

For each project `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`:

Default PaperNexus source and graph paths for a project:

```text
{PAPERNEXUS_PAPERS_ROOT}/{proj-id}/
  md/
  pdf/

{PAPERNEXUS_INDEX_ROOT}/.papernexus/
  graph.kuzu
  graph.lite.json
  meta.json
```

Notes:
- `paper_source_dir` should usually point at `{PAPERNEXUS_PAPERS_ROOT}/{proj-id}`
- `graph_source_dir` should record the source corpus directory used for the current graph build, which by default is the same as `paper_source_dir`
- the graph files themselves are not stored inside `graph_source_dir`; they are stored in the PaperNexus index area

Project workspace structure:

```text
{PROJ}/
├── PROJECT_MANIFEST.json      # Project state and current stage
├── TRACK_REGISTRY.json        # Research track portfolio
├── CLAIM_POLICY.md            # Claim support criteria
├── WORKFLOW.md                # Workflow snapshot (copied from workspace)
├── README.md                  # Project overview
├── graph/                     # PaperNexus literature graph
├── memory/                    # Project memory
├── researcher/                # Researcher outputs
├── orchestrator/              # Experiment plans
├── coder/                     # Experiment code
├── analyzer/                  # Analysis results
├── writer/                    # Paper drafts
└── reviewer/                  # Review feedback
```

## Configuration Source

The `{PROJECTS_ROOT}` path is determined by:

1. **Plugin config** (highest priority): `openclaw.json` → `plugins.entries.openclaw-research.config.projectsRoot`
2. **Default**: `~/.openclaw/projects`

## Environment Variables

- **`OPENCLAW_PROJECT`**: Optional current project ID fallback
  - Useful in non-Discord or single-project local sessions
  - In Discord multi-project setups, channel-to-project binding is usually preferred
  - Example: `export OPENCLAW_PROJECT=my-first-detection`

- **`PAPERNEXUS_ROOT`**: Optional PaperNexus repository root
  - Can be used when PaperNexus is not discoverable as a sibling repository
  - Helps `graph-build` and related skills resolve the local PaperNexus installation

## Related Files

- **`WORKFLOW.md`**: Defines research stages, gates, and AUTO_PROCEED settings
- **`WORKSPACE.md`**: Defines agent file ownership and permissions
- **`templates/`**: Contains template files for new projects

## Quick Reference

```bash
# Optional local fallback when channel binding is not used
export OPENCLAW_PROJECT=my-project

# Project path resolves to:
# {PROJECTS_ROOT}/my-project
# = <plugins.entries.openclaw-research.config.projectsRoot>/my-project
```

---

**Last Updated**: 2026-03-21
