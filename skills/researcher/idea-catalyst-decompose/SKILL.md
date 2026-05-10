---
name: idea-catalyst-decompose
description: Use when interdisciplinary ideation needs a target-domain decomposition packet before cross-domain scouting, especially when the workflow is building IDEA-CATALYST packets from graph evidence.
argument-hint: "[problem or active track]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Decompose

把目标领域问题拆成可以继续做抽象和跨域搜索的挑战包。

## 目标

生成 durable 的 `DECOMPOSITION_PACKET.json`，而不是只在对话里列几个问题。

## 你要做什么

1. 从当前 active track、`RESEARCH_PROPOSAL.md`、`GRAPH_IDEATION_PACKET.json`、frontier files 中抽取 2-6 个关键问题。
2. 先做 metacognitive target-domain check：明确哪些目标领域进展已经可见、哪些仍不确定、哪些 gap 值得跨域探索。
3. 每个问题都必须同时保留：
   - `domain-specific question`
   - `domain-agnostic question`
   - `coarse-grained domain`
   - `fine-grained domain`
   - `core challenge`
4. 对每个问题保留目标领域表述，并判断它更接近：
   - `resolved`
   - `partial`
   - `unexplored`
5. 为每个问题生成 3 条以上 `target_domain_queries`，用于后续 target-domain analysis 和 cross-domain 检索。
6. 为 `partial` / `unexplored` 问题写出 structured remaining challenges。
7. 给出优先级，优先保留真正值得跨域探索的挑战。

## 额外要求

- `target_domain_analysis` 需要至少包含：
  - `addressed_aspects`
  - `remaining_challenges`
  - `overall_assessment`
- `overall_assessment` 应明确是：
  - `largely unaddressed`
  - `partially addressed`
  - `substantially addressed`

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/DECOMPOSITION_PACKET.json`

如果 workflow-owned scaffold 还没生成，先调用：

```json
{"action":"materialize_idea_catalyst_state","ideaCatalystMaterialization":{"micro_stage":"decomposition"}}
```

## 边界

- 不要在这里直接做 source-domain 选择。
- 不要跳过 coverage 判断直接给结论。
- 不要过早收敛成具体算法或实验计划；这一阶段要产出问题和概念挑战。
- `domain-agnostic question` 必须是机制级抽象，不只是把 target-domain 术语删掉。
- 这一阶段的产物必须能被 `idea-catalyst-translate` 继续消费。
