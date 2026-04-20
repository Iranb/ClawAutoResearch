# Auto Research / Auto Review Handoffs

这一页专门说明两条自动化主线当前到底覆盖了哪些 handoff，以及每个 handoff 是怎样被允许、派发、claim、activate 的。

## 总原则

无论是 `auto-research` 还是 `auto-review`，handoff 都遵循同一套 control-plane 规则：

1. 当前 owner 先写出 durable artifacts。
2. `research_workflow.auto_iterator_tick` 负责判断当前阶段是否真的 ready。
3. 只有当下一步属于**不同 owner** 时，才进入 cross-owner handoff。
4. cross-owner handoff 统一通过 `research_workflow.prepare_stage_handoff` 进入 control plane。
5. manifest 的 `owner_agent` / `current_stage` 不应靠聊天文字或自由发挥切换，而是依赖 handoff claim / activation。

简化理解：

- `auto_iterator_tick` 决定“应该不应该交”
- `prepare_stage_handoff` 决定“交给谁、交付什么”
- runtime / mailbox / queue 决定“怎么送达”

## `auto-review` 覆盖的 handoff

`/auto-review "topic"` 启动的是 survey 主线：

`survey_review -> write -> submit`

它不会正常进入 `plan -> code -> experiment`。

### 启动阶段

`/auto-review` 会先：

1. 创建或解析 project root
2. 把当前频道显式绑定到这个 survey 项目
3. 写入 survey-mode writing bootstrap
4. 启动 researcher 的 background `survey_review`

这里不是 handoff，而是 bootstrap。

### `survey_review -> write`

- from: `researcher`
- to: `academic_writer`
- stage owner 变化：`researcher -> academic_writer`

允许 handoff 的核心条件：

- survey review packet 已经足够支持写作
- `researcher/SURVEY_BRIEF.md` 已存在
- `researcher/SOTA_MATRIX.md` 或 `researcher/LITERATURE_REVIEW.md` 已存在

更完整的阶段 readiness 由 survey stage signals 决定，重点看：

- retrieval / screening / synthesis 是否已经 durably 落盘
- coverage / taxonomy / benchmark / gap 是否已经到可写作状态

逻辑上：

1. `survey_review` 由 Researcher 完成 query registry、screening packet、coverage/gap/synthesis
2. `auto_iterator_tick` 判断 `survey_review` 是否能进入 `write`
3. 若下一 owner 是 `academic_writer`，则创建 prepared handoff
4. Writer claim 后才真正进入写作 owner lane

### `write -> submit`

- from: `academic_writer`
- to: `reviewer`
- stage owner 变化：`academic_writer -> reviewer`

允许 handoff 的核心条件：

- `PROJECT_MANIFEST.json.writing_session` 反映 reviewer-ready draft
- `academic_writer/paper/main.tex` 存在
- `academic_writer/paper/` 下至少存在一个 PDF

这里特别注意：

- 现在**不再**要求 PDF 必须叫 `main.pdf`
- 只要求 writer paper 目录下有任意真实 PDF

Reviewer 侧真正进入 submit-ready 之前，还会继续受更严格的 gate 约束：

- reviewer 必须确认 citation verification
- `citation_integrity.verification_status = verified`
- `citation_integrity.all_citations_real = true`
- `citation_integrity.bibliography_page_count >= 1`
- GATE-5 最终仍然保留人为确认

### `submit -> done`

当前仍不是 fully autonomous closeout。

- `submit` owner 是 `reviewer`
- Reviewer 负责 submit packet / external review / rebuttal preparation / gate artifacts
- 但最终 `done` 前保留 mandatory human decision

所以现阶段更准确的说法是：

- `auto-review` 可以把项目推进到 `submit-ready`
- 但不会绕过最终人工 gate 自动完成 OpenReview-facing final submission

## `auto-research` 覆盖的 handoff

`/auto-research "topic"` 启动的是实验论文主线：

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit`

其中真正的 cross-owner handoff 主要是下面这些。

### `idea -> plan`

- from: `researcher`
- to: `orchestrator`

条件：

- ideation contract 已 durably ready
- active track / selection / rationale 已具备
- `IDEA_REPORT.md` 和 track contract 足以进入 planning

逻辑：

- Researcher 不直接写 code plan
- 先让 `auto_iterator_tick` 计算下一 owner 应该是 `orchestrator`
- 再通过 handoff control plane 交给 `plan`

### `plan -> code`

- from: `orchestrator`
- to: `coder`

条件：

- `{PROJ}/orchestrator/PLAN.md`
- `{PROJ}/orchestrator/TODOS.md`
- `{PROJ}/orchestrator/PLAN_AUDIT.md`
- `research_program.plan_selection` 已锁定
- plan contract 进入 canonical workflow schema

逻辑：

- 计划写完不等于可 handoff
- 必须 materialize 到 `research_program`
- 然后才允许 `coder` claim

### `code -> experiment`

- from: `coder`
- to: `researcher`

条件：

- experiment bundle / manifest / README / index 已 durably 存在
- baseline / validation / ablation contract 没漂移
- dry-run 或最低验证完成

逻辑：

- Coder 只交付 experiment bundle
- 不自己接着跑分析
- 交回 Researcher 的 experiment lane 做 launch / monitor / reconcile

### `experiment -> analyze`

- from: `researcher`
- to: `analyzer`

条件：

- experiment ledger / runtime signal / result artifacts 已可分析
- monitor / reconciliation 已把运行态收成 durable state
- required experiment evidence 达到 ready-for-analysis

逻辑：

- Researcher 管运行和 reconciliation
- Analyzer 管 claim-evidence 提炼

### `analyze -> review`

- from: `analyzer`
- to: `reviewer`

条件：

- `CLAIM_EVIDENCE_MATRIX.md`
- `TRACK_VERDICTS.md`
- `UNSUPPORTED_CLAIMS.md`
- quality audit / theory support / review-facing packet 已生成

逻辑：

- Analyzer 把“结果”变成“可审稿的论证包”
- Reviewer 接手的是 review packet，不是生 raw experiment outputs

### `review -> write`

- from: `reviewer`
- to: `academic_writer`

条件：

- `REVIEW_REPORT.md` 和 review pressure packet 已 durable
- review verdict 允许进入 writing
- unsupported headline claims 已处理或降级

逻辑：

- Reviewer 暴露 reject-first 风险
- Writer 再据此起草论文

### `write -> submit`

- from: `academic_writer`
- to: `reviewer`

条件：

- reviewer-ready draft
- `main.tex` 存在
- writer paper 目录下至少一个 PDF 存在

然后 reviewer 侧还要继续通过：

- citation verification 必须 verified
- `all_citations_real = true`
- `bibliography_page_count >= 1`

## 哪些阶段不是 handoff

下面这些通常是**同 owner 内的阶段推进**，不是 cross-owner handoff：

- `setup -> graph_build`
- `graph_build -> frontier_mapping`
- `frontier_mapping -> idea`

在 survey 主线里也一样：

- `survey_review` 内部的 `bootstrap -> retrieval -> screening -> synthesis -> complete`

这些阶段通常还是同一个 owner 在做，只是 micro-stage 在前进。

## “无人推进时”现在怎么处理

owner 技能现在都允许一条安全恢复路径：

1. 如果当前 owner 的 durable outputs 已完成，但没人推进
2. 先调用 `research_workflow.auto_iterator_tick`
3. 如果下一 owner 明确、且没有 handoff 在移动
4. 再调用 `research_workflow.prepare_stage_handoff`

这个机制已经加到了：

- `researcher/research-pipeline`
- `researcher/survey-review`
- `orchestrator/plan-research`
- `coder/implement-experiment`
- `analyzer/analyze-results`
- `reviewer/review-phase`
- `academic_writer/paper-phase`
- 以及共享的 `workflow-handoff-signal`

重要边界：

- 它们可以**主动触发 control-plane handoff**
- 但不能因为 handoff 卡住就直接越权做下一个 owner 的工作

## 当前最重要的两条实现事实

### 1. 同频道新项目优先新绑定

现在同一个 Discord channel 启动新的 `auto-review` / `auto-research` 时，新的显式 rebind 会 supersede 同频道旧项目绑定，避免旧项目继续污染 channel resolution。

### 2. reviewer submit 现在要求真实 PDF 和真实引用验证

现在 reviewer submit readiness 不再只靠：

- draft 状态看起来 ready
- 或 compile status 元数据

而是要求：

- writer 目录下真实存在 PDF
- reviewer 写回真实 citation verification

## 相关页面

- [Workflow 控制平面](./workflow-control-plane.md)
- [Writing 与 Review](./writing-and-review.md)
- [Commands 与 Tools](../reference/commands-and-tools.md)
