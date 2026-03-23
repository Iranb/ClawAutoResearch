# 运行、调试与测试

## 1. 日常运行的建议顺序

如果你要让系统长期自动推进，推荐的基本节奏是：

1. 保证项目目录状态完整
2. 保证 heartbeat 在运行
3. 让 Researcher 在 heartbeat / bootstrap / recovery turn 优先调用 `auto_iterator_tick`
4. 通过 `mailbox` 和受控 handoff 在角色间传递工作
5. 定期检查实验账本、innovation reflection 和 writing contract

## 2. 日常观察点

运行中最值得关注的状态包括：

- `PROJECT_MANIFEST.json.current_stage`
- `PROJECT_MANIFEST.json.owner_agent`
- `PROJECT_MANIFEST.json.blocking_reason`
- `PROJECT_MANIFEST.json.idle_research`
- `PROJECT_MANIFEST.json.innovation_reflection`
- `PROJECT_MANIFEST.json.writing_contract`
- `researcher/EXPERIMENT_LEDGER.json`
- `.openclaw-research/workflow-mailbox.json`

## 3. 遇到这些现象时优先怎么排查

### Agent 一直不往下走

优先检查：

- 当前 stage 的 required artifacts 是否齐全
- `blocking_reason`
- `missingStageSignals`
- mailbox 是否存在未处理 blocker

### Agent 忘记实验历史

优先检查：

- `researcher/EXPERIMENT_LEDGER.json` 是否存在
- 最近实验是否通过 `upsert_experiment` 回写
- `PROJECT_MANIFEST.json.experiment_memory` 是否同步

### Writer 没按模版写

优先检查：

- `writing_contract.template_required`
- `writing_contract.template_path`
- `writing_contract.template_status`
- `academic_writer/TEMPLATE_MAPPING.md`

### Researcher 空闲时乱调研

优先检查：

- `idle_research.enabled`
- `idle_research.topic`
- `idle_research.cooldown_minutes`
- `idle_research.last_run_at`

### Discord 里消息很乱

优先检查：

- `blockDiscordAgentMentions`
- `enableWorkflowMailbox`
- `agentContactCooldownSeconds`

## 4. 当前构建和测试命令

项目 `package.json` 当前提供：

```bash
npm run build
npm test
```

含义分别是：

- `npm run build`  
  执行 TypeScript 编译

- `npm test`  
  使用 Node 原生 test runner 运行 `tests/*.test.mjs`

## 5. 当前已经存在的自动迭代测试

目前已加入的测试主要覆盖：

- 缺少 setup 信号时保持在 `setup`
- setup 条件齐全时自动推进到 `graph_build`
- submit 材料齐全后在强制人工 gate 停下

这些测试位于：

- `tests/auto-iterator.test.mjs`

## 6. 推荐的扩展测试方向

如果你继续扩展代码，优先值得补的测试有：

- mailbox 路由与 ack
- contact cooldown
- idle_research 到期与状态回写
- innovation reflection stale 检查
- writing_contract 缺模板时的阻塞
- PaperNexus graph refresh required 的判断

## 7. 发生恢复或重启时怎么做

重启后不要直接继续写内容，优先：

1. 运行 `/resume-pipeline`
2. 读取 snapshot
3. 运行 `auto_iterator_tick`
4. 检查 mailbox
5. 对齐 ledger、manifest 和实际产物目录

## 8. 文档与代码对齐的建议

每次新增重大能力时，建议同步更新：

- `README.md`
- `WORKFLOW.md`
- `DOC/README.md`
- `DOC/` 下对应 concept/reference/guide

这样后面你自己维护这套系统时，不会只剩代码能读懂，而没有体系化文档可查。
