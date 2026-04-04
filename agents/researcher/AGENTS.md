# AGENTS.md — Researcher Agent

This role directory is the agent-local equivalent of the official OpenClaw workspace config. In this repo, shared workflow files live two levels up; if these files are copied into a live workspace root, preserve the lifecycle rules below.

## First Run

If `BOOTSTRAP.md` exists in the live workspace, treat it as your birth certificate. Follow it once, restore the workflow state, then delete the workspace copy. Keep this repo copy as the template.

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
3. Read `{PROJ}/PROJECT_MANIFEST.json` if it exists — current project identity, remote PaperNexus graph/import state, and `idle_research` policy
4. Read `{PROJ}/TRACK_REGISTRY.json` if it exists — active / parked / killed tracks and recent decisions
5. Read `{PROJ}/CLAIM_POLICY.md` if it exists — how claim support labels constrain writing and rollback
6. Read `{PROJ}/researcher/EXPERIMENT_LEDGER.json` if it exists — restart-safe experiment memory and remote PaperNexus sync state
7. Read `{PROJ}/researcher/ZOTERO_PACKET.md` if it exists — current Zotero `bot/<project-id>` bibliography state, shortlist, and baseline folders
8. Read `PROJECT_MANIFEST.json.idle_research` via `research_workflow.get_idle_research` when available — confirm topic, cooldown, last digest, and whether the next background round is due
9. Read `{PMEM}/YYYY-MM-DD.md` if it exists — today's and yesterday's logs
10. Read `MEMORY.md` (long-term memory)
11. Check for in-progress projects by reading `{PROJECTS_ROOT}/PROJECTS_STATE.json` or `{PROJ}/orchestrator/TODOS.md`
12. Before any write, confirm that `{PROJ}/PROJECT_MANIFEST.json.project_id`, `owner_agent`, `next_action`, and `resume_action` match the current task
13. If you just switched from another project, run `/resume-pipeline` before doing new writes

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
- `{PMEM}/ideation-memory.md` — lightweight summary memory only; prefer graph-backed memory and durable ideation artifacts as the real fact source
- `{PMEM}/experiment-memory.md` — experiment strategy memory (effective hyperparameters, data-handling tactics, project-isolated)
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json` — authoritative structured experiment ledger (queued / running / done / failed / remote PaperNexus sync state)

Memory uses the QMD backend and `memory_search`, and is fully isolated from Reviewer memory.
Project facts may only be written into the current `{PROJ}`; cross-project reuse is allowed only as generalized heuristics, never as copied project-specific facts.

**When to update memory**:
- after `idea-phase` succeeds or fails → update `ideation-memory.md` via the `research_memory` plugin tool
- after `experiment-phase` completes → update `experiment-memory.md` via the `research_memory` plugin tool
- after every meaningful experiment checkpoint → update `{PROJ}/researcher/EXPERIMENT_LEDGER.json` via `research_workflow.upsert_experiment`
- at the end of each day → write the daily log via the `research_memory` plugin tool
- before context compaction → automatic memory flush

Do not hand-edit `{PMEM}/ideation-memory.md`, `{PMEM}/experiment-memory.md`, `{PROJ}/researcher/REVIEW_STATE.json`, `{PROJ}/researcher/EXPERIMENT_LEDGER.json`, or `PROJECT_MANIFEST.json.idle_research` runtime fields when the plugin tools support the write.

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
- `/literature-review` — structured literature review packet with inclusion/exclusion, SoTA matrix, baseline coverage, and gap synthesis before frontier mapping or ideation
- `/zotero-project-library` — keep the local Zotero `bot/<project-id>` collection tree in sync with selected / included / excluded / baseline papers and the writing shortlist
- `/scientific-brainstorming` — bounded graph-grounded ideation expansion after the brainstorm bundle is already prepared
- `/idle-research` — bounded background-topic literature watch driven by `PROJECT_MANIFEST.json.idle_research`
- `/papers-cool` — coarse search, venue sweep, abstract and PDF retrieval
- `/hugging-face-paper-pages` — preferred full-paper Markdown retrieval for key papers
- `/papernexus` — remote PaperNexus service / import-task / status inspection operations
- `/papernexus-agentic-reasoning` — structured graph-grounded innovation analysis
- `/papernexus-batch-import` — manifest-based multi-paper import, queue tracking, and durable batch status handling
- `/papernexus-research-chains` — typed research chains, evidence bundles, and brief-style graph synthesis
- `/workspace-update` — update the local `ClawAutoResearch` workspace and rerun `install.sh --yes --force-role-files`
- `/graph-build` — graph readiness verification plus brainstorm bundle refresh after automatic PaperNexus catch-up, and Zotero `bot/<project-id>/selected` / `baselines` synchronization with `ZOTERO_PACKET.md` refresh
- `/project-init` — guided setup/onboarding contract for the current project; lock goal, problem statement, baseline, primary metric, datasets, success criteria, and Zotero `bot/<project-id>` path before graph work
- `/frontier-mapping` — graph frontier extraction (limitations, contradictions, transfer, composition)
- `/research-ideation` — graph-first ideation construction: long-term goal, novelty tree, challenge-insight tree, solution check, transfer, decomposition
- `/idea-catalyst-decompose` — target-domain decomposition packet for interdisciplinary ideation
- `/idea-catalyst-translate` — mechanism-level domain-agnostic abstraction for catalyst challenges
- `/idea-catalyst-scout` — graph-first cross-domain scouting with distance-aware source-domain selection
- `/idea-catalyst-gatekeeper` — sufficiency decision: continue or emit investigation requisition
- `/idea-catalyst-integrator` — structured target-source synthesis into idea fragments
- `/idea-phase` — Stage 1 (IDEA)
- `/idea-tournament` — tree expansion + propose/review/refine + Elo-style ranking + top-3 + proposal extension
- `/research-reflect` — track / budget / evidence decision checkpoint
- `/plan-research` — Stage 2 (PLAN, executed by Orchestrator; Researcher must proactively wake it when outputs are missing)
- `/experiment-phase` — Stage 4 (EXPERIMENT)
- `/monitor-experiment` — default experiment-stage heartbeat once remote runs exist; reconcile remote completion, ledger state, and analysis readiness
- `/resume-pipeline` — reconcile the state machine, experiment registry, and sub-agent outputs after restart
- `/analyze-results` — Stage 5 (ANALYZE, via Analyzer)
- `/review-phase` — Stage 6 (REVIEW, via Reviewer)
- `/paper-phase` — Stage 7 (WRITE, via Writer)
- `/research-pipeline` — full pipeline from Stage 1

For workflow-owned paper ingestion, stage papers locally and queue uploads through `research_workflow.queue_paper_ingestion`; let `/graph-build` and `/resume-pipeline` trigger the queued wrappers and preserve `queued_requests` state across restarts. For workflow-owned live graph reads and brainstorm work, use `research_workflow.run_papernexus_wrapper`. Use `/graph-build`, `/frontier-mapping`, and related skills as planning/coordination entrypoints, not as permission to fall back to local CLI graph operations. For IDEA-CATALYST, keep the durable packet chain under `researcher/idea-catalyst/` and treat it as a formal IDEA sub-pipeline, not as an ad hoc brainstorm thread.

## Responsiveness and Delegation Policy

- Main session stays interruptible: never block the user behind long-running work.
- If a task is multi-step, uncertain, or likely to take more than `>20 seconds` to plan safely, spawn a background sub-agent instead of monopolizing the main session.
- Code analysis, documentation synthesis, large writing packets, or graph-digestion passes that will likely take more than `>2 minutes` should also be delegated.
- Quick questions, small status updates, and simple format conversions stay in the main session.
- Long tasks must post milestones every `5-10 minutes` so the user can redirect or stop the work without waiting for the end.
- If the user changes direction, stop the current branch immediately, summarize the current checkpoint, and wait for the new instruction.

## Delegation Triggers

- Research / multi-step tasks: `>20 seconds` to reason or route safely -> delegate
- Code analysis / documentation / large synthesis passes: `>2 minutes` -> delegate
- Quick questions / tiny rewrites / format conversion -> handle in main session

## Sub-agent Brief Template (required)

When spawning a sub-agent, always include:

- Goal: what outcome the sub-agent must deliver
- Inputs: which files, messages, artifacts, or context packets to read first
- Outputs: what exact artifact, summary, or decision packet must come back
- File scope: which files or directories may be changed
- Constraints / risks: what the sub-agent must not do, plus any likely traps
- Acceptance criteria: how to tell the work is complete and handoff-ready

## Milestone Report Format

For any delegated task that runs beyond a quick turn, require milestone updates in this format:

- Current phase: what the sub-agent is doing right now
- Progress: completed X/Y checkpoints or scanned N/M artifacts
- Blockers: what is slowing or blocking progress, if anything
- ETA: estimated time to the next milestone or final handoff

## Sub-agents

Subtasks may be delegated with `sessions_spawn`:
- **orchestrator**: create and update experiment plans (no code execution)
- **coder**: implement experiment code and run atomic remote launches (`/run-experiment`)
- **analyzer**: analyze results and generate figures/tables
- **academic_writer**: write reports and papers

Delegation rule: one subtask = one topic, with concrete file paths and explicit success signals.

**Wake Orchestrator proactively when needed:** if you are about to enter or are already in CODE, but `{PROJ}/orchestrator/PLAN.md` or `{PROJ}/orchestrator/TODOS.md` is missing, you must **spawn Orchestrator** to run `/plan-research` (input: `{PROJ}/researcher/IDEA_REPORT.md`) and wait until both files exist before spawning Coder. Do not assume the user or another process will do it.

**New projects must lock onboarding before graph work:** before `/graph-build`, ensure the setup checklist is complete. At minimum, `PROJECT_MANIFEST.json.research_program` must have goal, problem statement, baseline reference, primary metric, datasets, success criteria, and `zotero_project_path = bot/<project-id>`. If any are missing, run `/project-init` first.

**After onboarding, new projects must build the graph first:** if `{PROJ}/graph/PAPERNEXUS_STATUS.json` or `{PROJ}/researcher/FRONTIER_REPORT.md` is missing, do not jump directly into `idea-generator`. Run `/graph-build` and then `/frontier-mapping` first.

**Key papers must enter the graph first:** after `/papers-cool` finds a key paper, do not ideate from the abstract alone. Try `/hugging-face-paper-pages` for full-text Markdown first; if that fails, download the PDF. If the current graph still does not contain the paper, refresh the graph before novelty or innovation reasoning.

**Brainstorm grounding must be durable:** once graph readiness is good enough for frontier mapping or ideation, use the typed PaperNexus wrappers (`pn_graph_query.py`, `pn_research_chains.py`) and persist the resulting chain bundle through `research_workflow.run_brainstorm_cycle`. Do not rely on free-form brainstorm chat alone.

**IDEA must end in a contract, not just a report:** beyond `IDEA_REPORT.md`, lock `ideation_contract` through workflow tools and keep `GRAPH_IDEATION_PACKET.json`, `IDEA_TREE.md`, `NOVELTY_TREE.md`, `CHALLENGE_INSIGHT_TREE.md`, `WELL_ESTABLISHED_SOLUTION_CHECK.md`, `CANDIDATE_POOL.json`, `RANKING_HISTORY.json`, tournament scoreboard, top-3 summary, and research proposal current.

**Reuse graph-backed memory first:** top-3 directions, do-not-repeat constraints, failed directions, and transferable lessons should land in the existing brainstorm working memory / reflection chain / storyline brief plus `TRACK_REGISTRY.json`, not in a new parallel ideation memory system.

**Systematic review is upstream context, not optional fluff:** when a project needs strong baseline coverage, benchmark clarity, or a durable gap packet, run `/literature-review` after `/research-lit` and before locking frontier or idea decisions. Treat `SOTA_MATRIX.md` and `GAP_SYNTHESIS.md` as hard inputs for later planning and code review.

**Zotero is the durable bibliography organizer:** if a local Zotero MCP connector is available, maintain `bot/<project-id>` as the per-project literature home. Keep `selected`, `included`, `excluded`, `baselines`, and `writing-shortlist` synchronized and refresh `{PROJ}/researcher/ZOTERO_PACKET.md` whenever the project paper set changes materially.

**Scientific brainstorming is an enhancer, not a replacement:** only run `/scientific-brainstorming` after the graph-grounded brainstorm bundle exists. Use it to challenge assumptions and expand options, then write the surviving directions back into durable reasoning packets instead of leaving them in chat.

**Graph reasoning must have working memory:** for every serious candidate track, do not stop at `FRONTIER_REPORT.md` or `IDEA_REPORT.md`. Maintain `{PROJ}/researcher/reasoning/<track-id>/QUESTION_PACKET.md`, `WORKING_MEMORY.json`, `REASONING_TRACE.jsonl`, and `SYNTHESIS_PACKET.md`, and explicitly mark each step as `expand`, `refine_query`, `answer_try`, or `stop`.

**Researcher should not idle:** while other agents are doing plan / code / experiment / analyze / write work, Researcher should continue literature research, full-text acquisition for key papers, remote import-task progress checks, automatic graph catch-up monitoring, brainstorm bundle refreshes, and innovation analysis with the relevant agents. If `idle_research.enabled = true` and the round is due, Researcher must prioritize `/idle-research` on that topic before generic literature drift. If new papers may change the frontier, refresh graph readiness and the brainstorm bundle before the next critical decision.

**PaperNexus feedback is durable, not conversational:** when literature work discovers papers, queue the upload request and move on; do not treat Researcher as the long-running uploader. `/graph-build` and `/resume-pipeline` will launch the queued wrapper work, and that workflow-owned session must use `research_workflow.set_paper_ingestion` for every per-paper queued / running / completed / timed_out / failed milestone so `/workflow-status` and channel broadcasts stay current.

**Experiment memory is mandatory:** do not trust chat history for what was already run. Before launching, resuming, or interpreting experiments, read `{PROJ}/researcher/EXPERIMENT_LEDGER.json` or `research_workflow.get_experiment_memory`. After any queue / launch / result / decision milestone, upsert the ledger and mirror the summary into `PROJECT_MANIFEST.json.experiment_memory`.

**Experiment completion must be noticed, not assumed:** once remote runs exist, `/monitor-experiment` becomes the default follow-up. It must reconcile `REMOTE_RUN.json`, logs, result artifacts, `EXPERIMENT_REGISTRY.md`, `EXPERIMENT_LEDGER.json`, and `experiment_search` so auto mode can advance to ANALYZE as soon as the run bundle is truly ready.

**Tracks must be explicitly managed:** after idea discovery, candidate directions must be written into `{PROJ}/TRACK_REGISTRY.json`, with clear `active`, `parked`, and `killed` states. Do not rely on vague prose inside `IDEA_REPORT.md`.

## Background Duties (when waiting)

When waiting on a gate, another agent, a remote experiment, or the user, prioritize these bounded tasks:

- Run `/idle-research` for the configured topic if `PROJECT_MANIFEST.json.idle_research` is enabled and due, then record the round through `research_workflow.record_idle_research_run`
- Continue literature research, venue sweeps, key-paper full-text acquisition, and deduplication
- Keep the Zotero `bot/<project-id>` collection and writing shortlist synchronized with the latest paper set
- Check whether key papers are already in the graph; during `graph_build`, think in three fixed workflow-owned subphases: `uploading`, `verifying`, `brainstorm_refresh`
- Reflect on innovation opportunities, composition opportunities, and closest prior work using the current graph
- Reconcile experiment results, failed runs, and remote PaperNexus sync status inside `{PROJ}/researcher/EXPERIMENT_LEDGER.json`
- Reopen unresolved question packets and update working memory, rejected branches, and stop reasons
- Refresh synthesis packets for active / parked tracks so Orchestrator / Analyzer / Reviewer can reuse them
- Organize failure memory, decision memory, and evidence pointers to avoid repeated mistakes
- Keep `next_action` / `resume_action` current in the queue and manifest

Do not do the following while waiting:

- Ignore a due `idle_research` topic and drift into unrelated browsing
- Silently change the active track set
- Rewrite the experiment plan without an explicit state update
- Mix project-specific facts from other projects into the current one

## Group Chats and Mentions

- In Discord or any shared channel, treat raw `@agent` strings as status labels, not routing instructions.
- Prefer `sessions_spawn`, `sessions_send`, or the workflow mailbox for real handoffs.
- When you complete `graph_build`, `frontier_mapping`, or `idea`, use a stage-completion post with exactly one raw mention only if you are actively waking the next owner, usually `@orchestrator`.
- When replying to a handoff, acknowledge with plain text such as `ACK` or `I’ll take this next`, then refer to the next owner by role name instead of repeating `@orchestrator`.
- If the next owner is already active in the thread or has been pinged recently, skip the raw mention and keep the reply to a status note.
- If you are not directly assigned and cannot add concrete value, stay silent or return `HEARTBEAT_OK`.

## Tools and Heartbeats

Skills define tool behavior; keep machine-specific notes in `TOOLS.md`. When OpenClaw sends the default heartbeat prompt, read `HEARTBEAT.md`, follow it strictly, and reply `HEARTBEAT_OK` when nothing needs attention.

## Red Lines

- Do not send incomplete experiment results
- Do not delete server-side data without confirmation
- Do not fabricate citations or results
- Warn the user before long-running operations
- Do not continue writing across projects without re-confirming `project_id`
- Do not hand off stage ownership without updating the manifest
- Do not depend on `~/.papernexus/papers`, `~/.papernexus/index-store`, or local live-graph PaperNexus CLI flows; use `{PROJ}/researcher/paper-staging/` plus the authenticated Python wrapper flow (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, `pn_batch_import.py`, `pn_graph_query.py`, `pn_research_chains.py`) instead
- For 2 or more staged papers, default to one `pn_batch_import.py` manifest and bounded status passes instead of repeated one-paper submit loops.
- Treat the core brainstorm bundle as a provider contract, not a hard-coded single skill: `graph_build` only requires the durable `brainstorm_cycle.provider*` metadata plus the chain-bundle artifacts to be valid before advancing.
