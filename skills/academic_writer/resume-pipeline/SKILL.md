---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Academic Writer. Resume from the last completed writing artifact, section draft, or review note."
argument-hint: "[section name or empty to infer next missing section]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Agent
  - research_workflow
---

# Resume Pipeline

Use when paper writing was interrupted and the writer needs to continue from existing outline, section drafts, and review comments.

## Research Rigor Constraints

- Preserve **one variable per experiment** in resumed prose; do not collapse distinct ablations or hypotheses during cleanup.
- **Record everything** you reuse, revise, or newly draft so review can see what changed.
- Keep the **experiment and code change linked** by resuming from named evidence artifacts, not vague memory.
- **Verify before claiming**: if support status changed while you were away, downgrade the claim before drafting more prose.
- **Never manipulate evaluation narrative** during resume or polish passes.
- **Never fabricate citations** when filling gaps after interruption.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/academic_writer/PAPER_PLAN.md` if exists
- `{PROJ}/academic_writer/STORYLINE_SKETCH.md` if exists
- `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` if exists
- `{PROJ}/academic_writer/WRITING_SIGNALS.md` if exists
- `{PROJ}/academic_writer/paper/sections/*.tex`
- `{PROJ}/reviewer/AUTO_REVIEW.md` if exists
- relevant `{PROJ}/cross-reviewer/outline/` or `prose/` files if present
- `research_workflow.get_writing_contract`

## Resume Logic

1. If `PAPER_PLAN.md` is missing, resume with `/paper-plan`.
2. If a writing template is required, confirm the template path still exists before drafting more prose.
3. If `TEMPLATE_MAPPING.md` is missing while a template is configured, rebuild it with `/paper-plan`.
4. If the plan exists, infer the next incomplete section in this order:
   - method
   - experiments
   - related work
   - introduction
   - conclusion
   - abstract
5. If a section draft exists but lacks cross-review feedback, send that section to Cross-Reviewer before proceeding.
6. If all sections exist, resume final polish or compile handoff.
7. If compilation is needed but shell access is unavailable in the current writer configuration, stop with an explicit note for Researcher.

## Safety Rules

- Never rewrite already-approved sections unless the latest review note requires it.
- Preserve `WRITING_SIGNALS.md` and make red signals visible rather than silently discarding them.
- If a writing template is configured, do not resume section drafting until the template and `TEMPLATE_MAPPING.md` are both readable.

## Output

```markdown
## Resume Status
- **Plan**: [ready / rebuilt]
- **Last completed section**: [name or none]
- **Next section**: [name or final polish]
- **Blocked by**: [none or reason]
```
