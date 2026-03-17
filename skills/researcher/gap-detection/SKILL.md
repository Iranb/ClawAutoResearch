# Gap Detection

## Overview
Analyzes a team's literature base to identify what has NOT been studied, contested, or resolved. Surfaces research gaps, contradictions left unaddressed, and methodological blind spots — helping teams identify novel contributions before writing.

## When to Use
- User asks "what hasn't been done yet in this area?"
- User is preparing a manuscript introduction or grant significance section
- User asks "where are the open questions in [topic]?"
- Lab wants to avoid duplicating work already done elsewhere
- User wants to position a new project in the existing literature landscape

## Key Capabilities
- Scan a paper corpus for explicitly stated limitations and future work sections
- Cluster unstudied conditions, populations, datasets, or modalities
- Cross-reference claimed gaps against actual recent work (via arXiv/PubMed)
- Identify methodological monocultures (everyone uses the same dataset/approach)
- Generate a structured "gap map" organized by type: empirical, theoretical, applied
- Suggest 3–5 concrete research directions with supporting evidence

## Usage Examples

### Find gaps in a topic area
```python
gaps = gap_detection.analyze(
    topic="self-supervised learning for genomics",
    corpus=review.get_papers(),
    include_future_work_sections=True
)
```

### Cross-check a proposed contribution against the literature
```python
gap_detection.validate_novelty(
    claim="We are the first to apply contrastive learning to single-cell RNA-seq",
    search_depth="comprehensive"
)
```

### Generate gap map for grant writing
```python
gap_detection.gap_map(
    topic="federated learning in clinical settings",
    format="structured_markdown",
    audience="NIH_reviewer"
)
```

## Output Format
Returns categorized gap list with: gap description, supporting evidence (paper excerpts), estimated research effort, and a novelty confidence score. Optionally formatted as a gap map table.

## Notes
- Explicitly stated limitations in papers are the highest-signal source of gaps
- Combine with `contradiction-detection` to find gaps created by conflicting findings
- Novelty validation is probabilistic — always verify manually before submission claims
