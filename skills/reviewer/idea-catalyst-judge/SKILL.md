---
name: idea-catalyst-judge
description: Use when IDEA-CATALYST needs independent pairwise ranking of interdisciplinary idea fragments after synthesis and before track integration.
argument-hint: "[idea fragments packet]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# IDEA-CATALYST Judge

 Judge 必须和 Integrator 分离，generator must not judge its own output。

## 目标

对 `IDEA_FRAGMENTS.json` 做 pairwise ranking，输出 durable 的 `RANKED_FRAGMENTS.json`。

## 评估重点

- depth of integration：source-domain mechanism 是否真正映射到 target-domain challenge
- multi-stage disciplinary engagement：是否消费了 target-domain analysis、source takeaways、recontextualization，而不是一跳类比
- innovation payoff：是否可能解决高影响 unresolved conceptual challenge
- novelty + feasibility：是否对目标领域专家非显然，同时足够可信，能进入 bounded pilot / investigation
- interdisciplinary usefulness：是否带来更强的问题解决潜力，而不是只更易实现

## 协议

- 优先 pairwise / Elo-style，而不是单条 scalar 自评分
- 给出 ranking history 或 pairwise evidence
- 输出 top fragment，并说明为什么它比其他片段更值得进入 track registry
- 不要因为 source-domain 更远就惩罚它；判断远距是否带来了概念杠杆
- 不要把文字更短、更顺或更直接当成更好；polish 不是主要评估对象

## Durable 输出

- `{PROJ}/researcher/idea-catalyst/RANKED_FRAGMENTS.json`

## 边界

- Judge 不负责生成新 fragment
- Judge 不负责改写 proposal
- Judge 的工作结束后，结果会继续流向 `idea-tournament` 和 `TRACK_REGISTRY.json`
