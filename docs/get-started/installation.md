# 安装与启用

这页关注“如何把系统装好并确认真的可用”，不是系统原理。

## 1. 先理解安装目标

安装后你应该得到下面这些能力：

- OpenClaw 能识别 `ClawAutoResearch` 插件。
- 对应角色能调用 `research_workflow` 与 `research_memory`。
- `projectsRoot` 被明确配置，所有项目都位于同一受控根目录下。
- `heartbeat` 已按角色打开，这样系统才能通过自动心跳持续推进。
- 如果启用了远程 PaperNexus，运行时能读取图谱配置、shared corpus 和 token 解析方式。

## 2. 推荐命令

```bash
cd "/workspace/openclaw-research"
bash install.sh --dry-run
bash install.sh
```

`install.sh` 会负责：

- 检查仓库与构建产物。
- 同步插件目录和角色配置。
- 安装或更新 skills、templates 和推荐配置片段。
- 给出文档入口，帮助你确认后续阅读路径。

## 3. OpenClaw 主配置里要确认什么

最关键的是 `~/.openclaw/openclaw.json` 中的插件配置块。

```json
{
  "plugins": {
    "entries": {
      "ClawAutoResearch": {
        "config": {
          "projectsRoot": "~/ResearchProjects",
          "injectWorkflowContext": true,
          "enforceWorkflowBoundaries": true,
          "enableWorkflowMailbox": true,
          "agentContactCooldownSeconds": 300,
          "papernexusAccessMode": "auto"
        }
      }
    }
  }
}
```

### 必须特别注意的字段

- `projectsRoot`
  - 决定所有项目的真实根目录。
  - workflow 不再接受 workspace fallback，把项目跑到外部目录会被拒绝。
- `injectWorkflowContext`
  - 控制每轮 prompt 是否自动注入 snapshot、owner、missing signals 和 handoff 边界。
- `enableWorkflowMailbox`
  - 决定是否启用结构化 mailbox，而不是依赖聊天 mention。
- `papernexusAccessMode`
  - 决定 shared graph 优先走远程 MCP、兼容 API 还是本地模式。
- `papernexusSharedCorpus`
  - 共享语料库名应该在这里统一配置，避免 `auto_iterator` 或 graph presence 落回硬编码默认值。

## 4. 角色工具许可

需要运行主流程的角色，至少要允许调用：

- `research_workflow`
- `research_memory`

如果某个角色看不到这些工具，即使技能文件写得再完整，也无法更新 durable state。

## 5. heartbeat 建议

没有 heartbeat，自动科研就会退化成“手动催下一步”。

推荐节奏：

```text
researcher: 30m
orchestrator: 2h
coder: 2h
analyzer: 2h
academic_writer: 2h
reviewer: 3h
cross-reviewer: 4h
```

心跳的意义不是频繁打扰，而是为 `auto_iterator_tick`、mailbox、graph refresh、idle research 和 runtime recovery 提供稳定触发点。

## 6. 安装后立刻做的验证

1. 确认 `research_workflow` 与 `research_memory` 在 OpenClaw 中可见。
2. 新建或选择一个项目，调用 `research_workflow.get_snapshot`。
3. 调用 `research_workflow.auto_iterator_tick`，确认系统能基于项目状态给出下一步，而不是报找不到项目或路径越界。
4. 如果你依赖远程 PaperNexus，确认 token、remote API/MCP 和 shared corpus 都能被正确解析。

## 7. 什么时候算安装成功

安装成功不等于脚本跑完，而是下面四件事同时成立：

- 插件被加载。
- 工具可调用。
- `projectsRoot` 路径约束生效。
- 一个真实项目能进入 `setup -> graph_build` 主线。

> [!TIP]
> 如果你刚装好系统，下一页直接读 [项目生命周期](./project-lifecycle.md)。那一页会把 `/project-init`、`/graph-build`、graph presence 和 `/resume-pipeline` 串起来。
