---
name: paper-review-checklist
description: "Multi-round paper review checklist for Reviewer. Use when reviewing a draft, near-final manuscript, or section and you need prioritized, actionable, publishability-oriented feedback instead of scattered comments."
argument-hint: "[full paper, section, or packet path]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - research_workflow
---

# Paper Review Checklist

Use this skill when Reviewer needs a durable, multi-round review discipline rather than ad hoc comments.

This skill complements:
- `review-phase`
- `paper-review`
- `review-response`

## Workflow Role

Treat this as the structured review checklist that should be reused every round.

Use it when:
- reviewing a full draft
- reviewing one section
- reviewing a near-submission paper
- reviewing a survey where methodology consistency matters

## Multi-Round Protocol

Run the review in ordered passes. Do not start with grammar.

### Round 1: Core Thesis and Publishability

Check:
- paper type
- target venue / destination
- core question
- main claims
- contributions
- title / abstract / introduction / conclusion alignment

Prioritize only `P0` and `P1` issues here.

### Round 2: Structure and Argument

Check:
- section order
- paragraph roles
- argument flow
- evidence support
- contradictions / limitations / boundary conditions

If Round 1 found fatal logic issues, do not bury them under stylistic notes.

### Round 3: Consistency and Academic Practice

Check:
- numbers / years / counts / settings consistency
- terminology stability
- tables / figures / prose consistency
- citation placement and representative coverage
- survey protocol consistency when applicable

### Round 4: Language and Expression

Only after the earlier passes:
- generic phrasing
- AI-like templated prose
- overloaded sentences
- terminology / tense / clarity issues

## Output Contract

Always return:

1. Overall assessment
2. Highest-priority issues (up to 5)
3. Structured review notes
4. Minor issues
5. Immediate next steps

Use this issue template:

- `Issue`
- `Why it matters`
- `How to fix it`

## Priority Discipline

Use:
- `P0` fatal
- `P1` major
- `P2` moderate
- `P3` minor

Do not let `P2/P3` comments obscure `P0/P1`.

## Survey-Specific Checks

If the paper is a survey, explicitly check:
- scope clarity
- search scope and time window
- inclusion/exclusion consistency
- taxonomy criteria
- comparison dimension stability
- whether open problems really follow from evidence

## Paper-Type Routing

Choose the reference checklist by paper type:

- generic / unclear / mixed draft:
  - [generic_paper_review_checklist.md](references/generic_paper_review_checklist.md)
- research / methods / empirical / theory paper:
  - [research_paper_review_checklist.md](references/research_paper_review_checklist.md)
- survey / review article:
  - [survey_paper_review_checklist.md](references/survey_paper_review_checklist.md)

If paper type is unclear:
- do the generic multi-round protocol in this file first
- then read the most likely reference and explicitly state the uncertainty
