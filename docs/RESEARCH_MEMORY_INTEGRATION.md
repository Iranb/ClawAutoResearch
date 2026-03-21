# Research Memory 集成方案

## 📋 概述

`research-memory.ts` 已经完整实现并集成到 OpenClaw 系统中。本文档说明其功能、当前集成状态和进一步集成方案。

---

## ✅ 当前实现的功能

### 核心功能模块

#### 1. 结构化研究记忆记录

**Idea Entry** (`recordIdeaEntry`)
- 记录成功的研究想法和假设
- 记录失败的想法和教训
- 支持新颖性分析、假设验证、失败模式分类
- 自动签名去重机制

**Experiment Entry** (`recordExperimentEntry`, `recordFailedExperimentEntry`)
- 记录实验配置、结果、资源消耗
- 失败实验的失败模式和重试条件
- 自动更新计算预算日志（Compute Budget Log）

#### 2. 评审状态管理

**Review State** (`getReviewState`, `setReviewState`, `checkReviewResumability`)
- 跟踪评审轮次、分数、结论
- 自动过期检测（24 小时阈值）
- 支持恢复/重启/无状态三种模式

#### 3. 日常日志

**Daily Log** (`appendDailyLog`)
- 按日期自动分文件
- 记录阶段、完成内容、关键决策
- 结果和下一步计划

#### 4. 项目隔离系统

- 通过 `OPENCLAW_PROJECT` 环境变量实现项目隔离
- 可配置的策略控制：
  - `requireProjectIsolation`: 强制项目隔离
  - `requireTrackId`: 强制追踪 ID
  - `requireEvidencePointers`: 强制证据指针
  - `allowWorkspaceFallback`: 允许回退到工作区级别

#### 5. 自动路径解析

**Path Resolution** (`getResolvedResearchMemoryPaths`)
- 自动解析项目根目录
- 支持项目级和工作区级两种模式
- 返回所有记忆文件的完整路径

---

## 🔧 当前集成状态

### ✅ 已完成

1. **OpenClaw 插件注册** (`index.ts`)
   - 工具名称：`research_memory`
   - 支持 8 种操作
   - 已在所有 agent 的工具配置中启用

2. **Agent 工具权限配置** (`openclaw.json`)
   ```json
   // Researcher
   tools: { allow: ["*"] }
   
   // Orchestrator
   tools: { allow: ["read", "write", "edit", "research_memory"] }
   
   // Coder
   tools: { allow: ["read", "write", "edit", "bash", "research_memory"] }
   
   // Analyzer
   tools: { allow: ["read", "write", "edit", "bash", "research_memory"] }
   
   // Academic Writer
   tools: { allow: ["read", "write", "edit", "web_search", "web_fetch", "research_memory"] }
   
   // Reviewer
   tools: { allow: ["read", "write", "edit", "bash", "memory_search", "memory_get", "web_search", "web_fetch", "research_memory"] }
   ```

3. **Plugin 配置** (`openclaw.plugin.json`)
   - 策略配置完整
   - 包含所有必要的配置项

4. **Skill 封装**
   - ✅ `skills/researcher/use-research-memory/SKILL.md`
   - ✅ `skills/coder/use-research-memory/SKILL.md`

---

## 📁 文件结构

```
openclaw-research/
├── index.ts                              # OpenClaw 插件入口
├── tools/
│   └── research-memory.ts                # 核心实现
├── skills/
│   ├── researcher/
│   │   └── use-research-memory/          # Researcher 使用指南
│   │       └── SKILL.md
│   └── coder/
│       └── use-research-memory/          # Coder 使用指南
│           └── SKILL.md
└── docs/
    └── RESEARCH_MEMORY_INTEGRATION.md    # 本文档
```

---

## 🚀 如何使用

### 通过 OpenClaw 工具调用

所有 agent 都可以通过 `research_memory` 工具调用：

```typescript
// 示例：记录想法
const result = await research_memory({
  action: "record_idea_entry",
  ideaEntry: {
    trackId: "track-001",
    title: "Graph-Augmented RAG",
    domain: "RAG, Knowledge Graphs",
    hypothesis: "Integrating citation graphs improves retrieval by 15%+",
    outcome: "success",
    whyNovel: "Prior work uses either graphs or dense retrieval",
    pilotResult: "+18% accuracy on SciQA",
    sourceStage: "idea-phase",
    confidence: 0.85,
    tags: ["rag", "graphs"],
    evidencePointers: [
      "{PROJ}/researcher/IDEA_REPORT.md#L45-L67"
    ]
  }
});
```

### 通过 Skill 调用

Agent 可以使用封装的 skill：

```markdown
/skill researcher/use-research-memory record_idea_entry track-001
```

---

## 📊 集成工作流

### IDEA 阶段

```
Researcher 完成 IDEA_REPORT.md
    ↓
为每个选中的 track 记录 idea entry
    ↓
为放弃的 track 记录失败想法
    ↓
追加日常日志
```

### CODE/EXPERIMENT 阶段

```
Coder 完成实验
    ↓
成功 → record_experiment_entry
失败 → record_failed_experiment_entry
    ↓
自动更新计算预算日志
    ↓
追加日常日志
```

### REVIEW 阶段

```
开始评审 → check_review_resumability
    ↓
每轮评审 → set_review_state (更新分数和待办)
    ↓
评审完成 → set_review_state (status: completed)
    ↓
追加日常日志
```

### WRITE 阶段

```
写作进度 → append_daily_log (phase: WRITE)
    ↓
交叉评审反馈 → record_idea_entry (如有新洞察)
    ↓
完成论文 → append_daily_log (总结)
```

---

## 🔐 环境变量配置

### 必需的环境变量

```bash
# 项目根目录（强制项目隔离时必需）
export OPENCLAW_PROJECT="/path/to/your/project"

# 工作区目录（可选，用于回退）
export OPENCLAW_WORKSPACE="/path/to/workspace"
```

### OpenClaw 自动设置

当使用 OpenClaw 启动项目时，这些变量会自动设置：
- `OPENCLAW_PROJECT`: 指向当前项目根目录
- `OPENCLAW_WORKSPACE`: 指向 agent 的工作区

---

## 📝 最佳实践

### 1. 必需字段

始终包含：
- `trackId`: 链接到 TRACK_REGISTRY.json
- `evidencePointers`: 指向具体文件
- `sourceStage`: 来源阶段
- `confidence`: 0-1 置信度

### 2. 命名规范

- 实验名：`<track>-<approach>-vN` (如 `graph-rag-v1`)
- Track ID: `track-NNN` 格式
- 标签：小写，连字符分隔

### 3. 证据指针

指向具体位置：
```json
"evidencePointers": [
  "{PROJ}/researcher/IDEA_REPORT.md#L45-L67",
  "{PROJ}/coder/exp-v1/results.json",
  "{PROJ}/graph/subgraphs/rag-neighborhood.json"
]
```

### 4. 失败记录

立即记录失败：
- 使用具体的 `failureBucket` 分类
- 明确 `retryCondition`
- 链接到失败分析文档

### 5. 评审状态

频繁更新：
- 每轮评审后更新
- 包含具体的 `pendingActions`
- 保持 `timestamp` 最新

---

## 🛠️ 进一步集成建议

### 1. 为其他 Agent 创建 Skill

建议创建：
- `skills/orchestrator/use-research-memory/SKILL.md`
- `skills/analyzer/use-research-memory/SKILL.md`
- `skills/academic_writer/use-research-memory/SKILL.md`
- `skills/reviewer/use-research-memory/SKILL.md`

### 2. 自动化集成点

在现有 skill 中自动调用 research_memory：

**researcher/idea-phase**
```markdown
在生成 IDEA_REPORT.md 后：
→ 自动调用 record_idea_entry 为每个选中的 track
```

**coder/run-experiment**
```markdown
在实验完成后：
→ 自动调用 record_experiment_entry 或 record_failed_experiment_entry
```

**reviewer/review-phase**
```markdown
在每轮评审后：
→ 自动调用 set_review_state
```

### 3. 模板文件

为常用操作创建模板：

```json
// templates/idea-entry-template.json
{
  "trackId": "track-XXX",
  "title": "...",
  "domain": "...",
  "hypothesis": "...",
  "outcome": "success|abandoned",
  "sourceStage": "...",
  "confidence": 0.0,
  "tags": [],
  "evidencePointers": []
}
```

### 4. 验证工具

添加验证函数确保数据质量：

```typescript
function validateIdeaEntry(entry: IdeaEntry): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!entry.trackId) errors.push("Missing trackId");
  if (!entry.evidencePointers?.length) errors.push("Missing evidence pointers");
  if (entry.confidence === undefined || entry.confidence < 0 || entry.confidence > 1) {
    errors.push("Invalid confidence score");
  }
  
  return errors;
}
```

---

## 🔍 调试和验证

### 检查路径配置

```json
{
  "action": "get_paths"
}
```

返回：
```json
{
  "policy": { ... },
  "mode": "project",
  "projectRoot": "/path/to/project",
  "ideationMemoryPath": "/path/to/project/memory/ideation-memory.md",
  "experimentMemoryPath": "/path/to/project/memory/experiment-memory.md",
  "reviewStatePath": "/path/to/project/researcher/REVIEW_STATE.json"
}
```

### 检查评审可恢复性

```json
{
  "action": "check_review_resumability"
}
```

返回：
```json
{
  "action": "resume|restart|none",
  "state": { ... },
  "reason": "..."
}
```

---

## 📈 监控和指标

### 计算预算跟踪

自动记录在 `experiment-memory.md`：

```markdown
## Compute Budget Log

| Project | Experiment | GPU Type | Hours | Date |
|---------|-----------|----------|-------|------|
| graph-rag | graph-rag-sciqa-v1 | NVIDIA A100 80GB | 12.5 | 2026-03-20 |
| prompt-compression | prompt-compression-v3 | NVIDIA A100 80GB | 8.2 | 2026-03-19 |
```

### 研究活动统计

通过查询记忆文件可以获得：
- 总想法数（成功/失败）
- 总实验数（成功/失败）
- 计算资源总消耗
- 各 track 的进展状态

---

## 🎯 下一步行动

### 立即可做

1. ✅ 为其他 agent 创建 use-research-memory skill
2. ✅ 在现有 skill 中添加自动调用点
3. ✅ 创建模板文件

### 中期改进

1. 添加数据验证层
2. 实现记忆查询和统计工具
3. 添加记忆压缩和归档功能

### 长期愿景

1. 跨项目记忆共享和复用
2. 基于记忆的实验推荐系统
3. 自动化研究洞察提取

---

## 📚 相关文档

- [WORKFLOW.md](../WORKFLOW.md) - 研究流程总览
- [CONFIG.md](../CONFIG.md) - 配置说明
- [skills/researcher/use-research-memory/SKILL.md](../skills/researcher/use-research-memory/SKILL.md) - Researcher 使用指南
- [skills/coder/use-research-memory/SKILL.md](../skills/coder/use-research-memory/SKILL.md) - Coder 使用指南

---

## 🤝 贡献指南

如需添加新的记忆类型或功能：

1. 在 `tools/research-memory.ts` 中实现
2. 在 `index.ts` 中注册新操作
3. 更新所有相关的 skill 文档
4. 添加测试用例

---

**状态**: ✅ 已完成基础集成，可投入使用  
**维护者**: OpenClaw Research Team  
**最后更新**: 2026-03-20
