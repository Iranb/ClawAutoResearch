---
name: paper-revision-checklist
description: "Multi-round revision checklist for Academic Writer. Use when revising a paper or section after review so the next draft addresses core logic, structure, evidence, and consistency issues before polishing language."
argument-hint: "[section name, draft path, or 'full paper']"
allowed-tools:
  - Read
  - Grep
  - Glob
  - research_workflow
---

# Paper Revision Checklist

Use this skill as the Writer-side mirror of reviewer critique.

It complements:
- `paper-write`
- `paper-phase`
- `writing-hard-constraints`

## Goal

Do not treat revision as "polish everything a bit".

Treat revision as a bounded sequence of passes:

1. Fix the most publication-relevant issues first
2. Rebuild argument / evidence / structure where necessary
3. Only then do local wording and style cleanup

## Multi-Round Revision Order

### Round 1: Core Alignment Repair

Check and repair:
- title / abstract / introduction / conclusion alignment
- core question and main contribution wording
- whether the manuscript still says the same thing in all headline locations

### Round 2: Structure and Argument Repair

Check and repair:
- section job clarity
- paragraph role clarity
- argument flow
- evidence support for major claims
- overclaim / limitation / boundary language

### Round 3: Consistency Repair

Check and repair:
- counts, years, dataset names, settings, abbreviations
- table / figure / text consistency
- citation placement and wording consistency

### Round 4: Local Expression Cleanup

Only after the earlier rounds:
- generic phrasing
- AI-like tone
- overloaded sentences
- local grammar and wording

## Writer Rule

- Do not answer a `P0/P1` review issue with superficial rewording
- If the issue is structural, move / merge / rewrite sections
- If the issue is evidential, change the claim or add real support
- If the issue is consistency, fix all affected locations, not just one sentence

## Survey Upgrade

For survey papers, also check:
- scope / protocol consistency
- included / excluded set consistency
- taxonomy criteria stability
- comparison dimension stability
- open problems actually following from evidence

## Output Discipline

At the end of a revision pass, record:
- what changed
- which `P0/P1` issues are actually resolved
- which issues remain intentionally deferred

## Paper-Type Routing

Choose the reference checklist by paper type:

- generic / unclear / mixed draft:
  - [generic_paper_writing_checklist.md](references/generic_paper_writing_checklist.md)
- research / methods / empirical / theory paper:
  - [research_paper_writing_checklist.md](references/research_paper_writing_checklist.md)
- survey / review article:
  - [survey_paper_writing_agent_guide.md](references/survey_paper_writing_agent_guide.md)

If paper type is unclear:
- run the generic revision order in this file first
- then read the most likely paper-type reference and state any unresolved assumptions
