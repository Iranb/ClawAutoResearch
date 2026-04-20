# Slash Commands

This page summarizes the slash commands currently registered by the system.

## 1. Project bootstrap and startup

| Command | Role | Typical use |
| --- | --- | --- |
| `/project-init` | initialize or refresh onboarding state | when a project exists but onboarding is still incomplete |
| `/auto-research "topic"` | start the experiment workflow from a topic | when you want to create and launch an experiment project directly |
| `/auto-review "topic"` | start the survey workflow from a topic | when you want to create and launch a survey project directly |
| `/clear-project-binding` | clear the current workflow binding | when the current channel is bound to the wrong project |

## 2. Main workflow progression

| Command | Role | Typical use |
| --- | --- | --- |
| `/research-pipeline` | continue the experiment-paper workflow | when a normal research project should keep moving |
| `/survey-pipeline "topic"` | run the survey workflow line | when you want the survey packet and survey writing path |
| `/research-queue` | advance multiple projects in a queue | when you are managing more than one project |
| `/resume-pipeline` | recover from durable workflow state | when context is lost or a session has been interrupted |

## 3. Graph, literature, and survey collection

| Command | Role | Typical use |
| --- | --- | --- |
| `/graph-build` | refresh graph readiness | when graph presence is missing or stale |
| `/literature-review` | run a bounded literature review pass | when you want a focused literature refresh |
| `/survey-graph-build` | build survey-focused graph candidates | when survey collection should prioritize graph-missing, strongly deduplicated papers |
| `/broad-paper-search` | run multi-provider broad paper search | when you want wide literature recall with durable merged candidates |
| `/idea-catalyst-search` | run IDEA-CATALYST cross-domain search | when the idea stage needs cross-domain scouting |
| `/zotero-sync` | sync the current project’s paper set to Zotero | when you want the literature set copied into Zotero |
| `/papernexus-stage-remote` | upload staged sources to remote PaperNexus staging | when local sources are ready for remote staging |

## 4. Status and diagnostics

| Command | Role | Typical use |
| --- | --- | --- |
| `/workflow-status` | inspect current stage, owner, blockers, and runtime health | the default first place to look |
| `/handoff-status` | inspect the handoff state machine | when ownership seems to have changed but no one picked work up |
| `/capture-diagnostics` | collect a bounded diagnostic bundle | when you want snapshot, queue, mailbox, graph, and runtime evidence together |
| `/show-commands` | list available commands and short descriptions | when you only need a quick in-session reminder |

## 5. Writing and closeout

| Command | Role | Typical use |
| --- | --- | --- |
| `/citation-calibrate` | refresh citation calibration | before submit or writing closeout |
| `/authoring-closeout` | run deterministic authoring closeout | when the manuscript exists but review / QC / citation state still needs reconciliation |
