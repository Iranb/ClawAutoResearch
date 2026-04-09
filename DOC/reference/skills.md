# Skills 总表

## 1. 说明

当前 Skills 按角色分组注册在 `skills/index.json` 中。  
下面的清单反映的是当前代码里已经存在、并且被插件工作流实际使用的 skill。

## 2. Researcher

- `research-pipeline`  
  Researcher 的主流程入口，串起 setup 到实验前后的主要研究循环，并协调 PaperNexus MCP-first live graph control。

- `graph-build`  
  基于论文源和 PaperNexus MCP-first graph control 检查自动图谱 catch-up 状态，并刷新 brainstorm bundle、graph readiness，以及配置好的 Zotero 项目文献集合；导入与排队仍使用 wrappers。默认项目根来自插件全局配置 `zoteroProjectRoot`，默认值是 `bot`。

- `frontier-mapping`  
  生成 graph-grounded frontier report、子图和方向包，默认走 PaperNexus HTTP MCP。

- `idea-phase`  
  主 ideation 阶段，负责创新点形成与 active track 选择，并把 graph / brainstorm / frontier 结果通过 `materialize_ideation_contract` 收口成 novelty tree、challenge-insight tree、tournament scoreboard 和 research proposal。

- `research-ideation`  
  更贴近 EvoScientist / EvoSkills 的 graph-first ideation 方法层：先锁长期目标，再构造 novelty tree、challenge-insight tree、well-established solution check、cross-domain transfer 和 problem decomposition。

- `idea-catalyst-decompose`  
  IDEA-CATALYST 子流水线的第 1 步：把 target-domain 问题拆成 durable decomposition packet，并做 coverage / challenge 优先级判断。

- `idea-catalyst-translate`  
  IDEA-CATALYST 子流水线的第 2 步：把挑战改写成 mechanism-level 的 domain-agnostic 抽象，而不是仅仅去术语化。

- `idea-catalyst-scout`  
  IDEA-CATALYST 子流水线的第 3 步：graph-first 跨域 scouting、domain distance 过滤、bridge/takeaway 收集。

- `idea-catalyst-gatekeeper`  
  IDEA-CATALYST 子流水线的第 4 步：做 sufficiency gate，决定继续 brainstorm 还是发 investigation requisition。

- `idea-catalyst-integrator`  
  IDEA-CATALYST 子流水线的第 5 步：把 target challenge 和 source-domain takeaways 结构化合成为 idea fragments。

- `idea-generator`  
  做候选 idea 发散。

- `idea-tournament`  
  对 idea 做 tree expansion、`propose -> review -> refine`、Elo-style 或等价排序、top-3 summary 和冠军 proposal extension。

- `novelty-check`  
  基于图谱和已有工作检查创新性与相邻工作。

- `experiment-phase`  
  实验总控阶段，协调计划、账本、结果和下游分析。

- `monitor-experiment`  
  监控远程实验的运行、完成和结果落盘，并负责把 `EXPERIMENT_LEDGER.json`、`EXPERIMENT_REGISTRY.md` 与 `experiment_search` 推到可进入分析阶段的状态。

- `parallel-experiments`  
  管理并行实验发起与资源编排。

- `resume-pipeline`  
  在会话恢复或项目切换后重建现场。

- `research-reflect`  
  做研究过程层面的反思与总结。

- `innovation-reflection`  
  在新实验结果出现后，对创新方向进行基于 PaperNexus MCP-first graph evidence 的反思。

- `research-lit`  
  常规文献调研与文献池维护，并通过 PaperNexus HTTP MCP 做 live graph grounding、通过 wrappers 做 remote import 与队列跟踪。

- `literature-review`  
  结构化文献综述包，负责 inclusion/exclusion、SoTA matrix、baseline coverage 和 gap synthesis，适合放在 `research-lit` 之后、`frontier-mapping` 和 `idea-phase` 之前。

- `zotero-project-library`
  当本地 Zotero MCP server 已配置时，直接使用本地 Zotero，把项目文献组织到配置好的 Zotero 项目目录下，维护 selected / included / excluded / baselines / writing-shortlist 这些集合，并生成项目侧 `ZOTERO_PACKET.md`。如果本地 Zotero MCP 需要认证，默认由它自己的 `ZOTERO_API_KEY` / `ZOTERO_USER_ID` 环境处理，而不是由插件配置提供。

- `scientific-brainstorming`  
  在 graph-grounded brainstorm bundle 已经准备好的前提下，做有边界的科研发散、假设反转和跨领域联想；它增强 `idea-phase`，但不替代 PaperNexus 的 graph grounding。

- `idle-research`  
  在空闲时围绕 `idle_research.topic` 做 bounded literature round。

- `papers-cool`  
  论文检索、下载、候选集收集。

- `pasa-paper-search`  
  可选的第二论文检索源；如果可用，就和 `papers-cool` 按 canonical identity 合并结果。

- `hugging-face-paper-pages`  
  优先获取论文 Markdown 页面。

- `arxiv2md-api`  
  当 Hugging Face 没有有效 Markdown 时，优先尝试 arxiv2md 的 direct raw markdown API。

- `arxiv2md`  
  当 direct raw markdown API 不可用时，用 arxiv2md 页面端作为下一层 Markdown fallback。

- `papernexus`  
  调用或接入 PaperNexus 功能做图谱构建与操作，默认走远程 HTTP MCP；导入/排队类任务再走 wrappers。

- `papernexus-agentic-reasoning`  
  用 PaperNexus 图谱做更强的 trace、synthesis、brainstorm，默认走 MCP-first control plane，而不是手写 REST。

- `papernexus-batch-import`  
  用固定 manifest 和 wrappers 稳定上传、排队、跟踪多篇论文的导入状态；这些 wrappers 是 `import_workflow` 的薄适配层。

- `papernexus-research-chains`  
  用 typed multi-hop research chains、evidence bundles 和 brief-style 输出做 graph-grounded synthesis。

- `crawl4ai-search`  
  通用网络检索和补充信息抓取。

- `research-queue`  
  排队、任务推进和多任务研究工作协调。

## 3. Orchestrator

- `plan-research`  
  研究计划、风险登记、资源分配与 TODO 组织；默认读取 `RESEARCH_PROPOSAL.md`、`PROBLEM_DECOMPOSITION.md` 和 tournament artifacts，而不只是自由文本 idea report。

- `resume-pipeline`  
  Orchestrator 视角下的恢复入口。

## 4. Coder

- `implement-experiment`  
  实验实现、代码修改和运行准备；要求同时尊重 baseline contract、proposal decomposition，以及 `CLAIM_TO_EXPERIMENT_MAP.md` 的后续 claim 压力。

- `scientific-visualization`  
  Coder 在实现和 dry-run 阶段使用的科研绘图能力，用来做 baseline/proposed 的 sanity-check 图、ablation 预览图和可复用的实验图。

- `run-experiment`  
  实验启动、运行参数、screen / server / result path 管理。

- `github-download`  
  外部代码库或资产获取。

- `resume-pipeline`  
  Coder 视角下的恢复入口。

## 5. Analyzer

- `analyze-results`  
  结果解释、指标拆解、claim-evidence 整理，并在分析结束后通过 workflow-owned `materialize_paper_story_state` 把 claim support / track verdict / unsupported-claim hooks 回写到 durable story contract。

- `scientific-figures`  
  科学图表、结果可视化和 figure asset 组织。

- `papernexus-reflection`  
  基于 PaperNexus 和结果文件做 graph-grounded reflection。

- `resume-pipeline`  
  Analyzer 视角下的恢复入口。

## 6. Academic Writer

- `paper-plan`  
  论文计划、章节规划、模版映射，并通过 workflow-owned `materialize_paper_story_state` 脚手架生成 durable story contract。

- `citation-management`  
  基于 Zotero 项目 writing-shortlist 和外部 metadata source-of-truth，清洗引用候选并为 `refs.bib` 做准备。

- `venue-templates`  
  面向目标 venue 的模板、页数预算和章节约束，帮助 Writer 在 `paper-plan` 和 `paper-write` 里保持结构一致。

- `paper-write`  
  正文撰写、paragraph logic audit、section draft 维护；直接消费 durable `paper_story_state` 和 `review_pressure_packet`，必要时先通过 workflow-owned materializer 刷新这两个合同，再按 story-first / claim-evidence-first 方式成稿。

- `paper-compile`  
  编译和输出检查。

- `paper-phase`  
  Writer 主流程入口。

- `ai-research-prompt`  
  与 AI 研究写作相关的辅助 prompt / 结构化写作动作。

- `research-paper-writing`  
  更通用的研究论文写作能力。

- `resume-pipeline`  
  Writer 视角下的恢复入口。

## 7. Reviewer

- `review-phase`  
  review 主阶段执行，并先通过 workflow-owned `materialize_review_pressure_packet` 脚手架生成，再补齐 reject-first review、novelty attack、unsupported-claim audit、reverse outline、figure/table QC、limitation audit，最终落成 durable `review_pressure_packet`。

- `paper-review`  
  Evo 风格的对抗式自审 skill，专门用于稿件故事链的 reject-first simulation、unsupported claim 删除、reverse outline、figure/table QC 和 limitation stress test。

- `idea-catalyst-judge`  
  IDEA-CATALYST 子流水线的独立评委，负责对 interdisciplinary idea fragments 做 pairwise / Elo-style ranking，避免生成者自己给自己打分。

- `scientific-critical-thinking`  
  Reviewer 的方法学、偏差、统计与证据质量审查能力，特别适合 CODE innovation review 和内部 REVIEW。

- `scholar-evaluation`  
  给问题定义、文献、方法、分析、写作、引用这些维度打分的结构化评估框架，适合 aggressive 模式下的多 reviewer quorum。

- `peer-review`  
  更接近期刊/会议正式审稿口吻的结构化 review，适合 late review、submit 前和 revise 阶段。

- `evidence-grading`  
  对 claim 和 evidence 的支撑强度评分。

- `paperreview-submit`  
  投稿前的检查与提交材料整理。

- `review-response`  
  审稿回复或 revision response 组织。

- `resume-pipeline`  
  Reviewer 视角下的恢复入口。

## 8. Cross-reviewer

- `resume-pipeline`  
  被唤起时的恢复入口。

## 9. Skills 与插件的关系

Skill 负责告诉 Agent “应该怎么做”，插件负责确保它“不能乱做”。  
因此关键流程通常都同时有两层：

- Skill 层的操作步骤
- Plugin 层的硬约束和状态回写
