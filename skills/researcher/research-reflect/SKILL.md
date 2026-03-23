---
name: research-reflect
description: "Structured reflection checkpoint: pause and evaluate progress, evidence quality, strategy. Use at any decision point during research."
argument-hint: "[stage name or context]"
allowed-tools:
  - Read
  - Write
  - Grep
  - Glob
---

# Research Reflect

Structured reflection checkpoint inspired by EvoScientist's `think_tool` design. Use it to make explicit `advance / merge / park / kill` decisions.

## When to Trigger

- Baseline experiment completed (you now have a reference point)
- A new dataset / model / training method was introduced (risk: confounded variables)
- The primary metric failed to improve for two consecutive iterations
- Results are abnormal (metric mismatch, unstable training, unexpected regression)
- You are about to propose a new innovation angle after updating the experiment ledger

## Reflection Dimensions

Select the 2-3 most relevant dimensions for each reflection; you do not need to cover all of them:

1. **Progress** — What has been completed? What concrete steps remain?
2. **Evidence quality** — Would the evidence survive reviewer scrutiny? Do you have CIs / error bars?
3. **Prior knowledge** — Check `{PMEM}/ideation-memory.md` and `{PMEM}/experiment-memory.md` for reusable validated strategies or failure paths to avoid. `{PMEM}` = `{PROJ}/memory`
   - If `{PROJ}/researcher/INNOVATION_REFLECTION.md` exists, treat it as the authoritative experiment-informed ideation memory
4. **Strategy** — Continue, adjust, or switch direction? What evidence supports that decision?
5. **Resource & compute** — Estimate remaining GPU time and memory needs. Should you scale down or run at full scale?
6. **Handoff** — Are the current outputs clear and complete enough for the next stage?
7. **Track portfolio** — Which tracks should continue, merge, pause, or terminate?

## Output Format

```json
{
  "completed": ["Stage 1: baseline on CIFAR-10"],
  "unmet_success_signals": ["Acc gap vs SOTA > 2%"],
  "track_decisions": [
    {"track_id": "track_a", "action": "advance", "reason": "pilot positive and novelty intact"},
    {"track_id": "track_b", "action": "park", "reason": "interesting but lower evidence / budget pressure"}
  ],
  "stage_modifications": [
    {"stage": "Stage 2", "change": "Add data augmentation ablation"}
  ],
  "new_stages": [
    {
      "title": "Stage 2b: Aug ablation",
      "goal": "Isolate augmentation effect",
      "success_signals": ["≥1% improvement from aug"],
      "what_to_run": ["python train.py --aug cutout --seeds 42,123,456"],
      "expected_artifacts": ["results/aug_ablation.json"]
    }
  ],
  "memory_updates": {
    "ideation": null,
    "experiment": "CutOut augmentation effective on CIFAR-10 with ResNet-18"
  },
  "todo_updates": ["Add: aug ablation experiment", "Update: timeline +2h"]
}
```

After reflection, update:

- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/orchestrator/PLAN.md`
- `{PROJ}/orchestrator/TODOS.md`

If this reflection is supporting a new innovation proposal after recent experiments, refresh `{PROJ}/researcher/INNOVATION_REFLECTION.md` first or explicitly reuse its latest lessons instead of proposing a direction from scratch.

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`
