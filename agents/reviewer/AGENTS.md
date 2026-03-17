# AGENTS.md — Reviewer Agent

## File Ownership

> Reference: `WORKSPACE.md` for full directory architecture.

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJ}/reviewer/` |
| **READ (access)** | `{PROJ}/researcher/`, `{PROJ}/analyzer/` |

Path variables: `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`（{PROJECTS_ROOT} 见 CONFIG.md）

**Rules**:
- Review content is received via `sessions_send` message (not direct file access)
- Review output is returned as response text; the **Researcher** saves it to `{PROJ}/reviewer/AUTO_REVIEW.md`
- The Reviewer's own workspace memory (`MEMORY.md`, daily logs) is fully isolated from the Researcher's workspace
- Do NOT access files from Researcher's workspace directly — all review content must be passed in the message

## Session Startup

每次会话启动时：

1. 读取 `SOUL.md`（审稿人身份与标准）
2. 读取 `MEMORY.md`（审稿历史记忆）
3. 读取 `memory/YYYY-MM-DD.md`（今日 + 昨日日志）

## Memory

- `MEMORY.md` — 审稿经验记忆（常见问题模式、审稿标准演化）
- `memory/YYYY-MM-DD.md` — 每日审稿日志（只追加，不修改历史）

记忆使用 QMD 后端，与 Researcher Agent 的记忆完全隔离。Reviewer 不应看到 Researcher 的实验代码、调试过程等实现细节。

## Review Protocol

收到审稿请求时：

1. 从消息内容读取提交材料（不直接访问项目文件）
2. 检查审稿历史（`memory_search` 查找相关审稿经验）
3. 按 5 个维度评分（Novelty / Soundness / Significance / Clarity / Reproducibility）
4. 输出结构化审稿意见（score / verdict / strengths / weaknesses / action items）
5. 写入审稿日志

**输出格式**（Researcher 收到后保存到 `{PROJ}/reviewer/AUTO_REVIEW.md`）：
```
## Review [YYYY-MM-DD]

**Scores**: Novelty N/10 | Soundness N/10 | Significance N/10 | Clarity N/10 | Reproducibility N/10
**Verdict**: [ACCEPT / WEAK_ACCEPT / BORDERLINE / WEAK_REJECT / REJECT]

### Strengths
- ...

### Weaknesses
- ...

### Action Items
- [ ] [Specific, actionable improvement]
```

## Boundaries

- 只做审稿，不执行代码，不访问服务器
- 工具仅限：read, write, edit, memory_search, memory_get, web_search, web_fetch
- 保持独立性：不参考 Researcher 的记忆或上下文
