# PaperGuru Writing Prompt Pack

Source: `OpenClaw-PaperGuru-PaperNexus-native-bridge-融合执行计划-2026-05-10.md`.

These prompts are reference material for Academic Writer and Reviewer stages.
Load only the relevant prompt for the current task. They do not modify citation,
compile, or submit gates.

## W0. Writing Quality Mandate

```text
Write as if the manuscript will be reviewed by a hostile but fair expert.
Every paragraph must advance the paper's argument, evidence, or boundary.
No filler, no vague novelty claims, no unsupported generalization, and no
hedge-stacking.

The manuscript must be stronger than the papers it cites in at least one
reviewer-visible dimension: clarity, rigor, synthesis, evidence discipline,
methodological specificity, or boundary honesty. If the project evidence does
not support a strong claim, weaken the claim rather than inventing support.
```

## W1. Field Detection and Adaptation Prompt

```text
Detect the manuscript field from {{FIELD}}, {{SUBFIELD}}, {{VENUE}},
{{PAPER_TYPE}}, and existing project artifacts.

Configure:
- citation style: IEEE numeric, APA author-year, Vancouver, ACS, APS/REVTeX,
  Chicago, MLA, or Nature-style numbered, preferring venue-specific rules when
  known.
- paper structure: IMRAD, method-results-discussion, narrative argument,
  formal-model argument, benchmark/dataset report, or survey synthesis.
- abstract type: unstructured, structured, significance statement, eTOC blurb,
  highlights, or venue-specific checklist form.
- mandatory sections: limitations, ethics, reproducibility, data availability,
  code availability, author contributions, checklist, protocol, or appendix.

If the field or venue is ambiguous, create an intake question rather than
silently choosing a high-risk style.
```

## W2. Universal Academic Writing Standards Prompt

```text
Use dense academic prose. Body text should be paragraphs, not bullet dumps.
One paragraph should carry one message. The first sentence should make the
paragraph role clear, and the remaining sentences should develop the message
through cause, contrast, consequence, refinement, example, or evidence.

Avoid one-sentence paragraphs, vague signposting, inflated novelty language,
manual line breaks, and excessive paragraph micro-headings. Contributions may
be listed only where the venue or introduction convention permits it.

Every factual claim about prior work, datasets, baselines, or empirical
behavior must map to a citation, PaperNexus evidence node, or explicit user
artifact. Unsupported claims must be weakened, marked TODO, or routed back to
research.
```

## W3. Citation Sourcing Mandate Prompt

```text
Do not fabricate citations, BibTeX entries, DOIs, author lists, venues, years,
statistics, or experimental results.

Any bibliography entry used in final manuscript prose must come from a
retrieved source, PaperNexus packet, verified metadata artifact, Zotero packet,
or user-provided bibliography. If a citation is needed but not available,
create a search request or TODO instead of inventing metadata.

Prefer authoritative versions in this order: published venue version, journal
version, conference proceeding, official preprint, workshop, technical report.
If metadata is uncertain, mark it for citation verification rather than
silently normalizing it.
```

## W4. Literature Search Strategy Prompt

```text
Before drafting a literature-heavy section, build a query plan rather than
running one broad search.

Use these query families:
1. broad landscape scan for recent surveys and field structure.
2. must-cite anchor search for foundational work.
3. venue-targeted search for {{VENUE}} and adjacent top venues.
4. subfield search for {{SUBFIELD}}.
5. method-axis search for {{METHOD_PARADIGM}} and {{NOVELTY_MODULE}}.
6. citation-chasing search for papers that are missing from the current
   evidence graph.

Each query must record intent, provider route, source artifacts, and whether
PaperNexus import is required. Do not add a paper to the writing shortlist
until metadata and source availability are known.
```

## W5. Citation Implementation by Discipline Prompt

```text
Apply citation commands and bibliography style according to field and venue:
- CS/engineering: numeric citations such as \cite{key}; use natbib commands
  only when the template supports them.
- medicine/biology: Vancouver or journal-specific numbered style.
- chemistry/materials: ACS-style citations when required.
- physics: REVTeX/APS-compatible commands when required.
- social science/psychology/economics: APA or author-year when required.
- humanities: Chicago/MLA/biblatex style when required.
- multidisciplinary venues: follow official template.

Do not change the repository citation gate in this phase. This prompt only
controls drafting and review behavior.
```

## W6. Statistics and Empirical Reporting Prompt

```text
For empirical manuscripts, every quantitative claim must expose enough context
to be reviewed.

Report sample size, metric definition, uncertainty where available, exact
statistical test when used, effect size when relevant, confidence or credible
intervals when available, and compute/resource cost for ML experiments when
the evidence exists.

For ML/CV/NLP, prefer mean and standard deviation over multiple runs when the
project has them. For clinical or observational work, report cohort criteria,
ethics/protocol identifiers when applicable, and missing-data handling. If
the project lacks these details, mark the gap instead of inventing it.
```

## W7. Figures and Visualizations Writing Prompt

```text
Every paper should have a visible figure strategy before final writing.
At minimum, plan one anchor figure that explains the framework, mechanism,
argument structure, or survey taxonomy, plus one evidence figure or table
that carries the strongest result or comparison.

All figures need:
- a clear purpose in the paper's argument.
- caption with a complete descriptive sentence.
- label and in-text reference before or near first use.
- colorblind-safe palette guidance.
- no decorative, fake, or unsupported visual elements.

Conceptual figures may use prompt-only or optional image generation. Data
figures must be generated from real data or left as TODO placeholders.
```

## W8. Tables Prompt

```text
Use booktabs-style tables: \toprule, \midrule, and \bottomrule. Avoid \hline.
Place captions above tables. Use stable labels such as \label{tab:main-results}
and reference them as Table~\ref{tab:main-results}.

Comparison tables should mark the best result only when the evidence supports
that interpretation. Large result tables should include uncertainty or
significance indicators when the project has them. Do not bold values that
come from unverified or placeholder results.
```

## W9. Mathematics and Formula Prompt

```text
Use precise notation and define variables on first use. Do not present a
generic weighted sum, softmax, sigmoid, or standard block as the central
contribution unless the project evidence explains why it is technically new.

Every referenced equation needs a label and \eqref. The surrounding prose must
explain the role of each term, the assumptions behind the formula, and what
would break if the assumption fails. Formal claims need proof sketches or
appendix routing.
```

## W10. Mandatory Sections by Field Prompt

```text
Check whether the field or venue requires mandatory sections:
- clinical studies: ethics approval, consent, trial registration, CONSORT when applicable.
- systematic reviews: PRISMA-style protocol, inclusion/exclusion criteria.
- ACL/EMNLP: limitations and ethics when required.
- NeurIPS/ICML/ICLR: checklist or reproducibility statement when required.
- PLOS/eLife/Nature-style venues: data availability, code availability, author contributions.
- economics: replication package and pre-registration when applicable.
- Cell Press/PNAS-style venues: highlights, eTOC, graphical abstract, or significance statement.

Only add sections that are true for the project. If required information is
missing, create a blocker or TODO.
```

## W11. Section-Specific Writing Prompt

```text
Draft each section according to its reader job:
- Abstract: motivation, gap, method/lens, strongest evidence, implication,
  with no unsupported citation or result.
- Introduction: stakes, concrete gap, limitation of prior work, proposed move,
  evidence preview, contribution list only if appropriate.
- Related Work: synthesize by theme; do not list papers one by one.
- Method: make replication possible; define modules, inputs, outputs,
  training/inference details, assumptions, and failure boundaries.
- Experiments/Results: lead with the most important finding; tie each claim to
  a table, figure, metric, or artifact.
- Discussion/Limitations: state boundaries honestly; do not hide negative or
  inconclusive findings.
- Conclusion: summarize contribution and boundary without introducing new
  claims.
```

## W12. Project File Structure Prompt

```text
For manuscripts longer than a short note, use a split project structure:

main.tex
sections/
  abstract.tex
  introduction.tex
  related-work.tex
  method.tex
  experiments.tex
  discussion.tex
  conclusion.tex
figures/
tables/
refs.bib

main.tex owns the documentclass, preamble, begin/end document, bibliography,
and section inputs. Section files should contain section content only. Do not
create a giant single-file manuscript unless the venue template explicitly
requires it and the user accepts the tradeoff.
```

## W13. Anti-Pattern Rejection Prompt

```text
Reject or route for repair when any of the following appear:
- hallucinated citation, data, result, venue, DOI, or author list.
- BibTeX entry with no source artifact.
- bullet-dump body prose.
- one-sentence or underdeveloped paragraphs in final manuscript prose.
- data figure with fake values.
- placeholder figure represented as final figure.
- uncited prior-work claim.
- vague method description that cannot be reproduced.
- inflated novelty language unsupported by the evidence graph.
- limitation removal that hides a real weakness.
```
