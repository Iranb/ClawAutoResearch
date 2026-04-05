---
name: idea-tournament
description: "Tree-structured idea expansion and ranking. Use after research-ideation / idea-phase to expand candidates across technique/domain/formulation axes, record propose-review-refine traces, rank with Elo-style or equivalent history, preserve top-3 directions, and extend the winner into a proposal."
argument-hint: "[research direction or active track set]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
  - Agent
---

# Idea Tournament

把“已经有研究方向”变成“经过系统比较后的冠军方向”。当前 workflow 中，`idea-tournament` 不再只是 pilot 排名器，而是 ideation contract 的显式收敛步骤。

## 角色

- `research-ideation` / `/idea-phase` 负责找到值得展开的问题空间
- `idea-tournament` 负责把候选方向做成：
  - tree-structured search
  - propose -> review -> refine trace
  - ranking history
  - top-3 direction summary
  - winner research proposal

## 输入

优先读取：

- `{PROJ}/researcher/ideation/GRAPH_IDEATION_PACKET.json`
- `{PROJ}/researcher/ideation/NOVELTY_TREE.md`
- `{PROJ}/researcher/ideation/CHALLENGE_INSIGHT_TREE.md`
- `{PROJ}/researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md`
- `{PROJ}/researcher/ideation/CROSS_DOMAIN_TRANSFER.md`
- `{PROJ}/researcher/ideation/PROBLEM_DECOMPOSITION.md`
- `{PROJ}/TRACK_REGISTRY.json`
- `brainstorm_cycle` 的 working / reflection / storyline briefs（通过 workflow-owned ideation contract 间接复用）
- 如果当前方向走了 IDEA-CATALYST，还要读：
  - `{PROJ}/researcher/idea-catalyst/DECOMPOSITION_PACKET.json`
  - `{PROJ}/researcher/idea-catalyst/ABSTRACTION_PACKET.json`
  - `{PROJ}/researcher/idea-catalyst/SCOUTING_REPORT.json`
  - `{PROJ}/researcher/idea-catalyst/GATE_DECISION.json`
  - `{PROJ}/researcher/idea-catalyst/IDEA_FRAGMENTS.json`
  - `{PROJ}/researcher/idea-catalyst/RANKED_FRAGMENTS.json`

如果上述 ideation scaffold 还没齐，先调用：

```json
{"action":"materialize_ideation_contract","ideationMaterialization":{"basis_stage":"frontier_mapping"}}
```

## 核心流程

### Phase 1: Tree Expansion

不要直接在“我最喜欢哪个方向”上做排序，先强制广度。

用三层树展开候选：

1. `Technique`
   - 同一问题下至少给出 2-3 个 genuinely different technical routes
2. `Domain`
   - 对每个 route 指定它最自然成立的约束 / 任务环境 / 失败场景
3. `Formulation`
   - 把每个 route 落成一个可验证的问题表述

候选总量上限默认是 `21`：

- technique layer 最多 7
- domain layer 最多 14
- formulation layer 最多 21

这样可以强制广度，但又不会让 tournament 失控。

当前 workflow 还要求：

- `target_candidate_count = 15`
- `hard_floor_candidate_count = 9`

如果 surviving pool 少于 `15`：

- 必须把 pool 标成 `scarce`
- 必须写出 `candidate scarcity reason`
- 不允许把一个很小的候选池假装成“已经充分探索”

每个节点都必须经历：

- `propose`
- `review`
- `refine`

只允许剪掉：

- 明显 infeasible 的分支
- 被 well-established solution check 判成 `occupied` 且没有新约束空间的分支

禁止凭直觉过早收窄。

### Phase 2: Ranking

对 surviving candidates 做四维评估：

- `novelty`
- `feasibility`
- `relevance`
- `clarity`

优先保留 pairwise / Elo 风格排序；如果当前环境无法真实跑 Elo tournament，也必须留下等价的 ranking history，而不是只写最终分数。

四个维度默认等权，不允许只按 novelty 单轴拍板。

最少要保留：

- 当前 round
- pairing / compared candidates
- 四维分数
- winner / loser
- composite score

### Phase 3: Top-3 Summary

不是只保留 top-1。

必须写出：

- top-3 候选方向
- 每个方向的核心 insight
- 每个方向的 primary risk
- 哪些方向应该：
  - `advance`
  - `park`
  - `merge`
  - `kill`

并把 top-3 / do-not-repeat / failed direction / transferable lessons 同步回现有 graph-backed memory，而不是再造一套平行 memory。

### Phase 4: Proposal Extension

把冠军方向扩成：

- `Background`
- `Related work pressure`
- `Method`
- `Experiment plan`
- `Expected results`
- `Risks and mitigations`

## Durable Outputs

本阶段的标准 durable outputs 是：

- `{PROJ}/researcher/ideation/IDEA_TREE.md`
- `{PROJ}/researcher/ideation/CANDIDATE_POOL.json`
- `{PROJ}/researcher/ideation/RANKING_HISTORY.json`
- `{PROJ}/researcher/ideation/TOURNAMENT_SCOREBOARD.json`
- `{PROJ}/researcher/ideation/TOP3_DIRECTION_SUMMARY.md`
- `{PROJ}/researcher/ideation/RESEARCH_PROPOSAL.md`

如果这些文件缺失，不要声称 tournament 已完成。

## 与现有 workflow 的关系

- `idea-phase` 负责 graph-first ideation grounding
- IDEA-CATALYST 子流水线负责跨域 challenge decomposition / abstraction / scouting / gating / fragment synthesis / judging
- `idea-tournament` 负责 competitive narrowing
- 后续 `plan` / `code` / `experiment` 以 `RESEARCH_PROPOSAL.md` 和 `CLAIM_TO_EXPERIMENT_MAP.md` 为约束

在当前 repo 中，workflow-owned `materialize_ideation_contract` 会自动生成 `IDEA_TREE.md`、`RANKING_HISTORY.json`、`TOURNAMENT_SCOREBOARD.json` 等 scaffold。默认先用这个 scaffold，再做 bounded refinement；不要从零手写另一套 tournament packet。

## 经验法则

- Quantity before quality
- Feasibility is not optional
- Top-3 比 top-1 更有价值
- Ranking history 比“最终直觉排序”更重要
- 问题选择的价值通常高于模块小修小补
