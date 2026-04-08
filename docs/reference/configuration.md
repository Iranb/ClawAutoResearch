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

### `papernexusAccessMode`

控制 shared graph 的访问策略：`remote_mcp`、`remote_api`、`local_mcp` 或 `auto`。

### `papernexusSharedCorpus`

控制 graph presence 和 auto iterator 应该对齐哪一个共享语料库。这个字段很关键，因为它避免系统在远程环境中错误使用内部默认 corpus。

## 3. 推荐调参方向

| 目标 | 主要调节项 |
| --- | --- |
| 减少 prompt 噪音 | `maxWorkflowInboxMessages` |
| 减少重复唤醒 | `agentContactCooldownSeconds` |
| 强化越界保护 | `enforceWorkflowBoundaries` |
| 稳定多频道多项目 | `enableChannelProjectBindings` |
| 改善远程图谱一致性 | `papernexusAccessMode` + `papernexusSharedCorpus` |
