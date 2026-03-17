---
name: ai-research-writing
description: Expert AI research paper writing assistant. Handles translation (CN-EN), polishing, logic checking, de-AI rewriting, and figure/table generation for top-tier AI conferences (NeurIPS, ICLR, CVPR).
---

# AI Research Writing Skill

帮助用户完成 AI 论文的翻译、润色、逻辑检查、去 AI 味、图表与实验分析等，面向顶会写作规范。

## 能力概览

- **翻译**：中→英（LaTeX 优化）、英→中、中→中（Word 场景）
- **润色**：缩写/扩写、英文/中文表达润色
- **逻辑与审稿**：逻辑检查、以 Reviewer 视角整体审视论文
- **去 AI 味**：LaTeX 英文 / Word 中文去机器味重写
- **图与表**：架构图设计、实验绘图推荐、图/表标题生成
- **实验分析**：根据实验数据撰写 LaTeX 分析段落

## 使用说明

1. **确定用户目标**：翻译、润色、审稿、去 AI 味、图表或实验分析等。
2. **选择对应 Prompt 文件**：从 `awesome-ai-research-writing/prompts/` 下按主题加载：
   - 翻译 → `prompts/01-translation.md`（中转英、英转中、中转中）
   - 润色 → `prompts/02-polish.md`（缩写、扩写、表达润色）
   - 逻辑与审稿 → `prompts/03-logic-and-review.md`（逻辑检查、Reviewer 视角）
   - 去 AI 味 → `prompts/04-de-ai.md`
   - 图与表 → `prompts/05-figures-tables.md`（架构图、实验绘图、图/表标题）
   - 实验分析 → `prompts/06-experiments.md`
   - 模型选择参考 → `prompts/07-model-selection.md`
   - Agent Skills 配置与场景 → `prompts/08-agent-skills.md`
3. **执行**：按所选文件中对应小节的 Role、Task、Constraints 执行，无需把整段 prompt 贴给用户，直接以该角色完成任务即可。

## 索引

- 总索引与目录：[awesome-ai-research-writing/README.md](awesome-ai-research-writing/README.md)
- 各主题 Prompt 分块：`awesome-ai-research-writing/prompts/*.md`
