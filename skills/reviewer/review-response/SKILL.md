# Review Response

## Overview
Drafts structured, evidence-backed responses to peer reviewer comments. Grounds rebuttals in the team's literature base, surfaces relevant papers to cite in response, and calibrates tone appropriately — firm where warranted, concise throughout.

## When to Use
- User pastes reviewer comments and asks for a response draft
- User asks "how should we respond to reviewer 2?"
- Lab has a revise-and-resubmit and needs to draft the response letter
- User wants to find papers that address a reviewer's concern
- User needs help deciding which reviewer concerns to push back on vs. accept

## Key Capabilities
- Parse reviewer comment threads and categorize by type: factual concern, missing citation, methodology critique, scope request, clarity issue
- Draft point-by-point response for each comment
- Search team corpus and external literature for papers addressing reviewer concerns
- Recommend response strategy: concede / address / push back / defer
- Generate revision summary letter (cover letter for resubmission)
- Calibrate tone: firm scientific disagreement vs. gracious acknowledgment

## Usage Examples

### Draft response to reviewer comments
```python
review_response.draft(
    reviewer_comments="[paste full review here]",
    manuscript_abstract="[paste abstract]",
    corpus=review.get_papers(),
    tone="firm_but_respectful",
    include_literature_search=True
)
```

### Categorize and triage reviewer concerns
```python
review_response.triage(
    reviewer_comments="[paste full review]",
    output=["category", "effort_estimate", "recommended_strategy"]
)
```

### Find papers that address a specific reviewer concern
```python
review_response.find_supporting_literature(
    concern="The authors do not address out-of-distribution generalization",
    corpus=review.get_papers(),
    search_external=True
)
```

### Generate cover letter for resubmission
```python
review_response.cover_letter(
    original_reviews=["R1 text", "R2 text", "R3 text"],
    changes_made=["Added ablation study in Section 4.2", "Clarified limitation in Discussion"],
    target_journal="Nature Methods"
)
```

## Output Format
Response draft is structured as: summary paragraph + numbered point-by-point responses. Each response includes: reviewer quote, response text, and any new citations to add. Triage output is a prioritized table. Cover letter is formatted prose ready to submit.

## Notes
- PaperClaw does not decide what experiments to run — it drafts the prose around decisions made by the authors
- Tone calibration: "firm" = disagree with evidence; "gracious" = accept and thank; default is balanced
- Combine with `evidence-grading` to assess whether a reviewer's concern has strong literature support
