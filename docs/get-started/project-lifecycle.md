# 项目生命周期

这页把“新项目第一次怎么跑”讲成一条连续主线。

## 1. setup：先把项目变成状态机可识别对象

起点不是 brainstorming，而是 `/project-init`。

它的作用是生成最小项目骨架，例如：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/GATE_STATE.json`

如果这些文件还不存在，系统通常会停留在 `setup` 或回退到 `setup`。

## 2. graph_build：第一条真实主线

很多系统把文献准备当作前置小事，这套系统不是。这里的 `/graph-build` 是硬门槛，因为后面很多阶段都依赖 graph presence。

### graph build 会做什么

- 读取 canonical papers 清单。
- 通过 shared PaperNexus corpus 检查这些论文是否已经进入图谱。
- 生成 graph readiness / presence 相关文件。
- 发现缺口时触发导入、排队或 repair。

### graph presence 为什么重要

如果项目进入 `idea`、`plan` 或 `write`，但共享图里缺核心论文，系统可能会回退到 `graph_build`。这不是保守过度，而是为了避免 novelty、analysis 和 writing 全部建立在不完整证据上。

## 3. frontier_mapping 与 idea：先收敛，再创新

当 graph presence ready 以后，Researcher 会进入：

- `frontier_mapping`
- `idea`

这里的目标不是“多想几个点子”，而是把前沿限制、矛盾、可迁移机制、challenge-insight tree 和 track ranking 收口成 durable ideation packet。

## 4. plan：从 research_program 而不是口头计划进入执行

Orchestrator 的关键工作不再只是写一个 `PLAN.md`。真正的 source-of-truth 是：

- `PROJECT_MANIFEST.json.research_program`
- alternatives
- selection
- execution plan
- task graph

这一步决定后面 `code` 和 `experiment` 会不会沿着正确 track 推进。

## 5. code -> experiment -> analyze -> review -> write

后半段主线的理解方式如下：

| 阶段 | 关键输出 |
| --- | --- |
| `code` | 实验实现包、运行脚本、结果目录约定 |
| `experiment` | ledger 更新、运行状态、result paths |
| `analyze` | claim-evidence、track verdicts、story hooks |
| `review` | review pressure packet、QC、风险闭环 |
| `write` | 在 writing contract 约束下产出草稿 |

## 6. 中断以后如何恢复

恢复时不要继续滚聊天历史，统一走这条链：

1. `/resume-pipeline`
2. `research_workflow.get_snapshot`
3. `research_workflow.auto_iterator_tick`
4. mailbox / gate state / ledger 对齐

这能把 `current_stage`、owner、blocking reason、missing signals 和建议动作重新拉回到代码驱动的现场。

## 7. 两个高频故障信号

### 一直回到 `graph_build`

优先检查：

- shared corpus 配置是否正确。
- canonical papers 是否真的进入共享图。
- graph presence report 是否显示缺失论文。

### 一直停在 `plan` 或 `write`

优先检查：

- `research_program` 是否齐全。
- `paper_story_state`、`review_pressure_packet`、`writing_contract` 是否已经 materialize。
- mailbox 里是否有未处理 blocker。

> [!INFO]
> 如果你想知道这些阶段背后的状态机逻辑，直接跳到 [Workflow 控制平面](../architecture/workflow-control-plane.md)。
