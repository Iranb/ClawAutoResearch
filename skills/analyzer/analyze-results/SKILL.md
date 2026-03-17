---
name: analyze-results
description: "Analyze experiment results: compute metrics, create figures, summarize findings."
argument-hint: "[results directory or experiment name]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Analyze Results

从实验输出提取指标、生成图表、总结发现。

> **File ownership**: Write ONLY to `{PROJ}/analyzer/`. Read logs from `{PROJ}/researcher/artifacts/` (read-only).
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Process

### 1. Collect Results

从 `{PROJ}/researcher/artifacts/results/` 读取所有结果文件（JSON/CSV）。

### 2. Compute Metrics

- 计算均值 ± 标准差（跨 seeds）
- 与 baseline 对比（绝对值和相对改进）
- 统计显著性检验（如适用）

### 3. Generate Figures

使用 Python 生成可视化：

```python
import matplotlib.pyplot as plt
import seaborn as sns
# 对比图、消融图、训练曲线等
```

保存到 `{PROJ}/analyzer/figures/`（PDF + PNG 各一份）。

### 4. Generate Tables

生成 LaTeX 格式的结果表，保存到 `{PROJ}/analyzer/tables/`。

### 5. Write Report

输出 `{PROJ}/analyzer/NARRATIVE_REPORT.md`：

```markdown
# Experiment Report: [title]

## Setup
- Model: ...
- Dataset: ...
- Config: ...

## Results
| Method | Metric1 | Metric2 |
|--------|---------|---------|
| Baseline | X ± Y | ... |
| Ours | X ± Y | ... |

## Analysis
- Key finding 1: ...
- Limitation: ...

## Artifacts
- Figures: {PROJ}/analyzer/figures/
- Tables:  {PROJ}/analyzer/tables/
- Logs:    {PROJ}/researcher/artifacts/logs/
```

### 6. Completion Signal

```
## Analysis Complete
- **Figures**: {PROJ}/analyzer/figures/
- **Tables**: {PROJ}/analyzer/tables/
- **Report**: {PROJ}/analyzer/NARRATIVE_REPORT.md
- **Main result**: [Proposed achieves X.X ± Y.Y vs baseline X.X ± Y.Y]
```

Then append to `{PROJ}/orchestrator/TODOS.md`:
```
- [x] Analysis complete: NARRATIVE_REPORT.md — completed: YYYY-MM-DD
```

## Rules

- Do NOT modify files in `{PROJ}/researcher/artifacts/logs/` (read-only)
- Do NOT run new experiments — only analyze existing results
- Do NOT write to any folder outside `{PROJ}/analyzer/`
- Include all completed runs — do not cherry-pick seeds
