# OpenClaw Research Plugin - 配置扩展分析索引

> 这是一份完整的配置可扩展性分析文档集合。用于回答问题：  
> **"项目根目录、GPU服务器等业务参数能否通过 plugin config 实现？"**

---

## 📑 文档导航

### 🎯 快速入门（5 分钟）

1. **[CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md)** ⭐ 从这里开始
   - 核心问题和答案
   - 3 种方案对比
   - 推荐决策
   - 实施路径
   - **适合**：管理者、决策者

### 📊 深度分析（30 分钟）

2. **[CONFIG_VISUAL_COMPARISON.md](./CONFIG_VISUAL_COMPARISON.md)**
   - 当前架构 vs 扩展后架构（可视化）
   - 数据流对比
   - 配置灵活性对比
   - 成本效益分析
   - **适合**：技术主管、架构师

3. **[CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md)**
   - 完整的技术分析
   - 当前缺陷分析
   - 详细实施方案（第一步到第五步）
   - 兼容性分析
   - **适合**：开发者、技术负责人

### 🔧 实施指南（工作用）

4. **[CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md)**
   - Phase 1/2/3 按步骤检查清单
   - 每个任务的详细说明
   - 预期代码行数
   - 进度追踪表
   - **适合**：开发者、项目经理

5. **[CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md)**
   - 常见配置场景（4 个示例）
   - 字段优先级矩阵
   - 配置检查清单
   - 迁移指南
   - 故障排除
   - **适合**：用户、运维、开发者

---

## 📌 核心问题与答案

### Q1: 项目根目录能否通过 plugin config 实现？

**现状**：❌ 不能  
**原因**：`openclaw.plugin.json` 的 `configSchema` 禁止未定义的字段  
**解决**：✅ 通过扩展 schema 即可支持  
**工作量**：~7.5 小时

---

### Q2: GPU 服务器能否通过 plugin config 实现？

**现状**：❌ 不能（目前在 `~/.openclaw/openclaw-research.json`）  
**原因**：plugin config 中没有 servers 字段  
**解决**：✅ 添加 `servers` 字段到 config  
**工作量**：包含在上述 7.5 小时内

---

### Q3: 轨道数、预算、评审轮数等业务参数能否配置？

**现状**：❌ 完全不能（都是硬编码）  
**原因**：这些参数没有在 plugin config 中定义  
**解决**：✅ 新增 7 个参数对象到 config  
**工作量**：包含在上述 7.5 小时内

---

### Q4: 推荐做什么？

**推荐**：采用 **方案 B（扩展 Plugin Config）**

| 方面 | 方案 A（不改） | 方案 B（扩展） |
|------|:----:|:----:|
| 成本 | 0h | 20h |
| 收益 | 无 | 高 |
| 维护成本 | 高 | 低 |
| 可配性 | 低 | 高 |
| 推荐度 | ❌ | ✅✅✅ |

---

### Q5: 需要多久实施？

**Phase 1（必须）**：7.5 小时
- 核心扩展：schema + policy + 文档

**Phase 2（强烈推荐）**：5.5 小时  
- 5 个 skills 集成

**Phase 3（可选）**：7 小时
- 验证和测试

**建议**：Phase 1 + 2 共 13 小时（1-2 个工作日）

---

### Q6: 向后兼容吗？

**是的，100% 向后兼容**
- 所有新字段都是可选的
- 所有字段都有合理的默认值
- 现有 config 无需修改即可继续工作

---

## 📊 当前配置现状总结

| 参数 | 当前位置 | 当前支持 | 扩展后 |
|------|---------|:------:|:----:|
| projectsRoot | `openclaw.json` 顶级 | ⚠️ 是但分散 | ✅ plugin config |
| servers | `~/.openclaw/openclaw-research.json` | ⚠️ 是但全局 | ✅ plugin config |
| maxActiveTracks | 代码硬编码 | ❌ 否 | ✅ plugin config |
| divergeSize | 代码硬编码 | ❌ 否 | ✅ plugin config |
| portfolioSize | 代码硬编码 | ❌ 否 | ✅ plugin config |
| maxConcurrentExp | 代码硬编码 | ❌ 否 | ✅ plugin config |
| maxReviewRounds | 代码硬编码 | ❌ 否 | ✅ plugin config |
| scoreThreshold | 代码硬编码 | ❌ 否 | ✅ plugin config |
| gpuType | 不存在 | ❌ 否 | ✅ plugin config |
| noveltyThreshold | 不存在 | ❌ 否 | ✅ plugin config |

---

## 🎯 决策树

```
问题：我们应该实施配置扩展吗？

├─ 你想要参数可配化吗？
│  ├─ 是 → 继续
│  └─ 否 → 停止（方案 A）
│
├─ 你想要集中管理配置吗？
│  ├─ 是 → 继续
│  └─ 否 → 停止（保持现状）
│
├─ 你有时间实施吗？（13-20h）
│  ├─ 是 → 继续
│  └─ 否 → 延期计划
│
└─ 最终决定 → 实施方案 B（Phase 1 + 2）✅
              立即开始，下周完成
```

---

## 📈 实施规划

### Timeline（推荐）

```
Week 1
  Mon: Phase 1 核心扩展 (7.5h)
       ├─ openclaw.plugin.json (2h)
       ├─ tools/research-memory.ts (3h)
       ├─ index.ts (1.5h)
       └─ 文档更新 (1h)
  
  Tue: Phase 2 技能集成 (5.5h)
       ├─ 5 个 skills 修改 (5.5h)
       └─ 集成测试 (0.5h)
  
  Wed: Phase 3 质量保证 (7h)
       ├─ 单元测试 (2h)
       ├─ 集成测试 (3h)
       └─ 文档完善 (2h)

Week 2
  Thu-Fri: Code Review + Merge + 用户文档
```

### 资源需求

- **开发者**：1-2 人
- **工时**：20 小时（core) + 5 小时（review）= 25 小时
- **成本**：~$500-1000（假设 $20-40/小时）
- **硬件**：标准开发机

### 风险评估

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| 配置冲突 | 中 | 中 | Phase 3 验证器 |
| 技能遗漏 | 低 | 中 | Code Review |
| 向后兼容性 | 很低 | 高 | 完整测试覆盖 |
| **总体风险** | **低** | **可控** | **可管理** |

---

## 🎓 学习资源

### 需要了解的概念

1. **JSON Schema** - 用于验证 config 结构
   - [JSON Schema 官方文档](https://json-schema.org/)
   - 本项目中的 `openclaw.plugin.json` 示例

2. **TypeScript 接口** - 用于定义 config 类型
   - 本项目中的 `ResearchMemoryPolicy` 示例

3. **Plugin 系统** - OpenClaw 的扩展机制
   - [index.ts](./index.ts) - plugin 注册示例
   - [openclaw.plugin.json](./openclaw.plugin.json) - plugin 元数据

### 推荐阅读顺序

1. 快速理解：[CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md)（5 min）
2. 理解架构：[CONFIG_VISUAL_COMPARISON.md](./CONFIG_VISUAL_COMPARISON.md)（15 min）
3. 开始实施：[CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md)（10 min）
4. 参考查询：[CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md)（随时查）
5. 深度分析：[CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md)（30 min）

---

## 🚀 快速开始

### 如果你是决策者

1. 阅读 [CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md) - 5 分钟
2. 查看 [CONFIG_VISUAL_COMPARISON.md](./CONFIG_VISUAL_COMPARISON.md) 的成本效益章节 - 3 分钟
3. 做出决定：推荐 **实施方案 B**
4. 分配资源：1-2 个开发者，13-20 小时

### 如果你是开发者

1. 阅读 [CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md) - 快速理解
2. 打开 [CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md) - 作为工作指导
3. 参考 [CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md) - 实施细节
4. 遇到问题查询 [CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md)

### 如果你是 DevOps/运维

1. 查看 [CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md) - 配置示例
2. 参考场景 1-4（单 GPU、多 GPU、云端、学术预算）
3. 使用配置检查清单进行验证

---

## 📞 常见问题

### Q: 改 json 配置后需要重启吗？

**是的**，plugin 在启动时读取配置。建议：
- 改完配置后重新启动 OpenClaw
- 或启动新的 research pipeline 项目

### Q: 如果配置错了会怎样？

**有 3 层防护**：
1. JSON Schema 验证（在 `openclaw.plugin.json` 中）
2. TypeScript 类型检查（编译时）
3. Phase 3 的自动验证器（运行时）

### Q: 可以每个项目有不同配置吗？

**是的**，两种方式：
1. 顶级 `openclaw.json` - 全局配置
2. 环境变量 + `{PROJ}/servers.json` - 项目级覆盖

### Q: 扩展对现有项目有影响吗？

**没有**。所有新配置都有合理的默认值，现有项目自动继承这些默认值，无需修改。

### Q: 如何验证配置正确性？

参考 [CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md) 的配置检查清单，或运行：
```bash
research_memory({ action: "get_paths" })
# 返回已加载的完整配置
```

---

## 📊 文档统计

| 文档 | 大小 | 深度 | 用途 |
|------|:---:|:---:|------|
| CONFIG_EXTENSION_SUMMARY.md | 📄 | 概览 | 决策 |
| CONFIG_VISUAL_COMPARISON.md | 📊 | 可视化 | 理解 |
| CONFIG_EXTENSIBILITY_ANALYSIS.md | 📘 | 深度 | 实施 |
| CONFIG_IMPLEMENTATION_CHECKLIST.md | ✅ | 详细 | 执行 |
| CONFIG_QUICK_REFERENCE.md | 🔍 | 参考 | 查询 |
| **此文档（索引）** | 📑 | 导航 | 定位 |

**总内容量**：~50KB、~8000 行、完整覆盖决策→实施→使用全流程

---

## 🎯 后续行动

### 立即（今天）

- [ ] 阅读 [CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md)
- [ ] 与团队讨论方案选择
- [ ] 做出决定（推荐方案 B）

### 本周

- [ ] 批准实施方案
- [ ] 分配开发者
- [ ] 开始 Phase 1（openclaw.plugin.json）

### 下周

- [ ] 完成 Phase 1 + Phase 2
- [ ] Code Review
- [ ] 合并到 main 分支
- [ ] 用户文档更新

### 长期

- [ ] Phase 3 测试完善（可选）
- [ ] 监控用户反馈
- [ ] 基于反馈的配置优化

---

## 📞 联系方式

如有问题：
1. 查阅此索引和相关文档
2. 参考 [CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md) 的故障排除
3. 向项目维护者提交 Issue

---

## 📝 版本历史

| 版本 | 日期 | 描述 |
|------|------|------|
| 1.0 | 2026-03-21 | 初始版本：完整分析+方案+检查清单 |

---

## 📄 许可证

本分析文档集合采用 MIT 许可证。

---

**创建时间**：2026年3月21日  
**最后更新**：2026年3月21日  
**状态**：完成（Ready for Decision）  
**下一步**：审核并批准实施

---

**快速链接**：
- 🎯 决策支持 → [CONFIG_EXTENSION_SUMMARY.md](./CONFIG_EXTENSION_SUMMARY.md)
- 📊 可视化对比 → [CONFIG_VISUAL_COMPARISON.md](./CONFIG_VISUAL_COMPARISON.md)
- 🔧 实施细节 → [CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md)
- ✅ 执行清单 → [CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md)
- 🔍 快速参考 → [CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md)
