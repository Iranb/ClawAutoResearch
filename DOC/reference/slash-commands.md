# 斜杠命令与技能入口

## 1. 说明

当前仓库里的“斜杠命令”本质上对应各角色 `skills/` 下的能力入口。  
如果你主要通过 Discord / OpenClaw chat 使用系统，建议把它们理解成 workflow 中的快捷调度点，而不是互相独立的零散命令。

## 2. 主流程命令

- `/project-init`  
  引导式项目开启入口。用于在 setup 阶段锁定 research program onboarding contract：研究目标、问题陈述、baseline、primary metric、数据集、success criteria，以及 Zotero 项目路径。默认路径来自插件全局配置 `zoteroProjectRoot`（默认 `bot`），所以通常是 `<zoteroProjectRoot>/<project-id>`；如果项目显式设置了 `research_program.zotero_project_path`，则以项目值为准。`/workflow-status` 如果显示 setup checklist 缺项，应优先运行它。

- `/research-pipeline`  
  完整科研主入口。适合从主题出发，让 Researcher 按 workflow 自动推进，并通过 PaperNexus HTTP MCP 优先控制 live graph；导入/排队仍通过 wrappers。现在它会先检查 guided setup/onboarding contract；如果 contract 还不完整，先补 `/project-init`，再继续图谱与文献流。

- `/resume-pipeline`  
  恢复中断项目。通常先读 manifest、gate、ledger，再继续 auto iterator。

- `/research-queue`  
  多项目队列与切换入口。适合维护多个并行研究项目。

- `/workflow-status`  
  当前 workflow 快照入口。除了 stage / owner / gate，也会显示 PaperNexus 的 graph refresh 与 paper ingestion 摘要；看到 `graph refresh required` 时，要结合 `PaperNexus ingestion` 一行判断是“真的缺论文”还是“wrapper 驱动的导入/重算仍在进行中”。

- `/clear-project-binding`
  在当前频道 / 群组会话里清空它的 workflow 项目绑定。适合频道被错误绑定到别的项目、需要重新开始绑定时使用。这个命令只清当前频道对应的 project binding，不会删除项目目录，也不会影响其他频道。

- `/survey-pipeline`
  面向综述 / survey 写作的 projectless 入口。给一个主题后，系统会创建一个轻量 survey workspace，并停留在 `survey_review` 这一个顶层 stage 内部推进 `retrieval -> screening -> synthesis -> complete`，不会进入实验环节。它复用现有 PaperNexus、workflow manifest、状态快照和 durable review packet，但把权威状态集中在 `PROJECT_MANIFEST.json.survey_review`，避免“文件已经生成了但 workflow 仍卡住”的老问题。现在 `survey_review -> write` 的 handoff 不再只看文件是否存在，而是会检查 5 个 survey gate：coverage、taxonomy stability、representative methods、benchmark alignment、gap closure。

## 3. 文献与图谱

- `/research-lit`  
  主题调研与持续文献跟踪，包含 project-local staging、MCP-backed PaperNexus graph grounding，以及 wrapper-based import / queue tracking；如果配置了本地 Zotero MCP server，则直接使用本地 Zotero 并同步维护配置好的项目文献集合，默认是 `<zoteroProjectRoot>/<project-id>`。

- `/literature-review`  
  当项目需要更严谨的文献综述包时使用，生成 inclusion/exclusion、SoTA matrix、baseline coverage 和 gap synthesis，适合接在 `/research-lit` 后面，再进入 `/graph-build` 与 `/frontier-mapping`；完成后应把 included/excluded/baseline 清单同步到配置好的 Zotero 项目集合。

综述模式的主要 durable 产物是：

- `SURVEY_QUERY_REGISTRY.json`
- `LITERATURE.md`
- `REVIEW_PROTOCOL.md`
- `INCLUDED_PAPERS.json`
- `EXCLUDED_PAPERS.json`
- `LITERATURE_REVIEW.md`
- `SOTA_MATRIX.md`
- `GAP_SYNTHESIS.md`
- `COVERAGE_SUMMARY.md`
- `SURVEY_BRIEF.md`
- `SURVEY_GATE_DIAGNOSTICS.json`

这些文件会被 `survey_review` materializer 反向汇总到 `PROJECT_MANIFEST.json.survey_review`，所以 slash command、`/workflow-status`、background continuation 和后续人工检查都读同一份权威状态。

其中 `SURVEY_GATE_DIAGNOSTICS.json` 会把以下 5 个 gate 变成 durable workflow state：

- coverage breadth
- taxonomy stability
- representative method completeness
- benchmark / dataset / metric alignment
- gap synthesis closure

- `/papers-cool`  
  粗粒度检索论文入口。

- `/pasa-paper-search`  
  可选的第二检索源；如果成功，和 `papers-cool` 结果按 canonical identity 合并。

- `/hugging-face-paper-pages`  
  优先抓取论文 Markdown。

- `/arxiv2md-api`  
  当 Hugging Face 没有有效 Markdown 时，优先抓取 arxiv2md 的 direct raw markdown。

- `/arxiv2md`  
  当 direct raw markdown 不可用时，抓取 arxiv2md 页面端的 Markdown。

- `/graph-build`  
  Discord 可见的后台 Researcher 命令。检查项目论文是否已被自动同步进共享图，并刷新 graph readiness 与 brainstorm bundle，live graph 走远程 HTTP MCP，导入/排队走 queued wrappers；如果本地 Zotero MCP server 已配置，还要同步更新配置好的 Zotero 项目集合里的 `selected`、`baselines` 和项目侧 `ZOTERO_PACKET.md`。

- `/zotero-sync`
  Discord 可见的后台 Researcher 命令。以当前项目的 workflow-owned 状态为 source of truth，对 Zotero 项目集合做一次显式 reconciliation：刷新 `selected` / `baselines` / `writing-shortlist`，把已经不属于项目的论文**只从项目 collection 移除**，但**不删除也不丢进 Zotero 废纸篓**。该命令始终走后台 continuation，不应阻塞前台主会话；若 Zotero MCP 不可用，只需把 `unavailable` / `failed` 状态写回 `ZOTERO_SYNC_PACKET.json` 和 `ZOTERO_PACKET.md`。如需认证，默认由 Zotero MCP server 自己通过 `ZOTERO_API_KEY` / `ZOTERO_USER_ID` 处理，而不是由插件配置提供。

- `/zotero-project-library`  
  当本地 Zotero MCP server 已配置时，直接使用本地 Zotero，把项目文献同步到配置好的项目目录，维护 selected / included / excluded / baselines / writing-shortlist。默认项目根来自插件全局配置 `zoteroProjectRoot`，默认值是 `bot`。

- `/papernexus`  
  直接调用 PaperNexus 能力，默认优先走远程 HTTP MCP；导入类任务再走 wrappers。

- `/frontier-mapping`  
  基于图谱做研究前沿与空白映射，默认 MCP-first。

## 4. 创新与反思

- `/idea-phase`  
  生成、筛选、收敛创新方向。

- `/scientific-brainstorming`  
  在 graph-grounded brainstorm bundle 已经准备好的前提下，做 bounded 的科研发散和假设压力测试。

- `/innovation-reflection`  
  基于实验账本和 PaperNexus 刷新创新反思。

- `/idle-research`  
  在主流程等待时，围绕指定主题做 bounded background research。

- `/research-reflect`  
  汇总阶段性经验、失败模式和可复用模式。

## 5. 计划、实现、实验

- `/plan-phase` 或 Orchestrator 相关 planning skills  
  生成 `PLAN.md`、`TODOS.md`、`PLAN_AUDIT.md`，并把 `PROJECT_MANIFEST.json.research_program` 补全为 plan 阶段的 durable source-of-truth。
  其中 `research_program.plan_alternatives` 必须保留多方案对比，`research_program.plan_selection` 必须明确最终选型、图谱证据和选择理由；`PLAN.md` 只是人类可读派生物，不再单独代表 plan 完成。

- `/implement-experiment`  
  Coder 实现实验代码与复现结构。

- `/scientific-visualization`  
  Coder 在实现与 dry-run 阶段生成 sanity-check 图、baseline/proposed 对比图和 ablation 预览图。

- `/run-experiment`  
  启动和管理实验执行。

- `/parallel-experiments`  
  并行实验批次调度。

- `/monitor-experiment`  
  监控远程实验、结果目录和 screen 状态，并把完成的 run 回写到实验账本与分析就绪状态；在自动模式里，这是远程训练开始后的默认跟进动作。

## 6. 分析、评审、写作

- `/analyze-results`  
  Analyzer 做结果解释和 claim-evidence 对齐。

- `/paper-plan`  
  Writer 建立论文结构与 template mapping。

- `/citation-management`  
  Writer 基于 Zotero writing-shortlist 和外部 metadata source-of-truth 清洗引用候选。

- `/venue-templates`  
  Writer 锁定目标 venue 的模板、页数预算和章节约束。

- `/paper-write`  
  Writer 按 writing contract 写作。

- `/citation-preflight`  
  Writer 在提交前预检 bibliography，清理可疑引用并准备 `refs.bib`。

- `/paper-phase`  
  论文写作主流程。

- `/review-phase`  
  Reviewer 做内部评审与证据分级。

- `/scientific-critical-thinking`  
  Reviewer 做方法学、偏差、统计与证据质量深审。

- `/scholar-evaluation`  
  Reviewer 做结构化维度评分。

- `/peer-review`  
  Reviewer 输出更接近正式审稿风格的整合 review。

- `/citation-integrity-gate`  
  Reviewer 独立核验引用，写 `CITATION_VERIFICATION.md`，并更新 citation gate 状态。

## 7. 推荐使用方式

推荐优先级：

1. 大多数情况下先用 `/research-pipeline`
2. 项目中断后优先用 `/resume-pipeline`
3. 只有在你明确要干预某个阶段时，再单独调用阶段性命令

## 8. 相关文档

- [科研工作流与自动迭代器](../concepts/workflow-and-auto-iterator.md)
- [插件工具接口](./plugin-tools.md)
- [安装与启用](../guides/install-and-enable.md)
