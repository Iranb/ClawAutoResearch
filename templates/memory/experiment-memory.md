# Experiment Memory

> Researcher Agent long-term memory for experiment execution patterns.
> Updated after each experiment-phase completion.
> Used during agent-bootstrap to reuse proven strategies and avoid known pitfalls.

---

## Proven Experiment Strategies (ESE — Experiment Strategy Experience)

Hyperparameter configurations and training strategies that reliably work.

### Template Entry
```
### [Strategy Name] — YYYY-MM-DD
- **Project ID**: [proj-id]
- **Track ID**: [track-id]
- **Signature**: [stable dedupe signature]
- **Evidence pointers**:
  - [artifact path / report / log]
- **Task type**: [classification / generation / RL / etc.]
- **Dataset**: [name + size]
- **Model**: [architecture]
- **Key hyperparameters**:
  - learning_rate: X
  - batch_size: Y
  - optimizer: AdamW / SGD / ...
  - scheduler: cosine / linear warmup + decay / ...
  - epochs / steps: N
  - seed(s): [42, 123, 456]
- **Training time**: ~N hours on [GPU type]
- **Why it works**: [brief explanation]
- **Reuse condition**: [when to apply this config]
```

<!-- Add entries below as strategies prove effective -->

---

## Failed Experiment Catalog

Experiments that consumed budget but failed, so future agents can avoid near-duplicate retries.

### Template Entry
```
### [Experiment Name] — YYYY-MM-DD (FAILED)
- **Project ID**: [proj-id]
- **Track ID**: [track-id]
- **Signature**: [stable dedupe signature]
- **Evidence pointers**:
  - [artifact path / report / log]
- **Task**: [task type]
- **Dataset**: [dataset]
- **Model**: [architecture]
- **Result summary**: [what happened]
- **Failure bucket**: [optimization / implementation / compute / data / evaluation]
- **Failure mode**: [why it failed]
- **Do not retry unless**: [condition that would materially change the outcome]
```

<!-- Add failed entries below as experiments fail -->

---

## Server-Specific Notes

Configuration tips for each GPU server.

### claw@211.71.76.29
- **GPU**: *(fill in after first run)*
- **Conda env**: `research` (or create per-project)
- **Fast storage path**: *(fill in)*
- **Known issues**: *(fill in)*
- **Typical batch size for A100 80GB**: *(fill in)*

---

## Data Pipeline Patterns

Reusable data loading and preprocessing strategies.

| Dataset | Preprocessing | Batch Size | Workers | Notes |
|---------|--------------|------------|---------|-------|
| *(add entries)* | | | | |

---

## Debugging Playbook

Common experiment failures and their fixes.

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| NaN loss after N steps | LR too high / no gradient clipping | Reduce LR 10x; add `clip_grad_norm_(1.0)` |
| CUDA OOM | Batch size too large | Halve batch size, double gradient accumulation |
| Loss not decreasing | LR too low / data issue | Check data loading; try LR 10x higher |
| Evaluation much worse than train | Overfitting | Add dropout / weight decay; reduce model size |
| Training hangs | Deadlock in dataloader | Set `num_workers=0` to debug |
| Runs diverge across seeds | Seed not fully set | Add `torch.backends.cudnn.deterministic=True` |

---

## Environment Setup Template

Standard commands for new server setup.

```bash
# Create conda environment
conda create -n research python=3.10 -y
conda activate research

# Core dependencies
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip install transformers datasets accelerate wandb

# Verify GPU
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.device_count())"
```

---

## Compute Budget Log

Track cumulative GPU hours consumed.

| Project | Experiment | GPU Type | Hours | Date |
|---------|-----------|----------|-------|------|
| *(add entries)* | | | | |
