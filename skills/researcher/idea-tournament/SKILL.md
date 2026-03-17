---
name: idea-tournament
description: "Run parallel pilot experiments on top-K ideas and rank them by empirical signal. Supports idea combination. Use after idea-generator produces candidates."
argument-hint: "[top-K ideas from IDEA_REPORT.md, or 'all']"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Idea Tournament

Parallel pilot experiments on multiple ideas → empirical ranking → optional combination → top-K selection.

## Constants

- **MAX_PILOT_IDEAS = 3** — max ideas to pilot simultaneously (one per GPU group)
- **MAX_PILOT_GPU_HOURS = 2** — max GPU-hours per single pilot (skip if over budget)
- **PILOT_TIMEOUT_H = 3** — hard kill timeout per pilot
- **TOURNAMENT_TOP_K = 2** — how many ideas pass to full experiment stage
- **COMBINE_THRESHOLD = 0.4** — if two ideas each score ≥ 40% of top idea, consider combining

## Input

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

Read `{PROJ}/researcher/IDEA_REPORT.md` — candidates ranked by initial scoring (no pilot yet).

Check `{PMEM}/ideation-memory.md` — skip any idea matching a known failed direction. `{PMEM}` = `{PROJ}/memory`

## Phase 1: GPU Allocation

Check server resources:
```bash
ssh <server> "nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader"
ssh <server> "screen -ls 2>/dev/null || echo 'No screens'"
```

Build GPU allocation table:
```
Available GPUs: [list free GPUs]
Ideas to pilot: [list top-N ideas after budget filter]
Assignment:
  GPU 0 → Idea 1 pilot  (screen: pilot_idea1)
  GPU 1 → Idea 2 pilot  (screen: pilot_idea2)
  GPU 2 → Idea 3 pilot  (screen: pilot_idea3)
```

If fewer GPUs than ideas: queue by priority (feasibility × impact score).

## Phase 2: Parallel Pilot Launch

For each idea, generate a minimal pilot script (< 2h GPU):
- Smallest viable dataset split (10-20% of full data)
- 1-3 epochs / short horizon
- Single seed only (seed=42)
- Only the core proposed component, no ablations

Launch ALL pilots simultaneously:
```bash
# Launch idea 1
ssh <server> "screen -dmS pilot_idea1 bash -c \
  'cd <remote_dst> && \
   CUDA_VISIBLE_DEVICES=<gpu_id> uv run python train.py --config pilot/idea1.yaml \
   > logs/pilot_idea1.log 2>&1; echo EXIT_CODE=\$? >> logs/pilot_idea1.log'"

# Launch idea 2 (same command, different config)
ssh <server> "screen -dmS pilot_idea2 bash -c ..."

# Launch idea 3
ssh <server> "screen -dmS pilot_idea3 bash -c ..."
```

Verify all launched:
```bash
ssh <server> "screen -ls | grep pilot_"
```

Write to `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json`:
```json
{
  "round": 1,
  "status": "running_pilots",
  "pilots": [
    {"idea_id": 1, "screen": "pilot_idea1", "gpu": 0, "launched": "ISO-TS"},
    {"idea_id": 2, "screen": "pilot_idea2", "gpu": 1, "launched": "ISO-TS"},
    {"idea_id": 3, "screen": "pilot_idea3", "gpu": 2, "launched": "ISO-TS"}
  ],
  "timeout_at": "ISO-TS + PILOT_TIMEOUT_H"
}
```

## Phase 3: Monitor Pilots (Polling)

Poll all pilots until ALL complete (or timeout):

```bash
# Check completion status
ssh <server> "for s in pilot_idea1 pilot_idea2 pilot_idea3; do
  screen -ls | grep \$s > /dev/null && echo \"\$s: RUNNING\" || echo \"\$s: DONE\"
done"

# Tail logs for running pilots
ssh <server> "tail -5 logs/pilot_idea1.log; echo '---'; tail -5 logs/pilot_idea2.log"
```

Polling interval: 2min → 5min → 10min (exponential backoff).

**Timeout handling**: If pilot_ideaN exceeds `PILOT_TIMEOUT_H`:
```bash
ssh <server> "screen -X -S pilot_ideaN quit"
```
Mark idea N as "TIMEOUT — signal unknown".

## Phase 4: Collect Results

Pull pilot results:
```bash
rsync -avz <server>:<remote_dst>/results/pilot_* {PROJ}/researcher/artifacts/pilots/
```

For each completed pilot, extract the key metric (from logs or results JSON).

**Signal classification**:
- `STRONG_POSITIVE`: key metric ≥ baseline + 2%
- `POSITIVE`: key metric ≥ baseline + 0.5%
- `NEUTRAL`: within ±0.5% of baseline
- `NEGATIVE`: below baseline
- `TIMEOUT`: did not complete in budget

## Phase 5: Tournament Scoring & Ranking

Score each idea:
```
pilot_signal_score: STRONG_POSITIVE=4, POSITIVE=3, NEUTRAL=1, NEGATIVE=0, TIMEOUT=1
feasibility_score: (1-5 from initial scoring)
novelty_score: (1-5 from novelty-check)
total = 0.5 × pilot + 0.3 × novelty + 0.2 × feasibility
```

**Combination check** (borrow from EvoScientist DELEGATION_STRATEGY):
If ideas A and B each score ≥ `COMBINE_THRESHOLD × top_score`:
- Check if they are architecturally compatible (non-conflicting mechanisms)
- If yes: propose a combined idea ("Idea A+B") with additive hypothesis
- The combined idea automatically advances alongside the top individual idea

## Phase 6: Update IDEA_REPORT.md

Rewrite `{PROJ}/researcher/IDEA_REPORT.md` with tournament results:

```markdown
# Idea Tournament Results

**Date**: YYYY-MM-DD
**Pilots run**: N
**Advancing to full experiment**: K idea(s)

---

## 🏆 Advancing Ideas

### Rank 1: [Title] — STRONG_POSITIVE ★★★
- **Pilot metric**: +X.X% over baseline (baseline: Y.Y%)
- **Score**: Z.Z/10
- **Hypothesis**: [one sentence]
- **Why novel**: [confirmed by novelty-check]
- **Estimated full experiment**: ~N GPU-hours
- **Next**: `/parallel-experiments "idea1"`

### Rank 2: [Title] — POSITIVE ★★
...

### 🔀 Combined Idea (if applicable): [Idea A + Idea B]
- **Rationale**: [why combination makes sense]
- **Pilot evidence**: A showed X, B showed Y, complementary because Z
- **Risk**: [potential conflict or implementation complexity]
- **Next**: implement combined approach if Rank 1 shows diminishing returns

---

## Eliminated Ideas

| Idea | Signal | Reason |
|------|--------|--------|
| [Title] | NEGATIVE | Baseline outperforms by -2.1% |
| [Title] | NEUTRAL | No signal at pilot scale, not worth full run |

---

## Memory Updates
- Eliminated ideas → `{PMEM}/ideation-memory.md` (IVE update)
- Advancing pattern → `{PMEM}/ideation-memory.md` (IDE update)
```

Update `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json`:
```json
{"status": "completed", "advancing_ideas": [1, 3], "combined": false}
```

## Gate — Human Checkpoint

Present tournament results to user:
- Show ranking table with pilot metrics
- Show combination proposal (if any)

User options:
- `"proceed"` → advance top-K to full experiment
- `"combine 1 3"` → combine ideas 1 and 3, advance as single idea
- `"only 1"` → override K, advance only idea 1
- `"rerun 2"` → re-pilot idea 2 with larger scale before deciding
- `"generate more"` → back to idea-generator with new constraints

`AUTO_PROCEED=true`: wait 15 seconds, auto-advance with top-K by score.
