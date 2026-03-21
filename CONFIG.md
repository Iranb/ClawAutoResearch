# CONFIG.md — OpenClaw Research Configuration

## Path Variables

### Core Paths

- **`{PROJECTS_ROOT}`**: `/Users/iranb/Downloads/AutoResearchProjects`
  - Root directory for all research projects
  - Each project is isolated under `{PROJECTS_ROOT}/{proj-id}/`
  - Configured in `openclaw.json` as `plugins.entries.openclaw-research.config.projectsRoot`

- **`{WS}`**: `~/.openclaw/workspace-researcher`
  - Researcher agent workspace
  - Contains skills, memory templates, and shared resources

- **`{PMEM}`**: `{PROJ}/memory`
  - Project-specific memory directory
  - Contains ideation-memory.md, experiment-memory.md, daily logs

### Per-Project Structure

For each project `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`:

```
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
2. **Top-level config**: `openclaw.json` → `projectsRoot`
3. **Default**: `~/.openclaw/projects`

## Environment Variables

- **`OPENCLAW_PROJECT`**: Current project ID
  - Must be set before starting any research workflow
  - Used to resolve `{PROJ}` path
  - Example: `export OPENCLAW_PROJECT=my-first-detection`

## Related Files

- **`WORKFLOW.md`**: Defines research stages, gates, and AUTO_PROCEED settings
- **`WORKSPACE.md`**: Defines agent file ownership and permissions
- **`templates/`**: Contains template files for new projects

## Quick Reference

```bash
# Set project
export OPENCLAW_PROJECT=my-project

# Project path resolves to:
# {PROJECTS_ROOT}/my-project
# = ~/.openclaw/projects/my-project
```

---

**Last Updated**: 2026-03-21
