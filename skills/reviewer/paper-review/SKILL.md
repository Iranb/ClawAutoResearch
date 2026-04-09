---
name: paper-review
description: "Adversarial self-review for your own paper packet before submission. Use to run reject-first simulation, novelty attack, unsupported-claim deletion, reverse outline checks, figure/table QC, and limitation stress tests on the current story contract."
argument-hint: "[paper packet or active track]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# Paper Review

这是当前 workflow 中承接 EvoSkills `paper-review` 方法论的显式入口。它不是给“别人的论文写审稿意见”，而是对**自己的论文包**做对抗式自审。

## 目标

把“这篇稿子好像已经能写”变成“这条故事链经得起 reviewer 的攻击”。

## 前置输入

优先读取：

- `{PROJ}/academic_writer/story/STORY_SPINE.md`
- `{PROJ}/academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- `{PROJ}/academic_writer/story/FALLBACK_NARRATIVE.md`
- `{PROJ}/academic_writer/story/REJECTION_RISK_TABLE.md`
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `{PROJ}/analyzer/TRACK_VERDICTS.md`
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`
- `{PROJ}/academic_writer/paper/main.tex` 或 section drafts

如果 durable reviewer pressure packet 还没准备好，先调用：

```json
{"action":"materialize_review_pressure_packet","reviewPressureMaterialization":{"basis_stage":"review"}}
```

## 核心协议

### 1. Reject-First Simulation

先写一段“为什么这篇稿子会被拒”的摘要，再写任何正面评价。

### 2. Attack Novelty

不要问“它是不是有点新”，而要问：

- 这个贡献 reviewer 会不会觉得一下午就能想到？
- 它到底新在 challenge、insight、contribution，还是只是模块拼接？
- novelty claim 能否被更窄、更可防守的表述替代？

### 3. Delete Unsupported Claims

对 Abstract / Introduction / Contributions 里的强 claim 做逐条检查：

- 没有直接证据的强 claim，先删，不要先辩护
- `SUPPORTED` 可做 headline
- `PARTIAL` 必须降调
- `UNSUPPORTED` 不得保留在 headline arc

### 4. Reverse Outline

把段落提纲从成稿里反向抽出来，检查：

- 每段是不是只有一个明确职责
- 段落顺序是不是自然导向下一个段落
- challenge 是否真的导向 insight，insight 是否真的导向 contribution

### 5. Figure / Table QC

检查：

- 图表是否真的支撑 claim
- caption 是否和正文一致
- 读者是否能从图表直接看到 novelty / limitation / boundary

### 6. Limitation Audit

必须显式写：

- scope boundary
- failure cases
- 哪些风险还没完全解决
- 主叙事若太强，fallback narrative 应如何切换

## Three Lenses

在给出最终 verdict 前，至少从这三个镜头各过一遍：

### 1. Internal Validity

- 中心 claim 是什么？
- 对应证据是什么？
- 证据到 claim 的 warrant 是否明确？
- 如果拿掉一条关键证据，故事会不会塌？

如果会塌，这篇稿子的主叙事仍然过脆。

### 2. External Validity

- 这个结论真正适用于什么数据、任务、设置？
- 作者有没有把边界条件写清楚？
- 有没有把局部结果说成普遍规律？

### 3. Contribution

- 这篇稿子让读者比之前多知道了什么？
- 这个 delta 是 meaningful 还是只是 nonzero？
- 如果一句话说不清 contribution delta，novelty claim 还不稳。

## Calibrated Rubric

在 reviewer 叙事里显式覆盖这五个维度：

- originality
- methodological rigor
- evidence sufficiency
- argument coherence
- writing quality

不要只说“感觉不错/不够新”。要说明是哪一个维度拖住了最终 verdict。

## Claim Verification Rule

对 Abstract / Introduction / contribution bullets 的强 claim，用下面的术语判断：

- `VERIFIED`
- `MINOR_DISTORTION`
- `MAJOR_DISTORTION`
- `UNVERIFIABLE`

其中：

- `MAJOR_DISTORTION` 不能留在 headline arc
- `UNVERIFIABLE` 不能靠辩护解决，必须删除、降级或补证据

## Durable Outputs

这一步的标准 durable outputs 是：

- `reviewer/story-pressure/REJECT_FIRST_REVIEW.md`
- `reviewer/story-pressure/NOVELTY_ATTACK.md`
- `reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md`
- `reviewer/story-pressure/REVERSE_OUTLINE.md`
- `reviewer/story-pressure/FIGURE_TABLE_QC.md`
- `reviewer/story-pressure/LIMITATION_AUDIT.md`

如果这些文件没齐，不要声称 paper review 已完成。

## 与当前 workflow 的关系

- `/review-phase` 是 reviewer 主循环
- `/paper-review` 是 story-facing adversarial review 方法
- 这两个入口应该共享同一个 durable `review_pressure_packet`

一句话：

`review-phase` 负责阶段推进，`paper-review` 负责把稿子按 reviewer 的最坏视角压一遍。
