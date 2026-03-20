---
name: idea-tournament
description: "Run parallel pilot experiments on top-K tracks and rank them by empirical signal. Supports track combination. Use after idea-generator produces candidates."
argument-hint: "[top-K tracks from IDEA_REPORT.md, or 'all']"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Idea Tournament

Parallel pilot experiments on multiple tracks → empirical ranking → optional combination → top-K selection.

## Constants

- **MAX_PILOT_IDEAS = 3** — max tracks to pilot simultaneously (one per GPU group)
- **MAX_PILOT_GPU_HOURS = 2** — max GPU-hours per single pilot (skip if over budget)
- **PILOT_TIMEOUT_H = 3** — hard kill timeout per pilot
- **TOURNAMENT_TOP_K = 2** — how many tracks pass to full experiment stage
- **COMBINE_THRESHOLD = 0.4** — if two tracks each score ≥ 40% of the top track, consider combining

## Input

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

Read `{PROJ}/researcher/IDEA_REPORT.md` — candidates ranked by initial scoring (no pilot yet).

Check `{PMEM}/ideation-memory.md` — skip any track matching a known failed direction. `{PMEM}` = `{PROJ}/memory`

## Phase 1: GPU Allocation

Check server resources:
```bash
ssh <server> "nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader"
ssh <server> "screen -ls 2>/dev/null || echo 'No screens'"
```

Build GPU allocation table:
```
Available GPUs: [list free GPUs]
Tracks to pilot: [list top-N tracks after budget filter]
Assignment:
  GPU 0 → Track 1 pilot  (screen: pilot_track1)
  GPU 1 → Track 2 pilot  (screen: pilot_track2)
  GPU 2 → Track 3 pilot  (screen: pilot_track3)
```

If fewer GPUs than tracks: queue by priority (feasibility × impact score).

## Phase 2: Parallel Pilot Launch

For each track, generate a minimal pilot script (< 2h GPU):
- Smallest viable dataset split (10-20% of full data)
- 1-3 epochs / short horizon
- Single seed only (seed=42)
- Only the core proposed component, no ablations

Launch ALL pilots simultaneously:
```bash
# Launch track 1
ssh <server> "screen -dmS pilot_track1 bash -c \
  'cd <remote_dst> && \
   CUDA_VISIBLE_DEVICES=<gpu_id> uv run python train.py --config pilot/track_1.yaml \
   > logs/pilot_track1.log 2>&1; echo EXIT_CODE=\$? >> logs/pilot_track1.log'"

# Launch track 2 (same command, different config)
ssh <server> "screen -dmS pilot_track2 bash -c ..."

# Launch track 3
ssh <server> "screen -dmS pilot_track3 bash -c ..."
```

Verify all launched:
```bash
ssh <server> "screen -ls | grep pilot_track"
```

Write to `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json`:
```json
{
  "round": 1,
  "status": "running_pilots",
  "pilots": [
    {"track_id": 1, "screen": "pilot_track1", "gpu": 0, "launched": "ISO-TS"},
    {"track_id": 2, "screen": "pilot_track2", "gpu": 1, "launched": "ISO-TS"},
    {"track_id": 3, "screen": "pilot_track3", "gpu": 2, "launched": "ISO-TS"}
  ],
  "timeout_at": "ISO-TS + PILOT_TIMEOUT_H"
}
```

## Phase 3: Monitor Pilots (Polling)

Poll all pilots until ALL complete (or timeout):

```bash
# Check completion status
ssh <server> "for s in pilot_track1 pilot_track2 pilot_track3; do
  screen -ls | grep \$s > /dev/null && echo \"\$s: RUNNING\" || echo \"\$s: DONE\"
done"

# Tail logs for running pilots
ssh <server> "tail -5 logs/pilot_track1.log; echo '---'; tail -5 logs/pilot_track2.log"
```

Polling interval: 2min → 5min → 10min (exponential backoff).

**Timeout handling**: If `pilot_trackN` exceeds `PILOT_TIMEOUT_H`:
```bash
ssh <server> "screen -X -S pilot_trackN quit"
```
Mark track N as "TIMEOUT — signal unknown".

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

Score each track:
```
pilot_signal_score: STRONG_POSITIVE=4, POSITIVE=3, NEUTRAL=1, NEGATIVE=0, TIMEOUT=1
feasibility_score: (1-5 from initial scoring)
novelty_score: (1-5 from novelty-check)
total = 0.5 × pilot + 0.3 × novelty + 0.2 × feasibility
```

**Combination check** (borrow from EvoScientist DELEGATION_STRATEGY):
If tracks A and B each score ≥ `COMBINE_THRESHOLD × top_score`:
- Check if they are architecturally compatible (non-conflicting mechanisms)
- If yes: propose a combined track ("Track A+B") with additive hypothesis
- The combined track automatically advances alongside the top individual track

## Phase 6: Update IDEA_REPORT.md

Rewrite `{PROJ}/researcher/IDEA_REPORT.md` with tournament results:

```markdown
# Idea Tournament Results

**Date**: YYYY-MM-DD
**Pilots run**: N
**Advancing to full experiment**: K idea(s)

---

## 🏆 Advancing Tracks

### Rank 1 Track: [Title] — STRONG_POSITIVE ★★★
- **Pilot metric**: +X.X% over baseline (baseline: Y.Y%)
- **Score**: Z.Z/10
- **Hypothesis**: [one sentence]
- **Why novel**: [confirmed by novelty-check]
- **Estimated full experiment**: ~N GPU-hours
- **Next**: `/parallel-experiments "track_1"`

### Rank 2 Track: [Title] — POSITIVE ★★
...

### 🔀 Combined Track (if applicable): [Track A + Track B]
- **Rationale**: [why combination makes sense]
- **Pilot evidence**: A showed X, B showed Y, complementary because Z
- **Risk**: [potential conflict or implementation complexity]
- **Next**: implement combined approach if Rank 1 shows diminishing returns

---

## Eliminated Tracks

| Track | Signal | Reason |
|-------|--------|--------|
| [Title] | NEGATIVE | Baseline outperforms by -2.1% |
| [Title] | NEUTRAL | No signal at pilot scale, not worth full run |

---

## Memory Updates
- Eliminated tracks → `{PMEM}/ideation-memory.md` (IVE update)
- Advancing pattern → `{PMEM}/ideation-memory.md` (IDE update)
```

Update `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json`:
```json
{"status": "completed", "advancing_tracks": [1, 3], "combined": false}
```

## Gate — Human Checkpoint

Present tournament results to user:
- Show ranking table with pilot metrics
- Show combination proposal (if any)

User options:
- `"proceed"` → advance top-K to full experiment
- `"combine 1 3"` → combine tracks 1 and 3, advance as single track
- `"only 1"` → override K, advance only track 1
- `"rerun 2"` → re-pilot track 2 with larger scale before deciding
- `"generate more"` → back to idea-generator with new constraints

`AUTO_PROCEED=true`: wait 15 seconds, auto-advance with top-K by score.
