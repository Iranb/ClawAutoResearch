---
name: papernexus
description: Use when working in PaperNexus and the task touches a live corpus, remote graph build, queued imports, or authenticated graph-backed reasoning.
---

# PaperNexus

Use this skill when the task is about a live PaperNexus corpus or the PaperNexus repository.

## Primary Rule

For workflow-owned work, do not treat raw HTTP routes or local live-graph CLI commands as the default control plane.

Prefer these paths, in order:

1. `research_workflow.queue_paper_ingestion`
2. `research_workflow.run_papernexus_wrapper`
3. the local Python wrappers in `scripts/`

Use local repo CLI stages only for isolated repository development or fixture debugging, not for a live shared graph.

## Workflow-Owned Entry Points

When you are inside the OpenClaw research workflow:

- queue uploads with `research_workflow.queue_paper_ingestion`
- let `/graph-build` or `/resume-pipeline` trigger upload work
- use `research_workflow.run_papernexus_wrapper` for live graph reads, reasoning, and bounded queue inspection

The wrapper-first commands are:

- `python3 scripts/pn_stage_sync.py`
- `python3 scripts/pn_import_submit.py`
- `python3 scripts/pn_import_queue.py`
- `python3 scripts/pn_batch_import.py`
- `python3 scripts/pn_graph_query.py`
- `python3 scripts/pn_research_chains.py`

Why:

- auth and request shape stay consistent
- workflow state can persist progress durably
- batch uploads become manifest-driven instead of shell-loop driven
- graph reads stay aligned with the same remote corpus settings

## Upload Policy

For one local paper:

- stage and submit through `pn_import_submit.py`

For two or more local papers:

- prefer one manifest-driven `pn_batch_import.py` flow

For explicit directory staging:

- use `pn_stage_sync.py` first
- then submit one staged file at a time, or use a batch manifest

Do not default to:

- handwritten shell loops
- manual task-id copying when `pn_import_queue.py` can resolve by `--paper-id` or `--source`
- local live-graph CLI rebuilds for workflow-owned graph refresh

## Graph Read Policy

Use graph reads through:

- `research_workflow.run_papernexus_wrapper`
- `python3 scripts/pn_graph_query.py`
- `python3 scripts/pn_research_chains.py`

Typical uses:

- `pn_graph_query.py query|context|impact|ideas|brainstorm`
- `pn_research_chains.py path-trace|evidence-chain|reflection-chain|research-brief|brainstorm-brief|theory-brief|storyline-brief|paper-enhancement`

If the wrappers cannot express a needed operation:

- report the missing capability
- do not silently fall back to local live-graph CLI against the shared corpus

## Queue Inspection Policy

When asked whether an import is queued, running, or done:

- use `pn_import_queue.py status`

When asked what it is doing right now:

- use `pn_import_queue.py log`

When waiting for completion in a bounded workflow pass:

- use `pn_import_queue.py wait`

Prefer `--paper-id` or `--source` over manually copying task ids.

## Minimal Examples

Single-file staging and submit:

```bash
python3 scripts/pn_import_submit.py \
  --api-base "http://<host>:4821" \
  --corpus "<corpus>" \
  --paper-id "paper-id" \
  --source "/absolute/path/paper.pdf" \
  --ssh-target "<ssh-target>"
```

Batch manifest submit:

```bash
python3 scripts/pn_batch_import.py \
  --api-base "http://<host>:4821" \
  --corpus "<corpus>" \
  --manifest "/absolute/path/batch-import.json" \
  submit
```

Typed graph read:

```bash
python3 scripts/pn_graph_query.py \
  --api-base "http://<host>:4821" \
  --corpus "<corpus>" \
  query "topic" --limit 8
```

Typed reasoning chain:

```bash
python3 scripts/pn_research_chains.py \
  --api-base "http://<host>:4821" \
  --corpus "<corpus>" \
  evidence-chain "topic" --limit 5
```

## Remote-Only Notes

- assume the authoritative graph is remote and shared
- use `{PROJ}/researcher/paper-staging/` for temporary local staging
- preserve progress through workflow-owned runtime state, not chat memory
- if a live import or graph read fails, report the exact wrapper step and recent evidence instead of guessing

## Do Not Do

- do not use local live-graph query or ideation CLI commands as the primary interface for a live workflow
- do not rebuild the shared graph locally just to inspect one project
- do not bypass `run_papernexus_wrapper` when the task belongs to workflow-owned graph work
