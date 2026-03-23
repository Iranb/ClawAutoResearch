# WORKSPACE.md — Directory Architecture

> This is the canonical reference for all file paths in the openclaw-research plugin.
> Every agent MUST read this file and follow its ownership rules.
> Rule summary: **write only to your own folder; read from any folder**.
> Project directories are separate from agent workspaces and live under the configurable `projectsRoot`, accessible to all agents.
> For the onboarding overview and reading map, start from [README.md](./README.md) and [DOC/README.md](./DOC/README.md).

---

## Path Resolution Conventions

- **{PROJECTS_ROOT}**: configurable project root, separate from all agent workspaces.
  - Configure it via `plugins.entries.openclaw-research.config.projectsRoot` in your real `openclaw.json`.
  - If omitted, the plugin falls back to `~/.openclaw/projects`.
- **{PROJ}** = `{PROJECTS_ROOT}/{proj-id}` — one project directory.
- **{WS}** = the current agent workspace (for example `~/.openclaw/workspace-researcher`), containing identity and process definitions only, not project data.
- **{PMEM}** = `{PROJ}/memory` — project-level memory (ideation, experiment, daily logs), readable by all agents; write permissions are defined below.

Project resolution in practice is:

1. current channel/session binding when enabled
2. explicit `OPENCLAW_PROJECT` fallback when present
3. plugin-configured `{PROJECTS_ROOT}` + project id resolution

---

## Top-Level Structure

```text
{PROJECTS_ROOT}/                     ← configurable, e.g. ~/.openclaw/projects or ~/ResearchProjects
│
├── PROJECTS_STATE.json              ← multi-project registry (written by researcher, readable by all agents)
│
└── {proj-id}/                       ← one directory per research project
    ├── README.md                    ← OWNED BY: researcher (project overview)
    ├── WORKFLOW.md                  ← workflow snapshot used by this project
    ├── PROJECT_MANIFEST.json        ← OWNED BY: researcher (project state manifest)
    ├── TRACK_REGISTRY.json          ← OWNED BY: researcher (multiple hypothesis tracks)
    ├── CLAIM_POLICY.md              ← OWNED BY: researcher (claim support and writing constraints)
    ├── servers.json                 ← optional; project-specific server config overriding global servers
    ├── graph/                       ← OWNED BY: researcher (PaperNexus graph state and subgraphs)
    │
    ├── memory/                      ← project-level memory (readable by all agents; written by researcher)
    │   ├── ideation-memory.md
    │   ├── experiment-memory.md
    │   └── YYYY-MM-DD.md            ← per-project daily log (append-only)
    │
    ├── researcher/                  ← OWNED BY: researcher
    ├── orchestrator/                ← OWNED BY: orchestrator
    ├── coder/                       ← OWNED BY: coder
    ├── analyzer/                    ← OWNED BY: analyzer
    ├── academic_writer/             ← OWNED BY: academic_writer
    ├── reviewer/                    ← OWNED BY: reviewer
    └── cross-reviewer/              ← OWNED BY: cross-reviewer
```

Agent workspaces (for example `~/.openclaw/workspace-researcher`) keep only identity and process definitions such as `SOUL.md`, `AGENTS.md`, `WORKFLOW.md`, `BOOTSTRAP.md`, and `HEARTBEAT.md`; all project data lives under `{PROJECTS_ROOT}`.

---

## Ownership Rules

| Agent | Owns (write) | Can read |
|-------|---------------|----------|
| **researcher** | `{PROJECTS_ROOT}/PROJECTS_STATE.json`, `{PROJ}/researcher/`, `{PROJ}/README.md`, `{PROJ}/PROJECT_MANIFEST.json`, `{PROJ}/TRACK_REGISTRY.json`, `{PROJ}/CLAIM_POLICY.md`, `{PROJ}/graph/`, `{PROJ}/memory/`, `{PROJ}/servers.json` | everything |
| **orchestrator** | `{PROJ}/orchestrator/` | everything under `{PROJ}/` |
| **coder** | `{PROJ}/coder/` | `{PROJ}/orchestrator/`, `{PROJ}/researcher/` |
| **analyzer** | `{PROJ}/analyzer/` | `{PROJ}/researcher/`, `{PROJ}/orchestrator/` |
| **academic_writer** | `{PROJ}/academic_writer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/`, `{PROJ}/reviewer/` |
| **reviewer** | `{PROJ}/reviewer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/` |
| **cross-reviewer** | `{PROJ}/cross-reviewer/` | `{PROJ}/researcher/`, `{PROJ}/analyzer/`, `{PROJ}/academic_writer/` |

> **Enforcement**: each agent's `AGENTS.md` specifies these rules explicitly.
> Agents MUST NOT create files outside their owned directory.
> Agents CAN read from `{PROJ}/memory/` and any other agent directory under `{PROJ}/`.

---

## Per-Project Directory Contents

### `{PROJ}/memory/` — Project-Level Memory

```text
memory/
├── ideation-memory.md       ← idea memory (successful patterns + failure classes)
├── experiment-memory.md     ← experiment strategy memory (effective hyperparameters, data-handling tactics)
└── YYYY-MM-DD.md            ← per-project daily log (append-only)
```

Bounded background-topic steering lives in `{PROJ}/PROJECT_MANIFEST.json.idle_research`; digests from those rounds should be written under `{PROJ}/researcher/idle-research/`.

### `{PROJ}/researcher/`

```text
researcher/
├── LITERATURE.md
├── FRONTIER_REPORT.md
├── IDEA_REPORT.md
├── idle-research/
│   └── ROUND-YYYY-MM-DD_HHMM.md
├── GATE_STATE.json
├── GATES_LOG.md
├── EXPERIMENT_LOG.md
├── EXPERIMENT_LEDGER.json
├── EXPERIMENT_REGISTRY.md
├── IDEA_TOURNAMENT_STATE.json
├── REVIEW_STATE.json
├── PARALLEL_STATE.json
├── workflow_snapshots/
│   └── WORKFLOW.YYYY-MM-DD_HHMM.md
└── artifacts/
    ├── pilots/
    ├── results/
    └── logs/
```

### `{PROJ}/TRACK_REGISTRY.json`

Unified registry for multiple hypothesis tracks within a project. It should contain at least:

- `track_id`
- `lens`
- `hypothesis`
- `status` (`candidate` / `active` / `parked` / `killed` / `merged`)
- `stage`
- `novelty_status`
- `evidence_status`
- `linked_graph_nodes`
- `relation_patterns`
- `why_now`
- `weakest_assumption`
- `falsification_test`
- `compute_budget_gpu_h`
- `last_decision`

### `{PROJ}/CLAIM_POLICY.md`

Controls how claims can flow from analysis into writing:

- `SUPPORTED`: may appear in abstract / contribution bullets / conclusion
- `PARTIAL`: may only be stated conservatively
- `UNSUPPORTED`: may not appear as a headline contribution

### `{PROJ}/graph/`

```text
graph/
├── PAPERNEXUS_STATUS.json
├── GRAPH_BUILD_REPORT.md
└── subgraphs/
    └── *.md
```

### `{PROJ}/orchestrator/`

```text
orchestrator/
├── PLAN.md
└── TODOS.md
```

### `{PROJ}/coder/` … `{PROJ}/cross-reviewer/`

Follow the existing ownership rules in each agent's `AGENTS.md`.

### `{PROJ}/analyzer/`

Key additional state files:

```text
analyzer/
├── NARRATIVE_REPORT.md
├── CLAIM_EVIDENCE_MATRIX.md
├── TRACK_VERDICTS.md
├── UNSUPPORTED_CLAIMS.md
├── THEORY_SUPPORT_NOTE.md
├── figures/
└── tables/
```

`THEORY_SUPPORT_NOTE.md` only outputs a coarse `green / red` signal:

- `green`: there is enough theory intuition, mechanism explanation, or lightweight derivation to write naturally
- `red`: theory is still weak, but it does not block a first draft; Writer should use more conservative phrasing and leave it for human review

### `{PROJ}/academic_writer/`

Soft-constraint state files for the writing stage:

```text
academic_writer/
├── PAPER_PLAN.md
├── STORYLINE_SKETCH.md
├── WRITING_SIGNALS.md
└── paper/
```

`WRITING_SIGNALS.md` only maintains three advisory fields:

- `theory: green | red`
- `storyline: green | red`
- `paragraph_logic: green | red`

These states are advisory only and must not block first-draft generation.

---

## Path Variables

| Variable | Resolves to |
|----------|-------------|
| `{PROJECTS_ROOT}` | configured project root from `plugins.entries.openclaw-research.config.projectsRoot` |
| `{PROJ}` | `{PROJECTS_ROOT}/{proj-id}` |
| `{PMEM}` | `{PROJ}/memory` |
| `{WS}` | current agent workspace (for example `~/.openclaw/workspace-researcher`) |

Example: `{PROJ}/researcher/IDEA_REPORT.md`, `{PMEM}/ideation-memory.md`

---

## Memory Isolation (Per Project)

Long-term memory lives entirely under the project-level `{PROJ}/memory/`. Different `{proj-id}` values are naturally isolated, so multiple projects or directions can run in parallel without interference. No workspace or agent changes are required.

---

## Multiple Servers

The experiment stage can deploy through SSH to remote GPUs. Treat the global server configuration as part of your actual OpenClaw runtime setup; for a specific project or direction, place `{PROJ}/servers.json` under the project to override the server list. Different projects can use different servers. See `CONFIG.md` for details.

---

## TODOS.md Convention (shared file)

The read/write convention for `{PROJ}/orchestrator/TODOS.md` remains unchanged and supports multi-agent collaborative updates.

---

## Cross-Reviewer / Reviewer Output Convention

As before, the calling agent writes review output into `{PROJ}/cross-reviewer/` or `{PROJ}/reviewer/`.
