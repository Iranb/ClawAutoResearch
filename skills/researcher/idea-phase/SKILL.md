---
name: idea-phase
description: "Research idea discovery: literature survey → graph readiness / brainstorm refresh → frontier mapping → track generation → novelty check → portfolio selection. Use when starting a new research direction."
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
  - research_workflow
---

# Idea Phase

从文献到 track portfolio，包含系统文献综述、Zotero 文献组织、PaperNexus 图谱前置、graph-grounded 头脑风暴、bounded scientific brainstorming、对抗式 novelty 过滤和 pilot 实验验证。当前 workflow 要求这一阶段落成 durable `ideation_contract`，而不是只留下自由文本 brainstorm。

## Pipeline

```
/research-lit → /literature-review (if needed) → /graph-build → /frontier-mapping → /scientific-brainstorming → /innovation-reflection (if due) → /idea-generator → /novelty-check → /research-reflect → Cross-model Review
     ↓                      ↓                        ↓                ↓                           ↓                        ↓                  ↓                  ↓                    ↓
  landscape            SoTA matrix + Zotero      remote graph     graph frontier         bounded divergence              实验后反思 + do-not-repeat      4-8 tracks         验证新颖性         portfolio decision    深度审稿
  + gaps               + gap packet              + API-backed KG  + frontier files       + assumption stress test        + next brainstorm anchors       + diverge/converge  → 淘汰已做         → advance/park/kill  → IDEA_REPORT.md
```

## Execution

### Phase 1: Literature Survey

```
/research-lit "$ARGUMENTS"
```

读取 `{PMEM}/ideation-memory.md`（如存在），了解已知失败方向。`{PMEM}` = `{PROJ}/memory`

这一阶段必须同时完成全文语料积累：
- 先用 `/papers-cool` 做粗检索和 venue sweep
- 如果稳定可用，可额外用 `/pasa-paper-search` 做第二检索源，并按 canonical identity 合并结果
- 对关键论文优先用 `/hugging-face-paper-pages` 拉取全文 markdown
- 若 Hugging Face 拿不到有效 markdown，则先回退到 `/arxiv2md-api`
- 若 direct markdown API 也失败，再回退到 `/markxiv`
- 若 `markxiv` 也失败，再回退到 `/arxiv2md`
- 若四路 markdown 都失败，则回退到 `/papers-cool` 下载 PDF
- 把 markdown / PDF 保存到 `{PROJ}/researcher/paper-staging/` 作为项目内 staging，再通过远程导入进入 `/graph-build`
- 如果当前 graph 里还没有这些关键论文，必须先刷新 graph，再进入创新点分析
- 如果主题跨度大、baseline 多、或者后续需要严谨对比矩阵，先补一轮 `/literature-review`
- 如果本地 Zotero MCP 可用，同步维护 `bot/<project-id>`，保证 included / excluded / baselines / writing-shortlist 在后续 plan、write、review 阶段可重用

**Output**:
- `{PROJ}/researcher/LITERATURE.md`（landscape、gaps、key methods、baselines）
- `{PROJ}/researcher/LITERATURE_REVIEW.md`、`SOTA_MATRIX.md`、`GAP_SYNTHESIS.md`（当项目需要系统综述包时）
- `{PROJ}/researcher/paper-staging/` 下的 markdown / PDF staging 语料
`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

### Phase 2: Graph Build

```
/graph-build "$ARGUMENTS"
```

通过远程 PaperNexus API 检查 `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` 和 `{PROJ}/researcher/paper-staging/` 是否已被自动同步到共享图中，并刷新这一轮 ideation 所需的 brainstorm bundle。不要依赖任何 home 目录下的共享 PaperNexus 存储或本地 CLI graph roots。

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

同时要求 `{PROJ}/graph/` 下的 frontier files 已生成，并保留 graph anchor 快照。
如果 `{PROJ}/researcher/LITERATURE_REVIEW.md`、`SOTA_MATRIX.md` 或 `GAP_SYNTHESIS.md` 已存在，frontier 结论必须与这些文件保持一致，而不是重新发明一个脱离基线的 brainstorm。

### Phase 4: Idea Generation

```
/idea-generator "$ARGUMENTS"
```

在生成新创新点之前，先检查当前 graph grounding 是否足够，并确认 IDEA-CATALYST sub-pipeline 所需 packet 已准备好。

在生成新创新点之前，先检查：

```json
{"action":"get_innovation_reflection"}
```

如果返回 `due: true`，或者 recent experiments 明显比上一次 reflection 更新，就必须先执行：

```
/innovation-reflection "$ARGUMENTS"
```

并把 `{PROJ}/researcher/INNOVATION_REFLECTION.md` 作为后续 ideation 的必读输入，而不是继续沿用旧 brainstorm。

执行 graph-grounded dialectic loop：
1. 基于 `LITERATURE.md` + `FRONTIER_REPORT.md` + `{PROJ}/graph/*.md` frontier files 做一次 **diverge**，生成 4-8 个 typed tracks
1a. 在 graph-grounded brainstorm bundle 已就绪的前提下，先运行一轮 `/scientific-brainstorming`，专门做假设反转、跨领域迁移和 falsifier 设计；不要用它替代前面的 graph grounding
1b. 对 surviving tracks 启动 IDEA-CATALYST sub-pipeline：
   - decompose
   - translate
   - scout
   - gatekeeper
   - integrator
   - judge
   其中跨域搜索和 integration 必须优先复用知识图谱中的 bridge / domain / mechanism 信号，而不是脱离 graph 自由发挥
2. 如果存在 `{PROJ}/researcher/INNOVATION_REFLECTION.md`，把其中的：
   - do-not-repeat constraints
   - transferable lessons
   - brainstorm anchors
   当成这轮创新点生成的硬约束
3. track 必须覆盖图谱透镜中的多种来源：limitation / contradiction / transfer / composition
4. 每条 track 都要附带 graph evidence packet：
   - anchor nodes / relations
   - why-now / why-this-gap-matters
   - weakest assumption
   - one falsifier pilot
5. 对 surviving tracks，可把 graph evidence packet 交给 Orchestrator 做一次结构化 innovation construction，收敛成更可执行的 hypothesis package
6. 对候选 track 做 attacker / novelty 初筛
7. 对 surviving tracks 做一次 **converge**，收敛成 portfolio，而不是只取一个 top-1
8. 可行性 + 新颖性初筛后保留 2-3 个候选 active tracks
9. 保留至多 1 个 parked track
10. 对 active tracks 做并行 pilot 实验（小规模快速验证）
11. 按 pilot 实证信号排序并写入 `TRACK_REGISTRY.json`
12. 在 converge 之后立即调用：

```json
{"action":"materialize_ideation_contract","ideationMaterialization":{"basis_stage":"frontier_mapping"}}
```

让 workflow 从现有 graph / brainstorm / frontier / track memory 自动生成：
- `GRAPH_IDEATION_PACKET.json`
- `NOVELTY_TREE.md`
- `CHALLENGE_INSIGHT_TREE.md`
- `WELL_ESTABLISHED_SOLUTION_CHECK.md`
- `CANDIDATE_POOL.json`
- `TOURNAMENT_SCOREBOARD.json`
- `TOP3_DIRECTION_SUMMARY.md`
- `RESEARCH_PROPOSAL.md`

13. 只在上述 durable artifacts 已落盘后，再补充或修订 `IDEA_REPORT.md`

其中有三个硬要求：
- `NOVELTY_TREE.md` 必须先基于 frontier files、anchor index、logic/evidence/storyline chain bundle 抽出 `novelty zones`
- `CHALLENGE_INSIGHT_TREE.md` 必须先抽 `challenge clusters` 和 `insight clusters`，再写树
- `WELL_ESTABLISHED_SOLUTION_CHECK.md` 必须显式判断每个方向是 `open`、`occupied` 还是 `open_with_constraints`

**Output**:
- 初步 `{PROJ}/researcher/IDEA_REPORT.md`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/researcher/ideation/GRAPH_IDEATION_PACKET.json`
- `{PROJ}/researcher/ideation/NOVELTY_TREE.md`
- `{PROJ}/researcher/ideation/CHALLENGE_INSIGHT_TREE.md`
- `{PROJ}/researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md`
- `{PROJ}/researcher/ideation/CROSS_DOMAIN_TRANSFER.md`
- `{PROJ}/researcher/ideation/PROBLEM_DECOMPOSITION.md`
- `{PROJ}/researcher/ideation/CANDIDATE_POOL.json`
- `{PROJ}/researcher/ideation/TOURNAMENT_SCOREBOARD.json`
- `{PROJ}/researcher/ideation/TOP3_DIRECTION_SUMMARY.md`
- `{PROJ}/researcher/ideation/RESEARCH_PROPOSAL.md`
- 若已有实验历史，则刷新 `{PROJ}/researcher/INNOVATION_REFLECTION.md`

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
- 若本轮创新点受实验反思影响，明确记录是哪条 reflection lesson 改变了该 track 的保留/淘汰结论
- 尽量形成一个有分工的 portfolio，例如 `safe-bet / high-upside / bridge-composition`

### Phase 7: Cross-model Review

通过 `sessions_send` 将 IDEA_REPORT 提交给 Reviewer Agent 评审：
- Reviewer 以审稿人视角评估 idea
- 返回评分 + 改进建议
- 更新 `{PROJ}/researcher/IDEA_REPORT.md`
- 如 reviewer 认为 portfolio 过宽，优先缩 scope 而不是保留更多 tracks

如果文献阶段中新增了大量本地 paper markdown / PDF，且与当前 frontier 显著不同，必须在最终决定前重新运行 `/graph-build` 和 `/frontier-mapping`，且不要使用 `--force`。

如果实验阶段新增了可反思的结果，且 `innovation_reflection` 重新变为 `pending`，不要继续写 `IDEA_REPORT.md` 或覆盖 `TRACK_REGISTRY.json`，先刷新 `/innovation-reflection`。

### 记忆更新

Phase 完成后更新 `{PMEM}/ideation-memory.md`：
- 有效选题模式（IDE: Idea Discovery Evolution）
- 如果所有 idea 被否决：记录失败分类（IVE: Idea Validation Evolution）
- 如果某条 track 被 kill：记录其 falsification signal 和不要重试的条件

同时优先复用现有 graph-backed memory，而不是再造一套平行 ideation memory：
- top-3 / do-not-repeat / failed direction / transferable lessons 优先写回 `brainstorm_cycle.working_memory_path`
- 需要反思链时写回 `brainstorm_cycle.reflection_chain_path`
- 需要 storyline grounding 时写回 `brainstorm_cycle.storyline_brief_path`
- surviving direction 的 reasoning / synthesis / evidence 指针继续落在 `TRACK_REGISTRY.json`
- `materialize_ideation_contract` 是默认的 scaffold 动作；只有当自动生成结果明显失真时，才手工细修这些 ideation 文档

## Stage Closeout

When the surviving portfolio is locked and the project is genuinely ready to move into PLAN, Researcher should use the shared `workflow-handoff-signal` skill and call `research_workflow.prepare_stage_handoff`.

Do not hand off if novelty / attacker review still requires another ideation pass, innovation reflection is still due, or the portfolio still needs another pilot or narrowing round.
