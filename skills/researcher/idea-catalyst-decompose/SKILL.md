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
2. 对每个问题保留目标领域表述，并判断它更接近：
   - `resolved`
   - `partial`
   - `unexplored`
3. 为 `partial` / `unexplored` 问题写出 remaining challenges。
4. 给出优先级，优先保留真正值得跨域探索的挑战。

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/DECOMPOSITION_PACKET.json`

如果 workflow-owned scaffold 还没生成，先调用：

```json
{"action":"materialize_idea_catalyst_state","ideaCatalystMaterialization":{"micro_stage":"decomposition"}}
```

## 边界

- 不要在这里直接做 source-domain 选择。
- 不要跳过 coverage 判断直接给结论。
- 这一阶段的产物必须能被 `idea-catalyst-translate` 继续消费。
