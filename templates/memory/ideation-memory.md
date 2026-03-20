# Ideation Memory

> Researcher Agent long-term memory for idea discovery patterns.
> Updated after each idea-phase completion or abandonment.
> Used during agent-bootstrap to avoid repeating known failures.

---

## Successful Idea Patterns (IDE — Idea Discovery Experience)

Patterns from ideas that passed review and produced publishable results.

### Template Entry
```
### [Project/Idea Name] — YYYY-MM-DD
- **Project ID**: [proj-id]
- **Track ID**: [track-id]
- **Signature**: [stable dedupe signature]
- **Evidence pointers**:
  - [artifact path / report / log]
- **Domain**: [NLP / CV / RL / etc.]
- **Core hypothesis**: [one sentence]
- **Closest prior work**: [paper or baseline]
- **What worked**: [specific technique or insight]
- **Key metric**: [e.g., +3.2% on X dataset over baseline Y]
- **Generalizable pattern**: [abstract lesson for future ideas]
```

<!-- Add entries below as ideas succeed -->

---

## Failed Idea Catalog (IVE — Idea Verification Experience)

Ideas that were pursued but failed or were abandoned. Use this to avoid dead ends.

### Template Entry
```
### [Idea Name] — YYYY-MM-DD
- **Project ID**: [proj-id]
- **Track ID**: [track-id]
- **Signature**: [stable dedupe signature]
- **Evidence pointers**:
  - [artifact path / report / log]
- **Domain**: [domain]
- **Hypothesis**: [what we thought would work]
- **Failure bucket**: [novelty / feasibility / implementation / data / compute]
- **Failure mode**: [why it didn't work]
  - [ ] Hypothesis was wrong (expected: X, got: Y)
  - [ ] Implementation issue (bug found at stage: ...)
  - [ ] Not novel (similar to [paper])
  - [ ] Compute infeasible (required: N GPU-h, available: M)
  - [ ] Data issue (dataset: ...)
- **Do not retry unless**: [condition under which this might work]
```

<!-- Add entries below as ideas fail -->

---

## Literature Gaps Identified

Areas where survey has identified open problems worth exploring.

| Gap | Domain | Identified | Notes |
|-----|--------|------------|-------|
| *(add entries)* | | | |

---

## Recurring Failure Patterns

High-level patterns observed across multiple failed attempts.

- *(none yet — add as patterns emerge)*

---

## Research Direction History

Timeline of research directions explored.

| Direction | Status | Period | Outcome |
|-----------|--------|--------|---------|
| *(add entries)* | | | |
