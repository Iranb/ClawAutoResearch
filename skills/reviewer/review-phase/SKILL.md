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
  - lobster
---

# Review Phase

混合审稿循环：同模型快速反思 + 独立 Reviewer Agent 跨 Agent 审稿。
这是实验和 claim 层面的内部审稿，不替代成稿后的 `/paperreview-submit` 外部 AI 审稿。

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
3. 读取 `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` 与 `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`
4. 读取 `{PROJ}/analyzer/TRACK_VERDICTS.md`
5. 若存在，读取 `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`
6. 读取 `{PROJ}/CLAIM_POLICY.md`
7. 读取 `{PROJ}/reviewer/AUTO_REVIEW.md`（如有历史审稿）
8. 初始化轮次计数

### Loop (≤ MAX_ROUNDS)

#### Phase A: Self-Reflection（同模型）

Researcher Agent 自我反思当前工作：

- 实验覆盖了所有 baseline 吗？
- 统计显著性足够吗（≥ 3 seeds，有 CI/error bars）？
- 有没有明显的遗漏实验（消融、敏感性分析）？
- 主 claim 是否都在 `CLAIM_EVIDENCE_MATRIX.md` 中被标记为 `SUPPORTED`？
- 理论支撑如果偏弱，是否已经在 `THEORY_SUPPORT_NOTE.md` 中被明确标成 `RED`，以便写作阶段保守表述？
- 代码是否可复现（seeds、版本、配置记录完整）？
- 当前 paper scope 是否已经足够，而不是还在无意义扩张？

如果发现小问题（bug、参数调优），直接修复并重跑，不进入跨 Agent 审稿。

#### Phase B: Cross-Agent Review（独立 Reviewer）

准备审稿材料：
- 从 `{PROJ}/analyzer/NARRATIVE_REPORT.md` 提取核心内容
- 附上 `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`
- 附上 `{PROJ}/analyzer/TRACK_VERDICTS.md`
- 若存在，附上 `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`
- 不包含实现细节、调试日志等内部信息
- 附上图表和关键指标表

通过 `sessions_send` 发送给 Reviewer Agent：

```
请审稿以下研究工作：

[审稿材料内容]

请按照你的 SOUL.md 中定义的 5 个维度评分，输出结构化审稿意见。
如果材料里提供了 theory support note，请额外给出 `Theory: GREEN/RED` 的 advisory signal。
```

#### Phase C: Parse & Decide

解析 Reviewer 返回的审稿意见：
- 提取 score、verdict、action items
- **STOP CONDITION**: score ≥ 6、verdict 包含 "ready"，主 claim 无 `UNSUPPORTED` 项，且 reviewer 未要求继续扩 scope → 停止，记录最终状态
- `Theory: RED` 只作为写作提示，不单独触发继续补实验

#### Phase D: Implement Fixes（如未通过）

按 action items 优先级实施修复：
1. 代码修复 → 重跑实验
2. 补充实验（消融、baseline）
3. 改进分析和可视化
4. 降级或删除 unsupported claim
5. 缩 scope / 停掉弱 track
6. 更新报告
7. 若 theory 为 `RED`，把风险保留到写作阶段，不必强制补齐理论后才继续

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
4. 若后续生成了 `{PROJ}/academic_writer/paper/main.pdf`，必须进入外部审稿阶段并运行 `/paperreview-submit`

如果当前结论是进入 WRITE，则在 durable review state 更新完成后再调用 Lobster handoff。

如果结论是补实验、缩 scope、继续 review 轮次，或回退到 IDEA / EXPERIMENT / ANALYZE，则不要向前 handoff。
