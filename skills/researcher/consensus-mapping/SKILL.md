# Consensus Mapping

## Overview
Identifies what the field broadly agrees on versus what remains contested, based on a team's paper corpus. Produces a structured "state of knowledge" map — separating settled science from active debate — which is invaluable for writing introductions, grant backgrounds, and onboarding new collaborators.

## When to Use
- User asks "what does the field generally agree on about X?"
- User is writing a grant background section and needs to establish prior art
- User asks "is [claim] well-established or still debated?"
- Onboarding a collaborator from a different subfield who needs a landscape overview
- User wants to identify what can be treated as a given vs. what needs justification

## Key Capabilities
- Cluster claims from the corpus by topic and measure agreement rate across papers
- Distinguish between consensus (≥80% agreement), emerging consensus (60–80%), and contested (<60%)
- Weight agreement by recency — older consensus may be superseded
- Weight by citation count and venue prestige as proxies for community trust
- Generate a structured consensus map by subtopic
- Identify claims that were once contested but are now settled (and when the shift happened)

## Usage Examples

### Generate consensus map for a topic
```python
consensus = consensus_mapping.build(
    topic="transformer architectures for biological sequences",
    corpus=review.get_papers(),
    weight_by_citations=True,
    weight_by_recency=True
)
```

### Check if a specific claim is consensus
```python
consensus_mapping.check(
    claim="Pre-training on large protein databases improves downstream task performance",
    corpus=review.get_papers()
)
# Returns: {"status": "strong_consensus", "agreement_rate": 0.91, "n_papers": 34}
```

### Generate background section for grant
```python
consensus_mapping.to_background(
    topic="self-supervised learning in genomics",
    format="NIH_specific_aims",
    max_words=300
)
```

## Output Format
Returns consensus map structured as: {topic_cluster: {claim, status, agreement_rate, supporting_papers, dissenting_papers, trend}}. Background section output is plain prose.

## Notes
- Agreement rate is estimated from explicit alignment/contradiction signals in text, not guaranteed accurate
- Always manually verify consensus claims before including in grant submissions
- Combine with `contradiction-detection` — contradictions are the boundaries of consensus
