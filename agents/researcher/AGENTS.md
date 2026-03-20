# AGENTS.md — Researcher Agent

## File Ownership

> Reference: `WORKSPACE.md` for full directory architecture.

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJECTS_ROOT}/PROJECTS_STATE.json`, `{PROJ}/PROJECT_MANIFEST.json`, `{PROJ}/TRACK_REGISTRY.json`, `{PROJ}/CLAIM_POLICY.md`, `{PROJ}/researcher/`, `{PROJ}/README.md`, `{PROJ}/memory/`, `{PROJ}/graph/` |
| **READ (access)** | Everything under `{WS}/` |

Path variables: see `CONFIG.md` for `{PROJECTS_ROOT}` (env or `~/.openclaw/openclaw-research.json`); `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`, `{PMEM}` = `{PROJ}/memory`, `{WS}` = current agent workspace

**Rules**:
- Create files ONLY inside `{PROJ}/researcher/` or `{PROJ}/memory/` (`{PMEM}`)
- Create project-scoped graph state ONLY inside `{PROJ}/graph/` or `{PROJ}/PROJECT_MANIFEST.json`
- NEVER write to other agents' folders (orchestrator/, coder/, analyzer/, academic_writer/, reviewer/, cross-reviewer/)
- Cross-reviewer output: after receiving a response via `sessions_send`, save it to `{PROJ}/cross-reviewer/` on behalf of cross-reviewer

## Session Startup

On every session start:

1. Read `SOUL.md` (identity and principles)
2. Read `USER.md` (user preferences, if present)
3. Read `{PROJ}/PROJECT_MANIFEST.json` if it exists — current project identity, PaperNexus corpus, and graph state
4. Read `{PROJ}/TRACK_REGISTRY.json` if it exists — active / parked / killed tracks and recent decisions
5. Read `{PROJ}/CLAIM_POLICY.md` if it exists — how claim support labels constrain writing and rollback
6. Read `{PMEM}/YYYY-MM-DD.md` if it exists — today's and yesterday's logs
7. Read `MEMORY.md` (long-term memory)
8. Check for in-progress projects by reading `{PROJECTS_ROOT}/PROJECTS_STATE.json` or `{PROJ}/orchestrator/TODOS.md`
9. Before any write, confirm that `{PROJ}/PROJECT_MANIFEST.json.project_id`, `owner_agent`, `next_action`, and `resume_action` match the current task
10. If you just switched from another project, run `/resume-pipeline` before doing new writes

## Remote Server

Experiment code runs on remote GPU servers over SSH. Server information is configured in `SERVER.md`.

Before each connection, check resources:
```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader && echo '---' && free -h && echo '---' && df -h /home"
```

Use `rsync` for code sync:
```bash
rsync -avz --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' --exclude='wandb' <local_src>/ <server>:<remote_dst>/
```

Use `screen` for long-running experiments:
```bash
ssh <server> "screen -dmS <exp_name> bash -c 'cd <remote_dst> && CUDA_VISIBLE_DEVICES=<gpu_id> uv run python train.py <args> > logs/<exp_name>.log 2>&1'"
```

## Memory

- `{PMEM}/YYYY-MM-DD.md` — daily experiment log (append-only, project-isolated)
- `MEMORY.md` — long-term memory (research directions, server config, personal preferences)
- `{PMEM}/ideation-memory.md` — idea memory (successful patterns + failure classes, project-isolated)
- `{PMEM}/experiment-memory.md` — experiment strategy memory (effective hyperparameters, data-handling tactics, project-isolated)

Memory uses the QMD backend and `memory_search`, and is fully isolated from Reviewer memory.
Project facts may only be written into the current `{PROJ}`; cross-project reuse is allowed only as generalized heuristics, never as copied project-specific facts.

**When to update memory**:
- after `idea-phase` succeeds or fails → update `ideation-memory.md` via the `research_memory` plugin tool
- after `experiment-phase` completes → update `experiment-memory.md` via the `research_memory` plugin tool
- at the end of each day → write the daily log via the `research_memory` plugin tool
- before context compaction → automatic memory flush

Do not hand-edit `{PMEM}/ideation-memory.md`, `{PMEM}/experiment-memory.md`, or `{PROJ}/researcher/REVIEW_STATE.json` when the `research_memory` tool supports the write.

## Research Workflow

> **Authoritative pipeline definition: `WORKFLOW.md`** (workspace root).
> Read it on every session start. It defines all stages, gate formats, and AUTO_PROCEED behavior.

**Quick reference — stage order:**

```
SETUP → GRAPH_BUILD → FRONTIER_MAPPING → IDEA → [GATE-1] → PLAN → [GATE-2] → CODE
  → EXPERIMENT → [GATE-3] → ANALYZE → REVIEW
  → WRITE → CROSS-REVIEW → [GATE-4] → SUBMIT → [GATE-5★] → REVISE / DONE
```

**State-machine rule:**
- Always update both `current_stage` and `current_micro_stage` in `{PROJ}/PROJECT_MANIFEST.json`
- Every track decision must be explicit in `{PROJ}/TRACK_REGISTRY.json`
- Do not allow more than 2 active tracks without an explicit budget exception
- Keep `owner_agent`, `next_action`, `resume_action`, `required_artifacts`, `blocking_reason`, `last_heartbeat_at`, and `last_handoff_at` current in `{PROJ}/PROJECT_MANIFEST.json`
- Mirror the latest audit paths into `{PROJ}/PROJECT_MANIFEST.json.audit`

★ GATE-5 is always required (never skipped, even in AUTO_PROCEED mode).

**Gate protocol (when AUTO_PROCEED=false):**
1. Complete the stage fully
2. Write `{PROJ}/researcher/GATE_STATE.json` with `current_stage` + `gate_status: "waiting"`
3. Post the gate message using the exact format from WORKFLOW.md
4. Wait for human response:
   - "continue" / "approve" / any instruction → proceed, update gate_status to "approved"
   - "stop" → halt, leave gate_status as "waiting"
   - feedback text → incorporate feedback, proceed
5. If AUTO_PROCEED=true: skip steps 3-4, log to `{PROJ}/researcher/GATES_LOG.md` instead

**Skill entry points:**
- `/research-lit` — continuous literature research and full-text corpus accumulation
- `/papers-cool` — coarse search, venue sweep, abstract and PDF retrieval
- `/hugging-face-paper-pages` — preferred full-paper Markdown retrieval for key papers
- `/papernexus` — PaperNexus corpus / status / watch / refresh operations
- `/papernexus-agentic-reasoning` — structured graph-grounded innovation analysis
- `/graph-build` — new-project graph initialization (PaperNexus corpus build / refresh)
- `/frontier-mapping` — graph frontier extraction (limitations, contradictions, transfer, composition)
- `/idea-phase` — Stage 1 (IDEA)
- `/research-reflect` — track / budget / evidence decision checkpoint
- `/plan-research` — Stage 2 (PLAN, executed by Orchestrator; Researcher must proactively wake it when outputs are missing)
- `/experiment-phase` — Stage 4 (EXPERIMENT)
- `/resume-pipeline` — reconcile the state machine, experiment registry, and sub-agent outputs after restart
- `/analyze-results` — Stage 5 (ANALYZE, via Analyzer)
- `/review-phase` — Stage 6 (REVIEW, via Reviewer)
- `/paper-phase` — Stage 7 (WRITE, via Writer)
- `/research-pipeline` — full pipeline from Stage 1

## Sub-agents

Subtasks may be delegated with `sessions_spawn`:
- **orchestrator**: create and update experiment plans (no code execution)
- **coder**: implement experiment code and run atomic remote launches (`/run-experiment`)
- **analyzer**: analyze results and generate figures/tables
- **academic_writer**: write reports and papers

Delegation rule: one subtask = one topic, with concrete file paths and explicit success signals.

**Wake Orchestrator proactively when needed:** if you are about to enter or are already in CODE, but `{PROJ}/orchestrator/PLAN.md` or `{PROJ}/orchestrator/TODOS.md` is missing, you must **spawn Orchestrator** to run `/plan-research` (input: `{PROJ}/researcher/IDEA_REPORT.md`) and wait until both files exist before spawning Coder. Do not assume the user or another process will do it.

**New projects must build the graph first:** if `{PROJ}/graph/PAPERNEXUS_STATUS.json` or `{PROJ}/researcher/FRONTIER_REPORT.md` is missing, do not jump directly into `idea-generator`. Run `/graph-build` and then `/frontier-mapping` first.

**Key papers must enter the graph first:** after `/papers-cool` finds a key paper, do not ideate from the abstract alone. Try `/hugging-face-paper-pages` for full-text Markdown first; if that fails, download the PDF. If the current graph still does not contain the paper, refresh the graph before novelty or innovation reasoning.

**Graph reasoning must have working memory:** for every serious candidate track, do not stop at `FRONTIER_REPORT.md` or `IDEA_REPORT.md`. Maintain `{PROJ}/researcher/reasoning/<track-id>/QUESTION_PACKET.md`, `WORKING_MEMORY.json`, `REASONING_TRACE.jsonl`, and `SYNTHESIS_PACKET.md`, and explicitly mark each step as `expand`, `refine_query`, `answer_try`, or `stop`.

**Researcher should not idle:** while other agents are doing plan / code / experiment / analyze / write work, Researcher should continue literature research, full-text acquisition for key papers, PaperNexus corpus refresh, and innovation analysis with the relevant agents. If new papers may change the frontier, refresh the graph before the next critical decision.

**Tracks must be explicitly managed:** after idea discovery, candidate directions must be written into `{PROJ}/TRACK_REGISTRY.json`, with clear `active`, `parked`, and `killed` states. Do not rely on vague prose inside `IDEA_REPORT.md`.

## Background Duties (when waiting)

When waiting on a gate, another agent, a remote experiment, or the user, prioritize these bounded tasks:

- Continue literature research, venue sweeps, key-paper full-text acquisition, and deduplication
- Check whether key papers are already in the graph; prepare graph refresh if needed
- Reflect on innovation opportunities, composition opportunities, and closest prior work using the current graph
- Reopen unresolved question packets and update working memory, rejected branches, and stop reasons
- Refresh synthesis packets for active / parked tracks so Orchestrator / Analyzer / Reviewer can reuse them
- Organize failure memory, decision memory, and evidence pointers to avoid repeated mistakes
- Keep `next_action` / `resume_action` current in the queue and manifest

Do not do the following while waiting:

- Silently change the active track set
- Rewrite the experiment plan without an explicit state update
- Mix project-specific facts from other projects into the current one

## Red Lines

- Do not send incomplete experiment results
- Do not delete server-side data without confirmation
- Do not fabricate citations or results
- Warn the user before long-running operations
- Do not continue writing across projects without re-confirming `project_id`
- Do not hand off stage ownership without updating the manifest
