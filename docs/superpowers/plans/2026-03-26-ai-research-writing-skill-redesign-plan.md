# AI Research Writing Skill Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the current AI research writing skill and prompt catalog into an English, agent-first structure that is easier to route, execute, and maintain.

**Architecture:** Keep one top-level `SKILL.md` as the discovery and routing layer, rewrite `README.md` as an English catalog, and convert prompt files `01-06` from human copy-paste templates into English task-spec references with consistent execution structure. Add a lightweight regression test that guards the new structure and prevents references to removed prompt files.

**Tech Stack:** Markdown, Node.js built-in test runner

---

### Task 1: Lock the redesign goals with a failing test

**Files:**
- Create: `tests/ai-research-writing-skill.test.mjs`

- [ ] **Step 1: Write the failing test**

Check that:
- `skills/academic_writer/ai-research-prompt/SKILL.md` exists
- it does not reference `07-model-selection.md` or `08-agent-skills.md`
- `README.md` and prompt files `01-06` exist
- all rewritten files include expected English structure markers
- the files contain no CJK characters

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ai-research-writing-skill.test.mjs`
Expected: FAIL because the current files are mixed-language and still reference removed prompt files.

### Task 2: Rewrite the top-level skill

**Files:**
- Modify: `skills/academic_writer/ai-research-prompt/SKILL.md`

- [ ] **Step 1: Rewrite frontmatter for discovery**

Use an English `description` focused on when to use the skill, not what it does.

- [ ] **Step 2: Rewrite the body as agent-first routing guidance**

Include:
- overview
- when to use
- routing table
- shared constraints
- missing-input handling

- [ ] **Step 3: Remove deleted prompt references**

Ensure only prompt files `01-06` are referenced.

### Task 3: Rewrite the catalog README

**Files:**
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/README.md`

- [ ] **Step 1: Replace the human copy-paste framing**

Rewrite the file as an English catalog that describes the prompt families and how the skill routes into them.

### Task 4: Rewrite prompt specs `01-03`

**Files:**
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/01-translation.md`
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/02-polish.md`
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/03-logic-and-review.md`

- [ ] **Step 1: Convert each file to a uniform execution structure**

Required sections:
- `Purpose`
- `When to Use`
- `Input Contract`
- `Output Contract`
- `Hard Constraints`
- `Procedure`
- `Failure Modes`

### Task 5: Rewrite prompt specs `04-06`

**Files:**
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/04-de-ai.md`
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/05-figures-tables.md`
- Modify: `skills/academic_writer/ai-research-prompt/awesome-ai-research-writing/prompts/06-experiments.md`

- [ ] **Step 1: Apply the same execution-structure rewrite**

Keep task-specific content, but express it as agent instructions instead of user copy-paste prompt blocks.

### Task 6: Verify the redesign

**Files:**
- Test: `tests/ai-research-writing-skill.test.mjs`

- [ ] **Step 1: Run the focused test**

Run: `node --test tests/ai-research-writing-skill.test.mjs`
Expected: PASS

- [ ] **Step 2: Re-run build-safe repository checks if needed**

Run: `npm test`
Expected: PASS
