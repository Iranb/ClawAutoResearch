---
name: papernexus-agentic-reasoning
description: "Use the PaperNexus graph as structured memory for graph-grounded innovation analysis: query, inspect context, trace impact, brainstorm, and package evidence-backed opportunity hypotheses."
argument-hint: "[research objective or active topic]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# PaperNexus Agentic Reasoning

Use this skill after graph refresh is complete and the relevant papers are already in the corpus.

Use it when the goal is not just to retrieve graph facts, but to reason through a research problem step by step with the PaperNexus graph as structured memory.

## What This Skill Is For

This skill adapts agentic graph reasoning to the current PaperNexus system:

- use the graph as long-horizon structured memory
- use a small, disciplined tool set
- decompose hard research tasks into explicit steps
- keep evidence, uncertainty, and open gaps visible during reasoning

In PaperNexus, the usable memory layers are:

- the main research graph
- the lite graph read model
- theory, storyline, and reflection overlays

## Available Graph Memory

### Main graph node types

- `Paper`
- `Problem`
- `Method`
- `Claim`
- `Finding`
- `Evidence`
- `Limitation`
- `Assumption`
- `Dataset`
- `Benchmark`
- `Metric`
- `FutureDirection`

### Reflection overlay entities

- `Innovation`
- `Experiment`
- `Outcome`
- `Reflection`

### Useful edge patterns

- `Paper -> Problem / Method / Claim / Finding / Limitation / Assumption`
- `Claim -> Evidence`
- `Method -> Problem / Dataset / Benchmark / Assumption`
- `Problem -> Limitation / FutureDirection`
- `Innovation -> TESTED_BY -> Experiment`
- `Experiment -> PRODUCED -> Outcome`
- `Outcome -> SUMMARIZED_AS -> Reflection`

## Tool Policy: Less Is More

Prefer this order:

1. graph retrieval and traversal
2. theory / storyline / reflection overlays
3. external search or code only if the graph cannot answer the current sub-question

Do not start with broad search if the graph already contains enough structure to narrow the question.

Preferred commands:

- `papernexus query`
- `papernexus context`
- `papernexus impact`
- `papernexus ideas`
- `papernexus brainstorm`

## Core Loop

1. define one concrete research objective or question
2. ground it by resolving key entities and anchor nodes with `papernexus query`
3. inspect structure with `papernexus context`
4. trace dependencies or consequences with `papernexus impact`
5. after each hop, decide whether to `expand`, `refine_query`, `answer_try`, or `stop`
6. generate or refine opportunities with `papernexus ideas` and `papernexus brainstorm`
7. package the result as graph-backed innovation evidence and a bounded synthesis memo

Each step should end with one of:

- confirmed
- uncertain
- contradicted
- needs external evidence

## Mandatory Inputs

Do not run this reasoning loop unless all of the following exist:

- `{PROJ}/researcher/LITERATURE.md`
- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- non-empty `{PROJ}/graph/subgraphs/`

If a key paper was just discovered and is not in the graph yet, stop and return to `/research-lit` plus `/graph-build` first.

## Durable Reasoning Packet (mandatory)

Maintain a durable reasoning folder under `{PROJ}/researcher/reasoning/<track-id-or-slug>/` with:

- `QUESTION_PACKET.md`
- `WORKING_MEMORY.json`
- `REASONING_TRACE.jsonl`
- `SYNTHESIS_PACKET.md`

Minimum structure:

`QUESTION_PACKET.md`

```text
Objective:
Key entities:
Resolved anchors:
Unresolved aliases:
Closest prior work:
Initial stop condition:
```

`WORKING_MEMORY.json`

```json
{
  "current_query": "",
  "visited_anchors": [],
  "accepted_facts": [],
  "evidence_paths": [],
  "rejected_paths": [],
  "contradictions": [],
  "open_unknowns": [],
  "sufficiency_status": "insufficient",
  "next_action": ""
}
```

`REASONING_TRACE.jsonl`

Each line captures one reasoning step:

```json
{"step_id":1,"query":"","action":"expand","anchor_nodes":[],"kept_evidence":[],"rejected_evidence":[],"decision":"continue"}
```

Do not let the reasoning jump ahead without updating these files.

## How To Think With The Graph

For literature understanding, prefer:

`Problem -> Method -> Claim -> Evidence -> Limitation`

For theory support, prefer:

`Claim -> Assumption / Mechanism / Proof idea -> Failure mode`

For experiment reflection, prefer:

`Innovation -> Experiment -> Outcome -> Reflection`

For future work, prefer:

`Problem -> Limitation -> FutureDirection -> transferable Method`

## When To Use Enhancement Overlays

Use overlays when the raw graph alone is too flat.

Theory overlay:

- why might this work
- what assumptions does it rely on
- when would it fail

Storyline overlay:

- how does the paper persuade the reader
- what is the main narrative thread
- where does the argument jump too fast

Reflection overlay:

- what is the core innovation
- what experiments actually tested it
- did the evidence indicate success, failure, or mixed results
- what lesson should transfer into future work

## Output Structure

For each candidate innovation, preserve:

- anchor graph nodes
- relation patterns
- closest prior work
- why-now
- weakest assumption
- one pilot
- one falsifier

For narrative output, prefer:

```text
Question:
Anchor graph nodes:
Stepwise reasoning:
Conclusion:
Confidence:
Open risks:
Next best action:
```

Write these signals into:

- `{PROJ}/researcher/FRONTIER_REPORT.md`
- `{PROJ}/researcher/IDEA_REPORT.md`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/researcher/reasoning/<track-id-or-slug>/SYNTHESIS_PACKET.md`

## Stepwise Reasoning Rules

- each step should cite a graph fact, overlay fact, or explicit inference
- mark inferences as inferences
- do not collapse evidence and conclusion into one sentence
- surface contradictions instead of smoothing them over
- after each step, attempt a bounded answer or innovation update before expanding further
- if a retrieved relation or neighborhood is not helping, record it in `rejected_paths` instead of revisiting it later

## Stop Rules

Stop the loop when any of the following becomes true:

- the current evidence paths are sufficient to support a bounded answer or innovation memo
- additional expansion mostly revisits already explored anchors or relations
- contradiction or missing graph coverage requires corpus refresh or external escalation
- the hop or iteration budget is exhausted

When the loop stops, `SYNTHESIS_PACKET.md` must explicitly separate:

- graph or source-backed facts
- higher-level inference
- open uncertainty or unresolved conflict

## Dynamic Update Rules

If source papers changed, refresh the graph before trusting the reasoning state:

```bash
papernexus analyze --force --corpus <name>
papernexus enhance --once --corpus <name>
```

If `watch` / `serve` are healthy, prefer them to keep the graph fresh during ongoing research.

For long-running usage, monitor:

```bash
papernexus service status --services watch,serve
```

## Mutation Decision Policy

During reasoning, do not jump from "this seems wrong" to editing the graph.

Default stance:

- treat the graph as read-only for reasoning unless there is a clearly identifiable error
- if the graph is missing a useful concept that is directly supported, prefer adding a new node or edge instead of rewriting existing ones

Use this policy:

1. retrieve the relevant graph neighborhood first
2. inspect theory, storyline, or reflection overlays if available
3. decide whether the issue is a clear factual graph error or only an interpretation gap
4. mutate only if the correction is explicit, local, and high-confidence, or if a new node or edge can be added with direct source support

Prefer not to mutate when:

- the issue is really uncertainty in the source paper
- the claim needs more evidence rather than a graph edit
- the conclusion depends on interpretation or synthesis
- the better action is to record a limitation, reflection, or open question
- the proposed change mainly rewrites an existing node, label, or relationship rather than extending the graph with new supported structure

If mutation is truly needed:

- use `mutate_graph` with `dryRun: true` first
- treat edits as local curation, not permanent truth
- remember that a later rebuild can overwrite them

Prefer additive mutation over destructive mutation:

- add a new node when the graph lacks a directly supported concept
- add a new edge when a supported relation is absent
- edit an existing node or edge only when the current one is clearly wrong

## Handoff Rule

Researcher owns graph-grounded innovation analysis.
If a track survives and needs to be turned into a bounded experiment program, hand the graph evidence packet, reasoning packet, and synthesis packet to Orchestrator via `/plan-research`.
