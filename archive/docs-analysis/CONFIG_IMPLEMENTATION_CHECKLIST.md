# Config 扩展实施检查清单

## 📋 概览

本文档追踪 plugin config 扩展的实施进度，包括代码修改、测试和文档更新。

---

## Phase 1: Schema & Policy Definition ✅ 规划中

### 1.1 openclaw.plugin.json - 扩展 configSchema

- [ ] **文件**：`openclaw.plugin.json`
- [ ] **任务**：在 `configSchema.properties` 中添加以下字段组：
  ```
  projectsRoot (string)
  servers (object with default, list)
  ideaGeneration (object: divergeSize, portfolioSize, tournamentRounds)
  trackPortfolio (object: maxActiveTracks, maxParkedTracks, parkedBudgetPolicy)
  computeBudget (object: defaultGpuHoursPerTrack, maxConcurrentExperiments, gpuType)
  reviewLoop (object: maxRounds, scoreThreshold, autoAdvanceScore)
  graphConfig (object: autoRefreshTrigger, noveltyThreshold, maxPapersToIngest)
  ```
- [ ] **验证**：schema 通过 JSON Schema 验证
- [ ] **向后兼容**：现有 config 不需改动，都有默认值

**预期代码行数**：~150 行 (在 `configSchema.properties` 中)

---

### 1.2 tools/research-memory.ts - 扩展 ResearchMemoryPolicy

- [ ] **文件**：`tools/research-memory.ts` L11-19
- [ ] **任务**：在 `ResearchMemoryPolicy` 接口中添加：
  ```typescript
  projectsRoot?: string;
  servers?: { default: string; list: string[] };
  ideaGeneration?: { divergeSize?: number; ... };
  trackPortfolio?: { maxActiveTracks?: number; ... };
  computeBudget?: { defaultGpuHoursPerTrack?: number; ... };
  reviewLoop?: { maxRounds?: number; ... };
  graphConfig?: { autoRefreshTrigger?: string; ... };
  ```
- [ ] **验证**：TypeScript 编译无错误
- [ ] **向后兼容**：所有新字段都是可选的 (`?`)

**预期代码行数**：~45 行

---

### 1.3 tools/research-memory.ts - 更新 DEFAULT_POLICY

- [ ] **文件**：`tools/research-memory.ts` L79-87
- [ ] **任务**：为每个新字段添加默认值
  ```typescript
  projectsRoot: "~/.openclaw/projects",
  servers: { default: "gateway", list: ["gateway"] },
  ideaGeneration: { divergeSize: 8, portfolioSize: 4, tournamentRounds: 2 },
  // ... 等等
  ```
- [ ] **验证**：所有默认值符合 configSchema 的 constraints (min/max/enum)

**预期代码行数**：~55 行

---

### 1.4 tools/research-memory.ts - 更新 normalizePolicy()

- [ ] **文件**：`tools/research-memory.ts` L88-117
- [ ] **任务**：添加合并逻辑，将输入 policy 与默认值合并
  ```typescript
  projectsRoot: policy.projectsRoot ?? DEFAULT_POLICY.projectsRoot,
  servers: {
    default: policy.servers?.default ?? DEFAULT_POLICY.servers.default,
    list: policy.servers?.list ?? DEFAULT_POLICY.servers.list,
  },
  // ... 其他字段
  ```
- [ ] **验证**：部分配置和完整配置都能正常合并

**预期代码行数**：~70 行

---

### 1.5 tools/research-memory.ts - 新增 getBusinessConfig() 导出函数

- [ ] **文件**：`tools/research-memory.ts` 末尾
- [ ] **任务**：添加导出函数用于外部获取业务级配置
  ```typescript
  export function getBusinessConfig(
    policy: Required<ResearchMemoryPolicy>
  ) {
    return {
      projectsRoot: policy.projectsRoot,
      servers: policy.servers,
      ideaGeneration: policy.ideaGeneration,
      // ... 其他字段
    };
  }
  ```
- [ ] **验证**：函数能被技能调用

**预期代码行数**：~20 行

---

### 1.6 index.ts - 更新 getPolicy() 函数

- [ ] **文件**：`index.ts` L92-102
- [ ] **任务**：添加类型检查和转换逻辑
  ```typescript
  projectsRoot:
    typeof config?.projectsRoot === "string"
      ? config.projectsRoot
      : "~/.openclaw/projects",
  servers:
    config?.servers && typeof config.servers === "object"
      ? { ... }
      : { default: "gateway", list: ["gateway"] },
  // ... 其他字段
  ```
- [ ] **验证**：配置可以从 openclaw.json 安全读取

**预期代码行数**：~80 行

---

### ✅ Phase 1 完成条件

- [ ] TypeScript 编译无错误：`tsc --noEmit`
- [ ] 所有新字段都有默认值
- [ ] configSchema 中的所有字段都在代码中被处理
- [ ] 修改了 SKILL.md 配置示例（见下方）
- [ ] 新增 CONFIG_EXTENSIBILITY_ANALYSIS.md 文档

---

## Phase 2: Integration with Skills ⏳ 可选

### 2.1 Researcher - /idea-phase 技能

- [ ] **文件**：`skills/researcher/idea-phase/index.ts`
- [ ] **任务**：读取 `ideaGeneration` 配置
  ```typescript
  const policy = getPolicy(api.config);
  const { divergeSize, portfolioSize, tournamentRounds } = policy.ideaGeneration;
  // 在生成和竞赛逻辑中使用这些值，而非硬编码
  ```
- [ ] **验证**：different config 值会改变生成的 idea 数量

**预期代码行数**：~10-20 行修改

---

### 2.2 Researcher - Track Decision Logic

- [ ] **文件**：`skills/researcher/idea-phase/index.ts`（或单独的 track 决策逻辑）
- [ ] **任务**：读取 `trackPortfolio` 配置，在 portfolio selection 中应用
  ```typescript
  const { maxActiveTracks, maxParkedTracks, parkedBudgetPolicy } = policy.trackPortfolio;
  // 强制 active tracks ≤ maxActiveTracks
  // 强制 parked tracks ≤ maxParkedTracks
  ```
- [ ] **验证**：config 中的约束被强制执行，超出时报错

**预期代码行数**：~15-25 行修改

---

### 2.3 Coder - 实验执行 /run-experiment

- [ ] **文件**：`skills/coder/run-experiment/index.ts`
- [ ] **任务**：读取 `computeBudget.maxConcurrentExperiments`，限制并发数
  ```typescript
  const { maxConcurrentExperiments, gpuType } = policy.computeBudget;
  // 在任务队列中，最多允许 maxConcurrentExperiments 个并发任务
  ```
- [ ] **验证**：超过并发限制时，新任务进入等待队列

**预期代码行数**：~10-15 行修改

---

### 2.4 Reviewer - /review-phase 技能

- [ ] **文件**：`skills/reviewer/review-phase/index.ts`
- [ ] **任务**：读取 `reviewLoop` 配置
  ```typescript
  const { maxRounds, scoreThreshold, autoAdvanceScore } = policy.reviewLoop;
  // 在评审循环中应用 maxRounds 和分数阈值
  ```
- [ ] **验证**：score ≥ autoAdvanceScore 时自动推进，max rounds 时停止

**预期代码行数**：~10-15 行修改

---

### 2.5 Researcher - /frontier-mapping 或 graph-build

- [ ] **文件**：`skills/researcher/frontier-mapping/` 或 `graph-build/`
- [ ] **任务**：读取 `graphConfig` 配置
  ```typescript
  const { autoRefreshTrigger, noveltyThreshold, maxPapersToIngest } = policy.graphConfig;
  ```
- [ ] **验证**：图谱构建遵循 refresh trigger 策略，novelty 分数使用 threshold

**预期代码行数**：~10-15 行修改

---

### ✅ Phase 2 完成条件

- [ ] 所有 5 个技能都成功读取对应的配置字段
- [ ] 没有引入新的错误（`tsc --noEmit`）
- [ ] 每个技能都有对应的集成测试或验证日志
- [ ] 更新 SKILL.md 中的技能文档，说明它们如何使用新配置

---

## Phase 3: Validation & Testing 🔮 可选

### 3.1 配置冲突检测

- [ ] **文件**：新增 `tools/config-validator.ts`
- [ ] **任务**：实现检查函数
  ```typescript
  export function validateBusinessConfig(policy: Required<ResearchMemoryPolicy>) {
    // 检查 ideaGeneration.divergeSize >= trackPortfolio.maxActiveTracks
    // 检查 trackPortfolio.maxActiveTracks + maxParkedTracks <= ideaGeneration.portfolioSize
    // 检查 computeBudget.maxConcurrentExperiments >= 1
    // 等等
    if (/* 检查失败 */) throw new Error("配置冲突...");
  }
  ```
- [ ] **集成**：在 `normalizePolicy` 或 plugin 注册时调用

**预期代码行数**：~50 行

---

### 3.2 单元测试

- [ ] **文件**：新增 `tools/__tests__/research-memory.config.test.ts`
- [ ] **测试用例**：
  - [ ] 默认 policy 完整性
  - [ ] 部分 config 合并正确性
  - [ ] 边界值（min/max）处理
  - [ ] 类型强制（string → enum 等）
  - [ ] 向后兼容性（不包含新字段的旧 config）

**预期代码行数**：~150 行

---

### 3.3 集成测试

- [ ] **文件**：新增 `__tests__/e2e/config-integration.test.ts`
- [ ] **场景**：
  - [ ] 启动 Researcher，验证能读取 ideaGeneration config
  - [ ] 执行 idea-phase，验证生成数量符合 divergeSize
  - [ ] 执行 track selection，验证遵守 maxActiveTracks 约束
  - [ ] 启动 Coder，验证能读取 computeBudget config
  - [ ] 验证冲突检测的错误信息清晰

**预期代码行数**：~200 行

---

### ✅ Phase 3 完成条件

- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 集成测试全部通过
- [ ] 添加 CONFIG_VALIDATION.md 文档

---

## 📝 文档更新清单

### 已完成 ✅

- [x] SKILL.md - 更新配置示例（已完成）
- [x] 新增 CONFIG_EXTENSIBILITY_ANALYSIS.md（已完成）

### 待完成 ⏳

- [ ] README.md - 添加配置快速参考
- [ ] CONFIG.md - 补充新配置字段的解释
- [ ] WORKFLOW.md - 在各 stage 说明使用哪些配置
- [ ] openclaw.plugin.json - uiHints 中为新字段添加 UI 提示
- [ ] 新增 CONFIG_EXAMPLES.md - 常见配置模板（单 GPU、多 GPU、云、本地）

---

## 🔄 提交顺序建议

```
Commit 1: Phase 1.1-1.6 (Schema & Policy)
  - openclaw.plugin.json
  - tools/research-memory.ts (完全修改)
  - index.ts (getPolicy 函数)
  - SKILL.md 配置示例
  Message: "feat: extend plugin config for business-level settings"

Commit 2: Phase 2.1-2.5 (Skill Integration)
  - skills/researcher/idea-phase/
  - skills/researcher/track-decision/
  - skills/coder/run-experiment/
  - skills/reviewer/review-phase/
  - skills/researcher/frontier-mapping/ or graph-build/
  Message: "feat: integrate business config in all skills"

Commit 3: Documentation
  - CONFIG_EXTENSIBILITY_ANALYSIS.md (已创建)
  - CONFIG.md (补充)
  - WORKFLOW.md (补充)
  - README.md (补充)
  Message: "docs: document config extensibility"

Commit 4: Tests & Validation (Phase 3)
  - __tests__/
  - tools/config-validator.ts
  Message: "test: add config validation and integration tests"
```

---

## 📊 进度总览

| Phase | 名称 | 优先级 | 状态 | 工时估计 |
|-------|------|--------|------|---------|
| 1.1 | openclaw.plugin.json schema | 🔴 高 | ⬜ 未开始 | 2h |
| 1.2 | ResearchMemoryPolicy 接口 | 🔴 高 | ⬜ 未开始 | 1h |
| 1.3 | DEFAULT_POLICY 默认值 | 🔴 高 | ⬜ 未开始 | 1h |
| 1.4 | normalizePolicy() 合并逻辑 | 🔴 高 | ⬜ 未开始 | 1.5h |
| 1.5 | getBusinessConfig() 导出 | 🔴 高 | ⬜ 未开始 | 0.5h |
| 1.6 | index.ts getPolicy() 更新 | 🔴 高 | ⬜ 未开始 | 1.5h |
| **Phase 1 小计** | | | | **7.5h** |
| 2.1 | /idea-phase 集成 | 🟡 中 | ⬜ 未开始 | 1h |
| 2.2 | Track decision 集成 | 🟡 中 | ⬜ 未开始 | 1.5h |
| 2.3 | /run-experiment 集成 | 🟡 中 | ⬜ 未开始 | 1h |
| 2.4 | /review-phase 集成 | 🟡 中 | ⬜ 未开始 | 1h |
| 2.5 | /frontier-mapping 集成 | 🟡 中 | ⬜ 未开始 | 1h |
| **Phase 2 小计** | | | | **5.5h** |
| 3.1 | 配置冲突检测 | 🟢 低 | ⬜ 未开始 | 2h |
| 3.2 | 单元测试 | 🟢 低 | ⬜ 未开始 | 2h |
| 3.3 | 集成测试 | 🟢 低 | ⬜ 未开始 | 3h |
| **Phase 3 小计** | | | | **7h** |
| 📝 | 文档更新 | 🟡 中 | ✅ 部分完成 | 2h |
| **总计** | | | | **19h** |

---

## 💡 关键链接

- 主分析文档：[CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md)
- 原始 SKILL.md：[SKILL.md](./SKILL.md)
- Plugin 配置：[openclaw.plugin.json](./openclaw.plugin.json)
- 配置读取工具：[tools/research-memory.ts](./tools/research-memory.ts)
- Plugin 入口：[index.ts](./index.ts)

---

## ⚠️ 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 配置冲突（如 diverge 数 < active 轨道数） | 中 | 高 | 实现 Phase 3 验证器 |
| 技能忽视新配置，仍用硬编码值 | 中 | 中 | 代码审查 + 单元测试 |
| 向后兼容性破裂 | 低 | 高 | 所有新字段都是可选的 + 默认值 |
| 配置误读（字符串 → enum） | 低 | 中 | 在 index.ts getPolicy() 中严格类型检查 |

---

## ✨ 下一步行动

1. **确认**: 审核本检查清单，确认优先级和工时估计
2. **创建分支**: `feature/config-extensibility`
3. **开始 Phase 1**: 从 1.1 开始，按顺序完成
4. **定期同步**: 每完成一个 Phase，更新本清单中的 checkbox

---

**最后更新**：2026-03-21  
**状态**：Planning 中
