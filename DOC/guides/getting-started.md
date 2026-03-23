# 快速上手

这份指南只回答一个问题：已经拿到仓库后，怎样用最少步骤把 `openclaw-research` 真正跑起来。

## 1. 先确认前提

在开始之前，至少确认这些前提已经满足：

- 本机有可用的 `openclaw` CLI
- 你已经在当前仓库根目录
- 如果要跑远程实验，SSH 已经配好
- 如果要使用 PaperNexus，相关仓库或环境路径可访问

## 2. 先构建，再安装

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
bash install.sh --dry-run
bash install.sh
```

如果你需要强制同步 workspace 根目录里的角色文件，可以改成：

```bash
bash install.sh --force-role-files
```

## 3. 合并 OpenClaw 主配置

安装脚本不会直接覆盖你的 `~/.openclaw/openclaw.json`，所以你还需要把最新插件配置合并到自己的主配置里。

最关键的项只有这些：

- `plugins.load.paths` 包含 `~/.openclaw/plugins`
- 启用 `openclaw-research`
- 在 `plugins.entries.openclaw-research.config.projectsRoot` 里设置项目根目录
- 给需要工作的角色放行 `research_workflow`
- 默认 `researcher` heartbeat 保持 `30m`

参考：

- [openclaw.RECOMMENDED.json](./../../openclaw.RECOMMENDED.json)
- [配置项参考](./../reference/configuration.md)

## 4. 启动第一个科研项目

推荐在 Discord 的一个独立频道里启动一个项目，对应一个研究主题。

先让 `researcher` 开题：

```text
/research-pipeline "your research topic" -- AUTO_PROCEED: true
```

如果你启用了 channel binding，拿到项目目录后，把当前频道绑定到该项目：

```json
{
  "action": "bind_channel_project",
  "channelBinding": {
    "projectRoot": "/absolute/path/to/the-created-project"
  }
}
```

这样之后这个频道里的 workflow、mailbox、graph presence check 和恢复逻辑，都会优先绑定到同一个项目上。

## 5. 理解项目启动后的默认行为

项目启动后，系统会围绕这些机制工作：

- `research_workflow.auto_iterator_tick` 在 heartbeat / bootstrap / resume 时推进或回退阶段
- `graph_build` / `frontier_mapping` / `idea` 前会做 graph presence check
- Researcher 空闲时会根据 `idle_research` 做受控背景调研
- 新实验进入账本后，会让创新反思变为待刷新
- Writer 在 `writing_contract` 存在时会按模板和段落逻辑约束工作

## 6. 新项目里最值得尽早补的状态

为了让后续流程更稳，建议尽早确认：

- `papernexus_root`
- `paper_source_dir`
- `graph_source_dir`
- `idle_research`
- `writing_contract`

其中：

- `paper_source_dir` 默认建议指向 `~/.papernexus/papers/{project_id}`
- `graph_source_dir` 默认建议也指向 `~/.papernexus/papers/{project_id}`
- `channel-project-bindings.json` 默认会写在 `{PROJ}/.openclaw-research/`

## 7. 建议的下一步阅读

当你已经能跑起项目后，建议继续看：

1. [系统架构](./../concepts/architecture.md)
2. [科研工作流与自动迭代器](./../concepts/workflow-and-auto-iterator.md)
3. [PaperNexus、实验记忆与反思机制](./../concepts/papernexus-memory-and-reflection.md)
4. [运行、调试与测试](./operations-and-testing.md)
