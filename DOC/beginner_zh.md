# OpenClaw Research 新手使用说明

这份说明是给第一次用 `openclaw-research` 的人准备的。

如果你现在只想把第一个科研项目跑起来，而不是先理解所有内部设计，看这一份就够了。

## 1. 这是什么

你可以把它理解成一个“会帮你持续推进科研项目”的插件。

你给它一个研究主题，它会帮你：

- 创建项目目录
- 记录项目当前阶段
- 在空闲时自动补调研
- 在不同阶段唤起合适的 Agent 继续工作
- 项目中断后继续恢复

## 2. 最近新增了什么能力

现在这套系统除了“能推进项目”，还多了几项更实用的新能力：

- `Auto mode`
  - `conservative`：尽量自动推进，但关键位置更保守
  - `aggressive`：更积极自动推进
- `高风险先讨论，不立刻降档`
  - 遇到风险时，系统会先组织多 Agent 讨论
  - 先尝试补救，再决定是否降档
- `自动补救`
  - 讨论后会把 action items 派给对应 Agent 处理
- `可见的讨论内容`
  - 现在执行 `/workflow-status`，不只会看到“系统说它讨论过”
  - 还会直接看到每个 Agent 的讨论摘要、action items、blockers 和原始 response 摘要

如果你是新手，只要记住一句话：

高风险时，系统会先自己讨论和修，再决定要不要更保守。

## 3. 第一次使用先做什么

第一次使用，只要完成这 3 步：

1. 构建插件
2. 跑安装脚本
3. 把最小配置合并到你的 `~/.openclaw/openclaw.json`

命令如下：

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
bash install.sh --dry-run
bash install.sh
```

如果你不想让脚本自动创建 agents，可以改成：

```bash
bash install.sh --skip-agent-create
```

## 4. 安装脚本现在会帮你做什么

现在的 `install.sh` 不只是创建插件链接，还会尽量把常见准备工作一起做好：

- 检查或创建研究工作流需要的 agents
- 同步各角色 skills
- 如果本机存在 `PaperNexus` 仓库：
  - 自动同步 `papernexus`
  - 自动同步 `papernexus-agentic-reasoning`
  - 自动同步 `papernexus-reflection`
- 同步模板和 researcher/reviewer/cross-reviewer 根配置
- 创建 `~/.openclaw/plugins/openclaw-research` 插件链接
- 安装完成后告诉你怎么验证 `Auto mode` 和 `/workflow-status`

它不会自动修改你的 `~/.openclaw/openclaw.json`，这一点仍然需要你自己确认。

## 5. 还要改什么配置

安装脚本不会自动修改你的 OpenClaw 主配置，所以你还需要检查：

- `plugins.load.paths` 里包含 `~/.openclaw/plugins`
- `openclaw-research` 已启用
- `projectsRoot` 已设置
- `orchestrator`、`coder`、`analyzer`、`academic_writer`、`reviewer` 允许 `research_workflow`
- `heartbeat` 已开启
- 如果想启用更强自动推进，配置 `autoMode` 和 `autoGate`

最简单的参考文件是：

- [openclaw.RECOMMENDED.json](../openclaw.RECOMMENDED.json)

如果你不知道 `projectsRoot` 填什么，先用：

```json
"projectsRoot": "~/.openclaw/projects"
```

如果你不知道 heartbeat 怎么配，先用：

```json
"heartbeat": {
  "every": "30m"
}
```

通常只需要保证 `researcher` 会有 heartbeat 机会就够了。

如果你想直接打开自动推进，可以先从这个最稳的默认值开始：

```json
"autoMode": "conservative",
"autoGate": {
  "enabled": true,
  "maxMitigationRounds": 2
}
```

想更自动，再改成：

```json
"autoMode": "aggressive"
```

## 6. 怎么开始第一个科研项目

打开 OpenClaw，让 `researcher` 执行：

```text
/research-pipeline "你的研究主题"
```

例如：

```text
/research-pipeline "fine-grained image classification with robust part discovery"
```

执行后，系统会自动做这些事：

- 创建项目目录
- 生成 `PROJECT_MANIFEST.json`
- 初始化 workflow 状态
- 生成 idle research 模版
- 后续按阶段推进项目

## 7. 项目目录会放在哪里

默认会放到你配置的 `projectsRoot` 下面。

例如当你配置的是：

```json
"projectsRoot": "~/.openclaw/projects"
```

那么项目一般会出现在类似这样的目录：

```text
~/.openclaw/projects/fine-grained-image-classification-with-robust-part-discovery
```

这个目录就是你整个科研项目的工作区。

## 8. 运行过程中你最常用的命令

建议先记住这 4 个：

- `/research-pipeline "主题"`：开始一个新项目
- `/resume-pipeline "project-id"`：恢复一个中断的项目
- `/workflow-status`：查看当前项目状态、自动推进状态、讨论内容
- `/research-queue ...`：管理调研队列

如果你刚上手，最常用的是前 3 个。

## 9. 空闲的时候它会做什么

如果项目已经配置了 idle research，并且到期了，系统会在空闲时自动帮你做一轮受控调研。

你不用理解内部实现，只需要知道：

- 它不会无限乱跑
- 它会按项目主题调研
- 它会把结果记录回项目状态

新项目里还会自动生成一个可编辑模版：

- `researcher/idle-research/IDLE_RESEARCH.json`

你可以把它理解成“自动调研设置草稿”。

## 10. 它真的会自己讨论吗

现在可以直接看，不需要猜。

当项目进入高风险状态时，系统会先组织多 Agent 讨论，再决定下一步。

你执行：

```text
/workflow-status
```

现在能直接看到：

- 当前 `configuredAutoMode`
- 当前 `effectiveAutoMode`
- 风险原因
- 已经讨论了几轮
- 每个 Agent 的讨论摘要
- 每个 Agent 提出的 action items
- 还剩哪些 blockers
- 每个 Agent 返回的原始 response 摘要

如果你最关心“它到底有没有真的讨论”，就看这里。

## 11. 如果项目中断了怎么办

很简单，重新让 `researcher` 执行：

```text
/resume-pipeline "项目目录名"
```

例如：

```text
/resume-pipeline "fine-grained-image-classification-with-robust-part-discovery"
```

如果你忘了项目当前在哪个阶段，可以先执行：

```text
/workflow-status
```

## 12. 如果我完全不知道现在卡在哪

先按这个顺序排查：

1. 看 `~/.openclaw/openclaw.json` 是否真的启用了插件
2. 看 `projectsRoot` 是否配置正确
3. 看相关 agent 是否允许 `research_workflow`
4. 看 `researcher` 是否有 heartbeat
5. 运行 `/workflow-status`
6. 如果项目中断，运行 `/resume-pipeline "project-id"`

如果 `/workflow-status` 里已经出现：

- `Auto discussion`
- `Auto gate review`
- 各 Agent 的 discussion content

说明自动控制面已经真的在工作了。

## 13. 现在最推荐的使用方式

如果你是第一次用，建议直接照这个最短路径：

1. 执行 `npm run build`
2. 执行 `bash install.sh`
3. 参考 [openclaw.RECOMMENDED.json](../openclaw.RECOMMENDED.json) 改好主配置
4. 先用 `autoMode = conservative`
5. 执行 `/research-pipeline "你的研究主题"`
6. 执行 `/workflow-status` 看是否已经出现 Auto mode 和讨论信息
7. 需要恢复时执行 `/resume-pipeline "project-id"`
8. 想更自动时，再把 `autoMode` 改成 `aggressive`

## 14. 想继续了解再看哪里

等你真的跑起第一个项目之后，再看这些文档会更轻松：

- [overview_zh.md](./overview_zh.md)
- [DOC/guides/getting-started.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/DOC/guides/getting-started.md)
- [DOC/reference/configuration.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/DOC/reference/configuration.md)
