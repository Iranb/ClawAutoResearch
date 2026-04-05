# openclaw-research: Idea-Catalyst Upgrade Guide

**Date:** 2026-04-04  
**Basis:** Paper `2603.12226v1` (Idea-Catalyst: Metacognition-Driven Interdisciplinary Inspiration)  
**Scope:** Code modifications and new features for `openclaw-research` only

---

## 0. Current State Snapshot

The IDEA-CATALYST subsystem lives in `tools/idea-catalyst/` with these modules:

| Module | File | Lines | Maturity | Key Gap |
|---|---|---|---|---|
| State | `state.ts` | 196 | Production | None critical |
| Decomposer | `decomposer.ts` | 113 | Functional | Token-overlap matching only; no LLM-driven question generation |
| Translator | `translator.ts` | 75 | Weak | Template string concatenation; no real abstraction reasoning |
| Scout-Adapter | `scout-adapter.ts` | 183 | Functional | `domain_distance` is fake (0.55 + index * 0.05); does not call PaperNexus API |
| Gatekeeper | `gatekeeper.ts` | 197 | Strong | Thresholds are good but lack LLM-based sufficiency judgment |
| Integrator | `integrator.ts` | 67 | **Critical weakness** | Pure template concatenation; no cross-domain reasoning |
| Judge | `judge.ts` + `ranking.ts` | 235 | Strong | Elo pairwise system works; could add LLM-based pairwise comparison |
| Materializer | `materializers.ts` | 330 | Production | Orchestrates all modules end-to-end |
| Workflow-Bridge | `workflow-bridge.ts` | 409 | Production | Requisition loop is mature |

The paper's methodology (Section 3) directly maps to these modules:

```
Paper Section 3.3 (Critical Reasoning over Target Domain)
  -> decomposer.ts + translator.ts

Paper Section 3.4 (Creative Reasoning Across Source Domains)
  -> scout-adapter.ts + gatekeeper.ts

Paper Section 3.5 (Target-Source Interdisciplinary Integration)
  -> integrator.ts + judge.ts
```

---

## 1. CRITICAL: Rewrite `integrator.ts` — From Templates to Graph-Grounded Synthesis

### Problem

Current `buildIdeaCatalystIdeaFragments()` produces fragments like:
```ts
core_insight: candidate.summary ?? "Graph-grounded interdisciplinary idea fragment."
synthesis_approach: `Integrate ${domain} concepts into ${problemStatement ?? "the target problem"}.`
```

This is string concatenation, not interdisciplinary synthesis. The paper's fragments (Appendix A) require structured `integration_mechanism`, `challenge_resolution`, and `concrete_realization` — all grounded in actual source-domain takeaways.

### Design

**File:** `tools/idea-catalyst/integrator.ts`

Replace the current single function with a multi-step integration pipeline:

```
Step 1: For each (candidate, source_domain) pair, collect the actual scouting 
        takeaways from SCOUTING_REPORT.json for that domain
Step 2: For each takeaway, extract the "source_domain_formulation" and 
        "mechanism_explanation" (new fields the scout should produce)
Step 3: Build integration_mechanism by matching target_domain_elements 
        (from decomposition questions) with selected_takeaways
Step 4: Build challenge_resolution by checking which decomposition question 
        this fragment addresses and what coverage_status it had
Step 5: Build concrete_realization by combining the source insight with 
        the target problem's methodology vocabulary
```

**New type** to add:

```ts
type IdeaFragment = {
  fragment_id: string;
  track_id: string | null;
  direction_id: string | null;
  title: string;
  source_domain: string;
  target_domain: string;
  core_insight: string;
  integration_mechanism: {
    target_domain_elements: string[];
    selected_takeaways: Array<{
      takeaway_id: string;
      source_domain_formulation: string;
      mechanism_explanation: string;
      selection_rationale: string;
    }>;
    synthesis_approach: string;
  };
  challenge_resolution: {
    addresses_target_challenge: string;
    addresses_source_limitations: string;
    addresses_research_problem: string;
  };
  concrete_realization: {
    proposed_approach: string;
    key_innovations: string[];
  };
  // scoring dimensions
  novelty: number;
  feasibility: number;
  relevance: number;
  clarity: number;
  interdisciplinary_potential: number;
};
```

This schema is directly from the paper's Appendix A. The current `ranking.ts` already uses `novelty`, `feasibility`, `relevance`, `clarity`, `interdisciplinary_potential` — so the judge pipeline requires no changes.

**Key constraint:** The integrator must consume the scouting report's `takeaways` array per domain. Currently `scout-adapter.ts` produces takeaways as `{ concept, mechanism, kg_node_id }` — see change #3 below.

---

## 2. HIGH: Upgrade `decomposer.ts` — Dual-Representation Questions

### Problem

The paper's core innovation (Section 3.3) is decomposing the problem into **dual-representation** questions: a domain-specific formulation and a domain-agnostic formulation. Current decomposer only produces `domain_specific_question` and classifies coverage as resolved/partial/unexplored using token overlap.

### Design

**File:** `tools/idea-catalyst/decomposer.ts`

Add a new field to each question in the decomposition packet:

```ts
type DecompositionQuestion = {
  question_id: string;
  priority: number;
  domain_specific_question: string;      // exists
  domain_agnostic_question: string;      // NEW — from translator, but should be co-produced
  coverage_status: string;               // exists
  coverage_evidence: { ... };            // exists
  remaining_non_incremental_challenges: Array<{
    challenge_specific: string;          // NEW — domain-specific challenge formulation
    challenge_agnostic: string;          // NEW — domain-agnostic challenge formulation
  }>;
};
```

Currently `remaining_non_incremental_challenges` returns 2 hardcoded template strings. Replace with:

```ts
// Instead of:
return [
  `Find a non-incremental mechanism that addresses "${challenge}" in ${targetDomain}.`,
  `Collect cross-domain evidence...`,
];

// Produce structured challenges that the translator and scout can consume:
return deriveRemainingChallenges({
  challenge,
  targetDomain,
  coverageEvidence: question.coverage_evidence,
  graphSignalMatches: question.coverage_evidence.graph_signal_matches,
});
```

The `deriveRemainingChallenges` function should:
1. For each unresolved challenge, produce a domain-specific formulation
2. Produce a domain-agnostic formulation by stripping domain-specific terminology
3. Use the graph signal matches to identify what was already partially addressed

### Integration with translator

Currently `translator.ts` (`buildIdeaCatalystAbstractionPacket`) produces `domain_agnostic_question` by prepending "How can a learning system address..." — this is a template. After this change, the dual representation should be produced at decomposition time and the translator should consume it rather than regenerating it.

**New flow:**
```
decomposer produces (domain_specific_question, domain_agnostic_question) pairs
  -> translator enriches with mechanism_hypothesis and transfer_axes
  -> scout uses domain_agnostic_question for cross-domain retrieval
```

---

## 3. HIGH: Upgrade `scout-adapter.ts` — Real Domain Distance + Structured Takeaways

### Problem A: Fake domain distance

```ts
// Current code at line 121:
domain_distance: Number((0.55 + index * 0.05).toFixed(2)),
```

This is a monotonically increasing fake value. PaperNexus already has `scoreDomainDistance(matrix, left, right)` in `domain-taxonomy.js` and `buildDomainDistanceMatrix()` that computes Jaccard-based distance from neighbor overlap.

### Design A: Consume PaperNexus domain distance

The scouting report should accept a `domainDistanceMatrix` parameter and use it:

```ts
export function deriveIdeaCatalystScoutReport(params: {
  graphIdeationPacket: Record<string, unknown> | null;
  topicSummary: Record<string, unknown> | null;
  challengeClusters: string[];
  transferBridges: string[];
  targetDomain: string | null;
  domainDistanceMatrix: Record<string, unknown> | null;  // NEW
}) {
  // ...
  // Replace fake domain_distance with:
  domain_distance: scoreDomainDistanceFromMatrix(
    params.domainDistanceMatrix,
    targetDomain,
    domain
  ),
}
```

The materializer (`materializers.ts`) should fetch the domain distance matrix from PaperNexus (via MCP tool call or local graph state) before calling `deriveIdeaCatalystScoutReport`.

### Problem B: Takeaways lack structure

Current takeaways are `{ concept, mechanism, kg_node_id }`. The paper requires takeaways with `source_domain_formulation`, `mechanism_explanation`, and `selection_rationale` (Table 3).

### Design B: Structured takeaways per domain

Extend the `candidateDomainEntries` to produce richer takeaways:

```ts
type DomainTakeaway = {
  takeaway_id: string;
  concept: string;              // exists as takeaway.concept
  mechanism: string;            // exists as takeaway.mechanism  
  kg_node_id: string;           // exists
  source_domain_formulation: string;  // NEW — how this concept works in the source domain
  mechanism_explanation: string;      // NEW — underlying logic/principle
  relevance_to_challenge: string;     // NEW — which decomposition question this addresses
};
```

For the initial implementation, `source_domain_formulation` and `mechanism_explanation` can be derived from PaperNexus node properties (the KG already stores `properties.abstract`, `properties.text`, `properties.evidenceText` on brainstorm-eligible nodes). The scout should request these from PaperNexus via the `context` MCP tool for each bridge node.

---

## 4. HIGH: Upgrade `translator.ts` — Beyond Template Abstraction

### Problem

Current abstraction logic:
```ts
domain_agnostic_question: `How can a learning system address ${question.toLowerCase()} under changing collaborators, constraints, and environments?`
mechanism_hypothesis: `Abstract the control or adaptation mechanism underlying ${question.toLowerCase()} so it can be transferred across domains.`
```

These are the same template applied to every question regardless of content.

### Design

The translator should produce different abstraction strategies based on the question's `coverage_status`:

```ts
function buildAbstraction(question: DecompositionQuestion): Abstraction {
  if (question.coverage_status === 'unexplored') {
    // For unexplored questions, abstract broadly to maximize discovery
    return {
      domain_agnostic_question: abstractBroadly(question),
      mechanism_hypothesis: null, // no hypothesis yet — pure exploration
      transfer_axes: [],
      strategy: 'exploratory',
    };
  }
  
  if (question.coverage_status === 'partial') {
    // For partial questions, abstract around the specific remaining challenges
    return {
      domain_agnostic_question: abstractAroundChallenges(
        question.remaining_non_incremental_challenges
      ),
      mechanism_hypothesis: deriveFromTransferBridges(
        question.coverage_evidence.transfer_bridge_matches
      ),
      transfer_axes: question.coverage_evidence.transfer_bridge_matches,
      strategy: 'targeted',
    };
  }
  
  // For resolved questions, skip
  return null;
}
```

The key insight from the paper is that **domain-agnostic formulations drive source-domain selection**. If the abstraction is a template, the source-domain selection will be generic. Better abstractions → better source domains → better fragments.

---

## 5. MEDIUM: Add LLM-Based Pairwise Comparison to `ranking.ts`

### Problem

Current judge uses dimension-by-dimension score comparison + Elo. The paper (Section 3.5) uses **LLM-based pairwise comparison** where a judge model assesses which fragment has higher interdisciplinary potential based on depth of integration, innovation payoff, and novelty-feasibility balance.

### Design

Add an optional LLM judge layer on top of the existing Elo system:

**New file:** `tools/idea-catalyst/llm-judge.ts`

```ts
export type PairwiseJudgment = {
  fragment_a: string;
  fragment_b: string;
  preferred: 'a' | 'b';
  reasoning: string;
  dimensions: {
    interdisciplinary_novelty: 'a' | 'b';
    interdisciplinary_usefulness: 'a' | 'b';
    depth_of_integration: 'a' | 'b';
  };
};

// This function produces the prompt for the LLM judge
// Following the paper's evaluation prompt (Appendix E)
export function buildPairwiseComparisonPrompt(params: {
  researchProblem: string;
  targetDomain: string;
  fragmentA: IdeaFragment;
  fragmentB: IdeaFragment;
}): string { ... }

// Parse the LLM response into a structured judgment
export function parsePairwiseJudgment(response: string): PairwiseJudgment { ... }
```

**Integration:** The materializer should optionally run LLM pairwise comparisons if configured in the policy, and feed the results back into the Elo system as additional match results with higher K-factor.

The current Elo system in `ranking.ts` already works well for the non-LLM case. The LLM judge would be an **additive layer**, not a replacement:

```
ranking.ts Elo (dimension scores) -> base ranking
  + llm-judge.ts pairwise (LLM evaluation) -> refined ranking
  = final RANKED_FRAGMENTS.json
```

---

## 6. MEDIUM: Add Metacognitive Control Loop to Materializer

### Problem

The paper emphasizes that Idea-Catalyst is not a linear pipeline but a **metacognitive control loop** with self-awareness, context-awareness, strategy selection, goal management, and evaluation (Section 3.2). Current materializer runs decompose → translate → scout → gate → integrate → judge in a single linear pass.

### Design

Add a loop to `materializers.ts` that can repeat the decompose-scout-gate cycle based on coverage assessment:

```ts
export async function materializeIdeaCatalystState(params: { ... }) {
  // ... existing setup ...
  
  let iteration = 0;
  const maxIterations = 3;
  let gateDecision;
  
  while (iteration < maxIterations) {
    const decompositionPacket = buildIdeaCatalystDecompositionPacket({ ... });
    const abstractionPacket = buildIdeaCatalystAbstractionPacket( ... );
    const scoutingReport = deriveIdeaCatalystScoutReport({ ... });
    gateDecision = buildIdeaCatalystGateDecision(scoutingReport, decompositionPacket);
    
    if (gateDecision.decision === 'brainstorm') break;
    
    // NEW: Metacognitive assessment
    const assessment = assessProgress({
      decompositionPacket,
      scoutingReport, 
      gateDecision,
      iteration,
    });
    
    if (assessment.strategy === 'refine_questions') {
      // Refine decomposition questions based on what scouting found
      challengeClusters = refineChallengeClusters(
        challengeClusters,
        scoutingReport,
        assessment.refinementHints,
      );
    } else if (assessment.strategy === 'expand_domains') {
      // Try different source domains
      transferBridges = expandTransferBridges(
        transferBridges,
        scoutingReport,
        assessment.expansionHints,
      );
    } else {
      // Requisition — exit to workflow for external paper acquisition
      break;
    }
    
    iteration += 1;
  }
  
  // ... rest of materialization ...
}
```

The key addition is `assessProgress()` — a metacognitive evaluator that decides whether to:
1. **Refine questions** (self-awareness: we asked the wrong questions)
2. **Expand domains** (context-awareness: we looked in the wrong places)
3. **Requisition** (strategy selection: we need more data from the outside)

---

## 7. MEDIUM: Story-Architecture Integration — Claim-to-Idea Traceability

### Problem

The assessment document identified that `plan -> code -> experiment -> analyze` claim-binding could be tighter. Specifically, there is no explicit link from an IDEA-CATALYST fragment to the claims it will support in the story spine.

### Design

Add a new durable artifact: `researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json`

```ts
type IdeaToClaimMapping = {
  fragment_id: string;
  source_domain: string;
  title: string;
  expected_claims: Array<{
    claim_id: string;            // matches CLAIM_TO_EXPERIMENT_MAP
    claim_text: string;
    support_type: 'primary' | 'supporting' | 'negative';
    evidence_path: string;       // which experiment validates this
  }>;
  story_arc_position: 'challenge' | 'insight' | 'contribution' | 'advantage';
};
```

This artifact should be produced at `plan` stage and consumed at `write` stage, creating a traceable chain:

```
IDEA_FRAGMENTS.json (idea stage)
  -> IDEA_TO_CLAIM_MAP.json (plan stage)
  -> CLAIM_TO_EXPERIMENT_MAP.md (plan stage)
  -> CLAIM_EVIDENCE_MATRIX.md (analyze stage)
  -> STORY_SPINE.md (write stage)
```

**Integration point:** The `paper-plan/SKILL.md` should read `IDEA_FRAGMENTS.json` and use it to generate the claim mapping alongside the existing PAPER_PLAN.md.

---

## 8. LOW: Add CATALYST_SESSION_STATE.json Versioning

The current `state.ts` already defines `sessionStatePath` (`researcher/idea-catalyst/CATALYST_SESSION_STATE.json`) but it only stores `{ status, micro_stage, trigger, agent_id, updated_at }`. Extend it to track the metacognitive history:

```ts
type CatalystSessionState = {
  status: string;
  micro_stage: string;
  iteration_count: number;
  iterations: Array<{
    iteration: number;
    strategy: string;         // 'initial' | 'refine_questions' | 'expand_domains' | 'requisition'
    coverage_summary: {
      total_questions: number;
      resolved: number;
      partial: number;
      unexplored: number;
    };
    selected_domains: string[];
    bridge_evidence_tier: string;
    gate_decision: string;
    timestamp: string;
  }>;
  trigger: string | null;
  agent_id: string | null;
  updated_at: string;
};
```

This enables debugging and retrospective analysis of why a particular fragment was ranked highly.

---

## Summary: Implementation Priority

| Priority | Change | Files | Effort |
|---|---|---|---|
| P0 | Rewrite integrator with paper's fragment schema | `integrator.ts` | Medium |
| P0 | Connect scout-adapter to PaperNexus domain distance | `scout-adapter.ts`, `materializers.ts` | Low |
| P1 | Dual-representation decomposition questions | `decomposer.ts` | Medium |
| P1 | Structured takeaways in scouting report | `scout-adapter.ts` | Medium |
| P1 | Translator abstraction strategies | `translator.ts` | Medium |
| P2 | LLM-based pairwise judge | new `llm-judge.ts`, `ranking.ts` | Medium |
| P2 | Metacognitive loop in materializer | `materializers.ts` | High |
| P2 | Idea-to-claim traceability | new artifact, `paper-plan/SKILL.md` | Medium |
| P3 | Session state versioning | `state.ts`, `materializers.ts` | Low |
