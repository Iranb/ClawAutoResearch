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

结构化反思检查点，借鉴 EvoScientist 的 think_tool 设计。

## When to Trigger

- 基线实验完成（有了参考点）
- 引入新数据集/模型/训练方法（风险：混淆变量）
- 连续两次迭代未提升主指标
- 结果异常（指标不匹配、训练不稳定、意外退化）

## Reflection Dimensions

每次反思选取 2-3 个最相关的维度，不必全部覆盖：

1. **Progress** — 已完成什么？剩余哪些具体步骤？
2. **Evidence quality** — 证据是否经得住审稿人质疑？有 CI/error bars 吗？
3. **Prior knowledge** — 检查 `{PMEM}/ideation-memory.md` 和 `{PMEM}/experiment-memory.md`，是否有可复用的已验证策略或需要避开的失败路径？`{PMEM}` = `{PROJ}/memory`
4. **Strategy** — 继续当前方案 / 调整 / 换方向？有什么证据支持这个决策？
5. **Resource & compute** — 预估剩余实验的 GPU 时间和内存需求。需要缩减规模还是可以全量跑？
6. **Handoff** — 当前阶段的输出是否清晰、完整，可以交给下一阶段？

## Output Format

```json
{
  "completed": ["Stage 1: baseline on CIFAR-10"],
  "unmet_success_signals": ["Acc gap vs SOTA > 2%"],
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

反思后更新 `{PROJ}/orchestrator/PLAN.md` 和 `{PROJ}/orchestrator/TODOS.md`。`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`
