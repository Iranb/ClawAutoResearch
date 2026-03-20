## First Run Guide — openclaw-research plugin

> This document explains how to start your first automated research run after installing the plugin.
> For multiple research directions or multiple GPU servers, see [CONFIG.md](./CONFIG.md).

---

## Configuration Required After Installation

The install script does **not** modify your existing `openclaw.json`. It only creates workspaces, skills, `openclaw-research.json`, and related files under `~/.openclaw/`, then writes suggested changes to `openclaw-research-suggested-changes.txt`. After installation, complete the following configuration as needed.

| Item | Required | Notes |
|--------|----------|------|
| **OpenClaw main config** | **Required** | Make sure the `openclaw.json` used by OpenClaw (usually `~/.openclaw/openclaw.json` or a custom path) contains agent definitions for researcher / orchestrator / coder / analyzer / academic_writer / reviewer / cross-reviewer, plus each agent's `workspace`, `skills`, and `subagents.allowAgents`. You can copy from the plugin's `openclaw.json` or manually apply the suggestions from `openclaw-research-suggested-changes.txt`. |
| **Project root `projectsRoot`** | Optional | If you do not want projects under the default `~/.openclaw/projects`, add `projectsRoot: "your path"` at the top level of `openclaw.json`, for example `"~/ResearchProjects"`. The install script will not modify `openclaw.json`; if you already set `projectsRoot` manually, you can also write the same value into `~/.openclaw/openclaw-research.json` for agent-side resolution. |
| **Run mode (`AUTO_PROCEED` / `PROJECT_MODE`)** | Recommended | Edit `~/.openclaw/workspace-researcher/WORKFLOW.md` and set `AUTO_PROCEED: false` and `PROJECT_MODE: single` for an interactive first run. |
| **PaperNexus path** | Recommended | The new pipeline starts with graph build. Make sure the `PaperNexus` repository is adjacent to this plugin, or set the `PAPERNEXUS_ROOT` environment variable. |
| **GPU servers** | Required when running experiments | Do **not** put this in `openclaw.json`. The global default lives in `~/.openclaw/openclaw-research.json` under `servers`, or you can override it per project with `{PROJ}/servers.json` (see [CONFIG.md](./CONFIG.md)). Make sure passwordless SSH, `nvidia-smi`, `screen`, and `uv` are available on the target host. |
| **Researcher / Coder server info (`SERVER.md`)** | Recommended when running experiments | Provide `SERVER.md` in the researcher agent directory or workspace with SSH aliases, remote directories, uv path, and similar deployment info. `researcher:/experiment-phase` and `coder:/run-experiment` read from it. |
| **Project directory** | Optional | You may create the project directory before the first pipeline run, for example `mkdir -p ~/.openclaw/projects/my_project_id`. If you do not create it, Researcher can initialize it at runtime. |

Once those are in place, start a **researcher** session in OpenClaw and run `/research-pipeline` or individual stage skills.

If `OpenClaw gateway restart` happens, or the session is lost or the window is closed, the recommended recovery order is:

1. Run `/resume-pipeline` in the `researcher` session first
2. If the recovery result shows that another agent owns the current stage, run that agent's own `/resume-pipeline`
3. Only continue with new stage work after state has been reconciled

---

### 1. Choose the Entry Agent

- **Recommended first entry: `researcher`**
  - Single-project end-to-end flow: from topic discovery to experiments, analysis, and paper writing
  - Uses local `~/.openclaw/workspace-researcher` plus the plugin-provided skills
- **Advanced usage: `orchestrator`**
  - Better for multi-person collaboration or multiple concurrent projects
  - Learn the single-project `researcher` flow first, then switch to `orchestrator` for a PI-style coordination view

For your first attempt, start a new **researcher** session in OpenClaw.

---

### 2. Configure Run Mode (`AUTO_PROCEED` and Gates)

Open:

- `~/.openclaw/workspace-researcher/WORKFLOW.md`

Check the top-level settings:

```text
AUTO_PROCEED: false        # true = fully automatic, false = wait for confirmation at each gate
GATE_TIMEOUT_HOURS: 24
PROJECT_MODE: single       # single | queue
```

**Recommended settings for the first run:**

- `AUTO_PROCEED: false` — semi-automatic mode; each key stage pauses for your decision
- `PROJECT_MODE: single` — one project only; no multi-project queue yet

After editing, **restart the researcher session** so it reloads the updated `WORKFLOW.md`.

---

### 3. Prepare a Project Directory (Optional but Recommended)

Create a project directory under the **project root** (default `~/.openclaw/projects`, configurable via `projectsRoot` in `openclaw.json`), for example:

```bash
mkdir -p ~/.openclaw/projects/gcd_v1
```

The first time you run `/research-pipeline`, Researcher will:

- Create project state files and agent-owned subdirectories under `{PROJECTS_ROOT}/<proj-id>/`:
  - `PROJECT_MANIFEST.json`
  - `TRACK_REGISTRY.json`
  - `CLAIM_POLICY.md`
  - `graph/`
  - `memory/`, `researcher/`, `orchestrator/`, `coder/`, `analyzer/`, `academic_writer/`, `reviewer/`, `cross-reviewer/`
- Write files according to the ownership rules in `WORKSPACE.md` and `WORKFLOW.md`

You can also skip the manual directory creation and let Researcher choose a suitable `proj-id` and initialize it.

---

### 4. Launch the End-to-End Pipeline

In the **researcher session**, enter a command with your research problem description, for example:

```text
/research-pipeline "Automated experiment pipeline for Generalized Category Discovery on ImageNet (baseline + new method)"
```

Internally, the plugin will progress through the defined stages:

1. **GRAPH_BUILD**
   - Run `/research-lit` first for coarse `papers-cool` discovery and full-text acquisition of key papers
   - Prefer `/hugging-face-paper-pages` when Markdown is available
   - If the graph does not yet contain the key papers, refresh the graph before calling `/graph-build`
   - Output: `{PROJ}/graph/PAPERNEXUS_STATUS.json`, `GRAPH_BUILD_REPORT.md`
   - This organizes the literature into a queryable PaperNexus corpus

2. **FRONTIER_MAPPING**
   - Run `/frontier-mapping`
   - Output: `{PROJ}/researcher/FRONTIER_REPORT.md` and `graph/subgraphs/`
   - Extract candidate directions from limitation / contradiction / transfer / composition frontiers

3. **IDEA**
   - Run `/idea-phase`, `/idea-generator`, `/novelty-check`, and `/idea-tournament`
   - Input: `LITERATURE.md` + `FRONTIER_REPORT.md`
   - Output: `{PROJ}/researcher/IDEA_REPORT.md`, `LITERATURE.md`, `TRACK_REGISTRY.json`
   - Instead of betting on a single idea, it first forms 2-3 active tracks and at most 1 parked track
   - It pauses at **GATE-1** to report candidate ideas and novelty evaluation

4. **PLAN**
   - Spawn `orchestrator` to run `/plan-research`
   - Input: `TRACK_REGISTRY.json`
   - Output: `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`
   - Orchestrator uses graph evidence packets to turn innovation ideas into executable plans
   - `PLAN.md` breaks experiments, budgets, and stop/rollback rules down by track
   - It pauses at **GATE-2** for experiment design and compute budget confirmation

5. **CODE**
   - Spawn `coder` to run `/implement-experiment`
   - Output: code and `README.md` under `{PROJ}/coder/<experiment-name>/`

6. **EXPERIMENT**
   - Researcher runs `/experiment-phase` (internally using `uv` and SSH to remote GPUs)
   - Output: `{PROJ}/researcher/artifacts/results/`, `EXPERIMENT_REGISTRY.md`
   - After each round it decides `advance / merge / park / kill` for each track
   - It pauses at **GATE-3** to show key metrics and relative baseline gains

7. **ANALYZE**
   - Spawn `analyzer` to run `/analyze-results` (plus `scientific-figures`)
   - Output: `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `CLAIM_EVIDENCE_MATRIX.md`, `TRACK_VERDICTS.md`, `UNSUPPORTED_CLAIMS.md`, `THEORY_SUPPORT_NOTE.md`, `figures/`, `tables/`
   - `THEORY_SUPPORT_NOTE.md` only gives a coarse `green / red` signal and does not block draft generation

8. **REVIEW (internal)**
   - Spawn `reviewer` to run `/review-phase` and `/evidence-grading`
   - Output: `{PROJ}/reviewer/REVIEW_REPORT.md`, `REVIEW_STATE.json`
   - This checks whether primary claims are marked `SUPPORTED` in `CLAIM_EVIDENCE_MATRIX.md`
   - It also checks scope, risk, and publishability to avoid endless unnecessary experimentation
   - If theory support is still weak, Reviewer only marks the theory signal as `red`; it does not block writing

9. **WRITE**
   - Spawn `academic_writer` to run `/paper-plan`, `/paper-write`, and `/paper-compile`
   - Use `cross-reviewer` for outline- and prose-level review
   - Primary `UNSUPPORTED` claims cannot be written as headline contributions
   - Generate `STORYLINE_SKETCH.md` and `WRITING_SIGNALS.md`
   - Theory / storyline / paragraph logic are tracked only with `green / red`; even `red` still allows a first draft, followed by human review
   - Output: `{PROJ}/academic_writer/PAPER_PLAN.md`, `STORYLINE_SKETCH.md`, `WRITING_SIGNALS.md`, `paper/sections/`, `paper/main.pdf`
   - It pauses at **GATE-4** for your approval before external review

10. **SUBMIT / External AI review**
   - Run `/paperreview-submit` in the reviewer session
   - Output: external AI review plus a first rebuttal draft
   - This stage is mandatory, not optional; once `paper/main.pdf` exists, it must go through this step
   - At **GATE-5 (mandatory stop)**, you decide whether to major revise, minor revise, or accept

Because `AUTO_PROCEED=false`, each gate (GATE-1 through GATE-4 plus GATE-5) will:

- print a structured summary of what the stage did, key metrics, and file paths
- offer actionable next-step choices (continue / modify / stop / go back)
- wait for your natural-language instruction before continuing

---

### 5. Stage-by-Stage Manual Driving

If you do not want to run everything at once, you can invoke only selected stage skills, for example:

- Only topic discovery and literature:
  - `/graph-build`
  - `/frontier-mapping`
  - `/idea-phase`
  - `/research-lit`
  - `/novelty-check`
  - `/research-reflect`
- Only parallel experiment dispatch:
  - `/experiment-phase`
  - `/parallel-experiments`
- Only paper writing:
  - If `NARRATIVE_REPORT.md` and `figures/` already exist, let `academic_writer` run:
    - `/paper-plan`
    - `/paper-write`
    - `/paper-compile`

You can interrupt or steer the process at any stage, for example:

```text
This time stop at the PLAN stage and do not start any remote experiments.
```

Or:

```text
Force an additional reproduce-baseline stage into PLAN, then continue.
```

Researcher / Orchestrator will write those requirements back into `PLAN.md` and `TODOS.md` before continuing.

---

### 6. Suggested First Practice Run

1. **Start a researcher session** and confirm that the startup self-check shows:
   - the current `AUTO_PROCEED` mode
   - whether it detected an existing project or `TODOS.md`
2. **Run only the IDEA stage**:
   - first execute `/graph-build` and `/frontier-mapping`
   - then execute `/idea-phase`, and inspect `{PROJ}/researcher/IDEA_REPORT.md`, `LITERATURE.md`, `FRONTIER_REPORT.md`, and `TRACK_REGISTRY.json`
3. **Run one complete `/research-pipeline`**:
   - choose a small problem you already understand well
   - inspect every gate summary and generated file carefully
4. **Tune the system from experience**:
   - adjust which gates must wait and which can be skipped when `AUTO_PROCEED=true` in `WORKFLOW.md`
   - widen or tighten per-agent read/write permissions in `WORKSPACE.md`
   - tune default parameters in `experiment-phase` and `parallel-experiments` for your GPU cluster and workflow habits

After that, you will have a controllable automated research pipeline, and you can choose to:

- collaborate during the day with gate mode (`AUTO_PROCEED=false`)
- switch to `AUTO_PROCEED=true` at night, let it run a project unattended, and review the results, reports, and paper draft the next day
