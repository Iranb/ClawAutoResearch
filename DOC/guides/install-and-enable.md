# 安装与启用

如果你只是想尽快把系统跑起来，先看 [快速上手](./getting-started.md)。
这份文档更偏“安装动作与安装后检查清单”。

## 1. 前提

当前仓库已经自带安装脚本 `install.sh`。  
推荐在 `openclaw-research` 根目录执行，不要手工零散复制文件。

## 2. 安装脚本当前会做什么

`install.sh` 当前主要负责：

- 检查基础环境
- 检查是否已有构建产物
- 可选地创建或检查 workflow agents
- 如果本机存在 `PaperNexus`，先同步相关 skills
- 创建或更新 `~/.openclaw/plugins/openclaw-research` 符号链接
- 同步共享 workspace 配置与模板
- 同步角色配置文件
- 保留仓库内 `DOC/`、`openclaw.RECOMMENDED.json` 作为参考文档

## 3. 推荐安装步骤

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
bash install.sh --dry-run
bash install.sh
```

## 4. 当前脚本支持的参数

- `--dry-run`  
  先看将要执行什么，不真正落盘。

- `--force-role-files`  
  强制覆盖或重建角色配置文件同步。

- `--skip-agent-create`  
  跳过 `openclaw agents add`，只同步插件、skills、模板和角色配置。

## 5. 安装后应确认什么

### 5.1 插件链接存在

确认：

- `~/.openclaw/plugins/openclaw-research`

### 5.2 OpenClaw 配置能看到该插件

确认 OpenClaw 主配置已加载此插件，且运行时可以看到：

- `research_memory`
- `research_workflow`

### 5.3 角色允许使用 workflow 工具

确认 `openclaw.json` 中需要的角色已允许：

- `research_memory`
- `research_workflow`

### 5.4 heartbeat 已开启

当前推荐是按 Agent 单独配置 heartbeat，例如：

```js
researcher: { heartbeat: { every: "30m" } }
orchestrator: { heartbeat: { every: "2h" } }
coder: { heartbeat: { every: "2h" } }
analyzer: { heartbeat: { every: "2h" } }
academic_writer: { heartbeat: { every: "2h" } }
reviewer: { heartbeat: { every: "3h" } }
cross-reviewer: { heartbeat: { every: "4h" } }
```

### 5.5 Auto mode 配置已经对齐

建议先确认：

- `autoMode = conservative`
- `autoGate.enabled = true`
- `autoGate.maxMitigationRounds` 已设置

这样系统才能在高风险时先自动讨论、先补救，再决定是否降档。

## 6. 新项目创建后的第一步

建议 Researcher 在真正工作前先完成：

1. 初始化项目目录
2. 生成 `PROJECT_MANIFEST.json`
3. 生成 `TRACK_REGISTRY.json`
4. 生成 `CLAIM_POLICY.md`
5. 准备 `researcher/EXPERIMENT_LEDGER.json`
6. 调用 `research_workflow.get_snapshot`
7. 调用 `research_workflow.auto_iterator_tick`

## 7. 建议的后续初始化

### 如果你想让空闲时持续调研

设置 `idle_research`。

### 如果你想让 Writer 严格按模版写

设置 `writing_contract`。

### 如果你要充分利用 PaperNexus

确保项目里配置了：

- `papernexus_root`
- `researcher/PAPER_SOURCE_INDEX.json`

当前默认建议：

- 所有项目共享同一张全局 PaperNexus 图
- 项目 manifest 默认不需要单独设置 `papernexus_corpus`、`paper_source_dir`、`graph_source_dir`
- 项目只需要维护 canonical paper selection，并让 workflow 去检查这些论文是否已经存在于共享图中
- 图索引默认在 `~/.papernexus/index-store`

## 8. 推荐同时阅读

- `DOC/README.md`
- `DOC/overview_zh.md`
- `DOC/beginner_zh.md`
- `WORKFLOW.md`
