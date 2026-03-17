# Evidence Grading

## Overview
Evaluates the strength of evidence behind scientific claims based on study design, sample size, replication status, venue quality, and recency. Produces structured evidence grades that help teams know how much weight to put on any given finding.

## When to Use
- User asks "how strong is the evidence for [claim]?"
- Lab needs to decide how confidently to build on a published result
- Writing a manuscript and need to calibrate hedging language
- Grant reviewers will scrutinize the strength of the preliminary evidence
- User wants to rank a set of papers by evidentiary weight

## Key Capabilities
- Grade individual papers on study design quality (RCT > observational > case study, etc.)
- Assess replication status: single study, replicated, widely replicated, meta-analyzed
- Factor in sample size, effect size, and statistical rigor
- Consider venue quality (Nature/Science/Cell vs. preprint vs. workshop)
- Produce Oxford CEBM-style evidence levels or custom grade schema
- Summarize overall evidence strength for a specific claim across multiple papers
- Generate hedging language calibrated to evidence grade

## Usage Examples

### Grade a specific paper
```python
evidence_grading.grade_paper(
    doi="10.1038/s41586-024-00001-0",
    domain="machine_learning",  # affects grade rubric
    include_rationale=True
)
# Returns: {"grade": "B+", "level": "replicated_benchmark", "rationale": "..."}
```

### Grade evidence for a claim across all supporting papers
```python
evidence_grading.grade_claim(
    claim="Scaling laws hold for code generation models",
    supporting_papers=claim_tracker.get_papers("claim_0099"),
    schema="custom"  # strong | moderate | preliminary | anecdotal
)
```

### Generate calibrated hedging language
```python
evidence_grading.suggest_language(
    claim="Our method outperforms baselines on protein fitness prediction",
    grade="preliminary",
    context="manuscript_results_section"
)
# Returns: "Our method demonstrates promising performance improvements over baselines..."
```

## Output Format
Returns grade, level label, confidence score, and rationale. For claim-level grading, returns aggregate grade with per-paper breakdown. Hedging language output is ready-to-use prose.

## Notes
- Grade rubrics are domain-aware: ML/CS standards differ from clinical/biomedical standards
- Preprints are graded conservatively until peer review is confirmed
- Combine with `contradiction-detection` — contradicted claims automatically receive a grade penalty
