---
name: idea-phase
description: "Research idea discovery: literature survey → graph build → frontier mapping → track generation → novelty check → portfolio selection. Use when starting a new research direction."
argument-hint: "[research-direction]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Agent
  - Skill
---

# Idea Phase

从文献到 track portfolio，包含 PaperNexus 图谱前置、graph-grounded 头脑风暴、对抗式 novelty 过滤和 pilot 实验验证。

## Pipeline

```
/research-lit → /graph-build → /frontier-mapping → /idea-generator → /novelty-check → /research-reflect → Cross-model Review
     ↓               ↓                ↓                  ↓                  ↓                  ↓                    ↓
  landscape      local corpus     graph frontier     4-8 tracks         验证新颖性         portfolio decision    深度审稿
  + gaps         + PaperNexus     + subgraphs        + diverge/converge  → 淘汰已做         → advance/park/kill  → IDEA_REPORT.md
```

## Execution

### Phase 1: Literature Survey

```
/research-lit "$ARGUMENTS"
```

读取 `{PMEM}/ideation-memory.md`（如存在），了解已知失败方向。`{PMEM}` = `{PROJ}/memory`

这一阶段必须同时完成全文语料积累：
- 先用 `/papers-cool` 做粗检索和 venue sweep
- 对关键论文优先用 `/hugging-face-paper-pages` 拉取全文 markdown
- 若拿不到 markdown，则回退到 `/papers-cool` 下载 PDF
- 把 markdown / PDF 保存到 PaperNexus 源目录，再进入 `/graph-build`
- 如果当前 graph 里还没有这些关键论文，必须先刷新 graph，再进入创新点分析

**Output**:
- `{PROJ}/researcher/LITERATURE.md`（landscape、gaps、key methods、baselines）
- `paper_source_dir` 下的 markdown / PDF 语料
`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

### Phase 2: Graph Build

```
/graph-build "$ARGUMENTS"
```

构建或刷新 `{PROJ}/graph/` 下的 PaperNexus corpus。优先使用本地 PDF / Markdown 文献；若项目里尚无本地 paper corpus，则可用 `LITERATURE.md` 作为 bootstrap graph source。

**Output**:
- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/graph/GRAPH_BUILD_REPORT.md`

### Phase 3: Frontier Mapping

```
/frontier-mapping "$ARGUMENTS"
```

基于 PaperNexus graph 提取四类 brainstorm frontier：
- limitation-driven
- contradiction-driven
- transfer-driven
- composition-driven

**Output**: `{PROJ}/researcher/FRONTIER_REPORT.md`

同时要求 `{PROJ}/graph/subgraphs/` 非空，并保留 graph anchor 快照。

### Phase 4: Idea Generation

```
/idea-generator "$ARGUMENTS"
```

执行 graph-grounded dialectic loop：
1. 基于 `LITERATURE.md` + `FRONTIER_REPORT.md` + `graph/subgraphs/` 做一次 **diverge**，生成 4-8 个 typed tracks
2. track 必须覆盖图谱透镜中的多种来源：limitation / contradiction / transfer / composition
3. 每条 track 都要附带 graph evidence packet：
   - anchor nodes / relations
   - why-now / why-this-gap-matters
   - weakest assumption
   - one falsifier pilot
4. 对 surviving tracks，可把 graph evidence packet 交给 Orchestrator 做一次结构化 innovation construction，收敛成更可执行的 hypothesis package
5. 对候选 track 做 attacker / novelty 初筛
6. 对 surviving tracks 做一次 **converge**，收敛成 portfolio，而不是只取一个 top-1
7. 可行性 + 新颖性初筛后保留 2-3 个候选 active tracks
8. 保留至多 1 个 parked track
9. 对 active tracks 做并行 pilot 实验（小规模快速验证）
10. 按 pilot 实证信号排序并写入 `TRACK_REGISTRY.json`

**Output**:
- 初步 `{PROJ}/researcher/IDEA_REPORT.md`
- `{PROJ}/TRACK_REGISTRY.json`

### Phase 5: Novelty Check

```
/novelty-check "[top idea description]"
```

对每个 top idea：
- 多源检索（via papers.cool scripts — keyword search + venue sweep）
- 外部 LLM 交叉验证
- 输出：PROCEED / PROCEED WITH CAUTION / ABANDON
- 若图谱显示该方向与已有 track 仅是换壳重述，应直接 kill 或 merge

### Phase 6: Portfolio Decision

```
/research-reflect "idea portfolio"
```

对 surviving tracks 执行一次显式决策：

- `advance` — 进入 plan
- `park` — 暂时保留但不消耗预算
- `merge` — 合并到更强的 track
- `kill` — 终止并写入失败记忆

要求：
- 最多 2 条 `active` track
- 最多 1 条 `parked` track
- 明确写入 `{PROJ}/TRACK_REGISTRY.json`
- 尽量形成一个有分工的 portfolio，例如 `safe-bet / high-upside / bridge-composition`

### Phase 7: Cross-model Review

通过 `sessions_send` 将 IDEA_REPORT 提交给 Reviewer Agent 评审：
- Reviewer 以审稿人视角评估 idea
- 返回评分 + 改进建议
- 更新 `{PROJ}/researcher/IDEA_REPORT.md`
- 如 reviewer 认为 portfolio 过宽，优先缩 scope 而不是保留更多 tracks

如果文献阶段中新增了大量本地 paper markdown / PDF，且与当前 frontier 显著不同，必须在最终决定前重新运行 `/graph-build --force` 和 `/frontier-mapping`。

### 记忆更新

Phase 完成后更新 `{PMEM}/ideation-memory.md`：
- 有效选题模式（IDE: Idea Discovery Evolution）
- 如果所有 idea 被否决：记录失败分类（IVE: Idea Validation Evolution）
- 如果某条 track 被 kill：记录其 falsification signal 和不要重试的条件
