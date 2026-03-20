# CONFIG.md — Project Root and Multi-Server Configuration

> Put `projectsRoot` in OpenClaw's `openclaw.json`. Do not put `servers` in `openclaw.json`; keep it in `~/.openclaw/openclaw-research.json`, with optional per-project overrides via `{PROJ}/servers.json`.

---

## 1. Project Root (`projectsRoot`)

**Goal**: separate project data from each agent's workspace by using one shared directory that all agents can access.

- Configure the top-level **`projectsRoot`** key in **`openclaw.json`**, for example:
  ```json
  projectsRoot: "~/.openclaw/projects"
  ```
  You can change it to any path, such as `"/Users/me/ResearchProjects"` or `"~/OpenClawProjects"`.
- **Project path**: `{PROJECTS_ROOT}/{proj-id}/`; **project memory**: `{PROJECTS_ROOT}/{proj-id}/memory/` (`ideation-memory`, `experiment-memory`, daily logs).
- Agents resolve **{PROJECTS_ROOT}** in this order: environment variable `OPENCLAW_PROJECTS_ROOT` → `projectsRoot` in `~/.openclaw/openclaw-research.json` → default `~/.openclaw/projects`.
  The install script copies `projectsRoot` from `openclaw.json` into `~/.openclaw/openclaw-research.json` so agents can read it.
- **PROJECTS_STATE.json** should live under the project root: `{PROJECTS_ROOT}/PROJECTS_STATE.json`, so multiple agents can share it.

---

## 2. Multiple Servers (Global and Per-Project)

**Problem**: the default `tools.exec.host` assumes one host, but multi-GPU setups need host selection or rotation, and different research directions or projects may need different servers.

**Approach**:

1. **Global default**: configure **`servers`** in `~/.openclaw/openclaw-research.json`.
2. **Per-project override**: if **`{PROJ}/servers.json`** exists, that project's SSH deployment uses only the project-local config instead of the global `servers`.

### Global Config Example (`~/.openclaw/openclaw-research.json`)

```json
{
  "servers": {
    "default": "gateway",
    "list": ["gateway", "gpu-node-2", "gpu-node-3"]
  }
}
```

### Per-Project Override Example (`{PROJ}/servers.json`)

Create `servers.json` in the project root using the same format:

```json
{
  "default": "gpu-lab-1",
  "list": ["gpu-lab-1", "gpu-lab-2"]
}
```

- **`default`**: the default SSH host for this project.
- **`list`**: the list of allowed hosts for this project; skills choose only from this list.

**Resolution order**: when running `/experiment-phase`, `/parallel-experiments`, and related skills, first read **`{PROJ}/servers.json`**. If it exists, use its `default` and `list`; otherwise, use the global `servers` in `~/.openclaw/openclaw-research.json`.

### Agent Usage Convention

- When Researcher runs experiment-related skills, it resolves servers in the order above and selects a host from `list` based on load, free GPUs, or your preferred strategy.
- Each host should already have passwordless SSH, `nvidia-smi`, `screen`, `uv`, or an equivalent environment configured.

---

After configuration, restart OpenClaw or open a new session so the config is reloaded. If you change `projectsRoot`, make sure the target directory exists and that agent processes have read/write access.
