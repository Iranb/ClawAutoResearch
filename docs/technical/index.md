# 技术文档

这一部分面向维护者、扩展开发者和需要排查系统内部行为的人。

这里重点解释：

- workflow control plane
- runtime queue / mailbox / handoff
- graph presence / PaperNexus / durable state
- 命令、工具、状态合同和模块边界

## 推荐阅读顺序

1. [系统特性与 Workflow 流程总览](../architecture/system-workflows.md)
2. [Workflow 向 Discord 汇报的节点](../architecture/discord-reporting.md)
3. [系统设计总览](../architecture/index.md)
4. [Workflow 控制平面](../architecture/workflow-control-plane.md)
5. [Commands 与 Tools](../reference/commands-and-tools.md)
6. [State Contracts](../reference/state-contracts.md)
7. [测试与调试](../operations/testing-and-debugging.md)

## 这部分适合谁

- 你要改 workflow 代码
- 你要排查 runtime / handoff / queue 问题
- 你要理解为什么一个项目会推进、回退、repair 或等待人工

## 继续阅读

- [架构设计](../architecture/index.md)
- [运行时参考](../reference/index.md)
- [开发与运维](../operations/index.md)
- [内部设计历史](../internal-history.md)
