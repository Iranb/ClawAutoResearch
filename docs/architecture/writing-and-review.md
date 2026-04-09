# Writing 与 Review

这套系统把“写作”定义为消费上游结构化证据的阶段，而不是单纯把结果润色成论文。

## 1. 写作的输入不是散文件

进入 `write` 之前，系统希望你已经拥有对应主线的结构化输入。

### 实验论文主线

系统希望你已经拥有：

- `paper_story_state`
- `review_pressure_packet`
- `writing_contract`
- claim-evidence artifacts
- figures / tables / theory support

Writer 消费的是这些 durable packets，而不是去实验目录里临时捞材料。

### 科研综述主线

如果项目走的是综述线，Writer 的核心输入会变成：

- `PROJECT_MANIFEST.json.survey_review`
- `researcher/SURVEY_BRIEF.md`
- `researcher/LITERATURE_REVIEW.md`
- `researcher/GAP_SYNTHESIS.md`
- `researcher/COVERAGE_SUMMARY.md`
- `writing_contract.paper_mode = survey`

这时系统不会再要求你先具备完整的实验 claim map，重点转为主题组织、coverage、gap articulation 和 survey-mode template 对齐。

## 2. 为什么 review 要发生在 write 前面

`review` 阶段的职责不是等草稿写完以后再打击士气，而是提前把高风险问题系统化暴露出来：

- unsupported claims
- novelty attack
- reverse outline
- figure/table QC
- limitation audit

这样 Writer 在真正写的时候，能少走很多返工弯路。

## 3. Analyzer 的责任为什么延伸到 story state

Analyzer 不是只负责“解释指标”，还负责把结果转成写作层可用的 story surface，例如：

- `CLAIM_EVIDENCE_MATRIX.md`
- `TRACK_VERDICTS.md`
- `UNSUPPORTED_CLAIMS.md`
- `THEORY_SUPPORT_NOTE.md`

这些内容再通过 materializer 收束到 `paper_story_state`。

## 4. Writing contract 为什么重要

`writing_contract` 约束的内容包括：

- 目标模板路径
- paper mode
- section order
- template copy status
- proof appendix 需求
- theory note 路径

它避免 Writer 在完全脱离模板的情况下自由发挥。

现在 `paper mode` 已经不只区分 conference / journal，也支持 `survey`。这让综述项目可以复用同一套 workflow 控制平面，同时走一套不同于实验论文的写作合同。

## 5. submit 不是写完就结束

`submit -> done` 之间还保留显式 gate，尤其在人类确认、外部评审对齐和最终提交材料完整性上，这一层不会轻易自动跳过。
