---
name: use-research-memory
description: "Use the research_memory tool to record idea entries, experiment entries, daily logs, and manage review state. Provides structured interfaces for all research memory operations."
argument-hint: "[action] [entry data]"
allowed-tools:
  - research_memory(*)
  - Read
  - Write
  - Glob
---

# Research Memory Tool Usage

This skill provides structured interfaces for using the `research_memory` tool across all research phases.

## When to Use

Use this skill when you need to:
- Record a new research idea (successful or failed)
- Log experiment results (success or failure)
- Write daily research logs
- Manage review loop state
- Query research memory paths

## Environment Requirements

Before using research memory, ensure:

1. `OPENCLAW_PROJECT` is set to the project root
2. Project directory structure exists:
   - `{PROJECT}/memory/` for ideation and experiment memory
   - `{PROJECT}/researcher/` for review state and daily logs

## Action Reference

### 1. Record Idea Entry

**Use when**: Completing IDEA phase or documenting a research hypothesis.

```json
{
  "action": "record_idea_entry",
  "ideaEntry": {
    "trackId": "track-001",
    "title": "Graph-Augmented RAG for Scientific QA",
    "domain": "RAG, Knowledge Graphs",
    "hypothesis": "Integrating paper citation graphs improves retrieval accuracy by 15%+",
    "outcome": "success",
    "whyNovel": "Prior work uses either graphs or dense retrieval, not both",
    "pilotResult": "+18% accuracy on SciQA benchmark",
    "generalizablePattern": "Graph neighborhood expansion before dense retrieval",
    "closestPriorWork": "GraphRAG (2024), Structured Retrieval (2023)",
    "sourceStage": "idea-phase",
    "confidence": 0.85,
    "tags": ["rag", "graphs", "retrieval"],
    "evidencePointers": [
      "{PROJ}/researcher/IDEA_REPORT.md#L45-L67",
      "{PROJ}/graph/ANCHOR_INDEX.md"
    ]
  }
}
```

**For failed ideas**:
```json
{
  "action": "record_idea_entry",
  "ideaEntry": {
    "trackId": "track-003",
    "title": "Multi-Modal Prompt Compression",
    "domain": "Prompt Engineering",
    "hypothesis": "Vision-language models can compress prompts 10x without loss",
    "outcome": "abandoned",
    "failureMode": "Compression destroys critical reasoning chains",
    "failureBucket": "information-loss",
    "retryCondition": "Only if new VLM architecture supports hierarchical attention",
    "sourceStage": "idea-phase",
    "confidence": 0.3,
    "tags": ["prompting", "compression", "multimodal"],
    "evidencePointers": [
      "{PROJ}/researcher/IDEA_AUDIT.md#L112-L130"
    ]
  }
}
```

### 2. Record Experiment Entry

**Use when**: Completing an experiment in CODE or EXPERIMENT phase.

```json
{
  "action": "record_experiment_entry",
  "experimentEntry": {
    "trackId": "track-001",
    "name": "graph-rag-sciqa-v1",
    "taskType": "Scientific QA",
    "dataset": "SciQA",
    "model": "Llama-3-70B",
    "hyperparams": {
      "learning_rate": 0.0001,
      "batch_size": 32,
      "graph_depth": 2,
      "top_k": 5
    },
    "result": "78.4% accuracy (+18% vs baseline)",
    "trainingTimeHours": 12.5,
    "gpuType": "A100",
    "reuseCondition": "Works for any scientific QA task with citation graphs",
    "sourceStage": "experiment-phase",
    "confidence": 0.9,
    "tags": ["rag", "graphs", "sciqa", "llama3"],
    "evidencePointers": [
      "{PROJ}/coder/graph-rag-sciqa-v1/results.json",
      "{PROJ}/researcher/artifacts/results/graph-rag-sciqa-v1.md"
    ]
  }
}
```

### 3. Record Failed Experiment Entry

**Use when**: An experiment fails or produces negative results.

```json
{
  "action": "record_failed_experiment_entry",
  "failedExperimentEntry": {
    "trackId": "track-002",
    "name": "prompt-compression-v3",
    "taskType": "Prompt Compression",
    "dataset": "LongBench",
    "model": "Kimi-k2.5",
    "hyperparams": {
      "compression_ratio": 0.1,
      "method": "vlm-encoder"
    },
    "resultSummary": "Accuracy dropped 40% at 10x compression",
    "failureMode": "Critical reasoning steps lost in compression",
    "failureBucket": "information-loss",
    "retryCondition": "Hierarchical attention or selective preservation",
    "trainingTimeHours": 8.2,
    "gpuType": "A100",
    "sourceStage": "experiment-phase",
    "confidence": 0.4,
    "tags": ["prompting", "compression", "failure"],
    "evidencePointers": [
      "{PROJ}/coder/prompt-compression-v3/failure-analysis.md"
    ]
  }
}
```

### 4. Append Daily Log

**Use when**: Ending a research session or completing a phase.

```json
{
  "action": "append_daily_log",
  "dailyLog": {
    "phase": "IDEA",
    "whatWasDone": [
      "Completed graph-backed brainstorming for RAG track",
      "Identified 3 novel opportunities from PaperNexus analysis",
      "Documented failure modes for prompt compression track"
    ],
    "keyDecisions": [
      "Selected graph-augmented RAG as primary track",
      "Decided to park multi-modal compression track",
      "Approved budget for SciQA experiments"
    ],
    "results": [
      "IDEA_REPORT.md completed with 5 candidate tracks",
      "IDEA_AUDIT.md shows 2 viable tracks"
    ],
    "nextSteps": [
      "Begin PLAN phase for graph-RAG track",
      "Write failure analysis for compression track to memory",
      "Prepare experiment budget request"
    ]
  }
}
```

### 5. Manage Review State

**Use when**: Starting, updating, or checking review loop status.

**Check resumability**:
```json
{
  "action": "check_review_resumability"
}
```

**Set review state**:
```json
{
  "action": "set_review_state",
  "reviewState": {
    "round": 2,
    "status": "in_progress",
    "lastScore": 7,
    "lastVerdict": "almost",
    "pendingActions": [
      "Address unsupported claim about novelty",
      "Add baseline comparison table"
    ],
    "timestamp": "2026-03-20T10:30:00Z"
  }
}
```

**Get review state**:
```json
{
  "action": "get_review_state"
}
```

### 6. Get Memory Paths

**Use when**: Debugging or verifying memory configuration.

```json
{
  "action": "get_paths"
}
```

Returns:
```json
{
  "policy": { ... },
  "mode": "project",
  "projectRoot": "/path/to/project",
  "ideationMemoryPath": "/path/to/project/memory/ideation-memory.md",
  "experimentMemoryPath": "/path/to/project/memory/experiment-memory.md",
  "reviewStatePath": "/path/to/project/researcher/REVIEW_STATE.json"
}
```

## Best Practices

### 1. Always Include Required Fields
- `trackId`: Link to TRACK_REGISTRY.json
- `evidencePointers`: Point to concrete artifacts
- `sourceStage`: Where did this come from? (idea-phase, experiment-phase, etc.)
- `confidence`: 0-1 score reflecting certainty

### 2. Use Consistent Naming
- Experiment names: `<track>-<version>` (e.g., `graph-rag-v1`)
- Track IDs: `track-NNN` format
- Tags: lowercase, hyphen-separated

### 3. Link to Artifacts
Always provide `evidencePointers` that point to:
- Phase reports (IDEA_REPORT.md, PLAN.md, etc.)
- Experiment results (results.json, metrics.csv)
- Graph artifacts (`graph/*.md` frontier files, anchor indexes, build reports)
- Analysis documents (failure-analysis.md)

### 4. Record Failures Promptly
- Document failures immediately after they occur
- Use specific `failureBucket` categories:
  - `information-loss`
  - `scalability`
  - `generalization`
  - `reproducibility`
  - `compute-budget`
- Always specify `retryCondition` clearly

### 5. Update Review State Frequently
- Update at the end of each review iteration
- Include specific `pendingActions`
- Keep `timestamp` current for resumability

## Integration Points

### IDEA Phase
```
IDEA_REPORT.md → record_idea_entry (for each selected track)
IDEA_AUDIT.md → record_idea_entry (for abandoned tracks)
End of session → append_daily_log
```

### EXPERIMENT Phase
```
Experiment results → record_experiment_entry (success)
                   → record_failed_experiment_entry (failure)
End of session → append_daily_log
```

### REVIEW Phase
```
Start review → check_review_resumability
Each iteration → set_review_state
End of review → set_review_state (status: completed)
Session log → append_daily_log
```

### WRITE Phase
```
Writing progress → append_daily_log (phase: WRITE)
Cross-review feedback → record_idea_entry (if new insights)
```

## Error Handling

If you get errors about missing `OPENCLAW_PROJECT`:
1. Check that the project is properly initialized
2. Verify PROJECT_MANIFEST.json exists
3. Ensure the agent workspace is correctly configured

If you get duplicate signature errors:
1. The entry already exists (check ideation-memory.md or experiment-memory.md)
2. Use a different experiment version number
3. Modify the trackId or title slightly

## Examples by Agent

### Researcher Agent
```json
{
  "action": "record_idea_entry",
  "ideaEntry": {
    "trackId": "track-001",
    "title": "...",
    "domain": "...",
    "hypothesis": "...",
    "outcome": "success",
    "sourceStage": "idea-phase",
    "evidencePointers": ["{PROJ}/researcher/IDEA_REPORT.md"]
  }
}
```

### Coder Agent
```json
{
  "action": "record_experiment_entry",
  "experimentEntry": {
    "trackId": "track-001",
    "name": "exp-v1",
    "taskType": "...",
    "dataset": "...",
    "result": "...",
    "sourceStage": "experiment-phase",
    "evidencePointers": ["{PROJ}/coder/exp-v1/results.json"]
  }
}
```

### Analyzer Agent
```json
{
  "action": "append_daily_log",
  "dailyLog": {
    "phase": "ANALYZE",
    "whatWasDone": ["Completed claim extraction", "Built evidence matrix"],
    "keyDecisions": ["3 primary claims supported", "2 secondary claims need work"],
    "results": ["NARRATIVE_REPORT.md", "CLAIM_EVIDENCE_MATRIX.md"],
    "nextSteps": ["Begin REVIEW phase"]
  }
}
```

### Reviewer Agent
```json
{
  "action": "check_review_resumability"
}
```

```json
{
  "action": "set_review_state",
  "reviewState": {
    "round": 1,
    "status": "in_progress",
    "lastScore": 6,
    "lastVerdict": "almost",
    "pendingActions": ["Add baseline comparison", "Clarify novelty claim"],
    "timestamp": "2026-03-20T14:00:00Z"
  }
}
```
