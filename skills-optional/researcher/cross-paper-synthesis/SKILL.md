# Cross-Paper Synthesis

## Overview
Synthesizes findings across multiple papers into a coherent narrative, structured comparison, or integrated model. Goes beyond summarizing individual papers to produce genuinely novel synthesis — identifying patterns, progressions, and insights that only emerge when reading across the corpus as a whole.

## When to Use
- User asks "what's the big picture across all these papers?"
- User wants a related work section written that actually synthesizes, not just lists
- User asks "how has the field's understanding of X evolved over time?"
- User wants to compare methodological approaches across papers
- Lab wants a structured comparison table of models/methods/results

## Key Capabilities
- Synthesize across 5–100 papers on a shared topic
- Generate narrative synthesis: what we knew, what changed, what it means
- Generate structured comparison: methods, datasets, metrics, results in table form
- Temporal synthesis: show how understanding has evolved year by year
- Cross-domain synthesis: find connections between papers from different fields
- Identify the "through line" — the core insight that unifies disparate work

## Usage Examples

### Narrative synthesis of a topic
```python
synthesis = cross_paper_synthesis.narrative(
    papers=review.get_papers(tag="attention-mechanisms"),
    focus="methodological evolution",
    max_words=800,
    audience="expert"
)
```

### Structured comparison table
```python
cross_paper_synthesis.comparison_table(
    papers=review.get_papers(tag="protein-lm-benchmarks"),
    dimensions=["model_size", "training_data", "benchmark", "metric", "score"],
    format="markdown_table"
)
```

### Temporal evolution synthesis
```python
cross_paper_synthesis.timeline(
    topic="in-context learning capabilities",
    papers=review.get_papers(),
    group_by="year"
)
```

## Output Format
Narrative synthesis is prose with inline citations. Comparison tables are Markdown or LaTeX. Timeline output shows year-by-year progression with key papers anchoring each phase.

## Notes
- Best results with 10–50 papers; >100 papers may require topic narrowing
- Combine with `consensus-mapping` to distinguish what's established vs. speculative in the synthesis
- Always review AI-generated synthesis before including in manuscripts — factual errors are possible
