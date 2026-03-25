# OpenClaw Research 新手使用说明

这份说明是给第一次用 `openclaw-research` 的人准备的。

如果你不想先理解复杂的多 Agent、workflow、图谱、实验账本，只想先把第一个科研项目跑起来，看这一份就够了。

## 1. 这是什么

你可以把这个插件理解成一个“会帮你持续推进科研项目”的系统。

你给它一个研究主题，它会帮你：

- 建一个项目目录
- 记录当前做到了哪一步
- 在空闲时继续补调研
- 需要时唤起不同角色继续工作
- 中断之后还能继续恢复

你不需要一开始就理解全部内部细节。

## 2. 先做什么

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

## 3. 还要改什么配置

安装脚本不会自动修改你的 OpenClaw 主配置，所以你还需要检查：

- `plugins.load.paths` 里包含 `~/.openclaw/plugins`
- `openclaw-research` 已启用
- `projectsRoot` 已设置
- `orchestrator`、`coder`、`analyzer`、`academic_writer`、`reviewer` 允许 `research_workflow`
- `heartbeat` 已开启

最简单的参考文件是：

- [openclaw.RECOMMENDED.json](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/openclaw.RECOMMENDED.json)

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

## 4. 怎么开始第一个科研项目

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

## 5. 项目目录会放在哪里

默认会放到你配置的 `projectsRoot` 下面。

例如当你配置的是：

```json
"projectsRoot": "~/.openclaw/projects"
```

那么项目一般会出现在类似这样的目录：

```text
~/.openclaw/projects/fine-grained-image-classification-with-robust-part-discovery
```

这个目录就是你整个科研项目的“工作区”。

## 6. 运行过程中你最常用的命令

建议先记住这 4 个：

- `/research-pipeline "主题"`：开始一个新项目
- `/resume-pipeline "project-id"`：恢复一个中断的项目
- `/workflow-status`：查看当前项目状态
- `/research-queue ...`：管理调研队列

如果你只是刚上手，前两个最重要。

## 7. 空闲的时候它会做什么

如果项目已经配置了 idle research，并且到期了，系统会在空闲时自动帮你做一轮受控调研。

你不用理解内部实现，只需要知道：

- 它不会无限乱跑
- 它会按项目主题调研
- 它会把结果记录回项目状态

新项目里还会自动生成一个可编辑模版：

- `researcher/idle-research/IDLE_RESEARCH.json`

你可以把它理解成“自动调研设置草稿”。

## 8. 如果项目中断了怎么办

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

## 9. 如果我完全不知道现在卡在哪

先按这个顺序排查：

1. 看 `~/.openclaw/openclaw.json` 是否真的启用了插件
2. 看 `projectsRoot` 是否配置正确
3. 看相关 agent 是否允许 `research_workflow`
4. 看 `researcher` 是否有 heartbeat
5. 运行 `/workflow-status`
6. 如果项目中断，运行 `/resume-pipeline "project-id"`

## 10. 你现在最推荐的使用方式

如果你是第一次用，建议直接照这个最短路径：

1. 执行 `npm run build`
2. 执行 `bash install.sh`
3. 参考 [openclaw.RECOMMENDED.json](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/openclaw.RECOMMENDED.json) 改好主配置
4. 执行 `/research-pipeline "你的研究主题"`
5. 需要恢复时执行 `/resume-pipeline "project-id"`
6. 看状态时执行 `/workflow-status`

## 11. 想继续了解再看哪里

等你真的跑起第一个项目之后，再看这些文档会更轻松：

- [README_zh.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/README_zh.md)
- [DOC/guides/getting-started.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/DOC/guides/getting-started.md)
- [DOC/reference/configuration.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/DOC/reference/configuration.md)
