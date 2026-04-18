# Generic Paper Writing Checklist for Agent

Intended for: a writing agent drafting, revising, expanding, or reorganizing an academic paper.

Goal: turn an incomplete or inconsistent draft into a coherent, credible, submission-ready manuscript without inventing claims, results, or citations.

## Mission

You are working on a real paper draft, not generating generic academic-sounding prose.

Your first responsibility is to make the manuscript internally consistent. Style comes later.

Before polishing language, make sure the paper is aligned across:

- title
- abstract
- introduction
- method or framework
- experiments or evaluation
- figures and tables
- discussion
- conclusion

If internal consistency is still broken, do not treat the draft as ready for cosmetic polishing.

## Non-Negotiable Rules

- Do not invent citations, data, experiments, or results.
- Do not leave contradictory paper identities in the same manuscript.
- Do not keep placeholder text such as `Table ??`, `Figure ??`, or unresolved notes.
- Do not present unfair baseline comparisons without explicit qualification.
- Do not write stronger claims than the evidence supports.
- Do not silently preserve residual text from older draft directions.

## Phase 0: Establish the Source of Truth

Complete these items before rewriting major sections.

- [ ] Identify the canonical paper title or working title.
- [ ] Identify the canonical core problem the paper solves.
- [ ] Identify the canonical method, framework, or thesis of the paper.
- [ ] Identify the final scope: datasets, tasks, theory coverage, or case studies actually included.
- [ ] Identify which results, claims, and citations are confirmed versus still uncertain.
- [ ] Identify the baseline set or comparison frame used in the final paper.
- [ ] Remove or mark any text that belongs to abandoned draft directions.

If any of the above is unresolved, mark it as `author decision required` instead of guessing.

## Phase 1: Align Title, Abstract, and Contributions

- [ ] The title matches the actual paper content.
- [ ] The abstract describes the same paper that the body presents.
- [ ] The introduction promises only what the paper later delivers.
- [ ] The contribution list matches the actual sections and evidence.
- [ ] Every major contribution has support in the manuscript.
- [ ] The abstract does not overclaim beyond the reported evidence.

### Abstract-Specific Checks

- [ ] Distinguish average results from best-case results when relevant.
- [ ] Use cautious language when evidence is mixed or statistically weak.
- [ ] Mention limitations if they are central to interpreting the results.
- [ ] Avoid vague claims such as “significant progress” unless immediately made concrete.

## Phase 2: Repair the Introduction

- [ ] State the paper problem clearly and early.
- [ ] Explain why the problem matters.
- [ ] Summarize the gap in prior work accurately.
- [ ] Introduce only the final method, argument, or framework.
- [ ] Ensure the introduction uses the same terminology as the rest of the paper.
- [ ] Ensure the introduction sets up expectations the later paper can meet.

## Phase 3: Repair the Core Technical or Analytical Section

Use this phase for the method section, theory section, framework section, or analytical core of the paper.

- [ ] The manuscript presents one coherent central approach or argument.
- [ ] Figures, equations, algorithms, and captions match the text.
- [ ] Every claimed component appears in the actual paper body.
- [ ] Every equation or formal definition has a clear role.
- [ ] Claimed motivations match the implemented mechanism or actual analysis.
- [ ] No key concept appears in the abstract but disappears from the core section.

### Consistency Checks

- [ ] Title ↔ abstract ↔ core section use the same naming.
- [ ] Module names or concept names are stable across the manuscript.
- [ ] Definitions do not shift meaning across sections.
- [ ] Visual explanations and formal descriptions point to the same thing.

## Phase 4: Repair the Experimental or Evaluation Scope

If the paper is empirical or includes evaluation, complete these checks.

- [ ] The final evaluation scope is listed once and remains stable.
- [ ] All datasets, tasks, benchmarks, or case studies in the conclusion also appear in the results section.
- [ ] All main claims can be traced to actual tables, figures, or analyses.
- [ ] Metrics are defined consistently.
- [ ] Table and figure naming is stable and readable.

If the paper is non-empirical, reinterpret this phase as checking analytical scope, examples, case evidence, or proof coverage.

## Phase 5: Numerical Integrity and Comparison Fairness

- [ ] All claimed gains are arithmetically correct.
- [ ] Baseline values are stable across setup, results, and discussion.
- [ ] Means, standard deviations, best-run numbers, and single-case results are clearly distinguished.
- [ ] Comparisons are fair with respect to setting, protocol, model family, or evaluation scope.
- [ ] Any borrowed numbers from prior papers are clearly identified.
- [ ] Any non-comparable comparison is explicitly qualified.

## Phase 6: Write the Results or Findings Section Carefully

- [ ] Lead with the main finding, then interpret it.
- [ ] Separate robust findings from suggestive trends.
- [ ] Distinguish descriptive findings from causal interpretation.
- [ ] Avoid overstating ablations, case studies, or small-sample patterns.
- [ ] Keep the language proportional to the evidence.

### Result-Writing Rules

- [ ] Replace strong verbs with more precise ones when the evidence is limited.
- [ ] Avoid “consistent improvement” unless all highlighted evidence supports that phrase.
- [ ] Do not hide negative or mixed results when they materially affect the paper's claim.

## Phase 7: Repair Discussion and Conclusion

- [ ] The discussion interprets results without changing the paper scope.
- [ ] The conclusion summarizes only what the paper actually established.
- [ ] No new datasets, experiments, claims, or concepts appear for the first time in the conclusion.
- [ ] Limitations are acknowledged where needed.
- [ ] Future work follows naturally from actual evidence gaps.

## Phase 8: Appendix and Submission Readiness

- [ ] Replace every placeholder table, figure, and citation marker.
- [ ] Remove notes-to-self, unresolved comments, and draft residue.
- [ ] Ensure appendix claims match the main paper.
- [ ] Ensure ethics, licensing, data, or code statements match the actual manuscript.
- [ ] Ensure all cross-references resolve correctly.

## Optional Branches by Paper Type

### If the paper is a survey or review

- [ ] Scope is clearly defined.
- [ ] Inclusion logic matches the papers actually discussed.
- [ ] Taxonomy or framework has explicit criteria.
- [ ] Comparative claims are supported by stable dimensions.
- [ ] Open problems follow from earlier evidence.

### If the paper is an empirical methods paper

- [ ] Method identity is stable.
- [ ] Evaluation protocol is clear.
- [ ] Baseline comparison is fair.
- [ ] Reported improvement is reproducible and honestly described.

### If the paper is theoretical or analytical

- [ ] Definitions are precise and stable.
- [ ] Assumptions are explicit.
- [ ] Theorems, lemmas, or propositions are used consistently.
- [ ] Informal explanation matches the formal claims.

## Required Output Style From the Writing Agent

When revising a section, return:

### 1. Section Goal

- What section is being revised
- What problem or inconsistency is being fixed

### 2. Assumptions Used

- Title or method identity assumed
- Experiment or scope assumptions used
- Any unresolved author decisions

### 3. Revised Draft

Provide directly editable prose.

### 4. Remaining Issues

List unresolved items that still require author confirmation.

## Final Gate Before Claiming the Draft Is Improved

Do not claim the paper is cleaned up unless all of the following hold:

- [ ] One stable paper identity
- [ ] One stable scope
- [ ] No unresolved placeholder references
- [ ] No contradictory dataset, concept, or result mentions
- [ ] No arithmetic mismatch in claimed gains
- [ ] No unqualified unfair comparison
- [ ] Abstract, body, and conclusion now describe the same paper
