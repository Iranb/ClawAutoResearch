---
name: review-phase
description: "Hybrid review loop: same-model reflection + cross-agent review with isolated Reviewer. Use after experiments complete."
argument-hint: "[topic or scope — chosen idea title]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - Skill
---

# Review Phase

混合审稿循环：同模型快速反思 + 独立 Reviewer Agent 跨 Agent 审稿。

## Constants

- **MAX_ROUNDS = 4**
- **POSITIVE_THRESHOLD**: score ≥ 6/10, verdict 包含 "ready" 或 "almost"
- **REVIEW_DOC**: `{PROJ}/reviewer/AUTO_REVIEW.md`（累积审稿记录）
- **HUMAN_CHECKPOINT = false** — 当 `true` 时，每轮审稿后暂停等待用户指令

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## State Persistence

`{PROJ}/researcher/REVIEW_STATE.json` 支持 context compaction 后恢复：

```json
{
  "round": 2,
  "status": "in_progress",
  "last_score": 5.0,
  "last_verdict": "not ready",
  "pending_experiments": [],
  "timestamp": "2026-03-16T22:00:00"
}
```

恢复逻辑：
- `status: "completed"` → 重新开始
- `status: "in_progress"` 且超过 24 小时 → 过期，重新开始
- `status: "in_progress"` 且 24 小时内 → 从下一轮继续

## Pipeline

### Initialization

1. 检查 `{PROJ}/researcher/REVIEW_STATE.json` 是否存在及状态
2. 读取实验报告（`{PROJ}/researcher/EXPERIMENT_LOG.md`、`{PROJ}/analyzer/NARRATIVE_REPORT.md`）
3. 读取 `{PROJ}/reviewer/AUTO_REVIEW.md`（如有历史审稿）
4. 初始化轮次计数

### Loop (≤ MAX_ROUNDS)

#### Phase A: Self-Reflection（同模型）

Researcher Agent 自我反思当前工作：

- 实验覆盖了所有 baseline 吗？
- 统计显著性足够吗（≥ 3 seeds，有 CI/error bars）？
- 有没有明显的遗漏实验（消融、敏感性分析）？
- 代码是否可复现（seeds、版本、配置记录完整）？

如果发现小问题（bug、参数调优），直接修复并重跑，不进入跨 Agent 审稿。

#### Phase B: Cross-Agent Review（独立 Reviewer）

准备审稿材料：
- 从 `{PROJ}/analyzer/NARRATIVE_REPORT.md` 提取核心内容
- 不包含实现细节、调试日志等内部信息
- 附上图表和关键指标表

通过 `sessions_send` 发送给 Reviewer Agent：

```
请审稿以下研究工作：

[审稿材料内容]

请按照你的 SOUL.md 中定义的 5 个维度评分，输出结构化审稿意见。
```

#### Phase C: Parse & Decide

解析 Reviewer 返回的审稿意见：
- 提取 score、verdict、action items
- **STOP CONDITION**: score ≥ 6 且 verdict 包含 "ready" → 停止，记录最终状态

#### Phase D: Implement Fixes（如未通过）

按 action items 优先级实施修复：
1. 代码修复 → 重跑实验
2. 补充实验（消融、baseline）
3. 改进分析和可视化
4. 更新报告

#### Phase E: Document Round

追加到 `{PROJ}/reviewer/AUTO_REVIEW.md`（Researcher 负责写入）：

```markdown
## Round N (timestamp)
- **Self-reflection**: [发现的问题和修复]
- **Reviewer score**: X/10
- **Verdict**: [ready / almost / not ready]
- **Key issues**: [...]
- **Actions taken**: [...]
- **Status**: [continuing / stopping]
```

更新 `{PROJ}/researcher/REVIEW_STATE.json`。

### Completion

1. 更新 `{PROJ}/researcher/REVIEW_STATE.json` 为 `status: "completed"`
2. 写入最终审稿总结到 `{PROJ}/reviewer/AUTO_REVIEW.md`
3. 更新 `{PMEM}/experiment-memory.md`（ESE），`{PMEM}` = `{PROJ}/memory`
