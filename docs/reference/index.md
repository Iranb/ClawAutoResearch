# 运行时参考索引

这一部分回答的是“系统在代码和工具层面到底暴露了什么”。

推荐阅读顺序：

1. [Commands 与 Tools](./commands-and-tools.md)
2. [State Contracts](./state-contracts.md)
3. [Module Map](./module-map.md)
4. [Configuration](./configuration.md)

如果你正在看新的 conference / journal 广覆盖论文搜索实现，建议先读：

- [Broad Paper Search 设计详解](../architecture/broad-paper-search.md)

如果你在修 bug，通常先看 commands/tools，再看 state contracts，最后看 module map。

如果你关注的是“某个节点为什么被挡住、审核 packet 在哪里、revision 是怎么派回去的”，建议把架构页里的：

- [Workflow Hooks](../architecture/workflow-hooks.md)

一起看。
