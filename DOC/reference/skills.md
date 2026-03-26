# Skills 总表

## 1. 说明

当前 Skills 按角色分组注册在 `skills/index.json` 中。  
下面的清单反映的是当前代码里已经存在、并且被插件工作流实际使用的 skill。

## 2. Researcher

- `research-pipeline`  
  Researcher 的主流程入口，串起 setup 到实验前后的主要研究循环。

- `graph-build`  
  基于论文源和 PaperNexus 刷新图谱与 graph readiness。

- `frontier-mapping`  
  生成 graph-grounded frontier report、子图和方向包。

- `idea-phase`  
  主 ideation 阶段，负责创新点形成与 active track 选择。

- `idea-generator`  
  做候选 idea 发散。

- `idea-tournament`  
  对 idea 做比较、淘汰和组合。

- `novelty-check`  
  基于图谱和已有工作检查创新性与相邻工作。

- `experiment-phase`  
  实验总控阶段，协调计划、账本、结果和下游分析。

- `monitor-experiment`  
  监控已运行实验的状态和结果。

- `parallel-experiments`  
  管理并行实验发起与资源编排。

- `resume-pipeline`  
  在会话恢复或项目切换后重建现场。

- `research-reflect`  
  做研究过程层面的反思与总结。

- `innovation-reflection`  
  在新实验结果出现后，对创新方向进行基于 PaperNexus 的反思。

- `research-lit`  
  常规文献调研与文献池维护。

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
  调用或接入 PaperNexus 功能做图谱构建与操作。

- `papernexus-agentic-reasoning`  
  用 PaperNexus 图谱做更强的 trace、synthesis、brainstorm。

- `crawl4ai-search`  
  通用网络检索和补充信息抓取。

- `research-queue`  
  排队、任务推进和多任务研究工作协调。

## 3. Orchestrator

- `plan-research`  
  研究计划、风险登记、资源分配与 TODO 组织。

- `resume-pipeline`  
  Orchestrator 视角下的恢复入口。

## 4. Coder

- `implement-experiment`  
  实验实现、代码修改和运行准备。

- `run-experiment`  
  实验启动、运行参数、screen / server / result path 管理。

- `github-download`  
  外部代码库或资产获取。

- `resume-pipeline`  
  Coder 视角下的恢复入口。

## 5. Analyzer

- `analyze-results`  
  结果解释、指标拆解、claim-evidence 整理。

- `scientific-figures`  
  科学图表、结果可视化和 figure asset 组织。

- `papernexus-reflection`  
  基于 PaperNexus 和结果文件做 graph-grounded reflection。

- `resume-pipeline`  
  Analyzer 视角下的恢复入口。

## 6. Academic Writer

- `paper-plan`  
  论文计划、章节规划、模版映射。

- `paper-write`  
  正文撰写、paragraph logic audit、section draft 维护。

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
  review 主阶段执行。

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
