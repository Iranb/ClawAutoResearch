# 项目生命周期

这页把“新项目第一次怎么跑”讲成两条连续主线：

- 实验论文主线
- 科研综述主线

## 1. setup：先把项目变成状态机可识别对象

起点不是 brainstorming，而是 `/project-init`。

如果你不想手动补 onboarding，只想输入主题就让系统自己开跑，最新入口是：

- `/auto-research "topic"`
- `/auto-review "topic"`

它的作用是生成最小项目骨架，例如：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/GATE_STATE.json`

如果这些文件还不存在，系统通常会停留在 `setup` 或回退到 `setup`。

## 2. 先决定你在走哪条主线

### 实验论文主线

适用于“要做新方法、跑实验、分析结果、写论文”的项目。它通常从：

- `/auto-research "topic"` 或
- `/project-init`
- `/graph-build`
- `/research-pipeline`

开始。

### 科研综述主线

适用于“要围绕一个主题做系统综述、做 screening、coverage、gap synthesis、最后写 survey”的项目。它通常直接从：

- `/auto-review "topic"` 或
- `/survey-pipeline "topic"`

开始。这个命令会创建一个轻量 survey workspace，把 durable state 写到 `PROJECT_MANIFEST.json.survey_review`，然后围绕综述 artifacts 推进，最终 handoff 到 `write`，并把 `writing_contract.paper_mode` 设为 `survey`。

## 3. graph_build：实验主线的第一条真实主线

很多系统把文献准备当作前置小事，这套系统不是。这里的 `/graph-build` 是硬门槛，因为后面很多阶段都依赖 graph presence。

### graph build 会做什么

- 读取 canonical papers 清单。
- 通过 shared PaperNexus corpus 检查这些论文是否已经进入图谱。
- 生成 graph readiness / presence 相关文件。
- 发现缺口时触发导入、排队或 repair。

### graph presence 为什么重要

如果项目进入 `idea`、`plan` 或 `write`，但共享图里缺核心论文，系统可能会回退到 `graph_build`。这不是保守过度，而是为了避免 novelty、analysis 和 writing 全部建立在不完整证据上。

## 4. frontier_mapping 与 idea：先收敛，再创新

当 graph presence ready 以后，Researcher 会进入：

- `frontier_mapping`
- `idea`

这里的目标不是“多想几个点子”，而是把前沿限制、矛盾、可迁移机制、challenge-insight tree 和 track ranking 收口成 durable ideation packet。

## 5. plan：从 research_program 而不是口头计划进入执行

Orchestrator 的关键工作不再只是写一个 `PLAN.md`。真正的 source-of-truth 是：

- `PROJECT_MANIFEST.json.research_program`
- alternatives
- selection
- execution plan
- task graph

这一步决定后面 `code` 和 `experiment` 会不会沿着正确 track 推进。

## 6. 两条后半段主线

### 实验论文主线

| 阶段 | 关键输出 |
| --- | --- |
| `code` | 实验实现包、运行脚本、结果目录约定 |
| `experiment` | ledger 更新、运行状态、result paths |
| `analyze` | claim-evidence、track verdicts、story hooks |
| `review` | review pressure packet、QC、风险闭环 |
| `write` | 在 writing contract 约束下产出草稿 |

### 科研综述主线

| 阶段 | 关键输出 |
| --- | --- |
| `survey_review` | query registry、screening packet、coverage summary、gap synthesis、`SURVEY_BRIEF.md` |
| `write` | `paper_mode=survey` 的 survey draft |
| `submit` | 最终提交前的人类 gate |

综述线不会要求你先补一套 `idea -> plan -> code -> experiment` 工件；它会直接消费 survey review artifacts 进入写作。

## 7. 如何开启一个科研综述项目

最推荐的方式是直接在聊天里调用：

```text
/survey-pipeline "multimodal reasoning survey"
```

系统会做这些事：

1. 创建一个轻量 survey workspace，而不是要求你先手工搭实验项目骨架。
2. 绑定当前会话到该 survey 项目，后续 `/workflow-status` 和 `/resume-pipeline` 都能继续接上。
3. 在 `PROJECT_MANIFEST.json.survey_review` 下维护 topic、phase、included/excluded counts、coverage、brief readiness 等 durable state。
4. 当 `SURVEY_BRIEF.md` 和关键综述工件 ready 后，允许 handoff 到 `write`，并以 `paper_mode=survey` 进入写作。

## 8.5 现有项目如何迁移到最新 workflow/runtime

如果你手上已经有一批旧项目，需要补齐最新 runtime state、survey identity 和 experiment decision 字段，可以直接运行：

```bash
node scripts/migrate_latest_workflow_projects.mjs --projects-root "<projects-root>"
```

这个迁移是 backfill-first：

1. 补齐最新 workflow 骨架文件
2. 初始化最新 runtime state 文件
3. 校正 survey 项目的 workflow identity
4. 对 experiment 项目持久化最新 decision 字段

它不会删除现有项目内容，也不会重置已有论文/实验产物。

## 9. 中断以后如何恢复

恢复时不要继续滚聊天历史，统一走这条链：

1. `/resume-pipeline`
2. `research_workflow.get_snapshot`
3. `research_workflow.auto_iterator_tick`
4. mailbox / gate state / ledger 对齐

这能把 `current_stage`、owner、blocking reason、missing signals 和建议动作重新拉回到代码驱动的现场。

## 10. 阶段完成后如何 handoff

当前项目里，stage closeout 不是“谁做完谁顺手喊下一位”，而是：

1. 当前 owner 先把 durable artifacts 写完
2. workflow 通过 `auto_iterator_tick` 判断阶段是否真的 ready
3. 如果结果是 `drive_stage`，才会进入 handoff
4. handoff 先写 mailbox，再执行 dispatch
5. dispatch hop 默认可以走 native，也可以在 auto mode 下走 Lobster backend

如果你在排查“为什么下一位 agent 没接上”，建议直接看：

- [Lobster Handoffs](../architecture/lobster-handoffs.md)

## 11. 两个高频故障信号

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

### 综述项目一直停在 `survey_review`

优先检查：

- `PROJECT_MANIFEST.json.survey_review.topic` 是否已写入。
- `researcher/SURVEY_QUERY_REGISTRY.json`、`researcher/INCLUDED_PAPERS.json`、`researcher/GAP_SYNTHESIS.md`、`researcher/SURVEY_BRIEF.md` 是否已经落盘。
- `survey_review.status` 是否已经 materialize 到 `completed`。
- `writing_contract.paper_mode` 是否已经是 `survey`，避免误走实验论文写作合同。

> [!INFO]
> 如果你想知道这些阶段背后的状态机逻辑，直接跳到 [Workflow 控制平面](../architecture/workflow-control-plane.md)。
