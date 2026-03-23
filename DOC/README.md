# OpenClaw Research DOC

这套文档面向当前仓库里的 `openclaw-research` 代码，按接近 OpenClaw 官方文档的方式拆成 `concepts`、`reference`、`guides` 三层。

## 文档导航

### Concepts

- [系统架构](./concepts/architecture.md)
- [科研工作流与自动迭代器](./concepts/workflow-and-auto-iterator.md)
- [PaperNexus、实验记忆与反思机制](./concepts/papernexus-memory-and-reflection.md)

### Reference

- [Agent 角色与目录配置](./reference/agents.md)
- [Skills 总表](./reference/skills.md)
- [插件工具接口](./reference/plugin-tools.md)
- [状态文件与项目产物](./reference/state-files.md)
- [配置项参考](./reference/configuration.md)
- [斜杠命令与技能入口](./reference/slash-commands.md)
- [Coder 数据集路径约束](./reference/coder-dataset-paths.md)

### Guides

- [安装与启用](./guides/install-and-enable.md)
- [运行、调试与测试](./guides/operations-and-testing.md)

## 这套代码当前解决什么问题

`openclaw-research` 不是一个单纯的 prompt 集合，而是一套以插件为中心的自动化科研系统，目标是把多 Agent 科研流程从“靠聊天记忆和技能自觉执行”，变成“靠状态文件、工具动作、运行时约束和自动迭代器执行”。

当前代码已经覆盖这些能力：

- 多 Agent 科研分工：`researcher`、`orchestrator`、`coder`、`analyzer`、`academic_writer`、`reviewer`、`cross-reviewer`
- 显式科研阶段机：`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit`
- 插件注入的 workflow guard：在每轮对话前注入状态，在工具调用前拦截越界行为
- 确定性的 `auto_iterator_tick`：将 heartbeat / bootstrap / recovery turn 变成真正的阶段协调器
- 基于 PaperNexus 的文献入库、图谱刷新、创新头脑风暴和实验后反思
- 结构化实验记忆：`EXPERIMENT_LEDGER.json`
- 空闲调研机制：`idle_research`
- Writer 模版约束与段落逻辑约束：`writing_contract`
- Agent 间 mailbox、Discord mention 清洗、通信 cooldown

## 推荐阅读顺序

如果你第一次接触这套代码，建议按下面顺序读：

1. [系统架构](./concepts/architecture.md)
2. [科研工作流与自动迭代器](./concepts/workflow-and-auto-iterator.md)
3. [PaperNexus、实验记忆与反思机制](./concepts/papernexus-memory-and-reflection.md)
4. [Agent 角色与目录配置](./reference/agents.md)
5. [插件工具接口](./reference/plugin-tools.md)
6. [安装与启用](./guides/install-and-enable.md)

## 代码入口

- 插件入口：`index.ts`
- workflow 约束核心：`tools/workflow-guard.ts`
- research memory 后端：`tools/research-memory.ts`
- 全局工作流规范：`WORKFLOW.md`
- 安装脚本：`install.sh`
- Skills 注册表：`skills/index.json`
