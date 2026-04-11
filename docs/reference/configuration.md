# Configuration

这页总结的是“哪些配置会显著改变 workflow 行为”。

## 1. 最重要的插件配置

- `projectsRoot`
- `injectWorkflowContext`
- `enforceWorkflowBoundaries`
- `enableWorkflowMailbox`
- `maxWorkflowInboxMessages`
- `agentContactCooldownSeconds`
- `enableChannelProjectBindings`
- `lobsterHandoff`
- `papernexusAccessMode`
- `papernexusApiBaseUrl`
- `papernexusMcpUrl`
- `papernexusApiTokenEnv`
- `papernexusApiTokenSource`
- `papernexusSharedCorpus`

## 2. 这些配置分别影响什么

### `projectsRoot`

决定项目目录的权威根。现在 workflow 不再接受 workspace fallback，所以路径错了就是直接失败，而不是偷偷写到别处。

### `injectWorkflowContext`

决定 prompt 是否注入阶段、owner、blocking、mailbox 摘要和边界提醒。关掉它通常会让 Agent 更容易忘记 handoff 和 owner gate。

### `enableWorkflowMailbox`

打开结构化交接层，减少频道噪音和重复 `@agent` 唤醒。

### `lobsterHandoff`

控制是否把跨 Agent handoff 的 dispatch hop 交给 Lobster backend。

它不改变：

- stage readiness
- owner 计算
- mailbox 事实源
- stage broadcast

它只改变：

- “handoff 这一跳是走 native 还是走 Lobster”

当前最常用的字段是：

- `enabled`
- `autoModeOnly`
- `gatewayUrl`
- `pipelinePath`
- `timeoutMs`
- `maxStdoutBytes`
- `fallbackToNative`

推荐理解：

- 想先试水：`enabled = true`, `autoModeOnly = true`
- 想避免 Lobster 挂掉就卡死：`fallbackToNative = true`
- 只有在你真的要替换内置 pipeline 路径时，才需要改 `pipelinePath`

### `papernexusAccessMode`

控制 shared graph 的访问策略：`remote_mcp`、`remote_api`、`local_mcp` 或 `auto`。

### `papernexusSharedCorpus`

控制 graph presence 和 auto iterator 应该对齐哪一个共享语料库。这个字段很关键，因为它避免系统在远程环境中错误使用内部默认 corpus。

## 3. 推荐调参方向

| 目标 | 主要调节项 |
| --- | --- |
| 减少 prompt 噪音 | `maxWorkflowInboxMessages` |
| 减少重复唤醒 | `agentContactCooldownSeconds` |
| 稳定自动 handoff hop | `lobsterHandoff.enabled` + `lobsterHandoff.autoModeOnly` + `lobsterHandoff.fallbackToNative` |
| 强化越界保护 | `enforceWorkflowBoundaries` |
| 稳定多频道多项目 | `enableChannelProjectBindings` |
| 改善远程图谱一致性 | `papernexusAccessMode` + `papernexusSharedCorpus` |
