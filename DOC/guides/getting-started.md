# 快速上手

这份指南只讲 4 件最常用的事：

1. 如何开启一个科研项目
2. 如何打开自动化
3. 如何设置自动调研论文的主题方向
4. 如何设置远程服务器和 GPU

如果你已经完成安装，并且 `openclaw-research` 已经启用，看这一份就够了。

## 1. 如何开启科研

最简单的启动方式，就是让 `researcher` 执行：

```text
/research-pipeline "你的研究主题"
```

例如：

```text
/research-pipeline "multimodal reasoning for document understanding"
```

执行后，系统会自动做这些事：

- 创建项目目录
- 初始化 `PROJECT_MANIFEST.json`
- 初始化 workflow 状态
- 创建各个 Agent 的项目子目录
- 开始第一轮文献收集和图谱构建

如果你想恢复一个已经做过的项目，用：

```text
/resume-pipeline "project-id"
```

想查看当前状态，用：

```text
/workflow-status
```

## 2. 如何设置自动化

自动化最关键的是 3 件事：

- 打开 `autoMode`
- 打开 `autoGate`
- 给各个 Agent 配置 heartbeat

最稳的推荐值是：

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          "projectsRoot": "~/.openclaw/projects",
          "injectWorkflowContext": true,
          "enforceWorkflowBoundaries": true,
          "enableWorkflowMailbox": true,
          "heartbeatBackgroundChecks": true,
          "enableChannelProjectBindings": true,
          "autoMode": "conservative",
          "autoGate": {
            "enabled": true,
            "maxMitigationRounds": 2
          }
        }
      }
    }
  },
  "agents": {
    "list": [
      { "id": "researcher", "heartbeat": { "every": "30m" } },
      { "id": "orchestrator", "heartbeat": { "every": "2h" } },
      { "id": "coder", "heartbeat": { "every": "2h" } },
      { "id": "analyzer", "heartbeat": { "every": "2h" } },
      { "id": "academic_writer", "heartbeat": { "every": "2h" } },
      { "id": "reviewer", "heartbeat": { "every": "3h" } },
      { "id": "cross-reviewer", "heartbeat": { "every": "4h" } }
    ]
  }
}
```

这套默认值的含义很简单：

- `conservative`：尽量自动推进，但关键位置更保守
- `autoGate.enabled = true`：高风险时会先多 Agent 讨论和审核
- `researcher` heartbeat 更频繁：负责主流程推进和空闲自动调研

如果你确认系统已经比较稳定，想更自动，可以再把：

```json
"autoMode": "aggressive"
```

加进去。

更完整的推荐配置见：

- [openclaw.RECOMMENDED.json](../../openclaw.RECOMMENDED.json)

## 3. 如何设置自动调研论文的主题方向

最简单的理解方式是：

“自动调研”就是 Researcher 在空闲时，围绕你指定的主题继续追论文、补充文献、更新图谱。

### 3.1 先确认自动调研能运行

需要这两个条件：

- 插件配置里 `heartbeatBackgroundChecks = true`
- `researcher` 有 heartbeat

也就是上面自动化配置那一段已经开了。

### 3.2 新项目里会自动生成调研模板

项目创建后，你会看到：

- `{PROJ}/researcher/idle-research/IDLE_RESEARCH.json`

这个文件可以理解成“自动调研设置草稿”。

你最常需要改的是这些字段：

```json
{
  "enabled": true,
  "topic": "multimodal reasoning for document understanding",
  "objective": "track new papers, useful baselines, and strong implementation ideas",
  "query_seeds": [
    "document understanding multimodal reasoning",
    "multimodal OCR reasoning",
    "vision-language document QA"
  ],
  "preferred_venues": ["arXiv", "CVPR", "ICCV", "ECCV", "ACL", "EMNLP"],
  "max_papers_per_cycle": 8,
  "cooldown_minutes": 360,
  "refresh_graph_on_new_core_papers": true
}
```

最重要的字段只有 3 个：

- `enabled`
- `topic`
- `query_seeds`

### 3.3 什么时候它会自己调研

当这些条件满足时，系统会自动跑一轮：

- 当前项目不是 Researcher 的关键路径
- `idle_research.enabled = true`
- 到了下一次调研时间

你不需要手动盯着它，它会把结果写回项目状态和 round digest。

## 4. 如何设置远程服务器和 GPU

远程实验最简单的入口是：

- 全局默认服务器配置：`agents/researcher/SERVER.md`
- 某个项目单独指定服务器：`{PROJ}/servers.json`

### 4.1 先改全局默认服务器

编辑：

- [agents/researcher/SERVER.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/agents/researcher/SERVER.md)

至少写清楚这些信息：

- SSH 地址或 alias
- 远程代码目录
- 远程日志目录
- 远程结果目录
- `uv` 路径
- 数据集目录
- GPU 情况

最小示例：

```md
# SERVER.md — Remote Server Configuration

## GPU Server

- **SSH alias**: `gpu-server`
- **GPU**: `4x RTX 4090 24GB`
- **uv path**: `~/.local/bin/uv`

## Directory Configuration

- **Remote code directory**: `/home/you/experiments/`
- **Log directory**: `/home/you/experiments/logs/`
- **Result directory**: `/home/you/experiments/results/`
- **主数据集**: `/data/datasets/`
- **项目数据集**: `/data/projects/{PROJ}/datasets/`
```

### 4.2 检查服务器和 GPU 是否正常

先确认你本机能连上去：

```bash
ssh gpu-server "hostname"
```

再确认 GPU：

```bash
ssh gpu-server "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"
```

再确认 `uv`：

```bash
ssh gpu-server "~/.local/bin/uv --version"
```

### 4.3 如果某个项目想用另一台机器

可以在项目目录下写：

- `{PROJ}/servers.json`

最小示例：

```json
{
  "default": "gpu-server-a",
  "list": ["gpu-server-a", "gpu-server-b"]
}
```

它的意思是：

- 默认优先用 `gpu-server-a`
- 这个项目也允许分发到 `gpu-server-b`

### 4.4 GPU 是怎么被使用的

你不用手动指定每一张卡。通常流程是：

1. Researcher / `experiment-phase` 先检查远程 `nvidia-smi`
2. 再判断哪些 GPU 空闲
3. 然后把原子实验交给 Coder 去启动
4. 一般是一块 GPU 跑一个独立实验

所以你真正要保证的只有两件事：

- `SERVER.md` 写对
- SSH 和 `nvidia-smi` 能正常工作

## 5. 最简单的一套实际使用顺序

如果你是第一次用，按这个顺序做就行：

1. 在 `~/.openclaw/openclaw.json` 里合并推荐配置，先用 `autoMode = conservative`
2. 给各个 Agent 配好 heartbeat
3. 改好 [agents/researcher/SERVER.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/agents/researcher/SERVER.md)
4. 执行 `/research-pipeline "你的研究主题"`
5. 进入项目后，把 `researcher/idle-research/IDLE_RESEARCH.json` 里的主题方向改成你真正想长期追踪的方向
6. 用 `/workflow-status` 看它当前推进到了哪一步

如果你只想记一句话：

先开项目，再开自动化，再设自动调研主题，最后把远程服务器配好。
