# Experiment Registry — [Project Title]

> Managed by `/experiment-phase` and `/parallel-experiments`.
> Updated after every poll cycle. Do not edit manually during active runs.

**Project**: [project-id]
**Last updated**: YYYY-MM-DD HH:MM

---

## Active Experiments

| ID | Name | Group | GPU | Screen | Status | Started | ETA | Exit | Key Metric |
|----|------|-------|-----|--------|--------|---------|-----|------|------------|

<!-- Status values: running | done | failed | timeout | stalled -->
<!-- Group A = first parallel wave; Group B = depends on A; etc. -->

---

## Queued Experiments

| ID | Name | Group | Depends On | Reason Waiting |
|----|------|-------|-----------|----------------|

---

## Completed Experiments

| ID | Name | Status | Exit | Key Metric | vs Baseline | Duration | Seeds |
|----|------|--------|------|------------|-------------|----------|-------|

---

## Summary (filled after all experiments complete)

| Experiment | Seeds | Mean ± Std | vs Baseline | Status |
|-----------|-------|------------|-------------|--------|
| baseline | — | X.X ± Y.Y | — | ✓ |
| proposed | 42, 123, 456 | X.X ± Y.Y | +Z.Z% | ✓ |
| ablation_noX | 42 | X.X ± Y.Y | -Z.Z% | ✓ |

**Overall verdict**: POSITIVE / NEGATIVE / MIXED
**Next step**: `/analyze-results` / replan / abandon
