# Graph 与 Memory

如果不理解这一层，就很容易把系统误解成“带检索的多 Agent 写作器”。实际上它的研究知识底座由共享图谱和项目记忆两部分组成。

## 1. 为什么共享图谱是硬约束

PaperNexus 在这里承担的是 shared research substrate，而不是附属工具。它支撑：

- graph build
- frontier mapping
- novelty grounding
- closest prior work 对比
- innovation reflection
- 写作阶段的 citation / claim grounding

所以系统不是“先搜一下，再随便写”，而是要求关键阶段都回到同一套图谱证据面。

## 2. 文献摄取链路

默认顺序是：

1. `papers-cool`
2. `pasa-paper-search`（可选补充）
3. `hugging-face-paper-pages`
4. `arxiv2md-api`
5. `markxiv`
6. `arxiv2md`
7. PDF fallback
7. queue import / graph refresh

这个顺序的意义是尽可能优先拿 Markdown，再把 canonical papers 映射到共享图里。

## 3. shared corpus 与项目本地状态的区别

这是维护时最容易混淆的点。

| 层级 | 存放位置 | 作用 |
| --- | --- | --- |
| shared corpus | PaperNexus 远程或共享实例 | 真正承载文献与图谱关系 |
| project-local graph state | `{PROJ}/graph/` | 保存 workflow-facing readiness、presence report、frontier outputs |
| project memory | `{PROJ}/memory/` | 保存 ideation、experiment、daily log 等项目记忆 |

也就是说，项目本地 `graph/` 不是另一个私有语料库。它主要保存“系统如何理解共享图是否已准备好”。

## 4. graph presence 是如何影响阶段推进的

`tools/graph-presence.ts` 会把 canonical paper selection 和共享图现状做比对。只要 graph presence 没通过，系统就不应继续 novelty-sensitive 阶段。

典型影响：

- `idea` 可能被回退到 `graph_build`
- `plan` 可能因为前置图谱不完整而暂停
- `get_snapshot` 和 `auto_iterator_tick` 会把 graph 缺失纳入 blocking reason

## 5. 共享语料库配置为什么必须走插件全局配置

近期一个很典型的故障是：系统如果在 graph presence 检查时落回内部硬编码的语料库名，就会在远程环境里不断把阶段打回 `graph_build`。

所以现在共享语料库应统一从插件全局配置读取，例如：

- `papernexusApiBaseUrl`
- `papernexusMcpUrl`
- `papernexusAccessMode`
- `papernexusSharedCorpus`

`papernexusSharedCorpus` 的意义尤其重要，因为 `auto_iterator`、`get_snapshot` 和 graph presence 必须对准真实共享语料库，而不是项目级旧 hint 或内部默认值。

## 6. project memory：系统如何记住自己做过什么

项目记忆的关键文件包括：

- `memory/ideation-memory.md`
- `memory/experiment-memory.md`
- `memory/YYYY-MM-DD.md`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json`
- `PROJECT_MANIFEST.json.innovation_reflection`

其中最重要的是 `EXPERIMENT_LEDGER.json`。它是 experiment lifecycle 的权威来源，而不是随手记在日报里的经验总结。`EXPERIMENT_MEMORY_PACKET.json` 则是它的 distilled graph bridge，用来给 planner、coder search loop 和 innovation reflection 提供可复用的结构化实验记忆。

## 7. innovation reflection：为什么 ideation 不是一次性动作

系统要求新的可反思实验结果出现后，必须刷新创新反思链路：

- 写 `researcher/INNOVATION_REFLECTION.md`
- 调 `record_innovation_reflection`
- 同步 `PROJECT_MANIFEST.json.innovation_reflection`

这样下一轮 ideation 就能显式消费：

- 哪些假设已经失败
- 哪些约束变得更强
- 哪些迁移方向出现了新的证据
- 哪些 retained git lineage 真正值得成为下轮搜索的 incumbent 基础

## 8. idle research：后台调研为什么不是自由漂移

`idle_research` 是明确的后台合同，常见字段包括：

- `topic`
- `objective`
- `query_seeds`
- `preferred_venues`
- `cooldown_minutes`
- `last_run_at`
- `refresh_graph_on_new_core_papers`

这意味着 Researcher 的空闲行为必须受 topic 和 cooldown 控制，而不是心情好就去泛化搜文献。

## 9. 这一层对写作也有决定性影响

虽然写作发生在 `academic_writer`，但 Writer 依赖的上游事实全部来自这里：

- 图谱支撑的 novelty / prior art 认知
- `EXPERIMENT_LEDGER.json` 中的真实实验历史
- `innovation_reflection` 产生的边界变化
- project-level claim support 和 story state

> [!TIP]
> 如果你已经理解图谱与记忆层，再去读 [Agents 与 Skills](./agents-and-skills.md) 会更容易理解为什么角色边界必须这么严格。
