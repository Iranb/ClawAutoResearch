# Claude Handoff Prompt

Use the prompt below when handing this work to Claude.

```text
Continue the IDEA-CATALYST implementation in openclaw-research.

Before deciding what to change, read these files carefully:

1. /workspace/internal/artifacts/functional_audit_v2.md.resolved
2. /workspace/openclaw-research/docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md
3. /workspace/openclaw-research/docs/superpowers/plans/2026-04-03-idea-catalyst-kg-subpipeline.md
4. /workspace/openclaw-research/docs/superpowers/specs/2026-04-03-idea-catalyst-kg-subpipeline-design.zh-CN.md
5. /workspace/openclaw-research/docs/superpowers/plans/2026-04-03-idea-catalyst-handoff-summary.md

Then inspect the current implementation state in:

- /workspace/openclaw-research/tools/idea-catalyst/
- /workspace/openclaw-research/tools/workflow-guard-runtime/stage-preflight.ts
- /workspace/openclaw-research/tools/workflow-guard-stages/ideation-stage-signals.ts
- /workspace/openclaw-research/tools/register-workflow-tools.ts
- /workspace/openclaw-research/tools/workflow-commands/formatters.ts
- /workspace/openclaw-research/skills/researcher/
- /workspace/openclaw-research/skills/reviewer/

Important constraints:

- Continue the approved direction: PaperNexus KG/schema first, workflow integration second.
- IDEA-CATALYST must remain a formal sub-pipeline inside the IDEA stage.
- Do not put new business logic into workflow-guard.ts unless a thin facade or glue change is strictly necessary.
- Prefer adding or expanding modules under tools/idea-catalyst/.
- Reuse existing workflow contracts and durable artifacts instead of inventing a parallel state system.

What I want from you:

1. First, summarize what is already implemented vs. what is still missing, based on the blueprint and the audit.
2. Then decide the highest-value next implementation step.
3. Prefer finishing graph-native Scout/Gatekeeper/requisition flow before polishing secondary docs.
4. If a design choice becomes blocking, stop and ask only that specific question.

Two design questions may still matter later, but do not ask them unless they become necessary for the next concrete implementation step:

- Domain taxonomy: Semantic Scholar 19 top-level fields vs. a finer-grained taxonomy
- Existing pn_idea_catalyst.py: refactor in place or keep a new bundle alongside it

Your output should:

- identify the next concrete coding task
- explain why it is next
- list the exact files you will touch
- keep the implementation modular
- run targeted tests before claiming success
```
