# 安装与启用

## 1. 前提

当前仓库已经自带安装脚本 `install.sh`。  
推荐在 `openclaw-research` 根目录执行，不要手工零散复制文件。

## 2. 安装脚本当前会做什么

`install.sh` 当前主要负责：

- 检查基础环境
- 创建或更新 `~/.openclaw/plugins/openclaw-research` 符号链接
- 同步共享 workspace 配置与模板
- 同步角色配置文件
- 保留仓库内 `README.md`、`DOC/`、`openclaw.RECOMMENDED.json` 作为参考文档

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

当前推荐默认是：

```js
heartbeat: {
  every: "30m"
}
```

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
- `papernexus_corpus`
- `paper_source_dir`
- `graph_source_dir`

当前默认建议：

- `paper_source_dir = ~/.papernexus/papers/{project_id}`
- `graph_source_dir = ~/.papernexus/papers/{project_id}`
- 图索引默认在 `~/.papernexus/index-store`

## 8. 推荐同时阅读

- `DOC/README.md`
- `README.md`
- `WORKFLOW.md`
