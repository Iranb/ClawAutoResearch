# Writer Flow 流程优先化与可恢复写作门控方案

**状态：** implemented  
**日期：** 2026-04-13  
**目标：** 把当前 Writer 阶段从“终态文件存在性强约束”重构为“流程进度强约束 + 产物存在弱约束”，让 agent 可以在不完整草稿上稳定恢复、增量推进和最终收口，而不是反复把自己误判为“整篇稿子被 wipe，需要从头重建”。

**实现落点：**

- `tools/workflow-guard-writing/write-package-eval.ts`
- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/workflow-guard-state/authoring-review-state.ts`
- `tools/workflow-guard-setters/writing-state-setters.ts`
- `tools/research-writing/materializers.ts`
- `tools/workflow-guard-project/snapshot-builder.ts`
- `tools/workflow-guard-prompt-assembly.ts`
- `skills/academic_writer/paper-phase/SKILL.md`
- `skills/academic_writer/paper-write/SKILL.md`

---

## 1. 问题定义

当前写作阶段暴露出的核心问题不是单点 bug，而是 gate 设计错位：

1. `write` 阶段 gate 混入了大量 `submit` 级要求
2. writer 通过“文件是否存在”来判断当前进度，而不是通过 durable 进度状态
3. `paper_phase / paper_write` 缺少明确的 section-progress checkpoint
4. 部分 survey/research handoff 一进入 `write`，就被大量终态要求挡回，导致 writer 一再自我诊断：
   - “paper directory was wiped”
   - “need to rebuild full draft from SURVEY_BRIEF”

这会造成：

- 同一 writer session 反复输出相同的恢复叙述
- 对用户来说像“AI 卡住循环”
- 对 workflow 来说像“write stage 一直不稳定”

---

## 2. 现状问题

当前 `write` 阶段信号主要集中在：

- `tools/workflow-guard-stages/writing-stage-signals.ts`
- `tools/workflow-guard-setters/writing-state-setters.ts`

主要问题：

### 2.1 `write` gate 过度依赖终态产物

它要求：

- `PAPER_PLAN.md`
- `STORYLINE_SKETCH.md`
- `writing_session ready_for_submit`
- `graph_guided_writing ready`
- `main.pdf`
- `WRITING_SIGNALS.md`
- `cross-reviewer/`
- 各类 QC / citation / theory / review issue 全部接近 submit-ready

这些要求更像：

- **submit gate**

而不是：

- **write gate**

### 2.2 缺少 durable 的 section-progress 模型

虽然已有：

- `writing_session.section_packets`
- `draft_order`
- `finalized_sections`
- `compile_safe_sections`

但当前 gate 仍把重点放在：

- 文件缺不缺
- 所有 section packet 是否都存在

而不是：

- 当前写到哪一节
- 哪些 section 已有草稿
- 哪些 section 已过 review
- 哪些 section 只是还没 compile-safe

### 2.3 写作流程与最终产物没有分层

现在系统没有清楚区分：

- `write_bootstrap`
- `outline_ready`
- `drafting`
- `section_review`
- `manuscript_complete`
- `compile_ready`
- `submit_ready`

所以 writer 很容易在 “部分 section 还没写完” 时被系统当作“终态不完整，需要重建全文”。

---

## 3. 设计原则

1. **对流程严格**
2. **对单个产物文件宽松**
3. **允许增量恢复**
4. **允许 partial draft 存在**
5. **`write` 与 `submit` 分层**
6. **survey / experiment 共用同一写作进度协议**

---

## 4. 借鉴自 scientific-writing skill 的流程点

从外部 scientific-writing 流程中，最值得吸收的是：

### 4.1 分阶段写作，而不是终态导向写作

推荐的阶段：

1. `write_bootstrap`
2. `outline_ready`
3. `drafting`
4. `section_review`
5. `manuscript_complete`
6. `compile_ready`
7. `ready_for_submit`

### 4.2 reverse-outline / claim-evidence / paragraph logic 是硬流程

不要只要求：

- 文件在
- PDF 在

而要要求：

- 当前 section 是否有 thesis
- 段落职责是否清晰
- claim 是否有 evidence
- 当前 section 是否完成过 section-level prose review

### 4.3 恢复要基于 durable progress，不基于目录直觉

writer 每次恢复时应该先问：

- 哪些 section 已存在
- 哪些 section packet 已有 draftPath / reviewPath / verdict
- 当前 `writing_session.status` 是什么

而不是一上来就：

- “paper directory 被 wipe，重建全文”

---

## 5. 新的 write-stage 模型

### 5.1 `write` gate 只检查“是否能进入写作流程”

`write` 阶段的 hard requirements 应收敛到：

- `paper_story_state` ready
- `review_pressure_packet` ready
- `writing_contract` valid
- 如果 template required，则 template 可读
- 如果 KG storyline required，则 KG storyline packet ready

允许缺失：

- `main.pdf`
- `refs.bib`
- `WRITING_SIGNALS.md`
- `cross-reviewer/`
- 所有 section packet
- `writing_session ready_for_submit`
- final QC / final citation verification

这些应该留给：

- `submit` gate

### 5.2 新增 writing process readiness helper

新增一个派生 helper，例如：

- `evaluateWritingProcessReadiness(...)`

输出：

- `processStatus`
  - `missing`
  - `bootstrapping`
  - `outline_ready`
  - `drafting`
  - `section_review`
  - `manuscript_complete`
  - `compile_ready`
  - `ready_for_submit`
- `missingSections`
- `draftedSections`
- `reviewedSections`
- `compileSafeSections`
- `finalizedSections`
- `requiredSections`
- `nextSuggestedSection`
- `rebuildNeeded`
- `rebuildReason`

### 5.3 `rebuildNeeded` 只能在真正条件下为 true

只有这些情况才允许判定“需要重建”：

- `main.tex` 缺失且所有 section 也缺失
- `writing_session` 缺失且 paper dir 几乎为空
- 模板 required 但 project-local template copy 缺失
- section files 存在但全部不可读或 stale 且无可恢复 packet

不能因为：

- 部分 section 缺失
- `refs.bib` 缺失
- `benchmarks.tex` / `conclusion.tex` 还没写

就把整个项目说成“paper directory was wiped”

---

## 6. 具体代码改造

### 6.1 新增写作进度 helper

文件：

- `tools/workflow-guard-writing/write-package-eval.ts`
  或拆成新模块：
- `tools/workflow-guard-writing/write-progress.ts`

职责：

- 从 `writing_contract` + `writing_session` + 文件系统
  推导出 process-first progress

### 6.2 重构 `collectWriteStageMissingSignals`

文件：

- `tools/workflow-guard-stages/writing-stage-signals.ts`

改法：

- `collectWriteStageMissingSignals` 只保留 `write` 入口和中途流程的硬阻塞
- 把以下内容挪出 `write` gate：
  - `main.pdf`
  - `citation_integrity.verification_status = verified`
  - `WRITING_SIGNALS.md`
  - `cross-reviewer/`
  - `writing_session ready_for_submit`
  - `graph_guided_writing ready_for_submit`
  - final paper QC / figure QC / citation collection hard blockers

这些统一进入：

- `collectSubmitStageMissingSignals`

### 6.3 丰富 `writing_session`

文件：

- `tools/workflow-guard-state/authoring-review-state.ts`
- `tools/workflow-guard-setters/writing-state-setters.ts`

新增/强化字段：

- `process_status`
- `outline_ready`
- `drafted_sections`
- `reviewed_sections`
- `manuscript_complete`
- `compile_ready`
- `rebuild_needed`
- `rebuild_reason`
- `next_suggested_section`

要求：

- `setWritingSessionState` 可以显式写这些字段
- 缺失时也能由 helper 自动推导

### 6.4 快照与 prompt 组装

文件：

- `tools/workflow-guard-project/snapshot-builder.ts`
- `tools/workflow-guard-prompt-assembly.ts`

要求：

- 快照里暴露当前写作进度，而不是只暴露 submit-ready 布尔量
- prompt 里优先提示：
  - 已完成哪些 section
  - 缺哪些 section
  - 当前应该继续哪一节

而不是直接说：

- “paper directory 被 wipe，需要重建全文”

### 6.5 paper-write / paper-phase skill 更新

文件：

- `skills/academic_writer/paper-write/SKILL.md`
- `skills/academic_writer/paper-phase/SKILL.md`

要求：

- 明确恢复顺序：
  1. 读取 `writing_session`
  2. 读取现有 `sections/*.tex`
  3. 只重建缺失或 stale 的 section
- 除非 `rebuild_needed = true`
  - 否则禁止宣告“paper directory was wiped”
- 鼓励 section-by-section continuation
  - 不鼓励每轮先宣布“我要重建全文”

### 6.6 runtime materializers

文件：

- `tools/research-writing/materializers.ts`
- 视需要：
- `tools/workflow-guard-materializers/paper-story-materializer.ts`

要求：

- `materialize_writing_support_artifacts` 除了生成 story bundle，还应能初始化最小 `writing_session`
- 当 `write` 阶段刚开始时：
  - 至少生成 section queue / next_suggested_section
  - 而不是让 writer 从空状态自猜

---

## 7. 新的 gate 分层

### 7.1 Write gate

硬要求：

- story ready
- writing contract ready
- review pressure ready
- template / KG storyline（如果 required）ready

软要求：

- section packets可逐步补
- `WRITING_SIGNALS.md` 可后补
- `main.pdf` 不要求

### 7.2 Submit gate

硬要求：

- manuscript complete
- compile ready / main.pdf exists
- citation verified
- final review pressure resolved
- QC pass
- `writing_session.ready_for_submit = true`

---

## 8. 测试策略

### 8.1 新增 / 更新测试

1. `write` 阶段不会因为缺 `main.pdf` 阻塞进入写作
2. 部分 section 已存在时，writer progress 显示为增量 continuation，而不是 rebuild
3. 只有真正空目录 / template丢失 / 全量 stale 才会 `rebuild_needed = true`
4. survey write line 不因缺 final artifacts 被挡在 `survey_review`
5. `submit` 仍然对 `main.pdf` / citation / QC 严格

### 8.2 针对本次 bug 的回归

复现：

- 有 `main.tex`
- 有部分 `sections/*.tex`
- 缺若干 section / refs.bib
- writer session 恢复

期望：

- 不再反复说“paper directory was wiped”
- 而是识别为：
  - partial draft
  - continue missing sections

---

## 9. 验收标准

以下全部满足才算完成：

1. `write` gate 不再要求 submit 级产物
2. writer 能在 partial draft 上稳定恢复
3. “paper directory was wiped” 只在真正需要重建时出现
4. survey / experiment 两条写作线都保持 process-first 进度感知
5. `submit` gate 仍保持严格

---

## 10. 实施顺序

1. 先落 plan
2. 加 writer progress helper
3. 重构 `collectWriteStageMissingSignals`
4. 扩展 `writing_session` 结构
5. 更新快照 / prompt / skill
6. 跑写作相关测试与 docs build
