---
name: openclaw-research
description: Multi-agent research automation plugin for OpenClaw. Provides end-to-end research workflow from idea discovery to paper submission. Use when conducting literature review, generating research ideas, running experiments on remote GPUs, analyzing results, or writing academic papers. Includes project-isolated memory management and graph-grounded ideation.
---

# OpenClaw Research Plugin

## Quick Start

1. **Install the plugin**: Run `bash install.sh` in your workspace
2. **Configure openclaw.json**: Add plugin configuration with `projectsRoot`
3. **Set up SSH**: Ensure SSH access to GPU servers
4. **Launch pipeline**: Use `/research-pipeline` skill with your research topic

## Core Workflow

The plugin implements a state-machine controlled workflow:

```
SETUP → GRAPH_BUILD → FRONTIER_MAPPING → IDEA → PLAN → CODE → EXPERIMENT → ANALYZE → REVIEW → WRITE → SUBMIT → DONE
```

### When to Use This Plugin

Use this plugin when you need to:
- Conduct systematic literature reviews using PaperNexus graph
- Generate and evaluate research ideas with novelty checking
- Run experiments on remote GPU clusters via SSH
- Analyze results and generate evidence-backed claims
- Write academic papers in LaTeX with proper citations
- Get independent review feedback before submission

## Agent Architecture

The plugin coordinates multiple specialized agents. **Implementation is always the Coder role** — do not use the deprecated name **methodologist** in routing, skills, or handoffs (use **coder** / `@coder`).

| Agent | Role | Key Skills |
|-------|------|------------|
| **Researcher** | Pipeline orchestration | `/research-pipeline`, `/graph-build`, `/idea-phase` |
| **Orchestrator** | Experiment planning | `/plan-research`, `/use-research-memory` |
| **Coder** | Implementation | `/implement-experiment`, `/run-experiment` |
| **Analyzer** | Results analysis | `/analyze-results`, `/scientific-figures` |
| **Academic Writer** | Paper writing | `/paper-write`, `/paper-compile` |
| **Reviewer** | Quality evaluation | `/review-phase`, `/evidence-grading` |
| **Cross-Reviewer** | Novelty critique | `/resume-pipeline` |

## Essential Skills

### Research Pipeline Orchestration

```markdown
/research-pipeline "Your research topic or question"
```

This is the main entry point. It orchestrates the entire workflow from literature review through paper submission.

### Literature Graph Building

```markdown
/graph-build
```

Builds PaperNexus literature graph for your research domain. Use before idea generation.

### Idea Generation

```markdown
/idea-phase
```

Graph-grounded brainstorming with novelty checking. Generates candidate research tracks.

### Experiment Execution

```markdown
/experiment-phase
```

Runs experiments on remote GPU servers via SSH. Monitors progress and logs results.

### Paper Writing

```markdown
/paper-write
```

Writes LaTeX paper sections with evidence-backed claims and proper citations.

## Research Memory Tool

Use `research_memory` tool for structured, project-isolated memory management instead of editing files manually.

### Common Operations

**Record successful idea:**
```typescript
research_memory({
  action: "record_idea_entry",
  ideaEntry: {
    title: "Your idea title",
    domain: "Research domain",
    hypothesis: "Your hypothesis",
    outcome: "success",
    whyNovel: "Novelty explanation",
    pilotResult: "Pilot results",
    generalizablePattern: "Key pattern",
    closestPriorWork: "Related work citation",
    trackId: "track_001",
    evidencePointers: ["{PROJ}/path/to/evidence.md"]
  }
})
```

**Record failed experiment:**
```typescript
research_memory({
  action: "record_failed_experiment_entry",
  failedExperimentEntry: {
    name: "experiment_name",
    taskType: "task type",
    dataset: "dataset used",
    failureMode: "What went wrong",
    failureBucket: "categorization",
    retryCondition: "How to retry successfully",
    trackId: "track_001"
  }
})
```

**Get review state:**
```typescript
research_memory({ action: "get_review_state" })
```

**Append daily log:**
```typescript
research_memory({
  action: "append_daily_log",
  dailyLog: {
    date: "2026-03-21",
    sessionSummary: "What was accomplished",
    nextSteps: ["TODO 1", "TODO 2"]
  }
})
```

## Project Structure

Projects are stored under `{projectsRoot}/{project-id}/`:

```
{project-id}/
├── PROJECT_MANIFEST.json    # Project state and current stage
├── TRACK_REGISTRY.json      # Research track portfolio
├── CLAIM_POLICY.md          # Claim support criteria
├── servers.json             # GPU server config (optional)
├── graph/                   # PaperNexus graph state
├── memory/                  # Research memory
│   ├── ideation-memory.md
│   ├── experiment-memory.md
│   └── daily-logs/
├── researcher/              # Researcher artifacts
├── orchestrator/            # Planning documents
├── coder/                   # Experiment code
├── analyzer/                # Analysis results
├── writer/                  # Paper drafts
└── reviewer/                # Review feedback
```

## Configuration

Add to your `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          // Data integrity (recommended: all true except allowWorkspaceFallback)
          allowWorkspaceFallback: false,
          requireProjectIsolation: true,
          requireProjectIdInEntries: true,
          requireTrackId: true,
          requireEvidencePointers: true,
          reviewStateMaxAgeHours: 24,
          
          // Project root
          projectsRoot: "~/.openclaw/projects",
          
          // GPU servers
          servers: {
            default: "gateway",
            list: ["gateway", "gpu-node-2"]
          },
          
          // Idea generation
          ideaGeneration: {
            divergeSize: 8,
            portfolioSize: 4,
            tournamentRounds: 2
          },
          
          // Track portfolio
          trackPortfolio: {
            maxActiveTracks: 2,
            maxParkedTracks: 1,
            parkedBudgetPolicy: "zero"
          },
          
          // Compute budget
          computeBudget: {
            defaultGpuHoursPerTrack: 100,
            maxConcurrentExperiments: 4,
            gpuType: "A100"
          },
          
          // Review loop
          reviewLoop: {
            maxRounds: 3,
            scoreThreshold: 6.0,
            autoAdvanceScore: 7.5
          },
          
          // Graph config
          graphConfig: {
            autoRefreshTrigger: "per-track",
            noveltyThreshold: 0.7,
            maxPapersToIngest: 5000
          }
        }
      }
    }
  }
}
```

### Key Configuration Parameters

**Data Integrity Policies:**
- `requireProjectIsolation`: Enforce OPENCLAW_PROJECT env var
- `requireTrackId`: Require track IDs for ideas/experiments
- `requireEvidencePointers`: Require traceability pointers

**Track Management:**
- `maxActiveTracks`: Limit concurrent active research tracks (default: 2)
- `maxParkedTracks`: Limit suspended tracks (default: 1)
- `parkedBudgetPolicy`: "zero" | "reduced" | "full"

**Compute Budget:**
- `defaultGpuHoursPerTrack`: GPU hours per track (default: 100)
- `maxConcurrentExperiments`: Parallel experiments per track (default: 4)
- `gpuType`: "A100" | "H100" | "V100" | "RTX6000" | "mixed"

**Review Loop:**
- `maxRounds`: Max review iterations (default: 3)
- `scoreThreshold`: Min score to advance (default: 6.0/10)
- `autoAdvanceScore`: Auto-advance threshold (default: 7.5/10)

## State Files

### PROJECT_MANIFEST.json

Tracks project state:

```json
{
  "projectId": "your-project-id",
  "currentStage": "EXPERIMENT",
  "createdAt": "2026-03-21T10:00:00Z",
  "updatedAt": "2026-03-21T15:30:00Z"
}
```

### TRACK_REGISTRY.json

Manages research track portfolio:

```json
{
  "tracks": {
    "track_001": {
      "hypothesis": "Your hypothesis",
      "status": "active",
      "gpuHoursUsed": 45.2,
      "experiments": ["exp_001", "exp_002"]
    }
  },
  "activeCount": 1,
  "parkedCount": 0
}
```

## Best Practices

### 1. Project Isolation

Always set `OPENCLAW_PROJECT` environment variable before starting:

```bash
export OPENCLAW_PROJECT=your-project-id
```

This ensures all memory writes are properly isolated.

### 2. Track Portfolio Management

- Start with 2-4 candidate tracks from idea tournament
- Focus resources on most promising tracks
- Park tracks when blocked, don't abandon them
- Use failure buckets to categorize and learn from setbacks

### 3. Evidence-Backed Claims

When writing papers:
- Every claim must have evidence pointer
- Use `/evidence-grading` to validate support
- Distinguish between strong/weak/insufficient evidence

### 4. Review Loop

- Review happens after ANALYZE stage
- Reviewer is isolated from other agents
- Max 3 rounds of review-revise
- Score ≥ 7.5 auto-advances to writing

### 5. GPU Resource Management

- Monitor `gpuHoursUsed` in TRACK_REGISTRY
- Respect `maxConcurrentExperiments` limit
- Use `mixed` GPU type for flexible scheduling
- Park tracks to free up budget

## Troubleshooting

### Issue: Memory writes failing

**Solution**: Ensure `OPENCLAW_PROJECT` is set and project directory exists.

### Issue: Experiments not running on GPU

**Solution**: Check SSH configuration and server availability in `servers.json`.

### Issue: Review stuck

**Solution**: Use `research_memory({ action: "check_review_resumability" })` to diagnose.

### Issue: Too many ideas, not enough execution

**Solution**: Reduce `divergeSize` and enforce `maxActiveTracks` limit.

## Additional Resources

- [WORKFLOW.md](./WORKFLOW.md) - Detailed stage descriptions
- [WORKSPACE.md](./WORKSPACE.md) - Directory ownership and structure
- [CONFIG.md](./CONFIG.md) - Full configuration reference
- [README.md](./README.md) - Plugin overview

## Architecture Influences

- **EvoScientist**: Multi-agent collaboration and memory evolution
- **ARIS**: Skill orchestration and file-driven state management
