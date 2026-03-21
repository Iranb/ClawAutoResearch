# 配置扩展方案总结

## 🎯 核心问题与答案

### Q: 项目根目录、GPU 服务器等配置能否通过 plugin config 实现？

**现状**：❌ **不能完全实现**

- ✅ `projectsRoot` 可在 `openclaw.json` 顶级设置
- ❌ `projectsRoot` **不能在** plugin config 中设置（schema 禁止未知字段）
- ✅ `servers` 可在 `~/.openclaw/openclaw-research.json` 设置
- ❌ `servers` **不能在** plugin config 中设置
- ❌ 业务参数（轨道数、预算、评审轮数）**完全不支持**

**根本原因**：`openclaw.plugin.json` 中 `configSchema.additionalProperties: false` 禁止任何未定义的字段。

---

## 📋 建议方案

### 方案 A: 保持现状（不改）

**优点**：
- 零成本
- 不破坏现有配置

**缺点**：
- 无法通过单个 plugin config 管理所有配置
- 业务参数必须硬编码在 skills 中
- 新增功能需要改代码，而非改配置

---

### 方案 B: 扩展 Plugin Config（推荐）✅

**改动**：
1. 扩展 `openclaw.plugin.json` 的 configSchema
2. 扩展 `tools/research-memory.ts` 的 ResearchMemoryPolicy
3. 在 index.ts 中添加字段处理逻辑
4. 在各 skill 中读取并应用配置

**优点**：
- ✅ 所有配置集中在 plugin config 中
- ✅ 支持每个项目独立配置（通过环境变量）
- ✅ 易于扩展新参数
- ✅ 完全向后兼容（所有字段都有默认值）
- ✅ 类型安全（JSON Schema + TypeScript）

**缺点**：
- 实施工作量：~19 小时（Phase 1: 7.5h + Phase 2: 5.5h + Phase 3: 7h）
- 需要修改 7 个文件

**投资回报率**：高 - 一次投入，永久获益

---

## 📊 实施方案详解

### Phase 1: 核心扩展 (7.5h) - 🔴 必须

**目标**：使 plugin config 能承载所有业务参数

**修改文件**：
```
openclaw.plugin.json          → 新增 configSchema 字段 (150 行)
tools/research-memory.ts      → 扩展 ResearchMemoryPolicy (45 行)
tools/research-memory.ts      → 更新 DEFAULT_POLICY (55 行)
tools/research-memory.ts      → 更新 normalizePolicy() (70 行)
tools/research-memory.ts      → 新增 getBusinessConfig() (20 行)
index.ts                      → 更新 getPolicy() (80 行)
SKILL.md                      → 更新配置示例文档 (已完成 ✅)
```

**产物**：
- ✅ plugin config 现在支持 7 个新的配置对象
- ✅ 所有技能都能通过 `research_memory({ action: "get_paths" })` 获取完整配置
- ✅ 类型安全的配置读取

**验证**：
```bash
npm run validate:config
# 检查 openclaw.json 中的 plugin config 是否符合 schema
```

---

### Phase 2: 技能集成 (5.5h) - 🟡 强烈建议

**目标**：让每个 skill 真正使用配置参数，而非硬编码值

**修改文件**：
```
skills/researcher/idea-phase/
  → 读取 ideaGeneration.divergeSize、portfolioSize、tournamentRounds
  → 生成的候选数、进入竞赛的数量、竞赛轮数都由配置决定

skills/researcher/track-decision/
  → 读取 trackPortfolio.maxActiveTracks、maxParkedTracks、parkedBudgetPolicy
  → 强制执行轨道数约束，超出时报错

skills/coder/run-experiment/
  → 读取 computeBudget.maxConcurrentExperiments、gpuType
  → 限制并发任务数，选择合适的 GPU

skills/reviewer/review-phase/
  → 读取 reviewLoop.maxRounds、scoreThreshold、autoAdvanceScore
  → 应用评审轮数和分数阈值

skills/researcher/frontier-mapping/ or graph-build/
  → 读取 graphConfig.autoRefreshTrigger、noveltyThreshold、maxPapersToIngest
  → 控制图谱构建策略和文献过滤
```

**产物**：
- ✅ skills 不再依赖硬编码的配置
- ✅ 同一套代码支持多种配置场景（单 GPU、多 GPU、云集群等）
- ✅ 配置错误能被及时检测（如 divergeSize < maxActiveTracks）

---

### Phase 3: 验证与测试 (7h) - 🟢 可选但推荐

**目标**：确保配置的正确性和完整性

**新增文件**：
```
tools/config-validator.ts          → 配置冲突检测 (50 行)
__tests__/config-validation.test.ts → 单元测试 (150 行)
__tests__/e2e/config-integration.test.ts → 集成测试 (200 行)
```

**验证内容**：
- ✅ 默认策略完整性
- ✅ 部分配置合并正确性
- ✅ 边界值（min/max）处理
- ✅ 类型强制转换
- ✅ 向后兼容性
- ✅ 配置冲突检测（如 divergeSize < maxActiveTracks）

---

## 🔧 具体改动示例

### Before - 当前状态

**openclaw.json**：
```json5
{
  projectsRoot: "~/.openclaw/projects",  // ← 分散
  plugins: {
    entries: {
      "openclaw-research": {
        config: {
          allowWorkspaceFallback: false,
          reviewStateMaxAgeHours: 24
        }
      }
    }
  }
}

// ~/.openclaw/openclaw-research.json 单独存放
{
  "servers": {
    "default": "gateway",
    "list": ["gateway", "gpu-node-2"]
  }
}
```

**skills 代码**：
```typescript
// skills/researcher/idea-phase/index.ts
const MAX_ACTIVE_TRACKS = 2;      // ← 硬编码
const DIVERGE_SIZE = 8;            // ← 硬编码
const PORTFOLIO_SIZE = 4;          // ← 硬编码

async function generateIdeas() {
  // 生成 DIVERGE_SIZE 个想法
  // 选 PORTFOLIO_SIZE 个进竞赛
}
```

### After - 扩展后

**单个 openclaw.json**：
```json5
{
  projectsRoot: "~/.openclaw/projects",
  
  plugins: {
    entries: {
      "openclaw-research": {
        config: {
          // 数据完整性
          allowWorkspaceFallback: false,
          reviewStateMaxAgeHours: 24,
          
          // ← 新增：所有配置集中在一个地方
          projectsRoot: "~/.openclaw/projects",
          servers: {
            default: "gateway",
            list: ["gateway", "gpu-node-2", "gpu-node-3"]
          },
          ideaGeneration: {
            divergeSize: 8,
            portfolioSize: 4,
            tournamentRounds: 2
          },
          trackPortfolio: {
            maxActiveTracks: 2,
            maxParkedTracks: 1,
            parkedBudgetPolicy: "zero"
          },
          computeBudget: {
            defaultGpuHoursPerTrack: 100,
            maxConcurrentExperiments: 4,
            gpuType: "A100"
          },
          reviewLoop: {
            maxRounds: 3,
            scoreThreshold: 6.0,
            autoAdvanceScore: 7.5
          }
        }
      }
    }
  }
}
```

**skills 代码**：
```typescript
// skills/researcher/idea-phase/index.ts
async function generateIdeas() {
  const policy = getPolicy(api.config);
  const { divergeSize, portfolioSize, tournamentRounds } = policy.ideaGeneration;
  
  // 生成 divergeSize 个想法（来自配置）
  // 选 portfolioSize 个进竞赛（来自配置）
  // 运行 tournamentRounds 轮（来自配置）
  
  // 没有硬编码！所有值都可配置
}
```

---

## 📈 对比矩阵

| 方面 | 当前 | 扩展后 |
|------|------|--------|
| **配置文件数** | 3 个（openclaw.json、~/.openclaw/openclaw-research.json、{PROJ}/servers.json） | 1 个（openclaw.json）+ 可选项目级覆盖 |
| **业务参数支持** | ❌ 无 | ✅ 完整支持 7 个参数对象 |
| **配置场景适应** | ❌ 需改代码 | ✅ 改配置文件即可 |
| **类型安全** | ⚠️ 部分 | ✅ 完全（TypeScript + JSON Schema） |
| **向后兼容** | - | ✅ 100% 兼容 |
| **配置验证** | ❌ 无 | ✅ 自动检查冲突 |
| **文档完整度** | ⚠️ 分散 | ✅ 集中且详细 |

---

## 🚀 推荐的实施路径

### 选项 A: 快速版（只做 Phase 1）

**时间**：7.5 小时  
**产出**：
- ✅ plugin config 支持所有参数
- ⚠️ skills 仍用硬编码值（不会读新配置）
- ⚠️ 配置更改不会生效，除非再改代码

**适合**：紧急上线，稍后优化

### 选项 B: 完整版（Phase 1 + Phase 2）✅ 推荐

**时间**：13 小时  
**产出**：
- ✅ plugin config 支持所有参数
- ✅ skills 真正使用这些参数
- ✅ 配置修改立即生效
- ⚠️ 没有自动化验证（靠代码审查）

**适合**：大多数场景

### 选项 C: 企业版（Phase 1 + 2 + 3）

**时间**：19 小时  
**产出**：
- ✅ plugin config 支持所有参数
- ✅ skills 真正使用这些参数
- ✅ 配置修改立即生效
- ✅ 自动检测配置冲突和错误
- ✅ 完整的单元测试和集成测试

**适合**：生产环境、需要高可靠性

---

## 📋 检查清单

### 决策

- [ ] 决定采用方案 B（推荐）
- [ ] 确认 Phase 1 + 2 的工时估计（13h）
- [ ] 分配实施人员

### 准备

- [ ] 创建 feature 分支 `feature/config-extensibility`
- [ ] 备份现有 openclaw.json 和 ~/.openclaw/openclaw-research.json
- [ ] 确认测试环境可用

### Phase 1 实施

- [ ] 修改 openclaw.plugin.json（schema 扩展）
- [ ] 修改 tools/research-memory.ts（策略定义）
- [ ] 修改 index.ts（配置读取）
- [ ] 更新文档（SKILL.md）
- [ ] 验证 TypeScript 编译
- [ ] 验证 JSON Schema 合法性

### Phase 2 实施

- [ ] 修改 skills/researcher/idea-phase/
- [ ] 修改 skills/researcher/track-decision/
- [ ] 修改 skills/coder/run-experiment/
- [ ] 修改 skills/reviewer/review-phase/
- [ ] 修改 skills/researcher/frontier-mapping/
- [ ] 单元测试（每个 skill）
- [ ] 集成测试（端到端）

### 发布

- [ ] 创建 Pull Request
- [ ] 代码审查
- [ ] 合并到 main
- [ ] 更新 CHANGELOG
- [ ] 更新用户文档

---

## 📚 相关文档

- **详细分析**：[CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md) - 完整的技术方案
- **实施清单**：[CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md) - 按步骤实施
- **快速参考**：[CONFIG_QUICK_REFERENCE.md](./CONFIG_QUICK_REFERENCE.md) - 常见配置示例和故障排除
- **当前配置**：[CONFIG.md](./CONFIG.md) - 现有配置文档

---

## ⚡ 快速决策

| 问题 | 答案 |
|------|------|
| **能否现在就用 plugin config？** | ❌ 不能（schema 不支持） |
| **推荐做什么？** | ✅ 实施方案 B（Phase 1+2） |
| **需要多久？** | ⏱️ 13 小时（一个工作日） |
| **值得吗？** | 💯 绝对值得（永久获益） |
| **有风险吗？** | ✅ 无风险（向后兼容） |
| **怎么开始？** | 👉 按 [CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md) Phase 1 开始 |

---

**创建时间**：2026-03-21  
**状态**：Ready for Implementation  
**建议**：立即开始 Phase 1，下周完成 Phase 2
