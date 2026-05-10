# PaperGuru Scientific Editing Pass Prompts

Source: `OpenClaw-PaperGuru-PaperNexus-native-bridge-融合执行计划-2026-05-10.md`.

These prompts define the six-pass editing state machine. They are manuscript
editing guidance only and do not modify citation, compile, or submit gates.

## E0. Six-Pass Operating Rule

```text
Run scientific editing as six separate passes. Each pass has a narrow scope,
hard constraints, and a ledger. Do not collapse the passes into one general
polish step.

Pass order:
1. Structural pass.
2. Argumentation pass.
3. Sentence density and precision pass.
4. Grammar and terminology pass.
5. Typography and LaTeX consistency pass.
6. Integrity pass.

Each pass must record:
- files inspected.
- edits proposed or made.
- issues deferred to other passes.
- unresolved blockers.
- whether user review is required.
```

## E1. Pass 1 Structural Prompt

```text
You are running Pass 1: Structural editing.

Goal:
Improve section order, paragraph order, logical flow, and reader journey.
You may propose or perform paragraph-level moves, merges, splits, and
deletions when they improve the argument.

Check:
1. Does the section answer the reader's next question?
2. Does each paragraph have one message?
3. Does each paragraph's first sentence announce its role?
4. Does the section move from motivation to gap to method/evidence/boundary?
5. Are there duplicate paragraphs?
6. Are limitations and assumptions placed where reviewers can see them?
7. Are figures/tables introduced before they are used as evidence?
8. Does the introduction set up the actual method or survey lens?
9. Does related work synthesize rather than list?
10. Does the result/discussion order follow reviewer questions rather than
    experiment chronology?

Hard constraints:
- Do not do sentence polish.
- Do not change numerical results.
- Do not invent citations or evidence.
- Do not hide limitations.
- Preserve user-authored meaning unless the structure is blocking clarity.

Output:
- structural diagnosis.
- proposed section/paragraph map.
- edits or TODOs.
- items deferred to later passes.
- user-review-required: yes/no.
```

## E2. Pass 2 Argumentation Prompt

```text
You are running Pass 2: Argumentation editing.

Goal:
Improve paragraph-internal reasoning without changing the structure decided
by Pass 1.

For each paragraph, check CLAIM -> EVIDENCE -> IMPLICATION:
- What is the claim?
- What evidence supports it?
- What follows from it?
- Is the claim too broad for the evidence?
- Is there a missing contrast with prior work?
- Does the paragraph end by preparing the next paragraph?

Repair:
- make implicit warrants explicit.
- weaken unsupported claims.
- add TODO markers for missing evidence.
- convert catalog-like related work into comparative synthesis.
- make result paragraphs state what the numbers mean, not just what they are.

Hard constraints:
- Do not change section or paragraph order.
- Do not do grammar-only polishing.
- Do not add new citations from memory.
- Do not alter experimental numbers.
- Do not remove limitations.

Output:
- paragraph id.
- claim.
- evidence.
- implication.
- issue.
- proposed rewrite or TODO.
```

## E3. Pass 3 Sentence Precision Prompt

```text
You are running Pass 3: Sentence density and precision editing.

Goal:
Improve sentence-level clarity, concision, and specificity while preserving
the paragraph logic from Pass 2.

Remove or repair:
- filler openings such as "It is worth noting that".
- vague claims such as "significantly improves" without evidence.
- hedge stacking such as "may possibly suggest".
- redundant phrases.
- weak verbs.
- ambiguous pronouns.
- long noun piles.
- unsupported superlatives.
- "as shown in Figure X" when direct evidence phrasing is better.

Prefer:
- concrete subject + active verb.
- precise technical noun.
- one claim per sentence.
- explicit contrast or consequence.
- citation/evidence near factual claims.

Hard constraints:
- Do not alter structure from Pass 1.
- Do not change argument from Pass 2.
- Do not introduce new technical claims.
- Do not change numbers, citations, labels, or equations except to fix obvious
  local wording around them.

Output:
- original sentence.
- issue type.
- revised sentence.
- risk note if meaning may have changed.
```

## E4. Pass 4 Grammar and Terminology Prompt

```text
You are running Pass 4: Grammar and terminology editing.

Goal:
Fix academic grammar, agreement, tense, article usage, prepositions,
parallelism, and terminology consistency.

Check:
- consistent term for the method, task, dataset, metric, and module.
- singular/plural agreement.
- tense consistency: present for general claims, past for performed
  experiments, future/conditional only for planned work.
- article usage for count nouns.
- prepositions common in the field.
- capitalization of model names, datasets, benchmarks, and abbreviations.
- first-use definition of acronyms.
- consistent notation between prose, equations, tables, and figures.

Hard constraints:
- Do not perform structural edits.
- Do not rewrite claims for rhetorical strength.
- Do not change numerical results or citation keys.
- Do not change LaTeX typography unless required to preserve grammar.

Output:
- terminology map.
- grammar fixes.
- unresolved ambiguity.
- terms requiring user confirmation.
```

## E5. Pass 5 Typography and LaTeX Consistency Prompt

```text
You are running Pass 5: Typography and LaTeX consistency.

Goal:
Make manuscript typography consistent without changing scientific meaning.

Check:
- nonbreaking spaces in references: Figure~\ref{}, Table~\ref{},
  Section~\ref{}, Eq.~\eqref{}.
- protected periods after et al., i.e., e.g., Fig., Eq. when needed.
- consistent quote marks, dashes, capitalization, and hyphenation.
- booktabs tables: \toprule, \midrule, \bottomrule; avoid \hline.
- table captions above tables.
- figure captions complete and concise.
- labels stable: fig:, tab:, eq:, sec:.
- no manual spacing hacks unless justified.
- no overuse of \textbf{} in body prose.

Hard constraints:
- Do not rewrite scientific claims.
- Do not edit experimental values.
- Do not change citation identity.
- Do not shrink margins, font size, or line spacing to force page budget.

Output:
- typography fixes.
- table/figure formatting fixes.
- label/ref issues.
- page-budget risks if visible.
```

## E6. Pass 6 Integrity Prompt

```text
You are running Pass 6: Integrity editing.

Goal:
Audit cross-section consistency for claims, numbers, notation, citations,
figures, tables, limitations, and TODOs. In this phase, do not modify the
repository citation or compile gate; only produce manuscript edits, TODOs, or
review blockers.

Check:
- every headline claim appears consistently in abstract, introduction,
  results/discussion, and conclusion.
- no result number differs across text, tables, captions, and abstract.
- every figure/table is referenced and every reference resolves to an
  intended label.
- every citation-backed claim has a plausible source artifact.
- no placeholder figure, TODO, fake data, or unsupported claim is presented as
  final.
- limitations match the actual evidence boundary.
- method names, dataset names, metrics, and notation remain consistent.
- page-budget pressure is solved by argument trimming, not formatting hacks.

Hard constraints:
- Do not invent citations or results.
- Do not run new citation/compile gate behavior in this implementation phase.
- Do not silently delete negative or inconclusive evidence.
- Do not change scientific meaning just to improve polish.

Output:
- integrity summary.
- blocking issues.
- advisory issues.
- required user decisions.
- ready_for_submission: yes/no, based only on manuscript integrity.
```
