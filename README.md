# openclaw-research

基于 OpenClaw 的自动化科研 Plugin，实现从选题到论文的端到端闭环。

## Architecture

**双 Agent 架构**（记忆隔离）：

- **Researcher Agent** — 执行侧：选题、实验、代码、分析（SSH 远程 GPU）
- **Reviewer Agent** — 审稿侧：独立评审，不看实现细节（只读，无代码执行权限）

**混合审稿模式**：
- 日常迭代：同模型反思（快速修复）
- 关键节点：跨 Agent 审稿（独立评审，避免自评盲区）

**记忆系统**：
- QMD 后端，per-agent 隔离
- 按项目隔离：项目目录可配置（`projectsRoot`），记忆在 `{PROJ}/memory/` 下（ideation-memory、experiment-memory、每日日志），多 agent 可访问同一项目根
- 记忆进化：IDE（选题发现）/ IVE（失败验证）/ ESE（实验策略）

## Skills

| 技能 | 类型 | 说明 |
|------|------|------|
| `research-pipeline` | 编排 | 端到端全流程 |
| `idea-phase` | 编排 | 选题阶段 |
| `research-lit` | 原子 | 文献调研 |
| `idea-generator` | 原子 | 想法生成 + pilot |
| `novelty-check` | 原子 | 新颖性验证 |
| `experiment-phase` | 编排 | 实验阶段 |
| `run-experiment` | 原子 | SSH 部署实验 |
| `monitor-experiment` | 原子 | 监控实验 |
| `analyze-results` | 原子 | 结果分析 |
| `review-phase` | 编排 | 混合审稿循环 |
| `paper-phase` | 编排 | 论文阶段 |
| `paper-plan` | 原子 | 论文大纲 |
| `paper-write` | 原子 | LaTeX 写作 |
| `paper-compile` | 原子 | 编译 PDF |
| `research-reflect` | 原子 | 反思检查点 |

## Quick Start

1. 配置 `openclaw.json`（参考 `openclaw.json` 模板）
2. 编辑 `agents/researcher/SERVER.md` 填入你的 GPU 服务器信息
3. 确保 SSH 免密登录已配置
4. 启动：`/research-pipeline "your research topic"`

## Design References

- **EvoScientist** — 多 Agent 协作 + 记忆进化 + think_tool 反思
- **ARIS** — Claude Code 技能编排 + 跨模型审稿 + 文件驱动状态
