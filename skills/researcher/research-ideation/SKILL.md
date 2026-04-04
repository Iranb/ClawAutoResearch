---
name: research-ideation
description: "Goal-driven research ideation: define the long-term goal, build graph-grounded novelty and challenge-insight trees, run well-established solution checks, and design candidate solutions through cross-domain transfer plus problem decomposition."
argument-hint: "[research direction]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# Research Ideation

这是当前 workflow 中显式承接 EvoScientist / EvoSkills `research-ideation` 方法论的入口。它不替代 `/idea-phase`，而是把 `idea-phase` 里的 graph-first ideation 方法写成明确的研究动作。

## 目标

把“读了很多论文”变成“形成可比较、可淘汰、可沉淀的研究方向”。

## 5 步流程

节奏要求固定为：

`宽搜文献 -> 反思本轮发现 -> 补 gap -> 再收窄问题 -> 进入 tournament`

不要把创新点理解成“多读几篇论文后突然有灵感”。真正要沉淀的是：

- 哪些 gap 真实存在
- 哪些方向已经被成熟方案占住
- 哪些方向虽然新，但不可做
- 哪些方向值得进入 top-3 memory

### Step 1: Define A Long-Term Goal

先锁定长期研究目标，而不是直接从一篇论文里摘一个局部创新点。

至少回答：

- 终局想解决什么问题？
- 为什么这件事有科学价值和实践价值？
- 当前项目的 baseline、primary metric、dataset envelope 是什么？

优先把这些信息对齐到：

- `PROJECT_MANIFEST.json.research_program`
- `TRACK_REGISTRY.json`

### Step 2: Build Literature Trees

必须同时构造两棵树：

- `Novelty Tree`
  - milestone task
  - representative pipeline
  - novel module
- `Challenge-Insight Tree`
  - 技术挑战
  - 已知 insight / response

在当前 repo 中，不要脱离图谱手工从零开始。优先复用：

- `graph/ANCHOR_INDEX.md`
- `researcher/FRONTIER_REPORT.md`
- frontier files
- `brainstorm_cycle.logic_chain`
- `brainstorm_cycle.evidence_chain`
- `brainstorm_cycle.storyline_brief`

然后通过：

```json
{"action":"materialize_ideation_contract","ideationMaterialization":{"basis_stage":"frontier_mapping"}}
```

生成 durable 的：

- `NOVELTY_TREE.md`
- `CHALLENGE_INSIGHT_TREE.md`
- `GRAPH_IDEATION_PACKET.json`

每轮文献扩展后都要先做一次小反思：

- 新增论文改变了哪个 challenge cluster？
- 有没有某条 old idea 已经被 closest prior work 覆盖？
- 哪些 baseline family 的 gap 其实只是 setting mismatch？
- 哪些 transfer bridge 值得带去下一轮 narrowing？

### Step 3: Well-Established Solution Check

不要在成熟解法已经占领的区域里做边际修补。

每个方向都要显式判断：

- `open`
- `occupied`
- `open_with_constraints`

结果写到：

- `WELL_ESTABLISHED_SOLUTION_CHECK.md`

### Step 4: Design A Solution

用两类方法推进方案，而不是简单拼已有模块：

- `cross-domain transfer`
- `problem decomposition`

对应 durable outputs：

- `CROSS_DOMAIN_TRANSFER.md`
- `PROBLEM_DECOMPOSITION.md`

如果当前方向明显依赖跨域迁移，不要直接跳去 tournament。先进入 IDEA-CATALYST 子流水线：

- `/idea-catalyst-decompose`
- `/idea-catalyst-translate`
- `/idea-catalyst-scout`
- `/idea-catalyst-gatekeeper`
- `/idea-catalyst-integrator`
- `/idea-catalyst-judge`

### Step 5: Validate And Narrow

把候选方向交给 `/idea-tournament` 做：

- tree-structured candidate expansion
- propose -> review -> refine
- ranking history
- top-3 summary
- research proposal

并要求 top-3 / killed directions / do-not-repeat lessons 回写到现有 graph-backed memory，而不是留在 chat 里。

## 记忆要求

不要再造单独 ideation memory。优先回写到现有结构：

- `brainstorm_cycle.working_memory_path`
- `brainstorm_cycle.reflection_chain_path`
- `brainstorm_cycle.storyline_brief_path`
- `innovation_reflection`
- `TRACK_REGISTRY.json`

## 什么时候用

适合在：

- `/graph-build` 完成后
- `/frontier-mapping` 完成后
- `/idea-phase` 需要把 graph-grounded brainstorm 收敛成真正研究方向时

如果只是要对已有候选方向做比较和排名，用 `/idea-tournament`。
