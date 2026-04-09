# Workflow 控制平面

这是理解整套系统的核心页面。

## 1. 基本原则

系统不是“让 Agent 自己决定下一步”，而是“让 durable state 与 workflow code 决定下一步”。最重要的执行入口是 `research_workflow.auto_iterator_tick`，最重要的控制层是 `workflow-guard`。

## 2. 主阶段机

| Stage | Owner | 核心输出 | 下游为什么依赖它 |
| --- | --- | --- | --- |
| `setup` | `researcher` | 项目骨架与基础状态 | 后面所有阶段都需要 durable project surface |
| `graph_build` | `researcher` | graph presence ready | 没有共享图就不应该做 novelty-sensitive 工作 |
| `frontier_mapping` | `researcher` | frontier / contradiction / transfer packet | ideation 需要图谱驱动的收敛而不是空想 |
| `idea` | `researcher` | active tracks + ideation contract | `plan` 要消费可追溯的创新包 |
| `plan` | `orchestrator` | `research_program` + alternatives + selection | `code` 不能脱离 track contract 野生执行 |
| `code` | `coder` | 实验实现与运行包 | `experiment` 需要确定要跑什么 |
| `experiment` | `coder` / `researcher` | ledger、结果路径、运行状态 | `analyze` 需要结构化结果输入 |
| `analyze` | `analyzer` | claim-evidence、verdict、story hooks | `review` 和 `write` 要消费已整理的证据 |
| `review` | `reviewer` | review pressure packet | 写作前先暴露 reject-first 风险 |
| `write` | `academic_writer` | template-aligned draft | 进入 submit 之前必须形成真实稿件 |
| `submit` -> `done` | `reviewer` / human | submission state | 保留最终人工 gate |

## 3. `auto_iterator_tick` 实际会做什么

一次 tick 通常包含下面几步：

1. 读取 `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`GATE_STATE.json`、`EXPERIMENT_LEDGER.json`。
2. 计算 `stageBefore`、`ownerBefore`、`missingSignals`、`blockingReasons`。
3. 在 graph-sensitive 阶段优先检查 graph presence。
4. 发现缺少 contract 时先触发 materializer，而不是直接推下一位角色硬写。
5. 通过 artifact-backed derived state 计算当前阶段是 `drive_stage`、`repair_artifact`、`background` 还是 `wait_human`。
6. 只有 `drive_stage` 才会成为真正可派发的 owner handoff；其他结果会转成 repair/background guidance，而不是伪 handoff。
7. 必要时通过 mailbox、queue 或 broadcast 把 handoff 变成结构化事件。

## 4. 为什么需要回退能力

科研流程不是线性的。下面这些情况都应该触发回退：

- `idea` 阶段发现 shared graph 不完整，应回到 `graph_build`。
- `plan` 阶段发现 ideation contract 缺失，应回到 `idea`。
- `write` 阶段发现 `paper_story_state` 或 `review_pressure_packet` 缺失，应回到 `analyze` 或 `review` 的准备面。
- `experiment` 阶段产生了新证据，但 `innovation_reflection` 仍旧陈旧，下次 serious ideation 前应回补反思链路。

## 5. workflow-guard 的职责分层

`workflow-guard` 不是一个单点逻辑，而是一组模块：

- prompt assembly：把当前阶段真正需要的 snapshot 注入角色 prompt。
- boundaries：约束写入目录、spawn/send、可联系对象和 mailbox 使用。
- runtime orchestration：封装 `auto_iterator_tick`、background continuation、dispatch 和 recovery。
- derived state：统一把 workflow-owned artifact、inline cached fields、repair/background diagnostics 归一成可复用的 readiness / handoff facts。
- materializers：把 `research_program`、`paper_story_state`、`review_pressure_packet`、writing support artifacts 等产物系统化落盘。
- summaries：支撑 `/workflow-status`、dashboard 摘要和多项目视图。

## 6. auto mode 不是无脑继续跑

自动模式还有一层风险控制：

- `workflow-auto-discussion`
- `workflow-auto-gate`
- `workflow-code-review`

它们让系统在高风险处先讨论、先补救、再决定是否降档，而不是一旦出问题就完全中断或完全放开。

## 7. plan 阶段的特别更新

现在 `plan` 阶段的权威产物已经从旧的 `PLAN.md` 转向 `research_program`。这意味着：

- 必须保存 alternatives。
- 必须保存 selection rationale。
- 必须记录被选 track 与 ideation 结果的对齐关系。
- 必须把 execution plan 变成 durable state，而不是只写一页自然语言计划。

## 8. 对系统贡献者最重要的判断标准

当你新增一个能力时，不要只问“能不能让 Agent 做成某件事”，还要问：

- 它属于哪个阶段。
- 它的 durable output 是什么。
- 缺失时系统怎么检测。
- 检测到缺失以后应回退到哪一步。
- 哪个角色拥有写入权。

> [!TIP]
> 如果你已经理解这里，下一页建议读 [Graph 与 Memory](./graph-memory.md)。这两页合起来才是这套系统真正的心脏。
