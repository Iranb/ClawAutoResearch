# AI Research Writing Skill Redesign

**Status:** Draft  
**Date:** 2026-03-26  
**Author:** Codex  
**Scope:** `/skills/academic_writer/ai-research-prompt` and its `awesome-ai-research-writing` prompt catalog

---

## 1. Goal

Redesign the current AI research writing prompt library from a human copy-paste prompt pack into an agent-first skill that is easier for Codex-style agents to discover, route, and execute consistently.

The final instruction surface should be in English.

---

## 2. Current Problems

The current skill has useful domain knowledge, but its structure is optimized for human prompt reuse rather than agent execution.

Main problems:

- `SKILL.md` mixes Chinese explanation with light routing logic.
- `README.md` is a human-facing catalog, not an execution-oriented index.
- `prompts/01-06` are mostly Chinese copy-paste templates instead of agent task specs.
- The documents tell a human what to paste, rather than telling an agent how to decide, what inputs to require, and what outputs to produce.
- The old `SKILL.md` still references prompt files `07` and `08`, which are no longer part of the active set.

---

## 3. Target Shape

The redesign keeps one entry skill and rewrites the prompt set into a consistent three-layer structure.

### 3.1 Entry Layer

`/skills/academic_writer/ai-research-prompt/SKILL.md`

Responsibilities:

- describe when to use the skill
- classify task categories
- route requests to the correct prompt file
- define shared academic-writing rules
- define how the agent should ask for missing inputs

This file should stay compact and searchable.

### 3.2 Execution Layer

`awesome-ai-research-writing/prompts/01-06`

Each file becomes an English task-spec document rather than a copy-paste prompt.

Each file should use a consistent agent-readable structure:

- purpose
- when to use
- required input
- optional input
- output contract
- hard constraints
- procedure
- failure modes

### 3.3 Reference Layer

`awesome-ai-research-writing/README.md`

Responsibilities:

- provide a concise English catalog for humans and agents
- summarize available task families
- explain how the entry skill routes into the prompt files
- avoid long instructional prose or copy-paste framing

---

## 4. Task Families

The active scope remains six task families.

1. Translation
2. Polish
3. Logic and review
4. De-AI rewriting
5. Figures and tables
6. Experiment analysis

The redesign should not depend on removed files `07` and `08`.

---

## 5. Design Principles

### 5.1 Agent-First

Every file should answer:

- when should the agent use this file?
- what input must the agent request or infer?
- what output shape should the agent produce?
- what must the agent avoid?

### 5.2 English Execution Surface

Instructions, routing rules, and output contracts should be written in English.

### 5.3 Strong Output Contracts

Each task family should specify:

- expected output sections
- whether the output should be prose, LaTeX, JSON-like structure, or short recommendations
- when the agent should preserve original text
- when the agent should refuse to invent unsupported claims or evidence

### 5.4 Shared Constraints Live Up Top

Repeated rules should move into `SKILL.md` where appropriate:

- do not invent citations
- preserve math
- preserve user intent
- avoid unnecessary formatting
- ask for missing source text when blocked

This reduces duplication inside the prompt files.

---

## 6. File-Level Plan

### 6.1 `SKILL.md`

Rewrite fully in English.

Add:

- frontmatter with a better discovery-oriented description
- a short overview
- task-routing table
- shared academic writing constraints
- guidance for missing-input handling

Remove:

- Chinese explanatory sections
- references to deleted `07` and `08`

### 6.2 `README.md`

Rewrite as an English catalog with:

- what this library is
- which task families exist
- how the top-level skill uses the prompt files
- short descriptions only

### 6.3 `prompts/01-translation.md`

Convert into an execution reference for:

- CN -> EN academic translation
- EN -> ZH literal explanation
- ZH -> ZH academic rewriting

### 6.4 `prompts/02-polish.md`

Convert into an execution reference for:

- shortening
- expansion
- English polish
- Chinese academic polish

### 6.5 `prompts/03-logic-and-review.md`

Convert into an execution reference for:

- minimal red-flag logic checking
- reviewer-style full-paper critique

### 6.6 `prompts/04-de-ai.md`

Convert into an execution reference for:

- English de-AI rewriting
- Chinese de-AI rewriting

### 6.7 `prompts/05-figures-tables.md`

Convert into an execution reference for:

- method-figure planning
- plot recommendation
- figure title generation
- table title generation

### 6.8 `prompts/06-experiments.md`

Convert into an execution reference for:

- experimental result interpretation
- LaTeX paragraph generation
- evidence-safe result narration

---

## 7. Validation Strategy

Add a lightweight repository test that checks:

- the skill files exist
- the top-level `SKILL.md` no longer references deleted prompt files
- the rewritten files use the required English structure markers
- the rewritten files do not contain CJK characters

This is not a full quality test, but it prevents regression back to the previous mixed-language prompt-pack format.

---

## 8. Non-Goals

This redesign does not:

- split the skill into six separate top-level skills
- add code generation behavior
- add PDF parsing or model-selection logic
- recreate deleted prompt files `07` and `08`

---

## 9. Success Criteria

The redesign is successful when:

- an agent can inspect `SKILL.md` and reliably route requests to the right prompt file
- the prompt files read like execution guides rather than user copy-paste templates
- the instruction surface is in English
- deleted prompt references are removed
- validation passes
