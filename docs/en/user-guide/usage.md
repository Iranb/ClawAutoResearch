# Usage

This page is only about what to do after installation is complete.

If you still need environment setup, go back to [Installation](./installation.md).

## 1. Choose the workflow line

### Experiment paper line

Use this when you want to propose a method, write code, run experiments, and produce a methods paper.

```text
/auto-research "your topic"
```

### Survey / review line

Use this when you want to collect literature, screen papers, build coverage and gap synthesis, and write a survey paper.

```text
/auto-review "your topic"
```

## 2. Let the system create the project

You do not need to scaffold the project manually the first time.

Common project artifacts include:

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `.openclaw-research/` runtime state

## 3. Check state instead of guessing

Use:

```text
/workflow-status
```

Priority fields:

- `current_stage`
- `current_micro_stage`
- `owner_agent`
- `next_action`
- `blocking_reason`

## 4. Recover the right way

When a session is interrupted, use:

```text
/resume-pipeline
```

Do not rely on the old chat history as the source of truth.

## 5. Most important next reading

- [Workflow Tour](./workflow-tour.md)
- [Slash Commands](./slash-commands.md)
- [System Workflows](../architecture/system-workflows.md)
- [Chinese project lifecycle page](../../get-started/project-lifecycle.md)
