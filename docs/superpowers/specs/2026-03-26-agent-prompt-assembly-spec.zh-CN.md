# Agent Prompt 组装规范

**状态：** Draft  
**日期：** 2026-03-26  
**范围：** `openclaw-research` 中由 workflow hook 注入到 agent 前置上下文的 prompt 组装方式  
**目标角色：** `academic_writer`、`reviewer`、`cross-reviewer` 为重点，其他角色可复用同一原则

---

## 1. 目的

这份规范定义的是：

- 哪些 workflow 状态应该进入 agent 的 active prompt
- 哪些状态只应保留在 manifest、trace 或 status 里
- prompt 应如何分层，而不是被拼成一个越来越长的状态大杂烩
- 写作 / 审稿 agent 在多轮修订中应该如何只关注“当前这一步”

这份规范的核心目标不是“让 prompt 更全面”，而是：

**让 prompt 更聚焦、更稳、更不容易让 agent 忘掉当前主任务。**

---

## 2. 核心原则

### 2.1 状态不等于提示词

workflow 系统可以维护很多状态，但并不意味着这些状态都应该进入 agent 的 active prompt。

系统状态的首要去向应该是：

1. manifest
2. trace
3. workflow-status / snapshot
4. 只有在会改变 agent 当前动作时，才进入 prompt

### 2.2 Prompt 注意力是稀缺资源

越长的 prompt，不代表越可靠。相反，在写作和审稿任务里，过长 prompt 更容易导致：

- 当前任务被 diluted
- 局部约束被弱化执行
- output 变得模板化和泛化
- 多轮修订时“状态越来越多、任务越来越模糊”

### 2.3 当前步骤优先于全局状态

Agent 此刻应该优先知道的是：

- 我现在到底在做什么
- 当前处理的是哪个 section / review lane / issue set
- 这一轮具体要解决什么

而不是：

- 整个项目所有阶段的全量状态
- 与当前动作无关的历史摘要
- 大量不会改变当前决策的全局字段

### 2.4 远端状态应摘要化

离当前任务较远的状态只能以**短摘要**出现，而不能以大段结构化 dump 出现。

例如：

- 可以说“citation verification 仍未完成”
- 不应该把整个 `citation_integrity` block 原样塞进写作 prompt

---

## 3. Prompt 分层模型

Active prompt 应按层组装，而不是平铺拼接。

### Layer 1: 稳定角色策略

这一层是小而稳定的规则，应尽量跨轮次保持不变。

适合放在这里的内容：

- 不要 hallucinate evidence
- 不要 invent citations
- 不要越权写入不允许的目录
- 不要绕过 workflow gate
- 对当前角色的核心职责提醒

不适合放在这里的内容：

- 当前 section 的具体问题
- 当前 round 的 blocker
- 大段项目历史

### Layer 2: Stage-local 控制状态

这一层只放当前子任务所需的最小 workflow 控制信息。

建议字段：

- `current_stage`
- `current_micro_stage`
- `owner_agent`
- `next_action`
- `resume_action`
- `blocking_reason`
- 当前 worker 允许写入的路径摘要
- 当前 stage 缺失的 1-5 条最关键 signal

注意：

- 不要把完整 `WorkflowSnapshot` 全量塞进去
- 不要在这一层放 PaperNexus、idle research、全项目 experiment memory 等远端状态

### Layer 3: 主任务载荷

这是整个 prompt 的主载荷，应占据注意力中心。

对 Writer 来说，主载荷应该是：

- 当前 `section packet`
- 当前 section draft
- 当前 round 要解决的问题

对 Reviewer 来说，主载荷应该是：

- 当前 `review packet`
- 当前 issue set
- 当前 round 的 review lane 和目标

这一层应明确包含：

- 当前对象是谁
- 目标是什么
- 不能做什么
- 必须检查什么

### Layer 4: 窄化后的支撑证据

这一层放当前步骤真正需要的 supporting evidence。

原则：

- 只给当前步骤需要的证据
- 不给“将来可能会有用”的证据
- 不给和当前 section / issue 无关的材料

写作时的例子：

- 写 `results` 时给相关 claim-evidence matrix 片段、相关 figure summary、相关实验 summary
- 不要把整个项目的所有 track summary 都放进去

审稿时的例子：

- evidence review 只给 claim support 相关材料
- surface review 只给 PDF、caption/text/figure 相关材料

### Layer 5: Reflection Delta

只在 revision / reflection 轮次出现。

这一层应只放：

- 新发现的问题
- 上一轮未解决的问题
- 最新 compile / figure / citation / review failure

不要做的事：

- 每一轮都把完整历史重放一遍
- 把所有旧问题和所有旧上下文反复复制到 prompt 里

---

## 4. 哪些状态可以进 Prompt，哪些不应该进

### 4.1 默认允许进入 Active Prompt 的状态

以下状态在“会影响当前动作”时允许进入：

- 当前 `stage` / `micro_stage`
- `next_action`
- `blocking_reason`
- `review_issue_tracker` 的当前 issue delta
- 与当前 section 直接相关的 `paper_qc` / `figure_qc` 失败摘要
- 与当前回合直接相关的 `citation_collection` 进度摘要
- 当前 `writing_session` 的局部字段
- 当前 `review_session` 的局部字段
- 当前 section packet
- 当前 round 需要处理的 issue delta
- 当前角色允许写入的路径摘要

### 4.2 默认不应该进入 Active Prompt 的状态

以下状态默认不应整块进入：

- 完整 `PROJECT_MANIFEST.json`
- 完整 `WorkflowSnapshot`
- 完整 `TRACK_REGISTRY.json`
- 完整 `EXPERIMENT_LEDGER.json`
- 完整 `EXPERIMENT_SEARCH.json`
- 完整 `review_issue_tracker`
- 完整 `paper_qc` / `figure_qc` / `citation_integrity`
- 与当前 section 无关的 graph / idea / experiment 历史
- Idle research 与 background task 明细

这些状态可以存在于系统中，但默认只应：

- 用于 gate
- 用于 status
- 用于 trace
- 用于生成一个很短的摘要

### 4.3 可摘要进入的状态

以下状态只应以短摘要方式进入：

- `citation_integrity`
  - 例如：`citation verification is still pending`
- `citation_collection`
  - 例如：`citation collection is still running, 8/24 verified`
- `figure_qc`
  - 例如：`two figure-caption alignment issues remain`
- `paper_qc`
  - 例如：`page budget exceeded by 0.5 page`
- `review_issue_tracker`
  - 例如：`one high-severity surface issue remains in Results`
- `experiment_search`
  - 例如：`experiment search is in ablation_studies with multi-seed ready`
- `external_review_state`
  - 例如：`external review concluded: major_revision`

---

## 5. Writer Prompt 规范

### 5.1 Writer 的当前主任务永远是“一个 section”

Writer 在 active prompt 中默认只能有一个主 section。

默认规则：

- 一次只聚焦一个 active section packet
- framing section 和 body section 不要同时作为主任务载荷
- 如果多个 section 都需改动，应拆成多轮或多次调用

### 5.2 Writer Prompt 的推荐结构

推荐顺序：

1. 稳定角色规则
2. 当前 stage 控制状态
3. 当前 section packet
4. 当前 section draft
5. 当前 round 需要修的 issue delta
6. 当前 section 所需的窄化证据

### 5.3 Writer 必须看到的局部字段

当前 section packet 至少应提供：

- `section`
- `section_class`
- `goal`
- `allowed_claims`
- `forbidden_unsupported_claims`
- `required_graph_evidence_pointers`
- `required_figure_ids`
- `required_citation_count`
- `dependent_sections`
- `stale`

Writer 额外允许看到的摘要状态：

- 与当前 section 直接相关的 `review_issue_tracker` issue delta
- 当前 section 会受影响的 `figure_qc` fail / pending 摘要
- 当前 round 必须解决的 `paper_qc` fail 摘要
- `write_package` 的极短摘要，只限：
  - `status`
  - `assembly_status`
  - `assembly_mode`
  - `pending_reason`
  - 与当前 section 直接相关的 queue / derived artifact 摘要
- 如果当前轮正在补 citation，则给出 `citation_collection` 的极短进度摘要

Writer 默认不应看到：

- 完整 `paper_qc`
- 完整 `figure_qc`
- 完整 `citation_collection`
- 完整 `review_issue_tracker`
- 完整 `experiment_search`
- `review_verdict`

### 5.4 Writer 默认不应看到的东西

默认不应直接看到：

- 完整 graph frontier 报告
- 所有 track 的实验历史
- 所有 section packet 的全文
- 和当前 section 无关的 issue 列表
- 全量 auto gate / mailbox / background task 细节

---

## 6. Reviewer Prompt 规范

### 6.1 Reviewer 也应遵守“单主载荷”原则

Reviewer 的 active prompt 也不应同时承载太多不同任务。

推荐做法：

- evidence review 时，只给 claim support 相关材料
- surface review 时，只给 PDF、figure、caption、text alignment 相关材料
- submission simulation 时，只给 near-submit 的整体验证材料

### 6.2 Reviewer Prompt 的推荐结构

推荐顺序：

1. 稳定角色规则
2. 当前 review lane 与当前 round
3. 当前 review packet 或 issue set
4. 当前 lane 所需的材料
5. 当前轮新增问题或未关闭问题 delta

### 6.3 Reviewer Prompt 不应成为“全项目回顾”

Reviewer 的 prompt 不应塞满：

- 项目完整历史
- 所有旧 round 的完整文本
- 与本轮 lane 无关的 workflow 状态

Reviewer 的重点应是：

- 这轮要看什么
- 这轮还有哪些 blocker
- 这轮输出要落到哪里

---

## 7. 对 `AI-Scientist-v2` 的借鉴方式

`AI-Scientist-v2` 在这方面最值得借的不是“prompt 更长”，而是“上下文按步骤过滤”。

### 7.1 Citation Gathering

只给 citation 相关 summary 和当前已有 bibliography。

### 7.2 Writeup

只给：

- 当前 idea
- 经过过滤的 experiment summary
- 当前 plot 列表
- plot description
- 当前 LaTeX

### 7.3 Reflection

只给：

- 当前草稿
- 当前 compile 结果
- 当前 `chktex`
- 当前 unused / invalid figure 信息
- 当前 VLM figure review

它并没有在 reflection 阶段重新灌入所有上游状态。

### 7.4 我们应该如何吸收

我们应借的是：

- step-specific filtering
- revision delta 优先
- 当前主任务载荷优先

而不是：

- 超长 system prompt
- 所有状态无限累加

---

## 8. Focused Prompt 模式

在当前实现中，`academic_writer`、`reviewer`、`cross-reviewer` 应优先使用 focused prompt 模式。

Focused 模式的目标是：

- 保留 owner gate
- 保留 next action
- 保留少量 blocker
- 明确主任务载荷
- 明确 prompt assembly 规则
- 删去与当前任务关系较远的大量状态输出

Focused 模式默认应避免显示：

- `Idle research`
- `PaperNexus`
- 长串 theory / graph / experiment 背景规则
- 对当前子任务无直接影响的远端状态

对于 `write_package`，Focused 模式尤其不应直接注入：

- 完整 `WRITE_PACKAGE.json`
- 完整 assembly report
- 与当前 section 无关的全量 derived artifact payload

更合理的做法是：

- Layer 2 只给 `write_package` 的状态结论
- Layer 3 只给当前 section 真正要消费的 queue item / section packet
- Layer 4 才给与当前 section 直接相关的 `figure_pack` / `table_pack` / `citation_candidates` 摘要
- 如果 assembly 仍有阻塞项，只给当前轮要处理的那几个 blocker，不重复 dump 全量缺口

---

## 9. Prompt 压力预算

系统应显式管理 prompt 压力，而不是假设模型会自动过滤。

建议约束：

- 不要把完整 workflow snapshot 注入 section-writing turn
- 远端状态默认压缩到 3-7 行摘要
- 一轮只允许一个主载荷对象
- 历史上下文默认只保留最近一轮 revision delta
- 如无必要，不要把 manifest 原样 dump 给 agent

简单判断原则：

**如果某个字段不会改变当前 worker 现在这一轮的动作，就不应该出现在 active prompt 里。**

---

## 10. Prompt Trace 元数据

为了防止 prompt 逐步失控，trace 里应记录 prompt 组成的高层元数据。

建议记录：

- `prompt_layer_profile`
  - `stable_policy`
  - `stage_local_state`
  - `primary_payload`
  - `supporting_evidence`
  - `reflection_delta`
- `prompt_payload_sizes`
  - 每层大致字符数或 token 数
- `section_context_id`
- `review_lane`
- `round_id`

注意：

- 不必把完整 prompt 全量持久化
- 重点是可监控 prompt 是否正在从“聚焦分层”滑向“状态大杂烩”

---

## 11. 实施建议

### 11.1 先做 focused prompt，不要先做更大全量 prompt

如果要扩展 prompt，优先扩展 focused 模式，而不是继续把 full snapshot 堆长。

### 11.2 先让状态进 manifest，再决定是否进 prompt

新增状态块时，应先回答：

- 它是不是一个 gate？
- 它是不是一个 status？
- 它是不是一个 trace 维度？

只有最后才问：

- 它要不要进入 active prompt？

### 11.3 Prompt 规范必须和状态规范一起维护

每加一个新的 runtime state，都要同步决定：

- 是否进 prompt
- 进哪一层
- 何时允许出现
- 何时必须禁止出现

---

## 12. 最终建议

Prompt 设计不应追求“把系统知道的一切都告诉模型”。

Prompt 设计应追求：

- 只告诉模型当前真的需要知道的东西
- 把状态留给 control plane
- 把注意力留给当前任务

对于 `openclaw-research` 这样的 workflow 系统来说，最健康的关系应该是：

**manifest 管状态，gate 管推进，trace 管追责，prompt 只管当前这一步怎么做好。**
