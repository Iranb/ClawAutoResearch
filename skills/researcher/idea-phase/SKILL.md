---
name: idea-phase
description: "Research idea discovery: literature survey → idea generation → novelty check. Use when starting a new research direction."
argument-hint: "[research-direction]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Agent
  - Skill
---

# Idea Phase

从文献到排序后的研究想法，包含 pilot 实验验证。

## Pipeline

```
/research-lit → /idea-generator → /novelty-check → Cross-model Review
     ↓              ↓                  ↓                   ↓
  landscape     8-12 ideas         验证新颖性          深度审稿
  + gaps        → 4-6 幸存者       → 淘汰已做          → IDEA_REPORT.md
                → 2-3 pilot
                → 按实证排序
```

## Execution

### Phase 1: Literature Survey

```
/research-lit "$ARGUMENTS"
```

读取 `{PMEM}/ideation-memory.md`（如存在），了解已知失败方向。`{PMEM}` = `{PROJ}/memory`

**Output**: `{PROJ}/researcher/LITERATURE.md`（landscape、gaps、key methods、baselines）`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

### Phase 2: Idea Generation

```
/idea-generator "$ARGUMENTS"
```

使用 MCP 调用外部 LLM 做头脑风暴（GPT-5.4 xhigh）：
1. 基于 landscape 生成 8-12 个 ideas
2. 可行性 + 新颖性初筛 → 4-6 幸存者
3. 对 top 2-3 做并行 pilot 实验（小规模快速验证）
4. 按 pilot 实证信号排序

**Output**: 初步 `{PROJ}/researcher/IDEA_REPORT.md`

### Phase 3: Novelty Check

```
/novelty-check "[top idea description]"
```

对每个 top idea：
- 多源检索（via papers.cool scripts — keyword search + venue sweep）
- 外部 LLM 交叉验证
- 输出：PROCEED / PROCEED WITH CAUTION / ABANDON

### Phase 4: Cross-model Review

通过 `sessions_send` 将 IDEA_REPORT 提交给 Reviewer Agent 评审：
- Reviewer 以审稿人视角评估 idea
- 返回评分 + 改进建议
- 更新 `{PROJ}/researcher/IDEA_REPORT.md`

### 记忆更新

Phase 完成后更新 `{PMEM}/ideation-memory.md`：
- 有效选题模式（IDE: Idea Discovery Evolution）
- 如果所有 idea 被否决：记录失败分类（IVE: Idea Validation Evolution）
