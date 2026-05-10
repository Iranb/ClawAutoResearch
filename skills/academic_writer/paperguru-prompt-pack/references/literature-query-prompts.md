# PaperGuru Literature / PaperNexus Query Prompts

Source: `OpenClaw-PaperGuru-PaperNexus-native-bridge-融合执行计划-2026-05-10.md`.

These prompts create bounded PaperNexus query-profile inputs. They do not
replace PaperNexus discovery/import/graph ownership.

## L1. Six-Round Literature Query Planner

```text
Build a six-round literature query plan for {{FIELD}} / {{SUBFIELD}}.

Round 1: broad scan.
Find recent surveys, field maps, benchmarks, and dominant paradigms.

Round 2: must-cite anchors.
Find foundational works that reviewers expect to see.

Round 3: venue-targeted scan.
Search {{VENUE}} and adjacent venues from the last relevant years.

Round 4: subfield scan.
Search terms specific to {{SUBFIELD}}.

Round 5: method-axis scan.
Search around {{METHOD_PARADIGM}}, {{NOVELTY_MODULE}}, and baseline families.

Round 6: gap and citation chasing.
Use missing claims, reviewer concerns, and PaperNexus graph gaps to create
targeted follow-up queries.

For each query return:
- query_id
- query text
- intent
- provider route
- year filter if needed
- venue filter if needed
- expected use in manuscript
- requires PaperNexus import: yes/no
- source artifacts
```

## L2. Multi-Domain Query Seed Examples

```text
For CS/CV:
- "{{SUBFIELD}} survey deep learning"
- "{{TASK}} benchmark state of the art"
- "{{METHOD_PARADIGM}} {{TASK}}"
- "{{BASELINE_FAMILY}} {{TASK}}"
- "{{VENUE}} {{SUBFIELD}} {{YEAR_RANGE}}"

For medicine:
- "{{CONDITION}} {{INTERVENTION_OR_MODEL}} systematic review"
- "{{CONDITION}} prediction model validation"
- "{{OUTCOME}} cohort study confidence interval"
- "{{GUIDELINE_OR_TRIAL_TYPE}} {{CONDITION}}"

For social science/economics:
- "{{TOPIC}} causal inference"
- "{{POLICY_OR_TREATMENT}} difference in differences"
- "{{TOPIC}} field experiment"
- "{{OUTCOME}} robustness check"

For chemistry/materials:
- "{{MATERIAL}} synthesis characterization"
- "{{PROPERTY}} mechanism"
- "{{METHOD}} spectroscopy microscopy"
- "{{MATERIAL}} benchmark performance stability"

For humanities:
- "{{TOPIC}} historiography"
- "{{AUTHOR_OR_ARCHIVE}} primary sources"
- "{{CONCEPT}} critical debate"
- "{{PERIOD}} {{REGION}} source analysis"
```
