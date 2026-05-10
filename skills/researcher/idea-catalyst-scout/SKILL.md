---
name: idea-catalyst-scout
description: Use when IDEA-CATALYST needs graph-first cross-domain scouting, domain-distance filtering, and source-domain takeaways after abstraction is ready.
argument-hint: "[abstraction packet or active challenge]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Scout

这是 IDEA-CATALYST 最关键的一步：先走图，再让 LLM 辅助，而不是让模型自由猜 source domain。

## 目标

输出 `SCOUTING_REPORT.json`，其中至少要有：

- 候选 source domains
- domain distance / selection basis
- bridge nodes / takeaways
- `cross-domain searches`
- relevance pruning 结果

## 协议

1. 先复用图里的 domain / transfer / bridge 线索。
2. 优先用 graph-first traversal 和现有 `GRAPH_IDEATION_PACKET.json`。
3. 只有图证据不足时，才做 LLM-assisted fallback。
4. 保留为什么选这些 source-domain，而不是只给结果。
5. 每个 takeaways 都应尽量包含：
   - `source_domain_formulation`
   - `mechanism_explanation`
   - `selection_rationale`
   - `relevance_to_challenge`
   - `supporting_papers`
6. 对跨域文献检索，优先使用 workflow-owned `research30` 集成，而不是只停留在 query 草案。
7. source-domain 选择要基于 analogy / shared mechanism / transferable principle，而不是只选 target-domain 近邻。
8. 如果一个 source-domain 的多数检索结果和概念挑战无关，应标记为 insufficient，不要勉强提炼 takeaway。

## 与 research30 的关系

`SCOUTING_REPORT.json` 里的 `cross_domain_searches` 现在不再只是给 Agent 的静态提示。

当需要真正把 source-domain 检索跑起来时，优先调用：

```json
{
  "action": "run_idea_catalyst_research30",
  "ideaCatalystResearch30": {
    "days": 3650,
    "depth": "quick"
  }
}
```

它会：

- 读取 `SCOUTING_REPORT.json` / `INVESTIGATION_REQUISITION.json` 中的 query
- 通过 research30 的 OpenAlex / Semantic Scholar / PubMed / arXiv / HuggingFace 多源检索跑真实搜索
- 写出：
  - `{PROJ}/researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.json`
  - `{PROJ}/researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.md`
- 回写 `SCOUTING_REPORT.json.research30_validation`

注意：

- research30 适合做跨域文献的多源检索与 recent frontier 补强
- foundational / canonical 理论仍要结合图谱与 PaperNexus，不能把它误当成唯一真相源

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/SCOUTING_REPORT.json`

## 红线

- 不允许退化成“列 3 个看起来相关的学科”
- 不允许只按 target-domain 邻近领域做保守扩展
- 不允许把宽泛概念（如 Theory of Mind、feedback、adaptation）当成 takeaway，除非能说明具体机制如何回应当前 challenge
