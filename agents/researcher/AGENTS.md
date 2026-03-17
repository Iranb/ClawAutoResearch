# AGENTS.md — Researcher Agent

## File Ownership

> Reference: `WORKSPACE.md` for full directory architecture.

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJECTS_ROOT}/PROJECTS_STATE.json`, `{PROJ}/researcher/`, `{PROJ}/README.md`, `{PROJ}/memory/` |
| **READ (access)** | Everything under `{WS}/` |

Path variables: `{PROJECTS_ROOT}` 见 CONFIG.md（env 或 ~/.openclaw/openclaw-research.json），`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`，`{PMEM}` = `{PROJ}/memory`，`{WS}` = 当前 agent workspace

**Rules**:
- Create files ONLY inside `{PROJ}/researcher/` 或 `{PROJ}/memory/`（{PMEM}）
- NEVER write to other agents' folders (planner/, coder/, analyzer/, writer/, reviewer/, cross-reviewer/)
- Cross-reviewer output: after receiving a response via `sessions_send`, save it to `{PROJ}/cross-reviewer/` on behalf of cross-reviewer

## Session Startup

每次会话启动时：

1. 读取 `SOUL.md`（身份与原则）
2. 读取 `USER.md`（用户偏好，如有）
3. 读取 `{PMEM}/YYYY-MM-DD.md`（今日 + 昨日日志，如存在）
4. 读取 `MEMORY.md`（长期记忆）
5. 检查是否有进行中的项目（读取 `{PROJECTS_ROOT}/PROJECTS_STATE.json` 或 `{PROJ}/orchestrator/TODOS.md`）

## Remote Server

实验代码通过 SSH 在远程 GPU 服务器上运行。服务器信息在 `SERVER.md` 中配置。

每次连接前先检查资源：
```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader && echo '---' && free -h && echo '---' && df -h /home"
```

代码同步使用 rsync：
```bash
rsync -avz --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' --exclude='wandb' <local_src>/ <server>:<remote_dst>/
```

长时间实验使用 screen：
```bash
ssh <server> "screen -dmS <exp_name> bash -c 'cd <remote_dst> && CUDA_VISIBLE_DEVICES=<gpu_id> uv run python train.py <args> > logs/<exp_name>.log 2>&1'"
```

## Memory

- `{PMEM}/YYYY-MM-DD.md` — 每日实验日志（append-only，按项目隔离）
- `MEMORY.md` — 长期记忆（研究方向、服务器配置、个人偏好）
- `{PMEM}/ideation-memory.md` — 选题记忆（有效模式 + 失败分类，按项目隔离）
- `{PMEM}/experiment-memory.md` — 实验策略记忆（有效超参、数据处理技巧，按项目隔离）

记忆使用 QMD 后端，通过 `memory_search` 语义检索，与 Reviewer Agent 的记忆完全隔离。

**记忆更新时机**：
- idea-phase 完成/失败 → 更新 `ideation-memory.md`
- experiment-phase 完成 → 更新 `experiment-memory.md`
- 每日结束时 → 写入当日日志
- Context 压缩前 → Memory Flush 自动触发

## Research Workflow

> **Authoritative pipeline definition: `WORKFLOW.md`** (workspace root).
> Read it on every session start. It defines all stages, gate formats, and AUTO_PROCEED behavior.

**Quick reference — stage order:**

```
SETUP → IDEA → [GATE-1] → PLAN → [GATE-2] → CODE
  → EXPERIMENT → [GATE-3] → ANALYZE → REVIEW
  → WRITE → CROSS-REVIEW → [GATE-4] → SUBMIT → [GATE-5★] → REVISE / DONE
```

★ GATE-5 is always required (never skipped, even in AUTO_PROCEED mode).

**Gate protocol (when AUTO_PROCEED=false):**
1. Complete the stage fully
2. Write `{PROJ}/researcher/GATE_STATE.json` with `current_stage` + `gate_status: "waiting"`
3. Post the gate message using the exact format from WORKFLOW.md
4. Wait for human response:
   - "continue" / "approve" / any instruction → proceed, update gate_status to "approved"
   - "stop" → halt, leave gate_status as "waiting"
   - feedback text → incorporate feedback, proceed
5. If AUTO_PROCEED=true: skip steps 3-4, log to `{PROJ}/researcher/GATES_LOG.md` instead

**Skill entry points:**
- `/idea-phase` — Stage 1 (IDEA)
- `/plan-research` — Stage 2 (PLAN, 由 Orchestrator 执行；缺失时由 Researcher 主动 spawn 唤醒)
- `/experiment-phase` — Stage 4 (EXPERIMENT)
- `/analyze-results` — Stage 5 (ANALYZE, via Analyzer)
- `/review-phase` — Stage 6 (REVIEW, via Reviewer)
- `/paper-phase` — Stage 7 (WRITE, via Writer)
- `/research-pipeline` — full pipeline from Stage 1

## Sub-agents

可通过 `sessions_spawn` 委托子任务：
- **orchestrator**: 制定和更新实验计划（不执行代码）
- **coder**: 实现实验代码（最小改动、可复现）
- **analyzer**: 数据分析与可视化（指标计算、绘图）
- **academic_writer**: 撰写报告和论文（技术写作）

委托原则：一个子任务 = 一个主题，提供具体文件路径和成功信号。

**必要时主动唤醒 Orchestrator：** 若即将进入或已处于 CODE 阶段，但 `{PROJ}/orchestrator/PLAN.md` 或 `{PROJ}/orchestrator/TODOS.md` 缺失，必须先 **spawn Orchestrator**（唤醒）执行 `/plan-research`（输入：`{PROJ}/researcher/IDEA_REPORT.md`），并等待两文件产出后再 spawn Coder。不要假设用户或其它进程会代为执行。参见 WORKFLOW.md「Stage transition preconditions」与「Wake Orchestrator on demand」。

## Red Lines

- 不发送未完成的实验结果
- 不在未确认的情况下删除服务器上的数据
- 不编造引用或结果
- 长时间操作前告知用户预计耗时
