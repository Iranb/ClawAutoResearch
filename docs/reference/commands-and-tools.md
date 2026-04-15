# Commands 与 Tools

从 Agent 的视角看，这个插件真正暴露出来的系统能力主要来自 slash commands 和两组 runtime tools。

## 1. Slash commands

| Command | 作用 | 常见场景 |
| --- | --- | --- |
| `/project-init` | 初始化项目骨架 | 新建项目 |
| `/auto-research` | 只给主题就启动全自动科研主线 | 想从 topic 直接创建项目并后台开跑 |
| `/auto-review` | 只给主题就启动全自动综述主线 | 想从 topic 直接创建 survey 项目并后台开跑 |
| `/graph-build` | 构建或修复 graph presence | 共享图缺论文、graph 不 ready |
| `/research-pipeline` | 启动或继续主研究流程 | 想从当前项目状态持续推进 |
| `/survey-pipeline` | 启动综述主线 | 想围绕一个主题做综述、screening、coverage 与 survey 写作 |
| `/research-queue` | 多项目排队推进 | 同时管理多个研究项目 |
| `/resume-pipeline` | 从 durable state 恢复 | 会话重启、上下文丢失、换频道 |
| `/workflow-status` | 查看阶段、blocking reason、auto discussion | 排障与人工诊断 |
| `/handoff-status` | 查看 handoff control plane 状态 | owner 似乎切了但没人接手、queue/mailbox/binding gate 诊断 |
| `/show-commands` | 列出可用 slash commands 与简介 | 刚接触系统，或不确定该用哪个入口 |
| `/citation-calibrate` | 对当前项目运行 citation calibration | submit 前刷新引用真实性校验 |
| `/authoring-closeout` | 对当前项目执行 deterministic closeout | 稿件已生成，但 workflow 状态或 QC 还没收口 |
| `/capture-diagnostics` | 抓取当前项目的诊断包 | Discord 流水线卡住、handoff 丢失、graph/review 状态异常时一键留存现场 |
| `/survey-graph-build` | 运行后台 survey 图谱候选构建 | 主题相关、强去重、graph-missing 优先 |

## 2. `research_memory`

这是结构化研究记忆工具，常见动作包括：

- `get_paths`
- `record_idea_entry`
- `record_experiment_entry`
- `record_failed_experiment_entry`
- `append_daily_log`
- `get_review_state`
- `set_review_state`
- `check_review_resumability`

它的目标是让 idea / experiment / review 的记忆留在文件系统和结构化状态里，而不是留在聊天上下文里。

## 3. `research_workflow`

这是控制平面最重要的工具面。核心动作家族包括：

### Snapshot 与推进

- `get_snapshot`
- `auto_iterator_tick`
- `dispatch_task`
- gate state 相关动作

### Graph 与摄取

- `get_papernexus_remote_access`
- `get_papernexus_progress`
- `check_graph_presence`
- `queue_paper_ingestion`

### Contracts 与 materializers

- `materialize_ideation_contract`
- `set_research_program`
- `materialize_paper_story_state`
- `materialize_review_pressure_packet`
- `materialize_writing_support_artifacts`

### Coordination

- `read_mailbox`
- `send_mailbox`
- `ack_mailbox`
- channel binding 相关动作
- `get_file_audit_state`
- `set_file_audit_policy`
- `materialize_file_audit_packet`

### Experiment / QC / review

- `upsert_experiment`
- `refresh_gpu_monitor`
- `get_gpu_monitor`
- `record_experiment_runtime_signal`
- `evaluate_experiment_search_decision`
- `get_paper_qc`
- `get_figure_qc`
- `get_citation_collection`
- `get_review_issue_tracker`

`refresh_gpu_monitor` / `get_gpu_monitor` 这一组专门服务 experiment monitor：

- 读取项目里的活跃 `REMOTE_RUN.json`
- 通过 SSH 采集服务器 GPU 使用率与 `screen -ls`
- 生成 durable 的 GPU monitor snapshot
- 按显式优先级判断 completion：
  - terminal watcher artifact
  - stable `RESULT_SUMMARY.json`
  - idle GPU + missing screen
  - stale heartbeat timeout
- 帮 Coder / Researcher 判断“run 还在忙”还是“应该转去 `/monitor-experiment` 做 reconciliation”

`record_experiment_runtime_signal` / `evaluate_experiment_search_decision` 这一组是 experiment control-plane 的新核心：

- `record_experiment_runtime_signal`
  - 给 bundle 写 `RUN_HEARTBEAT.json` / `RUN_TERMINAL.json` / `RESULT_SUMMARY.json` / `FAILURE_SIGNATURE.json`
  - 让 completion 检测不依赖 agent 在线
- `evaluate_experiment_search_decision`
  - 综合 `EXPERIMENT_SEARCH_SPEC.json`、`experiment_search`、`EXPERIMENT_LEDGER.json`、experiment review、experiment memory、GPU monitor
  - 输出 `repair_implementation / continue_tuning / require_multi_seed / require_ablation / rollback_to_plan / rollback_to_idea / reconcile_runtime`
- promotion 现在也有 runtime hard guard：如果 recorded basis 只引用 configured `non_promotion_signals`，candidate 不能被 promote

## 3.5 workflow hooks 相关动作

现在 `research_workflow` 还暴露了一组和 workflow hooks 直接相关的动作：

| Action | 作用 | 常见场景 |
| --- | --- | --- |
| `get_file_audit_state` | 读取 manifest hook policy + runtime hook state | 排查某个 stage / handoff 为什么被 hook 挡住 |
| `set_file_audit_policy` | 将 file audit hooks 写入 `PROJECT_MANIFEST.json.workflow_hooks` | 初始化项目审计策略、人工调整审核规则 |
| `materialize_file_audit_packet` | 手动物化某个 hook 的 audit packet | 调试 hook 输入面、检查 supporting artifacts 是否正确 |

这组动作和旧的 feature-specific review 不同：

- 它们不是只服务某一个 stage
- 它们是跨 `stage/task/handoff` 的节点级审核能力
- 它们会和 `.openclaw-research/workflow-hooks-state.json`、`reviewer/file-audits/` 联动

如果你想看完整架构背景，直接读：

- [Workflow Hooks](../architecture/workflow-hooks.md)

## 4. 为什么 `auto_iterator_tick` 是最重要的入口

只看命令表，容易误以为所有动作是平铺的。实际上 `auto_iterator_tick` 是把它们串起来的关键：它决定当前阶段该持有哪种工具动作、该 materialize 哪些 contract、是否应该回退到 `graph_build`、是否该等待人工。

在 experiment 阶段，它现在还负责：

- 根据 decision engine 把 bounded repair handoff 给 `Coder`
- 把 multi-seed / ablation / reconcile handoff 回 `Researcher`
- 在 active search envelope 下优先派发 `Coder /search-experiment`
- 在 rollback 条件满足时显式回退到 `plan` / `idea` 并同步 `orchestration_state`

## 5. command / tool / skill 的关系

- command：面向用户或频道的入口。
- tool：面向 Agent 的运行时接口。
- skill：面向角色的执行协议。

理解这三层的关系后，排查问题会容易很多。很多表面上的“skill 没做好”，其实是 tool state 没准备好，或者 command 进入点选错了。

补充一个真实调试经验：

- workflow command handler 本身已经可以通过 repo-local fallback `scripts/run_local_workflow_command.mjs` 直接验证
- 如果 non-interactive `openclaw agent` slash transport 继续 silent hang，优先区分：
  - handler / workflow runtime 是否正常
  - transport 本体是否异常

这样就不会把 transport 问题误判成 workflow 主链问题。

现有项目批量迁移到最新 workflow/runtime 结构时，推荐直接运行：

```bash
node scripts/migrate_latest_workflow_projects.mjs --projects-root "/workspace/AutoResearchProjects"
```

它会批量 backfill 项目骨架、runtime state、survey identity，以及 experiment decision 持久化字段。
