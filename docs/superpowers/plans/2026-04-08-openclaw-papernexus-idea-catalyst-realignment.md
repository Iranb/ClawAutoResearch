# Idea-Catalyst Repository Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `openclaw-research` and `PaperNexus` IDEA-CATALYST prompts, packet schemas, SKILL wording, and stage flow with the public `pkargupta/idea_catalyst` repository and paper `2603.12226`.

**Architecture:** Treat the public repository and paper as the prompt-and-flow source of truth, then map that contract into two layers: `PaperNexus` becomes the upstream challenge-aware packet provider, and `openclaw-research` becomes the downstream workflow consumer plus agent-facing SKILL surface. Do not replace the current graph-first architecture; instead, add missing public-repo stages, rubrics, and field names so the local system remains graph-native but semantically aligned.

**Tech Stack:** TypeScript, JavaScript, Python wrapper scripts, Node test runner (`node --test`), Markdown SKILL docs, remote HTTP MCP, graph-backed packet materialization

## Completion Status

Status on 2026-04-08 for the current `openclaw-research` workspace:

- OpenClaw-side alignment tasks are implemented.
- The implementation stays graph-native instead of copying the public repository literally.
- Public-repo field names, stage semantics, and ranking criteria are now mapped into the downstream workflow consumer layer.
- PaperNexus-side upstream packet-provider tasks in this document are now implemented in the `PaperNexus` repository and verified there against the corresponding JS and Python wrapper tests.

Completed OpenClaw-side outcomes:

1. Added `tools/idea-catalyst/prompt-contracts.ts` plus source-test shim and locked stage-field tests.
2. Realigned decomposition to emit paired domain-specific / domain-agnostic questions, coarse/fine domain metadata, target-domain queries, and rubric-backed target-domain analysis.
3. Realigned scout output to preserve graph-native cross-domain searches, domain rationale, structured takeaways, and supporting papers.
4. Realigned integration output to carry structured `idea_fragment`, `integration_mechanism`, `challenge_resolution`, and `concrete_realization` fields while preserving local graph-grounded synthesis.
5. Realigned LLM judging and ranking to the public four-criterion comparison contract:
   - depth of integration
   - multi-stage disciplinary engagement
   - innovation payoff
   - novelty + feasibility
6. Updated IDEA-CATALYST workflow guidance and researcher SKILL docs so execution language matches the new packet semantics and graph-backed requisition flow.
7. Verified the OpenClaw-side integration through targeted catalyst tests, broader workflow runtime tests, and `npm run build`.

Completed PaperNexus-side outcomes:

1. Added `src/core/graph/idea-catalyst-packets.js` and exposed a staged `packetBundle` / `packet_bundle` view with:
   - `decomposition`
   - `target_domain_analysis`
   - `cross_domain_queries`
   - `source_domain_analyses`
   - `idea_fragments`
   - `interdisciplinary_ranking`
   - `requisition_report`
2. Extended `catalyst-adapter.js` so the light graph-native result still works for existing callers while also surfacing:
   - `fineGrainedDomain`
   - `coarseGrainedDomain`
   - `researchQuestions`
   - `remainingChallenges`
   - `crossDomainSearches`
   - `packetBundle`
3. Extended takeaway extraction to retain `supporting_papers` and `selection_rationale`, so downstream consumers can preserve public-repo style evidence fields without losing graph-native provenance.
4. Extended interdisciplinary ranking to emit comparison-ready dimensions:
   - depth of integration
   - multi-stage disciplinary engagement
   - innovation payoff
   - novelty + feasibility
5. Updated the remote IDEA-CATALYST MCP wrapper / skill entry to support:
   - `--fine-grained-domain`
   - `--coarse-grained-domain`
   - `--output-mode idea_fragments|packet_bundle`
   - `--include-analysis`
6. Added additive compatibility aliases to make cross-repo handoff easier without breaking current consumers:
   - `decomposition.questions`
   - `cross_domain_searches`
   - `cross_domain_analysis`
   - `idea_fragments[*].idea_fragment`
7. Verified the PaperNexus-side implementation through:
   - `test/idea-catalyst-schema.test.js`
   - `test/mcp.test.js`
   - `test/takeaway-extraction.test.js`
   - `test/catalyst-adapter.test.js`
   - `test/idea-catalyst-packets.test.js`
   - `test/catalyst-e2e.test.js`
   - `test/query-api.test.js`
   - `test/python-remote-scripts.test.js`

Cross-repository alignment assessment as of 2026-04-08:

- The two repositories are now semantically aligned on the major IDEA-CATALYST stages:
  - decomposition
  - target-domain analysis
  - cross-domain retrieval
  - source-domain takeaways
  - integration
  - interdisciplinary ranking / requisition
- The major public-repo field families now line up across the split architecture:
  - coarse/fine domain metadata
  - remaining challenges
  - supporting papers
  - four-criterion ranking dimensions
  - staged packet output mode
- The main remaining distinction is architectural rather than semantic:
  - `PaperNexus` remains the upstream packet provider
  - `openclaw-research` still owns the downstream workflow-local durable packets
  - but `openclaw-research` now accepts `IDEA_CATALYST_PACKET_BUNDLE.json` as an upstream source of truth and automatically derives / refreshes the workflow-local bridge + challenge packet layer from it
- This means the system is now aligned and interoperable in both directions:
  - legacy split packets still work
  - bundle-first upstream delivery also works
  - a future cleanup pass can still reduce the runtime to a thinner single-bundle consumer if desired

---

## Source Of Truth

Use these as normative references while implementing:

- Public repo README pipeline:
  `https://github.com/pkargupta/idea_catalyst`
- Public prompt contract:
  `https://raw.githubusercontent.com/pkargupta/idea_catalyst/main/prompts.py`
- Public schema contract:
  `https://raw.githubusercontent.com/pkargupta/idea_catalyst/main/classes.py`
- Paper:
  `/workspace/input/2603.12226v1.pdf`
- Existing local upgrade notes:
  `openclaw-research/docs/superpowers/plans/2026-04-04-openclaw-research-idea-catalyst-upgrade-guide.md`
  `openclaw-research/docs/superpowers/plans/2026-04-05-papernexus-openclaw-idea-catalyst-integration.md`

## Parallelization Map

Recommended agent split after Task 1 lands:

- Agent A: Task 2 only
- Agent B: Task 3 only
- Agent C: Task 4 only
- Agent D: Task 5 only
- Agent E: Task 6 only
- Human or lead agent: Task 7 integration, conflict resolution, and final verification

Dependency order:

1. Task 1 is the contract-locking prerequisite for every other task.
2. Tasks 2, 3, and 4 can run in parallel after Task 1.
3. Task 5 depends on Task 4.
4. Task 6 depends on the intended output contracts from Tasks 2, 3, and 5.
5. Task 7 depends on Tasks 2 through 6.

## File Structure

### New files

- Create: `openclaw-research/tools/idea-catalyst/prompt-contracts.ts`
- Create: `openclaw-research/tests/idea-catalyst-prompt-contracts.test.mjs`
- Create: `PaperNexus/src/core/graph/idea-catalyst-packets.js`
- Create: `PaperNexus/test/idea-catalyst-packets.test.js`
- Create: `openclaw-research/tests/idea-catalyst-skill-docs.test.mjs`

### Existing files to modify

- Modify: `openclaw-research/tools/idea-catalyst/llm-question-generator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/decomposer.ts`
- Modify: `openclaw-research/tools/idea-catalyst/translator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/scout-adapter.ts`
- Modify: `openclaw-research/tools/idea-catalyst/integrator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/llm-judge.ts`
- Modify: `openclaw-research/tools/idea-catalyst/materializers.ts`
- Modify: `openclaw-research/tools/workflow-guard-guidance/idea-catalyst-guidance.ts`
- Modify: `openclaw-research/tests/idea-catalyst-modules.test.mjs`
- Modify: `openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `openclaw-research/tests/idea-catalyst-llm-control.test.mjs`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-decompose/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-translate/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-scout/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-integrator/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-gatekeeper/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-phase/SKILL.md`
- Modify: `PaperNexus/src/core/graph/catalyst-adapter.js`
- Modify: `PaperNexus/src/core/graph/takeaway-extraction.js`
- Modify: `PaperNexus/src/core/graph/interdisciplinary-potential.js`
- Modify: `PaperNexus/src/server/api.js`
- Modify: `PaperNexus/src/mcp/tool-idea-catalyst.js`
- Modify: `PaperNexus/test/catalyst-adapter.test.js`
- Modify: `PaperNexus/test/idea-catalyst-schema.test.js`
- Modify: `PaperNexus/test/catalyst-e2e.test.js`
- Modify: `PaperNexus/test/python-remote-scripts.test.js`
- Modify: `PaperNexus/SKILL/PaperNexusIdeaCatalyst/SKILL.md`
- Modify: `PaperNexus/SKILL/PaperNexusIdeaCatalyst/scripts/pn_idea_catalyst.py`

### Contract outcome to preserve

At the end of this plan, the local stack should expose the same conceptual stages as the public repo:

1. initial decomposition with `coarse_grained_domain`, `fine_grained_domain`, paired questions, and target-domain queries
2. target-domain analysis with addressed aspects, remaining challenges, and explicit assessment rubric
3. cross-domain query generation driven by the domain-agnostic question
4. cross-domain takeaway extraction with source-domain formulation and mechanism explanation
5. target-domain integration with structured `idea_fragment`
6. interdisciplinary ranking with explicit comparative dimensions

### Task 1: Lock The Public Prompt Contract Into Tests

**Files:**
- Create: `openclaw-research/tools/idea-catalyst/prompt-contracts.ts`
- Create: `openclaw-research/tests/idea-catalyst-prompt-contracts.test.mjs`
- Modify: `openclaw-research/tests/idea-catalyst-llm-control.test.mjs`
- Modify: `PaperNexus/test/idea-catalyst-schema.test.js`

- [ ] **Step 1: Write failing contract tests for the public-repo stage schema**

```js
test('prompt-contract helpers expose the public repo stage fields', () => {
  const contract = getIdeaCatalystPromptContract();
  assert.ok(contract.initial_decomposition.required_fields.includes('coarse_grained_domain'));
  assert.ok(contract.target_domain_analysis.required_fields.includes('remaining_challenges'));
  assert.ok(contract.cross_domain_queries.required_fields.includes('cross_domain_searches'));
  assert.ok(contract.integration.required_fields.includes('idea_fragment'));
});
```

- [ ] **Step 2: Run the contract tests to verify they fail**

Run:
`node --test openclaw-research/tests/idea-catalyst-prompt-contracts.test.mjs openclaw-research/tests/idea-catalyst-llm-control.test.mjs PaperNexus/test/idea-catalyst-schema.test.js`

Expected:
missing module or missing field assertions around the public prompt contract

- [ ] **Step 3: Implement the minimal shared contract helpers**

```ts
export function getIdeaCatalystPromptContract() {
  return {
    initial_decomposition: { required_fields: [...] },
    target_domain_analysis: { required_fields: [...] },
    cross_domain_queries: { required_fields: [...] },
    cross_domain_analysis: { required_fields: [...] },
    integration: { required_fields: [...] },
    ranking: { required_fields: [...] }
  };
}
```

- [ ] **Step 4: Re-run the contract tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-prompt-contracts.test.mjs openclaw-research/tests/idea-catalyst-llm-control.test.mjs PaperNexus/test/idea-catalyst-schema.test.js`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C openclaw-research add tools/idea-catalyst/prompt-contracts.ts tests/idea-catalyst-prompt-contracts.test.mjs tests/idea-catalyst-llm-control.test.mjs
git -C openclaw-research commit -m "test: lock idea catalyst public prompt contract"
git -C PaperNexus add test/idea-catalyst-schema.test.js
git -C PaperNexus commit -m "test: lock PaperNexus idea catalyst public schema contract"
```

### Task 2: Align OpenClaw Decomposition And Target-Domain Analysis

**Files:**
- Modify: `openclaw-research/tools/idea-catalyst/llm-question-generator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/decomposer.ts`
- Modify: `openclaw-research/tools/idea-catalyst/translator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/materializers.ts`
- Modify: `openclaw-research/tests/idea-catalyst-modules.test.mjs`
- Modify: `openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `openclaw-research/tests/idea-catalyst-llm-control.test.mjs`

- [ ] **Step 1: Write failing tests for paired-question decomposition and rubric-backed target analysis**

```js
test('decomposition packet carries public-repo question metadata', () => {
  const packet = buildIdeaCatalystDecompositionPacket(...);
  assert.equal(typeof packet.coarse_grained_domain, 'string');
  assert.ok(packet.questions[0].target_domain_queries.length >= 3);
  assert.ok(['largely unaddressed', 'partially addressed', 'substantially addressed']
    .includes(packet.questions[0].target_domain_analysis.overall_assessment));
});
```

- [ ] **Step 2: Run the focused OpenClaw module tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-modules.test.mjs openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs openclaw-research/tests/idea-catalyst-llm-control.test.mjs`

Expected:
FAIL because the packet does not yet carry the public-repo stage fields or rubric outputs

- [ ] **Step 3: Implement minimal code to co-produce decomposition plus target-domain analysis**

Implementation notes:

- `llm-question-generator.ts` should stop emitting a generic “generate 1-3 additional questions” prompt and instead expose prompt builders mirroring the public repo’s decomposition requirements:
  `coarse_grained_domain`
  `core_challenge`
  `domain_specific_question`
  `domain_agnostic_question`
  `rationale`
  `target_domain_queries`
- `decomposer.ts` should persist those fields into `DECOMPOSITION_PACKET.json`
- `translator.ts` should consume existing `domain_agnostic_question` values instead of regenerating a template-first abstraction
- `materializers.ts` should preserve the public assessment labels and serialize them into the durable packet

```ts
type TargetDomainAnalysis = {
  addressed_aspects: Array<{ sub_question: string; evidence: string }>;
  remaining_challenges: Array<{
    challenge_id: string;
    domain_specific_challenge_question: string;
    domain_agnostic_challenge_question: string;
    why_unaddressed: string;
    importance: string;
  }>;
  overall_assessment: 'substantially addressed' | 'partially addressed' | 'largely unaddressed';
};
```

- [ ] **Step 4: Re-run the focused OpenClaw module tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-modules.test.mjs openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs openclaw-research/tests/idea-catalyst-llm-control.test.mjs`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C openclaw-research add tools/idea-catalyst/llm-question-generator.ts tools/idea-catalyst/decomposer.ts tools/idea-catalyst/translator.ts tools/idea-catalyst/materializers.ts tests/idea-catalyst-modules.test.mjs tests/idea-catalyst-runtime-tools.test.mjs tests/idea-catalyst-llm-control.test.mjs
git -C openclaw-research commit -m "feat: align decomposition and target-domain analysis with public idea catalyst prompts"
```

### Task 3: Align OpenClaw Cross-Domain Search, Takeaways, Integration, And Ranking

**Files:**
- Modify: `openclaw-research/tools/idea-catalyst/scout-adapter.ts`
- Modify: `openclaw-research/tools/idea-catalyst/integrator.ts`
- Modify: `openclaw-research/tools/idea-catalyst/llm-judge.ts`
- Modify: `openclaw-research/tools/idea-catalyst/materializers.ts`
- Modify: `openclaw-research/tests/idea-catalyst-modules.test.mjs`

- [ ] **Step 1: Write failing tests for public-repo style cross-domain searches, takeaways, and ranking criteria**

```js
test('scout report preserves cross-domain search rationale and query bundles', () => {
  const report = deriveIdeaCatalystScoutReport(...);
  assert.ok(report.cross_domain_searches[0].domain_rationale);
  assert.ok(report.cross_domain_searches[0].queries.length >= 2);
  assert.ok(report.candidate_domains[0].takeaways[0].supporting_papers.length >= 1);
});

test('llm judge prompt uses all public ranking criteria', () => {
  const prompt = buildPairwiseComparisonPrompt(...);
  assert.match(prompt, /DEPTH OF INTEGRATION/i);
  assert.match(prompt, /MULTI-STAGE DISCIPLINARY ENGAGEMENT/i);
  assert.match(prompt, /INNOVATION PAYOFF/i);
  assert.match(prompt, /NOVELTY \+ FEASIBILITY/i);
});
```

- [ ] **Step 2: Run the focused scout and ranking tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-modules.test.mjs`

Expected:
FAIL because the scout report and judge prompt still reflect the lighter local contract

- [ ] **Step 3: Implement the minimal scouting, integration, and ranking alignment**

Implementation notes:

- `scout-adapter.ts` should emit both:
  `cross_domain_searches`
  `candidate_domains[*].takeaways`
- each takeaway should retain:
  `source_domain_formulation`
  `mechanism_explanation`
  `selection_rationale`
  `supporting_papers`
  `relevance_to_challenge`
- `integrator.ts` should match the public `idea_fragment` structure exactly:
  `title`
  `core_insight`
  `integration_mechanism`
  `challenge_resolution`
  `concrete_realization`
- `llm-judge.ts` should upgrade from the current 3-dimension comparison to the public 4-criterion comparison
- `materializers.ts` should preserve both graph-native evidence and public prompt field names when writing `IDEA_FRAGMENTS.json` and `RANKED_FRAGMENTS.json`

```ts
type CrossDomainSearch = {
  domain: string;
  domain_rationale: string;
  queries: string[];
};
```

- [ ] **Step 4: Re-run the scout and ranking tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-modules.test.mjs`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C openclaw-research add tools/idea-catalyst/scout-adapter.ts tools/idea-catalyst/integrator.ts tools/idea-catalyst/llm-judge.ts tools/idea-catalyst/materializers.ts tests/idea-catalyst-modules.test.mjs
git -C openclaw-research commit -m "feat: align cross-domain scouting integration and ranking with public idea catalyst flow"
```

### Task 4: Extend PaperNexus Into A Challenge-Aware Upstream Packet Builder

**Files:**
- Create: `PaperNexus/src/core/graph/idea-catalyst-packets.js`
- Modify: `PaperNexus/src/core/graph/catalyst-adapter.js`
- Modify: `PaperNexus/src/core/graph/takeaway-extraction.js`
- Modify: `PaperNexus/src/core/graph/interdisciplinary-potential.js`
- Modify: `PaperNexus/src/server/api.js`
- Modify: `PaperNexus/src/mcp/tool-idea-catalyst.js`
- Create: `PaperNexus/test/idea-catalyst-packets.test.js`
- Modify: `PaperNexus/test/catalyst-adapter.test.js`
- Modify: `PaperNexus/test/catalyst-e2e.test.js`

- [ ] **Step 1: Write failing tests for a public-repo style packet bundle**

```js
test('idea-catalyst packet builder returns decomposition analysis search takeaways integration and ranking stages', () => {
  const bundle = buildIdeaCatalystPackets(graph, {...});
  assert.ok(bundle.decomposition.research_questions.length >= 2);
  assert.ok(bundle.target_domain_analysis.length >= 1);
  assert.ok(bundle.cross_domain_queries.length >= 1);
  assert.ok(bundle.source_domain_analyses.length >= 1);
  assert.ok(bundle.idea_fragments.length >= 1 || bundle.requisition_report);
  assert.ok(bundle.interdisciplinary_ranking);
});
```

- [ ] **Step 2: Run the focused PaperNexus catalyst tests**

Run:
`node --test PaperNexus/test/idea-catalyst-schema.test.js PaperNexus/test/catalyst-adapter.test.js PaperNexus/test/idea-catalyst-packets.test.js PaperNexus/test/catalyst-e2e.test.js`

Expected:
FAIL because the current API only returns a simplified bridge-ranking payload

- [ ] **Step 3: Implement the minimal upstream packet composition**

Implementation notes:

- `idea-catalyst-packets.js` should compose the existing graph utilities into one staged bundle
- `catalyst-adapter.js` should expose challenge-level inputs:
  `fineGrainedDomain`
  `coarseGrainedDomain`
  `researchQuestions`
  `remainingChallenges`
  `crossDomainSearches`
- `takeaway-extraction.js` should attach `supporting_papers` explicitly
- `interdisciplinary-potential.js` should emit the ranking fields needed by the public comparison step
- `api.js` should expose both:
  a light `result` view for current consumers
  a structured `packetBundle` view for aligned consumers
- `tool-idea-catalyst.js` should support a bundle-returning mode without breaking existing `idea_fragments | requisition_report` callers

```js
return {
  decomposition,
  target_domain_analysis,
  cross_domain_queries,
  source_domain_analyses,
  idea_fragments,
  interdisciplinary_ranking,
  requisition_report
};
```

- [ ] **Step 4: Re-run the focused PaperNexus catalyst tests**

Run:
`node --test PaperNexus/test/idea-catalyst-schema.test.js PaperNexus/test/catalyst-adapter.test.js PaperNexus/test/idea-catalyst-packets.test.js PaperNexus/test/catalyst-e2e.test.js`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C PaperNexus add src/core/graph/idea-catalyst-packets.js src/core/graph/catalyst-adapter.js src/core/graph/takeaway-extraction.js src/core/graph/interdisciplinary-potential.js src/server/api.js src/mcp/tool-idea-catalyst.js test/idea-catalyst-packets.test.js test/catalyst-adapter.test.js test/catalyst-e2e.test.js
git -C PaperNexus commit -m "feat: expose challenge-aware idea catalyst packet bundle"
```

### Task 5: Align PaperNexus SKILL And Wrapper With The New Stage Contract

**Files:**
- Modify: `PaperNexus/SKILL/PaperNexusIdeaCatalyst/SKILL.md`
- Modify: `PaperNexus/SKILL/PaperNexusIdeaCatalyst/scripts/pn_idea_catalyst.py`
- Modify: `PaperNexus/test/python-remote-scripts.test.js`

- [ ] **Step 1: Write failing wrapper and SKILL-entry tests**

```js
test('pn_idea_catalyst wrapper forwards fine-grained domain and bundle mode', async () => {
  const payload = await runWrapper(...);
  assert.equal(payload.request.tool, 'idea_catalyst');
  assert.equal(payload.request.arguments.fineGrainedDomain, 'Generalized Category Discovery');
  assert.equal(payload.request.arguments.outputMode, 'packet_bundle');
});
```

- [ ] **Step 2: Run the remote-wrapper tests**

Run:
`node --test PaperNexus/test/python-remote-scripts.test.js`

Expected:
FAIL because the wrapper and skill still describe the older single-stage contract

- [ ] **Step 3: Implement the minimal wrapper and SKILL updates**

Implementation notes:

- `pn_idea_catalyst.py` should accept:
  `--fine-grained-domain`
  `--output-mode idea_fragments|packet_bundle`
  optional `--include-analysis`
- `SKILL.md` should describe the staged flow:
  decomposition
  target-domain analysis
  cross-domain retrieval
  source-domain takeaways
  integration
  ranking or requisition
- preserve the current remote HTTP MCP rule and canonical entrypoint language

- [ ] **Step 4: Re-run the wrapper tests**

Run:
`node --test PaperNexus/test/python-remote-scripts.test.js`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C PaperNexus add SKILL/PaperNexusIdeaCatalyst/SKILL.md SKILL/PaperNexusIdeaCatalyst/scripts/pn_idea_catalyst.py test/python-remote-scripts.test.js
git -C PaperNexus commit -m "docs: align PaperNexus idea catalyst skill and wrapper with staged packet flow"
```

### Task 6: Align OpenClaw Research SKILL Docs And Workflow Guidance

**Files:**
- Modify: `openclaw-research/skills/researcher/idea-catalyst-decompose/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-translate/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-scout/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-integrator/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-catalyst-gatekeeper/SKILL.md`
- Modify: `openclaw-research/skills/researcher/idea-phase/SKILL.md`
- Modify: `openclaw-research/tools/workflow-guard-guidance/idea-catalyst-guidance.ts`
- Create: `openclaw-research/tests/idea-catalyst-skill-docs.test.mjs`

- [ ] **Step 1: Write failing tests for the canonical local stage wording**

```js
test('canonical skill docs mention the public idea catalyst stage invariants', async () => {
  const decompose = await fs.readFile('openclaw-research/skills/researcher/idea-catalyst-decompose/SKILL.md', 'utf8');
  assert.match(decompose, /domain-specific/i);
  assert.match(decompose, /domain-agnostic/i);
  assert.match(decompose, /coarse-grained|fine-grained/i);
});
```

- [ ] **Step 2: Run the skill-doc tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-skill-docs.test.mjs`

Expected:
FAIL because the local SKILL docs currently describe a slimmer graph-first flow

- [ ] **Step 3: Update the skill docs and guidance with the final staged contract**

Required doc-level changes:

- `idea-catalyst-decompose`:
  explicitly require `coarse_grained_domain`, `core_challenge`, paired questions, and target-domain queries
- `idea-catalyst-translate`:
  reposition as challenge abstraction and query-generation support, not simple rephrasing
- `idea-catalyst-scout`:
  mention `cross_domain_searches`, source-domain rationale, and source-domain takeaways
- `idea-catalyst-integrator`:
  use the public `idea_fragment` field names
- `idea-catalyst-gatekeeper`:
  mention the explicit sufficiency/requisition decision boundary
- `idea-phase`:
  describe Idea-Catalyst as a sub-pipeline that starts after graph grounding, not as generic brainstorming
- `idea-catalyst-guidance.ts`:
  nudge requisition recovery in terms consistent with the new staged contract

- [ ] **Step 4: Re-run the skill-doc tests**

Run:
`node --test openclaw-research/tests/idea-catalyst-skill-docs.test.mjs`

Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git -C openclaw-research add skills/researcher/idea-catalyst-decompose/SKILL.md skills/researcher/idea-catalyst-translate/SKILL.md skills/researcher/idea-catalyst-scout/SKILL.md skills/researcher/idea-catalyst-integrator/SKILL.md skills/researcher/idea-catalyst-gatekeeper/SKILL.md skills/researcher/idea-phase/SKILL.md tools/workflow-guard-guidance/idea-catalyst-guidance.ts tests/idea-catalyst-skill-docs.test.mjs
git -C openclaw-research commit -m "docs: align openclaw idea catalyst skills with public staged workflow"
```

### Task 7: Cross-Repo Integration, Verification, And Handoff

**Files:**
- Modify only if integration issues require small follow-up changes in files already touched above

- [ ] **Step 1: Run the full targeted verification suites in both repos**

Run:
`node --test openclaw-research/tests/idea-catalyst-prompt-contracts.test.mjs openclaw-research/tests/idea-catalyst-modules.test.mjs openclaw-research/tests/idea-catalyst-runtime-tools.test.mjs openclaw-research/tests/idea-catalyst-llm-control.test.mjs openclaw-research/tests/idea-catalyst-skill-docs.test.mjs`

Run:
`node --test PaperNexus/test/idea-catalyst-schema.test.js PaperNexus/test/catalyst-adapter.test.js PaperNexus/test/idea-catalyst-packets.test.js PaperNexus/test/catalyst-e2e.test.js PaperNexus/test/python-remote-scripts.test.js`

Expected:
all PASS

- [ ] **Step 2: Run broader regression checks**

Run:
`npm --prefix openclaw-research run build`

Run:
`npm --prefix PaperNexus test`

Expected:
PASS without regressions outside IDEA-CATALYST

- [ ] **Step 3: Perform one manual smoke check against the public repo semantics**

Manual checklist:

- one sample problem yields paired decomposition questions
- target-domain analysis emits `overall_assessment`
- cross-domain search emits domain rationale plus query lists
- takeaways include source-domain formulation plus supporting papers
- integration emits the public `idea_fragment` schema
- ranking prompt uses all four public evaluation dimensions
- data-starved runs still return a requisition instead of hallucinated fragments

- [ ] **Step 4: Write short completion notes into both repos**

Suggested locations:

- append a short note to
  `openclaw-research/docs/superpowers/plans/2026-04-04-openclaw-research-idea-catalyst-upgrade-guide.md`
- append a short note to
  `openclaw-research/docs/superpowers/plans/2026-04-05-papernexus-openclaw-idea-catalyst-integration.md`

Include:

- which public-repo stages are now covered
- which fields remain intentionally graph-specific
- any known gaps left for a later pass

- [ ] **Step 5: Final commit**

```bash
git -C openclaw-research add docs/superpowers/plans/2026-04-04-openclaw-research-idea-catalyst-upgrade-guide.md docs/superpowers/plans/2026-04-05-papernexus-openclaw-idea-catalyst-integration.md
git -C openclaw-research commit -m "docs: record idea catalyst repo-alignment completion notes"
```

## Completion Criteria

This plan is complete only when all of the following are true:

1. `openclaw-research` prompt builders and durable packets carry the public repo’s stage fields and assessment labels.
2. `openclaw-research` scout, integration, and ranking outputs match the public conceptual flow while remaining graph-grounded.
3. `PaperNexus` can return a challenge-aware IDEA-CATALYST packet bundle, not only a flat ranked-domain result.
4. `PaperNexusIdeaCatalyst` SKILL and wrapper explain and expose the new staged contract.
5. `openclaw-research` IDEA-CATALYST SKILL docs describe the same prompt and stage semantics the code now implements.
6. Requisition behavior is preserved: low-evidence runs block brainstorming rather than inventing fragments.
7. All targeted tests and broader regression commands pass.

## Notes For The Lead Implementer

- Prefer additive compatibility shims over breaking renames where MCP callers may still expect the old fields.
- Keep `PaperNexus` as the upstream fact source and `openclaw-research` as the workflow-and-skill consumer.
- Do not regress the current graph-first architecture just to mirror the public repo literally; mirror semantics and contracts, not the exact internal implementation.
