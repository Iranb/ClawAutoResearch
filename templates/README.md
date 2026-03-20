# Plugin Template Directory (`templates`)

This directory stores the templates and state files used by openclaw-research. The install script copies `memory/` and `hooks/` into the corresponding workspaces, skipping files that already exist. During project initialization, state templates can also be copied from here into `{PROJ}/`.

## Structure

```text
templates/
├── memory/                         # project-level memory templates (copied to workspace-researcher/memory/)
│   ├── ideation-memory.md          # idea-memory template
│   └── experiment-memory.md        # experiment-strategy template
├── hooks/                          # session hooks (copied to workspace roots)
│   ├── BOOTSTRAP.md                # read on session start (OpenClaw boot-md)
│   ├── HEARTBEAT.md                # periodic persistence (~every 2h)
│   ├── agent-bootstrap.md          # reference/archive matching BOOTSTRAP
│   └── before-compaction.md        # reference/archive; logic folded into HEARTBEAT
├── EXPERIMENT_REGISTRY.md          # experiment registry template (/experiment-phase, /parallel-experiments)
├── IDEA_TOURNAMENT_STATE.json      # idea-tournament state template (resume/continue)
├── PROJECT_MANIFEST.json           # project state-machine template
├── PROJECTS_STATE.json             # multi-project top-level state template
├── TRACK_REGISTRY.json             # hypothesis track registry
├── CLAIM_POLICY.md                 # claim support labels and writing constraints
└── README.md                       # this document
```

## Usage

- **memory**: copied into `~/.openclaw/workspace-researcher/memory/` during installation; new projects may initialize `{PROJ}/memory/` from these templates.
- **hooks**: `BOOTSTRAP.md` and `HEARTBEAT.md` are copied into the researcher, reviewer, and cross-reviewer workspace roots during installation; OpenClaw reads `BOOTSTRAP.md` at session start and triggers `HEARTBEAT.md` periodically.
- **PROJECT_MANIFEST.json**, **TRACK_REGISTRY.json**, **CLAIM_POLICY.md**: recommended to be copied into `{PROJ}/` during project initialization as the unified templates for the state machine, track portfolio, recovery, audit, and writing evidence gates.
- **EXPERIMENT_REGISTRY.md**, **IDEA_TOURNAMENT_STATE.json**, **PROJECTS_STATE.json**: copy into the project directory as needed (for example under `{PROJ}/researcher/` or `{PROJECTS_ROOT}/`) as initial state or reference format.

After editing files in this directory, re-running `install.sh` will not overwrite same-named files that already exist in user workspaces. If you need to update deployed hooks or memory templates, overwrite them manually or back them up before reinstalling.
