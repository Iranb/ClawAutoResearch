# Paper Ingestion Completion Broadcast Design

## Goal

When PaperNexus truly finishes importing a paper, `research_workflow.set_paper_ingestion`
should persist that completion event and emit exactly one Discord status broadcast for that
paper.

## Scope

This change only covers workflow-owned PaperNexus ingestion status updates.

It does not:

- infer completions from `PAPER_SOURCE_INDEX.json`
- poll PaperNexus directly from the plugin
- add a new background coordinator lane

## Approved Approach

Add an optional `completed_papers` field to the `paperIngestion` payload accepted by
`research_workflow.set_paper_ingestion`.

Each entry carries:

- `canonical_id`
- `title`
- `import_task_id`

The workflow tool should:

1. persist completed paper entries in `PROJECT_MANIFEST.json.paper_ingestion`
2. detect which completed papers are first-seen compared with the current persisted state
3. emit one `deliver: true` Discord status broadcast per first-seen completed paper

## Data Model

Extend `paper_ingestion` state with:

```json
{
  "completed_papers": [
    {
      "canonical_id": "arxiv:2502.00032",
      "title": "Retrieval-Augmented Experiment Planning",
      "import_task_id": "imp-42"
    }
  ]
}
```

Semantics:

- `completed_papers` is append-only from the caller's point of view
- tool-side merge is union-by-identity, not blind replacement
- identity prefers `canonical_id + import_task_id`, with stable string normalization
- repeated reports for the same paper must not trigger a second broadcast

## Broadcast Behavior

Broadcast path:

- reuse `maybeBroadcastWorkflowStatusUpdate`
- emit one message per newly completed paper
- use `status = "completed"`

Recommended summary format:

`PaperNexus import completed: <title> (<canonical_id>) via task <import_task_id>.`

Idempotency:

- one idempotency suffix per completed paper event
- derived from project id, canonical id, and import task id

## Implementation Split

### State Layer

In `tools/workflow-guard.ts`:

- extend `PaperIngestionState`
- normalize and serialize `completed_papers`
- update `setPaperIngestionState` to return `newlyCompletedPapers`

### Tool Layer

In `tools/register-workflow-tools.ts`:

- after `set_paper_ingestion`, loop over `newlyCompletedPapers`
- send one workflow status broadcast per new completion when runtime and session are available
- include broadcast results in the tool response for observability

## Testing

Add runtime-tool coverage for:

1. persisting `completed_papers`
2. broadcasting once for a first-seen completion
3. not rebroadcasting the same completion on a repeated update
4. broadcasting again for a different completed paper

## Risks

- callers may send only incremental `completed_papers` entries; union semantics avoids data loss
- callers may resend the same completion on retries; first-seen diffing avoids duplicate Discord noise
